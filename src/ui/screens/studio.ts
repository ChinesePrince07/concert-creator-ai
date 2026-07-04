import { MIDI_MIN } from '../../core/keyboard';
import type { PerformanceNote } from '../../core/types';
import type { CameraMode } from '../../scene/cameras';
import { CHARACTERS, createConcertScene, PIANO_MODELS, type ConcertScene } from '../../scene/stage';
import { applyEdit, backToLibrary } from '../../state/actions';
import { store, type AppState, type ProjectState } from '../../state/store';
import { PlaybackEngine } from '../audio';
import { el, fmtTime, ICONS, svgIcon } from '../dom';
import { openRenderModal } from './renderModal';

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const CAMERA_MODES: Array<{ id: CameraMode; label: string }> = [
  { id: 'AUTO', label: 'CINEMA' },
  { id: 'SIDE', label: 'SIDE' },
  { id: 'CLOSE', label: 'CLOSE' },
  { id: 'ORBIT', label: 'ORBIT' },
  { id: 'TOP', label: 'TOP VIEW' },
  { id: 'FP', label: 'FIRST PERSON' },
];
const HAND_PALETTES: Array<{ l: string; r: string; name: string }> = [
  { l: '#3f8cff', r: '#3ecf5a', name: 'Classic' },
  { l: '#53d5ff', r: '#ffb454', name: 'Stage' },
  { l: '#9d8cff', r: '#ffd54f', name: 'Nocturne' },
  { l: '#ff7ab6', r: '#7ab8ff', name: 'Neon' },
];

