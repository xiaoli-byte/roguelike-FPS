"""附属阶段 · 发光分区（Emissive ID）：从审核通过的概念图生成同构图的自发光遮罩（白 = 会发光的细节）。

枪的稀有度、元素是按实例变的，不能画进贴图。遮罩只标出「会发光的细节」（雕刻纹路、符文刻槽、散热缝、能量导管），
游戏化阶段和颜色走同一套投影烘焙成 T_*_E 自发光贴图；运行时按实例给自发光着色（元素色，无元素时用稀有度色）并做脉动，
取代程序化枪模上那些贴在表面的发光平板。只作废游戏化及之后的阶段，不影响高模。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from lib import imaging, openai_image
from lib.config import CFG, ROOT, AssetSpec
from lib.state import AssetState
from stages.matid import decode

PROMPT = """Convert this model sheet into an EMISSIVE MASK with exactly the same layout: the same four views at exactly the
same positions, sizes and silhouettes, every detail in the same place.
Recolour EVERY surface with exactly one of two flat colours:
- PURE RED (#FF0000) only for the thin ornamental details that will glow with magical energy: engraved inlay lines,
  engraved scrollwork grooves, rune engravings, narrow vent slits and energy conduits. Keep them as thin as they are
  drawn; together they cover only a small part of the object (roughly 3 to 10 percent).
- PURE BLUE (#0000FF) for everything else: all plain metal, wood, leather, cloth, bone and stone surfaces, large flat
  panels, barrels, grips, screws and rivets.
No other colours anywhere on the object: no white, no grey, no original colours, no shading, no gradients,
no outlines, no texture. Fully transparent background.
"""
RATIO_WARN = (0.01, 0.2)


def run(spec: AssetSpec, a) -> None:
    st = AssetState(spec)
    cn = st.require("concept")
    cfg = CFG.section("concept")
    model = getattr(a, "model", None) or cfg["model"]
    w, h = cfg["sheet_size"]
    sheet_in = st.file(cn, f"CN_{spec.id}_v{cn['version']:03d}_sheet.png")
    cn_panels = [st.file(cn, f"CN_{spec.id}_v{cn['version']:03d}_{v}.png") for v in imaging.VIEW_ORDER]

    ver = st.next_version("emid")
    out = spec.stage_dir("concept")
    stem = f"EID_{spec.id}_v{ver:03d}"
    print(f"→ 发光分区：{model}，底图 {sheet_in.name} …", flush=True)
    hint = spec.raw.get("emissive_hint", "").strip()
    prompt = PROMPT + (f"\nASSET-SPECIFIC NOTES (which details glow):\n{hint}\n" if hint else "")
    png, info = openai_image.edit(prompt, [sheet_in], model=model, size=f"{w}x{h}", quality=cfg["quality"])
    sheet = out / f"{stem}_sheet.png"
    sheet.write_bytes(png)

    # 逐个配准到概念视图的剪影上（同材质分区）
    figures = imaging.segment_figures(imaging.key_flat_background(Image.open(sheet)), 4)
    panels, regs, ratio = [], {}, {}
    compare = Image.new("RGB", (512 * 4, 1024 * 2), (200, 200, 200))
    for i, (v, fig, cp) in enumerate(zip(imaging.VIEW_ORDER, figures, cn_panels)):
        concept = Image.open(cp).convert("RGBA")
        reg, info_r = imaging.register(fig, imaging.alpha_mask(concept))
        mask, r, purity = decode(reg)
        regs[v] = {**info_r, "purity": round(purity, 3)}
        p = out / f"{stem}_{v}.png"
        mask.save(p)
        panels.append(p)
        ratio[v] = round(r, 3)
        # 对照：上排概念，下排概念上叠发光区域（青）
        tile = Image.new("RGBA", concept.size, (200, 200, 200, 255))
        tile.alpha_composite(concept)
        compare.paste(tile.convert("RGB"), (i * 512, 0))
        a_ = np.asarray(mask)
        glow = (a_[..., 3] > 127) & (a_[..., :3].mean(-1) > 127)
        over = np.asarray(tile.convert("RGB")).copy()
        over[glow] = (over[glow] * 0.25 + np.array([40, 230, 255]) * 0.75).astype(np.uint8)
        compare.paste(Image.fromarray(over), (i * 512, 1024))
    cmp_path = out / f"{stem}_compare.png"
    compare.save(cmp_path)
    (out / f"{stem}_prompt.txt").write_text(prompt, encoding="utf-8")

    st.add_version("emid", {"version": ver, "from_concept": cn["version"], **info, "registration": regs,
                            "emissive_ratio": ratio}, [sheet, *panels, cmp_path])
    print(f"✔ 发光分区 v{ver:03d}：发光占比 " + "  ".join(f"{v} {r:.0%}" for v, r in ratio.items()))
    bad = [v for v, r in ratio.items() if not RATIO_WARN[0] <= r <= RATIO_WARN[1]]
    if bad:
        print(f"  ⚠ {', '.join(bad)} 发光占比不在 {RATIO_WARN[0]:.0%}–{RATIO_WARN[1]:.0%}，看对照图确认")
    print(f"  对照图（青 = 发光）：{cmp_path.relative_to(ROOT)}")
