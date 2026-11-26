"""第一章重做版的游戏画面对照页：每张图一页，每个机位一行——构图概念图（views/）| 游戏画面 A | 游戏画面 B（如调光前 / 调光后）。
机位和白盒检视页、构图概念图一致（scripts/desert/redo-poses.mjs）；游戏画面由 scripts/desert/ch1-shots.mjs 拍（CH1_QUERY='&redo=1'）。
用法（仓库根目录）：
  python docs/art/concepts/ch1-routes/tools/make_game_sheets.py game/before game/after [输出目录=game]
输出 <输出目录>/<图>_game.jpg。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_whitebox_sheets import BG, DIM, GOLD, INK, fit, font  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
ORDER = ["concept", "spawn", "s1", "sB", "s2", "s3", "s4", "exit"]
NAMES = {"concept": "斜俯瞰", "spawn": "出生第一眼", "s1": "① 进场", "sB": "首领 · 进场处看泉心", "s2": "② 进场", "s3": "③ 进场", "s4": "④ 进场", "exit": "出口"}
TITLES = {"1-1": "古道穿越戈壁", "1-2": "雅丹迷城", "1-3": "沉沙古城", "1-4": "鸣沙山月牙泉 · 旱魃", "1-A": "千佛崖"}


def shot(folder: Path, m: str, v: str) -> Path | None:
    for p in sorted(folder.glob(f"{m}-*.jpg")):
        if p.stem.endswith("-gray") or p.stem.endswith("-foes") or p.stem.endswith("-nofog") or "sheet" in p.stem:
            continue
        key = re.match(rf"{re.escape(m)}-\d+-([A-Za-z0-9]+)", p.stem)
        if key and key.group(1) == v:
            return p
    return None


def concept(m: str, v: str) -> Path | None:
    if v == "concept":
        raw = {"1-1": "raw/1-1_v4.png", "1-2": "raw/1-2_v3.png", "1-3": "raw/1-3_v2.png", "1-4": "raw/1-4_v3.png", "1-A": "raw/1-A_v3.png"}[m]
        return HERE / raw
    p = HERE / "views" / f"{m}_{v}.jpg"
    return p if p.exists() else None


def sheet(m: str, a: Path, b: Path, la: str, lb: str) -> Image.Image | None:
    rows = [(v, concept(m, v), shot(a, m, v), shot(b, m, v)) for v in ORDER]
    rows = [r for r in rows if r[2] or r[3]]
    if not rows:
        return None
    W, pad = 1800, 14
    cw = (W - pad * 4) // 3
    ch = cw * 2 // 3
    f_t, f_s = font(30, True), font(16)
    H = 64 + len(rows) * (ch + 30 + pad) + pad
    out = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(out)
    d.text((pad, 14), f"{m} {TITLES[m]} · 游戏画面对照", font=f_t, fill=INK)
    d.text((W - 640, 26), f"左：构图概念图　中：{la}　右：{lb}", font=f_s, fill=DIM)
    y = 64
    for v, c, sa, sb in rows:
        for k, (p, label, col) in enumerate([(c, "构图概念图", DIM), (sa, la, DIM), (sb, lb, GOLD)]):
            x = pad + k * (cw + pad)
            if p and p.exists():
                out.paste(fit(p, cw, ch), (x, y))
            d.text((x, y + ch + 5), f"{NAMES.get(v, v)} · {label}", font=f_s, fill=col)
        y += ch + 30 + pad
    return out


def main() -> None:
    a = HERE / (sys.argv[1] if len(sys.argv) > 1 else "game/before")
    b = HERE / (sys.argv[2] if len(sys.argv) > 2 else "game/after")
    out = HERE / (sys.argv[3] if len(sys.argv) > 3 else "game")
    out.mkdir(parents=True, exist_ok=True)
    la, lb = a.name, b.name
    for m in TITLES:
        img = sheet(m, a, b, la, lb)
        if img is None:
            continue
        img.save(out / f"{m}_game.jpg", quality=86)
        print(f"{m}_game.jpg", img.size)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
