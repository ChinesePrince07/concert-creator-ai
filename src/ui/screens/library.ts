import { buildDemoMidis } from '../../core/demos/pieces';
import { startProject } from '../../state/actions';
import { el, fmtTime, toast } from '../dom';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i;
const MIDI_EXT = /\.(mid|midi)$/i;

export function libraryScreen(): { el: HTMLElement; dispose(): void } {
  const demos = buildDemoMidis();

  const cards = demos.map((d, i) =>
    el(
      'button',
      {
        class: 'prog-card',
        onclick: () => {
          const buf = d.bytes.buffer.slice(
            d.bytes.byteOffset,
            d.bytes.byteOffset + d.bytes.byteLength,
          ) as ArrayBuffer;
          void startProject({ kind: 'midi', data: buf, name: d.name });
        },
      },
      [
        el('span', { class: 'num', text: ROMAN[i] ?? String(i + 1) }),
        el('span', {}, [
          el('span', { class: 't', text: d.name }),
          el('span', { class: 'c', text: `${d.composer} · ${fmtTime(d.duration)}` }),
        ]),
        el('span', { class: 'go', text: 'PERFORM →' }),
      ],
    ),
  );

  const fileInput = el('input', {
    type: 'file',
    accept: '.mid,.midi,audio/*',
    style: 'display:none',
  }) as HTMLInputElement;
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) void handleFile(f);
    fileInput.value = '';
  };

  const dropzone = el(
    'div',
    { class: 'dropzone', onclick: () => fileInput.click() },
    [
      el('span', { html: 'Drop <strong>piano audio</strong> or <strong>MIDI</strong> anywhere — or click to browse' }),
      el('span', { class: 'formats', text: '.MID · .MP3 · .WAV · .OGG · .FLAC' }),
    ],
  );

  const root = el('div', { class: 'screen library' }, [
    el('div', { class: 'library-main' }, [
      el('div', { class: 'masthead' }, [
        el('div', { class: 'overline', text: 'AI Virtual Pianist' }),
        el('h1', { html: 'Concert<br><em>Creator</em>' }),
        el('p', {
          class: 'lede',
          text: 'Give it a recording. It hears the notes, separates the hands, chooses the fingering, and performs the piece on a concert grand — then films it.',
        }),
        el('div', {
          class: 'foot',
          text: 'An unofficial recreation of Concert Creator AI (Massive Technologies, †2022). Everything runs in your browser — nothing is uploaded.',
        }),
      ]),
      el('div', { class: 'programme' }, [
        el('div', { class: 'overline', text: 'Tonight’s Programme' }),
        ...cards,
      ]),
    ]),
    dropzone,
    fileInput,
  ]);

  const onDrag = (e: DragEvent) => {
    e.preventDefault();
    dropzone.classList.add('armed');
  };
  const onLeave = () => dropzone.classList.remove('armed');
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dropzone.classList.remove('armed');
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleFile(f);
  };
  root.addEventListener('dragover', onDrag);
  root.addEventListener('dragleave', onLeave);
  root.addEventListener('drop', onDrop);

  async function handleFile(f: File): Promise<void> {
    const name = f.name.replace(/\.[^.]+$/, '');
    const data = await f.arrayBuffer();
    if (MIDI_EXT.test(f.name)) {
      void startProject({ kind: 'midi', data, name });
    } else if (AUDIO_EXT.test(f.name) || f.type.startsWith('audio/')) {
      void startProject({ kind: 'audio', data, name });
    } else {
      toast('Unsupported file — drop piano audio (.mp3/.wav/…) or MIDI (.mid)');
    }
  }

  return { el: root, dispose() {} };
}
