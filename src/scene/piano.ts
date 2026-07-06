import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural concert grand: rim slab with the classic plan curve, propped
 * lid, keybed, fallboard, felt, legs, lyre with a working sustain pedal,
 * and a bench. World meters; keyboard front edge at z≈0.16, body into -z.
 */

export type PianoModelId = 'scanned';

export interface PianoModelSpec {
  id: PianoModelId;
  name: string;
  blurb: string;
  lengthScale: number;
  widthScale: number;
  finishColor: number;
  finishRoughness: number;
  plateColor: number;
  plateMetalness: number;
  feltColor: number;
  soundboardColor: number;
  hardwareColor: number;
  hardwareMetalness: number;
  hardwareRoughness: number;
  stringColor: number;
  extraBassKeys: number;
}

export const PIANO_MODELS: PianoModelSpec[] = [
  {
    // The only piano is Andy's supplied photoreal GLB (loaded by customPiano.ts).
    // This spec drives the procedural fallback body that stays hidden behind the
    // GLB (and shows only if the GLB fails to load).
    id: 'scanned', name: 'Steinway (your GLB)', blurb: 'Photoreal model you supplied — app keys overlaid',
    lengthScale: 1.0, widthScale: 1.0, finishColor: 0x060607, finishRoughness: 0.07,
    plateColor: 0x574320, plateMetalness: 0.7, feltColor: 0x8c1626, soundboardColor: 0x120b05,
    hardwareColor: 0xb08d3f, hardwareMetalness: 1.0, hardwareRoughness: 0.32, stringColor: 0xd8d3c4, extraBassKeys: 0,
  },
];

export interface PianoRig {
  group: THREE.Group;
  setPedal(v: number): void;
  /** hide the open lid + desk for unobstructed top-down (Synthesia) views */
  setLidVisible(v: boolean): void;
  dispose(): void;
}

const LEN = 1.32; // baseline depth stretch → ~2.2m concert length

function rimShape(scale: number, frontCut: number, len: number, width: number): THREE.Shape {
  // plan coords: (x, d) with d = distance back from the case front
  const s = new THREE.Shape();
  const k = scale * width;
  const d = scale * len;
  const f = frontCut;
  s.moveTo(-0.66 * k, f);
  s.lineTo(0.66 * k, f);
  s.lineTo(0.66 * k, 0.45 * d);
  s.quadraticCurveTo(0.63 * k, 0.98 * d, 0.28 * k, 1.2 * d);
  s.quadraticCurveTo(0.05 * k, 1.34 * d, -0.12 * k, 1.52 * d);
  s.quadraticCurveTo(-0.38 * k, 1.68 * d, -0.56 * k, 1.5 * d);
  s.quadraticCurveTo(-0.66 * k, 1.38 * d, -0.66 * k, 1.1 * d);
  s.lineTo(-0.66 * k, f);
  return s;
}

/** shape space (x, d) extruded by D → world slab x, y ∈ [yBottom, yBottom+D], z = frontZ - d */
function orientPlan(geo: THREE.BufferGeometry, frontZ: number, yBottom: number): void {
  geo.rotateX(-Math.PI / 2); // depth → +Y, shape d → -Z; winding preserved
  geo.translate(0, yBottom, frontZ);
}

