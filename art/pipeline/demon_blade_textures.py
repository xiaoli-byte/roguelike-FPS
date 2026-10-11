"""Hilt texture atlas for the 魔刀千刃 v2 runtime model (docs/demon-blade-v2.md).

  python demon_blade_textures.py [--sheet DS_SK_Weapon_DemonBlade_v001.png]

Crops the user-approved design sheet: the blade-root demon face from the full side view (unwarped to a straight
column so it matches the runtime blade outline, which is measured from the same view), an awakened copy with the
demon eye repainted violet-white, the cord-wrapped grip, the pommel cap and the guard face. Writes the albedo atlas
and an emissive atlas (glowing cyan motif and the eye only) to public/assets/weapons/. Atlas rectangles are fixed
below and mirrored as HILT_ATLAS in src/weapons/demonBlade/BladeModel.ts; the root/shard boundary traced from this
crop is ROOT_BOUNDARY in BladeShape.ts. The 128 blade shards are not textured: they are procedural geometry.
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
from PIL import Image

from lib.state import resolve_path

DESIGN = resolve_path("art/source/weapons/SK_Weapon_DemonBlade/00_design")
OUT = resolve_path("public/assets/weapons")
SIZE = 1024
# Atlas rectangles (x, y, w, h) in pixels; keep HILT_ATLAS in BladeModel.ts in sync.
RECTS = {
    "root": (0, 0, 256, 576),
    "root_awake": (256, 0, 256, 576),
    "grip": (0, 576, 1024, 144),
    "pommel": (0, 720, 128, 160),
    "guard": (128, 720, 512, 96),
}
# Side-view quad of the blade root (output upper-left, lower-left, lower-right, upper-right):
# u = spine (0) -> edge (1), v = blade start at the guard (0) -> x = 940 px, 0.198 m along the blade (1).
ROOT_QUAD = (581, 131, 940, 160, 940, 250, 581, 227)
# Demon eye in root texture coordinates (u, v) and its half size, for the awakened copy.
EYE_UV = (0.41, 0.244)
EYE_HALF = (0.05, 0.036)
GRIP_BOX = (120, 140, 525, 198)
POMMEL_BOX = (50, 128, 112, 210)
GUARD_BOX = (64, 412, 356, 470)


def emissive(rgb: np.ndarray) -> np.ndarray:
    """Glowing cyan motif and white-violet eye: saturated blue or very bright pixels. Dark gunmetal stays dark."""
    f = rgb.astype(np.float32) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    cyan = np.clip((b - r - 0.22) / 0.3, 0, 1) * np.clip((lum - 0.32) / 0.25, 0, 1)
    hot = np.clip((lum - 0.78) / 0.15, 0, 1) * np.clip((b - g - 0.04) / 0.08, 0, 1)
    mask = np.maximum(cyan, hot)[..., None]
    return (f * mask * 255).astype(np.uint8)


def awaken(col: Image.Image) -> Image.Image:
    """Repaint the demon eye as an opened violet-white slit (噬灵鬼眼)."""
    w, h = col.size
    arr = np.asarray(col).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    cu, cv = EYE_UV[0] * w, EYE_UV[1] * h
    hu, hv = EYE_HALF[0] * w, EYE_HALF[1] * h
    # almond slit along the blade (v): |du| < hu * (1 - (dv/hv)^2)
    du = (xx - cu) / hu
    dv = (yy - cv) / hv
    almond = np.clip((1 - dv * dv - np.abs(du)) * 3, 0, 1)
    core = np.clip((1 - (dv * 1.3) ** 2 - np.abs(du) * 2.2) * 2, 0, 1)
    glow = np.exp(-(du * du + dv * dv) * 1.2)[..., None]
    violet = np.array([196, 120, 255], np.float32)
    white = np.array([255, 248, 255], np.float32)
    out = arr * (1 - 0.55 * glow) + violet * 0.55 * glow
    out = out * (1 - almond[..., None]) + violet * almond[..., None]
    out = out * (1 - core[..., None]) + white * core[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def boundary(col: np.ndarray) -> list[tuple[float, float]]:
    """First violet seam pixel below the face per column -> painted root/shard boundary (u, v)."""
    h, w, _ = col.shape
    f = col.astype(np.int32)
    seam = (f[..., 2] > 170) & (f[..., 0] > 70) & (f[..., 1] < 110) & (f[..., 2] - f[..., 1] > 90)
    pts = []
    for u in np.linspace(0.04, 0.96, 12):
        x = int(u * (w - 1))
        rows = np.nonzero(seam[int(h * 0.3):, x])[0]
        if len(rows):
            pts.append((round(float(u), 3), round(float((rows[0] + int(h * 0.3)) / (h - 1)), 3)))
    return pts


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheet", default="DS_SK_Weapon_DemonBlade_v001.png")
    args = ap.parse_args()
    sheet = Image.open(DESIGN / args.sheet).convert("RGB")
    albedo = Image.new("RGB", (SIZE, SIZE), (40, 42, 50))
    glow = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))

    def put(name: str, img: Image.Image) -> np.ndarray:
        x, y, w, h = RECTS[name]
        img = img.resize((w, h), Image.LANCZOS)
        albedo.paste(img, (x, y))
        arr = np.asarray(img)
        glow.paste(Image.fromarray(emissive(arr)), (x, y))
        return arr

    w, h = RECTS["root"][2], RECTS["root"][3]
    col = sheet.transform((w, h), Image.QUAD, ROOT_QUAD, Image.BICUBIC)
    put("root", col)
    put("root_awake", awaken(col))
    put("grip", sheet.crop(GRIP_BOX))
    put("pommel", sheet.crop(POMMEL_BOX))
    put("guard", sheet.crop(GUARD_BOX))

    OUT.mkdir(parents=True, exist_ok=True)
    albedo.save(OUT / "T_DemonBlade_Hilt_D.webp", quality=92, method=6)
    glow.save(OUT / "T_DemonBlade_Hilt_E.webp", quality=90, method=6)
    print("✔", OUT / "T_DemonBlade_Hilt_D.webp", OUT / "T_DemonBlade_Hilt_E.webp")


if __name__ == "__main__":
    main()
