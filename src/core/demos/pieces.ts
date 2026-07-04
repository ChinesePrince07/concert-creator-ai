import { Midi } from '@tonejs/midi';

/**
 * Built-in demo library, generated at runtime — no bundled binaries.
 * Each piece is authored as [midi, gridStart, gridDur, velocity?] tables on a
 * per-piece grid, split into right/left tracks so the importer's two-track
 * hand hints kick in (matching the original product's behavior).
 */

export interface DemoPiece {
  id: string;
  name: string;
  composer: string;
  bytes: Uint8Array;
  /** seconds, approximate */
  duration: number;
}

type N = [midi: number, at: number, dur: number, vel?: number];

function toMidi(right: N[], left: N[], grid: number, name: string): Uint8Array {
  const midi = new Midi();
  midi.name = name;
  const rh = midi.addTrack();
  rh.name = 'Right Hand';
  const lh = midi.addTrack();
  lh.name = 'Left Hand';
  for (const [m, at, dur, vel] of right) {
    rh.addNote({ midi: m, time: at * grid, duration: dur * grid * 0.95, velocity: vel ?? 0.62 });
  }
  for (const [m, at, dur, vel] of left) {
    lh.addNote({ midi: m, time: at * grid, duration: dur * grid * 0.95, velocity: vel ?? 0.5 });
  }
  return midi.toArray();
}

// --- Für Elise (Beethoven, WoO 59) — opening section, 3/8, sixteenth grid ---
function furElise(): DemoPiece {
  const E5 = 76, Eb5 = 75, B4 = 71, D5 = 74, C5 = 72, A4 = 69, C4 = 60, E4 = 64;
  const Ab4 = 68, F5 = 77, G4 = 67, F4 = 65;
  const A2 = 45, E3 = 52, A3 = 57, E2 = 40, Ab3 = 56, C3 = 48, G3 = 55, C4l = 60, G2 = 43, B3 = 59;

  const right: N[] = [
    // pickup + first phrase
    [E5, 0, 1], [Eb5, 1, 1],
    [E5, 2, 1], [Eb5, 3, 1], [E5, 4, 1], [B4, 5, 1], [D5, 6, 1], [C5, 7, 1],
    [A4, 8, 2, 0.68], [C4, 11, 1], [E4, 12, 1], [A4, 13, 1],
    [B4, 14, 2, 0.66], [E4, 17, 1], [Ab4, 18, 1], [B4, 19, 1],
    [C5, 20, 2, 0.68], [E4, 23, 1], [E5, 24, 1], [Eb5, 25, 1],
    [E5, 26, 1], [Eb5, 27, 1], [E5, 28, 1], [B4, 29, 1], [D5, 30, 1], [C5, 31, 1],
    [A4, 32, 2, 0.68], [C4, 35, 1], [E4, 36, 1], [A4, 37, 1],
    [B4, 38, 2, 0.66], [E4, 41, 1], [C5, 42, 1], [B4, 43, 1],
    [A4, 44, 2, 0.7], [B4, 47, 1], [C5, 48, 1], [D5, 49, 1],
    // second theme
    [E5, 50, 2, 0.7], [G4, 53, 1], [F5, 54, 1], [E5, 55, 1],
    [D5, 56, 2, 0.68], [F4, 59, 1], [E5, 60, 1], [D5, 61, 1],
    [C5, 62, 2, 0.66], [E4, 65, 1], [D5, 66, 1], [C5, 67, 1],
    [B4, 68, 2, 0.64], [E4, 71, 1], [E5, 72, 1], [Eb5, 73, 1],
    // reprise
    [E5, 74, 1], [Eb5, 75, 1], [E5, 76, 1], [B4, 77, 1], [D5, 78, 1], [C5, 79, 1],
    [A4, 80, 2, 0.68], [C4, 83, 1], [E4, 84, 1], [A4, 85, 1],
    [B4, 86, 2, 0.66], [E4, 89, 1], [C5, 90, 1], [B4, 91, 1],
    [A4, 92, 4, 0.6],
  ];
  const left: N[] = [
    [A2, 8, 1], [E3, 9, 1], [A3, 10, 1],
    [E2, 14, 1], [E3, 15, 1], [Ab3, 16, 1],
    [A2, 20, 1], [E3, 21, 1], [A3, 22, 1],
    [A2, 32, 1], [E3, 33, 1], [A3, 34, 1],
    [E2, 38, 1], [E3, 39, 1], [Ab3, 40, 1],
    [A2, 44, 1], [E3, 45, 1], [A3, 46, 1],
    [C3, 50, 1], [G3, 51, 1], [C4l, 52, 1],
    [G2, 56, 1], [G3, 57, 1], [B3, 58, 1],
    [A2, 62, 1], [E3, 63, 1], [A3, 64, 1],
    [E2, 68, 1], [E3, 69, 1], [Ab3, 70, 1],
    [A2, 80, 1], [E3, 81, 1], [A3, 82, 1],
    [E2, 86, 1], [E3, 87, 1], [Ab3, 88, 1],
    [A2, 92, 4, 0.55], [E3, 92, 4, 0.45], [A3, 92, 4, 0.45],
  ];
  const grid = 0.145; // sixteenth ≈ poco moto
  return {
    id: 'fur-elise',
    name: 'Für Elise',
    composer: 'L. van Beethoven',
    bytes: toMidi(right, left, grid, 'Für Elise'),
    duration: 96 * grid,
  };
}

