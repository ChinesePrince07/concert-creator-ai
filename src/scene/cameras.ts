import * as THREE from 'three';
import type { Shot, ShotPlan, ShotType } from '../core/cinema/planner';

export type CameraMode = 'AUTO' | 'SIDE' | 'TOP' | 'FP' | 'CLOSE' | 'ORBIT';

export interface CameraContext {
  /** world-space point between the hands, biased toward the active one */
  activeCenter: THREE.Vector3;
  /** overall performance energy 0..1 */
  energy: number;
  /** the avatar's animated eye pose — when present, first-person rides the head */
  eye?: { pos: THREE.Vector3; up: THREE.Vector3 };
  /** world-space point the AI gaze is looking at (anticipates upcoming notes) */
  gazePoint?: THREE.Vector3;
}

export interface CameraState {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  focus: number;
  /** camera roll reference; undefined = world up */
  up?: THREE.Vector3;
}

function seededPhases(seed: number): number[] {
  let a = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    a = (a * 1664525 + 1013904223) >>> 0;
    out.push((a / 4294967296) * Math.PI * 2);
  }
  return out;
}

const _drift = new THREE.Vector3();

function drift(t: number, phases: number[], amp: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(
    Math.sin(t * 0.42 + phases[0]) * amp + Math.sin(t * 0.11 + phases[1]) * amp * 1.6,
    Math.sin(t * 0.35 + phases[2]) * amp * 0.7 + Math.sin(t * 0.09 + phases[3]) * amp,
    Math.sin(t * 0.5 + phases[4]) * amp * 0.5,
  );
  return out;
}

function ease(p: number): number {
  return p * p * (3 - 2 * p);
}

export function evaluateShot(shot: Shot, t: number, ctx: CameraContext, state: CameraState): void {
  const dur = Math.max(1e-3, shot.end - shot.start);
  const p = THREE.MathUtils.clamp((t - shot.start) / dur, 0, 1);
  const phases = seededPhases(shot.seed);
  const ax = THREE.MathUtils.clamp(ctx.activeCenter.x, -0.58, 0.58);

  evalType(shot.type);

  drift(t, phases, 0.014, _drift);
  state.pos.add(_drift);
  state.target.addScaledVector(_drift, 0.25);
  state.focus = state.pos.distanceTo(state.target);

  // Calibrated to the seated performer: head (0,1.14,0.48), hands (0,0.78,0.24),
  // keyboard (0,0.735,0.1), bench z 0.5; pianist faces -z, +x is his right
  // (treble), audience/front is +z. See stage.ts for the world layout.
  function evalType(type: ShotType): void {
    switch (type) {
      case 'WIDE_DOLLY': {
        // hero establishing from the treble side: face lit, whole grand sweeping
        // away to frame-right, slow push-in. (An audience/+z angle only shows his
        // back — the flattering views are from the keyboard ends.)
        const k = ease(p);
        state.pos.set(2.72 - 0.32 * k, 1.55 - 0.07 * k, 1.22 - 0.16 * k);
        state.target.set(-0.05, 0.9, 0.05);
        state.fov = 40;
        break;
      }
      case 'SIDE_LOW': {
        // left-side profile, low, looking across the keys toward the treble
        state.pos.set(-2.4 + p * 0.18, 1.05, 1.05 - p * 0.12);
        state.target.set(0.28, 0.85, 0.24);
        state.fov = 33;
        break;
      }
      case 'CLOSE_HANDS': {
        // intimate 3/4 from the treble end: the player's face and hands at the
        // keys (a macro would only expose the low-poly hands — this flatters them)
        state.pos.set(ax * 0.15 + 1.22, 1.0, 0.44);
        state.target.set(ax * 0.3 - 0.16, 0.82, 0.2);
        state.fov = 41;
        break;
      }
      case 'TOP_DOWN': {
        // high three-quarter looking down the keyboard and the player's hands
        state.pos.set(ax * 0.4, 1.92, 0.62);
        state.target.set(ax * 0.4, 0.76, 0.02);
        state.fov = 40;
        break;
      }
      case 'FIRST_PERSON': {
        if (ctx.eye && ctx.gazePoint) {
          state.pos.copy(ctx.eye.pos);
          state.target.copy(ctx.gazePoint);
          state.up = ctx.eye.up;
          state.fov = 50;
        } else {
          state.pos.set(0.0, 1.5, 0.6);
          state.target.set(ax * 0.5, 0.78, 0.02);
          state.fov = 52;
        }
        break;
      }
      case 'ORBIT': {
        // sweep across the audience side only — never dips behind the raised lid
        const a = Math.PI * (0.3 + 0.32 * ease(p));
        const r = 3.0;
        state.pos.set(Math.cos(a) * r * 1.05, 1.36, Math.sin(a) * r + 0.1);
        state.target.set(0, 0.9, -0.05);
        state.fov = 36;
        break;
      }
      case 'LID': {
        // bass-side glamour: the open lid and its warm glow sweep frame-left, the
        // player in profile frame-right
        const k = ease(p);
        state.pos.set(-2.6 + 0.16 * k, 1.5 - 0.05 * k, 1.15 - 0.14 * k);
        state.target.set(0.2, 0.9, 0.05);
        state.fov = 40;
        break;
      }
    }
  }
}

