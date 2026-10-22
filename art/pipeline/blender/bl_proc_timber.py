"""Procedural chapter-2 plank road kit (栈道, headless Blender): timber pieces that tile exactly.

Tripo could not make these: the four-view concepts disagreed on which edge carries the railing and drew the 6 m deck
about 3 m deep, and a reconstructed mesh never has the flat, exactly spaced ends a modular walkway needs. Here every
piece is built from chamfered boxes on fixed dimensions, so sections snap end to end on the grid below, and the look
follows the approved ART5 concepts (dark weathered planks, faded vermilion railing, verdigris bronze straps, snow caps,
short icicles).

Kit grid (Blender: x along the road, front / outer edge = −y, back / cliff side = +y, z up; the origin is the middle of
the deck footprint at the lowest point, export_asset keep_xy):
  plank_straight  deck x ∈ [−4, 4], y ∈ [−3, 3], deck top z = 2.4; cantilever joists into the cliff at x = −3, −1, 1, 3
                  with a back post and a diagonal strut each; railing posts every 2 m (x = −3, −1, 1, 3), rails run the
                  full length so they continue across joints.
  plank_corner    deck x ∈ [−3, 3], y ∈ [−3, 3]; railing on the front (y = −2.85) and +x (x = 2.85) edges; the −x and
                  +y edges are open (a straight joins at each; the second one is turned 90° so its front faces +x).
                  Four corner posts with cross braces stand under it (the cliff only touches its back-left corner).
  plank_broken    deck from x = −2.5 (clean joining end) to the snapped +x end (planks end between x ≈ 0.9 and 2.4,
                  two hang down, the railing dangles, the third joist is snapped).
  plank_post      a trestle bent 6 m wide (x), 9 m tall, 1.2 m deep, top beam flat at z = 9: put it under a straight with
                  the trestle's x along the straight's y; its top carries the joists (joist bottom = straight z 1.92).

Every LOD is modelled (LOD1: no chamfers, straps, nails or icicles). One painted 1024² atlas per piece: eight plank
strips (nails painted where that piece's joists cross), two timber strips, end grain, lacquer, bronze, snow, ice and
stone; per-pixel roughness / metallic in the ORM.
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from bl_common import args  # noqa: E402
from bl_proc_common import Atlas, Geo, export_asset, hexc, smoothstep, tube, unit  # noqa: E402

P = args()
SEED = int(P.get("seed", 1))

# ───────────────────────────── atlas layout (u0, v0, u1, v1) and the metres each region spans ─────────────────────────────

PLANK = [(0.0, k * 0.0625, 1.0, (k + 1) * 0.0625) for k in range(8)]           # 8 m × 0.5 m each
TIMBER = [(0.0, 0.5 + k * 0.0625, 1.0, 0.5 + (k + 1) * 0.0625) for k in range(2)]  # 8 m × 0.5 m
END = (0.0, 0.625, 0.125, 0.6875)       # end grain, 1 m × 0.5 m
LACQUER = (0.125, 0.625, 1.0, 0.6875)   # 7 m × 0.5 m
BRONZE = (0.0, 0.6875, 0.5, 0.75)       # 4 m × 0.5 m
SNOW = (0.5, 0.6875, 1.0, 0.75)         # 4 m × 0.5 m
ICE = (0.0, 0.75, 0.25, 0.8125)         # 2 m × 0.5 m
STONE = (0.25, 0.75, 0.75, 0.875)       # 4 m × 1 m
METRES = {"plank": (8.0, 0.5), "timber": (8.0, 0.5), "end": (1.0, 0.5), "lacquer": (7.0, 0.5), "bronze": (4.0, 0.5),
          "snow": (4.0, 0.5), "ice": (2.0, 0.5), "stone": (4.0, 1.0)}


def region(mat: str, k: int = 0):
    return {"plank": PLANK[k % 8], "timber": TIMBER[k % 2], "end": END, "lacquer": LACQUER, "bronze": BRONZE,
            "snow": SNOW, "ice": ICE, "stone": STONE}[mat]


# ───────────────────────────── chamfered boxes ─────────────────────────────

class Box:
    """Chamfered box builder. axes = rows ex, ey, ez (orthonormal); half = half sizes. The main faces are flat; each
    chamfer quad carries the two neighbouring face normals on its two edges (a rounded edge from one segment), corner
    triangles carry the three. Faces whose normal runs along the grain axis map to the end-grain region."""

    def __init__(self, g: Geo, rng, lod: int):
        self.g, self.rng, self.lod = g, rng, lod

    def __call__(self, c, half, mat: str, k: int = 0, axes=None, bevel: float = 0.025, grain: int | None = None,
                 skip=()):
        g = self.g
        c = np.asarray(c, float)
        E = np.eye(3) if axes is None else np.array([unit(a) for a in axes])
        h = np.asarray(half, float)
        r = 0.0 if self.lod > 0 else min(bevel, *(h * 0.45))
        grain = int(np.argmax(h)) if grain is None else grain
        rect = region(mat, k)
        mu, mv = METRES[mat]
        off = self.rng.uniform(0, 1, 3)

        def P_(loc):
            return c + E.T @ loc

        def uv_for(axis: int, loc):
            """Planar map for the face whose normal is `axis`: u along the grain (or the longer in-plane axis)."""
            a, b = [i for i in range(3) if i != axis]
            if axis == grain and mat in ("plank", "timber"):
                er, (emu, emv) = END, METRES["end"]
                ua, vb = loc[a] + h[a], loc[b] + h[b]
                return (er[0] + (er[2] - er[0]) * (ua / emu + off[0] * 0.3) % 1.0 * 0.999,
                        er[1] + (er[3] - er[1]) * min(vb / emv, 0.999))
            if grain in (a, b):
                ga, gb = grain, (b if grain == a else a)
            else:
                ga, gb = (a, b) if h[a] >= h[b] else (b, a)
            la, lb = 2 * h[ga], 2 * h[gb]
            sa = min(1.0, mu / max(la, 1e-6))
            sb = min(1.0, mv / max(lb, 1e-6))
            oa = (mu - la * sa) * off[1] if mat not in ("plank",) else 0.0  # planks stay world-aligned (nails)
            ob = (mv - lb * sb) * off[2]
            if mat == "plank":
                oa = (c[0] - h[0] + 4.0) if grain == 0 else 0.0
            ua = (loc[ga] + h[ga]) * sa + oa
            vb = (loc[gb] + h[gb]) * sb + ob
            return (rect[0] + (rect[2] - rect[0]) * min(max(ua / mu, 0.0), 0.999),
                    rect[1] + (rect[3] - rect[1]) * min(max(vb / mv, 0.0), 0.999))

        # 24 corner vertices: for face (axis, sign) the corner (sa, sb) on its two in-plane axes
        vid, vloc = {}, {}
        for axis in range(3):
            for s in (-1, 1):
                a, b = [i for i in range(3) if i != axis]
                for sa in (-1, 1):
                    for sb in (-1, 1):
                        loc = np.zeros(3)
                        loc[axis] = s * h[axis]
                        loc[a] = sa * (h[a] - r)
                        loc[b] = sb * (h[b] - r)
                        vid[(axis, s, a, sa, b, sb)] = g.v(P_(loc))
                        vloc[(axis, s, a, sa, b, sb)] = loc

        def key(axis, s, signs):
            a, b = [i for i in range(3) if i != axis]
            return (axis, s, a, signs[a], b, signs[b])

        def n_of(axis, s):
            n = np.zeros(3)
            n[axis] = s
            return E.T @ n

        for axis in range(3):
            for s in (-1, 1):
                if (axis, s) in skip:
                    continue
                a, b = [i for i in range(3) if i != axis]
                corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
                ks = []
                for sa, sb in corners:
                    sg = [0, 0, 0]
                    sg[a], sg[b] = sa, sb
                    ks.append(key(axis, s, sg))
                # winding: counter-clockwise seen from outside
                n = n_of(axis, s)
                pts = [g.V[vid[k_]] for k_ in ks]
                if np.dot(np.cross(pts[1] - pts[0], pts[2] - pts[0]), n) < 0:
                    ks = ks[::-1]
                g.face([vid[k_] for k_ in ks], [uv_for(axis, vloc[k_]) for k_ in ks], [n] * 4)
        if r <= 0:
            return
        # edge chamfers: between faces (i, si) and (j, sj), running along the third axis
        for i in range(3):
            for j in range(i + 1, 3):
                m = 3 - i - j
                for si in (-1, 1):
                    for sj in (-1, 1):
                        if (i, si) in skip and (j, sj) in skip:
                            continue
                        quad = []
                        for sm in (-1, 1):
                            sg = [0, 0, 0]
                            sg[j], sg[m] = sj, sm
                            ki = key(i, si, sg)
                            sg = [0, 0, 0]
                            sg[i], sg[m] = si, sm
                            kj = key(j, sj, sg)
                            quad.append((ki, i, si))
                            quad.append((kj, j, sj))
                        order = [quad[0], quad[1], quad[3], quad[2]]
                        pts = [g.V[vid[q[0]]] for q in order]
                        nn = n_of(i, si) + n_of(j, sj)
                        if np.dot(np.cross(pts[1] - pts[0], pts[2] - pts[0]), nn) < 0:
                            order = order[::-1]
                        base_axis = i if i != grain else j
                        base_s = si if base_axis == i else sj
                        g.face([vid[q[0]] for q in order],
                               [uv_for(base_axis, vloc[q[0]] * np.where(np.arange(3) == base_axis, 0, 1)
                                       + np.where(np.arange(3) == base_axis, base_s * h[base_axis], 0)) for q in order],
                               [n_of(q[1], q[2]) for q in order])
        # corner triangles
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    sg = [sx, sy, sz]
                    tri = [(key(ax, sg[ax], sg), ax, sg[ax]) for ax in range(3)]
                    pts = [g.V[vid[t[0]]] for t in tri]
                    nn = sum(n_of(t[1], t[2]) for t in tri)
                    if np.dot(np.cross(pts[1] - pts[0], pts[2] - pts[0]), nn) < 0:
                        tri = tri[::-1]
                    base_axis = 0 if grain != 0 else 1
                    g.face([vid[t[0]] for t in tri],
                           [uv_for(base_axis, vloc[key(base_axis, sg[base_axis], sg)]) for t in tri],
                           [n_of(t[1], t[2]) for t in tri])


def beam_between(box: Box, p0, p1, w: float, d: float, mat: str, k: int = 0, up=(0, 0, 1), bevel: float = 0.025):
    """A timber of section w × d whose long axis runs from p0 to p1 (end faces at p0 / p1)."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    ex = unit(p1 - p0)
    upv = np.asarray(up, float)
    if abs(np.dot(ex, unit(upv))) > 0.95:
        upv = np.array([0, 1.0, 0])
    ey = unit(np.cross(upv, ex))
    ez = np.cross(ex, ey)
    box((p0 + p1) / 2, (np.linalg.norm(p1 - p0) / 2, w / 2, d / 2), mat, k, axes=(ex, ey, ez), bevel=bevel, grain=0)


