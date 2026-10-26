"""射击核心的手绘风贴图（特效打磨 A 路）：枪口火焰形状集 + 弹孔 / 焦痕图集（含法线）。

    python scripts/unity/fx_shot_textures.py             # 写 unity/Assets/Game/Resources/Fx/Shot/*.png
    python scripts/unity/fx_shot_textures.py --preview D # 另存上色预览到目录 D

全部确定性（固定种子），重跑逐字节相同。按线性空间导入（数据，不是颜色）。

T_Fx_MuzzleSet.png  1024 × 1024，4 × 4 格（每格 256 px，第 0 格在左上角，按行往右数）：
    RGB = 亮度（白热芯 1 → 边缘 0.55，乘调用方颜色），A = 形状（硬边 + 1–2 px 抗锯齿：卡通、干脆）
    正面（格心 = 枪口，朝枪管方向看）：
        0 十字星芒（步枪：四道长芒 + 四道短芒）      1 霰弹喷口（一圈火舌簇 + 弹丸火星点）
        2 粗火团（左轮 / 榴弹：鼓起的火云团）          3 冲击环（狙击 / 灵炮：带缺口的细环）
        4 能量波纹（三圈同心环、外圈虚线）              5 白热芯（所有火焰类的芯）
        6 六角星芒（冲锋枪：短促六芒）                  7 符环（灵器：环 + 刻度 + 内环）
    侧面（根在格子左边、沿 +u 伸出；面片沿枪管放）：
        8 长火舌（带两节激波菱）                        9 粗短火舌（左轮）
       10 扇形喷口（霰弹）                             11 中火舌（步枪 / 冲锋枪）
       12 能量流（一道柔光带 + 三道竖波纹）            13 八角爆星（正面，榴弹 / 飞弹的砰）
       14–15 留空

T_Fx_Holes.png / T_Fx_Holes_N.png  2048 × 1024，8 × 4 格（每格 256 px）：
    左半 4 × 4：弹孔，行 = 地表（0 石 / 1 沙 / 2 冰 / 3 金属），列 = 变体 0–3；
    右半：焦痕 4 种，每种占 2 × 2 格（512 px）：变体 k 在列 4 + 2·(k % 2)、行 2·(k / 2)。
    T_Fx_Holes：R = 压暗（焦黑、坑底），G = 余热（发光的位置，按余热高低从里往外熄），B = 提亮（崩白、翻沙、擦亮的金属），
                A = 高度（0.5 = 原表面，低 = 凹，高 = 鼓起的坑沿 / 碎屑）。
    T_Fx_Holes_N：由高度场求出的切线空间法线（u 向右、v 向上，OpenGL 约定），按法线贴图导入。
"""
import argparse
import os

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.environ.get("FX_SHOT_OUT") or os.path.join(ROOT, "unity", "Assets", "Game", "Resources", "Fx", "Shot")


def grid(n):
    c = (np.arange(n) + 0.5) / n * 2 - 1
    x, y = np.meshgrid(c, -c)  # x 向右、y 向上
    return x, y


# ───────────── 噪声 ─────────────

def _hash(ix, iy, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + seed * 2654435761) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFF) / float(0xFFFFFF)


def vnoise(x, y, seed=0):
    xi, yi = np.floor(x), np.floor(y)
    fx, fy = x - xi, y - yi
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    xi, yi = xi.astype(np.int64), yi.astype(np.int64)
    a = _hash(xi, yi, seed)
    b = _hash(xi + 1, yi, seed)
    c = _hash(xi, yi + 1, seed)
    d = _hash(xi + 1, yi + 1, seed)
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy


def fbm(x, y, seed=0, octaves=4):
    s, amp, norm = 0.0, 0.5, 0.0
    for i in range(octaves):
        s = s + amp * vnoise(x, y, seed + i * 31)
        norm += amp
        x = x * 2.03 + 1.7
        y = y * 2.03 - 0.9
        amp *= 0.5
    return s / norm


def angnoise(theta, freq, seed):
    """沿角度一圈无缝的噪声：在半径 freq 的圆上取 2D 噪声"""
    return fbm(np.cos(theta) * freq + 11.3, np.sin(theta) * freq - 7.1, seed, 3)


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def aa(d, px):
    """有符号距离（里面为正）→ 硬边覆盖，抗锯齿宽 px（格内坐标单位）"""
    return np.clip(d / px + 0.5, 0, 1)


