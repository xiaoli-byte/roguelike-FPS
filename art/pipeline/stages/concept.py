"""阶段 01 · 概念设计：以白模四视图为底图，用 GPT Image 2.5 重绘成正式的角色设定四视图（paintover）。

硬约束是「四格位置、剪影、比例与白模一致」：后面的高模对齐和投影贴图都依赖白模的相机参数。
产出后自动比对每格剪影与白模的重合度（IoU），并出一张对照图供人工审核（人工闸门）。
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from lib import imaging, openai_image
from lib.config import CFG, ROOT, AssetSpec, PipelineError
from lib.state import AssetState

IOU_WARN = 0.72

LAYOUT = """\
The input image is a grey-box 3D blockout of ONE game character rendered as an orthographic turnaround:
four views in a single row, left to right: FRONT view, LEFT side view (character faces image-left),
BACK view, RIGHT side view (character faces image-right).

Repaint it into a finished, production-quality character model sheet of the same character.

HARD CONSTRAINTS (do not break any of these):
- Keep exactly four views, each centred on exactly the same spot as in the input, same scale, same ground line.
- Each view must keep the blockout's silhouette, pose and proportions: arms held out in the same A-pose with
  straight elbows, same shoulder / elbow / wrist / hip / knee heights, same leg stance, same head size and height.
  Organic detail may round off the boxy shapes, but stay within the original outline.
- Orthographic, no perspective, no camera tilt. The four views must show the identical character with identical
  colours, materials and details, consistent from every side.
- Fully transparent background. No ground, no cast shadows, no text, no labels, no frames, no extra props.
- Keep glowing elements (eyes) where the blockout has orange glowing spots.
"""


LAYOUT_PROP = """\
The input image is a grey-box 3D blockout of ONE game prop (a weapon / shield / magic implement) rendered as an
orthographic turnaround: four views in a single row, left to right: FRONT view (the main face), LEFT side view,
BACK view, RIGHT side view. The prop is displayed standing upright for the model sheet; in game it is held or
mounted in another orientation.

Repaint it into a finished, production-quality prop model sheet of the same object.

HARD CONSTRAINTS (do not break any of these):
- Keep exactly four views, each centred on exactly the same spot as in the input, same scale, same baseline.
- Each view must keep the blockout's silhouette and proportions: same overall length, width and thickness, same
  position of the grip / head / blade / barrel along the length. Detail may bevel and refine the boxy shapes,
  but stay within the original outline.
- Orthographic, no perspective, no camera tilt. The four views must show the identical object with identical
  colours, materials and details, consistent from every side.
- Fully transparent background. Only the object: no hands, no characters, no stand, no ground, no cast shadows,
  no text, no labels, no frames.
- Keep glowing elements where the blockout has glowing parts (same colour family).
"""


LAYOUT_ARM = """\
The input image is a grey-box 3D blockout of ONE FIRST-PERSON GAME ARM (the hand, wrist cuff and forearm sleeve a
player sees in a first-person shooter) rendered as an orthographic turnaround: four views in a single row, left to
right: FRONT view, LEFT side view, BACK view, RIGHT side view. The arm is displayed upright for the model sheet.

Repaint it into a finished, production-quality first-person arm model sheet of the same arm.

HARD CONSTRAINTS (do not break any of these):
- Keep exactly four views, each centred on exactly the same spot as in the input, same scale, same baseline.
- Each view must keep the blockout's silhouette and proportions: same hand size and position, same cuff, same sleeve
  length and thickness. The sleeve simply ends where the blockout ends (it is cut off there in game).
- The hand keeps the blockout's pose: fingers closed around an INVISIBLE grip. Do NOT draw any weapon, handle or
  object in or near the hand. Only the arm.
- Orthographic, no perspective, no camera tilt. The four views must show the identical arm with identical colours,
  materials and details, consistent from every side.
- Fully transparent background. No body, no shoulder, no ground, no cast shadows, no text, no labels, no frames.
"""


LAYOUT_CREATURE = """\
The input image is a grey-box 3D blockout of ONE game creature / boss rendered as an orthographic turnaround:
four views in a single row, left to right: FRONT view, LEFT side view (creature faces image-left),
BACK view, RIGHT side view (creature faces image-right).

