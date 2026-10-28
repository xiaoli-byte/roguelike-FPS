"""卡通爆炸 / 火舌序列帧图集 T_Fx_Blast.png（特效打磨 B 路）。

    python scripts/unity/fx_blast_atlas.py            # 写 unity/Assets/Art/Fx/T_Fx_Blast.png
    python scripts/unity/fx_blast_atlas.py --preview  # 另存一张上色预览到 --out 目录（默认当前目录）

2048 × 2048，8 × 8 格、每格 256 px；格序 = Shuriken 帧序（第 0 帧在左上角，按行往右数）。
四个通道是数据不是颜色（按线性导入），由 SF_FxToon 着色器解释：
    R = 形状场（0..1，越往团块中心越大；着色器按粒子年龄抬高阈值 → 硬边「啃掉」，卡通爆炸的消散方式）
    G = 热度（白热芯 → 黄 → 主色 → 暗红，着色器分几段硬色阶）
    B = 受光（左上来光的球面明暗；着色器取两段：亮面 / 暗面，团块之间的折缝压暗当描边）
    A = 覆盖（R > 0 的地方，给不认识这张图的兜底材质用）
帧：
     0–15  火团（一簇翻滚的圆团：中间大团 + 一圈小团向外滚、慢慢长大）
    16–31  烟团（同样的团簇，更圆、往上翻，没有热度）
    32     冲击环（带噪声内缘的粗环，外缘更热）
    33     爆闪星（漫画式的尖刺闪光）
    34     尘圈（贴地的一圈尘团，俯视）
    35     封脉印（环 + 八道方折刻符，青色反应用）
    36     焚雷裂（中心向外的七道折线裂光）
    37     熔溅冠（侧面看的一圈往上溅起的熔滴）
    38–47  留空
    48–63  火舌（一条火苗窜起、尖端断开成一团往上飘、缩回；状态灼烧 / 余火用）
全部确定性（固定种子），重跑逐字节相同。
"""
import argparse
import os

import numpy as np
from PIL import Image

N = 256
COLS = ROWS = 8
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "unity", "Assets", "Art", "Fx", "T_Fx_Blast.png")

# 格内坐标：x 向右、y 向上，[-1, 1]
_c = (np.arange(N) + 0.5) / N * 2 - 1
X, Y = np.meshgrid(_c, -_c)


# ───────────── 噪声 ─────────────

def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + iz.astype(np.int64) * 1442695041 + seed * 2654435761) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFF) / float(0xFFFFFF)


def vnoise(x, y, z=0.0, seed=0):
    z = np.broadcast_to(np.asarray(z, dtype=np.float64), x.shape)
    xi, yi, zi = np.floor(x), np.floor(y), np.floor(z)
    fx, fy, fz = x - xi, y - yi, z - zi
    ux, uy, uz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    xi, yi, zi = xi.astype(np.int64), yi.astype(np.int64), zi.astype(np.int64)
    out = 0
    for dz in (0, 1):
        layer = 0
        for dy in (0, 1):
            a = _hash(xi, yi + dy, zi + dz, seed)
            b = _hash(xi + 1, yi + dy, zi + dz, seed)
            row = a + (b - a) * ux
            layer = row if dy == 0 else layer + (row - layer) * uy
        out = layer if dz == 0 else out + (layer - out) * uz
    return out


def fbm(x, y, z=0.0, seed=0, octaves=3):
    s, a, norm = 0.0, 0.5, 0.0
    for o in range(octaves):
        s = s + a * vnoise(x * (2 ** o), y * (2 ** o), z * (1.5 ** o), seed + o * 17)
        norm += a
        a *= 0.5
    return s / norm


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


LIGHT = np.array([-0.55, 0.62, 0.56])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


# ───────────── 团簇（火团 / 烟团） ─────────────

