"""PNG → WebP for the Unity web export (called by optimize-web-levels.mjs).

usage: python -I webp_textures.py <source dir> <target dir> <roles json>

roles json maps texture file name → role:
  "normal"   Unity normal map. WebSceneExporter blits textures into an sRGB render texture, so a linear
             normal map arrives sRGB-encoded in R/G/B (alpha is never encoded) and in Unity's packed layout
             (DXT5nm: R=1, G=y, A=x; BC5: R=x, G=y, A=1). Unpacked here like Unity's UnpackNormalmapRGorAG
             (x = R·A, y = G after undoing sRGB, z = sqrt(1 − x² − y²)) into a glTF RGB normal map, then lossy
             WebP q95 (mean angular error ≈ 0.5°).
  "lossless" data textures whose bytes are read as weights (terrain splat maps): lossless WebP.
Everything else is a colour texture: lossy WebP q90. Fully opaque images drop their alpha channel.
"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def unpack_normal(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA")).astype(np.float32) / 255.0
    x = srgb_to_linear(rgba[..., 0]) * rgba[..., 3] * 2.0 - 1.0
    y = srgb_to_linear(rgba[..., 1]) * 2.0 - 1.0
    z = np.sqrt(np.clip(1.0 - x * x - y * y, 0.0, 1.0))
    n = np.stack([x, y, z], axis=-1)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    return Image.fromarray(np.clip(np.round((n * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8), "RGB")


def convert(job: tuple[str, str, str]) -> tuple[str, int, int]:
    source, target, role = job
    image = Image.open(source)
    image.load()
    if role == "normal":
        unpack_normal(image).save(target, "WEBP", quality=95, method=4)
    else:
        if image.mode != "RGBA":
            image = image.convert("RGBA")
        if image.getchannel("A").getextrema() == (255, 255):
            image = image.convert("RGB")
        if role == "lossless":
            image.save(target, "WEBP", lossless=True, quality=100, method=4)
        else:
            image.save(target, "WEBP", quality=90, method=4)
    return Path(source).name, Path(source).stat().st_size, Path(target).stat().st_size


def main() -> None:
    source_dir, target_dir, roles_file = map(Path, sys.argv[1:4])
    roles: dict[str, str] = json.loads(roles_file.read_text(encoding="utf-8"))
    jobs = []
    for path in sorted(source_dir.glob("*.png")):
        jobs.append((str(path), str(target_dir / (path.stem + ".webp")), roles.get(path.name, "color")))
    before = after = 0
    with ProcessPoolExecutor() as pool:
        for i, (_, a, b) in enumerate(pool.map(convert, jobs, chunksize=4), 1):
            before += a
            after += b
            if i % 100 == 0:
                print(f"textures {i}/{len(jobs)}", flush=True)
    counts = {role: sum(1 for job in jobs if job[2] == role) for role in ("color", "normal", "lossless")}
    print(f"textures {len(jobs)} {counts}: {before / 2**20:.0f} MiB -> {after / 2**20:.0f} MiB", flush=True)


if __name__ == "__main__":
    main()
