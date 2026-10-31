"""第三章砸地的方形裂纹贴花 T_Fx_CrackCh3.png（第二批收尾 C 路，2026-10-31）。

    python scripts/unity/fx_crack_ch3.py              # 写 unity/Assets/Art/Fx/T_Fx_CrackCh3.png
    python scripts/unity/fx_crack_ch3.py --preview    # 另存一张上色预览（亮沙 / 熔岩两种底）到 --out 目录（默认当前目录）

熔心魔将跃击 / 竖劈 / 插剑 / 登场落地、第三章精英（炮仗傀儡、铁牛）砸地用：以前借的是通用砸地预设的裂纹格（一圈白色放射纹，读成旱魃的日轮），
或者干脆只有一滩熔铜。这张按 docs/art/fx-style.md 第三章的底色画：
  · 形状：中尺度、方折——中间一块压塌的方形坑（略转一点、四边各断一处），六道主裂纹从坑沿往外走，每一步只走 0° / 45° / 90° 的方向、
    转弯是硬折角（「方块 = 土石和重量」），越往外越细、末端收成尖；其中三道在中段分一个短叉。不画细密的碎纹。
  · 颜色由着色器 SF_FxCrack 按通道上：裂光铜橙（亮芯白热铜）、暗边紫褐（不是纯黑），余热慢慢冷成暗铜缝。
2 × 2 = 4 个变体（每格 512 px），贴的时候随机取一格、再随机转一个角度。四个通道是数据（按线性导入）：
    R = 暗边：裂缝两侧一圈紫褐焦边 + 方坑的焦底（不透明度）
    G = 裂光：裂缝本体（从坑沿往外由粗到细）
    B = 白热：裂缝中线、越靠近坑越热（着色器按余热平方取，刚砸下去的那一下才白）
    A = 到坑心的「距离」0..1（着色器用它做裂纹往外蔓延的那 0.15 s）
全部确定性（固定种子），重跑逐字节相同。
"""
import argparse
import math
import os

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "unity", "Assets", "Art", "Fx", "T_Fx_CrackCh3.png")
CELL = 512
GRID = 2
SEED = 3303


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def seg_dist(px, py, a, b):
    """每个像素到线段 ab 的距离、以及在线段上的参数 t（0..1）"""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / max(l2, 1e-9), 0, 1)
    qx, qy = ax + t * dx - px, ay + t * dy - py
    return np.sqrt(qx * qx + qy * qy), t


def kinked(rng, start, heading, total, kinks):
    """方折裂纹：从 start 沿 heading 走 total 长，中途硬折 kinks 次（每次 ±45°，偶尔回正），方向始终是 45° 的整数倍"""
    pts = [start]
    x, y = start
    h = heading
    cuts = sorted(rng.uniform(0.25, 0.8, size=kinks)) if kinks else []
    marks = [0.0, *cuts, 1.0]
    for i in range(len(marks) - 1):
        L = (marks[i + 1] - marks[i]) * total
        x, y = x + math.cos(h) * L, y + math.sin(h) * L
        pts.append((x, y))
        # 折一下：45°，朝哪边随机；折过一次之后一半概率折回原方向（锯齿一样往外走，不打圈）
        h = heading + rng.choice([-1, 1]) * math.pi / 4 if abs(h - heading) < 1e-3 or rng.random() < 0.5 else heading
    return pts


def clamp_pts(pts, rmax=0.94):
    """折线在半径 rmax 处截断（起点不动）"""
    out = [pts[0]]
    for i in range(len(pts) - 1):
        b = pts[i + 1]
        if math.hypot(*b) <= rmax:
            out.append(b)
            continue
        a = pts[i]
        lo, hi = 0.0, 1.0
        for _ in range(30):
            mid = (lo + hi) / 2
            q = (a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid)
            lo, hi = (mid, hi) if math.hypot(*q) <= rmax else (lo, mid)
        out.append((a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo))
        break
    return out


def point_at_radius(pts, rr):
    """折线上第一次到达半径 rr 的点（到不了返回 None）"""
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ra, rb = math.hypot(*a), math.hypot(*b)
        if (ra - rr) * (rb - rr) <= 0 and abs(rb - ra) > 1e-6:
            t = (rr - ra) / (rb - ra)
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return None


