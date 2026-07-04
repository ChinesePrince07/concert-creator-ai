import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { importMidi } from './importer';

function twoHandMidi(): ArrayBuffer {
  const midi = new Midi();
  const rh = midi.addTrack();
  rh.name = 'right';
  rh.addNote({ midi: 72, time: 0, duration: 0.5, velocity: 0.8 }); // C5
  rh.addNote({ midi: 76, time: 0.5, duration: 0.5, velocity: 0.7 }); // E5
  const lh = midi.addTrack();
  lh.name = 'left';
  lh.addNote({ midi: 36, time: 0, duration: 1, velocity: 0.6 }); // C2
  lh.addNote({ midi: 43, time: 0.5, duration: 0.5, velocity: 0.5 }); // G2
  return midi.toArray().buffer as ArrayBuffer;
}

describe('importMidi', () => {
  it('imports notes sorted by start then pitch with sequential ids and 0..1 velocities', () => {
    const score = importMidi(twoHandMidi());
    expect(score.notes.length).toBe(4);
    expect(score.notes.map((n) => n.midi)).toEqual([36, 72, 43, 76]);
    expect(score.notes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3']);
    for (const n of score.notes) {
      expect(n.velocity).toBeGreaterThan(0);
      expect(n.velocity).toBeLessThanOrEqual(1);
      expect(n.end).toBeGreaterThan(n.start);
    }
  });

  it('derives hand hints from two melodic tracks by mean pitch', () => {
    const score = importMidi(twoHandMidi());
    expect(score.handHints).toBeDefined();
    const hands = score.notes.map((n) => score.handHints!.get(n.id));
    expect(hands).toEqual(['L', 'R', 'L', 'R']);
  });

  it('gives no hand hints for single-track files', () => {
    const midi = new Midi();
    const t = midi.addTrack();
    t.addNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.5 });
    const score = importMidi(midi.toArray().buffer as ArrayBuffer);
    expect(score.handHints).toBeUndefined();
  });

  it('drops notes outside the 88-key range and enforces minimum duration', () => {
    const midi = new Midi();
    const t = midi.addTrack();
    t.addNote({ midi: 15, time: 0, duration: 0.5, velocity: 0.5 }); // below A0
    t.addNote({ midi: 112, time: 0, duration: 0.5, velocity: 0.5 }); // above C8
    t.addNote({ midi: 60, time: 1, duration: 0.004, velocity: 0.5 }); // 4ms blip
    const score = importMidi(midi.toArray().buffer as ArrayBuffer);
    expect(score.notes.length).toBe(1);
    expect(score.notes[0].midi).toBe(60);
    expect(score.notes[0].end - score.notes[0].start).toBeGreaterThanOrEqual(0.03);
  });

  it('truncates same-pitch overlaps (a key cannot be re-struck while held)', () => {
    const midi = new Midi();
    const t = midi.addTrack();
    t.addNote({ midi: 60, time: 0, duration: 2, velocity: 0.5 });
    t.addNote({ midi: 60, time: 0.8, duration: 0.5, velocity: 0.5 });
    const score = importMidi(midi.toArray().buffer as ArrayBuffer);
    expect(score.notes.length).toBe(2);
    expect(score.notes[0].end).toBeCloseTo(0.8, 3);
  });

  it('collapses simultaneous same-pitch duplicates keeping the louder strike', () => {
    const midi = new Midi();
    const a = midi.addTrack();
    a.addNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.4 });
    const b = midi.addTrack();
    b.addNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.9 });
    b.addNote({ midi: 64, time: 1, duration: 0.5, velocity: 0.9 });
    const score = importMidi(midi.toArray().buffer as ArrayBuffer);
    const c4s = score.notes.filter((n) => n.midi === 60);
    expect(c4s.length).toBe(1);
    expect(c4s[0].velocity).toBeCloseTo(0.9, 2);
  });

  it('extracts sustain pedal spans from CC64', () => {
    const midi = new Midi();
    const t = midi.addTrack();
    t.addNote({ midi: 60, time: 0, duration: 3, velocity: 0.5 });
    t.addCC({ number: 64, value: 1, time: 0.5 });
    t.addCC({ number: 64, value: 0, time: 1.5 });
    t.addCC({ number: 64, value: 1, time: 2.0 });
    t.addCC({ number: 64, value: 0, time: 2.5 });
    const score = importMidi(midi.toArray().buffer as ArrayBuffer);
    expect(score.pedal.length).toBe(2);
    expect(score.pedal[0].start).toBeCloseTo(0.5, 2);
    expect(score.pedal[0].end).toBeCloseTo(1.5, 2);
    expect(score.pedal[1].start).toBeCloseTo(2.0, 2);
    expect(score.pedal[1].end).toBeCloseTo(2.5, 2);
  });
});