def icicles(g: Geo, lod: int, rng, spots) -> None:
    """Short fat icicles hanging under (x, y, z) spots (LOD0 only)."""
    if lod > 0:
        return
    for p in spots:
        p = np.asarray(p, float)
        n = rng.integers(1, 3)
        for _ in range(n):
            q = p + np.array([rng.uniform(-0.08, 0.08), rng.uniform(-0.04, 0.04), 0.0])
            ln = rng.uniform(0.18, 0.42)
            r0 = rng.uniform(0.035, 0.06)
            pts = np.array([q + np.array([0, 0, 0.02]), q - np.array([0, 0, ln * 0.45]), q - np.array([0, 0, ln])])
            tube(g, pts, np.array([r0, r0 * 0.6, 0.0]), 5, ICE)


# ───────────────────────────── pieces ─────────────────────────────

DECK_TOP = 2.4
PLANK_T = 0.12
PLANK_W = 0.5
JOIST_TOP = DECK_TOP - PLANK_T          # 2.28
JOIST_H = 0.36
RAIL_Y = -2.85
RAIL_HW, RAIL_HH = 0.1, 0.09            # top rail half width / half height


def planks(box: Box, x0: float, x1: float, y0: float = -3.0, y1: float = 3.0, ends=None, rng=None, snowy_back=True):
    """Planks laid along the road (x). ends: optional per-plank (x_end) overrides for the snapped piece."""
    n = int(round((y1 - y0) / PLANK_W))
    for i in range(n):
        yc = y0 + (i + 0.5) * PLANK_W
        k = 7 if (snowy_back and i == n - 1) else (6 if (snowy_back and i == n - 2) else int(rng.integers(0, 6)))
        xe = x1 if ends is None else ends[i]
        if xe is None:
            continue
        dz = rng.uniform(-0.006, 0.006)
        box(((x0 + xe) / 2, yc, DECK_TOP - PLANK_T / 2 + dz), ((xe - x0) / 2, PLANK_W / 2 - 0.004, PLANK_T / 2), "plank", k,
            bevel=0.022, grain=0)


