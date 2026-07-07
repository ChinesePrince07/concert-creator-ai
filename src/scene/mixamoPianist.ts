import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PoseFrame } from '../core/choreo/program';
import type { Hand } from '../core/types';
import { solveTwoBone } from './ik';
import { kbToWorld } from './mapping';
import type { PianistRig } from './pianist';

/**
 * User-supplied Mixamo-rigged pianist (public/assets/character/maestro.glb).
 * The standardized mixamorig skeleton lets us drive him deterministically:
 * seated pose at load; per frame the choreography drives hips/spine/head,
 * two-bone IK aims the arm bones at the AI wrists, the hand bones take the
 * solved palm basis, and his own finger bones curl with the performance.
 */

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;

// finger curl axis/sign for mixamo local frames (verified visually)
const CURL_AXIS: 'x' | 'y' | 'z' = 'z';
const CURL_SIGN: Record<Hand, number> = { L: -1, R: 1 };
// finger abduction (lateral spread) so the hand fans across the keys instead of
// clumping into a claw. Applied on the knuckle, perpendicular to the curl axis.
const SPLAY_AXIS: 'x' | 'y' | 'z' = 'x';
const SPLAY_SIGN: Record<Hand, number> = { L: 1, R: -1 };
// resting fan per finger [thumb, index, middle, ring, pinky]
const FINGER_FAN = [0.4, 0.14, 0.0, -0.13, -0.24];

let cached: Promise<THREE.Group | null> | null = null;
export function loadMaestro(): Promise<THREE.Group | null> {
  if (!cached) {
    cached = new GLTFLoader()
      .loadAsync('/assets/character/maestro.glb')
      .then((g) => g.scene)
      .catch((e) => {
        console.warn('[maestro] not available', e);
        return null;
      });
  }
  return cached;
}

