# Concert Creator AI — Recreation: Design

**Date:** 2026-07-04
**Status:** Approved for implementation (autonomous /goal run — decisions documented with rationale in lieu of interactive approval)

## 1. Background: what the original product was

Concert Creator AI (concertcreator.ai) by **Massive Technologies** (Canada, labs in Helsinki) turned a piano recording into a cinematic video of a virtual pianist playing it. The hosted render service disappeared around 2022.

Documented behavior of the original:

- **Input:** piano-solo audio *or* MIDI. If a MIDI file had left/right hands on two tracks, the split was respected; otherwise the AI separated hands itself. Import processing took ~10 s.
- **Pipeline (per co-founder interviews / MIDI.org):** multi-pitch recognition converts audio to MIDI; a proprietary **motion-synthesis engine** — trained via TensorFlow on professional pianists playing for hours under sensors — generates *musically correct performances with correct fingerings, hand positions, and complex hand crossovers*; **full-body and hand inverse kinematics** retarget the performance onto 3D avatars.
- **Studio UX:** *Add Song* → *Camera* button (Top View & First Person = falling-note piano roll with LED effects; 3D scene views = avatar + piano), *Visuals* button (per-hand colors tint the notes, piano-roll zoom, piano model selection), *Edit Animation* (select notes; reassign finger/hand via widgets/hotkeys — `1‑4`+`F` left hand, `7‑9‑0`+`H` right; `Q` disables a note; arrow keys navigate; refresh regenerates in ~15 s), *Render* (choose resolution + frame rate; offline render, up to hours; credits / $19 mo).
- **Learning features:** sheet-music display, built-in song library, playback speed, looping, MIDI I/O.
- **Output style:** dark cinematic stage, grand piano, realistic pianist avatar, automated camera work; alternatively Rousseau-style top-down LED falling-note videos.

## 2. Goals

Recreate the core product loop as a working web app:

