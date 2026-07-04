import type { Finger } from '../types';

/**
 * Parncutt-style comfortable-span table, semitones, for an ordered finger
 * pair (lower finger number first, i.e. thumb-side first). `min` allows
 * negative values where the thumb can pass under.
 */
export interface SpanRange {
  min: number;
  lo: number;
  hi: number;
  max: number;
}

const SPANS: Record<string, SpanRange> = {
  '1,2': { min: -3, lo: 1, hi: 5, max: 10 },
  '1,3': { min: -2, lo: 3, hi: 7, max: 12 },
  '1,4': { min: -1, lo: 5, hi: 9, max: 13 },
  '1,5': { min: 1, lo: 7, hi: 10, max: 15 },
  '2,3': { min: 1, lo: 1, hi: 3, max: 5 },
  '2,4': { min: 1, lo: 3, hi: 5, max: 7 },
  '2,5': { min: 2, lo: 5, hi: 7, max: 10 },
  '3,4': { min: 1, lo: 1, hi: 2, max: 4 },
  '3,5': { min: 1, lo: 3, hi: 4, max: 7 },
  '4,5': { min: 1, lo: 1, hi: 2, max: 4 },
};

export function spanRange(fa: Finger, fb: Finger): SpanRange {
  const lo = Math.min(fa, fb);
  const hi = Math.max(fa, fb);
  return SPANS[`${lo},${hi}`] ?? { min: 0, lo: 0, hi: 0, max: 0 };
}

export function maxSpanSemitones(fa: Finger, fb: Finger): number {
  return spanRange(fa, fb).max;
}

/** Typical lateral reach of each finger relative to the thumb, semitones. */
export const FINGER_OFFSET: Record<Finger, number> = { 1: 0, 2: 2, 3: 3.5, 4: 5, 5: 7 };
