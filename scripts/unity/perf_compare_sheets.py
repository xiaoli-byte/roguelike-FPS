"""I4 改前 / 改后截图对比：把对照套件（bridge.sh playtest perf-cull-ch1 …）拍的
unity/Assets/Art/_Review/playtest_<前缀>_<关卡>_<机位>_<档>_<配置序号>.png 拼成每关一张 JPG：
三行（出生 / 中段远眺 / 战斗）× 两列（配置 0 = 改前，配置 1 = 改后），左上角写关卡、档、机位、改前 / 改后。

    python scripts/unity/perf_compare_sheets.py --prefix perfcull --tier high --out docs/art/review/perf
"""
import argparse
import glob
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
REVIEW = os.path.join(ROOT, "unity", "Assets", "Art", "_Review")
VIEWS = [("spawn", "出生"), ("vista", "中段远眺"), ("combat", "战斗")]
CELL = (800, 450)


def font(size):
    win = os.environ.get("WINDIR", "C:/Windows")
    for f in (os.path.join(win, "Fonts", "msyh.ttc"), os.path.join(win, "Fonts", "simhei.ttf"),
              os.path.join(ROOT, "unity", "Assets", "Game", "Resources", "UI", "Fonts", "NotoSansSC-Regular.otf")):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default="perfcull")
    ap.add_argument("--tier", default="high")
    ap.add_argument("--labels", default="改前（不按图层剔除）,改后（按图层剔除）")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "art", "review", "perf"))
    ap.add_argument("--quality", type=int, default=80)
    a = ap.parse_args()
    labels = a.labels.split(",")
    pat = re.compile(rf"playtest_{re.escape(a.prefix)}_(.+?)_(spawn|vista|combat)_{a.tier}_(\d)\.png$")
    shots = {}
    for p in glob.glob(os.path.join(REVIEW, f"playtest_{a.prefix}_*_{a.tier}_*.png")):
        m = pat.search(os.path.basename(p))
        if m:
            shots[(m.group(1), m.group(2), int(m.group(3)))] = p
    levels = sorted({k[0] for k in shots})
    if not levels:
        sys.exit(f"{REVIEW} 里没有 playtest_{a.prefix}_*_{a.tier}_*.png")
    os.makedirs(a.out, exist_ok=True)
    f_big, f_small = font(30), font(22)
    for level in levels:
        sheet = Image.new("RGB", (CELL[0] * 2, CELL[1] * len(VIEWS)), (24, 24, 24))
        d = ImageDraw.Draw(sheet)
        for row, (key, name) in enumerate(VIEWS):
            for col in (0, 1):
                p = shots.get((level, key, col))
                x, y = col * CELL[0], row * CELL[1]
                if p:
                    sheet.paste(Image.open(p).convert("RGB").resize(CELL, Image.LANCZOS), (x, y))
                tag = f"{level} · {'高' if a.tier == 'high' else '低'}档 · {name} · {labels[col]}"
                d.rectangle([x, y, x + 20 + d.textlength(tag, font=f_small), y + 34], fill=(0, 0, 0))
                d.text((x + 10, y + 4), tag, fill=(255, 235, 170), font=f_small)
        out = os.path.join(a.out, f"{a.prefix}_{level}_{a.tier}.jpg")
        sheet.save(out, quality=a.quality)
        print(out)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