1. **Import** piano audio (mp3/wav/ogg/m4a/flac) or MIDI → automatic transcription, hand separation, fingering, and performance choreography in seconds, fully client-side.
2. **Studio**: interactive 3D concert scene — grand piano with 88 animated keys, full-body virtual pianist with IK-driven arms/hands/fingers, camera modes (cinematic auto-cut, side, top-down, first-person, close-up, orbit), visual customization (per-hand note colors, falling notes on/off, lighting mood), transport (play/pause/seek/speed).
3. **Edit Animation**: per-note hand/finger reassignment and note disable, with instant regeneration honoring user pins (the original's marquee "full control" feature).
4. **Render**: deterministic offline export to MP4 (720p/1080p/1440p, 30/60 fps) with synchronized audio — the user's original audio when audio was uploaded (the avatar mimes the actual recording, exactly like the original product), or synthesized piano for MIDI input.
5. **Demo library** of public-domain pieces so the app demos instantly.

### Non-goals (v1)

- Photoreal scanned-human avatars (see §6 rationale), AR/VR modes, avatar GLB import, sheet-music engraving, accounts/credits/payments (the clone is local and free), mobile apps, MIDI hardware I/O.

## 3. Approaches considered

**A. Client-only web app (chosen).** Vite + TypeScript SPA. Transcription with Spotify's Basic Pitch (TF.js, in-browser); custom hand-split + fingering + choreography algorithms; Three.js cinematic renderer; WebCodecs offline MP4 export.
*Pros:* zero infrastructure; private (nothing uploaded); the whole product loop works on any modern Chrome/Edge; renders in minutes not hours; every stage inspectable/editable. *Cons:* transcription quality below server-grade piano models; realism ceiling of WebGL.

**B. Python backend pipeline.** Bytedance piano-transcription + PianoPlayer fingering + Blender headless photoreal renders behind a job queue.
*Pros:* highest quality ceiling, closest to the original's offline "hours-long" renders. *Cons:* GPU + multi-GB models + job infra; renders take hours; not runnable as a simple local web app; enormous scope.

**C. Hybrid.** Client app + optional local Python sidecar for premium transcription.
*Pros:* upgrade path. *Cons:* two runtimes to maintain; complicates v1 for marginal gain.

**Decision: A**, with the transcriber behind a narrow `Transcriber` interface so B/C's server-grade transcription can be plugged in later without touching the rest. The original's own UX acknowledged imperfect transcription (per-note edit/disable exists precisely for that), so client-grade transcription with first-class MIDI input and note editing is faithful to the real product.

## 4. Architecture

```
Audio file ─► decode ─► BasicPitchTranscriber ─┐                        ┌─► Studio (realtime three.js)
                                               ├─► NoteEvent[] ─► HandSplit ─► Fingering ─► Choreography ─► PerformanceScore + ChoreoProgram
MIDI file ──► MidiImporter (respects 2 tracks) ┘                        └─► Exporter (offline frame loop → WebCodecs → MP4)
Audio track: original decoded audio (audio input) | OfflineAudioContext piano synth (MIDI input)
Cinematography: CinemaPlanner(PerformanceScore) ─► ShotPlan (consumed by both Studio auto-camera and Exporter)
```

### Module layout

```
src/
  core/types.ts        NoteEvent, PerformanceNote, PerformanceScore, edits, settings
  core/midi/           MIDI import via @tonejs/midi; track→hand mapping; normalization
  core/transcribe/     Transcriber interface; BasicPitchTranscriber; note post-filters
  core/hands/          chord-slice hand assignment (Viterbi over contiguous splits)
  core/fingering/      per-hand fingering (Viterbi over chord finger-combos, Parncutt-style costs)
  core/choreo/         phrase analysis; wrist paths; finger press curves; body/head/pedal layers
  core/cinema/         segment detection → shot plan (type, duration, camera path)
  core/audio/          decode helpers; offline piano synthesizer (MIDI → AudioBuffer)
  scene/               keyboard geometry (88 keys, real dimensions), grand piano body,
                       pianist rig + IK, stage/lights/reflections, piano-roll LED layer,
                       cameras, post-processing, quality tiers
  export/              WebCodecs VideoEncoder/AudioEncoder + mp4-muxer; codec fallback chain
  state/               project store + processing state machine (plain TS, observable)
  ui/                  screens: Library/Import, Processing, Studio (panels: Camera, Visuals,
                       Animation, Render modal); transport; keyboard shortcuts
```

`core/*` is pure TypeScript with no DOM/three dependencies — unit-testable with Vitest. `scene/`, `export/`, `ui/` are integration layers.

### Key types (abridged)

```ts
interface NoteEvent   { midi: number; start: number; end: number; velocity: number; id: string }
type Hand = 'L' | 'R'
interface PerformanceNote extends NoteEvent {
  hand: Hand; finger: 1|2|3|4|5;            // 1 = thumb
  disabled?: boolean;                        // Q-key feature
  pinned?: { hand?: Hand; finger?: 1|2|3|4|5 } // user edits survive regeneration
}
interface PerformanceScore { notes: PerformanceNote[]; duration: number; pedal: PedalEvent[]; phrases: Phrase[] }
interface ChoreoProgram    { sample(t: number): PoseFrame }  // deterministic, pure function of t
interface ShotPlan         { shots: Shot[] }                 // covers [0, duration], no gaps
```

Determinism rule: `ChoreoProgram.sample(t)` and camera evaluation are pure functions of time so the realtime studio and the offline exporter produce identical motion.

## 5. Core algorithms

**Transcription (audio path).** `@spotify/basic-pitch` (TF.js) with model files served locally (copied from the npm package at build time). Post-filters: drop notes < 40 ms with low amplitude; merge re-articulations < 30 ms apart at same pitch; clamp to A0–C8; velocity from frame amplitude. Sustain-pedal inference heuristic: dense overlapping releases → synthetic CC64 spans (drives foot + damper visuals only).

**Hand split (single-track input).** Notes are grouped into ~60 ms onset slices. Within a slice, sorted by pitch, only contiguous splits are considered (bottom *k* notes → L, top *n−k* → R), giving *n+1* candidate assignments per slice. Viterbi over slices with costs: distance from each hand's running centroid, simultaneous span > 14 semitones (hard-ish), hand crossing (L above R), jump speed between slices, and a centroid-separation prior. Two-track MIDI bypasses this entirely (tracks = hands, like the original).

**Fingering (per hand).** Events = chords per hand. Candidate states: order-preserving finger combinations (≤ C(5,k) ≤ 10 per chord). Viterbi transition costs based on Parncutt-style comfortable-span tables per finger pair (min/comfortable/max semitone spans, white/black adjusted), position-shift magnitude, same-finger-repeat-different-key penalty, discounted thumb-under crossings, weak-finger (4,5) usage on accented notes, thumb-on-black penalty. User pins are hard constraints: regeneration re-runs Viterbi with pinned states fixed.

**Choreography.** Layered, all sampled at render time:
- *Wrist targets:* per hand, target x = weighted centroid of sounding + upcoming (≤ 250 ms lookahead) notes; y/z from key row (black keys deeper). Critically-damped spring toward target with anticipation lead; speed limits produce natural "reaching" instead of teleports.
- *Fingers:* per note — anticipatory lift, velocity-scaled strike to key-dip depth, hold, damped release. Lateral splay from key offset relative to wrist; thumb has opposition axis. Fingers not engaged relax toward a neutral curl.
- *Arms:* two-bone analytic IK (shoulder→elbow→wrist) with elbow pole vector out-and-down; wrist pitch/roll from row depth and span.
- *Body:* spine lean/translate toward hands' midpoint (low-passed), sway amplitude from local note density/dynamics, breathing idle, head look-at active-hand with ~300 ms lag and occasional phrase-peak lifts.
- *Pedal:* right foot rides CC64.
- Invariant (tested): at every note onset the assigned fingertip is above the correct key within ε, and the key reaches full dip by onset + attack time.

**Cinematography.** Phrase segmentation from inter-onset gaps + density valleys. Shot grammar: WIDE_DOLLY_IN, SIDE_LOW, CLOSE_HANDS (rail following active-hand centroid), TOP_DOWN, FIRST_PERSON, ORBIT_SLOW, LID_REFLECTION. Selection weighted by segment character (fast runs → keys/top shots; slow lyrical → close/side/orbit); hard cuts on phrase starts; min shot 4 s; DOF focus pulls to hands in close shots. Manual camera modes simply override the planner.

## 6. Rendering & art direction

**Scene:** black-void concert stage; volumetric spotlight cones + dust motes; glossy reflective floor (planar reflection); procedural full-size grand piano (rim curve, propped lid, gold accents, red felt) with an 88-key keyboard built to real dimensions (23.5 mm white-key pitch, correct black-key pattern and setback); keys rotate about a rear hinge ~4° for a ~10 mm dip, velocity-scaled attack; optional per-hand emissive key highlight. ACES filmic tone mapping; bloom, depth of field, vignette, film grain (SMAA at export quality).

**Pianist:** *deliberately sculptural, not pseudo-photoreal.* A browser build cannot reach scanned-human realism, and near-miss photorealism reads as uncanny. Art direction: an elegant obsidian/graphite figure — matte body, subtle sheen, defined silhouette, no facial features — with the geometry budget concentrated in the hands (per-phalanx segments, knuckle spheres, fingernail highlights). Rig: hips→spine×2→chest→neck→head; clavicle/upper-arm/forearm/hand per side; 15 finger bones per hand (MCP/PIP/DIP × 5); legs posed to bench/pedals. The claim to "hyper-realistic" is carried by *motion fidelity* (the original's actual differentiator) plus cinematic lighting.

**Piano-roll LED mode** (Top View / First Person cameras): instanced falling notes colored by hand (user-configurable, tinting notes exactly as the original's "hand color" setting), LED flash on key strike, zoom control, optional finger-number labels (learning mode).

**Quality tiers:** Preview (studio realtime, reduced post) vs Export (full post, fixed timestep). Same scene graph.

## 7. Audio

- **Audio input:** the exported video contains the *original recording* (decoded → re-encoded), avatar mimes it — identical to the original product's behavior and sidesteps synthesis quality entirely.
- **MIDI input:** offline-rendered piano via a layered additive/FM synth voice (per-note detuned partials + hammer transient + release damper, velocity layers, CC64 sustain) through OfflineAudioContext → AudioBuffer. No external sample downloads required (keeps the app fully self-contained); a sampled-piano upgrade is a clean future swap behind the same `renderMidiAudio()` interface.
- Studio playback and export share the same audio source path (WebAudio for preview; PCM → AudioEncoder for export).

## 8. UI flow & design language

Landing (hero + demo library + drop zone) → Processing (staged progress: *Transcribing → Separating hands → Fingering → Choreographing*, seconds not hours — a deliberate, visible improvement on the original) → **Studio** (full-bleed 3D canvas; bottom transport with timeline + speed + loop; left rail buttons mirroring the original: **Camera**, **Visuals**, **Animation**, **Render**) → Render modal (resolution/fps/estimate → progress → download).

Animation edit mode: click a note (piano-roll strip under the timeline) → reassign hand/finger via widget or hotkeys (`1-5` finger, `F`/`H` hand toggle mirroring original bindings, `Q` disable, arrows navigate) → *Regenerate* re-runs fingering/choreo with pins (target < 2 s, honest progress if longer).

Dark cinematic design language: near-black stage-warm palette, one accent (amber spotlight gold), editorial serif display over grotesque body, generous negative space, no generic AI-app gradients. Branding: **"Concert Creator"** with an "unofficial recreation" footnote.

## 9. Export

Offline deterministic render loop: `t = frame / fps`, choreography + cameras sampled at `t`, rendered to canvas, frames → `VideoEncoder`; audio PCM sliced → `AudioEncoder`; muxed by `mp4-muxer`. Codec fallback chain: H.264+AAC → H.264+Opus → (webm-muxer) VP9+Opus → last-resort realtime MediaRecorder capture. Resolutions 1280×720 / 1920×1080 / 2560×1440 at 30 or 60 fps. Progress = encoded frames / total with ETA + cancel. A/V sync is structural (both streams timestamped from the same timeline).

## 10. Testing & verification

- **Vitest (core/):** keyboard geometry (MIDI→key index/x-position, black-key pattern); hand split on constructed two-voice pieces (Alberti bass + melody stays separated; crossing penalty works); fingering (C-major scale RH yields thumb-under pattern family, no transition exceeding max-span tables, chords get order-preserving fingers, pins respected); choreography invariants (fingertip-over-key at onset, wrist speed cap, continuity — no NaNs, sample() pure); cinema (shots tile [0,duration], min lengths); synth (renders non-silent buffer, note-off releases); export timestamp math.
- **Browser e2e (chrome-devtools/playwright MCP):** load app → import demo piece → processing completes → studio screenshot (visual pass on piano/avatar/lighting) → play 5 s → export short clip → assert MP4 downloaded and non-trivial size. Iterate on visuals via screenshots.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Basic Pitch struggles on dense polyphonic piano audio | MIDI input is first-class; post-filters; per-note edit/disable UI (the original shipped the same escape hatch); demo library shows best-case instantly |
| WebCodecs/AAC unavailable on some platforms | 4-step codec fallback chain; capability probe surfaced in Render modal |
| Procedural avatar looks toy-like | Sculptural art direction; geometry budget on hands; rim-light silhouette; screenshot-driven iteration |
| Realtime perf on weak GPUs | Instanced keys/notes, quality tiers, DPR cap; export is offline so never frame-rate-bound |
| Fingering DP degenerate on extreme input (glissandi, black-MIDI) | Beam caps, span guards, graceful "impossible" handling (nearest-feasible), note-disable |
| Scope creep | Non-goals list; sheet music and avatar import explicitly deferred |

## 12. Dependencies

`three`, `@tonejs/midi`, `@spotify/basic-pitch` (+ its TF.js), `mp4-muxer`, `webm-muxer` (fallback), dev: `vite`, `typescript`, `vitest`. Basic Pitch model files copied to `public/models/basic-pitch/` at install time (self-contained, offline-capable).
