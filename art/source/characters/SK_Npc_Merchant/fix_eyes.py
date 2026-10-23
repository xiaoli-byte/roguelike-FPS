"""狸猫行商眼部修复（2026-10-23）：换掉 Tripo 的眼镜、左眼贴图换成右眼的镜像、两眼侧上方的帽檐局部抬高，其余部位不动。

    blender -b --factory-startup --python art/source/characters/SK_Npc_Merchant/fix_eyes.py -- <源 GLB> <输出 GLB>

用户 2026-10-23：「商人的建模还有瑕疵，眼睛那一块」，补充的侧面近景里：只有一侧看得到金色圆框，框和眼球、毛糊在一起像嵌进脸里，
另一只眼被帽檐压着几乎看不见。四视图（TV_npc_merchant_v001）里是双眼一副细金丝圆眼镜，镜框立在脸前，帽檐在眼睛上方。

1. 眼镜：Tripo 把眼镜做成一块从脸面伸出约 2.5 cm 的厚片（焊接后是一个 322 面的连通块，整个落在 BOX 里）：不透明的镜片上又画了
   一对眼睛，侧面看是两块深色厚片贴在脸上，边框是扁的猫眼形，顶上一条深色横梁。整块删掉，按四视图重做一副：两个细圆环（管径
   GLASSES["tube"]）套在瞳孔上，环面朝向取脸的法线和正前方的中间，离脸的距离按环上每一点到脸面的实测深度定（留 CLEAR 的空隙），
   中间一道略向上拱的鼻梁连起来。没有镜腿（四视图侧面也看不到）。新网格用同一个材质，UV 落在底色图里一块没被占用的空白区域，
   那里画一块竖向渐变的金色（环朝外的一侧亮、贴脸的一侧暗）。
   构建时 LOD0 超过 classes.npc 的 lod_tris[0] 就整体塌陷减面，细环的分段边最便宜，会先被减成八边形；所以这里先把主体按构建同样的
   塌陷减面减到「预算 − 新眼镜面数」，构建时 LOD0 不再减面，环保持 GLASSES["segments"] 段（LOD1 / LOD2 照常减）。减面前按位置
   焊接 UV 接缝（直接对断开的网格减面，接缝会裂成细缝），FACE_BOX 里的胡须等小部件锁住不减，减面后法线按 Tripo 原网格还原。
2. 左眼贴图：去掉镜片后，脸上的左眼（生物的左 = +X）下半有一道斜的浅色条，是 Tripo 把镜片反光投到了皮肤上，两只眼也画得不一样。
   右眼是干净的，所以把右眼镜像到左眼：左眼框里的每个纹素，按它在模型上的点做 x 取反，找右眼那一侧的表面点，取那里的颜色。
   只改主体网格（胡须、眼镜是别的连通块）朝前的面，眼框边缘 1 cm 渐变过渡。
3. 帽檐：斗笠是锥形，前沿最高（z 1.35），往两侧一路垂到眼睛高度（正侧面 1.20），所以从侧面、斜上方看，帽檐正好挡在眼睛前上方。
   只在两眼的方位（以帽轴为心，正前方 = -90°，左右各一个 BRIM["center"] 为中心、BRIM["half"] 为半宽的 cos² 包络）把帽檐往上抬，
   抬高量从帽檐内圈 BRIM["r0"] 到外沿 BRIM["r1"] 平滑增加，外沿最多 BRIM["lift"]。正前方和正侧面不动，帽顶、耳朵不动；
   抬完后帽檐沿口从侧面到前面是一条单调上升的平滑曲线（原来在眼睛那一段下垂得最厉害）。

坐标一律先按 bl_build_tripo_creature 的规则缩放到 1.5 米、落地、包围盒居中后再算（米制：front = -Y，生物的左 = +X，up = +Z）。
写回时网格用原始坐标，原有面的 UV、材质原样保留；减面后的包围盒之后不再变（构建时的缩放、居中和这里一致）。
"""
import json
import math
import sys
import tomllib
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
HEIGHT = 1.5
# 眼镜包围盒：整个连通块落在这里面的就是 Tripo 的眼镜
BOX = (np.array([-0.125, -0.372, 1.144]), np.array([0.125, -0.340, 1.220]))
GLASSES_FACES = 322
# 左眼（+X）连睫毛的框；右眼在它的镜像位置。FEATHER = 框边的渐变宽度
EYE_X, EYE_Z, FEATHER = (0.022, 0.13), (1.145, 1.25), 0.01
# 新眼镜：环半径（到管中心）、管半径、环面离脸的最小空隙、环 / 管的分段
GLASSES = {"radius": 0.027, "tube": 0.0028, "segments": 28, "sides": 6, "bridge_segments": 10}
CLEAR = 0.005
# LOD0 三角面预算（classes.npc）；主体减到预算减去新眼镜的三角面数，再留一点余量
LOD0_TRIS = tomllib.loads((Path(__file__).resolve().parents[3] / "pipeline/pipeline.toml").read_text(encoding="utf-8"))["classes"]["npc"]["lod_tris"][0]
GLASSES_TRIS = 2 * GLASSES["sides"] * (2 * GLASSES["segments"] + GLASSES["bridge_segments"])
# 减面时不动的脸前小部件（胡须、额前的毛）：主体以外、整个落在这个盒子里的连通块
FACE_BOX = (np.array([-0.45, -0.45, 1.0]), np.array([0.45, -0.12, 1.32]))
# 帽檐：帽轴（xy）、两眼方位（相对正前方 -90° 的偏角）、包络半宽、抬高起止半径、外沿抬高量、只动帽檐沿口往下这么多以内的点
BRIM = {"axis": (0.0, -0.13), "center": 55.0, "half": 35.0, "r0": 0.20, "r1": 0.27, "lift": 0.03, "band": 0.045}
# 金色（sRGB）：环朝外一侧 → 贴脸一侧
GOLD_LIGHT, GOLD_DARK = np.array([236, 196, 104]) / 255, np.array([150, 102, 38]) / 255

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
o = next(o for o in bpy.data.objects if o.type == "MESH")
mw = o.matrix_world.copy()
mwi = mw.inverted()
me = o.data
co = np.array([(mw @ v.co)[:] for v in me.vertices])
lo, hi = co.min(0), co.max(0)
scale = HEIGHT / (hi[2] - lo[2])
shift = np.array([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
rot = mw.to_3x3()
bbox0 = (lo.copy(), hi.copy())


def normalized():
    return (np.array([(mw @ v.co)[:] for v in me.vertices]) + shift) * scale


def to_local(p) -> Vector:
    return mwi @ Vector((np.asarray(p) / scale - shift).tolist())


def welded_components():
    """按位置焊接（UV 接缝处顶点是分开的）后的连通块：每个面 → 根编号。"""
    norm = normalized()
    keys = {}
    vkey = [keys.setdefault(tuple(np.round(p / 2e-4).astype(int)), len(keys)) for p in norm]
    parent = list(range(len(keys)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for p in me.polygons:
        r0 = find(vkey[p.vertices[0]])
        for vi in p.vertices[1:]:
            r = find(vkey[vi])
            if r != r0:
                parent[r] = r0
    return norm, np.array([find(vkey[p.vertices[0]]) for p in me.polygons])


# ───────────── 1a. 删掉 Tripo 的眼镜 ─────────────
norm, roots = welded_components()
kill = []
for r in np.unique(roots):
    fs = np.nonzero(roots == r)[0]
    pts = norm[[v for i in fs for v in me.polygons[int(i)].vertices]]
    if (pts.min(0) >= BOX[0] - 1e-3).all() and (pts.max(0) <= BOX[1] + 1e-3).all():
        kill.extend(int(i) for i in fs)
assert len(kill) == GLASSES_FACES, len(kill)
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context="FACES")
bm.to_mesh(me)
bm.free()

# ───────────── 1b. 主体减到 LOD0 预算以内（同构建：塌陷 + 三角化） ─────────────
# 导入的网格在 UV 接缝处是断开的（每个 UV 岛是一个松散块）：直接减面会把相邻两个岛的公共边各减各的，接缝裂成细缝（v003..v007
# 的鼻子、嘴角都有）。先把位置完全重合的点焊起来再减：塌陷减面把 UV 不连续的边当边界保护，UV 不会跨岛（实测减面前后单个三角形的
# UV 最大跨度 351 → 368 纹素）；导出时再按 UV 拆开。阈值只合并完全重合的点，不把挨得近的不同部件焊到一起
# Tripo 自带的顶点法线（没有硬边：UV 接缝两侧的法线一致）先记下来，减面后按最近点插值还原，减面不改明暗
src_co = [v.co.copy() for v in me.vertices]
src_tris = [tuple(p.vertices) for p in me.polygons]
src_vn = np.zeros((len(me.vertices), 3))
np.add.at(src_vn, [l.vertex_index for l in me.loops], np.array([c.vector[:] for c in me.corner_normals]))
src_vn /= np.linalg.norm(src_vn, axis=1, keepdims=True) + 1e-12
src_bvh = BVHTree.FromPolygons(src_co, src_tris)
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
bm.to_mesh(me)
bm.free()
# 胡须这些脸前的细小部件不减（细管的边塌起来最便宜，焊上之后会被减得发灰起棱）：权重 0 的点塌陷代价极高
norm, roots = welded_components()
main = np.bincount(roots).argmax()
keep = np.zeros(len(me.vertices), bool)
for r in np.unique(roots):
    if r == main:
        continue
    fs = np.nonzero(roots == r)[0]
    vs = [v for i in fs for v in me.polygons[int(i)].vertices]
    a, b = norm[vs].min(0), norm[vs].max(0)
    if (a >= FACE_BOX[0]).all() and (b <= FACE_BOX[1]).all():
        keep[vs] = True
grp = o.vertex_groups.new(name="decimate")
grp.add([int(i) for i in np.nonzero(~keep)[0]], 1.0, "REPLACE")
grp.add([int(i) for i in np.nonzero(keep)[0]], 0.0, "REPLACE")
have = sum(len(p.vertices) - 2 for p in me.polygons)
want = LOD0_TRIS - GLASSES_TRIS - 40
bpy.context.view_layer.objects.active = o
dec = o.modifiers.new("decimate", "DECIMATE")
dec.ratio = want / have
dec.use_collapse_triangulate = True
dec.vertex_group = grp.name
dec.vertex_group_factor = 1000.0
bpy.ops.object.modifier_apply(modifier=dec.name)
if o.vertex_groups.get("decimate"):
    o.vertex_groups.remove(o.vertex_groups["decimate"])
kept_verts = int(keep.sum())
body_tris = sum(len(p.vertices) - 2 for p in me.polygons)
assert body_tris + GLASSES_TRIS <= LOD0_TRIS, body_tris
# 减面会挪动顶点，包围盒按减面后的重算（之后的步骤和构建都以它为准）
co = np.array([(mw @ v.co)[:] for v in me.vertices])
lo, hi = co.min(0), co.max(0)
scale = HEIGHT / (hi[2] - lo[2])
shift = np.array([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
bbox0 = (lo.copy(), hi.copy())

# ───────────── 2. 左眼贴图 ← 右眼镜像 ─────────────
norm, roots = welded_components()
main = np.bincount(roots).argmax()
body = [p.index for p in me.polygons if roots[p.index] == main]
tri_ids = [i for i in body if len(me.polygons[i].vertices) == 3]
bvh = BVHTree.FromPolygons([Vector(p) for p in norm], [tuple(me.polygons[i].vertices) for i in tri_ids])

mat = me.materials[0]
tex = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
           and any(l.to_socket.name == "Base Color" for l in n.outputs["Color"].links))
img = tex.image
W, H = img.size
px = np.empty(W * H * 4, np.float32)
img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)
out = px.copy()
uv = np.array([d.uv[:] for d in me.uv_layers.active.data])


def bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-18:
        return None
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return np.array([1 - v - w, v, w])


def sample(u, v, src_px=px):
    x, y = u * W - 0.5, v * H - 0.5
    x0, y0 = int(np.floor(x)) % W, int(np.floor(y)) % H
    x1, y1 = (x0 + 1) % W, (y0 + 1) % H
    fx, fy = x - np.floor(x), y - np.floor(y)
    return ((src_px[y0, x0] * (1 - fx) + src_px[y0, x1] * fx) * (1 - fy)
            + (src_px[y1, x0] * (1 - fx) + src_px[y1, x1] * fx) * fy)


def surface_uv(loc, fi):
    """BVH 命中点 → 该点的 UV（主体三角形的重心插值）。"""
    sp = me.polygons[tri_ids[fi]]
    mu = bary(np.array(loc[:]), *norm[list(sp.vertices)])
    if mu is None:
        return None
    mu = np.clip(mu, 0, 1)
    mu /= mu.sum()
    return mu @ uv[list(sp.loop_indices)], mu, sp


written = 0
for i in body:
    poly = me.polygons[i]
    if len(poly.vertices) != 3:
        continue
    P = norm[list(poly.vertices)]
    cen = P.mean(0)
    if not (EYE_X[0] <= cen[0] <= EYE_X[1] and EYE_Z[0] <= cen[2] <= EYE_Z[1] and cen[1] < -0.2):
        continue
    if (rot @ poly.normal).normalized()[1] > -0.2:  # 只要朝前的面
        continue
    T = uv[list(poly.loop_indices)] * [W, H]
    x0, y0 = np.floor(T.min(0)).astype(int) - 2
    x1, y1 = np.ceil(T.max(0)).astype(int) + 2
    # 三角形外 2 个纹素以内的也写（接缝和三角形边上的纹素不留旧色，岛边的缝隙也填上，免得 mip 时渗出旧眼睛）
    tol = 2.0 / max(float(np.linalg.norm(np.cross(T[1] - T[0], T[2] - T[0]))) / max(np.linalg.norm(T[1] - T[0]), np.linalg.norm(T[2] - T[0]), np.linalg.norm(T[2] - T[1]), 1e-6), 1e-6)
    for yy in range(y0, y1 + 1):
        for xx in range(x0, x1 + 1):
            lam = bary(np.array([xx + 0.5, yy + 0.5]), *T)
            if lam is None or lam.min() < -tol:
                continue
            lam = np.clip(lam, 0, None)
            lam /= lam.sum()
            p = lam @ P
            # 框边渐变：离框边越近越保留原色
            d = min(p[0] - EYE_X[0], EYE_X[1] - p[0], p[2] - EYE_Z[0], EYE_Z[1] - p[2])
            wgt = float(np.clip(d / FEATHER, 0, 1))
            if wgt <= 0:
                continue
            loc, _, fi, _ = bvh.find_nearest(Vector((-p[0], p[1], p[2])))
            if loc is None:
                continue
            sp = me.polygons[tri_ids[fi]]
            mu = bary(np.array(loc[:]), *norm[list(sp.vertices)])
            if mu is None:
                continue
            mu = np.clip(mu, 0, 1)
            mu /= mu.sum()
            mu = mu * 0.94 + 0.02  # 取样点往三角形里收一点，不取到 UV 岛边缘的填充色
            su = mu @ uv[list(sp.loop_indices)]
            col = sample(su[0], su[1])
            yi, xi = yy % H, xx % W
            out[yi, xi, :3] = px[yi, xi, :3] * (1 - wgt) + col[:3] * wgt
            written += 1

# ───────────── 1c. 新眼镜的位置：瞳孔中心、脸面法线、离脸距离 ─────────────
eyes = []
for side in (1, -1):
    pts, lum = [], []
    for x in np.linspace(EYE_X[0], EYE_X[1], 56):
        for z in np.linspace(EYE_Z[0], EYE_Z[1], 56):
            loc, nrm, fi, _ = bvh.ray_cast(Vector((side * x, -1.0, z)), Vector((0, 1, 0)))
            if loc is None:
                continue
            s = surface_uv(loc, fi)
            if s is None:
                continue
            c = sample(s[0][0], s[0][1], out)[:3]
            pts.append(np.array(loc[:]))
            lum.append(float(c @ [0.299, 0.587, 0.114]))
    pts, lum = np.array(pts), np.array(lum)
    dark = pts[lum <= np.quantile(lum, 0.04)]  # 瞳孔 + 睫毛最深的一撮，取下半部分（睫毛在上）
    dark = dark[dark[:, 2] <= np.median(dark[:, 2])]
    eyes.append({"pupil": dark.mean(0)})
# 两眼取对称的平均位置（右眼镜像过来，免得一高一低）
pc = (np.array([abs(eyes[0]["pupil"][0]), 0, eyes[0]["pupil"][2]]) + np.array([abs(eyes[1]["pupil"][0]), 0, eyes[1]["pupil"][2]])) / 2
R, TUBE = GLASSES["radius"], GLASSES["tube"]
rims = []
for side in (1, -1):
    loc, nrm, fi, _ = bvh.ray_cast(Vector((side * pc[0], -1.0, pc[2])), Vector((0, 1, 0)))
    S = np.array(loc[:])
    # 法线取眼周一圈命中点法线的平均（单个三角形的法线太跳）
    ns = []
    for k in range(16):
        a = 2 * math.pi * k / 16
        h = bvh.ray_cast(Vector((side * pc[0] + 0.6 * R * math.cos(a), -1.0, pc[2] + 0.6 * R * math.sin(a))), Vector((0, 1, 0)))
        if h[0] is not None:
            ns.append(np.array(h[1][:]))
    N = np.mean(ns, 0)
    N /= np.linalg.norm(N)
    n = N * 0.5 + np.array([0, -1.0, 0]) * 0.5
    n /= np.linalg.norm(n)
    u = np.cross([0, 0, 1.0], n)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    # 环上每一点（含管的半径）到脸面的深度：从环面前 10 cm 沿 -n 打回脸上
    need = 0.0
    for k in range(48):
        a = 2 * math.pi * k / 48
        for dr in (-TUBE, 0, TUBE):
            q = S + (R + dr) * (math.cos(a) * u + math.sin(a) * v)
            h = bvh.ray_cast(Vector((q + n * 0.1).tolist()), Vector((-n).tolist()), 0.2)
            if h[0] is not None:
                need = max(need, 0.1 - float(np.linalg.norm(np.array(h[0][:]) - (q + n * 0.1))))
    gap = need + TUBE + CLEAR
    rims.append({"side": side, "surface": S, "n": n, "u": u, "v": v, "gap": gap, "center": S + n * gap})
# 两个环的离脸距离取一样（取大的），保持对称
gap = max(r["gap"] for r in rims)
for r in rims:
    r["gap"] = gap
    r["center"] = r["surface"] + r["n"] * gap

# ───────────── 3. 帽檐局部抬高 ─────────────
norm, roots = welded_components()
main = np.bincount(roots).argmax()
in_main = np.zeros(len(me.vertices), bool)
for p in me.polygons:
    if roots[p.index] == main:
        in_main[list(p.vertices)] = True
ax = np.array(BRIM["axis"])
d = norm[:, :2] - ax
r_xy = np.hypot(d[:, 0], d[:, 1])
az = np.degrees(np.arctan2(d[:, 1], d[:, 0]))          # 正前方 = -90°，生物的左（+X）= 0°
# 每个方位上帽檐沿口的高度：外沿一圈（r1 以外）的最低点；只动沿口往下 band 以内的点（帽檐的上下两面），脸、毛不在这个高度
edge_z = {}
for k in range(-180, 181, 5):
    m = in_main & (np.abs(((az - k + 180) % 360) - 180) <= 5) & (r_xy >= BRIM["r1"] - 0.01) & (norm[:, 2] > 1.15)
    if m.any():
        edge_z[k] = float(norm[m, 2].min())
ks = np.array(sorted(edge_z))
zs = np.array([edge_z[k] for k in ks])
floor = np.interp(az, ks, zs) - BRIM["band"]


def envelope(a):
    w = np.zeros_like(a)
    for c in (-90 + BRIM["center"], -90 - BRIM["center"]):
        t = np.abs(((a - c + 180) % 360) - 180) / BRIM["half"]
        w = np.maximum(w, np.where(t < 1, np.cos(t * math.pi / 2) ** 2, 0))
    return w


ramp = np.clip((r_xy - BRIM["r0"]) / (BRIM["r1"] - BRIM["r0"]), 0, 1)
ramp = ramp * ramp * (3 - 2 * ramp)
dz = BRIM["lift"] * envelope(az) * ramp * (in_main & (norm[:, 2] >= floor) & (d[:, 1] < 0))
moved = int((dz > 1e-5).sum())
edge_before = {k: round(edge_z[k], 3) for k in range(-180, 1, 15) if k in edge_z}
for vi in np.nonzero(dz > 1e-5)[0]:
    p = norm[vi].copy()
    p[2] += dz[vi]
    me.vertices[vi].co = to_local(p)

# ───────────── 1d. 金色贴图块 + 新眼镜网格 ─────────────
# 底色图里找一块没被任何三角形占用的空白（按 8 纹素一格算占用，外扩 1 格留 mip 余量；Tripo 的图集很满，约 84 % 的格子有三角形）
CELL = 8
gw, gh = W // CELL, H // CELL
used = np.zeros((gh, gw), bool)
for p in me.polygons:
    T = uv[list(p.loop_indices)] * [gw, gh]
    a0, b0 = np.floor(T.min(0)).astype(int), np.ceil(T.max(0)).astype(int)
    used[max(a0[1], 0):min(b0[1] + 1, gh), max(a0[0], 0):min(b0[0] + 1, gw)] = True
pad = 1
grow = used.copy()
for dy in range(-pad, pad + 1):
    for dx in range(-pad, pad + 1):
        grow |= np.roll(np.roll(used, dy, 0), dx, 1)
BLK = 8  # 8 格 = 64 纹素见方
free = None
integ = np.pad(grow.astype(int), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
for cy in range(gh - BLK):
    for cx in range(gw - BLK):
        if integ[cy + BLK, cx + BLK] - integ[cy, cx + BLK] - integ[cy + BLK, cx] + integ[cy, cx] == 0:
            free = (cx, cy)
            break
    if free:
        break
assert free, "底色图里没有空白块"
X0, Y0 = free[0] * CELL, free[1] * CELL
SZ = BLK * CELL
for yy in range(SZ):
    t = yy / (SZ - 1)  # v 方向：0 = 环朝外一侧（亮）→ 1 = 贴脸一侧（暗）
    out[Y0 + yy, X0:X0 + SZ, :3] = GOLD_LIGHT * (1 - t) + GOLD_DARK * t
    out[Y0 + yy, X0:X0 + SZ, 3] = 1.0
# 新网格的 UV 只用这块的中间 70 %，mip 时不吃到边外的颜色
U0, U1 = (X0 + 0.15 * SZ) / W, (X0 + 0.85 * SZ) / W
V0, V1 = (Y0 + 0.15 * SZ) / H, (Y0 + 0.85 * SZ) / H

bm = bmesh.new()
bm.from_mesh(me)
uvl = bm.loops.layers.uv.active
new_verts = []


def tube(path, n_out, closed, sides=GLASSES["sides"]):
    """沿折线 path（N×3，归一化坐标）扫一根管；n_out[i] = 该点"朝外"的方向（管截面角 0 对着它，贴图最亮）。"""
    rings = []
    m = len(path)
    for i in range(m):
        if closed:
            tg = path[(i + 1) % m] - path[i - 1]
        else:
            tg = path[min(i + 1, m - 1)] - path[max(i - 1, 0)]
        tg /= np.linalg.norm(tg)
        e1 = n_out[i] - tg * (n_out[i] @ tg)
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(tg, e1)
        ring = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            nv = bm.verts.new(to_local(path[i] + TUBE * (math.cos(a) * e1 + math.sin(a) * e2)))
            new_verts.append(nv)
            ring.append((nv, j))
        rings.append(ring)
    faces = 0
    for i in range(m if closed else m - 1):
        r0, r1 = rings[i], rings[(i + 1) % m]
        for j in range(sides):
            jn = (j + 1) % sides
            f = bm.faces.new((r0[j][0], r0[jn][0], r1[jn][0], r1[j][0]))
            f.smooth = True
            f.material_index = 0
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                su = U0 + (U1 - U0) * (ii / m)
                # 截面角 → 亮暗：角 0（朝外）在 V0，角 π（贴脸）在 V1
                sv = V0 + (V1 - V0) * (1 - math.cos(2 * math.pi * jj / sides)) / 2
                loop[uvl].uv = (su, sv)
            faces += 1
    return faces


new_faces = 0
seg = GLASSES["segments"]
for r in rims:
    a = np.linspace(0, 2 * math.pi, seg, endpoint=False)
    path = np.array([r["center"] + R * (math.cos(t) * r["u"] + math.sin(t) * r["v"]) for t in a])
    new_faces += tube(path, [r["n"]] * seg, True)
# 鼻梁：两环内侧偏上的点之间一道向上拱的弧，贴着鼻梁前面走
inner = []
for r in rims:
    t = math.radians(160 if r["side"] == 1 else 20)  # u = 生物的左 → 右方向；内侧 = 朝鼻子
    inner.append(r["center"] + R * (math.cos(t) * r["u"] + math.sin(t) * r["v"]))
mid = (inner[0] + inner[1]) / 2
top = np.array([0.0, float(mid[1]), float(mid[2]) + 0.006])  # 弧顶
h = bvh.ray_cast(Vector((0, -1.0, float(top[2]))), Vector((0, 1, 0)))
if h[0] is not None:
    top[1] = min(top[1], h[0].y - TUBE - CLEAR)
ctrl = 2 * top - mid  # 二次贝塞尔在 t = 0.5 处正好过弧顶
bs = GLASSES["bridge_segments"]
path = np.array([(1 - t) ** 2 * inner[0] + 2 * (1 - t) * t * ctrl + t * t * inner[1] for t in np.linspace(0, 1, bs + 1)])
new_faces += tube(path, [np.array([0, -1.0, 0])] * len(path), False)
bm.to_mesh(me)
bm.free()

# 法线：原有的点取 Tripo 原网格最近点的插值法线，新眼镜用自身几何算出的法线
vn = np.array([v.vector[:] for v in me.vertex_normals])
n_src = len(me.vertices) - len(new_verts)
for i in range(n_src):
    loc, _, fi, _ = src_bvh.find_nearest(me.vertices[i].co)
    tri = src_tris[fi]
    mu = bary(np.array(loc[:]), *[np.array(src_co[k][:]) for k in tri])
    if mu is None:
        continue
    mu = np.clip(mu, 0, 1)
    nn = (mu / mu.sum()) @ src_vn[list(tri)]
    vn[i] = nn / (np.linalg.norm(nn) + 1e-12)
me.normals_split_custom_set_from_vertices([tuple(n) for n in vn])

img.pixels.foreach_set(out.ravel())
img.update()

# 包围盒不能变（构建时按包围盒缩放、居中）
co = np.array([(mw @ v.co)[:] for v in me.vertices])
assert np.allclose(co.min(0), bbox0[0], atol=1e-6) and np.allclose(co.max(0), bbox0[1], atol=1e-6), (co.min(0), co.max(0), bbox0)

bpy.ops.object.select_all(action="DESELECT")
o.select_set(True)
bpy.context.view_layer.objects.active = o
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_image_format="AUTO",
                          export_texcoords=True, export_normals=True, export_materials="EXPORT",
                          export_animations=False, export_extras=False)
print("EYES_FIX " + json.dumps({
    "glasses_deleted_faces": len(kill), "left_eye_texels": written, "texture": [W, H],
    "pupils": [e["pupil"].round(4).tolist() for e in eyes], "rim_center": [r["center"].round(4).tolist() for r in rims],
    "rim_gap": round(gap, 4), "rim_normal": [r["n"].round(3).tolist() for r in rims], "gold_patch": [X0, Y0, SZ],
    "body_tris": [have, body_tris], "decimate_kept_verts": kept_verts, "glasses_new_faces": new_faces, "lod0_tris": body_tris + 2 * new_faces, "brim_moved_verts": moved, "brim_edge_before": edge_before,
    "faces_left": len(me.polygons)}))
