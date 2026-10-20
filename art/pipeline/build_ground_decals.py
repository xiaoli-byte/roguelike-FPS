"""Ground decals for the chapter-1 maps (ART3 / ART4): painted procedurally, published straight into the manifest.

  python build_ground_decals.py [ID ...]          (default: every decal)

A decal is a flat cut-out quad grid lying 2 cm above its origin, with its own BC (alpha = cut-out mask) / N / ORM
painted here in numpy, so no provider credits and no concept stage. Level code lays it on flattened ground (the
1-1 road spline, the 1-4 spring bed) and may rotate / scale it; the ruts tile along their length (+Z).

  SM_Decal_DesertCartRuts    8 m strip of two cart ruts (1.6 m gauge) with low sand berms, tiles along Z
  SM_Decal_DesertCrackedBed  8 x 8 m patch of curled dry-mud plates whose outline follows the cracks

Material is alphaMode MASK (StylizedLit cut-out in Unity). The GLB is written directly (WebP textures). Two LODs:
the subdivided grid and a 1 x 2 quad strip past LOD_DISTANCE (a single-mesh FBX collapses onto the prefab root in
Unity and the LODGroup / QA then find no `_LOD0` renderer); the manifest entry carries generator.tool = "procedural" and the paint parameters. Deterministic: the
same parameters give the same bytes. Then `unity_export.py <ID>` and `bridge.sh sync`.
"""
from __future__ import annotations

import io
import json
import struct
import sys

import numpy as np
from PIL import Image

from lib.config import CFG, ROOT
from lib.state import now, sha256

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RUNTIME = ROOT / CFG.paths["runtime"] / "props"
MANIFEST = ROOT / CFG.paths["manifest"]
LIFT = 0.02  # metres above the origin, so the decal sits on flattened terrain without z-fighting
LOD_DISTANCE = [0, 30]  # the flat far LOD only drops the grid's subdivisions


