import * as THREE from 'three';
import type { ChoreoProgram } from '../core/choreo/program';
import type { ShotPlan } from '../core/cinema/planner';
import type { PerformanceScore } from '../core/types';
import { evaluateCamera, type CameraState } from '../scene/cameras';
import { KEY_TOP_Y } from '../scene/mapping';

/**
 * Bakes the AI performance into an engine-agnostic JSON for offline rendering
 * (Blender/Unreal/Unity). All positions are world-space meters matching the
 * app's scene: keyboard centered on x=0, white-key tops at y=0.735, +z toward
 * the pianist. Finger angles are radians in hand-local space: fingers extend
 * along -Z, X is the flex axis, Y the yaw axis (see docs/BLENDER.md).
 */

export interface BlenderBake {
  format: 'concert-creator-bake';
  version: 1;
  fps: number;
  duration: number;
  world: { keyTopY: number; keyboardWidth: number };
  notes: Array<{ midi: number; start: number; end: number; velocity: number; hand: 'L' | 'R'; finger: number }>;
  frames: BakedFrame[];
}

interface BakedHand {
  wrist: [number, number, number];
  quat: [number, number, number, number];
  roll: number;
  fingers: Array<{ yaw: number; mcp: number; pip: number; dip: number; press: number }>;
}

interface BakedFrame {
  t: number;
  L: BakedHand;
  R: BakedHand;
  keys: number[]; // 88 dips, rounded
  pedal: number;
  body: { leanX: number; leanZ: number; sway: number };
  head: { yaw: number; pitch: number };
  camera: { pos: [number, number, number]; target: [number, number, number]; fov: number };
}

const UP_Y = new THREE.Vector3(0, 1, 0);

export function bakeForBlender(
  score: PerformanceScore,
  choreo: ChoreoProgram,
  shots: ShotPlan,
  fps = 30,
): BlenderBake {
  const frames: BakedFrame[] = [];
  const total = Math.ceil(choreo.duration * fps);
  const camState: CameraState = {
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    fov: 40,
    focus: 3,
  };
  const activeCenter = new THREE.Vector3();
  const tipsAvg = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const rollQ = new THREE.Quaternion();
  const back = new THREE.Vector3();

  const world = (x: number, y: number, z: number): [number, number, number] => [
    (x - 611) / 1000,
    KEY_TOP_Y + y / 1000,
    z / 1000,
  ];

  for (let f = 0; f < total; f++) {
    const t = f / fps;
    const frame = choreo.sample(t);

    const bakeHand = (hand: 'L' | 'R'): BakedHand => {
      const pose = frame.hands[hand];
      const wrist = world(pose.wrist.x, pose.wrist.y, pose.wrist.z);
      tipsAvg.set(0, 0, 0);
      for (const fp of pose.fingers) {
        const [x, y, z] = world(fp.tip.x, fp.tip.y, fp.tip.z);
        tipsAvg.x += x / 5;
        tipsAvg.y += y / 5;
        tipsAvg.z += z / 5;
      }
      fwd.set(tipsAvg.x - wrist[0], (tipsAvg.y - wrist[1]) * 0.35, tipsAvg.z - wrist[2]);
      if (fwd.lengthSq() < 1e-8) fwd.set(0, -0.2, -1);
      fwd.normalize();
      back.copy(fwd).negate();
      right.crossVectors(UP_Y, back).normalize();
      up.crossVectors(back, right).normalize();
      mtx.makeBasis(right, up, back);
      q.setFromRotationMatrix(mtx);
      rollQ.setFromAxisAngle(back, pose.roll * (hand === 'R' ? -1 : 1));
      q.premultiply(rollQ);
      return {
        wrist,
        quat: [q.x, q.y, q.z, q.w],
        roll: pose.roll,
        fingers: pose.fingers.map((fp, i) => {
          // hand-local tip → chain angles, mirroring the studio's solver
          const local = new THREE.Vector3(
            (fp.tip.x - pose.wrist.x) / 1000,
            (fp.tip.y - pose.wrist.y) / 1000,
            (fp.tip.z - pose.wrist.z) / 1000,
          ).applyQuaternion(q.clone().invert());
          const slots = [-0.04, -0.023, -0.008, 0.008, 0.023];
          const bx = (hand === 'L' ? -1 : 1) * slots[i];
          local.x -= bx;
          local.z += i === 0 ? 0.028 : 0.08;
          const yaw = Math.atan2(-local.x, -local.z);
          const l1 = 0.046;
          const l2 = 0.048;
          const horiz = Math.hypot(local.x, local.z);
          const d = THREE.MathUtils.clamp(Math.hypot(horiz, local.y), 0.012, l1 + l2 - 1e-4);
          const phi = Math.atan2(-local.y, horiz);
          const a1 = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
          const bend = Math.PI - Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
          return {
            yaw: Number((THREE.MathUtils.clamp(yaw, -0.6, 0.6) * 0.85).toFixed(4)),
            mcp: Number(THREE.MathUtils.clamp(-(phi - a1) - 0.05, -1.45, 0.1).toFixed(4)),
            pip: Number(THREE.MathUtils.clamp(-bend * 0.75, -1.9, 0).toFixed(4)),
            dip: Number(THREE.MathUtils.clamp(-bend * 0.45, -1.2, 0).toFixed(4)),
            press: Number(fp.press.toFixed(3)),
          };
        }),
      };
    };

    const L = bakeHand('L');
    const R = bakeHand('R');

    // camera follows the studio's AUTO cinematography
    let pressL = 0;
    let pressR = 0;
    for (const fp of frame.hands.L.fingers) pressL += fp.press;
    for (const fp of frame.hands.R.fingers) pressR += fp.press;
    const bias = pressL + pressR > 0.05 ? pressR / (pressL + pressR) : 0.5;
    activeCenter.set(
      (frame.hands.L.wrist.x * (1 - bias) + frame.hands.R.wrist.x * bias - 611) / 1000,
      0.75,
      0.05,
    );
    evaluateCamera('AUTO', shots, t, { activeCenter, energy: 0.5 }, camState);

    frames.push({
      t: Number(t.toFixed(5)),
      L,
      R,
      keys: Array.from(frame.keys, (v) => Number(v.toFixed(3))),
      pedal: Number(frame.pedal.toFixed(3)),
      body: {
        leanX: Number(frame.body.leanX.toFixed(4)),
        leanZ: Number(frame.body.leanZ.toFixed(4)),
        sway: Number(frame.body.sway.toFixed(4)),
      },
      head: { yaw: Number(frame.head.yaw.toFixed(4)), pitch: Number(frame.head.pitch.toFixed(4)) },
      camera: {
        pos: [camState.pos.x, camState.pos.y, camState.pos.z].map((v) => Number(v.toFixed(4))) as [number, number, number],
        target: [camState.target.x, camState.target.y, camState.target.z].map((v) => Number(v.toFixed(4))) as [number, number, number],
        fov: Number(camState.fov.toFixed(2)),
      },
    });
  }

  return {
    format: 'concert-creator-bake',
    version: 1,
    fps,
    duration: choreo.duration,
    world: { keyTopY: KEY_TOP_Y, keyboardWidth: 1.222 },
    notes: score.notes
      .filter((n) => !n.disabled)
      .map((n) => ({ midi: n.midi, start: n.start, end: n.end, velocity: n.velocity, hand: n.hand, finger: n.finger })),
    frames,
  };
}
