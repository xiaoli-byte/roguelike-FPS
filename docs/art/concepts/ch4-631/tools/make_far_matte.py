"""4-4 神山海子的远山绘景：从概念图裁出远山那一块（带画好的天），两侧冰斗壁和谷底抠成透明，上沿渐隐。
    python docs/art/concepts/ch4-631/tools/make_far_matte.py
输出 public/assets/environment/haizi/far_mountains_matte.webp（带透明通道）和投影绘景用的 scene_projection.webp（整张图抹掉道具、天和神山透明）。
抠掉的冰斗壁和左右各加宽的 PAD 补画成天（按行取画里的天色）和接着往两边走的淡远山（照画里两侧远峰的样子程序画）：玩家在湖岸上换位置时近处的 3D 冰斗壁和远处背景板错开，边和抠掉的地方也不会露缝。
裁剪框（概念图像素）和出生点相机一起决定背景板在世界里的位置：src/world/haizi/farMatte.ts 的 MATTE 常量要和这里的 BOX 一致。
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[5]
SRC = ROOT / "docs/art/concepts/ch4-631/4-4_haizi_scene_v5.jpg"
OUT = ROOT / "public/assets/environment/haizi/far_mountains_matte.webp"
BOX = (256, 0, 1792, 576)            # 概念图 2048×1152 里的像素
# 保留区（裁剪区像素）：两侧冰斗壁山脊线以上、山脚雾带以上。描线往天空那侧收了几个像素，画里的深色山脊不会在 3D 冰斗壁上方露一条边
KEEP = [(0, 0), (0, 74), (86, 204), (152, 302), (220, 376), (306, 420), (424, 436), (768, 446), (1100, 438), (1246, 392),
        (1324, 326), (1392, 260), (1458, 166), (1536, 58), (1536, 0)]


PAD = 384                            # 左右各加宽这么多像素（概念图像素）：换个位置看，背景板的边也藏在冰斗壁后面
HORIZON = 446                        # 远山山脚（雾带）在裁剪区里的行


def fill_sky(rgb: np.ndarray, keep: np.ndarray) -> np.ndarray:
    """抠掉和加宽的地方补天：保留区的颜色做归一化卷积往外延（横向拉得远、竖向只拉几个像素——天和云都是横着走的），
    由细到粗叠：贴着保留区的地方接上画里那一片的颜色，离得远的地方是整行的平均天色。"""
    h, W, _ = rgb.shape
    est = None
    for sx, sy in ((1200, 12), (420, 9), (160, 6), (60, 4), (20, 3)):
        den = gaussian_filter(keep, (sy, sx), mode="nearest")
        num = np.stack([gaussian_filter(rgb[..., c] * keep, (sy, sx), mode="nearest") for c in range(3)], -1)
        cur = num / np.maximum(den, 1e-6)[..., None]
        if est is None:
            est = np.where((den > 1e-4)[..., None], cur, np.nan)
            continue
        wgt = np.clip(den / 0.3, 0, 1)[..., None]
        est = est * (1 - wgt) + cur * wgt
    # 山脚往下没有保留区的行：用上面最后一行
    for y in range(1, h):
        bad = np.isnan(est[y, :, 0])
        est[y, bad] = est[y - 1, bad]
    return np.nan_to_num(est, nan=200.0)


def value_noise(shape: tuple[int, int], cell: int, seed: int) -> np.ndarray:
    """0..1 的平滑噪声（随机格子双三次放大）"""
    rng = np.random.default_rng(seed)
    h, w = shape
    g = rng.random((h // cell + 3, w // cell + 3)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize(((w // cell + 3) * cell, (h // cell + 3) * cell), Image.BICUBIC)
    return np.asarray(im).astype(np.float32)[:h, :w] / 255


def ranges(sky: np.ndarray) -> np.ndarray:
    """冰斗壁后面接着往两边走的远山：照画里两侧远峰的样子——尖顶、宽缓的山肩、淡紫白、右坡受光偏暖、左坡背光偏冷、
    山脚没进雾里、雾很重（反差比主峰低得多）。两层：远的一层矮、雾重；近的一层高一点。只用在抠掉和加宽的地方（保留区里是原画）。"""
    h, W, _ = sky.shape
    X = np.arange(W, dtype=np.float32) - PAD              # 裁剪区坐标
    Y = np.arange(h, dtype=np.float32)[:, None]
    out = sky.copy()
    rng = np.random.default_rng(44)
    lit, shade = np.array([236, 229, 232], np.float32), np.array([182, 189, 212], np.float32)
    mist = np.array([212, 217, 231], np.float32)
    streak = value_noise((h, W), 14, 8)                       # 大块的雪坡 / 岩脊明暗
    # 一座座山单独画、由远到近叠（前面的挡后面的），山脊线从峰尖斜着往下走（受光坡 / 背光坡的分界），不是一条竖线
    peaks = []
    for layer, (n, tops, haze) in enumerate([(8, (338, 404), 0.6), (6, (268, 350), 0.4)]):
        for side in (0, 1):
            lo, hi = ((-PAD - 80, 240) if side == 0 else (1260, 1536 + PAD + 80))
            for px in rng.uniform(lo, hi, n // 2):
                peaks.append((layer, px, rng.uniform(*tops), rng.uniform(0.85, 1.25, 2), rng.uniform(0.3, 0.5, 2),
                              rng.uniform(30, 60), haze + rng.uniform(-0.05, 0.05), rng.uniform(-0.45, 0.45), rng.integers(1 << 30)))
    for layer, px, top, s1, s2, knee, haze, rd, seed in peaks:
        d = np.abs(X - px)
        sl = np.where(X < px, s1[0], s1[1]); sh = np.where(X < px, s2[0], s2[1])
        yl = top + np.where(d < knee, d * sl, knee * sl + (d - knee) * sh)     # 尖顶一段陡，往下是缓的山肩
        yl = yl + (value_noise((1, W), 18, int(seed % 997))[0] - 0.5) * 10 * np.clip(d / 25, 0, 1)   # 山脊线上的小峰，峰尖不动
        below = (Y >= yl[None, :]) & (Y < HORIZON + 40)
        if not below.any():
            continue
        xb = px + (Y - top) * rd + (value_noise((h, 1), 20, int(seed % 991))[:, :1] - 0.5) * 14   # 主山脊往下的走向
        t = np.clip((X[None, :] - xb) / 5 + 0.5, 0, 1)[..., None]                               # 右坡受光
        face = (shade * (1 - t) + lit * t) * (0.96 + 0.07 * streak[..., None])
        foot = np.clip((Y - (HORIZON - 80)) / 80, 0, 1)[..., None]     # 山脚没进雾
        body = face * (1 - foot) + mist * foot
        body = body * (1 - haze) + sky * haze
        out = np.where(below[..., None], body, out)
    return np.asarray(Image.fromarray(out.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(np.float32)


def main() -> None:
    im = Image.open(SRC).convert("RGB").crop(BOX)
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    # 背景板的保留区比 KEEP 往下多留一段（山脚雾带下面那道深色 U 形谷）：3D 缺口地形的天际线上方露出来的是画，不是一条亮白的雾
    ImageDraw.Draw(mask).polygon([(x, y + 62 if 300 <= x <= 1250 else y) for x, y in KEEP], fill=255)
    rgb = np.asarray(im).astype(np.float32)
    # 保留区往里收 14 px 再羽化：画里冰斗壁那道深色山脊线不渗进来；取色只用往里收 16 px 的像素
    soft = mask.filter(ImageFilter.MinFilter(29)).filter(ImageFilter.GaussianBlur(6))
    inner = mask.filter(ImageFilter.MinFilter(33))
    W = w + 2 * PAD
    src = np.zeros((h, W, 3), np.float32); src[:, PAD:PAD + w] = rgb
    kin = np.zeros((h, W), np.float32); kin[:, PAD:PAD + w] = np.asarray(inner).astype(np.float32) / 255
    wide = ranges(fill_sky(src, kin))
    k = np.zeros((h, W), np.float32)
    k[:, PAD:PAD + w] = np.asarray(soft).astype(np.float32) / 255
    wide = src * k[..., None] + wide * (1 - k[..., None])
    # 透明：上沿 0–12% 渐隐进程序天空；深色谷底（470–510 px）往下透明（冰碛垄和远谷交给场景里的 3D）；最外侧 280 px 渐隐
    y = np.linspace(0, 1, h)[:, None]
    x = np.arange(W)[None, :]
    a = np.clip(y / 0.12, 0, 1) * (1 - np.clip((y * h - 470) / 40, 0, 1))
    a = a * np.clip(x / 280, 0, 1) * np.clip((W - 1 - x) / 280, 0, 1)
    rgba = np.dstack([wide.clip(0, 255).astype(np.uint8), (a * 255).astype(np.uint8)])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(OUT, "WEBP", quality=92, alpha_quality=90, method=6)
    print(OUT.relative_to(ROOT), f"{OUT.stat().st_size // 1024} KB", (W, h))



# ───── 投影绘景（src/world/haizi/paintProject.ts）：整张概念图从出生点相机投到冰斗壁、冰舌、缺口和远岸的 3D 地形上
PROJ_OUT = ROOT / "public/assets/environment/haizi/scene_projection.webp"
# 画里的道具（柱子、经幡、玛尼堆、湖心岛和祭坛）：抹掉，不然会印到后面的山坡上（概念图 2048×1152 像素）
PROPS = [(336, 576, 504, 658), (812, 532, 1034, 652), (1018, 586, 1232, 642), (1192, 582, 1258, 654), (1406, 582, 1494, 654),
         (1822, 526, 1914, 664), (826, 552, 1180, 700)]


def mirror_fill(img: np.ndarray, rect: tuple[int, int, int, int]) -> None:
    """道具框里换成紧挨着它左边（左边不够就右边）那一块的镜像：岩板、积雪、雾的纹理是真的，不是抹出来的一团灰；框边 8 px 渐变"""
    x0, y0, x1, y1 = rect
    w = x1 - x0
    W = img.shape[1]
    src = img[y0:y1, x0 - w:x0][:, ::-1] if x0 - w >= 0 else img[y0:y1, x1:x1 + w][:, ::-1]
    h = y1 - y0
    yy = np.minimum(np.arange(h), np.arange(h)[::-1])[:, None]
    xx = np.minimum(np.arange(w), np.arange(w)[::-1])[None, :]
    k = (np.clip(np.minimum(yy, xx) / 8.0, 0, 1))[..., None]
    img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - k) + src * k


def make_projection() -> None:
    img = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
    H, W, _ = img.shape
    for r in PROPS:
        mirror_fill(img, r)
    out = img.clip(0, 255).astype(np.uint8)
    # 透明：天和神山（保留区，左右两条山脊线延到画框上沿）不投
    ox = BOX[0]
    keep = [(207, 0)] + [(x + ox, y) for x, y in KEEP[2:-2]] + [(1834, 0)]
    mask = Image.new("L", (W, H), 255)
    ImageDraw.Draw(mask).polygon(keep, fill=0)
    a = np.asarray(mask.filter(ImageFilter.GaussianBlur(4)))
    rgba = np.dstack([out, a]).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(PROJ_OUT, "WEBP", quality=90, alpha_quality=80, method=6)
    print(PROJ_OUT.relative_to(ROOT), f"{PROJ_OUT.stat().st_size // 1024} KB", (W, H))


if __name__ == "__main__":
    main()
    make_projection()
