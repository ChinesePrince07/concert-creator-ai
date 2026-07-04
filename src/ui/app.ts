// Temporary scene-development harness — replaced by the real UI in Task 9.
// Query params: ?piece=0..2 & cam=AUTO|SIDE|TOP|FP|CLOSE|ORBIT & t=<sec> & freeze=1
import { buildDemoMidis } from '../core/demos/pieces';
import { importMidi } from '../core/midi/importer';
import { createConcertScene } from '../scene/stage';
import { buildPerformance } from '../state/pipeline';
import type { CameraMode } from '../scene/cameras';

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `<canvas id="stage" style="position:fixed;inset:0;width:100vw;height:100vh;display:block"></canvas>
  <div id="hud" style="position:fixed;left:12px;bottom:10px;color:#8b8577;font:12px monospace"></div>`;
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;

  const params = new URLSearchParams(location.search);
  const pieceIdx = Number(params.get('piece') ?? '2');
  const cam = (params.get('cam') ?? 'AUTO') as CameraMode;
  const t0 = Number(params.get('t') ?? '0');
  const freeze = params.get('freeze') === '1';

  const demo = buildDemoMidis()[pieceIdx] ?? buildDemoMidis()[0];
  const buf = demo.bytes.buffer.slice(
    demo.bytes.byteOffset,
    demo.bytes.byteOffset + demo.bytes.byteLength,
  ) as ArrayBuffer;
  const imported = importMidi(buf, demo.name);
  const perf = buildPerformance(imported);

  const scene = createConcertScene(canvas);
  scene.setScore(perf.score, perf.choreo, perf.shots);
  scene.setCameraMode(cam);
  const resize = () =>
    scene.resize(window.innerWidth, window.innerHeight, Math.min(devicePixelRatio, 1.5));
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const start = last;
  function loop(): void {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    const t = freeze ? t0 : (t0 + (now - start) / 1000) % perf.score.duration;
    scene.renderAt(t, dt);
    hud.textContent = `${demo.name}  t=${t.toFixed(2)}s  cam=${cam}  notes=${perf.score.notes.length}`;
    (window as unknown as { __sceneReady?: boolean }).__sceneReady = true;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
