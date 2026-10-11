"""Review sheets for a native-skeleton creature GLB (build_tripo_creature.py output), any bone names.

    blender -b --factory-startup --python art/tools/review_native_creature.py -- <build.glb> <out_dir> [poses.json]

Writes into <out_dir>:
  turnaround.png  textured LOD0 in bind pose: front / 3-4 front / side / back / 3-4 back / top (Workbench, flat studio light)
  weights.png     every LOD0 vertex coloured by its dominant bone (one distinct colour per bone, legend strip at the
                  bottom), same six views: weight bleed shows as a colour patch in the wrong place
  pose_<name>.png each stress pose from poses.json, dominant-bone colours plus magenta on faces whose edges stretch more
                  than STRETCH_FLAG x rest length; front / side / 3-4
  review.json     per bone: dominant vertex count and p95 distance from the bone segment; per pose: edge-stretch p99 /
                  max / fraction over the flag (over the edges that moved)

poses.json: {"<pose>": [["<bone>", [ax, ay, az], degrees], ...], ...}; rotations about the bone head, axis in Blender world
(front = -Y, creature's left = +X, up = +Z), applied in list order (list parents before children).
"""
import colorsys
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out_dir = Path(argv[0]).resolve(), Path(argv[1]).resolve()
poses = json.loads(Path(argv[2]).read_text(encoding="utf-8")) if len(argv) > 2 else {}
out_dir.mkdir(parents=True, exist_ok=True)
STRETCH_FLAG = 1.8
TILE = 520

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(glb))
for o in list(bpy.data.objects):
    if o.type == "MESH" and not o.name.endswith("LOD0"):
        bpy.data.objects.remove(o)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
bones = [b.name for b in arm.data.bones]
me = mesh.data
nv = len(me.vertices)
vg_name = {g.index: g.name for g in mesh.vertex_groups}
dom = []
for v in me.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom.append(vg_name[best.group] if best else "")
deform = sorted({d for d in dom if d}, key=bones.index)
# distinct colours: golden-ratio hues, alternating lightness so neighbours in the list differ
PAL = {b: colorsys.hsv_to_rgb((i * 0.618034) % 1.0, 0.75 if i % 2 else 0.95, 0.95 if i % 3 else 0.7) for i, b in enumerate(deform)}
base_rgb = np.array([PAL.get(d, (0.3, 0.3, 0.3)) for d in dom])


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
mw = arm.matrix_world
seg = {b.name: (np.array(mw @ b.head_local), np.array(mw @ b.tail_local)) for b in arm.data.bones}