def railing_x(box: Box, lod: int, x0: float, x1: float, posts, y: float = RAIL_Y):
    """Railing along x at y: posts (x list), a lacquered top rail and mid rail over [x0, x1], snow on top."""
    for px in posts:
        rail_post(box, (px, y), lod)
    box(((x0 + x1) / 2, y, DECK_TOP + 0.76), ((x1 - x0) / 2, RAIL_HW, RAIL_HH), "lacquer", bevel=0.03, grain=0)
    box(((x0 + x1) / 2, y, DECK_TOP + 0.36), ((x1 - x0) / 2, 0.065, 0.06), "lacquer", bevel=0.02, grain=0)
    box(((x0 + x1) / 2, y, DECK_TOP + 0.76 + RAIL_HH + 0.03), ((x1 - x0) / 2, RAIL_HW + 0.025, 0.04), "snow", bevel=0.035,
        grain=0)


def railing_y(box: Box, lod: int, y0: float, y1: float, posts, x: float):
    for py in posts:
        rail_post(box, (x, py), lod)
    box((x, (y0 + y1) / 2, DECK_TOP + 0.76), (RAIL_HW, (y1 - y0) / 2, RAIL_HH), "lacquer", bevel=0.03, grain=1)
    box((x, (y0 + y1) / 2, DECK_TOP + 0.36), (0.065, (y1 - y0) / 2, 0.06), "lacquer", bevel=0.02, grain=1)
    box((x, (y0 + y1) / 2, DECK_TOP + 0.76 + RAIL_HH + 0.03), (RAIL_HW + 0.025, (y1 - y0) / 2, 0.04), "snow", bevel=0.035,
        grain=1)