function midiName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function studioScreen(initial: AppState): {
  el: HTMLElement;
  update(s: AppState): void;
  dispose(): void;
} {
  let project = initial.project!;
  let scene: ConcertScene;
  const engine = new PlaybackEngine();
  engine.setPcm(project.audio.pcm);

  let t = 0;
  let rafId = 0;
  let lastNow = performance.now();
  let openPanel: 'camera' | 'visuals' | 'pianist' | null = null;
  let editMode = false;
  let selectedId: string | null = null;
  let exporting = false;

  // ---------- DOM ----------
  const canvas = el('canvas', { class: 'stage3d' }) as HTMLCanvasElement;

  const timeLabel = el('span', { class: 'time' });
  const timelineFill = el('div', { class: 'fill' });
  const timelineHead = el('div', { class: 'head' });
  const timeline = el('div', { class: 'timeline' }, [
    el('div', { class: 'track' }),
    timelineFill,
    timelineHead,
  ]);
  const playBtn = el('button', { class: 'playbtn', 'aria-label': 'Play' });
  const speedBtn = el('button', { class: 'mini', text: 'SPEED ×1' });
  const loopBtn = el('button', { class: 'mini', text: 'LOOP' });
  const editBtn = el('button', { class: 'mini', text: 'EDIT ANIMATION' });

  const transport = el('div', { class: 'transport' }, [
    timeline,
    el('div', { class: 'controls' }, [
      playBtn,
      timeLabel,
      el('span', { class: 'spacer' }),
      editBtn,
      speedBtn,
      loopBtn,
    ]),
  ]);

  const railButtons: Record<string, HTMLButtonElement> = {
    camera: railBtn('camera', 'CAMERA'),
    pianist: railBtn('pianist', 'PIANIST'),
    visuals: railBtn('visuals', 'VISUALS'),
    animation: railBtn('animation', 'ANIMATE'),
    render: railBtn('render', 'RENDER'),
  };
  railButtons.render.classList.add('render-btn');
  const rail = el('div', { class: 'rail' }, Object.values(railButtons));

  const panelHost = el('div', {});
  const stripHost = el('div', {});

  const root = el('div', { class: 'screen studio' }, [
    canvas,
    el('div', { class: 'topbar' }, [
      el('div', { class: 'brand' }, [
        el('span', { class: 'mark', text: 'Concert Creator' }),
        el('span', { class: 'piece', text: project.name }),
      ]),
      el('button', { class: 'ghost back', text: '← LIBRARY', onclick: () => backToLibrary() }),
    ]),
    rail,
    panelHost,
    stripHost,
    transport,
  ]);

  function railBtn(icon: keyof typeof ICONS, label: string): HTMLButtonElement {
    const b = el('button', {}, [svgIcon(ICONS[icon]), el('span', { text: label })]);
    return b as HTMLButtonElement;
  }

  // ---------- scene ----------
  function mountScene(): void {
    scene = createConcertScene(canvas);
    scene.setScore(project.perf.score, project.perf.choreo, project.perf.shots);
    scene.setVisuals(store.get().visuals);
    scene.setCameraMode(store.get().cameraMode);
    resize();
  }

  function resize(): void {
    if (exporting) return;
    scene.resize(window.innerWidth, window.innerHeight, Math.min(devicePixelRatio, 1.5));
  }

  const duration = () => project.perf.score.duration;

  // ---------- render loop ----------
  function loop(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    if (!exporting) {
      if (engine.playing) {
        t = engine.current();
        if (t >= duration() - 0.02) {
          if (store.get().transport.loop) {
            engine.play(0);
            t = 0;
          } else {
            engine.pause();
            setPlayingUI(false);
            t = duration() - 0.02;
          }
        }
      }
      scene.renderAt(Math.min(t, duration() - 1e-3), dt);
      updateTransportUI();
      if (editMode) drawStrip();
    }
    rafId = requestAnimationFrame(loop);
  }

  // ---------- transport ----------
  function setPlayingUI(playing: boolean): void {
    playBtn.innerHTML = '';
    playBtn.append(svgIcon(playing ? ICONS.pause : ICONS.play));
  }

  function togglePlay(): void {
    if (engine.playing) {
      t = engine.pause();
      setPlayingUI(false);
    } else {
      if (t >= duration() - 0.05) t = 0;
      engine.play(t);
      setPlayingUI(true);
    }
  }

  function updateTransportUI(): void {
    const d = duration();
    const pct = Math.min(1, t / d) * 100;
    timelineFill.style.width = `${pct}%`;
    timelineHead.style.left = `${pct}%`;
    timeLabel.innerHTML = `<b>${fmtTime(t)}</b> / ${fmtTime(d)}`;
  }

  function seekFromEvent(e: MouseEvent): void {
    const rect = timeline.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    t = frac * duration();
    engine.seek(t);
  }

  timeline.onmousedown = (e) => {
    seekFromEvent(e);
    const move = (ev: MouseEvent) => seekFromEvent(ev);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  playBtn.onclick = togglePlay;

  const SPEEDS = [1, 0.75, 0.5, 1.25];
  speedBtn.onclick = () => {
    const cur = SPEEDS.indexOf(engine.playbackRate);
    const next = SPEEDS[(cur + 1) % SPEEDS.length];
    engine.setRate(next);
    speedBtn.textContent = `SPEED ×${next}`;
  };
  loopBtn.onclick = () => {
    store.update((s) => ({ transport: { ...s.transport, loop: !s.transport.loop } }));
    loopBtn.classList.toggle('on', store.get().transport.loop);
  };
  editBtn.onclick = () => toggleEdit();

  // phrase ticks
  for (const p of project.perf.score.phrases) {
    const tick = el('div', { class: 'phrase-tick' });
    tick.style.left = `${(p.start / duration()) * 100}%`;
    timeline.append(tick);
  }

  // ---------- rail / panels ----------
  railButtons.camera.onclick = () => setPanel(openPanel === 'camera' ? null : 'camera');
  railButtons.pianist.onclick = () => setPanel(openPanel === 'pianist' ? null : 'pianist');
  railButtons.visuals.onclick = () => setPanel(openPanel === 'visuals' ? null : 'visuals');
  railButtons.animation.onclick = () => toggleEdit();
  railButtons.render.onclick = () => {
    if (exporting) return;
    if (engine.playing) togglePlay();
    openRenderModal({
      scene,
      project,
      onExportingChange: (on) => {
        exporting = on;
        if (!on) {
          resize();
          scene.setQuality('preview');
          scene.setCameraMode(store.get().cameraMode);
        }
      },
    });
  };

  function setPanel(p: typeof openPanel): void {
    openPanel = p;
    railButtons.camera.classList.toggle('on', p === 'camera');
    railButtons.pianist.classList.toggle('on', p === 'pianist');
    railButtons.visuals.classList.toggle('on', p === 'visuals');
    panelHost.innerHTML = '';
    if (p === 'camera') panelHost.append(cameraPanel());
    if (p === 'pianist') panelHost.append(pianistPanel());
    if (p === 'visuals') panelHost.append(visualsPanel());
  }

  function pianistPanel(): HTMLElement {
    const list = el('div', {});
    const current = store.get().visuals.character;
    for (const c of CHARACTERS) {
      const b = el(
        'button',
        { class: `char-card ${c.id === current ? 'on' : ''}` },
        [
          el('span', { class: 'cn', text: c.name }),
          el('span', { class: 'cb', text: c.blurb }),
        ],
      );
      b.onclick = () => {
        setVisuals({ character: c.id });
        list.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      list.append(b);
    }
    return el('div', { class: 'panel' }, [
      el('h3', { text: 'Pianist' }),
      el('div', { class: 'group' }, [el('label', { text: 'Character' }), list]),
    ]);
  }

  function cameraPanel(): HTMLElement {
    const seg = el('div', { class: 'seg wrap' });
    const current = store.get().cameraMode;
    for (const m of CAMERA_MODES) {
      const b = el('button', { text: m.label, class: m.id === current ? 'on' : '' });
      b.onclick = () => {
        store.update(() => ({ cameraMode: m.id }));
        scene.setCameraMode(m.id);
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      seg.append(b);
    }
    return el('div', { class: 'panel' }, [
      el('h3', { text: 'Camera' }),
      el('div', { class: 'group' }, [el('label', { text: 'Mode' }), seg]),
      el('div', {
        class: 'group',
        html: `<label>Note</label><span style="color:var(--ink-dim);font-size:11px">Cinema cuts itself to the music. Top View &amp; First Person show the falling-note roll.</span>`,
      }),
    ]);
  }

  function visualsPanel(): HTMLElement {
    const v = store.get().visuals;

    const moodSeg = el('div', { class: 'seg' });
    for (const mood of ['noir', 'warm', 'blue'] as const) {
      const b = el('button', { text: mood.toUpperCase(), class: v.lightMood === mood ? 'on' : '' });
      b.onclick = () => {
        setVisuals({ lightMood: mood });
        moodSeg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      moodSeg.append(b);
    }

    const swatches = el('div', { class: 'swatches' });
    HAND_PALETTES.forEach((p) => {
      const on = v.leftColor === p.l && v.rightColor === p.r;
      const b = el('button', {
        class: `swatch ${on ? 'on' : ''}`,
        title: p.name,
        style: `background: linear-gradient(135deg, ${p.l} 50%, ${p.r} 50%)`,
      });
      b.onclick = () => {
        setVisuals({ leftColor: p.l, rightColor: p.r });
        swatches.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      swatches.append(b);
    });

    const avatarToggle = el('button', { class: `toggle ${v.showAvatar ? 'on' : ''}` });
    avatarToggle.onclick = () => {
      const next = !store.get().visuals.showAvatar;
      setVisuals({ showAvatar: next });
      avatarToggle.classList.toggle('on', next);
    };

    const zoom = el('input', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(v.rollZoom) }) as HTMLInputElement;
    zoom.oninput = () => setVisuals({ rollZoom: Number(zoom.value) });

    const SHORT: Record<string, string> = {
      steinway: 'STEINWAY & SONS',
      yamaha: 'YAMAHA CFX',
      bosendorfer: 'BÖSENDORFER',
      kawai: 'SHIGERU KAWAI',
      fazioli: 'FAZIOLI',
    };
    const pianoSeg = el('div', { class: 'seg wrap' });
    for (const m of PIANO_MODELS) {
      const b = el('button', {
        text: SHORT[m.id],
        title: `${m.name} — ${m.blurb}`,
        class: v.pianoModel === m.id ? 'on' : '',
      });
      b.onclick = () => {
        setVisuals({ pianoModel: m.id });
        pianoSeg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      pianoSeg.append(b);
    }

    return el('div', { class: 'panel' }, [
      el('h3', { text: 'Visuals' }),
      el('div', { class: 'group' }, [el('label', { text: 'Piano' }), pianoSeg]),
      el('div', { class: 'group' }, [el('label', { text: 'Lighting' }), moodSeg]),
      el('div', { class: 'group' }, [el('label', { text: 'Hand colours — L / R' }), swatches]),
      el('div', { class: 'group' }, [
        el('div', { class: 'row' }, [el('span', { text: 'Show pianist' }), avatarToggle]),
      ]),
      el('div', { class: 'group' }, [el('label', { text: 'Roll zoom (Top / First Person)' }), zoom]),
    ]);
  }

  function setVisuals(patch: Partial<AppState['visuals']>): void {
    store.update((s) => ({ visuals: { ...s.visuals, ...patch } }));
    scene.setVisuals(store.get().visuals);
  }

  // ---------- edit mode ----------
  const stripCanvas = el('canvas') as HTMLCanvasElement;
  const popHost = el('div', {});
  const strip = el('div', { class: 'editstrip' }, [
    stripCanvas,
    el('div', { class: 'hint', text: 'Click a note · 1–5 finger · H hand · Q mute · ←→ navigate · Esc close' }),
    el('div', { class: 'actions' }, [
      el('button', { text: 'DONE', onclick: () => toggleEdit() }),
    ]),
    popHost,
  ]);

  function toggleEdit(): void {
    editMode = !editMode;
    railButtons.animation.classList.toggle('on', editMode);
    editBtn.classList.toggle('on', editMode);
    if (editMode) {
      stripHost.append(strip);
      requestAnimationFrame(() => {
        fitStrip();
        drawStrip();
      });
    } else {
      selectedId = null;
      popHost.innerHTML = '';
      strip.remove();
    }
  }

  function fitStrip(): void {
    const rect = strip.getBoundingClientRect();
    stripCanvas.width = rect.width * devicePixelRatio;
    stripCanvas.height = rect.height * devicePixelRatio;
  }

  function notes(): PerformanceNote[] {
    return project.perf.score.notes;
  }

  function drawStrip(): void {
    const ctx = stripCanvas.getContext('2d');
    if (!ctx) return;
    const W = stripCanvas.width;
    const H = stripCanvas.height;
    const d = duration();
    ctx.clearRect(0, 0, W, H);
    const v = store.get().visuals;
    const yFor = (midi: number) => H - 18 - ((midi - MIDI_MIN) / 87) * (H - 40);
    const noteH = Math.max(2.5 * devicePixelRatio, H / 120);
    for (const n of notes()) {
      const x = (n.start / d) * W;
      const w = Math.max(2, ((n.end - n.start) / d) * W);
      ctx.globalAlpha = n.disabled ? 0.22 : 0.92;
      ctx.fillStyle = n.hand === 'L' ? v.leftColor : v.rightColor;
      ctx.fillRect(x, yFor(n.midi), w, noteH);
      if (n.pinned) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ece5d6';
        ctx.fillRect(x, yFor(n.midi) - 2, 2, noteH + 4);
      }
      if (n.id === selectedId) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1.5, yFor(n.midi) - 1.5, w + 3, noteH + 3);
      }
    }
    // playhead
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#d9a441';
    ctx.fillRect((t / d) * W, 0, 1.5 * devicePixelRatio, H);
    ctx.globalAlpha = 1;
  }

  stripCanvas.onmousedown = (e) => {
    const rect = stripCanvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * stripCanvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * stripCanvas.height;
    const d = duration();
    const H = stripCanvas.height;
    const yFor = (midi: number) => H - 18 - ((midi - MIDI_MIN) / 87) * (H - 40);
    let best: PerformanceNote | null = null;
    let bestDist = 12 * devicePixelRatio;
    for (const n of notes()) {
      const x0 = (n.start / d) * stripCanvas.width;
      const x1 = x0 + Math.max(2, ((n.end - n.start) / d) * stripCanvas.width);
      const y = yFor(n.midi);
      const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
      const dy = Math.abs(py - y);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    if (best) selectNote(best.id, e.clientX);
    else {
      selectedId = null;
      popHost.innerHTML = '';
    }
  };

  function selectNote(id: string, clientX?: number): void {
    selectedId = id;
    const n = notes().find((x) => x.id === id);
    if (!n) return;
    // seek preview to just before the note
    t = Math.max(0, n.start - 0.35);
    engine.seek(t);
    showPopover(n, clientX);
    drawStrip();
  }

  function showPopover(n: PerformanceNote, clientX?: number): void {
    popHost.innerHTML = '';
    const handSeg = el('div', { class: 'seg' });
    (['L', 'R'] as const).forEach((h) => {
      const b = el('button', { text: h === 'L' ? 'LEFT' : 'RIGHT', class: n.hand === h ? 'on' : '' });
      b.onclick = () => applyAndRefresh({ id: n.id, hand: h });
      handSeg.append(b);
    });
    const fingerSeg = el('div', { class: 'seg' });
    ([1, 2, 3, 4, 5] as const).forEach((f) => {
      const b = el('button', { text: String(f), class: n.finger === f ? 'on' : '' });
      b.onclick = () => applyAndRefresh({ id: n.id, finger: f });
      fingerSeg.append(b);
    });
    const muteBtn = el('button', {
      text: n.disabled ? 'UNMUTE NOTE' : 'MUTE NOTE (Q)',
      onclick: () => applyAndRefresh({ id: n.id, disabled: !n.disabled }),
    });

    const pop = el('div', { class: 'notepop' }, [
      el('div', { class: 'nt' }, [
        el('b', { text: `${midiName(n.midi)}` }),
        el('span', { text: `${n.start.toFixed(2)}s · ${n.hand}${n.finger}` }),
      ]),
      el('div', { class: 'group' }, [el('label', { text: 'Hand' }), handSeg]),
      el('div', { class: 'group' }, [el('label', { text: 'Finger (1 = thumb)' }), fingerSeg]),
      muteBtn,
    ]);
    const stripRect = strip.getBoundingClientRect();
    const x = Math.min(Math.max((clientX ?? stripRect.left + 40) - stripRect.left - 105, 8), stripRect.width - 218);
    pop.style.left = `${x}px`;
    pop.style.bottom = `${stripRect.height + 8}px`;
    popHost.append(pop);
  }

  function applyAndRefresh(edit: Parameters<typeof applyEdit>[0]): void {
    applyEdit(edit);
    project = store.get().project!;
    scene.setScore(project.perf.score, project.perf.choreo, project.perf.shots);
    engine.setPcm(project.audio.pcm);
    const n = notes().find((x) => x.id === edit.id);
    if (n) showPopover(n);
    drawStrip();
  }

  // ---------- keyboard ----------
  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      toggleEdit();
      return;
    }
    if (!editMode) return;
    const list = notes();
    const idx = list.findIndex((n) => n.id === selectedId);
    if (e.key === 'ArrowRight') {
      const next = list[Math.min(list.length - 1, idx < 0 ? 0 : idx + 1)];
      if (next) selectNote(next.id);
    } else if (e.key === 'ArrowLeft') {
      const prev = list[Math.max(0, idx < 0 ? 0 : idx - 1)];
      if (prev) selectNote(prev.id);
    } else if (selectedId && /^[1-5]$/.test(e.key)) {
      applyAndRefresh({ id: selectedId, finger: Number(e.key) as 1 | 2 | 3 | 4 | 5 });
    } else if (selectedId && (e.key === 'h' || e.key === 'H')) {
      const n = list.find((x) => x.id === selectedId);
      if (n) applyAndRefresh({ id: selectedId, hand: n.hand === 'L' ? 'R' : 'L' });
    } else if (selectedId && (e.key === 'q' || e.key === 'Q')) {
      const n = list.find((x) => x.id === selectedId);
      if (n) applyAndRefresh({ id: selectedId, disabled: !n.disabled });
    } else if (e.key === 'Escape') {
      selectedId = null;
      popHost.innerHTML = '';
      drawStrip();
    }
  }

  // ---------- lifecycle ----------
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKey);
  mountScene();
  setPlayingUI(false);
  updateTransportUI();
  lastNow = performance.now();
  rafId = requestAnimationFrame(loop);

  return {
    el: root,
    update(s: AppState) {
      if (s.project && s.project !== project) {
        project = s.project;
      }
    },
    dispose() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey);
      engine.dispose();
      scene.dispose();
    },
  };
}