// --- Gymnopédie No. 1 (Satie) — opening, 3/4, quarter grid -----------------
function gymnopedie(): DemoPiece {
  const right: N[] = [];
  const left: N[] = [];
  const G2 = 43, D2 = 38, B3 = 59, D4 = 62, Fs4 = 66, A3 = 57;
  // 18 bars of the floating accompaniment
  for (let bar = 0; bar < 18; bar++) {
    const t = bar * 3;
    if (bar % 2 === 0) {
      left.push([G2, t, 1, 0.46], [B3, t + 1, 2, 0.4], [D4, t + 1, 2, 0.38], [Fs4, t + 1, 2, 0.36]);
    } else {
      left.push([D2, t, 1, 0.46], [A3, t + 1, 2, 0.4], [D4, t + 1, 2, 0.38], [Fs4, t + 1, 2, 0.36]);
    }
  }
  const Fs5 = 78, A5 = 81, G5 = 79, Cs5 = 73, B4 = 71, D5 = 74, A4 = 69, E5 = 76, Fs5b = 78;
  right.push(
    [Fs5, 14, 1, 0.52],
    [A5, 15, 1, 0.5], [G5, 16, 1, 0.5], [Fs5, 17, 1, 0.5],
    [Cs5, 18, 1, 0.48], [B4, 19, 1, 0.48], [Cs5, 20, 1, 0.48],
    [D5, 21, 5, 0.5],
    [Fs5b, 27, 1, 0.52],
    [A5, 28, 1, 0.5], [G5, 29, 1, 0.5], [Fs5, 30, 1, 0.5],
    [Cs5, 31, 1, 0.48], [B4, 32, 1, 0.48], [Cs5, 33, 1, 0.48],
    [D5, 34, 1, 0.5], [E5, 35, 1, 0.48],
    [A4, 36, 6, 0.46],
    [Fs5, 44, 1, 0.5], [E5, 45, 1, 0.48], [D5, 46, 1, 0.48],
    [Cs5, 47, 1, 0.46], [B4, 48, 1, 0.46], [A4, 49, 2, 0.44],
  );
  const grid = 0.62; // Lent
  return {
    id: 'gymnopedie-1',
    name: 'Gymnopédie No. 1',
    composer: 'Erik Satie',
    bytes: toMidi(right, left, grid, 'Gymnopédie No. 1'),
    duration: 54 * grid,
  };
}

// --- Cascade Étude — generated arpeggio showpiece, sixteenth grid -----------
function cascadeEtude(): DemoPiece {
  const right: N[] = [];
  const left: N[] = [];
  // Am, F, C, G — two rounds, rising intensity
  const chords = [
    [57, 60, 64],
    [53, 57, 60],
    [60, 64, 67],
    [55, 59, 62],
  ];
  const bars = 16;
  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[bar % 4];
    const t0 = bar * 16;
    const v = 0.45 + 0.4 * (bar / (bars - 1));
    // RH: 16th arpeggio up two octaves and back
    const tones = [
      chord[0] + 12, chord[1] + 12, chord[2] + 12,
      chord[0] + 24, chord[1] + 24, chord[2] + 24,
      chord[0] + 36 <= 108 ? chord[0] + 36 : chord[2] + 24,
      chord[2] + 24,
    ];
    const up = [...tones];
    const down = [...tones].reverse();
    const run = [...up, ...down];
    for (let s = 0; s < 16; s++) {
      right.push([run[s % run.length], t0 + s, 1, Math.min(0.95, v + (s % 4 === 0 ? 0.08 : 0))]);
    }
    // LH: root–fifth–octave rocking
    const root = chord[0] - 24;
    const pattern = [root, root + 7, root + 12, root + 7];
    for (let q = 0; q < 4; q++) {
      left.push([pattern[q % 4], t0 + q * 4, 3.6, Math.min(0.8, v - 0.05)]);
    }
    if (bar === bars - 1) {
      right.push([chord[0] + 24, t0 + 16, 8, 0.85], [chord[1] + 24, t0 + 16, 8, 0.8], [chord[2] + 24, t0 + 16, 8, 0.8]);
      left.push([root, t0 + 16, 8, 0.7], [root + 12, t0 + 16, 8, 0.6]);
    }
  }
  const grid = 0.115;
  return {
    id: 'cascade-etude',
    name: 'Cascade Étude',
    composer: 'Generated',
    bytes: toMidi(right, left, grid, 'Cascade Étude'),
    duration: (16 * 16 + 8) * grid,
  };
}

export function buildDemoMidis(): DemoPiece[] {
  return [furElise(), gymnopedie(), cascadeEtude()];
}
