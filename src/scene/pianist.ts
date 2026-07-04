import * as THREE from 'three';
import type { PoseFrame } from '../core/choreo/program';
import type { Hand } from '../core/types';
import { aimSegment, solveTwoBone } from './ik';
import { kbToWorld } from './mapping';

/**
 * The virtual pianist: a sculptural obsidian figure. Rigid capsule segments
 * on a plain Object3D hierarchy; arms are two-bone IK chains driven by the
 * choreography's wrist targets, fingers are analytic 3-joint chains driven
 * by fingertip targets.
 */

export interface PianistRig {
  group: THREE.Group;
  apply(frame: PoseFrame): void;
  setVisible(v: boolean): void;
}

const BODY_MAT = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0x101013,
    roughness: 0.52,
    metalness: 0.06,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
  });
const SKIN_MAT = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0x131217,
    roughness: 0.42,
    metalness: 0.04,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
  });

const UPPER_ARM = 0.285;
const FOREARM = 0.26;
const THIGH = 0.42;
const SHIN = 0.42;

interface FingerChain {
  yaw: THREE.Group; // at MCP, rotates around Y (splay)
  mcp: THREE.Group; // pitch
  pip: THREE.Group;
  dip: THREE.Group;
  lengths: [number, number, number];
}

interface ArmRig {
  shoulder: THREE.Group; // upper-arm pivot (aims at elbow)
  elbow: THREE.Group; // forearm pivot (aims at wrist)
  hand: THREE.Group; // positioned at wrist, oriented from finger targets
  fingers: FingerChain[];
  side: 1 | -1; // R = -? set below
}

function capsule(r: number, len: number, mat: THREE.Material, sy = 1, sx = 1): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 18);
  geo.translate(0, -len / 2, 0); // hang along -Y from origin
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(sx, sy, 1);
  mesh.castShadow = true;
  return mesh;
}

function joint(r: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.castShadow = true;
  return m;
}

