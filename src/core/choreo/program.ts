import {
  KEYBOARD_WIDTH_MM,
  KEY_COUNT,
  contactZ,
  isBlack,
  keyCenterX,
  keyIndex,
  keyTopY,
} from '../keyboard';
import type { Finger, Hand, PerformanceNote, PerformanceScore } from '../types';

/**
 * Deterministic performance choreography.
 *
 * Wrist paths, body lean and gaze need physics-like smoothing, so they are
 * simulated once at 240 Hz into flat arrays. Finger envelopes, key dips and
 * pedal are cheap analytic functions of the note lists. `sample(t)` is a pure
 * function of t — the realtime studio and the offline exporter see identical
 * motion.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FingerPose {
  tip: Vec3;
  /** 0..1 key-press amount for this finger */
  press: number;
  /** 0 = extended, 1 = fully curled */
  curl: number;
  /** -1..1 lateral deviation from the finger's home slot */
  splay: number;
}

export interface HandPose {
  wrist: Vec3;
  /** index 0..4 = fingers 1..5 (thumb..pinky) */
  fingers: FingerPose[];
  /** wrist roll toward the pressing finger: + = pinky side, − = thumb side */
  roll: number;
}

export interface PoseFrame {
  hands: Record<Hand, HandPose>;
  body: { leanX: number; leanZ: number; sway: number; breath: number };
  head: {
    yaw: number;
    pitch: number;
    lift: number;
    /** where the eyes are looking along the keyboard (mm) — anticipates upcoming entries */
    gazeX: number;
  };
  pedal: number;
  /** per-key dip 0..1, index = keyIndex(midi) */
  keys: Float32Array;
}

export interface ChoreoProgram {
  duration: number;
  sample(t: number): PoseFrame;
}

const SIM_HZ = 240;
const LOOKAHEAD = 0.25;
const LIFT_TIME = 0.12;
const RELEASE_TIME = 0.09;
const BLEND_IN = 0.08;
const BLEND_OUT = 0.08;
const WRIST_SPEED_CAP = 3000; // mm/s
const WRIST_OMEGA = 18; // critically damped spring, rad/s
const REST_Y = 46;
const REST_Z = 238;

const HOME_OFFSETS: Record<Hand, Record<Finger, number>> = {
  R: { 1: -32, 2: -15, 3: 0, 4: 15, 5: 30 },
  L: { 1: 32, 2: 15, 3: 0, 4: -15, 5: -30 },
};

function attackTime(velocity: number): number {
  return Math.max(0.02, 0.08 - 0.06 * velocity);
}

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** press envelope 0..1 */
function pressEnv(n: PerformanceNote, t: number): number {
  const atk = attackTime(n.velocity);
  const riseStart = n.start - 0.3 * atk;
  const riseEnd = n.start + 0.7 * atk;
  if (t < riseStart) return 0;
  if (t < riseEnd) return smoothstep((t - riseStart) / Math.max(1e-4, riseEnd - riseStart));
  if (t <= n.end) return 1;
  return 1 - smoothstep((t - n.end) / RELEASE_TIME);
}

function keyDipDepth(velocity: number): number {
  return 0.75 + 0.25 * Math.min(1, velocity * 1.4);
}

