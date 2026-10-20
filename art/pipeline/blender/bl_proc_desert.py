"""Procedural chapter-1 map kit (headless Blender): game-ready LOD meshes + painted BC / N / ORM from a code recipe.

The user rejected the Tripo plants (mushy blobs, broken leaf patches, a lump of sand for a base) and asked for the kit
to be modelled in local Blender instead. Every recipe here builds each LOD directly (no decimation of a sculpt), so the
topology stays clean and the silhouette is designed, and paints its own texture atlas in numpy:

  plants   tapered branch tubes (parallel-transport frames, bark strip of the atlas, young twigs greener toward the
           tip) + alpha-cut leaf-cluster cards painted as SDF shapes (leaves with midrib, light tip, dark rim, spines,
           flowers). Card normals point away from the crown centre, so the clump shades as one soft volume instead of
           flickering flat planes. Material: alphaMode MASK, double-sided.

Every recipe follows the asset's approved concept sheet (the user, 2026-10-20: the concepts were right, the Tripo
meshes did not match them).

Recipes: camelthorn (骆驼刺: round leaf clumps on twisted trunks over a sand mound, as on its concept),
tamarisk (红柳: tall feathery shrub with pink plumes).

Outputs: GLB (<ID>_LOD<i> nodes with lod / lod_distance extras, one material M_<name>, T_<name>_BC / _N / _ORM, Draco +
WebP), .blend, texture PNGs, four orthographic renders in the bounds-only reference camera frames (registered as the
concept views), a three-quarter beauty render, and metrics in the shape stages/validate.py and review.py read.

Params: asset_id, recipe, seed, texture, lod_tris, lod_distance, texture_dir, texture_basename, out_glb, out_blend,
render_dir, beauty_png. Returns the measured reference_dimensions [w, h, d] (game axes) with the metrics.
"""
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
from bl_common import VIEW_ORDER, args, finish, log  # noqa: E402

P = args()
NAME = P["asset_id"]
SHORT = NAME.split("_", 1)[1]
TEX = int(P["texture"])
SEED = int(P.get("seed", 1))
T0 = time.time()
RESULT: dict = {}


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