def polyline_fields(px, py, pts, w0, w1, both=False):
    """一条折线（宽度从 w0 线性收到 w1，末端收尖；both = 两头都收尖）：返回到中线的距离 / 本处半宽"""
    best = np.full(px.shape, 1e9, np.float32)
    best_w = np.zeros(px.shape, np.float32)
    lengths = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(lengths) or 1.0
    acc = 0.0
    for i in range(len(pts) - 1):
        d, t = seg_dist(px, py, pts[i], pts[i + 1])
        u = (acc + t * lengths[i]) / total
        w = w0 + (w1 - w0) * u
        # 末端 15% 收成尖
        w = w * np.clip((1 - u) / 0.15, 0, 1) ** 0.6
        if both:
            w = w * np.clip(u / 0.2, 0, 1) ** 0.6
        better = d / np.maximum(w, 1e-4) < best / np.maximum(best_w, 1e-4)
        best = np.where(better, d, best)
        best_w = np.where(better, w, best_w)
        acc += lengths[i]
    return best, best_w


def cell(rng):
    """一个变体：返回 (R 暗边, G 裂光, B 白热, A 到坑心距离)，各 CELL × CELL，坐标 −1..1（y 向上）"""
    n = CELL
    c = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 - 1
    px, py = np.meshgrid(c, -c)
    aa = 2.0 / n * 1.2  # 抗锯齿宽度（约 1.2 px）
    r = np.sqrt(px * px + py * py)

    # 方坑：转一点的正方形，半边 0.15–0.19；坑底焦黑、中间一汪熔铜（白热），坑沿一圈裂光、断两处
    rot = rng.uniform(-0.35, 0.35)
    hs = rng.uniform(0.15, 0.19)
    cr, sr = math.cos(rot), math.sin(rot)
    lx, ly = px * cr + py * sr, -px * sr + py * cr
    box = np.maximum(np.abs(lx), np.abs(ly))
    pit = 1 - smoothstep(hs - aa, hs + aa, box)
    rim = 1 - smoothstep(0.014, 0.014 + aa, np.abs(box - hs))
    for k in rng.choice(4, size=2, replace=False):
        g = rng.uniform(-0.5, 0.5) * hs
        m = [(lx > hs * 0.7) & (np.abs(ly - g) < hs * 0.3), (lx < -hs * 0.7) & (np.abs(ly - g) < hs * 0.3),
             (ly > hs * 0.7) & (np.abs(lx - g) < hs * 0.3), (ly < -hs * 0.7) & (np.abs(lx - g) < hs * 0.3)][k]
        rim = np.where(m, 0, rim)
    pool = 1 - smoothstep(hs * 0.45, hs * 0.62, box)
    glow = np.maximum(rim * 0.85, pool * 0.75)
    hot = np.maximum(rim * 0.5, pool)
    dark = np.maximum(pit * 0.92, 1 - smoothstep(0.035, 0.035 + aa * 2, np.abs(box - hs)))

    # 方形石板：外面再套一圈断续的方框裂纹（半边 0.44–0.52，和坑同向略偏），四条边各分两半、随机断掉几段——地面被砸成一圈方石板（回纹的意思）
    rot2 = rot + rng.uniform(-0.12, 0.12)
    hs2 = rng.uniform(0.44, 0.52)
    c2, s2 = math.cos(rot2), math.sin(rot2)

    def sq(u, v, h=hs2, c=c2, s_=s2):
        """方框局部坐标 (u, v)·h → 贴图坐标"""
        return (u * h * c - v * h * s_, u * h * s_ + v * h * c)

    plates = []
    keep = rng.random(8) < 0.55
    keep[rng.integers(0, 8)] = True
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    for k in range(4):
        a, b = corners[k], corners[(k + 1) % 4]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        for j, (p0, p1) in enumerate(((a, mid), (mid, b))):
            if keep[k * 2 + j]:
                plates.append([sq(*p0), sq(*p1)])

    # 主裂纹：从坑的四个角斜着往外（穿过外框的角）、再从两三条边的中点直着往外；穿出外框之后有的折一下 45°，越往外越细、收成尖
    radials = []
    for k in range(4):
        h = rot + math.pi / 4 + k * math.pi / 2
        start = (math.cos(h) * hs * math.sqrt(2), math.sin(h) * hs * math.sqrt(2))
        total = rng.uniform(0.5, 0.75)
        if rng.random() < 0.5:
            radials.append(clamp_pts([start, (start[0] + math.cos(h) * total, start[1] + math.sin(h) * total)]))
        else:
            first = rng.uniform(0.45, 0.6) * total
            p1 = (start[0] + math.cos(h) * first, start[1] + math.sin(h) * first)
            h2 = h + rng.choice([-1, 1]) * math.pi / 4
            rest = total - first
            radials.append(clamp_pts([start, p1, (p1[0] + math.cos(h2) * rest, p1[1] + math.sin(h2) * rest)]))
    for k in rng.choice(4, size=int(rng.integers(2, 4)), replace=False):
        h = rot + k * math.pi / 2
        start = (math.cos(h) * hs, math.sin(h) * hs)
        # 一半只裂到外框，一半穿出去
        total = (hs2 - hs) * 1.02 if rng.random() < 0.5 else rng.uniform(0.5, 0.7)
        radials.append(clamp_pts([start, (start[0] + math.cos(h) * total, start[1] + math.sin(h) * total)]))
    lines = [(p, rng.uniform(0.034, 0.042), 0.004, False) for p in radials]
    lines += [(p, 0.018, 0.016, True) for p in plates]
    for pts, w0, w1, both in lines:
        d, w = polyline_fields(px, py, pts, w0, w1, both)
        core = 1 - smoothstep(w - aa, w + aa, d)
        glow = np.maximum(glow, core)
        # 白热：中线（半宽的 40%），越靠近坑越热
        hot = np.maximum(hot, (1 - smoothstep(w * 0.4 - aa * 0.5, w * 0.4 + aa, d)) * (1 - smoothstep(0.2, 0.7, r)))
        # 暗边：两侧一圈紫褐焦边（半宽 2.4 倍 + 一点，外缘稍软）
        dark = np.maximum(dark, 1 - smoothstep(w * 2.4 + 0.006, w * 2.4 + 0.006 + aa * 3, d))
    # 整块往外淡：外圈 0.9 以外收掉
    edge = 1 - smoothstep(0.88, 0.98, r)
    return dark * edge, glow * edge, hot * edge, np.clip(r, 0, 1)


