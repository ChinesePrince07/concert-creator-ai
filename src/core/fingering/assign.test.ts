import { describe, expect, it } from 'vitest';
import type { Hand, NoteEvent } from '../types';
import { assignFingering, type FingeringInput } from './assign';
import { maxSpanSemitones } from './costs';

let seq = 0;
function note(midi: number, start: number, dur = 0.25, extra: Partial<FingeringInput> = {}): FingeringInput {
  return { id: `f${seq++}`, midi, start, end: start + dur, velocity: 0.6, ...extra };
}

function scale(hand: Hand, startMidi: number, steps: number[], t0 = 0, dt = 0.25): FingeringInput[] {
  const notes: FingeringInput[] = [];
  let m = startMidi;
  notes.push(note(m, t0));
  steps.forEach((s, i) => {
    m += s;
    notes.push(note(m, t0 + (i + 1) * dt));
  });
  return notes;
}

const MAJOR_UP = [2, 2, 1, 2, 2, 2, 1];

describe('assignFingering', () => {
  it('fingers a two-octave RH C-major scale with legal transitions and thumb passages', () => {
    seq = 0;
    const notes = scale('R', 60, [...MAJOR_UP, ...MAJOR_UP]);
    const fingers = assignFingering(notes, 'R');
    expect(fingers.size).toBe(notes.length);

    let thumbPassages = 0;
    for (let i = 0; i < notes.length - 1; i++) {
      const fa = fingers.get(notes[i].id)!;
      const fb = fingers.get(notes[i + 1].id)!;
      const interval = notes[i + 1].midi - notes[i].midi;
      expect(fa).toBeGreaterThanOrEqual(1);
      expect(fa).toBeLessThanOrEqual(5);
      // no same finger on two different consecutive keys
      expect(fa === fb && interval !== 0, `repeat finger ${fa} at step ${i}`).toBe(false);
      if (fb === 1 && fa >= 2 && interval > 0) thumbPassages++;
      // transitions involving distinct non-thumb fingers must respect stretch limits
      if (fa !== 1 && fb !== 1) {
        expect(Math.abs(interval)).toBeLessThanOrEqual(maxSpanSemitones(fa, fb) + 2);
      }
    }
    expect(thumbPassages).toBeGreaterThanOrEqual(1);
  });

  it('fingers an RH C-major triad order-preserving with the thumb on the bottom', () => {
    seq = 0;
    const notes = [note(60, 0, 1), note(64, 0, 1), note(67, 0, 1)];
    const fingers = assignFingering(notes, 'R');
    const f = notes.map((n) => fingers.get(n.id)!);
    expect(f[0]).toBe(1);
    expect(f[1]).toBeGreaterThan(f[0]);
    expect(f[2]).toBeGreaterThan(f[1]);
  });

  it('fingers an LH triad mirrored: thumb on the top note', () => {
    seq = 0;
    const notes = [note(36, 0, 1), note(40, 0, 1), note(43, 0, 1)];
    const fingers = assignFingering(notes, 'L');
    const f = notes.map((n) => fingers.get(n.id)!);
    expect(f[2]).toBe(1);
    expect(f[0]).toBeGreaterThan(f[1]);
    expect(f[1]).toBeGreaterThan(f[2]);
  });

  it('honors pinned fingers as hard constraints', () => {
    seq = 0;
    const notes = [note(60, 0, 1), note(64, 0, 1, { pinned: { finger: 3 } }), note(67, 0, 1)];
    const fingers = assignFingering(notes, 'R');
    expect(fingers.get(notes[1].id)).toBe(3);
    expect(fingers.get(notes[0].id)!).toBeLessThan(3);
    expect(fingers.get(notes[2].id)!).toBeGreaterThan(3);
  });

  it('survives wide leaps and dense input without crashing, assigning every note', () => {
    seq = 0;
    const notes: FingeringInput[] = [];
    for (let i = 0; i < 120; i++) {
      notes.push(note(48 + ((i * 13) % 36), i * 0.09, 0.08));
    }
    const fingers = assignFingering(notes, 'R');
    expect(fingers.size).toBe(notes.length);
    for (const n of notes) expect(fingers.get(n.id)).toBeDefined();
  });

  it('skips disabled notes', () => {
    seq = 0;
    const on = note(60, 0);
    const off = note(64, 0.5, 0.25, { disabled: true });
    const fingers = assignFingering([on, off], 'R');
    expect(fingers.get(on.id)).toBeDefined();
    expect(fingers.has(off.id)).toBe(false);
  });
});
