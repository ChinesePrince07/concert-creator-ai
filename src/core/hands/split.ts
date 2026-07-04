import type { Hand, NoteEvent } from '../types';

/**
 * Left/right hand separation.
 *
 * Notes are grouped into onset slices; within a slice (sorted by pitch) only
 * contiguous splits are considered — bottom k notes to the left hand — and a
 * Viterbi pass over slices picks the split sequence minimizing movement,
 * span, crossing and separation costs. Full-coverage hints (two-track MIDI)
 * bypass the solver: they are ground truth.
 */

const SLICE_WINDOW = 0.06;
const DEFAULT_L_CENTROID = 50;
const DEFAULT_R_CENTROID = 71;
const EMA_ALPHA = 0.25;

interface Slice {
  time: number;
  notes: NoteEvent[]; // sorted by pitch asc
}

type Occupancy = 'L' | 'R' | 'both' | null;

interface PathState {
  cost: number;
  prev: number; // index of predecessor state in previous slice
  centroidL: number | null;
  centroidR: number | null;
  lastActive: Occupancy;
}

export function assignHands(
  notes: NoteEvent[],
  hints?: Map<string, Hand>,
): Map<string, Hand> {
  const result = new Map<string, Hand>();
  if (notes.length === 0) return result;

  // Ground-truth path: hints covering (nearly) all notes.
  if (hints && hints.size >= notes.length * 0.9) {
    let cL = DEFAULT_L_CENTROID;
    let cR = DEFAULT_R_CENTROID;
    for (const n of [...notes].sort((a, b) => a.start - b.start)) {
      let hand = hints.get(n.id);
      if (!hand) hand = Math.abs(n.midi - cL) <= Math.abs(n.midi - cR) ? 'L' : 'R';
      if (hand === 'L') cL = cL + EMA_ALPHA * (n.midi - cL);
      else cR = cR + EMA_ALPHA * (n.midi - cR);
      result.set(n.id, hand);
    }
    return result;
  }

  const slices = toSlices(notes);
  const layers: PathState[][] = [];

  for (let s = 0; s < slices.length; s++) {
    const slice = slices[s];
    const n = slice.notes.length;
    const layer: PathState[] = [];
    const prevLayer = layers[s - 1];
    const prevTime = s > 0 ? slices[s - 1].time : slice.time;
    const dt = Math.max(0.05, slice.time - prevTime);

    for (let k = 0; k <= n; k++) {
      // hint consistency: L-hinted notes must be in bottom k, R-hinted above
      if (!splitRespectesHints(slice.notes, k, hints)) continue;
      const lNotes = slice.notes.slice(0, k);
      const rNotes = slice.notes.slice(k);
      let best: PathState | null = null;

      const occupancy: Occupancy =
        lNotes.length > 0 && rNotes.length > 0 ? 'both' : lNotes.length > 0 ? 'L' : rNotes.length > 0 ? 'R' : null;
      const candidates = prevLayer ?? [
        { cost: 0, prev: -1, centroidL: null, centroidR: null, lastActive: null } satisfies PathState,
      ];
      for (let p = 0; p < candidates.length; p++) {
        const prev = candidates[p];
        const cost = prev.cost + sliceCost(lNotes, rNotes, prev, dt);
        if (!best || cost < best.cost) {
          best = {
            cost,
            prev: p,
            centroidL: nextCentroid(prev.centroidL, lNotes),
            centroidR: nextCentroid(prev.centroidR, rNotes),
            lastActive: occupancy ?? prev.lastActive,
          };
        }
      }
      if (best) layer.push(best);
      else layer.push({ cost: Number.POSITIVE_INFINITY, prev: 0, centroidL: null, centroidR: null, lastActive: null });
      // remember which k this state is: index in layer === k only if none skipped;
      // guard by storing k on the state via array position mapping below.
    }
    // If every k was hint-inconsistent (shouldn't happen), allow all splits unconstrained.
    if (layer.length === 0) {
      for (let k = 0; k <= n; k++) {
        const lNotes = slice.notes.slice(0, k);
        const rNotes = slice.notes.slice(k);
        const prev =
          prevLayer?.[0] ?? { cost: 0, prev: -1, centroidL: null, centroidR: null, lastActive: null as Occupancy };
        layer.push({
          cost: prev.cost + sliceCost(lNotes, rNotes, prev, dt),
          prev: 0,
          centroidL: nextCentroid(prev.centroidL, lNotes),
          centroidR: nextCentroid(prev.centroidR, rNotes),
          lastActive:
            lNotes.length > 0 && rNotes.length > 0 ? 'both' : lNotes.length > 0 ? 'L' : rNotes.length > 0 ? 'R' : prev.lastActive,
        });
      }
    }
    layers.push(layer);
  }

  // Backtrack. Layer index → k is positional only when no k was skipped, so
  // recompute the k list per slice the same way the forward pass did.
  const kLists = slices.map((slice) => {
    const n = slice.notes.length;
    const ks: number[] = [];
    for (let k = 0; k <= n; k++) if (splitRespectesHints(slice.notes, k, hints)) ks.push(k);
    if (ks.length === 0) for (let k = 0; k <= n; k++) ks.push(k);
    return ks;
  });

  let stateIdx = argmin(layers[layers.length - 1].map((st) => st.cost));
  for (let s = slices.length - 1; s >= 0; s--) {
    const k = kLists[s][stateIdx] ?? 0;
    const slice = slices[s];
    slice.notes.forEach((noteEv, i) => result.set(noteEv.id, i < k ? 'L' : 'R'));
    stateIdx = layers[s][stateIdx]?.prev ?? 0;
    if (stateIdx < 0) stateIdx = 0;
  }
  return result;
}

