"""战斗审阅图集：把 Unity 截图拼成每只怪 / 每个首领一张的拼图，并生成总览页。

输入（都在 unity/Assets/Art/_Review/，被 gitignore）：
  gallery/<组>/manifest.json + *.jpg   bridge.sh playtest gallery-<组>（GalleryRecorder）
  playtest_intro_*.png                  bridge.sh playtest boss-intro
  playtest_fx_*.png / fx3_* / fx4_*     bridge.sh playtest fx
输出（入库）：docs/art/review/unity-combat/
  <组>-<对象>.jpg   一行一个招式：前摇 / 出手 / 命中（或收招）/ 第一人称；最后一行是精英、出生、死亡、其他状态
  intro-<首领>.jpg  登场演出四镜
  fx-<主题>.jpg     通用战斗特效
  index.html / README.md   总览页（问题清单来自同目录 issues.json）
用法：python scripts/unity/combat_gallery.py
"""
import datetime
import html
import json
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / "unity/Assets/Art/_Review"
GALLERY = REVIEW / "gallery"
OUT = ROOT / "docs/art/review/unity-combat"
SUITE_CS = ROOT / "unity/Assets/Game/Scripts/Testing/Suites/CombatGallerySuite.cs"

CW, CH = 400, 225  # 格子
CAP = 40  # 格子下方的说明
PAD = 6
ROW_TITLE = 34
TITLE = 56
COLS = 4
BG = (18, 19, 24)
FG = (232, 232, 236)
DIM = (150, 152, 160)
PHASE_COLORS = {
    "前摇": (240, 180, 60), "出手": (245, 120, 50), "命中": (235, 70, 70), "收招": (140, 140, 150), "效果": (120, 200, 240), "第一人称": (90, 160, 245),
    "精英": (190, 120, 245), "迸散": (60, 200, 190), "溶解": (60, 200, 190), "出生法阵": (110, 210, 110), "显形": (110, 210, 110),
    "状态": (160, 160, 170), "转阶段·起": (240, 200, 90), "转阶段·中": (240, 200, 90), "化形·起": (200, 140, 250), "化形·成": (200, 140, 250),
    "倒下": (200, 200, 210), "溃散": (200, 200, 210), "落幕": (200, 200, 210), "余韵": (200, 200, 210),
}

GROUPS = {
    "desert": ("第一章 · 沙海", "chapter"),
    "frost": ("第二章 · 冰原", "chapter"),
    "inferno": ("第三章 · 火狱", "chapter"),
    "hanba": ("首领 · 旱魃（1-4）", "boss"),
    "kunpeng": ("首领 · 鲲鹏（2-4）", "boss"),
    "warlord": ("首领 · 熔心魔将（3-3）", "boss"),
    "qilin": ("首领 · 火麒麟（3-4）", "boss"),
}
BOSS_IDS = {"hanba": "boss_hanba", "kunpeng": "boss_kunpeng", "warlord": "boss_warlord", "qilin": "boss_qilin"}


def font(size, bold=False):
    win = os.environ.get("WINDIR", r"C:\Windows")
    for name in (["msyhbd.ttc"] if bold else []) + ["msyh.ttc", "simhei.ttf"]:
        p = Path(win) / "Fonts" / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


F_TITLE, F_ROW, F_CAP, F_SMALL = font(26, True), font(18, True), font(15), font(13)


def fit(text, f, width):
    """截断到一行放得下"""
    if f.getlength(text) <= width:
        return text
    while text and f.getlength(text + "…") > width:
        text = text[:-1]
    return text + "…"