def poster(v, steps, soft=0.08):
    """色阶化（手绘的几段硬色阶），段与段之间留一点软边"""
    v = np.clip(v, 0, 1) * steps
    base = np.floor(v)
    f = v - base
    return np.clip((base + sstep(0.5 - soft, 0.5 + soft, f)) / steps, 0, 1)


def seg_dist(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    t = np.clip(((px - ax) * abx + (py - ay) * aby) / max(1e-9, abx * abx + aby * aby), 0, 1)
    dx, dy = px - (ax + abx * t), py - (ay + aby * t)
    return np.sqrt(dx * dx + dy * dy), t


def rng(seed):
    return np.random.default_rng(seed)


# ───────────── 枪口火焰 ─────────────

MN = 256


def spikes(x, y, count, length, base_w, rot=0.0, lens=None):
    """count 道尖芒（三角形，基宽 base_w、长 length），返回覆盖与亮度"""
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x) - rot
    cov = np.zeros_like(x)
    lum = np.zeros_like(x)
    for i in range(count):
        a = i * 2 * np.pi / count
        L = length if lens is None else lens[i]
        # 沿这道芒的坐标
        da = np.angle(np.exp(1j * (th - a)))
        along = r * np.cos(da)
        side = np.abs(r * np.sin(da))
        w = base_w * np.clip(1 - along / L, 0, 1)
        d = w - side
        c = aa(d, 1.5 / MN * 2) * (along > -0.05) * (along < L)
        cov = np.maximum(cov, c)
        lum = np.maximum(lum, c * (1 - 0.45 * np.clip(along / L, 0, 1)))
    return cov, lum