def seg_dist(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


dom_arr = np.array(dom)
per_bone = {}
for b in deform:
    idx = np.nonzero(dom_arr == b)[0]
    d = seg_dist(rest[idx], *seg[b])
    per_bone[b] = {"verts": int(len(idx)), "p95_dist_m": round(float(np.percentile(d, 95)), 3),
                   "max_dist_m": round(float(d.max()), 3)}

attr = me.color_attributes.new("rigview", "BYTE_COLOR", "CORNER")
loop_vert = np.array([l.vertex_index for l in me.loops])
poly_of_loop = np.zeros(len(me.loops), int)
for p in me.polygons:
    poly_of_loop[p.loop_start:p.loop_start + p.loop_total] = p.index
edge_key = {tuple(sorted(e)): k for k, e in enumerate(edges.tolist())}
poly_edges = [[edge_key[tuple(sorted(k))] for k in p.edge_keys] for p in me.polygons]


def paint(stretch=None) -> None:
    rgb = base_rgb[loop_vert].copy()
    if stretch is not None:
        bad = np.array([stretch[pe].max() > STRETCH_FLAG for pe in poly_edges])
        rgb[bad[poly_of_loop]] = (1.0, 0.0, 0.85)
    rgba = np.concatenate([rgb, np.ones((len(rgb), 1))], 1).ravel()
    attr.data.foreach_set("color", rgba.astype(np.float32))
    me.update()


sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"
sh.show_cavity = True
sc.render.resolution_x = sc.render.resolution_y = TILE
sc.world = bpy.data.worlds.new("w")
sc.world.color = (0.16, 0.17, 0.2)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
VIEWS = {"front": (0, 0.05), "q_front": (35, 0.18), "side": (90, 0.05), "back": (180, 0.05), "q_back": (215, 0.18),
         "top": (0, 1.0)}


def render(name: str, views) -> list[Path]:
    co = evaluated_coords()
    lo, hi = co.min(0), co.max(0)
    centre = Vector(((lo + hi) / 2).tolist())
    cam.data.ortho_scale = float(max(hi - lo)) * 1.08
    paths = []
    for v in views:
        yaw, up = VIEWS[v]
        a = math.radians(yaw)
        if v == "top":
            d = Vector((0.0, -0.02, 1.0)).normalized()
        else:
            d = Vector((math.sin(a), -math.cos(a), up)).normalized()
        cam.location = centre + d * 8 * H
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        p = out_dir / f"_{name}_{v}.png"
        sc.render.filepath = str(p)
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


def sheet(paths: list[Path], out: Path, legend: bool = False) -> None:
    n = len(paths)
    lh = 26 * math.ceil(len(deform) / 6) + 8 if legend else 0
    img = np.zeros((TILE + lh, TILE * n, 4), np.float32)
    img[..., 3] = 1
    for c, p in enumerate(paths):
        im = bpy.data.images.load(str(p))
        img[lh:, c * TILE:(c + 1) * TILE] = np.array(im.pixels[:], np.float32).reshape(TILE, TILE, 4)
        bpy.data.images.remove(im)
        p.unlink()
    if legend:
        # colour swatches only (Blender has no text rasteriser here); names in review.json "legend", same order
        w = TILE * n // 6
        for i, b in enumerate(deform):
            r, c = divmod(i, 6)
            y0 = lh - 26 * (r + 1)
            img[y0:y0 + 20, c * w + 4:c * w + 4 + 40, :3] = PAL[b]
    o = bpy.data.images.new(out.stem, img.shape[1], img.shape[0], alpha=True)
    o.pixels.foreach_set(img.ravel())
    o.filepath_raw = str(out)
    o.file_format = "PNG"
    o.save()
    bpy.data.images.remove(o)


# 1. textured turnaround
sh.color_type = "TEXTURE"
sheet(render("tex", ["front", "q_front", "side", "back", "q_back", "top"]), out_dir / "turnaround.png")
# 2. weights
sh.color_type = "VERTEX"
paint(None)
sheet(render("w", ["front", "q_front", "side", "back", "q_back", "top"]), out_dir / "weights.png", legend=True)

pb = {b.name: b for b in arm.pose.bones}


def reset() -> None:
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def rot_world(name: str, axis, deg: float) -> None:
    if name not in pb:
        return
    b = pb[name]
    head = b.head.copy()
    ax = (arm.matrix_world.inverted().to_3x3() @ Vector(axis)).normalized()
    R = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, ax) @ Matrix.Translation(-head)
    b.matrix = R @ b.matrix
    bpy.context.view_layer.update()


report = {"asset": glb.name, "height_m": round(H, 3), "bones": bones, "legend": deform, "per_bone": per_bone,
          "flag": STRETCH_FLAG, "poses": {}}
for name, ops in poses.items():
    reset()
    for b, ax, deg in ops:
        rot_world(b, ax, deg)
    co = evaluated_coords()
    st = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1) / rest_len
    moved = np.linalg.norm(co - rest, axis=1) > 0.01 * H
    mv = st[moved[edges[:, 0]] | moved[edges[:, 1]]]
    mv = mv if len(mv) else st
    paint(st)
    sheet(render(name, ["front", "side", "q_front"]), out_dir / f"pose_{name}.png")
    report["poses"][name] = {"p99": round(float(np.percentile(mv, 99)), 3), "max": round(float(mv.max()), 2),
                             "over_flag": round(float((mv > STRETCH_FLAG).mean()), 5), "moved_edges": int(len(mv))}
reset()
(out_dir / "review.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
print("NATIVE_REVIEW", json.dumps({k: v["p99"] for k, v in report["poses"].items()}))
