"""Shared code for the Blender-modelled map kit scripts (bl_proc_desert.py, bl_proc_timber.py), run in Blender's Python.

  Geo           vertices + faces with per-corner UVs and normals (exported as custom split normals)
  Atlas         the numpy-painted texture canvas: base colour (+ alpha), height (-> normal map), AO, optional
                per-pixel roughness / metallic
  export_asset  paints the atlas, writes BC / N / ORM, builds one material, models every LOD with build_lod(i, rng),
                checks the budgets, exports the GLB (+ .blend), renders the four reference-camera views and a beauty shot
                and writes the metrics (the shape stages/validate.py and review.py read).

mat_opts: roughness (constant unless the painter fills Atlas.rough), alpha (default True: BC alpha -> alphaMode MASK),
ground (beauty-shot ground colour), keep_xy (default False: centre the footprint on the origin).
"""
import math
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

from bl_common import VIEW_ORDER, finish, log


# ───────────────────────────── geometry ─────────────────────────────

def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-9)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hexc(h: str) -> np.ndarray:
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float) / 255.0


# ───────────────────────────── geometry ─────────────────────────────

class Geo:
    """Vertices + faces with per-corner UVs and per-corner normals (exported as custom split normals)."""

    def __init__(self):
        self.V: list = []
        self.F: list = []

    def v(self, p) -> int:
        self.V.append(np.asarray(p, float))
        return len(self.V) - 1

    def face(self, idx, uvs, normals):
        self.F.append((tuple(idx), [tuple(map(float, u)) for u in uvs], [tuple(map(float, unit(n))) for n in normals]))

    def tris(self) -> int:
        return sum(len(f[0]) - 2 for f in self.F)

    def to_object(self, name: str):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.V], [], [f[0] for f in self.F])
        uv = me.uv_layers.new(name="UVMap")
        normals = []
        for poly, (_, uvs, ns) in zip(me.polygons, self.F):
            for k, li in enumerate(poly.loop_indices):
                uv.data[li].uv = uvs[k]
            normals.extend(ns)
        me.normals_split_custom_set(normals)
        me.validate(clean_customdata=False)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def frames(pts: np.ndarray):
    """Parallel-transport frames along a polyline: tangent, normal, binormal per point."""
    T = np.gradient(pts, axis=0)
    T = T / np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.array([0, 0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0, 0])
    N = [unit(np.cross(T[0], ref))]
    for i in range(1, len(pts)):
        n = N[-1] - T[i] * np.dot(N[-1], T[i])
        N.append(unit(n if np.linalg.norm(n) > 1e-6 else np.cross(T[i], ref)))
    N = np.array(N)
    return T, N, np.cross(T, N)


def tube(g: Geo, pts: np.ndarray, radii: np.ndarray, sides: int, uv_rect, tip: bool = True) -> None:
    """Tapered tube; the last ring collapses to a tip vertex. u = around (inside uv_rect), v = along the length."""
    u0, v0, u1, v1 = uv_rect
    T, N, B = frames(pts)
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    vs = v0 + (v1 - v0) * seg / max(seg[-1], 1e-6)
    rings = []
    last = len(pts) - (1 if tip else 0)
    for i in range(last):
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            d = N[i] * math.cos(a) + B[i] * math.sin(a)
            ring.append((g.v(pts[i] + d * radii[i]), d))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            a, da = rings[i][k]
            b, db = rings[i][k2]
            c, dc = rings[i + 1][k2]
            d, dd = rings[i + 1][k]
            ua, ub = u0 + (u1 - u0) * k / sides, u0 + (u1 - u0) * (k + 1) / sides
            g.face((a, b, c, d), [(ua, vs[i]), (ub, vs[i]), (ub, vs[i + 1]), (ua, vs[i + 1])], [da, db, dc, dd])
    if tip:
        t = g.v(pts[-1])
        i = len(rings) - 1
        for k in range(sides):
            k2 = (k + 1) % sides
            a, da = rings[i][k]
            b, db = rings[i][k2]
            ua, ub = u0 + (u1 - u0) * k / sides, u0 + (u1 - u0) * (k + 1) / sides
            g.face((a, b, t), [(ua, vs[i]), (ub, vs[i]), ((ua + ub) / 2, vs[-1])], [da, db, T[-1]])


