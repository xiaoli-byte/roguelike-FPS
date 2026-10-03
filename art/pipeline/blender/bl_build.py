"""阶段 03 · 游戏化（在 Blender 里无头运行）：高模 → 可进引擎的低模资产。

步骤
 1. 导入高模，清理浮块 / 重复点，统一法线。
 2. 对齐：4 个候选朝向 × 剪影 IoU 选朝向；再在缩放 / 平移上搜索，让四个视图的剪影和配准后的概念图重合最好；
    最后把脚底落到 z=0（游戏约定：脚底原点、朝 +Z = Blender −Y、Y 向上 = Blender Z、米）。
 3. 低模 LOD0：四边面折叠减面到预算 → 三角化 → 平滑着色 → Smart UV + 打包。
 4. 投影着色：概念四视图按白模相机正交投影到高模；权重 = 可见性（射线遮挡）× 法线朝向^k × 概念图 alpha；
    四个视图都看不到的顶点用网格扩散补色。
 5. 烘焙（Cycles，高模 → 低模）：BaseColor（自发光通道）、切线空间法线（OpenGL / glTF 约定）、AO；
    AO + 粗糙度 + 金属度打包为 ORM（glTF 约定 R=AO G=Roughness B=Metallic）。
 6. LOD1..n：LOD0 继续减面（共用 UV 与贴图）。
 7. 骨骼网格：按白模关节搭骨架（骨骼名 = 游戏关节名），自动权重（bone heat），最多 4 骨骼影响，归一化。
 8. 导出 GLB（Draco + WebP + 切线），保存 .blend 工程，写出度量数据供 validate 阶段使用。
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
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

from bl_common import VIEW_ORDER, args, clear_scene, finish, import_glb, log  # noqa: E402

P = args()
T0 = time.time()
RESULT: dict = {"steps": {}}


def step(name: str, t: float) -> None:
    RESULT["steps"][name] = round(time.time() - t, 1)
    log(f"{name} 完成（{time.time() - t:.1f} 秒）")


def activate(obj, others=()) -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in others:
        o.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def mesh_verts(obj) -> np.ndarray:
    n = len(obj.data.vertices)
    a = np.empty(n * 3, np.float32)
    obj.data.vertices.foreach_get("co", a)
    return a.reshape(n, 3).astype(np.float64)


def set_verts(obj, v: np.ndarray) -> None:
    obj.data.vertices.foreach_set("co", v.astype(np.float32).ravel())
    obj.data.update()


def load_mask_rgba(path: str) -> np.ndarray:
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1]  # 行从上到下


# ───────────────────────────── 1. 导入与清理 ─────────────────────────────
t = time.time()
clear_scene()
views = json.loads(Path(P["views_json"]).read_text(encoding="utf-8"))
VP = {v["view"]: v for v in views["views"]}
hp_objs = [o for o in import_glb(P["highpoly_glb"]) if o.type == "MESH"]
activate(hp_objs[0], hp_objs[1:])
if len(hp_objs) > 1:
    bpy.ops.object.join()
hp = bpy.context.view_layer.objects.active
hp.name = "HP"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in bpy.data.objects if o.type != "MESH"]:
    bpy.data.objects.remove(o)

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.delete_loose()
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")
parts = sorted([o for o in bpy.context.view_layer.objects if o.type == "MESH"], key=lambda o: len(o.data.polygons), reverse=True)
total = sum(len(o.data.polygons) for o in parts)
keep = [o for o in parts if len(o.data.polygons) >= 0.01 * total]
for o in parts:
    if o not in keep:
        bpy.data.objects.remove(o)
activate(keep[0], keep[1:])
if len(keep) > 1:
    bpy.ops.object.join()
hp = bpy.context.view_layer.objects.active
hp.name = "HP"
raw_faces = len(hp.data.polygons)
# Surface Net 提面会留下非流形边（边折叠减面会卡在这些边上），也没有平滑法线：
# 体素重建一次拓扑，得到水密流形网格（体素边长按资产高度取，和 Hunyuan 体素分辨率同量级，不损失细节）
dims = hp.dimensions
remesh = hp.modifiers.new("remesh", "REMESH")
remesh.mode = "VOXEL"
remesh.voxel_size = max(dims) * P.get("remesh_voxel", 0.0025)
remesh.adaptivity = 0.0
activate(hp)
bpy.ops.object.modifier_apply(modifier=remesh.name)
bpy.ops.object.shade_smooth()
RESULT["highpoly"] = {"faces_raw": raw_faces, "faces": len(hp.data.polygons), "verts": len(hp.data.vertices),
                      "loose_parts": len(parts), "kept_parts": len(keep), "remesh_voxel_m": round(remesh.voxel_size, 5)}
step("导入清理", t)

# ───────────────────────────── 2. 对齐 ─────────────────────────────
t = time.time()
DS = 4  # 剪影比对降采样倍数
masks = {}
for v in VIEW_ORDER:
    rgba = load_mask_rgba(P["concept_views"][v])
    m = rgba[..., 3] > 0.5
    h, w = m.shape
    masks[v] = m[: h - h % DS, : w - w % DS].reshape(h // DS, DS, w // DS, DS).any(axis=(1, 3))


def project(vp: dict, pts: np.ndarray) -> np.ndarray:
    c, r, u = np.array(vp["center"]), np.array(vp["right"]), np.array(vp["up"])
    x = ((pts - c) @ r / vp["world_w"] + 0.5) * vp["px_w"]
    y = (0.5 - (pts - c) @ u / vp["world_h"]) * vp["px_h"]
    return np.stack([x, y], axis=1)


def silhouette(vp: dict, pts: np.ndarray) -> np.ndarray:
    xy = (project(vp, pts) / DS).astype(np.int64)
    H, W = vp["px_h"] // DS, vp["px_w"] // DS
    ok = (xy[:, 0] >= 0) & (xy[:, 0] < W) & (xy[:, 1] >= 0) & (xy[:, 1] < H)
    m = np.zeros((H, W), bool)
    m[xy[ok, 1], xy[ok, 0]] = True
    # 闭运算填点阵空隙
    d = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return d & (np.roll(d, 1, 0) | np.roll(d, -1, 0)) & (np.roll(d, 1, 1) | np.roll(d, -1, 1)) | m


def score(pts: np.ndarray, which=VIEW_ORDER) -> tuple[float, dict]:
    per = {}
    for v in which:
        s, mk = silhouette(VP[v], pts), masks[v]
        per[v] = float((s & mk).sum() / max(1, (s | mk).sum()))
    weights = {"front": 1.5, "back": 1.0, "left": 1.0, "right": 1.0}
    return sum(per[v] * weights[v] for v in which) / sum(weights[v] for v in which), per


V0 = mesh_verts(hp)
sample = V0[np.random.default_rng(0).choice(len(V0), min(len(V0), 120000), replace=False)]


def fit_box(pts: np.ndarray) -> np.ndarray:
    """按概念图剪影的世界范围做初始缩放 / 平移：高度对齐正面图，水平居中正面 / 侧面图。"""
    fv, lv = VP["front"], VP["left"]

    def world_extent(vp, mask):
        ys, xs = np.nonzero(mask)
        x0, x1 = xs.min() * DS / vp["px_w"], (xs.max() + 1) * DS / vp["px_w"]
        y0, y1 = ys.min() * DS / vp["px_h"], (ys.max() + 1) * DS / vp["px_h"]
        c, r, u = np.array(vp["center"]), np.array(vp["right"]), np.array(vp["up"])
        return ((x0 + x1) / 2 - 0.5) * vp["world_w"], (0.5 - y1) * vp["world_h"] + c @ u, (0.5 - y0) * vp["world_h"] + c @ u, c, r

    fx, fz0, fz1, fc, fr = world_extent(fv, masks["front"])
    lx, _, _, lc, lr = world_extent(lv, masks["left"])
    lo, hi = pts.min(0), pts.max(0)
    s = (fz1 - fz0) / (hi[2] - lo[2])
    p = (pts - (lo + hi) / 2) * s
    target = np.array([fc[0] + fx * fr[0], lc[1] + lx * lr[1], (fz0 + fz1) / 2])
    return p + target


# 朝向：Hunyuan3D 的约定是「输入图 = 正面」，导入 Blender 后朝 −Y，与游戏约定一致，默认不转。
# 剪影分不清正面和背面（互为镜像），所以只在 90° / 270° 明显更好时才改（说明输入图其实是侧视图），并给出警告。
cands = []
for k in range(4):
    a = k * math.pi / 2
    R = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    sc, per = score(fit_box(sample @ R.T))
    cands.append((sc, k, R))
    log(f"朝向候选 {k * 90:3d}°：IoU {sc:.3f} " + " ".join(f"{v}={per[v]:.2f}" for v in VIEW_ORDER))
best = cands[0]
for c in (cands[1], cands[3]):
    if c[0] > best[0] + 0.08:
        best = c
if best[1] != 0:
    log(f"⚠ 朝向改为 {best[1] * 90}°（侧向剪影明显更吻合），请在审核图里确认正反")
_, yaw_k, R = best
RESULT["align"] = {"yaw_deg": yaw_k * 90}

# 在初始对齐附近搜缩放和平移（坐标下降，三轮逐步缩小步长）
base = fit_box(sample @ R.T)
ctr = base.mean(0)
params = np.array([1.0, 0.0, 0.0, 0.0])  # 缩放、dx、dy、dz
cur, _ = score(base)
height = base[:, 2].max() - base[:, 2].min()
for span in (0.04, 0.015, 0.006):
    for i in range(4):
        for delta in (-span, span):
            trial = params.copy()
            trial[i] += delta if i == 0 else delta * height
            pts = (base - ctr) * trial[0] + ctr + trial[1:]
            sc, _ = score(pts)
            if sc > cur + 1e-4:
                cur, params = sc, trial
final_score, per = score((base - ctr) * params[0] + ctr + params[1:])
log(f"对齐：缩放修正 {params[0]:.3f}，平移 {np.round(params[1:], 3)}，IoU {final_score:.3f}")

# 应用到完整高模：同样的变换（先 fit_box 的线性部分）
full = V0 @ R.T
lo, hi = (sample @ R.T).min(0), (sample @ R.T).max(0)
fitted_lo = fit_box(np.array([lo, hi]))
s0 = (fitted_lo[1, 2] - fitted_lo[0, 2]) / (hi[2] - lo[2])
full = (full - (lo + hi) / 2) * s0 + (fitted_lo[0] + fitted_lo[1]) / 2
full = (full - ctr) * params[0] + ctr + params[1:]
if P.get("anchor", "feet") == "feet":
    full[:, 2] -= full[:, 2].min()  # 脚底落地（角色）；挂件的原点是挂点，保持对齐结果
set_verts(hp, full)
RESULT["align"].update({"iou": round(final_score, 3), "iou_per_view": {k: round(v, 3) for k, v in per.items()},
                        "height_m": round(float(full[:, 2].max()), 4),
                        "blockout_height_m": round(views["bbox_max"][2] - views["bbox_min"][2], 4)})
step("对齐", t)

# ───────────────────────────── 3. 低模 LOD0 + UV ─────────────────────────────
t = time.time()
lod_tris = P["lod_tris"]


def decimate_copy(src, name: str, tris: int):
    me = src.data.copy()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    activate(obj)
    cur_tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if cur_tris > tris:
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = tris / cur_tris
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # 减面会留下退化三角形 / 重复点（Blender 报 "Mesh is not valid"），bone heat 的方程组会因此整块求解失败
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.dissolve_degenerate(threshold=1e-5)
    bpy.ops.mesh.delete_loose()
    bpy.ops.object.mode_set(mode="OBJECT")
    mod = obj.modifiers.new("tri", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.validate(clean_customdata=False)
    bpy.ops.object.shade_smooth()
    return obj


def uv_charts(bm) -> tuple[list[int], int]:
    """按缝线切分的面连通块（UV 图块）：返回 (face.index → 块号, 块数)。"""
    bm.faces.ensure_lookup_table()
    cid, n = [-1] * len(bm.faces), 0
    for f0 in bm.faces:
        if cid[f0.index] >= 0:
            continue
        stack, cid[f0.index] = [f0], n
        while stack:
            f = stack.pop()
            for e in f.edges:
                if not e.seam:
                    for g in e.link_faces:
                        if cid[g.index] < 0:
                            cid[g.index] = n
                            stack.append(g)
        n += 1
    return cid, n


def flipped_charts(obj) -> tuple[set, int]:
    """UV 翻折：同一图块里朝向与多数相反的面。返回 (有翻折的块, 翻折面数)。"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active
    cid, n = uv_charts(bm)
    pos, neg = np.zeros(n, int), np.zeros(n, int)
    for f in bm.faces:
        a, b, c = (l[uv].uv for l in f.loops[:3])
        s = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
        if s > 0:
            pos[cid[f.index]] += 1
        elif s < 0:
            neg[cid[f.index]] += 1
    bad = np.minimum(pos, neg)
    bm.free()
    return set(np.nonzero(bad)[0].tolist()), int(bad.sum())