def rail_post(box: Box, xy, lod: int, size: float = 0.3):
    x, y = xy
    box((x, y, DECK_TOP + 0.47), (size / 2, size / 2, 0.47), "timber", 1, bevel=0.035, grain=2)
    box((x, y, DECK_TOP + 0.97), (size / 2 + 0.03, size / 2 + 0.03, 0.04), "bronze", bevel=0.012)
    box((x, y, DECK_TOP + 1.04), (size / 2 + 0.04, size / 2 + 0.04, 0.05), "snow", bevel=0.045)
    if lod == 0:
        box((x, y, DECK_TOP + 0.06), (size / 2 + 0.025, size / 2 + 0.025, 0.06), "bronze", bevel=0.012)


def bracket(box: Box, lod: int, x: float, y_front: float = -3.1, y_back: float = 3.0, strut: bool = True,
            post: bool = True, snap_at: float | None = None):
    """One cantilever joist (along y) with its back post against the cliff and a diagonal strut."""
    yf = y_front if snap_at is None else snap_at
    box((x, (yf + y_back) / 2, JOIST_TOP - JOIST_H / 2), (0.15, (y_back - yf) / 2, JOIST_H / 2), "timber", 0, bevel=0.03,
        grain=1)
    if snap_at is None and lod == 0:
        box((x, y_front + 0.04, JOIST_TOP - JOIST_H / 2), (0.17, 0.05, JOIST_H / 2 + 0.02), "bronze", bevel=0.01)
    if post:
        box((x, 2.82, (JOIST_TOP - JOIST_H) / 2), (0.15, 0.15, (JOIST_TOP - JOIST_H) / 2), "timber", 1, bevel=0.03, grain=2)
        if lod == 0:
            box((x, 2.82, JOIST_TOP - JOIST_H - 0.08), (0.17, 0.17, 0.06), "bronze", bevel=0.01)
    if strut:
        beam_between(box, (x, 2.7, 0.22), (x, -1.55, JOIST_TOP - JOIST_H - 0.02), 0.22, 0.22, "timber", 1, up=(0, 0, 1))
        if lod == 0:
            box((x, -1.4, JOIST_TOP - JOIST_H - 0.04), (0.16, 0.22, 0.03), "bronze", bevel=0.01)


