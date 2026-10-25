"""Game build for Tripo Studio P2.0 sources: the provider already ships a game-weight mesh with PBR images.

Unlike bl_build.py (Hunyuan shape + concept projection), this keeps the provider's UVs and textures:
  1. import + join, uniform fit to the bounds-only reference, yaw chosen by concept silhouettes, feet on ground;
  2. one LOD: the provider mesh as it is (triangulated, no decimation; 2026-10-25 the user: 「不要减面了」);
  3. provider base colour / normal / metal-roughness repacked to T_<name>_BC / _N / _ORM at the class budget;
  4. GLB export (Draco + WebP) with the same node names, extras and metrics as bl_build.py.
"""
import json
import math
import time
from pathlib import Path

import bpy
import numpy as np

import sys as _sys
_sys.path.insert(0, str(Path(__file__).parent))
from bl_common import args, clear_scene, finish, import_glb, log

P = args()
RESULT: dict = {}
T0 = time.time()
VIEW_ORDER = ["front", "left", "back", "right"]
name = P["asset_id"]


def activate(obj, others=()):
    bpy.ops.object.select_all(action="DESELECT")
    for o in (obj, *others):
        o.select_set(True)
    bpy.context.view_layer.objects.active = obj


def mesh_verts(obj) -> np.ndarray:
    v = np.empty(len(obj.data.vertices) * 3, np.float64)
    obj.data.vertices.foreach_get("co", v)
    return v.reshape(-1, 3)


def set_verts(obj, v: np.ndarray) -> None:
    obj.data.vertices.foreach_set("co", v.astype(np.float32).ravel())
    obj.data.update()


# ── 1. import ──
clear_scene()
parts = [o for o in import_glb(P["highpoly_glb"]) if o.type == "MESH"]
for o in [o for o in bpy.data.objects if o.type != "MESH"]:
    bpy.data.objects.remove(o)
activate(parts[0], parts[1:])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(parts) > 1:
    bpy.ops.object.join()
src = bpy.context.view_layer.objects.active
src.name = "SRC"
# The provider mesh arrives split along its UV seams (glTF/FBX vertices are per UV), twin vertices up to ~1e-4 m
# apart. Decimating it split, each UV island's border simplifies on its own and the LODs open hairline cracks
# that show the sky through walls; weld first (UVs and custom normals live on the loops, so both survive).
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-4)
bpy.ops.object.mode_set(mode="OBJECT")
materials = [m for m in src.data.materials if m]
if len(materials) != 1:
    raise RuntimeError(f"expected one provider material, got {[m.name for m in materials]}")
RESULT["source"] = {"tris": sum(len(p.vertices) - 2 for p in src.data.polygons), "verts": len(src.data.vertices)}

# ── 2. fit to reference ──
views = json.loads(Path(P["views_json"]).read_text(encoding="utf-8"))
VP = {v["view"]: v for v in views["views"]}
bmin, bmax = np.array(views["bbox_min"]), np.array(views["bbox_max"])
ref = bmax - bmin  # x width, y depth, z height (Blender axes)
DS = 4
masks = {}
for v in VIEW_ORDER:
    img = bpy.data.images.load(P["concept_views"][v], check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], np.float32).reshape(h, w, 4)[::-1]
    bpy.data.images.remove(img)
    m = px[..., 3] > 0.5
    masks[v] = m[: h - h % DS, : w - w % DS].reshape(h // DS, DS, w // DS, DS).any(axis=(1, 3))


def silhouette(vp: dict, pts: np.ndarray) -> np.ndarray:
    c, r, u = np.array(vp["center"]), np.array(vp["right"]), np.array(vp["up"])
    x = ((pts - c) @ r / vp["world_w"] + 0.5) * vp["px_w"] / DS
    y = (0.5 - (pts - c) @ u / vp["world_h"]) * vp["px_h"] / DS
    H, W = vp["px_h"] // DS, vp["px_w"] // DS
    xi, yi = x.astype(np.int64), y.astype(np.int64)
    ok = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
    s = np.zeros((H, W), bool)
    s[yi[ok], xi[ok]] = True
    d = s | np.roll(s, 1, 0) | np.roll(s, -1, 0) | np.roll(s, 1, 1) | np.roll(s, -1, 1)
    return d & (np.roll(d, 1, 0) | np.roll(d, -1, 0)) & (np.roll(d, 1, 1) | np.roll(d, -1, 1)) | s


def fitted(pts: np.ndarray) -> tuple[np.ndarray, float]:
    lo, hi = pts.min(0), pts.max(0)
    size = np.maximum(hi - lo, 1e-6)
    # Height is the design dimension; the footprint may exceed the reference slightly (engine fits colliders).
    s = min(ref[2] / size[2], ref[0] * 1.12 / size[0], ref[1] * 1.12 / size[1])
    # Into the reference box: horizontally centred on it, bottom on its floor. Scene props' boxes are centred with the
    # floor at z = 0 (feet on the ground); attachments' boxes sit in socket space (a fire ball centred on its socket).
    out = (pts - [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]]) * s + [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, bmin[2]]
    return out, s


