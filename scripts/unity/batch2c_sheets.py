"""第二批收尾 C 路的改前 / 改后拼图（docs/art/review/batch2/C/*.jpg）。

    python scripts/unity/batch2c_sheets.py [截图目录] [输出目录]

截图目录缺省 unity/Assets/Art/_Review（bridge.sh playtest review-glow 的 playtest_b2c_*.png；同一次运行里切开关拍的改前 / 改后，
光照、机位、时间点都一样）。每张拼图一行一种地面（亮沙 / 雪 / 熔岩），每个状态左改前、右改后：
    hanba-glow.jpg     旱魃：平时 / 日蚀 / 复燃（龟裂白金裂光 + 日轮三层自发光；日蚀黑盘暖黑 → 冷黑）
    hanba-cracks-close.jpg  同上的胸口近景（看龟裂）
    hanba-hair.jpg     长发回垂：人形手 K 片段里发链的关键帧播没播出来（只拍沙地）
    warlord-blade.jpg  熔心魔将大剑：平时 / 前摇烧亮 / 狂怒（剑脊熔铜纹 + 刃口白热；改前只有边光）
    crack-ch3.jpg      第三章砸地：魔将重击落地 + 精英砸地，0.25 s / 2.5 s 俯视 + 第一人称（改前：熔铜贴花 / 不留贴花）+ 狂怒白热
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC = os.path.join(ROOT, "unity", "Assets", "Art", "_Review")
OUT = os.path.join(ROOT, "docs", "art", "review", "batch2", "C")
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
        W, H = im.size
        cx, cy, cw = crop
        rw = W * cw
        rh = min(H, rw * h / w)
        x0 = min(max(0, W * cx - rw / 2), W - rw)
        y0 = min(max(0, H * cy - rh / 2), H - rh)
        im = im.crop((int(x0), int(y0), int(x0 + rw), int(y0 + rh)))
    return im.resize((w, h), Image.LANCZOS)


def sheet(title, cols, src, out, w=360, h=203, crop=None, note=None, grounds=GROUNDS):
    """cols = [(列标题, 文件名模板（{g} = 地面）), ...]；一行一种地面"""
    side = 90
    top = 56 + (30 if note else 0)
    W = side + len(cols) * (w + 6) + 6
    H = top + 34 + len(grounds) * (h + 6) + 6
    im = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(im)
    dr.text((12, 10), title, font=F_TITLE, fill=(240, 236, 228))
    if note:
        dr.text((12, 50), note, font=F_CELL, fill=(190, 186, 178))
    for ci, (label, _) in enumerate(cols):
        x = side + 6 + ci * (w + 6)
        after = label.endswith("改后")
        dr.text((x + 4, top + 4), label, font=F_CELL, fill=(255, 210, 120) if after else (200, 200, 205))
    for ri, (g, gname) in enumerate(grounds):
        y = top + 34 + ri * (h + 6)
        dr.text((12, y + h // 2 - 14), gname, font=F_SIDE, fill=(230, 226, 218))
        for ci, (_, tmpl) in enumerate(cols):
            x = side + 6 + ci * (w + 6)
            im.paste(load(src, tmpl.format(g=g), w, h, crop), (x, y))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out, quality=88)
    print(f"写入 {out}（{W} × {H}）")


def pairs(states, stem):
    cols = []
    for key, name in states:
        cols.append((f"{name} · 改前", f"b2c_{{g}}_{stem}_{key}_before"))
        cols.append((f"{name} · 改后", f"b2c_{{g}}_{stem}_{key}_after"))
    return cols


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    out = sys.argv[2] if len(sys.argv) > 2 else OUT
    sheet("旱魃 · 龟裂白金裂光与日轮自发光（_E 遮罩，第二批收尾 C 路）",
          pairs((("idle", "平时"), ("eclipse", "日蚀"), ("flare", "复燃 +0.08 s")), "hanba"), src, os.path.join(out, "hanba-glow.jpg"),
          note="改前：本体 / 日轮没有自发光，日蚀黑盘暖黑；改后：龟裂裂光随日轮炽度、日蚀时烧亮（暖），黑盘冷靛，复燃三层到峰值")
    sheet("旱魃近景 · 皮肤龟裂的白金裂光（胸口前 4.5 m）",
          pairs((("idle", "平时"), ("eclipse", "日蚀"), ("flare", "复燃 +0.08 s")), "hanbaclose"), src, os.path.join(out, "hanba-cracks-close.jpg"),
          note="龟裂 = emission_mask.py 的 thin 规则：暗皮肤里比 9 纹素（4096 底色）窄的金线；残衣同色的大色块不亮")
    sheet("旱魃 · 长发回垂（人形手 K 片段里发链的关键帧；弹簧骨开着，停在回垂最大的那一帧）",
          [("死亡 · 改前", "b2c_hair_death_before"), ("死亡 · 改后", "b2c_hair_death_after"),
           ("焦裂 · 改前", "b2c_hair_crackPalm_before"), ("焦裂 · 改后", "b2c_hair_crackPalm_after")],
          src, os.path.join(out, "hanba-hair.jpg"), w=480, h=270, grounds=(("", "沙地"),),
          note="改前 = 发链骨每帧压回绑定姿势（= 片段里的发链曲线没播出来）；改后 = 发链根节照片段回垂，弹簧骨以它为目标")
    sheet("熔心魔将 · 大剑正式发光遮罩（剑脊熔铜纹 R / 刃口 G）",
          pairs((("rest", "平时"), ("windup", "前摇烧亮"), ("fury", "狂怒")), "blade"), src, os.path.join(out, "warlord-blade.jpg"),
          note="改前：借底色贴图当 _EmissionMap，但材质没开 _EMISSION，只剩边光；改后：剑脊余烬 → 烧亮，刃口狂怒白热，剑格 / 剑柄不亮")
    cols = pairs((("025", "砸下 0.25 s"), ("250", "2.5 s 冷却中"), ("fp", "第一人称")), "crack")
    cols.append(("狂怒 0.25 s · 改后", "b2c_{g}_crack_fury_after"))
    sheet("第三章砸地 · 方形裂纹贴花（左：魔将重击落地 4.6 m，右：精英砸地 1.8 m）", cols, src, os.path.join(out, "crack-ch3.jpg"), w=300, h=169,
          note="改前：魔将留一滩熔铜贴花、精英不留贴花；改后：方坑 + 方折裂纹 + 方石板缝，铜橙裂光、紫褐焦边，慢慢冷成暗铜缝")


if __name__ == "__main__":
    main()
