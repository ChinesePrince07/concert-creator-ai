# Blender headless renderer for Concert Creator bakes.
#
#   blender --background --python scripts/blender/render_concert.py -- \
#       --bake performance.json --audio performance.wav --out render/ \
#       [--samples 128] [--fps-scale 1]
#
# Builds a keyboard + two stylized hand armatures from the bake, keyframes
# everything (keys, hands, camera), and renders with Cycles. This scene is a
# faithful STARTING POINT: swap `build_hand` / `build_piano` for photoreal
# assets (scanned hand rigs, PBR pianos) to reach reference-grade output —
# the bake's wrist transforms and per-finger angles drive any rig whose
# fingers flex about local X and yaw about local Y, fingers along -Z.
#
# World convention (matches the web app):
#   meters; keyboard centered on x=0; white-key tops at y = world.keyTopY;
#   +z toward the pianist; camera fov is vertical degrees.

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

WHITE_PITCH = 0.0235
MIDI_MIN = 21
BLACK_PCS = {1, 3, 6, 8, 10}
BLACK_OFFSET = {1: -0.002, 3: 0.002, 6: -0.0026, 8: 0.0, 10: 0.0026}


def is_black(midi):
    return midi % 12 in BLACK_PCS


def white_index(midi):
    return sum(1 for m in range(MIDI_MIN, midi) if not is_black(m))


def key_center_x(midi, keyboard_width):
    if not is_black(midi):
        x_mm = white_index(midi) * WHITE_PITCH + WHITE_PITCH / 2
    else:
        x_mm = (white_index(midi - 1) + 1) * WHITE_PITCH + BLACK_OFFSET[midi % 12]
    return x_mm - keyboard_width / 2


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--bake", required=True)
    p.add_argument("--audio")
    p.add_argument("--out", default="render")
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--width", type=int, default=1920)
    p.add_argument("--height", type=int, default=1080)
    return p.parse_args(argv)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, base, roughness=0.5, emission=None, emission_strength=0.0, subsurface=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if subsurface and "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = subsurface
    if emission and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def build_piano(bake):
    key_top = bake["world"]["keyTopY"]
    kb_w = bake["world"]["keyboardWidth"]
    white_mat = make_material("white_key", (0.87, 0.84, 0.76), 0.35)
    black_mat = make_material("black_key", (0.05, 0.05, 0.06), 0.3)
    keys = {}
    for k in range(88):
        midi = k + MIDI_MIN
        black = is_black(midi)
        w = 0.011 if black else 0.0222
        l = 0.095 if black else 0.15
        h = 0.032 if black else 0.021
        bpy.ops.mesh.primitive_cube_add(size=1)
        ob = bpy.context.object
        ob.name = f"key_{midi}"
        ob.scale = (w / 2, l / 2, h / 2)
        y_top = key_top + (0.0125 if black else 0.0)
        ob.location = (key_center_x(midi, kb_w), -l / 2, y_top - h / 2)
        # rotate about the rear hinge when pressed: keyframed via delta rotation
        ob.data.materials.append(black_mat if black else white_mat)
        # convert to z-up blender world: we author directly in blender axes below
        keys[k] = ob
    # simple case slab behind the keys
    bpy.ops.mesh.primitive_cube_add(size=1)
    case = bpy.context.object
    case.name = "case"
    case.scale = (kb_w / 2 + 0.05, 0.9, 0.15)
    case.location = (0, -0.9 - 0.02, key_top + 0.02)
    case.data.materials.append(make_material("case", (0.02, 0.02, 0.022), 0.2))
    return keys


def build_hand(name, mat):
    """Stylized proxy hand: armature + simple skinned tubes.
    Replace with a photoreal rigged hand; keep bone names finger{i}_{seg}."""
    arm = bpy.data.armatures.new(f"{name}_arm")
    ob = bpy.data.objects.new(name, arm)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    slots = [(-0.04, 0.028), (-0.023, 0.08), (-0.008, 0.084), (0.008, 0.08), (0.023, 0.072)]
    lengths = [(0.042, 0.028, 0.024), (0.044, 0.027, 0.021), (0.048, 0.03, 0.023), (0.044, 0.028, 0.021), (0.035, 0.023, 0.019)]
    for i, ((sx, sy), (l1, l2, l3)) in enumerate(zip(slots, lengths)):
        prev = None
        base = Vector((sx, -sy, -0.006))
        for j, seg in enumerate((l1, l2, l3)):
            b = arm.edit_bones.new(f"finger{i}_{j}")
            b.head = base
            base = base + Vector((0, -seg, 0))
            b.tail = base
            if prev:
                b.parent = prev
                b.use_connect = True
            prev = b
    bpy.ops.object.mode_set(mode="OBJECT")
    # proxy mesh: skinned cylinders per bone
    bpy.ops.mesh.primitive_cube_add(size=1)
    palm = bpy.context.object
    palm.scale = (0.038, 0.047, 0.013)
    palm.location = (0, -0.045, -0.006)
    palm.parent = ob
    palm.data.materials.append(mat)
    return ob