def merge_small_charts(bm, area: np.ndarray, min_area: float, allowed: set | None = None, rounds: int = 40) -> None:
    """小图块并入共享缝长最长的邻块（擦掉中间的缝）。allowed：只在这些面之间动缝（局部重做时用）。"""
    for _ in range(rounds):
        cid, n = uv_charts(bm)
        small = set(np.nonzero(np.bincount(cid, weights=area, minlength=n) < min_area)[0].tolist())
        if not small:
            return
        shared = {}
        for e in bm.edges:
            if e.seam and len(e.link_faces) == 2:
                fa, fb = e.link_faces
                if allowed is not None and (fa.index not in allowed or fb.index not in allowed):
                    continue
                a, b = cid[fa.index], cid[fb.index]
                if a != b:
                    for x, y in ((a, b), (b, a)):
                        if x in small:
                            shared.setdefault(x, {}).setdefault(y, 0.0)
                            shared[x][y] += e.calc_length()
        target = {x: max(d, key=d.get) for x, d in shared.items()}
        changed = 0
        for e in bm.edges:
            if e.seam and len(e.link_faces) == 2:
                fa, fb = e.link_faces
                if allowed is not None and (fa.index not in allowed or fb.index not in allowed):
                    continue
                a, b = cid[fa.index], cid[fb.index]
                if target.get(a) == b or target.get(b) == a:
                    e.seam = False
                    changed += 1
        if not changed:
            return