def plank_straight(lod: int, rng) -> Geo:
    g = Geo()
    box = Box(g, rng, lod)
    L = 4.0
    planks(box, -L, L, rng=rng)
    for x in (-3, -1, 1, 3):
        bracket(box, lod, x)
    box((0, -2.83, JOIST_TOP - 0.17), (L, 0.12, 0.17), "timber", 0, bevel=0.03, grain=0)   # outer fascia
    box((0, 2.88, JOIST_TOP - 0.14), (L, 0.12, 0.14), "timber", 1, bevel=0.03, grain=0)    # back ledger
    railing_x(box, lod, -L, L, (-3, -1, 1, 3))
    box((0, 2.72, DECK_TOP + 0.03), (L, 0.26, 0.05), "snow", bevel=0.045, grain=0)          # drift along the cliff
    icicles(g, lod, rng, [(x, -3.12, JOIST_TOP - JOIST_H) for x in (-3, -1, 1, 3)]
            + [(x, -2.95, JOIST_TOP - 0.34) for x in (-2.2, -0.3, 1.8, 3.5)])
    return g


def plank_corner(lod: int, rng) -> Geo:
    g = Geo()
    box = Box(g, rng, lod)
    S = 3.0
    planks(box, -S, S, rng=rng, snowy_back=False)
    for x in (-2, 0, 2):
        box((x, 0, JOIST_TOP - JOIST_H / 2), (0.15, 3.0, JOIST_H / 2), "timber", 0, bevel=0.03, grain=1)
    box((0.1, -2.83, JOIST_TOP - 0.17), (3.1, 0.12, 0.17), "timber", 0, bevel=0.03, grain=0)     # front fascia
    box((2.83, 0.1, JOIST_TOP - 0.17), (0.12, 2.9, 0.17), "timber", 0, bevel=0.03, grain=1)      # +x fascia
    # four corner posts under the landing, braced on every face
    legs = [(-2.75, -2.75), (2.75, -2.75), (2.75, 2.75), (-2.75, 2.75)]
    for x, y in legs:
        box((x, y, (JOIST_TOP - 0.34) / 2), (0.17, 0.17, (JOIST_TOP - 0.34) / 2), "timber", 1, bevel=0.03, grain=2)
        if lod == 0:
            box((x, y, JOIST_TOP - 0.42), (0.19, 0.19, 0.06), "bronze", bevel=0.01)
            box((x, y, 0.06), (0.21, 0.21, 0.06), "bronze", bevel=0.01)
    zb, zt = 0.25, JOIST_TOP - 0.42
    for (xa, ya), (xb, yb) in zip(legs, legs[1:] + legs[:1]):
        beam_between(box, (xa, ya, zb), (xb, yb, zt), 0.18, 0.18, "timber", 1)
        if lod == 0:
            beam_between(box, (xb, yb, zb), (xa, ya, zt), 0.18, 0.18, "timber", 1)
    # railing on the front and +x edges, a heavier corner post where they meet
    railing_x(box, lod, -S, 2.85, (-2, 0))
    railing_y(box, lod, -2.85, S, (0, 2), x=2.85)
    rail_post(box, (2.85, RAIL_Y), lod, size=0.38)
    icicles(g, lod, rng, [(-2.1, -2.95, JOIST_TOP - 0.34), (0.4, -2.95, JOIST_TOP - 0.34), (2.95, -1.2, JOIST_TOP - 0.34),
                          (2.95, 1.4, JOIST_TOP - 0.34), (2.8, -2.95, JOIST_TOP - 0.34)])
    return g


