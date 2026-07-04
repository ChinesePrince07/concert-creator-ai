import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ChoreoProgram } from '../core/choreo/program';
import type { ShotPlan } from '../core/cinema/planner';
import { KEY_COUNT, MIDI_MIN, keyIndex } from '../core/keyboard';
import type { Hand, PerformanceScore } from '../core/types';
import { type CameraMode, type CameraState, evaluateCamera } from './cameras';
import { createKeyboard } from './keys';
import { createPiano } from './piano';
import { createPianist } from './pianist';
import { type PostChain, createPost } from './post';
import { createRoll } from './roll';

export type { CameraMode } from './cameras';

export interface VisualSettings {
  leftColor: string;
  rightColor: string;
  showRoll: boolean;
  showAvatar: boolean;
  lightMood: 'noir' | 'warm' | 'blue';
  rollZoom: number;
}

export const DEFAULT_VISUALS: VisualSettings = {
  leftColor: '#53d5ff',
  rightColor: '#ffb454',
  showRoll: true,
  showAvatar: true,
  lightMood: 'noir',
  rollZoom: 1,
};

export interface ConcertScene {
  setScore(score: PerformanceScore, choreo: ChoreoProgram, shots: ShotPlan): void;
  renderAt(t: number, dt: number): void;
  setCameraMode(mode: CameraMode): void;
  getCameraMode(): CameraMode;
  setVisuals(v: Partial<VisualSettings>): void;
  resize(w: number, h: number, dpr: number): void;
  setQuality(q: 'preview' | 'export'): void;
  dispose(): void;
  readonly canvas: HTMLCanvasElement;
}

interface KeyNoteSpan {
  start: number;
  end: number;
  hand: Hand;
}