def unwrap_lod0(obj, tex_size: int) -> dict:
    """自动展 UV：智能展开得到初始分块 → 小块并入共享边界最长的邻块（Hunyuan 网格法线杂乱，智能展开会切出几百个
    平均十来个三角面的小岛，每个岛四周的边距吃掉大半贴图）→ 图块边界平滑 → 在真实几何上用最小拉伸展开 →
    有翻折的块逐级细化重做（恢复原细分后按更小的阈值重新合并）→ 统一纹素密度 → 按像素边距打包。"""
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.seams_from_islands(mark_seams=True, mark_sharp=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    original = {e.index for e in bm.edges if e.seam}
    area = np.array([f.calc_area() for f in bm.faces])
    _, n0 = uv_charts(bm)
    min_frac = P.get("uv_min_chart", 0.005)
    merge_small_charts(bm, area, min_frac * area.sum())
    # 边界平滑：合并进来的碎块形状不规则，图块边缘全是毛刺，打包时毛刺之间的空隙用不上。
    # 多数边邻面属于另一个图块的面改归过去，再按新的归属重新生成缝线；平滑可能切出新的小碎块，再并一轮
    cid, n = uv_charts(bm)
    cid = np.array(cid)
    nb = [[g.index for e in f.edges for g in e.link_faces if g is not f] for f in bm.faces]
    for _ in range(4):
        changed = 0
        for i, ns in enumerate(nb):
            if len(ns) < 2:
                continue
            vals, cnt = np.unique(cid[ns], return_counts=True)
            k = cnt.argmax()
            if vals[k] != cid[i] and cnt[k] * 2 > len(ns):
                cid[i] = vals[k]
                changed += 1
        if not changed:
            break
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.seam = bool(cid[e.link_faces[0].index] != cid[e.link_faces[1].index])
    merge_small_charts(bm, area, min_frac * area.sum())
    bm.to_mesh(obj.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", fill_holes=True, correct_aspect=True, margin=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    # 仍有翻折的块逐级细化：恢复这些块内部原来的细分缝，再按更小的阈值重新合并，只对它们重新展开（阈值 0 = 原细分，不会翻折）
    redone = 0
    bad, flipped = flipped_charts(obj)
    for frac in (min_frac * 0.4, min_frac * 0.1, 0.0):
        if not bad:
            break
        redone += len(bad)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        cid, _ = uv_charts(bm)
        bm.edges.ensure_lookup_table()
        faces = {f.index for f in bm.faces if cid[f.index] in bad}
        for i in original:
            e = bm.edges[i]
            if any(f.index in faces for f in e.link_faces):
                e.seam = True
        if frac > 0:
            merge_small_charts(bm, area, frac * area.sum(), allowed=faces)
        for f in bm.faces:
            f.select = f.index in faces
        bm.to_mesh(obj.data)
        bm.free()
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", fill_holes=True, correct_aspect=True, margin=0.0)
        bpy.ops.object.mode_set(mode="OBJECT")
        bad, flipped = flipped_charts(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="ANY", margin=UV_MARGIN, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    _, n1 = uv_charts(bm)
    bm.free()
    return {"smart_islands": n0, "charts": n1, "fallback_charts": redone, "flipped_faces": flipped,
            "flipped_ratio": round(flipped / max(1, len(obj.data.polygons)), 4)}


UV_MARGIN = 0.004  # 打包边距（按岛缩放），两种展开方案一致，比较才公平


def texel_density(obj) -> float:
    """面积加权的平均线性纹素密度（UV 单位 / 米）：比 UV 利用率更直接反映贴图清晰度。"""
    me = obj.data
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 3, 2)
    co = mesh_verts(obj)
    idx = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", idx)
    tri = co[idx.reshape(-1, 3)]
    a3 = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) / 2
    au = np.abs((uv[:, 1, 0] - uv[:, 0, 0]) * (uv[:, 2, 1] - uv[:, 0, 1]) - (uv[:, 2, 0] - uv[:, 0, 0]) * (uv[:, 1, 1] - uv[:, 0, 1])) / 2
    ok = a3 > 1e-12
    return float((np.sqrt(au[ok] / a3[ok]) * a3[ok]).sum() / max(a3[ok].sum(), 1e-12))


def unwrap_best(obj, tex_size: int) -> dict:
    """两种展开方案都做，保留平均纹素密度更高的一个：
    A 智能展开直接打包（碎岛少的资产里最紧凑）；B 合并图块后最小拉伸展开（碎岛严重的资产里多出一到两成清晰度，有翻折则淘汰）。"""
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=UV_MARGIN, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    buf_a = np.empty(len(obj.data.loops) * 2, np.float32)
    obj.data.uv_layers.active.data.foreach_get("uv", buf_a)
    dens_a = texel_density(obj)
    info = unwrap_lod0(obj, tex_size)
    dens_b = texel_density(obj)
    use_b = dens_b > dens_a and info["flipped_ratio"] <= 0.005
    if not use_b:
        obj.data.uv_layers.active.data.foreach_set("uv", buf_a)
        obj.data.update()
    return {**info, "method": "merged" if use_b else "smart", "density_smart": round(dens_a, 4), "density_merged": round(dens_b, 4)}


base_name = P["asset_id"]
lod0 = decimate_copy(hp, f"{base_name}_LOD0", lod_tris[0])
RESULT["uv"] = unwrap_best(lod0, P["texture"])
_u = RESULT["uv"]
log(f"UV：智能展开 {_u['smart_islands']} 个小岛 / 合并后 {_u['charts']} 个图块（翻折 {_u['flipped_faces']}）；"
    f"纹素密度 {_u['density_smart']} / {_u['density_merged']} → 采用{'合并图块' if _u['method'] == 'merged' else '智能展开'}")
lod0.data.uv_layers[0].name = "UVMap"
step("低模与 UV", t)

# ───────────────────────────── 4. 投影着色（高模顶点上）─────────────────────────────
t = time.time()
me = hp.data
V = mesh_verts(hp)
N = np.empty(len(V) * 3, np.float32)
me.vertices.foreach_get("normal", N)
N = N.reshape(-1, 3).astype(np.float64)
bvh = BVHTree.FromObject(hp, bpy.context.evaluated_depsgraph_get())
k_sharp = P["projection_sharpness"]
trust = {"front": 1.0, "back": 0.9, "left": 0.8, "right": 0.8}
height = float(V[:, 2].max() - V[:, 2].min())  # 包围盒高度（挂件原点在挂点，z 可能为负）
eps = height * 2e-3

images = {}
W = np.zeros((len(V), 4))
cols = np.zeros((len(V), 3))
matid = P.get("matid_views")
mcols = np.zeros(len(V)) if matid else None
emid = P.get("emid_views")  # 发光分区（自发光遮罩，白 = 会发光的细节）
ecols = np.zeros(len(V)) if emid else None
for i, v in enumerate(VIEW_ORDER):
    vp = VP[v]
    rgba = load_mask_rgba(P["concept_views"][v])
    images[v] = rgba
    mask = load_mask_rgba(matid[v]) if matid else None
    emask = load_mask_rgba(emid[v]) if emid else None
    d = np.array(vp["dir"])
    facing = np.clip(N @ -d, 0, 1) ** k_sharp
    xy = project(vp, V)
    xi = np.clip(xy[:, 0].astype(int), 0, vp["px_w"] - 1)
    yi = np.clip(xy[:, 1].astype(int), 0, vp["px_h"] - 1)
    alpha = rgba[yi, xi, 3]
    cand = np.nonzero((facing > 1e-3) & (alpha > 0.5))[0]
    vis = np.zeros(len(V), bool)
    toward = Vector(-d)
    for j in cand:
        o = Vector(V[j] + N[j] * eps + (-d) * eps)
        hit = bvh.ray_cast(o, toward)
        vis[j] = hit[0] is None
    W[:, i] = vis * facing * alpha * trust[v]
    srgb = rgba[yi, xi, :3]  # image.pixels 是 sRGB 编码值；着色器里的贴图采样是线性值，补色要在线性空间算
    lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    cols += W[:, i:i + 1] * lin
    if mask is not None:  # 金属遮罩（白 = 金属）；遮罩剪影外按非金属
        mcols += W[:, i] * mask[yi, xi, :3].mean(-1) * (mask[yi, xi, 3] > 0.5)
    if emask is not None:  # 自发光遮罩（白 = 发光）；剪影外按不发光
        ecols += W[:, i] * emask[yi, xi, :3].mean(-1) * (emask[yi, xi, 3] > 0.5)
    log(f"投影 {v}：可见顶点 {vis.sum()}/{len(V)}")

wsum = W.sum(1)
known = wsum > 0.05
cols[known] /= wsum[known, None]
# 看不到的顶点：沿网格边扩散补色（已知顶点固定）
e = np.empty(len(me.edges) * 2, np.int64)
me.edges.foreach_get("vertices", e)
e = e.reshape(-1, 2)
a_, b_ = np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]])
deg = np.bincount(a_, minlength=len(V)).astype(np.float64)


def diffuse(values: np.ndarray) -> np.ndarray:
    out = values.copy()
    out[~known] = values[known].mean(0)
    for _ in range(400):
        acc = np.stack([np.bincount(a_, weights=out[b_, c], minlength=len(V)) for c in range(out.shape[1])], 1)
        out[~known] = (acc / np.maximum(deg, 1)[:, None])[~known]
    return out


fill = diffuse(cols)
fill_m = None
if matid:
    mcols[known] /= wsum[known]
    fill_m = diffuse(mcols[:, None])[:, 0]
fill_e = None
if emid:
    ecols[known] /= wsum[known]
    fill_e = diffuse(ecols[:, None])[:, 0]
RESULT["projection"] = {"uncovered_ratio": round(float((~known).mean()), 4)}
log(f"投影覆盖率 {known.mean():.1%}（其余 {(~known).sum()} 个顶点扩散补色）")

# 写入顶点属性 + 投影 UV
attrs = [("proj_w", W), ("proj_fill", np.concatenate([fill, np.ones((len(V), 1))], 1))]
if fill_m is not None:
    attrs.append(("proj_fill_m", np.stack([fill_m, fill_m, fill_m, np.ones_like(fill_m)], 1)))
if fill_e is not None:
    attrs.append(("proj_fill_e", np.stack([fill_e, fill_e, fill_e, np.ones_like(fill_e)], 1)))
for name, data in attrs:
    attr = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", data.astype(np.float32).ravel())
loops = np.empty(len(me.loops), np.int64)
me.loops.foreach_get("vertex_index", loops)
for v in VIEW_ORDER:
    vp = VP[v]
    xy = project(vp, V[loops])
    uv = np.stack([xy[:, 0] / vp["px_w"], 1 - xy[:, 1] / vp["px_h"]], 1)
    layer = me.uv_layers.new(name=f"proj_{v}")
    layer.data.foreach_set("uv", uv.astype(np.float32).ravel())

# 投影材质（只用于烘焙）
mat = bpy.data.materials.new("M_ProjectionBake")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
emit = nt.nodes.new("ShaderNodeEmission")
nt.links.new(emit.outputs[0], out.inputs["Surface"])
wattr = nt.nodes.new("ShaderNodeAttribute")
wattr.attribute_name = "proj_w"
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(wattr.outputs["Color"], sep.inputs[0])
w_out = [sep.outputs[0], sep.outputs[1], sep.outputs[2], wattr.outputs["Alpha"]]
fattr = nt.nodes.new("ShaderNodeAttribute")
fattr.attribute_name = "proj_fill"
EPS_FILL = 0.05
acc_col = None
acc_w = None
tex_nodes = {}
for i, v in enumerate(VIEW_ORDER):
    img = bpy.data.images.load(P["concept_views"][v], check_existing=False)
    img.colorspace_settings.name = "sRGB"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex_nodes[v] = tex
    tex.extension = "CLIP"
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = f"proj_{v}"
    nt.links.new(uvn.outputs[0], tex.inputs["Vector"])
    scl = nt.nodes.new("ShaderNodeVectorMath")
    scl.operation = "SCALE"
    nt.links.new(tex.outputs["Color"], scl.inputs[0])
    nt.links.new(w_out[i], scl.inputs["Scale"])
    if acc_col is None:
        acc_col, acc_w = scl.outputs[0], w_out[i]
    else:
        add = nt.nodes.new("ShaderNodeVectorMath")
        add.operation = "ADD"
        nt.links.new(acc_col, add.inputs[0])
        nt.links.new(scl.outputs[0], add.inputs[1])
        acc_col = add.outputs[0]
        addw = nt.nodes.new("ShaderNodeMath")
        addw.operation = "ADD"
        nt.links.new(acc_w, addw.inputs[0])
        nt.links.new(w_out[i], addw.inputs[1])
        acc_w = addw.outputs[0]