def cell(src, phase, note, cw=CW, ch=CH):
    """一格：截图缩到 cw×ch，下面一行说明（阶段名着色 + 备注）"""
    im = Image.new("RGB", (cw, ch + CAP), BG)
    if src and Path(src).exists():
        shot = Image.open(src).convert("RGB")
        shot.thumbnail((cw, ch), Image.LANCZOS)
        im.paste(shot, ((cw - shot.width) // 2, (ch - shot.height) // 2))
    else:
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, cw - 1, ch - 1], outline=(70, 70, 80))
        d.text((cw // 2, ch // 2), "（没截到）", font=F_CAP, fill=DIM, anchor="mm")
    d = ImageDraw.Draw(im)
    color = PHASE_COLORS.get(phase, FG)
    d.text((6, ch + 3), phase, font=F_CAP, fill=color)
    if note:
        x = 6 + F_CAP.getlength(phase) + 10
        d.text((x, ch + 4), fit(note, F_SMALL, cw - x - 4), font=F_SMALL, fill=DIM)
    return im


def sheet(title, sub, rows, path, cols=COLS, cw=CW):
    """rows: [(行标题, [(图, 阶段, 备注) …])]；cols × cw 决定格子大小（特效图用两列大格）"""
    ch = cw * 9 // 16
    width = PAD + cols * (cw + PAD)
    height = TITLE + sum((ROW_TITLE if rt else 0) + ch + CAP + PAD for rt, _ in rows) + PAD
    im = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(im)
    d.text((PAD + 4, 10), title, font=F_TITLE, fill=FG)
    d.text((PAD + 8 + F_TITLE.getlength(title) + 14, 18), fit(sub, F_CAP, width - F_TITLE.getlength(title) - 40), font=F_CAP, fill=DIM)
    y = TITLE
    for rt, cells in rows:
        if rt:
            d.text((PAD + 4, y + 7), fit(rt, F_ROW, width - 20), font=F_ROW, fill=(245, 214, 140))
            y += ROW_TITLE
        for i, c in enumerate(cells[:cols]):
            im.paste(cell(*c, cw=cw, ch=ch), (PAD + i * (cw + PAD), y))
        y += ch + CAP + PAD
    im.save(path, "JPEG", quality=84, optimize=True, progressive=True)
    return path


def chunks(xs, n):
    return [xs[i:i + n] for i in range(0, len(xs), n)]


def table_labels():
    """从 GalleryAttacks 招式表读出每种敌人的招式名（核对没截到的招式）"""
    text = SUITE_CS.read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r'\["(\w+)"\] = new\[\]\s*\{(.*?)\},\s*\n', text, re.S):
        out[m.group(1)] = re.findall(r'A\("([^"]+)"', m.group(2))
    return out


def captured_at(man):
    return man.get("started", "")


def subject_rows(shots, labels):
    """一个对象的拼图行：招式（按招式表顺序 / 出现顺序）→ 其他（精英、出生、死亡、表外状态、转阶段、化形、倒下）"""
    moves, extra = {}, []
    for s in shots:
        if s["kind"] in ("attack", "boss-move"):
            key = (s["label"], s.get("form") or "", s.get("bossPhase", -1))
            moves.setdefault(key, {})[s["order"]] = s
        else:
            extra.append(s)
    order = {l: i for i, l in enumerate(labels)}
    rows = []
    for key in sorted(moves, key=lambda k: (k[2], order.get(k[0], 99), min(x["t"] for x in moves[k].values()))):
        label, form, phase = key
        cells = moves[key]
        any_cell = next(iter(cells.values()))
        bits = [label]
        if form:
            bits.append(form)
        if phase >= 0:
            bits.append(f"阶段 {phase + 1}")
        if any_cell.get("elite"):
            bits.append("精英出手")
        bits.append(f"距玩家 {any_cell.get('dist', 0):.1f} m")
        row = []
        for o, default in ((0, "前摇"), (1, "出手"), (2, "命中"), (3, "第一人称")):
            s = cells.get(o)
            row.append((s and s["path"], s["phase"] if s else default, s.get("note") if s else ""))
        rows.append((" · ".join(bits), row))
    groups = [
        ("精英 / 出生 / 死亡", [s for s in extra if s["kind"] in ("elite", "spawn", "death")]),
        ("转阶段 / 化形 / 倒下", [s for s in extra if s["kind"].startswith("boss-")]),
        ("其他状态（表外）", [s for s in extra if s["kind"] == "state"]),
    ]
    rank = {"elite": 0, "spawn": 1, "death": 2}
    for title, xs in groups:
        xs.sort(key=lambda s: (rank.get(s["kind"], 3), s["kind"], s["label"], s["order"]))
        for i, part in enumerate(chunks(xs, COLS)):
            rows.append((title + ("（续）" if i else ""), [(s["path"], s["label"] if s["kind"] == "state" else s["phase"],
                                  s["label"] if s["kind"].startswith("boss-") else s.get("note")) for s in part]))
    return rows


def build_groups(labels):
    sheets, missing = [], []
    for group, (gtitle, gkind) in GROUPS.items():
        mp = GALLERY / group / "manifest.json"
        if not mp.exists():
            continue
        man = json.loads(mp.read_text(encoding="utf-8"))
        when = captured_at(man)
        by, seen = {}, {}
        for s in man["shots"]:
            seen[s["file"]] = s  # 同名文件被后来的截图覆盖过：只留最后一条
        for s in seen.values():
            s["path"] = str(GALLERY / group / s["file"])
            if Path(s["path"]).exists():
                by.setdefault(s["subject"], []).append(s)
        boss_first = sorted(by, key=lambda k: (0 if k.startswith("boss") else 1, k))
        for sub in boss_first:
            shots = by[sub]
            name = shots[0]["name"]
            rows = subject_rows(shots, labels.get(sub, []))
            if not rows:
                continue
            got = {s["label"] for s in shots if s["kind"] == "attack"}
            # 首领关里的召唤物 / 小怪只是顺带拍到，不核对缺招
            lack = [l for l in labels.get(sub, []) if l not in got] if gkind == "chapter" else []
            for l in lack:
                missing.append((group, name, l))
            role = "召唤物 / 场上小怪" if gkind == "boss" and not sub.startswith("boss") else ""
            sub_title = f"{sub} · {gtitle}{' · ' + role if role else ''} · 截于 {when} · {len(shots)} 张"
            if lack:
                sub_title += f" · 没截到：{'、'.join(lack)}"
            path = OUT / f"{group}-{sub}.jpg"
            sheet(f"{name}", sub_title, rows, path)
            sheets.append({"group": group, "subject": sub, "name": name, "file": path.name, "shots": len(shots), "when": when,
                           "boss": sub.startswith("boss"), "lack": lack})
            print(f"  {path.name}：{len(shots)} 张")
    return sheets, missing


INTRO = [("hanba", "旱魃 · 1-4 鸣沙山月牙泉"), ("kunpeng", "鲲鹏 · 2-4 北冥"), ("warlord", "熔心魔将 · 3-3 熔铸坊"), ("qilin", "火麒麟 · 3-4 祝融殿")]
INTRO_SHOTS = {
    "hanba": ["1_basin", "2_emerge", "3_roar", "handoff"], "kunpeng": ["1_abyss", "2_breach", "3_pearl", "handoff"],
    "warlord": ["1_vista", "2_impact", "3_roar", "handoff"], "qilin": ["1_furnace", "2_leap", "3_rear", "handoff"],
}
INTRO_PHASES = ["全景", "现身", "特写 + 名字卡", "落回第一人称"]


def mtime(p):
    return datetime.datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")


def build_intros():
    sheets = []
    for boss, title in INTRO:
        rows = []
        stamps = []
        for variant, rt in (("level_", "真实关卡（带界面）"), ("", "测试场（带界面）")):
            cells = []
            for shot, ph in zip(INTRO_SHOTS[boss], INTRO_PHASES):
                p = REVIEW / f"playtest_intro_{boss}_{variant}{shot}_ui.png"
                if not p.exists():
                    p = REVIEW / f"playtest_intro_{boss}_{variant}{shot}.png"
                if p.exists():
                    stamps.append(mtime(p))
                cells.append((p if p.exists() else None, ph, shot))
            rows.append((rt, cells))
        when = max(stamps) if stamps else "?"
        path = OUT / f"intro-{boss}.jpg"
        sheet(f"登场演出 · {title}", f"boss-intro 套件 · 截于 {when}", rows, path)
        sheets.append({"group": "intro", "subject": boss, "name": title, "file": path.name, "shots": len(stamps), "when": when})
        print(f"  {path.name}")
    return sheets


FX = [
    ("hit", "命中 / 暴击 / 破盾破甲", [("fx_hit", "命中星芒"), ("fx_crit", "暴击星芒"), ("fx_hit_armor", "打甲"), ("fx_hit_shield", "打盾"),
                                  ("fx_break_armor", "破甲"), ("fx_break_shield", "破盾")]),
    ("impact", "弹着点 / 弹孔（沙 · 石 · 冰 · 金属）", [(f"fx_impact_{m}", f"弹着点 · {n}") for m, n in (("sand", "沙"), ("stone", "石"), ("ice", "冰"), ("metal", "金属"))]
     + [(f"fx_hole_{m}", f"弹孔 · {n}") for m, n in (("sand", "沙"), ("stone", "石"), ("ice", "冰"), ("metal", "金属"))]),
    ("blast", "爆炸 + 焦痕 / 枪口火焰 / 雷击", [("fx_explosion", "爆炸"), ("fx_explosion_late", "爆炸 · 余烟"), ("fx_explosion_scorch", "焦痕"),
                                       ("fx_muzzle", "枪口火焰"), ("fx_lightning", "雷击")]),
    ("tracer", "元素曳光（火 / 雷 / 蚀）", [(f"fx_tracer_{e}{v}", f"{n}{vn}") for e, n in (("fire", "火"), ("shock", "雷"), ("corrode", "蚀"))
                                     for v, vn in (("", " · 玩家视角"), ("_side", " · 侧面"))]),
    ("status", "状态外观", [("fx_status_burn", "灼烧"), ("fx_status_shock", "感电"), ("fx_status_corrode", "蚀化"), ("fx_status_stun", "眩晕"),
                        ("fx_status_slow", "减速"), ("fx_status_all", "五种并排")]),
    ("spawn", "出生法阵 + 显形 / 死亡迸散 + 溶解", [("fx_spawn_mid", "出生法阵"), ("fx_spawn_finale", "显形"), ("fx_death", "死亡迸散"),
                                         ("fx_death_dissolve", "尸体溶解")]),
    ("reaction", "元素反应（熔池 / 归墟）", [("fx_meltdown_pool", "熔池"), ("fx_meltdown_pool_late", "熔池 · 后段"), ("fx_abyss_windup", "归墟 · 聚拢"),
                                     ("fx_abyss_burst", "归墟 · 爆发"), ("fx_abyss_late", "归墟 · 余波")]),
    ("frost", "FX3 冰霜专属", [("fx3_shatter", "碎冰"), ("fx3_shatter_late", "碎冰 · 散开"), ("fx3_nova", "冰爆"), ("fx3_nova_late", "冰爆 · 余雾"),
                           ("fx3_icering", "冰环冰刺"), ("fx3_fog", "冻雾霜纹"), ("fx3_shell_freeze", "霜甲 · 冻到一半"), ("fx3_shell", "霜甲 · 冻满"),
                           ("fx3_shell_pose", "霜甲 · 近景"), ("fx3_shell_break", "霜甲 · 碎"), ("fx3_glint", "星芒"),
                           ("fx3_glow_qingniao", "发光 · 青鸟"), ("fx3_glow_ice_puffer", "发光 · 河豚"), ("fx3_glow_haozhi", "发光 · 豪彘"),
                           ("fx3_glow_fox_witch", "发光 · 狐巫")]),
    ("inferno", "FX4 火狱专属", [("fx4_gunpowder", "火药爆"), ("fx4_gunpowder_late", "火药爆 · 纸屑"), ("fx4_molten_stream", "熔铜流"),
                             ("fx4_floorfire", "五种地火"), ("fx4_floorfire_top", "地火 · 俯视"), ("fx4_flame_pillar", "火柱"), ("fx4_chain", "铁链 · 烧红"),
                             ("fx4_chain_close", "铁链 · 近景"), ("fx4_chain_drop", "断链"), ("fx4_basalt", "碎岩甲 + 熔岩飞溅"),
                             ("fx4_region_tuo", "分区遮罩 · 火鼍碎甲"), ("fx4_region_nuo_black", "分区遮罩 · 傩面"), ("fx4_region_nuo_cracked", "傩面 · 碎")]
     + [(f"fx4_flame_{i}", f"火苗 · {n}") for i, n in (("fire_rat", "火浣鼠"), ("huodou", "祸斗"), ("tantong", "炭童"), ("tomb_beast", "镇墓兽"))]),
]


def build_fx():
    sheets = []
    for key, title, items in FX:
        found = [(REVIEW / f"playtest_{f}.png", n) for f, n in items if (REVIEW / f"playtest_{f}.png").exists()]
        lack = [n for f, n in items if not (REVIEW / f"playtest_{f}.png").exists()]
        if not found:
            continue
        stamps = [mtime(p) for p, _ in found]
        rows = [("", [(p, n, mtime(p)[5:]) for p, n in part]) for part in chunks(found, 2)]
        path = OUT / f"fx-{key}.jpg"
        sub = f"fx 套件 · 截于 {min(stamps)} – {max(stamps)}" + (f" · 没截到：{'、'.join(lack)}" if lack else "")
        sheet(f"通用特效 · {title}", sub, rows, path, cols=2, cw=810)
        sheets.append({"group": "fx", "subject": key, "name": title, "file": path.name, "shots": len(found), "when": max(stamps), "lack": lack})
        print(f"  {path.name}：{len(found)} 张")
    return sheets


SEV = {"高": "#e5484d", "中": "#f5a524", "低": "#8b8d98"}

# 总览页开头的「特效打磨」一段：准则 + 审查报告 + 各路改前 / 改后对比图（docs/art/review/fx-polish/<路>/*.jpg，按文件名排）
FX_POLISH_DATE = "2026-10-29"
FX_POLISH = ROOT / "docs/art/review/fx-polish"
FX_POLISH_LANES = [
    ("A", "A 射击核心", "枪口火焰、抛壳、曳光、弹孔 / 焦痕、命中层、暴击、碎刃刀光"),
    ("B", "B 爆炸 / 元素 / 状态 / 护盾", "卡通爆炸三档、五种元素反应、状态外观、护盾球壳 / 破甲、火舌、出生死亡"),
    ("C", "C 首领与怪物专属 + 预警", "首领登场 / 招式 / 倒下、普通怪招式、三章出生法阵、地面预警"),
    ("D", "D 环境氛围", "12 关空气粒子、火盆 / 灯笼、水面 / 流沙 / 熔岩、沙帘"),
    ("style", "风格审查", "按 fx-style.md 自查清单逐项过 A / B 两路，亮沙 / 雪 / 熔岩三种地面改前 / 改后（S1–S12）"),
]
FX_POLISH_TEXT = ("四路特效打磨（A 射击核心、B 爆炸 / 元素 / 状态 / 护盾、C 首领与怪物专属 + 预警、D 环境氛围）和一轮风格审查都已完成，"
                  "本图集是打磨之后用合并后的代码重拍的。特效按 fx-style.md 的准则做：形状先于细节、每个特效 2–3 个色阶、"
                  "中尺度东方纹样、克制的光、第一人称读感优先；烟尘按章节换暖沙 / 冷白 / 紫褐。各路改前 / 改后对比：")


def fx_polish_links():
    """[(路标题, 说明, [(图名, 相对 unity-combat 的路径)])]"""
    out = []
    for key, title, desc in FX_POLISH_LANES:
        d = FX_POLISH / key
        files = sorted(d.glob("*.jpg"), key=lambda p: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.stem)]) if d.is_dir() else []
        out.append((title, desc, [(p.stem, f"../fx-polish/{key}/{p.name}") for p in files]))
    return out

