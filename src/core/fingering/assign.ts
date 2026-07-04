import { isBlack } from '../keyboard';
import type { Finger, Hand, NoteEvent } from '../types';
import { FINGER_OFFSET, spanRange } from './costs';

export type FingeringInput = NoteEvent & {
  pinned?: { hand?: Hand; finger?: Finger };
  disabled?: boolean;
};

const CHORD_WINDOW = 0.04;
const FINGERS: Finger[] = [1, 2, 3, 4, 5];

interface EvNote {
  id: string;
  /** mirrored pitch: RH = midi, LH = -midi, so "ascending" always means away from the thumb */
  p: number;
  midi: number;
  pin?: Finger;
}

interface ChordEvent {
  time: number;
  notes: EvNote[]; // sorted by p ascending
  /** notes beyond the 5-finger budget, mapped to the nearest solved note */
  overflow: Array<{ id: string; nearest: number }>;
}

/**
 * Assign fingers 1..5 to one hand's notes via Viterbi over chord events.
 * Left hand is solved in mirrored pitch space (thumb toward high notes).
 */
export function assignFingering(notes: FingeringInput[], hand: Hand): Map<string, Finger> {
  const result = new Map<string, Finger>();
  const active = notes.filter((n) => !n.disabled);
  if (active.length === 0) return result;

  const sign = hand === 'L' ? -1 : 1;
  const evNotes: Array<EvNote & { start: number }> = active
    .map((n) => ({
      id: n.id,
      p: sign * n.midi,
      midi: n.midi,
      pin: n.pinned?.finger,
      start: n.start,
    }))
    .sort((a, b) => a.start - b.start || a.p - b.p);

  const events = toEvents(evNotes);
  const combosPerEvent = events.map((e) => candidateCombos(e));

  // Viterbi
  interface Cell {
    cost: number;
    prev: number;
  }
  const table: Cell[][] = [];
  for (let e = 0; e < events.length; e++) {
    const layer: Cell[] = [];
    const combos = combosPerEvent[e];
    for (let c = 0; c < combos.length; c++) {
      const emit = emissionCost(events[e], combos[c]);
      if (e === 0) {
        layer.push({ cost: emit, prev: -1 });
        continue;
      }
      let best = Number.POSITIVE_INFINITY;
      let bestPrev = 0;
      const prevCombos = combosPerEvent[e - 1];
      const dt = Math.max(0.02, events[e].time - events[e - 1].time);
      for (let pc = 0; pc < prevCombos.length; pc++) {
        const t = table[e - 1][pc].cost + transitionCost(events[e - 1], prevCombos[pc], events[e], combos[c], dt);
        if (t < best) {
          best = t;
          bestPrev = pc;
        }
      }
      layer.push({ cost: best + emit, prev: bestPrev });
    }
    table.push(layer);
  }

  // Backtrack
  let idx = 0;
  {
    const last = table[table.length - 1];
    for (let i = 1; i < last.length; i++) if (last[i].cost < last[idx].cost) idx = i;
  }
  const chosen: Finger[][] = new Array(events.length);
  for (let e = events.length - 1; e >= 0; e--) {
    chosen[e] = combosPerEvent[e][idx];
    idx = table[e][idx].prev;
    if (idx < 0) idx = 0;
  }

  for (let e = 0; e < events.length; e++) {
    const ev = events[e];
    ev.notes.forEach((n, i) => {
      result.set(n.id, n.pin ?? chosen[e][i]);
    });
    for (const o of ev.overflow) {
      result.set(o.id, chosen[e][Math.min(o.nearest, chosen[e].length - 1)]);
    }
  }
  return result;
}

function toEvents(notes: Array<EvNote & { start: number }>): ChordEvent[] {
  const events: ChordEvent[] = [];
  let bucket: Array<EvNote & { start: number }> = [];
  let bucketTime = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (bucket.length === 0) return;
    const sorted = [...bucket].sort((a, b) => a.p - b.p);
    let solved = sorted;
    const overflow: ChordEvent['overflow'] = [];
    if (sorted.length > 5) {
      // keep 5 spread across the cluster; the rest ride along visually
      const pick = new Set<number>();
      for (let i = 0; i < 5; i++) pick.add(Math.round((i * (sorted.length - 1)) / 4));
      solved = [...pick].sort((a, b) => a - b).map((i) => sorted[i]);
      sorted.forEach((n, i) => {
        if (![...pick].includes(i)) {
          let nearest = 0;
          let bestD = Number.POSITIVE_INFINITY;
          solved.forEach((s, si) => {
            const d = Math.abs(s.p - n.p);
            if (d < bestD) {
              bestD = d;
              nearest = si;
            }
          });
          overflow.push({ id: n.id, nearest });
        }
      });
    }
    events.push({ time: bucketTime, notes: solved, overflow });
    bucket = [];
  };
  for (const n of notes) {
    if (n.start - bucketTime > CHORD_WINDOW) {
      flush();
      bucketTime = n.start;
    }
    bucket.push(n);
  }
  flush();
  return events;
}

