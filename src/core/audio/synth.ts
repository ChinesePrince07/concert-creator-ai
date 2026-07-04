import { KEYBOARD_WIDTH_MM, keyCenterX } from '../keyboard';
import type { PedalEvent } from '../types';

/**
 * Offline piano synthesizer — pure DSP, no WebAudio, Node-testable.
 *
 * Each note is a bank of inharmonic partials rendered with 2nd-order sine
 * resonators (one multiply-add per sample per partial) under a two-stage
 * exponential decay, plus a seeded hammer-noise transient. The sustain pedal
 * extends a note's effective end to the pedal-up time.
 */

export interface SynthNote {
  id: string;
  midi: number;
  start: number;
  end: number;
  velocity: number;
  disabled?: boolean;
}

export interface SynthScore {
  notes: SynthNote[];
  pedal: PedalEvent[];
  duration: number;
}

export interface PcmResult {
  l: Float32Array;
  r: Float32Array;
  sampleRate: number;
  duration: number;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderScoreToPcm(score: SynthScore, sampleRate = 48000): PcmResult {
  const notes = score.notes.filter((n) => !n.disabled);
  const pedal = score.pedal.map((p) => ({
    start: p.start,
    end: Number.isFinite(p.end) ? p.end : score.duration,
  }));

  const effectiveEnd = (n: SynthNote): number => {
    for (const p of pedal) {
      if (p.start <= n.end && n.end <= p.end) return Math.max(n.end, p.end);
    }
    return n.end;
  };

  let maxEnd = 0.5;
  for (const n of notes) maxEnd = Math.max(maxEnd, effectiveEnd(n));
  const totalSec = Math.max(score.duration, maxEnd + 1.8);
  const len = Math.ceil(totalSec * sampleRate);
  const l = new Float32Array(len);
  const r = new Float32Array(len);

  for (const n of notes) renderNote(n, effectiveEnd(n));

  // gentle safety normalization
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const a = Math.abs(l[i]);
    const b = Math.abs(r[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  if (peak > 0.95) {
    const k = 0.95 / peak;
    for (let i = 0; i < len; i++) {
      l[i] *= k;
      r[i] *= k;
    }
  }

  return { l, r, sampleRate, duration: len / sampleRate };

  function renderNote(n: SynthNote, endEff: number): void {
    const f0 = 440 * Math.pow(2, (n.midi - 69) / 12);
    const v = Math.min(1, Math.max(0.05, n.velocity));
    const startSample = Math.max(0, Math.floor(n.start * sampleRate));
    const releaseSample = Math.floor(endEff * sampleRate);

    const pan = (keyCenterX(n.midi) / KEYBOARD_WIDTH_MM - 0.5) * 0.8;
    const gL = Math.cos(((pan + 1) * Math.PI) / 4);
    const gR = Math.sin(((pan + 1) * Math.PI) / 4);
    const noteGain = 0.3 * (0.2 + 0.8 * Math.pow(v, 1.3));

    const tauBase = Math.min(8, Math.max(0.4, 4.0 * Math.pow(2, -(n.midi - 48) / 24)));
    const kPartials = Math.min(14, Math.max(1, Math.floor((0.45 * sampleRate) / f0)));
    const brightness = 2.1 - 0.9 * v;
    const B = Math.min(0.0012, 0.00005 * Math.pow(2, (n.midi - 40) / 12));

    const attackSamples = Math.max(8, Math.floor((0.0015 + 0.004 * (1 - v)) * sampleRate));
    const kneeSample = startSample + Math.floor(0.15 * sampleRate);
    const relTau = 0.1;
    const kRel = Math.exp(-1 / (relTau * sampleRate));

    // hard window: note render stops when everything is inaudible
    const windowEnd = Math.min(len, releaseSample + Math.floor(0.9 * sampleRate));

    for (let p = 1; p <= kPartials; p++) {
      const fp = p * f0 * Math.sqrt(1 + B * p * p);
      if (fp >= sampleRate * 0.48) break;
      const w = (2 * Math.PI * fp) / sampleRate;
      const coeff = 2 * Math.cos(w);
      let s1 = Math.sin(-w);
      let s2 = Math.sin(-2 * w);

      let ampBase = 1 / Math.pow(p, brightness);
      if (p === 2) ampBase *= 1.15;
      if (p === 3) ampBase *= 1.05;

      const tauP = tauBase / (1 + 0.6 * (p - 1));
      const kFast = Math.exp(-1 / (tauP * 0.25 * sampleRate));
      const kSlow = Math.exp(-1 / (tauP * sampleRate));

      let amp = ampBase * noteGain;
      for (let i = startSample; i < windowEnd; i++) {
        const s0 = coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
        const idx = i - startSample;
        const attack = idx < attackSamples ? idx / attackSamples : 1;
        const out = amp * attack * s0;
        l[i] += out * gL;
        r[i] += out * gR;
        amp *= i < kneeSample ? kFast : i < releaseSample ? kSlow : kRel;
        if (amp < 1e-5 && idx > attackSamples) break;
      }
    }

    // hammer transient: filtered seeded noise, a few milliseconds
    const rng = mulberry32(hashString(n.id) ^ (n.midi * 2654435761));
    const noiseLen = Math.floor(0.004 * sampleRate);
    const noiseGain = 0.1 * Math.pow(v, 1.6) * noteGain * 3;
    const alpha = 0.1 + 0.3 * v;
    let lp = 0;
    for (let i = 0; i < noiseLen && startSample + i < len; i++) {
      lp += alpha * ((rng() * 2 - 1) - lp);
      const env = 1 - i / noiseLen;
      const out = noiseGain * env * env * lp;
      l[startSample + i] += out * gL;
      r[startSample + i] += out * gR;
    }
  }
}
