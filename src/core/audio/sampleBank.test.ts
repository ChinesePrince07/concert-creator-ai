import { describe, it, expect } from 'vitest';
import { noteNameToMidi } from './sampleBank';

describe('noteNameToMidi', () => {
  it('maps naturals', () => {
    expect(noteNameToMidi('A0')).toBe(21);
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('C8')).toBe(108);
  });
  it('maps sharps (s)', () => {
    expect(noteNameToMidi('Ds1')).toBe(27);
    expect(noteNameToMidi('Fs4')).toBe(66);
  });
  it('rejects garbage', () => {
    expect(() => noteNameToMidi('H2')).toThrow();
    expect(() => noteNameToMidi('C')).toThrow();
  });
});
