import { describe, expect, it } from 'vitest';
import { renderScoreToPcm } from './synth';

function goertzelPower(x: Float32Array, sampleRate: number, freq: number, from: number, to: number): number {
  const i0 = Math.floor(from * sampleRate);
  const i1 = Math.min(x.length, Math.floor(to * sampleRate));
  const w = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = i0; i < i1; i++) {
    s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function single(midi: number, velocity: number, dur = 1.0) {
  return {
    notes: [{ id: 'x0', midi, start: 0.1, end: 0.1 + dur, velocity }],
    pedal: [] as Array<{ start: number; end: number }>,
    duration: 0.1 + dur + 1.5,
  };
}

describe('renderScoreToPcm', () => {
  it('renders a non-silent stereo buffer with peak below 1', () => {
    const { l, r, duration } = renderScoreToPcm(single(60, 0.7), 48000);
    expect(l.length).toBe(r.length);
    expect(duration).toBeGreaterThan(1.5);
    let peak = 0;
    let energy = 0;
    for (let i = 0; i < l.length; i++) {
      peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      energy += l[i] * l[i] + r[i] * r[i];
    }
    expect(peak).toBeGreaterThan(0.02);
    expect(peak).toBeLessThanOrEqual(1);
    expect(energy).toBeGreaterThan(1);
    for (let i = 0; i < l.length; i++) {
      if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) throw new Error(`NaN at ${i}`);
    }
  });

  it('rings past the note release (decay tail)', () => {
    const sr = 48000;
    const { l, r } = renderScoreToPcm(single(48, 0.8, 0.5), sr); // note ends at 0.6
    let tail = 0;
    for (let i = Math.floor(0.62 * sr); i < Math.floor(0.72 * sr); i++) tail += Math.abs(l[i]) + Math.abs(r[i]);
    expect(tail).toBeGreaterThan(0.02);
  });

  it('gets louder with velocity', () => {
    const quiet = renderScoreToPcm(single(60, 0.3), 48000);
    const loud = renderScoreToPcm(single(60, 0.95), 48000);
    const peakOf = (b: Float32Array) => {
      let p = 0;
      for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i]));
      return p;
    };
    expect(peakOf(loud.l)).toBeGreaterThan(peakOf(quiet.l) * 1.5);
  });

  it('produces the right pitch: C4 render is dominated by ~261.6 Hz', () => {
    const sr = 48000;
    const { l } = renderScoreToPcm(single(60, 0.6, 1.2), sr);
    const target = goertzelPower(l, sr, 261.63, 0.35, 0.9);
    expect(target).toBeGreaterThan(goertzelPower(l, sr, 200, 0.35, 0.9) * 5);
    expect(target).toBeGreaterThan(goertzelPower(l, sr, 330, 0.35, 0.9) * 5);
    expect(target).toBeGreaterThan(goertzelPower(l, sr, 523.25, 0.35, 0.9));
  });

  it('sustain pedal lets a short note ring past its written end', () => {
    const sr = 48000;
    const base = {
      notes: [{ id: 'p0', midi: 55, start: 0.1, end: 0.25, velocity: 0.8 }],
      duration: 3,
    };
    const dry = renderScoreToPcm({ ...base, pedal: [] }, sr);
    const wet = renderScoreToPcm({ ...base, pedal: [{ start: 0, end: 2.0 }] }, sr);
    const rms = (b: Float32Array, from: number, to: number) => {
      let e = 0;
      const i0 = Math.floor(from * sr);
      const i1 = Math.floor(to * sr);
      for (let i = i0; i < i1; i++) e += b[i] * b[i];
      return Math.sqrt(e / Math.max(1, i1 - i0));
    };
    expect(rms(wet.l, 0.8, 1.2)).toBeGreaterThan(rms(dry.l, 0.8, 1.2) * 2);
  });

  it('is deterministic', () => {
    const a = renderScoreToPcm(single(72, 0.6), 24000);
    const b = renderScoreToPcm(single(72, 0.6), 24000);
    expect(a.l).toEqual(b.l);
  });
});