def muzzle_cell(i):
    x, y = grid(MN)
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x)
    px = 2.0 / MN
    a = np.zeros_like(x)
    lum = np.zeros_like(x)
    core = np.exp(-(r / 0.2) ** 2)
    if i == 0:  # 十字星芒
        c1, l1 = spikes(x, y, 4, 0.96, 0.15)
        c2, l2 = spikes(x, y, 4, 0.5, 0.09, rot=np.pi / 4)
        disc = aa(0.24 - r, px)
        a = np.maximum.reduce([c1, c2 * 0.85, disc])
        lum = np.maximum.reduce([l1, l2 * 0.9, disc]) * 0.72 + 0.28 * core
    elif i == 1:  # 霰弹喷口：一圈火舌簇
        g = rng(101)
        disc = aa(0.3 + 0.03 * np.sin(th * 9) - r, px)
        a, lum = disc.copy(), disc * 0.9
        n = 11
        for k in range(n):
            ang = k * 2 * np.pi / n + g.uniform(-0.15, 0.15)
            L = g.uniform(0.62, 0.95)
            w0 = g.uniform(0.09, 0.14)
            da = np.angle(np.exp(1j * (th - ang)))
            along = r * np.cos(da)
            side = np.abs(r * np.sin(da))
            t = np.clip((along - 0.12) / (L - 0.12), 0, 1)
            w = w0 * np.sin(np.pi * np.clip(t * 0.9 + 0.1, 0, 1)) ** 0.6 * (1 - t) ** 0.5
            c = aa(w - side, px) * (along > 0.1) * (along < L)
            a = np.maximum(a, c)
            lum = np.maximum(lum, c * (0.95 - 0.4 * t))
        for k in range(14):  # 弹丸火星点
            ang = g.uniform(0, 2 * np.pi)
            rr = g.uniform(0.55, 0.92)
            cx, cy = np.cos(ang) * rr, np.sin(ang) * rr
            d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            c = aa(g.uniform(0.018, 0.032) - d, px)
            a = np.maximum(a, c)
            lum = np.maximum(lum, c)
        lum = lum * 0.75 + 0.25 * core
    elif i in (2, 13):  # 粗火团 / 八角爆星
        if i == 2:
            g = rng(202)
            f = aa(0.5 - r, px)
            for k in range(8):
                ang = k * 2 * np.pi / 8 + g.uniform(-0.2, 0.2)
                rr = g.uniform(0.4, 0.55)
                cx, cy = np.cos(ang) * rr, np.sin(ang) * rr
                f = np.maximum(f, aa(g.uniform(0.2, 0.3) - np.sqrt((x - cx) ** 2 + (y - cy) ** 2), px))
            a = f
            # 三段色阶：芯白热、中间亮、外圈
            band = poster(1 - np.clip(r / 0.85, 0, 1), 3, 0.06)
            lum = f * (0.55 + 0.45 * band)
        else:
            g = rng(1313)
            lens = [g.uniform(0.75, 0.98) if k % 2 == 0 else g.uniform(0.42, 0.58) for k in range(16)]
            c, l = spikes(x, y, 16, 1.0, 0.2, rot=0.1, lens=lens)
            disc = aa(0.36 + 0.04 * np.sin(th * 7) - r, px)
            a = np.maximum(c, disc)
            lum = np.maximum(l * 0.85, disc) * 0.75 + 0.25 * core
    elif i == 3:  # 冲击环
        R = 0.78
        ring = aa(0.055 - np.abs(r - R) - 0.02 * np.sin(th * 3), px)
        gaps = sstep(-0.25, 0.25, np.sin(th * 4 + 0.6))  # 四个缺口
        ring = ring * np.maximum(gaps, 0.0)
        inner = sstep(0.4, R, r) * (r < R) * 0.22
        a = np.maximum(ring, inner)
        lum = np.maximum(ring, inner * 0.7)
    elif i == 4:  # 能量波纹
        a = np.zeros_like(x)
        for R, w, dash in ((0.32, 0.05, 0), (0.58, 0.04, 10), (0.84, 0.03, 16)):
            ring = aa(w - np.abs(r - R), px)
            if dash:
                ring = ring * sstep(-0.2, 0.2, np.sin(th * dash))
            a = np.maximum(a, ring * (1.1 - R * 0.5))
        a = np.maximum(a, np.exp(-(r / 0.22) ** 2) * 0.8)
        lum = np.clip(a, 0, 1) * 0.85 + 0.15 * core
    elif i == 5:  # 白热芯
        a = np.clip(aa(0.3 - r, px) * 0.85 + np.exp(-(r / 0.45) ** 2) * 0.6, 0, 1) * aa(0.98 - r, px)
        lum = np.clip(0.6 + 0.4 * (1 - r / 0.5), 0.6, 1)
    elif i == 6:  # 六角星芒（冲锋枪）
        c1, l1 = spikes(x, y, 6, 0.78, 0.16, rot=np.pi / 2)
        disc = aa(0.22 - r, px)
        a = np.maximum(c1, disc)
        lum = np.maximum(l1, disc) * 0.72 + 0.28 * core
    elif i == 7:  # 符环
        outer = aa(0.035 - np.abs(r - 0.8), px)
        inner = aa(0.022 - np.abs(r - 0.55), px)
        ticks = aa(0.035 - np.abs(r * np.sin(np.angle(np.exp(1j * (th * 8))) / 8)), px) * (r > 0.6) * (r < 0.92)
        dots = np.zeros_like(x)
        for k in range(4):
            ang = k * np.pi / 2 + np.pi / 4
            d = np.sqrt((x - np.cos(ang) * 0.68) ** 2 + (y - np.sin(ang) * 0.68) ** 2)
            dots = np.maximum(dots, aa(0.045 - d, px))
        a = np.maximum.reduce([outer, inner * 0.8, ticks * 0.9, dots, np.exp(-(r / 0.25) ** 2) * 0.7])
        lum = np.clip(a, 0, 1) * 0.85 + 0.15 * core
    elif i in (8, 9, 10, 11, 12):  # 侧面：x 从根（-1）到尖（+1）
        t = (x + 1) / 2
        ay = np.abs(y)
        if i == 8:  # 长火舌 + 两节激波菱
            w = 0.36 * np.clip(1 - t, 0, 1) ** 0.75 * np.sqrt(np.clip(t * 9, 0, 1))
            w = w * (1 + 0.32 * np.exp(-((t - 0.36) / 0.06) ** 2) + 0.25 * np.exp(-((t - 0.64) / 0.06) ** 2))
            w = w - 0.1 * np.exp(-((t - 0.5) / 0.05) ** 2) * (1 - t)
            a = aa(w - ay, px) * (t < 0.99)
            inner = aa(w * 0.45 - ay, px)
            lum = a * (0.62 + 0.38 * inner) * (1 - 0.3 * t)
        elif i == 9:  # 粗短火舌
            w = 0.78 * np.sin(np.pi * np.clip(t / 0.82, 0, 1)) ** 0.55 * (1 - t) ** 0.25 + 0.04 * np.sin(t * 40) * (1 - t)
            a = aa(w - ay, px) * (t < 0.82)
            inner = aa(w * 0.5 - ay, px)
            lum = a * (0.6 + 0.4 * inner) * (1 - 0.25 * t)
        elif i == 10:  # 扇形喷口
            g = rng(1010)
            ang = np.arctan2(y, np.maximum(t, 1e-4) * 2)
            n = 7
            Ls = g.uniform(0.62, 0.98, n)
            k = np.clip(((ang + 0.62) / 1.24 * n).astype(int), 0, n - 1)
            L = Ls[k]
            fan = (np.abs(ang) < 0.62) * (t < L)
            # 每道火舌的边：角度格中心更长，边上收尖
            cell = ((ang + 0.62) / 1.24 * n) % 1
            tip = L * (0.65 + 0.35 * np.sin(np.pi * cell))
            a = aa((tip - t) * 2, px) * (np.abs(ang) < 0.62) * aa(0.62 - np.abs(ang), 0.03)
            a = np.maximum(a, aa(0.26 * np.sqrt(np.clip(t * 6, 0, 1)) - ay, px) * (t < 0.3))
            lum = a * (0.95 - 0.45 * t)
            for j in range(10):
                cx = g.uniform(0.0, 0.9)
                cy = g.uniform(-0.5, 0.5) * (cx + 0.1)
                d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
                c = aa(g.uniform(0.016, 0.026) - d, px)
                a = np.maximum(a, c)
                lum = np.maximum(lum, c)
        elif i == 11:  # 中火舌
            w = 0.42 * np.clip(1 - t / 0.78, 0, 1) ** 0.8 * np.sqrt(np.clip(t * 8, 0, 1))
            w = w * (1 + 0.28 * np.exp(-((t - 0.4) / 0.07) ** 2))
            a = aa(w - ay, px) * (t < 0.78)
            inner = aa(w * 0.45 - ay, px)
            lum = a * (0.62 + 0.38 * inner) * (1 - 0.3 * t)
        else:  # 能量流
            band = np.exp(-(ay / (0.12 + 0.05 * t)) ** 2) * (1 - t) ** 0.6
            a = band
            for tc in (0.22, 0.47, 0.72):
                xc = tc * 2 - 1
                e = ((x - xc) / 0.06) ** 2 + (y / (0.42 - 0.2 * tc)) ** 2
                ring = aa(0.25 - np.abs(np.sqrt(e) - 0.75), 0.06)
                a = np.maximum(a, ring * (1 - tc * 0.8))
            lum = np.clip(a, 0, 1) * 0.9 + 0.1
    a = np.clip(a, 0, 1)
    lum = np.clip(lum, 0, 1)
    return lum, a


