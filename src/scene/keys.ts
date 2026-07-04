import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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

/** Procedural ivory: vertical grain, edge occlusion, front lip shadow. */
function makeWhiteAlbedo(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3edde';
  g.fillRect(0, 0, 256, 256);
  // faint vertical ivory grain
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(Math.random() * 256);
    g.fillStyle = `rgba(${215 + Math.random() * 25}, ${208 + Math.random() * 22}, ${188 + Math.random() * 20}, ${0.05 + Math.random() * 0.07})`;
    g.fillRect(x, 0, 1 + Math.random() * 2, 256);
  }
  // subtle warm aging toward one end (reads as fallboard shadow on tops)
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(120, 100, 70, 0.10)');
  grad.addColorStop(0.25, 'rgba(120, 100, 70, 0.0)');
  grad.addColorStop(1, 'rgba(255, 255, 250, 0.05)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  // edge occlusion on all borders → dark seams between neighbouring keys
  const edge = 18;
  const eg = (x0: number, y0: number, x1: number, y1: number, horiz: boolean) => {
    const gr = horiz ? g.createLinearGradient(x0, 0, x1, 0) : g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, 'rgba(30, 26, 18, 0.34)');
    gr.addColorStop(1, 'rgba(30, 26, 18, 0)');
    g.fillStyle = gr;
    g.fillRect(horiz ? x0 : 0, horiz ? 0 : y0, horiz ? Math.abs(x1 - x0) : 256, horiz ? 256 : Math.abs(y1 - y0));
  };
  eg(0, 0, edge, 0, true);
  eg(256, 0, 256 - edge, 0, true);
  eg(0, 0, 0, edge, false);
  eg(0, 256, 0, 256 - edge, false);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWhiteRoughness(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(110, 110, 110)';
  g.fillRect(0, 0, 128, 128);
  // worn, glossier play zone in the middle
  const rad = g.createRadialGradient(64, 78, 8, 64, 78, 70);
  rad.addColorStop(0, 'rgba(70, 70, 70, 0.85)');
  rad.addColorStop(1, 'rgba(120, 120, 120, 0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) {
    const v = 95 + Math.floor(Math.random() * 40);
    g.fillStyle = `rgba(${v},${v},${v},0.25)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  return new THREE.CanvasTexture(c);
}

function makeBlackAlbedo(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#131318';
  g.fillRect(0, 0, 128, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.07)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.02})`;
    g.fillRect(Math.random() * 128, 0, 1, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createKeyboard(): KeyboardRig {
  const group = new THREE.Group();

  const whiteMat = new THREE.MeshPhysicalMaterial({
    map: makeWhiteAlbedo(),
    roughnessMap: makeWhiteRoughness(),
    roughness: 1.0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.26,
  });
  const blackMat = new THREE.MeshPhysicalMaterial({
    map: makeBlackAlbedo(),
    roughness: 0.34,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  });

  const whiteGeo = new RoundedBoxGeometry(WHITE_W, WHITE_H, WHITE_L, 2, 0.0011);
  whiteGeo.translate(0, -WHITE_H / 2, WHITE_L / 2); // origin at rear-top hinge
  const blackGeo = new RoundedBoxGeometry(BLACK_W, BLACK_H + 0.02, BLACK_L, 2, 0.0017);
  blackGeo.translate(0, (BLACK_H + 0.02) / 2 - 0.02, BLACK_L / 2);

  const whites: number[] = [];
  const blacks: number[] = [];
  for (let k = 0; k < KEY_COUNT; k++) (isBlack(k + MIDI_MIN) ? blacks : whites).push(k);

  const whiteMesh = new THREE.InstancedMesh(whiteGeo, whiteMat, whites.length);
  const blackMesh = new THREE.InstancedMesh(blackGeo, blackMat, blacks.length);
  whiteMesh.castShadow = whiteMesh.receiveShadow = true;
  blackMesh.castShadow = blackMesh.receiveShadow = true;
  group.add(whiteMesh, blackMesh);

  const baseWhite = new THREE.Color(0xffffff); // albedo lives in the map
  const baseBlack = new THREE.Color(0xffffff);
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
