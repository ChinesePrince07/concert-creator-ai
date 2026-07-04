import * as THREE from 'three';
import {
  BLACK_KEY_LENGTH_MM,
  BLACK_KEY_RAISE_MM,
  BLACK_KEY_WIDTH_MM,
  KEY_COUNT,
  MIDI_MIN,
  WHITE_KEY_LENGTH_MM,
  isBlack,
  keyCenterX,
} from '../core/keyboard';
import { kbToWorld } from './mapping';

const WHITE_W = 0.0222;
const WHITE_H = 0.021;
const WHITE_L = WHITE_KEY_LENGTH_MM / 1000;
const BLACK_W = BLACK_KEY_WIDTH_MM / 1000;
const BLACK_H = 0.012;
const BLACK_L = BLACK_KEY_LENGTH_MM / 1000;
const DIP_ANGLE = THREE.MathUtils.degToRad(4.2);

export interface KeyboardRig {
  group: THREE.Group;
  /** dips: 0..1 per key (index = keyIndex), colors: per-hand highlight */
  update(dips: Float32Array, highlight: { color: THREE.Color; amount: number }[]): void;
  setHighlightEnabled(on: boolean): void;
}

export function createKeyboard(): KeyboardRig {
  const group = new THREE.Group();

  const whiteMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8d0bc,
    roughness: 0.42,
    clearcoat: 0.28,
    clearcoatRoughness: 0.38,
  });
  const blackMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b0b0d,
    roughness: 0.22,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
  });

  const whiteGeo = new THREE.BoxGeometry(WHITE_W, WHITE_H, WHITE_L);
  whiteGeo.translate(0, -WHITE_H / 2, WHITE_L / 2); // origin at rear-top hinge
  const blackGeo = new THREE.BoxGeometry(BLACK_W, BLACK_H + 0.02, BLACK_L);
  blackGeo.translate(0, (BLACK_H + 0.02) / 2 - 0.02, BLACK_L / 2);

  const whites: number[] = [];
  const blacks: number[] = [];
  for (let k = 0; k < KEY_COUNT; k++) (isBlack(k + MIDI_MIN) ? blacks : whites).push(k);

  const whiteMesh = new THREE.InstancedMesh(whiteGeo, whiteMat, whites.length);
  const blackMesh = new THREE.InstancedMesh(blackGeo, blackMat, blacks.length);
  whiteMesh.castShadow = whiteMesh.receiveShadow = true;
  blackMesh.castShadow = blackMesh.receiveShadow = true;
  group.add(whiteMesh, blackMesh);

  const baseWhite = new THREE.Color(0xd8d0bc);
  const baseBlack = new THREE.Color(0x0b0b0d);
  for (let i = 0; i < whites.length; i++) whiteMesh.setColorAt(i, baseWhite);
  for (let i = 0; i < blacks.length; i++) blackMesh.setColorAt(i, baseBlack);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const tmpColor = new THREE.Color();

  let highlightOn = true;

  function place(keyIdx: number, meshIdx: number, mesh: THREE.InstancedMesh, dip: number): void {
    const midi = keyIdx + MIDI_MIN;
    const black = isBlack(midi);
    kbToWorld(keyCenterX(midi), black ? BLACK_KEY_RAISE_MM : 0, 0, pos);
    eul.set(dip * DIP_ANGLE, 0, 0);
    q.setFromEuler(eul);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(meshIdx, m);
  }

  function update(dips: Float32Array, highlight: { color: THREE.Color; amount: number }[]): void {
    for (let i = 0; i < whites.length; i++) {
      const k = whites[i];
      place(k, i, whiteMesh, dips[k]);
      if (highlightOn) {
        const h = highlight[k];
        tmpColor.copy(baseWhite);
        if (h && h.amount > 0.02) tmpColor.lerp(h.color, Math.min(0.85, h.amount));
        whiteMesh.setColorAt(i, tmpColor);
      }
    }
    for (let i = 0; i < blacks.length; i++) {
      const k = blacks[i];
      place(k, i, blackMesh, dips[k]);
      if (highlightOn) {
        const h = highlight[k];
        tmpColor.copy(baseBlack);
        if (h && h.amount > 0.02) tmpColor.lerp(h.color, Math.min(0.9, h.amount));
        blackMesh.setColorAt(i, tmpColor);
      }
    }
    whiteMesh.instanceMatrix.needsUpdate = true;
    blackMesh.instanceMatrix.needsUpdate = true;
    if (whiteMesh.instanceColor) whiteMesh.instanceColor.needsUpdate = true;
    if (blackMesh.instanceColor) blackMesh.instanceColor.needsUpdate = true;
  }

  // initial placement
  update(new Float32Array(KEY_COUNT), []);

  return {
    group,
    update,
    setHighlightEnabled(on: boolean) {
      highlightOn = on;
      if (!on) {
        for (let i = 0; i < whites.length; i++) whiteMesh.setColorAt(i, baseWhite);
        for (let i = 0; i < blacks.length; i++) blackMesh.setColorAt(i, baseBlack);
        if (whiteMesh.instanceColor) whiteMesh.instanceColor.needsUpdate = true;
        if (blackMesh.instanceColor) blackMesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
