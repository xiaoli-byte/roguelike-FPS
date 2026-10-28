"""特效风格审查的改前 / 改后拼图（docs/art/review/fx-polish/style/*.jpg，审查报告见 docs/art/review/fx-polish/style-audit.md）。

    python scripts/unity/fx_style_sheets.py <改前目录> <改后目录> [输出目录]

两个目录里是 unity/Assets/Art/_Review 下的 playtest_*.png：
    sty_*        bridge.sh playtest fx-style（亮沙 / 雪 / 熔岩三种地面，每种地面一行改前、一行改后）
    fxa_* / blade_fp_*   playtest fx-shot / blade-fp（射击核心，沙地）
    fxb_*        playtest fx-blast（爆炸序列等，沙地）
改前用风格审查之前的代码拍一遍、改后再拍一遍。每张拼图同一机位、同一时间点上下对排。
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "docs", "art", "review", "fx-polish", "style")
WINDIR = os.environ.get("WINDIR", "C:/Windows")
FONT_PATHS = [os.path.join(WINDIR, "Fonts", "msyh.ttc"), os.path.join(WINDIR, "Fonts", "simhei.ttf"), "/System/Library/Fonts/PingFang.ttc"]


def font(size):
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


F_TITLE, F_CELL, F_SIDE = font(30), font(20), font(24)
BG = (22, 22, 26)
GROUNDS = (("sand", "亮沙"), ("snow", "雪"), ("lava", "熔岩"))


def load(d, name, w, h, crop=None):
    p = os.path.join(d, f"playtest_{name}.png")
    if not os.path.exists(p):
        im = Image.new("RGB", (w, h), (60, 20, 20))
        ImageDraw.Draw(im).text((10, 10), f"缺 {name}", font=F_CELL, fill=(255, 200, 200))
        return im
    im = Image.open(p).convert("RGB")
    if crop:
        # crop = (中心 x, 中心 y, 宽度占比)：按格子的宽高比取一块，夹在图内
        W, H = im.size
        cx, cy, cw = crop
        rw = W * cw
        rh = min(H, rw * h / w)
        x0 = min(max(0, W * cx - rw / 2), W - rw)
        y0 = min(max(0, H * cy - rh / 2), H - rh)
        im = im.crop((int(x0), int(y0), int(x0 + rw), int(y0 + rh)))
    return im.resize((w, h), Image.LANCZOS)


def sheet(title, rows, before, after, out, w=400, h=225, note=None):
    """rows = [(行标题, [(格名, 文件名, 裁切或 None), ...]), ...]：每一行拼改前 + 改后两行"""
    cols = max(len(c) for _, c in rows)
    side = 110
    head = 56 + (30 if note else 0)
    cell_h = h + 28
    H = head + len(rows) * (2 * cell_h + 14)
    W = side + cols * w
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((14, 10), title, font=F_TITLE, fill=(255, 236, 200))
    if note:
        d.text((14, 50), note, font=F_CELL, fill=(200, 200, 200))
    y = head
    for label, cells in rows:
        for tag, src, color in (("改前", before, (200, 150, 150)), ("改后", after, (150, 220, 160))):
            d.text((10, y + cell_h // 2 - 26), label, font=F_CELL, fill=(230, 230, 230))
            d.text((10, y + cell_h // 2 + 2), tag, font=F_SIDE, fill=color)
            for i, (cap, name, crop) in enumerate(cells):
                x = side + i * w
                d.text((x + 6, y + 2), cap, font=F_CELL, fill=(220, 220, 220))
                img.paste(load(src, name, w - 4, h, crop), (x, y + 26))
            y += cell_h
        y += 14
    img.save(out, quality=86)
    print("写入", out, img.size)


def grounds(cells):
    """三种地面各一行：cells = [(格名, 后缀, 裁切), ...] → sty_<地面>_<后缀>"""
    return [(n, [(cap, f"sty_{g}_{suf}", crop) for cap, suf, crop in cells]) for g, n in GROUNDS]


def main():
    before, after = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else OUT
    os.makedirs(out, exist_ok=True)
    J = lambda name: os.path.join(out, name)
    mid = (0.5, 0.45, 0.62)

    sheet("爆炸 · 三种地面（中档 3 m；第三人称旁边站一只怪当参照，第一人称准星压在怪身上）",
          grounds([("第三人称 0.15 s", "blast_015", None), ("第三人称 0.6 s（烟）", "blast_060", None),
                   ("第一人称 0.12 s", "fp_blast", None), ("第一人称 0.55 s", "fp_blast_late", None)]),
          before, after, J("S1-explosion-grounds.jpg"))
    times = ["015", "030", "060", "110"]
    sheet("爆炸三档 · 序列（沙地，固定侧机位）",
          [(f"{n}档", [(f"{int(t) / 100:.2f} s", f"fxb_blast_{k}_{t}", (0.5, 0.42, 0.62)) for t in times]) for k, n in (("s", "小"), ("m", "中"), ("l", "大"))],
          before, after, J("S2-explosion-sequence.jpg"))
    sheet("元素反应 · 三种地面（焚雷 / 归墟的闪光、熔金的余韵）",
          grounds([("焚雷 · 闪光 0.04 s", "rx_thunderfire_flash", mid), ("焚雷 · 冲击波 0.2 s", "rx_thunderfire_wave", mid),
                   ("归墟 · 闪光 0.04 s", "rx_abyss_flash", mid), ("归墟 · 0.2 s", "rx_abyss_wave", mid),
                   ("熔金 · 余韵 0.65 s", "rx_meltdown_after", mid)]),
          before, after, J("S3-reactions.jpg"), w=360, h=203)
    sheet("状态 · 三种地面（一排：灼烧 / 感电 / 蚀化 / 眩晕 / 减速；近景）",
          grounds([("一排 8.5 m", "status", None), ("灼烧", "status_burn", (0.5, 0.42, 0.55)), ("感电", "status_shock", (0.5, 0.42, 0.55)),
                   ("蚀化", "status_corrode", (0.5, 0.42, 0.55)), ("眩晕", "status_stun", (0.5, 0.36, 0.55)), ("减速（冰壳）", "status_slow", (0.5, 0.42, 0.55))]),
          before, after, J("S4-status.jpg"), w=330, h=248)
    sheet("护盾 / 护甲 · 三种地面（受击球壳、破盾一刻、破甲一刻）",
          grounds([("护盾受击", "shield_hit", mid), ("破盾 0.07 s", "shield_break", mid), ("破甲 0.07 s", "armor_break", mid)]),
          before, after, J("S5-shield-armor.jpg"), w=480, h=270)
    sheet("开火 · 三种地面（第一人称：开火那一帧 + 连射 0.45 s 的曳光 / 命中火花）",
          grounds([("冲锋枪 · 开火", "fp_smg", None), ("冲锋枪 · 连射", "fp_smg_burst", None),
                   ("霰弹 · 开火", "fp_shotgun", None), ("霰弹 · 连射", "fp_shotgun_burst", None)]),
          before, after, J("S6-fire-grounds.jpg"))
    weapons = (("smg", "蜂鸣冲锋枪"), ("rifle", "裂风步枪"), ("shotgun", "碎岩霰弹"), ("sniper", "鹰隼狙击"), ("revolver", "赤铜左轮"),
               ("launcher", "焚城榴弹"), ("railgun", "贯虹灵炮"), ("magmashot", "赤蛟霰铳"), ("trinity", "三才转轮"))
    sheet("枪口火焰 · 九把（沙地；第一人称开火那一帧 + 第三人称侧面）",
          [(n, [("第一人称", f"fxa_w_{k}_fp", (0.62, 0.62, 0.55)), ("第三人称", f"fxa_w_{k}_side", (0.4, 0.5, 0.55))]) for k, n in weapons],
          before, after, J("S7-muzzle.jpg"), w=520, h=292)
    sheet("弹孔 / 焦痕 · 三种地面（步枪扫一片地 + 一颗小爆炸：0.9 s 余热、4 s 冷却）",
          grounds([("0.9 s", "ground_hot", None), ("4 s", "ground_cold", None)]),
          before, after, J("S8-ground-marks.jpg"), w=560, h=315)
    sheet("弹孔 / 焦痕 · 近景（沙地 fx-shot）",
          [("弹孔", [("石 · 余热", "fxa_hole_stone_hot", None), ("沙", "fxa_hole_sand_hot", None), ("冰", "fxa_hole_ice_hot", None), ("金属", "fxa_hole_metal_hot", None)]),
           ("焦痕", [("0.3 s", "fxa_scorch_a", None), ("1.5 s", "fxa_scorch_b", None), ("5 s", "fxa_scorch_c", None)])],
          before, after, J("S9-holes-scorch.jpg"))
    sheet("命中火花 · 盾 / 甲 / 血肉 / 弱点 + 暴击（沙地 fx-shot，侧面近景）",
          [("命中", [("护盾", "fxa_layer_shield_close", (0.5, 0.45, 0.6)), ("护甲", "fxa_layer_armor_close", (0.5, 0.45, 0.6)),
                     ("血肉", "fxa_layer_flesh_close", (0.5, 0.45, 0.6)), ("弱点", "fxa_layer_weak_close", (0.5, 0.42, 0.6))]),
           ("暴击", [("普通 0.25 s", "fxa_normal_a_close", (0.5, 0.45, 0.6)), ("暴击 0.25 s", "fxa_crit_a_close", (0.5, 0.45, 0.6)),
                     ("暴击 0.6 s", "fxa_crit_b_close", (0.5, 0.45, 0.6)), ("暴击 · 第一人称", "fxa_crit_a_fp", None)])],
          before, after, J("S10-hits.jpg"))
    sheet("碎刃刀光 · 三段斩（blade-fp，判定帧 / 收势）",
          [(f"第 {k} 段", [("判定帧", f"blade_fp_slash{k}_b_strike", None), ("收势", f"blade_fp_slash{k}_c_follow", None)]) for k in (1, 2, 3)],
          before, after, J("S11-blade.jpg"), w=640, h=360)
    sheet("出生 / 死亡 · 三种地面（显形中途 0.32 s、火元素击杀迸散）",
          grounds([("显形中", "spawn", None), ("死亡迸散", "death", None)]),
          before, after, J("S12-spawn-death.jpg"), w=560, h=315)


if __name__ == "__main__":
    main()
