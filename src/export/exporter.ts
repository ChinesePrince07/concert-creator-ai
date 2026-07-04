import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import type { PcmResult } from '../core/audio/synth';
import type { ConcertScene } from '../scene/stage';
import { pickCodecs, videoBitrate, type CodecPlan } from './codecs';
import { frameDurationUs, frameTimestampUs, planAudioChunks } from './timestamps';

export interface ExportOptions {
  scene: ConcertScene;
  duration: number;
  pcm: PcmResult;
  width: number;
  height: number;
  fps: number;
  /** render at N× resolution and downscale before encoding (Cinema quality) */
  supersample?: number;
  /** sub-frame samples averaged per frame — 180° shutter motion blur (Cinema) */
  motionBlurSamples?: number;
  onProgress(frame: number, totalFrames: number): void;
  signal: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  codecLine: string;
}

/**
 * Deterministic offline render: choreography and cameras are sampled at
 * frame/fps, so the exported motion is identical to the studio preview.
 */
export async function exportVideo(opts: ExportOptions): Promise<ExportResult> {
  const { scene, duration, pcm, width, height, fps, onProgress, signal } = opts;
  const ss = Math.max(1, Math.min(2, opts.supersample ?? 1));
  const blur = Math.max(1, Math.min(8, opts.motionBlurSamples ?? 1));
  const plan = await pickCodecs(width, height, fps);
  const totalFrames = Math.ceil(duration * fps);

  // supersampled / blur-accumulated frames land on this canvas before encoding
  let frameSource: HTMLCanvasElement | OffscreenCanvas = scene.canvas;
  let downscale: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  if (ss > 1 || blur > 1) {
    const ds =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    ds.width = width;
    ds.height = height;
    const ctx = ds.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    downscale = ctx;
    frameSource = ds;
  }

  const muxer =
    plan.container === 'mp4'
      ? new Mp4Muxer({
          target: new Mp4Target(),
          video: { codec: plan.muxVideo === 'avc' ? 'avc' : 'vp9', width, height },
          audio: {
            codec: plan.muxAudio,
            sampleRate: pcm.sampleRate,
            numberOfChannels: 2,
          },
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        })
      : new WebmMuxer({
          target: new WebmTarget(),
          video: { codec: 'V_VP9', width, height, frameRate: fps },
          audio: { codec: 'A_OPUS', sampleRate: pcm.sampleRate, numberOfChannels: 2 },
          firstTimestampBehavior: 'offset',
        });

  let encoderError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) =>
      (muxer as { addVideoChunk(c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata): void }).addVideoChunk(
        chunk,
        meta,
      ),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });
  videoEncoder.configure({
    codec: plan.videoCodec,
    width,
    height,
    framerate: fps,
    bitrate: videoBitrate(width, height, fps),
    latencyMode: 'quality',
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) =>
      (muxer as { addAudioChunk(c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata): void }).addAudioChunk(
        chunk,
        meta,
      ),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });
  audioEncoder.configure({
    codec: plan.audioCodec,
    sampleRate: pcm.sampleRate,
    numberOfChannels: 2,
    bitrate: 192_000,
  });

  // feed the whole audio track up front (cheap; encoder paces itself)
  const totalSamples = Math.min(pcm.l.length, Math.ceil(duration * pcm.sampleRate));
  for (const chunk of planAudioChunks(totalSamples, pcm.sampleRate, 960)) {
    const data = new Float32Array(chunk.frames * 2);
    data.set(pcm.l.subarray(chunk.offset, chunk.offset + chunk.frames), 0);
    data.set(pcm.r.subarray(chunk.offset, chunk.offset + chunk.frames), chunk.frames);
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: pcm.sampleRate,
      numberOfFrames: chunk.frames,
      numberOfChannels: 2,
      timestamp: chunk.timestampUs,
      data,
    });
    audioEncoder.encode(audioData);
    audioData.close();
  }

  const durationUs = frameDurationUs(fps);
  const keyEvery = fps * 2;

  scene.resize(width * ss, height * ss, 1);

  for (let frame = 0; frame < totalFrames; frame++) {
    if (signal.aborted) {
      videoEncoder.close();
      audioEncoder.close();
      throw new DOMException('Export cancelled', 'AbortError');
    }
    if (encoderError) throw encoderError;

    const t = frame / fps;
    if (downscale) {
      // 180° shutter: average sub-frame samples across half the frame interval
      for (let s = 0; s < blur; s++) {
        const ts = Math.min(t + (s / blur) * (0.5 / fps), duration - 1e-4);
        scene.renderAt(ts, 1 / (fps * blur));
        downscale.globalAlpha = 1 / (s + 1); // running average
        downscale.drawImage(scene.canvas, 0, 0, width, height);
      }
      downscale.globalAlpha = 1;
    } else {
      scene.renderAt(Math.min(t, duration - 1e-4), 1 / fps);
    }
    const vf = new VideoFrame(frameSource, {
      timestamp: frameTimestampUs(frame, fps),
      duration: durationUs,
    });
    videoEncoder.encode(vf, { keyFrame: frame % keyEvery === 0 });
    vf.close();

    if (videoEncoder.encodeQueueSize > 6) await drain(videoEncoder, 6);
    if (frame % 3 === 0) {
      onProgress(frame, totalFrames);
      await nextTick();
    }
  }

  await videoEncoder.flush();
  await audioEncoder.flush();
  if (encoderError) throw encoderError;
  muxer.finalize();
  onProgress(totalFrames, totalFrames);

  const buffer = (muxer.target as InstanceType<typeof Mp4Target> | InstanceType<typeof WebmTarget>).buffer;
  if (!buffer) throw new Error('Muxer produced no output.');
  const ext = plan.container;
  return {
    blob: new Blob([buffer], { type: plan.container === 'mp4' ? 'video/mp4' : 'video/webm' }),
    fileName: `concert.${ext}`,
    codecLine: plan.label,
  };
}

function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function drain(encoder: VideoEncoder, until: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (encoder.encodeQueueSize <= until || encoder.state !== 'configured') resolve();
      else setTimeout(check, 4);
    };
    check();
  });
}