def muzzle_atlas():
    img = np.zeros((4 * MN, 4 * MN, 4), dtype=np.float64)
    for i in range(16):
        if i >= 14:
            continue
        lum, a = muzzle_cell(i)
        col, row = i % 4, i // 4
        sl = img[row * MN:(row + 1) * MN, col * MN:(col + 1) * MN]
        sl[..., 0] = sl[..., 1] = sl[..., 2] = np.where(a > 0, lum, 0)
        sl[..., 3] = a
    return img


# ───────────── 弹孔 / 焦痕 ─────────────

HN = 256


def polygon_radius(theta, n, base, jitter, seed):
    """不规则多边形的半径（崩口）：n 个顶点、半径 base·(1 ± jitter)，顶点之间按角度线性插"""
    g = rng(seed)
    angs = np.sort(g.uniform(0, 2 * np.pi, n))
    rads = base * (1 + g.uniform(-jitter, jitter, n))
    t = np.mod(theta, 2 * np.pi)
    angs_ext = np.concatenate([angs - 2 * np.pi, angs, angs + 2 * np.pi])
    rads_ext = np.concatenate([rads, rads, rads])
    return np.interp(t, angs_ext, rads_ext)


def cracks(x, y, seed, count, r0, r1, width, branch=True):
    """放射裂纹（折线、渐细）：返回 0..1 的线遮罩"""
    g = rng(seed)
    m = np.zeros_like(x)
    for k in range(count):
        ang = k * 2 * np.pi / count + g.uniform(-0.3, 0.3)
        L = g.uniform(r1 * 0.65, r1)
        pts = [(np.cos(ang) * r0, np.sin(ang) * r0)]
        a = ang
        for s in range(3):
            a += g.uniform(-0.35, 0.35)
            rr = r0 + (L - r0) * (s + 1) / 3
            pts.append((np.cos(a) * rr, np.sin(a) * rr))
        for s in range(3):
            (ax, ay), (bx, by) = pts[s], pts[s + 1]
            d, t = seg_dist(x, y, ax, ay, bx, by)
            w = width * (1 - (s + t) / 3) + 0.002
            m = np.maximum(m, aa(w - d, 1.2 / HN * 2))
        if branch and g.uniform() < 0.7:
            (ax, ay) = pts[1]
            ba = a + g.choice([-1, 1]) * g.uniform(0.5, 0.9)
            bl = g.uniform(0.12, 0.25)
            d, t = seg_dist(x, y, ax, ay, ax + np.cos(ba) * bl, ay + np.sin(ba) * bl)
            m = np.maximum(m, aa(width * 0.6 * (1 - t) + 0.002 - d, 1.2 / HN * 2))
    return m


