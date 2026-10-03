"""附属阶段 · 材质分区（Material ID）：从审核通过的概念图生成同构图的黑白金属遮罩。

金属（钢、铁、铜、金、铆钉、扣件、金属甲片）= 白，非金属（布、皮革、木、骨、皮肤、纸、宝石、发光件）= 黑。
遮罩逐视图配准到概念图的剪影上，游戏化阶段和颜色走同一套投影烘焙出金属度贴图，并据此给出分区粗糙度。
没有遮罩时游戏化阶段退回登记表里的常量。只会作废游戏化及之后的阶段，不影响高模。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from lib import imaging, openai_image
from lib.config import CFG, ROOT, AssetSpec
from lib.state import AssetState

PROMPT = """Convert this model sheet into a MATERIAL ID MAP with exactly the same layout: the same four views at exactly the
same positions, sizes and silhouettes, every detail in the same place.
Recolour EVERY surface with exactly one of two flat colours:
- PURE RED (#FF0000) for METAL: steel, iron, bronze, brass, gold, silver, metal armor plates, rivets, buckles,
  metal rings and fittings, blades, gun barrels.
- PURE BLUE (#0000FF) for everything NON-METAL: cloth, leather, wood, bone, skulls, skin, hair, paper, rope,
  feathers, gems, glass, glowing eyes or glowing energy, lacquer and paint.
Straps, belts, sashes, bandoliers and wraps are NON-METAL (blue) even when they carry metal parts; only the small
buckles, rivets and fittings on them are metal (red).
No other colours anywhere on the object: no white, no grey, no original colours, no shading, no gradients,
no outlines, no texture. Fully transparent background.
"""
# 编码：红 = 金属、蓝 = 非金属。比黑白编码稳健：原本就是白色的骨头 / 布料不会被当成「已经涂白」保留下来
PURITY_WARN = 0.85


def decode(panel: Image.Image) -> tuple[Image.Image, float, float]:
    """红蓝编码 → 灰度遮罩（白 = 金属），返回 (遮罩 RGBA, 金属占比, 编码纯度)。"""
    a = np.asarray(panel.convert("RGBA")).astype(np.int32)
    on = a[..., 3] > 127
    r, b = a[..., 0], a[..., 2]
    metal = (r - b) > 40
    pure = (np.abs(r - b) > 80) & on
    g = np.where(metal, 255, 0).astype(np.uint8)
    out = np.dstack([g, g, g, np.where(on, 255, 0).astype(np.uint8)])
    n = max(1, on.sum())
    return Image.fromarray(out, "RGBA"), float((metal & on).sum() / n), float(pure.sum() / n)


def run(spec: AssetSpec, a) -> None:
    st = AssetState(spec)
    cn = st.require("concept")
    cfg = CFG.section("concept")
    model = getattr(a, "model", None) or cfg["model"]
    w, h = cfg["sheet_size"]
    sheet_in = st.file(cn, f"CN_{spec.id}_v{cn['version']:03d}_sheet.png")
    cn_panels = [st.file(cn, f"CN_{spec.id}_v{cn['version']:03d}_{v}.png") for v in imaging.VIEW_ORDER]

    ver = st.next_version("matid")
    out = spec.stage_dir("concept")
    stem = f"MID_{spec.id}_v{ver:03d}"
    print(f"→ 材质分区：{model}，底图 {sheet_in.name} …", flush=True)
    hint = spec.raw.get("matid_hint", "").strip()
    prompt = PROMPT + (f"\nASSET-SPECIFIC MATERIAL NOTES:\n{hint}\n" if hint else "")
    png, info = openai_image.edit(prompt, [sheet_in], model=model, size=f"{w}x{h}", quality=cfg["quality"])
    sheet = out / f"{stem}_sheet.png"
    sheet.write_bytes(png)

    # 逐个人物配准到「配准后的概念视图」剪影上（生成模型不保证构图，和概念阶段同一个道理）
    figures = imaging.segment_figures(imaging.key_flat_background(Image.open(sheet)), 4)
    panels, regs, metal_ratio = [], {}, {}
    compare = Image.new("RGB", (512 * 4, 1024 * 2), (200, 200, 200))
    for i, (v, fig, cp) in enumerate(zip(imaging.VIEW_ORDER, figures, cn_panels)):
        concept = Image.open(cp).convert("RGBA")
        reg, info_r = imaging.register(fig, imaging.alpha_mask(concept))
        mask, ratio, purity = decode(reg)
        regs[v] = {**info_r, "purity": round(purity, 3)}
        p = out / f"{stem}_{v}.png"
        mask.save(p)
        panels.append(p)
        a_ = np.asarray(mask)
        on = a_[..., 3] > 127
        metal_ratio[v] = round(ratio, 3)
        if purity < PURITY_WARN:
            print(f"  ⚠ {v} 编码纯度 {purity:.0%}（大量像素既不红也不蓝），遮罩可能不可靠")
        # 对照：上排概念，下排概念上叠金属区域（红）
        tile = Image.new("RGBA", concept.size, (200, 200, 200, 255))
        tile.alpha_composite(concept)
        compare.paste(tile.convert("RGB"), (i * 512, 0))
        over = np.asarray(tile.convert("RGB")).copy()
        metal = on & (a_[..., :3].mean(-1) > 127)
        over[metal] = (over[metal] * 0.4 + np.array([230, 40, 40]) * 0.6).astype(np.uint8)
        compare.paste(Image.fromarray(over), (i * 512, 1024))
    cmp_path = out / f"{stem}_compare.png"
    compare.save(cmp_path)

    st.add_version("matid", {"version": ver, "from_concept": cn["version"], **info, "registration": regs,
                             "metal_ratio": metal_ratio}, [sheet, *panels, cmp_path])
    print(f"✔ 材质分区 v{ver:03d}：金属占比 " + "  ".join(f"{v} {r:.0%}" for v, r in metal_ratio.items()))
    print(f"  对照图（红 = 金属）：{cmp_path.relative_to(ROOT)}")
    (out / f"{stem}_prompt.txt").write_text(prompt, encoding="utf-8")