def build():
    rng = np.random.default_rng(SEED)
    size = CELL * GRID
    img = np.zeros((size, size, 4), np.float32)
    for gy in range(GRID):
        for gx in range(GRID):
            R, G, B, A = cell(rng)
            img[gy * CELL:(gy + 1) * CELL, gx * CELL:(gx + 1) * CELL] = np.stack([R, G, B, A], 2)
    return img


def preview(img, out_dir):
    """上色预览：同着色器的配色（暗边紫褐、裂光铜橙、白热），亮沙 / 熔岩两种底各一张"""
    dark = np.array([0.23, 0.13, 0.17])
    copper = np.array([1.0, 0.54, 0.18])
    hotc = np.array([1.0, 0.9, 0.65])
    for name, ground in (("sand", np.array([0.86, 0.74, 0.55])), ("lava", np.array([0.2, 0.13, 0.16]))):
        R, G, B = img[..., 0], img[..., 1], img[..., 2]
        a = R * 0.88
        rgb = ground * (1 - a[..., None]) + dark * a[..., None]
        rgb = rgb + copper * G[..., None] * 0.9 + hotc * B[..., None] * 0.6
        Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(os.path.join(out_dir, f"crack_ch3_{name}.png"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    img = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT, optimize=True)
    print(f"写入 {os.path.relpath(OUT, ROOT)}（{img.shape[1]} × {img.shape[0]}，{GRID} × {GRID} 变体）")
    if a.preview:
        preview(img, a.out)


if __name__ == "__main__":
    main()
