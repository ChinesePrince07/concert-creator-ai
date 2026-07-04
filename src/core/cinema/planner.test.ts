import { describe, expect, it } from 'vitest';
import { detectPhrases } from '../choreo/phrases';
import type { PerformanceNote, PerformanceScore } from '../types';
import { planShots } from './planner';

let seq = 0;
function pnote(midi: number, start: number, dur = 0.3, velocity = 0.6): PerformanceNote {
  return {
    id: `s${seq++}`,
    midi,
    start,
    end: start + dur,
    velocity,
    hand: midi < 60 ? 'L' : 'R',
    finger: 3,
  };
}

function score(notes: PerformanceNote[]): PerformanceScore {
  const duration = Math.max(...notes.map((n) => n.end)) + 1.5;
  return { name: 'cin', notes, duration, pedal: [], phrases: detectPhrases(notes) };
}

function slowThenFast(): PerformanceScore {
  seq = 0;
  const notes: PerformanceNote[] = [];
  // 0..12s: sparse chords (~1.5 notes/s)
  for (let t = 0; t < 12; t += 1.4) notes.push(pnote(48 + ((t * 3) % 24), t, 1.1));
  // 14..26s: rapid run (~12 notes/s)
  for (let t = 14; t < 26; t += 0.085) notes.push(pnote(60 + Math.round((t * 7) % 24), t, 0.08));
  return score(notes);
}

describe('planShots', () => {
  it('tiles the whole piece with no gaps and sane shot lengths', () => {
    const sc = slowThenFast();
    const plan = planShots(sc, { seed: 7 });
    expect(plan.shots.length).toBeGreaterThan(2);
    expect(plan.shots[0].start).toBe(0);
    expect(plan.shots[plan.shots.length - 1].end).toBeCloseTo(sc.duration, 5);
    for (let i = 0; i < plan.shots.length; i++) {
      const s = plan.shots[i];
      const minLen = i === plan.shots.length - 1 ? 2 : 4;
      expect(s.end - s.start, `shot ${i} length`).toBeGreaterThanOrEqual(minLen - 1e-6);
      if (i > 0) expect(s.start).toBeCloseTo(plan.shots[i - 1].end, 6);
    }
  });

  it('opens with an establishing wide shot and never repeats a type back-to-back', () => {
    const plan = planShots(slowThenFast(), { seed: 3 });
    expect(plan.shots[0].type).toBe('WIDE_DOLLY');
    for (let i = 1; i < plan.shots.length; i++) {
      expect(plan.shots[i].type).not.toBe(plan.shots[i - 1].type);
    }
  });

  it('biases fast passages toward keyboard-focused shots', () => {
    const plan = planShots(slowThenFast(), { seed: 11 });
    const fastShots = plan.shots.filter((s) => s.start >= 13.5 && s.end <= 26.1);
    expect(fastShots.length).toBeGreaterThan(0);
    for (const s of fastShots) {
      expect(['TOP_DOWN', 'CLOSE_HANDS', 'FIRST_PERSON']).toContain(s.type);
    }
  });

  it('is deterministic for a fixed seed and varies with the seed', () => {
    const sc = slowThenFast();
    const a = planShots(sc, { seed: 42 });
    const b = planShots(sc, { seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = planShots(sc, { seed: 43 });
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });
});
