import { describe, expect, it } from 'vitest';
import { keyCenterX, keyIndex } from '../keyboard';
import type { PerformanceNote, PerformanceScore } from '../types';
import { detectPhrases } from './phrases';
import { buildChoreoProgram } from './program';

let seq = 0;
function pnote(
  midi: number,
  start: number,
  dur: number,
  hand: 'L' | 'R',
  finger: 1 | 2 | 3 | 4 | 5,
  velocity = 0.6,
): PerformanceNote {
  return { id: `c${seq++}`, midi, start, end: start + dur, velocity, hand, finger };
}

function makeScore(notes: PerformanceNote[], pedal: PerformanceScore['pedal'] = []): PerformanceScore {
  const duration = Math.max(...notes.map((n) => n.end), 0) + 1.5;
  return { name: 'test', notes, duration, pedal, phrases: detectPhrases(notes) };
}

describe('buildChoreoProgram', () => {
  it('puts the assigned fingertip on the key at every onset and dips the key', () => {
    seq = 0;
    const notes = [
      pnote(60, 1.0, 0.6, 'R', 1),
      pnote(64, 2.0, 0.6, 'R', 2),
      pnote(48, 1.5, 0.8, 'L', 1),
    ];
    const program = buildChoreoProgram(makeScore(notes));
    for (const n of notes) {
      const frame = program.sample(n.start + 0.01);
      const tip = frame.hands[n.hand].fingers[n.finger - 1].tip;
      expect(Math.abs(tip.x - keyCenterX(n.midi)), `finger x for midi ${n.midi}`).toBeLessThanOrEqual(6);
      const dipped = program.sample(n.start + 0.06);
      expect(dipped.keys[keyIndex(n.midi)]).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('is a pure function of time', () => {
    seq = 0;
    const program = buildChoreoProgram(makeScore([pnote(72, 0.5, 1, 'R', 3)]));
    const a = program.sample(0.75);
    const b = program.sample(0.75);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // and sampling out of order does not change results
    program.sample(2.0);
    const c = program.sample(0.75);
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });

  it('never produces NaN and caps wrist speed at 3 m/s', () => {
    seq = 0;
    const notes: PerformanceNote[] = [];
    // wild register jumps to stress the springs
    const jumps = [21, 108, 40, 96, 60, 24, 90, 30];
    jumps.forEach((m, i) => notes.push(pnote(m, i * 0.25, 0.2, m < 60 ? 'L' : 'R', 3, 0.9)));
    const program = buildChoreoProgram(makeScore(notes));
    const dt = 1 / 120;
    let prev = program.sample(0);
    for (let t = dt; t <= program.duration; t += dt) {
      const f = program.sample(t);
      for (const hand of ['L', 'R'] as const) {
        const w = f.hands[hand].wrist;
        expect(Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.z)).toBe(true);
        const pw = prev.hands[hand].wrist;
        const speed = Math.hypot(w.x - pw.x, w.y - pw.y, w.z - pw.z) / dt;
        expect(speed, `wrist speed at t=${t.toFixed(3)}`).toBeLessThanOrEqual(3000 + 1);
        for (const fg of f.hands[hand].fingers) {
          expect(Number.isFinite(fg.tip.x) && Number.isFinite(fg.tip.y) && Number.isFinite(fg.tip.z)).toBe(true);
          expect(Number.isFinite(fg.press) && Number.isFinite(fg.curl) && Number.isFinite(fg.splay)).toBe(true);
        }
      }
      expect(Number.isFinite(f.body.leanX + f.body.leanZ + f.body.sway + f.body.breath)).toBe(true);
      expect(Number.isFinite(f.head.yaw + f.head.pitch + f.head.lift)).toBe(true);
      for (let k = 0; k < 88; k++) expect(Number.isFinite(f.keys[k])).toBe(true);
      prev = f;
    }
  });

  it('rides the sustain pedal', () => {
    seq = 0;
    const program = buildChoreoProgram(
      makeScore([pnote(60, 0.5, 2.5, 'R', 1)], [{ start: 1, end: 2 }]),
    );
    expect(program.sample(0.5).pedal).toBeLessThan(0.2);
    expect(program.sample(1.5).pedal).toBeGreaterThan(0.8);
    expect(program.sample(2.4).pedal).toBeLessThan(0.2);
  });

  it('releases keys after note end', () => {
    seq = 0;
    const n = pnote(60, 1, 0.5, 'R', 2);
    const program = buildChoreoProgram(makeScore([n]));
    expect(program.sample(0.2).keys[keyIndex(60)]).toBe(0);
    expect(program.sample(1.3).keys[keyIndex(60)]).toBeGreaterThan(0.8);
    expect(program.sample(1.9).keys[keyIndex(60)]).toBeLessThan(0.1);
  });
});

describe('hand shaping (realism)', () => {
  it('prepares a finger over its upcoming key well before the strike', () => {
    seq = 0;
    // RH thumb plays C4 at t=1, then G4 at t=3 — by t=2.5 the thumb should
    // already hover near G4, not sit at a static spread offset
    const notes = [pnote(60, 1.0, 0.5, 'R', 1), pnote(67, 3.0, 0.5, 'R', 1)];
    const program = buildChoreoProgram(makeScore(notes));
    const frame = program.sample(2.5);
    const thumbX = frame.hands.R.fingers[0].tip.x;
    expect(Math.abs(thumbX - keyCenterX(67))).toBeLessThanOrEqual(40);
  });

  it('keeps idle fingers hovering near the keys their hand actually covers', () => {
    seq = 0;
    // RH plays a C4–E4–G4 chord (fingers 1,3,5). Finger 2 has no notes at
    // all — it should drape near the chord region, between thumb and middle
    const notes = [
      pnote(60, 1.0, 1.2, 'R', 1),
      pnote(64, 1.0, 1.2, 'R', 3),
      pnote(67, 1.0, 1.2, 'R', 5),
    ];
    const program = buildChoreoProgram(makeScore(notes));
    const frame = program.sample(1.5);
    const idleIndexX = frame.hands.R.fingers[1].tip.x; // finger 2
    expect(idleIndexX).toBeGreaterThan(keyCenterX(60) - 30);
    expect(idleIndexX).toBeLessThan(keyCenterX(67) + 30);
  });

  it('rolls the wrist toward the pressing finger', () => {
    seq = 0;
    // pinky-side press should produce positive roll (RH), thumb-side negative
    const pinky = buildChoreoProgram(makeScore([pnote(72, 1.0, 0.8, 'R', 5)]));
    const thumb = buildChoreoProgram(makeScore([pnote(60, 1.0, 0.8, 'R', 1)]));
    const rollPinky = pinky.sample(1.3).hands.R.roll;
    const rollThumb = thumb.sample(1.3).hands.R.roll;
    expect(rollPinky).toBeGreaterThan(0.02);
    expect(rollThumb).toBeLessThan(-0.02);
  });
});

describe('gaze (head-cam)', () => {
  it('anticipates the next entry: gaze moves toward the upcoming register before the strike', () => {
    seq = 0;
    // C4 at t=1, then a leap to C6 at t=3 — by t=2.7 the gaze should already
    // favour the high register over the old one
    const notes = [pnote(60, 1.0, 0.6, 'R', 1), pnote(96, 3.0, 0.6, 'R', 5)];
    const program = buildChoreoProgram(makeScore(notes));
    const gaze = program.sample(2.7).head.gazeX;
    const dHigh = Math.abs(gaze - keyCenterX(96));
    const dLow = Math.abs(gaze - keyCenterX(60));
    expect(dHigh).toBeLessThan(dLow);
  });

  it('keeps gaze finite and inside the keyboard', () => {
    seq = 0;
    const notes = [pnote(21, 0.5, 0.4, 'L', 5), pnote(108, 1.2, 0.4, 'R', 5)];
    const program = buildChoreoProgram(makeScore(notes));
    for (let t = 0; t < program.duration; t += 0.05) {
      const g = program.sample(t).head.gazeX;
      expect(Number.isFinite(g)).toBe(true);
      expect(g).toBeGreaterThanOrEqual(-100);
      expect(g).toBeLessThanOrEqual(1322);
    }
  });
});

describe('detectPhrases', () => {
  it('splits phrases on onset gaps of at least 0.9s', () => {
    seq = 0;
    const notes = [
      pnote(60, 0, 0.4, 'R', 1),
      pnote(62, 0.5, 0.4, 'R', 2),
      pnote(64, 1.0, 0.4, 'R', 3),
      pnote(65, 4.0, 0.4, 'R', 4),
      pnote(67, 4.5, 0.4, 'R', 5),
    ];
    const phrases = detectPhrases(notes);
    expect(phrases.length).toBe(2);
    expect(phrases[0].start).toBeCloseTo(0, 3);
    expect(phrases[1].start).toBeCloseTo(4.0, 3);
    for (const p of phrases) {
      expect(p.density).toBeGreaterThan(0);
      expect(p.energy).toBeGreaterThan(0);
    }
  });
});
