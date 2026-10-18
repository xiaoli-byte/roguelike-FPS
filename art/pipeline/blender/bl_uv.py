"""Automatic UV unwrap shared by the game builds (moved from bl_build.py unchanged).

unwrap_best: Smart UV packed as-is vs. small charts merged into neighbours + minimum-stretch unwrap; keeps the one
with the higher average texel density (merged only when it has no flipped faces). bl_build.py uses it for the
Hunyuan LOD0, bl_build_tripo.py for far LODs re-unwrapped away from the provider's fragmented atlas.
"""
import math

import bmesh
import bpy
import numpy as np


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


UV_MARGIN = 0.004  # 打包边距（按岛缩放），两种展开方案一致，比较才公平


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


def unwrap_lod0(obj, tex_size: int, min_frac: float = 0.005, margin: float = None) -> dict:
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
    margin = UV_MARGIN if margin is None else margin
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
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="ANY", margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    _, n1 = uv_charts(bm)
    bm.free()
    return {"smart_islands": n0, "charts": n1, "fallback_charts": redone, "flipped_faces": flipped,
            "flipped_ratio": round(flipped / max(1, len(obj.data.polygons)), 4)}


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


def unwrap_best(obj, tex_size: int, min_frac: float = 0.005, margin: float = None) -> dict:
    """两种展开方案都做，保留平均纹素密度更高的一个：
    A 智能展开直接打包（碎岛少的资产里最紧凑）；B 合并图块后最小拉伸展开（碎岛严重的资产里多出一到两成清晰度，有翻折则淘汰）。"""
    margin = UV_MARGIN if margin is None else margin
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    buf_a = np.empty(len(obj.data.loops) * 2, np.float32)
    obj.data.uv_layers.active.data.foreach_get("uv", buf_a)
    dens_a = texel_density(obj)
    info = unwrap_lod0(obj, tex_size, min_frac, margin)
    dens_b = texel_density(obj)
    use_b = dens_b > dens_a and info["flipped_ratio"] <= 0.005
    if not use_b:
        obj.data.uv_layers.active.data.foreach_set("uv", buf_a)
        obj.data.update()
    return {**info, "method": "merged" if use_b else "smart", "density_smart": round(dens_a, 4), "density_merged": round(dens_b, 4)}
