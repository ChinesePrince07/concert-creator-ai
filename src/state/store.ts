import type { PcmResult } from '../core/audio/synth';
import type { ImportedScore, NoteEdit } from '../core/types';
import type { CameraMode, VisualSettings } from '../scene/stage';
import { DEFAULT_VISUALS } from '../scene/stage';
import type { Performance } from './pipeline';

export type Phase = 'library' | 'processing' | 'studio';

export interface StageState {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  /** 0..1 for stages that report granular progress */
  progress?: number;
  ms?: number;
  detail?: string;
}

export interface ProjectState {
  name: string;
  imported: ImportedScore;
  perf: Performance;
  audio: { kind: 'file' | 'synth'; pcm: PcmResult };
  edits: NoteEdit[];
}

export interface TransportState {
  playing: boolean;
  t: number;
  speed: number;
  loop: boolean;
}

export interface RenderJob {
  status: 'configuring' | 'rendering' | 'done' | 'error' | 'cancelled';
  width: number;
  height: number;
  fps: number;
  frame: number;
  totalFrames: number;
  startedAt?: number;
  blob?: Blob;
  fileName?: string;
  error?: string;
  codecLine?: string;
}

export interface AppState {
  phase: Phase;
  processing?: { pieceName: string; stages: StageState[]; error?: string };
  project?: ProjectState;
  visuals: VisualSettings;
  cameraMode: CameraMode;
  transport: TransportState;
  renderJob?: RenderJob;
  editMode: boolean;
  selectedNoteId?: string;
}

export type Listener = (state: AppState) => void;

export class Store {
  private state: AppState = {
    phase: 'library',
    visuals: { ...DEFAULT_VISUALS },
    cameraMode: 'AUTO',
    transport: { playing: false, t: 0, speed: 1, loop: false },
    editMode: false,
  };
  private listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  update(fn: (s: AppState) => Partial<AppState> | void): void {
    const patch = fn(this.state);
    if (patch) this.state = { ...this.state, ...patch };
    else this.state = { ...this.state };
    for (const l of this.listeners) l(this.state);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const store = new Store();
