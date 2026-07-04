import * as THREE from 'three';
import type { PoseFrame } from '../core/choreo/program';
import type { Hand } from '../core/types';
import { aimSegment, solveTwoBone } from './ik';
import { kbToWorld } from './mapping';

/**
 * The virtual pianist: a sculptural obsidian figure. Rigid capsule segments
 * on a plain Object3D hierarchy; arms are two-bone IK chains driven by the
 * choreography's wrist targets, fingers are analytic 3-joint chains driven
 * by fingertip targets.
 */

export type CharacterId = 'nocturne' | 'elena' | 'marcus' | 'yuki' | 'august';

export interface CharacterSpec {
  id: CharacterId;
  name: string;
  blurb: string;
  skinColor: number;
  skinRoughness: number;
  skinClearcoat: number;
  outfitColor: number;
  outfitRoughness: number;
  accentColor: number;
  hair: 'none' | 'bun' | 'short' | 'long' | 'swept';
  hairColor: number;
  gown: boolean;
  /** visual bulk multiplier (radii only — skeleton stays identical) */
  build: number;
  face: boolean;
}

export const CHARACTERS: CharacterSpec[] = [
  {
    id: 'elena', name: 'Elena', blurb: 'Concert gown, dark bun',
    skinColor: 0xd9a586, skinRoughness: 0.55, skinClearcoat: 0.12,
    outfitColor: 0x11302a, outfitRoughness: 0.72, accentColor: 0x0c221d,
    hair: 'bun', hairColor: 0x241610, gown: true, build: 0.94, face: true,
  },
  {
    id: 'marcus', name: 'Marcus', blurb: 'Classic tailcoat',
    skinColor: 0x6b442c, skinRoughness: 0.58, skinClearcoat: 0.1,
    outfitColor: 0x0d0d11, outfitRoughness: 0.55, accentColor: 0xe6e1d4,
    hair: 'short', hairColor: 0x0e0a08, gown: false, build: 1.06, face: true,
  },
  {
    id: 'yuki', name: 'Yuki', blurb: 'Ivory blouse, long hair',
    skinColor: 0xeccdb0, skinRoughness: 0.52, skinClearcoat: 0.14,
    outfitColor: 0xcfc7b6, outfitRoughness: 0.68, accentColor: 0x24242a,
    hair: 'long', hairColor: 0x15100e, gown: false, build: 0.92, face: true,
  },
  {
    id: 'august', name: 'August', blurb: 'Charcoal turtleneck, silver hair',
    skinColor: 0xc39b7d, skinRoughness: 0.56, skinClearcoat: 0.1,
    outfitColor: 0x26262c, outfitRoughness: 0.8, accentColor: 0x1a1a1f,
    hair: 'swept', hairColor: 0xb4b8bf, gown: false, build: 1.02, face: true,
  },
  {
    id: 'nocturne', name: 'Nocturne', blurb: 'The obsidian sculpture',
    skinColor: 0x131217, skinRoughness: 0.42, skinClearcoat: 0.4,
    outfitColor: 0x101013, outfitRoughness: 0.52, accentColor: 0x131217,
    hair: 'none', hairColor: 0x000000, gown: false, build: 1.0, face: false,
  },
];

export interface PianistRig {
  group: THREE.Group;
  apply(frame: PoseFrame): void;
  setVisible(v: boolean): void;
  /** hide head + neck for first-person view */
  setHeadVisible(v: boolean): void;
  /** Synthesia framing: only forearms + hands, everything else hidden */
  setHandsOnly(v: boolean): void;
  dispose(): void;
}

const UPPER_ARM = 0.285;
const FOREARM = 0.26;
const THIGH = 0.42;
const SHIN = 0.42;

interface FingerChain {
  yaw: THREE.Group; // at MCP, rotates around Y (splay)
  mcp: THREE.Group; // pitch
  pip: THREE.Group;
  dip: THREE.Group;
  lengths: [number, number, number];
}

