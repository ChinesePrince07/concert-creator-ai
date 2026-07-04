export interface CodecPlan {
  container: 'mp4' | 'webm';
  videoCodec: string; // WebCodecs codec string
  muxVideo: 'avc' | 'vp9';
  audioCodec: 'mp4a.40.2' | 'opus';
  muxAudio: 'aac' | 'opus';
  label: string;
}

/** H.264 level by pixel rate (coarse but safe). */
function avcCodecString(width: number, height: number, fps: number): string {
  const mbps = (width * height * fps) / 256; // macroblocks/s
  if (mbps > 983040) return 'avc1.640033'; // 5.1
  if (mbps > 245760) return 'avc1.640032'; // 5.0
  if (mbps > 108000) return 'avc1.64002A'; // 4.2
  return 'avc1.640028'; // 4.0
}

export async function pickCodecs(width: number, height: number, fps: number): Promise<CodecPlan> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs is not available in this browser.');
  }
  const avc = avcCodecString(width, height, fps);
  const videoCandidates: Array<{ codec: string; mux: 'avc' | 'vp9'; container: 'mp4' | 'webm' }> = [
    { codec: avc, mux: 'avc', container: 'mp4' },
    { codec: 'vp09.00.41.08', mux: 'vp9', container: 'webm' },
  ];

  let video: (typeof videoCandidates)[0] | null = null;
  for (const c of videoCandidates) {
    const support = await VideoEncoder.isConfigSupported({
      codec: c.codec,
      width,
      height,
      framerate: fps,
      bitrate: videoBitrate(width, height, fps),
    });
    if (support.supported) {
      video = c;
      break;
    }
  }
  if (!video) throw new Error('No supported video encoder (H.264/VP9) found.');

  const audioCandidates: Array<{ codec: 'mp4a.40.2' | 'opus'; mux: 'aac' | 'opus' }> =
    video.container === 'mp4'
      ? [
          { codec: 'mp4a.40.2', mux: 'aac' },
          { codec: 'opus', mux: 'opus' },
        ]
      : [{ codec: 'opus', mux: 'opus' }];

  let audio: (typeof audioCandidates)[0] | null = null;
  for (const c of audioCandidates) {
    const support = await AudioEncoder.isConfigSupported({
      codec: c.codec,
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 192_000,
    });
    if (support.supported) {
      audio = c;
      break;
    }
  }
  if (!audio) throw new Error('No supported audio encoder (AAC/Opus) found.');

  return {
    container: video.container,
    videoCodec: video.codec,
    muxVideo: video.mux,
    audioCodec: audio.codec,
    muxAudio: audio.mux,
    label: `${video.container.toUpperCase()} · ${video.mux === 'avc' ? 'H.264' : 'VP9'} + ${audio.mux.toUpperCase()}`,
  };
}

export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * fps * 0.09);
}
