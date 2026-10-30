"""招式节拍条的改前 / 改后对比拼图（首领与精英动作 · 特效调优）。

输入：bridge.sh playtest beats-<…> 拍出来的 unity/Assets/Art/_Review/beats/<套件>/（*.jpg + manifest.json，HBeatSuites.cs），
      改前那一份先拷到别处（同样的目录结构）。
输出：每个招式一张 jpg：上一行改前、下一行改后，按节拍排（起手 / 预警 / 蓄力顶点 / 释放帧 / 持续段 / 复燃 / 收招 / 第一人称）。

用法：
  python scripts/unity/beat_strips.py <改后目录> <输出目录> [--before <改前目录>] [--prefix hanba]
只给改后目录时只出一行。
"""
import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CW, CH = 384, 216
PAD, CAP, ROW_TITLE, TITLE = 6, 30, 30, 50
BG, FG, DIM = (18, 19, 24), (232, 232, 236), (150, 152, 160)
BEAT_COLORS = {
    "起手": (240, 200, 90), "预警": (240, 180, 60), "蓄力顶点": (245, 150, 50), "释放帧": (235, 70, 70), "持续段": (245, 120, 50),
    "复燃": (255, 230, 120), "收招": (140, 140, 150), "第一人称": (90, 160, 245),
}


def font(size, bold=False):
    win = os.environ.get("WINDIR", r"C:\Windows")
    for name in (["msyhbd.ttc"] if bold else []) + ["msyh.ttc", "simhei.ttf"]:
        p = Path(win) / "Fonts" / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def load(d: Path):
    m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    by = {}
    for s in m["shots"]:
        by.setdefault(s["move"], {"label": s["label"], "shots": {}})["shots"][s["order"]] = s
    return by


def row(draw, canvas, d: Path, shots: dict, orders: list, y: int, tag: str, f_cap, f_tag):
    draw.text((PAD, y + 6), tag, fill=FG, font=f_tag)
    y += ROW_TITLE
    for i, o in enumerate(orders):
        x = PAD + i * (CW + PAD)
        s = shots.get(o)
        if not s:
            draw.rectangle([x, y, x + CW, y + CH], outline=(60, 60, 70))
            draw.text((x + 10, y + CH // 2 - 10), "（没拍到）", fill=DIM, font=f_cap)
            continue
        img = Image.open(d / s["file"]).convert("RGB").resize((CW, CH), Image.LANCZOS)
        canvas.paste(img, (x, y))
        c = BEAT_COLORS.get(s["beat"], FG)
        draw.rectangle([x, y + CH, x + 6, y + CH + CAP - 6], fill=c)
        note = s.get("note") or ""
        draw.text((x + 12, y + CH + 4), s["beat"] + (f" · {note}" if note else ""), fill=c if not note else FG, font=f_cap)
    return y + CH + CAP


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("after", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--before", type=Path)
    ap.add_argument("--prefix", default="")
    a = ap.parse_args()
    after = load(a.after)
    before = load(a.before) if a.before else {}
    a.out.mkdir(parents=True, exist_ok=True)
    f_title, f_tag, f_cap = font(26, True), font(18, True), font(15)
    for move, info in after.items():
        orders = sorted(set(info["shots"]) | set(before.get(move, {}).get("shots", {})))
        rows = 2 if move in before else 1
        w = PAD + len(orders) * (CW + PAD)
        h = TITLE + rows * (ROW_TITLE + CH + CAP) + PAD
        canvas = Image.new("RGB", (w, h), BG)
        draw = ImageDraw.Draw(canvas)
        draw.text((PAD + 4, 10), f"{info['label']}  ·  节拍条（起手 → 释放帧 → 收招，最后一格第一人称）", fill=FG, font=f_title)
        y = TITLE
        if move in before:
            y = row(draw, canvas, a.before, before[move]["shots"], orders, y, "改前", f_cap, f_tag)
        row(draw, canvas, a.after, info["shots"], orders, y, "改后" if move in before else "现状", f_cap, f_tag)
        name = f"{a.prefix}-{move}.jpg" if a.prefix else f"{move}.jpg"
        canvas.save(a.out / name, quality=86, optimize=True)
        print(a.out / name)


if __name__ == "__main__":
    main()
