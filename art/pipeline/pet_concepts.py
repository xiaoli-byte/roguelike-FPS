"""Pet (灵兽) concept four-view sheets through the local Codex CLI, split into Tripo multiview inputs.

    python art/pipeline/pet_concepts.py                 # all pets that have no sheet yet
    python art/pipeline/pet_concepts.py SK_Pet_Baize    # (re)generate one pet
    python art/pipeline/pet_concepts.py --split-only    # re-split existing sheets

Fast track for the first pet batch (docs/pet-system.md): the pets are not in registry.toml yet, so this writes straight to
art/source/pets/<ID>/concept/ (sheet + front/left/back/right PNGs with keyed background). The Tripo GLB goes to
art/source/_tripo_inbox/, and art/pipeline/blender/bl_pet_export.py turns it into the Unity FBX + texture.
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from lib import codex_image, imaging  # noqa: E402
from lib.config import CFG, ROOT  # noqa: E402

CODEX_MODEL = "gpt-5.6-sol"  # codex-cli 0.146 + ChatGPT sign-in rejects pipeline.toml's gpt-6.1-sol

SHEET_LAYOUT = """Output: one orthographic model turnaround sheet for 3D reconstruction. Exactly four separate complete views
of the SAME creature in one row, left to right:
1. FRONT view: the creature's face and chest face the viewer.
2. LEFT side view: the creature turned 90 degrees so its head points to the LEFT edge of the image.
3. BACK view: the creature's back and tail face the viewer.
4. RIGHT side view: the creature turned 90 degrees so its head points to the RIGHT edge of the image.
Same pose, same scale and same ground line in all four, each centred in its quarter with generous empty margin, never
touching or overlapping; the whole creature fits inside its quarter, nothing cropped. One single solid connected body:
no loose particles, no separate floating pieces, no flames, smoke, sparkles or glow effects drawn around it.
Plain flat light neutral grey background (#D6D6D6). No floor, no ground shadow, no text, no labels, no frames, no
perspective."""

# id → (display, height note, brief). Rarity and gameplay live in unity/Assets/Game/Scripts/Pets/PetDefs.cs.
PETS: dict[str, tuple[str, str, str]] = {
    "SK_Pet_Dangkang": ("当康", "about 0.7 m tall", """A small chubby mythical piglet-boar spirit (Dangkang of the Shan Hai Jing, omen of
good harvests) standing on all fours: round barrel body on four short sturdy legs with small dark hooves, a short upturned
snout, two small curved ivory tusks, big friendly dark eyes, floppy ears, warm wheat-gold and cream bristly fur with a
darker russet stripe down the back, a crest of golden rice-grain stalks growing from its forehead, a small red cloth knot
around its neck holding a round bronze coin charm. Cute, sturdy and cheerful."""),
    "SK_Pet_Huan": ("讙", "about 0.6 m tall", """A wild mountain cat spirit (Huan of the Shan Hai Jing) standing on all fours: lean agile
feline body, ONE single big round amber eye in the middle of its face, tall tufted lynx ears, three long bushy tails raised
and fanned out behind it, smoky charcoal-grey fur with pale silver stripes, a cream chest ruff, a collar of three small
bronze bells. Alert, mischievous expression, neutral standing pose."""),
    "SK_Pet_Jingwei": ("精卫", "body 0.45 m long, wingspan 0.9 m", """A small mythical bird (Jingwei of the Shan Hai Jing, daughter of the
Flame Emperor): a crow-sized songbird with a patterned black-and-white head, a white beak and bright red feet, glossy
black and crimson plumage with ember-orange wing tips, a round grey pebble held in its beak. Wings spread wide and flat in
a gliding pose, tail feathers fanned, legs tucked under the body."""),
    "SK_Pet_Chongming": ("重明鸟", "wingspan 1.3 m", """A mythical double-pupilled bird (Chongming bird, which drives away evil beasts):
a pheasant-like bird with golden-white plumage, long flowing tail feathers in gold and sky blue, an upswept feather crest,
large eyes that each show two cyan pupils side by side, sky-blue zigzag lightning patterns painted on the wings. Wings
spread wide in a hovering pose, tail hanging down, legs tucked."""),
    "SK_Pet_Suanni": ("狻猊", "about 0.8 m tall", """The mythical lion-dragon Suanni (one of the dragon's nine sons, guardian of incense burners)
as a small stout guardian lion-dog standing on all fours: a big round head with a huge curly mane of jade-green and teal
swirls, bulging round eyes, a wide grinning mouth with small fangs, a stocky body with dark bronze-gold fur, curly flame-like
tufts at the elbows, a thick curly tail, a small round bronze incense burner (ding) with three tiny legs sitting on its back
like a saddle, and a red silk ribbon with a bronze bell on its chest. Palette: verdigris jade, aged bronze gold, a touch of
red. Proud, loyal, protective."""),
    "SK_Pet_Zheng": ("狰", "about 0.85 m tall", """A ferocious mythical beast (Zheng of the Shan Hai Jing) standing on all fours in a low
crouched ready stance: a lean muscular red leopard with ONE curved stone-grey horn on its forehead and FIVE long whip-like
tails fanned out behind it, black rosette spots on crimson fur, a cream belly, bared fangs, flint-grey claws."""),
    "SK_Pet_Baize": ("白泽", "about 1.3 m tall", """The legendary sage beast Baize, who knows every demon in the world, standing calm and
dignified on four legs: a majestic lion-goat body with long flowing snow-white fur, a long white beard, two curved golden
horns, a third eye on its forehead, a row of small golden eyes along each flank, golden cloud-pattern ornaments on its
shoulders, a jade talisman pendant hanging at its chest, cloud-shaped fur tufts around its hooves. Palette: white, gold and
pale jade; radiant, holy and noble."""),
    "SK_Pet_Yinglong": ("应龙", "body 2.4 m long", """The legendary winged dragon Yinglong as a young Chinese loong flying in a gentle S-curve:
a long sinuous serpentine body with jade-green scales and a gold belly, two large feathered eagle-like wings spread wide,
deer-antler horns, a flowing white mane and long whiskers, four small clawed legs, a pearl held in one front claw, storm-blue
lightning streaks on the wing feathers. Compact pose that fits inside its quarter."""),
}


def out_dir(asset_id: str) -> Path:
    return ROOT / "art" / "source" / "pets" / asset_id / "concept"


def prompt_for(asset_id: str) -> str:
    display, size, brief = PETS[asset_id]
    style = CFG.section("concept")["style"].strip()
    brief = " ".join(brief.split())
    return f"{style}\n\nCreature ({display}, {size}): {brief}\n\n{SHEET_LAYOUT}"


def keep_main_islands(im: Image.Image) -> Image.Image:
    """Drop stray fragments of the neighbouring views (wing tips crossing the column split): keep islands >= 3% of the largest."""
    from scipy import ndimage
    a = np.asarray(im).copy()
    mask = a[..., 3] > 16
    labels, n = ndimage.label(mask)
    if n <= 1:
        return im
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= sizes.max() * 0.03
    a[..., 3] = np.where(keep[labels], a[..., 3], 0)
    return Image.fromarray(a)


def split(sheet: Path, out: Path) -> list[Path]:
    """Four views by column occupancy: key the flat background, find the four widest foreground column runs."""
    with Image.open(sheet) as im:
        rgba = imaging.key_flat_background(im.convert("RGBA"), 24.0)
    alpha = np.asarray(rgba)[..., 3] > 16
    cols = alpha.sum(axis=0) > 2
    runs, start = [], None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append((start, x))
            start = None
    # merge runs separated by tiny gaps (tails, whiskers), then keep the four widest
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 12:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    merged = sorted(sorted(merged, key=lambda r: r[1] - r[0], reverse=True)[:4])
    if len(merged) != 4:
        # fall back to quarters
        w = rgba.width // 4
        merged = [(i * w, (i + 1) * w) for i in range(4)]
    paths = []
    for view, (x0, x1) in zip(imaging.VIEW_ORDER, merged):
        crop = rgba.crop((max(0, x0 - 8), 0, min(rgba.width, x1 + 8), rgba.height))
        crop = keep_main_islands(crop)
        bbox = crop.getbbox()
        fig = crop.crop(bbox)
        side = int(max(fig.width, fig.height) / 0.85)
        canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
        canvas.alpha_composite(fig, ((side - fig.width) // 2, (side - fig.height) // 2))
        canvas = canvas.convert("RGB").resize((1024, 1024), Image.LANCZOS)
        p = out / f"{sheet.stem.replace('_sheet', '')}_{view}.png"
        canvas.save(p)
        paths.append(p)
    return paths


def make(asset_id: str) -> str:
    out = out_dir(asset_id)
    out.mkdir(parents=True, exist_ok=True)
    prompt = prompt_for(asset_id)
    png, info = codex_image.generate(prompt, model=CODEX_MODEL, size="2048x1024", retries=2)
    sheet = out / f"CN_{asset_id}_sheet.png"
    sheet.write_bytes(png)
    (out / f"CN_{asset_id}_prompt.txt").write_text(prompt, encoding="utf-8")
    (out / f"CN_{asset_id}_generation.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    views = split(sheet, out)
    return f"{asset_id}: {info.get('seconds')} s → {[v.name for v in views]}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--split-only", action="store_true")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    ids = a.ids or [i for i in PETS if not (out_dir(i) / f"CN_{i}_sheet.png").exists() or a.split_only]
    if a.split_only:
        for i in ids:
            sheet = out_dir(i) / f"CN_{i}_sheet.png"
            if sheet.exists():
                print(i, [p.name for p in split(sheet, out_dir(i))], flush=True)
        return
    with ThreadPoolExecutor(a.jobs) as pool:
        futs = {pool.submit(make, i): i for i in ids}
        for f, i in futs.items():
            try:
                print(f.result(), flush=True)
            except Exception as e:  # keep the batch going
                print(f"FAILED {i}: {e}", flush=True)


if __name__ == "__main__":
    main()
