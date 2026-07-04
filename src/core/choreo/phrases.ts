import type { NoteEvent, Phrase } from '../types';

const PHRASE_GAP = 0.9;

/** Segment a piece into phrases at inter-onset gaps of >= 0.9s. */
export function detectPhrases(notes: NoteEvent[]): Phrase[] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const phrases: Phrase[] = [];
  let group: NoteEvent[] = [sorted[0]];
  const flush = () => {
    const start = group[0].start;
    const end = Math.max(...group.map((n) => n.end));
    const dur = Math.max(0.25, end - start);
    phrases.push({
      start,
      end,
      density: group.length / dur,
      energy: group.reduce((s, n) => s + n.velocity, 0) / group.length,
    });
  };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start - sorted[i - 1].start > PHRASE_GAP) {
      flush();
      group = [sorted[i]];
    } else {
      group.push(sorted[i]);
    }
  }
  flush();
  return phrases;
}