NOTES = [
    "三章普通怪都在测试场（TestArena）截：沙地、红色刷怪台、悬浮的武器架是测试场的东西，不是本章地形（红色圆台不是预警，别和红 / 橙色预警混看）；首领在各自的真实关卡里截。",
    "普通和精英同时刷在刷怪台上，冰鲸、玄冰巨蟹这类大体型的两只会互相穿插——是测试摆位，不是游戏问题。",
    "第三章模型暂缓，3-3 / 3-4 场地里的方块和浅色板是白盒占位；场地柱子密，个别旁观机位被柱子挡住。",
    "「命中」= 出手后玩家第一次挨的一下（4 点以上，跳伤不算）；几只怪同时出手时可能记到别的怪头上。没打中就拍收招；辅助招（施法、换位、护甲）第三格是出手后 0.7 s 的「效果」。",
    "「第一人称」格：眼睛位置不动、视线临时转向出招者（拍完还原），看的是玩家正看着它时预警读不读得出来。",
    "本轮（2026-10-29）在特效打磨四路 + 风格审查收口之后、用合并 ff7ad722 后的代码全部重拍：七组 gallery、boss-intro（测试场 + 四个首领关）、fx；各图标题里有截图时间。",
]


def render_pages(sheets, issues, missing):
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    sections = [("intro", "一、首领登场演出", lambda s: s["group"] == "intro")]
    sections += [(g, f"二、首领招式 · {GROUPS[g][0].split(' · ')[1]}", lambda s, g=g: s["group"] == g) for g in ("hanba", "kunpeng", "warlord", "qilin")]
    sections += [(g, f"三、普通怪物 · {GROUPS[g][0]}", lambda s, g=g: s["group"] == g) for g in ("desert", "frost", "inferno")]
    sections += [("fx", "四、通用战斗特效", lambda s: s["group"] == "fx")]
    counts = {}
    for s in sheets:
        counts.setdefault(s["group"], [0, 0])
        counts[s["group"]][0] += 1
        counts[s["group"]][1] += s["shots"]

    # ── index.html ──
    h = []
    h.append("""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unity 战斗演出审阅</title><style>
:root{--bg:#121318;--panel:#1b1d24;--fg:#e8e8ec;--dim:#9a9caa;--line:#2a2d38;--acc:#f5d68c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Microsoft YaHei",system-ui,sans-serif}
header{padding:28px 32px 8px}h1{margin:0 0 6px;font-size:26px}h2{margin:36px 0 12px;font-size:20px;color:var(--acc)}
main{padding:0 32px 60px;max-width:1720px}nav{position:sticky;top:0;background:#121318ee;padding:10px 32px;border-bottom:1px solid var(--line);z-index:5;
display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px}nav a{color:var(--dim);text-decoration:none}nav a:hover{color:var(--fg)}
.dim{color:var(--dim)}table{border-collapse:collapse;width:100%;background:var(--panel);font-size:14px}
td,th{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{color:var(--dim);font-weight:normal}
.sev{display:inline-block;min-width:28px;text-align:center;border-radius:4px;padding:0 6px;color:#111;font-weight:bold}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:18px}
figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
figure img{width:100%;display:block;cursor:zoom-in;background:#000}figcaption{padding:8px 12px;font-size:14px}
figcaption b{color:var(--fg)}figcaption .lack{color:#f5a524}
#lb{position:fixed;inset:0;background:#000e;display:none;z-index:10;overflow:auto;cursor:zoom-out}
#lb img{display:block;margin:0 auto;max-width:none;width:min(1660px,100%)}#lb .bar{position:fixed;left:0;right:0;bottom:0;padding:8px 16px;
background:#000c;color:var(--fg);font-size:14px}
</style></head><body>""")
    h.append(f"<header><h1>Unity 战斗演出审阅图集</h1><div class='dim'>生成于 {now} · 每只怪 / 每个首领一张拼图：一行一个招式，"
             "四格依次是<b style='color:#f0b43c'>前摇</b>（预警最满的那一帧）、<b style='color:#f57832'>出手</b>、<b style='color:#eb4646'>命中</b>"
             "（没打中则为收招）、<b style='color:#5aa0f5'>第一人称</b>（前摇最后一帧的玩家视角）。第三人称旁观机位里的<b style='color:#5af2ff'>青色胶囊</b>是玩家站位。"
             "点图放大，← → 翻页，Esc 关闭。</div></header>")
    h.append("<nav><a href='#fx-polish'>特效打磨</a><a href='#issues'>问题清单</a>" + "".join(f"<a href='#{k}'>{t.split('、', 1)[1]}</a>" for k, t, _ in sections) + "</nav><main>")
    # 特效打磨
    h.append(f"<h2 id='fx-polish'>特效打磨（{FX_POLISH_DATE}）</h2><p>{html.escape(FX_POLISH_TEXT)}</p><p>"
             "准则：<a href='../../fx-style.md'>docs/art/fx-style.md</a> · 审查报告：<a href='../fx-polish/style-audit.md'>fx-polish/style-audit.md</a></p>"
             "<table><tr><th>路</th><th>内容</th><th>改前 / 改后对比图</th></tr>")
    for title, desc, files in fx_polish_links():
        links = " · ".join(f"<a href='{html.escape(p)}'>{html.escape(n)}</a>" for n, p in files) or "<span class='dim'>（无）</span>"
        h.append(f"<tr><td>{html.escape(title)}</td><td class='dim'>{html.escape(desc)}</td><td>{links}</td></tr>")
    h.append("</table>")
    # 概况
    h.append("<h2 id='summary'>截图概况</h2><table><tr><th>分组</th><th>拼图</th><th>截图</th><th>截图时间</th></tr>")
    names = {"intro": "首领登场", "fx": "通用特效", **{g: v[0] for g, v in GROUPS.items()}}
    for g in ["intro", "hanba", "kunpeng", "warlord", "qilin", "desert", "frost", "inferno", "fx"]:
        if g not in counts:
            continue
        whens = sorted({s["when"] for s in sheets if s["group"] == g})
        h.append(f"<tr><td>{names[g]}</td><td>{counts[g][0]}</td><td>{counts[g][1]}</td><td>{html.escape(' / '.join(whens[:1] + whens[-1:]) if len(whens) > 1 else ''.join(whens))}</td></tr>")
    h.append("</table>")
    h.append("<h2 id='notes'>截图说明</h2><ul class='dim'>" + "".join(f"<li>{html.escape(n)}</li>" for n in NOTES) + "</ul>")
    # 问题清单
    h.append("<h2 id='issues'>问题清单</h2><p class='dim'>截图时发现的明显问题。严重程度：高 = 影响读招 / 明显穿帮；中 = 看得出不对；低 = 打磨项。"
             "「状态」写的是修复进度和修法（已修的条目对应的拼图已重拍）。</p>")
    h.append("<table><tr><th>#</th><th>严重</th><th>归属</th><th>对象</th><th>问题</th><th>状态</th><th>见图</th></tr>")
    for i, it in enumerate(issues, 1):
        refs = " ".join(f"<a href='#{html.escape(r)}'>{html.escape(r)}</a>" for r in it.get("refs", []))
        st = it.get("status", "未修")
        color = "#46a758" if st.startswith("已修") else "#f5a524" if "在修" in st else "#8b8d98"
        h.append(f"<tr><td>{i}</td><td><span class='sev' style='background:{SEV.get(it['severity'], '#888')}'>{it['severity']}</span></td>"
                 f"<td>{html.escape(it['owner'])}</td><td>{html.escape(it['subject'])}</td><td>{html.escape(it['text'])}</td>"
                 f"<td style='color:{color}'>{html.escape(st)}</td><td>{refs}</td></tr>")
    h.append("</table>")
    if missing:
        h.append("<p class='dim'>招式表里有、这一轮没截到的招式（剧本没逼出来或被打断）：" +
                 "；".join(html.escape(f"{GROUPS[g][0]} {n} · {l}") for g, n, l in missing) + "</p>")
    for key, title, pred in sections:
        xs = [s for s in sheets if pred(s)]
        if not xs:
            continue
        h.append(f"<h2 id='{key}'>{title}</h2><div class='grid'>")
        for s in xs:
            lack = f"<br><span class='lack'>没截到：{html.escape('、'.join(s['lack']))}</span>" if s.get("lack") else ""
            h.append(f"<figure id='{html.escape(s['file'][:-4])}'><img loading='lazy' src='{s['file']}' alt='{html.escape(s['name'])}'>"
                     f"<figcaption><b>{html.escape(s['name'])}</b> <span class='dim'>{html.escape(s['subject'])} · {s['shots']} 张 · 截于 {s['when']}</span>{lack}</figcaption></figure>")
        h.append("</div>")
    h.append("""</main><div id="lb"><img><div class="bar"></div></div><script>
const imgs=[...document.querySelectorAll('figure img')],lb=document.getElementById('lb'),big=lb.querySelector('img'),bar=lb.querySelector('.bar');let k=-1;
function show(i){k=(i+imgs.length)%imgs.length;big.src=imgs[k].src;bar.textContent=(k+1)+' / '+imgs.length+' · '+imgs[k].closest('figure').querySelector('figcaption').textContent;lb.style.display='block';lb.scrollTop=0}
imgs.forEach((im,i)=>im.onclick=()=>show(i));lb.onclick=()=>{lb.style.display='none';k=-1};
addEventListener('keydown',e=>{if(k<0)return;if(e.key==='ArrowRight')show(k+1);else if(e.key==='ArrowLeft')show(k-1);else if(e.key==='Escape')lb.onclick()});
</script></body></html>""")
    (OUT / "index.html").write_text("\n".join(h), encoding="utf-8")

    # ── README.md（GitHub / 编辑器里直接看）──
    m = [f"# Unity 战斗演出审阅图集", "",
         f"生成于 {now}。浏览器打开同目录的 [index.html](index.html) 体验更好（点图放大、← → 翻页）。", "",
         "每只怪 / 每个首领一张拼图：一行一个招式，四格依次是 **前摇**（预警最满的那一帧）、**出手**、**命中**（没打中则为收招）、**第一人称**（前摇最后一帧的玩家视角）。"
         "第三人称旁观机位里的青色胶囊是玩家站位。", "",
         "重新生成：`bash scripts/unity/bridge.sh playtest gallery-<desert|frost|inferno|hanba|kunpeng|warlord|qilin>`、`playtest boss-intro`、`playtest fx`，"
         "然后 `python scripts/unity/combat_gallery.py`。", "",
         f"## 特效打磨（{FX_POLISH_DATE}）", "", FX_POLISH_TEXT, "",
         "准则：[docs/art/fx-style.md](../../fx-style.md) · 审查报告：[fx-polish/style-audit.md](../fx-polish/style-audit.md)", "",
         "| 路 | 内容 | 改前 / 改后对比图 |", "|---|---|---|"]
    for title, desc, files in fx_polish_links():
        m.append(f"| {title} | {desc} | {' · '.join(f'[{n}]({p})' for n, p in files) or '（无）'} |")
    m += ["", "## 截图说明", ""] + [f"- {n}" for n in NOTES] + ["",
         "## 问题清单", "", "| # | 严重 | 归属 | 对象 | 问题 | 状态 | 见图 |", "|---|---|---|---|---|---|---|"]
    for i, it in enumerate(issues, 1):
        refs = " ".join(f"[{r}]({r}.jpg)" for r in it.get("refs", []))
        st = it.get("status", "未修").replace("|", "/")
        m.append(f"| {i} | {it['severity']} | {it['owner']} | {it['subject']} | {it['text'].replace('|', '/')} | {'**' + st + '**' if st.startswith('已修') else st} | {refs} |")
    if missing:
        m += ["", "招式表里有、这一轮没截到的招式：" + "；".join(f"{GROUPS[g][0]} {n} · {l}" for g, n, l in missing)]
    for key, title, pred in sections:
        xs = [s for s in sheets if pred(s)]
        if not xs:
            continue
        m += ["", f"## {title}", ""]
        for s in xs:
            lack = f"（没截到：{'、'.join(s['lack'])}）" if s.get("lack") else ""
            m += [f"**{s['name']}** `{s['subject']}` · {s['shots']} 张 · 截于 {s['when']}{lack}", "", f"![{s['name']}]({s['file']})", ""]
    (OUT / "README.md").write_text("\n".join(m), encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    for old in OUT.glob("*.jpg"):
        if not only or any(old.name.startswith(g) for g in only):
            old.unlink()
    labels = table_labels()
    print("拼图：")
    sheets, missing = build_groups(labels)
    sheets += build_intros()
    sheets += build_fx()
    issues_path = OUT / "issues.json"
    issues = json.loads(issues_path.read_text(encoding="utf-8")) if issues_path.exists() else []
    render_pages(sheets, issues, missing)
    total = sum(s["shots"] for s in sheets)
    size = sum(p.stat().st_size for p in OUT.glob("*.jpg")) / 1e6
    print(f"共 {len(sheets)} 张拼图（{total} 张截图），{size:.1f} MB → {OUT}")


if __name__ == "__main__":
    main()
