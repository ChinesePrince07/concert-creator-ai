import { Midi } from '@tonejs/midi';
import { MIDI_MAX, MIDI_MIN } from '../keyboard';
import type { Hand, ImportedScore, NoteEvent, PedalEvent } from '../types';

const MIN_DURATION = 0.03;
const SIMULTANEOUS_EPS = 0.002;

interface RawNote {
  midi: number;
  start: number;
  end: number;
  velocity: number;
  track: number;
}

export function importMidi(data: ArrayBuffer, name = 'Imported MIDI'): ImportedScore {
  const midi = new Midi(data);

  const melodic = midi.tracks
    .map((t, i) => ({ track: t, index: i }))
    .filter(({ track }) => track.notes.length > 0);

  let raw: RawNote[] = [];
  for (const { track, index } of melodic) {
    for (const n of track.notes) {
      raw.push({
        midi: n.midi,
        start: n.time,
        end: n.time + Math.max(n.duration, MIN_DURATION),
        velocity: Math.min(1, Math.max(0.02, n.velocity)),
        track: index,
      });
    }
  }

  raw = raw.filter((n) => n.midi >= MIDI_MIN && n.midi <= MIDI_MAX);
  raw.sort((a, b) => a.start - b.start || a.midi - b.midi);

  // Collapse simultaneous duplicates of the same pitch (keep the louder one),
  // then truncate remaining same-pitch overlaps: a held key cannot re-strike.
  const byPitch = new Map<number, RawNote[]>();
  const kept: RawNote[] = [];
  for (const n of raw) {
    const prevList = byPitch.get(n.midi);
    const prev = prevList?.[prevList.length - 1];
    if (prev && Math.abs(prev.start - n.start) <= SIMULTANEOUS_EPS) {
      if (n.velocity > prev.velocity) {
        prev.velocity = n.velocity;
        prev.end = Math.max(prev.end, n.end);
        prev.track = n.track;
      }
      continue;
    }
    if (prev && prev.end > n.start) prev.end = n.start;
    if (prevList) prevList.push(n);
    else byPitch.set(n.midi, [n]);
    kept.push(n);
  }
  const finalNotes = kept.filter((n) => n.end - n.start > 0.001);

  const notes: NoteEvent[] = finalNotes.map((n, i) => ({
    id: `n${i}`,
    midi: n.midi,
    start: n.start,
    end: n.end,
    velocity: n.velocity,
  }));

  // Hand hints from exactly two melodic tracks: higher mean pitch = right hand.
  let handHints: Map<string, Hand> | undefined;
  if (melodic.length === 2) {
    const mean = (idx: number) => {
      const ns = finalNotes.filter((n) => n.track === idx);
      return ns.reduce((s, n) => s + n.midi, 0) / Math.max(1, ns.length);
    };
    const [a, b] = [melodic[0].index, melodic[1].index];
    const rightTrack = mean(a) >= mean(b) ? a : b;
    handHints = new Map(
      notes.map((note, i) => [note.id, finalNotes[i].track === rightTrack ? 'R' : 'L'] as const),
    );
  }

  return { name: midi.name || name, notes, handHints, pedal: extractPedal(midi) };
}

function extractPedal(midi: Midi): PedalEvent[] {
  const spans: PedalEvent[] = [];
  for (const track of midi.tracks) {
    const ccs = track.controlChanges[64];
    if (!ccs) continue;
    let downAt: number | null = null;
    for (const cc of ccs) {
      const down = cc.value >= 0.5;
      if (down && downAt === null) downAt = cc.time;
      else if (!down && downAt !== null) {
        spans.push({ start: downAt, end: cc.time });
        downAt = null;
      }
    }
    if (downAt !== null) spans.push({ start: downAt, end: Number.POSITIVE_INFINITY });
  }
  spans.sort((a, b) => a.start - b.start);
  // merge overlaps across tracks
  const merged: PedalEvent[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}