export function buildChoreoProgram(score: PerformanceScore): ChoreoProgram {
  const notes = score.notes.filter((n) => !n.disabled);
  const duration = score.duration;

  // ---- indexes ----------------------------------------------------------
  const byHandFinger = new Map<string, PerformanceNote[]>();
  const byKey: PerformanceNote[][] = Array.from({ length: KEY_COUNT }, () => []);
  const byHand: Record<Hand, PerformanceNote[]> = { L: [], R: [] };
  for (const n of notes) {
    const hf = `${n.hand}${n.finger}`;
    if (!byHandFinger.has(hf)) byHandFinger.set(hf, []);
    byHandFinger.get(hf)!.push(n);
    byKey[keyIndex(n.midi)].push(n);
    byHand[n.hand].push(n);
  }
  for (const list of byHandFinger.values()) list.sort((a, b) => a.start - b.start);
  for (const list of byKey) list.sort((a, b) => a.start - b.start);
  byHand.L.sort((a, b) => a.start - b.start);
  byHand.R.sort((a, b) => a.start - b.start);

  const pedal = score.pedal.map((p) => ({
    start: p.start,
    end: Number.isFinite(p.end) ? p.end : duration,
  }));

  // ---- simulated channels ------------------------------------------------
  const steps = Math.max(2, Math.ceil(duration * SIM_HZ) + 1);
  const ch = {
    wl: [new Float32Array(steps), new Float32Array(steps), new Float32Array(steps)],
    wr: [new Float32Array(steps), new Float32Array(steps), new Float32Array(steps)],
    eFast: new Float32Array(steps),
    eSlow: new Float32Array(steps),
    activeX: new Float32Array(steps),
  };

  simulate();

  function wristTarget(hand: Hand, t: number): { x: number; y: number; z: number; press: number } {
    const list = byHand[hand];
    let wSum = 0;
    let xSum = 0;
    let blackSum = 0;
    let press = 0;
    // notes relevant to the wrist: sounding, imminent, or just released
    const lo = lowerBound(list, t - 4); // generous window, list scan is cheap per step
    for (let i = lo; i < list.length; i++) {
      const n = list[i];
      if (n.start > t + LOOKAHEAD) break;
      let w = 0;
      if (t >= n.start && t <= n.end) w = 1;
      else if (n.start > t) w = 0.65 * (1 - (n.start - t) / LOOKAHEAD);
      else if (t - n.end < 0.2) w = 0.3 * (1 - (t - n.end) / 0.2);
      if (w <= 0) continue;
      wSum += w;
      xSum += w * (keyCenterX(n.midi) - HOME_OFFSETS[hand][n.finger]);
      blackSum += w * (isBlack(n.midi) ? 1 : 0);
      if (t >= n.start && t <= n.end) press = Math.max(press, n.velocity);
    }
    if (wSum === 0) {
      const restX = KEYBOARD_WIDTH_MM * (hand === 'L' ? 0.33 : 0.67);
      return { x: restX, y: REST_Y, z: REST_Z, press: 0 };
    }
    const blackRatio = blackSum / wSum;
    return {
      x: xSum / wSum,
      y: REST_Y - 8 * press,
      z: REST_Z - 30 * blackRatio,
      press,
    };
  }

  function simulate(): void {
    const dt = 1 / SIM_HZ;
    const state = {
      L: { p: [KEYBOARD_WIDTH_MM * 0.33, REST_Y, REST_Z], v: [0, 0, 0] },
      R: { p: [KEYBOARD_WIDTH_MM * 0.67, REST_Y, REST_Z], v: [0, 0, 0] },
    };
    let eFast = 0;
    let eSlow = 0;
    let activeX = KEYBOARD_WIDTH_MM / 2;
    let onsetCursor = 0;
    const onsets = [...notes].sort((a, b) => a.start - b.start);
    let lastOnsetHand: Hand | null = null;
    let lastOnsetAt = -10;

    const kFast = 1 - Math.exp(-dt / 0.25);
    const kSlow = 1 - Math.exp(-dt / 1.5);
    const kActive = 1 - Math.exp(-dt / 0.3);

    for (let s = 0; s < steps; s++) {
      const t = s / SIM_HZ;

      let impulse = 0;
      while (onsetCursor < onsets.length && onsets[onsetCursor].start <= t) {
        impulse += onsets[onsetCursor].velocity;
        lastOnsetHand = onsets[onsetCursor].hand;
        lastOnsetAt = onsets[onsetCursor].start;
        onsetCursor++;
      }
      eFast += kFast * (impulse * 6 - eFast);
      eSlow += kSlow * (impulse * 6 - eSlow);

      for (const hand of ['L', 'R'] as const) {
        const st = state[hand];
        const target = wristTarget(hand, t + 0.06); // slight anticipation
        const tgt = [target.x, target.y, target.z];
        for (let a = 0; a < 3; a++) {
          const acc = WRIST_OMEGA * WRIST_OMEGA * (tgt[a] - st.p[a]) - 2 * WRIST_OMEGA * st.v[a];
          st.v[a] += acc * dt;
        }
        const speed = Math.hypot(st.v[0], st.v[1], st.v[2]);
        if (speed > WRIST_SPEED_CAP) {
          const k = WRIST_SPEED_CAP / speed;
          st.v[0] *= k;
          st.v[1] *= k;
          st.v[2] *= k;
        }
        for (let a = 0; a < 3; a++) st.p[a] += st.v[a] * dt;
        const chans = hand === 'L' ? ch.wl : ch.wr;
        chans[0][s] = st.p[0];
        chans[1][s] = st.p[1];
        chans[2][s] = st.p[2];
      }

      // gaze: watch the working hand, but glance ahead to upcoming entries —
      // the closer the next strike, the harder the eyes lock onto its key
      const currentX =
        lastOnsetHand && t - lastOnsetAt < 0.5
          ? (lastOnsetHand === 'L' ? state.L.p[0] : state.R.p[0])
          : (state.L.p[0] + state.R.p[0]) / 2;
      let gazeTarget = currentX;
      const GAZE_AHEAD = 1.0;
      let wSum = 0;
      let xSum = 0;
      let nextStart = Number.POSITIVE_INFINITY;
      for (let j = onsetCursor; j < onsets.length && onsets[j].start <= t + GAZE_AHEAD; j++) {
        const w = 1 / (0.15 + (onsets[j].start - t));
        wSum += w;
        xSum += w * keyCenterX(onsets[j].midi);
        if (onsets[j].start < nextStart) nextStart = onsets[j].start;
      }
      if (wSum > 0) {
        const upX = xSum / wSum;
        const imminence = Math.min(1, Math.max(0, 1 - (nextStart - t) / GAZE_AHEAD));
        gazeTarget = lerp(currentX, upX, 0.35 + 0.55 * imminence);
      }
      activeX += kActive * (gazeTarget - activeX);

      ch.eFast[s] = eFast;
      ch.eSlow[s] = eSlow;
      ch.activeX[s] = activeX;
    }
  }

  function channel(arr: Float32Array, t: number): number {
    const x = Math.min(Math.max(t, 0), duration) * SIM_HZ;
    const i = Math.min(Math.floor(x), arr.length - 2);
    return lerp(arr[i], arr[i + 1], x - i);
  }

  // ---- analytic finger/tip evaluation ------------------------------------
  /**
   * Where an unengaged finger hovers: real pianists shape the hand over the
   * keys it is about to (or just did) play. Glide between the previous and
   * next assignment of this finger; fall back to the static spread.
   */
  function fingerHome(hand: Hand, finger: Finger, t: number, wrist: Vec3): Vec3 {
    const spread: Vec3 = {
      x: wrist.x + HOME_OFFSETS[hand][finger],
      y: wrist.y - 34,
      z: wrist.z - 118,
    };
    const list = byHandFinger.get(`${hand}${finger}`);
    if (!list || list.length === 0) return spread;

    const idx = lowerBound(list, t); // first with start >= t
    const next = list[idx];
    let prev: PerformanceNote | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].end <= t) {
        prev = list[i];
        break;
      }
      if (list[i].start <= t) return hoverOver(list[i], wrist); // engaged handled upstream
    }

    const PREP = 1.6; // seconds of anticipation
    const RELAX = 2.0; // seconds before drifting back to the spread

    if (prev && next) {
      const gap = Math.max(0.05, next.start - prev.end);
      const s = smoothstep((t - prev.end) / gap);
      const a = hoverOver(prev, wrist);
      const b = hoverOver(next, wrist);
      return { x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s), z: lerp(a.z, b.z, s) };
    }
    if (next) {
      const s = smoothstep((t - (next.start - PREP)) / PREP);
      const b = hoverOver(next, wrist);
      return { x: lerp(spread.x, b.x, s), y: lerp(spread.y, b.y, s), z: lerp(spread.z, b.z, s) };
    }
    if (prev) {
      const s = smoothstep((t - prev.end) / RELAX);
      const a = hoverOver(prev, wrist);
      return { x: lerp(a.x, spread.x, s), y: lerp(a.y, spread.y, s), z: lerp(a.z, spread.z, s) };
    }
    return spread;
  }

  function hoverOver(n: PerformanceNote, wrist: Vec3): Vec3 {
    return {
      x: keyCenterX(n.midi),
      y: keyTopY(n.midi) + 12,
      z: Math.min(contactZ(n.midi) + 6, wrist.z - 96),
    };
  }

  function fingerPose(hand: Hand, finger: Finger, t: number, wrist: Vec3): FingerPose {
    const list = byHandFinger.get(`${hand}${finger}`);
    const home = fingerHome(hand, finger, t, wrist);
    let best: PerformanceNote | null = null;
    let bestW = 0;
    if (list && list.length > 0) {
      const lo = lowerBound(list, t - 8);
      for (let i = lo; i < list.length; i++) {
        const n = list[i];
        if (n.start - (LIFT_TIME + BLEND_IN) > t) break;
        const w = engagement(n, t);
        if (w > bestW) {
          bestW = w;
          best = n;
        }
      }
    }
    if (!best || bestW <= 0) {
      return { tip: home, press: 0, curl: 0.45, splay: 0 };
    }
    const press = pressEnv(best, t);
    const atk = attackTime(best.velocity);
    const kx = keyCenterX(best.midi);
    const ktop = keyTopY(best.midi);
    const kz = contactZ(best.midi);
    // anticipatory lift before the strike
    let liftBump = 0;
    if (t < best.start - atk && t > best.start - LIFT_TIME) {
      const phase = (t - (best.start - LIFT_TIME)) / Math.max(1e-4, LIFT_TIME - atk);
      liftBump = 7 * Math.sin(Math.PI * Math.min(1, Math.max(0, phase)));
    }
    const engaged: Vec3 = {
      x: kx,
      y: ktop + 3 * (1 - press) + liftBump - press * 8,
      z: kz,
    };
    const w = bestW;
    const tip: Vec3 = {
      x: lerp(home.x, engaged.x, w),
      y: lerp(home.y, engaged.y, w),
      z: lerp(home.z, engaged.z, w),
    };
    const splay = Math.min(1, Math.max(-1, (engaged.x - home.x) / 30)) * w;
    const curl = press > 0.01 ? 0.5 - 0.15 * press : 0.45 + 0.05 * (1 - w);
    return { tip, press: press * w, curl, splay };
  }

  function engagement(n: PerformanceNote, t: number): number {
    const inStart = n.start - LIFT_TIME;
    const outEnd = n.end + RELEASE_TIME;
    if (t < inStart - BLEND_IN || t > outEnd + BLEND_OUT) return 0;
    if (t < inStart) return smoothstep((t - (inStart - BLEND_IN)) / BLEND_IN);
    if (t <= outEnd) return 1;
    return 1 - smoothstep((t - outEnd) / BLEND_OUT);
  }

  function keysAt(t: number, out: Float32Array): void {
    out.fill(0);
    for (let k = 0; k < KEY_COUNT; k++) {
      const list = byKey[k];
      if (list.length === 0) continue;
      const lo = lowerBound(list, t - 12);
      for (let i = lo; i < list.length; i++) {
        const n = list[i];
        if (n.start - 0.1 > t) break;
        const v = pressEnv(n, t) * keyDipDepth(n.velocity);
        if (v > out[k]) out[k] = v;
      }
    }
  }

  function pedalAt(t: number): number {
    let v = 0;
    for (const p of pedal) {
      const rise = smoothstep((t - p.start) / 0.08);
      const fall = 1 - smoothstep((t - p.end) / 0.08);
      v = Math.max(v, Math.min(rise, fall));
    }
    return v;
  }

  function sample(t: number): PoseFrame {
    const wristL: Vec3 = { x: channel(ch.wl[0], t), y: channel(ch.wl[1], t), z: channel(ch.wl[2], t) };
    const wristR: Vec3 = { x: channel(ch.wr[0], t), y: channel(ch.wr[1], t), z: channel(ch.wr[2], t) };
    const fingersL: FingerPose[] = [];
    const fingersR: FingerPose[] = [];
    for (let f = 1 as Finger; f <= 5; f = (f + 1) as Finger) {
      fingersL.push(fingerPose('L', f, t, wristL));
      fingersR.push(fingerPose('R', f, t, wristR));
    }
    // wrist roll toward whichever side of the hand is doing the work
    const rollOf = (hand: Hand, fingers: FingerPose[]): number => {
      let r = 0;
      for (let i = 0; i < 5; i++) {
        r += fingers[i].press * (HOME_OFFSETS[hand][(i + 1) as Finger] / 30);
      }
      return Math.min(1, Math.max(-1, r)) * 0.2;
    };
    const rollL = rollOf('L', fingersL);
    const rollR = rollOf('R', fingersR);
    const keys = new Float32Array(KEY_COUNT);
    keysAt(t, keys);

    const eFast = channel(ch.eFast, t);
    const eSlow = channel(ch.eSlow, t);
    const eNorm = Math.min(1, Math.max(0, eFast / 3));
    const centroid = (wristL.x + wristR.x) / 2;
    const activeX = channel(ch.activeX, t);
    const lift = Math.min(1, Math.max(0, (eFast - eSlow) / 2.5)) * 0.25;

    return {
      hands: {
        L: { wrist: wristL, fingers: fingersL, roll: rollL },
        R: { wrist: wristR, fingers: fingersR, roll: rollR },
      },
      body: {
        leanX: Math.min(1, Math.max(-1, (centroid - KEYBOARD_WIDTH_MM / 2) / 600)) * 0.14,
        leanZ: 0.04 + 0.1 * eNorm,
        sway: 0.055 * Math.sin(2 * Math.PI * 0.16 * t) * (0.35 + 0.65 * eNorm),
        breath: Math.sin(2 * Math.PI * 0.23 * t),
      },
      head: {
        yaw: Math.min(1, Math.max(-1, (activeX - centroid) / 500)) * 0.45,
        pitch: -0.1 - 0.1 * eNorm + lift * 0.3,
        lift,
        gazeX: activeX,
      },
      pedal: pedalAt(t),
      keys,
    };
  }

  return { duration, sample };
}

/** first index whose start >= t (lists sorted by start) */
function lowerBound(list: PerformanceNote[], t: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