def plank_broken(lod: int, rng) -> Geo:
    g = Geo()
    box = Box(g, rng, lod)
    x0 = -2.5
    brng = np.random.default_rng(SEED + 17)
    n = int(round(6.0 / PLANK_W))
    hanging = {3, 8}
    ends = []
    for i in range(n):
        ends.append(None if i in hanging else float(brng.uniform(0.9, 2.4)))
    planks(box, x0, 2.4, ends=ends, rng=rng)
    # splinters: a narrower, thinner tongue past each snapped plank end
    if lod == 0:
        for i, xe in enumerate(ends):
            if xe is None:
                continue
            yc = -3.0 + (i + 0.5) * PLANK_W
            ln = float(brng.uniform(0.12, 0.35))
            off = float(brng.uniform(-0.12, 0.12))
            box((xe + ln / 2, yc + off, DECK_TOP - PLANK_T * 0.55), (ln / 2, PLANK_W * 0.18, PLANK_T * 0.3), "plank", i % 6,
                bevel=0.01, grain=0)
    # two loose planks hang from the break, still nailed at one end
    for i in hanging:
        yc = -3.0 + (i + 0.5) * PLANK_W
        top = np.array([1.05, yc, DECK_TOP - 0.06])
        ang = math.radians(62 + 10 * (i % 2))
        tip = top + np.array([math.cos(ang) * 1.6, 0.0, -math.sin(ang) * 1.6])
        beam_between(box, top, tip, PLANK_T, PLANK_W - 0.01, "plank", i % 6, up=(0, 1, 0))
        box(((x0 + 1.05) / 2, yc, DECK_TOP - PLANK_T / 2), ((1.05 - x0) / 2, PLANK_W / 2 - 0.004, PLANK_T / 2), "plank", i % 6,
            bevel=0.022, grain=0)
    for x in (-1.5, 0.5):
        bracket(box, lod, x)
    # the third joist is snapped half way and droops; its strut is gone
    bracket(box, lod, 2.0, strut=False, snap_at=0.3)
    box((-0.7, -2.83, JOIST_TOP - 0.17), (1.8, 0.12, 0.17), "timber", 0, bevel=0.03, grain=0)   # fascia, snapped at 1.1
    box((-0.45, 2.88, JOIST_TOP - 0.14), (2.05, 0.12, 0.14), "timber", 1, bevel=0.03, grain=0)  # ledger to 1.6
    # railing: intact to x = 1.3, then the top rail dangles from its last post
    for px in (-1.5, 0.5):
        rail_post(box, (px, RAIL_Y), lod)
    box(((x0 + 1.3) / 2, RAIL_Y, DECK_TOP + 0.76), ((1.3 - x0) / 2, RAIL_HW, RAIL_HH), "lacquer", bevel=0.03, grain=0)
    box(((x0 + 1.3) / 2, RAIL_Y, DECK_TOP + 0.76 + RAIL_HH + 0.03), ((1.3 - x0) / 2, RAIL_HW + 0.025, 0.04), "snow",
        bevel=0.035, grain=0)
    box(((x0 + 0.95) / 2, RAIL_Y, DECK_TOP + 0.36), ((0.95 - x0) / 2, 0.065, 0.06), "lacquer", bevel=0.02, grain=0)
    beam_between(box, (1.28, RAIL_Y, DECK_TOP + 0.76), (1.75, RAIL_Y - 0.12, DECK_TOP - 0.25), 2 * RAIL_HH, 2 * RAIL_HW,
                 "lacquer", up=(0, 1, 0))
    box((-0.6, 2.72, DECK_TOP + 0.03), (1.9, 0.26, 0.05), "snow", bevel=0.045, grain=0)
    icicles(g, lod, rng, [(xe, -3.0 + (i + 0.5) * PLANK_W, DECK_TOP - PLANK_T) for i, xe in enumerate(ends)
                          if xe is not None and i % 3 == 0]
            + [(x, -3.12, JOIST_TOP - JOIST_H) for x in (-1.5, 0.5)])
    return g


def plank_post(lod: int, rng) -> Geo:
    g = Geo()
    box = Box(g, rng, lod)
    X = 2.6
    for s in (-1, 1):
        box((s * X, 0, 0.3), (0.5, 0.6, 0.3), "stone", bevel=0.05, grain=0)
        box((s * X, 0, 0.62), (0.52, 0.62, 0.035), "snow", bevel=0.03, grain=0)
        box((s * X, 0, 4.6), (0.3, 0.3, 4.0), "timber", 1, bevel=0.035, grain=2)
        if lod == 0:
            for z in (8.35, 4.6, 0.85):
                box((s * X, 0, z), (0.32, 0.32, 0.09), "bronze", bevel=0.01)
    box((0, 0, 8.8), (3.0, 0.35, 0.2), "timber", 0, bevel=0.03, grain=0)       # top beam (carries the deck)
    box((0, 0, 4.6), (2.9, 0.25, 0.2), "timber", 0, bevel=0.03, grain=0)       # middle beam
    box((0, 0, 4.83), (2.9, 0.28, 0.035), "snow", bevel=0.03, grain=0)
    # one big X between the middle and the top beam
    for s in (-1, 1):
        beam_between(box, (s * (X - 0.3), 0, 4.85), (-s * (X - 0.3), 0, 8.55), 0.28, 0.24, "timber", 1, up=(0, 1, 0))
    if lod == 0:
        box((0, 0, 6.7), (0.28, 0.16, 0.28), "bronze", bevel=0.01)
    icicles(g, lod, rng, [(x, 0.2, 4.4) for x in (-1.8, -0.6, 0.7, 1.9)])
    return g