const FALLBACK_SHOT: Shot = { type: 'WIDE_DOLLY', start: 0, end: 3600, seed: 7 };

export function evaluateCamera(
  mode: CameraMode,
  plan: ShotPlan | null,
  t: number,
  ctx: CameraContext,
  state: CameraState,
): void {
  state.up = undefined;
  if (mode === 'AUTO') {
    const shots = plan?.shots ?? [];
    let shot: Shot = FALLBACK_SHOT;
    for (let i = 0; i < shots.length; i++) {
      if (t >= shots[i].start && t < shots[i].end) {
        shot = shots[i];
        break;
      }
      if (i === shots.length - 1 && t >= shots[i].end) shot = shots[i];
    }
    evaluateShot(shot, t, ctx, state);
    return;
  }
  const ax = THREE.MathUtils.clamp(ctx.activeCenter.x, -0.58, 0.58);
  switch (mode) {
    case 'SIDE':
      evaluateShot({ type: 'SIDE_LOW', start: 0, end: 3600, seed: 11 }, t, ctx, state);
      break;
    case 'CLOSE':
      evaluateShot({ type: 'CLOSE_HANDS', start: 0, end: 3600, seed: 12 }, t, ctx, state);
      break;
    case 'TOP': {
      // classic Synthesia framing: telephoto front-on, keys flat and low
      state.pos.set(0, 1.56, 1.5);
      state.target.set(0, 0.77, -0.04);
      state.fov = 25;
      state.focus = state.pos.distanceTo(state.target);
      break;
    }
    case 'FP': {
      // through the pianist's own eyes — the camera IS the animated head
      if (ctx.eye && ctx.gazePoint) {
        state.pos.copy(ctx.eye.pos);
        state.target.copy(ctx.gazePoint);
        state.up = ctx.eye.up;
        state.fov = 56;
      } else {
        state.pos.set(0.01, 1.53, 0.5);
        state.target.set(ax * 0.35, 0.8, -0.28);
        state.fov = 58;
      }
      state.focus = state.pos.distanceTo(state.target);
      break;
    }
    case 'ORBIT': {
      const az = t * ((Math.PI * 2) / 44);
      state.pos.set(Math.sin(az) * 3.3, 1.46, Math.cos(az) * 3.3 + 0.1);
      state.target.set(0, 0.92, -0.05);
      state.fov = 36;
      state.focus = state.pos.distanceTo(state.target);
      break;
    }
    default:
      break;
  }
}