def paint_leaf_cluster(atlas: Atlas, rect, rng, pal: dict, leaves: tuple, leaf_len: tuple, leaf_w: float,
                       spines: int = 0, flowers: int = 0, plume: bool = False, side_twigs: int = 2,
                       pointed: bool = False, buds: bool = False, flower_size: float = 1.0, rim: bool = True,
                       leaf_contrast: float = 1.0) -> None:
    """A branching sprig (main stalk + side twigs) with leaves, or a feathery plume, drawn as SDF shapes that fill one
    atlas cell. Cell coordinates: X in [0, aspect] across, Y in [0, 1] up (isotropic, so shapes are not stretched)."""
    sl, s, t, (pw, ph) = atlas.region(rect)
    asp = pw / ph
    X, Y = s * asp, t
    rgb = np.zeros(s.shape + (3,))
    alpha = np.zeros(s.shape)
    height = np.zeros(s.shape)
    ao = np.ones(s.shape)
    cx = 0.5 * asp
    bend = rng.uniform(-0.1, 0.1) * asp
    stalks = [np.array([(cx, 0.0), (cx + bend * 0.4, 0.45), (cx + bend, 0.93)])]

    def along(st, tv):
        seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(st, axis=0), axis=1))]
        d = np.clip(tv, 0, 1) * seg[-1]
        i = min(int(np.searchsorted(seg, d, side="right")) - 1, len(st) - 2)
        f = (d - seg[i]) / max(seg[i + 1] - seg[i], 1e-9)
        return st[i] + f * (st[i + 1] - st[i]), unit(st[i + 1] - st[i])

    def turn(tan, ang):
        return np.array([tan[0] * math.cos(ang) - tan[1] * math.sin(ang), tan[0] * math.sin(ang) + tan[1] * math.cos(ang)])

    for k in range(side_twigs):
        b0, tan = along(stalks[0], rng.uniform(0.22, 0.6))
        side = 1 if k % 2 == 0 else -1
        d = turn(tan, math.radians(rng.uniform(35, 58)) * side)
        end = b0 + d * rng.uniform(0.32, 0.46)
        end = np.array([np.clip(end[0], 0.08 * asp, 0.92 * asp), min(end[1], 0.95)])
        stalks.append(np.array([b0, (b0 + end) / 2 + np.array([0, 0.04]), end]))
    lens = np.array([np.linalg.norm(np.diff(st, axis=0), axis=1).sum() for st in stalks])
    twig_mask = np.zeros(s.shape, bool)
    twig_t = np.zeros(s.shape)
    for n, st in enumerate(stalks):
        for (ax, ay), (bx, by) in zip(st, st[1:]):
            dd, tt = seg_dist(X, Y, ax, ay, bx, by)
            width = (0.016 if n == 0 else 0.011) * (1 - 0.5 * (ay + tt * (by - ay)))
            m = dd < width
            twig_mask |= m
            twig_t = np.where(m, ay + tt * (by - ay), twig_t)
    n_leaves = int(rng.integers(leaves[0], leaves[1] + 1))
    picks = rng.choice(len(stalks), n_leaves, p=lens / lens.sum())
    for j in np.argsort(rng.uniform(size=n_leaves)):
        st = stalks[picks[j]]
        tv = rng.uniform(0.12 if picks[j] == 0 else 0.05, 1.0)
        b0, tan = along(st, tv)
        side = 1 if rng.uniform() < 0.5 else -1
        d = turn(tan, math.radians(rng.uniform(25, 55) if not plume else rng.uniform(35, 70)) * side)
        L = rng.uniform(*leaf_len) * (1.0 - (0.4 if plume else 0.2) * tv)
        W = leaf_w * rng.uniform(0.85, 1.15) * (0.35 if plume else 1.0)
        ax_ = (X - b0[0]) * d[0] + (Y - b0[1]) * d[1]
        bx_ = -(X - b0[0]) * d[1] + (Y - b0[1]) * d[0]
        u = ax_ / L
        uc = np.clip(u, 0, 1)
        if pointed:  # lanceolate: widest a third of the way out, long sharp tip
            shape = np.where((u > 0) & (u < 1), 2.54 * uc ** 0.45 * (1 - uc) ** 1.1, 0)
        else:
            shape = np.where((u > 0) & (u < 1), np.sin(np.pi * uc) ** (0.75 if not plume else 0.4) * (1 - 0.3 * u), 0)
        width = W * shape
        inside = (u > 0) & (u < 1) & (np.abs(bx_) < width)
        if not inside.any():
            continue
        edge = inside & (np.abs(bx_) > width - 0.011)
        tone = rng.uniform(-0.07, 0.07)
        lit = np.clip(0.5 + leaf_contrast * (0.7 * u - 0.2 + (bx_ / np.maximum(width, 1e-4)) * 0.22 * side), 0, 1)
        col = (pal["leaf_dark"] + (pal["leaf_light"] - pal["leaf_dark"]) * lit[..., None]) * (1 + tone)
        if not plume:
            rib = inside & (np.abs(bx_) < 0.004) & (u < 0.85)
            col = np.where(rib[..., None], col * 0.8, col)
        if rim:
            col = np.where(edge[..., None], pal["leaf_rim"], col)
        hgt = 0.4 + 0.5 * tv + 0.002 * j
        m = inside & (height < hgt)
        rgb = np.where(m[..., None], col, rgb)
        alpha = np.maximum(alpha, m.astype(float))
        height = np.where(m, hgt, height)
        ao = np.where(m, np.minimum(ao, 0.74 + 0.26 * u), ao)
    for k in range(spines):
        st = stalks[rng.integers(len(stalks))]
        b0, tan = along(st, rng.uniform(0.1, 0.9))
        d = turn(tan, math.radians(rng.uniform(60, 85)) * (1 if k % 2 else -1))
        dd, _ = seg_dist(X, Y, b0[0], b0[1], b0[0] + d[0] * 0.075, b0[1] + d[1] * 0.075)
        m = dd < 0.005
        rgb = np.where(m[..., None], pal["spine"], rgb)
        alpha = np.maximum(alpha, m.astype(float))
    tcol = pal["twig"] * (0.85 + 0.25 * twig_t[..., None])
    rgb = np.where(twig_mask[..., None], tcol, rgb)
    alpha = np.maximum(alpha, twig_mask.astype(float))
    for k in range(flowers):
        st = stalks[rng.integers(len(stalks))]
        b0, tan = along(st, rng.uniform(0.55, 1.0))
        c = b0 + np.array([-tan[1], tan[0]]) * rng.uniform(-0.05, 0.05)
        r = rng.uniform(0.026, 0.034) * flower_size
        dd = np.hypot(X - c[0], Y - c[1])
        petals = np.zeros(s.shape, bool)
        for q in range(5):
            a_ = 2 * math.pi * q / 5 + rng.uniform(0, 1)
            pc = c + np.array([math.cos(a_), math.sin(a_)]) * r * 0.55
            petals |= np.hypot(X - pc[0], Y - pc[1]) < r * 0.5
        if buds:  # an elongated bud along the twig with a lighter tip and a green calyx at its base
            ex, ey = tan
            ax_ = (X - c[0]) * ex + (Y - c[1]) * ey
            bx_ = -(X - c[0]) * ey + (Y - c[1]) * ex
            body = (ax_ / (r * 1.25)) ** 2 + (bx_ / (r * 0.62)) ** 2 < 1
            calyx = (np.abs(bx_) < r * 0.55) & (ax_ < -r * 0.7) & (ax_ > -r * 1.35)
            m = body | calyx
            lit = np.clip(0.5 + ax_ / (r * 2.5), 0, 1)[..., None]
            col = pal["flower"] + (pal["flower_light"] - pal["flower"]) * lit
            col = np.where(calyx[..., None], pal["leaf_dark"], col)
            petals = body
        else:
            m = petals | (dd < r * 0.35)
            col = np.where((dd < r * 0.3)[..., None], pal["flower_light"], pal["flower"])
            col = np.where((petals & (dd > r * 0.75))[..., None], pal["flower"] * 0.8, col)
        rgb = np.where(m[..., None], col, rgb)
        alpha = np.maximum(alpha, m.astype(float))
        height = np.where(m, 1.2, height)
    atlas.rgb[sl] = np.where(alpha[..., None] > 0.5, rgb, atlas.rgb[sl])
    atlas.a[sl] = np.maximum(atlas.a[sl], alpha)
    atlas.h[sl] = np.maximum(atlas.h[sl], height * alpha)
    atlas.ao[sl] = np.where(alpha > 0.5, ao * (0.8 + 0.2 * np.clip(t, 0, 1)), atlas.ao[sl])


