"""第一章玩家视角构图概念图的对照页：每张图一页，每个机位一行——左边白盒截图（不带标注），右边 ChatGPT 在同一机位上重绘的成品画面。
用法（仓库根目录，先跑 gen_view_concepts.py）：
  python docs/art/concepts/ch1-routes/tools/make_view_sheets.py [版本=v1]
输出 views/<图>_views.jpg；每个机位取 views/raw/ 里最新的版本（或 views/picks.json 里点名的版本）。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_whitebox_sheets import BG, DIM, GOLD, INK, fit, font  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
WB = HERE / "whitebox"
VIEWS = HERE / "views"
ORDER = ["spawn", "s1", "sB", "s2", "s3", "s4", "exit"]
NAMES = {"spawn": "出生第一眼", "s1": "① 进场", "sB": "首领 · 进场处看泉心", "s2": "② 进场", "s3": "③ 进场", "s4": "④ 进场", "exit": "出口"}
TITLES = {"1-1": "古道穿越戈壁", "1-2": "雅丹迷城", "1-3": "沉沙古城", "1-4": "鸣沙山月牙泉 · 旱魃", "1-A": "千佛崖"}


def latest(m: str, v: str, picks: dict) -> Path | None:
    key = f"{m}_{v}"
    if key in picks:
        p = VIEWS / "raw" / f"{m}_{v}_{picks[key]}.png"
        return p if p.exists() else None
    found = sorted(VIEWS.glob(f"raw/{m}_{v}_v*.png"), key=lambda p: int(re.search(r"_v(\d+)\.png$", p.name).group(1)))
    return found[-1] if found else None


def sheet(m: str, picks: dict) -> Image.Image | None:
    rows = [(v, WB / f"{m}_{v}_plain.jpg", latest(m, v, picks)) for v in ORDER]
    rows = [r for r in rows if r[2] is not None and r[1].exists()]
    if not rows:
        return None
    W, pad, cw = 1600, 16, 776
    ch = int(cw * 2 / 3)
    f_t, f_s = font(30, True), font(16)
    H = 64 + len(rows) * (ch + 30 + pad) + pad
    out = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(out)
    d.text((pad, 14), f"{m} {TITLES[m]} · 玩家视角构图概念图", font=f_t, fill=INK)
    d.text((W - 520, 26), "左：白盒同机位　右：ChatGPT 按白盒重绘", font=f_s, fill=DIM)
    y = 64
    for v, wb, art in rows:
        out.paste(fit(wb, cw, ch), (pad, y))
        out.paste(fit(art, cw, ch), (pad * 2 + cw, y))
        d.text((pad, y + ch + 5), f"{NAMES.get(v, v)}（白盒）", font=f_s, fill=DIM)
        d.text((pad * 2 + cw, y + ch + 5), f"{NAMES.get(v, v)}（{art.stem.rsplit('_', 1)[-1]}）", font=f_s, fill=GOLD)
        y += ch + 30 + pad
    return out


def main() -> None:
    picks_path = VIEWS / "picks.json"
    picks = json.loads(picks_path.read_text(encoding="utf-8")) if picks_path.exists() else {}
    for m in TITLES:
        img = sheet(m, picks)
        if img is None:
            continue
        img.save(VIEWS / f"{m}_views.jpg", quality=88)
        print(f"{m}_views.jpg", img.size)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
