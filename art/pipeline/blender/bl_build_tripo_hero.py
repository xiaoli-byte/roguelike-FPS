"""Tripo hero build (headless Blender): rigged Tripo P2.0 hero -> runtime skeletal GLB.

The shared build stage (bl_build.py) bakes a Hunyuan high-poly onto a new low-poly and
skins it to the game's 13-joint parts rig. Tripo heroes are different: the mesh is already
game-resolution, quad-dominant and skinned by Tripo to a 65-bone Mixamo skeleton, but it has
no UVs and no texture (the textured Studio export was never downloadable). This script keeps
Tripo's mesh, skeleton and skin weights exactly and adds everything a runtime asset needs:

 1. Units / pivot: uniform scale to the hero's design height, feet on z=0, facing -Y (glTF +Z).
 2. Triangulate, Smart-UV unwrap and pack one 0..1 atlas.
 3. Base colour by orthographic camera projection of the approved front T-pose reference
    (the same image Tripo generated the geometry from). Texel weight = depth-buffer visibility
    x facing ratio x reference foreground. Surfaces the front camera cannot see (back, tail
    undersides, occluded wing parts) receive a harmonic fill diffused over the mesh from
    confidently visible vertices, so the back of a body continues its front colour blocks
    instead of mirroring facial detail. Gutters are dilated for mip-safe seams.
 4. AO bake (Cycles) packed into ORM (R=AO, G=roughness, B=metallic).
 5. LOD1/LOD2 by collapse decimation of LOD0 (UVs and vertex groups preserved), all LODs
    limited to 4 normalized influences (Three.js skinning).
 6. Export one GLB: <asset>_LOD0..2 skinned to one shared skeleton, Draco + WebP, with
    extras.lod_distance; save the .blend work file and a metrics JSON for validation.

Run through art/pipeline/build_tripo_heroes.py (it prepares arguments, validates and publishes).
"""

import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

from bl_common import args, finish, log  # noqa: E402

P = args()
T0 = time.time()
RESULT: dict = {"steps": {}}
ASSET = P["asset_id"]                     # SK_Hero_Fox
SHORT = ASSET.split("_", 1)[1]           # Hero_Fox
SIZE = int(P["texture"])


def step(name: str, t: float) -> None:
    RESULT["steps"][name] = round(time.time() - t, 1)
    log(f"{name} ({time.time() - t:.1f}s)")


def activate(obj, others=()) -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in others:
        o.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def tri_count(obj) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ───────────────────────────── 1. Load, scale, pivot ─────────────────────────────
t = time.time()
bpy.ops.wm.open_mainfile(filepath=P["source_blend"])
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
layer_objects = set(bpy.context.view_layer.objects)
for o in [arm, *meshes]:  # Bridge-saved files may keep the objects outside the active view layer
    if o not in layer_objects:
        bpy.context.scene.collection.objects.link(o)
if len(meshes) != 1:
    raise RuntimeError(f"expected one Tripo mesh, found {[o.name for o in meshes]}")
body = meshes[0]
arm.data.pose_position = "REST"
for pb in arm.pose.bones:
    pb.matrix_basis.identity()
RESULT["source"] = {"mesh": body.name, "armature": arm.name, "bones": len(arm.data.bones),
                    "verts": len(body.data.vertices), "polys": len(body.data.polygons)}
arm.name = ASSET
arm.data.name = f"{ASSET}_Skeleton"
body.name = f"{ASSET}_LOD0"
body.data.name = f"{ASSET}_LOD0"

