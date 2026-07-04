import { renderScoreToPcm, type PcmResult } from '../core/audio/synth';
import { buildChoreoProgram, type ChoreoProgram } from '../core/choreo/program';
import { detectPhrases } from '../core/choreo/phrases';
import { planShots, type ShotPlan } from '../core/cinema/planner';
import { assignFingering, type FingeringInput } from '../core/fingering/assign';
import { assignHands } from '../core/hands/split';
import type {
  Finger,
  Hand,
  ImportedScore,
  NoteEdit,
  PerformanceNote,
  PerformanceScore,
} from '../core/types';

export interface Performance {
  score: PerformanceScore;
  choreo: ChoreoProgram;
  shots: ShotPlan;
}

function hashName(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

/**
 * The "AI performance generation" step: hands → fingering → choreography →
 * cinematography. `edits` are user pins that survive regeneration.
 */
export function buildPerformance(
  imported: ImportedScore,
  edits: NoteEdit[] = [],
): Performance {
  const editById = new Map(edits.map((e) => [e.id, e]));

  // hand assignment (user hand-pins act as extra hints)
  const hints = new Map(imported.handHints ?? []);
  for (const e of edits) if (e.hand) hints.set(e.id, e.hand);
  const hands = assignHands(imported.notes, hints.size > 0 ? hints : undefined);

  // fingering per hand with pins
  const byHand: Record<Hand, FingeringInput[]> = { L: [], R: [] };
  for (const n of imported.notes) {
    const e = editById.get(n.id);
    const hand = e?.hand ?? hands.get(n.id) ?? 'R';
    byHand[hand].push({
      ...n,
      disabled: e?.disabled,
      pinned: e?.finger ? { finger: e.finger } : undefined,
    });
  }
  const fingersL = assignFingering(byHand.L, 'L');
  const fingersR = assignFingering(byHand.R, 'R');

  const notes: PerformanceNote[] = [];
  for (const hand of ['L', 'R'] as const) {
    const fingers = hand === 'L' ? fingersL : fingersR;
    for (const n of byHand[hand]) {
      const e = editById.get(n.id);
      notes.push({
        id: n.id,
        midi: n.midi,
        start: n.start,
        end: n.end,
        velocity: n.velocity,
        hand,
        finger: fingers.get(n.id) ?? (3 as Finger),
        disabled: e?.disabled,
        pinned: e && (e.hand || e.finger) ? { hand: e.hand, finger: e.finger } : undefined,
      });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);

  const active = notes.filter((n) => !n.disabled);
  const lastEnd = active.length > 0 ? Math.max(...active.map((n) => n.end)) : 1;
  const score: PerformanceScore = {
    name: imported.name,
    notes,
    duration: lastEnd + 2.0,
    pedal: imported.pedal.map((p) => ({
      start: p.start,
      end: Number.isFinite(p.end) ? p.end : lastEnd,
    })),
    phrases: detectPhrases(active),
  };

  return {
    score,
    choreo: buildChoreoProgram(score),
    shots: planShots(score, { seed: hashName(imported.name) }),
  };
}

// ---------------------------------------------------------------------------
// Async orchestration for the UI (staged progress, audio decode/transcribe)
// ---------------------------------------------------------------------------

export type PipelineInput =
  | { kind: 'midi'; data: ArrayBuffer; name: string }
  | { kind: 'audio'; data: ArrayBuffer; name: string };

export interface PipelineResult {
  imported: import('../core/types').ImportedScore;
  perf: Performance;
  audio: { kind: 'file' | 'synth'; pcm: PcmResult };
}

export interface StageReporter {
  start(label: string): void;
  progress(pct: number): void;
  done(detail?: string): void;
}

const paint = () => new Promise((r) => setTimeout(r, 16));

export async function runPipeline(
  input: PipelineInput,
  report: StageReporter,
): Promise<PipelineResult> {
  const { importMidi } = await import('../core/midi/importer');

  let imported: import('../core/types').ImportedScore;
  let filePcm: PcmResult | null = null;

  if (input.kind === 'midi') {
    report.start('Reading score');
    await paint();
    imported = importMidi(input.data, input.name);
    report.done(`${imported.notes.length} notes`);
  } else {
    report.start('Decoding audio');
    await paint();
    const ctx = new AudioContext({ sampleRate: 48000 });
    const decoded = await ctx.decodeAudioData(input.data.slice(0));
    await ctx.close();
    filePcm = audioBufferToPcm(decoded);
    report.done(`${decoded.duration.toFixed(1)}s`);

    report.start('Transcribing notes');
    const { transcribeAudio } = await import('../core/transcribe/basicPitch');
    imported = await transcribeAudio(decoded, (pct) => report.progress(pct), input.name);
    if (imported.notes.length === 0) throw new Error('No piano notes detected in this recording.');
    report.done(`${imported.notes.length} notes`);
  }

  report.start('Separating hands');
  await paint();
  report.done();
  report.start('Assigning fingering');
  await paint();
  report.done();
  report.start('Choreographing performance');
  await paint();
  const perf = buildPerformance(imported);
  report.done(`${perf.score.phrases.length} phrases`);

  report.start('Planning cinematography');
  await paint();
  report.done(`${perf.shots.shots.length} shots`);

  let audio: PipelineResult['audio'];
  if (filePcm) {
    audio = { kind: 'file', pcm: filePcm };
  } else {
    report.start('Voicing the piano');
    await paint();
    const pcm = renderScoreToPcm(
      { notes: perf.score.notes, pedal: perf.score.pedal, duration: perf.score.duration },
      48000,
    );
    audio = { kind: 'synth', pcm };
    report.done(`${pcm.duration.toFixed(1)}s`);
  }

  return { imported, perf, audio };
}

/** Re-run the AI with user pins; synth audio re-voiced (disabled notes go silent). */
export function regenerate(
  imported: import('../core/types').ImportedScore,
  edits: NoteEdit[],
  audioKind: 'file' | 'synth',
): { perf: Performance; pcm?: PcmResult } {
  const perf = buildPerformance(imported, edits);
  if (audioKind === 'synth') {
    const pcm = renderScoreToPcm(
      { notes: perf.score.notes, pedal: perf.score.pedal, duration: perf.score.duration },
      48000,
    );
    return { perf, pcm };
  }
  return { perf };
}

export function audioBufferToPcm(buf: AudioBuffer): PcmResult {
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  return { l: new Float32Array(l), r: new Float32Array(r), sampleRate: buf.sampleRate, duration: buf.duration };
}
