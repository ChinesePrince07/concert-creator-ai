export type Hand = 'L' | 'R';
export type Finger = 1 | 2 | 3 | 4 | 5; // 1 = thumb for both hands

export interface NoteEvent {
  id: string;
  midi: number;
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  /** 0..1 */
  velocity: number;
}

export interface PerformanceNote extends NoteEvent {
  hand: Hand;
  finger: Finger;
  /** user pressed Q on it — excluded from sound-independent animation */
  disabled?: boolean;
  /** user edits that survive regeneration */
  pinned?: { hand?: Hand; finger?: Finger };
}

export interface PedalEvent {
  start: number;
  end: number;
}

export interface Phrase {
  start: number;
  end: number;
  /** notes per second inside the phrase */
  density: number;
  /** 0..1 mean velocity */
  energy: number;
}

export interface PerformanceScore {
  name: string;
  notes: PerformanceNote[];
  duration: number;
  pedal: PedalEvent[];
  phrases: Phrase[];
}

/** Raw import result before hand/finger assignment. */
export interface ImportedScore {
  name: string;
  notes: NoteEvent[];
  /** note id -> hand, when the source encodes hands (two-track MIDI) */
  handHints?: Map<string, Hand>;
  pedal: PedalEvent[];
}

export interface NoteEdit {
  id: string;
  hand?: Hand;
  finger?: Finger;
  disabled?: boolean;
}
