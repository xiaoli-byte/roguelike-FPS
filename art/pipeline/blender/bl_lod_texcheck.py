"""LOD texture fidelity: does every LOD still *look* like LOD0 once its texture is applied?

Collapse decimation interpolates UVs with the surface. When an edge collapse crosses a UV island border, the
merged triangle's UVs span unrelated parts of the atlas and the texture smears into diagonal stripes (Tripo P2.0
smart meshes: ~90% of vertices on island borders). Triangle counts and UV ranges stay perfectly valid, so only a
colour comparison catches it:

  area-uniform samples on LOD k → colour through LOD k's own UVs and base colour image,
  nearest point on LOD0 (same normal side) → colour through LOD0's UVs and image,
  both colours averaged over the samples within RADIUS on the surface, so painted micro detail and the small
  geometric offset of a far LOD drop out and only wrong colour *regions* remain. Smoothing on the surface, not in
  the image, keeps the empty gutter between UV islands out of the average.

`smeared_ratio` = area fraction whose colours differ by more than DELTA (sRGB 0..1 per channel, Euclidean).
Library (imported by bl_build_tripo.py) and standalone script (stages/validate.py runs it on the export GLB).
"""
from __future__ import annotations

import re

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

DELTA = 0.16      # colour distance counted as "wrong colour" (sRGB 0..1, Euclidean over RGB)
RADIUS = 0.015    # surface smoothing radius, fraction of LOD0's bounding-box diagonal (≈ 25 cm on a 14 m tower)
STRETCH = 3.0     # UV distortion factor vs LOD0 (density or anisotropy) counted as "stretched texture"
SAMPLES = 24000
LOD_RE = re.compile(r"_LOD(\d+)$")


def _tris(obj):
    """World-space triangle corners (n, 3, 3) and corner UVs (n, 3, 2)."""
    me = obj.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    vi = np.empty(n * 3, np.int64)
    li = np.empty(n * 3, np.int64)
    me.loop_triangles.foreach_get("vertices", vi)
    me.loop_triangles.foreach_get("loops", li)
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mw = np.array(obj.matrix_world)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    uv = np.empty(len(me.loops) * 2, np.float64)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    return co[vi].reshape(n, 3, 3), uv[li].reshape(n, 3, 2)


def base_color_image(obj, slot: int = 0):
    """The image feeding Base Color of the object's material (through mix / multiply nodes)."""
    mat = obj.material_slots[slot].material if obj.material_slots else None
    if not mat or not mat.node_tree:
        return None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)

    def up(sock, depth=0):
        if not sock.is_linked or depth > 6:
            return None
        node = sock.links[0].from_node
        if node.type == "TEX_IMAGE":
            return node.image
        for i in node.inputs:
            r = up(i, depth + 1)
            if r:
                return r
        return None

    return up(bsdf.inputs["Base Color"]) if bsdf else None


def rgb(img) -> np.ndarray:
    """(h, w, 3) RGB of an image, rows bottom→top as Blender stores them."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[..., :3]


def lookup(tex: np.ndarray, uv: np.ndarray) -> np.ndarray:
    """Bilinear lookup with wrap, uv in Blender convention (v up)."""
    h, w = tex.shape[:2]
    x = uv[:, 0] * w - 0.5
    y = uv[:, 1] * h - 0.5
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    x0, y0 = x0 % w, y0 % h
    x1, y1 = (x0 + 1) % w, (y0 + 1) % h
    return (tex[y0, x0] * (1 - fx) * (1 - fy) + tex[y0, x1] * fx * (1 - fy)
            + tex[y1, x0] * (1 - fx) * fy + tex[y1, x1] * fx * fy)


def uv_jacobian(t: np.ndarray, uv: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-triangle texture mapping 3D → UV: (scale, anisotropy) from the singular values σ1 ≥ σ2 of its Jacobian.
    scale = √(σ1σ2) (UV units per metre), anisotropy = σ1 / σ2 (inf for a UV-degenerate triangle)."""
    e1 = t[:, 1] - t[:, 0]
    e2 = t[:, 2] - t[:, 0]
    l1 = np.maximum(np.linalg.norm(e1, axis=1), 1e-12)
    x = e1 / l1[:, None]
    n = np.cross(e1, e2)
    y = np.cross(n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12), x)
    Q = np.stack([np.stack([l1, np.zeros_like(l1)], 1), np.stack([(e2 * x).sum(1), (e2 * y).sum(1)], 1)], 2)
    U = np.stack([uv[:, 1] - uv[:, 0], uv[:, 2] - uv[:, 0]], 2)
    det = Q[:, 0, 0] * Q[:, 1, 1] - Q[:, 0, 1] * Q[:, 1, 0]
    ok = np.abs(det) > 1e-14
    Qi = np.zeros_like(Q)
    Qi[ok] = np.linalg.inv(Q[ok])
    sv = np.linalg.svd(U @ Qi, compute_uv=False)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.sqrt(sv[:, 0] * sv[:, 1]), np.where(sv[:, 1] > 0, sv[:, 0] / sv[:, 1], np.inf)