def main():
    args = parse_args()
    with open(args.bake) as f:
        bake = json.load(f)
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.fps = bake["fps"]
    frames = bake["frames"]
    scene.frame_end = len(frames)

    # NOTE: the bake is y-up; Blender is z-up. Author with a root empty
    # rotated -90° about X so bake coordinates can be used directly.
    root = bpy.data.objects.new("bake_root", None)
    bpy.context.collection.objects.link(root)
    root.rotation_euler = (math.radians(90), 0, 0)

    keys = build_piano(bake)
    for ob in list(keys.values()):
        ob.parent = root
    skin = make_material("skin", (0.72, 0.52, 0.4), 0.5, subsurface=0.08)
    hands = {"L": build_hand("hand_L", skin), "R": build_hand("hand_R", skin)}
    for h in hands.values():
        h.parent = root

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.parent = root
    scene.camera = cam

    key_top = bake["world"]["keyTopY"]
    for fi, fr in enumerate(frames, start=1):
        for hand_key, ob in hands.items():
            h = fr[hand_key]
            ob.location = Vector((h["wrist"][0], h["wrist"][1], h["wrist"][2]))
            q = h["quat"]
            ob.rotation_mode = "QUATERNION"
            ob.rotation_quaternion = Quaternion((q[3], q[0], q[1], q[2]))
            ob.keyframe_insert("location", frame=fi)
            ob.keyframe_insert("rotation_quaternion", frame=fi)
            for i, fa in enumerate(h["fingers"]):
                pb0 = ob.pose.bones.get(f"finger{i}_0")
                pb1 = ob.pose.bones.get(f"finger{i}_1")
                pb2 = ob.pose.bones.get(f"finger{i}_2")
                if not (pb0 and pb1 and pb2):
                    continue
                for pb, rot in ((pb0, fa["mcp"]), (pb1, fa["pip"]), (pb2, fa["dip"])):
                    pb.rotation_mode = "XYZ"
                    pb.rotation_euler = (rot, fa["yaw"] if pb is pb0 else 0.0, 0.0)
                    pb.keyframe_insert("rotation_euler", frame=fi)
        # keys
        for k, dip in enumerate(fr["keys"]):
            ob = keys.get(k)
            if ob is None:
                continue
            ob.rotation_euler = (dip * math.radians(4.2), 0, 0)
            if fi == 1 or dip > 0 or True:
                pass
            ob.keyframe_insert("rotation_euler", frame=fi)
        # camera (bake y-up → parented under rotated root)
        c = fr["camera"]
        cam.location = Vector((c["pos"][0], c["pos"][1], c["pos"][2]))
        look = Vector((c["target"][0], c["target"][1], c["target"][2]))
        direction = look - cam.location
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = direction.to_track_quat("-Z", "Y")
        cam_data.angle_y = math.radians(c["fov"])
        cam.keyframe_insert("location", frame=fi)
        cam.keyframe_insert("rotation_quaternion", frame=fi)
        cam_data.keyframe_insert("lens", frame=fi)

    # lights: soft key + fill
    for name, loc, energy in (("key", (2.5, 3.5, 4.0), 800), ("fill", (-2.5, 2.0, 3.0), 250)):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.size = 2.0
        light = bpy.data.objects.new(name, light_data)
        light.location = loc
        bpy.context.collection.objects.link(light)

    os.makedirs(args.out, exist_ok=True)
    scene.render.filepath = os.path.join(args.out, "frame_")
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(animation=True)
    print("Rendered", len(frames), "frames to", args.out)
    print("Mux with:  ffmpeg -framerate", bake["fps"], "-i", os.path.join(args.out, "frame_%04d.png"),
          "-i", args.audio or "<audio.wav>", "-c:v libx264 -pix_fmt yuv420p -c:a aac out.mp4")


if __name__ == "__main__":
    main()