fs = nt.nodes.new("ShaderNodeVectorMath")
fs.operation = "SCALE"
fs.inputs["Scale"].default_value = EPS_FILL
nt.links.new(fattr.outputs["Color"], fs.inputs[0])
add = nt.nodes.new("ShaderNodeVectorMath")
add.operation = "ADD"
nt.links.new(acc_col, add.inputs[0])
nt.links.new(fs.outputs[0], add.inputs[1])
den = nt.nodes.new("ShaderNodeMath")
den.operation = "ADD"
den.inputs[1].default_value = EPS_FILL
nt.links.new(acc_w, den.inputs[0])
inv = nt.nodes.new("ShaderNodeMath")
inv.operation = "DIVIDE"
inv.inputs[0].default_value = 1.0
nt.links.new(den.outputs[0], inv.inputs[1])
norm = nt.nodes.new("ShaderNodeVectorMath")
norm.operation = "SCALE"
nt.links.new(add.outputs[0], norm.inputs[0])
nt.links.new(inv.outputs[0], norm.inputs["Scale"])
nt.links.new(norm.outputs[0], emit.inputs["Color"])
hp.data.materials.clear()
hp.data.materials.append(mat)
step("投影着色", t)

# ───────────────────────────── 5. 烘焙 ─────────────────────────────
t = time.time()
sc = bpy.context.scene
sc.render.engine = "CYCLES"
dev = "CPU"
if P.get("bake_device", "GPU") == "GPU":
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == backend]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == backend
                sc.cycles.device = "GPU"
                dev = backend
                break
        except TypeError:
            continue
log(f"烘焙设备 {dev}")
RESULT["bake_device"] = dev
sc.world = bpy.data.worlds.new("World")
sc.world.light_settings.distance = height * 0.12
sc.cycles.samples = 1
size = P["texture"]
tex_dir = Path(P["texture_dir"])
tex_dir.mkdir(parents=True, exist_ok=True)
tex_base = P["texture_basename"]


def new_image(name: str, color_space: str, alpha=False):
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = color_space
    return img


lp_mat = bpy.data.materials.new(f"M_{base_name.split('_', 1)[1]}")
lp_mat.use_nodes = True
lp_nt = lp_mat.node_tree
lod0.data.materials.clear()
lod0.data.materials.append(lp_mat)
bake_node = lp_nt.nodes.new("ShaderNodeTexImage")
lp_nt.nodes.active = bake_node

cage = height * P["cage_extrusion"]
margin = P["bake_margin_px"]


def bake(kind: str, img, **kw) -> None:
    bake_node.image = img
    activate(lod0, [hp])
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=cage, max_ray_distance=cage * 4,
                        margin=margin, margin_type="EXTEND", target="IMAGE_TEXTURES", **kw)


img_bc = new_image(f"{tex_base}_BC", "sRGB")
bake("EMIT", img_bc)
img_metal = None
if matid:  # 同一套投影，把四张概念图换成四张金属遮罩再烘一次
    for v, node in tex_nodes.items():
        mimg = bpy.data.images.load(matid[v], check_existing=False)
        mimg.colorspace_settings.name = "Non-Color"
        node.image = mimg
    fattr.attribute_name = "proj_fill_m"
    img_metal = new_image(f"{tex_base}_MetalMask", "Non-Color")
    bake("EMIT", img_metal)
img_emit = None
if emid:  # 同一套投影烘自发光遮罩，再锐化成近似二值（投影插值会把细纹路糊开）
    for v, node in tex_nodes.items():
        eimg = bpy.data.images.load(emid[v], check_existing=False)
        eimg.colorspace_settings.name = "Non-Color"
        node.image = eimg
    fattr.attribute_name = "proj_fill_e"
    img_emit = new_image(f"{tex_base}_E", "Non-Color")
    bake("EMIT", img_emit)
    px = np.empty(size * size * 4, np.float32)
    img_emit.pixels.foreach_get(px)
    e_ = np.clip((px.reshape(-1, 4)[:, 0] - 0.3) / 0.4, 0, 1)
    img_emit.pixels.foreach_set(np.stack([e_, e_, e_, np.ones_like(e_)], 1).ravel())
    RESULT["emissive_id"] = {"emissive_texel_ratio": round(float((e_ > 0.5).mean()), 4)}
img_n = new_image(f"{tex_base}_N", "Non-Color")
bake("NORMAL", img_n, normal_space="TANGENT")
sc.cycles.samples = P["ao_samples"]
img_ao = new_image(f"{tex_base}_AO", "Non-Color")
bake("AO", img_ao)
sc.cycles.samples = 1

# ORM 打包
ao = np.empty(size * size * 4, np.float32)
img_ao.pixels.foreach_get(ao)
ao = ao.reshape(-1, 4)[:, 0]
img_orm = new_image(f"{tex_base}_ORM", "Non-Color")
if img_metal is not None:
    # 材质分区：金属区金属度 metal_value、粗糙度 metal_roughness；非金属区金属度 0、粗糙度 roughness；边界平滑过渡
    mm = np.empty(size * size * 4, np.float32)
    img_metal.pixels.foreach_get(mm)
    m = np.clip((mm.reshape(-1, 4)[:, 0] - 0.25) / 0.5, 0, 1)
    rough = P["roughness"] + (P["metal_roughness"] - P["roughness"]) * m
    orm = np.stack([ao, rough, m * P["metal_value"], np.ones_like(ao)], 1)
    RESULT["material_id"] = {"metal_texel_ratio": round(float((m > 0.5).mean()), 4)}
else:
    orm = np.stack([ao, np.full_like(ao, P["roughness"]), np.full_like(ao, P["metallic"]), np.ones_like(ao)], 1)
img_orm.pixels.foreach_set(orm.ravel())
for img in [i for i in (img_bc, img_n, img_orm, img_metal, img_emit) if i is not None]:
    img.filepath_raw = str(tex_dir / f"{img.name}.png")
    img.file_format = "PNG"
    img.save()
bpy.data.images.remove(img_ao)
RESULT["textures"] = {img.name: {"size": size, "colorspace": img.colorspace_settings.name} for img in (img_bc, img_n, img_orm)}
step("烘焙", t)

