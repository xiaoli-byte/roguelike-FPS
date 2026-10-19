"""Tripo creature build (headless Blender): Tripo-rigged, textured creature → runtime skeletal GLB with a native skeleton.

Tripo's auto-rig gives a usable leg / toe skeleton but unnamed bones and creature-agnostic weights (on 蜃楼蟾 the throat
sac and face were skinned to the front-leg bones, the whole pagoda to one bone, toe chains crossed feet). This script
keeps the mesh, UVs, provider texture and the good part of the skeleton, and turns it into a semantic creature rig:

 1. Import, apply transforms (front = -Y, Z up), uniform scale to the design height, feet on z = 0, centred.
 2. Bones: keep / rename the listed Tripo bones, merge the weights of every other bone into its listed target, add new
    bones (head, sac, ...), re-parent, delete the rest.
 3. Region weights from geometry, by the rig's "profile" (see creature_rigs/<asset>.json):
    toad_sac   — sac sphere, head cap, feet by quadrant (Tripo creature rig, bone_N names);
    biped_tail — Tripo humanoid (Mixamo) rig plus bones Mixamo lacks: ears (optional), tail chain (by radius around a
                 polyline, or "island": the whole separate tail mesh island), a rigid weak-spot part.
 4. Textures: provider base colour → BC; AO bake (Cycles) → ORM (R = AO, G = roughness, B = metallic).
    "provider_pbr": the provider's own roughness / metallic maps go into ORM (else one flat roughness, no metal).
    "bake_normal": tangent-space normal map baked from the full provider mesh (with its own normal map) onto LOD0,
    so the folds / plate edges / fur clumps lost to decimation still catch the light.
    "paint_shading": providers de-light the base colour (Tripo 去光处理), which leaves a flat albedo. Stylized games keep
    painted shading in the albedo, so a short-range cavity AO (crevices, plate edges, fur clumps) and the regular AO are
    multiplied back in, with a slight contrast / saturation lift.
    "texture_cleanup": erase provider texture mistakes in a body region (e.g. a bell print the provider painted on the
    back of an ear): texels of faces inside the region that deviate from the region's own smooth colour are refilled
    with that colour (two passes, so the print itself doesn't leak into the reference).
 5. LOD0..2 by collapse decimation (vertex groups kept), ≤ 4 normalised influences, one shared skeleton.
 6. Export one GLB (Draco + WebP), save the .blend and a metrics JSON.
"""
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

from bl_common import args, finish, log  # noqa: E402

P = args()
RIG = json.loads(Path(P["rig_json"]).read_text(encoding="utf-8"))
ASSET = P["asset_id"]
SHORT = ASSET.split("_", 1)[1]           # Enemy_MirageToad
RESULT: dict = {"steps": {}}


def step(name: str, t: float) -> None:
    RESULT["steps"][name] = round(time.time() - t, 1)
    log(f"{name}（{time.time() - t:.1f} 秒）")


def activate(obj, others=()) -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in others:
        o.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def ids(spec: str) -> list[int]:
    out = []
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b or a) + 1))
    return out


# ───────────────────────────── 1. Import, units, pivot ─────────────────────────────
t = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
# Tripo originals arrive as FBX (DCC Bridge inbox) or as the committed GLB (art/source/pets/<ID>/03_model/): glTF's +Z
# front comes in as Blender −Y, the same frame the rig JSON uses.
if P["source"].lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=P["source"])
else:
    bpy.ops.import_scene.fbx(filepath=P["source"])
# Custom-skeleton rigs ("bones" in the rig JSON) take an unrigged provider mesh; Tripo-rigged ones bring an armature.
CUSTOM = "bones" in RIG
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
if CUSTOM and arm is not None:
    bpy.data.objects.remove(arm, do_unlink=True)
    arm = None
movers = [o for o in (arm, mesh) if o is not None]
activate(mesh)
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for m in list(mesh.modifiers):
    if m.type == "ARMATURE":
        mesh.modifiers.remove(m)
activate(movers[0], movers[1:])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
V = np.array([v.co[:] for v in mesh.data.vertices])
lo, hi = V.min(0), V.max(0)
s = P["height"] / (hi[2] - lo[2])
offset = Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))
for o in movers:
    o.location = offset * s
    o.scale = (s, s, s)
activate(movers[0], movers[1:])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
V = np.array([v.co[:] for v in mesh.data.vertices])
RESULT["source"] = {"verts": len(V), "tris": sum(len(p.vertices) - 2 for p in mesh.data.polygons), "scale": s}
step("导入与单位", t)


def uv_area(o) -> float:
    """Fraction of the 0..1 UV square covered by the active UV map (sum of triangle areas)."""
    me = o.data
    me.calc_loop_triangles()
    uvs = np.array([d.uv[:] for d in me.uv_layers.active.data])
    tri = np.array([t.loops[:] for t in me.loop_triangles])
    a, b, c = uvs[tri[:, 0]], uvs[tri[:, 1]], uvs[tri[:, 2]]
    return float(np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])).sum() / 2)


def mark_segment_seams() -> dict:
    """UV seams for a game-character unwrap: one island per skeleton segment (faces grouped by their dominant bone),
    and every tube-like segment cut once lengthwise on its least visible side (towards the creature's back / underside),
    so each island flattens with little stretch. Needs the semantic vertex groups and the armature."""
    me = mesh.data
    names = {g.index: g.name for g in mesh.vertex_groups}
    dom = np.full(len(me.vertices), -1)
    best = np.zeros(len(me.vertices))
    for v in me.vertices:
        for g in v.groups:
            if g.weight > best[v.index]:
                best[v.index], dom[v.index] = g.weight, g.group
    face_dom = []
    for f in me.polygons:
        ids, counts = np.unique(dom[list(f.vertices)], return_counts=True)
        face_dom.append(int(ids[np.argmax(counts)]))
    face_dom = np.array(face_dom)
    edge_faces = {}
    for f in me.polygons:
        for ek in f.edge_keys:
            edge_faces.setdefault(ek, []).append(f.index)
    # cylindrical angle of every vertex around its segment's bone axis; the cut sits on the side facing `cut_dir`
    cut_dir = Vector(RIG.get("uv_cut_dir", [0, 1, -1])).normalized()       # Blender frame: +Y = back, -Z = down
    ang = np.zeros(len(me.vertices))
    bones = arm.data.bones
    for gi, gname in names.items():
        b = bones.get(gname)
        sel = np.nonzero(dom == gi)[0]
        if b is None or len(sel) == 0:
            continue
        axis = (b.tail_local - b.head_local).normalized()
        ref = cut_dir - axis * cut_dir.dot(axis)
        if ref.length < 1e-4:
            ref = Vector((1, 0, 0)) - axis * axis.x
        ref.normalize()
        side = axis.cross(ref)
        d = V[sel] - np.array(b.head_local[:])
        # angle measured from the direction opposite the cut, so the ±π wrap (the seam) lies on the cut side
        ang[sel] = np.arctan2(d @ np.array(side[:]), d @ np.array((-ref)[:]))
    for e in me.edges:
        e.use_seam = False
    n_border = n_cut = 0
    key_to_edge = {e.key: e for e in me.edges}
    for ek, fs in edge_faces.items():
        e = key_to_edge[ek]
        if len(fs) != 2 or face_dom[fs[0]] != face_dom[fs[1]]:
            e.use_seam = True
            n_border += 1
            continue
        a, b2 = ang[ek[0]], ang[ek[1]]
        if abs(a - b2) > math.pi:
            e.use_seam = True
            n_cut += 1
    return {"segment_borders": n_border, "tube_cuts": n_cut, "segments": int(len(set(face_dom.tolist())))}