def bump(r, c, w):
    return np.exp(-((r - c) / w) ** 2)


def hole_stone(v):
    x, y = grid(HN)
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x)
    s = 1000 + v * 17
    rh = polygon_radius(th, 7 + v, 0.15 + 0.02 * (v % 2), 0.3, s)
    rc = polygon_radius(th, 9, 0.44 + 0.03 * (v % 3), 0.18, s + 1)
    n = fbm(x * 5 + v * 3.1, y * 5 - v, s + 2)
    # 高度：坑底深、坑壁分三段崩口台阶、坑沿微鼓
    wall = 1 - sstep(rh, rc, r)
    # 崩口台阶不要一圈圈同心：按角度噪声错开
    wall_t = np.clip(wall ** 1.3 + 0.18 * (angnoise(th, 2.8, s + 5) - 0.5) * wall * (1 - wall) * 4, 0, 1)
    h = 0.5 - 0.28 * poster(wall_t, 2, 0.2) - 0.06 * wall - 0.1 * (r < rh)
    h += 0.05 * bump(r, rc + 0.03, 0.05) * (0.6 + 0.8 * n)
    cr = cracks(x, y, s + 3, 4 + v % 3, 0.3, 0.88, 0.028)
    h -= 0.08 * cr * (r > rc * 0.8)
    # 碎屑：坑沿外散落的小碎块（亮、微鼓）
    g = rng(s + 4)
    chips = np.zeros_like(x)
    for k in range(9):
        ang = g.uniform(0, 2 * np.pi)
        rr = g.uniform(0.5, 0.8)
        cx, cy = np.cos(ang) * rr, np.sin(ang) * rr
        pr = polygon_radius(np.arctan2(y - cy, x - cx), 5, g.uniform(0.025, 0.05), 0.4, s + 10 + k)
        chips = np.maximum(chips, aa(pr - np.sqrt((x - cx) ** 2 + (y - cy) ** 2), 2.0 / HN))
    h += 0.05 * chips
    dark = np.maximum.reduce([
        (r < rh) * 1.0,
        poster(wall, 2, 0.1) * 0.55 * (0.8 + 0.4 * n),
        cr * 0.85 * (r > rc * 0.8),
        poster(sstep(rc + 0.28, rc, r), 2, 0.15) * 0.28 * (0.6 + 0.8 * n) * (r >= rc * 0.95),
    ])
    light = np.maximum(chips * 0.55, bump(r, rc + 0.015, 0.018) * 0.35 * (n > 0.45))
    heat = sstep(rh + 0.1, rh - 0.01, r) * (r > rh * 0.55) * 1.0 + cr * sstep(0.45, 0.2, r) * 0.6
    cover = np.maximum.reduce([dark, light, heat, np.abs(h - 0.5) * 6])
    return finish(dark, heat, light, h, cover)


