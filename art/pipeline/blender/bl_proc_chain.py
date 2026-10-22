"""Procedural chapter-3 giant chain link (headless Blender): one black-iron link the runtime instances into chains.

The hanging forge, the Qilin cauldron and the chain bridges all hang on giant chains whose length and sag are decided at
runtime (docs/unity-parity.md §6: 链条程序生成), so the art is a single link, not a modelled chain. The link is a stadium
(two half circles joined by straight sides) swept with a round-cornered square section, with a riveted collar on each
straight side; its long axis is glTF +Y (Blender +Z), so links stack along Y and every second one turns 90° about Y.

Kit grid: outer length 1.0 m (pitch between links = 1.0 − 2 × bar = 0.68 m), outer width 0.62 m, bar 0.16 m; the origin
is the link's centre (export_asset keep_xy; z then shifts so the lowest point is at 0, i.e. the centre is 0.5 m up).
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from bl_common import args  # noqa: E402
from bl_proc_common import Atlas, Geo, export_asset, hexc, unit  # noqa: E402

P = args()
SEED = int(P.get("seed", 1))

L, W, BAR = 1.0, 0.62, 0.16
IRON = (0.0, 0.0, 1.0, 0.5)
COLLAR = (0.0, 0.5, 1.0, 1.0)


def stadium(n_arc: int, n_side: int) -> np.ndarray:
    """Centre line of the bar (closed loop in the x-z plane), counter-clockwise."""
    r = (W - BAR) / 2
    half = (L - BAR) / 2 - r
    pts = []
    for k in range(n_arc + 1):  # top arc
        a = math.pi * k / n_arc
        pts.append((r * math.cos(a), half + r * math.sin(a)))
    for k in range(1, n_side):
        pts.append((-r, half - 2 * half * k / n_side))
    for k in range(n_arc + 1):  # bottom arc
        a = math.pi + math.pi * k / n_arc
        pts.append((r * math.cos(a), -half + r * math.sin(a)))
    for k in range(1, n_side):
        pts.append((r, -half + 2 * half * k / n_side))
    return np.array([(x, 0.0, z) for x, z in pts])


def sweep(g: Geo, path: np.ndarray, radius: float, sides: int, rect, squareness: float = 0.55) -> None:
    """Closed sweep of a rounded-square section along a closed loop in the x-z plane (section axes: in-plane normal, y)."""
    n = len(path)
    u0, v0, u1, v1 = rect
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.vstack([path, path[:1]]), axis=0), axis=1))]
    rings = []
    for i in range(n):
        t = unit(path[(i + 1) % n] - path[i - 1])
        nrm = unit(np.cross(t, [0, 1.0, 0]))
        ring = []
        for k in range(sides):
            a = 2 * math.pi * (k + 0.5) / sides
            c, s = math.cos(a), math.sin(a)
            # superellipse: between a circle (squareness 0) and a square (1)
            e = 2 / (1 + squareness * 3)
            cx = math.copysign(abs(c) ** e, c)
            sy = math.copysign(abs(s) ** e, s)
            d = nrm * cx + np.array([0, 1.0, 0]) * sy
            ring.append((g.v(path[i] + d * radius), unit(nrm * c + np.array([0, 1.0, 0]) * s)))
        rings.append(ring)
    for i in range(n):
        j = (i + 1) % n
        va, vb = v0 + (v1 - v0) * seg[i] / seg[-1], v0 + (v1 - v0) * seg[i + 1] / seg[-1]
        for k in range(sides):
            k2 = (k + 1) % sides
            ua, ub = u0 + (u1 - u0) * k / sides, u0 + (u1 - u0) * (k + 1) / sides
            a, da = rings[i][k]
            b, db = rings[i][k2]
            c, dc = rings[j][k2]
            d, dd = rings[j][k]
            g.face((a, d, c, b), [(ua, va), (ua, vb), (ub, vb), (ub, va)], [da, dd, dc, db])


def collar(g: Geo, x: float, sides: int) -> None:
    """A short thicker band around one straight side, with four rivet bumps."""
    r = BAR / 2 + 0.025
    zs = (-0.09, 0.09)
    rings = []
    for z in (-0.09, 0.09):
        ring = []
        for k in range(sides):
            a = 2 * math.pi * (k + 0.5) / sides
            d = np.array([math.cos(a), math.sin(a), 0.0])
            ring.append((g.v(np.array([x, 0, z]) + d * r), d))
        rings.append(ring)
    u0, v0, u1, v1 = COLLAR
    for k in range(sides):
        k2 = (k + 1) % sides
        ua, ub = u0 + (u1 - u0) * k / sides, u0 + (u1 - u0) * (k + 1) / sides
        a, da = rings[0][k]
        b, db = rings[0][k2]
        c, dc = rings[1][k2]
        d, dd = rings[1][k]
        g.face((a, b, c, d), [(ua, v0), (ub, v0), (ub, v1), (ua, v1)], [da, db, dc, dd])
    for ring, zc in ((rings[0], -1.0), (rings[1], 1.0)):  # flat annulus caps toward the bar
        cen = g.v(np.array([x, 0, zs[0 if zc < 0 else 1]]))
        for k in range(sides):
            k2 = (k + 1) % sides
            a, _ = ring[k]
            b, _ = ring[k2]
            idx = (cen, b, a) if zc < 0 else (cen, a, b)
            g.face(idx, [((u0 + u1) / 2, v0)] * 3, [[0, 0, zc]] * 3)


def chain_link(lod: int, rng) -> Geo:
    g = Geo()
    sweep(g, stadium(*((6, 2) if lod == 0 else (3, 1))), BAR / 2, 8 if lod == 0 else 5, IRON)
    if lod == 0:
        r = (W - BAR) / 2
        for x in (-r, r):
            collar(g, x, 8)
    return g


def value_noise(h, w, cy, cx, rng):
    grid = rng.uniform(0, 1, (cy + 1, cx + 1))
    ys, xs = np.linspace(0, cy, h, endpoint=False), np.linspace(0, cx, w, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    a, b = grid[y0][:, x0], grid[y0][:, x0 + 1]
    c, d = grid[y0 + 1][:, x0], grid[y0 + 1][:, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def paint(atlas: Atlas, rng) -> None:
    atlas.rough = np.full_like(atlas.ao, 0.55)
    atlas.metal = np.full_like(atlas.ao, 0.8)
    # bar: blackened iron, worn brighter on the outer ridge (u ≈ 0.5 of the section), soot in the inner corners
    sl, s, t, (w, h) = atlas.region(IRON)
    n = value_noise(h, w, 6, 40, rng) * 0.6 + value_noise(h, w, 24, 160, rng) * 0.4
    ridge = np.exp(-((s - 0.5) * 5.0) ** 2) * 0.7 + np.exp(-((s - 0.0) * 6.0) ** 2) * 0.3
    col = hexc("#1e1c1d") + (hexc("#4a4644") - hexc("#1e1c1d")) * np.clip(ridge * 0.8 + n * 0.4, 0, 1)[..., None]
    col = col + hexc("#5a2a12") * 0.12 * (n > 0.72)[..., None]  # a little heat rust
    atlas.rgb[sl], atlas.a[sl], atlas.h[sl] = col, 1.0, 0.3 * n
    atlas.ao[sl] = 0.8 + 0.2 * ridge
    atlas.rough[sl] = 0.5 - 0.15 * ridge
    # collar: darker band with rivet bumps
    sl, s, t, (w, h) = atlas.region(COLLAR)
    rv = np.hypot(((s * 8) % 1) - 0.5, (t - 0.5) * 2) < 0.22
    col = np.where(rv[..., None], hexc("#6a625a"), hexc("#2a2624"))
    atlas.rgb[sl], atlas.a[sl], atlas.h[sl] = col, 1.0, 0.6 * rv
    atlas.ao[sl], atlas.rough[sl] = 0.9, 0.45


RECIPES = {"chain_link": chain_link}
export_asset(P, RECIPES[P["recipe"]], paint, {"roughness": 0.55, "alpha": False, "keep_xy": True,
                                              "ground": (0.18, 0.16, 0.15)})
