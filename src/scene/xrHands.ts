import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { LoopSubdivision } from 'three-subdivide';
import type { Hand } from '../core/types';

/**
 * Realistic skinned hands from the official WebXR input profiles
 * (@webxr-input-profiles/assets, Apache-2.0). The GLBs use the WebXR
 * convention: 25 joints as flat siblings of the armature, posed in armature
 * space. We retarget by rest-relative forward kinematics: at zero angles the
 * hand reproduces its authored rest pose exactly; solved chain angles rotate
 * each phalanx about calibrated axes derived from the hand's own landmarks.
 */

export interface FingerChainAngles {
  rotY: number; // yaw at the knuckle (my hand-local Y)
  rotZ: number; // thumb-plane roll (my hand-local Z)
  mcpX: number;
  pipX: number;
  dipX: number;
}

export interface XRHandRig {
  root: THREE.Group;
  apply(angles: FingerChainAngles[]): void;
  setTint(color: THREE.Color, obsidian: boolean): void;
}

interface JointRest {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

const CHAINS: string[][] = [
  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
];

let cache: { left: THREE.Group; right: THREE.Group } | null | undefined;

export async function loadXRHandScenes(): Promise<{ left: THREE.Group; right: THREE.Group } | null> {
  if (cache !== undefined) return cache;
  try {
    const loader = new GLTFLoader();
    const [l, r] = await Promise.all([
      loader.loadAsync('/assets/hands/left.glb'),
      loader.loadAsync('/assets/hands/right.glb'),
    ]);
    cache = { left: l.scene, right: r.scene };
  } catch (err) {
    console.warn('[xr-hands] failed to load hand meshes, using procedural hands', err);
    cache = null;
  }
  return cache;
}

export function createXRHandRig(source: THREE.Group, hand: Hand): XRHandRig {
  const scene = cloneSkeleton(source);
  const armature = scene.getObjectByName('Armature') ?? scene;

  const joints = new Map<string, THREE.Object3D>();
  armature.traverse((o) => {
    if (o.name && o.name !== 'Armature') joints.set(o.name, o);
  });

  const rest = new Map<string, JointRest>();
  for (const [name, j] of joints) {
    rest.set(name, { pos: j.position.clone(), quat: j.quaternion.clone() });
  }

  const rp = (n: string) => rest.get(n)!.pos;

  // ---- calibration: my hand axes expressed in armature space --------------
  // fingers axis (my -Z)
  const fingerAxis = new THREE.Vector3();
  for (const n of ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal']) {
    fingerAxis.add(new THREE.Vector3().subVectors(rp(n), rp('wrist')));
  }
  fingerAxis.normalize();
  // across the palm toward the pinky (my +X for R, my −X for L → flip below)
  const across = new THREE.Vector3().subVectors(
    rp('pinky-finger-phalanx-proximal'),
    rp('index-finger-phalanx-proximal'),
  );
  across.addScaledVector(fingerAxis, -across.dot(fingerAxis)).normalize();

  const zc = fingerAxis.clone().negate(); // my +Z (toward wrist)
  const xc = hand === 'R' ? across.clone() : across.clone().negate(); // my +X
  const yc = new THREE.Vector3().crossVectors(zc, xc).normalize(); // my +Y (hand back)
  xc.crossVectors(yc, zc).normalize(); // re-orthogonalize

  const calM = new THREE.Matrix4().makeBasis(xc, yc, zc); // my-space → armature-space
  const calQ = new THREE.Quaternion().setFromRotationMatrix(calM);
  const calQInv = calQ.clone().invert();

  // armature sits under the pianist's hand group: map armature→hand space
  armature.quaternion.copy(calQInv);
  armature.position.copy(rp('wrist')).applyQuaternion(calQInv).negate();

  // scale the asset hand to match the choreography's hand span
  const assetLen =
    rp('middle-finger-phalanx-proximal').distanceTo(rp('middle-finger-phalanx-intermediate')) +
    rp('middle-finger-phalanx-intermediate').distanceTo(rp('middle-finger-phalanx-distal')) +
    rp('middle-finger-phalanx-distal').distanceTo(rp('middle-finger-tip'));
  const targetLen = 0.048 + 0.03 + 0.023;
  const s = THREE.MathUtils.clamp(targetLen / Math.max(1e-4, assetLen), 0.8, 1.3);
  armature.scale.setScalar(s);
  armature.position.multiplyScalar(s);

  // mesh setup
  let meshMat: THREE.MeshPhysicalMaterial | null = null;
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh || (o as THREE.SkinnedMesh).isSkinnedMesh) {
      const m = o as THREE.SkinnedMesh;
      m.frustumCulled = false;
      m.castShadow = true;
      try {
        // VR hand meshes are authored low-poly — one Loop pass doubles the
        // silhouette smoothness (skinning attributes are interpolated too)
        m.geometry = LoopSubdivision.modify(m.geometry, 1, {
          split: false,
          preserveEdges: false,
          flatOnly: false,
        });
      } catch (e) {
        console.warn('[xr-hands] subdivision skipped', e);
      }
      const old = m.material as THREE.MeshStandardMaterial;
      meshMat = new THREE.MeshPhysicalMaterial({
        map: old.map ?? null,
        normalMap: old.normalMap ?? null,
        color: 0xffffff,
        roughness: 0.55,
        sheen: 0.4,
        sheenRoughness: 0.6,
        clearcoat: 0.1,
        clearcoatRoughness: 0.5,
      });
      m.material = meshMat;
    }
  });

  const root = new THREE.Group();
  root.add(scene);

  // ---- runtime FK ----------------------------------------------------------
  const dq = new THREE.Quaternion();
  const step = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const qy = new THREE.Quaternion();
  const qz = new THREE.Quaternion();
  const qx = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  /** Δ = cal · R_my · cal⁻¹, accumulated along the chain */
  function applyChain(chain: string[], a: FingerChainAngles): void {
    const rots = [a.mcpX, a.pipX, a.dipX];
    dq.identity();
    // base yaw (+ thumb roll) in my space
    qy.setFromAxisAngle(Y, a.rotY);
    qz.setFromAxisAngle(Z, a.rotZ);
    step.copy(calQ).multiply(qz).multiply(qy).multiply(calQInv);
    dq.copy(step);

    let prevName = chain[0];
    for (let i = 0; i < 3; i++) {
      const name = chain[i];
      const next = chain[i + 1];
      qx.setFromAxisAngle(X, rots[i]);
      step.copy(calQ).multiply(qx).multiply(calQInv);
      dq.multiply(step);

      const j = joints.get(name);
      const jr = rest.get(name);
      const nr = rest.get(next);
      if (!j || !jr || !nr) return;
      if (i === 0) j.position.copy(jr.pos);
      j.quaternion.copy(dq).multiply(jr.quat);

      const nextJoint = joints.get(next);
      if (nextJoint) {
        tmpV.subVectors(nr.pos, jr.pos).applyQuaternion(dq).add(j.position);
        nextJoint.position.copy(tmpV);
        nextJoint.quaternion.copy(dq).multiply(nr.quat);
      }
      prevName = name;
    }
    void prevName;
  }

  function apply(angles: FingerChainAngles[]): void {
    for (let f = 0; f < 5; f++) applyChain(CHAINS[f], angles[f]);
  }

  return {
    root,
    apply,
    setTint(color: THREE.Color, obsidian: boolean) {
      if (!meshMat) return;
      const m = meshMat as THREE.MeshPhysicalMaterial;
      m.color.copy(color);
      if (obsidian) {
        m.map = null;
        m.roughness = 0.4;
        m.clearcoat = 0.45;
        m.sheen = 0;
        m.needsUpdate = true;
      }
    },
  };
}