def paint_bark(atlas: Atlas, rect, rng, base: np.ndarray, tip: np.ndarray, streak: np.ndarray) -> None:
    """Bark strip: u around the branch, v along it (root → tip colour ramp), soft vertical streaks."""
    sl, s, t, _ = atlas.region(rect)
    col = base + (tip - base) * smoothstep(0.35, 1.0, t)[..., None]
    k = np.arange(1, 7)
    phase = rng.uniform(0, 2 * np.pi, 6)
    st = sum(np.sin(2 * np.pi * kk * 3 * s + ph + 3 * t) / kk for kk, ph in zip(k, phase))
    st = smoothstep(0.4, 1.0, st)
    col = col + (streak - col) * (0.55 * st)[..., None]
    atlas.rgb[sl] = col
    atlas.a[sl] = 1.0
    atlas.h[sl] = 0.4 - 0.2 * st
    atlas.ao[sl] = 0.85


def paint_core(atlas: Atlas, rect, rng, dark: np.ndarray, light: np.ndarray) -> None:
    """Flat foliage colour with a soft vertical ramp (v = height on the core sphere) and faint mottling."""
    sl, s, t, _ = atlas.region(rect)
    mott = 0.5 + 0.5 * np.sin(s * 37 + 3 * np.sin(t * 23)) * np.sin(t * 29 + 2 * np.sin(s * 17))
    col = dark + (light - dark) * (0.25 + 0.5 * t + 0.15 * mott)[..., None]
    atlas.rgb[sl] = col
    atlas.a[sl] = 1.0
    atlas.h[sl] = 0.3
    atlas.ao[sl] = 0.7 + 0.3 * t


def paint_sand(atlas: Atlas, rect, rng, base: np.ndarray, rim: np.ndarray, pebble: np.ndarray, pebbles: int = 9) -> None:
    """Top-down sand patch for a mound (planar UVs): lighter crown, wind ripples, a few dark pebbles."""
    sl, s, t, _ = atlas.region(rect)
    x, y = s - 0.5, t - 0.5
    r = np.hypot(x, y) / 0.5
    col = base + (rim - base) * smoothstep(0.2, 1.0, r)[..., None]
    rip = 0.5 + 0.5 * np.sin((x * 0.8 + y * 0.6) * 70 + 4 * np.sin(y * 9))
    col = col * (0.96 + 0.06 * rip[..., None])
    h = 0.15 * rip
    for _ in range(pebbles):
        a, d = rng.uniform(0, 2 * np.pi), rng.uniform(0.15, 0.36)
        px, py = math.cos(a) * d, math.sin(a) * d
        rr = rng.uniform(0.018, 0.04)
        e = ((x - px) / rr) ** 2 + ((y - py) / (rr * rng.uniform(0.6, 0.9))) ** 2
        m = e < 1
        shade = (0.75 + 0.35 * np.clip((y - py) / rr, -1, 1))[..., None]
        col = np.where(m[..., None], pebble * shade, col)
        h = np.where(m, 0.6 * (1 - e), h)
    atlas.rgb[sl] = col
    atlas.a[sl] = 1.0
    atlas.h[sl] = h
    atlas.ao[sl] = 0.9