# 低模正式材质：glTF 可识别的 PBR 节点结构
lp_nt.nodes.clear()
o_ = lp_nt.nodes.new("ShaderNodeOutputMaterial")
bsdf = lp_nt.nodes.new("ShaderNodeBsdfPrincipled")
lp_nt.links.new(bsdf.outputs[0], o_.inputs["Surface"])
t_bc = lp_nt.nodes.new("ShaderNodeTexImage")
t_bc.image = img_bc
lp_nt.links.new(t_bc.outputs["Color"], bsdf.inputs["Base Color"])
t_n = lp_nt.nodes.new("ShaderNodeTexImage")
t_n.image = img_n
nmap = lp_nt.nodes.new("ShaderNodeNormalMap")
lp_nt.links.new(t_n.outputs["Color"], nmap.inputs["Color"])
lp_nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
t_orm = lp_nt.nodes.new("ShaderNodeTexImage")
t_orm.image = img_orm
sep = lp_nt.nodes.new("ShaderNodeSeparateColor")
lp_nt.links.new(t_orm.outputs["Color"], sep.inputs[0])
lp_nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
lp_nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
gnode = lp_nt.nodes.new("ShaderNodeGroup")
gnode.node_tree = grp
lp_nt.links.new(sep.outputs[0], gnode.inputs["Occlusion"])
if img_emit is not None:
    # 自发光遮罩 → glTF emissiveTexture（emissiveFactor = 1）；运行时按实例改自发光颜色和强度
    t_e = lp_nt.nodes.new("ShaderNodeTexImage")
    t_e.image = img_emit
    lp_nt.links.new(t_e.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0

# ───────────────────────────── 6. LOD ─────────────────────────────
t = time.time()
lods = [lod0]
for i, tris in enumerate(lod_tris[1:], start=1):
    lods.append(decimate_copy(lod0, f"{base_name}_LOD{i}", tris))
    lods[-1].data.materials.clear()
    lods[-1].data.materials.append(lp_mat)
step("LOD", t)

# 按展示姿态（最长轴竖直）渲染和对齐的资产（静态挂件、枪）：转回模型 / 挂点的局部空间。
# 必须在骨骼与蒙皮之前：部件骨架按白模关节（模型空间）建骨、按白模部件分段
presentation = views.get("presentation")
if presentation:
    back = Matrix(presentation).transposed().to_4x4()
    for lod in lods:
        lod.data.transform(back)
        lod.data.update()
    RESULT["presentation"] = presentation

# ───────────────────────────── 7. 骨骼与蒙皮 ─────────────────────────────
arm_obj = None
if P["kind"] == "skeletal" and P.get("rig_mode") == "parts":
    # ── 通用部件骨架：骨骼 = 白模的每个节点；权重 = 离哪个白模实体部件最近（部件包围盒当影响体积）──
    t = time.time()
    bo = json.loads(Path(P["blockout_json"]).read_text(encoding="utf-8"))

    def g2b(p):  # 游戏 / glTF（Y 上，+Z 前）→ Blender（Z 上，−Y 前）
        return Vector((p[0], -p[2], p[1]))

    joints = {j["name"]: j for j in bo["joints"]}
    lo_b, hi_b = np.array(bo["bounds"]["min"]), np.array(bo["bounds"]["max"])
    asset_size = float((hi_b - lo_b).max())
    arm = bpy.data.armatures.new("Skeleton")
    arm_obj = bpy.data.objects.new(f"{base_name}_Skeleton", arm)
    sc.collection.objects.link(arm_obj)
    activate(arm_obj)
    bpy.ops.object.mode_set(mode="EDIT")
    ebones = {}
    for name, j in joints.items():
        b = arm.edit_bones.new(name)
        b.head = g2b(j["bindPosition"])
        b.tail = b.head + Vector((0, 0, max(0.02, asset_size * 0.03)))
        b.use_deform = True
        ebones[name] = b
    for name, j in joints.items():
        if j["parent"] in ebones:
            ebones[name].parent = ebones[j["parent"]]
    bpy.ops.object.mode_set(mode="OBJECT")

    # 白模实体部件 → (所属节点, 世界矩阵, 局部包围盒)
    before = set(bpy.data.objects)
    imported = import_glb(P["blockout_glb"])
    vols = []
    for o in imported:
        if o.type == "MESH" and o.get("role") == "body" and o.get("joint") in joints:
            bb = np.array([list(c) for c in o.bound_box])
            vols.append((o["joint"], np.array(o.matrix_world), bb.min(0), bb.max(0)))
    for o in [o for o in bpy.data.objects if o not in before]:
        bpy.data.objects.remove(o)
    names = list(joints.keys())
    jidx = {n: i for i, n in enumerate(names)}
    sigma = asset_size * P.get("rig_sigma", 0.015)
    log(f"部件骨架：{len(names)} 个节点，{len(vols)} 个影响体积，过渡带 σ = {sigma:.3f} m")

    def part_distance(pts: np.ndarray) -> np.ndarray:
        """每个点到各关节所属影响体积（白模部件包围盒）的最近距离，(点数, 关节数)。"""
        D = np.full((len(pts), len(names)), np.inf)
        for joint, M, bmin, bmax in vols:
            Mi = np.linalg.inv(M)
            local = pts @ Mi[:3, :3].T + Mi[:3, 3]
            world = np.clip(local, bmin, bmax) @ M[:3, :3].T + M[:3, 3]
            k = jidx[joint]
            D[:, k] = np.minimum(D[:, k], np.linalg.norm(world - pts, axis=1))
        return D

    # 哪些部件之间可以平滑过渡：父子关节（肩↔上臂、肘、腕），或共同父关节自身没有实体部件的兄弟关节（纯枢轴下的躯干↔胯 = 腰）。
    # 其余部件（垂在腰侧的前臂和躯干之间隔着肘和肩、垂在胯边的拳头和胯、斗篷和腿）在绑定姿势里贴在一起被高模熔成一体时，
    # 任何权重都会在招式里拉出长条，所以把网格沿它们的交界切开、封口，各自刚性跟随（硬表面 / 石像角色的常规做法）
    has_vol = {j for j, *_ in vols}
    near = np.eye(len(names), dtype=bool)
    for a in names:
        pa = joints[a]["parent"]
        if pa in jidx:
            near[jidx[a], jidx[pa]] = near[jidx[pa], jidx[a]] = True
        for b in names:
            if a != b and pa is not None and joints[b]["parent"] == pa and pa not in has_vol:
                near[jidx[a], jidx[b]] = True
    # 过渡模式里指定刚性的关节（rig_rigid_joints，按 rig 字段名）：与父关节、兄弟关节的交界也切开，整段绕关节转。
    # 用于转角极大的关节（主母举臂约 160°，线性混合蒙皮在肩部必然拉长；切口藏在护肩下面）
    for f in P.get("rig_rigid_joints") or []:
        j = (bo.get("fields") or {}).get(f)
        if j not in jidx:
            raise SystemExit(f"rig_rigid_joints 里的 {f} 不是 rig 字段（白模说明没有 fields 映射或字段名错）")
        pj = joints[j]["parent"]
        for b in names:
            if b != j and (b == pj or joints[b]["parent"] == pj):  # 父关节与兄弟关节；和子关节（肘以下）照常过渡
                near[jidx[j], jidx[b]] = near[jidx[b], jidx[j]] = False

    rigid = bool(P.get("rig_rigid", False))

    def split_parts(lod, budget: int) -> dict:
        """按部件切开网格并封口。刚体模式：所有部件交界都切开；过渡模式：只切开不相邻部件的交界。
        每个面所属的部件记在面属性 part 里（封口面继承相邻外表面的部件），蒙皮阶段直接读它，不再按面中心重新判定
        （封口面的中心常常离对侧部件更近，重新判定会把边界顶点判给对侧，留下长条）。超出面数预算时微量减面。"""
        bm = bmesh.new()
        bm.from_mesh(lod.data)
        bm.faces.ensure_lookup_table()
        cen = np.array([list(f.calc_center_median()) for f in bm.faces])
        fdom = part_distance(cen).argmin(1)
        # 分段清理：① 标签平滑（多数边邻面属于另一个部件就改过去，消掉锯齿边界）；
        # ② 小碎块并回周边部件（比如胯侧被判给拳头的零星面片，否则会跟着拳头飞走、在胯上留洞）
        nb = [[g.index for e in f.edges for g in e.link_faces if g is not f] for f in bm.faces]
        for _ in range(3):
            changed = 0
            for i, ns in enumerate(nb):
                if not ns:
                    continue
                vals, cnt = np.unique(fdom[ns], return_counts=True)
                k = cnt.argmax()
                if vals[k] != fdom[i] and cnt[k] * 2 > len(ns):
                    fdom[i] = vals[k]
                    changed += 1
            if not changed:
                break
        total = np.bincount(fdom, minlength=len(names))
        seen = np.zeros(len(fdom), bool)
        merged = 0
        for s in range(len(fdom)):
            if seen[s]:
                continue
            comp, stack, seen[s] = [], [s], True
            while stack:
                i = stack.pop()
                comp.append(i)
                for j in nb[i]:
                    if not seen[j] and fdom[j] == fdom[s]:
                        seen[j] = True
                        stack.append(j)
            if len(comp) < max(12, 0.05 * total[fdom[s]]):
                border = [fdom[j] for i in comp for j in nb[i] if fdom[j] != fdom[s]]
                if border:
                    fdom[comp] = np.bincount(border).argmax()
                    merged += len(comp)
        layer = bm.faces.layers.int.get("part") or bm.faces.layers.int.new("part")
        for f in bm.faces:
            f[layer] = int(fdom[f.index])

        def separate(a: int, b: int) -> bool:
            return a != b if rigid else not near[a, b]

        cut = [e for e in bm.edges if len(e.link_faces) == 2
               and separate(e.link_faces[0][layer], e.link_faces[1][layer])]
        stats = {"cut_edges": len(cut), "cap_tris": 0, "merged_fragment_faces": int(merged)}
        if cut:
            uv = bm.loops.layers.uv.active
            # 切开前记下每个位置的一组 UV，封口面沿用边界顶点的 UV（封口在绑定姿势里藏在相邻部件里面，只在关节转开时露出，取周边颜色即可）
            pos_uv = {}
            for f in bm.faces:
                for l in f.loops:
                    pos_uv.setdefault(tuple(np.round(list(l.vert.co), 6)), l[uv].uv.copy())
            bmesh.ops.split_edges(bm, edges=cut)
            boundary = [e for e in bm.edges if e.is_boundary]
            new = bmesh.ops.holes_fill(bm, edges=boundary, sides=0).get("faces", [])
            if new:
                caps = bmesh.ops.triangulate(bm, faces=new, quad_method="BEAUTY", ngon_method="BEAUTY").get("faces", new)
                capset = set(caps)
                # 每个封口整块用一个代表色：取边缘顶点里固有色亮度居中的那个 UV（沿边缘插值会拉出一条条杂色）
                px = np.asarray(img_bc.pixels[:], np.float32).reshape(img_bc.size[1], img_bc.size[0], 4)

                def lum(u) -> float:
                    x = min(img_bc.size[0] - 1, max(0, int(u[0] % 1.0 * img_bc.size[0])))
                    y = min(img_bc.size[1] - 1, max(0, int(u[1] % 1.0 * img_bc.size[1])))
                    return float(px[y, x, :3] @ np.array([0.299, 0.587, 0.114]))

                cap_seen = set()
                for f0 in caps:
                    if f0 in cap_seen:
                        continue
                    region, stack = [], [f0]
                    cap_seen.add(f0)
                    while stack:
                        f = stack.pop()
                        region.append(f)
                        for e in f.edges:
                            for g in e.link_faces:
                                if g in capset and g not in cap_seen:
                                    cap_seen.add(g)
                                    stack.append(g)
                    rim = [pos_uv[k] for f in region for v in f.verts
                           if (k := tuple(np.round(list(v.co), 6))) in pos_uv]
                    if not rim:
                        continue
                    pick = sorted(rim, key=lum)[len(rim) // 2]
                    for f in region:
                        for l in f.loops:
                            l[uv].uv = pick
                # 封口面的部件 = 与它共顶点的外表面里最多的部件（一个封口只属于切开后的一侧）
                for f in caps:
                    votes = {}
                    for v in f.verts:
                        for g in v.link_faces:
                            if g not in capset:
                                votes[g[layer]] = votes.get(g[layer], 0) + 1
                    if votes:
                        f[layer] = max(votes, key=votes.get)
                stats["cap_tris"] = len(caps)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(lod.data)
        bm.free()
        lod.data.update()
        tris = sum(len(p.vertices) - 2 for p in lod.data.polygons)
        if tris > budget:
            mod = lod.modifiers.new("fit_budget", "DECIMATE")
            mod.ratio = (budget - 4) / tris
            activate(lod)
            bpy.ops.object.modifier_apply(modifier=mod.name)
        stats["tris"] = sum(len(p.vertices) - 2 for p in lod.data.polygons)
        return stats

    skin_stats, split_stats = {}, {}
    for lod, budget in zip(lods, lod_tris):
        split_stats[lod.name] = split_parts(lod, budget)
        activate(arm_obj, [lod])
        bpy.context.view_layer.objects.active = arm_obj
        bpy.ops.object.parent_set(type="ARMATURE_NAME")  # 建好以骨骼命名的空顶点组 + Armature 修改器
        co = mesh_verts(lod)
        D = part_distance(co)
        # 顶点的归属部件 = 所在面（切分阶段记下的 part 属性）里最多的部件；刚体模式 100% 跟随它，
        # 过渡模式只在与它相邻的关节之间分权重（切开后两侧顶点各归各的部件）
        me = lod.data
        attr = me.attributes.get("part")
        if attr is not None and len(attr.data) == len(me.polygons):
            fdom = np.array([d.value for d in attr.data])
        else:
            fdom = part_distance(np.array([list(p.center) for p in me.polygons])).argmin(1)
        votes = np.zeros((len(co), len(names)), np.int32)
        for p, d in zip(me.polygons, fdom):
            votes[list(p.vertices), d] += 1
        home = np.where(votes.sum(1) > 0, votes.argmax(1), D.argmin(1))
        if rigid:
            D = np.where(np.arange(len(names))[None, :] == home[:, None], 0.0, np.inf)
        else:
            D = np.where(near[home], D, np.inf)
        dmin = D.min(1, keepdims=True)
        w = np.exp(-(D - dmin) / sigma)
        w[(D - dmin) > 4 * sigma] = 0
        top = np.argsort(-w, axis=1)[:, :P["max_bone_influences"]]
        groups = {n: lod.vertex_groups.get(n) or lod.vertex_groups.new(name=n) for n in names}
        rows = np.arange(len(co))
        tw = w[rows[:, None], top]
        tw = tw / np.maximum(tw.sum(1, keepdims=True), 1e-9)
        # 按骨骼批量写权重（同一权重值的顶点一次 add，避免逐顶点调用）
        for slot in range(top.shape[1]):
            for k in np.unique(top[:, slot]):
                sel = (top[:, slot] == k) & (tw[:, slot] > 0.01)
                if not sel.any():
                    continue
                vg = groups[names[k]]
                for val in np.unique(np.round(tw[sel, slot], 3)):
                    ids = np.nonzero(sel & (np.round(tw[:, slot], 3) == val))[0].tolist()
                    vg.add(ids, float(val), "REPLACE")
        activate(lod)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        unweighted = sum(1 for v in lod.data.vertices if not v.groups)
        skin_stats[lod.name] = {"heat_failed_verts": 0, "max_influences": int(max((len(v.groups) for v in lod.data.vertices), default=0)),
                                "unweighted_verts": unweighted, "weights_from": "parts"}
    RESULT["skin"] = {"bones": names, "per_lod": skin_stats, "mode": "parts", "sigma_m": round(sigma, 4),
                      "rigid": rigid, "split": split_stats}
    s0 = split_stats[lods[0].name]
    log(f"{'刚体分段' if rigid else '不相邻部件切分'}：LOD0 切开 {s0['cut_edges']} 条边，封口 {s0['cap_tris']} 个三角面，并回碎块 {s0['merged_fragment_faces']} 个面")
    step("部件骨架蒙皮", t)
elif P["kind"] == "skeletal":
    t = time.time()
    bo = json.loads(Path(P["blockout_json"]).read_text(encoding="utf-8"))

    def g2b(p):  # 游戏 / glTF（Y 上，+Z 前）→ Blender（Z 上，−Y 前）
        return Vector((p[0], -p[2], p[1]))

    joints = {j["name"]: j for j in bo["joints"]}
    children = {n: [c for c, j in joints.items() if j["parent"] == n] for n in joints}
    pos_b = {n: g2b(j["bindPosition"]) for n, j in joints.items()}
    pc_b = {n: (g2b(j["partCenter"]) if j.get("partCenter") else None) for n, j in joints.items()}

    # 骨骼适配网格：概念图的手臂常比白模的 A-pose 更贴身。在高模的正面投影里逐行找「与躯干之间有空隙的最外侧一段」
    # 作为手臂截面，取前臂区段截面中心的质心，算它相对肩关节的外展角，按实测角度摆手臂骨；运行时按同一角度绑定。
    base_spread = bo.get("bindPose", {}).get("armSpread", 0.45)

    def mesh_arm_angle(side, sh, el, hd):
        res = 0.006
        sel = (V[:, 2] > hd.z - 0.05) & (V[:, 2] < el.z)
        if sel.sum() < 200:
            return None
        xi = np.round(V[sel, 0] / res).astype(np.int64)
        zi = np.round(V[sel, 2] / res).astype(np.int64)
        x0, z0 = xi.min(), zi.min()
        grid = np.zeros((zi.max() - z0 + 1, xi.max() - x0 + 1), bool)
        grid[zi - z0, xi - x0] = True
        grid = grid | np.roll(grid, 1, 1) | np.roll(grid, -1, 1) | np.roll(grid, 1, 0) | np.roll(grid, -1, 0)
        centers = []
        for r in range(grid.shape[0]):
            d = np.diff(np.concatenate([[0], grid[r].astype(np.int8), [0]]))
            runs = list(zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]))
            merged = []
            for s, e in runs:  # 小于 3 格的缝当作点阵空洞，合并
                if merged and s - merged[-1][1] < 3:
                    merged[-1][1] = e
                else:
                    merged.append([s, e])
            if len(merged) < 2:
                continue  # 这一行手臂贴着躯干，没有空隙
            spans = [((s + x0) * res, (e - 1 + x0) * res) for s, e in merged]
            outer = max(spans, key=lambda sp: (sp[0] + sp[1]) / 2 * side)
            if min(outer[0] * side, outer[1] * side) > 0:  # 最外侧一段完全在这一侧，才是手臂
                centers.append(((outer[0] + outer[1]) / 2, (r + z0) * res))
        if len(centers) < 6:
            return None
        c = np.array(centers).mean(0)
        return math.atan2(abs(c[0] - sh.x), sh.z - c[1])

    bind_spread = {}
    for side, (a_n, e_n, h_n) in ((1, ("armL", "elbowL", "handL")), (-1, ("armR", "elbowR", "handR"))):
        sh = pos_b[a_n]
        theta = mesh_arm_angle(side, sh, pos_b[e_n], pos_b[h_n])
        delta = 0.0 if theta is None else max(-0.35, min(0.25, theta - base_spread))
        if abs(delta) < 0.03:
            delta = 0.0
        if delta:
            rot = Matrix.Rotation(-side * delta, 3, "Y")
            for n in (a_n, e_n, h_n):
                pos_b[n] = sh + rot @ (pos_b[n] - sh)
                if pc_b[n] is not None:
                    pc_b[n] = sh + rot @ (pc_b[n] - sh)
        bind_spread[a_n] = round(base_spread + delta, 4)
        log(f"骨骼适配 {a_n}：网格外展角 {'—' if theta is None else f'{theta:.3f}'}，绑定角 {bind_spread[a_n]:.3f}（白模 {base_spread}）")
    RESULT["bind_pose"] = {"armSpreadL": bind_spread["armL"], "armSpreadR": bind_spread["armR"], "base": base_spread}

    arm = bpy.data.armatures.new("Skeleton")
    arm_obj = bpy.data.objects.new(f"{base_name}_Skeleton", arm)
    sc.collection.objects.link(arm_obj)
    activate(arm_obj)
    bpy.ops.object.mode_set(mode="EDIT")
    ebones = {}
    for name, j in joints.items():
        head = pos_b[name]
        if pc_b[name] is not None:
            tail = head + (pc_b[name] - head) * 2.0
        elif len(children[name]) == 1:
            tail = pos_b[children[name][0]]
        else:
            tail = head + Vector((0, 0, 0.1))
        if (tail - head).length < 0.05:
            tail = head + (tail - head).normalized() * 0.05 if (tail - head).length > 1e-6 else head + Vector((0, 0, 0.05))
        b = arm.edit_bones.new(name)
        b.head, b.tail = head, tail
        b.use_deform = True
        ebones[name] = b
    for name, j in joints.items():
        if j["parent"]:
            ebones[name].parent = ebones[j["parent"]]
            ebones[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    def heat_failed(o):
        return [v.index for v in o.data.vertices if not v.groups or sum(g.weight for g in v.groups) < 1e-4]

    # 第一遍：每级 LOD 都跑 bone heat（自动权重）
    failed = {}
    for lod in lods:
        activate(arm_obj, [lod])
        bpy.context.view_layer.objects.active = arm_obj
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        failed[lod.name] = heat_failed(lod)
    # 第二遍：bone heat 大面积失败的 LOD，从求解成功的 LOD（代理网格）插值传递权重
    ratio = {l.name: len(failed[l.name]) / max(1, len(l.data.vertices)) for l in lods}
    source = min(lods, key=lambda l: ratio[l.name])
    transferred = []
    if ratio[source.name] < 0.01:
        for lod in lods:
            if lod is source or ratio[lod.name] <= 0.05:
                continue
            activate(lod)
            dt = lod.modifiers.new("weights_from_proxy", "DATA_TRANSFER")
            dt.object = source
            dt.use_vert_data = True
            dt.data_types_verts = {"VGROUP_WEIGHTS"}
            dt.vert_mapping = "POLYINTERP_NEAREST"
            dt.layers_vgroup_select_src = "ALL"
            dt.layers_vgroup_select_dst = "NAME"
            bpy.ops.object.modifier_move_to_index(modifier=dt.name, index=0)
            bpy.ops.object.modifier_apply(modifier=dt.name)
            transferred.append(lod.name)
            log(f"{lod.name}: bone heat 失败 {ratio[lod.name]:.0%}，从 {source.name} 传递权重")

    # 刚性头部区域：白模里属于 head 关节的部件（头、头巾、斗笠、头盔角……）的包围盒。
    # 宽帽檐会伸到肩膀上方，bone heat 会把帽檐分一部分给手臂骨，举手时帽子跟着歪；这个区域内的顶点一律 100% 绑头骨。
    head_box = None
    leg_radius = None
    if P.get("blockout_glb"):
        before = set(bpy.data.objects)
        imported = import_glb(P["blockout_glb"])

        def part_box(joint_name):
            ps = [o for o in imported if o.type == "MESH" and o.get("joint") == joint_name and o.get("role") == "body"]
            if not ps:
                return None
            lo_, hi_ = np.full(3, 1e9), np.full(3, -1e9)
            for o in ps:
                for c in o.bound_box:
                    w_ = np.array(o.matrix_world @ Vector(c))
                    lo_, hi_ = np.minimum(lo_, w_), np.maximum(hi_, w_)
            return lo_, hi_

        hb = part_box("head")
        if hb is not None:
            pad = height * 0.012
            head_box = (hb[0] - pad, hb[1] + pad)
            head_box[0][2] = max(head_box[0][2], pos_b["head"].z - 0.01)  # 只管脖子以上
        lb = part_box("legL")
        if lb is not None:
            leg_radius = float(max(lb[1][0] - lb[0][0], lb[1][1] - lb[0][1]) / 2)
        for o in [o for o in bpy.data.objects if o not in before]:
            bpy.data.objects.remove(o)

    def robe_fix(lod) -> int:
        """裙摆 / 长袍：离腿骨比真实腿部明显更远、权重又主要在腿上的顶点，
        部分权重转给髋骨，其余在左右大腿间平均，袍摆跟随双腿的平均运动而不被撕开。"""
        if leg_radius is None:
            return 0
        legs = [n for n in ("legL", "kneeL", "legR", "kneeR") if lod.vertex_groups.get(n)]
        if len(legs) < 4 or not lod.vertex_groups.get("hips"):
            return 0
        gi = {n: lod.vertex_groups[n].index for n in legs + ["hips"]}
        co = mesh_verts(lod)
        # 整条腿的骨段：大腿（髋→膝）+ 小腿（膝→膝正下方地面）。只量到大腿段会把小腿误判成衣摆
        segs = []
        for a, b in (("legL", "kneeL"), ("legR", "kneeR")):
            segs.append((pos_b[a], pos_b[b]))
            segs.append((pos_b[b], Vector((pos_b[b].x, pos_b[b].y, 0.0))))
        knee_z = min(pos_b["kneeL"].z, pos_b["kneeR"].z)
        thr = leg_radius * 1.5 + 0.02
        hip_z = pos_b["hips"].z
        # 长袍（登记表 garment = "long_robe"）：袍子盖住整条腿，从脚踝到髋部整体按「髋骨 + 左右平均」绑定，
        # 袍内的腿不再单独大幅摆动、从袍子里戳出来；脚和袍摆只保留 25% 的腿部运动（施法者式的滑步，
        # 全跟腿走会把袍摆拉成长条）
        long_robe = P.get("garment") == "long_robe"
        ankle_z = pos_b["kneeL"].z * 0.22
        changed = 0
        for v in lod.data.vertices:
            z = co[v.index][2]
            if z > hip_z:
                continue
            w = {g.group: g.weight for g in v.groups}
            leg_w = sum(w.get(gi[n], 0.0) for n in legs)
            if leg_w < (0.3 if long_robe else 0.5):
                continue
            if long_robe:
                k = 0.75 + 0.25 * min(1.0, max(0.0, (z - ankle_z) / 0.06))
            else:
                if z < knee_z - 0.08:  # 短衣摆只到膝盖附近，膝下是小腿本身
                    continue
                p = Vector(co[v.index])
                d = min(((p - a) - (b - a) * max(0.0, min(1.0, (p - a).dot(b - a) / max((b - a).length_squared, 1e-9)))).length
                        for a, b in segs)
                if d <= thr:
                    continue
                k = min(1.0, (d - thr) / 0.08)
            to_hips = leg_w * 0.5 * k
            rest = leg_w - to_hips
            new = {gi["hips"]: w.get(gi["hips"], 0.0) + to_hips}
            # 剩余腿部权重：按原左右比例与 50/50 平均之间插值
            left = sum(w.get(gi[n], 0.0) for n in ("legL", "kneeL"))
            share_l = (left / leg_w) * (1 - k) + 0.5 * k
            new[gi["legL"]] = rest * share_l
            new[gi["legR"]] = rest * (1 - share_l)
            for g in list(v.groups):
                if g.group in gi.values():
                    lod.vertex_groups[g.group].remove([v.index])
            for g_idx, wt in new.items():
                if wt > 1e-3:
                    lod.vertex_groups[g_idx].add([v.index], wt, "ADD")
            changed += 1
        return changed

    def arm_capsule_fix(lod) -> int:
        """手臂影响范围约束：手臂链（上臂 / 前臂 / 手）只能影响离骨段 arm_radius 以内、且在肩关节外侧的顶点，
        超出部分平滑转给躯干（髋部以下转给髋骨）。细躯干角色（骷髅）的两侧肋骨、斗篷离手臂骨比离脊柱近，
        bone heat 会把它们分给手臂，抬手时半边身体跟着翻起来、把手盖住。"""
        R = P.get("arm_radius", 0.14)
        co = mesh_verts(lod)
        gidx = {g.name: g.index for g in lod.vertex_groups}
        torso_g, hips_g = gidx.get("torso"), gidx.get("hips")
        if torso_g is None:
            return 0
        changed = 0
        for side in ("L", "R"):
            chain = [n + side for n in ("arm", "elbow", "hand")]
            ids = {gidx[n] for n in chain if n in gidx}
            S, E, H = (np.array(pos_b[n + side]) for n in ("arm", "elbow", "hand"))
            Hend = H + (H - E) * 0.5  # 手掌 / 手指
            sx = abs(S[0])

            def seg_d(a, b, pts):
                ab = b - a
                t = np.clip(((pts - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
                return np.linalg.norm(pts - (a + t[:, None] * ab), axis=1)

            d = np.minimum(np.minimum(seg_d(S, E, co), seg_d(E, H, co)), seg_d(H, Hend, co))
            f_dist = np.clip(1 - (d - R) / 0.06, 0, 1)
            # 肩关节内侧（靠身体中线）的顶点：越靠内越归躯干；手已经伸到内侧的情况（d 很小）不受影响
            f_med = np.clip((np.abs(co[:, 0]) - (sx - 0.08)) / 0.08, 0, 1)
            f_med = np.maximum(f_med, (d < R * 0.4).astype(float))
            keep = f_dist * f_med
            for v in lod.data.vertices:
                k = keep[v.index]
                if k >= 0.999:
                    continue
                moved = 0.0
                for g in v.groups:
                    if g.group in ids and g.weight > 0:
                        moved += g.weight * (1 - k)
                        g.weight *= k
                if moved > 1e-4:
                    target = torso_g if (hips_g is None or co[v.index][2] > pos_b["hips"].z) else hips_g
                    lod.vertex_groups[target].add([v.index], moved, "ADD")
                    changed += 1
        return changed

    skin_stats = {}
    for lod in lods:
        activate(lod)
        robe = robe_fix(lod)
        RESULT.setdefault("robe_verts", {})[lod.name] = robe
        RESULT.setdefault("arm_capsule_verts", {})[lod.name] = arm_capsule_fix(lod)
        if head_box is not None:
            co_all = mesh_verts(lod)
            inside = np.nonzero(((co_all >= head_box[0]) & (co_all <= head_box[1])).all(1))[0].tolist()
            if inside:
                for vg in lod.vertex_groups:
                    vg.remove(inside)
                (lod.vertex_groups.get("head") or lod.vertex_groups.new(name="head")).add(inside, 1.0, "REPLACE")
            RESULT.setdefault("rigid_head_verts", {})[lod.name] = len(inside)
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=P["max_bone_influences"])
        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        # bone heat 求解失败的顶点：按到各骨段的距离做平滑衰减的邻近权重（前 3 根骨骼、归一化），
        # 而不是硬绑最近骨骼（硬绑在关节处弯曲时会撕裂）
        names = [b.name for b in arm.bones]
        A = np.array([list(b.head_local) for b in arm.bones])
        B = np.array([list(b.tail_local) for b in arm.bones])
        orphans = [v.index for v in lod.data.vertices if not v.groups or sum(g.weight for g in v.groups) < 1e-4]
        if orphans:
            co = mesh_verts(lod)[orphans]
            ab = B - A
            t_ = np.clip(np.einsum("nbk,bk->nb", co[:, None, :] - A[None], ab) / np.maximum((ab ** 2).sum(1), 1e-9), 0, 1)
            dist = np.linalg.norm(co[:, None, :] - (A[None] + t_[..., None] * ab[None]), axis=2)
            sigma = height * 0.025
            w = np.exp(-(dist - dist.min(1, keepdims=True)) / sigma)
            top = np.argsort(-w, axis=1)[:, :3]
            for row, vi in enumerate(orphans):
                v = lod.data.vertices[vi]
                for g in list(v.groups):
                    lod.vertex_groups[g.group].remove([vi])
                ws = w[row, top[row]]
                ws = ws / ws.sum()
                for bi, wt in zip(top[row], ws):
                    if wt < 0.02:
                        continue
                    vg = lod.vertex_groups.get(names[bi]) or lod.vertex_groups.new(name=names[bi])
                    vg.add([vi], float(wt), "REPLACE")
            bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        orphans = [lod.data.vertices[i] for i in orphans]
        max_inf = max((len(v.groups) for v in lod.data.vertices), default=0)
        skin_stats[lod.name] = {"heat_failed_verts": len(orphans), "max_influences": max_inf,
                                "heat_failed_initial": len(failed[lod.name]),
                                "weights_from": source.name if lod.name in transferred else "bone_heat",
                                "unweighted_verts": sum(1 for v in lod.data.vertices if not v.groups)}
        if orphans:
            log(f"{lod.name}: {len(orphans)} 个顶点 bone heat 未覆盖，改用平滑邻近权重")
    # 影响分布：每根骨骼的主导顶点离它自己骨段的距离 p90（手臂骨过大 = 把身体 / 斗篷分给了手臂）
    spread = {}
    lod0 = lods[0]
    co0 = mesh_verts(lod0)
    gname = {g.index: g.name for g in lod0.vertex_groups}
    dom = np.array([gname[max(v.groups, key=lambda g: g.weight).group] if v.groups else "" for v in lod0.data.vertices])
    for b in arm.bones:
        sel = dom == b.name
        if sel.sum() < 5:
            continue
        a_, b_ = np.array(b.head_local), np.array(b.tail_local)
        ab = b_ - a_
        t_ = np.clip(((co0[sel] - a_) @ ab) / max(ab @ ab, 1e-9), 0, 1)
        dd = np.linalg.norm(co0[sel] - (a_ + t_[:, None] * ab), axis=1)
        spread[b.name] = {"verts": int(sel.sum()), "p90_m": round(float(np.percentile(dd, 90)), 3)}
    RESULT["skin"] = {"bones": list(joints.keys()), "per_lod": skin_stats, "spread": spread}
    step("骨骼蒙皮", t)

# ───────────────────────────── 8. 导出 / 保存 / 度量 ─────────────────────────────
t = time.time()
bpy.data.objects.remove(hp)
for o in [o for o in bpy.data.objects if o.type == "MESH" and o not in lods]:
    bpy.data.objects.remove(o)
for img in list(bpy.data.images):
    if img not in (img_bc, img_n, img_orm, img_emit):
        bpy.data.images.remove(img)
bpy.data.materials.remove(mat)
for i, lod in enumerate(lods):
    lod["lod"] = i
    lod["lod_distance"] = P["lod_distance"][i]


lod_metrics = []
for lod in lods:
    me = lod.data
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers["UVMap"].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 3, 2) if len(me.loops) % 3 == 0 else uv.reshape(-1, 2)
    area = 0.0
    if uv.ndim == 3:
        a, b, c = uv[:, 0], uv[:, 1], uv[:, 2]
        area = float(np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])).sum() / 2)
    co = mesh_verts(lod)
    lod_metrics.append({
        "name": lod.name, "tris": sum(len(p.vertices) - 2 for p in me.polygons), "verts": len(me.vertices),
        "uv_min": [float(uv.reshape(-1, 2).min(0)[i]) for i in range(2)], "uv_max": [float(uv.reshape(-1, 2).max(0)[i]) for i in range(2)],
        "uv_utilization": round(area, 3),
        "bbox_min": [round(float(x), 4) for x in co.min(0)], "bbox_max": [round(float(x), 4) for x in co.max(0)],
    })
