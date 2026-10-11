"""Skin review for native-skeleton creatures / bosses built by build_tripo_creature.py, posed with the asset's ROM table.

    blender -b --python art/tools/review_creature_rom.py -- <build.glb> <out_dir> <asset_id>

1. Weight map: every LOD0 vertex coloured by its dominant bone (one colour per bone, chains as gradients), rendered
   front / side / back / three-quarter. Weight bleed shows up as a patch of the wrong colour.
2. ROM poses: `[assets.<asset_id>.rom]` in art/pipeline/registry.toml, `pose = { bone = [rx, ry, rz] }` — a rotation
   vector (axis × angle, radians) in the runtime's model space (X = the creature's left, Y = up, Z = front), exactly what
   the enemy code passes to NativePose.rotate. Rotations compose like NativePose: a child's axis is carried by its
   parent's motion (applied leaves first, then parents). Each pose is rendered with magenta on faces whose edges
   stretch more than STRETCH_FLAG × their rest length.
3. <out_dir>/rom_review.json (per pose stretch p99 / max / fraction over the flag, over the edges that moved; the same p99
   weighted by rest edge length and the share of the moved surface AREA on flagged faces; per bone the dominant vertex
   count) and <out_dir>/rom_sheet.png (all images in one contact sheet).
   Tripo smart meshes carry many sub-millimetre edges whose ratio jumps on tiny absolute motion: the plain edge p99 then
   reads > 1.8 although no flagged face is visible. Judge by the length-weighted p99 and the flagged area share.

Calibration from the enemy pipeline: p99 stretch > 1.8 marks broken deformation. Bosses must be reviewed with the real
attack poses (random small poses hid a p99 of 9.7 on a boss arm).
"""
import colorsys
import json
import math
import sys
import tomllib
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out_dir = Path(argv[0]).resolve(), Path(argv[1]).resolve()
asset = argv[2]
out_dir.mkdir(parents=True, exist_ok=True)
STRETCH_FLAG = 1.8
ROOT = Path(__file__).resolve().parents[2]
reg = tomllib.loads((ROOT / "art/pipeline/registry.toml").read_text(encoding="utf-8"))
ROM: dict = reg["assets"][asset].get("rom", {})

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(glb))
for o in list(bpy.data.objects):
    if o.type == "MESH" and not o.name.endswith("LOD0"):
        bpy.data.objects.remove(o)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
bones = [b.name for b in arm.data.bones]

# colours: hue per bone in hierarchy order; chains (name_1, name_2 …) share a hue with rising brightness
families = sorted({b.rsplit("_", 1)[0] if b[-1].isdigit() else b for b in bones})
hue = {f: (i * 0.61803) % 1.0 for i, f in enumerate(families)}


def bone_colour(n: str) -> tuple:
    fam = n.rsplit("_", 1)[0] if n[-1].isdigit() else n
    k = int(n.rsplit("_", 1)[1]) if n[-1].isdigit() else 1
    return colorsys.hsv_to_rgb(hue[fam], 0.75, 0.45 + 0.18 * (k - 1))


vg_name = {g.index: g.name for g in mesh.vertex_groups}
me = mesh.data
nv = len(me.vertices)
dom = []
for v in me.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom.append(vg_name[best.group] if best else "")
base_rgb = np.array([bone_colour(d) if d else (1, 1, 1) for d in dom])
counts = {b: dom.count(b) for b in bones if dom.count(b)}


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
attr = me.color_attributes.new("rigview", "BYTE_COLOR", "CORNER")
loop_vert = np.array([l.vertex_index for l in me.loops])
poly_of_loop = np.zeros(len(me.loops), int)
for p in me.polygons:
    poly_of_loop[p.loop_start:p.loop_start + p.loop_total] = p.index
edge_key = {tuple(sorted(e)): k for k, e in enumerate(edges.tolist())}
poly_edges = [[edge_key[tuple(sorted(k))] for k in p.edge_keys] for p in me.polygons]
poly_area = np.array([p.area for p in me.polygons])
poly_verts = [list(p.vertices) for p in me.polygons]


def weighted_pct(x: np.ndarray, w: np.ndarray, q: float) -> float:
    o = np.argsort(x)
    c = np.cumsum(w[o])
    return float(x[o][min(len(x) - 1, int(np.searchsorted(c, q * c[-1])))])


def paint(stretch) -> None:
    rgb = base_rgb[loop_vert].copy()
    if stretch is not None:
        bad = np.array([stretch[pe].max() > STRETCH_FLAG for pe in poly_edges])
        rgb[bad[poly_of_loop]] = (1.0, 0.0, 0.85)
    rgba = np.concatenate([rgb, np.ones((len(rgb), 1))], 1).ravel()
    attr.data.foreach_set("color", rgba.astype(np.float32))
    me.update()


scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "VERTEX"
shading.show_cavity = True
RES = 560
scene.render.resolution_x = scene.render.resolution_y = RES
scene.world = bpy.data.worlds.new("w")
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = "ORTHO"
VIEWS = {"front": Vector((0, -1, 0)), "side": Vector((1, 0, 0)), "back": Vector((0, 1, 0)),
         "threeq": Vector((0.75, -0.66, 0.12)).normalized(), "below": Vector((0.3, -0.5, -0.8)).normalized()}
images: list[tuple[str, Path]] = []


def render(name: str, views) -> list[str]:
    co = evaluated_coords()
    lo, hi = co.min(0), co.max(0)
    centre = Vector(((lo + hi) / 2).tolist())
    cam.data.ortho_scale = float(max(hi - lo)) * 1.08
    cam.data.clip_end = 30 * H
    names = []
    for v in views:
        d = VIEWS[v]
        cam.location = centre + d * 6 * H
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        p = out_dir / f"{name}_{v}.png"
        scene.render.filepath = str(p)
        bpy.ops.render.render(write_still=True)
        images.append((f"{name} · {v}", p))
        names.append(p.name)
    return names


pb = {b.name: b for b in arm.pose.bones}
depth = {b.name: len(b.parent_recursive) for b in arm.pose.bones}


def reset() -> None:
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def game_to_blender(v) -> Vector:
    return Vector((v[0], -v[2], v[1]))


def apply_pose(spec: dict) -> None:
    """NativePose semantics: rotation vectors in the model's rest frame; children first, parents carry them."""
    to_arm = arm.matrix_world.inverted().to_3x3()
    for name in sorted((n for n in spec if n in pb), key=lambda n: -depth[n]):
        rv = game_to_blender(spec[name])
        ang = rv.length
        if ang < 1e-6:
            continue
        b = pb[name]
        head = b.bone.head_local.copy()          # rest head (ancestors not posed yet)
        ax = (to_arm @ rv).normalized()
        R = Matrix.Translation(head) @ Matrix.Rotation(ang, 4, ax) @ Matrix.Translation(-head)
        b.matrix = R @ b.matrix
        bpy.context.view_layer.update()


report = {"asset": asset, "glb": glb.name, "height_m": round(H, 3), "bones": len(bones), "flag": STRETCH_FLAG,
          "dominant_verts": counts, "poses": {}}
paint(None)
report["weight_map"] = render("weights", ("front", "side", "back", "threeq"))
for name, spec in ROM.items():
    reset()
    apply_pose(spec)
    co = evaluated_coords()
    st = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1) / rest_len
    moved = np.linalg.norm(co - rest, axis=1) > 0.01 * H
    sel = moved[edges[:, 0]] | moved[edges[:, 1]]
    if not sel.any():
        sel[:] = True
    mv = st[sel]
    paint(st)
    bad = np.array([st[pe].max() > STRETCH_FLAG for pe in poly_edges])
    mface = np.array([moved[v].any() for v in poly_verts])
    area_bad = float(poly_area[bad & mface].sum() / max(1e-9, poly_area[mface].sum()))
    report["poses"][name] = {"p99": round(float(np.percentile(mv, 99)), 3), "max": round(float(mv.max()), 2),
                             "p99_len": round(weighted_pct(mv, rest_len[sel], 0.99), 3),
                             "flag_area": round(area_bad, 5),
                             "over_flag": round(float((mv > STRETCH_FLAG).mean()), 5), "moved_edges": int(len(mv)),
                             "images": render(f"rom_{name}", ("front", "side", "threeq"))}
reset()
(out_dir / "rom_review.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")

# contact sheet (4 images per row)
cols = 4
rows = math.ceil(len(images) / cols)
sheet = np.ones((rows * RES, cols * RES, 4), np.float32)
for i, (_, p) in enumerate(images):
    img = bpy.data.images.load(str(p))
    px = np.array(img.pixels[:], np.float32).reshape(RES, RES, 4)
    r, c = divmod(i, cols)
    y0 = (rows - 1 - r) * RES                       # Blender images are bottom-up
    sheet[y0:y0 + RES, c * RES:(c + 1) * RES] = px
    bpy.data.images.remove(img)
out = bpy.data.images.new("rom_sheet", cols * RES, rows * RES, alpha=True)
out.pixels.foreach_set(sheet.ravel())
out.filepath_raw = str(out_dir / "rom_sheet.png")
out.file_format = "PNG"
out.save()
print("ROM_REVIEW", json.dumps({k: {"p99": v["p99"], "p99_len": v["p99_len"], "flag_area": v["flag_area"]} for k, v in report["poses"].items()}))
print("SHEET_ORDER", json.dumps([n for n, _ in images], ensure_ascii=False))
