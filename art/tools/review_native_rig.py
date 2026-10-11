"""Skin-binding review for native-skeleton (Mixamo + tail / ears) Tripo heroes.

    blender -b --python art/tools/review_native_rig.py -- <build.glb> <out_dir>

1. Weight map: every LOD0 vertex coloured by its dominant bone group (torso, head, each arm, each hand, each leg,
   tail gradient, ears), rendered front / side / back. Weight bleed shows as a colour patch in the wrong place
   (a sleeve on the leg colour, a gliding membrane on the hand colour, a coat tail on the tail colour).
2. Stress poses (rotations in Blender world axes: front = -Y, character's left = +X, up = +Z), each rendered with the
   same colours plus magenta on faces whose edges stretch more than STRETCH_FLAG x their rest length:
   gun-hold arms forward, arms raised, deep squat, spine twist + head turn, tail curl up, tail swing, ear flick, fists.
3. <out_dir>/rig_review.json: per pose edge-stretch p99 / max / fraction over the flag (over the edges that moved), per bone group the vertex
   count and the p95 distance of its dominant vertices from the group's bones (as a fraction of height).

The images are separate PNGs (<pose>_<view>.png); compose them with any image tool.
Calibration from the enemy pipeline: p99 stretch > 1.8 marks broken deformation ("noodle" limbs).
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

glb, out_dir = (Path(p).resolve() for p in sys.argv[sys.argv.index("--") + 1:][:2])
out_dir.mkdir(parents=True, exist_ok=True)
STRETCH_FLAG = 1.8

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(glb))
for o in list(bpy.data.objects):
    if o.type == "MESH" and not o.name.endswith("LOD0"):
        bpy.data.objects.remove(o)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
bones = [b.name for b in arm.data.bones]


def base(n: str) -> str:
    return n.split(":", 1)[-1]


def group_of(n: str) -> str:
    n = base(n)
    if n.startswith("tail_"):
        return "tail"
    if n.startswith("ear_"):
        return "ears"
    for side in ("Left", "Right"):
        if n.startswith(side + "Hand"):
            return side + "Hand"
        if n.startswith(side) and any(k in n for k in ("Shoulder", "Arm")):
            return side + "Arm"
        if n.startswith(side) and any(k in n for k in ("UpLeg", "Leg", "Foot", "Toe")):
            return side + "Leg"
    if n.startswith(("Neck", "Head")):
        return "head"
    return "torso"


GROUP_COL = {"torso": (0.55, 0.55, 0.6), "head": (0.95, 0.85, 0.35), "LeftArm": (0.2, 0.45, 0.95),
             "RightArm": (0.95, 0.35, 0.2), "LeftHand": (0.45, 0.85, 1.0), "RightHand": (1.0, 0.65, 0.4),
             "LeftLeg": (0.2, 0.7, 0.35), "RightLeg": (0.6, 0.85, 0.2), "tail": (0.6, 0.3, 0.85), "ears": (0.1, 0.9, 0.8)}

# dominant bone per vertex
vg_name = {g.index: g.name for g in mesh.vertex_groups}
me = mesh.data
nv = len(me.vertices)
dom = [""] * nv
for v in me.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom[v.index] = vg_name[best.group] if best else ""
tail_bones = sorted((b for b in bones if base(b).startswith("tail_")), key=lambda b: int(base(b).split("_")[1]))


def vert_colour(i: int) -> tuple:
    b = dom[i]
    g = group_of(b) if b else "torso"
    if g == "tail" and tail_bones:
        k = tail_bones.index(b) / max(1, len(tail_bones) - 1)
        return (0.45 + 0.5 * k, 0.2 + 0.2 * k, 0.9 - 0.4 * k)
    return GROUP_COL[g]


# rest geometry (evaluated, world space) and edges
def evaluated_coords() -> np.ndarray:
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    m = ev.to_mesh()
    co = np.array([mesh.matrix_world @ v.co for v in m.vertices])
    ev.to_mesh_clear()
    return co


rest = evaluated_coords()
H = float(rest[:, 2].max() - rest[:, 2].min())
edges = np.array([e.vertices[:] for e in me.edges])
rest_len = np.linalg.norm(rest[edges[:, 0]] - rest[edges[:, 1]], axis=1) + 1e-9

# group distance stats (dominant vertices vs. the group's bone segments, rest pose)
mw = arm.matrix_world
seg = {b.name: (np.array(mw @ b.head_local), np.array(mw @ b.tail_local)) for b in arm.data.bones}


def seg_dist(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


groups: dict = {}
dom_arr = np.array(dom)
for gname in GROUP_COL:
    members = [b for b in bones if group_of(b) == gname]
    idx = np.nonzero(np.isin(dom_arr, members))[0]
    if not len(idx):
        continue
    d = np.min([seg_dist(rest[idx], *seg[b]) for b in members], axis=0)
    groups[gname] = {"verts": int(len(idx)), "p95_dist_over_height": round(float(np.percentile(d, 95)) / H, 3),
                     "max_dist_over_height": round(float(d.max()) / H, 3)}

# colour attribute (per corner) — rewritten per pose for the stretch overlay
attr = me.color_attributes.new("rigview", "BYTE_COLOR", "CORNER")
loop_vert = np.array([l.vertex_index for l in me.loops])
poly_of_loop = np.zeros(len(me.loops), int)
for p in me.polygons:
    poly_of_loop[p.loop_start:p.loop_start + p.loop_total] = p.index
base_rgb = np.array([vert_colour(i) for i in range(nv)])
edge_key = {tuple(sorted(e)): k for k, e in enumerate(edges.tolist())}
poly_edges = [[edge_key[tuple(sorted(k))] for k in p.edge_keys] for p in me.polygons]


def paint(stretch: np.ndarray | None) -> None:
    rgb = base_rgb[loop_vert].copy()
    if stretch is not None:
        bad = np.array([stretch[pe].max() > STRETCH_FLAG for pe in poly_edges])
        rgb[bad[poly_of_loop]] = (1.0, 0.0, 0.85)
    rgba = np.concatenate([rgb, np.ones((len(rgb), 1))], 1).ravel()
    attr.data.foreach_set("color", rgba.astype(np.float32))
    me.update()


# render setup: workbench, flat attribute colours with studio lighting, orthographic cameras
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "VERTEX"
shading.show_cavity = True
scene.render.resolution_x = scene.render.resolution_y = 640
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = "ORTHO"
cx, cy = float(rest[:, 0].mean()), float(rest[:, 1].mean())
VIEWS = {"front": (Vector((0, -1, 0)), 0.0), "side": (Vector((1, 0, 0)), 0.0), "back": (Vector((0, 1, 0)), 0.0),
         "threeq": (Vector((0.75, -0.66, 0.12)).normalized(), 0.0)}


def render(name: str, views=("front", "side", "back")) -> list[str]:
    co = evaluated_coords()
    lo, hi = co.min(0), co.max(0)
    centre = Vector(((lo + hi) / 2).tolist())
    span = float(max(hi - lo)) * 1.08
    cam.data.ortho_scale = span
    paths = []
    for v in views:
        d, _ = VIEWS[v]
        cam.location = centre + d * 6 * H
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        p = out_dir / f"{name}_{v}.png"
        scene.render.filepath = str(p)
        bpy.ops.render.render(write_still=True)
        paths.append(p.name)
    return paths


pb = {base(b.name): b for b in arm.pose.bones}


def reset() -> None:
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def rot_world(name: str, axis, deg: float) -> None:
    """Rotate a pose bone about its head by `deg` around a world axis (parents first: call in hierarchy order)."""
    if name not in pb:
        return
    b = pb[name]
    head = b.head.copy()                                  # armature space
    ax = (arm.matrix_world.inverted().to_3x3() @ Vector(axis)).normalized()
    R = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, ax) @ Matrix.Translation(-head)
    b.matrix = R @ b.matrix
    bpy.context.view_layer.update()


def rot_local(name: str, axis: str, deg: float) -> None:
    if name not in pb:
        return
    b = pb[name]
    b.rotation_mode = "XYZ"
    e = list(b.rotation_euler)
    e["XYZ".index(axis)] += math.radians(deg)
    b.rotation_euler = e
    bpy.context.view_layer.update()


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
tails = [base(b) for b in tail_bones]
fingers = [f"{s}Hand{f}{j}" for s in ("Left", "Right") for f in ("Index", "Middle", "Ring", "Pinky") for j in (1, 2, 3)]
POSES = {
    "gunhold": [("LeftArm", X, -75), ("RightArm", X, -75), ("LeftForeArm", X, -45), ("RightForeArm", X, -45)],
    "arms_up": [("LeftArm", Y, -120), ("RightArm", Y, 120)],
    "squat": [("LeftUpLeg", X, -75), ("RightUpLeg", X, -75), ("LeftLeg", X, 110), ("RightLeg", X, 110)],
    "twist": [("Spine2", Z, 35), ("Head", Z, 50)],
    "tail_curl": [(t, X, 28) for t in tails],
    "tail_swing": [(t, Z, 22) for t in tails],
    "ears": [("ear_L", Y, 35), ("ear_R", Y, -35)],
    "fists": "fists",
}

report = {"asset": glb.name, "height_m": round(H, 3), "bones": len(bones), "tail_bones": len(tail_bones),
          "groups": groups, "poses": {}, "flag": STRETCH_FLAG}
paint(None)
report["weight_map"] = render("weights", ("front", "side", "back", "threeq"))
for name, ops in POSES.items():
    reset()
    if ops == "fists":
        for f in fingers:
            rot_local(f, "X", 70)
        for s in ("Left", "Right"):
            for j in (1, 2, 3):
                rot_local(f"{s}HandThumb{j}", "Z", 25 if s == "Left" else -25)
    else:
        if not any(n in pb for n, _, _ in ops):
            continue
        for n, ax, deg in ops:
            rot_world(n, ax, deg)
    co = evaluated_coords()
    st = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1) / rest_len
    # stretch statistics only over the part that moved (a tail is < 1% of the edges: a whole-body p99 hides it)
    moved = np.linalg.norm(co - rest, axis=1) > 0.01 * H
    mv = st[moved[edges[:, 0]] | moved[edges[:, 1]]]
    mv = mv if len(mv) else st
    paint(st)
    views = ("front", "side") if name not in ("tail_curl", "tail_swing", "ears") else ("side", "threeq")
    if name == "fists":
        views = ("front", "threeq")
    report["poses"][name] = {"p99": round(float(np.percentile(mv, 99)), 3), "max": round(float(mv.max()), 2),
                             "over_flag": round(float((mv > STRETCH_FLAG).mean()), 5), "moved_edges": int(len(mv)),
                             "images": render(name, views)}
reset()
(out_dir / "rig_review.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
print("RIG_REVIEW", json.dumps({k: v["p99"] for k, v in report["poses"].items()}))