def make_puffs(seed, ring, center_r, ring_d, ring_r, extra_top, jitter=0.25, angles=None):
    """angles：给定每个外圈团的方向（弧度），不给就均匀一圈加 ±jitter 的抖动"""
    rng = np.random.default_rng(seed)
    puffs = [dict(p=np.array([0.0, -0.06]), r=center_r, w=rng.uniform(1.4, 2.2) * rng.choice([-1, 1]), o=rng.uniform(0, 50), h=1.0)]
    for i in range(ring):
        a = (angles[i] if angles is not None else 2 * np.pi * i / ring) + rng.uniform(-jitter, jitter)
        d = rng.uniform(*ring_d)
        dirv = np.array([np.cos(a), np.sin(a) * 0.9])
        # 往外滚：右边的团顺时针、左边的逆时针（顶面朝外翻）
        w = -np.sign(dirv[0] + 1e-3) * rng.uniform(2.0, 3.4)
        puffs.append(dict(p=dirv * d, r=rng.uniform(*ring_r), w=w, o=rng.uniform(0, 50), h=rng.uniform(0.62, 0.9) - 0.12 * max(0, dirv[1])))
    for i in range(extra_top):
        x = rng.uniform(-0.22, 0.22)
        puffs.append(dict(p=np.array([x, rng.uniform(0.28, 0.4)]), r=rng.uniform(0.2, 0.27), w=-np.sign(x + 1e-3) * rng.uniform(1.5, 2.5), o=rng.uniform(0, 50), h=0.5))
    return puffs


def cluster(puffs, t, expand, grow, rise, roll, noise_amp, seed):
    """一帧团簇：返回 形状场 D、受光 B、折缝 crease、热度 H（一半按每团的团心、一半按整簇：中间最热，一簇只有一个白热芯）"""
    s_all, light_all, heat_all = [], [], []
    centre = puffs[0]["p"] * expand(t) + np.array([0.0, rise * t])
    span = max(np.linalg.norm(pf["p"] * expand(t)) + pf["r"] * grow(t) for pf in puffs)
    for k, pf in enumerate(puffs):
        p = pf["p"] * expand(t) + np.array([0.0, rise * t])
        r = pf["r"] * grow(t)
        vx, vy = (X - p[0]) / r, (Y - p[1]) / r
        th = pf["w"] * roll * t
        c, s = np.cos(th), np.sin(th)
        lx, ly = c * vx - s * vy, s * vx + c * vy
        n = fbm(lx * 1.6 + pf["o"], ly * 1.6 + pf["o"] * 0.37, t * 0.6, seed + k, 3)
        dist = np.sqrt(vx * vx + vy * vy)
        sv = 1 - dist + noise_amp * (n - 0.5)
        z = np.sqrt(np.clip(1 - dist * dist, 0, 1))
        # 法线只带一点点噪声：每团是干净的球面两段明暗（风格审查：原来 0.22 的噪声把亮暗交界啃成一片碎斑）
        nx, ny = vx + 0.06 * (n - 0.5), vy + 0.06 * (n - 0.5)
        ln = np.sqrt(nx * nx + ny * ny + z * z) + 1e-6
        lit = np.clip((nx * LIGHT[0] + ny * LIGHT[1] + z * LIGHT[2]) / ln, 0, 1)
        # 团心热、边缘凉；离簇中心越远的团越凉
        hot = pf.get("h", 1.0)
        # 每团自己的热芯只占一半，另一半按整簇算（离簇中心越远越凉）：一簇只有一个白热芯，不是每个小团都发白（风格审查：不读成一片泡泡）
        lobe = np.clip((1 - dist * 1.05 + 0.2 * (n - 0.5)) * 1.35, 0, 1) ** 0.8 * hot
        cx, cy = X - centre[0], Y - centre[1]
        whole = np.clip(1.15 - np.sqrt(cx * cx + cy * cy) / max(1e-3, span), 0, 1)
        heat = lobe * 0.5 + whole * lobe ** 0.35 * 0.5
        s_all.append(sv)
        light_all.append(lit)
        heat_all.append(heat)
    S = np.stack(s_all)
    L = np.stack(light_all)
    k = 14.0
    m = S.max(axis=0)
    D = m + np.log(np.exp(k * (S - m)).sum(axis=0)) / k - np.log(len(puffs)) / k * 0.35
    idx = S.argmax(axis=0)
    B = np.take_along_axis(L, idx[None], 0)[0]
    H = np.take_along_axis(np.stack(heat_all), idx[None], 0)[0]
    srt = np.sort(S, axis=0)
    gap = srt[-1] - srt[-2]
    crease = 1 - smooth(0.0, 0.09, gap)
    # 只在两团都有覆盖的地方算折缝
    crease *= (srt[-2] > 0.02)
    D = np.clip(D, 0, 1)
    edge = np.maximum(np.abs(X), np.abs(Y))
    D *= 1 - smooth(0.86, 0.97, edge)
    return D, B, crease, H