# ───────────────────────────── painting ─────────────────────────────

def value_noise(h: int, w: int, cy: int, cx: int, rng) -> np.ndarray:
    """Bilinear value noise on an h × w canvas from a (cy + 1) × (cx + 1) random grid."""
    grid = rng.uniform(0, 1, (cy + 1, cx + 1))
    ys = np.linspace(0, cy, h, endpoint=False)
    xs = np.linspace(0, cx, w, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = grid[y0][:, x0]
    b = grid[y0][:, x0 + 1]
    c = grid[y0 + 1][:, x0]
    d = grid[y0 + 1][:, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def fbm(h, w, cy, cx, rng, octaves: int = 3) -> np.ndarray:
    out, amp, tot = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(h, w, cy * 2 ** o, cx * 2 ** o, rng)
        tot += amp
        amp *= 0.5
    return out / tot


def put(atlas: Atlas, rect, rgb, h=None, ao=None, rough=None, metal=None):
    sl, s, t, _ = atlas.region(rect)
    atlas.rgb[sl] = rgb
    atlas.a[sl] = 1.0
    if h is not None:
        atlas.h[sl] = h
    if ao is not None:
        atlas.ao[sl] = ao
    atlas.rough[sl] = rough
    atlas.metal[sl] = metal


def wood(atlas: Atlas, rect, rng, base, dark, light, nails=(), snow: float = 0.0, seam: bool = True):
    """Weathered timber along u: long grain streaks, a few knots, dark seams top / bottom, nail heads at u in nails,
    optional snow dusting (snow > 0) heavier toward the strip's top edge (v = 1)."""
    sl, s, t, (w, h) = atlas.region(rect)
    grain = fbm(h, w, 14, 3, rng, 3)
    streak = 0.5 + 0.5 * np.sin((t * 9.0 + grain * 3.0) * math.pi * 2)
    tone = fbm(h, w, 2, 12, rng, 2)
    col = dark + (base - dark) * (0.55 + 0.45 * streak[..., None]) + (light - base) * smoothstep(0.55, 0.85, tone)[..., None]
    hgt = 0.25 * streak
    if seam:
        edge = np.minimum(t, 1 - t)
        e = smoothstep(0.0, 0.07, edge)
        col = col * (0.55 + 0.45 * e[..., None])
        hgt = hgt * e - 0.4 * (1 - e)
    # knots
    for _ in range(int(w / 420)):
        kx, ky = rng.uniform(0.02, 0.98), rng.uniform(0.25, 0.75)
        rr = (((s - kx) * w / 9) ** 2 + ((t - ky) * h / 6) ** 2)
        m = rr < 1
        col = np.where(m[..., None], col * (0.6 + 0.3 * rr[..., None]), col)
        hgt = np.where(m, hgt - 0.2 * (1 - rr), hgt)
    # nail heads (pairs) where the joists cross
    for u in nails:
        for v in (0.3, 0.7):
            dd = np.hypot((s - u) * w, (t - v) * h)
            m = dd < 2.4
            col = np.where(m[..., None], hexc("#4a4440") + 0.12 * (dd[..., None] < 1.0), col)
            hgt = np.where(m, hgt + 0.5 * (1 - dd / 2.4), hgt)
    if snow > 0:
        n = fbm(h, w, 2, 12, rng, 3)
        cover = smoothstep(0.62 - snow * 0.5, 0.7 - snow * 0.45, n * 0.8 + t * 0.4 * snow)
        sc = hexc("#eef3f8") - 0.08 * (1 - n[..., None])
        col = col * (1 - cover[..., None]) + sc * cover[..., None]
        hgt = hgt * (1 - cover) + 0.3 * cover
    rough = np.full((h, w), 0.86)
    if snow > 0:
        rough = rough * (1 - cover) + 0.92 * cover
    put(atlas, rect, col, hgt, 0.85 + 0.15 * tone, rough, 0.0)


def paint_kit(atlas: Atlas, rng, nails) -> None:
    atlas.rough = np.full_like(atlas.ao, 0.85)
    atlas.metal = np.zeros_like(atlas.ao)
    base, dark, light = hexc("#6e5139"), hexc("#3f2c1f"), hexc("#8f6c4c")
    for k in range(8):
        wood(atlas, PLANK[k], np.random.default_rng(SEED * 13 + k), base * (0.94 + 0.06 * (k % 3)), dark, light, nails,
             snow=(0.12 if k < 6 else (0.55 if k == 6 else 0.85)))
    for k in range(2):
        wood(atlas, TIMBER[k], np.random.default_rng(SEED * 17 + k), hexc("#5a4231"), hexc("#33241a"), hexc("#7a5b40"))
    # end grain: rings
    sl, s, t, (w, h) = atlas.region(END)
    ring = 0.5 + 0.5 * np.sin(np.hypot((s % 0.25 - 0.125) * 4 * w / h, t - 0.5) * 60)
    put(atlas, END, hexc("#5e4632") + (hexc("#7d6047") - hexc("#5e4632")) * ring[..., None], 0.2 * ring, 0.8, 0.9, 0.0)
    # faded vermilion lacquer, worn lighter on the edges, a few scratches through to dark wood
    sl, s, t, (w, h) = atlas.region(LACQUER)
    n = fbm(h, w, 3, 30, rng, 3)
    col = hexc("#a3392a") + (hexc("#c95a3e") - hexc("#a3392a")) * smoothstep(0.4, 0.8, n)[..., None]
    edge = smoothstep(0.0, 0.12, np.minimum(t, 1 - t))
    col = col * (0.8 + 0.2 * edge[..., None]) + hexc("#e08a60") * 0.15 * (1 - edge[..., None])
    scr = fbm(h, w, 2, 60, rng, 2)
    m = scr > 0.78
    col = np.where(m[..., None], hexc("#4a2e20"), col)
    put(atlas, LACQUER, col, 0.1 * n - 0.2 * m, 0.95, 0.6, 0.0)
    # verdigris bronze with rivets
    sl, s, t, (w, h) = atlas.region(BRONZE)
    n = fbm(h, w, 4, 24, rng, 3)
    col = hexc("#6e5a36") + (hexc("#4f8f7b") - hexc("#6e5a36")) * smoothstep(0.35, 0.65, n)[..., None]
    rv = (np.hypot(((s * w) % 24) - 12, ((t * h) % 24) - 12) < 3.5)
    col = np.where(rv[..., None], hexc("#9a8150"), col)
    put(atlas, BRONZE, col, 0.4 * rv + 0.1 * n, 0.9, 0.45 + 0.2 * (1 - n), 0.55)
    # snow: bright top fading to a cool blue-grey underside
    sl, s, t, (w, h) = atlas.region(SNOW)
    n = fbm(h, w, 4, 16, rng, 3)
    col = hexc("#cfdbea") + (hexc("#f6f9fc") - hexc("#cfdbea")) * smoothstep(0.1, 0.8, t * 0.7 + n * 0.3)[..., None]
    put(atlas, SNOW, col, 0.3 * n, 1.0, 0.92, 0.0)
    # ice
    sl, s, t, (w, h) = atlas.region(ICE)
    n = fbm(h, w, 3, 6, rng, 2)
    col = hexc("#8fcbe8") + (hexc("#dff3fb") - hexc("#8fcbe8")) * (t * 0.6 + n * 0.4)[..., None]
    put(atlas, ICE, col, 0.2 * n, 1.0, 0.25, 0.0)
    # stone footing
    sl, s, t, (w, h) = atlas.region(STONE)
    n = fbm(h, w, 6, 20, rng, 4)
    col = hexc("#6f757d") + (hexc("#a2a8ae") - hexc("#6f757d")) * n[..., None]
    put(atlas, STONE, col, 0.5 * n, 0.85 + 0.15 * n, 0.92, 0.0)


# ───────────────────────────── recipes ─────────────────────────────

def nails_for(xs):
    """Plank strips are world-aligned (u = (x + 4) / 8 on every piece), so nails sit where that piece's joists are."""
    return [(x + 4.0) / 8.0 for x in xs]


RECIPES = {
    # builder, joist x positions (nails on the planks), mat options
    "plank_straight": (plank_straight, nails_for((-3, -1, 1, 3))),
    "plank_corner": (plank_corner, nails_for((-2, 0, 2))),
    "plank_broken": (plank_broken, nails_for((-1.5, 0.5, 2.0))),
    "plank_post": (plank_post, ()),
}

builder, nails = RECIPES[P["recipe"]]
export_asset(P, builder, lambda atlas, rng: paint_kit(atlas, rng, nails),
             {"roughness": 0.85, "alpha": False, "keep_xy": True, "ground": (0.86, 0.89, 0.93)})