RESULT["lods"] = lod_metrics

export = Path(P["export_glb"])
export.parent.mkdir(parents=True, exist_ok=True)
activate(lods[0], lods[1:] + ([arm_obj] if arm_obj else []))
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
opts = dict(filepath=str(export), export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_texcoords=True, export_normals=True, export_tangents=P["tangents"], export_materials="EXPORT",
            export_image_format=P["image_format"], export_skins=True, export_all_influences=False,
            export_def_bones=False, export_animations=False, export_morph=False, export_extras=True,
            export_cameras=False, export_lights=False,
            export_draco_mesh_compression_enable=P["draco"], export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14, export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
dropped = [k for k in opts if k not in props]
bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})
if dropped:
    log(f"导出器不支持的参数已忽略：{dropped}")
RESULT["export"] = {"path": str(export), "bytes": export.stat().st_size}

blend = Path(P["blend_path"])
txt = bpy.data.texts.new("README")
txt.write(f"{base_name} 工程文件（由 art/pipeline 生成）。\n高模：{P['highpoly_glb']}\n概念：{json.dumps(P['concept_views'], ensure_ascii=False)}\n")
bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True, relative_remap=True)
RESULT["blend"] = str(blend)
step("导出", t)
RESULT["total_seconds"] = round(time.time() - T0, 1)
finish(P, RESULT)