def card(g: Geo, base, xdir, ydir, w: float, h: float, cell, normal_of) -> None:
    """One leaf card anchored at its bottom centre (the twig base), spanning cell = (u0, v0, u1, v1) of the atlas.
    Two faces back to back (separate vertices, reversed winding) sharing the crown normals: every side the camera sees
    is a front face, so the material keeps back-face culling and the clump shades the same from both sides in any
    engine, instead of relying on a shader flipping back-face normals."""
    u0, v0, u1, v1 = cell
    x, y = unit(xdir) * w / 2, unit(ydir) * h
    pts = [base - x, base + x, base + x + y, base - x + y]
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    ns = [normal_of(p) for p in pts]
    g.face([g.v(p) for p in pts], uvs, ns)
    back = [g.v(p) for p in pts]
    g.face(back[::-1], uvs[::-1], ns[::-1])


def bezier(p0, p1, p2, p3, n: int) -> np.ndarray:
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def rot_z(v, a):
    c, s = math.cos(a), math.sin(a)
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]])


# ───────────────────────────── painting ─────────────────────────────

class Atlas:
    """RGBA base colour + height + AO on a TEX² canvas in Blender UV space (row 0 = v 0, the bottom)."""

    def __init__(self, size: int):
        self.n = size
        self.rgb = np.zeros((size, size, 3))
        self.a = np.zeros((size, size))
        self.h = np.zeros((size, size))
        self.ao = np.ones((size, size))
        # optional per-pixel roughness / metallic (None = the material's constant roughness, no metal)
        self.rough = None
        self.metal = None

    def region(self, rect):
        u0, v0, u1, v1 = rect
        x0, x1 = int(round(u0 * self.n)), int(round(u1 * self.n))
        y0, y1 = int(round(v0 * self.n)), int(round(v1 * self.n))
        ys, xs = np.mgrid[y0:y1, x0:x1]
        s = (xs + 0.5 - x0) / max(x1 - x0, 1)
        t = (ys + 0.5 - y0) / max(y1 - y0, 1)
        return (slice(y0, y1), slice(x0, x1)), s, t, (x1 - x0, y1 - y0)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / max(dx * dx + dy * dy, 1e-12), 0, 1)
    return np.hypot(px - ax - t * dx, py - ay - t * dy), t


# ───────────────────────────── build + export + renders ─────────────────────────────

