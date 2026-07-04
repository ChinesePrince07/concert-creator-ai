import * as THREE from 'three';
import { MIDI_MIN, isBlack, keyCenterX, keyIndex } from '../core/keyboard';
import type { PerformanceScore } from '../core/types';
import { KEY_TOP_Y, kbToWorld } from './mapping';

/**
 * Rousseau-style LED piano roll for the Top View / First Person modes:
 * luminous rounded notes glide along the keyboard plane toward the keys and
 * flash an LED strip on impact. Lives in the keys' plane extended into -z.
 */

const MAX_NOTES = 640;
const SPEED = 0.5; // m/s of approach
const KEY_REAR_Z = -0.005;

export interface RollLayer {
  group: THREE.Group;
  setScore(score: PerformanceScore | null): void;
  setColors(left: THREE.Color, right: THREE.Color): void;
  setZoom(z: number): void;
  update(t: number, keys: Float32Array): void;
  setVisible(v: boolean): void;
}

export function createRoll(): RollLayer {
  const group = new THREE.Group();
  group.visible = false;

  let notes: PerformanceScore['notes'] = [];
  let starts: number[] = [];
  const colorL = new THREE.Color(0x4fd8ff);
  const colorR = new THREE.Color(0xffb84f);
  let zoom = 1;

  // backdrop
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 3.4),
    new THREE.MeshBasicMaterial({ color: 0x05060a }),
  );
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.set(0, KEY_TOP_Y - 0.02, -1.72);
  group.add(backdrop);

  // note quads with rounded-corner SDF alpha
  const noteMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec2 vSize;
      attribute vec3 iColor;
      attribute vec4 iRect; // x center, z bottom, width, length
      attribute float iGlow;
      varying float vGlow;
      void main() {
        vUv = uv;
        vColor = iColor;
        vGlow = iGlow;
        vSize = vec2(iRect.z, iRect.w);
        vec3 p = position;
        p.x = p.x * iRect.z + iRect.x;
        p.z = p.z * iRect.w + iRect.y - iRect.w * 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec2 vSize;
      varying float vGlow;
      void main() {
        vec2 he = vSize * 0.5;
        vec2 p = (vUv - 0.5) * vSize;
        float r = min(0.006, min(he.x, he.y) * 0.9);
        vec2 q = abs(p) - he + r;
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        float alpha = 1.0 - smoothstep(-0.0012, 0.0012, d);
        float core = 1.0 - smoothstep(-0.008, 0.0, d);
        vec3 col = vColor * (0.75 + 0.9 * vGlow) + vec3(0.25) * core * vGlow;
        gl_FragColor = vec4(col, alpha * 0.96);
      }
    `,
  });

  const quad = new THREE.PlaneGeometry(1, 1);
  quad.rotateX(-Math.PI / 2); // lie in keyboard plane, length along z
  const noteGeo = new THREE.InstancedBufferGeometry();
  noteGeo.index = quad.index;
  noteGeo.attributes.position = quad.attributes.position;
  noteGeo.attributes.uv = quad.attributes.uv;
  const iColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NOTES * 3), 3);
  const iRect = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NOTES * 4), 4);
  const iGlow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NOTES), 1);
  noteGeo.setAttribute('iColor', iColor);
  noteGeo.setAttribute('iRect', iRect);
  noteGeo.setAttribute('iGlow', iGlow);
  const noteMesh = new THREE.Mesh(noteGeo, noteMat);
  noteMesh.position.y = KEY_TOP_Y + 0.013;
  noteMesh.frustumCulled = false;
  group.add(noteMesh);

  // LED strip: one emissive box per key at the strike line
  const ledGeo = new THREE.BoxGeometry(0.02, 0.004, 0.012);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, 88);
  const lm = new THREE.Matrix4();
  const lpos = new THREE.Vector3();
  const lq = new THREE.Quaternion();
  const lscale = new THREE.Vector3(1, 1, 1);
  for (let k = 0; k < 88; k++) {
    kbToWorld(keyCenterX(k + MIDI_MIN), 16, KEY_REAR_Z * 1000, lpos);
    lm.compose(lpos, lq, lscale);
    leds.setMatrixAt(k, lm);
    leds.setColorAt(k, new THREE.Color(0x101014));
  }
  group.add(leds);

  const tmp = new THREE.Color();

  function update(t: number, keys: Float32Array): void {
    if (!group.visible || notes.length === 0) {
      noteGeo.instanceCount = 0;
      return;
    }
    const speed = SPEED * zoom;
    const horizon = 1.9 / speed; // seconds of lookahead shown
    // find first note with end >= t (still visible) via starts index
    let count = 0;
    for (let i = firstVisible(t - 6); i < notes.length && count < MAX_NOTES; i++) {
      const n = notes[i];
      if (n.start > t + horizon) break;
      if (n.end < t - 0.1 || n.disabled) continue;
      const remainStart = Math.max(0, n.start - t);
      const remainEnd = Math.max(0, n.end - t);
      if (remainEnd <= 0) continue;
      const zBottom = KEY_REAR_Z - remainStart * speed;
      const zTop = KEY_REAR_Z - remainEnd * speed;
      const len = Math.max(0.02, zBottom - zTop);
      const black = isBlack(n.midi);
      const w = black ? 0.0125 : 0.019;
      const x = (keyCenterX(n.midi) - 611) / 1000;
      const sounding = t >= n.start && t <= n.end;
      tmp.copy(n.hand === 'L' ? colorL : colorR);
      iColor.setXYZ(count, tmp.r, tmp.g, tmp.b);
      iRect.setXYZW(count, x, zBottom, w, len);
      iGlow.setX(count, sounding ? 1 : 0.15);
      count++;
    }
    noteGeo.instanceCount = count;
    iColor.needsUpdate = true;
    iRect.needsUpdate = true;
    iGlow.needsUpdate = true;

    for (let k = 0; k < 88; k++) {
      const dip = keys[k];
      tmp.setRGB(0.06, 0.06, 0.08);
      if (dip > 0.03) {
        // color by whichever hand's note is on this key — approximated by
        // sampling visible notes; cheap variant: white-hot flash
        tmp.setRGB(0.9 * dip + 0.1, 0.85 * dip + 0.1, 0.75 * dip + 0.12);
      }
      leds.setColorAt(k, tmp);
    }
    if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
  }

  function firstVisible(t: number): number {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  return {
    group,
    setScore(score) {
      notes = score ? [...score.notes].sort((a, b) => a.start - b.start) : [];
      starts = notes.map((n) => n.start);
    },
    setColors(l, r) {
      colorL.copy(l);
      colorR.copy(r);
    },
    setZoom(z) {
      zoom = THREE.MathUtils.clamp(z, 0.5, 2);
    },
    update,
    setVisible(v) {
      group.visible = v;
    },
  };
}
