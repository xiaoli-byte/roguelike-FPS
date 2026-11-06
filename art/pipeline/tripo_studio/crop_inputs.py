"""Tripo multiview inputs: the four figures of an asset's current concept source sheet, one uniform scale,
centred on 1024x1024 transparent squares.  usage: python crop_inputs.py <ID> [--flip back,right] [--same-front]"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # repo root (art/pipeline/tripo_studio/..)
sys.path.insert(0, str(ROOT / "art" / "pipeline"))
import numpy as np
from PIL import Image
from lib import imaging
from lib.config import CFG
from lib.state import AssetState

KEY_TOL = {"zhurong": 18.0}
OUT = Path(__file__).parent / "inputs"


def main(aid: str, flips: set[str], same_front: bool) -> None:
    spec = CFG.asset(aid)
    st = AssetState(spec)
    cn = st.current("concept")
    src = st.file(cn, f"CN_{aid}_v{cn['version']:03d}_source.png")
    sys.path.insert(0, str(Path(__file__).parent))
    import figs as F
    with Image.open(src) as im:
        crops = F.figures(im, "row")
    big = max(max(c.width, c.height) for c in crops)
    s = 900 / big
    out = OUT / aid
    out.mkdir(parents=True, exist_ok=True)
    for view, c in zip(imaging.VIEW_ORDER, crops):
        if same_front:
            c = crops[0]
        if view in flips:
            c = c.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        w, h = max(1, round(c.width * s)), max(1, round(c.height * s))
        r = c.resize((w, h), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        canvas.alpha_composite(r, ((1024 - w) // 2, (1024 - h) // 2))
        canvas.save(out / f"{view}.png")
    # contact sheet for eyeballing
    row = Image.new("RGBA", (4 * 512, 512), (214, 214, 214, 255))
    for i, view in enumerate(imaging.VIEW_ORDER):
        with Image.open(out / f"{view}.png") as v:
            row.alpha_composite(v.resize((512, 512)), (i * 512, 0))
    row.convert("RGB").save(out / "_contact.jpg", quality=85)
    print(aid, f"concept v{cn['version']:03d}", "->", out)


if __name__ == "__main__":
    args = sys.argv[1:]
    flips = set()
    same = "--same-front" in args
    if "--flip" in args:
        flips = set(args[args.index("--flip") + 1].split(","))
    main(args[0], flips, same)
