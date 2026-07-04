/**
 * Physical geometry of an 88-key piano keyboard, in keyboard space:
 * x = mm along the keyboard (0 at the left edge of A0), y = mm above the
 * white-key top surface, z = mm from the fallboard toward the player.
 */

export const MIDI_MIN = 21; // A0
export const MIDI_MAX = 108; // C8
export const KEY_COUNT = MIDI_MAX - MIDI_MIN + 1;

export const WHITE_KEY_PITCH_MM = 23.5;
export const WHITE_KEY_COUNT = 52;
export const KEYBOARD_WIDTH_MM = WHITE_KEY_COUNT * WHITE_KEY_PITCH_MM;

export const WHITE_KEY_LENGTH_MM = 150; // exposed length
export const BLACK_KEY_LENGTH_MM = 95;
export const BLACK_KEY_RAISE_MM = 12.5;
export const BLACK_KEY_WIDTH_MM = 11;
export const KEY_DIP_MM = 10;

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

/** Real pianos nudge black keys off the white-key boundary by group. */
const BLACK_OFFSET_MM: Record<number, number> = {
  1: -2.0, // C#
  3: 2.0, // D#
  6: -2.6, // F#
  8: 0.0, // G#
  10: 2.6, // A#
};

export function keyIndex(midi: number): number {
  return midi - MIDI_MIN;
}

export function isBlack(midi: number): boolean {
  return BLACK_PCS.has(((midi % 12) + 12) % 12);
}

/** Sequential index among white keys only (A0 = 0 ... C8 = 51). */
export function whiteIndex(midi: number): number {
  let idx = 0;
  for (let m = MIDI_MIN; m < midi; m++) if (!isBlack(m)) idx++;
  return idx;
}

export function keyCenterX(midi: number): number {
  if (!isBlack(midi)) return whiteIndex(midi) * WHITE_KEY_PITCH_MM + WHITE_KEY_PITCH_MM / 2;
  // boundary between the neighboring white keys, nudged by group
  const leftWhite = midi - 1; // black keys always sit above a white neighbor
  const boundary = (whiteIndex(leftWhite) + 1) * WHITE_KEY_PITCH_MM;
  return boundary + (BLACK_OFFSET_MM[((midi % 12) + 12) % 12] ?? 0);
}

/** Top surface height of the (unpressed) key. */
export function keyTopY(midi: number): number {
  return isBlack(midi) ? BLACK_KEY_RAISE_MM : 0;
}

/** Recommended fingertip contact distance from the fallboard. */
export function contactZ(midi: number): number {
  return isBlack(midi) ? 78 : 118;
}