co = np.array([body.matrix_world @ v.co for v in body.data.vertices])
src_h = float(co[:, 2].max() - co[:, 2].min())
scale = float(P["height"]) / src_h
activate(arm, [body])
arm.scale = (scale, scale, scale)
bpy.context.view_layer.update()
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
co = np.array([body.matrix_world @ v.co for v in body.data.vertices])
# Feet on the ground, centred over the origin on X / Y (Tripo already centres; this guards drift).
shift = np.array([-(co[:, 0].max() + co[:, 0].min()) / 2, 0.0, -co[:, 2].min()])
if np.abs(shift).max() > 1e-5:
    arm.location = tuple(shift)
    activate(arm, [body])
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
co = np.array([body.matrix_world @ v.co for v in body.data.vertices])
RESULT["scale"] = {"factor": round(scale, 5), "height": round(float(co[:, 2].max() - co[:, 2].min()), 4),
                   "min": co.min(0).round(4).tolist(), "max": co.max(0).round(4).tolist()}
step("scale/pivot", t)

# ───────────────────────────── 1b. Detach non-arm geometry from arm bones ─────────────────
# Tripo's auto-rig weights anything near the T-pose arms to the arm chain, including the
# falcon's back wings. When the runtime IK brings the arms down to the weapon, those wing
# vertices would be dragged across the back. Arm / forearm / hand influence is faded out with
# distance from that side's arm segments and handed to the clavicle (Shoulder) bone, which the
# display animation does not rotate. Opt-in per hero: detach_arm_weights = [start, end] as a
# fraction of the hero's height.
band = P.get("detach_arm_weights")
if band:
    t = time.time()
    lo_d, hi_d = band[0] * float(P["height"]), band[1] * float(P["height"])
    bones_w = {b.name: (np.array(arm.matrix_world @ b.head_local), np.array(arm.matrix_world @ b.tail_local)) for b in arm.data.bones}
    groups = {g.name: g for g in body.vertex_groups}
    Vw = np.array([body.matrix_world @ v.co for v in body.data.vertices])
    moved = {}
    for side in ("Left", "Right"):
        segs = [bones_w[f"mixamorig:{side}{n}"] for n in ("Arm", "ForeArm", "Hand")]
        d = np.full(len(Vw), np.inf)
        for a, b in segs:
            ab = b - a
            tt = np.clip(((Vw - a) @ ab) / max(float(ab @ ab), 1e-12), 0, 1)
            d = np.minimum(d, np.linalg.norm(Vw - (a + tt[:, None] * ab), axis=1))
        f = np.clip((d - lo_d) / (hi_d - lo_d), 0, 1); f = f * f * (3 - 2 * f)
        chain = [g for n, g in groups.items() if n.startswith((f"mixamorig:{side}Arm", f"mixamorig:{side}ForeArm", f"mixamorig:{side}Hand"))]
        chain_idx = {g.index for g in chain}
        shoulder = groups[f"mixamorig:{side}Shoulder"]
        count = 0
        for v in body.data.vertices:
            if f[v.index] <= 0:
                continue
            take = 0.0
            for ge in v.groups:
                if ge.group in chain_idx and ge.weight > 0:
                    dw = ge.weight * f[v.index]
                    take += dw
                    body.vertex_groups[ge.group].add([v.index], ge.weight - dw, "REPLACE")
            if take > 1e-6:
                shoulder.add([v.index], take, "ADD")
                count += 1
        moved[side] = count
    RESULT["detach_arm_weights"] = {"band_m": [round(lo_d, 3), round(hi_d, 3)], "vertices": moved}
    step("detach arm weights", t)

# ───────────────────────────── 2. Triangulate + UV ─────────────────────────────
t = time.time()
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
bm.to_mesh(body.data)
bm.free()
while body.data.uv_layers:
    body.data.uv_layers.remove(body.data.uv_layers[0])
body.data.uv_layers.new(name="UVMap")
# Tripo meshes are deliberately faceted (median dihedral ~27 deg), so angle-based Smart UV
# shatters them into hundreds of tiny charts. Charts are segmented semantically instead:
# dominant skin bone (merged into body parts) x front/back hemisphere, smoothed over face
# neighbours, tiny charts merged into their longest-border neighbour. Chart borders become
# seams for a minimum-stretch unwrap, then one packed atlas.


