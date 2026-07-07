import type { PcmResult, SynthNote, SynthScore } from './synth';

/**
 * Sampled-piano renderer — mixes a real recorded grand (Salamander samples)
 * into the project PCM. Pure DSP given decoded buffers, so it stays
 * Node-testable; the browser loader (sampleBank.ts) supplies the decoded
 * {@link SampleBank}.
 *
 * Each note reads its nearest recorded pitch, resampled to the target pitch
 * with linear interpolation, shaped by a velocity gain + velocity-dependent
 * one-pole lowpass (soft notes are duller), and cut with an exponential
 * release once the note (or the sustain pedal) lets go.
 */

/** One recorded pitch: stereo PCM captured at `rootMidi`. */
export interface SampleEntry {
  rootMidi: number;
  sampleRate: number;
  l: Float32Array;
  r: Float32Array;
}

export interface SampleBank {
  entries: SampleEntry[];
}

const MASTER = 0.9;
const RELEASE_TAU = 0.14; // seconds — damper fall after note/pedal release

/** The recorded pitch closest to `midi` (smallest semitone distance). */
export function nearestEntry(bank: SampleBank, midi: number): SampleEntry {
  let best = bank.entries[0];
  let bestDist = Infinity;
  for (const e of bank.entries) {
    const d = Math.abs(e.rootMidi - midi);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

export function renderScoreToPcmSampled(
  score: SynthScore,
  bank: SampleBank,
  sampleRate = 48000,
): PcmResult {
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

  if (bank.entries.length > 0) {
    for (const n of notes) renderNote(n, effectiveEnd(n));
  }

  // gentle safety normalization (recorded samples are hot; chords can pile up)
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
    const entry = nearestEntry(bank, n.midi);
    const src = entry.l;
    const srcR = entry.r;
    const srcLen = src.length;
    if (srcLen < 2) return;

    const v = Math.min(1, Math.max(0.05, n.velocity));
    const gain = MASTER * Math.pow(v, 0.9);

    // resample rate: pitch shift * source/target rate conversion
    const semis = n.midi - entry.rootMidi;
    const readStep = Math.pow(2, semis / 12) * (entry.sampleRate / sampleRate);

    // velocity-dependent lowpass: soft strikes are duller. Fully open at v=1.
    const alpha = Math.min(1, 0.28 + 0.72 * v);

    const startSample = Math.max(0, Math.floor(n.start * sampleRate));
    const releaseSample = Math.floor(endEff * sampleRate);
    const kRel = Math.exp(-1 / (RELEASE_TAU * sampleRate));

    let pos = 0; // fractional read index into the source
    let lpL = 0;
    let lpR = 0;
    let env = 1;
    for (let i = startSample; i < len; i++) {
      const idx = Math.floor(pos);
      if (idx + 1 >= srcLen) break; // source exhausted — note has decayed out
      const frac = pos - idx;
      const sl = src[idx] * (1 - frac) + src[idx + 1] * frac;
      const sr = srcR[idx] * (1 - frac) + srcR[idx + 1] * frac;
      lpL += alpha * (sl - lpL);
      lpR += alpha * (sr - lpR);

      if (i >= releaseSample) {
        env *= kRel;
        if (env < 1e-4) break;
      }

      l[i] += lpL * gain * env;
      r[i] += lpR * gain * env;
      pos += readStep;
    }
  }
}
