"""第四章地基（F 路）的改前 / 改后对比图：读 playtest gallery-ch4-f 的截图（unity/Assets/Art/_Review/playtest_ch4f_*.png），
拼成带标题的横排对比图，存 docs/art/review/ch4-port/F/*.jpg。

    python scripts/unity/ch4f_compare.py
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC = os.path.join(ROOT, "unity", "Assets", "Art", "_Review")
OUT = os.path.join(ROOT, "docs", "art", "review", "ch4-port", "F")
W = 760  # 每格宽

SHEETS = [
    ("01_spawn_sigil", "出生法阵（4-1 第一人称，啸獭显形中）",
     [("ch4f_sigil_before", "改前：通用符文"), ("ch4f_sigil_after", "改后：第四章「雷纹」（紫红外环 + 折线雷纹 + 四雷齿 + 粉白雷心）")]),
    ("02_charged_rim", "带电（天狗，同一机位）",
     [("ch4f_charge_before", "不带电"), ("ch4f_charge_after", "带电：紫红轮廓光噼啪（不染整只）"), ("ch4f_charge_after2", "带电：下一下脉冲 + 贴骨短电弧")]),
    ("03_strike_warning", "落雷预警（半径 3.2 m，预警 1.2 s 时第 0.7 s）",
     [("ch4f_strike_before", "改前：一般危险圆（只有正红填充）"), ("ch4f_strike_after", "改后：正红填充 + 外沿紫红雷标"), ("ch4f_strike_land", "劈下那一帧")]),
    ("04_plateau_storm", "高原雷暴（同一机位远眺）",
     [("ch4f_storm_before", "晴天（VP_Plateau 单遍）"), ("ch4f_storm_after", "雷暴满强度：压暗、偏冷、雨、落雷")]),
]


def font(size):
    for name in ("msyh.ttc", "simhei.ttf", "simsun.ttc"):
        p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    title_f, cap_f = font(26), font(19)
    made = 0
    for key, title, cells in SHEETS:
        ims = []
        for name, cap in cells:
            p = os.path.join(SRC, f"playtest_{name}.png")
            if not os.path.exists(p):
                print(f"缺 {p}")
                continue
            im = Image.open(p).convert("RGB")
            h = round(im.height * W / im.width)
            ims.append((im.resize((W, h), Image.LANCZOS), cap))
        if not ims:
            continue
        h = max(i.height for i, _ in ims)
        sheet = Image.new("RGB", (W * len(ims) + 8 * (len(ims) - 1), h + 92), (18, 16, 22))
        d = ImageDraw.Draw(sheet)
        d.text((14, 10), title, font=title_f, fill=(240, 232, 220))
        for k, (im, cap) in enumerate(ims):
            x = k * (W + 8)
            sheet.paste(im, (x, 50))
            d.text((x + 10, 50 + h + 8), cap, font=cap_f, fill=(225, 215, 200))
        out = os.path.join(OUT, f"{key}.jpg")
        sheet.save(out, quality=88)
        print(out)
        made += 1
    return 0 if made == len(SHEETS) else 1


if __name__ == "__main__":
    sys.exit(main())