function toSlices(notes: NoteEvent[]): Slice[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const slices: Slice[] = [];
  for (const n of sorted) {
    const current = slices[slices.length - 1];
    if (current && n.start - current.time <= SLICE_WINDOW) current.notes.push(n);
    else slices.push({ time: n.start, notes: [n] });
  }
  for (const s of slices) s.notes.sort((a, b) => a.midi - b.midi);
  return slices;
}

function splitRespectesHints(
  notesByPitch: NoteEvent[],
  k: number,
  hints?: Map<string, Hand>,
): boolean {
  if (!hints || hints.size === 0) return true;
  for (let i = 0; i < notesByPitch.length; i++) {
    const h = hints.get(notesByPitch[i].id);
    if (!h) continue;
    if (i < k && h === 'R') return false;
    if (i >= k && h === 'L') return false;
  }
  return true;
}

function nextCentroid(prev: number | null, sliceNotes: NoteEvent[]): number | null {
  if (sliceNotes.length === 0) return prev;
  const mean = sliceNotes.reduce((s, n) => s + n.midi, 0) / sliceNotes.length;
  if (prev === null) return mean;
  return prev + EMA_ALPHA * (mean - prev);
}

function sliceCost(
  lNotes: NoteEvent[],
  rNotes: NoteEvent[],
  prev: PathState,
  dt: number,
): number {
  let cost = 0;
  cost += spanPenalty(lNotes) + spanPenalty(rNotes);

  // voice continuity: a monophonic run should not ping-pong between hands
  const occupancy: Occupancy =
    lNotes.length > 0 && rNotes.length > 0 ? 'both' : lNotes.length > 0 ? 'L' : rNotes.length > 0 ? 'R' : null;
  if (
    occupancy !== null &&
    occupancy !== 'both' &&
    prev.lastActive !== null &&
    prev.lastActive !== 'both' &&
    prev.lastActive !== occupancy &&
    dt < 0.35
  ) {
    cost += 5;
  }

  // crossing: left hand's top above right hand's bottom
  if (lNotes.length > 0 && rNotes.length > 0) {
    const overlap = lNotes[lNotes.length - 1].midi - rNotes[0].midi;
    if (overlap > 0) cost += 20 * overlap;
    // separation prior: hands like breathing room
    const sep = mean(rNotes) - mean(lNotes);
    if (sep < 7) cost += (7 - sep) * 2;
  }

  const cL = prev.centroidL ?? DEFAULT_L_CENTROID;
  const cR = prev.centroidR ?? DEFAULT_R_CENTROID;

  // distance from running centroid (register affinity)
  for (const n of lNotes) cost += Math.abs(n.midi - cL) * 0.15;
  for (const n of rNotes) cost += Math.abs(n.midi - cR) * 0.15;

  // movement speed between slices
  if (lNotes.length > 0 && prev.centroidL !== null) {
    const v = Math.abs(mean(lNotes) - prev.centroidL) / dt;
    cost += Math.min(30, 0.015 * v * v);
  }
  if (rNotes.length > 0 && prev.centroidR !== null) {
    const v = Math.abs(mean(rNotes) - prev.centroidR) / dt;
    cost += Math.min(30, 0.015 * v * v);
  }
  return cost;
}

function spanPenalty(sliceNotes: NoteEvent[]): number {
  if (sliceNotes.length < 2) return 0;
  const span = sliceNotes[sliceNotes.length - 1].midi - sliceNotes[0].midi;
  if (span <= 14) return 0;
  return (span - 14) * (span <= 17 ? 8 : 30);
}

function mean(ns: NoteEvent[]): number {
  return ns.reduce((s, n) => s + n.midi, 0) / ns.length;
}

function argmin(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[best]) best = i;
  return best;
}
