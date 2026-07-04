import * as THREE from 'three';
import {
  BLACK_KEY_WIDTH_MM,
  KEYBOARD_WIDTH_MM,
  MIDI_MIN,
  WHITE_KEY_LENGTH_MM,
  isBlack,
  keyCenterX,
} from '../core/keyboard';
import type { Hand, PerformanceScore } from '../core/types';
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
  /** tilt of the tile plane about the strike line: π/2 = vertical wall (classic), ~1.0 = fp ramp */
  setPitch(rad: number): void;
  /** minimal keyboard dressing (front rail + felt) for when the piano body is hidden */
  setRailVisible(v: boolean): void;
  update(t: number, keys: Float32Array, highlight?: { color: THREE.Color; amount: number }[]): void;
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

  // note quads with rounded-corner SDF alpha
  const noteMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // UI overlay: tiles read over the piano body and lid
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
        vec3 col = vColor * (0.7 + 1.15 * vGlow) + vec3(0.3) * core * vGlow;
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
  // pivot at the strike line; pitch rotates the tile plane up from the piano
  noteMesh.position.set(0, KEY_TOP_Y + 0.013, KEY_REAR_Z);
  noteMesh.renderOrder = 990;
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

  // ---- pressed-key glow + under-key light fans (the reference look) -------
  const glowShader = (fan: boolean) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAmt;
        attribute vec3 iColor;
        attribute float iAmt;
        void main() {
          vUv = uv;
          vColor = iColor;
          vAmt = iAmt;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: fan
        ? /* glsl */ `
        varying vec2 vUv; varying vec3 vColor; varying float vAmt;
        void main() {
          // widening fan, brightest at the top, fading down
          float spread = mix(0.42, 0.06, vUv.y);
          float lateral = 1.0 - smoothstep(spread * 0.25, spread, abs(vUv.x - 0.5));
          float fade = pow(max(vUv.y, 0.0), 1.7);
          gl_FragColor = vec4(vColor * 1.6, lateral * fade * vAmt * 0.85);
        }
      `
        : /* glsl */ `
        varying vec2 vUv; varying vec3 vColor; varying float vAmt;
        void main() {
          // key-top glow: hot toward the strike line (rear), soft sides
          float lateral = 1.0 - smoothstep(0.12, 0.5, abs(vUv.x - 0.5));
          float depth = pow(max(vUv.y, 0.0), 1.5);
          vec3 col = mix(vColor, vec3(1.0), 0.35 * depth * vAmt);
          gl_FragColor = vec4(col * 1.7, lateral * (0.25 + 0.75 * depth) * vAmt);
        }
      `,
    });

  function makeOverlay(fan: boolean): {
    mesh: THREE.InstancedMesh;
    color: THREE.InstancedBufferAttribute;
    amt: THREE.InstancedBufferAttribute;
  } {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0); // origin at bottom edge
    const inst = new THREE.InstancedMesh(geo, glowShader(fan), 88);
    inst.frustumCulled = false;
    inst.renderOrder = fan ? 980 : 985;
    const color = new THREE.InstancedBufferAttribute(new Float32Array(88 * 3), 3);
    const amt = new THREE.InstancedBufferAttribute(new Float32Array(88), 1);
    inst.geometry.setAttribute('iColor', color);
    inst.geometry.setAttribute('iAmt', amt);
    if (!new URLSearchParams(location.search).has('noglow')) group.add(inst);
    return { mesh: inst, color, amt };
  }

  const topGlow = makeOverlay(false);
  const fanGlow = makeOverlay(true);
  {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let k = 0; k < 88; k++) {
      const midi = k + MIDI_MIN;
      const w = (isBlack(midi) ? BLACK_KEY_WIDTH_MM + 4 : 25) / 1000;
      // key-top glow: lies flat on the key, from front toward the strike line
      kbToWorld(keyCenterX(midi), (isBlack(midi) ? 13.5 : 1.5) + 1.5, WHITE_KEY_LENGTH_MM, p);
      m.compose(p, qFlat, new THREE.Vector3(w, WHITE_KEY_LENGTH_MM / 1000, 1));
      topGlow.mesh.setMatrixAt(k, m);
      // under-key fan: vertical sheet below the key front, pointing down
      kbToWorld(keyCenterX(midi), -160, WHITE_KEY_LENGTH_MM + 2, p);
      q.identity();
      m.compose(p, q, new THREE.Vector3(w * 3.2, 0.155, 1));
      fanGlow.mesh.setMatrixAt(k, m);
    }
    topGlow.mesh.instanceMatrix.needsUpdate = true;
    fanGlow.mesh.instanceMatrix.needsUpdate = true;
  }

  // minimal dressing when the piano body is hidden: front rail + felt line
  const rail = new THREE.Group();
  const railBox = new THREE.Mesh(
    new THREE.BoxGeometry(KEYBOARD_WIDTH_MM / 1000 + 0.06, 0.05, 0.16),
    new THREE.MeshPhysicalMaterial({ color: 0x08080a, roughness: 0.3, clearcoat: 0.8 }),
  );
  railBox.position.set(0, KEY_TOP_Y - 0.037, 0.062);
  rail.add(railBox);
  const feltLine = new THREE.Mesh(
    new THREE.BoxGeometry(KEYBOARD_WIDTH_MM / 1000, 0.006, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x8c1626, roughness: 1 }),
  );
  feltLine.position.set(0, KEY_TOP_Y + 0.004, -0.004);
  rail.add(feltLine);
  rail.visible = false;
  group.add(rail);

  const tmp = new THREE.Color();

  function update(
    t: number,
    keys: Float32Array,
    highlight?: { color: THREE.Color; amount: number }[],
  ): void {
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
      // distances ahead of the strike line, in local plane space
      const vBottom = remainStart * speed;
      const vTop = remainEnd * speed;
      const len = Math.max(0.02, vTop - vBottom);
      const black = isBlack(n.midi);
      const w = black ? 0.0125 : 0.019;
      const x = (keyCenterX(n.midi) - 611) / 1000;
      const sounding = t >= n.start && t <= n.end;
      tmp.copy(n.hand === 'L' ? colorL : colorR);
      iColor.setXYZ(count, tmp.r, tmp.g, tmp.b);
      iRect.setXYZW(count, x, -vBottom, w, len);
      iGlow.setX(count, sounding ? 1 : 0.15);
      count++;
    }
    noteGeo.instanceCount = count;
    iColor.needsUpdate = true;
    iRect.needsUpdate = true;
    iGlow.needsUpdate = true;

    for (let k = 0; k < 88; k++) {
      const dip = keys[k];
      const h = highlight?.[k];
      if (dip > 0.03 && h && h.amount > 0.02) {
        tmp.copy(h.color).multiplyScalar(0.4 + dip);
        tmp.r += 0.25 * dip;
        tmp.g += 0.25 * dip;
        tmp.b += 0.25 * dip;
      } else if (dip > 0.03) {
        tmp.setRGB(0.9 * dip + 0.1, 0.85 * dip + 0.1, 0.75 * dip + 0.12);
      } else {
        tmp.setRGB(0.06, 0.06, 0.08);
      }
      leds.setColorAt(k, tmp);

      // emissive key glow + under-key light fan
      const amt = h && h.amount > 0.02 ? Math.min(1, dip * 1.15) : 0;
      topGlow.amt.setX(k, amt);
      fanGlow.amt.setX(k, Math.pow(amt, 1.5));
      if (h && amt > 0) {
        topGlow.color.setXYZ(k, h.color.r, h.color.g, h.color.b);
        fanGlow.color.setXYZ(k, h.color.r, h.color.g, h.color.b);
      }
    }
    if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
    topGlow.amt.needsUpdate = true;
    topGlow.color.needsUpdate = true;
    fanGlow.amt.needsUpdate = true;
    fanGlow.color.needsUpdate = true;
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
    setPitch(rad) {
      noteMesh.rotation.x = rad;
    },
    setRailVisible(v) {
      rail.visible = v;
    },
    update,
    setVisible(v) {
      group.visible = v;
    },
  };
}