interface ArmRig {
  shoulder: THREE.Group; // upper-arm pivot (aims at elbow)
  elbow: THREE.Group; // forearm pivot (aims at wrist)
  elbowBall: THREE.Mesh;
  hand: THREE.Group; // positioned at wrist, oriented from finger targets
  fingers: FingerChain[];
  side: 1 | -1; // R = -? set below
}

function capsule(r: number, len: number, mat: THREE.Material, sy = 1, sx = 1): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 18);
  geo.translate(0, -len / 2, 0); // hang along -Y from origin
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(sx, sy, 1);
  mesh.castShadow = true;
  return mesh;
}

function joint(r: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.castShadow = true;
  return m;
}

export function createPianist(characterId: CharacterId = 'nocturne'): PianistRig {
  const spec = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[CHARACTERS.length - 1];
  const body = new THREE.MeshPhysicalMaterial({
    color: spec.outfitColor,
    roughness: spec.outfitRoughness,
    metalness: 0.04,
    clearcoat: spec.id === 'nocturne' ? 0.35 : 0.08,
    clearcoatRoughness: 0.45,
  });
  const skin = new THREE.MeshPhysicalMaterial({
    color: spec.skinColor,
    roughness: spec.skinRoughness,
    metalness: spec.id === 'nocturne' ? 0.04 : 0.0,
    clearcoat: spec.skinClearcoat,
    clearcoatRoughness: 0.5,
  });
  const accent = new THREE.MeshPhysicalMaterial({
    color: spec.accentColor,
    roughness: 0.6,
    metalness: 0.02,
  });
  const hairMat = new THREE.MeshPhysicalMaterial({
    color: spec.hairColor,
    roughness: 0.72,
    metalness: 0.05,
    clearcoat: 0.2,
    clearcoatRoughness: 0.6,
  });
  const shoe = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.35, clearcoat: 0.6 });
  const bulk = spec.build;
  const group = new THREE.Group();

  // ---- torso chain --------------------------------------------------------
  const root = new THREE.Group(); // pelvis on the bench
  root.position.set(0, 0.55, 0.6);
  group.add(root);

  const hipsMesh = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), body);
  hipsMesh.scale.set(1.02 * bulk, 0.6, 0.78);
  hipsMesh.castShadow = true;
  root.add(hipsMesh);

  if (spec.gown) {
    // skirt draping over the bench
    const skirtProfile: THREE.Vector2[] = [
      new THREE.Vector2(0.14, 0.02),
      new THREE.Vector2(0.19, -0.04),
      new THREE.Vector2(0.24, -0.1),
      new THREE.Vector2(0.27, -0.14),
    ];
    const skirt = new THREE.Mesh(new THREE.LatheGeometry(skirtProfile, 28), body);
    skirt.scale.set(1, 1, 0.8);
    skirt.castShadow = true;
    root.add(skirt);
  } else {
    // coat tail hint
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.2), body);
    tail.position.set(0, -0.055, 0.1);
    tail.rotation.x = 0.25;
    root.add(tail);
  }

  const spine1 = new THREE.Group();
  spine1.position.set(0, 0.075, 0);
  root.add(spine1);

  // one smooth "tailcoat" shell over the articulated core — kills the seams
  const coatProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.001, -0.12),
    new THREE.Vector2(0.15, -0.115),
    new THREE.Vector2(0.152, -0.05),
    new THREE.Vector2(0.128, 0.05),
    new THREE.Vector2(0.118, 0.14),
    new THREE.Vector2(0.13, 0.24),
    new THREE.Vector2(0.148, 0.32),
    new THREE.Vector2(0.152, 0.375),
    new THREE.Vector2(0.118, 0.43),
    new THREE.Vector2(0.05, 0.462),
    new THREE.Vector2(0.001, 0.465),
  ];
  const coat = new THREE.Mesh(new THREE.LatheGeometry(coatProfile, 26), body);
  coat.scale.set(bulk, 1, 0.7);
  coat.castShadow = true;
  spine1.add(coat);

  if (spec.id === 'marcus') {
    // slim shirt-front strip under the tailcoat
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.17, 0.02), accent);
    shirt.position.set(0, 0.33, -0.1);
    shirt.rotation.x = 0.12;
    spine1.add(shirt);
  }

  const spine1Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.118, 20, 16), body);
  spine1Mesh.scale.set(0.98, 0.92, 0.62);
  spine1Mesh.position.y = 0.045;
  spine1Mesh.castShadow = true;
  spine1.add(spine1Mesh);

  const spine2 = new THREE.Group();
  spine2.position.set(0, 0.105, 0);
  spine1.add(spine2);
  const spine2Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.122, 20, 16), body);
  spine2Mesh.scale.set(1.04, 0.95, 0.62);
  spine2Mesh.position.y = 0.05;
  spine2Mesh.castShadow = true;
  spine2.add(spine2Mesh);

  const chest = new THREE.Group();
  chest.position.set(0, 0.125, 0);
  spine2.add(chest);
  const chestMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 22, 18), body);
  chestMesh.scale.set(1.22 * bulk, 1.0, 0.66);
  chestMesh.position.y = 0.05;
  chestMesh.castShadow = true;
  chest.add(chestMesh);

  const neck = new THREE.Group();
  neck.position.set(0, 0.175, -0.01);
  chest.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 14), skin);
  neckMesh.position.y = 0.03;
  neckMesh.castShadow = true;
  neck.add(neckMesh);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.014, 10, 24), accent);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.005;
  neck.add(collar);

  const head = new THREE.Group();
  head.position.set(0, 0.09, 0);
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.093, 26, 20), skin);
  skull.scale.set(0.92, 1.12, 1.0);
  skull.position.y = 0.075;
  skull.castShadow = true;
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.062, 18, 14), skin);
  jaw.scale.set(0.82, 0.9, 0.86);
  jaw.position.set(0, 0.015, -0.014);
  head.add(jaw);

  if (spec.face) {
    // restrained facial hints — mannequin-smooth, no uncanny detail
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), skin);
    nose.scale.set(0.7, 1.0, 0.9);
    nose.position.set(0, 0.055, -0.088);
    head.add(nose);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.skinColor).multiplyScalar(0.42),
      roughness: 0.85,
    });
    for (const ex of [-0.031, 0.031]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), eyeMat);
      eye.scale.set(1.15, 0.55, 0.5);
      eye.position.set(ex, 0.082, -0.082);
      head.add(eye);
    }
    for (const ex of [-0.085, 0.085]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), skin);
      ear.scale.set(0.45, 0.8, 0.6);
      ear.position.set(ex, 0.06, 0.005);
      head.add(ear);
    }
  }

  if (spec.hair !== 'none') {
    // hood shell over the top/back of the skull, leaving the face open
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.099, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hairMat,
    );
    hood.scale.set(0.95, 1.08, 1.04);
    hood.position.set(0, 0.082, 0.008);
    hood.rotation.x = 0.5; // sweep back off the brow
    hood.castShadow = true;
    head.add(hood);
    if (spec.hair === 'bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.037, 14, 12), hairMat);
      bun.position.set(0, 0.11, 0.085);
      head.add(bun);
    } else if (spec.hair === 'long') {
      const fallHair = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.2, 6, 14), hairMat);
      fallHair.scale.set(1.25, 1, 0.55);
      fallHair.position.set(0, -0.07, 0.075);
      fallHair.rotation.x = 0.12;
      head.add(fallHair);
    } else if (spec.hair === 'swept') {
      const crest = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), hairMat);
      crest.scale.set(1.5, 0.55, 1.35);
      crest.position.set(0, 0.148, 0.012);
      head.add(crest);
    }
  }

  // ---- arms ---------------------------------------------------------------
  function buildArm(handKey: Hand): ArmRig {
    const side = handKey === 'L' ? -1 : 1; // world x sign of the shoulder
    const clav = new THREE.Group();
    clav.position.set(side * 0.168, 0.125, -0.005);
    chest.add(clav);
    const shoulderBall = joint(0.054 * bulk, body);
    clav.add(shoulderBall);

    const shoulder = new THREE.Group();
    clav.add(shoulder);
    shoulder.add(capsule(0.047 * bulk, UPPER_ARM, body, 1, 1));

    const elbow = new THREE.Group();
    group.add(elbow); // world-space driven
    elbow.add(capsule(0.038 * bulk, FOREARM, body));
    const elbowBall = joint(0.045 * bulk, body);
    elbow.add(elbowBall);

    // cuff
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.0395 * bulk, 0.041 * bulk, 0.02, 14), accent);
    cuff.position.y = -FOREARM + 0.025;
    elbow.add(cuff);

    const hand = new THREE.Group();
    group.add(hand); // world-space driven
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.047, 18, 14), skin);
    palm.scale.set(0.92, 0.36, 1.35);
    palm.position.set(0, -0.006, -0.045);
    palm.castShadow = true;
    hand.add(palm);

    const fingers: FingerChain[] = [];
    const spread = [
      // [x offset, z offset, segment lengths]
      { x: -0.04 * side, z: -0.028, l: [0.042, 0.028, 0.024] as [number, number, number], thumb: true },
      { x: -0.023 * side, z: -0.08, l: [0.044, 0.027, 0.021] as [number, number, number] },
      { x: -0.008 * side, z: -0.084, l: [0.048, 0.03, 0.023] as [number, number, number] },
      { x: 0.008 * side, z: -0.08, l: [0.044, 0.028, 0.021] as [number, number, number] },
      { x: 0.023 * side, z: -0.072, l: [0.035, 0.023, 0.019] as [number, number, number] },
    ];
    for (const s of spread) {
      const yawG = new THREE.Group();
      yawG.position.set(s.x, -0.006, s.z);
      hand.add(yawG);
      if (s.thumb) {
        yawG.rotation.y = side * 0.85;
        yawG.rotation.z = side * -0.5;
      }
      const mcp = new THREE.Group();
      yawG.add(mcp);
      mcp.add(knuckle(0.0092));
      const b1 = boneZ(s.l[0], 0.008);
      mcp.add(b1);
      const pip = new THREE.Group();
      pip.position.z = -s.l[0];
      mcp.add(pip);
      pip.add(knuckle(0.0078));
      pip.add(boneZ(s.l[1], 0.0071));
      const dip = new THREE.Group();
      dip.position.z = -s.l[1];
      pip.add(dip);
      dip.add(knuckle(0.0068));
      dip.add(boneZ(s.l[2], 0.0062, true));
      fingers.push({ yaw: yawG, mcp, pip, dip, lengths: s.l });
    }
    return { shoulder, elbow, elbowBall, hand, fingers, side: side as 1 | -1 };

    function knuckle(r: number): THREE.Mesh {
      const k = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), skin);
      k.castShadow = true;
      return k;
    }
    function boneZ(len: number, r: number, tip = false): THREE.Mesh {
      const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - (tip ? r : 2 * r)), 5, 12);
      geo.rotateX(Math.PI / 2); // capsule axis Y -> Z
      geo.translate(0, 0, -len / 2);
      const mesh = new THREE.Mesh(geo, skin);
      mesh.castShadow = true;
      return mesh;
    }
  }

  const arms: Record<Hand, ArmRig> = { L: buildArm('L'), R: buildArm('R') };

  // ---- legs (IK to static foot anchors; right foot rides the pedal) -------
  interface Leg {
    hip: THREE.Group;
    knee: THREE.Group;
    foot: THREE.Mesh;
    hipLocal: THREE.Vector3;
    footAnchor: THREE.Vector3;
  }
  function buildLeg(sx: number, footX: number, footZ: number): Leg {
    const hip = new THREE.Group();
    root.add(hip);
    hip.position.set(sx * 0.095, -0.02, 0.02);
    hip.add(capsule(0.062 * bulk, THIGH, body));
    const knee = new THREE.Group();
    group.add(knee);
    knee.add(capsule(0.048 * bulk, SHIN, body));
    knee.add(joint(0.055 * bulk, body));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.24), shoe);
    foot.castShadow = true;
    group.add(foot);
    return {
      hip,
      knee,
      foot,
      hipLocal: new THREE.Vector3(sx * 0.095, -0.02, 0.02),
      footAnchor: new THREE.Vector3(footX, 0.045, footZ),
    };
  }
  const legL = buildLeg(-1, -0.16, 0.18);
  const legR = buildLeg(1, 0.062, 0.06);

  // ---- scratch vectors ----------------------------------------------------
  const wristW = new THREE.Vector3();
  const shoulderW = new THREE.Vector3();
  const elbowW = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const tipW = new THREE.Vector3();
  const tipsAvg = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  const tipLocal = new THREE.Vector3();
  const hipW = new THREE.Vector3();
  const kneeW = new THREE.Vector3();
  const UP_Y = new THREE.Vector3(0, 1, 0);
  const _rollQ = new THREE.Quaternion();
  const _backAxis = new THREE.Vector3();

  function applyArm(handKey: Hand, frame: PoseFrame): void {
    const arm = arms[handKey];
    const pose = frame.hands[handKey];
    kbToWorld(pose.wrist.x, pose.wrist.y, pose.wrist.z, wristW);

    arm.shoulder.getWorldPosition(shoulderW);

    // average fingertip target → hand forward
    tipsAvg.set(0, 0, 0);
    for (const f of pose.fingers) {
      kbToWorld(f.tip.x, f.tip.y, f.tip.z, tipW);
      tipsAvg.add(tipW);
    }
    tipsAvg.multiplyScalar(1 / 5);

    pole.copy(shoulderW).add(new THREE.Vector3(arm.side * 0.45, -0.42, 0.3));
    solveTwoBone(shoulderW, wristW, UPPER_ARM, FOREARM, pole, elbowW);

    aimSegment(arm.shoulder, shoulderW, elbowW);
    arm.elbow.position.copy(elbowW);
    aimSegment(arm.elbow, elbowW, wristW);

    // hand frame: local -Z points along the fingers, local +Y is the hand back
    arm.hand.position.copy(wristW);
    fwd.subVectors(tipsAvg, wristW);
    fwd.y *= 0.35; // keep the palm mostly level
    if (fwd.lengthSq() < 1e-8) fwd.set(0, -0.2, -1);
    fwd.normalize();
    const back = fwd.clone().negate(); // local +Z
    right.crossVectors(UP_Y, back).normalize(); // X = Y×Z
    up.crossVectors(back, right).normalize(); // Y = Z×X
    mtx.makeBasis(right, up, back);
    arm.hand.quaternion.setFromRotationMatrix(mtx);
    // wrist roll toward the working side (ulnar/radial deviation look)
    _rollQ.setFromAxisAngle(_backAxis.copy(back), pose.roll * (handKey === 'R' ? -1 : 1));
    arm.hand.quaternion.premultiply(_rollQ);
    arm.hand.updateMatrixWorld(true);

    // fingers
    for (let i = 0; i < 5; i++) {
      const chain = arm.fingers[i];
      const fp = pose.fingers[i];
      // biomechanical coupling: neighbors of a pressing finger flex a little
      const coupling =
        0.2 * ((pose.fingers[i - 1]?.press ?? 0) + (pose.fingers[i + 1]?.press ?? 0)) * (1 - fp.press);
      kbToWorld(fp.tip.x, fp.tip.y, fp.tip.z, tipW);
      tipLocal.copy(tipW);
      chain.yaw.parent!.worldToLocal(tipLocal);
      tipLocal.sub(chain.yaw.position);

      const isThumb = i === 0;
      const yaw = Math.atan2(-tipLocal.x, -tipLocal.z);
      if (isThumb) {
        const yawBase = arm.side * 0.85;
        chain.yaw.rotation.y = yawBase * 0.6 + THREE.MathUtils.clamp(yaw, -1.2, 1.2) * 0.5 + fp.splay * 0.08;
      } else {
        chain.yaw.rotation.y = THREE.MathUtils.clamp(yaw, -0.55, 0.55) * 0.85 + fp.splay * 0.08;
      }

      const horiz = Math.hypot(tipLocal.x, tipLocal.z);
      const dy = tipLocal.y;
      const [l1, l2raw, l3] = chain.lengths;
      const l2 = l2raw + l3 * 0.8;
      const d = THREE.MathUtils.clamp(Math.hypot(horiz, dy), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
      const phi = Math.atan2(-dy, horiz); // down positive
      const cosA1 = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
      const a1 = Math.acos(cosA1);
      const cosInner = THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
      const bend = Math.PI - Math.acos(cosInner);
      const curlBias = 0.35 + fp.curl * 0.5;
      chain.mcp.rotation.x = THREE.MathUtils.clamp(-(phi - a1) - 0.05 - coupling * 0.3, -1.45, 0.1);
      chain.pip.rotation.x = THREE.MathUtils.clamp(-bend * (0.72 + 0.1 * curlBias) - coupling, -1.9, 0);
      chain.dip.rotation.x = THREE.MathUtils.clamp(-bend * (0.42 * curlBias) - coupling * 0.7, -1.2, 0);
    }
  }

  function applyLeg(leg: Leg, footTarget: THREE.Vector3, pedalPitch: number): void {
    leg.hip.getWorldPosition(hipW);
    pole.copy(hipW).add(new THREE.Vector3(0, 0.1, 0.6));
    solveTwoBone(hipW, footTarget, THIGH, SHIN, pole, kneeW);
    aimSegment(leg.hip, hipW, kneeW);
    leg.knee.position.copy(kneeW);
    aimSegment(leg.knee, kneeW, footTarget);
    leg.foot.position.copy(footTarget);
    leg.foot.position.z += 0.06;
    leg.foot.rotation.x = -pedalPitch;
  }

  function apply(frame: PoseFrame): void {
    // body
    root.rotation.z = -(frame.body.leanX * 0.55 + frame.body.sway * 0.35);
    root.rotation.x = frame.body.leanZ * 0.15;
    root.position.x = frame.body.leanX * 0.14 + frame.body.sway * 0.05;
    spine1.rotation.x = 0.14 + frame.body.leanZ * 0.9;
    spine2.rotation.x = 0.05 + frame.body.leanZ * 0.35 + frame.body.breath * 0.006;
    chest.rotation.x = -0.08;
    chest.scale.setScalar(1 + frame.body.breath * 0.008);
    neck.rotation.y = frame.head.yaw * 0.5;
    head.rotation.y = frame.head.yaw * 0.55;
    head.rotation.x = frame.head.pitch * 0.8 - frame.head.lift * 0.5 + 0.18;
    group.updateMatrixWorld(true);

    applyArm('L', frame);
    applyArm('R', frame);

    applyLeg(legL, legL.footAnchor, 0);
    applyLeg(legR, legR.footAnchor, frame.pedal * 0.18);
  }

  // neutral pose
  apply({
    hands: {
      L: neutralHand('L'),
      R: neutralHand('R'),
    },
    body: { leanX: 0, leanZ: 0.02, sway: 0, breath: 0 },
    head: { yaw: 0, pitch: -0.1, lift: 0 },
    pedal: 0,
    keys: new Float32Array(88),
  });

  return {
    group,
    apply,
    setVisible(v: boolean) {
      group.visible = v;
    },
    setHeadVisible(v: boolean) {
      neck.visible = v;
    },
    setHandsOnly(v: boolean) {
      root.visible = !v;
      arms.L.elbowBall.visible = !v;
      arms.R.elbowBall.visible = !v;
      for (const leg of [legL, legR]) {
        leg.knee.visible = !v;
        leg.foot.visible = !v;
      }
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

function neutralHand(hand: Hand) {
  const x = hand === 'L' ? 380 : 840;
  return {
    wrist: { x, y: 46, z: 238 },
    fingers: Array.from({ length: 5 }, (_, i) => ({
      tip: { x: x + (hand === 'L' ? 1 : -1) * (32 - i * 15), y: 12, z: 120 },
      press: 0,
      curl: 0.45,
      splay: 0,
    })),
    roll: 0,
  };
}
