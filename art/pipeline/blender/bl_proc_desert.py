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
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from bl_common import args  # noqa: E402
from bl_proc_common import (Atlas, Geo, bezier, card, export_asset, hexc, rot_z, seg_dist, smoothstep,  # noqa: E402
                            tube, unit)

P = args()
SEED = int(P.get("seed", 1))


# ───────────────────────────── painting ─────────────────────────────

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

spec, painter, mat_opts = RECIPES[P["recipe"]]
export_asset(P, lambda i, rng: (clump_bush if spec.get("builder") == "clump" else plant)(i, spec, rng), painter, mat_opts)
