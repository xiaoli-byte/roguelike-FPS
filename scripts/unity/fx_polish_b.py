"""特效打磨 B 路的改前 / 改后对比拼图（docs/art/review/fx-polish/B/*.jpg）。

    python scripts/unity/fx_polish_b.py <改前目录> <改后目录> [输出目录]

两个目录里是 bridge.sh playtest fx-blast 拍的 playtest_fxb_*.png（改前用旧代码拍一遍、改后再拍一遍）。
每张拼图一行改前、一行改后（同一机位、同一时间点），左侧标「改前 / 改后」，格子上方写时间点 / 名字。
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "docs", "art", "review", "fx-polish", "B")
WINDIR = os.environ.get("WINDIR", "C:/Windows")
FONT_PATHS = [os.path.join(WINDIR, "Fonts", "msyh.ttc"), os.path.join(WINDIR, "Fonts", "simhei.ttf"), "/System/Library/Fonts/PingFang.ttc"]


def font(size):
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


F_TITLE, F_CELL, F_SIDE = font(30), font(20), font(24)
BG = (22, 22, 26)


def load(d, name, w, h, crop=None):
    p = os.path.join(d, f"playtest_fxb_{name}.png")
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


def sheet(title, rows, cols, before, after, out, w=384, h=216, crop=None, note=None):
    """rows = [(行标题, [(格名, 文件名), ...]), ...]：每一行拼改前 + 改后两行"""
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
            for i, (cap, name) in enumerate(cells):
                x = side + i * w
                d.text((x + 6, y + 2), cap, font=F_CELL, fill=(220, 220, 220))
                img.paste(load(src, name, w - 4, h, crop), (x, y + 26))
            y += cell_h
        y += 14
    img.save(out, quality=86)
    print("写入", out, img.size)


def main():
    before, after = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else OUT
    os.makedirs(out, exist_ok=True)
    times = ["005", "015", "030", "060", "110"]
    tl = lambda t: f"{int(t) / 100:.2f} s"
    sheet("爆炸三档 · 序列（固定侧机位，0.05 / 0.15 / 0.3 / 0.6 / 1.1 s）",
          [(f"{n}档", [(tl(t), f"blast_{k}_{t}") for t in times]) for k, n in (("s", "小"), ("m", "中"), ("l", "大"))],
          5, before, after, os.path.join(out, "B1-explosion.jpg"),
          note="小 0.8 m（弹丸）/ 中 3 m（榴弹、火药、焚雷）/ 大 7 m（首领技能、精英自爆）")
    rx = (("meltdown", "熔金"), ("thunderfire", "焚雷"), ("veinseal", "封脉"), ("abyss", "归墟"), ("collapse", "崩解"))
    sheet("元素反应 · 闪光 → 冲击波 → 余韵（执行后 0.04 / 0.2 / 0.65 s）",
          [(n, [("闪光", f"rx_{k}_1flash"), ("冲击波", f"rx_{k}_2wave"), ("余韵", f"rx_{k}_3after")]) for k, n in rx],
          3, before, after, os.path.join(out, "B2-reactions.jpg"), w=512, h=288)
    st = (("burn", "灼烧"), ("shock", "感电"), ("corrode", "蚀化"), ("stun", "眩晕"), ("slow", "减速"))
    sheet("状态外观 · 远景（第一人称 18 m / 9 m）",
          [("远近", [("18 m 第一人称", "status_far"), ("9 m 第一人称", "status_mid")])],
          2, before, after, os.path.join(out, "B3-status-far.jpg"), w=800, h=450,
          note="靶子从左到右：灼烧 / 感电 / 蚀化 / 眩晕 / 减速")
    sheet("状态外观 · 18 m 局部放大（只看颜色分得清五种）",
          [("18 m", [("灼烧 / 感电 / 蚀化 / 眩晕 / 减速", "status_far")])],
          1, before, after, os.path.join(out, "B3b-status-far-zoom.jpg"), w=1200, h=300, crop=(0.5, 0.505, 0.36))
    sheet("状态外观 · 近景（侧面 3 m）",
          [("五种", [(n, f"status_{k}") for k, n in st])],
          5, before, after, os.path.join(out, "B4-status-near.jpg"), w=400, h=300, crop=(0.5, 0.42, 0.55))
    sheet("护盾 / 护甲 · 受击与破碎（侧面机位）",
          [("护盾", [("受击（球壳 + 涟漪）", "shield_hit_side"), ("破盾一刻", "shield_break"), ("破盾后 0.25 s", "shield_break_late")]),
           ("护甲", [("受击", "armor_hit_side"), ("破甲一刻", "armor_break"), ("破甲后 0.25 s", "armor_break_late")])],
          3, before, after, os.path.join(out, "B5-shield-armor.jpg"), w=512, h=288, crop=(0.5, 0.45, 0.6))
    sheet("火舌（FlameTongue：火浣鼠 / 镇墓兽 / 祸斗 / 炭童 / 地火 + 火柱）",
          [("怪物", [("火浣鼠", "flame_fire_rat"), ("镇墓兽", "flame_tomb_beast"), ("祸斗", "flame_huodou"), ("炭童", "flame_tantong")]),
           ("一次性", [("地火 + 火柱", "flame_ground")])],
          4, before, after, os.path.join(out, "B6-flames.jpg"), w=440, h=330, crop=(0.5, 0.42, 0.5))
    sheet("出生 / 死亡（通用部分）",
          [("出生死亡", [("显形中", "spawn_mid"), ("死亡迸散（火元素击杀）", "death_burst"), ("尸体溶解", "death_dissolve")])],
          3, before, after, os.path.join(out, "B7-spawn-death.jpg"), w=512, h=288)
    # 三章出生法阵（只有改后：C 路主题法阵 + B 路通用光墙 / 溶解 / 光点螺旋）
    w, h = 512, 288
    img = Image.new("RGB", (3 * w + 20, 56 + 2 * (h + 28)), BG)
    d = ImageDraw.Draw(img)
    d.text((14, 10), "三章出生法阵（C 路主题法阵 + B 路通用光墙 / 溶解 / 光点螺旋，改后）", font=F_TITLE, fill=(255, 236, 200))
    for i, (k, n) in enumerate((("jerboa_blade", "第一章 · 沙"), ("jiaoren", "第二章 · 冰"), ("tantong", "第三章 · 火"))):
        for j, suf in enumerate(("", "_late")):
            x, y = 10 + i * w, 56 + j * (h + 28)
            d.text((x + 6, y + 2), f"{n} · {'0.3 s' if j == 0 else '0.55 s'}", font=F_CELL, fill=(220, 220, 220))
            img.paste(load(after, f"spawn_theme_{k}{suf}", w - 4, h, (0.5, 0.48, 0.55)), (x, y + 26))
    p = os.path.join(out, "B8-spawn-themes.jpg")
    img.save(p, quality=86)
    print("写入", p, img.size)


if __name__ == "__main__":
    main()