def body_part(group: str) -> str:
    g = group.split(":")[-1]
    for side in ("Left", "Right"):
        if g.startswith(side):
            rest = g[len(side):]
            if rest.startswith("Hand"):
                return side + "Hand"
            if rest.startswith(("Toe", "Foot")):
                return side + "Foot"
            if rest == "Shoulder":
                return side + "Arm"
            return side + rest
    if g.startswith(("Head", "Neck")):
        return "Head"
    if g in ("Spine1", "Spine2"):
        return "Chest"
    return "Pelvis"


gname = {g.index: body_part(g.name) for g in body.vertex_groups}
parts = sorted(set(gname.values()))
pidx = {p_: i for i, p_ in enumerate(parts)}
VW = np.zeros((len(body.data.vertices), len(parts)))
for v in body.data.vertices:
    for g in v.groups:
        if g.group in gname:
            VW[v.index, pidx[gname[g.group]]] += g.weight
bm = bmesh.new(); bm.from_mesh(body.data); bm.faces.ensure_lookup_table()
nF = len(bm.faces)
f_part = np.array([int(np.argmax(sum(VW[v.index] for v in f.verts))) for f in bm.faces])
f_ny = np.array([f.normal.y for f in bm.faces])
f_area = np.array([f.calc_area() for f in bm.faces])
nbrs = [[o.index for e in f.edges for o in e.link_faces if o.index != f.index] for f in bm.faces]
front = (f_ny < 0).astype(np.float64)
for _ in range(4):  # area-weighted majority smoothing of the hemisphere label
    nxt = front.copy()
    for i in range(nF):
        if nbrs[i]:
            w = f_area[nbrs[i]]
            nxt[i] = 0.5 * front[i] + 0.5 * float((front[nbrs[i]] * w).sum() / max(w.sum(), 1e-12))
    front = nxt
label = f_part * 2 + (front > 0.5)
chart = -np.ones(nF, int); nC = 0
for i in range(nF):
    if chart[i] >= 0:
        continue
    stack = [i]; chart[i] = nC
    while stack:
        j = stack.pop()
        for k in nbrs[j]:
            if chart[k] < 0 and label[k] == label[i]:
                chart[k] = nC; stack.append(k)
    nC += 1
for _ in range(6):  # merge charts below 14 faces into the neighbour sharing the longest border
    sizes = np.bincount(chart, minlength=nC)
    small = [c for c in range(nC) if 0 < sizes[c] < 14]
    if not small:
        break
    for c in small:
        border: dict = {}
        for e in bm.edges:
            lf = e.link_faces
            if len(lf) == 2:
                a, b = chart[lf[0].index], chart[lf[1].index]
                if a == c and b != c:
                    border[b] = border.get(b, 0) + e.calc_length()
                elif b == c and a != c:
                    border[a] = border.get(a, 0) + e.calc_length()
        if border:
            chart[chart == c] = max(border, key=border.get)
for e in bm.edges:
    lf = e.link_faces
    e.seam = bool(len(lf) != 2 or chart[lf[0].index] != chart[lf[1].index])
bm.to_mesh(body.data); bm.free()
RESULT["uv_charts"] = int(len(np.unique(chart)))
activate(body)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", fill_holes=True, correct_aspect=True, margin=0.003)
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
bpy.ops.object.mode_set(mode="OBJECT")
me = body.data
nV, nL, nT = len(me.vertices), len(me.loops), len(me.polygons)
V = np.empty(nV * 3, np.float32); me.vertices.foreach_get("co", V); V = V.reshape(-1, 3).astype(np.float64)
N = np.empty(nV * 3, np.float32); me.vertices.foreach_get("normal", N); N = N.reshape(-1, 3).astype(np.float64)
loop_v = np.empty(nL, np.int32); me.loops.foreach_get("vertex_index", loop_v)
UV = np.empty(nL * 2, np.float32); me.uv_layers["UVMap"].data.foreach_get("uv", UV); UV = UV.reshape(-1, 2).astype(np.float64)
TRI = loop_v.reshape(-1, 3)          # triangulated: loops are 3 per polygon, in order
TUV = UV.reshape(-1, 3, 2)
step("triangulate/uv", t)

