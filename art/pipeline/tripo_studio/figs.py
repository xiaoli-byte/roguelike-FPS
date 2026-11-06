"""Four keyed view figures (front, left, back, right) from a concept image.

layout "row": one horizontal row, figures found by column gaps (thin members bridged);
layout "grid": 2x2 grid (TL front, TR left, BL back, BR right), one figure per quadrant.
Background keying: flood fill from the border AND every enclosed background-coloured region bigger than
`min_hole` pixels (gaps between truss members, scaffold bays), so Tripo never sees grey panels inside the object."""
import numpy as np
from PIL import Image
from scipy import ndimage


def key(im: Image.Image, tol: float = 18.0, min_hole: int = 250) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.int32)
    h, w = a.shape[:2]
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    near = np.sqrt(((a - bg) ** 2).sum(-1)) < tol
    lab, n = ndimage.label(near)
    sizes = ndimage.sum(near, lab, range(1, n + 1))
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    keep_bg = np.zeros(n + 1, bool)
    for i in range(1, n + 1):
        if i in edge or sizes[i - 1] >= min_hole:
            keep_bg[i] = True
    bgmask = keep_bg[lab]
    # soften: erode the figure edge by nothing, just alpha
    rgba = np.dstack([a.astype(np.uint8), np.where(bgmask, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def _crop(fig: Image.Image) -> Image.Image:
    al = np.asarray(fig)[..., 3] > 127
    # drop specks: keep connected components bigger than 0.5% of the largest
    lab, n = ndimage.label(al)
    if n > 1:
        sizes = ndimage.sum(al, lab, range(1, n + 1))
        good = np.zeros(n + 1, bool)
        good[1:] = sizes >= sizes.max() * 0.005
        al = good[lab]
        arr = np.asarray(fig).copy()
        arr[..., 3] = np.where(al, arr[..., 3], 0)
        fig = Image.fromarray(arr, "RGBA")
    ys, xs = np.nonzero(al)
    return fig.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def figures(src: Image.Image, layout: str, tol: float = 18.0) -> list[Image.Image]:
    src = src.convert("RGB")
    W, H = src.size
    if layout == "grid":
        # two rows of two figures; the figures need not respect the exact quadrant lines
        out = []
        for y0, y1 in ((0, H // 2), (H // 2, H)):
            out += _row(src.crop((0, y0, W, y1)), 2, tol)
        return out
    return _row(src, 4, tol)


def _row(src: Image.Image, n: int, tol: float) -> list[Image.Image]:
    W, H = src.size
    k = key(src, tol)
    al = np.asarray(k)[..., 3] > 127
    segs = []
    for it in (12, 8, 5, 3, 1):
        cols = ndimage.binary_dilation(al.any(axis=0), iterations=it)
        lab, count = ndimage.label(cols)
        segs = [np.nonzero(lab == i)[0] for i in range(1, count + 1)]
        # fragments (a stray speck, a detached flag tip) are much smaller than a view
        big = max(al[:, s].sum() for s in segs)
        segs = [s for s in segs if al[:, s].sum() >= big * 0.05]
        if len(segs) >= n:
            break
    segs = sorted(segs, key=lambda s: al[:, s].sum(), reverse=True)[:n]
    segs.sort(key=lambda s: s[0])
    if len(segs) != n:
        raise SystemExit(f"found {len(segs)} figures")
    return [_crop(k.crop((int(s[0]), 0, int(s[-1]) + 1, H))) for s in segs]
