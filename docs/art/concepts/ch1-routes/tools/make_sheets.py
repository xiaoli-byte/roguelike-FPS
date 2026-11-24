"""把 ChatGPT 出的路线概念图配上中文图例、据点和走法说明，拼成成品图；再出一张章节总览。

用法（仓库根目录）：python docs/art/concepts/ch1-routes/tools/make_sheets.py
输入 raw/<图>_<定稿版本>.png，输出 <图>_route_concept.jpg 和 ch1_route_overview.jpg。
图上的标记（S / 1–4 / E / 菱形 / 三角 / 方块 / 金线白线）是模型画的，中文说明是这里排的。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent.parent
FONT_DIRS = [Path("H:/Windows/Fonts"), Path("C:/Windows/Fonts")]
BG, INK, DIM, GOLD = (22, 21, 26), (238, 232, 220), (168, 160, 148), (245, 196, 60)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for d in FONT_DIRS:
        for name in (["msyhbd.ttc"] if bold else []) + ["msyh.ttc", "simhei.ttf"]:
            if (d / name).exists():
                return ImageFont.truetype(str(d / name), size)
    return ImageFont.load_default()


def wrap(d: ImageDraw.ImageDraw, text: str, f, width: int) -> list[str]:
    """中文按字折行（英文数字不拆词也无妨，说明里很少）"""
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        if d.textlength(cur + ch, font=f) > width and cur:
            # 行首不放标点
            if ch in "，。；：、）」":
                cur += ch
                lines.append(cur)
                cur = ""
                continue
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def para(d, xy, text, f, width, fill=INK, gap=6) -> int:
    x, y = xy
    h = f.size + gap
    for line in wrap(d, text, f, width):
        d.text((x, y), line, font=f, fill=fill)
        y += h
    return y


def symbol(d, x, y, kind, text=""):
    """图例里的小标记（和图上模型画的同色同形）"""
    ol = (20, 20, 24)
    r = 13
    if kind in ("S", "num", "E", "B"):
        col = {"S": (255, 255, 255), "num": (250, 208, 40), "E": (90, 220, 90), "B": (232, 50, 50)}[kind]
        d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=ol, width=3)
        f = font(17, True)
        w = d.textlength(text, font=f)
        d.text((x - w / 2, y - 12), text, font=f, fill=(255, 255, 255) if kind == "B" else ol)
    elif kind == "guard":
        d.polygon([(x, y - r), (x + r, y), (x, y + r), (x - r, y)], fill=(245, 130, 30), outline=ol)
    elif kind == "entry":
        d.polygon([(x, y - r), (x + r, y + r - 3), (x - r, y + r - 3)], fill=(225, 40, 200), outline=ol)
    elif kind == "cache":
        d.rectangle([x - r + 3, y - r + 3, x + r - 3, y + r - 3], fill=(40, 215, 235), outline=ol, width=2)
    elif kind in ("gold", "white"):
        col, wd = ((245, 196, 40), 6) if kind == "gold" else ((255, 255, 255), 3)
        for k in range(3):
            d.line([(x - 20 + k * 15, y), (x - 11 + k * 15, y)], fill=col, width=wd)
    elif kind == "swirl":
        d.arc([x - r, y - r, x + r, y + r], 30, 330, fill=(225, 40, 200), width=4)
        d.arc([x - 6, y - 6, x + 6, y + 6], 200, 120, fill=(225, 40, 200), width=3)
    elif kind == "perch":
        for dy in (-2, 6):
            d.line([(x - 9, y + dy), (x, y + dy - 8), (x + 9, y + dy)], fill=(250, 208, 40), width=4)


COMMON_LEGEND = [
    ("S", "S", "出生点"),
    ("num", "1", "据点（①–④）：必清，一波接一波刷怪"),
    ("E", "E", "出口：据点清完后升起"),
    ("gold", "", "金色粗虚线：主线（推荐走法，按顺序穿过四个据点）"),
    ("white", "", "白色细虚线：侧翼 / 备选走法"),
    ("guard", "", "橙菱形：驻守点——路上的伏兵，开局就在场，走近整组醒"),
    ("entry", "", "品红三角：怪物入场点——游荡怪群和增援只从这里进场"),
    ("cache", "", "青方块：藏宝点（可选，不影响出口）"),
]
BOSS_LEGEND = [
    ("S", "S", "出生点 · 观景台补给营（安全区）"),
    ("num", "1", "进场点：木栈道落到北岸"),
    ("B", "B", "首领 · 旱魃，自泉心升起"),
    ("E", "E", "胜利后的出口：月泉阁庭院"),
    ("gold", "", "金色环线：绕泉风筝路线（约 250 m）"),
    ("white", "", "白色岔路：进各处荫蔽的路"),
    ("swirl", "", "品红漩涡：沙魇召唤点"),
    ("entry", "", "品红三角：沙山脊上滑下来的增援"),
    ("perch", "", "双箭头：俯射位（两座新月丘顶、月泉阁二层）"),
]

MAPS = {
    "1-1": dict(
        src="raw/1-1_v3.png", title="1-1 古道穿越戈壁", motif="母题：开阔",
        mood="破晓后一小时，迎着朝阳向东赶路：长影朝玩家倒过来，烽燧狼烟逆光直上，东边天际压着将来的沙暴。",
        redo="重做要点：原来「古道 + 圆盘」的香肠形可玩区改成整片能走的戈壁盆地；边界全靠地形（北、东是沙丘，南是冲沟陡坎，西是两座石丘夹着驿站）。"
             "汉长城自北向南横贯，三处能过（主缺口 / 北豁口 / 南端绕河床）；干河床是下沉的侧翼路；烽燧放在全场最高处，从哪儿都看得见。",
        sites=[
            "S　出生 · 驿站残门：门框正好框住长城缺口和远处的狼烟",
            "①　黑戈壁砾石滩：入口战 6 只（跳鼠 ×4 + 蝎卫 ×2）；低宽卧石成簇，半身掩体",
            "②　雅丹石阵：2 波 8 只（蜃楼蟾 ×2、跳鼠 ×5、沙魇 ×1）；矮丘沙坡可上顶俯射，高丘顶有怪跃下",
            "③　烽燧台地：2 波 6 只（镇墓兽冲坡 + 邪飞天，台下援军）；6 m 夯土台、东西两条坡道。② ③ 先后不限",
            "④　驼队残骸营地：2 波 12 只含 2 精英；下沉沙洼，周期沙暴从东边压过来（要先清 ② ③）",
        ],
        routes=[
            "金线　驿站 → 长城缺口 → ① → ② → ③ → ④ → 出口，约 420 m",
            "白线 A　北线：沿长城到北豁口（戍卒窖藏）→ ②",
            "白线 B　南线：绕长城南端下河床 → 南戈壁孤岩（商队遗货，有守军）→ ④",
            "白线 C　古道线：① → 河床浅滩 → 烽燧台西坡道（先打 ③；逆行走法从出口祭坛进，也走它）",
        ],
        levels="竖向：河床 −1.5 m / 戈壁 0 / 雅丹顶 3.5–9 m / 烽燧台 +6 m / 沙丘脊 12–25 m",
    ),
    "1-2": dict(
        src="raw/1-2_v2.png", title="1-2 雅丹迷城", motif="母题：收紧",
        mood="起风的上午，太阳在前进方向右前方：扬沙贴着河道往前流、逆光发亮，岩墙一面暖橙一面冷紫，塔尖和岩拱是沙雾里的剪影。",
        redo="重做要点：三条平直河道改成分分合合的辫状河道；雅丹岛之间每 30–50 m 一个风口垭口——是迷宫不是走廊，每个场地至少三个进出方向。"
             "佛塔加高成全图的「指北针」；外圈崖壁比岛高、天际线留豁口；平时视线 20–40 m，只在屋脊之海和塔尖广场打开。",
        sites=[
            "S　出生 · 河口沙扇：狮身雅丹旁，三个河道口同时可见，远处塔尖一点金",
            "①　河口三叉：2 波 10 只（河口伏击 → 侧河道包抄）；河心洲 + 矮岩台",
            "②　屋脊之海：2 波 11 只（火浣鼠、沙魇 ×2、邪飞天 ×2）；沙盆里 3 处流沙，屋顶链是高路",
            "③　塔尖广场：2 波 10 只含精英镇墓兽；半埋佛塔 + 两级环台（俯射位）",
            "④　岩拱门：守门小队 7 只；穿过岩拱就是出口平台，望得见 1-3 的古城",
        ],
        routes=[
            "金线　沙扇 → ① → 北河道 → ② → 沙垭口 → ③ → ④ → 穿拱 → 出口，约 400 m",
            "白线 A　中河道：① 直插 ③（捷径）",
            "白线 B　南河道：经供养窟（灵兽封印，有守军）→ ④",
            "高路　两处矮鲸背岩丘的背风沙坡 + ② 的屋顶链 + ③ 的环台",
        ],
        levels="竖向：流沙盆 −1.6 m / 河道 0 / 屋顶 +2 / 环台 3.6、6 / 矮岩丘 5 / 岩墙 10–20 / 塔尖 30 m",
    ),
    "1-3": dict(
        src="raw/1-3_v1.png", title="1-3 沉沙古城", motif="母题：城市 · 三层并行",
        mood="午后高日：街巷里是又深又冷的影，沙瀑从墙头倾进城里发亮；寺塔始终立在天际线上。",
        redo="重做要点：方盒子城改成不规则的圆角城；巨型横沙丘压住西北三分之一、从破墙灌进城。出生在城外丘顶，先俯瞰全城再滑下去。"
             "墙头 8 m / 屋顶沙台 4 m / 街面 0 m 三层并行，换层点不超过 30 m 一处；补给营在塔院，出口是塔后塌坑里的暗渠（通 1-4 月牙泉）。",
        sites=[
            "S　出生 · 城外丘顶：一眼看全城，寺塔 190 m 外",
            "①　灌沙城门：2 波 7 只（灌沙伏击 → 沙坡滚火）；沙坡上往下打",
            "②　三路长街：2 波 9 只；街面 / 屋顶 / 墙头三条线，镇墓兽 + 邪飞天压街",
            "③　集市井台：2 波 10 只（井台蜃影 → 集市乱战）；下沉广场，三面台阶",
            "④　寺院前庭：3 波 14 只含 2 精英（沙王卫队）；坐像 + 两层回廊。蓝帐 = 塔院补给营（商人、安全区）",
        ],
        routes=[
            "金线　丘顶 → ① → ② → ③ → ④ → 寺塔 → 塌坑暗渠，约 430 m（四个据点顺序不限）",
            "白线 A　墙头线：破口上墙 → 北墙（墙头藏宝）→ 东墙马道下到集市",
            "白线 B　屋顶线：西坊埋屋屋顶（埋屋藏宝，有守军）直插寺院前庭",
        ],
        levels="竖向：塌坑 −10 m / 井台 −2 / 街面 0 / 屋顶沙台 +4 / 墙头 +8 / 丘顶出生 +12 / 寺塔 22 m",
    ),
    "1-4": dict(
        src="raw/1-4_v2.png", title="1-4 鸣沙山月牙泉 · 旱魃", motif="首领场 · 开阔 + 日晒与荫蔽", boss=True,
        mood="烈日下的露天沙洼：月牙泉是全画面唯一的冷色，影子就是掩体。",
        redo="重做要点：露天、刀刃脊沙山环抱、月牙泉、南岸月泉阁和白杨林（照实景鸣沙山月牙泉）。旱魃的日晒机制用真实阴影——"
             "遮荫点按远近分散在环线上：月泉阁敞厅和回廊是深影，两座新月丘背阴面、白杨林、北岸残祠是浅影；太阳随阶段升高，影子越来越短。",
        sites=[
            "S → ①　观景台补给营（安全区、商人）→ 之字木栈道下到北岸进场",
            "阶段一　泉满：旱魃立在泉心，玩家绕泉周旋，影子长、荫蔽多",
            "阶段二　泉半干：露出一圈泉床，沙魇从四个漩涡点破沙而出",
            "阶段三　泉干、日轮当头：只剩阁内和回廊是深影；龟裂泉床成了新的低地",
            "E　胜利后宝箱落在北岸，出口在月泉阁庭院（通第二章）",
        ],
        routes=[
            "金线　绕泉风筝环线，一圈约 250 m，全程硬沙地、无卡脚",
            "白线　进荫蔽的岔路：阁内敞厅、回廊、两座新月丘背后、白杨林、北岸残祠",
            "俯射位　两座新月丘顶（迎风缓坡走得上去）、月泉阁二层台",
        ],
        levels="竖向：泉床 −1.4 m / 岸 0 / 新月丘顶 5.5–7 / 阁二层 +6 / 观景台 +16 / 沙山脊 30–40 m",
    ),
    "1-A": dict(
        src="raw/1-A_v2.png", title="1-A 千佛崖（备选图）", motif="母题：竖向分层",
        mood="午后斜阳把千佛崖照成一面金壁，崖脚的河床还在冷影里。",
        redo="重做要点：直崖改成河湾外侧的月牙形长崖，出生在对岸，一眼看全崖面。整张图是一场从河床到崖顶的攀登，据点按登高顺序编号。"
             "九层楼是贯通三层的竖向通道，另有西端崩塌碎石坡、沙堆坡、东端之字石阶三条上下路；崖脚 0 / 窟檐栈道 8 m / 崖顶 18 m 三层都能走能打。",
        sites=[
            "S　出生 · 对岸渡口台：隔着宕泉河看整面千佛崖",
            "①　河洲驼队：2 波 13 只（驼队残兵 → 河床伏沙）；残车、拒马、货堆",
            "②　大佛窟前：3 波 15 只；九层楼脚下的广场，窟檐层有远程位",
            "③　西崖窟檐：3 波 14 只；8 m 高的栈道，崖顶有怪跃下、飞天飞临",
            "④　崖顶塔院：3 波 16 只含 2 精英（千佛护法）；寺塔 + 一排白塔",
        ],
        routes=[
            "金线　渡口 → ① → ② → 九层楼内上窟檐层 → ③ → 碎石坡上崖顶 → ④ → 沿崖沿白塔 → 出口，约 450 m",
            "白线 A　① → 东端之字石阶直上崖顶（高处捷径）",
            "白线 B　沙堆坡从河床直上窟檐层",
            "藏宝　藏经洞（窟檐层西端）、河滩遗骸（南岸，有守军）",
        ],
        levels="竖向：河床 −1 m / 崖脚 0 / 窟檐层 +8 / 崖顶 +18 / 寺塔顶 +40 m",
    ),
}


def sheet(mid: str) -> Image.Image:
    m = MAPS[mid]
    art = Image.open(HERE / m["src"]).convert("RGB")
    W = art.width
    pad = 28
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_title, f_motif, f_body, f_small, f_head = font(38, True), font(22, True), font(19), font(17), font(20, True)
    col_w = [430, W - 430 - 3 * pad - pad, 0]

    # 先量高度
    def layout(d, y0, draw: bool) -> int:
        y = y0 + pad
        if draw:
            d.text((pad, y), m["title"], font=f_title, fill=INK)
            tw = d.textlength(m["title"], font=f_title)
            d.text((pad + tw + 20, y + 14), m["motif"], font=f_motif, fill=GOLD)
        y += 54
        y = para(d if draw else probe, (pad, y), "氛围　" + m["mood"], f_body, W - 2 * pad, fill=INK) + 4
        y = para(d if draw else probe, (pad, y), m["redo"], f_small, W - 2 * pad, fill=DIM) + 14
        top = y
        # 左栏：图例
        ly = top
        if draw:
            d.text((pad, ly), "图例", font=f_head, fill=GOLD)
        ly += 32
        for kind, text, label in (BOSS_LEGEND if m.get("boss") else COMMON_LEGEND):
            lines = wrap(probe, label, f_small, col_w[0] - 56)
            if draw:
                symbol(d, pad + 20, ly + 12, kind, text)
                for k, line in enumerate(lines):
                    d.text((pad + 52, ly + k * 23), line, font=f_small, fill=INK)
            ly += max(30, len(lines) * 23 + 7)
        # 右栏：据点 + 走法
        rx = pad + col_w[0] + pad
        ry = top
        if draw:
            d.text((rx, ry), "首领战" if m.get("boss") else "据点", font=f_head, fill=GOLD)
        ry += 32
        for s in m["sites"]:
            ry = para(d if draw else probe, (rx, ry), s, f_small, col_w[1], fill=INK, gap=5) + 4
        ry += 8
        if draw:
            d.text((rx, ry), "走法", font=f_head, fill=GOLD)
        ry += 32
        for s in m["routes"]:
            ry = para(d if draw else probe, (rx, ry), s, f_small, col_w[1], fill=INK, gap=5) + 4
        ry += 6
        ry = para(d if draw else probe, (rx, ry), m["levels"], f_small, col_w[1], fill=DIM, gap=5)
        return max(ly, ry) + pad

    H = layout(None, art.height, False)
    out = Image.new("RGB", (W, H), BG)
    out.paste(art, (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(0, art.height), (W, art.height)], fill=GOLD, width=3)
    layout(d, art.height, True)
    return out


def overview(sheets: dict[str, Image.Image]) -> Image.Image:
    order = ["1-1", "1-2", "1-3", "1-4", "1-A"]
    notes = {"1-1": "开阔 · 破晓", "1-2": "收紧 · 起风的上午", "1-3": "城市 · 午后", "1-4": "首领 · 烈日", "1-A": "备选图 · 竖向分层 · 午后斜阳"}
    tw, th = 760, 507
    pad = 24
    W = pad + 3 * (tw + pad)
    H = 150 + 2 * (th + 70) + pad
    out = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(out)
    d.text((pad, 26), "第一章 · 赤沙古道　关卡路线概念总览", font=font(40, True), fill=INK)
    para(d, (pad, 84), "一章一天：1-1 破晓迎日（开阔）→ 1-2 起风的上午（收紧）→ 1-3 午后的沉沙城（城市，章末补给营）→ 1-4 烈日下的月牙泉（首领 旱魃）。1-A 千佛崖进图池，每局洗牌时替换 1-1 / 1-2 之一。"
         "五张图都按同一套度量：半身掩体 1 m、全身掩体 ≥ 2.2 m、主路 ≥ 8 m、坡道 ≤ 24°、据点场地半径 24–30 m、兴趣点间隔 40–60 m。",
         font(19), W - 2 * pad, fill=DIM)
    for k, mid in enumerate(order):
        art = Image.open(HERE / MAPS[mid]["src"]).convert("RGB").resize((tw, th), Image.LANCZOS)
        cx = pad + (k % 3) * (tw + pad)
        cy = 150 + (k // 3) * (th + 70)
        out.paste(art, (cx, cy))
        d.rectangle([cx, cy, cx + tw - 1, cy + th - 1], outline=(70, 66, 60), width=2)
        d.text((cx, cy + th + 10), MAPS[mid]["title"], font=font(26, True), fill=INK)
        w = d.textlength(MAPS[mid]["title"], font=font(26, True))
        d.text((cx + w + 16, cy + th + 16), notes[mid], font=font(20), fill=GOLD)
    # 第六格：通用图例
    cx, cy = pad + 2 * (tw + pad), 150 + th + 70
    d.text((cx, cy), "图例", font=font(24, True), fill=GOLD)
    y = cy + 44
    for kind, text, label in COMMON_LEGEND:
        symbol(d, cx + 20, y + 12, kind, text)
        y = para(d, (cx + 52, y), label, font(18), tw - 60, fill=INK, gap=5) + 10
    return out


def main() -> None:
    sheets = {}
    for mid in MAPS:
        img = sheet(mid)
        sheets[mid] = img
        out = HERE / f"{mid}_route_concept.jpg"
        img.save(out, quality=92)
        print(out.name, img.size)
    ov = overview(sheets)
    ov.save(HERE / "ch1_route_overview.jpg", quality=90)
    print("ch1_route_overview.jpg", ov.size)


if __name__ == "__main__":
    main()