def srgb(hex_: str) -> np.ndarray:
    return np.array([int(hex_[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def value_noise(shape, cells, rng, periodic=(False, False)) -> np.ndarray:
    """Smooth value noise in [0, 1] on an (h, w) grid with `cells` = (cy, cx) lattice cells; optionally periodic."""
    h, w = shape
    cy, cx = cells
    lat = rng.random((cy + 1, cx + 1)).astype(np.float32)
    if periodic[0]:
        lat[-1, :] = lat[0, :]
    if periodic[1]:
        lat[:, -1] = lat[:, 0]
    y = np.linspace(0, cy, h, endpoint=not periodic[0], dtype=np.float32)
    x = np.linspace(0, cx, w, endpoint=not periodic[1], dtype=np.float32)
    y0 = np.clip(np.floor(y).astype(int), 0, cy - 1)
    x0 = np.clip(np.floor(x).astype(int), 0, cx - 1)
    ty = smooth(0, 1, y - y0)[:, None]
    tx = smooth(0, 1, x - x0)[None, :]
    a = lat[y0][:, x0]; b = lat[y0][:, x0 + 1]; c = lat[y0 + 1][:, x0]; d = lat[y0 + 1][:, x0 + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(shape, base, rng, octaves=3, periodic=(False, False)) -> np.ndarray:
    out, amp, total = np.zeros(shape, np.float32), 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(shape, (base[0] * 2 ** o, base[1] * 2 ** o), rng, periodic)
        total += amp
        amp *= 0.5
    return out / total


def normal_map(height: np.ndarray, px_x: float, px_z: float, wrap_z: bool) -> np.ndarray:
    """Height (m) on the (row = +Z, col = +X) grid → tangent-space normal (glTF / OpenGL: green = image up = -Z)."""
    mode = "wrap" if wrap_z else "edge"
    hz = np.pad(height, ((1, 1), (0, 0)), mode=mode)
    hx = np.pad(height, ((0, 0), (1, 1)), mode="edge")
    dx = (hx[:, 2:] - hx[:, :-2]) / (2 * px_x)
    dz = (hz[2:, :] - hz[:-2, :]) / (2 * px_z)
    n = np.stack([-dx, dz, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


# ───────────── painters: return (rgba, height_m, ao) on a (size, size) grid; row = +Z, column = +X ─────────────

def paint_ruts(size: int, width: float, length: float, rng) -> tuple:
    rows, cols = size, size
    z = (np.arange(rows, dtype=np.float32) + 0.5) / rows * length          # along the road, periodic
    x = (np.arange(cols, dtype=np.float32) + 0.5) / cols * width - width / 2  # across
    Z, X = np.meshgrid(z, x, indexing="ij")
    ph = 2 * np.pi * Z / length
    # gentle meander, the same for both ruts (the cart drifted), periodic along the strip
    sway = 0.035 * np.sin(ph + 0.7) + 0.02 * np.sin(2 * ph + 2.1) + 0.01 * np.sin(5 * ph)
    gauge = 0.80 + 0.012 * np.sin(3 * ph + 1.3)
    edge_n = fbm((rows, cols), (16, 6), rng, 3, periodic=(True, False)) - 0.5
    drift = fbm((rows, cols), (3, 2), rng, 2, periodic=(True, False))   # sand blown back into the ruts
    height = np.zeros((rows, cols), np.float32)
    groove_mask = np.zeros_like(height)
    berm_mask = np.zeros_like(height)
    for side in (-1, 1):
        c = side * gauge + sway
        half = 0.13 + 0.025 * np.sin(4 * ph + side) + 0.03 * edge_n
        d = np.abs(X - c)
        g = 1 - smooth(half * 0.35, half, d)                       # groove bowl
        b = smooth(half * 0.8, half + 0.02, d) * (1 - smooth(half + 0.05, half + 0.15 + 0.05 * edge_n, d))  # berm
        groove_mask = np.maximum(groove_mask, g)
        berm_mask = np.maximum(berm_mask, b)
    fill = smooth(0.62, 0.8, drift)                                # drifts soften the ruts in two or three places
    groove_mask *= 1 - 0.75 * fill
    berm_mask *= 1 - 0.6 * fill
    height = -0.07 * groove_mask + 0.025 * berm_mask
    alpha = ((groove_mask > 0.08) | (berm_mask > 0.25)).astype(np.float32)
    # painted colours: compacted darker sand in the bottom, a pale lip on the berms, broad soft colour blotches
    sand, lip, bottom, shade = srgb("#c9a676"), srgb("#e2c89c"), srgb("#8e6a47"), srgb("#a8845a")
    blotch = fbm((rows, cols), (6, 3), rng, 2, periodic=(True, False))[..., None]
    col = sand + (lip - sand) * berm_mask[..., None]
    col = col + (shade - col) * smooth(0.05, 0.5, groove_mask)[..., None]
    col = col + (bottom - col) * smooth(0.55, 1.0, groove_mask)[..., None]
    col *= 0.94 + 0.12 * blotch
    # a few painted transverse pressure streaks in the groove bottom (wheel rims sliding)
    streak = 0.5 + 0.5 * np.sin(Z * 2 * np.pi / (length / 40) + 3 * edge_n)
    col *= (1 - 0.05 * smooth(0.6, 1.0, groove_mask) * streak)[..., None]
    ao = 1 - 0.3 * smooth(0.3, 1.0, groove_mask)
    rgba = np.concatenate([np.clip(col, 0, 1), alpha[..., None]], axis=-1)
    return rgba, height, ao, (width / cols, length / rows), True


def paint_cracked_bed(size: int, width: float, length: float, rng) -> tuple:
    rows, cols = size, size
    z = (np.arange(rows, dtype=np.float32) + 0.5) / rows * length - length / 2
    x = (np.arange(cols, dtype=np.float32) + 0.5) / cols * width - width / 2
    Z, X = np.meshgrid(z, x, indexing="ij")

    def voronoi(cell: float, jitter: float):
        ny, nx = int(np.ceil(length / cell)) + 2, int(np.ceil(width / cell)) + 2
        pts = (np.stack(np.meshgrid(np.arange(ny), np.arange(nx), indexing="ij"), -1).astype(np.float32)
               + 0.5 + (rng.random((ny, nx, 2)).astype(np.float32) - 0.5) * jitter) * cell
        pts -= np.array([length / 2 + cell, width / 2 + cell], np.float32)
        gy = np.floor((Z + length / 2 + cell) / cell).astype(int)
        gx = np.floor((X + width / 2 + cell) / cell).astype(int)
        f1 = np.full(Z.shape, 1e9, np.float32); f2 = f1.copy(); idx = np.zeros(Z.shape, int)
        p1 = np.zeros(Z.shape + (2,), np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                yy, xx = np.clip(gy + dy, 0, ny - 1), np.clip(gx + dx, 0, nx - 1)
                p = pts[yy, xx]
                d = np.hypot(Z - p[..., 0], X - p[..., 1])
                closer = d < f1
                f2 = np.where(closer, f1, np.minimum(f2, d))
                idx = np.where(closer, yy * nx + xx, idx)
                p1 = np.where(closer[..., None], p, p1)
                f1 = np.where(closer, d, f1)
        return (f2 - f1) / 2, idx, p1  # distance to the nearest cell edge, cell id, cell centre

    edge, cid, centre = voronoi(0.62, 0.9)
    edge2, _, _ = voronoi(0.24, 0.85)
    width_n = fbm(Z.shape, (10, 10), rng, 2)
    crack_w = 0.010 + 0.022 * width_n                                   # primary cracks 1-3 cm
    crack = 1 - smooth(crack_w * 0.6, crack_w, edge)
    minor_on = smooth(0.55, 0.7, fbm(Z.shape, (6, 6), rng, 2))          # secondary cracks only in patches
    crack2 = (1 - smooth(0.003, 0.007, edge2)) * minor_on * smooth(0.04, 0.08, edge)
    curl = 1 - smooth(0.0, 0.16, edge)                                  # plate rims curl up toward the crack
    height = 0.018 * curl - 0.05 * crack - 0.012 * crack2
    # outline: whole plates in or out, so the patch edge follows the cracks; a few loose plates outside
    theta = np.arctan2(centre[..., 0], centre[..., 1])
    radius = np.hypot(centre[..., 0], centre[..., 1])
    rim = 3.0 + 0.45 * np.sin(3 * theta + 0.4) + 0.3 * np.sin(5 * theta + 2.2) + 0.2 * np.sin(8 * theta + 1.1)
    cell_rand = (np.sin(cid * 12.9898) * 43758.5453) % 1.0
    inside = (radius < rim) | ((radius < rim + 0.7) & (cell_rand > 0.55))
    alpha = (inside & (np.abs(X) < width / 2 - 0.02) & (np.abs(Z) < length / 2 - 0.02)).astype(np.float32)
    plate, rimc, crackc, deep = srgb("#c8ae86"), srgb("#e0caa2"), srgb("#6b5038"), srgb("#4a3626")
    tint = (0.93 + 0.12 * cell_rand)[..., None]
    blotch = fbm(Z.shape, (5, 5), rng, 2)[..., None]
    col = plate * tint * (0.95 + 0.1 * blotch)
    col = col + (rimc - col) * (0.75 * curl)[..., None]
    col = col + (crackc - col) * np.maximum(crack, 0.8 * crack2)[..., None]
    col = col + (deep - col) * smooth(0.6, 1.0, crack)[..., None]
    ao = 1 - 0.45 * crack - 0.2 * crack2
    rgba = np.concatenate([np.clip(col, 0, 1), alpha[..., None]], axis=-1)
    return rgba, height, ao, (width / cols, length / rows), False


DECALS = {
    "SM_Decal_DesertCartRuts": {"display": "古道车辙贴花（1-1 古道，沿 Z 平铺）", "bind": "desert.silkroad.cartRuts",
                                "width": 2.4, "length": 8.0, "grid": (4, 16), "texture": 1024, "seed": 11,
                                "painter": paint_ruts},
    "SM_Decal_DesertCrackedBed": {"display": "龟裂泉床贴花（1-4 干涸月牙泉）", "bind": "desert.silkroad.crackedBed",
                                  "width": 8.0, "length": 8.0, "grid": (8, 8), "texture": 1024, "seed": 23,
                                  "painter": paint_cracked_bed},
}


# ───────────── GLB writer ─────────────

def webp(arr: np.ndarray, lossless: bool) -> bytes:
    mode = "RGBA" if arr.shape[-1] == 4 else "RGB"
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
    buf = io.BytesIO()
    im.save(buf, "WEBP", lossless=lossless, quality=92, method=6, exact=True)
    return buf.getvalue()


def write_glb(path, asset_id: str, cfg: dict, images: dict) -> None:
    w, l = cfg["width"], cfg["length"]
    name = asset_id[3:]  # SM_Decal_X → Decal_X
    blobs, views, accessors = [], [], []

    def add_view(data: bytes, target=None):
        offset = sum(len(b) for b in blobs)
        pad = (-len(data)) % 4
        blobs.append(data + bytes(pad))
        v = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        return len(views) - 1

    def add_acc(arr: np.ndarray, comp: int, typ: str, target, minmax=False):
        acc = {"bufferView": add_view(arr.tobytes(), target), "componentType": comp, "count": len(arr), "type": typ}
        if minmax:
            acc["min"] = arr.min(0).tolist(); acc["max"] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    def grid(nx: int, nz: int) -> dict:
        xs = np.linspace(-w / 2, w / 2, nx + 1, dtype=np.float32)
        zs = np.linspace(-l / 2, l / 2, nz + 1, dtype=np.float32)
        Zg, Xg = np.meshgrid(zs, xs, indexing="ij")
        pos = np.stack([Xg, np.full_like(Xg, LIFT), Zg], -1).reshape(-1, 3)
        nrm = np.tile(np.array([0, 1, 0], np.float32), (len(pos), 1))
        # image row = +Z, column = +X (row 0 at -Z); glTF v runs down the image
        uv = np.stack([(Xg + w / 2) / w, (Zg + l / 2) / l], -1).reshape(-1, 2).astype(np.float32)
        idx = []
        for r in range(nz):
            for c in range(nx):
                a = r * (nx + 1) + c
                b, d, e = a + 1, a + nx + 1, a + nx + 2
                idx += [a, d, b, b, d, e]  # counter-clockwise seen from +Y
        return {"attributes": {"POSITION": add_acc(pos, 5126, "VEC3", 34962, True), "NORMAL": add_acc(nrm, 5126, "VEC3", 34962),
                               "TEXCOORD_0": add_acc(uv, 5126, "VEC2", 34962)},
                "indices": add_acc(np.array(idx, np.uint16), 5123, "SCALAR", 34963), "material": 0}

    prims = [grid(*cfg["grid"]), grid(1, 2)]
    imgs = []
    for role in ("BC", "N", "ORM"):
        imgs.append({"bufferView": add_view(images[role]), "mimeType": "image/webp", "name": f"T_{name}_{role}"})
    doc = {
        "asset": {"generator": "art/pipeline/build_ground_decals.py", "version": "2.0"},
        "scene": 0, "scenes": [{"name": "Scene", "nodes": list(range(len(prims)))}],
        "nodes": [{"name": f"{asset_id}_LOD{i}", "mesh": i, "extras": {"lod": i, "lod_distance": LOD_DISTANCE[i]}}
                  for i in range(len(prims))],
        "meshes": [{"name": f"{asset_id}_LOD{i}", "primitives": [p]} for i, p in enumerate(prims)],
        "materials": [{"name": f"M_{name}", "alphaMode": "MASK", "alphaCutoff": 0.5,
                       "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicRoughnessTexture": {"index": 2}},
                       "normalTexture": {"index": 1}, "occlusionTexture": {"index": 2}}],
        "textures": [{"sampler": 0, "extensions": {"EXT_texture_webp": {"source": i}}} for i in range(3)],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 10497 if cfg.get("tile_z") else 33071}],
        "images": imgs, "accessors": accessors, "bufferViews": views,
        "buffers": [{"byteLength": sum(len(b) for b in blobs)}],
        "extensionsUsed": ["EXT_texture_webp"], "extensionsRequired": ["EXT_texture_webp"],
    }
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * ((-len(js)) % 4)
    binc = b"".join(blobs)
    total = 12 + 8 + len(js) + 8 + len(binc)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
                     + struct.pack("<I4s", len(binc), b"BIN\0") + binc)


def build(asset_id: str) -> dict:
    cfg = DECALS[asset_id]
    rng = np.random.default_rng(cfg["seed"])
    rgba, height, ao, (px_x, px_z), wrap = cfg["painter"](cfg["texture"], cfg["width"], cfg["length"], rng)
    cfg["tile_z"] = wrap
    nmap = normal_map(height, px_x, px_z, wrap)
    orm = np.stack([ao, np.full_like(ao, 0.95), np.zeros_like(ao)], -1)
    # cut-out edges: push the colour of the nearest opaque texels into the transparent ones (no dark mip fringe)
    rgb = rgba[..., :3].copy()
    mask = rgba[..., 3] > 0.5
    if (~mask).any() and mask.any():
        from scipy import ndimage
        _, (iy, ix) = ndimage.distance_transform_edt(~mask, return_indices=True)
        rgb = rgb[iy, ix]
    bc = np.concatenate([rgb, rgba[..., 3:]], -1)
    images = {"BC": webp(bc, lossless=False), "N": webp(nmap, lossless=False), "ORM": webp(orm, lossless=False)}
    out = RUNTIME / f"{asset_id}.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    write_glb(out, asset_id, cfg, images)
    # review sheet under the ignored _tmp/ (not committed, not shipped): BC over a sand swatch + the normal map
    src = ROOT / CFG.paths["source"] / "props" / asset_id
    src.mkdir(parents=True, exist_ok=True)
    sand = np.ones_like(rgb) * srgb("#c9a676")
    over = rgb * rgba[..., 3:] + sand * (1 - rgba[..., 3:])
    sheet = np.concatenate([over, nmap], axis=1)
    (src / "_tmp").mkdir(exist_ok=True)
    Image.fromarray((sheet * 255).astype(np.uint8)).save(src / "_tmp" / f"{asset_id}_review.png")
    record = {"id": asset_id, "display": cfg["display"], "generator": "art/pipeline/build_ground_decals.py",
              "size_m": [cfg["width"], cfg["length"]], "grid": list(cfg["grid"]), "texture": cfg["texture"],
              "seed": cfg["seed"], "lift_m": LIFT, "tiles_along_z": wrap, "glb_sha256": sha256(out), "built": now()}
    (src / "decal.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "url": f"assets/props/{asset_id}.glb",
        "kind": "static",
        "class": "ground_decal",
        "bind": {"source": "scene", "id": cfg["bind"]},
        "keepGlow": "none",
        "lodDistance": LOD_DISTANCE,
        "bounds": {"min": [-cfg["width"] / 2, LIFT, -cfg["length"] / 2], "max": [cfg["width"] / 2, LIFT, cfg["length"] / 2]},
        "sha256": sha256(out),
        "bytes": out.stat().st_size,
        "published": now(),
        "generator": {"tool": "procedural", "mode": "ground_decal", "checkpoint": f"seed {cfg['seed']}"},
        "license": "project-original procedural texture",
    }


def main() -> None:
    ids = sys.argv[1:] or list(DECALS)
    unknown = set(ids) - set(DECALS)
    if unknown:
        raise SystemExit(f"unknown decal(s): {sorted(unknown)}; known: {sorted(DECALS)}")
    entries = {}
    for asset_id in ids:
        entries[asset_id] = build(asset_id)
        print(f"✔ {asset_id} → public/{entries[asset_id]['url']}（{entries[asset_id]['bytes'] / 1024:.0f} KB）")
    # other pipeline processes publish concurrently: merge into the manifest as it is now
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["assets"].update(entries)
    manifest["updated"] = now()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
