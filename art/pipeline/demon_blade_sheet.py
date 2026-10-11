"""Design sheet for the 魔刀千刃 redesign (docs/demon-blade-v2.md).

  python demon_blade_sheet.py [--force]

GPT Image edit with the user's three Scissor Seven references (two anime frames + the official replica) as input.
The sheet restyles the anime weapon for this game (Gunfire Reborn level stylised, hand-painted) and shows the states
the runtime has to build: whole weapon, blade root demon face (eye closed / open), grip, and the fragment forms.
Output: art/source/weapons/SK_Weapon_DemonBlade/00_design/DS_SK_Weapon_DemonBlade_v<NNN>.png with the exact prompt and
generation record next to it. An existing sheet is never regenerated without --force (every image costs money).
"""
from __future__ import annotations

import argparse
import json
import sys

from lib.config import CFG, _load_env
from lib import openai_image
from lib.state import resolve_path

ASSET = resolve_path("art/source/weapons/SK_Weapon_DemonBlade")
REFS = [ASSET / "references" / n for n in
        ("user-03-product-silhouette.png", "user-02-closed-blade.png", "user-01-edge-fragments.png")]

PROMPT = """Weapon design sheet for a stylised first-person roguelite shooter, at the production quality and art style
of Gunfire Reborn weapons: bold readable silhouette, chunky clean forms with broad faceted planes, hand-painted PBR
textures with soft painted gradients, crisp bevel highlights and restrained edge wear, two or three dominant colour
blocks plus one glowing accent. No black cartoon outlines.

The weapon is the "Demon Blade of a Thousand Edges" from the reference images: the sword ONLY, no character, no hands.
Keep its identity from the references: a long single-edged sword with a gentle curve and a tapering tip, total length
about 1.07 m; a long grip tightly wrapped in black cord; a small flat black rectangular guard; a dark gunmetal blade
root just above the guard that carries a large luminous cyan-blue swirling demon-spirit face motif (stylised flame-like
curls forming brow, eye and fanged mouth); the same cyan swirl motif on the pommel cap. From the root the blade turns
into a mosaic of hundreds of separate angular blade shards: pale lavender-silver plates with painted bevels, divided by
deep violet glowing seams, darker toward the spine, the cutting edge glowing white-hot violet, a soft purple aura
around the blade. Exaggerate slightly for game readability: a wider blade than the replica, chunkier shards.

Layout, plain flat light grey background (#D6D6D6), no text, labels or frames, even studio lighting, no cast shadows:
- Top: the complete sword in exact side view, laid horizontally across the full width, grip on the left, tip on the
  right, cutting edge facing down, with margin on all sides.
- Bottom left: close-up of the blade root demon face, twice side by side: dormant (eye shut, dim cyan) and awakened
  (a single slit demon eye opened in violet-white light, motif blazing).
- Bottom middle: close-up of the guard, cord-wrapped grip and pommel cap.
- Bottom right, three small vignettes of the same shards: (1) the blade edge breaking apart, shards streaming from the
  tip toward the hilt; (2) all shards released as a swirling vortex swarm with violet trails; (3) the shards locked
  into a round spinning shield disc."""


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    _load_env()
    out = ASSET / "00_design"
    out.mkdir(parents=True, exist_ok=True)
    existing = sorted(out.glob("DS_SK_Weapon_DemonBlade_v*.png"))
    if existing and not args.force:
        print(f"= {existing[-1].name} already exists (use --force to pay for another)")
        return
    stem = f"DS_SK_Weapon_DemonBlade_v{len(existing) + 1:03d}"
    cfg = CFG.section("concept")
    png, info = openai_image.edit(PROMPT, REFS, model=cfg["model"], size="2048x1024", quality=cfg["quality"],
                                  background="opaque")
    (out / f"{stem}.png").write_bytes(png)
    (out / f"{stem}_prompt.txt").write_text(PROMPT, encoding="utf-8")
    (out / f"{stem}.json").write_text(json.dumps({"references": [p.name for p in REFS], "generation": info},
                                                 ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✔ {out / (stem + '.png')}  ({info['seconds']} s)")


if __name__ == "__main__":
    main()
