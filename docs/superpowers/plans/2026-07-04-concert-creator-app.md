# Concert Creator AI Recreation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **This run:** executed inline via superpowers:executing-plans (autonomous session; solo executor). Tasks are milestone-sized; each ends with passing tests + a commit.

**Goal:** A client-side web app that turns piano audio/MIDI into a cinematic 3D video of a virtual pianist playing it, with editable AI-generated fingering and MP4 export.

**Architecture:** Pure-TS `core/` pipeline (transcribe → hand split → fingering → choreography → cinematography → PCM synth), consumed by a Three.js `scene/` and a WebCodecs `export/`, orchestrated by a small observable `state/` store and vanilla-TS `ui/`. Determinism rule: choreography/cameras are pure functions of time; studio and exporter sample the same programs.

**Tech Stack:** Vite 7, TypeScript 5 (strict), three, @tonejs/midi, @spotify/basic-pitch (TF.js), mp4-muxer, webm-muxer, Vitest 3.

## Global Constraints

- All `core/` modules: no DOM, no WebAudio, no three imports — Node-testable pure TS.
- Coordinates: keyboard space = x mm along keyboard (0 at left edge of A0), y mm up, z mm toward player; scene maps keyboard→world.
- White key pitch 23.5 mm; 52 white keys; MIDI range 21 (A0) – 108 (C8); key dip 10 mm; black keys raised 12.5 mm, length 95 mm vs white 150 mm exposed.
- Hands: `'L' | 'R'`; fingers `1..5` (1 = thumb, both hands).
- Time unit: seconds (float) everywhere; sample rate 48000 Hz.
- Commits: conventional style, one per task minimum, tests green before every commit.
- No external network fetches at runtime: Basic Pitch model served from `public/models/basic-pitch/`, demos from `public/demos/`.

---

### Task 0: Scaffold

**Files:** Create `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/ui/app.ts`, `scripts/copy-model.mjs`; update `README.md`.

- [ ] `npm create vite@latest . -- --template vanilla-ts` (adapt into existing repo), add deps: `three @tonejs/midi @spotify/basic-pitch mp4-muxer webm-muxer`, dev: `vitest @types/three`.
- [ ] `scripts/copy-model.mjs`: copy `node_modules/@spotify/basic-pitch/model/**` → `public/models/basic-pitch/`; wire as `postinstall`.
- [ ] `npm run dev` boots; `npm run build` passes; `npx vitest run` passes (empty suite placeholder test).
- [ ] Commit: `chore: scaffold vite+ts app with pipeline deps`

### Task 1: Types + keyboard geometry (`core/keyboard.ts`, `core/types.ts`)

**Produces:** `NoteEvent`, `PerformanceNote`, `PerformanceScore`, `Hand`, `Finger`, `PedalEvent`, `Phrase`;
`KEY_COUNT=88`, `keyIndex(midi)`, `isBlack(midi)`, `keyCenterX(midi)` (mm), `keyTopY(midi)`, `keyFrontZ(midi)`, `whiteIndex(midi)`, `KEYBOARD_WIDTH_MM`.