# ───────────────────────────── 3. Projection colour ─────────────────────────────
t = time.time()


def raster(P2, W, H):
    """Yield (tri, rows, cols, bary) for pixel centres covered by each 2-D triangle (x right, y down)."""
    for i in range(len(P2)):
        p = P2[i]
        x0 = max(int(math.floor(p[:, 0].min())), 0); x1 = min(int(math.ceil(p[:, 0].max())), W - 1)
        y0 = max(int(math.floor(p[:, 1].min())), 0); y1 = min(int(math.ceil(p[:, 1].max())), H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        px, py = xs + 0.5, ys + 0.5
        (ax, ay), (bx, by), (cx, cy) = p
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
        w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if inside.any():
            yield i, ys[inside], xs[inside], np.stack([w0[inside], w1[inside], w2[inside]], 1)


ref_img = bpy.data.images.load(P["reference"], check_existing=False)
RW, RH = ref_img.size
ref = np.array(ref_img.pixels[:], np.float32).reshape(RH, RW, -1)[::-1, :, :3].astype(np.float64)  # top-down, sRGB values
border = np.concatenate([ref[:8].reshape(-1, 3), ref[-8:].reshape(-1, 3), ref[:, :8].reshape(-1, 3), ref[:, -8:].reshape(-1, 3)])
bg = np.median(border, 0)
fg = np.abs(ref - bg).max(2) > 0.085


def box_blur(a, r):
    """Separable box blur (edge-clamped) for HxW or HxWxC arrays."""
    out = a.astype(np.float64)
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim; pad[axis] = (r, r)
        c = np.cumsum(np.pad(out, pad, mode="edge"), axis=axis)
        c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
        n = out.shape[axis]
        out = (np.take(c, np.arange(2 * r + 1, n + 2 * r + 1), axis=axis) - np.take(c, np.arange(0, n), axis=axis)) / (2 * r + 1)
    return out


fg = box_blur(fg.astype(np.float64), 2) > 0.5       # remove speckle
fg_core = box_blur(fg.astype(np.float64), 3) > 0.999  # eroded: never sample background halo
rows = np.where(fg.sum(1) > 2)[0]; cols = np.where(fg.sum(0) > 2)[0]
r_top, r_bot, c_l, c_r = rows.min(), rows.max(), cols.min(), cols.max()

# Mesh silhouette in a fixed mesh-space grid (x, z), used to score candidate image fits.
GRID = 0.004
gx0, gx1 = V[:, 0].min() - 0.02, V[:, 0].max() + 0.02
gz0, gz1 = V[:, 2].min() - 0.02, V[:, 2].max() + 0.02
GW, GH = int((gx1 - gx0) / GRID) + 1, int((gz1 - gz0) / GRID) + 1
sil = np.zeros((GH, GW), bool)
tri_g = np.stack([(V[TRI][:, :, 0] - gx0) / GRID, (gz1 - V[TRI][:, :, 2]) / GRID], 2)
for i, rr, cc, _ in raster(tri_g, GW, GH):
    sil[rr, cc] = True
gxs = gx0 + (np.arange(GW) + 0.5) * GRID
gzs = gz1 - (np.arange(GH) + 0.5) * GRID
GX, GZ = np.meshgrid(gxs, gzs)


def iou(s, cx, rz):
    c = np.round(cx + s * GX - 0.5).astype(int); r = np.round(rz - s * GZ - 0.5).astype(int)
    ok = (c >= 0) & (c < RW) & (r >= 0) & (r < RH)
    m = np.zeros_like(sil); m[ok] = fg[r[ok], c[ok]]
    return (m & sil).sum() / max((m | sil).sum(), 1)


zmin, zmax = V[:, 2].min(), V[:, 2].max()
s0 = (r_bot - r_top) / (zmax - zmin)
cx0 = (c_l + c_r + 1) / 2 - s0 * (V[:, 0].min() + V[:, 0].max()) / 2
rz0 = r_bot + 1 + s0 * zmin
best = (iou(s0, cx0, rz0), s0, cx0, rz0)
for span, n in ((0.04, 9), (0.012, 7)):     # coarse-to-fine search around the bbox fit
    _, sb, cb, rb = best
    for ds in np.linspace(-span, span, n):
        for dc in np.linspace(-span, span, n) * RW * 0.25:
            for dr in np.linspace(-span, span, n) * RH * 0.25:
                score = iou(sb * (1 + ds), cb + dc, rb + dr)
                if score > best[0]:
                    best = (score, sb * (1 + ds), cb + dc, rb + dr)
fit_iou, S, CX, RZ = best
RESULT["alignment"] = {"iou_bbox": round(float(iou(s0, cx0, rz0)), 4), "iou": round(float(fit_iou), 4),
                       "px_per_m": round(float(S), 2), "reference": P["reference"], "reference_size": [RW, RH]}
log(f"reference fit IoU {fit_iou:.3f} (bbox {RESULT['alignment']['iou_bbox']:.3f})")


def to_img(p):
    return CX + S * p[..., 0], RZ - S * p[..., 2], p[..., 1]   # col, row, depth (+Y = away from camera)


# Front depth + triangle-id buffer at reference resolution.
zbuf = np.full((RH, RW), np.inf)
idbuf = np.full((RH, RW), -1, np.int64)
pc, pr, pd = to_img(V)
tri_i = np.stack([pc[TRI], pr[TRI]], 2)
for i, rr, cc, b in raster(tri_i, RW, RH):
    d = b @ pd[TRI[i]]
    nearer = d < zbuf[rr, cc]
    zbuf[rr[nearer], cc[nearer]] = d[nearer]
    idbuf[rr[nearer], cc[nearer]] = i
EPS = 0.008 * float(P["height"])


def sample(img, c, r):
    """Bilinear sample of an HxWx3 top-down image at pixel coordinates (centres at +0.5)."""
    c = np.clip(c - 0.5, 0, RW - 1.001); r = np.clip(r - 0.5, 0, RH - 1.001)
    c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
    fc, fr = (c - c0)[:, None], (r - r0)[:, None]
    return (img[r0, c0] * (1 - fc) * (1 - fr) + img[r0, c0 + 1] * fc * (1 - fr)
            + img[r0 + 1, c0] * (1 - fc) * fr + img[r0 + 1, c0 + 1] * fc * fr)


def pix(c, r):
    return np.clip(r.astype(int), 0, RH - 1), np.clip(c.astype(int), 0, RW - 1)


def visible(c, r, d):
    ri, ci = pix(c, r)
    return (d <= zbuf[ri, ci] + EPS) & fg_core[ri, ci]


def smoothstep(a, b, x):
    x = np.clip((x - a) / (b - a), 0, 1)
    return x * x * (3 - 2 * x)


edges = np.concatenate([TRI[:, [0, 1]], TRI[:, [1, 2]], TRI[:, [2, 0]]])
edges = np.unique(np.sort(edges, 1), axis=0)
elen = np.linalg.norm(V[edges[:, 0]] - V[edges[:, 1]], axis=1)
comp = np.arange(nV)
while True:  # connected components: propagate the minimum vertex index over edges
    prev = comp.copy()
    m = np.minimum(comp[edges[:, 0]], comp[edges[:, 1]])
    np.minimum.at(comp, edges[:, 0], m); np.minimum.at(comp, edges[:, 1], m)
    if (comp == prev).all():
        break
main_comp = np.bincount(comp).argmax()
tri_comp = comp[TRI[:, 0]]
tri_part = np.array([parts[k] for k in f_part])
LIMB = np.array([p_ not in ("Head", "Chest", "Pelvis") for p_ in tri_part])
CORE = np.array([p_ in ("Head", "Chest") for p_ in tri_part]).astype(int)  # never mirror face / chest

# Vertex fill for surfaces the front camera cannot see. Confidently visible vertices are
# sources; every other vertex takes the colour of its geodesically nearest source (flat
# colour blocks, no muddy averaging), then a short harmonic pass softens block borders.
ref_soft = box_blur(ref, 3)
vis_v = visible(pc, pr, pd) & (-N[:, 1] > 0.35)
known = vis_v.copy()
fill = np.zeros((nV, 3)); fill[known] = sample(ref_soft, pc[known], pr[known])
dist = np.where(known, 0.0, np.inf); owner = np.where(known, np.arange(nV), -1)
for _ in range(4 * nV):
    changed = False
    for u, v_ in ((edges[:, 0], edges[:, 1]), (edges[:, 1], edges[:, 0])):
        cand = dist[u] + elen
        better = cand < dist[v_] - 1e-12
        if better.any():
            changed = True
            order = np.argsort(-cand[better])          # write nearest last so it wins
            vv, uu, cc_ = v_[better][order], u[better][order], cand[better][order]
            dist[vv] = cc_; owner[vv] = owner[uu]
    if not changed:
        break
cur = fill.copy()
reach = owner >= 0
cur[~known & reach] = fill[owner[~known & reach]]
if (~reach).any() and known.any():
    # Components with no visible vertex: nearest visible vertex in space.
    from mathutils.kdtree import KDTree
    idx = np.where(known)[0]
    kd = KDTree(len(idx))
    for j, k in enumerate(idx):
        kd.insert(V[k].tolist(), j)
    kd.balance()
    for k in np.where(~reach)[0]:
        cur[k] = fill[idx[kd.find(V[k].tolist())[1]]]
RESULT["orphan_vertices"] = int((~reach).sum())
deg = np.bincount(edges.ravel(), minlength=nV).astype(np.float64)
for _ in range(12):
    acc = np.zeros((nV, 3))
    np.add.at(acc, edges[:, 0], cur[edges[:, 1]]); np.add.at(acc, edges[:, 1], cur[edges[:, 0]])
    nxt = acc / np.maximum(deg, 1)[:, None]
    cur[~known] = 0.5 * cur[~known] + 0.5 * nxt[~known]
fillc = cur
mean = fill[known].mean(0) if known.any() else np.full(3, 0.5)

# Texel bake in UV space. A hidden texel may also take the reference colour "through" the
# front surface when that surface is the other side of the same sheet: same separate
# component (tails, loose cloth) or the same limb segment, or any thin sheet (< 7 cm).
# Head and torso never do, so a face or chest pattern is not printed onto the back.
img_bc = np.zeros((SIZE, SIZE, 3)); filled = np.zeros((SIZE, SIZE), bool)
proj_w_sum = 0.0; through_sum = 0.0; texels = 0
THIN = 0.07 * float(P["height"]) / 1.9
tuv_px = np.stack([TUV[:, :, 0] * SIZE, (1 - TUV[:, :, 1]) * SIZE], 2)
for i, rr, cc, b in raster(tuv_px, SIZE, SIZE):
    tri = TRI[i]
    pos = b @ V[tri]
    nrm = b @ N[tri]; nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
    c_, r_, d_ = to_img(pos)
    w = visible(c_, r_, d_) * smoothstep(0.08, 0.32, -nrm[:, 1])
    ri, ci = pix(c_, r_)
    front_tri = idbuf[ri, ci]
    ok = (front_tri >= 0) & fg_core[ri, ci]
    ft = np.where(ok, front_tri, 0)
    same_sheet = ((tri_comp[ft] == tri_comp[i]) & (CORE[i] == 0)
                  & ((tri_comp[i] != main_comp) | (LIMB[i] & (tri_part[ft] == tri_part[i]))))
    thin = ((d_ - zbuf[ri, ci]) < THIN) & (tri_part[i] != "Head")  # ear backs are not inner ears
    through = (ok & (same_sheet | thin)).astype(np.float64)
    ref_c = sample(ref, c_, r_)
    hidden = through[:, None] * ref_c + (1 - through[:, None]) * (b @ fillc[tri])
    col = ref_c * w[:, None] + hidden * (1 - w[:, None])
    img_bc[rr, cc] = col; filled[rr, cc] = True
    proj_w_sum += float(w.sum()); through_sum += float(((1 - w) * through).sum()); texels += len(w)
RESULT["through_ratio"] = round(through_sum / max(texels, 1), 4)
RESULT["projection"] = {"texels": texels, "projected_ratio": round(proj_w_sum / max(texels, 1), 4),
                        "fill_source_vertices": int(vis_v.sum()), "vertices": nV,
                        "uncovered_ratio": round(1 - float(vis_v.mean()), 4)}
# Gutter dilation (mip-safe seams).
for _ in range(16):
    if filled.all():
        break
    acc = np.zeros_like(img_bc); cnt = np.zeros((SIZE, SIZE))
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh_f = np.roll(filled, (dr, dc), (0, 1)); sh_c = np.roll(img_bc, (dr, dc), (0, 1))
        acc += sh_c * sh_f[..., None]; cnt += sh_f
    grow = (~filled) & (cnt > 0)
    img_bc[grow] = acc[grow] / cnt[grow][:, None]; filled |= grow
img_bc[~filled] = mean
RESULT["uv_utilization_texels"] = round(texels / SIZE / SIZE, 4)


def new_image(name, colorspace, data):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False)
    img.colorspace_settings.name = colorspace
    rgba = np.concatenate([np.clip(data, 0, 1), np.ones((SIZE, SIZE, 1))], 2)[::-1]
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    return img