def fidelity(lod0, tex0: np.ndarray, lod, tex: np.ndarray, delta: float = DELTA, radius: float = RADIUS,
             samples: int = SAMPLES, seed: int = 0) -> dict:
    t0, uv0 = _tris(lod0)
    tk, uvk = _tris(lod)
    area = np.linalg.norm(np.cross(tk[:, 1] - tk[:, 0], tk[:, 2] - tk[:, 0]), axis=1) / 2
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(tk), samples, p=area / area.sum())
    a, b = rng.random(samples), rng.random(samples)
    flip = a + b > 1
    a[flip], b[flip] = 1 - a[flip], 1 - b[flip]
    w = np.stack([1 - a - b, a, b], 1)
    pts = np.einsum("ni,nij->nj", w, tk[pick])
    nk = np.cross(tk[pick, 1] - tk[pick, 0], tk[pick, 2] - tk[pick, 0])
    nk /= np.maximum(np.linalg.norm(nk, axis=1, keepdims=True), 1e-12)
    ck = lookup(tex, np.einsum("ni,nij->nj", w, uvk[pick]))

    flat0 = t0.reshape(-1, 3)
    bvh = BVHTree.FromPolygons(flat0.tolist(), np.arange(len(flat0)).reshape(-1, 3).tolist(), all_triangles=True)
    span = float(np.linalg.norm(flat0.max(0) - flat0.min(0)))
    face = np.full(samples, -1, np.int64)
    loc = np.zeros((samples, 3))
    for i, p in enumerate(pts):
        hit = bvh.find_nearest(p)
        if hit[0] is not None:
            loc[i], face[i] = hit[0], hit[2]
    found = face >= 0
    face[~found] = 0
    n0 = np.cross(t0[face, 1] - t0[face, 0], t0[face, 2] - t0[face, 0])
    n0 /= np.maximum(np.linalg.norm(n0, axis=1, keepdims=True), 1e-12)
    dist = np.linalg.norm(loc - pts, axis=1)
    # Same side of the surface and close by: a thin wall's nearest point can be its back face.
    ok = found & ((n0 * nk).sum(1) > 0.3) & (dist < span * 0.02)
    # barycentric of the hit point in its LOD0 triangle → LOD0 UV
    A, B, C = t0[face, 0], t0[face, 1], t0[face, 2]
    v0, v1, v2 = B - A, C - A, loc - A
    d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
    d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
    den = np.maximum(d00 * d11 - d01 * d01, 1e-18)
    bv = (d11 * d20 - d01 * d21) / den
    bw = (d00 * d21 - d01 * d20) / den
    w0 = np.clip(np.stack([1 - bv - bw, bv, bw], 1), 0, 1)
    w0 /= np.maximum(w0.sum(1, keepdims=True), 1e-12)
    c0 = lookup(tex0, np.einsum("ni,nij->nj", w0, uv0[face]))

    # Surface low-pass: average both colours over the matched samples within the radius (same normal side).
    idx = np.flatnonzero(ok)
    kd = KDTree(len(idx))
    for j, i in enumerate(idx):
        kd.insert(pts[i], j)
    kd.balance()
    r = span * radius
    sk, s0 = np.empty((len(idx), 3)), np.empty((len(idx), 3))
    for j, i in enumerate(idx):
        nb = [k for _, k, _ in kd.find_range(pts[i], r)]
        nb = idx[nb][(nk[idx[nb]] @ nk[i]) > 0.5]
        sk[j], s0[j] = ck[nb].mean(0), c0[nb].mean(0)
    diff = np.linalg.norm(sk - s0, axis=1)

    # UV distortion vs LOD0 at the same spot: a collapse across an island border leaves a triangle whose texture is
    # stretched (stripes: anisotropic) or squeezed / blown up against the provider's local texel density. A LOD with
    # its own unwrap differs from LOD0 only by one global density factor, removed by the median.
    scale0, aniso0 = uv_jacobian(t0, uv0)
    scalek, anisok = uv_jacobian(tk, uvk)
    with np.errstate(divide="ignore", invalid="ignore"):
        rel = scalek[pick[idx]] / scale0[face[idx]]
    rel = rel / np.nanmedian(rel[np.isfinite(rel) & (rel > 0)]) if len(idx) else rel
    stretched = ~((rel > 1 / STRETCH) & (rel < STRETCH)) | (anisok[pick[idx]] > STRETCH * np.maximum(aniso0[face[idx]], 1.0))
    if not len(diff):
        return {"samples": 0, "matched_ratio": 0.0, "mean_delta": None, "p90_delta": None, "smeared_ratio": None,
                "stretched_ratio": None, "dist_p99_m": None}
    return {"samples": int(len(diff)), "matched_ratio": round(float(ok.mean()), 3),
            "mean_delta": round(float(diff.mean()), 4), "p90_delta": round(float(np.percentile(diff, 90)), 4),
            "smeared_ratio": round(float((diff > delta).mean()), 4),
            "stretched_ratio": round(float(stretched.mean()), 4),
            "dist_p99_m": round(float(np.percentile(dist[found], 99)), 4)}


def check_objects(lods: dict, delta: float = DELTA, radius: float = RADIUS) -> dict:
    """lods: {index: object}. Returns {"LOD1": {...}, ...} against LOD0."""
    tex0 = rgb(base_color_image(lods[0]))
    return {f"LOD{i}": fidelity(lods[0], tex0, o, rgb(base_color_image(o)), delta, radius)
            for i, o in sorted(lods.items()) if i}


if __name__ == "__main__":
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent))
    from bl_common import args, clear_scene, finish, import_glb, log

    P = args()
    clear_scene()
    lods = {}
    for o in import_glb(P["glb"]):
        m = LOD_RE.search(o.name) if o.type == "MESH" else None
        if m:
            lods[int(m.group(1))] = o
    bpy.context.view_layer.update()
    delta, radius = P.get("delta", DELTA), P.get("radius", RADIUS)
    res = check_objects(lods, delta, radius) if 0 in lods and len(lods) > 1 else {}
    for k, v in res.items():
        log(f"{k} 贴图一致性：糊色面积 {v['smeared_ratio']:.1%}，UV 拉伸面积 {v['stretched_ratio']:.1%}，平均色差 {v['mean_delta']}")
    finish(P, {"lods": res, "delta": delta, "radius": radius})