def hole_sand(v):
    x, y = grid(HN)
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x)
    s = 2000 + v * 17
    n = fbm(x * 4 + v, y * 4 - v * 2, s)
    rc = 0.5 + 0.06 * (angnoise(th, 1.6, s + 1) - 0.5) * 2 + 0.03 * (v % 2)
    bowl = np.clip(1 - (r / rc) ** 2, 0, 1)
    h = 0.5 - 0.17 * bowl
    rim = bump(r, rc + 0.06, 0.1) * (0.6 + 0.8 * angnoise(th, 3.0, s + 2))
    h += 0.12 * poster(np.clip(rim, 0, 1), 3, 0.15)
    pit = sstep(0.13, 0.08, r)
    h -= 0.12 * pit
    # 溅出去的沙：几道放射的沙痕 + 沙粒点
    g = rng(s + 3)
    rays = np.zeros_like(x)
    for k in range(9 + v):
        ang = g.uniform(0, 2 * np.pi)
        L = g.uniform(0.7, 0.95)
        rc0 = 0.52 + 0.03 * (v % 2)
        d, t = seg_dist(x, y, np.cos(ang) * rc0, np.sin(ang) * rc0, np.cos(ang) * L, np.sin(ang) * L)
        rays = np.maximum(rays, aa(0.035 * (1 - t) + 0.005 - d, 2.0 / HN))
    grains = (vnoise(x * 60, y * 60, s + 4) > 0.82) * sstep(0.95, 0.6, r) * (r > rc)
    h += 0.04 * rays + 0.03 * grains
    dark = np.maximum(poster(bowl, 2, 0.12) * 0.32 * (0.8 + 0.4 * n), pit * 0.75)
    light = np.maximum.reduce([poster(np.clip(rim, 0, 1), 2, 0.15) * 0.5, rays * 0.35, grains * 0.4])
    heat = pit * 0.35
    cover = np.maximum.reduce([dark, light, heat, np.abs(h - 0.5) * 6])
    return finish(dark, heat, light, h, cover)


def hole_ice(v):
    x, y = grid(HN)
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x)
    s = 3000 + v * 17
    rh = polygon_radius(th, 6, 0.09, 0.3, s)
    rc = polygon_radius(th, 8 + v, 0.3 + 0.03 * (v % 2), 0.25, s + 1)
    spall = sstep(rc, rc - 0.04, r)
    h = 0.5 - 0.06 * spall - 0.2 * (r < rh)
    # 裂纹：中间一道深色的缝（亮冰面上看得见）+ 两边崩白的光边
    cr = cracks(x, y, s + 2, 7 + v, 0.15, 0.95, 0.022)
    cr_core = cracks(x, y, s + 2, 7 + v, 0.15, 0.95, 0.008)
    # 贝壳状的断口弧
    g = rng(s + 3)
    arcs = np.zeros_like(x)
    for k in range(3):
        R = g.uniform(0.45, 0.65)
        a0 = g.uniform(0, 2 * np.pi)
        span = g.uniform(0.6, 1.2)
        da = np.angle(np.exp(1j * (th - a0)))
        arcs = np.maximum(arcs, aa(0.012 - np.abs(r - R), 2.0 / HN) * (np.abs(da) < span / 2))
    h -= 0.06 * cr + 0.03 * arcs
    ring = bump(r, rc + 0.02, 0.025) * 0.5
    dark = np.maximum.reduce([(r < rh) * 0.92, cr_core * 0.62, arcs * 0.35, ring * 0.6])
    light = np.maximum.reduce([poster(spall * (0.7 + 0.3 * fbm(x * 8, y * 8, s + 4)), 3, 0.1) * 0.85, (cr - cr_core) * 0.9])
    heat = np.zeros_like(x)
    cover = np.maximum.reduce([dark, light, np.abs(h - 0.5) * 6])
    return finish(dark, heat, light, h, cover)


