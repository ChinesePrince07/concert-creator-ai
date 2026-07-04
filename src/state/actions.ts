import type { NoteEdit } from '../core/types';
import { toast } from '../ui/dom';
import { regenerate, runPipeline, type PipelineInput } from './pipeline';
import { store, type StageState } from './store';

export async function startProject(input: PipelineInput): Promise<void> {
  const stages: StageState[] = [];
  store.update((s) => ({
    phase: 'processing',
    processing: { pieceName: input.name, stages },
    project: undefined,
    editMode: false,
    selectedNoteId: undefined,
    transport: { ...s.transport, playing: false, t: 0 },
  }));

  let startedAt = 0;
  const reporter = {
    start(label: string) {
      startedAt = performance.now();
      stages.push({ label, status: 'active' });
      store.update(() => ({ processing: { pieceName: input.name, stages: [...stages] } }));
    },
    progress(pct: number) {
      const cur = stages[stages.length - 1];
      if (cur) cur.progress = pct;
      store.update(() => ({ processing: { pieceName: input.name, stages: [...stages] } }));
    },
    done(detail?: string) {
      const cur = stages[stages.length - 1];
      if (cur) {
        cur.status = 'done';
        cur.ms = performance.now() - startedAt;
        cur.detail = detail;
        cur.progress = undefined;
      }
      store.update(() => ({ processing: { pieceName: input.name, stages: [...stages] } }));
    },
  };

  try {
    const result = await runPipeline(input, reporter);
    store.update(() => ({
      phase: 'studio',
      project: {
        name: input.name,
        imported: result.imported,
        perf: result.perf,
        audio: result.audio,
        edits: [],
      },
    }));
  } catch (err) {
    const cur = stages[stages.length - 1];
    if (cur && cur.status === 'active') cur.status = 'error';
    store.update(() => ({
      processing: {
        pieceName: input.name,
        stages: [...stages],
        error: err instanceof Error ? err.message : String(err),
      },
    }));
  }
}

export function applyEdit(edit: NoteEdit): void {
  const s = store.get();
  const project = s.project;
  if (!project) return;
  const edits = [...project.edits.filter((e) => e.id !== edit.id)];
  const existing = project.edits.find((e) => e.id === edit.id);
  edits.push({ ...existing, ...edit });

  const t0 = performance.now();
  const { perf, pcm } = regenerate(project.imported, edits, project.audio.kind);
  store.update(() => ({
    project: {
      ...project,
      edits,
      perf,
      audio: pcm ? { kind: 'synth', pcm } : project.audio,
    },
  }));
  toast(`Performance regenerated in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
}

export function backToLibrary(): void {
  store.update((s) => ({
    phase: 'library',
    project: undefined,
    processing: undefined,
    editMode: false,
    renderJob: undefined,
    transport: { ...s.transport, playing: false, t: 0 },
  }));
}
