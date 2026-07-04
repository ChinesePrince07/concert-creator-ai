import { bakeForBlender } from '../../export/blenderBake';
import { exportVideo } from '../../export/exporter';
import { pickCodecs } from '../../export/codecs';
import type { ConcertScene } from '../../scene/stage';
import type { ProjectState } from '../../state/store';
import { el, fmtTime, toast } from '../dom';

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function pcmToWavBlob(l: Float32Array, r: Float32Array, sampleRate: number): Blob {
  const frames = l.length;
  const buf = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + frames * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    v.setInt16(44 + i * 4, Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), true);
    v.setInt16(46 + i * 4, Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

const RESOLUTIONS = [
  { label: '720p', w: 1280, h: 720 },
  { label: '1080p', w: 1920, h: 1080 },
  { label: '1440p', w: 2560, h: 1440 },
];

export function openRenderModal(opts: {
  scene: ConcertScene;
  project: ProjectState;
  onExportingChange(on: boolean): void;
}): void {
  const { scene, project } = opts;
  let res = RESOLUTIONS[1];
  let fps = 30;
  let controller: AbortController | null = null;

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' });
  backdrop.append(modal);
  document.body.append(backdrop);

  backdrop.onclick = (e) => {
    if (e.target === backdrop && !controller) close();
  };

  function close(): void {
    controller?.abort();
    controller = null;
    backdrop.remove();
  }

  function estimate(): string {
    const frames = Math.ceil(project.perf.score.duration * fps);
    const mb = (res.w * res.h * fps * 0.09 * project.perf.score.duration) / 8 / 1e6;
    return `${frames.toLocaleString()} frames · ≈${mb < 100 ? mb.toFixed(0) : Math.round(mb / 10) * 10} MB · offline render, roughly 1–4× realtime`;
  }

  function renderConfig(): void {
    modal.innerHTML = '';
    const resSeg = el('div', { class: 'seg' });
    RESOLUTIONS.forEach((r) => {
      const b = el('button', { text: r.label, class: r === res ? 'on' : '' });
      b.onclick = () => {
        res = r;
        renderConfig();
      };
      resSeg.append(b);
    });
    const fpsSeg = el('div', { class: 'seg' });
    [30, 60].forEach((f) => {
      const b = el('button', { text: `${f} FPS`, class: f === fps ? 'on' : '' });
      b.onclick = () => {
        fps = f;
        renderConfig();
      };
      fpsSeg.append(b);
    });

    const codecLine = el('div', { class: 'meta', text: 'Probing encoders…' });
    void pickCodecs(res.w, res.h, fps)
      .then((p) => {
        codecLine.textContent = `${p.label} · ${estimate()}`;
      })
      .catch((e) => {
        codecLine.textContent = `⚠ ${e instanceof Error ? e.message : e}`;
      });

    modal.append(
      el('h3', { text: 'Render performance' }),
      el('div', { class: 'sub', text: `${project.name} · ${fmtTime(project.perf.score.duration)}` }),
      el('div', { class: 'group' }, [el('label', { text: 'Resolution' }), resSeg]),
      el('div', { class: 'group' }, [el('label', { text: 'Frame rate' }), fpsSeg]),
      codecLine,
      el('div', { class: 'actions' }, [
        el('button', {
          class: 'ghost',
          text: 'EXPORT FOR BLENDER',
          title: 'Bake the performance + camera to JSON and audio to WAV for offline photoreal rendering (see docs/BLENDER.md)',
          onclick: () => {
            const bake = bakeForBlender(project.perf.score, project.perf.choreo, project.perf.shots, fps);
            downloadBlob(new Blob([JSON.stringify(bake)], { type: 'application/json' }), 'performance.json');
            downloadBlob(
              pcmToWavBlob(project.audio.pcm.l, project.audio.pcm.r, project.audio.pcm.sampleRate),
              'performance.wav',
            );
            toast('Baked performance.json + performance.wav — see docs/BLENDER.md');
          },
        }),
        el('span', { class: 'spacer', style: 'flex:1' }),
        el('button', { class: 'ghost', text: 'CANCEL', onclick: () => close() }),
        el('button', { class: 'primary', text: 'RENDER', onclick: () => start() }),
      ]),
    );
  }

  function renderProgress(frame: number, total: number, startedAt: number): void {
    const pct = total > 0 ? frame / total : 0;
    const elapsed = (performance.now() - startedAt) / 1000;
    const eta = frame > 10 ? (elapsed / frame) * (total - frame) : NaN;
    modal.innerHTML = '';
    modal.append(
      el('h3', { text: 'Rendering…' }),
      el('div', { class: 'sub', text: `${res.label} · ${fps} fps — the stage is being filmed frame by frame` }),
      el('div', { class: 'bigpct', text: `${Math.floor(pct * 100)}%` }),
      el('div', {
        class: 'frameline',
        text: `frame ${frame.toLocaleString()} / ${total.toLocaleString()}${Number.isFinite(eta) ? ` · ~${fmtTime(eta)} left` : ''}`,
      }),
      el('div', { class: 'bar' }, [
        (() => {
          const f = el('div', { class: 'f' });
          f.style.width = `${pct * 100}%`;
          return f;
        })(),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'ghost', text: 'CANCEL RENDER', onclick: () => cancel() }),
      ]),
    );
  }

  function renderDone(blob: Blob, fileName: string, codec: string, seconds: number): void {
    const url = URL.createObjectURL(blob);
    modal.innerHTML = '';
    modal.append(
      el('h3', { text: 'Your concert is ready' }),
      el('div', {
        class: 'sub',
        text: `${(blob.size / 1e6).toFixed(1)} MB · ${codec} · rendered in ${fmtTime(seconds)}`,
      }),
      el('div', { class: 'meta', text: 'The avatar performance, camera direction and audio are baked into a standard video file.' }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'ghost', text: 'CLOSE', onclick: () => close() }),
        el('button', {
          class: 'primary',
          text: `DOWNLOAD ${fileName.split('.').pop()?.toUpperCase()}`,
          onclick: () => {
            const a = el('a', { href: url, download: fileName });
            a.click();
          },
        }),
      ]),
    );
  }

  function renderError(msg: string): void {
    modal.innerHTML = '';
    modal.append(
      el('h3', { text: 'Render failed' }),
      el('div', { class: 'meta', text: msg }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'ghost', text: 'CLOSE', onclick: () => close() }),
        el('button', { class: 'primary', text: 'TRY AGAIN', onclick: () => renderConfig() }),
      ]),
    );
  }

  function cancel(): void {
    controller?.abort();
  }

  async function start(): Promise<void> {
    controller = new AbortController();
    const startedAt = performance.now();
    opts.onExportingChange(true);
    scene.setQuality('export');
    // export whatever view is active — Cinema, Synthesia Top View, First Person…
    scene.resize(res.w, res.h, 1);
    renderProgress(0, Math.ceil(project.perf.score.duration * fps), startedAt);
    try {
      const result = await exportVideo({
        scene,
        duration: project.perf.score.duration,
        pcm: project.audio.pcm,
        width: res.w,
        height: res.h,
        fps,
        signal: controller.signal,
        onProgress: (frame, total) => renderProgress(frame, total, startedAt),
      });
      controller = null;
      opts.onExportingChange(false);
      renderDone(result.blob, result.fileName, result.codecLine, (performance.now() - startedAt) / 1000);
    } catch (err) {
      controller = null;
      opts.onExportingChange(false);
      if (err instanceof DOMException && err.name === 'AbortError') {
        renderConfig();
      } else {
        renderError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  renderConfig();
}
