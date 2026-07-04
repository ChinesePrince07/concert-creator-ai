import type { PerformanceScore } from '../types';

export type ShotType =
  | 'WIDE_DOLLY'
  | 'SIDE_LOW'
  | 'CLOSE_HANDS'
  | 'TOP_DOWN'
  | 'FIRST_PERSON'
  | 'ORBIT'
  | 'LID';

export interface Shot {
  type: ShotType;
  start: number;
  end: number;
  /** per-shot variation seed for camera micro-movement */
  seed: number;
}

export interface ShotPlan {
  shots: Shot[];
}

export interface PlanOptions {
  seed?: number;
  minShot?: number;
  maxShot?: number;
}

/** deterministic PRNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planShots(score: PerformanceScore, opts: PlanOptions = {}): ShotPlan {
  const seed = opts.seed ?? 1;
  const minShot = opts.minShot ?? 4;
  const maxShot = opts.maxShot ?? 11;
  const rng = mulberry32(seed * 2654435761 + 1);
  const duration = score.duration;

  // ---- cut points: phrase starts, respecting min/max shot lengths --------
  const candidates = score.phrases.map((p) => p.start).filter((t) => t > 0 && t < duration);
  const cuts: number[] = [0];
  let last = 0;
  for (const c of candidates) {
    while (c - last > maxShot) {
      last = last + maxShot * (0.72 + 0.2 * rng());
      if (c - last < minShot) break;
      cuts.push(last);
    }
    if (c - last >= minShot && duration - c >= 2) {
      cuts.push(c);
      last = c;
    }
  }
  while (duration - last > maxShot) {
    const next = last + maxShot * (0.7 + 0.25 * rng());
    if (duration - next < 2) break;
    cuts.push(next);
    last = next;
  }

  // ---- densities per prospective shot ------------------------------------
  const onsets = score.notes
    .filter((n) => !n.disabled)
    .map((n) => n.start)
    .sort((a, b) => a - b);
  const densityIn = (a: number, b: number): number => {
    let lo = 0;
    let hi = onsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (onsets[mid] < a) lo = mid + 1;
      else hi = mid;
    }
    let count = 0;
    for (let i = lo; i < onsets.length && onsets[i] < b; i++) count++;
    return count / Math.max(0.5, b - a);
  };

  // ---- assign shot types --------------------------------------------------
  const shots: Shot[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i];
    const end = i + 1 < cuts.length ? cuts[i + 1] : duration;
    const density = densityIn(start, end);
    const prevType = shots[shots.length - 1]?.type;
    let type: ShotType;
    if (i === 0) {
      type = 'WIDE_DOLLY';
    } else {
      type = pick(weightsFor(density), prevType, rng);
    }
    shots.push({ type, start, end, seed: Math.floor(rng() * 1e9) });
  }
  return { shots };
}

function weightsFor(density: number): Array<[ShotType, number]> {
  if (density > 8) {
    return [
      ['TOP_DOWN', 3],
      ['CLOSE_HANDS', 3],
      ['FIRST_PERSON', 2],
    ];
  }
  if (density > 4) {
    return [
      ['CLOSE_HANDS', 3],
      ['SIDE_LOW', 2],
      ['TOP_DOWN', 2],
      ['ORBIT', 1],
      ['WIDE_DOLLY', 1],
    ];
  }
  return [
    ['SIDE_LOW', 3],
    ['ORBIT', 2],
    ['CLOSE_HANDS', 2],
    ['LID', 1],
    ['WIDE_DOLLY', 1],
  ];
}

function pick(
  weights: Array<[ShotType, number]>,
  exclude: ShotType | undefined,
  rng: () => number,
): ShotType {
  const usable = weights.filter(([t]) => t !== exclude);
  const pool = usable.length > 0 ? usable : weights;
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [t, w] of pool) {
    r -= w;
    if (r <= 0) return t;
  }
  return pool[pool.length - 1][0];
}
