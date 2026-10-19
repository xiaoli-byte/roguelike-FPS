"""Procedural pet attachment (headless Blender): 精卫的火石、应龙的宝珠 from a code recipe → runtime GLB, no provider model.

Tripo got both small parts wrong (the pebble came out as a slab with glow on one edge, the pearl as an egg), and both are
simple enough to make from code with full control over shape, crack layout and glow:

  lava_pebble  flattened round stone (thin axis = Y, so the flat face looks forward): warped 3D Voronoi plates on the
               ellipsoid; cracks = bands around the cells' bisector planes (some borders closed, some fading out, smooth-min
               widened junctions); plate rims rounded down into the crack; shallow planar chisel facets per plate (the
               hand-carved look of the design sheet); glowing groove (yellow core → orange → red edge) with a warm spill on
               the rock next to it, light convex edges, darker hollows.
  cloud_pearl  perfect sphere, golden glow with raised white 祥云 relief (round lobes + spiral curls + tapering tails).

Steps:
  1. high-poly surface: icosphere (sub 8) pushed by the recipe field in numpy; colour / emission / ORM as point attributes;
  2. low-poly: the same field on a coarser sphere, collapse-decimated to the LOD0 budget, smart UV;
  3. Cycles bakes high → low: tangent normal, then emit bakes of the attributes → BC / N / ORM (R AO, G rough, B metal) / E;
  4. LOD1 by collapse decimation (UVs follow); GLB export (Draco + WebP), .blend, metrics;
  5. review renders of LOD0 (front / left / back / right / three-quarter, transparent film) into review_dir.
Deterministic for a given seed. Params (from build_hero_part.py): asset_id, procedural, seed, size, texture, lod_tris,
lod_distance, out_glb, out_blend, review_dir.
"""
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from bl_common import VIEWS, args, finish, log  # noqa: E402

P = args()
NAME = P["asset_id"]
SHORT = NAME.split("_", 1)[1]
RECIPE = P["procedural"]
SEED = int(P.get("seed", 1))
TEX = int(P["texture"])
SIZE = float(P["size"])
T0 = time.time()
RESULT: dict = {"recipe": RECIPE, "seed": SEED}
bpy.ops.wm.read_factory_settings(use_empty=True)


