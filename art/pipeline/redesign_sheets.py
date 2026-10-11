"""Character design sheets for the new enemy roster (docs/art/enemy-roster-v2.md).

  python redesign_sheets.py [KEY ...] [--force]     no keys = every design in enemy_designs_v2.json
  python redesign_sheets.py --turnaround KEY        four-view model sheet for Tripo from the latest approved design
  python redesign_sheets.py --designs hero_designs_v2.json [KEY ...]   another roster (heroes: docs/art/hero-roster-v2.md);
                                                    its optional "style" / "layouts" replace STYLE / LAYOUT

Text-only generation (no earlier art is used as a reference). Each sheet is a free character design: key pose,
turnaround views and hand / foot close-ups. Output: art/source/characters/_design/<chapter>/<key>/DS_<key>_v<NNN>.png
with the exact prompt and generation record next to it. Existing sheets are never regenerated without --force
(every image costs money).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from lib.config import CFG, PipelineError, _load_env
from lib import openai_image
from lib.state import resolve_path

ROOT = Path(__file__).resolve().parent
DESIGNS = ROOT / "enemy_designs_v2.json"
OUT = resolve_path("art/source/characters/_design")

STYLE = """Original character design for a polished STYLIZED 3D first-person roguelite shooter, at the production
quality of Gunfire Reborn enemies. Strongly stylized, not realistic: simplified chunky shapes, exaggerated cartoon-like
proportions (big head and hands, compact body), bold readable silhouette, smooth sculpted forms with clean bevelled
edges, hair and fur as a few large carved clumps (never individual strands), clothing as thick simple folds, flat-ish
hand-painted textures with soft gradients and restrained edge wear, two or three dominant colour blocks plus one
glowing accent. No photorealistic skin, pores, anatomy detail, realistic fabric or semi-realistic painting.
Distinctly Chinese mythological fantasy. Memorable at 30 metres; one obvious glowing weak spot."""

LAYOUT = {
    "humanoid": """Output: one character design sheet on a plain flat light grey background (#D6D6D6), no text, labels
or frames. Left half: a large three-quarter view in a dynamic combat pose with {weapon}. Right half, side by side at the
same scale: a FRONT view and a BACK view in a relaxed A-pose with empty open hands, full body head to feet. Bottom right:
two small close-ups, one open hand (every finger clearly visible and countable) and one foot. Even studio lighting, no
cast shadows.""",
    "hybrid": """Output: one creature design sheet on a plain flat light grey background (#D6D6D6), no text, labels or
frames. Left half: a large three-quarter view in a dynamic attack pose with {weapon}. Right half at the same scale: a
FRONT view, a SIDE view and a BACK view, each complete with margin. Bottom right: one small close-up of an open hand
(every finger clearly visible and countable). Even studio lighting, no cast shadows.""",
    "creature": """Output: one creature design sheet on a plain flat light grey background (#D6D6D6), no text, labels or
frames. Left half: a large three-quarter view in an aggressive action pose. Right half at the same scale: a FRONT view,
a SIDE view and a BACK view, each complete with margin. Even studio lighting, no cast shadows.""",
}


def generate(design: dict, data: dict, force: bool) -> str:
    out = OUT / design["chapter"] / design["key"]
    out.mkdir(parents=True, exist_ok=True)
    existing = sorted(out.glob(f"DS_{design['key']}_v*.png"))
    if existing and not force:
        return f"= {design['key']}: {existing[-1].name} already exists (use --force to pay for another)"
    stem = f"DS_{design['key']}_v{len(existing) + 1:03d}"
    layouts = {**LAYOUT, **data.get("layouts", {})}
    prompt = "\n\n".join(part for part in [
        data.get("style", STYLE),
        data["chapters"][design["chapter"]],
        f"Character: {design['name']}, about {design['height_m']:g} m tall. {design['brief']}",
        design.get("style_note", ""),
        layouts[design["layout"]].format(weapon=design.get("weapon") or "its natural attack"),
    ] if part)
    cfg = CFG.section("concept")
    # style_refs: approved sheets of the same roster used ONLY as a style anchor (stylization, proportions, rendering),
    # so a later addition matches characters the user already approved
    refs = [sorted((OUT / design["chapter"] / k).glob(f"DS_{k}_v*.png"))[-1] for k in design.get("style_refs", [])]
    if refs:
        prompt = (f"The {len(refs)} attached images are approved design sheets of OTHER characters from the same game. "
                  "Use them ONLY as the style reference: match their exact stylization, head-to-body ratio, eye style, "
                  "fur and cloth rendering, line of bevels, colour saturation, lighting and sheet layout. Do not copy "
                  "their species, outfits, props or colours.\n\n" + prompt)
        png, info = openai_image.edit(prompt, refs, model=cfg["model"], size="2048x1024", quality=cfg["quality"],
                                      background="opaque")
    else:
        png, info = openai_image.generate(prompt, model=cfg["model"], size="2048x1024", quality=cfg["quality"])
    (out / f"{stem}.png").write_bytes(png)
    (out / f"{stem}_prompt.txt").write_text(prompt, encoding="utf-8")
    (out / f"{stem}.json").write_text(json.dumps({"design": design, "generation": info}, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
    return f"✔ {design['key']} → {out / (stem + '.png')}  ({info['seconds']} s)"


TURNAROUND = """Using the attached character design sheet as the exact design reference (same character, same shapes,
colours, materials, proportions and stylization), produce an orthographic model turnaround sheet for 3D reconstruction.
Exactly four separate complete views of the SAME character in one row, left to right:
1) FRONT view: the character faces the viewer.
2) Side view with the character's face and body pointing to the LEFT edge of the image (we see its left flank).
3) BACK view: we see the character's back.
4) Side view with the character's face and body pointing to the RIGHT edge of the image (we see its right flank). {lead}{pose}. Same scale and same ground line in all four, each centred in
its quarter with generous empty margin, never touching or overlapping. Every part of the body fully visible; {digits}
Plain flat light neutral grey background (#D6D6D6). No floor, no ground shadow, no effects, no projectiles, no mirage
copies, no smoke or fire trails, no text, no labels, no frames, no perspective. Even neutral lighting."""


PROP_TURNAROUND = """Using the attached character design sheet only as the design reference for this ONE object (same shapes,
colours, materials and stylization as it appears there), produce an orthographic model turnaround sheet of the object
ALONE for 3D reconstruction: {lead}{pose}. NO character, no hands, no body parts, no stand, no strings of light.
Exactly four separate complete views of the SAME object in one row, left to right: 1) FRONT view, 2) side view with the
object's front facing the LEFT edge of the image, 3) BACK view, 4) side view with the object's front facing the RIGHT edge
of the image. Same scale and same vertical centre line in all four, each centred in its quarter with generous empty
margin, never touching or overlapping. {digits}
Plain flat light neutral grey background (#D6D6D6). No floor, no shadow, no effects, no glow halo, no particles, no text,
no labels, no frames, no perspective. Even neutral lighting."""


def split_views(sheet: Path, order: tuple[str, ...]) -> None:
    """Cut a one-row turnaround into per-view images by background gaps, never by fixed quarters: side views of long
    creatures overflow their quarter. Each view keeps the sheet's pixel scale and ground line, centred on a canvas
    shared by all views (equal size), and is saved as <sheet stem>_<view>.png in `order` (left to right)."""
    import numpy as np
    from PIL import Image
    with Image.open(sheet) as im:
        rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    bg = np.median(np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3)]), axis=0)
    fg = np.abs(rgb - bg).max(axis=2) > 18
    cols = fg.sum(axis=0) > 2
    runs, start = [], None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append([start, x]); start = None
    # merge specks into their neighbour until exactly len(order) objects remain (largest gaps separate views)
    runs = [r for r in runs if r[1] - r[0] > 6]
    while len(runs) > len(order):
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        i = gaps.index(min(gaps))
        runs[i:i + 2] = [[runs[i][0], runs[i + 1][1]]]
    owners = None  # per-pixel view index when views overlap in x (long tail reaching under the next view's hand)
    if len(runs) != len(order):
        runs, owners = _split_by_components(fg, len(order), sheet.name)
    rows = np.where(fg.any(axis=1))[0]
    top, bottom = int(rows.min()), int(rows.max()) + 1
    margin = 40
    width = max(r[1] - r[0] for r in runs) + 2 * margin
    height = bottom - top + 2 * margin
    side = max(width, height)
    with Image.open(sheet) as im:
        src = np.asarray(im.convert("RGB")).copy()
    for i, (view, (x0, x1)) in enumerate(zip(order, runs)):
        crop = src[top:bottom, x0:x1].copy()
        if owners is not None:
            crop[owners[top:bottom, x0:x1] != i] = bg.astype(np.uint8)
        canvas = Image.new("RGB", (side, side), tuple(int(c) for c in bg))
        canvas.paste(Image.fromarray(crop), ((side - (x1 - x0)) // 2, side - margin - (bottom - top)))
        canvas.save(sheet.with_name(f"{sheet.stem}_{view}.png"))


def _split_by_components(fg, count: int, name: str):
    """Fallback for views whose x-ranges overlap: separate them as 2-D connected regions. The `count` largest regions
    are the views (left to right); smaller specks join the view with the nearest centroid. Returns the x-range of each
    view and a per-pixel owner map (-1 = background)."""
    import numpy as np
    from scipy import ndimage
    labels, n = ndimage.label(ndimage.binary_dilation(fg, iterations=2))
    labels[~fg] = 0
    if n < count:
        raise PipelineError(f"{name}: found {n} separate regions, expected {count} (views touch?)")
    sizes = ndimage.sum(fg, labels, range(1, n + 1))
    centres = [c[1] for c in ndimage.center_of_mass(fg, labels, range(1, n + 1))]
    seeds = sorted(np.argsort(sizes)[::-1][:count], key=lambda k: centres[k])
    if sizes[seeds].min() < 0.2 * sizes.max():
        raise PipelineError(f"{name}: views are not separate regions (largest {count} sizes {sizes[seeds].tolist()})")
    owner_of = np.full(n + 1, -1)
    for k in range(n):
        owner_of[k + 1] = min(range(count), key=lambda i: abs(centres[k] - centres[seeds[i]]))
    owners = owner_of[labels]
    runs = []
    for i in range(count):
        xs = np.where((owners == i).any(axis=0))[0]
        runs.append([int(xs.min()), int(xs.max()) + 1])
    return runs, owners


def turnaround(design: dict) -> str:
    out = OUT / design["chapter"] / design["key"]
    out.mkdir(parents=True, exist_ok=True)
    # a part / prop of a character (e.g. a held instrument modelled separately) uses its owner's design sheet
    ref = design.get("reference_key", design["key"])
    sheets = sorted((OUT / design["chapter"] / ref).glob(f"DS_{ref}_v*.png"))
    if not sheets:
        raise PipelineError(f"{design['key']}: no design sheet yet")
    existing = sorted(p for p in out.glob(f"TV_{design['key']}_v*.png") if re.fullmatch(r"TV_.+_v\d{3}\.png", p.name))
    stem = f"TV_{design['key']}_v{len(existing) + 1:03d}"
    template = PROP_TURNAROUND if design.get("layout") == "prop" else TURNAROUND
    prompt = template.format(lead=design.get("turnaround_lead", "Neutral standing rest pose"),
                               pose=design.get("turnaround_pose", ""), digits=design.get(
        "turnaround_digits", "fingers and toes clearly separated and countable."))
    cfg = CFG.section("concept")
    png, info = openai_image.edit(prompt, [sheets[-1]], model=cfg["model"], size="2048x1024",
                                  quality=cfg["quality"], background="opaque")
    sheet = out / f"{stem}.png"
    sheet.write_bytes(png)
    # Tripo multiview / pipeline convention (viewer-relative): "left" = face points to the image's left edge,
    # "right" = face points to the image's right edge. Swapping them makes Tripo sculpt a second face on the back.
    split_views(sheet, ("front", "left", "back", "right"))
    (out / f"{stem}_prompt.txt").write_text(prompt, encoding="utf-8")
    (out / f"{stem}.json").write_text(json.dumps({"design": design, "from_sheet": sheets[-1].name, "generation": info},
                                                 ensure_ascii=False, indent=2), encoding="utf-8")
    return f"✔ {design['key']} turnaround → {sheet}  ({info['seconds']} s)"


def safe(design: dict, data: dict, force: bool) -> str:
    try:
        return generate(design, data, force)
    except Exception as e:  # one failed sheet must not discard the others already paid for
        return f"✘ {design['key']}: {e}"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("keys", nargs="*")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--turnaround", metavar="KEY")
    parser.add_argument("--designs", type=Path, default=DESIGNS, help="roster JSON (default enemy_designs_v2.json)")
    args = parser.parse_args()
    _load_env()
    designs_file = args.designs if args.designs.is_absolute() else ROOT / args.designs
    data = json.loads(designs_file.read_text(encoding="utf-8"))
    if args.turnaround:
        design = next((d for d in data["designs"] if d["key"] == args.turnaround), None)
        if design is None:
            raise PipelineError(f"not in {designs_file.name}: {args.turnaround}")
        print(turnaround(design), flush=True)
        return
    designs = [d for d in data["designs"] if not args.keys or d["key"] in args.keys]
    missing = set(args.keys) - {d["key"] for d in designs}
    if missing:
        raise PipelineError(f"not in {designs_file.name}: {sorted(missing)}")
    with ThreadPoolExecutor(max_workers=4) as pool:
        for line in pool.map(lambda d: safe(d, data, args.force), designs):
            print(line, flush=True)


if __name__ == "__main__":
    main()