def fireball(t):
    puffs = FIRE_PUFFS
    ease = lambda t: 1 - (1 - t) ** 2
    D, B, crease, H = cluster(puffs, t, lambda t: 0.66 + 0.5 * ease(t), lambda t: 0.8 + 0.4 * ease(t), 0.06, 1.0, 0.18, 101)
    H = np.clip(H * (1 - 0.2 * t), 0, 1) * (D > 0)
    B = B * (1 - 0.45 * crease)
    return D, H, B


def smoke(t):
    puffs = SMOKE_PUFFS
    ease = lambda t: 1 - (1 - t) ** 1.6
    D, B, crease, _ = cluster(puffs, t, lambda t: 0.66 + 0.4 * ease(t), lambda t: 0.8 + 0.35 * ease(t), 0.1, 0.6, 0.14, 707)
    B = B * (1 - 0.3 * crease)
    return D, np.zeros_like(D), B


# ───────────── 单帧图形 ─────────────

def ring():
    r = np.sqrt(X * X + Y * Y)
    a = np.arctan2(Y, X)
    n = fbm(np.cos(a) * 2.5 + 5, np.sin(a) * 2.5 + 5, 0.0, 11, 3)
    inner = 0.74 - 0.17 - 0.12 * (n - 0.5)
    P = np.where(r < 0.74, (r - inner) / (0.74 - inner), 1 - (r - 0.74) / 0.12)
    P = np.clip(P, 0, 1)
    H = 0.45 + 0.55 * smooth(0.6, 0.86, r)
    return P, H * (P > 0), np.ones_like(P)


def burst_star():
    rng = np.random.default_rng(33)
    r = np.sqrt(X * X + Y * Y)
    a = np.arctan2(Y, X)
    n_sp = 12
    L = np.full_like(r, 0.3)
    for k in range(n_sp):
        ak = 2 * np.pi * k / n_sp + rng.uniform(-0.12, 0.12)
        ln = (0.93 if k % 2 == 0 else 0.62) * rng.uniform(0.85, 1.0)
        w = rng.uniform(0.16, 0.24)
        da = np.abs((a - ak + np.pi) % (2 * np.pi) - np.pi)
        L = np.maximum(L, 0.3 + (ln - 0.3) * np.clip(1 - da / w, 0, 1) ** 1.6)
    S = np.clip(1 - r / L, 0, 1)
    P = np.clip(S * 1.5, 0, 1)
    H = np.clip(1 - r / L, 0, 1) ** 0.7
    return P, H, np.ones_like(P)


def dust_ring():
    rng = np.random.default_rng(34)
    S = np.full_like(X, -1.0)
    Bm = np.zeros_like(X)
    for k in range(14):
        a = 2 * np.pi * k / 14 + rng.uniform(-0.15, 0.15)
        d = rng.uniform(0.56, 0.66)
        rr = rng.uniform(0.15, 0.23)
        vx, vy = (X - np.cos(a) * d) / rr, (Y - np.sin(a) * d) / rr
        dist = np.sqrt(vx * vx + vy * vy)
        n = fbm(vx * 1.5 + k * 3, vy * 1.5, 0.0, 340 + k, 3)
        s = 1 - dist + 0.25 * (n - 0.5)
        z = np.sqrt(np.clip(1 - dist * dist, 0, 1))
        better = s > S
        S = np.where(better, s, S)
        Bm = np.where(better, 0.35 + 0.65 * z * (0.8 + 0.4 * n), Bm)
    P = np.clip(S, 0, 1)
    return P, np.zeros_like(P), np.clip(Bm, 0, 1)


