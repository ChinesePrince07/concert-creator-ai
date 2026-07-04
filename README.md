# Concert Creator — AI Virtual Pianist

An unofficial, from-scratch recreation of **Concert Creator AI** (Massive Technologies, taken down ~2022): give it a piano recording or MIDI file and it generates a cinematic video of a virtual pianist performing the piece — correct fingering, hand separation, body movement, automated camera direction, and a rendered MP4 at the end.

Everything runs **entirely in the browser**. Nothing is uploaded anywhere.

## Quick start

```bash
npm install       # also copies the Basic Pitch model into public/
npm run dev       # → http://localhost:5173
npm test          # 48 unit tests over the music pipeline
```

Open the app, pick a piece from the built-in programme (Für Elise, Gymnopédie No. 1, or the generated Cascade Étude), or drop any **piano solo** `.mp3/.wav/.ogg/.flac` or `.mid` file.

## What happens to your file

1. **Transcription** — audio is decoded and run through Spotify's Basic Pitch (TF.js, model served locally) to recover notes. MIDI files skip this; two-track MIDI keeps its left/right hand split (same behavior as the original product).
2. **Hand separation** — a Viterbi pass over onset slices assigns notes to hands (contiguous-split candidates, movement/span/crossing costs).
3. **Fingering** — per hand, a second Viterbi over chord events with Parncutt-style comfortable-span tables picks fingers 1–5, including thumb-under passages. The left hand is solved in mirrored pitch space.
4. **Choreography** — wrist paths are critically-damped springs with lookahead anticipation; fingers get press envelopes and analytic IK targets; body lean/sway, head gaze, and sustain-pedal foot ride the music. `sample(t)` is a pure function of time.
5. **Cinematography** — phrases are detected, then a seeded shot planner cuts between wide dollies, close-ups, top-downs, orbits and first-person views on phrase boundaries.
6. **Studio** — a Three.js concert stage: procedural grand piano (88 physically-dimensioned animated keys), sculptural obsidian pianist driven by two-bone arm IK and 3-joint finger chains, volumetric spotlights, reflective floor, bloom/DOF/grain post.
7. **Render** — a deterministic offline loop samples the same choreography at `frame/fps`, encodes with WebCodecs (H.264 → VP9 fallback; AAC → Opus fallback), muxes to MP4/WebM, and hands you the file. The exported video contains your original recording when you uploaded audio; MIDI projects are voiced by a built-in resonator-bank piano synth.

## Editing the performance (like the original)

`EDIT ANIMATION` opens the note strip: click any note → reassign **hand** (H) or **finger** (1–5), or **mute** it (Q). The AI re-solves fingering/choreography around your pins in well under a second. Camera modes, lighting moods, per-hand note colours and the falling-note roll (Top View / First Person) are in the left rail — mirroring the original's Camera/Visuals panels.

## Pianists & pianos

- **PIANIST** panel: five characters — Elena (gown), Marcus (tailcoat), Yuki, August, and Nocturne, the obsidian sculpture. Stylized-human rather than pseudo-photoreal by design; the realism lives in the motion: fingers pre-shape over the keys they're about to play, neighbouring fingers flex with the pressing one, and the wrist rolls toward the working side. (The original trained on sensor-tracked pianists; this recreation approximates that behaviour with biomechanical rules.)
- **VISUALS → Piano**: Steinway & Sons D-274, Yamaha CFX, Bösendorfer Imperial (with its extra black bass keys), Shigeru Kawai SK-EX, and Fazioli F308 — procedural design cues per maker.
- **Top View / First Person** are Synthesia-style modes: the live hands stay in frame while note tiles glide onto the keys; exports honor whichever view is active.

## Architecture

```
src/core      pure TS, unit-tested: keyboard geometry, MIDI import, hand split,
              fingering, choreography, shot planning, piano synth, demo pieces
src/scene     three.js stage: piano, keyboard, pianist rig + IK, cameras, roll, post
src/state     observable store + pipeline orchestration
src/ui        library / processing / studio screens, transport, panels, render modal
src/export    WebCodecs + mp4-muxer/webm-muxer deterministic exporter
```

Design + plan documents live in `docs/superpowers/`.

## Honest limitations

- Transcription is client-grade: dense/pedal-heavy recordings will need the note editor (the original shipped the same escape hatch). MIDI input is first-class.
- The pianist is deliberately sculptural rather than pseudo-photoreal — browser rendering can't reach scanned-human fidelity, so the realism budget went to **motion**: fingering, anticipation, crossovers, weight.
- Sheet-music display and AR/VR modes from the original are out of scope.

*Not affiliated with Massive Technologies. Built as a technical homage to a product the internet misses.*
