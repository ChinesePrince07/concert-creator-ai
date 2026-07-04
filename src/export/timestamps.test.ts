import { describe, expect, it } from 'vitest';
import { frameTimestampUs, planAudioChunks } from './timestamps';

describe('frameTimestampUs', () => {
  it('is exact at whole seconds and never drifts over 10 minutes', () => {
    for (const fps of [30, 60]) {
      expect(frameTimestampUs(fps, fps)).toBe(1_000_000);
      expect(frameTimestampUs(fps * 600, fps)).toBe(600_000_000);
      for (let f = 0; f < fps * 600; f += 997) {
        const exact = (f * 1_000_000) / fps;
        expect(Math.abs(frameTimestampUs(f, fps) - exact)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('is strictly increasing', () => {
    let prev = -1;
    for (let f = 0; f < 2000; f++) {
      const ts = frameTimestampUs(f, 60);
      expect(ts).toBeGreaterThan(prev);
      prev = ts;
    }
  });
});

describe('planAudioChunks', () => {
  it('covers every sample exactly once including a partial tail', () => {
    const total = 48000 * 3 + 123;
    const chunks = planAudioChunks(total, 48000, 960);
    let covered = 0;
    let expectedOffset = 0;
    for (const c of chunks) {
      expect(c.offset).toBe(expectedOffset);
      expectedOffset += c.frames;
      covered += c.frames;
      expect(c.frames).toBeGreaterThan(0);
      expect(c.frames).toBeLessThanOrEqual(960);
    }
    expect(covered).toBe(total);
    expect(chunks[chunks.length - 1].frames).toBe(123 + 48000 * 3 - 960 * Math.floor(total / 960));
  });

  it('timestamps match sample offsets', () => {
    const chunks = planAudioChunks(48000, 48000, 960);
    expect(chunks[0].timestampUs).toBe(0);
    expect(chunks[1].timestampUs).toBe(20_000);
    expect(chunks[25].timestampUs).toBe(500_000);
  });
});