tex_dir = Path(P["texture_dir"]); tex_dir.mkdir(parents=True, exist_ok=True)
bc = new_image(f"T_{SHORT}_BC", "sRGB", img_bc)
step("projection colour", t)

# ───────────────────────────── 4. AO bake + ORM ─────────────────────────────
t = time.time()
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = int(P.get("ao_samples", 48))
mat = bpy.data.materials.new(f"M_{SHORT}")
mat.use_nodes = True
nt = mat.node_tree
me.materials.clear(); me.materials.append(mat)
AO_SIZE = SIZE // 2
ao_img = bpy.data.images.new(f"T_{SHORT}_AO", AO_SIZE, AO_SIZE, alpha=False)
ao_img.colorspace_settings.name = "Non-Color"
bake_node = nt.nodes.new("ShaderNodeTexImage"); bake_node.image = ao_img; nt.nodes.active = bake_node
activate(body)
bpy.ops.object.bake(type="AO", margin=8, margin_type="EXTEND", target="IMAGE_TEXTURES")
ao_img.scale(SIZE, SIZE)
ao = np.array(ao_img.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[::-1, :, 0].astype(np.float64)
ao = 0.3 + 0.7 * np.clip(ao, 0, 1)   # stylized: keep cavities readable without black crush
rough = np.full_like(ao, float(P.get("roughness", 0.88)))
metal = np.full_like(ao, float(P.get("metallic", 0.0)))
orm = new_image(f"T_{SHORT}_ORM", "Non-Color", np.stack([ao, rough, metal], 2))
bpy.data.images.remove(ao_img)
nt.nodes.remove(bake_node)
for img in (bc, orm):
    img.filepath_raw = str(tex_dir / f"{img.name}.png"); img.file_format = "PNG"; img.save()
RESULT["textures"] = {img.name: {"size": SIZE, "colorspace": img.colorspace_settings.name} for img in (bc, orm)}
step("ao/orm", t)

# Final glTF-readable material.
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
t_bc = nt.nodes.new("ShaderNodeTexImage"); t_bc.image = bc
nt.links.new(t_bc.outputs["Color"], bsdf.inputs["Base Color"])
t_orm = nt.nodes.new("ShaderNodeTexImage"); t_orm.image = orm
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(t_orm.outputs["Color"], sep.inputs[0])
nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
gnode = nt.nodes.new("ShaderNodeGroup"); gnode.node_tree = grp
nt.links.new(sep.outputs[0], gnode.inputs["Occlusion"])
mat.use_backface_culling = False  # Tripo shells are open in places (tail roots, sleeves)
for m in list(bpy.data.materials):
    if m is not mat and m.users == 0:
        bpy.data.materials.remove(m)

# ───────────────────────────── 5. LODs + skin limits ─────────────────────────────
t = time.time()
lods = [body]
tris0 = tri_count(body)
for i, budget in enumerate(P["lod_tris"][1:], start=1):
    target = min(budget * 0.96, tris0 * (0.55 if i == 1 else 0.22))
    dup = body.copy(); dup.data = body.data.copy()
    dup.name = dup.data.name = f"{ASSET}_LOD{i}"
    sc.collection.objects.link(dup)
    mod = dup.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"; mod.ratio = target / tris0; mod.use_collapse_triangulate = True
    activate(dup)
    bpy.ops.object.modifier_move_to_index(modifier="decimate", index=0)
    bpy.ops.object.modifier_apply(modifier="decimate")
    lods.append(dup)
skin = {}
for i, lod in enumerate(lods):
    activate(lod)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    lod["lod"] = i
    lod["lod_distance"] = P["lod_distance"][i]
    mx = max((len([g for g in v.groups if g.weight > 1e-6]) for v in lod.data.vertices), default=0)
    unweighted = sum(1 for v in lod.data.vertices if not any(g.weight > 1e-6 for g in v.groups))
    skin[lod.name] = {"max_influences": mx, "unweighted_verts": unweighted}
RESULT["skin"] = {"bones": len(arm.data.bones), "per_lod": skin}
lod_metrics = []
for lod in lods:
    m_ = lod.data
    uv = np.empty(len(m_.loops) * 2, np.float32); m_.uv_layers["UVMap"].data.foreach_get("uv", uv)
    uv3 = uv.reshape(-1, 3, 2)
    a, b, c = uv3[:, 0], uv3[:, 1], uv3[:, 2]
    area = float(np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])).sum() / 2)
    cc = np.array([v.co for v in m_.vertices])
    lod_metrics.append({"name": lod.name, "tris": tri_count(lod), "verts": len(m_.vertices),
                        "uv_min": uv.reshape(-1, 2).min(0).tolist(), "uv_max": uv.reshape(-1, 2).max(0).tolist(),
                        "uv_utilization": round(area, 3),
                        "bbox_min": cc.min(0).round(4).tolist(), "bbox_max": cc.max(0).round(4).tolist()})
RESULT["lods"] = lod_metrics
step("lod/skin", t)

# ───────────────────────────── 6. Export ─────────────────────────────
t = time.time()
export = Path(P["export_glb"]); export.parent.mkdir(parents=True, exist_ok=True)
activate(lods[0], lods[1:] + [arm])
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
opts = dict(filepath=str(export), export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
            export_image_format="WEBP", export_image_quality=88, export_skins=True, export_all_influences=False,
            export_def_bones=False, export_animations=False, export_morph=False, export_extras=True,
            export_cameras=False, export_lights=False,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14, export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})
RESULT["export"] = {"path": str(export), "bytes": export.stat().st_size,
                    "ignored_options": [k for k in opts if k not in props]}
blend = Path(P["blend_path"]); blend.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True, relative_remap=True)
RESULT["blend"] = str(blend)
step("export", t)
RESULT["total_seconds"] = round(time.time() - T0, 1)
finish(P, RESULT)
log(f"done {ASSET}: {RESULT['export']['bytes'] / 1024:.0f} KiB")
