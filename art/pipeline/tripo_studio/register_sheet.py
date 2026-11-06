"""Register a Tripo Studio (GPT Image 2.5) concept image as the asset's concept (tripo_assets.register), then approve it.

  python register_sheet.py <ID> <image.png> --prompt <prompt.txt> [--layout row|grid] [--variant N]
         [--swap-sides] [--flip back,left,right] [--same-front] [--note "..."] [--no-approve]

The four figures are keyed with figs.key (border flood + enclosed background holes), re-laid as one clean row on the
sheet grey and registered; --swap-sides / --flip fix the image model's side-view mistakes, --same-front uses the front
figure for all four views (4-fold symmetric pieces)."""
import argparse
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # repo root (art/pipeline/tripo_studio/..)
sys.path.insert(0, str(ROOT / "art" / "pipeline"))
sys.path.insert(0, str(Path(__file__).parent))
from PIL import Image
from lib.state import AssetState
import tripo_assets as ta
import prepare_nature_batch as nature
import figs as F

ap = argparse.ArgumentParser()
ap.add_argument("id")
ap.add_argument("image")
ap.add_argument("--prompt", required=True)
ap.add_argument("--layout", default="row")
ap.add_argument("--variant", type=int, default=0)
ap.add_argument("--swap-sides", action="store_true")
ap.add_argument("--flip", default="")
ap.add_argument("--same-front", action="store_true")
ap.add_argument("--note", default="")
ap.add_argument("--no-approve", action="store_true")
ap.add_argument("--batch", default="", help="approval note prefix, e.g. 2026-11-06 祝融套件 3-1")
a = ap.parse_args()

spec = ta.tripo_spec(a.id)
state = AssetState(spec)
bo = nature.prepare_reference(a.id)
views = json.loads(state.file(bo, f"BO_{a.id}_v{bo['version']:03d}_views.json").read_text(encoding="utf-8"))

figs = F.figures(Image.open(a.image), a.layout)
fixes = [f"layout {a.layout}"]
if a.swap_sides:
    figs = [figs[0], figs[3], figs[2], figs[1]]; fixes.append("swapped left/right views")
if a.same_front:
    figs = [figs[0]] * 4; fixes.append("front view used for all four (4-fold symmetric)")
order = ["front", "left", "back", "right"]
for v in [x for x in a.flip.split(",") if x]:
    i = order.index(v)
    figs[i] = figs[i].transpose(Image.Transpose.FLIP_LEFT_RIGHT); fixes.append(f"mirrored {v} view")

# clean row sheet (record of what was registered)
gap = 80
Hh = max(f.height for f in figs) + 2 * gap
Ww = sum(f.width for f in figs) + gap * 5
sheet = Image.new("RGBA", (Ww, Hh), (214, 214, 214, 255))
x = gap
for f in figs:
    sheet.alpha_composite(f, (x, Hh - gap - f.height)); x += f.width + gap
buf = io.BytesIO()
sheet.convert("RGB").save(buf, "PNG")

# register exactly these figures (the pipeline's own segmentation would re-split thin members)
nature.imaging.segment_figures = lambda *_a, **_k: [f.copy() for f in figs]
nature.imaging.key_flat_background = lambda im, *_a, **_k: im.convert("RGBA")
prompt = Path(a.prompt).read_text(encoding="utf-8")
info = {"provider": "tripo_studio", "model": "GPT Image 2.5", "size": list(Image.open(a.image).size), "variants": 4,
        "selected_variant": a.variant, "references": [], "fixes": fixes, "note": a.note,
        "source_image": Path(a.image).name}
ta.register(spec, state, bo, views, buf.getvalue(), prompt, info)
if not a.no_approve:
    v = state.set_review("concept", "approved", "Claude AI visual review",
                         (a.batch or __import__("datetime").date.today().isoformat()) + "：用户授权免审，按推荐方案直接通过" + (f"；{a.note}" if a.note else ""))
    print(f"approved concept v{v['version']:03d}")