def hole_metal(v):
    x, y = grid(HN)
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x)
    s = 4000 + v * 17
    rc = 0.34 + 0.03 * (v % 2)
    bowl = np.clip(1 - (r / rc) ** 2, 0, 1)
    h = 0.5 - 0.2 * bowl + 0.09 * bump(r, rc + 0.01, 0.045)
    pierced = v < 2
    rh = polygon_radius(th, 6, 0.09, 0.25, s) if pierced else np.full_like(x, 0.0)
    hole = (r < rh) * 1.0
    h -= 0.15 * hole
    # 漆面崩掉一圈露出亮金属（外缘锯齿）
    chip_r = rc + 0.1 + 0.08 * (angnoise(th, 2.5, s + 1) - 0.5) * 2 + 0.03 * np.sin(th * 13)
    bare = aa(chip_r - r, 2.0 / HN) * (r > rc * 0.85)
    g = rng(s + 2)
    scratches = np.zeros_like(x)
    for k in range(12):
        ang = g.uniform(0, 2 * np.pi)
        L = g.uniform(0.5, 0.8)
        d, t = seg_dist(x, y, np.cos(ang) * rc, np.sin(ang) * rc, np.cos(ang + 0.05) * L, np.sin(ang + 0.05) * L)
        scratches = np.maximum(scratches, aa(0.008 * (1 - t) + 0.002 - d, 1.5 / HN))
    h -= 0.015 * scratches
    dark = np.maximum.reduce([hole, bump(r, chip_r + 0.02, 0.03) * 0.35, bowl * 0.18])
    light = np.maximum.reduce([bare * 0.6, scratches * 0.5, bump(r, rc + 0.01, 0.02) * 0.6])
    heat = sstep(rc * 0.75, 0.0, r) * (1 - hole * 0.3)
    cover = np.maximum.reduce([dark, light, heat, np.abs(h - 0.5) * 6])
    return finish(dark, heat, light, h, cover)


def scorch(v):
    n2 = HN * 2
    c = (np.arange(n2) + 0.5) / n2 * 2 - 1
    x, y = np.meshgrid(c, -c)
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x)
    s = 5000 + v * 23
    g = rng(s)
    base = 0.5 * (1 + 0.25 * (angnoise(th, 2.2, s + 1) - 0.5) * 2)
    # 爆开的放射焦痕（长短不一、尖头）
    streak = np.zeros_like(x)
    for k in range(11 + v):
        ang = g.uniform(0, 2 * np.pi)
        L = g.uniform(0.65, 0.96)
        w0 = g.uniform(0.06, 0.11)
        da = np.angle(np.exp(1j * (th - ang)))
        along = r * np.cos(da)
        side = np.abs(r * np.sin(da))
        w = w0 * np.clip(1 - (along - 0.2) / (L - 0.2), 0, 1)
        streak = np.maximum(streak, aa(w - side, 2.0 / n2) * (along > 0) * (along < L))
    n = fbm(x * 3.5 + v, y * 3.5 - v, s + 2)
    body = aa(base - r, 2.0 / n2)
    # 外缘不是一刀切：烟熏往外淡成两段色阶，边缘被噪声啃
    soot = poster(sstep(base + 0.14, base - 0.1, r + 0.12 * (n - 0.5)), 3, 0.1)
    charcoal = sstep(0.36, 0.2, r + 0.12 * (n - 0.5))
    dark = np.maximum(soot * (0.62 + 0.25 * poster(n, 2, 0.15)), streak * 0.55 * (1 - 0.4 * r))
    dark = np.maximum(dark, charcoal * 0.95)
    # 龟裂的焦土：Voronoi 边当裂缝（缝里余热）
    pts = []
    while len(pts) < 16:  # 点之间至少隔 0.16（两点挨太近，平分线那条缝会糊成一大片）
        p_ = g.uniform(-0.55, 0.55, 2)
        if all(np.hypot(*(p_ - q)) > 0.16 for q in pts):
            pts.append(p_)
    d1 = np.full_like(x, 9.0)
    d2 = np.full_like(x, 9.0)
    for px_, py_ in pts:
        d = np.sqrt((x - px_) ** 2 + (y - py_) ** 2)
        d2 = np.minimum(d2, np.maximum(d1, d))
        d1 = np.minimum(d1, d)
    edge = aa(0.014 - (d2 - d1), 2.0 / n2) * sstep(0.55, 0.3, r)
    h = 0.5 - 0.06 * charcoal - 0.08 * edge - 0.03 * body
    # 余热：缝里最热（中心）往外熄，外加零星火星点
    embers = (vnoise(x * 34, y * 34, s + 3) > 0.86) * sstep(0.62, 0.25, r)
    heat = np.maximum(edge * (0.45 + 0.55 * sstep(0.55, 0.0, r)), embers * 0.75)
    heat = np.maximum(heat, charcoal * 0.35 * sstep(0.3, 0.0, r))
    ash = (vnoise(x * 50, y * 50, s + 4) > 0.9) * soot * (r > 0.3) * 0.35
    light = ash
    cover = np.maximum.reduce([dark, heat, light, np.abs(h - 0.5) * 6])
    return finish(dark, heat, light, h, cover)