**Test:** `src/core/keyboard.test.ts` — 88 keys A0..C8; 52 whites/36 blacks; octave pattern (C#,D#,F#,G#,A# black); `keyCenterX(21)≈11.75`, monotonically increasing; black-key x offset between neighbors; `KEYBOARD_WIDTH_MM≈1222`.

- [ ] Failing tests → implement → green → commit `feat(core): note types and keyboard geometry`

### Task 2: MIDI import (`core/midi/importer.ts`)

**Interfaces:** `importMidi(data: ArrayBuffer): ImportedScore` where `ImportedScore = { notes: NoteEvent[]; handHints?: Map<string,Hand>; pedal: PedalEvent[]; name?: string }`. Two non-empty melodic tracks → handHints by track (higher mean pitch = R). Normalization: sort by (start,midi), synthesize ids `n0..`, clamp 21–108 (drop outside), min duration 0.03 s, merge same-pitch overlaps, velocities → 0..1.

**Test:** build MIDI in-memory with `@tonejs/midi` (two-track piece, one-track piece, out-of-range notes, CC64 events) → assert hints, clamping, pedal spans, ordering.

- [ ] Failing tests → implement → green → commit `feat(core): midi importer with two-track hand hints`

### Task 3: Hand split (`core/hands/split.ts`)

**Interfaces:** `assignHands(notes: NoteEvent[], hints?: Map<string,Hand>): Map<string,Hand>`. Onset slices (60 ms); per-slice contiguous splits (k bottom→L); Viterbi with costs: centroid distance (per hand EMA), span>14 st penalty (soft 8/hard 24), crossing penalty, inter-slice jump speed, separation prior. Hints are hard assignments; solver fills the rest.

**Test:** constructed cases — melody C5–C6 over Alberti C2–G3 stays R/L; two crossing scales swap cleanly; 4-note spread chord splits 2/2; hint override respected; all notes assigned.

- [ ] Failing tests → implement → green → commit `feat(core): viterbi hand separation`

### Task 4: Fingering (`core/fingering/assign.ts`, `core/fingering/costs.ts`)

**Interfaces:** `assignFingering(notes: PerformanceNote[] /*hand set*/, opts?: {pins?: Map<string,Finger>}): Map<string,Finger>`. Chord events per hand; candidate order-preserving finger combos; Viterbi transitions with Parncutt-style pair span tables (`costs.ts` exports `SPAN: Record<pair,{min,lo,hi,max}>` in semitones, mirrored for L), stretch/shift/same-finger/thumb-under/weak-finger/thumb-on-black costs. Pins = hard constraints. Beam ≤ 64 states.

**Test:** RH C-major scale 2 octaves → every adjacent transition legal, ≥1 thumb passage, no same-finger repeats on different keys; C-E-G chord → fingers {1,2,3} or {1,3,5}; pinned finger honored; LH descending scale mirror; wide leaps don't crash; disabled notes skipped.

- [ ] Failing tests → implement → green → commit `feat(core): fingering engine with parncutt cost model`

### Task 5: Choreography (`core/choreo/program.ts`, `core/choreo/phrases.ts`)

**Interfaces:** `detectPhrases(notes): Phrase[]`; `buildChoreoProgram(score: PerformanceScore): ChoreoProgram`;
`ChoreoProgram = { duration: number; sample(t): PoseFrame }`;
`PoseFrame = { hands: Record<Hand,{wrist:{x,y,z}; fingers: FingerPose[5] /*{tipTarget:{x,y,z}, press:0..1, curl:0..1, splay:number}*/}>; body:{leanX,leanZ,sway,breath}; head:{yaw,pitch,lift}; pedal:0..1; keys: Float32Array(88) /*dip 0..1*/ }`.
Wrist: critically-damped spring to lookahead centroid (precomputed piecewise at 240 Hz then lerp-sampled — keeps `sample()` pure & fast). Finger press envelope: lift 120 ms before onset, strike to full dip in max(20 ms, 80−60·vel), hold, release 90 ms. Keys array mirrors envelopes incl. velocity.

**Test:** at every onset the assigned finger's `tipTarget.x` within 6 mm of `keyCenterX` and `keys[key]≥0.85` by onset+attack; `sample` pure (two calls identical); no NaN sweep over duration @120 Hz; wrist speed ≤ 3 m/s; pedal follows CC64; phrase boundaries at ≥0.9 s gaps.

- [ ] Failing tests → implement → green → commit `feat(core): performance choreography program`

### Task 6: Cinematography (`core/cinema/planner.ts`)

**Interfaces:** `planShots(score, opts?): ShotPlan`; `ShotPlan={shots: Shot[]}`; `Shot={type: ShotType; start; end; seed}` with `ShotType = 'WIDE_DOLLY'|'SIDE_LOW'|'CLOSE_HANDS'|'TOP_DOWN'|'FIRST_PERSON'|'ORBIT'|'LID'`; camera math itself lives in scene (evaluates Shot + PoseFrame → position/target/fov/focus).

**Test:** shots tile [0,duration] exactly, each ≥4 s (last may be ≥2), no immediate type repeats, fast segments (>8 notes/s) bias to TOP_DOWN/CLOSE_HANDS, deterministic for fixed seed.

- [ ] Failing tests → implement → green → commit `feat(core): automated shot planner`

### Task 7: Piano synth + demo pieces (`core/audio/synth.ts`, `core/audio/render.ts`, `scripts/build-demos.mjs`)

**Interfaces:** `renderScoreToPcm(score, sampleRate=48000): {l: Float32Array; r: Float32Array; duration}` — pure DSP (additive partials w/ inharmonicity, hammer noise transient, velocity-dependent brightness, exponential decays, CC64 lengthens release, per-note stereo pan by key position, soft-knee limiter). No WebAudio (Node-testable). `scripts/build-demos.mjs` writes `public/demos/*.mid` (Für Elise theme, Gymnopédie No.1 excerpt, generated arpeggio etude) + `public/demos/index.json`.

**Test:** non-silent render, peak ≤1, tail extends past last note end, higher velocity ⇒ higher peak for same note, C4 render's dominant FFT bin ≈ 261.6 Hz (coarse), demos build & re-import via importer.

- [ ] Failing tests → implement → green → commit `feat(core): offline piano synth and demo library`

### Task 8: Three.js scene (`src/scene/*`)

**Files:** `scene/stage.ts` (root, lights, floor reflection, dust, quality tiers), `scene/piano.ts` (body+lid+bench), `scene/keys.ts` (88 instanced keys, dip + emissive highlight), `scene/pianist.ts` (rig build, obsidian materials), `scene/ik.ts` (two-bone solver + finger pose application), `scene/roll.ts` (LED falling notes), `scene/cameras.ts` (Shot evaluator + manual modes), `scene/post.ts` (composer: bloom/DOF/vignette/grain/SMAA), `scene/mapping.ts` (keyboard→world transform, applies PoseFrame each frame).

**Interfaces:** `createConcertScene(canvas): ConcertScene` with `{ setScore(score, choreo: ChoreoProgram, shots: ShotPlan): void; renderAt(t: number, dt: number): void; setCameraMode(mode: CameraMode): void; setVisuals(v: VisualSettings): void; resize(w,h,dpr): void; setQuality('preview'|'export'): void; dispose(): void }`. `CameraMode='AUTO'|'SIDE'|'TOP'|'FP'|'CLOSE'|'ORBIT'`; `VisualSettings={leftColor,rightColor,showRoll,showAvatar,lightMood:'noir'|'warm'|'blue',rollZoom}`.

Verification: browser screenshots at fixed times/cameras (no unit tests); gates — keys visually aligned with mapping, fingers contact correct keys on screenshots at known onsets, avatar silhouette elegant at WIDE/SIDE/CLOSE, 60 fps preview @1080p on this machine.

- [ ] Keyboard+piano+stage render (screenshot gate) → commit `feat(scene): stage, piano, animated keyboard`
- [ ] Pianist rig + IK driven by ChoreoProgram (screenshot gate at onsets) → commit `feat(scene): ik pianist driven by choreography`
- [ ] Roll layer, cameras, post chain (screenshot gates per mode) → commit `feat(scene): cinematography, led roll, post-processing`

### Task 9: State + UI (`src/state/store.ts`, `src/ui/*`)

**Files:** `state/store.ts` (observable `AppState`: phase `'library'|'processing'|'studio'|'exporting'`, project {score, choreo, shots, audio: {kind:'file',pcm}|{kind:'synth',pcm}}, settings, progress), `state/pipeline.ts` (async orchestrator: import → [transcribe] → split → fingering → choreo → shots → audio; stage callbacks; Web Worker for Basic Pitch + DSP if main-thread jank), `ui/screens/library.ts` (hero, drop zone, demo cards), `ui/screens/processing.ts` (staged progress), `ui/screens/studio.ts` (canvas + left rail: Camera/Visuals/Animation/Render; transport: play/seek/speed/loop; note strip for edit mode with hotkeys 1-5/F/H/Q/arrows; Regenerate), `ui/style.css` (design language per spec §8).

**Interfaces:** `store.update(fn)`, `store.subscribe(sel, cb)`; `runPipeline(input: {kind:'midi'|'audio', data:ArrayBuffer, name}, store)`; `applyEditsAndRegenerate(store, edits: NoteEdit[])` where `NoteEdit={id, hand?, finger?, disabled?}` re-runs fingering (+choreo) with pins, preserving prior pins.

**Transcription:** `core/transcribe/basicPitch.ts` wraps `@spotify/basic-pitch` `BasicPitch(modelUrl).evaluateModel(audioBuffer→mono 22050, cb)` → `noteFramesToTime(...outputToNotesPoly(frames,onsets,0.25,0.25,11))` → NoteEvent[] (+post-filters from spec §5). Browser-only module (WebAudio decode); not unit tested — e2e covers it.

Verification: e2e in browser — demo card click → studio in <10 s; audio file → studio; edit a note's finger → regenerate reflects pin; all camera modes switch; playback synced (roll notes hit keys on the beat).

- [ ] Store+pipeline+screens with demo flow working → commit `feat(app): full import→studio flow with editing`

### Task 10: Export (`src/export/exporter.ts`, `src/export/codecs.ts`, Render modal in `ui/`)

**Interfaces:** `exportVideo(opts: {scene, choreo, shots, pcm, width, height, fps, onProgress, signal}): Promise<Blob>`; `pickCodecs(width,height,fps): Promise<CodecPlan>` where `CodecPlan={container:'mp4'|'webm', video:{codec,description?}, audio:{codec}}` probing `avc1.640028+mp4a.40.2 → avc1+opus → vp09+opus(webm)`; realtime MediaRecorder fallback `captureExportRealtime(...)` if `VideoEncoder` missing. Offline loop: `scene.setQuality('export')`, per frame `renderAt(frame/fps)`, `new VideoFrame(canvas,{timestamp:frame*1e6/fps})`, keyframe every 2 s; audio: PCM → 20 ms `AudioData` chunks; mux with mp4-muxer/webm-muxer; progress = frames/total.

**Test (unit, `export/timestamps.test.ts`):** frame timestamp math exact for 30/60 fps over 10 min (no drift, integer µs), audio chunk slicing covers PCM exactly once, keyframe cadence. E2e: export 5 s 720p30 of a demo → Blob >100 KB, `video` element plays it, duration ≈5 s ±0.2.

- [ ] Unit tests green; e2e export verified → commit `feat(export): deterministic webcodecs mp4 export with fallbacks`

### Task 11: E2E verification, visual polish, README

- [ ] Chrome automation: full journey (library → demo → studio → play → edit → regenerate → export → download); screenshots of every camera mode + both stages of UI; fix visual defects found (iterate).
- [ ] Audio-input journey with a synthesized test WAV (generate piano-ish tones → expect transcription → studio).
- [ ] README: what it is, credit to original, quick start, architecture map, limitations.
- [ ] Commit: `docs: readme + polish` … then merge decision via superpowers:finishing-a-development-branch.

## Self-Review (done)

1. **Spec coverage:** §2 goals → Tasks 2/3/4 (import+AI), 8/9 (studio+edit), 10 (render), 7 (demos+audio), 5/6 (choreo+cinema); §7 audio-passthrough handled in Task 9 pipeline (`audio.kind='file'`) and Task 10 (pcm arg). §8 UI. §10 testing mapped per task. ✓
2. **Placeholders:** none — every task has concrete interfaces, test assertions, commands/gates. ✓
3. **Type consistency:** `ChoreoProgram.sample(t)→PoseFrame` used in Tasks 5/8/10; `ShotPlan` in 6/8/10; `renderScoreToPcm` in 7/9/10; `ImportedScore.handHints` in 2/3. Fixed one mismatch (exporter takes `pcm`, not AudioBuffer) during review. ✓