# ───────────────────────────── numpy helpers ─────────────────────────────
def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smin(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    """Polynomial smooth minimum (rounds the corner where two distance fields meet)."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1 - h)


def lerp(a, b, t):
    """Colour lerp: a / b are RGB triples or N×3 arrays, t a scalar or one weight per point."""
    t = np.asarray(t, float)
    return a + (b - a) * (t[:, None] if t.ndim == 1 else t)


def ramp(t: np.ndarray, stops) -> np.ndarray:
    ts = np.array([s[0] for s in stops])
    cs = np.array([s[1] for s in stops], float)
    return np.stack([np.interp(t, ts, cs[:, c]) for c in range(3)], 1)


class Waves:
    """Smooth band-limited 3D noise: normalised sum of random plane waves (std ≈ 1, wavelength ≈ 2π / freq)."""

    def __init__(self, rng, freq: float, n: int = 12):
        self.k = unit(rng.normal(size=(n, 3))) * (freq * rng.uniform(0.7, 1.3, (n, 1)))
        self.ph = rng.uniform(0, 2 * np.pi, n)
        self.s = math.sqrt(2.0 / n)

    def __call__(self, x: np.ndarray) -> np.ndarray:
        return np.sin(x @ self.k.T + self.ph).sum(1) * self.s


def icosphere(sub: int):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    me = bpy.data.meshes.new("_ico")
    bm.to_mesh(me)
    bm.free()
    V = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", V)
    me.calc_loop_triangles()
    F = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", F)
    bpy.data.meshes.remove(me)
    return unit(V.reshape(-1, 3)), F.reshape(-1, 3)


def fps(rng, n: int, scale: np.ndarray, tries: int = 4000) -> np.ndarray:
    """n well-spread unit directions (farthest-point sampling, distances measured on the scaled surface)."""
    cand = unit(rng.normal(size=(tries, 3)))
    S = cand * scale
    pick = [0]
    d = np.linalg.norm(S - S[0], axis=1)
    for _ in range(n - 1):
        i = int(d.argmax())
        pick.append(i)
        d = np.minimum(d, np.linalg.norm(S - S[i], axis=1))
    return cand[pick]


def edges(F: np.ndarray):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    return e[:, 0], e[:, 1]


def neighbour_mean(A: np.ndarray, I, J, n: int) -> np.ndarray:
    cnt = np.bincount(I, minlength=n).astype(float)
    if A.ndim == 1:
        return np.bincount(I, weights=A[J], minlength=n) / cnt
    return np.stack([np.bincount(I, weights=A[J, c], minlength=n) for c in range(A.shape[1])], 1) / cnt[:, None]


def vertex_normals(X: np.ndarray, F: np.ndarray) -> np.ndarray:
    fn = np.cross(X[F[:, 1]] - X[F[:, 0]], X[F[:, 2]] - X[F[:, 0]])
    N = np.zeros_like(X)
    for c in range(3):
        N[:, c] = sum(np.bincount(F[:, k], weights=fn[:, c], minlength=len(X)) for k in range(3))
    return unit(N)


# ───────────────────────────── recipes ─────────────────────────────
LAVA = [(0.0, (0.78, 0.17, 0.03)), (0.28, (1.0, 0.40, 0.05)), (0.62, (1.0, 0.68, 0.16)), (1.0, (1.0, 0.90, 0.52))]


class LavaPebble:
    E = np.array([1.0, 0.58, 0.94])   # x width, y thickness (flat face forward), z height
    K = 11                            # Voronoi cells (rock plates)

    def __init__(self, rng):
        K = self.K
        self.rng = rng
        self.seeds = fps(rng, K, self.E) * self.E
        self.warp = [Waves(rng, 3.0) for _ in range(3)]
        self.width_n = Waves(rng, 5.0)
        self.fade_n = Waves(rng, 4.5)
        self.shape_n = Waves(rng, 1.5)
        self.tone_n = Waves(rng, 6.0)
        m = np.triu(rng.uniform(0.6, 1.25, (K, K)), 1)
        self.m = m + m.T
        sym = lambda b: np.triu(b, 1) | np.triu(b, 1).T  # noqa: E731
        closed = sym(rng.random((K, K)) < 0.13)
        self.fading = sym(rng.random((K, K)) < 0.3)
        # Pass 1 on a coarse sphere: which cells touch (only those borders can close), then each cell's chisel planes.
        U, _ = icosphere(5)
        b = self._base(U, np.zeros((K, K)))
        adj = np.zeros((K, K), bool)
        near = b["edge_raw"] < 0.06
        adj[b["a"][near], b["nb"][near]] = True
        adj |= adj.T
        closed &= adj
        self.m[closed] = 0.0
        RESULT["closed_borders"] = int(np.triu(closed).sum())
        RESULT["fading_borders"] = int(np.triu(self.fading & adj & ~closed).sum())
        b = self._base(U, self.m)
        self.planes = []
        for c in range(K):
            sel = (b["a"] == c) & (b["near"] < 0.2)
            if sel.sum() < 8:
                sel = b["a"] == c
            Pp = b["P"][sel]
            n_c = unit(unit(b["Q"][sel] / self.E ** 2).mean(0))
            ns, ds = [], []
            for _ in range(int(rng.integers(6, 10))):
                n = unit(n_c + rng.normal(size=3) * 0.55)
                if n @ n_c < 0.45:
                    n = unit(n + n_c)
                ns.append(n)
                ds.append(float((Pp @ n).max()) - rng.uniform(0.022, 0.06))
            self.planes.append((np.array(ns), np.array(ds)))
        self.tone = rng.uniform(-0.03, 0.03, K)

    def chisel(self, X: np.ndarray, cell: np.ndarray):
        """Planar cuts of each point's cell: scale factor ≤ 1 along the ray from the centre, and the facet index."""
        k = np.ones(len(X))
        fid = np.full(len(X), -1)
        for c in np.unique(cell):
            sel = np.nonzero(cell == c)[0]
            Nn, Dd = self.planes[int(c)]
            proj = X[sel] @ Nn.T
            ratio = np.where(proj > 1e-6, Dd[None] / np.maximum(proj, 1e-6), 9.0)
            j = ratio.argmin(1)
            r = ratio[np.arange(len(sel)), j]
            k[sel] = np.minimum(1.0, r)
            fid[sel] = np.where(r < 1.0, j, -1)
        return k, fid

    def _base(self, U: np.ndarray, m: np.ndarray) -> dict:
        """Per border b of the point's cell a: strength s = m[a,b] (× fade on fading borders) scales the crack width AND
        its depth, so a crack that fades out narrows to a hairline and closes without leaving a crease. Grooves of
        neighbouring borders merge by smooth-min (fatter junctions)."""
        S, K = self.seeds, self.K
        Q = U * self.E
        Qw = Q + 0.075 * np.stack([w(Q) for w in self.warp], 1)
        D = np.linalg.norm(Qw[:, None, :] - S[None], axis=2)
        a = D.argmin(1)
        Sa = S[a]
        fade = np.clip(0.5 + 0.9 * self.fade_n(Qw), 0.0, 1.0)
        w0 = 0.052 * np.clip(1 + 0.4 * self.width_n(Qw), 0.4, None)
        Bv, R, G = 0.035, 0.2, 0.065
        n = len(U)
        raw = np.full(n, 9.0)
        nb = np.zeros(n, int)
        h = np.zeros(n)
        c = np.zeros(n)
        mix = np.zeros(n)
        warm = np.zeros(n)
        near = np.zeros(n)
        for b in range(K):
            dv = S[b] - Sa
            L = np.linalg.norm(dv, axis=1)
            own = L < 1e-6
            dist = -((Qw - (Sa + S[b]) / 2) * dv).sum(1) / np.maximum(L, 1e-6)
            dist[own] = 9.0
            closer = dist < raw
            raw = np.where(closer, dist, raw)
            nb = np.where(closer, b, nb)
            mab = m[a, b]
            st = np.clip(mab * np.where(self.fading[a, b], fade, 1.0), 0.0, 1.25)
            st[own] = 0.0
            amp = np.minimum(1.0, st / 0.7)
            w = w0 * st
            eb = dist - w
            t = np.clip(dist / np.maximum(w, 1e-6), 0.0, 1.0)
            hb = np.where(eb >= 0, -Bv * amp * (1 - np.clip(eb / R, 0, 1)) ** 2, -Bv * amp - G * amp * (1 - t * t))
            h = smin(h, hb, 0.012)
            vis = smoothstep(0.003, 0.012, w)            # hairline cracks fade out instead of breaking into dashes
            c = np.maximum(c, (1 - t) * vis)
            mix = np.maximum(mix, smoothstep(0.004, -0.008, eb) * vis)
            warm = np.maximum(warm, (1 - smoothstep(0.0, 0.2, eb)) * amp)
            near = np.maximum(near, (1 - smoothstep(0.0, 0.06, eb)) * amp)
        h = h + 0.022 * self.shape_n(Q)
        return {"Q": Q, "Qw": Qw, "a": a, "nb": nb, "edge_raw": raw, "c": c, "mix": mix, "warm": warm, "near": near,
                "P": Q * (1 + h)[:, None]}

    def surface(self, U, F, smooth_iters: int, colours: bool):
        b = self._base(U, self.m)
        X = b["P"].copy()
        cell, nb = b["a"], b["nb"]
        ka, facet = self.chisel(X, cell)
        kb, _ = self.chisel(X, nb)
        beta = 0.5 * (1 - smoothstep(0.0, 0.06, b["edge_raw"]))   # the neighbour's facets blend in at the border
        k = (1 - beta) * ka + beta * kb
        X *= (1 - (1 - k) * (1 - b["near"]))[:, None]           # no chisel on the crack walls / in the groove
        I, J = edges(F)
        for _ in range(smooth_iters):
            X = X + 0.5 * (neighbour_mean(X, I, J, len(X)) - X)
        if not colours:
            return X, None
        # rock: warm dark grey, per-plate / per-facet tone (hand-painted facets), light convex edges, darker hollows
        tone = (1 - beta) * self.tone[cell] + beta * self.tone[nb]
        ftone = np.where(facet >= 0, ((cell * 7 + facet * 13) % 11) / 10.0 - 0.5, 0.0) * 0.025 * (1 - 2 * beta)
        v = 0.39 + tone + ftone + 0.012 * self.tone_n(b["Q"])
        rock = v[:, None] * np.array([1.04, 0.985, 0.95])
        N = vertex_normals(X, F)
        h_edge = float(np.linalg.norm(X[I] - X[J], axis=1).mean())
        conv = -((neighbour_mean(X, I, J, len(X)) - X) * N).sum(1) / (h_edge * h_edge)
        for _ in range(4):
            conv = 0.5 * conv + 0.5 * neighbour_mean(conv, I, J, len(X))
        conv = conv / max(1e-9, float(np.percentile(np.abs(conv[b["near"] < 0.1]), 97)))
        rock = rock + (0.085 * smoothstep(0.15, 0.9, conv) - 0.05 * smoothstep(0.15, 0.9, -conv))[:, None]
        warm = b["warm"]                                 # glow spill on the rock next to a crack
        rock = lerp(rock, np.array([0.66, 0.30, 0.12]), 0.6 * warm ** 2)
        lava = ramp(b["c"], LAVA)                        # c: 0 at the crack wall, 1 on its centre line
        mix = b["mix"]
        bc = lerp(rock, lava, mix)
        em = lava * mix[:, None] + np.array([1.0, 0.36, 0.06]) * (0.32 * warm ** 3 * (1 - mix))[:, None]
        ao = 1 - 0.32 * b["near"] * (1 - mix)
        rough = 0.86 - 0.3 * mix
        RESULT["crack_area"] = round(float((mix > 0.5).mean()), 3)
        return X, {"bc": bc, "em": em, "orm": np.stack([ao, rough, np.zeros_like(ao)], 1)}


# 祥云 motif templates in local units (motif ≈ 2.4 wide): lobes (x, y, r, spiral turns or 0), tail polyline + radii
CLOUDS = [
    {"lobes": [(0.0, 0.02, 0.42, 1.6), (0.50, -0.14, 0.30, 1.1), (-0.49, -0.15, 0.29, 1.1), (0.15, 0.40, 0.23, 0.0)],
     "tail": [(-0.30, -0.36), (-0.70, -0.52), (-1.05, -0.40), (-1.25, -0.18)], "tail_r": (0.17, 0.06)},
    {"lobes": [(0.0, 0.0, 0.40, 1.5), (0.46, 0.20, 0.26, 1.0), (-0.36, 0.26, 0.20, 0.0)],
     "tail": [(0.20, -0.34), (0.60, -0.46), (1.00, -0.38), (1.22, -0.16)], "tail_r": (0.16, 0.06)},
    {"lobes": [(0.0, 0.0, 0.34, 1.4), (0.38, -0.08, 0.22, 0.9), (-0.36, -0.06, 0.22, 0.9)],
     "tail": [(-0.10, -0.30), (-0.45, -0.42), (-0.80, -0.30)], "tail_r": (0.14, 0.05)},
]


def seg_dist(p: np.ndarray, a, b) -> tuple[np.ndarray, np.ndarray]:
    a, b = np.asarray(a), np.asarray(b)
    ab = b - a
    t = np.clip(((p - a) @ ab) / float(ab @ ab), 0.0, 1.0)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1), t


