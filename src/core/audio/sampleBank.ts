import type { SampleBank, SampleEntry } from './sampler';

/**
 * Browser loader for the Salamander grand samples in `public/piano/`.
 * Fetches + decodes the 30 recorded pitches once, caches the decoded
 * {@link SampleBank}, and exposes a synchronous accessor for the re-voice
 * path (which runs after the bank is already loaded).
 *
 * Samples: Salamander Grand Piano by Alexander Holm (CC-BY 3.0).
 */

// Salamander is sampled every 3 semitones (A / C / D# / F# per octave).
const FILES = [
  'A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3',
  'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5',
  'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8',
];

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `"Ds4"` → MIDI 63, `"A0"` → 21. `s` marks a sharp. */
export function noteNameToMidi(name: string): number {
  const m = /^([A-G])(s?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad sample name: ${name}`);
  const [, letter, sharp, oct] = m;
  return 12 * (Number(oct) + 1) + SEMITONE[letter] + (sharp ? 1 : 0);
}

let cache: Promise<SampleBank> | null = null;
let loaded: SampleBank | null = null;

/** The decoded bank if it has finished loading, else null. */
export function getLoadedBank(): SampleBank | null {
  return loaded;
}

/** Fetch + decode all pitches once; subsequent calls return the same promise. */
export function loadPianoSampleBank(
  baseUrl = '/piano/',
  onProgress?: (done: number, total: number) => void,
): Promise<SampleBank> {
  if (cache) return cache;
  cache = (async () => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    try {
      let done = 0;
      const entries = await Promise.all(
        FILES.map(async (name): Promise<SampleEntry> => {
          const res = await fetch(`${baseUrl}${name}.mp3`);
          if (!res.ok) throw new Error(`sample ${name}.mp3: HTTP ${res.status}`);
          const audio = await ctx.decodeAudioData(await res.arrayBuffer());
          const l = audio.getChannelData(0);
          const r = audio.numberOfChannels > 1 ? audio.getChannelData(1) : l;
          onProgress?.(++done, FILES.length);
          return {
            rootMidi: noteNameToMidi(name),
            sampleRate: audio.sampleRate,
            l: new Float32Array(l),
            r: new Float32Array(r),
          };
        }),
      );
      entries.sort((a, b) => a.rootMidi - b.rootMidi);
      loaded = { entries };
      return loaded;
    } finally {
      void ctx.close();
    }
  })();
  return cache;
}