def seal():
    r = np.sqrt(X * X + Y * Y)
    a = np.arctan2(Y, X)
    band = np.clip(1 - np.abs(r - 0.78) / 0.07, 0, 1)
    inner = np.clip(1 - np.abs(r - 0.55) / 0.035, 0, 1)
    # 八道方折刻符：每 45° 一块，块内一个方折（两段直角线）
    seg = (a + np.pi) / (2 * np.pi) * 8
    f = seg - np.floor(seg)
    radial = (r > 0.58) & (r < 0.74)
    stroke1 = (np.abs(f - 0.35) < 0.05) & radial & (r < 0.7)
    stroke2 = (np.abs(r - 0.66) < 0.025) & (f > 0.35) & (f < 0.72)
    stroke3 = (np.abs(f - 0.72) < 0.05) & (r > 0.62) & (r < 0.72)
    glyph = (stroke1 | stroke2 | stroke3).astype(np.float64)
    P = np.clip(np.maximum(np.maximum(band, inner), glyph * 0.9), 0, 1)
    # 刻符白热、环身主色（着色器 0.9 以上才白热）
    H = np.where(glyph > 0, 0.97, 0.5 + 0.32 * np.maximum(band, inner))
    edge = np.maximum(np.abs(X), np.abs(Y))
    P *= 1 - smooth(0.9, 0.98, edge)
    return P, H * (P > 0), np.ones_like(P)


def cracks():
    rng = np.random.default_rng(36)
    P = np.zeros_like(X)
    for k in range(7):
        a = 2 * np.pi * k / 7 + rng.uniform(-0.3, 0.3)
        pts = [np.array([0.0, 0.0])]
        d = np.array([np.cos(a), np.sin(a)])
        length = rng.uniform(0.7, 0.9)
        n_seg = 5
        for i in range(n_seg):
            ang = a + rng.uniform(-0.55, 0.55)
            pts.append(pts[-1] + np.array([np.cos(ang), np.sin(ang)]) * length / n_seg)
        for i in range(n_seg):
            p0, p1 = pts[i], pts[i + 1]
            seg = p1 - p0
            tt = np.clip(((X - p0[0]) * seg[0] + (Y - p0[1]) * seg[1]) / (seg @ seg), 0, 1)
            dx, dy = X - (p0[0] + seg[0] * tt), Y - (p0[1] + seg[1] * tt)
            dist = np.sqrt(dx * dx + dy * dy)
            w = 0.05 * (1 - (i + tt) / n_seg) + 0.012
            P = np.maximum(P, np.clip(1 - dist / w, 0, 1))
    r = np.sqrt(X * X + Y * Y)
    P = np.maximum(P, np.clip(1 - r / 0.2, 0, 1))
    H = np.clip(1 - r * 0.9, 0.3, 1)
    return P, H * (P > 0), np.ones_like(P)


def splash_crown():
    rng = np.random.default_rng(37)
    # 底部一道扁椭圆 + 往上溅的尖 + 尖顶上脱离的熔滴（侧面看）
    base = np.clip(1 - np.sqrt((X / 0.8) ** 2 + ((Y + 0.62) / 0.16) ** 2), 0, 1)
    P = base * 1.4
    for k in range(9):
        x0 = -0.68 + 1.36 * k / 8 + rng.uniform(-0.05, 0.05)
        h = rng.uniform(0.35, 0.85) * (1 - 0.45 * abs(x0))
        lean = x0 * 0.35
        u = (Y + 0.62) / h
        xc = x0 + lean * np.clip(u, 0, 1)
        w = 0.085 * np.clip(1 - u, 0, 1) ** 0.7
        spike = np.clip(1 - np.abs(X - xc) / (w + 1e-4), 0, 1) * ((u >= 0) & (u <= 1))
        P = np.maximum(P, spike)
        dy = Y - (-0.62 + h + rng.uniform(0.08, 0.16))
        dx = X - (x0 + lean * 1.15)
        rr = rng.uniform(0.04, 0.07)
        P = np.maximum(P, np.clip(1 - np.sqrt(dx * dx + dy * dy) / rr, 0, 1) * 1.2)
    P = np.clip(P, 0, 1)
    H = np.clip(1 - (Y + 0.62) * 0.6, 0.35, 1)
    return P, H * (P > 0), np.ones_like(P)


# ───────────── 火舌序列 ─────────────

