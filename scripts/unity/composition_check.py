"""构图自检（docs/art/composition.md 第 4 节）：每张截图出一张六格自检图 + 一行 631 统计。

六格：原图 / 缩略（拇指大小，看大型和锚点）/ 灰度（看前中后三层、锚点）/ 眯眼（模糊，看疏密和留白成不成组）/
水平翻转（看构图平衡）/ 细节密度热图（安静 · 中等 · 密集三档，白框 = 最密一格，青框 = 最疏一格）。

统计（都是画面面积占比，目标按 631）：
    低饱和 / 固有色 / 高饱和    → 颜色三档，目标约 60 / 30 / 10；高饱和里再拆出暖（熔岩橙、血红）和冷（青金）
    暗 / 中暗 / 中间调 / 亮      → 明度分布；中间调（40–70%）占太多 = 前中后挤在一条明度带，空间出不来
    安静 / 中等 / 密集          → 细节密度三档，目标约 60 / 30 / 10；最密 / 最疏之比太小 = 没有疏密节奏

用法：
    python scripts/unity/composition_check.py docs/art/review/ch3-v2/3-2/after                 # 整个目录
    python scripts/unity/composition_check.py a.png b.jpg --out H:/tmp/check --md H:/tmp/check/summary.md
    python scripts/unity/composition_check.py <目录> --no-sheet                                 # 只打印统计

默认把自检图写到每张图旁边的 check/ 子目录（<名字>_check.jpg）；--out 指定别的目录。
阈值是经验值（见 composition.md 4.2），只做提示，最终还是看图判断。
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")
PANEL_W = 520
GAP = 8
BG = (18, 16, 22)
INK = (240, 232, 220)
SUB = (190, 182, 170)
WARN = (255, 150, 90)

# 颜色三档按色度（RGB 最大值 − 最小值）分，比 HSV 饱和度稳：暗褐在 HSV 里饱和度很高，看起来却是安静的。
# 阈值按用户给的 3-3 参考图（火神王座）校准，它正好是 60 / 31 / 9
CHROMA_LOW, CHROMA_HIGH, VAL_HIGH_MIN = 0.12, 0.40, 0.45
# 细节密度（亮度先按 2%–98% 拉满再求梯度，按格取均值；图先缩到 640 宽）。
# 阈值按用户给的 3-3 参考图（火神王座）校准：它的格中位数 0.011、九成格 < 0.035
DENSITY_QUIET, DENSITY_DENSE = 0.015, 0.05
GRID_COLS = 16


def font(size):
    for name in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf", "simsun.ttc"):
        p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def luma(rgb):
    """截图本身是 sRGB 编码的画面，直接按编码值算亮度，等于「看到的明暗」"""
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def color_tiers(img):
    rgb = np.asarray(img, dtype=np.float32) / 255.0
    mx, mn = rgb.max(-1), rgb.min(-1)
    chroma = mx - mn
    h = np.asarray(img.convert("HSV"), dtype=np.float32)[..., 0] / 255.0 * 360.0
    high = (chroma >= CHROMA_HIGH) & (mx >= VAL_HIGH_MIN)
    low = (chroma < CHROMA_LOW) & ~high
    mid = ~high & ~low
    warm = high & ((h < 50) | (h >= 340))
    cool = high & (h >= 150) & (h < 230)
    n = float(h.size)
    return {
        "low": low.sum() / n, "mid": mid.sum() / n, "high": high.sum() / n,
        "warm": warm.sum() / n, "cool": cool.sum() / n,
    }


def value_bands(y):
    n = float(y.size)
    return {
        "mean": float(y.mean()), "spread": float(np.percentile(y, 95) - np.percentile(y, 5)),
        "dark": (y < 0.2).sum() / n,
        "lowmid": ((y >= 0.2) & (y < 0.4)).sum() / n,
        "mid": ((y >= 0.4) & (y < 0.7)).sum() / n,
        "light": (y >= 0.7).sum() / n,
    }


def density_grid(img):
    """亮度梯度的格均值：图先缩到 640 宽（分辨率不同结果不变），亮度按 2%–98% 拉满（整体偏暗的图不会被当成「安静」）"""
    w, h = img.size
    small = img.resize((640, max(1, round(640 * h / w))), Image.BILINEAR)
    y = luma(np.asarray(small, dtype=np.float32) / 255.0)
    lo, hi = np.percentile(y, 2), np.percentile(y, 98)
    y = np.clip((y - lo) / max(hi - lo, 0.05), 0, 1)
    gx = np.zeros_like(y)
    gy = np.zeros_like(y)
    gx[:, 1:-1] = (y[:, 2:] - y[:, :-2]) * 0.5
    gy[1:-1, :] = (y[2:, :] - y[:-2, :]) * 0.5
    g = np.sqrt(gx * gx + gy * gy)
    rows = max(1, round(GRID_COLS * small.size[1] / small.size[0]))
    H, W = g.shape
    grid = np.zeros((rows, GRID_COLS), dtype=np.float32)
    for r in range(rows):
        for c in range(GRID_COLS):
            cell = g[r * H // rows:(r + 1) * H // rows, c * W // GRID_COLS:(c + 1) * W // GRID_COLS]
            grid[r, c] = cell.mean() if cell.size else 0
    return grid


def density_tiers(grid):
    n = float(grid.size)
    quiet = (grid < DENSITY_QUIET).sum() / n
    dense = (grid >= DENSITY_DENSE).sum() / n
    lo, hi = float(grid.min()), float(grid.max())
    return {"quiet": quiet, "medium": 1 - quiet - dense, "dense": dense,
            "ratio": hi / max(lo, 1e-4), "max_at": np.unravel_index(grid.argmax(), grid.shape),
            "min_at": np.unravel_index(grid.argmin(), grid.shape)}


def warnings(col, val, den):
    out = []
    if col["high"] > 0.15:
        out.append("高饱和超量（点缀 > 15%）")
    elif col["high"] < 0.03:
        out.append("没有点缀色")
    if col["low"] < 0.45:
        out.append("主色不够安静（低饱和 < 45%）")
    if val["mid"] > 0.55:
        out.append("明度挤在中间调")
    elif val["spread"] < 0.25:
        out.append(f"明度挤在一条带（5%–95% 跨度 {val['spread'] * 100:.0f}%）")
    if val["mean"] < 0.15:
        out.append(f"整体太暗（平均亮度 {val['mean'] * 100:.0f}%）")
    if den["quiet"] < 0.4:
        out.append("留白不足（安静 < 40%）")
    if den["dense"] > 0.25:
        out.append("细节太满（密集 > 25%）")
    if den["ratio"] < 3:
        out.append("疏密不分（最密 / 最疏 < 3）")
    return out


def analyse(path):
    img = Image.open(path).convert("RGB")
    rgb = np.asarray(img, dtype=np.float32) / 255.0
    col = color_tiers(img)
    val = value_bands(luma(rgb))
    grid = density_grid(img)
    den = density_tiers(grid)
    return img, grid, {"color": col, "value": val, "density": den, "warn": warnings(col, val, den)}


def pct(x):
    return f"{x * 100:.0f}"


def stat_line(s):
    c, v, d = s["color"], s["value"], s["density"]
    return (f"颜色 {pct(c['low'])}/{pct(c['mid'])}/{pct(c['high'])}（暖 {pct(c['warm'])} 冷 {pct(c['cool'])}）· "
            f"明度 暗 {pct(v['dark'])} 中暗 {pct(v['lowmid'])} 中间调 {pct(v['mid'])} 亮 {pct(v['light'])}（均 {pct(v['mean'])} 跨 {pct(v['spread'])}）· "
            f"密度 {pct(d['quiet'])}/{pct(d['medium'])}/{pct(d['dense'])}（疏密比 {d['ratio']:.1f}）")


def heat_panel(img, grid, size):
    base = ImageOps.grayscale(img).resize(size, Image.BILINEAR).convert("RGB")
    over = Image.new("RGB", size)
    draw = ImageDraw.Draw(over)
    rows, cols = grid.shape
    cw, ch = size[0] / cols, size[1] / rows
    for r in range(rows):
        for c in range(cols):
            v = grid[r, c]
            colr = (40, 70, 120) if v < DENSITY_QUIET else (255, 120, 40) if v >= DENSITY_DENSE else (130, 130, 130)
            draw.rectangle([c * cw, r * ch, (c + 1) * cw, (r + 1) * ch], fill=colr)
    out = Image.blend(base, over, 0.45)
    d = ImageDraw.Draw(out)
    for (r, c), colr in ((np.unravel_index(grid.argmax(), grid.shape), (255, 255, 255)),
                         (np.unravel_index(grid.argmin(), grid.shape), (90, 230, 230))):
        d.rectangle([c * cw + 1, r * ch + 1, (c + 1) * cw - 2, (r + 1) * ch - 2], outline=colr, width=3)
    return out


def sheet(img, grid, stats, title):
    w, h = img.size
    size = (PANEL_W, round(PANEL_W * h / w))
    full = img.resize(size, Image.LANCZOS)
    thumb_bg = Image.new("RGB", size, (60, 58, 64))
    tw = 96
    thumb = img.resize((tw, round(tw * h / w)), Image.LANCZOS)
    thumb_bg.paste(thumb, ((size[0] - thumb.size[0]) // 2, (size[1] - thumb.size[1]) // 2))
    panels = [
        ("原图", full),
        ("缩略（拇指大小）", thumb_bg),
        ("灰度", ImageOps.grayscale(full).convert("RGB")),
        ("眯眼（模糊）", full.filter(ImageFilter.GaussianBlur(PANEL_W / 70))),
        ("水平翻转", ImageOps.mirror(full)),
        ("细节密度：蓝 安静 / 灰 中等 / 橙 密集", heat_panel(img, grid, size)),
    ]
    f_title, f_lab, f_stat = font(22), font(16), font(17)
    label_h, head_h = 26, 40
    foot_h = 34 + (26 if stats["warn"] else 0)
    W = PANEL_W * 3 + GAP * 4
    H = head_h + (size[1] + label_h) * 2 + GAP * 3 + foot_h
    out = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(out)
    d.text((GAP, 8), title, font=f_title, fill=INK)
    for i, (lab, p) in enumerate(panels):
        x = GAP + (i % 3) * (PANEL_W + GAP)
        y = head_h + (i // 3) * (size[1] + label_h + GAP)
        d.text((x, y + 2), lab, font=f_lab, fill=SUB)
        out.paste(p, (x, y + label_h))
    y = H - foot_h + 6
    d.text((GAP, y), stat_line(stats), font=f_stat, fill=INK)
    if stats["warn"]:
        d.text((GAP, y + 26), "提示：" + "；".join(stats["warn"]), font=f_stat, fill=WARN)
    return out


def collect(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            for f in sorted(os.listdir(p)):
                if os.path.splitext(f)[1].lower() in IMG_EXT and not f.endswith("_check.jpg"):
                    out.append(os.path.join(p, f))
        elif os.path.isfile(p):
            out.append(p)
        else:
            print(f"跳过：找不到 {p}", file=sys.stderr)
    return out


def main():
    ap = argparse.ArgumentParser(description="构图自检：缩略 / 灰度 / 眯眼 / 翻转 / 密度热图 + 631 统计")
    ap.add_argument("paths", nargs="+", help="截图文件或目录")
    ap.add_argument("--out", help="自检图输出目录（默认每张图旁边的 check/）")
    ap.add_argument("--md", help="把统计表另存成 Markdown")
    ap.add_argument("--no-sheet", action="store_true", help="只打印统计，不出自检图")
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    files = collect(args.paths)
    if not files:
        print("没有图", file=sys.stderr)
        return 1
    rows = ["| 图 | 颜色 低/固有/高（暖·冷） | 明度 暗/中暗/中间调/亮（均·跨） | 密度 安静/中等/密集（疏密比） | 提示 |",
            "|---|---|---|---|---|"]
    used = set()
    for f in files:
        img, grid, s = analyse(f)
        name = os.path.splitext(os.path.basename(f))[0]
        if name in used:  # 改前 / 改后同名：带上目录名，免得自检图互相覆盖
            name = f"{os.path.basename(os.path.dirname(os.path.abspath(f)))}_{name}"
        used.add(name)
        c, v, d = s["color"], s["value"], s["density"]
        rows.append(f"| {name} | {pct(c['low'])}/{pct(c['mid'])}/{pct(c['high'])}（{pct(c['warm'])}·{pct(c['cool'])}）"
                    f" | {pct(v['dark'])}/{pct(v['lowmid'])}/{pct(v['mid'])}/{pct(v['light'])}（{pct(v['mean'])}·{pct(v['spread'])}）"
                    f" | {pct(d['quiet'])}/{pct(d['medium'])}/{pct(d['dense'])}（{d['ratio']:.1f}）"
                    f" | {'；'.join(s['warn']) or '—'} |")
        if not args.no_sheet:
            folder = args.out or os.path.join(os.path.dirname(os.path.abspath(f)), "check")
            os.makedirs(folder, exist_ok=True)
            sheet(img, grid, s, name).save(os.path.join(folder, f"{name}_check.jpg"), quality=88)
    text = "\n".join(rows)
    print(text)
    if args.md:
        os.makedirs(os.path.dirname(os.path.abspath(args.md)), exist_ok=True)
        with open(args.md, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