def repack_uv_and_transfer() -> None:
    """Tripo's retopo UVs leave most of the texture empty (≈ 18 % used on 蝎尾弩卫), so an 8K provider map squeezed to
    2048 keeps only ~900 px of real detail. Re-pack the same islands (scaled up, NOT rotated: rotation would break the
    provider's tangent-space normal map), then bake every provider image from the old UVs onto the new ones at
    `transfer_size` (Cycles emission bake on the same mesh: the source image is read through the old UV map, the target
    is written through the new, active one). The old UV map and images are dropped; the rest of the build is unchanged."""
    t = time.time()
    me = mesh.data
    old = me.uv_layers.active
    old_name = old.name
    before = uv_area(mesh)
    new = me.uv_layers.new(name="UVPacked")
    me.uv_layers.active = new
    new.active_render = True
    activate(mesh)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.uv.select_all(action="SELECT")
    margin = float(RIG.get("uv_margin", 0.002))
    # Tripo's retopo atlas is thousands of tiny islands (5451 on 蝎尾弩卫, 2323 of them single triangles): re-packing
    # them only wastes more space on margins, and every seam bleeds in the mips. Re-unwrap into large hard-surface
    # islands instead, then pack tightly (rotation allowed: the normal map is re-baked from the old-UV copy below).
    if RIG.get("uv_method", "segments") == "smart":
        bpy.ops.uv.smart_project(angle_limit=math.radians(float(RIG.get("uv_angle", 66))), island_margin=margin,
                                 area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    else:
        bpy.ops.object.mode_set(mode="OBJECT")
        seams = mark_segment_seams()
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="MINIMUM_STRETCH" if "MINIMUM_STRETCH" in bpy.ops.uv.unwrap.get_rna_type()
                          .properties["method"].enum_items.keys() else "ANGLE_BASED", margin=margin)
        # An island that folds over itself (or two that land on each other) would bake one colour over another:
        # re-project just the overlapping faces as their own small islands.
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.uv.select_all(action="DESELECT")
        bpy.ops.uv.select_overlap()
        import bmesh
        bm = bmesh.from_edit_mesh(mesh.data)
        uvl = bm.loops.layers.uv.active
        overlapping = sum(1 for f in bm.faces if f.select)
        # Minimum-stretch also collapses thin double-sided shells (sashes, crossbow limbs) to slivers: those faces
        # would sample one texel. Re-project them too (density below a quarter of the median).
        dens = []
        for f in bm.faces:
            p = [l[uvl].uv for l in f.loops]
            ua = abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2
            dens.append(ua / (f.calc_area() + 1e-12))
        med = float(np.median(dens))
        collapsed = 0
        for f, d in zip(bm.faces, dens):
            if d < 0.25 * med and not f.select:
                f.select = True
                collapsed += 1
        bmesh.update_edit_mesh(mesh.data)
        if overlapping or collapsed:
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin, area_weight=0.0,
                                     scale_to_bounds=False)
        bpy.ops.mesh.select_all(action="SELECT")
        seams["overlap_faces_fixed"] = overlapping
        seams["collapsed_faces_fixed"] = collapsed
        RESULT["uv_seams"] = seams
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    after = uv_area(mesh)
    n = int(RIG.get("transfer_size", 4096))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for dvc in prefs.devices:
            dvc.use = True
        scene.cycles.device = "GPU"
    except Exception:  # noqa: BLE001 — CPU bake is fine, just slower
        scene.cycles.device = "CPU"
    scene.cycles.samples = int(RIG.get("transfer_samples", 4))
    mat = me.materials[0]
    # High-poly copy for the normal bake: the original mesh with the OLD UVs and the provider's untouched material
    # (its tangent-space normal map only reads correctly through the UVs it was painted on).
    global HIGH_SRC
    HIGH_SRC = mesh.copy()
    HIGH_SRC.data = mesh.data.copy()
    HIGH_SRC.name = f"{ASSET}_HighBake"
    bpy.context.scene.collection.objects.link(HIGH_SRC)
    HIGH_SRC.data.materials.clear()
    HIGH_SRC.data.materials.append(mat.copy())
    HIGH_SRC.data.uv_layers.remove(HIGH_SRC.data.uv_layers["UVPacked"])
    HIGH_SRC.data.uv_layers.active = HIGH_SRC.data.uv_layers[old_name]
    HIGH_SRC.hide_render = True
    HIGH_SRC.select_set(False)
    activate(mesh)
    nt = mat.node_tree
    out = next(x for x in nt.nodes if x.type == "OUTPUT_MATERIAL")
    surface = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].is_linked else None
    uvnode = nt.nodes.new("ShaderNodeUVMap")
    uvnode.uv_map = old_name
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    target = nt.nodes.new("ShaderNodeTexImage")
    moved = []
    feeds_normal = {lk.from_node for x in nt.nodes if x.type == "NORMAL_MAP" for lk in x.inputs["Color"].links}
    for node in [x for x in nt.nodes if x.type == "TEX_IMAGE" and x is not target and x.image is not None
                 and x not in feeds_normal]:
        src = node.image
        data = src.colorspace_settings.name != "sRGB"
        img = bpy.data.images.new(src.name + "_packed", n, n, alpha=False, float_buffer=False)
        img.colorspace_settings.name = src.colorspace_settings.name
        # read the source through the old UVs, write the target through the new active UVs
        link = node.inputs["Vector"].links[0] if node.inputs["Vector"].is_linked else None
        nt.links.new(uvnode.outputs["UV"], node.inputs["Vector"])
        nt.links.new(node.outputs["Color"], emit.inputs["Color"])
        target.image = img
        nt.nodes.active = target
        bpy.ops.object.bake(type="EMIT", margin=int(RIG.get("transfer_margin", 16)), use_clear=True)
        if link is not None:
            nt.links.new(link.from_socket, node.inputs["Vector"])
        else:
            nt.links.remove(node.inputs["Vector"].links[0])
        name = src.name
        node.image = img
        # the old image stays alive only if the high-poly copy still uses it (it doesn't: that copy keeps the normal map)
        src.name = name + "_oldUV"
        img.name = name
        img.pack()
        moved.append({"image": name, "size": n, "data": data})
    nt.nodes.remove(target)
    nt.nodes.remove(emit)
    nt.nodes.remove(uvnode)
    if surface is not None:
        nt.links.new(surface, out.inputs["Surface"])
    me.uv_layers.remove(me.uv_layers[old_name])
    me.uv_layers.active = me.uv_layers["UVPacked"]
    RESULT["uv_repack"] = {"area_before": round(before, 3), "area_after": round(after, 3), "transferred": moved}
    step(f"UV 重排 {before:.0%} → {after:.0%}，{len(moved)} 张源贴图转移到 {n}²", t)



# ───────────────────────────── 2. Bones: keep / merge / add ─────────────────────────────

