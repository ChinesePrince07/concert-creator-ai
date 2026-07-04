import { describe, expect, it } from 'vitest';
import type { Hand, NoteEvent } from '../types';
import { assignHands } from './split';

let seq = 0;
function note(midi: number, start: number, dur = 0.4, velocity = 0.6): NoteEvent {
  return { id: `t${seq++}`, midi, start, end: start + dur, velocity };
}

describe('assignHands', () => {
  it('keeps a melody over an Alberti bass separated into R and L', () => {
    seq = 0;
    const notes: NoteEvent[] = [];
    const bassPattern = [36, 43, 40, 43]; // C2 G2 E2 G2
    const melody = [72, 74, 76, 77, 79, 77, 76, 74]; // C5..G5..
    for (let i = 0; i < 16; i++) notes.push(note(bassPattern[i % 4], i * 0.25, 0.22));
    for (let i = 0; i < 8; i++) notes.push(note(melody[i], i * 0.5, 0.45));
    const hands = assignHands(notes);
    for (const n of notes) {
      const expected: Hand = n.midi >= 72 ? 'R' : 'L';
      expect(hands.get(n.id), `note ${n.midi}@${n.start}`).toBe(expected);
    }
  });

  it('splits a wide four-note chord two and two', () => {
    seq = 0;
    const notes = [note(36, 0), note(40, 0), note(72, 0), note(76, 0)];
    const hands = assignHands(notes);
    expect(hands.get(notes[0].id)).toBe('L');
    expect(hands.get(notes[1].id)).toBe('L');
    expect(hands.get(notes[2].id)).toBe('R');
    expect(hands.get(notes[3].id)).toBe('R');
  });

  it('never assigns a simultaneous span wider than a 10th to one hand when splittable', () => {
    seq = 0;
    // C3 + E3 + C5 + G5 — naive one-hand grouping would need a 19th
    const notes = [note(48, 0), note(52, 0), note(84, 0), note(91, 0)];
    const hands = assignHands(notes);
    const l = notes.filter((n) => hands.get(n.id) === 'L').map((n) => n.midi);
    const r = notes.filter((n) => hands.get(n.id) === 'R').map((n) => n.midi);
    expect(Math.max(...l) - Math.min(...l)).toBeLessThanOrEqual(16);
    expect(Math.max(...r) - Math.min(...r)).toBeLessThanOrEqual(16);
  });

  it('keeps a single mid-register line in one stable hand', () => {
    seq = 0;
    const line = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65];
    const notes = line.map((m, i) => note(m, i * 0.3, 0.28));
    const hands = assignHands(notes);
    const assigned = new Set(notes.map((n) => hands.get(n.id)));
    expect(assigned.size).toBe(1);
  });

  it('honors full-coverage hand hints exactly (two-track ground truth)', () => {
    seq = 0;
    // deliberately "wrong-looking" hints: low note to R, high to L (crossed hands)
    const a = note(40, 0);
    const b = note(80, 0);
    const hints = new Map<string, Hand>([
      [a.id, 'R'],
      [b.id, 'L'],
    ]);
    const hands = assignHands([a, b], hints);
    expect(hands.get(a.id)).toBe('R');
    expect(hands.get(b.id)).toBe('L');
  });

  it('assigns every note', () => {
    seq = 0;
    const notes: NoteEvent[] = [];
    for (let i = 0; i < 60; i++) notes.push(note(30 + ((i * 7) % 60), i * 0.11, 0.1));
    const hands = assignHands(notes);
    for (const n of notes) expect(hands.get(n.id)).toBeDefined();
  });
});
