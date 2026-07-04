import * as THREE from 'three';

const _n = new THREE.Vector3();
const _toPole = new THREE.Vector3();
const _u = new THREE.Vector3();

/**
 * Analytic two-bone IK. Returns the mid-joint (elbow/knee) world position for
 * a chain root→mid→target with segment lengths l1, l2; the mid joint bends
 * toward `pole`.
 */
export function solveTwoBone(
  root: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  _n.subVectors(target, root);
  const dRaw = _n.length();
  const d = THREE.MathUtils.clamp(dRaw, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  if (dRaw < 1e-6) _n.set(0, -1, 0);
  else _n.multiplyScalar(1 / dRaw);

  _toPole.subVectors(pole, root);
  const along = _toPole.dot(_n);
  _u.copy(_toPole).addScaledVector(_n, -along);
  if (_u.lengthSq() < 1e-8) _u.set(0, 1, 0).addScaledVector(_n, -_n.y).normalize();
  else _u.normalize();

  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const a = Math.acos(cosA);
  return out.copy(root).addScaledVector(_n, l1 * Math.cos(a)).addScaledVector(_u, l1 * Math.sin(a));
}

const _dir = new THREE.Vector3();
const _worldQ = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Point an object's local -Y axis from its world position toward `target`
 * (segments are modelled hanging along -Y). Works with rotated parents.
 */
export function aimSegment(obj: THREE.Object3D, from: THREE.Vector3, target: THREE.Vector3): void {
  _dir.subVectors(target, from);
  if (_dir.lengthSq() < 1e-10) return;
  _dir.normalize();
  _worldQ.setFromUnitVectors(UP, _dir.clone().negate());
  const parent = obj.parent;
  if (parent) {
    parent.getWorldQuaternion(_parentQ);
    obj.quaternion.copy(_parentQ.invert().multiply(_worldQ));
  } else {
    obj.quaternion.copy(_worldQ);
  }
}