def flame(t):
    # 0..0.35 窜起；之后尖端断开成一团往上飘、本体缩回
    grow = min(1.0, t / 0.35)
    k = max(0.0, (t - 0.35) / 0.65)
    tip = -0.85 + (0.2 + 1.5 * (1 - (1 - grow) ** 2)) * (1 - 0.55 * k)
    width = 0.44 * (1 - 0.45 * k)
    u = np.clip((Y + 0.86) / max(1e-3, tip + 0.86), 0, 1.2)
    sway = 0.17 * np.sin(2.4 * Y - t * 2 * np.pi * 1.5) * u ** 1.4
    xs = X - sway
    prof = width * np.sin(np.pi * np.clip(u, 0, 1) ** 0.62) ** 0.85 * (1 - 0.25 * u)
    n = fbm(X * 3.0 + 1.7, Y * 2.4 - t * 4.0, t, 480, 3)
    S = 1 - np.abs(xs) / (prof + 1e-3) + 0.3 * (n - 0.5)
    S = np.where((u > 0) & (u < 1), S, -1)
    D = np.clip(S, 0, 1)
    # 断开的那一团
    if k > 0:
        by = min(0.72, tip + 0.16 + 0.75 * k)
        bx = 0.12 * np.sin(k * 5.0)
        br = 0.26 * (1 - k) ** 0.7 + 0.01
        bd = np.sqrt((X - bx) ** 2 + (Y - by) ** 2) / br
        blob = 1 - bd + 0.25 * (n - 0.5)
        D = np.maximum(D, np.clip(blob, 0, 1))
    edge = np.maximum(np.abs(X), np.abs(Y))
    D *= 1 - smooth(0.88, 0.98, edge)
    H = np.clip((1 - np.abs(xs) / (prof + 1e-3)) * (1 - 0.75 * np.clip(u, 0, 1)) * 1.5, 0, 1) * (D > 0)
    if k > 0:
        H = np.maximum(H, np.clip(1 - bd, 0, 1) * (0.9 - 0.5 * k))
    return D, H, np.ones_like(D)


# 风格审查（docs/art/fx-style.md「形状先于细节」）：团数收少、每团放大——火团 1 + 5 + 1、烟团 1 + 4 + 1，一簇读成几大团，不是一片小泡泡
# 烟团照祥云的样子摆：上面鼓起三个团头、两侧各一个、底下收平（不是均匀的一圈）
FIRE_PUFFS = make_puffs(5, 6, 0.5, (0.3, 0.42), (0.25, 0.34), 1, jitter=0.4)
SMOKE_PUFFS = make_puffs(9, 5, 0.5, (0.27, 0.36), (0.27, 0.36), 1, jitter=0.12,
                         angles=[np.radians(a) for a in (172, 128, 82, 40, -8)])


def build():
    atlas = np.zeros((ROWS * N, COLS * N, 4), dtype=np.float64)
    cells = {}
    for i in range(16):
        cells[i] = fireball(i / 15)
        cells[16 + i] = smoke(i / 15)
        cells[48 + i] = flame(i / 15)
    cells[32] = ring()
    cells[33] = burst_star()
    cells[34] = dust_ring()
    cells[35] = seal()
    cells[36] = cracks()
    cells[37] = splash_crown()
    for idx, (R, G, B) in cells.items():
        cx, cy = idx % COLS, idx // COLS
        A = np.clip(R * 8, 0, 1)
        atlas[cy * N:(cy + 1) * N, cx * N:(cx + 1) * N] = np.stack([R, G * (R > 0), B * (R > 0), A], -1)
    return (np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8)


def preview(img):
    """按 SF_FxToon 的火模式粗略上色（只为看形状）"""
    a = img.astype(np.float64) / 255
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    hot, mid, deep, smk = np.array([1, 0.95, 0.75]), np.array([1, 0.55, 0.15]), np.array([0.75, 0.18, 0.05]), np.array([0.25, 0.22, 0.2])
    col = np.where((G > 0.62)[..., None], hot, np.where((G > 0.35)[..., None], mid, np.where((G > 0.12)[..., None], deep, smk)))
    col = col * np.where((B > 0.45)[..., None], 1.0, 0.72)[..., None][..., 0]
    mask = (R > 0.12)[..., None]
    bg = np.array([0.35, 0.55, 0.8])
    return (np.where(mask, col, bg) * 255).astype(np.uint8)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--out", default=".")
    ap.add_argument("--target", default=OUT)
    args = ap.parse_args()
    img = build()
    os.makedirs(os.path.dirname(args.target), exist_ok=True)
    Image.fromarray(img, "RGBA").save(args.target, optimize=False)
    print("写入", args.target, img.shape)
    if args.preview:
        p = os.path.join(args.out, "T_Fx_Blast_preview.png")
        Image.fromarray(preview(img), "RGB").resize((1024, 1024), Image.LANCZOS).save(p)
        print("预览", p)
