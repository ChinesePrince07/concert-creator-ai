import { describe, expect, it } from 'vitest';
import {
  KEY_COUNT,
  KEYBOARD_WIDTH_MM,
  MIDI_MAX,
  MIDI_MIN,
  WHITE_KEY_PITCH_MM,
  contactZ,
  isBlack,
  keyCenterX,
  keyIndex,
  keyTopY,
  whiteIndex,
} from './keyboard';

describe('keyboard geometry', () => {
  it('covers 88 keys from A0 (21) to C8 (108)', () => {
    expect(KEY_COUNT).toBe(88);
    expect(MIDI_MIN).toBe(21);
    expect(MIDI_MAX).toBe(108);
    expect(keyIndex(21)).toBe(0);
    expect(keyIndex(108)).toBe(87);
  });

  it('has 52 white and 36 black keys with the correct octave pattern', () => {
    let whites = 0;
    let blacks = 0;
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) (isBlack(m) ? blacks++ : whites++);
    expect(whites).toBe(52);
    expect(blacks).toBe(36);
    // C C# D D# E F F# G G# A A# B  → blacks at pc 1,3,6,8,10
    expect(isBlack(60)).toBe(false); // C4
    expect(isBlack(61)).toBe(true); // C#4
    expect(isBlack(63)).toBe(true); // D#4
    expect(isBlack(64)).toBe(false); // E4
    expect(isBlack(66)).toBe(true); // F#4
    expect(isBlack(68)).toBe(true); // G#4
    expect(isBlack(70)).toBe(true); // A#4
    expect(isBlack(71)).toBe(false); // B4
  });

  it('indexes white keys sequentially from A0', () => {
    expect(whiteIndex(21)).toBe(0); // A0
    expect(whiteIndex(23)).toBe(1); // B0
    expect(whiteIndex(24)).toBe(2); // C1
    expect(whiteIndex(108)).toBe(51); // C8
  });

  it('positions white key centers on the 23.5mm grid', () => {
    expect(WHITE_KEY_PITCH_MM).toBeCloseTo(23.5);
    expect(keyCenterX(21)).toBeCloseTo(11.75, 2);
    expect(keyCenterX(23)).toBeCloseTo(35.25, 2);
    expect(KEYBOARD_WIDTH_MM).toBeCloseTo(52 * 23.5, 2);
    expect(keyCenterX(108)).toBeCloseTo(KEYBOARD_WIDTH_MM - 11.75, 2);
  });

  it('places every black key strictly between its neighboring white key centers', () => {
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      if (!isBlack(m)) continue;
      expect(keyCenterX(m)).toBeGreaterThan(keyCenterX(m - 1));
      expect(keyCenterX(m)).toBeLessThan(keyCenterX(m + 1));
    }
  });

  it('produces strictly increasing x across all 88 keys', () => {
    for (let m = MIDI_MIN; m < MIDI_MAX; m++) {
      expect(keyCenterX(m + 1)).toBeGreaterThan(keyCenterX(m));
    }
  });

  it('raises black keys and pulls their contact point closer to the fallboard', () => {
    expect(keyTopY(60)).toBe(0);
    expect(keyTopY(61)).toBeCloseTo(12.5);
    expect(contactZ(61)).toBeLessThan(contactZ(60));
    expect(contactZ(60)).toBeGreaterThan(90);
    expect(contactZ(61)).toBeLessThan(95);
  });
});