function candidateCombos(event: ChordEvent): Finger[][] {
  const k = event.notes.length;
  const all: Finger[][] = [];
  const build = (startIdx: number, acc: Finger[]) => {
    if (acc.length === k) {
      all.push([...acc]);
      return;
    }
    for (let i = startIdx; i < FINGERS.length; i++) {
      acc.push(FINGERS[i]);
      build(i + 1, acc);
      acc.pop();
    }
  };
  build(0, []);
  const pinned = all.filter((combo) =>
    event.notes.every((n, i) => n.pin === undefined || combo[i] === n.pin),
  );
  return pinned.length > 0 ? pinned : all;
}

function emissionCost(event: ChordEvent, combo: Finger[]): number {
  let cost = 0;
  for (let i = 0; i + 1 < event.notes.length; i++) {
    const span = event.notes[i + 1].p - event.notes[i].p;
    const r = spanRange(combo[i], combo[i + 1]);
    if (span < r.min) cost += (r.min - span) * 4;
    else if (span > r.max) cost += (span - r.max) * 6 + 8;
    else if (span > r.hi) cost += (span - r.hi) * 1.2;
    else if (span < r.lo) cost += (r.lo - span) * 0.6;
  }
  for (let i = 0; i < event.notes.length; i++) {
    if (isBlack(event.notes[i].midi)) {
      if (combo[i] === 1) cost += 1.2;
      if (combo[i] === 5) cost += 0.5;
    }
    if (combo[i] === 4) cost += 0.15; // slight weak-finger aversion
  }
  return cost;
}

function transitionCost(
  prevEv: ChordEvent,
  prevCombo: Finger[],
  ev: ChordEvent,
  combo: Finger[],
  dt: number,
): number {
  let cost = 0;

  // hand-position shift, cheaper when there is time to move
  const shift = Math.abs(handPos(ev, combo) - handPos(prevEv, prevCombo));
  cost += (shift * 0.35) / Math.max(0.3, Math.min(dt, 1.2));

  const single = prevEv.notes.length === 1 && ev.notes.length === 1;
  if (single) {
    cost += melodicCost(prevEv.notes[0], prevCombo[0], ev.notes[0], combo[0]);
    return cost;
  }

  // chord-to-chord: penalize reusing a finger on a different key without time
  if (dt < 0.6) {
    for (let i = 0; i < combo.length; i++) {
      for (let j = 0; j < prevCombo.length; j++) {
        if (combo[i] === prevCombo[j] && ev.notes[i].p !== prevEv.notes[j].p) {
          const gap = Math.abs(ev.notes[i].p - prevEv.notes[j].p);
          cost += Math.min(6, 1.5 + gap * 0.3);
        }
      }
    }
  }
  return cost;
}

function melodicCost(a: EvNote, fa: Finger, b: EvNote, fb: Finger): number {
  const interval = b.p - a.p;
  if (fa === fb) return interval === 0 ? 0 : 10;

  // thumb passes
  if (fb === 1 && fa >= 2 && interval > 0) return 2 + Math.max(0, interval - 2) * 1.5;
  if (fa === 1 && fb >= 2 && interval < 0) return 2 + Math.max(0, -interval - 2) * 1.5;

  const ascendingFingers = fb > fa;
  const crossed = (ascendingFingers && interval < 0) || (!ascendingFingers && interval > 0);
  if (crossed && fa !== 1 && fb !== 1) return 14;

  const r = spanRange(fa, fb);
  const span = Math.abs(interval);
  let cost = 0;
  if (span > r.max) cost += (span - r.max) * 6 + 6;
  else if (span > r.hi) cost += (span - r.hi) * 1.5;
  else if (span < r.lo) cost += (r.lo - span) * 0.4;
  if (fb === 4) cost += 0.3;
  return cost;
}

function handPos(ev: ChordEvent, combo: Finger[]): number {
  let sum = 0;
  for (let i = 0; i < ev.notes.length; i++) sum += ev.notes[i].p - FINGER_OFFSET[combo[i]];
  return sum / ev.notes.length;
}