def finish(dark, heat, light, h, cover):
    """格边一圈清零（mip 不串格）"""
    n = dark.shape[0]
    c = (np.arange(n) + 0.5) / n * 2 - 1
    x, y = np.meshgrid(c, -c)
    edge = sstep(0.97, 0.9, np.maximum(np.abs(x), np.abs(y)))
    out = np.stack([np.clip(dark, 0, 1) * edge, np.clip(heat, 0, 1) * edge, np.clip(light, 0, 1) * edge,
                    0.5 + (np.clip(h, 0, 1) - 0.5) * edge], -1)
    return out


def normals_from_height(hgt, strength):
    """高度 → 切线空间法线（u 向右、v 向上）；按格算，strength = 坑深 / 格宽 的夸张倍数"""
    gy, gx = np.gradient(hgt)
    # 图像行往下增大，v 向上：dh/dv = -dh/drow
    dhdu = gx * strength
    dhdv = -gy * strength
    nx, ny, nz = -dhdu, -dhdv, np.ones_like(hgt)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1)


def holes_atlas():
    W, H = 8 * HN, 4 * HN
    masks = np.zeros((H, W, 4))
    masks[..., 3] = 0.5
    nrm = np.zeros((H, W, 3))
    nrm[..., 2] = 1
    makers = [hole_stone, hole_sand, hole_ice, hole_metal]
    strength = {0: 70.0, 1: 55.0, 2: 40.0, 3: 60.0}
    for row, mk in enumerate(makers):
        for v in range(4):
            cell = mk(v)
            masks[row * HN:(row + 1) * HN, v * HN:(v + 1) * HN] = cell
            nrm[row * HN:(row + 1) * HN, v * HN:(v + 1) * HN] = normals_from_height(cell[..., 3], strength[row])
    for k in range(4):
        cell = scorch(k)
        col, row = 4 + 2 * (k % 2), 2 * (k // 2)
        masks[row * HN:(row + 2) * HN, col * HN:(col + 2) * HN] = cell
        nrm[row * HN:(row + 2) * HN, col * HN:(col + 2) * HN] = normals_from_height(cell[..., 3], 90.0)
    return masks, nrm


def to8(a):
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def preview(masks, nrm, path):
    """上色预览：沙色底 + 光从左上来（只看效果，不入库）"""
    base = np.array([0.78, 0.62, 0.44])
    L = np.array([-0.5, 0.6, 0.62])
    L = L / np.linalg.norm(L)
    ndl = np.clip((nrm @ L), 0, 1)
    lit = (0.45 + 0.75 * ndl)[..., None] / (0.45 + 0.75 * L[2])
    col = base * lit * (1 - 0.9 * masks[..., 0:1])
    col = col * (1 - masks[..., 2:3]) + np.array([0.95, 0.92, 0.88]) * masks[..., 2:3] * lit
    col = col + np.array([1.0, 0.45, 0.1]) * masks[..., 1:2] * 0.8
    Image.fromarray(to8(col)).save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    a = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    mz = muzzle_atlas()
    Image.fromarray(to8(mz), "RGBA").save(os.path.join(OUT_DIR, "T_Fx_MuzzleSet.png"))
    masks, nrm = holes_atlas()
    Image.fromarray(to8(masks), "RGBA").save(os.path.join(OUT_DIR, "T_Fx_Holes.png"))
    Image.fromarray(to8(nrm * 0.5 + 0.5), "RGB").save(os.path.join(OUT_DIR, "T_Fx_Holes_N.png"))
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        preview(masks, nrm, os.path.join(a.preview, "holes_preview.png"))
        bg = np.zeros(mz.shape[:2] + (3,))
        bg[:] = (0.12, 0.1, 0.14)
        tint = np.array([1.0, 0.72, 0.35])
        col = bg + mz[..., :3] * tint * mz[..., 3:4] * 1.4
        Image.fromarray(to8(col)).save(os.path.join(a.preview, "muzzle_preview.png"))
    print("ok", OUT_DIR)


if __name__ == "__main__":
    main()
