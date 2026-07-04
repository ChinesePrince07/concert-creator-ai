import { describe, expect, it } from 'vitest';
import { importMidi } from '../midi/importer';
import { buildDemoMidis } from './pieces';

describe('buildDemoMidis', () => {
  it('provides at least three importable two-hand demo pieces', () => {
    const demos = buildDemoMidis();
    expect(demos.length).toBeGreaterThanOrEqual(3);
    for (const demo of demos) {
      expect(demo.name.length).toBeGreaterThan(2);
      const buf = demo.bytes.buffer.slice(
        demo.bytes.byteOffset,
        demo.bytes.byteOffset + demo.bytes.byteLength,
      ) as ArrayBuffer;
      const score = importMidi(buf, demo.name);
      expect(score.notes.length, demo.name).toBeGreaterThanOrEqual(30);
      expect(score.handHints, `${demo.name} hand hints`).toBeDefined();
      const dur = Math.max(...score.notes.map((n) => n.end));
      expect(dur).toBeGreaterThan(12);
      expect(dur).toBeLessThan(180);
    }
  });
});
