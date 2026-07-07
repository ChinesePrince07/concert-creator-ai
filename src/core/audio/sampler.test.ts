import { describe, it, expect } from 'vitest';
import { renderScoreToPcmSampled, nearestEntry, type SampleBank, type SampleEntry } from './sampler';
import type { SynthScore } from './synth';

function entry(rootMidi: number, data: number[], sampleRate = 48000): SampleEntry {
  const a = Float32Array.from(data);
  return { rootMidi, sampleRate, l: a, r: a };
}

function constEntry(rootMidi: number, value: number, seconds: number, sampleRate = 48000): SampleEntry {
  const a = new Float32Array(Math.floor(seconds * sampleRate)).fill(value);
  return { rootMidi, sampleRate, l: a, r: a };
}

function energyAt(pcm: { l: Float32Array }, sample: number): number {
  return Math.abs(pcm.l[sample] ?? 0);
}

describe('renderScoreToPcmSampled', () => {
  it('renders silence for an empty score', () => {
    const bank: SampleBank = { entries: [constEntry(60, 0.2, 1)] };
    const score: SynthScore = { notes: [], pedal: [], duration: 2 };
    const pcm = renderScoreToPcmSampled(score, bank, 48000);
    expect(pcm.sampleRate).toBe(48000);
    expect(pcm.l.length).toBeGreaterThan(0);
    let peak = 0;
    for (let i = 0; i < pcm.l.length; i++) peak = Math.max(peak, Math.abs(pcm.l[i]));
    expect(peak).toBe(0);
  });

  it('plays a root-pitch sample verbatim at start, scaled by velocity gain', () => {
    const src = [0.1, 0.2, 0.3, -0.2, 0.15, -0.05];
    const bank: SampleBank = { entries: [entry(60, src)] };
    const score: SynthScore = {
      notes: [{ id: 'n1', midi: 60, start: 0, end: 5, velocity: 1 }],
      pedal: [],
      duration: 6,
    };
    const pcm = renderScoreToPcmSampled(score, bank, 48000);
    // v=1 -> gain 0.9, lowpass fully open, readStep 1 -> verbatim
    for (let i = 0; i < src.length - 1; i++) {
      expect(pcm.l[i]).toBeCloseTo(src[i] * 0.9, 5);
    }
  });

  it('places the note at its start offset', () => {
    const bank: SampleBank = { entries: [entry(60, [0.5, 0.5, 0.5, 0.5])] };
    const score: SynthScore = {
      notes: [{ id: 'n1', midi: 60, start: 1, end: 5, velocity: 1 }],
      pedal: [],
      duration: 6,
    };
    const pcm = renderScoreToPcmSampled(score, bank, 48000);
    expect(energyAt(pcm, 0)).toBe(0);
    expect(energyAt(pcm, 48000)).toBeGreaterThan(0.1);
  });

  it('picks the nearest recorded pitch', () => {
    const bank: SampleBank = { entries: [entry(60, [0.1]), entry(72, [0.1])] };
    expect(nearestEntry(bank, 65).rootMidi).toBe(60);
    expect(nearestEntry(bank, 68).rootMidi).toBe(72);
    expect(nearestEntry(bank, 60).rootMidi).toBe(60);
  });

  it('sustains longer when the sustain pedal is held past the note end', () => {
    const bank: SampleBank = { entries: [constEntry(60, 0.2, 4)] };
    const note = { id: 'n1', midi: 60, start: 0, end: 0.5, velocity: 1 };
    const dry = renderScoreToPcmSampled({ notes: [note], pedal: [], duration: 4 }, bank, 48000);
    const wet = renderScoreToPcmSampled(
      { notes: [note], pedal: [{ start: 0, end: 3 }], duration: 4 },
      bank,
      48000,
    );
    // one second in: dry note already released to near-silence, pedal note still ringing
    expect(energyAt(dry, 48000)).toBeLessThan(0.02);
    expect(energyAt(wet, 48000)).toBeGreaterThan(0.1);
  });

  it('shifts pitch: an octave up exhausts the source about twice as fast', () => {
    const src = new Float32Array(1000).fill(0.2);
    const bank: SampleBank = { entries: [{ rootMidi: 60, sampleRate: 48000, l: src, r: src }] };
    const low = renderScoreToPcmSampled(
      { notes: [{ id: 'a', midi: 60, start: 0, end: 5, velocity: 1 }], pedal: [], duration: 6 },
      bank,
      48000,
    );
    const high = renderScoreToPcmSampled(
      { notes: [{ id: 'b', midi: 72, start: 0, end: 5, velocity: 1 }], pedal: [], duration: 6 },
      bank,
      48000,
    );
    // find last non-zero sample of each
    const lastNZ = (p: { l: Float32Array }) => {
      let last = 0;
      for (let i = 0; i < p.l.length; i++) if (Math.abs(p.l[i]) > 1e-4) last = i;
      return last;
    };
    const hi = lastNZ(high);
    const lo = lastNZ(low);
    expect(hi).toBeGreaterThan(400);
    expect(hi).toBeLessThan(lo * 0.65); // roughly half the duration
  });
});