export function createPiano(modelId: PianoModelId = 'scanned'): PianoRig {
  const cfg = PIANO_MODELS.find((m) => m.id === modelId) ?? PIANO_MODELS[0];
  const group = new THREE.Group();
  const black = new THREE.MeshPhysicalMaterial({
    color: cfg.finishColor,
    roughness: cfg.finishRoughness,
    clearcoat: 1.0,
    clearcoatRoughness: Math.max(0.03, cfg.finishRoughness * 0.4),
  });
  const gold = new THREE.MeshStandardMaterial({
    color: cfg.hardwareColor,
    metalness: cfg.hardwareMetalness,
    roughness: cfg.hardwareRoughness,
  });
  const bodyLen = LEN * cfg.lengthScale;
  const W = cfg.widthScale;
  const rim = (scale: number, frontCut = 0) => rimShape(scale, frontCut, bodyLen, W);

  const CASE_FRONT_Z = -0.02;
  const CASE_BASE_Y = 0.58;
  const CASE_H = 0.3;

  // rim: outer curve with inner hole → open case showing the interior
  const rimWithHole = rim(1);
  {
    const inner = rim(0.945);
    const hole = new THREE.Path();
    hole.curves = inner.curves;
    rimWithHole.holes.push(hole);
  }
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rimWithHole, {
      depth: CASE_H,
      bevelEnabled: true,
      bevelSize: 0.01,
      bevelThickness: 0.008,
      bevelSegments: 5,
      curveSegments: 96,
    }),
    black,
  );
  body.geometry = toCreasedNormals(body.geometry, Math.PI / 5) as unknown as THREE.ExtrudeGeometry;
  orientPlan(body.geometry, CASE_FRONT_Z, CASE_BASE_Y);
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  // case floor (bottom of the body)
  const bottom = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rim(0.99), { depth: 0.015, curveSegments: 40 }),
    black,
  );
  bottom.geometry = toCreasedNormals(bottom.geometry, Math.PI / 5) as unknown as THREE.ExtrudeGeometry;
  orientPlan(bottom.geometry, CASE_FRONT_Z - 0.002, CASE_BASE_Y);
  group.add(bottom);

  // soundboard (dark wood, visible under the open lid)
  const sound = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rim(0.94), { depth: 0.006, curveSegments: 40 }),
    new THREE.MeshStandardMaterial({ color: cfg.soundboardColor, roughness: 0.85, metalness: 0.02 }),
  );
  orientPlan(sound.geometry, CASE_FRONT_Z - 0.012, CASE_BASE_Y + 0.19);
  group.add(sound);

  // cast-iron plate, muted old gold
  const frame = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rim(0.87), { depth: 0.004, curveSegments: 40 }),
    new THREE.MeshStandardMaterial({ color: cfg.plateColor, metalness: cfg.plateMetalness, roughness: 0.62 }),
  );
  orientPlan(frame.geometry, CASE_FRONT_Z - 0.06, CASE_BASE_Y + 0.212);
  group.add(frame);

  // damper cover panel, pushed back to expose the pin block
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(1.23 * W, 0.014, 0.28),
    new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: 0.4, clearcoat: 0.5 }),
  );
  cover.position.set(0, CASE_BASE_Y + CASE_H - 0.045, CASE_FRONT_Z - 0.34);
  group.add(cover);

  // tuning pins: two staggered rows across the exposed pin block
  const pinMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc4, metalness: 0.95, roughness: 0.38 });
  const pinGeo = new THREE.CylinderGeometry(0.0032, 0.0032, 0.042, 8);
  const pinRows = 2;
  const pinsPerRow = 76;
  const pins = new THREE.InstancedMesh(pinGeo, pinMat, pinRows * pinsPerRow);
  {
    const pm = new THREE.Matrix4();
    const pq = new THREE.Quaternion();
    const ps = new THREE.Vector3(1, 1, 1);
    let idx = 0;
    for (let row = 0; row < pinRows; row++) {
      for (let i = 0; i < pinsPerRow; i++) {
        const x = THREE.MathUtils.lerp(-0.56 * W, 0.56 * W, (i + (row % 2) * 0.5) / pinsPerRow);
        const z = CASE_FRONT_Z - 0.065 - row * 0.045;
        pm.compose(new THREE.Vector3(x, CASE_BASE_Y + CASE_H - 0.028, z), pq, ps);
        pins.setMatrixAt(idx++, pm);
      }
    }
  }
  pins.castShadow = true;
  group.add(pins);

  // hammer rail: felt-topped bar between the pins and the damper cover
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.2 * W, 0.02, 0.035), black);
  rail.position.set(0, CASE_BASE_Y + CASE_H - 0.05, CASE_FRONT_Z - 0.17);
  group.add(rail);
  const railFelt = new THREE.Mesh(
    new THREE.BoxGeometry(1.2 * W, 0.006, 0.035),
    new THREE.MeshStandardMaterial({ color: cfg.feltColor, roughness: 1 }),
  );
  railFelt.position.set(0, CASE_BASE_Y + CASE_H - 0.037, CASE_FRONT_Z - 0.17);
  group.add(railFelt);

  // strings hint: thin bright lines fanning toward the tail
  const stringMat = new THREE.MeshStandardMaterial({ color: cfg.stringColor, metalness: 0.95, roughness: 0.3 });
  const stringGeo = new THREE.BoxGeometry(0.0012, 0.002, 1);
  const strings = new THREE.InstancedMesh(stringGeo, stringMat, 48);
  const sm = new THREE.Matrix4();
  const sq = new THREE.Quaternion();
  for (let i = 0; i < 48; i++) {
    const f = i / 47;
    const x = THREE.MathUtils.lerp(-0.5 * W, 0.53 * W, f);
    const len = THREE.MathUtils.lerp(1.3 * bodyLen, 0.32 * bodyLen, Math.pow(f, 1.35));
    const zMid = CASE_FRONT_Z - 0.14 - len / 2;
    sq.identity();
    sm.compose(new THREE.Vector3(x, CASE_BASE_Y + 0.225, zMid), sq, new THREE.Vector3(1, 1, len));
    strings.setMatrixAt(i, sm);
  }
  group.add(strings);

  // lid, hinged along the bass (left) edge, propped open
  const lidGroup = new THREE.Group();
  // main lid with the front flap folded back (front 30cm open, doubled strip)
  const lidMat = new THREE.MeshPhysicalMaterial({
    color: cfg.finishColor,
    roughness: cfg.finishRoughness + 0.18,
    clearcoat: 0.75,
    clearcoatRoughness: 0.28,
  });
  const lid = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rim(1, 0.3), { depth: 0.022, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 48 }),
    lidMat,
  );
  lid.geometry = toCreasedNormals(lid.geometry, Math.PI / 5) as unknown as THREE.ExtrudeGeometry;
  orientPlan(lid.geometry, CASE_FRONT_Z, 0);
  lid.geometry.translate(0.66 * W, 0, 0); // hinge line to origin
  lid.castShadow = true;
  const flap = new THREE.Mesh(new THREE.BoxGeometry(1.3 * W, 0.02, 0.28), lidMat);
  flap.position.set(0.66 * W, 0.032, CASE_FRONT_Z - 0.45);
  lidGroup.add(flap);
  lidGroup.position.set(-0.66 * W, CASE_BASE_Y + CASE_H + 0.012, 0);
  lidGroup.rotation.z = THREE.MathUtils.degToRad(42);
  lidGroup.add(lid);
  group.add(lidGroup);

  // lid prop
  const prop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.011, 0.72),
    black.clone(),
  );
  prop.position.set(0.5, 1.24, -0.95 * cfg.lengthScale);
  prop.rotation.z = THREE.MathUtils.degToRad(-16);
  group.add(prop);

  // keybed + cheeks + fallboard + felt
  const kbHalf = 0.611 + cfg.extraBassKeys * 0.0235;
  const bed = new THREE.Mesh(new THREE.BoxGeometry(kbHalf * 2 + 0.09, 0.045, 0.21), black);
  bed.position.set(0, 0.7, 0.075);
  bed.castShadow = bed.receiveShadow = true;
  group.add(bed);

  const cheekGeo = new THREE.BoxGeometry(0.042, 0.075, 0.2);
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, black);
    cheek.position.set(sx * (kbHalf + 0.023), 0.755, 0.06);
    cheek.castShadow = true;
    group.add(cheek);
  }

  // Bösendorfer-style extra bass keys: black-capped naturals left of A0
  if (cfg.extraBassKeys > 0) {
    const extraMat = new THREE.MeshPhysicalMaterial({ color: 0x111114, roughness: 0.3, clearcoat: 0.6 });
    const extraGeo = new THREE.BoxGeometry(0.0222, 0.021, 0.15);
    for (let i = 0; i < cfg.extraBassKeys; i++) {
      const k = new THREE.Mesh(extraGeo, extraMat);
      k.position.set(-(0.611 + (i + 0.5) * 0.0235), 0.735 - 0.0105, 0.075);
      k.castShadow = true;
      group.add(k);
    }
  }

  const fall = new THREE.Mesh(new THREE.BoxGeometry(kbHalf * 2 + 0.003, 0.085, 0.03), black);
  fall.position.set(0, 0.775, -0.012);
  fall.rotation.x = THREE.MathUtils.degToRad(-14);
  group.add(fall);
  const goldStrip = new THREE.Mesh(new THREE.BoxGeometry(kbHalf * 2, 0.006, 0.006), gold);
  goldStrip.position.set(0, 0.812, -0.02);
  goldStrip.rotation.x = THREE.MathUtils.degToRad(-14);
  group.add(goldStrip);

  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(kbHalf * 2, 0.004, 0.012),
    new THREE.MeshStandardMaterial({ color: cfg.feltColor, roughness: 1 }),
  );
  felt.position.set(0, 0.738, -0.001);
  group.add(felt);

  // music desk
  const desk = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.014), black);
  desk.position.set(0, 0.93, -0.12);
  desk.rotation.x = THREE.MathUtils.degToRad(-20);
  desk.castShadow = true;
  group.add(desk);

  // legs + casters
  const legGeo = new THREE.CylinderGeometry(0.038, 0.055, 0.58, 14);
  const legs: Array<[number, number]> = [
    [-0.56 * W, 0.02],
    [0.56 * W, 0.02],
    [-0.2, -1.78 * cfg.lengthScale],
  ];
  for (const [lx, lz] of legs) {
    const leg = new THREE.Mesh(legGeo, black);
    leg.position.set(lx, 0.29, lz);
    leg.castShadow = true;
    group.add(leg);
    const caster = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), gold);
    caster.position.set(lx, 0.035, lz);
    group.add(caster);
  }

  // lyre + pedals
  const lyre = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), black);
  post.position.set(0, 0.37, 0);
  lyre.add(post);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.12), black);
  base.position.set(0, 0.14, 0.01);
  lyre.add(base);
  const pedalGeo = new THREE.BoxGeometry(0.028, 0.012, 0.11);
  const pedals: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.position.set((i - 1) * 0.062, 0.155, 0.02);
    const pedal = new THREE.Mesh(pedalGeo, gold);
    pedal.position.set(0, 0, 0.055);
    pivot.add(pedal);
    lyre.add(pivot);
    pedals.push(pedal);
    pedal.userData.pivot = pivot;
  }
  lyre.position.set(0, 0, -0.08);
  group.add(lyre);

  // bench
  const bench = new THREE.Group();
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.055, 0.34),
    new THREE.MeshPhysicalMaterial({ color: 0x121013, roughness: 0.55, clearcoat: 0.25 }),
  );
  seat.position.y = 0.49;
  seat.castShadow = seat.receiveShadow = true;
  bench.add(seat);
  const bLegGeo = new THREE.CylinderGeometry(0.03, 0.036, 0.46, 10);
  for (const bx of [-0.25, 0.25]) {
    for (const bz of [-0.13, 0.13]) {
      const bl = new THREE.Mesh(bLegGeo, black);
      bl.position.set(bx, 0.235, bz);
      bl.castShadow = true;
      bench.add(bl);
    }
  }
  bench.position.set(0, 0, 0.62);
  group.add(bench);

  const sustainPivot = pedals[2].userData.pivot as THREE.Group;

  return {
    group,
    setPedal(v: number) {
      sustainPivot.rotation.x = -v * 0.22;
    },
    setLidVisible(v: boolean) {
      lidGroup.visible = v;
      prop.visible = v;
      desk.visible = v;
    },
    dispose() {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    },
  };
}
