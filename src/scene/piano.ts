import * as THREE from 'three';

/**
 * Procedural concert grand: rim slab with the classic plan curve, propped
 * lid, keybed, fallboard, felt, legs, lyre with a working sustain pedal,
 * and a bench. World meters; keyboard front edge at z≈0.16, body into -z.
 */

export interface PianoRig {
  group: THREE.Group;
  setPedal(v: number): void;
}

const BLACK = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0x060607,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
const GOLD = () =>
  new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 1.0, roughness: 0.32 });

const LEN = 1.32; // depth stretch → ~2.2m concert length

function rimShape(scale = 1): THREE.Shape {
  // plan coords: (x, d) with d = distance back from the case front
  const s = new THREE.Shape();
  const k = scale;
  const d = scale * LEN;
  s.moveTo(-0.66 * k, 0);
  s.lineTo(0.66 * k, 0);
  s.lineTo(0.66 * k, 0.45 * d);
  s.quadraticCurveTo(0.63 * k, 0.98 * d, 0.28 * k, 1.2 * d);
  s.quadraticCurveTo(0.05 * k, 1.34 * d, -0.12 * k, 1.52 * d);
  s.quadraticCurveTo(-0.38 * k, 1.68 * d, -0.56 * k, 1.5 * d);
  s.quadraticCurveTo(-0.66 * k, 1.38 * d, -0.66 * k, 1.1 * d);
  s.lineTo(-0.66 * k, 0);
  return s;
}

/** shape space (x, d) extruded by D → world slab x, y ∈ [yBottom, yBottom+D], z = frontZ - d */
function orientPlan(geo: THREE.BufferGeometry, frontZ: number, yBottom: number): void {
  geo.rotateX(-Math.PI / 2); // depth → +Y, shape d → -Z; winding preserved
  geo.translate(0, yBottom, frontZ);
}

export function createPiano(): PianoRig {
  const group = new THREE.Group();
  const black = BLACK();
  const gold = GOLD();

  const CASE_FRONT_Z = -0.02;
  const CASE_BASE_Y = 0.58;
  const CASE_H = 0.3;

  // rim: outer curve with inner hole → open case showing the interior
  const rimWithHole = rimShape();
  {
    const inner = rimShape(0.945);
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
      bevelSegments: 2,
      curveSegments: 48,
    }),
    black,
  );
  orientPlan(body.geometry, CASE_FRONT_Z, CASE_BASE_Y);
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  // case floor (bottom of the body)
  const bottom = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rimShape(0.99), { depth: 0.015, curveSegments: 40 }),
    black,
  );
  orientPlan(bottom.geometry, CASE_FRONT_Z - 0.002, CASE_BASE_Y);
  group.add(bottom);

  // soundboard (dark wood, visible under the open lid)
  const sound = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rimShape(0.94), { depth: 0.006, curveSegments: 40 }),
    new THREE.MeshStandardMaterial({ color: 0x120b05, roughness: 0.85, metalness: 0.02 }),
  );
  orientPlan(sound.geometry, CASE_FRONT_Z - 0.012, CASE_BASE_Y + 0.19);
  group.add(sound);

  // cast-iron plate, muted old gold
  const frame = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rimShape(0.87), { depth: 0.004, curveSegments: 40 }),
    new THREE.MeshStandardMaterial({ color: 0x2e2410, metalness: 0.5, roughness: 0.68 }),
  );
  orientPlan(frame.geometry, CASE_FRONT_Z - 0.06, CASE_BASE_Y + 0.212);
  group.add(frame);

  // damper/pin-block cover: dark panel over the front interior
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(1.23, 0.014, 0.42),
    new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: 0.4, clearcoat: 0.5 }),
  );
  cover.position.set(0, CASE_BASE_Y + CASE_H - 0.045, CASE_FRONT_Z - 0.24);
  group.add(cover);

  // strings hint: thin bright lines fanning toward the tail
  const stringMat = new THREE.MeshStandardMaterial({ color: 0xd8d3c4, metalness: 0.95, roughness: 0.3 });
  const stringGeo = new THREE.BoxGeometry(0.0012, 0.002, 1);
  const strings = new THREE.InstancedMesh(stringGeo, stringMat, 48);
  const sm = new THREE.Matrix4();
  const sq = new THREE.Quaternion();
  for (let i = 0; i < 48; i++) {
    const f = i / 47;
    const x = THREE.MathUtils.lerp(-0.5, 0.53, f);
    const len = THREE.MathUtils.lerp(1.3 * LEN, 0.32 * LEN, Math.pow(f, 1.35));
    const zMid = CASE_FRONT_Z - 0.14 - len / 2;
    sq.identity();
    sm.compose(new THREE.Vector3(x, CASE_BASE_Y + 0.225, zMid), sq, new THREE.Vector3(1, 1, len));
    strings.setMatrixAt(i, sm);
  }
  group.add(strings);

  // lid, hinged along the bass (left) edge, propped open
  const lidGroup = new THREE.Group();
  const lid = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rimShape(), { depth: 0.022, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 48 }),
    black,
  );
  orientPlan(lid.geometry, CASE_FRONT_Z, 0);
  lid.geometry.translate(0.66, 0, 0); // hinge line to origin
  lid.castShadow = true;
  lidGroup.position.set(-0.66, CASE_BASE_Y + CASE_H + 0.012, 0);
  lidGroup.rotation.z = THREE.MathUtils.degToRad(27);
  lidGroup.add(lid);
  group.add(lidGroup);

  // lid prop
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.56), black.clone());
  prop.position.set(0.5, 1.13, -0.98);
  prop.rotation.z = THREE.MathUtils.degToRad(-20);
  group.add(prop);

  // keybed + cheeks + fallboard + felt
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.31, 0.045, 0.21), black);
  bed.position.set(0, 0.7, 0.075);
  bed.castShadow = bed.receiveShadow = true;
  group.add(bed);

  const cheekGeo = new THREE.BoxGeometry(0.042, 0.075, 0.2);
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, black);
    cheek.position.set(sx * 0.634, 0.755, 0.06);
    cheek.castShadow = true;
    group.add(cheek);
  }

  const fall = new THREE.Mesh(new THREE.BoxGeometry(1.225, 0.085, 0.03), black);
  fall.position.set(0, 0.775, -0.012);
  fall.rotation.x = THREE.MathUtils.degToRad(-14);
  group.add(fall);
  const goldStrip = new THREE.Mesh(new THREE.BoxGeometry(1.225, 0.006, 0.006), gold);
  goldStrip.position.set(0, 0.812, -0.02);
  goldStrip.rotation.x = THREE.MathUtils.degToRad(-14);
  group.add(goldStrip);

  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(1.225, 0.004, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x8c1626, roughness: 1 }),
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
    [-0.56, 0.02],
    [0.56, 0.02],
    [-0.2, -1.78],
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
  };
}