Repaint it into a finished, production-quality creature model sheet of the same creature.

HARD CONSTRAINTS (do not break any of these):
- Keep exactly four views, each centred on exactly the same spot as in the input, same scale, same ground line.
- Keep the blockout's EXACT pose: every limb, leg, wing, tassel, floating piece and ornament stays where it is,
  at the same angle and length; same body proportions. Organic detail may round off the boxy shapes, but stay
  within the original outline. Separate pieces in the blockout stay visibly separate.
- Orthographic, no perspective, no camera tilt. The four views must show the identical creature with identical
  colours, materials and details, consistent from every side.
- Fully transparent background. No ground, no cast shadows, no text, no labels, no frames, no extra props.
- Keep glowing elements (eyes, cores, runes, glowing sacs) exactly where the blockout has glowing parts.
"""


def build_prompt(spec: AssetSpec, note: str) -> str:
    style = CFG.section("concept")["style"].strip()
    if spec.raw.get("concept_layout") == "fp_arm":  # 第一人称手臂：只画手臂，手里不画任何东西
        style = style.replace("game character art", "game first-person arm art")
        parts = [LAYOUT_ARM, f"ART STYLE:\n{style}", f"ARM DESIGN:\n{spec.brief}"]
    elif spec.raw.get("presentation"):  # 按展示姿态出图的部件资产（枪）：道具版式，活动部件也画在原位
        style = style.replace("game character art", "game prop art")
        parts = [LAYOUT_PROP, f"ART STYLE:\n{style}", f"PROP DESIGN:\n{spec.brief}"]
    elif spec.raw.get("rig") == "parts":
        style = style.replace("game character art", "game creature art")
        parts = [LAYOUT_CREATURE, f"ART STYLE:\n{style}", f"CREATURE DESIGN:\n{spec.brief}"]
    elif spec.kind == "static":
        style = style.replace("game character art", "game prop art")
        parts = [LAYOUT_PROP, f"ART STYLE:\n{style}", f"PROP DESIGN:\n{spec.brief}"]
    else:
        parts = [LAYOUT, f"ART STYLE:\n{style}", f"CHARACTER DESIGN:\n{spec.brief}"]
    if note:
        parts.append(f"ADDITIONAL DIRECTION FOR THIS REVISION:\n{note}")
    return "\n\n".join(parts)


def compare_sheet(bo_panels: list[Path], cn_panels: list[Image.Image], out: Path) -> list[float]:
    """三行对照：白模 / 概念 / 概念叠白模轮廓（红线）。返回每格 IoU。"""
    w, h = cn_panels[0].size
    sheet = Image.new("RGB", (w * 4, h * 3), (200, 200, 200))
    ious = []
    for i, (bp, cn) in enumerate(zip(bo_panels, cn_panels)):
        bo = Image.open(bp).convert("RGBA")
        mb, mc = imaging.alpha_mask(bo), imaging.alpha_mask(cn)
        ious.append(round(imaging.iou(mb, mc), 3))
        for row, im in enumerate((bo, cn, cn)):
            tile = Image.new("RGBA", (w, h), (200, 200, 200, 255))
            tile.alpha_composite(im)
            sheet.paste(tile.convert("RGB"), (i * w, row * h))
        edge = mb ^ np.roll(mb, 1, 0) | mb ^ np.roll(mb, 1, 1)
        ys, xs = np.nonzero(edge)
        px = sheet.load()
        for y, x in zip(ys, xs):
            px[i * w + x, 2 * h + y] = (230, 30, 30)
        ImageDraw.Draw(sheet).text((i * w + 8, 2 * h + 8), f"IoU {ious[-1]:.2f}", fill=(0, 0, 0))
    sheet.save(out)
    return ious


def register_sheet(sheet: Path, bo_panels: list[Path]) -> list[tuple[Image.Image, dict]]:
    """切出四个人物，逐个配准到对应的白模格子（生成模型不保证逐像素保持构图，这一步把它拉回白模相机坐标）。"""
    im = imaging.key_flat_background(Image.open(sheet))
    figures = imaging.segment_figures(im, 4)
    return [imaging.register(fig, imaging.alpha_mask(Image.open(bp))) for fig, bp in zip(figures, bo_panels)]


def reregister(spec: AssetSpec) -> None:
    """对当前概念版本重新做配准（算法改进后补跑，不重新调用接口）。"""
    st = AssetState(spec)
    cn = st.require_any("concept")
    bo = st.require("blockout")
    stem = f"CN_{spec.id}_v{cn['version']:03d}"
    out = spec.stage_dir("concept")
    bo_panels = [st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}_{v}.png") for v in imaging.VIEW_ORDER]
    registered = register_sheet(out / f"{stem}_sheet.png", bo_panels)
    for v, (im, _) in zip(imaging.VIEW_ORDER, registered):
        im.save(out / f"{stem}_{v}.png")
    ious = compare_sheet(bo_panels, [im for im, _ in registered], out / f"{stem}_compare.png")
    cn["registration"] = dict(zip(imaging.VIEW_ORDER, [r for _, r in registered]))
    cn["silhouette_iou"] = dict(zip(imaging.VIEW_ORDER, ious))
    st.refresh_hashes("concept", cn)
    print("剪影重合度 IoU：" + "  ".join(f"{v} {i:.2f}" for v, i in zip(imaging.VIEW_ORDER, ious)))


def run(spec: AssetSpec, a) -> None:
    st = AssetState(spec)
    bo = st.require("blockout")
    cfg = CFG.section("concept")
    model = a.model or cfg["model"]
    quality = a.quality or cfg["quality"]
    w, h = cfg["sheet_size"]
    prompt = build_prompt(spec, a.note)
    if a.dry_run:
        print(prompt)
        print(f"\n（dry-run：模型 {model}，{w}x{h}，quality={quality}）")
        return

    bo_sheet = st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}_sheet.png")
    bo_panels = [st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}_{v}.png") for v in imaging.VIEW_ORDER]
    ver = st.next_version("concept")
    out = spec.stage_dir("concept")
    stem = f"CN_{spec.id}_v{ver:03d}"
    print(f"→ 调用 {model}（{w}x{h}，{quality}），底图 {bo_sheet.name} …", flush=True)
    png, info = openai_image.edit(prompt, [bo_sheet], model=model, size=f"{w}x{h}", quality=quality)
    sheet = out / f"{stem}_sheet.png"
    sheet.write_bytes(png)

    registered = register_sheet(sheet, bo_panels)
    views = [im for im, _ in registered]
    panels = []
    for v, im in zip(imaging.VIEW_ORDER, views):
        p = out / f"{stem}_{v}.png"
        im.save(p)
        panels.append(p)
    compare = out / f"{stem}_compare.png"
    ious = compare_sheet(bo_panels, views, compare)
    info["registration"] = dict(zip(imaging.VIEW_ORDER, [r for _, r in registered]))
    prompt_file = out / f"{stem}_prompt.txt"
    prompt_file.write_text(prompt, encoding="utf-8")

    rec = st.add_version("concept", {
        "version": ver, "from_blockout": bo["version"], **info, "note": a.note,
        "silhouette_iou": dict(zip(imaging.VIEW_ORDER, ious)),
    }, [sheet, *panels, compare, prompt_file])
    usage = info.get("usage") or {}
    print(f"✔ 概念 v{ver:03d}：{sheet.relative_to(ROOT)}（{info['seconds']} 秒，用量 {json.dumps(usage)}）")
    print(f"  剪影重合度 IoU：" + "  ".join(f"{v} {i:.2f}" for v, i in zip(imaging.VIEW_ORDER, ious)))
    low = [v for v, i in zip(imaging.VIEW_ORDER, ious) if i < IOU_WARN]
    if low:
        print(f"  ⚠ {', '.join(low)} 与白模剪影偏差较大（< {IOU_WARN}），对齐和投影会受影响，建议重出")
    print(f"  对照图：{compare.relative_to(ROOT)}")
    print(f"  审核：assetctl.py approve {spec.id} concept --by <审核人>   或   reject … --note <原因>")
    if rec is None:
        raise PipelineError("记录失败")
