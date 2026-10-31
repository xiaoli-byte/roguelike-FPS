"""化蛇手 K 审核联系表的拼图（系统 Python + PIL；huashe_anims.py --review 渲完单张后自动调用）。

    python huashe_review_sheet.py <tiles.json> <输出.jpg> [--tile 200] [--per-row 4]

一个关键帧占一格（侧视 / 3/4 视 / 俯视三张并排），每个状态从新的一行起，标签写状态名、帧号、事件和身体链最大折角。宽 ≤ 2400 px。
"""
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
tiles = json.loads(Path(args[0]).read_text(encoding="utf-8"))
out = Path(args[1])
TILE = int(args[args.index("--tile") + 1]) if "--tile" in args else 200
PER_ROW = int(args[args.index("--per-row") + 1]) if "--per-row" in args else 4
LABEL = 22
HEAD = 30
GAP = 6

fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
try:
    font = ImageFont.truetype(str(fonts / "msyh.ttc"), 15)
    big = ImageFont.truetype(str(fonts / "msyhbd.ttc"), 19)
except OSError:
    font = big = ImageFont.load_default()

# 按 (状态, 帧) 归组，保持渲染顺序
groups, order = {}, []
for t in tiles:
    key = (t["clip"], t["frame"])
    if key not in groups:
        groups[key] = []
        order.append(key)
    groups[key].append(t)
clips = []
for c, f in order:
    if not clips or clips[-1][0] != c:
        clips.append((c, []))
    clips[-1][1].append(f)

cell_w = TILE * 3 + GAP
width = min(2400, PER_ROW * cell_w)
rows = []
for c, frames in clips:
    for i in range(0, len(frames), PER_ROW):
        rows.append((c, frames[i:i + PER_ROW], i == 0))
height = sum((HEAD if first else 0) + LABEL + TILE + GAP for _, _, first in rows) + GAP
sheet = Image.new("RGB", (width, height), (26, 27, 32))
draw = ImageDraw.Draw(sheet)
y = GAP
for c, frames, first in rows:
    if first:
        draw.text((8, y + 3), c, fill=(255, 210, 120), font=big)
        y += HEAD
    for j, f in enumerate(frames):
        x = j * cell_w
        g = groups[(c, f)]
        ev = " ".join(g[0]["events"])
        label = f"f{f}" + (f"  [{ev}]" if ev else "") + f"   折角 {g[0]['bend']:.0f}°"
        draw.text((x + 6, y + 2), label, fill=(235, 235, 240) if not ev else (130, 230, 255), font=font)
        for k, t in enumerate(sorted((t for t in g if t["view"] in ("side", "q", "top")), key=lambda t: ("side", "q", "top").index(t["view"]))):
            im = Image.open(t["file"]).convert("RGB").resize((TILE, TILE), Image.LANCZOS)
            sheet.paste(im, (x + k * TILE, y + LABEL))
    y += LABEL + TILE + GAP
out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out, quality=88)
print(f"SHEET {out} {sheet.size[0]}x{sheet.size[1]}")