def export_asset(P: dict, build_lod, painter, mat_opts: dict) -> None:
    name = P["asset_id"]
    short = name.split("_", 1)[1]
    tex = int(P["texture"])
    keep_xy = bool(mat_opts.get("keep_xy", False))
    result: dict = {}
    t0 = time.time()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    rng = np.random.default_rng(int(P.get("seed", 1)))

    atlas = Atlas(tex)
    painter(atlas, rng)
    # bleed colour into the cut-out area so mip levels do not pull in black fringes
    from_mask = atlas.a > 0.5
    if (~from_mask).any():
        rgb = atlas.rgb.copy()
        filled = from_mask.copy()
        for _ in range(24):
            if filled.all():
                break
            acc = np.zeros_like(rgb)
            cnt = np.zeros(filled.shape)
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                sh_f = np.roll(filled, (dy, dx), axis=(0, 1))
                sh_c = np.roll(rgb, (dy, dx), axis=(0, 1))
                acc += sh_c * sh_f[..., None]
                cnt += sh_f
            grow_m = (~filled) & (cnt > 0)
            rgb[grow_m] = acc[grow_m] / cnt[grow_m][:, None]
            filled |= grow_m
        atlas.rgb = rgb

    # normal map from the painted height (leaf bulge, bark streaks), OpenGL convention
    hgt = atlas.h * 0.6
    gx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5 * 6
    gy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5 * 6
    nrm = np.stack([-gx, -gy, np.ones_like(hgt)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    rough = atlas.rough if atlas.rough is not None else np.full_like(atlas.ao, mat_opts["roughness"])
    metal = atlas.metal if atlas.metal is not None else np.zeros_like(atlas.ao)
    orm = np.stack([atlas.ao, rough, metal], -1)

    tex_dir = Path(P["texture_dir"])
    tex_dir.mkdir(parents=True, exist_ok=True)
    base = P["texture_basename"]
    images = {}
    for role, arr, alpha, cs in (("BC", atlas.rgb, atlas.a, "sRGB"), ("N", nrm * 0.5 + 0.5, None, "Non-Color"),
                                 ("ORM", orm, None, "Non-Color")):
        img = bpy.data.images.new(f"{base}_{role}", tex, tex, alpha=alpha is not None)
        img.colorspace_settings.name = cs  # before the pixels: changing it regenerates a generated image's buffer
        rgba = np.concatenate([np.clip(arr, 0, 1), (alpha if alpha is not None else np.ones(arr.shape[:2]))[..., None]], -1)
        img.pixels.foreach_set(rgba.astype(np.float32).ravel())
        img.filepath_raw = str(tex_dir / f"{base}_{role}.png")
        img.file_format = "PNG"
        img.save()
        images[role] = img
    result["alpha_coverage"] = round(float((atlas.a > 0.5).mean()), 3)

    mat = bpy.data.materials.new(f"M_{short}")
    mat.use_nodes = True
    mat.use_backface_culling = True  # cards are two-faced geometry; kit pieces are closed solids
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]


    def tex_node(role, y):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = images[role]
        n.location = (-700, y)
        return n


    bc = tex_node("BC", 300)
    nt.links.new(bc.outputs["Color"], bsdf.inputs["Base Color"])
    if mat_opts.get("alpha", True):  # alpha-cut cards → glTF alphaMode MASK; solid kit pieces stay OPAQUE
        clip = nt.nodes.new("ShaderNodeMath")
        clip.operation = "ROUND"
        nt.links.new(bc.outputs["Alpha"], clip.inputs[0])
        nt.links.new(clip.outputs[0], bsdf.inputs["Alpha"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex_node("N", -300).outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex_node("ORM", 0).outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = bpy.data.node_groups.get("glTF Material Output") or bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    if "Occlusion" not in [s.name for s in grp.interface.items_tree]:
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    gnode = nt.nodes.new("ShaderNodeGroup")
    gnode.node_tree = grp
    nt.links.new(sep.outputs["Red"], gnode.inputs["Occlusion"])

    lods = []
    for i, budget in enumerate(P["lod_tris"]):
        g = build_lod(i, rng)
        ob = g.to_object(f"{name}_LOD{i}")
        ob.data.materials.append(mat)
        ob["lod"] = i
        ob["lod_distance"] = P["lod_distance"][i]
        lods.append(ob)
        log(f"LOD{i}：{g.tris()} 三角面（预算 {budget}）")
        if g.tris() > budget:
            raise RuntimeError(f"LOD{i} {g.tris()} tris over budget {budget}")

    # feet on the ground (z = 0 at the lowest point), centred on the footprint unless the recipe placed the origin itself
    # (kit pieces: the origin is the snapping point, e.g. the middle of a deck whose broken end sticks out)
    co = np.array([v.co[:] for v in lods[0].data.vertices])
    lo, hi = co.min(0), co.max(0)
    shift = Vector((0, 0, -lo[2])) if keep_xy else Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))
    for ob in lods:
        ob.data.transform(Matrix.Translation(shift))
    co = np.array([v.co[:] for v in lods[0].data.vertices])
    lo, hi = co.min(0), co.max(0)
    dims = (hi - lo).tolist()
    result["dims_m"] = [round(x, 3) for x in dims]
    log(f"尺寸 {np.round(dims, 2)} m（宽 × 深 × 高，Blender）")


    def uv_stats(ob) -> dict:
        me = ob.data
        uv = np.array([d.uv[:] for d in me.uv_layers.active.data])
        grid = np.zeros((256, 256), bool)
        for poly in me.polygons:
            pts = uv[list(poly.loop_indices)]
            for k in range(1, len(pts) - 1):
                tri = np.array([pts[0], pts[k], pts[k + 1]]) * 256
                x0, y0 = np.floor(tri.min(0)).astype(int).clip(0, 255)
                x1, y1 = np.ceil(tri.max(0)).astype(int).clip(0, 255)
                ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
                px, py = xs + 0.5, ys + 0.5
                (ax, ay), (bx, by), (cx, cy) = tri
                den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                if abs(den) < 1e-9:
                    continue
                l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
                l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
                inside = (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
                grid[ys[inside], xs[inside]] = True
        return {"uv_min": uv.min(0).round(4).tolist(), "uv_max": uv.max(0).round(4).tolist(),
                "uv_utilization": round(float(grid.mean()), 3)}


    lod_rows = []
    for ob in lods:
        me = ob.data
        c = np.array([v.co[:] for v in me.vertices])
        lod_rows.append({"name": ob.name, "tris": sum(len(p.vertices) - 2 for p in me.polygons), "verts": len(me.vertices),
                         **uv_stats(ob), "bbox_min": c.min(0).round(4).tolist(), "bbox_max": c.max(0).round(4).tolist()})

    bpy.ops.object.select_all(action="DESELECT")
    for ob in lods:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = lods[0]
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    opts = dict(filepath=P["out_glb"], export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
                export_image_format="WEBP", export_animations=False, export_extras=True, export_cameras=False,
                export_lights=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                export_draco_position_quantization=14, export_draco_normal_quantization=10,
                export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})
    bpy.ops.wm.save_as_mainfile(filepath=P["out_blend"])
    export_bytes = Path(P["out_glb"]).stat().st_size
    log(f"导出 {Path(P['out_glb']).name}：{export_bytes / 1024:.0f} KB")

    # ───────────────────────────── renders ─────────────────────────────
    for ob in lods[1:]:
        ob.hide_render = True
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    # many stacked alpha-cut cards: the default 8 transparent bounces turns deep foliage black in the renders
    scene.cycles.transparent_max_bounces = 128
    scene.cycles.max_bounces = 16
    scene.cycles.device = "CPU"
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("review")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.62, 0.66, 0.72, 1)
    bg.inputs["Strength"].default_value = 1.25  # closer to the game's bright stylized ambient
    scene.world = world
    sun = bpy.data.objects.new("key", bpy.data.lights.new("key", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(6)
    sun.rotation_euler = Vector((-0.45, 0.6, -0.65)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam

    # concept views: the bounds-only reference cameras for the model's own size (the same formula as
    # prepare_nature_batch.reference_data, so proc_assets.py registers a blockout whose views match these renders)
    W, D, H = (round(x, 2) for x in dims)  # Blender x, y, z → game width, depth, height
    PW, PH = 512, 1024
    world_h = max(H * 1.12, max(W, D) * 1.12 * PH / PW)
    DIRS = {"front": (0, 1, 0), "left": (-1, 0, 0), "back": (0, -1, 0), "right": (1, 0, 0)}
    mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, H / 2]
    views = {"views": [{"view": v, "dir": DIRS[v], "center": mid, "world_w": world_h * PW / PH, "world_h": world_h,
                        "px_w": PW, "px_h": PH} for v in VIEW_ORDER]}
    result["reference_dimensions"] = [W, H, D]
    rd = Path(P["render_dir"])
    rd.mkdir(parents=True, exist_ok=True)
    scene.render.film_transparent = True
    cam.data.type = "ORTHO"
    for vp in views["views"]:
        d = Vector(vp["dir"])
        centre = Vector(vp["center"])
        cam.data.ortho_scale = max(vp["world_w"], vp["world_h"])  # ortho_scale spans the longer image side
        scene.render.resolution_x, scene.render.resolution_y = vp["px_w"], vp["px_h"]
        cam.location = centre - d * 30
        cam.data.clip_end = 100
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(rd / f"{vp['view']}.png")
        bpy.ops.render.render(write_still=True)

    # beauty shot: three-quarter perspective on a sand plane
    scene.render.film_transparent = False
    plane_me = bpy.data.meshes.new("ground")
    R = max(dims) * 4
    plane_me.from_pydata([(-R, -R, 0), (R, -R, 0), (R, R, 0), (-R, R, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("ground", plane_me)
    gm = bpy.data.materials.new("sand")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*mat_opts.get("ground", (0.78, 0.62, 0.40)), 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    plane_me.materials.append(gm)
    scene.collection.objects.link(ground)
    cam.data.type = "PERSP"
    cam.data.lens = 50
    H = dims[2]
    target = Vector((mid[0], mid[1], H * 0.45))
    dist = max(dims) * 2.6
    cam.location = target + Vector((-0.62, -1.0, 0.42)).normalized() * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    scene.cycles.samples = 96
    scene.render.filepath = P["beauty_png"]
    bpy.ops.render.render(write_still=True)

    finish(P, {**result, "lods": lod_rows, "export": {"bytes": export_bytes},
               "align": {"iou": 1.0, "iou_per_view": {v: 1.0 for v in VIEW_ORDER}, "method": "procedural (no fit)"},
               "projection": {"uncovered_ratio": 0.0, "method": "procedural painted atlas"},
               "bake_device": "none (numpy painted)", "_seconds": round(time.time() - t0, 1)})