export function createMixamoPianist(source: THREE.Group): PianistRig {
  const group = new THREE.Group();
  const model = source;
  group.add(model);

  const bones = new Map<string, THREE.Object3D>();
  model.traverse((o) => {
    const m = /^mixamorig:?(.+?)(?:_\d+)?$/.exec(o.name);
    if (m && !bones.has(m[1])) bones.set(m[1], o);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      o.frustumCulled = false;
      o.castShadow = true;
      o.receiveShadow = true;
      const mat = (o as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial;
      if (mat && mat.isMeshStandardMaterial) {
        mat.envMapIntensity = 0.3;
        mat.roughness = Math.max(mat.roughness, 0.65);
        mat.color.multiplyScalar(0.55);
      }
    }
  });
  const B = (n: string) => bones.get(n) ?? null;

  // ---- normalize: scale to adult height, face -z, sit at the bench --------
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const rawH = Math.max(1e-3, box.getSize(new THREE.Vector3()).y);
  model.scale.multiplyScalar(1.72 / rawH); // adult stature — legs long enough to reach the floor
  model.rotation.y = Math.PI; // T-pose faces +z → face the keyboard (-z)
  model.updateMatrixWorld(true);

  // seated pose (static): thighs down-forward off the bench, shins near-vertical,
  // soles flat. A slight outward knee splay reads as a relaxed player's stance.
  const rx = (n: string, a: number) => {
    const b = B(n);
    if (b) b.rotateX(a);
  };
  const rz = (n: string, a: number) => {
    const b = B(n);
    if (b) b.rotateZ(a);
  };
  rx('LeftUpLeg', 1.45);
  rx('RightUpLeg', 1.42);
  rx('LeftLeg', -1.42);
  rx('RightLeg', -1.34);
  rx('LeftFoot', 0.52);
  rx('RightFoot', 0.55);
  rz('LeftUpLeg', 0.08);
  rz('RightUpLeg', -0.08);
  // arms down from T-pose toward the keys; IK refines every frame
  rz('LeftArm', -1.1);
  rz('RightArm', 1.1);
  model.updateMatrixWorld(true);

  // place hips horizontally over the bench (x centered, z in front of the keys)
  const hips = B('Hips');
  const hipsW = new THREE.Vector3();
  hips?.getWorldPosition(hipsW);
  model.position.x -= hipsW.x;
  model.position.z += 0.5 - hipsW.z;
  model.updateMatrixWorld(true);

  // drop the whole figure so the soles rest on the floor. Box3.setFromObject on a
  // skinned mesh returns *bind-pose* bounds (ignores our seated rotations), so we
  // read the actual deformed foot-bone world Y instead. This also pulls the hips
  // down to a real bench height and kills the "floating mannequin" look.
  const footWorldY = (n: string): number => {
    const b = B(n);
    if (!b) return Infinity;
    return b.getWorldPosition(new THREE.Vector3()).y;
  };
  const soleBone = Math.min(
    footWorldY('LeftToeBase'),
    footWorldY('RightToeBase'),
    footWorldY('LeftFoot'),
    footWorldY('RightFoot'),
  );
  if (Number.isFinite(soleBone)) model.position.y += 0.04 - soleBone; // ~sole thickness under the ankle bone
  model.updateMatrixWorld(true);

  // rest data for retargeting
  const restWorldQ = new Map<string, THREE.Quaternion>();
  for (const [n, b] of bones) restWorldQ.set(n, b.getWorldQuaternion(new THREE.Quaternion()));
  const boneW = (n: string, out: THREE.Vector3) => B(n)!.getWorldPosition(out);
  const len = (a: string, b: string) => {
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    boneW(a, va);
    boneW(b, vb);
    return va.distanceTo(vb);
  };
  const ARM: Record<Hand, { up: string; fore: string; hand: string; l1: number; l2: number; align: THREE.Quaternion }> = {
    L: {
      up: 'LeftArm', fore: 'LeftForeArm', hand: 'LeftHand',
      l1: len('LeftArm', 'LeftForeArm'), l2: len('LeftForeArm', 'LeftHand'),
      align: new THREE.Quaternion(),
    },
    R: {
      up: 'RightArm', fore: 'RightForeArm', hand: 'RightHand',
      l1: len('RightArm', 'RightForeArm'), l2: len('RightForeArm', 'RightHand'),
      align: new THREE.Quaternion(),
    },
  };
  // hand alignment: my palm basis (fingers -Z, back +Y) vs the bone's rest
  // world orientation, captured against the arms-down rest we just posed
  {
    const tmpQ = new THREE.Quaternion();
    for (const hand of ['L', 'R'] as const) {
      const hb = B(ARM[hand].hand)!;
      hb.getWorldQuaternion(tmpQ);
      // rest basis of my convention in the arms-down pose: fingers ~ -Y … use
      // captured rest and correct per frame relative to a nominal basis
      const restBasis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(hand === 'L' ? -1 : 1, 0, 0),
        new THREE.Vector3(0, 0, hand === 'L' ? 1 : 1),
        new THREE.Vector3(0, -1, 0),
      );
      const q0 = new THREE.Quaternion().setFromRotationMatrix(restBasis);
      ARM[hand].align.copy(q0.invert()).multiply(tmpQ);
    }
  }

  // finger bones + rest local quats
  const fingerBones: Record<Hand, THREE.Object3D[][]> = { L: [], R: [] };
  const fingerRest: Record<Hand, THREE.Quaternion[][]> = { L: [], R: [] };
  for (const hand of ['L', 'R'] as const) {
    const side = hand === 'L' ? 'Left' : 'Right';
    for (const f of FINGERS) {
      const chain: THREE.Object3D[] = [];
      const rest: THREE.Quaternion[] = [];
      for (let s = 1; s <= 3; s++) {
        const b = B(`${side}Hand${f}${s}`);
        if (b) {
          chain.push(b);
          rest.push(b.quaternion.clone());
        }
      }
      fingerBones[hand].push(chain);
      fingerRest[hand].push(rest);
    }
  }

  // ---- scratch --------------------------------------------------------------
  const wristW = new THREE.Vector3();
  const shoulderW = new THREE.Vector3();
  const elbowW = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const tipsAvg = new THREE.Vector3();
  const tipW = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const back = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  const qWorld = new THREE.Quaternion();
  const qParent = new THREE.Quaternion();
  const qDelta = new THREE.Quaternion();
  const dirNow = new THREE.Vector3();
  const childW = new THREE.Vector3();
  const UP_Y = new THREE.Vector3(0, 1, 0);
  const rollQ = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const splayAxisV = new THREE.Vector3();

  /** rotate `bone` (world-space delta) so `child` reaches `target` */
  function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
    bone.updateMatrixWorld(true);
    bone.getWorldPosition(shoulderW._aimTmp ?? (shoulderW._aimTmp = new THREE.Vector3()));
    const bw = shoulderW._aimTmp as THREE.Vector3;
    child.getWorldPosition(childW);
    dirNow.subVectors(childW, bw).normalize();
    fwd.subVectors(target, bw).normalize();
    qDelta.setFromUnitVectors(dirNow, fwd);
    bone.parent!.getWorldQuaternion(qParent);
    bone.getWorldQuaternion(qWorld);
    qWorld.premultiply(qDelta);
    bone.quaternion.copy(qParent.invert()).multiply(qWorld);
  }

  function applyArm(hand: Hand, frame: PoseFrame): void {
    const arm = ARM[hand];
    const upB = B(arm.up)!;
    const foreB = B(arm.fore)!;
    const handB = B(arm.hand)!;
    const pose = frame.hands[hand];
    kbToWorld(pose.wrist.x, pose.wrist.y, pose.wrist.z, wristW);
    upB.getWorldPosition(shoulderW);
    pole.copy(shoulderW).add(new THREE.Vector3(hand === 'L' ? -0.45 : 0.45, -0.42, 0.3));
    solveTwoBone(shoulderW, wristW, arm.l1, arm.l2, pole, elbowW);
    aimBone(upB, foreB, elbowW);
    aimBone(foreB, handB, wristW);

    // palm basis from fingertip targets (same as the procedural rig)
    tipsAvg.set(0, 0, 0);
    for (const fp of pose.fingers) {
      kbToWorld(fp.tip.x, fp.tip.y, fp.tip.z, tipW);
      tipsAvg.addScaledVector(tipW, 0.2);
    }
    fwd.subVectors(tipsAvg, wristW);
    fwd.y *= 0.35;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, -0.2, -1);
    fwd.normalize();
    back.copy(fwd).negate();
    right.crossVectors(UP_Y, back).normalize();
    up.crossVectors(back, right).normalize();
    mtx.makeBasis(right, up, back);
    qWorld.setFromRotationMatrix(mtx);
    rollQ.setFromAxisAngle(back, pose.roll * (hand === 'R' ? -1 : 1));
    qWorld.premultiply(rollQ);
    qWorld.multiply(arm.align);
    handB.parent!.getWorldQuaternion(qParent);
    handB.quaternion.copy(qParent.invert()).multiply(qWorld);
    handB.updateMatrixWorld(true);

    // fingers: curl from the solved chain, on his own bones, fanned so the
    // hand spreads across the keys instead of clumping
    axis.set(CURL_AXIS === 'x' ? 1 : 0, CURL_AXIS === 'y' ? 1 : 0, CURL_AXIS === 'z' ? 1 : 0);
    splayAxisV.set(SPLAY_AXIS === 'x' ? 1 : 0, SPLAY_AXIS === 'y' ? 1 : 0, SPLAY_AXIS === 'z' ? 1 : 0);
    for (let i = 0; i < 5; i++) {
      const chain = fingerBones[hand][i];
      const rest = fingerRest[hand][i];
      const fp = pose.fingers[i];
      const curls = [
        -0.15 - fp.press * 0.55 - (1 - fp.press) * fp.curl * 0.35,
        -0.2 - fp.press * 0.5 - fp.curl * 0.3,
        -0.1 - fp.press * 0.3 - fp.curl * 0.2,
      ];
      const spread = (FINGER_FAN[i] + fp.splay * 0.28) * SPLAY_SIGN[hand];
      for (let s = 0; s < chain.length; s++) {
        const b = chain[s];
        b.quaternion.copy(rest[s]);
        if (s === 0) b.rotateOnAxis(splayAxisV, spread);
        b.rotateOnAxis(axis, curls[s] * CURL_SIGN[hand] * (i === 0 ? 0.6 : 1));
      }
    }
  }

  const spine = B('Spine');
  const spine1 = B('Spine1');
  const spine2 = B('Spine2');
  const neck = B('Neck');
  const head = B('Head');
  const restLocal = new Map<string, THREE.Quaternion>();
  for (const n of ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'Hips']) {
    const b = B(n);
    if (b) restLocal.set(n, b.quaternion.clone());
  }
  const baseModelPos = model.position.clone();

  function apply(frame: PoseFrame): void {
    model.position.x = baseModelPos.x + frame.body.leanX * 0.1 + frame.body.sway * 0.04;
    const setRot = (b: THREE.Object3D | null, n: string, x: number, y: number, z: number) => {
      if (!b) return;
      b.quaternion.copy(restLocal.get(n)!);
      b.rotateX(x);
      b.rotateY(y);
      b.rotateZ(z);
    };
    setRot(spine, 'Spine', 0.1 + frame.body.leanZ * 0.7, 0, -frame.body.leanX * 0.3 - frame.body.sway * 0.2);
    setRot(spine1, 'Spine1', frame.body.leanZ * 0.3 + frame.body.breath * 0.006, 0, -frame.body.leanX * 0.15);
    setRot(spine2, 'Spine2', -0.05, 0, 0);
    setRot(neck, 'Neck', frame.head.pitch * 0.5 + 0.1, frame.head.yaw * 0.5, 0);
    setRot(head, 'Head', frame.head.pitch * 0.5 - frame.head.lift * 0.4, frame.head.yaw * 0.5, 0);
    model.updateMatrixWorld(true);
    applyArm('L', frame);
    applyArm('R', frame);
  }

  apply({
    hands: {
      L: { wrist: { x: 380, y: 46, z: 238 }, fingers: neutral(), roll: 0 },
      R: { wrist: { x: 840, y: 46, z: 238 }, fingers: neutral(), roll: 0 },
    },
    body: { leanX: 0, leanZ: 0.02, sway: 0, breath: 0 },
    head: { yaw: 0, pitch: -0.1, lift: 0, gazeX: 611 },
    pedal: 0,
    keys: new Float32Array(88),
  });

  function neutral() {
    return Array.from({ length: 5 }, (_, i) => ({
      tip: { x: 611 + (i - 2) * 15, y: 12, z: 120 },
      press: 0,
      curl: 0.45,
      splay: 0,
    }));
  }

  return {
    group,
    apply,
    setVisible(v) {
      group.visible = v;
    },
    setHeadVisible(v) {
      const h = B('Head');
      if (h) h.scale.setScalar(v ? 1 : 0.001); // bones can't hide; collapse instead
    },
    setHandsOnly() {
      /* classic Top View keeps using the default pianist's hands */
    },
    attachXRHands() {
      /* he has his own rigged hands */
    },
    getEyePose(outPos, outQuat) {
      const h = B('Head');
      if (!h) return;
      h.getWorldQuaternion(outQuat);
      h.getWorldPosition(outPos);
      outPos.y += 0.06;
      outPos.z -= 0.06;
    },
    dispose() {
      group.removeFromParent();
    },
  };
}

declare module 'three' {
  interface Vector3 {
    _aimTmp?: THREE.Vector3;
  }
}