export function createConcertScene(canvas: HTMLCanvasElement): ConcertScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030303);
  scene.fog = new THREE.FogExp2(0x040404, 0.055);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 60);
  camera.position.set(0, 1.6, -4);

  // ---- stage dressing -----------------------------------------------------
  const floorGroup = new THREE.Group();
  const reflector = new Reflector(new THREE.CircleGeometry(9, 64), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x828282,
    clipBias: 0.002,
  });
  reflector.rotation.x = -Math.PI / 2;
  floorGroup.add(reflector);
  const dim = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({
      color: 0x050506,
      roughness: 0.92,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
    }),
  );
  dim.rotation.x = -Math.PI / 2;
  dim.position.y = 0.002;
  dim.receiveShadow = true;
  floorGroup.add(dim);
  // radial fade so the stage floor dissolves into the void
  const edge = new THREE.Mesh(
    new THREE.CircleGeometry(16, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {},
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vP; void main(){ float r = length(vP); float a = smoothstep(2.1, 4.6, r); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.004;
  floorGroup.add(edge);
  scene.add(floorGroup);

  // ---- lights ---------------------------------------------------------------
  const rig = new THREE.Group();
  scene.add(rig);

  const key = new THREE.SpotLight(0xffdcae, 85, 0, 0.52, 0.5, 1.9);
  key.position.set(2.7, 4.3, 2.3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.015;
  key.target.position.set(-0.2, 0.85, -0.55);
  rig.add(key, key.target);

  const rim = new THREE.SpotLight(0x8fb0ff, 65, 0, 0.6, 0.55, 1.9);
  rim.position.set(-3.4, 3.4, -2.5);
  rim.target.position.set(0, 0.9, 0.3);
  rig.add(rim, rim.target);

  const keysAccent = new THREE.SpotLight(0xffe6c0, 1.1, 0, 0.3, 0.65, 1.8);
  keysAccent.position.set(0.4, 2.8, 1.6);
  keysAccent.castShadow = true;
  keysAccent.shadow.mapSize.set(1024, 1024);
  keysAccent.shadow.bias = -0.00025;
  keysAccent.target.position.set(0, 0.74, 0.05);
  rig.add(keysAccent, keysAccent.target);

  const hemi = new THREE.HemisphereLight(0x24242e, 0x000000, 0.45);
  rig.add(hemi);

  const bounce = new THREE.PointLight(0xffc890, 1.4, 3.5, 2);
  bounce.position.set(0.2, 1.1, -0.6);
  rig.add(bounce);

  // volumetric cones under the two hero spots
  const coneMat = () =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { opacity: { value: 0.05 }, tint: { value: new THREE.Color(0xffd9a8) } },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vPos = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float opacity;
        uniform vec3 tint;
        varying vec3 vPos;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          float rimF = pow(abs(dot(vNormalV, vViewDir)), 1.6);
          float h = smoothstep(-0.5, 0.45, vPos.y);
          gl_FragColor = vec4(tint, opacity * rimF * h);
        }
      `,
    });

  function addCone(light: THREE.SpotLight, tint: number, radius: number, op: number): void {
    const from = light.position;
    const to = light.target.position;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const geo = new THREE.ConeGeometry(radius, len, 32, 1, true);
    const mat = coneMat();
    mat.uniforms.tint.value = new THREE.Color(tint);
    mat.uniforms.opacity.value = op;
    const cone = new THREE.Mesh(geo, mat);
    cone.position.copy(from).add(to).multiplyScalar(0.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
    rig.add(cone);
  }
  addCone(key, 0xffd9a8, 1.35, 0.05);
  addCone(rim, 0x8fb0ff, 1.5, 0.035);

  // dust motes, drifting inside the key-light column
  const dustCount = 320;
  const dustPos = new Float32Array(dustCount * 3);
  {
    let s = 987654321;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < dustCount; i++) {
      const f = rand();
      dustPos[i * 3] = 0.6 + f * 2.0 + (rand() - 0.5) * 1.1;
      dustPos[i * 3 + 1] = 0.3 + rand() * 3.4;
      dustPos[i * 3 + 2] = 0.5 + f * 1.6 + (rand() - 0.5) * 1.1;
    }
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xfff0d8,
      size: 0.005,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  scene.add(dust);

  // ---- performers -----------------------------------------------------------
  const keyboard = createKeyboard();
  scene.add(keyboard.group);
  const piano = createPiano();
  scene.add(piano.group);
  const pianist = createPianist();
  scene.add(pianist.group);
  const roll = createRoll();
  scene.add(roll.group);

  const post: PostChain = createPost(renderer, scene, camera);

  // ---- state ------------------------------------------------------------------
  let score: PerformanceScore | null = null;
  let choreo: ChoreoProgram | null = null;
  let shots: ShotPlan | null = null;
  let mode: CameraMode = 'AUTO';
  const visuals: VisualSettings = { ...DEFAULT_VISUALS };
  const colorL = new THREE.Color(visuals.leftColor);
  const colorR = new THREE.Color(visuals.rightColor);
  const keySpans: KeyNoteSpan[][] = Array.from({ length: KEY_COUNT }, () => []);
  const highlights: { color: THREE.Color; amount: number }[] = Array.from(
    { length: KEY_COUNT },
    () => ({ color: new THREE.Color(), amount: 0 }),
  );

  const camState: CameraState = {
    pos: new THREE.Vector3(0, 1.6, -4),
    target: new THREE.Vector3(0, 0.85, 0),
    fov: 40,
    focus: 3,
  };
  const activeCenter = new THREE.Vector3(0, 0.78, 0.05);

  function isRollMode(): boolean {
    return (mode === 'TOP' || mode === 'FP') && visuals.showRoll;
  }

  function applyModeVisibility(): void {
    const rollOn = isRollMode();
    roll.setVisible(rollOn);
    // Synthesia modes keep the live scene — hands stay in frame under the tiles
    pianist.group.visible = visuals.showAvatar;
    pianist.setHeadVisible(!(rollOn && mode === 'FP'));
    piano.setLidVisible(!rollOn);
    roll.setPitch(mode === 'FP' ? 0.95 : 0.16);
    dust.visible = !rollOn;
    // extra readable fill over the keys in roll modes; theatrical rig stays on
    hemi.intensity =
      (rollOn ? 0.4 : 0) +
      (visuals.lightMood === 'warm' ? 0.55 : visuals.lightMood === 'blue' ? 0.38 : 0.45);
    // the interior is the tile canvas in TOP view — keep the spot off it
    const moodKey = visuals.lightMood === 'warm' ? 140 : visuals.lightMood === 'blue' ? 90 : 85;
    key.intensity = rollOn && mode === 'TOP' ? moodKey * 0.4 : moodKey;
  }

  function applyMood(): void {
    switch (visuals.lightMood) {
      case 'noir':
        key.color.set(0xffdcae);
        key.intensity = 85;
        rim.color.set(0x8fb0ff);
        rim.intensity = 65;
        hemi.intensity = 0.45;
        scene.environmentIntensity = 0.22;
        break;
      case 'warm':
        key.color.set(0xffc98c);
        key.intensity = 140;
        rim.color.set(0xffa574);
        rim.intensity = 45;
        hemi.intensity = 0.55;
        scene.environmentIntensity = 0.3;
        break;
      case 'blue':
        key.color.set(0xbfd4ff);
        key.intensity = 90;
        rim.color.set(0x4f6fff);
        rim.intensity = 80;
        hemi.intensity = 0.38;
        scene.environmentIntensity = 0.18;
        break;
    }
  }

  function updateHighlights(t: number, keys: Float32Array): void {
    for (let k = 0; k < KEY_COUNT; k++) {
      const spans = keySpans[k];
      const h = highlights[k];
      h.amount = 0;
      if (keys[k] <= 0.02 || spans.length === 0) continue;
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        if (t >= s.start - 0.15 && t <= s.end + 0.25) {
          h.color.copy(s.hand === 'L' ? colorL : colorR);
          h.amount = keys[k] * 0.85;
          break;
        }
        if (s.start - 0.15 > t) break;
      }
    }
  }

  applyModeVisibility();
  applyMood();

  return {
    canvas,
    setScore(s, c, sp) {
      score = s;
      choreo = c;
      shots = sp;
      roll.setScore(s);
      for (const list of keySpans) list.length = 0;
      for (const n of s.notes) {
        if (n.disabled) continue;
        if (n.midi < MIDI_MIN || n.midi > MIDI_MIN + KEY_COUNT - 1) continue;
        keySpans[keyIndex(n.midi)].push({ start: n.start, end: n.end, hand: n.hand });
      }
      for (const list of keySpans) list.sort((a, b) => a.start - b.start);
    },
    renderAt(t: number, dt: number) {
      const frame = choreo ? choreo.sample(t) : null;
      if (frame) {
        updateHighlights(t, frame.keys);
        keyboard.update(frame.keys, highlights);
        if (pianist.group.visible) pianist.apply(frame);
        piano.setPedal(frame.pedal);
        if (roll.group.visible) roll.update(t, frame.keys);

        // active-hands center for camera follow
        let pressL = 0;
        let pressR = 0;
        for (const f of frame.hands.L.fingers) pressL += f.press;
        for (const f of frame.hands.R.fingers) pressR += f.press;
        const wl = frame.hands.L.wrist;
        const wr = frame.hands.R.wrist;
        const bias = pressL + pressR > 0.05 ? pressR / (pressL + pressR) : 0.5;
        activeCenter.set(
          ((wl.x * (1 - bias) + wr.x * bias) - 611) / 1000,
          0.75,
          0.05,
        );
      }

      dust.rotation.y = t * 0.006;
      dust.position.y = Math.sin(t * 0.05) * 0.05;

      // followspot rides the hands along the keyboard
      keysAccent.position.x = activeCenter.x * 0.85 + 0.25;
      keysAccent.target.position.x = activeCenter.x;

      evaluateCamera(mode, shots, t, { activeCenter, energy: 0.5 }, camState);
      camera.position.copy(camState.pos);
      camera.lookAt(camState.target);
      if (Math.abs(camera.fov - camState.fov) > 0.01) {
        camera.fov = camState.fov;
        camera.updateProjectionMatrix();
      }
      post.setFocus(camState.focus);
      post.render(t);
    },
    setCameraMode(m) {
      mode = m;
      applyModeVisibility();
    },
    getCameraMode() {
      return mode;
    },
    setVisuals(v) {
      Object.assign(visuals, v);
      colorL.set(visuals.leftColor);
      colorR.set(visuals.rightColor);
      roll.setColors(colorL, colorR);
      roll.setZoom(visuals.rollZoom);
      keyboard.setHighlightEnabled(true);
      applyMood();
      applyModeVisibility();
    },
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      post.setSize(w, h);
    },
    setQuality(q) {
      post.setQuality(q);
    },
    dispose() {
      post.dispose();
      renderer.dispose();
      pmrem.dispose();
    },
  };
}
