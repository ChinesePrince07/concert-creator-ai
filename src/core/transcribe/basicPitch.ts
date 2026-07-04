import { MIDI_MAX, MIDI_MIN } from '../keyboard';
import type { ImportedScore, NoteEvent } from '../types';

/**
 * Audio → notes via Spotify's Basic Pitch (TF.js), model served locally.
 * Browser-only module (WebAudio + TF.js); exercised by e2e, not unit tests.
 */

const MODEL_URL = '/models/basic-pitch/model.json';

export async function transcribeAudio(
  audio: AudioBuffer,
  onProgress: (pct: number) => void,
  name = 'Transcribed recording',
): Promise<ImportedScore> {
  const { BasicPitch, noteFramesToTime, outputToNotesPoly } = await import('@spotify/basic-pitch');

  // Basic Pitch expects 22050 Hz mono
  const mono = await resample(audio, 22050);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  const bp = new BasicPitch(MODEL_URL);
  await bp.evaluateModel(
    mono,
    (f: number[][], o: number[][], c: number[][]) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (pct: number) => onProgress(Math.min(0.98, pct)),
  );

  const raw = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.35, 0.3, 8));

  let notes: NoteEvent[] = raw.map((n, i) => ({
    id: `n${i}`,
    midi: n.pitchMidi,
    start: n.startTimeSeconds,
    end: n.startTimeSeconds + n.durationSeconds,
    velocity: Math.min(1, Math.max(0.15, n.amplitude * 1.35)),
  }));

  // post-filters: range clamp, drop dust, merge re-articulations
  notes = notes
    .filter((n) => n.midi >= MIDI_MIN && n.midi <= MIDI_MAX)
    .filter((n) => n.end - n.start >= 0.04 || n.velocity > 0.45)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);

  const byPitch = new Map<number, NoteEvent>();
  const merged: NoteEvent[] = [];
  for (const n of notes) {
    const prev = byPitch.get(n.midi);
    if (prev && n.start - prev.end < 0.03 && n.start - prev.start < 0.12) {
      prev.end = Math.max(prev.end, n.end);
      prev.velocity = Math.max(prev.velocity, n.velocity);
      continue;
    }
    if (prev && prev.end > n.start) prev.end = n.start;
    byPitch.set(n.midi, n);
    merged.push(n);
  }
  const final = merged
    .filter((n) => n.end - n.start > 0.035)
    .map((n, i) => ({ ...n, id: `n${i}` }));

  onProgress(1);
  return { name, notes: final, pedal: [] };
}

async function resample(audio: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (audio.sampleRate === targetRate && audio.numberOfChannels === 1) return audio;
  const length = Math.ceil((audio.duration + 0.1) * targetRate);
  const ctx = new OfflineAudioContext(1, length, targetRate);
  const src = ctx.createBufferSource();
  src.buffer = audio;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}