# ───────────────────────────── recipes ─────────────────────────────

CARD_CELLS = [(c / 3, 0.25 + r * 0.375, (c + 1) / 3, 0.25 + (r + 1) * 0.375) for r in range(2) for c in range(3)]
BARK = (0.0, 0.0, 0.4, 0.25)
CORE = (0.4, 0.0, 0.5, 0.25)  # flat foliage colour for the solid cores inside leaf clumps
SPECIAL = [(0.5, 0.0, 0.75, 0.25), (0.75, 0.0, 1.0, 0.25)]


def plant(lod: int, spec: dict, rng) -> Geo:
    """Shared shrub builder: stems from the base, child branches, leaf / plume cards along the upper part of each."""
    g = Geo()
    crown = np.array(spec["crown_centre"])

    def crown_normal(p):
        n = unit(np.asarray(p) - crown)
        return unit(n + np.array([0, 0, spec.get("normal_up", 0.35)]))

    sides = spec["sides"][lod]
    segs = spec["segs"][lod]
    keep = spec["card_keep"][lod]
    grow = spec["card_grow"][lod]
    srng = np.random.default_rng(SEED)  # skeleton is the same in every LOD
    crng = np.random.default_rng(SEED + 101)
    branches = []
    n_main = spec["stems"]
    n_centre = spec.get("centre_stems", 0)
    for i in range(n_main + n_centre):
        centre = i >= n_main  # upright stems that fill the middle of the crown
        az = 2 * math.pi * (i + srng.uniform(-0.3, 0.3)) / (n_centre if centre else n_main)
        el = math.radians(srng.uniform(*(spec["centre_elev"] if centre else spec["stem_elev"])))
        L = srng.uniform(*(spec["centre_len"] if centre else spec["stem_len"]))
        d0 = np.array([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)])
        up = unit(d0 + np.array([0, 0, spec["stem_rise"]]))
        p0 = np.array([math.cos(az), math.sin(az), 0.0]) * spec["base_spread"] + np.array([0, 0, -0.02])
        p1 = p0 + d0 * L * 0.35
        p2 = p1 + up * L * 0.4
        p3 = p2 + unit(up + d0 * spec["stem_droop"]) * L * 0.35
        pts = bezier(p0, p1, p2, p3, segs + 1)
        r = np.linspace(spec["stem_r"][0], spec["stem_r"][1], len(pts))
        tube(g, pts, r, sides, BARK)
        branches.append((pts, 1.0))
        for c in range(spec["children"]):
            if lod and c >= spec["children_lod1"]:
                continue
            tt = srng.uniform(0.35, 0.75)
            j = int(tt * (len(pts) - 1))
            start = pts[j]
            dir_ = unit(rot_z(d0, srng.uniform(0.4, 0.9) * (1 if c % 2 else -1)) + np.array([0, 0, srng.uniform(0.1, 0.6)]))
            cl = L * srng.uniform(*spec["child_len"])
            q = bezier(start, start + dir_ * cl * 0.4, start + unit(dir_ + np.array([0, 0, 0.3])) * cl * 0.75,
                       start + unit(dir_ + np.array([0, 0, spec["child_rise"]])) * cl, max(2, segs - 2) + 1)
            rr = np.linspace(r[j] * 0.65, spec["stem_r"][1] * 0.8, len(q))
            tube(g, q, rr, max(3, sides - 1), BARK)
            branches.append((q, 0.75))
    # cards along the outer part of each branch
    for pts, scale in branches:
        seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        total = seg[-1]
        dist = total * spec["card_from"]
        while dist <= total:
            i = min(np.searchsorted(seg, dist), len(pts) - 1)
            p = pts[i]
            tan = unit(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
            if crng.uniform() < keep:
                out = unit(p - crown * np.array([1, 1, 0.5]))
                ydir = unit(tan * spec["card_along"] + out * 0.45 + np.array([0, 0, spec["card_up"]]) + crng.normal(0, 0.25, 3))
                xdir = unit(np.cross(ydir, unit(crng.normal(0, 1, 3))))
                cell = spec["cells"][crng.integers(len(spec["cells"]))]
                if dist > total * 0.8 and spec.get("tip_cells") and crng.uniform() < spec.get("tip_chance", 0.0):
                    cell = spec["tip_cells"][crng.integers(len(spec["tip_cells"]))]
                h = crng.uniform(*spec["card_h"]) * scale * grow
                w = h * (cell[2] - cell[0]) / (cell[3] - cell[1])  # the painted sprig keeps its proportions
                card(g, p - ydir * h * 0.08, xdir, ydir, w, h, cell, crown_normal)
                if crng.uniform() < spec["crossed"][lod]:
                    x2 = unit(np.cross(ydir, xdir))
                    card(g, p - ydir * h * 0.08, x2, ydir, w * 0.9, h * 0.95, cell, crown_normal)
            dist += crng.uniform(*spec["card_step"])
    return g


def mound(g: Geo, R: float, H: float, rng, uv_rect, segs: int = 16, rings: int = 3) -> None:
    """A low sand mound: dome profile, wobbling rim sunk 2 cm under the ground, planar UVs into uv_rect."""
    u0, v0, u1, v1 = uv_rect
    wob = [1 + 0.12 * math.sin(3 * a + 1.3) + 0.07 * math.sin(5 * a + 0.4) for a in np.linspace(0, 2 * math.pi, segs, endpoint=False)]

    def pos(r_frac, k):
        a = 2 * math.pi * k / segs
        r = R * r_frac * wob[k % segs]
        z = H * (1 - r_frac ** 2) ** 1.4 - 0.02 * (r_frac >= 0.999)
        return np.array([math.cos(a) * r, math.sin(a) * r, z])

    def nrm(r_frac, k):
        a = 2 * math.pi * k / segs
        slope = 2.8 * H / R * r_frac * (1 - r_frac ** 2) ** 0.4
        return unit([math.cos(a) * slope, math.sin(a) * slope, 1.0])

    def uv(p):
        return (u0 + (u1 - u0) * (p[0] / (2.4 * R) + 0.5), v0 + (v1 - v0) * (p[1] / (2.4 * R) + 0.5))

    top = g.v([0, 0, H])
    fracs = [(i + 1) / rings for i in range(rings)]
    ring_ids = [[g.v(pos(f, k)) for k in range(segs)] for f in fracs]
    for k in range(segs):
        k2 = (k + 1) % segs
        a, b = ring_ids[0][k], ring_ids[0][k2]
        g.face((top, a, b), [uv(g.V[top]), uv(g.V[a]), uv(g.V[b])], [[0, 0, 1], nrm(fracs[0], k), nrm(fracs[0], k2)])
    for i in range(rings - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            a, b = ring_ids[i][k], ring_ids[i][k2]
            c, d = ring_ids[i + 1][k2], ring_ids[i + 1][k]
            g.face((a, d, c, b), [uv(g.V[a]), uv(g.V[d]), uv(g.V[c]), uv(g.V[b])],
                   [nrm(fracs[i], k), nrm(fracs[i + 1], k), nrm(fracs[i + 1], k2), nrm(fracs[i], k2)])


def fib_dirs(n: int, rng, min_z: float = -0.35) -> list:
    """Roughly even directions on a sphere (Fibonacci lattice, jittered), dropping the ones that point down."""
    out = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n * 2):
        z = 1 - 2 * (i + 0.5) / (n * 2)
        r = math.sqrt(max(0.0, 1 - z * z))
        a = golden * i + rng.uniform(-0.3, 0.3)
        d = unit([math.cos(a) * r, math.sin(a) * r, z + rng.uniform(-0.08, 0.08)])
        if d[2] >= min_z:
            out.append(d)
    rng.shuffle(out)
    return out[:n]


def clump_bush(lod: int, spec: dict, rng) -> Geo:
    """The concept's structure: a few round leaf clumps on short twisted trunks over a low sand mound. Each clump is a
    ball of two-faced leaf cards whose normals point away from that clump's own centre, so it shades as one soft lump."""
    g = Geo()
    srng = np.random.default_rng(SEED)
    crng = np.random.default_rng(SEED + 211 + lod)
    mound(g, spec["mound_r"], spec["mound_h"], srng, spec["mound_cell"], segs=spec["mound_segs"][lod], rings=spec["mound_rings"][lod])
    clumps = []
    for i, (ang, dist, z, r) in enumerate(spec["clumps"]):
        a = math.radians(ang) + srng.uniform(-0.12, 0.12)
        c = np.array([math.cos(a) * dist, math.sin(a) * dist, z])
        clumps.append((c, r * srng.uniform(0.95, 1.05)))
    sides = spec["sides"][lod]
    for c, r in clumps:
        base = np.array([c[0] * 0.25, c[1] * 0.25, spec["mound_h"] * 0.6]) + srng.normal(0, 0.02, 3) * [1, 1, 0]
        mid = (base + c) / 2 + np.array([srng.uniform(-0.06, 0.06), srng.uniform(-0.06, 0.06), 0.02])
        pts = bezier(base, mid + (base - c) * 0.1, mid + (c - base) * 0.15, c - np.array([0, 0, r * 0.25]), spec["segs"][lod] + 1)
        tube(g, pts, np.linspace(spec["trunk_r"][0], spec["trunk_r"][1], len(pts)), sides, BARK)
        # one forked twig per trunk so the dark branches show between the clumps (as on the concept)
        if lod == 0:
            j = len(pts) // 2
            tip = pts[j] + unit(c - pts[j] + srng.normal(0, 0.4, 3)) * r * 0.8
            q = bezier(pts[j], pts[j] + (tip - pts[j]) * 0.4, pts[j] + (tip - pts[j]) * 0.7, tip, 3)
            tube(g, q, np.linspace(spec["trunk_r"][1] * 0.9, spec["trunk_r"][1] * 0.4, len(q)), 3, BARK)
    if spec.get("core"):
        u0, v0, u1, v1 = CORE
        for c, r in clumps:
            # a low-poly ball inside the cards so the clump reads as a solid lump, not a see-through pile of leaves
            rc = r * spec["core"]
            rings, segs = (2, 6) if lod == 0 else (1, 5)
            ids = [[g.v(c + rc * np.array([math.cos(2 * math.pi * k / segs) * math.sin(math.pi * (i + 1) / (rings + 1)),
                                            math.sin(2 * math.pi * k / segs) * math.sin(math.pi * (i + 1) / (rings + 1)),
                                            math.cos(math.pi * (i + 1) / (rings + 1)) * 0.85]))
                    for k in range(segs)] for i in range(rings)]
            top, bot = g.v(c + np.array([0, 0, rc * 0.85])), g.v(c - np.array([0, 0, rc * 0.85]))

            def nv(i):
                return unit(g.V[i] - c)

            def uvv(i):
                zz = (g.V[i][2] - (c[2] - rc)) / (2 * rc)
                kk = math.atan2(g.V[i][1] - c[1], g.V[i][0] - c[0]) / (2 * math.pi) + 0.5
                return (u0 + (u1 - u0) * kk, v0 + (v1 - v0) * zz)

            for k in range(segs):
                k2 = (k + 1) % segs
                a, b = ids[0][k], ids[0][k2]
                g.face((top, a, b), [uvv(top), uvv(a), uvv(b)], [nv(top), nv(a), nv(b)])
                a, b = ids[-1][k], ids[-1][k2]
                g.face((bot, b, a), [uvv(bot), uvv(b), uvv(a)], [nv(bot), nv(b), nv(a)])
                for i in range(rings - 1):
                    a, b, cc, d = ids[i][k], ids[i][k2], ids[i + 1][k2], ids[i + 1][k]
                    g.face((a, d, cc, b), [uvv(a), uvv(d), uvv(cc), uvv(b)], [nv(a), nv(d), nv(cc), nv(b)])
    for c, r in clumps:
        def clump_normal(p, c=c):
            return unit(unit(np.asarray(p) - c) + np.array([0, 0, spec["normal_up"]]))
        n = spec["clump_cards"][lod]
        for d in fib_dirs(n, crng, min_z=spec.get("card_min_z", -0.35)):
            top = d[2] > 0.45
            cells = spec["tip_cells"] if (top and crng.uniform() < spec["tip_chance"]) else spec["cells"]
            cell = cells[crng.integers(len(cells))]
            h = r * crng.uniform(*spec["card_h"]) * spec["card_grow"][lod]
            w = h * (cell[2] - cell[0]) / (cell[3] - cell[1])
            # lie on the ball like a scale (sprig pointing up the surface), tilted outward so the leaf tips bristle at
            # the silhouette: the clump reads as one round lump, not a burst of edge-on cards
            up = np.array([0, 0, 1.0])
            tan = up - d * float(np.dot(up, d))
            tan = unit(tan if np.linalg.norm(tan) > 0.2 else np.cross(d, unit(crng.normal(0, 1, 3))))
            tan = unit(tan + np.cross(d, tan) * crng.uniform(-0.6, 0.6))
            tilt = math.radians(crng.uniform(*spec["card_tilt"]))
            ydir = unit(tan * math.cos(tilt) + d * math.sin(tilt))
            xdir = unit(np.cross(ydir, d))
            b = c + d * r * spec["card_inset"] - ydir * h * 0.45
            card(g, b, xdir, ydir, w, h, cell, clump_normal)
    return g


def paint_camelthorn(atlas: Atlas, rng) -> None:
    # colours from the approved concept: yellow-olive leaves with light tops, dark twisted wood, pink-red buds
    pal = {"leaf_dark": hexc("#869836"), "leaf_light": hexc("#efeb88"), "leaf_rim": hexc("#4c5a22"),
           "twig": hexc("#5a4a3c"), "spine": hexc("#4a3a2c"), "flower": hexc("#e6507e"), "flower_light": hexc("#ffc0d4")}
    for k, cell in enumerate(CARD_CELLS):
        paint_leaf_cluster(atlas, cell, np.random.default_rng(SEED * 31 + k), pal, (13, 16), (0.34, 0.46), 0.08,
                           spines=0, flowers=(2 if k in (1, 4) else 1), side_twigs=2, pointed=True, buds=True,
                           flower_size=1.6, rim=False, leaf_contrast=0.45)
    paint_core(atlas, CORE, rng, hexc("#56662a"), hexc("#b4b84e"))
    paint_bark(atlas, BARK, rng, hexc("#4a3c32"), hexc("#6a5a46"), hexc("#33281f"))
    paint_leaf_cluster(atlas, SPECIAL[0], np.random.default_rng(SEED + 7), pal, (11, 13), (0.32, 0.44), 0.08, spines=0,
                       flowers=6, side_twigs=2, pointed=True, buds=True, flower_size=1.7, rim=False, leaf_contrast=0.45)
    paint_sand(atlas, SPECIAL[1], np.random.default_rng(SEED + 9), hexc("#e0bc7c"), hexc("#c89c60"), hexc("#a08060"), pebbles=0)


CAMELTHORN = {
    # the approved concept: seven big round leaf clumps sitting low on short dark trunks over a sand mound
    "builder": "clump", "mound_r": 0.6, "mound_h": 0.14, "mound_cell": SPECIAL[1], "mound_segs": (16, 10),
    "mound_rings": (3, 2),
    "clumps": [(90, 0.1, 0.42, 0.28), (180, 0.4, 0.3, 0.25), (0, 0.4, 0.3, 0.24), (238, 0.34, 0.27, 0.23),
               (302, 0.35, 0.28, 0.24), (132, 0.34, 0.31, 0.23), (48, 0.34, 0.32, 0.23)],
    "trunk_r": (0.03, 0.014), "sides": (4, 3), "segs": (4, 2), "clump_cards": (34, 10), "card_grow": (1.0, 1.4),
    "card_h": (0.75, 0.95), "card_inset": 0.72, "card_tilt": (20, 45), "normal_up": 0.4, "core": 0.62,
    "card_min_z": -0.75,
    "cells": CARD_CELLS, "tip_cells": [SPECIAL[0]], "tip_chance": 0.75,
}


def paint_tamarisk(atlas: Atlas, rng) -> None:
    green = {"leaf_dark": hexc("#6a8a5a"), "leaf_light": hexc("#d6e4b4"), "leaf_rim": hexc("#4a6444"),
             "twig": hexc("#9a5038"), "spine": hexc("#6a3a2a"), "flower": hexc("#e48aae"), "flower_light": hexc("#ffd6e4")}
    pink = dict(green, leaf_dark=hexc("#d0709a"), leaf_light=hexc("#ffd4e4"), leaf_rim=hexc("#a64a72"), twig=hexc("#9a5040"))
    # feathery sprays: many short scale-leaf needles packed along every twig
    for k, cell in enumerate(CARD_CELLS):
        paint_leaf_cluster(atlas, cell, np.random.default_rng(SEED * 17 + k), green, (95, 115), (0.06, 0.11), 0.09,
                           plume=True, side_twigs=3)
    paint_bark(atlas, BARK, rng, hexc("#6a3626"), hexc("#b0643e"), hexc("#4a261c"))
    for k, cell in enumerate(SPECIAL):
        paint_leaf_cluster(atlas, cell, np.random.default_rng(SEED * 23 + k), pink, (95, 115), (0.05, 0.09), 0.1,
                           plume=True, side_twigs=2)


TAMARISK = {
    # a vase of seven slender stems clothed in feathery plumes from knee height up, pink racemes at the tips
    "crown_centre": (0, 0, 1.0), "stems": 7, "stem_elev": (50, 76), "stem_len": (1.3, 1.7), "stem_rise": 0.55,
    "stem_droop": 0.5, "base_spread": 0.05, "stem_r": (0.026, 0.006), "children": 3, "children_lod1": 1,
    "child_len": (0.32, 0.5), "child_rise": 0.3, "sides": (4, 3), "segs": (5, 3), "card_from": 0.22,
    "card_step": (0.095, 0.13), "card_keep": (1.0, 0.28), "card_grow": (1.0, 1.5), "card_h": (0.38, 0.52),
    "card_along": 0.9, "card_up": 0.0, "crossed": (0.0, 0.0), "normal_up": 0.3,
    "cells": CARD_CELLS, "tip_cells": SPECIAL, "tip_chance": 0.55,
}

RECIPES = {
    "camelthorn": (CAMELTHORN, paint_camelthorn, {"roughness": 0.85}),
    "tamarisk": (TAMARISK, paint_tamarisk, {"roughness": 0.85}),
}

# ───────────────────────────── build ─────────────────────────────

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
spec, painter, mat_opts = RECIPES[P["recipe"]]
rng = np.random.default_rng(SEED)

atlas = Atlas(TEX)
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
orm = np.stack([atlas.ao, np.full_like(atlas.ao, mat_opts["roughness"]), np.zeros_like(atlas.ao)], -1)

tex_dir = Path(P["texture_dir"])
tex_dir.mkdir(parents=True, exist_ok=True)
base = P["texture_basename"]
images = {}
for role, arr, alpha, cs in (("BC", atlas.rgb, atlas.a, "sRGB"), ("N", nrm * 0.5 + 0.5, None, "Non-Color"),
                             ("ORM", orm, None, "Non-Color")):
    img = bpy.data.images.new(f"{base}_{role}", TEX, TEX, alpha=alpha is not None)
    img.colorspace_settings.name = cs  # before the pixels: changing it regenerates a generated image's buffer
    rgba = np.concatenate([np.clip(arr, 0, 1), (alpha if alpha is not None else np.ones(arr.shape[:2]))[..., None]], -1)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = str(tex_dir / f"{base}_{role}.png")
    img.file_format = "PNG"
    img.save()
    images[role] = img
RESULT["alpha_coverage"] = round(float((atlas.a > 0.5).mean()), 3)

mat = bpy.data.materials.new(f"M_{SHORT}")
mat.use_nodes = True
mat.use_backface_culling = True  # cards are two-faced geometry
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]


