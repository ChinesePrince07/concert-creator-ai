// Generates a test piano recording (known notes) for the transcription e2e.
// Node 26 runs TS directly: node scripts/make-test-wav.ts <out.wav>
import { writeFileSync } from 'node:fs';
import { renderScoreToPcm } from '../src/core/audio/synth.ts';

const notes = [
  // C major arpeggio up + melody phrase, deliberately clean and separated
  { m: 60, t: 0.3, d: 0.55, v: 0.75 },
  { m: 64, t: 0.95, d: 0.55, v: 0.72 },
  { m: 67, t: 1.6, d: 0.55, v: 0.74 },
  { m: 72, t: 2.25, d: 0.8, v: 0.8 },
  { m: 71, t: 3.2, d: 0.5, v: 0.7 },
  { m: 69, t: 3.8, d: 0.5, v: 0.68 },
  { m: 67, t: 4.4, d: 0.7, v: 0.72 },
  { m: 64, t: 5.25, d: 0.6, v: 0.7 },
  { m: 60, t: 5.95, d: 1.2, v: 0.75 },
  // low bass anchors
  { m: 48, t: 0.3, d: 1.8, v: 0.6 },
  { m: 43, t: 2.25, d: 1.7, v: 0.58 },
  { m: 48, t: 4.4, d: 2.2, v: 0.6 },
];

const score = {
  notes: notes.map((n, i) => ({
    id: `w${i}`,
    midi: n.m,
    start: n.t,
    end: n.t + n.d,
    velocity: n.v,
  })),
  pedal: [],
  duration: 8.5,
};

const { l, r, sampleRate } = renderScoreToPcm(score, 44100);

// 16-bit stereo WAV
const frames = l.length;
const dataSize = frames * 2 * 2;
const buf = Buffer.alloc(44 + dataSize);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataSize, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(sampleRate, 24);
buf.writeUInt32LE(sampleRate * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(dataSize, 40);
for (let i = 0; i < frames; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), 46 + i * 4);
}
writeFileSync(process.argv[2] ?? 'test-piano.wav', buf);
console.log(`wrote ${process.argv[2]} (${(buf.length / 1e6).toFixed(2)} MB, ${frames} frames @ ${sampleRate})`);
