"""单遍后处理改前 / 改后对比图（第二批 E 路）：把 bridge.sh playtest fp-look-ch1/2/3 存的
unity/Assets/Art/_Review/fp_look_<关卡>_<机位序号>_before|after.png、fp_look_<关卡>_third_*、fp_look_<关卡>_<fire|reload|skill|flash>_*（fp-shots）
拼成 JPG，左列改前（叠加枪模相机，世界后处理两遍 + 改前的 Volume 值），右列改后（单相机，单遍后处理 + 重调的 Volume 值）。

    python scripts/unity/fp_look_sheets.py --out docs/art/review/batch2/E
输出：fp_<关卡>.jpg（每关一张，每行一个机位）、fp_actions_<关卡>.jpg（开火 / 换弹 / 技能 / 枪口火焰）、third_<关卡>.jpg（第三人称机位，单遍，改前的值 / 现在的值）、
flash_zoom.jpg（三章枪口火焰同一帧的局部特写，放大 2 倍）。
"""
import argparse
import glob
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
REVIEW = os.path.join(ROOT, "unity", "Assets", "Art", "_Review")
CELL = (800, 450)
LABELS = ("改前：叠加枪模相机，世界后处理两遍", "改后：单相机，单遍后处理 + 重调 Volume")
THIRD = ("改前的 Volume 值（单遍）", "重调后的 Volume 值（单遍）")
ACTIONS = [("fire", "开火"), ("reload", "换弹"), ("skill", "技能出手"), ("flash", "枪口火焰（白芯最亮的一帧）")]


def font(size):
    win = os.environ.get("WINDIR", "C:/Windows")
    for f in (os.path.join(win, "Fonts", "msyh.ttc"), os.path.join(win, "Fonts", "simhei.ttf")):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def sheet(rows, labels, out, quality):
    """rows: [(行名, 改前路径, 改后路径)]"""
    img = Image.new("RGB", (CELL[0] * 2, CELL[1] * len(rows)), (24, 24, 24))
    d = ImageDraw.Draw(img)
    f = font(22)
    for r, (name, before, after) in enumerate(rows):
        for c, p in enumerate((before, after)):
            x, y = c * CELL[0], r * CELL[1]
            if p and os.path.exists(p):
                img.paste(Image.open(p).convert("RGB").resize(CELL, Image.LANCZOS), (x, y))
            tag = f"{name} · {labels[c]}"
            d.rectangle([x, y, x + 20 + d.textlength(tag, font=f), y + 34], fill=(0, 0, 0))
            d.text((x + 10, y + 4), tag, fill=(255, 235, 170), font=f)
    img.save(out, quality=quality)
    print(out)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "art", "review", "batch2", "E"))
    ap.add_argument("--quality", type=int, default=82)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    views = {}
    for p in glob.glob(os.path.join(REVIEW, "fp_look_*_before.png")):
        m = re.match(r"fp_look_(\d-\d)_(\d+)_before\.png$", os.path.basename(p))
        if m:
            views.setdefault(m.group(1), []).append(int(m.group(2)))
    if not views:
        sys.exit(f"{REVIEW} 里没有 fp_look_*_before.png：先跑 bridge.sh playtest fp-look-ch1 …")
    for level, idx in sorted(views.items()):
        rows = [(f"{level} 机位 {i + 1}", os.path.join(REVIEW, f"fp_look_{level}_{i}_before.png"), os.path.join(REVIEW, f"fp_look_{level}_{i}_after.png"))
                for i in sorted(idx)]
        sheet(rows, LABELS, os.path.join(a.out, f"fp_{level}.jpg"), a.quality)
        acts = [(f"{level} {name}", os.path.join(REVIEW, f"fp_look_{level}_{key}_before.png"), os.path.join(REVIEW, f"fp_look_{level}_{key}_after.png"))
                for key, name in ACTIONS if os.path.exists(os.path.join(REVIEW, f"fp_look_{level}_{key}_before.png"))]
        if acts:
            sheet(acts, LABELS, os.path.join(a.out, f"fp_actions_{level}.jpg"), a.quality)
        third = os.path.join(REVIEW, f"fp_look_{level}_third_before.png")
        if os.path.exists(third):
            sheet([(f"{level} 第三人称", third, os.path.join(REVIEW, f"fp_look_{level}_third_after.png"))], THIRD,
                  os.path.join(a.out, f"third_{level}.jpg"), a.quality)
    flash_zoom(a.out, a.quality)


def flash_zoom(out, quality):
    """三章（各第一关）枪口火焰同一帧（fp-shots 白芯最亮的那一帧）的局部特写：以改前右下角最亮的那团为中心裁 360×240，放大 2 倍"""
    import numpy as np
    rows = []
    for level in ("1-1", "2-1", "3-1"):
        b = os.path.join(REVIEW, f"fp_look_{level}_flash_before.png")
        a = os.path.join(REVIEW, f"fp_look_{level}_flash_after.png")
        if os.path.exists(b) and os.path.exists(a):
            rows.append((level, b, a))
    if not rows:
        return
    cw, ch, z = 360, 240, 2
    img = Image.new("RGB", (cw * z * 2, ch * z * len(rows)), (24, 24, 24))
    d = ImageDraw.Draw(img)
    f = font(22)
    for r, (level, b, a) in enumerate(rows):
        ib = Image.open(b).convert("RGB")
        w, h = ib.size
        arr = np.asarray(ib).astype(float)
        lum = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        sub = lum[h // 2:, w // 2:]
        thr = np.percentile(sub, 99.7)
        ys, xs = np.nonzero(sub >= thr)
        cx, cy = int(xs.mean()) + w // 2, int(ys.mean()) + h // 2
        box = (max(0, min(w - cw, cx - cw // 2)), max(0, min(h - ch, cy - ch // 2)))
        box = (box[0], box[1], box[0] + cw, box[1] + ch)
        for c, p in enumerate((b, a)):
            crop = Image.open(p).convert("RGB").crop(box).resize((cw * z, ch * z), Image.NEAREST)
            x, y = c * cw * z, r * ch * z
            img.paste(crop, (x, y))
            tag = f"{level} 枪口火焰特写 · {'改前：叠加枪模相机' if c == 0 else '改后：单相机 + 第一人称补偿'}"
            d.rectangle([x, y, x + 20 + d.textlength(tag, font=f), y + 34], fill=(0, 0, 0))
            d.text((x + 10, y + 4), tag, fill=(255, 235, 170), font=f)
    path = os.path.join(out, "flash_zoom.jpg")
    img.save(path, quality=quality)
    print(path)


if __name__ == "__main__":
    main()