def score(pts: np.ndarray) -> tuple[float, dict]:
    per = {}
    for v in VIEW_ORDER:
        sv, mk = silhouette(VP[v], pts), masks[v]
        per[v] = float((sv & mk).sum() / max(1, (sv | mk).sum()))
    weights = {"front": 1.5, "back": 1.0, "left": 1.0, "right": 1.0}
    return sum(per[v] * weights[v] for v in VIEW_ORDER) / 4.5, per


V0 = mesh_verts(src)


def surface_samples(obj, n: int = 80000) -> np.ndarray:
    """Area-weighted points on the triangles: a low-poly mesh's vertices alone leave holey silhouettes."""
    me = obj.data
    me.calc_loop_triangles()
    tri = np.empty(len(me.loop_triangles) * 3, np.int64)
    me.loop_triangles.foreach_get("vertices", tri)
    tri = tri.reshape(-1, 3)
    a, b, c = V0[tri[:, 0]], V0[tri[:, 1]], V0[tri[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2
    rng = np.random.default_rng(0)
    pick = rng.choice(len(tri), n, p=area / area.sum())
    u, v = rng.random(n), rng.random(n)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    return a[pick] + (b[pick] - a[pick]) * u[:, None] + (c[pick] - a[pick]) * v[:, None]


sample = surface_samples(src)
cands = []
for k in range(4):
    a = k * math.pi / 2
    R = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    pts, _ = fitted(sample @ R.T)
    sc, per = score(pts)
    cands.append((sc, k, R, per))
    log(f"朝向候选 {k * 90:3d}°：IoU {sc:.3f}")
best = cands[0]
for c in cands[1:]:
    if c[0] > best[0] + 0.06:
        best = c
iou, yaw_k, R, per = best
full, scale = fitted(V0 @ R.T)
set_verts(src, full)
dims = full.max(0) - full.min(0)
RESULT["align"] = {"yaw_deg": yaw_k * 90, "scale": round(float(scale), 5), "iou": round(float(iou), 3),
                   "iou_per_view": {k: round(v, 3) for k, v in per.items()},
                   "size_m": [round(float(x), 3) for x in dims], "reference_m": [round(float(x), 3) for x in ref]}
RESULT["projection"] = {"uncovered_ratio": 0.0, "method": "provider textures (Tripo), no concept projection"}
log(f"对齐：朝向 {yaw_k * 90}°，缩放 {scale:.4f}，尺寸 {np.round(dims, 2)}（参考 {np.round(ref, 2)}），IoU {iou:.3f}")

# ── 3. LOD0: the provider mesh, triangulated, no decimation ──
lod0 = bpy.data.objects.new(f"{name}_LOD0", src.data.copy())
bpy.context.scene.collection.objects.link(lod0)
activate(lod0)
tri = lod0.modifiers.new("tri", "TRIANGULATE")
bpy.ops.object.modifier_apply(modifier=tri.name)
lod0.data.validate(clean_customdata=False)
lods = [lod0]
log(f"LOD0：{len(lod0.data.polygons)} 三角面（不减面，参考 {P['lod_tris'][0]}）")

# ── 4. textures ──
mat = materials[0]
nodes = mat.node_tree.nodes
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")


def upstream_image(socket, depth=0):
    if not socket.is_linked or depth > 6:
        return None
    node = socket.links[0].from_node
    if node.type == "TEX_IMAGE":
        return node.image
    for inp in node.inputs:
        img = upstream_image(inp, depth + 1)
        if img:
            return img
    return None


img_base = upstream_image(bsdf.inputs["Base Color"])
img_normal = upstream_image(bsdf.inputs["Normal"])
img_mr = upstream_image(bsdf.inputs["Roughness"]) or upstream_image(bsdf.inputs["Metallic"])
if img_base is None:
    raise RuntimeError("provider material has no base colour image")
size = P["texture"]


def pixels(img) -> np.ndarray:
    copy = img.copy()
    copy.scale(size, size)
    px = np.array(copy.pixels[:], np.float32).reshape(size, size, 4)
    bpy.data.images.remove(copy)
    return px


def new_image(suffix: str, data: np.ndarray, colorspace: str):
    img = bpy.data.images.new(f"T_{P['texture_name']}_{suffix}", size, size, alpha=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(data.ravel())
    img.file_format = "PNG"
    out = Path(P["texture_dir"]) / f"{img.name}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.filepath_raw = str(out)
    img.save()
    img.pack()
    return img


bc = pixels(img_base); bc[..., 3] = 1.0
img_bc = new_image("BC", bc, "sRGB")


def detail_normal(colour: np.ndarray, strength: float = 2.5) -> np.ndarray:
    """Tangent-space detail normal from painted luminance (darker paint reads as recessed), softened first."""
    lum = colour[..., 0] * 0.2126 + colour[..., 1] * 0.7152 + colour[..., 2] * 0.0722
    for _ in range(2):  # small box blur keeps broad painted forms, drops pixel noise
        lum = (lum + np.roll(lum, 1, 0) + np.roll(lum, -1, 0) + np.roll(lum, 1, 1) + np.roll(lum, -1, 1)) / 5
    dv, du = np.gradient(lum)  # pixel rows run bottom→top in Blender, so axis 0 is +V
    n = np.stack([-du * strength * size / 256, -dv * strength * size / 256, np.ones_like(lum)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    out = np.ones((size, size, 4), np.float32)
    out[..., :3] = n * 0.5 + 0.5
    return out


img_n = new_image("N", pixels(img_normal) if img_normal else detail_normal(bc), "Non-Color")
RESULT["normal_source"] = "provider" if img_normal else "derived from painted base colour"

# Ambient occlusion baked from the game mesh itself (no provider AO): crevices, plinth steps, undersides.
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = P.get("ao_samples", 64)
scene.world = scene.world or bpy.data.worlds.new("World")
scene.world.light_settings.distance = float(max(dims)) * 0.12
img_ao = bpy.data.images.new("AO_tmp", size, size, alpha=False)
img_ao.colorspace_settings.name = "Non-Color"
bake_mat = bpy.data.materials.new("bake_tmp")
bake_mat.use_nodes = True
bake_node = bake_mat.node_tree.nodes.new("ShaderNodeTexImage")
bake_node.image = img_ao
bake_mat.node_tree.nodes.active = bake_node
lod0 = lods[0]
saved = [m for m in lod0.data.materials]
lod0.data.materials.clear(); lod0.data.materials.append(bake_mat)
activate(lod0)
# The provider mesh and the other LODs occupy the same volume: hide them or every AO ray hits a twin surface.
hidden = [o for o in bpy.data.objects if o is not lod0 and not o.hide_render]
for o in hidden:
    o.hide_render = True
bpy.ops.object.bake(type="AO", margin=P.get("bake_margin_px", 16), margin_type="EXTEND", target="IMAGE_TEXTURES")
for o in hidden:
    o.hide_render = False
ao = np.array(img_ao.pixels[:], np.float32).reshape(size, size, 4)[..., 0]
lod0.data.materials.clear()
for m in saved:
    lod0.data.materials.append(m)
bpy.data.materials.remove(bake_mat)
orm = np.ones((size, size, 4), np.float32)
orm[..., 0] = ao
RESULT["ao"] = {"mean": round(float(ao.mean()), 3), "samples": scene.cycles.samples}
if img_mr:
    mr = pixels(img_mr)
    orm[..., 1], orm[..., 2] = mr[..., 1], mr[..., 2]
else:
    orm[..., 1] = float(bsdf.inputs["Roughness"].default_value)
    orm[..., 2] = float(bsdf.inputs["Metallic"].default_value)
img_orm = new_image("ORM", orm, "Non-Color")
RESULT["textures"] = {"size": size, "base": img_base.name, "normal": img_normal.name if img_normal else None,
                      "metal_rough": img_mr.name if img_mr else None,
                      "source_size": list(img_base.size)}

game = bpy.data.materials.new(f"M_{P['texture_name']}")
game.use_nodes = True
gn, gl = game.node_tree.nodes, game.node_tree.links
gb = next(n for n in gn if n.type == "BSDF_PRINCIPLED")
t_bc = gn.new("ShaderNodeTexImage"); t_bc.image = img_bc
gl.new(t_bc.outputs["Color"], gb.inputs["Base Color"])
t_orm = gn.new("ShaderNodeTexImage"); t_orm.image = img_orm
sep = gn.new("ShaderNodeSeparateColor")
gl.new(t_orm.outputs["Color"], sep.inputs["Color"])
gl.new(sep.outputs["Green"], gb.inputs["Roughness"])
gl.new(sep.outputs["Blue"], gb.inputs["Metallic"])
t_n = gn.new("ShaderNodeTexImage"); t_n.image = img_n
nm = gn.new("ShaderNodeNormalMap")
gl.new(t_n.outputs["Color"], nm.inputs["Color"])
gl.new(nm.outputs["Normal"], gb.inputs["Normal"])
# glTF occlusion comes from the exporter's "glTF Material Output" group (same wiring as bl_build.py).
grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
gnode = gn.new("ShaderNodeGroup"); gnode.node_tree = grp
gl.new(sep.outputs["Red"], gnode.inputs["Occlusion"])
for lod in lods:
    lod.data.materials.clear()
    lod.data.materials.append(game)

# ── 5. export ──
bpy.data.objects.remove(src)
for img in list(bpy.data.images):
    if img not in (img_bc, img_n, img_orm):
        bpy.data.images.remove(img)  # provider originals and the AO scratch image
lod_metrics = []
for i, lod in enumerate(lods):
    lod["lod"] = i
    lod["lod_distance"] = P["lod_distance"][i]
    me = lod.data
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    tri_uv = uv.reshape(-1, 3, 2)
    a, b, c = tri_uv[:, 0], tri_uv[:, 1], tri_uv[:, 2]
    area = float(np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])).sum() / 2)
    co = mesh_verts(lod)
    flat = uv.reshape(-1, 2)
    lod_metrics.append({"name": lod.name, "tris": len(me.polygons), "verts": len(me.vertices),
                        "uv_min": [float(flat[:, 0].min()), float(flat[:, 1].min())],
                        "uv_max": [float(flat[:, 0].max()), float(flat[:, 1].max())],
                        "uv_utilization": round(area, 3),
                        "bbox_min": [round(float(x), 4) for x in co.min(0)], "bbox_max": [round(float(x), 4) for x in co.max(0)]})
RESULT["lods"] = lod_metrics

export = Path(P["export_glb"])
export.parent.mkdir(parents=True, exist_ok=True)
activate(lods[0], lods[1:])
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
opts = dict(filepath=str(export), export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_texcoords=True, export_normals=True, export_tangents=P["tangents"], export_materials="EXPORT",
            export_image_format=P["image_format"], export_skins=False, export_animations=False, export_morph=False,
            export_extras=True, export_cameras=False, export_lights=False,
            export_draco_mesh_compression_enable=P["draco"], export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14, export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})
RESULT["export"] = {"path": str(export), "bytes": export.stat().st_size}
bpy.ops.wm.save_as_mainfile(filepath=str(P["blend_path"]), compress=True)
RESULT["bake_device"] = "none (provider textures)"
RESULT["total_seconds"] = round(time.time() - T0, 1)
log(f"导出 {export.name}：{RESULT['export']['bytes'] / 1024:.0f} KB")
finish(P, RESULT)
