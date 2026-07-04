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
