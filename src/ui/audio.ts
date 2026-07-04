import type { PcmResult } from '../core/audio/synth';

/** WebAudio playback of the project PCM with seek/rate; time source for the studio. */
export class PlaybackEngine {
  private ctx: AudioContext | null = null;
  private pcm: PcmResult | null = null;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startCtxTime = 0;
  private startOffset = 0;
  private rate = 1;
  private _playing = false;

  setPcm(pcm: PcmResult): void {
    this.pcm = pcm;
    this.buffer = null;
    if (this._playing) {
      const t = this.current();
      this.play(t);
    }
  }

  get playing(): boolean {
    return this._playing;
  }

  get playbackRate(): number {
    return this.rate;
  }

  private ensure(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (!this.buffer && this.pcm) {
      const b = this.ctx.createBuffer(2, this.pcm.l.length, this.pcm.sampleRate);
      b.copyToChannel(this.pcm.l as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel(this.pcm.r as Float32Array<ArrayBuffer>, 1);
      this.buffer = b;
    }
    return this.ctx;
  }

  play(offset: number): void {
    const ctx = this.ensure();
    if (!this.buffer) return;
    void ctx.resume();
    this.stopSource();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(ctx.destination);
    const at = Math.min(Math.max(0, offset), this.buffer.duration - 0.01);
    src.start(0, at);
    const self = this;
    src.onended = () => {
      if (self.src === src) self._playing = false;
    };
    this.src = src;
    this.startCtxTime = ctx.currentTime;
    this.startOffset = at;
    this._playing = true;
  }

  pause(): number {
    const t = this.current();
    this.stopSource();
    this._playing = false;
    this.startOffset = t;
    return t;
  }

  seek(t: number): void {
    if (this._playing) this.play(t);
    else this.startOffset = Math.max(0, t);
  }

  setRate(r: number): void {
    if (this._playing) {
      const t = this.current();
      this.rate = r;
      this.play(t);
    } else {
      this.rate = r;
    }
  }

  current(): number {
    if (!this._playing || !this.ctx) return this.startOffset;
    return this.startOffset + (this.ctx.currentTime - this.startCtxTime) * this.rate;
  }

  private stopSource(): void {
    if (this.src) {
      this.src.onended = null;
      try {
        this.src.stop();
      } catch {
        /* not started */
      }
      this.src.disconnect();
      this.src = null;
    }
  }

  dispose(): void {
    this.stopSource();
    void this.ctx?.close();
    this.ctx = null;
  }
}
