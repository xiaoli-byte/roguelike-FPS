"""第四章三张概念图的路线 / 遭遇标注：每张图一张俯视规划图（世界坐标）+ 一张概念图叠标。

用法：python docs/art/concepts/ch4-631/tools/route_maps.py   （在仓库根目录）
数据就写在本文件里：4-2 / 4-4 的坐标抄自 src/world/gorge/spec.ts、src/world/haizi/spec.ts，
4-A 是新图，坐标是设计稿（docs/level-design/maps/4-A.md），搭图时以导航网格校正落点。
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent.parent
FONT_DIRS = [Path("C:/Windows/Fonts"), Path("H:/Windows/Fonts")]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for d in FONT_DIRS:
        for name in (["msyhbd.ttc"] if bold else []) + ["msyh.ttc", "simhei.ttf"]:
            if (d / name).exists():
                return ImageFont.truetype(str(d / name), size)
    return ImageFont.load_default()


# 标记：颜色 / 形状。点缀色只给玩法信息，和 composition.md「最高饱和留给功能」一致
STYLE = {
    "spawn": ((255, 255, 255), "circle"),   # 出生
    "site": ((255, 206, 64), "circle"),     # 据点（多波，守灵火坛）
    "lord": ((232, 64, 64), "circle"),      # 领主 / 首领
    "guard": ((255, 140, 40), "diamond"),   # 驻守点（路遇埋伏，开局就在场上）
    "entry": ((225, 70, 215), "triangle"),  # 怪物入场点（游荡怪群、增援只从这里进）
    "exit": ((70, 205, 110), "square"),     # 出口
    "poi": ((70, 200, 230), "square"),      # 补给 / 机关 / 导体
}
# （种类, 图例里画在标记上的字, 说明）
LEGEND = [("spawn", "S", "出生点"),
          ("site", "1", "据点：守灵火坛，一波接一波刷怪"),
          ("lord", "3", "领主 / 首领"),
          ("guard", "G", "驻守点：路上的伏兵，开局就在场上，走近整组醒"),
          ("entry", "E", "入场点：游荡怪群和增援从这里进场"),
          ("exit", "出", "出口"),
          ("poi", "", "机关 / 导体 / 掩体")]


def marker(d: ImageDraw.ImageDraw, xy, kind: str, text: str = "", r: int = 17, label: str = "", lf=None, anchor: str = "r"):
    col, shape = STYLE[kind]
    x, y = xy
    ol = (20, 20, 24)
    if shape == "circle":
        d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=ol, width=3)
    elif shape == "square":
        d.rectangle([x - r + 2, y - r + 2, x + r - 2, y + r - 2], fill=col, outline=ol, width=3)
    elif shape == "diamond":
        d.polygon([(x, y - r - 2), (x + r + 2, y), (x, y + r + 2), (x - r - 2, y)], fill=col, outline=ol)
        d.line([(x, y - r - 2), (x + r + 2, y), (x, y + r + 2), (x - r - 2, y), (x, y - r - 2)], fill=ol, width=3)
    else:
        pts = [(x, y - r - 3), (x + r + 2, y + r - 2), (x - r - 2, y + r - 2)]
        d.polygon(pts, fill=col)
        d.line(pts + [pts[0]], fill=ol, width=3)
    if text:
        f = font(int(r * 1.15), True)
        d.text((x, y + (2 if shape == "triangle" else -1)), text, font=f, fill=ol, anchor="mm")
    if label:
        f = lf or font(int(r * 1.05), True)
        if anchor == "r":
            pos, a = (x + r + 7, y), "lm"
        elif anchor == "l":
            pos, a = (x - r - 7, y), "rm"
        elif anchor == "t":
            pos, a = (x, y - r - 6), "mb"
        else:
            pos, a = (x, y + r + 6), "mt"
        d.text(pos, label, font=f, fill=(255, 255, 255), anchor=a, stroke_width=3, stroke_fill=(15, 15, 20))


def arrow_line(d: ImageDraw.ImageDraw, pts, col=(255, 255, 255), w: int = 6, dash: int = 0, head: bool = True, ol=(15, 15, 20)):
    """折线（可虚线）+ 末端箭头，带深色描边。"""
    def seg(a, b, colour, width):
        if not dash:
            d.line([a, b], fill=colour, width=width)
            return
        L = math.dist(a, b)
        n = max(1, int(L // (dash * 2)))
        for i in range(n + 1):
            t0, t1 = i * 2 * dash / L, min(1, (i * 2 * dash + dash) / L)
            if t0 >= 1:
                break
            d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=colour, width=width)
    for colour, width in ((ol, w + 4), (col, w)):
        for a, b in zip(pts, pts[1:]):
            seg(a, b, colour, width)
    if head and len(pts) > 1:
        (x0, y0), (x1, y1) = pts[-2], pts[-1]
        ang = math.atan2(y1 - y0, x1 - x0)
        s = w * 3.2
        tri = [(x1 + math.cos(ang) * s * 0.6, y1 + math.sin(ang) * s * 0.6),
               (x1 + math.cos(ang + 2.5) * s, y1 + math.sin(ang + 2.5) * s), (x1 + math.cos(ang - 2.5) * s, y1 + math.sin(ang - 2.5) * s)]
        d.polygon(tri, fill=col, outline=ol)


def legend_width(lines=(), scale: float = 1.0, routes=()) -> int:
    f, small = font(int(22 * scale), True), font(int(19 * scale))
    return int(max([430 * scale] + [small.getlength(t) + 30 * scale for t in lines] + [f.getlength(n) + 80 * scale for _, _, n in LEGEND] + [f.getlength(n) + 80 * scale for *_, n in routes]))


def legend(d: ImageDraw.ImageDraw, x: int, y: int, lines=(), scale: float = 1.0, routes=()):
    f = font(int(22 * scale), True)
    row = int(44 * scale)
    small = font(int(19 * scale))
    w = legend_width(lines, scale, routes)
    h = row * (len(LEGEND) + len(routes) + len(lines)) + int(24 * scale)
    d.rounded_rectangle([x, y, x + w, y + h], radius=12, fill=(18, 20, 26, 215), outline=(230, 230, 230), width=2)
    cy = y + int(30 * scale)
    for kind, letter, name in LEGEND:
        marker(d, (x + int(30 * scale), cy), kind, letter, r=int(16 * scale))
        d.text((x + int(58 * scale), cy), name, font=f, fill=(245, 245, 245), anchor="lm")
        cy += row
    for col, dash, name in routes:
        arrow_line(d, [(x + int(12 * scale), cy), (x + int(48 * scale), cy)], col=col, w=int(5 * scale), dash=dash, head=False)
        d.text((x + int(58 * scale), cy), name, font=f, fill=(245, 245, 245), anchor="lm")
        cy += row
    for t in lines:
        d.text((x + int(14 * scale), cy), t, font=small, fill=(215, 215, 215), anchor="lm")
        cy += row


def title(d: ImageDraw.ImageDraw, text: str, sub: str = "", x: int = 28, y: int = 22, scale: float = 1.0):
    d.text((x, y), text, font=font(int(40 * scale), True), fill=(255, 255, 255), stroke_width=4, stroke_fill=(15, 15, 20))
    if sub:
        d.text((x, y + int(54 * scale)), sub, font=font(int(23 * scale)), fill=(240, 240, 240), stroke_width=3, stroke_fill=(15, 15, 20))


WHITE, GOLD, CYAN, PURPLE = (255, 255, 255), (255, 214, 90), (110, 225, 240), (190, 110, 255)
ROUTES = [(WHITE, 0, "主路线（推荐走法）"), (GOLD, 14, "支线 / 另一种走法"), (PURPLE, 10, "精英游猎 / 冲撞线")]

# ───────────────────────────── 概念图叠标 ─────────────────────────────
# 坐标按 1280×720 的预览量，画的时候乘到原图

OVERLAYS = {
    "4-2_gorge": dict(
        src="4-2_gorge_scene_v2.jpg", title="4-2 大渡河 · 铁索桥峡谷", sub="概念机位：西岸坡肩，朝上游（北偏东）· 五处灵火点亮三处开出口",
        legend_at=(1052, 478),
        routes=[
            (WHITE, 0, [(150, 600), (330, 560), (470, 520), (575, 498), (700, 512), (830, 528), (960, 505), (1075, 472), (1120, 420), (1150, 300), (1215, 255), (1262, 205)]),
            (GOLD, 14, [(330, 560), (430, 455), (400, 395), (330, 350), (250, 300)]),
            (GOLD, 14, [(575, 498), (620, 560), (660, 640), (700, 706)]),
            (GOLD, 14, [(250, 300), (420, 255), (600, 250), (735, 262)]),
            (PURPLE, 10, [(60, 420), (200, 360), (330, 420), (500, 470), (540, 560)]),
        ],
        marks=[
            ("spawn", (150, 600), "S", "出生 · 西岸坡顶", "t"),
            ("site", (250, 300), "1", "① 甲居寨坡 2 波", "t"),
            ("site", (575, 498), "2", "② 铁索桥 2 波", "b"),
            ("lord", (782, 300), "3", "③ 江嘴 · 领主大鹗", "r"),
            ("site", (1238, 150), "4", "④ 绝壁驿站 2 波 ↗", "l"),
            ("site", (760, 690), "5", "⑤ 河滩磨坊 2 波 ↓", "r"),
            ("exit", (1240, 60), "出", "⑦ 古驿道 ↗", "l"),
            ("guard", (1160, 330), "G", "栈道岩龛：帝江", "l"),
            ("guard", (432, 430), "G", "回头弯：啸獭小窝", "l"),
            ("entry", (70, 215), "E", "寨后林线 · 跃下", "r"),
            ("entry", (720, 440), "E", "江嘴尖卵石滩 · 飞临", "l"),
            ("entry", (905, 165), "E", "江嘴北脊 · 跃下", "r"),
            ("entry", (1075, 655), "E", "东岸水边 · 上岸", "l"),
            ("entry", (40, 470), "E", "岩洞 · 穷奇巢", "r"),
            ("poi", (1090, 440), "", "东桥头雷桩", "b"),
            ("poi", (600, 452), "", "西桥头雷桩", "t"),
        ],
    ),
    "4-4_haizi": dict(
        src="4-4_haizi_scene_v3.jpg", title="4-4 神山海子 · 雷泽雷神", sub="概念机位 = 出生点（南岸偏西，面朝湖心岛）· 环岸两个方向 + 六段拱身上岛",
        legend_at=(1048, 14),
        routes=[
            (WHITE, 0, [(600, 690), (420, 655), (230, 560), (120, 450), (140, 372)]),
            (WHITE, 0, [(700, 690), (900, 655), (1090, 565), (1190, 450), (1200, 372)]),
            (GOLD, 14, [(640, 640), (648, 520), (655, 420)]),
        ],
        ellipses=[((660, 438), 300, 62, CYAN)],
        marks=[
            ("spawn", (650, 690), "S", "出生 · 南岸", "t"),
            ("lord", (660, 345), "首", "雷泽雷神升起处（湖心岛北）", "t"),
            ("exit", (662, 392), "坛", "", "r"),
            ("poi", (150, 322), "", "西柱", "t"),
            ("poi", (1198, 322), "", "东柱", "t"),
            ("poi", (943, 352), "", "北柱", "t"),
            ("poi", (1215, 610), "", "巨石（全掩体）", "l"),
            ("poi", (215, 640), "", "玛尼堆（挡雷息）", "r"),
            ("entry", (790, 300), "E", "北垭口 · 现身", "r"),
            ("entry", (330, 300), "E", "冰舌脚 · 跃下", "r"),
            ("entry", (1090, 255), "E", "东坡 · 跃下", "l"),
            ("entry", (420, 395), "E", "西北岸 · 飞临", "t"),
            ("entry", (1120, 520), "E", "东岸 · 飞临", "l"),
        ],
        notes=[((330, 522), "青色虚线：龙身盘踞圈（半径 28 m），六段轮流拱起 = 上岛的路")],
    ),
    "4-A_fortress": dict(
        src="4-A_fortress_scene_v4.jpg", title="4-A 雪域宫堡（第四章备选图）", sub="概念机位 = 出生点（西南草甸）· 上宫堡三条路 · 五处灵火点亮三处，顶殿后山口开门",
        legend_at=(395, 88),
        routes=[
            (WHITE, 0, [(170, 660), (380, 640), (600, 612), (760, 588), (875, 560), (985, 505), (945, 468), (975, 440), (905, 395), (795, 352), (880, 330), (975, 285), (880, 222), (800, 205), (880, 160), (905, 95)]),
            (GOLD, 14, [(380, 640), (330, 560), (300, 490)]),
            (GOLD, 14, [(300, 490), (470, 470), (600, 440), (690, 380), (735, 300)]),
            (GOLD, 14, [(985, 505), (1120, 520), (1262, 470)]),
            (GOLD, 14, [(300, 490), (200, 380), (120, 250)]),
            (PURPLE, 10, [(120, 250), (240, 420), (430, 560), (700, 600)]),
        ],
        marks=[
            ("spawn", (170, 660), "S", "出生 · 草甸玛尼堆", "t"),
            ("site", (300, 490), "1", "① 河畔村寨 2 波", "b"),
            ("site", (1080, 452), "2", "② 山门下院 3 波", "b"),
            ("site", (1035, 318), "3", "③ 坡道中台 2 波", "r"),
            ("site", (1250, 420), "4", "④ 煨桑台 2 波 →", "l"),
            ("site", (105, 205), "5", "⑤ 残碉 · 穷奇巢", "t"),
            ("lord", (905, 95), "6", "⑥ 顶殿前庭 3 波", "l"),
            ("exit", (1010, 55), "出", "后山口经幡门", "r"),
            ("guard", (850, 588), "G", "石桥：蛮蛮 + 帝江", "b"),
            ("guard", (735, 300), "G", "西坡缺口：举父", "b"),
            ("guard", (610, 470), "G", "上游冰滩：雷牦", "t"),
            ("entry", (30, 580), "E", "西口山道 · 牦群", "r"),
            ("entry", (215, 395), "E", "村北林线", "r"),
            ("entry", (450, 580), "E", "啸獭洞", "r"),
            ("entry", (560, 340), "E", "溪上游 · 飞临", "b"),
            ("entry", (975, 418), "E", "山门 · 增援门", "t"),
            ("entry", (790, 240), "E", "西墙头 · 跃下", "l"),
            ("entry", (1150, 100), "E", "后山口", "r"),
        ],
    ),
}


def draw_overlay(key: str):
    o = OVERLAYS[key]
    im = Image.open(HERE / o["src"]).convert("RGB")
    k = im.width / 1280
    # 整体压暗一点，标记才跳得出来
    im = Image.blend(im, Image.new("RGB", im.size, (10, 12, 18)), 0.22)
    d = ImageDraw.Draw(im, "RGBA")
    S = lambda p: (p[0] * k, p[1] * k)
    for (c, rx, ry, col) in o.get("ellipses", []):
        cx, cy = S(c)
        n = 72
        for i in range(n):
            if i % 12 in (5, 6, 7, 8, 9, 10, 11) and False:
                continue
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 0.55) / n
            d.line([(cx + math.cos(a0) * rx * k, cy + math.sin(a0) * ry * k), (cx + math.cos(a1) * rx * k, cy + math.sin(a1) * ry * k)], fill=col, width=int(4 * k))
    for col, dash, pts in o["routes"]:
        arrow_line(d, [S(p) for p in pts], col=col, w=int(5 * k), dash=int(dash * k))
    lf = font(int(17 * k), True)
    for kind, xy, text, label, anchor in o["marks"]:
        marker(d, S(xy), kind, text, r=int(13 * k), label=label, lf=lf, anchor=anchor)
    for xy, text in o.get("notes", []):
        d.text(S(xy), text, font=font(int(16 * k)), fill=(200, 245, 250), anchor="lm", stroke_width=3, stroke_fill=(15, 15, 20))
    title(d, o["title"], o["sub"], x=int(22 * k), y=int(14 * k), scale=k * 0.72)
    lx, ly = o["legend_at"]
    legend(d, int(lx * k), int(ly * k), scale=k * 0.5, routes=ROUTES)
    out = HERE / f"{key}_route_overlay.jpg"
    im.save(out, quality=88)
    print("saved", out.name)


# ───────────────────────────── 俯视规划图 ─────────────────────────────

class Plan:
    def __init__(self, bounds, ppm: float, name: str, sub: str, pad=(60, 120, 760, 60)):
        self.minx, self.maxx, self.minz, self.maxz = bounds
        self.ppm = ppm
        self.l, self.t, r, b = pad
        w = int((self.maxx - self.minx) * ppm) + self.l + r
        h = int((self.maxz - self.minz) * ppm) + self.t + b
        self.im = Image.new("RGB", (w, h), (226, 219, 201))
        self.d = ImageDraw.Draw(self.im, "RGBA")
        self.name, self.sub = name, sub

    def P(self, p):
        return (self.l + (p[0] - self.minx) * self.ppm, self.t + (p[1] - self.minz) * self.ppm)

    def poly(self, pts, fill, outline=None, width=2):
        q = [self.P(p) for p in pts]
        self.d.polygon(q, fill=fill)
        if outline:
            self.d.line(q + [q[0]], fill=outline, width=width)

    def line(self, pts, fill, width, joint="curve"):
        self.d.line([self.P(p) for p in pts], fill=fill, width=max(1, int(width)), joint=joint)

    def circle(self, c, r, fill=None, outline=None, width=2):
        x, y = self.P(c)
        rr = r * self.ppm
        self.d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=fill, outline=outline, width=width)

    def text(self, p, s, size=20, fill=(40, 36, 30), anchor="mm", bold=False, stroke=(226, 219, 201)):
        self.d.text(self.P(p), s, font=font(size, bold), fill=fill, anchor=anchor, stroke_width=3, stroke_fill=stroke)

    def route(self, pts, col=WHITE, w=6, dash=0, head=True):
        arrow_line(self.d, [self.P(p) for p in pts], col=col, w=w, dash=dash, head=head)

    def mark(self, kind, p, text="", label="", anchor="r", r=17):
        marker(self.d, self.P(p), kind, text, r=r, label=label, lf=font(19, True), anchor=anchor)

    def finish(self, key: str, lines=()):
        title(self.d, self.name, self.sub)
        x = self.im.width - 30 - legend_width(lines, routes=ROUTES)
        legend(self.d, x, 130, lines=lines, routes=ROUTES)
        # 指北 + 比例尺
        nx, ny = self.im.width - 90, self.im.height - 150
        arrow_line(self.d, [(nx, ny + 60), (nx, ny)], col=(40, 36, 30), w=5, ol=(226, 219, 201))
        self.d.text((nx, ny - 26), "北", font=font(24, True), fill=(40, 36, 30), anchor="mm")
        sx = self.im.width - 150 - int(50 * self.ppm)
        self.d.line([(sx, ny + 60), (sx + 50 * self.ppm, ny + 60)], fill=(40, 36, 30), width=5)
        self.d.text((sx + 25 * self.ppm, ny + 84), "50 m", font=font(20), fill=(40, 36, 30), anchor="mm")
        out = HERE / f"{key}_route_plan.jpg"
        self.im.save(out, quality=88)
        print("saved", out.name)


WATER, WATER_D = (120, 178, 196), (86, 140, 160)
TRAIL = (140, 110, 78)


def plan_gorge():
    p = Plan((-300, 300, -270, 270), 2.3, "4-2 大渡河 · 铁索桥峡谷 · 路线与遭遇", "坐标 = src/world/gorge/spec.ts；三块岸地 × 四层，五处灵火点亮三处开古驿道")
    C = (-8, -18)
    dj = [(-300, -215), (-245, -188), (-195, -158), (-150, -126), (-108, -94), (-70, -64), (-40, -40), C]
    xj = [(300, -205), (248, -182), (198, -156), (150, -128), (106, -98), (66, -67), (32, -40), C]
    dd = [C, (-12, 12), (-8, 42), (2, 75), (6, 110), (-2, 150), (-4, 185), (8, 220), (24, 250), (34, 270)]
    # 岸地底色（西岸缓坡、江嘴台地、东岸绝壁）
    p.poly([(-300, -215)] + dj[1:] + dd[1:] + [(34, 270), (-300, 270)], (214, 205, 176))
    p.poly(dj + list(reversed(xj)) + [(300, -270), (-300, -270)], (205, 196, 178))
    p.poly(xj + dd[1:] + [(300, 270), (300, -205)], (196, 188, 178))
    # 梯田、绝壁带
    for i, off in enumerate((0, 14, 28)):
        p.line([(-165 + off, -40), (-140 + off, -16), (-120 + off, 10)], (150, 170, 110), 9)
    p.line([(44, 43), (30, 20), (26, 0), (40, -30), (66, -46), (90, -44)], (120, 112, 108), 16)   # 东岸绝壁（栈道 A 挂在上面）
    for pts, half in ((dj, 8), (xj, 8), (dd, 11)):
        p.line(pts, WATER_D, half * 2 * p.ppm + 6)
        p.line(pts, WATER, half * 2 * p.ppm)
    p.line([(-30, 172), (-2, 196), (30, 212)], (165, 205, 212), 54 * p.ppm * 0.5)   # 河滩涉水（变宽变浅）
    # 骡道
    trails = [
        [(-180, 120), (-176, 100), (-166, 66), (-154, 30), (-140, 8)], [(-112, -2), (-90, 18), (-72, 40), (-58, 62), (-48, 76)],
        [(-46, 86), (-48, 112), (-58, 132), (-62, 146), (-52, 158), (-46, 170)], [(-130, -28), (-140, -40), (-150, -52)],
        [(-180, -114), (-176, -96), (-168, -76), (-158, -60), (-150, -52)], [(-230, -157), (-222, -140), (-206, -128), (-180, -114)],
        [(22, 176), (40, 160), (50, 146), (42, 128), (38, 100), (40, 60)],
        [(44, 60), (50, 88), (57, 108), (61, 115), (66, 110), (71, 94), (71, 74), (77, 52), (84, 24), (92, -6)],
        [(104, -14), (150, -30), (176, -18), (162, 0), (190, 8), (206, 2)], [(100, -36), (128, -66), (156, -86), (172, -98), (189, -112)],
        [(-82, -101), (-70, -112), (-62, -130), (-56, -137)], [(-20, -126), (-56, -136), (-96, -146)],
        [(14, -132), (60, -146), (104, -156), (136, -166), (152, -176)], [(-96, -146), (-140, -168), (-176, -184), (-200, -192), (-210, -190)],
        [(-4, -112), (16, -104), (-12, -94), (14, -84), (-12, -72), (-3, -63)],
    ]
    for t in trails:
        p.line(t, TRAIL, 4)
    p.line([(44, 43), (30, 20), (26, 0), (40, -30), (66, -46), (90, -44)], (96, 66, 40), 4)       # 栈道 A
    p.line([(-1, -57), (10, -52), (6, -45)], (96, 66, 40), 4)                                      # 栈道 B
    # 过河
    for a, b, name, at in (((-40, 74), (36, 51), "铁索桥", (-2, 50)), ((156, -170), (186, -118), "藤索吊桥", (206, -150)), ((-227, -162), (-213, -185), "伸臂木桥", (-250, -150))):
        p.line([a, b], (50, 46, 44), 7)
        p.text(at, name, 18, bold=True)
    for a, b in (((-150, -52), (-82, -101)), ((-96, -146), (-180, -114))):
        arrow_line(p.d, [p.P(a), p.P(b)], col=(70, 70, 76), w=3, dash=8, ol=(226, 219, 201))
    p.text((-118, -88), "溜索甲", 16)
    p.text((-146, -138), "溜索乙", 16)
    for i in range(9):
        t = i / 8
        p.circle((20 + (8 - 20) * t, -19 + (-41 + 19) * t), 1.6, fill=(110, 104, 98))
    p.text((48, -22), "跳石", 16)
    p.text((40, 212), "涉水", 16)
    p.text((-205, -230), "大金川", 20, fill=WATER_D, bold=True)
    p.text((215, -232), "小金川", 20, fill=WATER_D, bold=True)
    p.text((40, 250), "大渡河", 20, fill=WATER_D, bold=True)
    p.text((-240, 190), "西岸（缓坡）", 22, fill=(120, 100, 70), bold=True)
    p.text((20, -235), "江嘴（楔形台地）", 22, fill=(120, 100, 70), bold=True)
    p.text((235, 120), "东岸\n（绝壁）", 22, fill=(120, 100, 70), bold=True)
    # 据点范围
    for (x, z, r) in ((-126, -14, 46), (-2, 62, 50), (0, -100, 56), (92, -20, 40), (-12, 192, 50)):
        p.circle((x, z), r, outline=(255, 206, 64, 190), width=3)
    # 路线：推荐（最短三处灵火）+ 另一种走法 + 游猎
    p.route([(-180, 120), (-166, 66), (-140, 8), (-122, -4)], WHITE)
    p.route([(-122, -4), (-90, 18), (-58, 62), (-52, 84)], WHITE)
    p.route([(-52, 84), (-40, 74), (36, 51), (44, 60), (57, 108), (71, 94), (77, 52), (92, -6)], WHITE)
    p.route([(94, -10), (150, -30), (176, -18), (162, 0), (190, 8), (206, 2)], WHITE)
    p.route([(-52, 84), (-48, 112), (-58, 132), (-46, 170), (-52, 194)], GOLD, dash=10)
    p.route([(-130, -28), (-150, -52), (-82, -101), (-56, -137), (-20, -126), (12, -114)], GOLD, dash=10)
    p.route([(12, -114), (60, -146), (152, -176), (186, -118), (172, -98), (100, -36)], GOLD, dash=10)
    p.route([(-170, 60), (-150, 20), (-110, -40), (-80, 20), (-58, 90), (-56, 130), (-46, 170), (-90, 150), (-140, 120), (-170, 60)], PURPLE, w=4, dash=7, head=False)
    # 标记
    p.mark("spawn", (-180, 120), "S", "出生 · 西岸坡顶 +78", "b")
    p.mark("site", (-122, -4), "1", "① 甲居寨坡 2 波 · 12 只", "l")
    p.mark("site", (-52, 84), "2", "② 铁索桥 2 波 · 12 只", "l")
    p.mark("lord", (12, -114), "3", "③ 江嘴 · 守卫 10 只 → 大鹗", "r")
    p.mark("site", (94, -10), "4", "④ 绝壁驿站 2 波 · 10 只", "r")
    p.mark("site", (-52, 194), "5", "⑤ 河滩磨坊 2 波 · 17 只", "l")
    p.mark("exit", (206, 2), "出", "⑦ 古驿道 · 守卫 6 只", "b")
    for xy, lab, a in (((186, -118), "G1 吊桥东头 帝江×2", "t"), ((-230, -157), "G2 伸臂桥西头 天狗×2", "r"), ((28.6, -13.3), "G3 栈道岩龛", "b"), ((-60, 138), "G4 回头弯 啸獭×4", "l")):
        p.mark("guard", xy, "G", lab, a, r=14)
    for xy, lab, a in (((-236, 52), "E1 岩洞（穷奇巢）", "b"), ((-178, -40), "E2 寨后林线·跃下", "l"), ((-240, -205), "E3 伸臂桥北头山道", "b"), ((10, -196), "E4 江嘴北脊·跃下", "b"),
                       ((214, -112), "E5 吊桥东山道", "b"), ((218, 2), "E6 古驿道外·牦群", "r"), ((-4, -30), "E7 江嘴尖·飞临", "l"), ((40, 190), "E8 东岸水边·上岸", "r")):
        p.mark("entry", xy, "E", lab, a, r=13)
    for xy, lab in (((-44, 78), ""), ((40, 54), "雷桩")):
        p.mark("poi", xy, "", lab, "t", r=9)
    p.finish("4-2_gorge", lines=("推荐：出生→①→②→过桥→④→出口（约 12 分钟）", "反走：自古驿道入，④ 开场编制、① 终局编制", "紫线：穷奇只在西岸游猎；大鹗擂台 = 汇口上空 90 m"))


def plan_haizi():
    p = Plan((-112, 112, -112, 104), 5.6, "4-4 神山海子 · 雷泽雷神 · 擂台与入场点", "坐标 = src/world/haizi/spec.ts；湖面半径 46 m，湖岸 52–75 m 可走，外面是雪坡（风雪软边界）")
    p.im.paste((236, 240, 244), [0, 0, p.im.width, p.im.height])
    p.circle((0, 0), 104, fill=(222, 228, 234))
    p.circle((0, 0), 78, fill=(206, 208, 206), outline=(150, 150, 150), width=2)     # 可玩区 / 软边界
    p.circle((0, 0), 75, fill=(176, 174, 168))                                         # 碎石湖岸
    p.circle((0, 0), 52, fill=(158, 206, 204))                                         # 浅水
    p.circle((0, 0), 46, fill=(122, 184, 190))                                         # 深水
    p.circle((0, 0), 9, fill=(150, 146, 140), outline=(70, 70, 70), width=2)           # 湖心岛
    # 冰舌（西北）与神山方向
    p.poly([(-104, -36), (-70, -58), (-52, -44), (-60, -20), (-96, -6)], (200, 224, 240), (130, 170, 200))
    p.text((-88, -34), "冰舌", 20, fill=(70, 110, 150), bold=True, stroke=(200, 224, 240))
    ang = math.atan2(360, 1390)
    arrow_line(p.d, [p.P((math.sin(ang) * 82, -math.cos(ang) * 82)), p.P((math.sin(ang) * 108, -math.cos(ang) * 108))], col=(200, 150, 40), w=5, ol=(236, 240, 244))
    p.text((math.sin(ang) * 96 + 20, -math.cos(ang) * 96), "神山\n（冰碛垭口）", 18, fill=(150, 105, 20), bold=True, stroke=(236, 240, 244))
    # 龙身盘踞圈：六段
    for i in range(6):
        a0 = math.radians(i * 60 + 8)
        pts = [(math.sin(a0 + math.radians(t)) * 28, -math.cos(a0 + math.radians(t)) * 28) for t in range(0, 45, 5)]
        p.line(pts, (60, 140, 160), 12)
        mid = pts[len(pts) // 2]
        p.text((mid[0] * 1.3, mid[1] * 1.3), f"段{i + 1}", 15, fill=(30, 80, 96), stroke=(122, 184, 190))
    p.circle((0, -16), 5, outline=(232, 64, 64), width=4)
    # 掩体
    for x, z, s in ((52, -34, 1.1), (-58, 30, 1.0), (36, -50, 1.25), (-42, -46, 1.05)):
        p.circle((x, z), 2.2 * s, fill=(120, 116, 110), outline=(60, 60, 60))
    for x, z, s in ((54, 32, 2.2), (-64, -22, 1.8), (22, 62, 1.6), (-27, 57, 1.4)):
        p.circle((x, z), 1.6 * s, fill=(98, 96, 94), outline=(50, 50, 50))
    # 环岸两个方向 + 上岛
    def arc(a0, a1, r=63, n=24):
        return [(math.sin(math.radians(a0 + (a1 - a0) * i / n)) * r, -math.cos(math.radians(a0 + (a1 - a0) * i / n)) * r) for i in range(n + 1)]
    p.route(arc(195, 330), WHITE)
    p.route(arc(165, 30), WHITE)
    p.route([(-18, 67), (-14, 50), (-22, 30), (-12, 14), (-4, 7)], GOLD, dash=9)
    p.mark("spawn", (-18, 67.6), "S", "出生 · 南岸偏西", "b")
    p.mark("lord", (0, -16), "首", "雷神升起处", "t")
    p.mark("exit", (0, 0), "坛", "终局灵火坛", "b", r=13)
    for (x, z, n) in ((0, -60, "北柱"), (60, 0, "东柱"), (0, 60, "南柱"), (-60, 0, "西柱")):
        p.mark("poi", (x, z), "", n + "（导雷）", "r" if x >= 0 else "l", r=11)
    for xy, lab, a in (((14, -77), "E1 北垭口 · 现身（帝江）", "r"), ((-66, -40), "E2 冰舌脚 · 跃下（天狗）", "l"), ((76, -14), "E3 东坡 · 跃下（天狗）", "r"),
                       ((-56, 52), "E4 西南雪坡 · 现身", "l"), ((-48, -32), "E5 西北岸 · 飞临", "l"), ((50, 24), "E6 东岸 · 飞临", "r")):
        p.mark("entry", xy, "E", lab, a, r=13)
    p.text((52, -27), "玛尼堆", 15)
    p.text((54, 40), "巨石", 15)
    p.finish("4-4_haizi", lines=("白线：环岸两个方向；金线：踩拱身上岛", "灰圈 = 玛尼堆 / 巨石（挡雷息的全掩体）", "转阶段召唤只从 E1–E6 进，同屏 ≤ 8，雷神倒下即崩解"))


def plan_fortress():
    p = Plan((-230, 230, -200, 200), 3.0, "4-A 雪域宫堡 · 路线与遭遇（设计稿）", "新备选图：河谷草甸 + 山嘴宫堡；上宫堡三条路；五处灵火点亮三处，顶殿后山口开门", pad=(60, 120, 900, 60))
    p.im.paste((232, 234, 232), [0, 0, p.im.width, p.im.height])
    # 草甸
    p.poly([(-230, -120), (-150, -150), (-40, -120), (20, -40), (10, 60), (-10, 200), (-230, 200)], (224, 218, 196))
    # 山嘴（等高带，越高越深）
    spur = [(30, 110), (60, 150), (150, 150), (215, 90), (225, -40), (190, -130), (110, -140), (50, -90), (28, -10)]
    p.poly(spur, (196, 192, 188), (150, 146, 142))
    p.poly([(52, 80), (90, 108), (160, 100), (196, 50), (200, -40), (168, -108), (112, -112), (70, -70), (52, 0)], (180, 176, 174))
    p.poly([(80, 40), (120, 60), (165, 30), (172, -40), (150, -86), (112, -84), (88, -40)], (164, 160, 160))
    p.poly([(104, -6), (140, 6), (156, -30), (146, -62), (118, -60), (104, -36)], (150, 146, 148))
    # 残碉山脊
    p.poly([(-120, -196), (-30, -196), (-10, -160), (-50, -130), (-110, -140)], (196, 192, 188), (150, 146, 142))
    # 溪（自北向南，石桥在 (-20, 95)）
    stream = [(26, -200), (16, -120), (6, -60), (0, 0), (-8, 50), (-20, 95), (-30, 140), (-22, 200)]
    p.line(stream, WATER_D, 34)
    p.line(stream, WATER, 28)
    p.line([(2, -40), (6, -10)], (190, 220, 228), 40)       # 上游冰滩
    p.text((36, -150), "冰溪", 20, fill=WATER_D, bold=True, stroke=(232, 234, 232))
    # 路
    road = [(-150, 130), (-110, 128), (-70, 110), (-40, 112), (-20, 95), (6, 86), (30, 82), (45, 75)]
    p.line(road, TRAIL, 9)
    kora = [(45, 75), (70, 122), (140, 128), (190, 80), (190, 22), (196, -40), (170, -70), (150, -52), (126, -36)]
    p.line(kora, TRAIL, 5)
    scree = [(4, -22), (36, -30), (62, -22), (85, -10)]
    p.line(scree, (150, 130, 110), 4)
    p.line([(-150, 130), (-200, 90), (-222, 60)], TRAIL, 6)
    p.line([(-75, 0), (-90, -60), (-70, -120), (-60, -165)], TRAIL, 4)
    p.line([(-110, 128), (-90, 60), (-75, 0)], TRAIL, 5)
    # 宫堡：墙块（白墙 + 赭红顶带）
    def block(x, z, w, h, red=False):
        p.poly([(x - w / 2, z - h / 2), (x + w / 2, z - h / 2), (x + w / 2, z + h / 2), (x - w / 2, z + h / 2)], (150, 40, 40) if red else (250, 246, 236), (150, 60, 44), 3)
    for b in ((45, 75, 10, 8), (64, 84, 24, 10), (86, 62, 10, 24), (62, 44, 24, 10)):   # 山门 + 下院围墙
        block(*b)
    for b in ((92, 26, 24, 10), (116, 10, 12, 10), (100, -4, 12, 10), (128, -8, 24, 10)):   # 中台
        block(*b)
    for b in ((112, -40, 12, 10), (146, -30, 12, 10)):                                     # 上层角楼
        block(*b)
    block(128, -52, 18, 14, red=True)
    p.circle((128, -52), 3, fill=(240, 200, 60), outline=(120, 90, 20))
    # 之字坡道
    ramp = [(58, 62), (80, 50), (60, 38), (84, 26), (104, 30), (122, 18), (106, 4), (126, -14), (112, -24), (126, -36)]
    p.line(ramp, (236, 226, 206), 9)
    p.line(ramp, (150, 60, 44), 2)
    # 村寨、柴垛、玛尼墙
    for x, z in ((-90, -8), (-70, 10), (-62, -14)):
        block(x, z, 9, 9)
    p.line([(-104, 22), (-60, 30)], (120, 116, 110), 5)
    p.line([(-40, 100), (-10, 104)], (120, 116, 110), 4)
    # 残碉、煨桑台、风马旗台
    block(-60, -168, 8, 8)
    p.circle((186, 22), 5, fill=(250, 246, 236), outline=(150, 60, 44), width=3)
    # 据点范围
    for (x, z, r) in ((-75, 0, 34), (62, 66, 26), (113, 24, 20), (190, 22, 18), (-60, -165, 26), (128, -30, 24)):
        p.circle((x, z), r, outline=(255, 206, 64, 190), width=3)
    # 路线
    p.route(road + [(58, 62)], WHITE)
    p.route([(58, 62)] + ramp[1:] + [(128, -30)], WHITE)
    p.route([(128, -30), (148, -60), (160, -95)], WHITE)
    p.route([(4, -22), (6, -90), (6, -150)], GOLD, dash=10, head=False)
    p.line([(160, -95), (170, -122)], TRAIL, 5)
    p.route([(-110, 128), (-90, 60), (-75, 0)], GOLD, dash=10)
    p.route([(-75, 0), (-30, -14), (4, -22), (36, -30), (62, -22), (85, -10), (104, 4), (113, 24)], GOLD, dash=10)
    p.route(kora, GOLD, dash=10)
    p.route([(-75, 0), (-90, -60), (-70, -120), (-60, -165)], GOLD, dash=10)
    p.route([(-60, -165), (-100, -80), (-120, 40), (-60, 110), (-20, 95), (-60, 60), (-110, -40), (-60, -165)], PURPLE, w=4, dash=7, head=False)
    p.route([(45, 75), (20, 84), (-20, 95)], PURPLE, w=5, dash=5)
    # 标记
    p.mark("spawn", (-150, 130), "S", "出生 · 草甸玛尼堆", "b")
    p.mark("site", (-75, 0), "1", "① 河畔村寨 2 波 · 14 只", "l")
    p.mark("site", (62, 66), "2", "② 山门下院 3 波 · 18 只", "r")
    p.mark("site", (113, 24), "3", "③ 坡道中台 2 波 · 13 只", "l")
    p.mark("site", (190, 22), "4", "④ 煨桑台 2 波 · 13 只", "b")
    p.mark("site", (-60, -165), "5", "⑤ 残碉 · 啸獭窝 + 穷奇巢", "r")
    p.mark("lord", (128, -30), "6", "⑥ 顶殿前庭 3 波 · 22 只", "t")
    p.mark("exit", (160, -95), "出", "后山口经幡门", "r")
    p.mark("exit", (-222, 60), "出", "西口（反走的出口）", "r", r=13)
    for xy, lab, a in (((-20, 95), "G1 石桥 蛮蛮一对 + 帝江×2", "b"), ((4, -26), "G2 上游冰滩 雷牦×2", "l"), ((85, -10), "G3 西坡缺口 举父×1", "r"), ((196, -40), "G4 转经道拐角 帝江×3", "r")):
        p.mark("guard", xy, "G", lab, a, r=14)
    for xy, lab, a in (((-200, 84), "E1 西口山道·牦群", "b"), ((-118, -70), "E2 村北林线", "l"), ((-110, 92), "E3 草甸啸獭洞", "l"), ((6, -150), "E4 溪谷上游·飞临", "l"),
                       ((45, 75), "E5 山门·增援门", "l"), ((74, -16), "E6 西墙头·跃下", "l"), ((194, -8), "E7 东坡崖顶·跃下", "r"), ((170, -118), "E8 后山口外", "r")):
        p.mark("entry", xy, "E", lab, a, r=13)
    p.text((-170, 170), "河谷草甸 +0–6", 20, fill=(120, 100, 70), bold=True, stroke=(224, 218, 196))
    p.text((150, 120), "山嘴", 20, fill=(90, 86, 84), bold=True, stroke=(196, 192, 188))
    p.text((70, 100), "下院 +6", 15, stroke=(196, 192, 188))
    p.text((132, 30), "中台 +26", 15, stroke=(164, 160, 160))
    p.text((142, -66), "顶殿 +48", 15, stroke=(150, 146, 148))
    p.text((-60, -186), "残碉 +34", 15, stroke=(196, 192, 188))
    p.finish("4-A_fortress", lines=("白线：正门坡道（主路）", "金线：西坡缺口（碎石坡，最陡 19°）/ 转经道（缓、长）/ 去残碉 / 溪谷上游", "紫虚线：穷奇游猎；紫短线：山门→石桥的踩踏线"))


if __name__ == "__main__":
    for k in OVERLAYS:
        draw_overlay(k)
    plan_gorge()
    plan_haizi()
    plan_fortress()