export function createPianist(): PianistRig {
  const body = BODY_MAT();
  const skin = SKIN_MAT();
  const group = new THREE.Group();

  // ---- torso chain --------------------------------------------------------
  const root = new THREE.Group(); // pelvis on the bench
  root.position.set(0, 0.55, 0.6);
  group.add(root);

  const hipsMesh = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), body);
  hipsMesh.scale.set(1.02, 0.6, 0.78);
  hipsMesh.castShadow = true;
  root.add(hipsMesh);

  // coat tail hint
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.2), body);
  tail.position.set(0, -0.055, 0.1);
  tail.rotation.x = 0.25;
  root.add(tail);

  const spine1 = new THREE.Group();
  spine1.position.set(0, 0.075, 0);
  root.add(spine1);

  // one smooth "tailcoat" shell over the articulated core — kills the seams
  const coatProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.001, -0.12),
    new THREE.Vector2(0.15, -0.115),
    new THREE.Vector2(0.152, -0.05),
    new THREE.Vector2(0.128, 0.05),
    new THREE.Vector2(0.118, 0.14),
    new THREE.Vector2(0.13, 0.24),
    new THREE.Vector2(0.148, 0.32),
    new THREE.Vector2(0.152, 0.375),
    new THREE.Vector2(0.118, 0.43),
    new THREE.Vector2(0.05, 0.462),
    new THREE.Vector2(0.001, 0.465),
  ];
  const coat = new THREE.Mesh(new THREE.LatheGeometry(coatProfile, 26), body);
  coat.scale.set(1, 1, 0.7);
  coat.castShadow = true;
  spine1.add(coat);

  const spine1Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.118, 20, 16), body);
  spine1Mesh.scale.set(0.98, 0.92, 0.62);
  spine1Mesh.position.y = 0.045;
  spine1Mesh.castShadow = true;
  spine1.add(spine1Mesh);

  const spine2 = new THREE.Group();
  spine2.position.set(0, 0.105, 0);
  spine1.add(spine2);
  const spine2Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.122, 20, 16), body);
  spine2Mesh.scale.set(1.04, 0.95, 0.62);
  spine2Mesh.position.y = 0.05;
  spine2Mesh.castShadow = true;
  spine2.add(spine2Mesh);

  const chest = new THREE.Group();
  chest.position.set(0, 0.125, 0);
  spine2.add(chest);
  const chestMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 22, 18), body);
  chestMesh.scale.set(1.22, 1.0, 0.66);
  chestMesh.position.y = 0.05;
  chestMesh.castShadow = true;
  chest.add(chestMesh);

  const neck = new THREE.Group();
  neck.position.set(0, 0.175, -0.01);
  chest.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 14), skin);
  neckMesh.position.y = 0.03;
  neckMesh.castShadow = true;
  neck.add(neckMesh);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.014, 10, 24), body);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.005;
  neck.add(collar);

  const head = new THREE.Group();
  head.position.set(0, 0.09, 0);
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.093, 26, 20), skin);
  skull.scale.set(0.92, 1.12, 1.0);
  skull.position.y = 0.075;
  skull.castShadow = true;
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.062, 18, 14), skin);
  jaw.scale.set(0.82, 0.9, 0.86);
  jaw.position.set(0, 0.015, -0.014);
  head.add(jaw);

  // ---- arms ---------------------------------------------------------------
  function buildArm(handKey: Hand): ArmRig {
    const side = handKey === 'L' ? -1 : 1; // world x sign of the shoulder
    const clav = new THREE.Group();
    clav.position.set(side * 0.168, 0.125, -0.005);
    chest.add(clav);
    const shoulderBall = joint(0.054, body);
    clav.add(shoulderBall);

    const shoulder = new THREE.Group();
    clav.add(shoulder);
    shoulder.add(capsule(0.047, UPPER_ARM, body, 1, 1));

    const elbow = new THREE.Group();
    group.add(elbow); // world-space driven
    elbow.add(capsule(0.038, FOREARM, body));
    const elbowBall = joint(0.045, body);
    elbow.add(elbowBall);

    // cuff
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.0395, 0.041, 0.02, 14), skin);
    cuff.position.y = -FOREARM + 0.025;
    elbow.add(cuff);

    const hand = new THREE.Group();
    group.add(hand); // world-space driven
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.047, 18, 14), skin);
    palm.scale.set(0.92, 0.36, 1.35);
    palm.position.set(0, -0.006, -0.045);
    palm.castShadow = true;
    hand.add(palm);

    const fingers: FingerChain[] = [];
    const spread = [
      // [x offset, z offset, segment lengths]
      { x: -0.04 * side, z: -0.028, l: [0.042, 0.028, 0.024] as [number, number, number], thumb: true },
      { x: -0.023 * side, z: -0.08, l: [0.044, 0.027, 0.021] as [number, number, number] },
      { x: -0.008 * side, z: -0.084, l: [0.048, 0.03, 0.023] as [number, number, number] },
      { x: 0.008 * side, z: -0.08, l: [0.044, 0.028, 0.021] as [number, number, number] },
      { x: 0.023 * side, z: -0.072, l: [0.035, 0.023, 0.019] as [number, number, number] },
    ];
    for (const s of spread) {
      const yawG = new THREE.Group();
      yawG.position.set(s.x, -0.006, s.z);
      hand.add(yawG);
      if (s.thumb) {
        yawG.rotation.y = side * 0.85;
        yawG.rotation.z = side * -0.5;
      }
      const mcp = new THREE.Group();
      yawG.add(mcp);
      mcp.add(knuckle(0.0092));
      const b1 = boneZ(s.l[0], 0.008);
      mcp.add(b1);
      const pip = new THREE.Group();
      pip.position.z = -s.l[0];
      mcp.add(pip);
      pip.add(knuckle(0.0078));
      pip.add(boneZ(s.l[1], 0.0071));
      const dip = new THREE.Group();
      dip.position.z = -s.l[1];
      pip.add(dip);
      dip.add(knuckle(0.0068));
      dip.add(boneZ(s.l[2], 0.0062, true));
      fingers.push({ yaw: yawG, mcp, pip, dip, lengths: s.l });
    }
    return { shoulder, elbow, hand, fingers, side: side as 1 | -1 };

    function knuckle(r: number): THREE.Mesh {
      const k = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), skin);
      k.castShadow = true;
      return k;
    }
    function boneZ(len: number, r: number, tip = false): THREE.Mesh {
      const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - (tip ? r : 2 * r)), 5, 12);
      geo.rotateX(Math.PI / 2); // capsule axis Y -> Z
      geo.translate(0, 0, -len / 2);
      const mesh = new THREE.Mesh(geo, skin);
      mesh.castShadow = true;
      return mesh;
    }
  }

  const arms: Record<Hand, ArmRig> = { L: buildArm('L'), R: buildArm('R') };

  // ---- legs (IK to static foot anchors; right foot rides the pedal) -------
  interface Leg {
    hip: THREE.Group;
    knee: THREE.Group;
    foot: THREE.Mesh;
    hipLocal: THREE.Vector3;
    footAnchor: THREE.Vector3;
  }
  function buildLeg(sx: number, footX: number, footZ: number): Leg {
    const hip = new THREE.Group();
    root.add(hip);
    hip.position.set(sx * 0.095, -0.02, 0.02);
    hip.add(capsule(0.062, THIGH, body));
    const knee = new THREE.Group();
    group.add(knee);
    knee.add(capsule(0.048, SHIN, body));
    knee.add(joint(0.055, body));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.24), skin);
    foot.castShadow = true;
    group.add(foot);
    return {
      hip,
      knee,
      foot,
      hipLocal: new THREE.Vector3(sx * 0.095, -0.02, 0.02),
      footAnchor: new THREE.Vector3(footX, 0.045, footZ),
    };
  }
  const legL = buildLeg(-1, -0.16, 0.18);
  const legR = buildLeg(1, 0.062, 0.06);

  // ---- scratch vectors ----------------------------------------------------
  const wristW = new THREE.Vector3();
  const shoulderW = new THREE.Vector3();
  const elbowW = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const tipW = new THREE.Vector3();
  const tipsAvg = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  const tipLocal = new THREE.Vector3();
  const hipW = new THREE.Vector3();
  const kneeW = new THREE.Vector3();
  const UP_Y = new THREE.Vector3(0, 1, 0);

  function applyArm(handKey: Hand, frame: PoseFrame): void {
    const arm = arms[handKey];
    const pose = frame.hands[handKey];
    kbToWorld(pose.wrist.x, pose.wrist.y, pose.wrist.z, wristW);

    arm.shoulder.getWorldPosition(shoulderW);

    // average fingertip target → hand forward
    tipsAvg.set(0, 0, 0);
    for (const f of pose.fingers) {
      kbToWorld(f.tip.x, f.tip.y, f.tip.z, tipW);
      tipsAvg.add(tipW);
    }
    tipsAvg.multiplyScalar(1 / 5);

    pole.copy(shoulderW).add(new THREE.Vector3(arm.side * 0.45, -0.42, 0.3));
    solveTwoBone(shoulderW, wristW, UPPER_ARM, FOREARM, pole, elbowW);

    aimSegment(arm.shoulder, shoulderW, elbowW);
    arm.elbow.position.copy(elbowW);
    aimSegment(arm.elbow, elbowW, wristW);

    // hand frame: local -Z points along the fingers, local +Y is the hand back
    arm.hand.position.copy(wristW);
    fwd.subVectors(tipsAvg, wristW);
    fwd.y *= 0.35; // keep the palm mostly level
    if (fwd.lengthSq() < 1e-8) fwd.set(0, -0.2, -1);
    fwd.normalize();
    const back = fwd.clone().negate(); // local +Z
    right.crossVectors(UP_Y, back).normalize(); // X = Y×Z
    up.crossVectors(back, right).normalize(); // Y = Z×X
    mtx.makeBasis(right, up, back);
    arm.hand.quaternion.setFromRotationMatrix(mtx);
    arm.hand.updateMatrixWorld(true);

    // fingers
    for (let i = 0; i < 5; i++) {
      const chain = arm.fingers[i];
      const fp = pose.fingers[i];
      kbToWorld(fp.tip.x, fp.tip.y, fp.tip.z, tipW);
      tipLocal.copy(tipW);
      chain.yaw.parent!.worldToLocal(tipLocal);
      tipLocal.sub(chain.yaw.position);

      const isThumb = i === 0;
      const yaw = Math.atan2(-tipLocal.x, -tipLocal.z);
      if (isThumb) {
        const yawBase = arm.side * 0.85;
        chain.yaw.rotation.y = yawBase * 0.6 + THREE.MathUtils.clamp(yaw, -1.2, 1.2) * 0.5 + fp.splay * 0.08;
      } else {
        chain.yaw.rotation.y = THREE.MathUtils.clamp(yaw, -0.55, 0.55) * 0.85 + fp.splay * 0.08;
      }

      const horiz = Math.hypot(tipLocal.x, tipLocal.z);
      const dy = tipLocal.y;
      const [l1, l2raw, l3] = chain.lengths;
      const l2 = l2raw + l3 * 0.8;
      const d = THREE.MathUtils.clamp(Math.hypot(horiz, dy), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
      const phi = Math.atan2(-dy, horiz); // down positive
      const cosA1 = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
      const a1 = Math.acos(cosA1);
      const cosInner = THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
      const bend = Math.PI - Math.acos(cosInner);
      const curlBias = 0.35 + fp.curl * 0.5;
      chain.mcp.rotation.x = -(phi - a1) * 1.0 - 0.05;
      chain.pip.rotation.x = -bend * (0.72 + 0.1 * curlBias);
      chain.dip.rotation.x = -bend * (0.42 * curlBias);
    }
  }

  function applyLeg(leg: Leg, footTarget: THREE.Vector3, pedalPitch: number): void {
    leg.hip.getWorldPosition(hipW);
    pole.copy(hipW).add(new THREE.Vector3(0, 0.1, 0.6));
    solveTwoBone(hipW, footTarget, THIGH, SHIN, pole, kneeW);
    aimSegment(leg.hip, hipW, kneeW);
    leg.knee.position.copy(kneeW);
    aimSegment(leg.knee, kneeW, footTarget);
    leg.foot.position.copy(footTarget);
    leg.foot.position.z += 0.06;
    leg.foot.rotation.x = -pedalPitch;
  }

  function apply(frame: PoseFrame): void {
    // body
    root.rotation.z = -(frame.body.leanX * 0.55 + frame.body.sway * 0.35);
    root.rotation.x = frame.body.leanZ * 0.15;
    root.position.x = frame.body.leanX * 0.14 + frame.body.sway * 0.05;
    spine1.rotation.x = 0.14 + frame.body.leanZ * 0.9;
    spine2.rotation.x = 0.05 + frame.body.leanZ * 0.35 + frame.body.breath * 0.006;
    chest.rotation.x = -0.08;
    chest.scale.setScalar(1 + frame.body.breath * 0.008);
    neck.rotation.y = frame.head.yaw * 0.5;
    head.rotation.y = frame.head.yaw * 0.55;
    head.rotation.x = frame.head.pitch * 0.8 - frame.head.lift * 0.5 + 0.18;
    group.updateMatrixWorld(true);

    applyArm('L', frame);
    applyArm('R', frame);

    applyLeg(legL, legL.footAnchor, 0);
    applyLeg(legR, legR.footAnchor, frame.pedal * 0.18);
  }

  // neutral pose
  apply({
    hands: {
      L: neutralHand('L'),
      R: neutralHand('R'),
    },
    body: { leanX: 0, leanZ: 0.02, sway: 0, breath: 0 },
    head: { yaw: 0, pitch: -0.1, lift: 0 },
    pedal: 0,
    keys: new Float32Array(88),
  });

  return {
    group,
    apply,
    setVisible(v: boolean) {
      group.visible = v;
    },
  };
}

function neutralHand(hand: Hand) {
  const x = hand === 'L' ? 380 : 840;
  return {
    wrist: { x, y: 46, z: 238 },
    fingers: Array.from({ length: 5 }, (_, i) => ({
      tip: { x: x + (hand === 'L' ? 1 : -1) * (32 - i * 15), y: 12, z: 120 },
      press: 0,
      curl: 0.45,
      splay: 0,
    })),
  };
}
