"""2D 图像工具（Pillow + numpy）：拼四视图、裁视图、准备 Hunyuan3D 输入、剪影比对。"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

VIEW_ORDER = ["front", "left", "back", "right"]


def compose_row(panels: list[Path], out: Path, bg: tuple[int, int, int, int] | None = None) -> tuple[int, int]:
    ims = [Image.open(p).convert("RGBA") for p in panels]
    w, h = ims[0].size
    sheet = Image.new("RGBA", (w * len(ims), h), bg or (0, 0, 0, 0))
    for i, im in enumerate(ims):
        sheet.alpha_composite(im, (i * w, 0))
    if bg is not None:
        sheet = sheet.convert("RGB")
    sheet.save(out)
    return sheet.size


def split_row(sheet: Path, n: int, size: tuple[int, int]) -> list[Image.Image]:
    """把一行 n 格的图切开，每格缩放到 size（概念图输出尺寸和白模格子尺寸一致时不缩放）。"""
    im = Image.open(sheet).convert("RGBA")
    w, h = im.size
    pw = w // n
    out = []
    for i in range(n):
        p = im.crop((i * pw, 0, (i + 1) * pw, h))
        if p.size != size:
            p = p.resize(size, Image.LANCZOS)
        out.append(p)
    return out


def alpha_mask(im: Image.Image, thr: int = 127) -> np.ndarray:
    return np.asarray(im.convert("RGBA"))[..., 3] > thr


def key_flat_background(im: Image.Image, tol: float = 28.0) -> Image.Image:
    """没有透明通道（或整张不透明）时，按四边的主色把和边缘连通的背景抠掉。"""
    from collections import deque

    a = np.asarray(im.convert("RGBA")).copy()
    if (a[..., 3] < 250).mean() > 0.05:
        return Image.fromarray(a, "RGBA")
    rgb = a[..., :3].astype(np.int32)
    h, w = rgb.shape[:2]
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    near = np.sqrt(((rgb - bg) ** 2).sum(-1)) < tol
    seen = np.zeros((h, w), bool)
    q = deque([(y, x) for x in range(w) for y in (0, h - 1)] + [(y, x) for y in range(h) for x in (0, w - 1)])
    while q:
        y, x = q.popleft()
        if y < 0 or y >= h or x < 0 or x >= w or seen[y, x] or not near[y, x]:
            continue
        seen[y, x] = True
        q.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    a[..., 3] = np.where(seen, 0, 255).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def hunyuan_input(panel: Image.Image, size: int, fill: float) -> tuple[Image.Image, dict]:
    """白底正方形、主体居中占 fill。返回图和变换参数（panel 像素 → 输入图像素）。"""
    m = alpha_mask(panel)
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        raise ValueError("视图里没有主体（alpha 全空）")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = panel.crop((x0, y0, x1, y1))
    s = size * fill / max(x1 - x0, y1 - y0)
    crop = crop.resize((max(1, round((x1 - x0) * s)), max(1, round((y1 - y0) * s))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    ox, oy = (size - crop.width) // 2, (size - crop.height) // 2
    canvas.alpha_composite(crop, (ox, oy))
    return canvas.convert("RGB"), {"crop": [int(x0), int(y0), int(x1), int(y1)], "scale": s, "offset": [ox, oy]}


def hunyuan_inputs_multiview(panels: list[Image.Image], size: int, fill: float) -> tuple[list[Image.Image], dict]:
    """多视图输入：四个视图用同一个裁剪框和缩放（配准后的概念视图共用白模相机，像素比例一致），
    模型才会把它们当成同一个物体的四个面。裁剪框水平以画面中线（模型竖轴）为中心，竖直覆盖四个视图的并集。"""
    masks = [alpha_mask(p) for p in panels]
    cx = panels[0].width / 2
    y0 = min(int(np.nonzero(m)[0].min()) for m in masks)
    y1 = max(int(np.nonzero(m)[0].max()) + 1 for m in masks)
    hw = max(float(np.abs(np.nonzero(m)[1] + 0.5 - cx).max()) for m in masks)
    side = max(y1 - y0, 2 * hw) / fill
    cy = (y0 + y1) / 2
    box = (round(cx - side / 2), round(cy - side / 2), round(cx + side / 2), round(cy + side / 2))
    out = []
    for p in panels:
        crop = p.convert("RGBA").crop(box).resize((size, size), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        canvas.alpha_composite(crop)
        out.append(canvas.convert("RGB"))
    return out, {"box": list(box), "scale": size / (box[2] - box[0])}


def segment_figures(sheet: Image.Image, n: int, min_gap: int = 6) -> list[Image.Image]:
    """按 alpha 的列投影找人物之间的空隙，切出 n 个人物（各自紧贴包围盒）。找不到 n 段时按等分切。"""
    a = np.asarray(sheet.convert("RGBA"))
    cols = (a[..., 3] > 127).sum(axis=0) > 2
    segs, start = [], None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            segs.append([start, x])
            start = None
    # 合并被细缝隔开的同一人物（飘带、手指之间的缝）
    merged: list[list[int]] = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < min_gap * 4 and len(segs) > n:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    merged = sorted(merged, key=lambda s: s[1] - s[0], reverse=True)[:n]
    merged.sort()
    if len(merged) != n:
        w = a.shape[1] // n
        merged = [[i * w, (i + 1) * w] for i in range(n)]
    out = []
    for x0, x1 in merged:
        crop = sheet.crop((x0, 0, x1, a.shape[0]))
        m = alpha_mask(crop)
        ys, xs = np.nonzero(m)
        out.append(crop.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)) if len(xs) else crop)
    return out


def register(figure: Image.Image, target_mask: np.ndarray, search: float = 0.06) -> tuple[Image.Image, dict]:
    """把一个人物（紧贴包围盒的 RGBA）缩放平移到白模格子里：先按高度和脚底对齐、水平居中，
    再在缩放 ±search、平移 ±search 范围内搜剪影 IoU 最高的一组。返回配准后的整格图和参数。"""
    H, W = target_mask.shape
    tx0, ty0, tx1, ty1 = bbox(target_mask)
    fm = alpha_mask(figure)
    fh, fw = fm.shape
    s0 = (ty1 - ty0) / fh

    def place(s: float, dx: float, dy: float) -> tuple[np.ndarray, tuple[int, int, int, int]]:
        w, h = max(1, round(fw * s)), max(1, round(fh * s))
        ox = round((tx0 + tx1) / 2 - w / 2 + dx)
        oy = round(ty1 - h + dy)
        m = np.asarray(Image.fromarray(fm).resize((w, h), Image.NEAREST))
        canvas = np.zeros((H, W), bool)
        x0, y0 = max(0, ox), max(0, oy)
        x1, y1 = min(W, ox + w), min(H, oy + h)
        if x1 > x0 and y1 > y0:
            canvas[y0:y1, x0:x1] = m[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
        return canvas, (ox, oy, w, h)

    best = (-1.0, s0, 0.0, 0.0)
    span = search * (ty1 - ty0)
    for s in s0 * np.linspace(1 - search, 1 + search, 9):
        for dx in np.linspace(-span, span, 9):
            for dy in np.linspace(-span / 2, span / 2, 5):
                m, _ = place(s, dx, dy)
                v = iou(m, target_mask)
                if v > best[0]:
                    best = (v, s, dx, dy)
    v, s, dx, dy = best
    _, (ox, oy, w, h) = place(s, dx, dy)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fig = figure.resize((w, h), Image.LANCZOS)
    out.paste(fig, (ox, oy), fig)
    return out, {"scale": round(float(s), 4), "offset": [ox, oy], "iou": round(float(v), 3),
                 "iou_unregistered_scale": round(float(s0), 4)}


def iou(a: np.ndarray, b: np.ndarray) -> float:
    return float((a & b).sum() / max(1, (a | b).sum()))


def bbox(m: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(m)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