class CloudPearl:
    K = 9

    def __init__(self, rng):
        self.c = fps(rng, self.K, np.ones(3))
        self.scale = rng.uniform(0.60, 0.70, self.K)
        self.rot = rng.uniform(0, 2 * np.pi, self.K)
        self.flip = rng.random(self.K) < 0.5
        self.tpl = rng.integers(0, len(CLOUDS), self.K)
        self.spin = rng.uniform(0, 2 * np.pi, (self.K, 4))
        self.nacre = Waves(rng, 2.2)
        self.sheen = Waves(rng, 4.0)

    def motif(self, xy: np.ndarray, k: int):
        """→ (cloud mask with soft rounded edge, spiral groove 0..1) in local motif units."""
        tpl = CLOUDS[int(self.tpl[k])]
        sd = np.full(len(xy), 9.0)
        for (cx, cy, r, _) in tpl["lobes"]:
            sd = smin(sd, np.linalg.norm(xy - (cx, cy), axis=1) - r, 0.10)
        pts, (r0, r1) = tpl["tail"], tpl["tail_r"]
        L = np.cumsum([0] + [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)])
        for i in range(len(pts) - 1):
            dd, t = seg_dist(xy, pts[i], pts[i + 1])
            frac = (L[i] + t * (L[i + 1] - L[i])) / L[-1]
            sd = smin(sd, dd - (r0 + (r1 - r0) * frac), 0.08)
        mask = smoothstep(0.0, 0.06, -sd)
        groove = np.zeros(len(xy))
        for li, (cx, cy, r, turns) in enumerate(tpl["lobes"]):
            if turns <= 0:
                continue
            rel = xy - (cx, cy)
            rho = np.linalg.norm(rel, axis=1)
            alpha = np.mod(np.arctan2(rel[:, 1], rel[:, 0]) - self.spin[k, li], 2 * np.pi)
            span = 2 * np.pi * turns
            gd = np.full(len(xy), 9.0)
            for j in range(int(math.ceil(turns)) + 1):
                a2 = alpha + 2 * np.pi * j
                rs = r * (0.10 + 0.74 * a2 / span)
                gd = np.where(a2 <= span, np.minimum(gd, np.abs(rho - rs)), gd)
            groove = np.maximum(groove, (1 - smoothstep(0.018, 0.05, gd)) * (rho < r * 0.95))
        return mask, groove * mask

    def surface(self, U, F, smooth_iters: int, colours: bool):
        mask = np.zeros(len(U))
        groove = np.zeros(len(U))
        for k in range(self.K):
            c = self.c[k]
            ref = np.array([0.0, 0.0, 1.0]) if abs(c[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
            t1 = unit(np.cross(ref, c))
            t2 = np.cross(c, t1)
            ca, sa = math.cos(self.rot[k]), math.sin(self.rot[k])
            t1, t2 = ca * t1 + sa * t2, -sa * t1 + ca * t2
            cosang = U @ c
            sel = np.nonzero(cosang > math.cos(min(2.6, self.scale[k] * 1.6)))[0]
            th = np.arccos(np.clip(cosang[sel], -1, 1))
            dirs = U[sel] - np.outer(cosang[sel], c)
            dirs = dirs / np.maximum(np.linalg.norm(dirs, axis=1, keepdims=True), 1e-9)
            xy = np.stack([dirs @ t1, dirs @ t2], 1) * (th / self.scale[k])[:, None]
            if self.flip[k]:
                xy[:, 0] *= -1
            m, g = self.motif(xy, k)
            take = m > mask[sel]
            mask[sel] = np.where(take, m, mask[sel])
            groove[sel] = np.where(take, g, groove[sel])
        h = 0.016 * mask - 0.009 * groove
        X = U * (1 + h)[:, None]
        if not colours:
            return U.copy(), None                          # low-poly silhouette = the perfect sphere
        nac = 0.5 + 0.35 * self.nacre(U)
        gold = lerp(np.array([1.0, 0.84, 0.46]), np.array([1.0, 0.93, 0.70]), nac)
        cloud = lerp(np.array([1.0, 0.92, 0.76]), np.array([1.0, 0.98, 0.93]), smoothstep(0.3, 1.0, mask))
        cloud = cloud + 0.02 * self.sheen(U)[:, None]
        bc = lerp(gold, cloud, mask)
        bc = lerp(bc, np.array([0.97, 0.86, 0.64]), 0.55 * groove)
        em = lerp(gold * 0.65, cloud * 0.62, mask)
        em = lerp(em, np.array([1.0, 0.82, 0.48]) * 0.55, 0.55 * groove)
        ao = 1 - 0.3 * groove - 0.12 * mask * (1 - smoothstep(0.0, 0.6, mask))
        rough = 0.28 + 0.17 * mask
        RESULT["cloud_area"] = round(float((mask > 0.5).mean()), 3)
        return X, {"bc": bc, "em": em, "orm": np.stack([ao, rough, np.zeros_like(ao)], 1)}


# ───────────────────────────── mesh objects ─────────────────────────────
def make_obj(name: str, X: np.ndarray, F: np.ndarray, attrs: dict | None = None):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(X))
    me.vertices.foreach_set("co", X.astype(np.float32).ravel())
    me.loops.add(F.size)
    me.loops.foreach_set("vertex_index", F.astype(np.int32).ravel())
    me.polygons.add(len(F))
    me.polygons.foreach_set("loop_start", np.arange(0, F.size, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.polygons.foreach_set("use_smooth", np.ones(len(F), bool))
    for k, v in (attrs or {}).items():
        a = me.color_attributes.new(k, "FLOAT_COLOR", "POINT")
        rgba = np.ones((len(X), 4), np.float32)
        rgba[:, :3] = np.clip(v, 0.0, None)
        a.data.foreach_set("color", rgba.ravel())
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def activate(o, others=()) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for x in others:
        x.select_set(True)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def tris(o) -> int:
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, budget: int) -> None:
    n = tris(o)
    if n <= budget:
        return
    d = o.modifiers.new("dec", "DECIMATE")
    d.ratio = budget / n * 0.98
    activate(o)
    bpy.ops.object.modifier_apply(modifier="dec")


# ───────────────────────────── 1. surfaces ─────────────────────────────
t = time.time()
rng = np.random.default_rng(SEED)
recipe = {"lava_pebble": LavaPebble, "cloud_pearl": CloudPearl}[RECIPE](rng)
U8, F8 = icosphere(9)
X8, attrs = recipe.surface(U8, F8, smooth_iters=5, colours=True)
lo, hi = X8.min(0), X8.max(0)
scale = SIZE / float((hi - lo).max())
centre = (lo + hi) / 2
high = make_obj("high", (X8 - centre) * scale, F8, attrs)
U6, F6 = icosphere(6)
X6, _ = recipe.surface(U6, F6, smooth_iters=0, colours=False)
low = make_obj(f"{NAME}_LOD0", (X6 - centre) * scale, F6)
decimate(low, int(P["lod_tris"][0]))
dims = ((hi - lo) * scale).round(4).tolist()
log(f"高模 {len(F8)} 面，低模 {tris(low)} 面，尺寸 {dims} m（{time.time() - t:.0f} 秒）")
RESULT["dims_m"] = dims

activate(low)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02)
bpy.ops.object.mode_set(mode="OBJECT")

# ───────────────────────────── 2. bakes ─────────────────────────────
t = time.time()
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
scene.cycles.samples = 16

src = bpy.data.materials.new("bake_src")
src.use_nodes = True
snt = src.node_tree
for n in list(snt.nodes):
    snt.nodes.remove(n)
attr = snt.nodes.new("ShaderNodeAttribute")
attr.attribute_type = "GEOMETRY"
emis = snt.nodes.new("ShaderNodeEmission")
outn = snt.nodes.new("ShaderNodeOutputMaterial")
snt.links.new(attr.outputs["Color"], emis.inputs["Color"])
snt.links.new(emis.outputs["Emission"], outn.inputs["Surface"])
high.data.materials.append(src)

mat = bpy.data.materials.new(f"M_{SHORT}")
mat.use_nodes = True
mat.use_backface_culling = True                       # closed solid → glTF doubleSided false (Unity culls back faces)
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
low.data.materials.append(mat)
target = nt.nodes.new("ShaderNodeTexImage")
R = SIZE / 2
baked = {}
for role, kind, key in (("N", "NORMAL", None), ("BC", "EMIT", "bc"), ("E", "EMIT", "em"), ("ORM", "EMIT", "orm")):
    img = bpy.data.images.new(f"_bake_{role}", TEX, TEX, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    target.image = img
    nt.nodes.active = target
    if key:
        attr.attribute_name = key
    activate(low, [high])
    kw = {"normal_space": "TANGENT"} if kind == "NORMAL" else {}
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.08 * R, max_ray_distance=0.3 * R,
                        margin=8, use_clear=True, **kw)
    baked[role] = np.array(img.pixels[:], np.float32).reshape(TEX, TEX, 4)
    bpy.data.images.remove(img)
nt.nodes.remove(target)
log(f"烘焙 N / BC / E / ORM（{time.time() - t:.0f} 秒）")

# final 8-bit images: BC / E hold the painted (sRGB) values as they are; N / ORM are data
imgs = {}
for role in ("BC", "N", "ORM", "E"):
    im = bpy.data.images.new(f"T_{SHORT}_{role}", TEX, TEX, alpha=False)
    im.colorspace_settings.name = "sRGB" if role in ("BC", "E") else "Non-Color"
    px = np.clip(baked[role], 0.0, 1.0)
    px[..., 3] = 1.0
    im.pixels.foreach_set(px.ravel())
    im.pack()
    imgs[role] = im
RESULT["textures"] = {"size": TEX, **{f"{r}_mean": [round(float(x), 3) for x in baked[r][..., :3].reshape(-1, 3).mean(0)]
                                      for r in ("BC", "E", "ORM")}}


def tex_node(role: str, y: float):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = imgs[role]
    n.location = (-700, y)
    return n


nt.links.new(tex_node("BC", 300).outputs["Color"], bsdf.inputs["Base Color"])
nmap = nt.nodes.new("ShaderNodeNormalMap")
nmap.uv_map = low.data.uv_layers.active.name
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
nt.links.new(tex_node("E", -600).outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0

bpy.data.objects.remove(high, do_unlink=True)

# ───────────────────────────── 3. LODs + export ─────────────────────────────
lods = [low]
for i, budget in enumerate(P["lod_tris"]):
    o = low
    if i:
        o = low.copy()
        o.data = low.data.copy()
        o.name = f"{NAME}_LOD{i}"
        bpy.context.scene.collection.objects.link(o)
        decimate(o, int(budget))
        lods.append(o)
    o["lod"] = i
    o["lod_distance"] = P["lod_distance"][i]
lod_tris = [tris(o) for o in lods]
log(f"LOD {lod_tris}")
activate(lods[0], lods[1:])
bpy.ops.export_scene.gltf(filepath=P["out_glb"], export_format="GLB", use_selection=True, export_apply=True,
                          export_image_format="WEBP", export_draco_mesh_compression_enable=True, export_extras=True,
                          export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=P["out_blend"])

# ───────────────────────────── 4. review renders (LOD0) ─────────────────────────────
t = time.time()
rd = Path(P["review_dir"])
rd.mkdir(parents=True, exist_ok=True)
for o in lods[1:]:
    o.hide_render = True
scene.cycles.samples = 64
scene.render.resolution_x = scene.render.resolution_y = 640
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("review")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.55, 0.57, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
scene.world = world
sun = bpy.data.objects.new("key", bpy.data.lights.new("key", "SUN"))
sun.data.energy = 3.0
sun.data.angle = math.radians(8)
sun.rotation_euler = Vector((-0.35, 0.75, -0.6)).to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = SIZE * 1.3
cam.data.clip_end = 10
scene.collection.objects.link(cam)
scene.camera = cam
shots = {**{k: VIEWS[k][0] for k in ("front", "left", "back", "right")},
         "three_quarter": Vector((-0.55, 1.0, -0.4)).normalized()}
for key, d in shots.items():
    cam.location = -d * SIZE * 4
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(rd / f"{key}.png")
    bpy.ops.render.render(write_still=True)
log(f"审查图 {len(shots)} 张（{time.time() - t:.0f} 秒）")

finish(P, {**RESULT, "lod_tris": lod_tris, "source_tris": len(F8), "size": SIZE, "review": sorted(shots),
           "seconds": round(time.time() - T0, 1)})
