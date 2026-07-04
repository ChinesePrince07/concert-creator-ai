/** Drift-free frame timestamps in microseconds (computed per frame, not accumulated). */
export function frameTimestampUs(frame: number, fps: number): number {
  return Math.round((frame * 1_000_000) / fps);
}

export function frameDurationUs(fps: number): number {
  return Math.round(1_000_000 / fps);
}

export interface AudioChunkPlan {
  offset: number; // sample offset
  frames: number; // samples in this chunk
  timestampUs: number;
}

/** Slice a PCM stream into fixed-size chunks covering every sample exactly once. */
export function planAudioChunks(
  totalFrames: number,
  sampleRate: number,
  chunkFrames = 960,
): AudioChunkPlan[] {
  const chunks: AudioChunkPlan[] = [];
  for (let offset = 0; offset < totalFrames; offset += chunkFrames) {
    const frames = Math.min(chunkFrames, totalFrames - offset);
    chunks.push({
      offset,
      frames,
      timestampUs: Math.round((offset * 1_000_000) / sampleRate),
    });
  }
  return chunks;
}