def build_custom_skeleton() -> None:
    """Skeleton from the rig JSON ("bones": name → head / tail in the scaled, grounded frame, metres; Blender axes:
    front = -Y, the creature's left = +X, up = +Z), weights by Blender's bone heat diffusion, then rigid overrides
    ("rigid": a sphere or box of vertices fully on one bone, for hard parts such as a weak-spot sac or a weapon),
    then each "limit" keeps a bone's weights inside a region (e.g. arm bones never reach the pincers)."""
    global arm
    t = time.time()
    data = bpy.data.armatures.new(f"{ASSET}_Rig")
    arm = bpy.data.objects.new(f"{ASSET}_Rig", data)
    bpy.context.scene.collection.objects.link(arm)
    activate(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = data.edit_bones
    for name, b in RIG["bones"].items():
        e = eb.new(name)
        e.head = Vector(b["head"])
        e.tail = Vector(b["tail"])
        e.roll = 0.0
    for name, b in RIG["bones"].items():
        if b.get("parent"):
            eb[name].parent = eb[b["parent"]]
            eb[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for name, b in RIG["bones"].items():
        data.bones[name].use_deform = b.get("deform", True)
    activate(mesh, [arm])
    bpy.context.view_layer.objects.active = arm
    mesh.select_set(True)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    names = list(RIG["bones"])
    col = {n: i for i, n in enumerate(names)}
    W = np.zeros((len(V), len(names)))
    gname = {g.index: g.name for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        for g in v.groups:
            n = gname[g.group]
            if n in col:
                W[v.index, col[n]] += g.weight
    heat_empty = int((W.sum(1) < 1e-6).sum())
    reg = {"heat_unweighted_verts": heat_empty}
    # Bone heat fails outright on meshes made of many loose shells (蜃楼蟾: 61 parts, bells / eaves / banners): then
    # weight by distance to each deform bone's segment instead, only among bones whose region limit allows the vertex,
    # blending the 3 nearest with a steep inverse-distance falloff.
    method = RIG.get("weights", "heat")
    if method == "segments" or heat_empty > 0.3 * len(V):
        deform = [n for n in names if RIG["bones"][n].get("deform", True)]
        allowed = np.ones((len(V), len(names)), bool)
        for lim in RIG.get("limits", []):
            bl, bh = np.array(lim["box"][0]), np.array(lim["box"][1])
            inside = ((V >= bl) & (V <= bh)).all(1)
            for n in lim["bones"]:
                allowed[:, col[n]] &= inside
        D = np.full((len(V), len(names)), np.inf)
        for n in deform:
            a, b = np.array(RIG["bones"][n]["head"]), np.array(RIG["bones"][n]["tail"])
            ab = b - a
            u = np.clip(((V - a) @ ab) / max(float(ab @ ab), 1e-9), 0, 1)
            D[:, col[n]] = np.linalg.norm(V - (a + u[:, None] * ab), axis=1)
        D[~allowed] = np.inf
        order = np.argsort(D, axis=1)[:, :3]
        W = np.zeros_like(W)
        rows = np.arange(len(V))[:, None]
        d = D[rows, order]
        w = np.where(np.isfinite(d), 1.0 / np.maximum(d, 1e-3) ** 4, 0.0)
        W[rows, order] = w
        # 1/d^4 runs into the hundreds of thousands: normalise each vertex now, or the soft parts of the rigid / ground
        # overrides below (sphere blend, fade_z) are drowned and only their w = 1 cores take effect
        W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
        reg["weights"] = "segments (heat failed)" if method != "segments" else "segments"
    for lim in RIG.get("limits", []):
        m = np.ones(len(V), bool)
        if "box" in lim:
            bl, bh = np.array(lim["box"][0]), np.array(lim["box"][1])
            m = ((V >= bl) & (V <= bh)).all(1)
        outside = ~m
        for n in lim["bones"]:
            W[outside, col[n]] = 0.0
    for r in RIG.get("ground", []):
        # ground contact: vertices below fade_z go to the NEAREST of the listed foot bones (by segment distance),
        # so no sole / pad vertex keeps thigh or shin weight and gets dragged into the floor when the leg bends
        z0, z1 = r["fade_z"]
        wz = np.clip((z1 - V[:, 2]) / max(z1 - z0, 1e-6), 0, 1)
        cand = np.full((len(V), len(r["bones"])), np.inf)
        for j, n in enumerate(r["bones"]):
            a, b = np.array(RIG["bones"][n]["head"]), np.array(RIG["bones"][n]["tail"])
            ab = b - a
            u = np.clip(((V - a) @ ab) / max(float(ab @ ab), 1e-9), 0, 1)
            cand[:, j] = np.linalg.norm(V - (a + u[:, None] * ab), axis=1)
        pick = np.argmin(cand, axis=1)
        for j, n in enumerate(r["bones"]):
            w = wz * (pick == j)
            m = w > 0
            W[m] *= (1 - w[m])[:, None]
            W[m, col[n]] += w[m]
        reg["ground_verts"] = int((wz > 0.5).sum())
    for r in RIG.get("rigid", []):
        if "sphere" in r:
            c, rad = np.array(r["sphere"][0]), r["sphere"][1]
            d = np.linalg.norm(V - c, axis=1)
            w = np.clip((rad - d) / (r.get("blend", 0.25) * rad), 0, 1)
        else:
            bl, bh = np.array(r["box"][0]), np.array(r["box"][1])
            inside = ((V >= bl) & (V <= bh)).all(1)
            w = inside.astype(float)
        if "fade_z" in r:
            # full weight below fade_z[0], blending out to zero at fade_z[1] (feet / pads with a soft ankle)
            z0, z1 = r["fade_z"]
            w = w * np.clip((z1 - V[:, 2]) / max(z1 - z0, 1e-6), 0, 1)
        if "clip" in r:
            # keep the rigid part inside a box (e.g. a sac sphere stops at the mouth line)
            cl, ch = np.array(r["clip"][0]), np.array(r["clip"][1])
            w = w * ((V >= cl) & (V <= ch)).all(1)
        m = w > 0
        W[m] *= (1 - w[m])[:, None]
        W[m, col[r["bone"]]] += w[m]
        reg[f"{r['bone']}_verts"] = int((w > 0.5).sum())
    # Vertices heat diffusion left empty (or emptied by a limit) take their nearest weighted neighbour's weights.
    empty = W.sum(1) < 1e-6
    if empty.any():
        from mathutils.kdtree import KDTree
        full = np.nonzero(~empty)[0]
        tree = KDTree(len(full))
        for k, vi in enumerate(full):
            tree.insert(V[vi], k)
        tree.balance()
        for vi in np.nonzero(empty)[0]:
            _, k, _ = tree.find(V[vi])
            W[vi] = W[full[k]]
    reg["fallback_verts"] = int(empty.sum())
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    for g in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(g)
    for n in names:
        if not RIG["bones"][n].get("deform", True):
            continue
        g = mesh.vertex_groups.new(name=n)
        c = W[:, col[n]]
        for vi in np.nonzero(c > 1e-4)[0]:
            g.add([int(vi)], float(c[vi]), "REPLACE")
        reg.setdefault("per_bone", {})[n] = int((c > 0.5).sum())
    mod = next((m for m in mesh.modifiers if m.type == "ARMATURE"), None) or mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    RESULT["regions"] = reg
    RESULT["bones"] = sorted(names)
    step(f"自定义骨架：{len(names)} 根骨骼（热扩散权重，{heat_empty} 个顶点未覆盖）", t)


if CUSTOM:
    build_custom_skeleton()
else:
    t = time.time()
    # Region seeds are written in source units (≈ 1 unit tall); convert to the scaled frame.
    U = s
    keep = RIG["keep"]                                  # tripo name → semantic name
    merge_to = {}                                       # tripo name → semantic target
    for target, spec in RIG["merge"].items():
        for src in (spec if isinstance(spec, list) else [f"bone_{i}" for i in ids(spec)]):
            merge_to[src] = target
    groups = {g.index: g.name for g in mesh.vertex_groups}
    nv = len(V)
    if RIG.get("forearm_twist"):
        # 2026-10-13 tried on all three heroes and measured with /hero-skin-audit.html: with Tripo's auto weights (hand
        # weight reaching mid-forearm) a roll bone did not reduce collapse, and narrowing the hand blend for it raised
        # wrist stretch (falcon 129 → 287 stretched edges). Kept as an option, off for the heroes.
        # Mixamo has no forearm roll bone: add one per arm (child of the forearm, from mid-forearm to the wrist) so a
        # wrist turn spreads along the forearm instead of wringing the skin at the wrist (see biped_fixes)
        for S_ in ("Left", "Right"):
            RIG["add"][f"{S_}ForeArmTwist"] = {"parent": f"{S_}ForeArm", "head": f"twist_head:{S_}", "tail": f"twist_tail:{S_}"}
    names = sorted(set(keep.values()) | set(merge_to.values()) | set(RIG["add"]))
    col = {n: i for i, n in enumerate(names)}
    W = np.zeros((nv, len(names)))
    unmapped = set()
    for v in mesh.data.vertices:
        for g in v.groups:
            src = groups[g.group]
            dst = keep.get(src) or merge_to.get(src)
            if dst is None:
                unmapped.add(src)
                continue
            W[v.index, col[dst]] += g.weight
    if unmapped:
        log(f"未映射的 Tripo 骨骼（权重丢弃后由邻近骨骼补齐）：{sorted(unmapped)}")


    def region_mask(cond: np.ndarray) -> np.ndarray:
        return cond & np.isfinite(V).all(1)


    def overlay(name: str, w: np.ndarray) -> None:
        """Blend a region weight on top: the region takes w, everything else keeps (1 - w) of what it had."""
        m = w > 0
        W[m] *= (1 - w[m])[:, None]
        W[m, col[name]] += w[m]


    offset_np = np.array(offset[:])


    def to_scaled(p) -> np.ndarray:
        """Source units (the Tripo FBX after applying its transforms) → the scaled, grounded, centred frame."""
        return (np.array(p, float) + offset_np) * s


    def regions_toad_sac() -> dict:
        global W
        # Sac: a sphere just behind the front-most point of the lower body, kept below the mouth line.
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        H = P["height"]
        zr = z / H                                          # 0..1 like the source units
        band = region_mask((zr > 0.12) & (zr < 0.45) & (np.abs(x) < 0.12 * U))
        tip = V[band][np.argmin(V[band][:, 1])]
        sac_r = RIG.get("sac_radius", 0.18) * H
        sac_c = np.array([0.0, tip[1] + sac_r * 0.9, tip[2]])
        dist = np.linalg.norm(V - sac_c, axis=1)
        mouth_z = sac_c[2] + 0.62 * sac_r                   # the mouth line sits a little above the sac centre
        below_mouth = np.clip((mouth_z - z) / (0.12 * sac_r), 0, 1)
        w_sac = np.clip((1.22 * sac_r - dist) / (0.3 * sac_r), 0, 1) * below_mouth * (y < sac_c[1] + 0.35 * sac_r)
        # Head: the whole face above the mouth line in front of the shoulders (lips, eyes, brow, warts), not the pagoda.
        pag = W[:, col["pagoda"]] > 0.5
        w_head = (np.clip((sac_c[1] + 0.6 * sac_r - y) / (0.25 * sac_r), 0, 1)
                  * np.clip((z - (mouth_z - 0.12 * sac_r)) / (0.12 * sac_r), 0, 1) * (~pag))
        w_head = np.maximum(w_head - w_sac, 0)
        # Feet: everything at ground level belongs to the foot / hand of its quadrant.
        foot_names = {(1, 1): "foot_L", (-1, 1): "foot_R", (1, -1): "hand_L", (-1, -1): "hand_R"}
        w_feet = np.clip((0.14 - zr) / 0.05, 0, 1)
        for vi in np.nonzero(w_feet > 0)[0]:
            side = 1 if x[vi] > 0 else -1
            end = 1 if y[vi] > 0.095 * U else -1             # hind feet sit behind the front toes (Tripo toe chains cross)
            W[vi] *= (1 - w_feet[vi])
            W[vi, col[foot_names[(side, end)]]] += w_feet[vi]
        for name, w in (("sac", w_sac), ("head", w_head)):
            overlay(name, w)
        head_seed = Vector((0, float(sac_c[1]) + 0.05 * U, float(sac_c[2]) + 0.16 * U))
        RESULT["regions"] = {"sac_centre": [round(float(c), 3) for c in sac_c], "sac_radius": round(sac_r, 3),
                             "sac_verts": int((w_sac > 0.5).sum()), "head_verts": int((w_head > 0.5).sum()),
                             "feet_verts": int((w_feet > 0.5).sum())}
        return {"auto:head": head_seed, "auto:sac": Vector(sac_c.tolist())}


    def mesh_islands() -> np.ndarray:
        """Connected-component id per vertex (union-find over edges)."""
        ev = np.array([e.vertices[:] for e in mesh.data.edges])
        parent = np.arange(len(V))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for a, b in ev:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
        return np.array([find(i) for i in range(len(V))])


    def bone_pt(name: str, end: str = "head") -> np.ndarray:
        # bones are still the Tripo names here (renamed after the regions): accept either spelling
        b = arm.data.bones.get(name) or arm.data.bones["mixamorig:" + name]
        return np.array(arm.matrix_world @ (b.head_local if end == "head" else b.tail_local))


    def seg_dist(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        ab = b - a
        t = np.clip(((p - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
        return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


    def biped_fixes(reg: dict) -> None:
        """Weight repairs for Tripo's Mixamo auto-weights (applied after ears / tail; all optional, see the rig JSON):
        "rigid_islands": mesh islands whose bounding box lies inside a source-unit box go fully onto one bone
                         (a backpack auto-weighted to one arm deformed with every arm swing);
        "arm_clamp":     upper-arm / forearm weight on vertices inside the shoulder line moves to the chest bone
                         (Tripo let the arm own half the chest, so raising an arm tore the torso);
        "membrane":      a gliding membrane island between wrist and ankle gets a smooth gradient — forearm at the
                         wrist end, shin at the ankle end, the original weights near the flank — instead of Tripo's
                         hard split."""
        islands = None
        for r in RIG.get("rigid_islands", []):
            islands = mesh_islands() if islands is None else islands
            lo_b, hi_b = to_scaled(r["box"][0]), to_scaled(r["box"][1])
            n = 0
            for iid in np.unique(islands):
                m = islands == iid
                P_ = V[m]
                if (P_.min(0) >= lo_b).all() and (P_.max(0) <= hi_b).all():
                    W[m] = 0
                    W[m, col[r["bone"]]] = 1
                    n += int(m.sum())
            reg[f"rigid_{r['bone']}_verts"] = n
        ac = RIG.get("arm_clamp")
        if ac:
            chest = col[ac.get("to", "Spine2")]
            moved = 0
            for side in ("Left", "Right"):
                x_sh = abs(bone_pt(f"{side}Arm")[0])
                fade = np.clip((ac.get("inner_frac", 0.85) * x_sh - np.abs(V[:, 0])) / (ac.get("blend", 0.04) * U), 0, 1)
                fade *= (np.sign(V[:, 0]) == (1 if side == "Left" else -1))
                for b in (f"{side}Arm", f"{side}ForeArm"):
                    take = W[:, col[b]] * fade
                    W[:, col[b]] -= take
                    W[:, chest] += take
                    moved += int((take > 0.25).sum())
            reg["arm_clamp_verts"] = moved
        if RIG.get("island_majority"):
            # A small mesh island (lamp, pouch, buckle) that Tripo weighted almost entirely to one bone, with a few
            # vertices on an arm / hand on the other side of the body: those few get the majority's weights, else
            # they are dragged off with the arm (燎's hip lamp had 4 of 183 vertices on the left thumb).
            islands = mesh_islands() if islands is None else islands
            is_arm = np.array([any(k in n for k in ("Arm", "Hand", "Shoulder")) for n in names])
            dom = W.argmax(1)
            fixed = 0
            for iid in np.unique(islands):
                idx = np.nonzero(islands == iid)[0]
                if len(idx) > 400:
                    continue
                counts = np.bincount(dom[idx], minlength=len(names))
                major = int(counts.argmax())
                if counts[major] < 0.9 * len(idx):
                    continue
                # small props are rigid objects: if any vertex leans on an arm while the island doesn't (or vice
                # versa), the whole island takes the majority's averaged weights
                touches = (W[idx][:, is_arm].sum(1) > 0.05) if not is_arm[major] else (W[idx][:, ~is_arm].sum(1) > 0.05)
                if touches.any():
                    avg = W[idx[dom[idx] == major]].mean(0)
                    if not is_arm[major]:
                        avg[is_arm] = 0
                    W[idx] = avg / max(avg.sum(), 1e-6)
                    fixed += int(touches.sum())
            reg["island_majority_verts"] = fixed
        ft = RIG.get("forearm_twist")
        if ft:
            # Forearm skin: hand weight only right at the wrist (it used to reach mid-forearm, so every wrist bend dragged
            # the forearm), the rest ramps linearly from the forearm bone (elbow) to the twist bone (wrist). Upper-arm
            # weight and fingers are left alone.
            hb = ft.get("hand_blend") if isinstance(ft, dict) else None
            moved = 0
            for S_ in ("Left", "Right"):
                el, wr = bone_pt(f"{S_}ForeArm"), bone_pt(f"{S_}Hand")
                cF, cH, cT = col[f"{S_}ForeArm"], col[f"{S_}Hand"], col[f"{S_}ForeArmTwist"]
                ax = wr - el
                L_ = float(np.linalg.norm(ax))
                t = ((V - el) @ ax) / (L_ * L_)
                radial = np.linalg.norm((V - el) - np.outer(t, ax), axis=1)
                # only the sleeve / glove around the forearm (a gliding membrane or a big pauldron hanging off the
                # forearm would swing wide if it rolled with the wrist)
                rmax = (ft.get("max_radius", 0.5) if isinstance(ft, dict) else 0.5) * L_
                m = (W[:, cF] + W[:, cH] > 1e-4) & (t > -0.05) & (t < 1.0) & (radial < rmax)
                tt = np.clip(t[m], 0, 1)
                idx = np.nonzero(m)[0]
                if hb is None:
                    # keep Tripo's hand weights (narrowing them stretches the wrist when it bends); split only the
                    # forearm share into forearm → twist
                    f_ = W[idx, cF]
                    W[idx, cT] = f_ * tt
                    W[idx, cF] = f_ * (1 - tt)
                else:
                    fh = W[idx, cF] + W[idx, cH]
                    x = np.clip((tt - (1 - hb)) / hb, 0, 1)
                    hand = fh * x * x * (3 - 2 * x)
                    rest_ = fh - hand
                    W[idx, cH] = hand
                    W[idx, cT] = rest_ * tt
                    W[idx, cF] = rest_ * (1 - tt)
                moved += len(idx)
            reg["forearm_twist_verts"] = moved
        lb = RIG.get("limb_blend")
        if lb:   # tried 2026-10-12 on 燎: narrower elbow / wrist blends made the measured collapse worse; kept off
            # Tripo blends the elbow over half a segment (upper-arm weight 0.3 a quarter way down the forearm) and lets
            # the hand reach mid-forearm: bent past ~90° that wide zone averages two far-apart transforms and the
            # forearm collapses ("the arm disappears"). Re-split the arm-chain share of each arm vertex by its
            # position u along shoulder(0)–elbow(1)–wrist(2) with narrow smoothstep blends at the elbow and wrist.
            moved = 0
            for S_ in ("Left", "Right"):
                sh, el, wr = bone_pt(f"{S_}Arm"), bone_pt(f"{S_}ForeArm"), bone_pt(f"{S_}Hand")
                cA, cF, cH = col[f"{S_}Arm"], col[f"{S_}ForeArm"], col[f"{S_}Hand"]
                chain = W[:, cA] + W[:, cF] + W[:, cH]
                fingers = [col[n] for n in col if n.startswith(f"{S_}Hand") and n != f"{S_}Hand"]
                m = (chain > 0.5) & (W[:, fingers].sum(1) < 0.05) if fingers else chain > 0.5
                P_ = V[m]
                def para(a, b):
                    ab = b - a
                    t = np.clip(((P_ - a) @ ab) / (ab @ ab), 0, 1)
                    return t, np.linalg.norm(P_ - (a + t[:, None] * ab), axis=1)
                t1, d1 = para(sh, el)
                t2, d2 = para(el, wr)
                u = np.where(d1 < d2, t1, 1 + t2)
                def ss(x):
                    x = np.clip(x, 0, 1)
                    return x * x * (3 - 2 * x)
                we, ww = lb.get("elbow") or 0.12, lb.get("wrist", 0.1)
                to_fore = ss((u - (1 - we)) / (2 * we))
                to_hand = ss((u - (2 - ww)) / ww)            # the hand blend sits just above the wrist joint
                ids = np.nonzero(m)[0]
                if lb.get("elbow") is None:
                    # keep Tripo's upper-arm share; only re-split forearm vs hand (the hand reaching mid-forearm is what
                    # wrings the forearm flat when the wrist turns)
                    fh = W[ids, cF] + W[ids, cH]
                    W[ids, cF] = fh * (1 - to_hand)
                    W[ids, cH] = fh * to_hand
                else:
                    share = chain[m]
                    W[ids, cA] = share * (1 - to_fore)
                    W[ids, cF] = share * to_fore * (1 - to_hand)
                    W[ids, cH] = share * to_fore * to_hand
                moved += int(m.sum())
            reg["limb_blend_verts"] = moved
        mb = RIG.get("membrane")
        if mb:
            islands = mesh_islands() if islands is None else islands
            for side, sx in (("L", 1), ("R", -1)):
                S = "Left" if side == "L" else "Right"
                near = to_scaled([sx * mb["near"][0], *mb["near"][1:]])
                iid = islands[int(np.argmin(np.linalg.norm(V - near, axis=1)))]
                m = (islands == iid) & (np.sign(V[:, 0]) == sx)
                # the provider may fuse the glove into the membrane island: hand / finger vertices keep their weights
                hand_cols = [col[n] for n in col if n.startswith(f"{S}Hand")]
                m &= W[:, hand_cols].sum(1) < 0.2
                P_ = V[m]
                wrist, ankle = bone_pt(f"{S}Hand"), bone_pt(f"{S}Foot")
                # t: 0 at the ankle end, 1 at the wrist end (along the wrist–ankle line); lat: 0 at the flank, 1 at the edge
                ax = wrist - ankle
                t = np.clip(((P_ - ankle) @ ax) / (ax @ ax), 0, 1)
                x_body = to_scaled([mb["body_x"], 0, 0])[0]
                lat = np.clip((np.abs(P_[:, 0]) - x_body) / (np.abs(wrist[0]) - x_body + 1e-9), 0, 1) ** 0.7
                Wm = np.zeros((len(P_), W.shape[1]))
                arm_share, leg_share = lat * t, lat * (1 - t)
                d_up = seg_dist(P_, bone_pt(f"{S}Arm"), bone_pt(f"{S}ForeArm"))
                d_fo = seg_dist(P_, bone_pt(f"{S}ForeArm"), wrist)
                k_fo = d_up / (d_up + d_fo + 1e-9)
                Wm[:, col[f"{S}ForeArm"]] = arm_share * k_fo
                Wm[:, col[f"{S}Arm"]] = arm_share * (1 - k_fo)
                d_th = seg_dist(P_, bone_pt(f"{S}UpLeg"), bone_pt(f"{S}Leg"))
                d_sh = seg_dist(P_, bone_pt(f"{S}Leg"), ankle)
                k_sh = d_th / (d_th + d_sh + 1e-9)
                Wm[:, col[f"{S}Leg"]] = leg_share * k_sh
                Wm[:, col[f"{S}UpLeg"]] = leg_share * (1 - k_sh)
                # near the flank the membrane blends back into the original weights (coat / harness parts that share
                # the membrane's mesh island keep following the body)
                Wm += (1 - lat)[:, None] * W[m]
                W[m] = Wm
                reg[f"membrane_{side}_verts"] = int(m.sum())


    def regions_biped_tail() -> dict:
        """Mixamo has no ears, tail or weak-spot part: add them from points written in source units (≈ 1 unit tall)."""
        cfg = RIG["regions"]
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        reg = {}
        # Rigid weak-spot part (the bell): a sphere, fully on its own bone so the glow shell is exactly that part.
        if "part" in cfg:
            c = to_scaled(cfg["part"]["centre"])
            r = cfg["part"]["radius"] * U
            d = np.linalg.norm(V - c, axis=1)
            w = np.clip((1.15 * r - d) / (0.3 * r), 0, 1)
            overlay(cfg["part"]["bone"], w)
            reg[cfg["part"]["bone"] + "_verts"] = int((w > 0.5).sum())
        # Ears: vertices past the ear base along base→tip, on the ear's side and outside the skull's mid strip.
        for side, sx in (("L", 1), ("R", -1)) if "ears" in cfg else ():
            e = cfg["ears"]
            base = to_scaled([sx * e["base"][0], *e["base"][1:]])
            tip = to_scaled([sx * e["tip"][0], *e["tip"][1:]])
            axis = (tip - base) / np.linalg.norm(tip - base)
            t = (V - base) @ axis
            w = (np.clip(t / (e["blend"] * U), 0, 1)
                 * np.clip((sx * x - e["min_x"] * U) / (e["x_blend"] * U), 0, 1)
                 * (z > base[2] - e["below"] * U))
            overlay(f"ear_{side}", w)
            reg[f"ear_{side}_verts"] = int((w > 0.5).sum())
        # Tail: a polyline of joints; vertices near it share its bones with hat weights, faded in behind the hips.
        tc = cfg["tail"]
        J = np.array([to_scaled(p) for p in tc["joints"]])
        nb = len(J) - 1
        best_d = np.full(len(V), np.inf)
        best_s = np.zeros(len(V))
        for i in range(nb):
            a, b = J[i], J[i + 1]
            ab = b - a
            tt = np.clip(((V - a) @ ab) / (ab @ ab), 0, 1)
            d = np.linalg.norm(V - (a + tt[:, None] * ab), axis=1)
            better = d < best_d
            best_d[better], best_s[better] = d[better], i + tt[better]
        y0 = to_scaled([0, tc["start_y"], 0])[1]
        if tc.get("island"):
            # The tail is its own mesh island (Tripo smart mesh often models it separately): take the whole island
            # that holds the vertex nearest the tail tip, fully on the tail chain — no guessing a radius.
            ev = np.array([e.vertices[:] for e in mesh.data.edges])
            parent = np.arange(len(V))

            def find(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]
                    i = parent[i]
                return i
            for a, b in ev:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[ra] = rb
            roots = np.array([find(i) for i in range(len(V))])
            tip_v = int(np.argmin(np.linalg.norm(V - J[-1], axis=1)))
            w_tail = (roots == roots[tip_v]).astype(float)
            reg["tail_island_verts"] = int(w_tail.sum())
        else:
            w_tail = (((best_d < tc["radius"] * U) & (np.abs(x) < tc["radius"] * U)).astype(float)
                      * np.clip((y - y0) / (tc["blend_y"] * U), 0, 1))
            if "max_z" in tc:                               # keep backpacks / back plates above the tail out of it
                w_tail *= np.clip((to_scaled([0, 0, tc["max_z"]])[2] - z) / (0.03 * U), 0, 1)
        m = w_tail > 0
        W[m] *= (1 - w_tail[m])[:, None]
        for i in range(nb):
            hat = np.clip(1 - np.abs(best_s[m] - (i + 0.5)), 0, 1)
            if i == 0:
                hat = np.where(best_s[m] < 0.5, 1.0, hat)
            if i == nb - 1:
                hat = np.where(best_s[m] > nb - 0.5, 1.0, hat)
            W[m, col[f"tail_{i + 1}"]] += w_tail[m] * hat
        reg["tail_verts"] = int((w_tail > 0.5).sum())
        biped_fixes(reg)
        RESULT["regions"] = reg
        seeds = {f"tail:{i}": Vector(J[i].tolist()) for i in range(len(J))}
        for side, sx in (("L", 1), ("R", -1)) if "ears" in cfg else ():
            seeds[f"ear_base:{side}"] = Vector(to_scaled([sx * cfg["ears"]["base"][0], *cfg["ears"]["base"][1:]]).tolist())
            seeds[f"ear_tip:{side}"] = Vector(to_scaled([sx * cfg["ears"]["tip"][0], *cfg["ears"]["tip"][1:]]).tolist())
        if "part" in cfg:
            seeds["part"] = Vector(to_scaled(cfg["part"]["centre"]).tolist())
        if RIG.get("forearm_twist"):
            for S_ in ("Left", "Right"):
                el, wr = bone_pt(f"{S_}ForeArm"), bone_pt(f"{S_}Hand")
                seeds[f"twist_head:{S_}"] = Vector(((el + wr) / 2).tolist())
                seeds[f"twist_tail:{S_}"] = Vector(wr.tolist())
        seeds["origin"] = Vector((0, 0, 0))
        return seeds


    PROFILE = RIG.get("profile", "toad_sac")
    seeds = {"toad_sac": regions_toad_sac, "biped_tail": regions_biped_tail}[PROFILE]()
    # Vertices Tripo left unweighted (spire tips, bell clappers…) copy the weights of their nearest weighted vertex.
    empty = W.sum(1) < 1e-6
    if empty.any():
        from mathutils.kdtree import KDTree
        tree = KDTree(int((~empty).sum()))
        full = np.nonzero(~empty)[0]
        for k, vi in enumerate(full):
            tree.insert(V[vi], k)
        tree.balance()
        for vi in np.nonzero(empty)[0]:
            _, k, _ = tree.find(V[vi])
            W[vi] = W[full[k]]
    RESULT["regions"]["fallback_verts"] = int(empty.sum())

    # Skeleton edit: rename kept bones, add new ones, re-parent, delete the rest.
    activate(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in list(eb):
        if b.name in keep:
            b.name = keep[b.name]
    for name, spec in RIG["add"].items():
        nb = eb.new(name)
        nb.head = seeds[spec["head"]]
        nb.tail = seeds[spec["tail"]] if "tail" in spec else nb.head + Vector(spec["tail_offset"]) * U
        nb.use_connect = False
    for name, spec in RIG["add"].items():
        eb[name].parent = eb[spec["parent"]] if spec.get("parent") else None
    for child, parent in RIG.get("parent_fix", {}).items():
        eb[child].use_connect = False
        eb[child].parent = eb[parent]
    keep_names = set(keep.values()) | set(RIG["add"])
    for b in list(eb):
        if b.name not in keep_names:
            for c in b.children:
                anc = b.parent
                while anc is not None and anc.name not in keep_names:
                    anc = anc.parent
                c.use_connect = False
                c.parent = anc
            eb.remove(b)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Replace vertex groups with the semantic weights.
    for g in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(g)
    vg = {n: mesh.vertex_groups.new(name=n) for n in names if n in keep_names}
    for n, g in vg.items():
        c = W[:, col[n]]
        for vi in np.nonzero(c > 1e-4)[0]:
            g.add([int(vi)], float(c[vi]), "REPLACE")
    mod = next((m for m in mesh.modifiers if m.type == "ARMATURE"), None) or mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mesh.parent = arm
    RESULT["bones"] = sorted(b.name for b in arm.data.bones)
    step(f"骨架重整：{len(arm.data.bones)} 根语义骨骼", t)

HIGH_SRC = None
if RIG.get("repack_uv"):
    repack_uv_and_transfer()

# ───────────────────────────── 3. Textures: BC + ORM ─────────────────────────────
t = time.time()
mat = mesh.data.materials[0]
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
src_img = bsdf.inputs["Base Color"].links[0].from_node.image
size = int(P["texture"])
# The provider's full material (base colour + its normal map) stays on a copy for the high-poly side of the normal bake.
high_mat = mat.copy() if RIG.get("bake_normal") else None


def provider_map(key: str):
    """Provider texture by suffix (Tripo names them <model>_roughness / _metallic / _normal)."""
    return next((im for im in bpy.data.images if im.name.lower().rsplit(".", 1)[0].endswith(key)), None)


def gray(img, n: int) -> np.ndarray:
    c = img.copy()
    c.scale(n, n)
    a = np.array(c.pixels[:]).reshape(n, n, 4)[..., 0]
    bpy.data.images.remove(c)
    return a
bc = src_img.copy()
bc.scale(size, size)
bc.name = f"T_{SHORT}_BC"
bc.filepath_raw = ""
mat.name = f"M_{SHORT}"
for n in list(nt.nodes):
    if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
        nt.nodes.remove(n)
uv = mesh.data.uv_layers.active.name
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bc
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = P.get("roughness", 0.8)
# AO bake onto a temporary image (other objects none: the creature alone)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for dvc in prefs.devices:
        dvc.use = True
    scene.cycles.device = "GPU"
except Exception:  # noqa: BLE001 — CPU bake is fine, just slower
    scene.cycles.device = "CPU"
scene.cycles.samples = 64
ao_img = bpy.data.images.new("ao_tmp", size, size, alpha=False)
ao_node = nt.nodes.new("ShaderNodeTexImage")
ao_node.image = ao_img
nt.nodes.active = ao_node
activate(mesh)
mesh.modifiers["Armature"].show_render = False
bpy.ops.object.bake(type="AO", margin=16)
mesh.modifiers["Armature"].show_render = True
ao = np.array(ao_img.pixels[:]).reshape(size, size, 4)[..., 0]
def _box(a: np.ndarray, r: int) -> np.ndarray:
    for ax in (0, 1):
        a = np.swapaxes(a, 0, ax)
        pad = np.pad(a, ((r + 1, r),) + ((0, 0),) * (a.ndim - 1), mode="edge")
        c = np.cumsum(pad, 0)
        a = np.swapaxes((c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1), 0, ax)
    return a


def _blur(a: np.ndarray, r: int) -> np.ndarray:
    for _ in range(3):
        a = _box(a, r)
    return a


def _masked_blur(img: np.ndarray, w: np.ndarray, r: int) -> np.ndarray:
    return _blur(img * w[..., None], r) / np.maximum(_blur(w, r)[..., None], 1e-4)


def _raster_faces(faces, size: int) -> np.ndarray:
    """UV-space coverage of the given polygons (bottom-up rows, like Image.pixels)."""
    mask = np.zeros((size, size), bool)
    uvl = mesh.data.uv_layers.active.data
    for p in faces:
        uv = [(uvl[li].uv[0] * size, uvl[li].uv[1] * size) for li in p.loop_indices]
        for k in range(1, len(uv) - 1):
            a, b, c = uv[0], uv[k], uv[k + 1]
            x0, x1 = max(0, int(min(a[0], b[0], c[0]))), min(size - 1, int(max(a[0], b[0], c[0])) + 1)
            y0, y1 = max(0, int(min(a[1], b[1], c[1]))), min(size - 1, int(max(a[1], b[1], c[1])) + 1)
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if x1 < x0 or y1 < y0 or abs(d) < 1e-9:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
            l1 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / d
            l2 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / d
            inside = (l1 >= -.02) & (l2 >= -.02) & (1 - l1 - l2 >= -.02)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


cleanups = []
for fix in RIG.get("texture_cleanup", []):
    zmin = to_scaled([0, 0, fix["min_z"]])[2]
    face_dir = Vector(fix.get("facing", (0, 1, 0)))
    faces = [p for p in mesh.data.polygons
             if (V[list(p.vertices)].mean(0)[2] > zmin and abs(V[list(p.vertices)].mean(0)[0]) > fix["min_abs_x"] * s
                 and p.normal.dot(face_dir) > fix.get("min_dot", 0.15))]
    region = _raster_faces(faces, size)
    pxc = np.array(bc.pixels[:]).reshape(size, size, 4)
    rgb = pxc[..., :3]
    region &= rgb.max(-1) > 0.03          # never the empty UV gutter between islands
    r = max(2, round(fix.get("radius", 24) * size / 2048))
    w = region.astype(np.float32)
    ref1 = _masked_blur(rgb, w, r)
    bad = region & (np.linalg.norm(rgb - ref1, axis=-1) > fix.get("threshold", 0.06))
    bad = (_blur(bad.astype(np.float32), max(1, r // 8)) > 0.05) & region
    ref2 = _masked_blur(rgb, (region & ~bad).astype(np.float32), r)
    k = (_blur(bad.astype(np.float32), 1) * region)[..., None]
    pxc[..., :3] = rgb * (1 - k) + ref2 * k
    bc.pixels.foreach_set(pxc.astype(np.float32).ravel())
    cleanups.append({"name": fix.get("name", ""), "faces": len(faces), "texels": int(region.sum()), "replaced": int(bad.sum())})
if cleanups:
    RESULT["texture_cleanup"] = cleanups
    log(f"贴图修补：{cleanups}")

paint = RIG.get("paint_shading")
if paint:
    # 缝隙 AO：只看很短距离的遮蔽（甲片缝、皮带下沿、毛簇间、指缝），世界里没有 World 时新建一个来设距离
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake_world")
    scene.world.light_settings.distance = float(paint.get("cavity_distance", 0.018)) * P["height"]
    cav_img = bpy.data.images.new("cavity_tmp", size, size, alpha=False)
    ao_node.image = cav_img
    nt.nodes.active = ao_node
    mesh.modifiers["Armature"].show_render = False
    bpy.ops.object.bake(type="AO", margin=16)
    mesh.modifiers["Armature"].show_render = True
    cavity = np.array(cav_img.pixels[:]).reshape(size, size, 4)[..., 0]
    bpy.data.images.remove(cav_img)
    px = np.array(bc.pixels[:]).reshape(size, size, 4)
    rgb = px[..., :3].copy()
    shade = (1 - paint.get("cavity", 0.55) * (1 - cavity) ** 0.8) * (1 - paint.get("ao", 0.3) * (1 - ao))
    rgb *= shade[..., None]
    # 轻微提对比与饱和（去光后的底色偏灰白）
    lum = (rgb * np.array([0.299, 0.587, 0.114])).sum(-1, keepdims=True)
    rgb = lum + (rgb - lum) * paint.get("saturation", 1.12)
    rgb = 0.5 + (rgb - 0.5) * paint.get("contrast", 1.08)
    # 保持平均亮度不变：明暗只用来塑造体积，不让整体变暗
    lum0 = float((px[..., :3] * np.array([0.299, 0.587, 0.114])).sum(-1).mean())
    lum1 = float((rgb * np.array([0.299, 0.587, 0.114])).sum(-1).mean())
    if paint.get("keep_brightness", True) and lum1 > 1e-4 and lum0 > lum1:
        # 补回损失的平均亮度，但只提暗部和中间调：亮区（发光喉囊、高光）系数趋近 1，不会被推爆成一片白
        lum = (rgb * np.array([0.299, 0.587, 0.114])).sum(-1, keepdims=True)
        room = np.clip(1 - lum, 0, 1)
        need = lum0 - lum1
        gain = need / max(1e-4, float((lum * room).mean()))
        rgb *= 1 + gain * room
    px[..., :3] = np.clip(rgb, 0, 1)
    bc.pixels.foreach_set(px.astype(np.float32).ravel())
    RESULT["paint_shading"] = {"cavity_mean": round(float(cavity.mean()), 3), "shade_mean": round(float(shade.mean()), 3)}
orm = np.ones((size, size, 4), np.float32)
orm[..., 0] = ao
orm[..., 1] = P.get("roughness", 0.8)
orm[..., 2] = 0.0
pbr_used = []
if RIG.get("provider_pbr"):
    r_img, m_img = provider_map("roughness"), provider_map("metallic")
    if r_img is not None:
        # 风格化角色：粗糙度不低于 0.3（毛发不该像塑料一样反光）
        orm[..., 1] = np.clip(gray(r_img, size), 0.3, 1.0)
        pbr_used.append("roughness")
    if m_img is not None:
        orm[..., 2] = np.clip(gray(m_img, size), 0.0, 1.0)
        pbr_used.append("metallic")
orm_img = bpy.data.images.new(f"T_{SHORT}_ORM", size, size, alpha=False)
orm_img.colorspace_settings.name = "Non-Color"
orm_img.pixels.foreach_set(orm.ravel())
orm_img.pack()
bc.pack()
nt.nodes.remove(ao_node)
bpy.data.images.remove(ao_img)
orm_node = nt.nodes.new("ShaderNodeTexImage")
orm_node.image = orm_img
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(orm_node.outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
# glTF occlusion: the exporter reads a "glTF Material Output" group with an Occlusion socket.
grp = bpy.data.node_groups.get("glTF Material Output") or bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
if "Occlusion" not in [s.name for s in grp.interface.items_tree]:
    grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
gnode = nt.nodes.new("ShaderNodeGroup")
gnode.node_tree = grp
nt.links.new(sep.outputs["Red"], gnode.inputs["Occlusion"])
RESULT["textures"] = {"size": size, "ao_mean": round(float(ao.mean()), 3), "provider_pbr": pbr_used,
                      "roughness_mean": round(float(orm[..., 1].mean()), 3), "metal_frac": round(float((orm[..., 2] > 0.5).mean()), 3)}
step("贴图（BC + AO/ORM）", t)

# ───────────────────────────── 4. LODs + skin limits ─────────────────────────────
t = time.time()
high = None
if high_mat is not None and globals().get("HIGH_SRC") is not None:
    # UV 重展过：用保留旧 UV 和原始材质（含供应方法线贴图）的副本做高模
    high = HIGH_SRC
    high.hide_render = False
    if "Armature" not in high.modifiers:
        high.modifiers.new("Armature", "ARMATURE")
elif high_mat is not None:
    # 全分辨率网格留一份做法线烘焙的高模（不导出）
    activate(mesh)
    bpy.ops.object.duplicate()
    high = bpy.context.object
    high.name = f"{ASSET}_HighBake"
    high.data.materials.clear()
    high.data.materials.append(high_mat)
mesh.name = f"{ASSET}_LOD0"
lods = [mesh]
for i in range(1, len(P["lod_tris"])):
    activate(mesh)
    bpy.ops.object.duplicate()
    d = bpy.context.object
    d.name = f"{ASSET}_LOD{i}"
    lods.append(d)


def tris(o) -> int:
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


for i, o in enumerate(lods):
    activate(o)
    have = tris(o)
    want = P["lod_tris"][i]
    if have > want:
        dec = o.modifiers.new("decimate", "DECIMATE")
        dec.ratio = want / have * 0.985
        dec.use_collapse_triangulate = True
        bpy.ops.object.modifier_move_to_index(modifier=dec.name, index=0)
        bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    o["lod_distance"] = P["lod_distance"][i]
per_lod, lod_metrics = {}, []
for o in lods:
    infl = [sum(1 for g in v.groups if g.weight > 1e-4) for v in o.data.vertices]
    per_lod[o.name] = {"max_influences": max(infl), "unweighted_verts": sum(1 for n in infl if n == 0)}
    uvs = np.array([d.uv[:] for d in o.data.uv_layers.active.data])
    lod_metrics.append({"name": o.name, "tris": tris(o), "uv_min": uvs.min(0).tolist(), "uv_max": uvs.max(0).tolist()})
RESULT["skin"] = {"per_lod": per_lod}
RESULT["lods"] = lod_metrics
step("LOD 与蒙皮上限 " + " / ".join(str(m["tris"]) for m in lod_metrics), t)

# ───────────────────────────── 4a. Normal map (high → LOD0) ─────────────────────────────
if high is not None:
    t = time.time()
    n_img = bpy.data.images.new(f"T_{SHORT}_N", size, size, alpha=False)
    n_img.colorspace_settings.name = "Non-Color"
    n_node = nt.nodes.new("ShaderNodeTexImage")
    n_node.image = n_img
    nt.nodes.active = n_node
    for o in (high, lods[0]):
        o.modifiers["Armature"].show_render = False
    activate(lods[0], [high])
    H_m = P["height"]
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=16, use_selected_to_active=True,
                        cage_extrusion=0.012 * H_m, max_ray_distance=0.04 * H_m)
    for o in (high, lods[0]):
        o.modifiers["Armature"].show_render = True
    n_img.pack()
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.uv_map = lods[0].data.uv_layers.active.name
    nt.links.new(n_node.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    npx = np.array(n_img.pixels[:]).reshape(size, size, 4)
    RESULT["normal_map"] = {"size": size, "flatness": round(float(np.abs(npx[..., :2] - 0.5).mean()), 4)}
    bpy.data.objects.remove(high, do_unlink=True)
    step("法线贴图（高模 → LOD0）", t)

# ───────────────────────────── 4b. Glow shell ─────────────────────────────
# The weak-spot glow is a thin additive shell over the art's own sac (faces whose sac weight ≥ 0.5, pushed out 1 cm),
# skinned to the same bones: it inflates with the sac and keeps the painted pattern; the runtime drives its opacity.
t = time.time()
shell = None
if RIG.get("glow_shell"):
    gname = RIG["glow_shell"]
    activate(lods[0])
    bpy.ops.object.duplicate()
    shell = bpy.context.object
    shell.name = f"{ASSET}_GlowShell"
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    deform = bm.verts.layers.deform.active
    gi = shell.vertex_groups[gname].index
    w = {v.index: v[deform].get(gi, 0.0) for v in bm.verts}
    drop = [f for f in bm.faces if min(w[v.index] for v in f.verts) < 0.5]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    for v in bm.verts:
        v.co += v.normal * 0.012
    bm.to_mesh(shell.data)
    bm.free()
    glow_mat = bpy.data.materials.new(f"M_{SHORT}_Glow")
    glow_mat.use_nodes = True
    gb = next(n for n in glow_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    gt = glow_mat.node_tree.nodes.new("ShaderNodeTexImage")
    gt.image = bc
    glow_mat.node_tree.links.new(gt.outputs["Color"], gb.inputs["Emission Color"])
    gb.inputs["Emission Strength"].default_value = 1.0
    shell.data.materials.clear()
    shell.data.materials.append(glow_mat)
    if "lod_distance" in shell:
        del shell["lod_distance"]
    RESULT["glow_shell"] = {"group": gname, "tris": tris(shell)}
    step(f"发光壳 {tris(shell)} 面", t)

# ───────────────────────────── 5. Export ─────────────────────────────
t = time.time()
arm.name = f"{ASSET}_Rig"
for o in bpy.data.objects:
    o.select_set(o in lods or o is arm or o is shell)
bpy.context.view_layer.objects.active = arm
bpy.ops.wm.save_as_mainfile(filepath=P["out_blend"])
bpy.ops.export_scene.gltf(
    filepath=P["out_glb"], export_format="GLB", use_selection=True, export_extras=True,
    export_skins=True, export_animations=False, export_morph=False, export_yup=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_image_format="WEBP", export_image_quality=int(RIG.get("webp_quality", 88)), export_apply=False)
RESULT["glb_kb"] = round(Path(P["out_glb"]).stat().st_size / 1024)
step(f"导出 {RESULT['glb_kb']} KB", t)
finish(P, RESULT)
