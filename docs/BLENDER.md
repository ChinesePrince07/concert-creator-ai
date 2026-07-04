# Offline photoreal rendering (the way the original actually did it)

Concert Creator's original renders took *hours* per song — they were offline,
engine-grade renders, not realtime. This pipeline reproduces that
architecture: the web app is the fast studio; Blender (Cycles) is the
final-quality renderer.

## Flow

1. In the studio, open **RENDER** → **EXPORT FOR BLENDER**. (Your browser may
   ask to allow multiple downloads — the bake and the audio come as two files.)
   You get:
   - `performance.json` — the full bake: per-frame wrist transforms, per-finger
     chain angles, all 88 key dips, pedal, body/head, and the auto-cinematography
     camera track (position/target/vertical-fov per frame).
   - `performance.wav` — the audio track (your recording, or the synth voicing).
2. Render:

   ```bash
   blender --background --python scripts/blender/render_concert.py -- \
       --bake performance.json --audio performance.wav --out render/ --samples 128
   ffmpeg -framerate 30 -i render/frame_%04d.png -i performance.wav \
       -c:v libx264 -pix_fmt yuv420p -shortest concert-cycles.mp4
   ```

The bundled script builds a *proxy* scene (keyboard, stylized hand armatures,
camera, lights) so it runs end-to-end out of the box. It is deliberately a
scaffold for real assets:

## Swapping in photoreal assets

- **Hands** — replace `build_hand()` with an imported rigged hand
  (scan-quality models are widely available; MakeHuman/character-creator
  exports work too). Drive it with the bake:
  - object transform ← `frames[i].{L,R}.wrist` + `.quat`
  - finger bones ← `fingers[f].{yaw,mcp,pip,dip}` (radians). Convention:
    fingers extend along the rig's −Z, flexion is rotation about local X
    (negative = curl), yaw about local Y. `f` runs thumb → pinky.
- **Piano** — replace `build_piano()` with any grand piano model; keep 88
  independent key objects (or shape keys) rotated by
  `keys[k] × 4.2°` about the rear hinge. `key_center_x()` gives lane positions.
- **Coordinates** — the bake is y-up, meters, keyboard centered on x=0,
  white-key tops at `world.keyTopY`, +z toward the pianist. The script parents
  everything under `bake_root` (rotated 90°) so bake coordinates are used as-is
  in z-up Blender.

## Why this reaches reference quality

Cycles gives you subsurface skin, soft area shadows, true depth of field and
unbounded sample counts — the exact class of renderer the original's
marketing footage came from. The AI performance (the hard part) is already
solved and baked; fidelity becomes purely an asset + render-time budget.