def tex_node(role, y):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = images[role]
    n.location = (-700, y)
    return n


bc = tex_node("BC", 300)
nt.links.new(bc.outputs["Color"], bsdf.inputs["Base Color"])
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
    g = (clump_bush if spec.get("builder") == "clump" else plant)(i, spec, rng)
    ob = g.to_object(f"{NAME}_LOD{i}")
    ob.data.materials.append(mat)
    ob["lod"] = i
    ob["lod_distance"] = P["lod_distance"][i]
    lods.append(ob)
    log(f"LOD{i}：{g.tris()} 三角面（预算 {budget}）")
    if g.tris() > budget:
        raise RuntimeError(f"LOD{i} {g.tris()} tris over budget {budget}")

# feet on the ground (z = 0 at the lowest point), centred on the footprint
co = np.array([v.co[:] for v in lods[0].data.vertices])
lo, hi = co.min(0), co.max(0)
shift = Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))
for ob in lods:
    ob.data.transform(Matrix.Translation(shift))
co = np.array([v.co[:] for v in lods[0].data.vertices])
dims = (co.max(0) - co.min(0)).tolist()
RESULT["dims_m"] = [round(x, 3) for x in dims]
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
views = {"views": [{"view": v, "dir": DIRS[v], "center": [0, 0, H / 2], "world_w": world_h * PW / PH, "world_h": world_h,
                    "px_w": PW, "px_h": PH} for v in VIEW_ORDER]}
RESULT["reference_dimensions"] = [W, H, D]
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
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.78, 0.62, 0.40, 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
plane_me.materials.append(gm)
scene.collection.objects.link(ground)
cam.data.type = "PERSP"
cam.data.lens = 50
H = dims[2]
target = Vector((0, 0, H * 0.45))
dist = max(dims) * 2.6
cam.location = target + Vector((-0.62, -1.0, 0.42)).normalized() * dist
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.render.resolution_x, scene.render.resolution_y = 1280, 800
scene.cycles.samples = 96
scene.render.filepath = P["beauty_png"]
bpy.ops.render.render(write_still=True)

finish(P, {**RESULT, "lods": lod_rows, "export": {"bytes": export_bytes},
           "align": {"iou": 1.0, "iou_per_view": {v: 1.0 for v in VIEW_ORDER}, "method": "procedural (no fit)"},
           "projection": {"uncovered_ratio": 0.0, "method": "procedural painted atlas"},
           "bake_device": "none (numpy painted)", "_seconds": round(time.time() - T0, 1)})
