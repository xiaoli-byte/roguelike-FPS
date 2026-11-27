"""界面字体：下载 OFL 原字体 → 按游戏用字裁成子集 → 直接发布 WOFF2、许可证和 @font-face 样式表。

    python scripts/web/fonts.py            缺原字体就下载（版本与 SHA-256 钉死），重新生成全部发布物
    python scripts/web/fonts.py --report   只扫描用字、打印统计，不写文件
    python scripts/web/fonts.py --check    只核对，不写、不需要原字体：发布的子集覆盖当前全部用字、
                                           fonts.json / sf-fonts.css 和字体文件对得上；有问题退出码 1

三套字体（都来自官方 GitHub 发布，版本与 SHA-256 钉死在 FONTS 表里）：
    正文 Noto Sans SC Regular         notofonts/noto-cjk  Sans2.004  Sans/SubsetOTF/SC
    标题 霞鹜文楷 LXGW WenKai Medium   lxgw/LxgwWenKai     v1.530     发布附件
    数字 Barlow Condensed SemiBold    jpt/barlow          1.422      fonts/ttf
原字体下载到 art/fonts/_src/（.gitignore，不入库；丢了会按钉死的地址重新下载并校验 SHA-256）。

用字（正文 / 标题）：ASCII + Latin-1 + 常用标点 / 箭头 / 几何符号 + CJK 标点 + 全角字符 + GB2312 第 1–3 区符号 + GB2312 一级汉字（3755）
+ 扫描到的全部非 ASCII 字符：
    src/**/*.ts            去掉注释后的代码（代码标识符都是 ASCII，所以就是字符串 / 模板字面量）
    src/**/*.css           去掉注释（content: "…" 之类）
    仓库根和 src 下的 *.html 去掉 <!-- --> 注释（检视页的界面文字）
    public/**/*.json       全部字符串（键和值）：关卡文档里的地名 / 据点名、机关、关卡目标、定义表……按通用规则扫整个 public/，
                           以后新加的数据表不用登记
数字字体只要 ASCII + Latin-1 + 几个符号（× · − ％ ↑ ↓ …），中文靠回退。

回退：正文另出「余量」文件 NotoSansSC-Regular-Ext.woff2 = 原字体减去子集已有的字（不重复），
sf-base.css 的回退链是  标题 / 数字 → 正文子集 → 正文余量，子集之外的字（以后新写的文案忘了重跑本脚本）照样能显示；
余量带 unicode-range，页面真用到那段字时浏览器才下载。每个发布文件都必须 < 8 MB，余量超了按码位切成几份（-Ext1、-Ext2…）。

许可：霞鹜文楷的 OFL 声明了保留字体名（'霞鹜' '霞鶩' '落霞孤鹜' '落霞孤鶩' 'LXGW'），附加许可只放宽到网页字体，
游戏里打包子集属于「修改版」，所以子集改名为 WenKai SF / 文楷 SF（文件 WenKaiSF-Medium.woff2），版权与许可证记录原样保留。
Noto 与 Barlow 没有保留字体名，沿用原名。

输出：
  public/assets/fonts/<名>.woff2 + OFL-*.txt + FONTS-NOTICE.txt（许可证随字体分发）
  public/assets/fonts/fonts.json   每个字体：文件、字体族、原字体 sha256（origin）、发布文件 sha256、码位数；许可证文件的 sha256
  src/ui/css/sf-fonts.css           @font-face：每个字体带 unicode-range（按字体实际的字表生成）
字体族名（src/ui/css/sf-base.css 的 --sf-font-* 回退链用）：SF Body / SF Body Ext / SF Title / SF Number，
都登记成 font-weight 400：粗体由浏览器合成。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
from io import BytesIO

from fontTools import subset
from fontTools.ttLib import TTFont

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC_DIR = os.path.join(REPO, "art", "fonts", "_src")
OUT_DIR = os.path.join(REPO, "public", "assets", "fonts")
CSS = os.path.join(REPO, "src", "ui", "css", "sf-fonts.css")
MANIFEST = os.path.join(OUT_DIR, "fonts.json")
NOTICE = "FONTS-NOTICE.txt"
MAX_BYTES = 8 * 1024 * 1024

# 原字体。out：发布文件名（不带 .woff2）；family：@font-face 的字体族；rename：名称表里的替换（保留字体名不能出现在修改版里）；
# ext：另出余量文件做回退（发布名、字体族、名称表替换）
FONTS = {
    "body": {
        "file": "NotoSansSC-Regular.otf",
        "url": "https://github.com/notofonts/noto-cjk/raw/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
        "sha256": "faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9",
        "license": ("OFL-NotoSansSC.txt", "https://github.com/notofonts/noto-cjk/raw/Sans2.004/LICENSE"),
        "origin": "Noto Sans SC Regular 2.004（notofonts/noto-cjk 标签 Sans2.004，Sans/SubsetOTF/SC）",
        "charset": "cjk",
        "out": "NotoSansSC-Regular",
        "family": "SF Body",
        "role": "正文（Noto Sans SC 子集）",
        "rename": [],
        "ext": {
            "out": "NotoSansSC-Regular-Ext",
            "family": "SF Body Ext",
            "role": "正文余量（子集之外的字，用到才下载）",
            "rename": [("Noto Sans SC", "Noto Sans SC Ext"), ("NotoSansSC-Regular", "NotoSansSC-Regular-Ext")],
        },
    },
    "title": {
        "file": "LXGWWenKai-Medium.ttf",
        "url": "https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Medium.ttf",
        "sha256": "f4b8a34d1f838fe411540cb7c97b1c384ac9738a876c4104500bc42508b2312a",
        "license": ("OFL-LXGWWenKai.txt", "https://github.com/lxgw/LxgwWenKai/raw/v1.530/OFL.txt"),
        "origin": "LXGW WenKai Medium 1.530（lxgw/LxgwWenKai 发布 v1.530）",
        "charset": "cjk",
        "out": "WenKaiSF-Medium",
        "family": "SF Title",
        "role": "标题（霞鹜文楷子集 WenKai SF）",
        "rename": [("霞鹜文楷", "文楷 SF"), ("霞鶩文楷", "文楷 SF"), ("LXGW WenKai", "WenKai SF"), ("LXGWWenKai", "WenKaiSF")],
        "ext": None,
    },
    "number": {
        "file": "BarlowCondensed-SemiBold.ttf",
        "url": "https://github.com/jpt/barlow/raw/1.422/fonts/ttf/BarlowCondensed-SemiBold.ttf",
        "sha256": "0dae49e31a5dd598184b8ed18ed877f9280e07c4cc3fa7c2cad25a5e7d8a3ad4",
        "license": ("OFL-Barlow.txt", "https://github.com/jpt/barlow/raw/1.422/OFL.txt"),
        "origin": "Barlow Condensed SemiBold 1.422（jpt/barlow 标签 1.422，fonts/ttf）",
        "charset": "latin",
        "out": "BarlowCondensed-SemiBold",
        "family": "SF Number",
        "role": "数字（Barlow Condensed SemiBold）",
        "rename": [],
        "ext": None,
    },
}

# 改名时动的名称记录：家族 / 唯一标识 / 全名 / PostScript 名 / 首选家族 / WWS 家族
RENAME_IDS = (1, 3, 4, 6, 16, 18, 21)
# 修改版不带的记录：示例文本（文楷的示例句里有保留字）
DROP_IDS = (19,)
# 改名后名称里仍不许出现的保留字
RESERVED = ("霞鹜", "霞鶩", "落霞孤鹜", "落霞孤鶩", "LXGW")


# ───────────────────────────── 下载 ─────────────────────────────

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    print(f"  下载 {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "spiritfire-fonts"})
    with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as fh:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
    os.replace(tmp, dest)


def ensure_sources() -> None:
    for f in FONTS.values():
        path = os.path.join(SRC_DIR, f["file"])
        if not os.path.exists(path):
            fetch(f["url"], path)
        digest = sha256(path)
        if digest != f["sha256"]:
            sys.exit(f"{f['file']} 的 SHA-256 不对（{digest}）：删掉 {path} 重新下载，或核对 FONTS 表里的版本")
        lic_name, lic_url = f["license"]
        if not os.path.exists(os.path.join(SRC_DIR, lic_name)):
            fetch(lic_url, os.path.join(SRC_DIR, lic_name))


# ───────────────────────────── 用字 ─────────────────────────────

def gb2312_chars(rows: range) -> set[str]:
    """GB2312 指定区（1 起）的全部字符：区号 r → 首字节 0xA0 + r，位号 1–94 → 次字节 0xA1–0xFE"""
    out = set()
    for row in rows:
        for cell in range(1, 95):
            try:
                out.add(bytes([0xA0 + row, 0xA0 + cell]).decode("gb2312"))
            except UnicodeDecodeError:
                continue
    return out


def ranges(*spans: tuple[int, int]) -> set[str]:
    return {chr(c) for a, b in spans for c in range(a, b + 1)}


BASE_LATIN = ranges((0x20, 0x7E), (0xA0, 0xFF))
SYMBOLS = ranges(
    (0x2010, 0x205E),  # 一般标点：— – ‘ ’ “ ” • … ‰ ′ ″ ※
    (0x2190, 0x21FF),  # 箭头 ↑ ↓ ← →
    (0x2212, 0x2212),  # 减号 −
    (0x2460, 0x2473),  # ① – ⑳
    (0x25A0, 0x25FF),  # 几何 ■ □ ▲ ▼ ◆ ◇ ○ ●
    (0x2605, 0x2606),  # ★ ☆
    (0x3000, 0x303F),  # CJK 标点：、。〈〉《》「」『』【】〔〕
    (0xFF01, 0xFF65),  # 全角 ASCII 与半角标点：！（），：；？％～
    (0xFFE0, 0xFFE6),  # ￠ ￡ ￥
)
NUMBER_EXTRA = set("×·−–—％%+-/:.,'\"°…↑↓←→▲▼") | ranges((0x2010, 0x2027), (0x2030, 0x2033))
LEVEL1 = gb2312_chars(range(16, 56))


def strip_ts_comments(text: str) -> str:
    """去掉 // 和 /* */ 注释，保留代码与字符串。逐字符走：识别 ' " ` 字符串，字符串里的 // 不当注释"""
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and nxt == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in ('"', "'", "`"):
            j = i + 1
            while j < n and text[j] != c:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "\n" and c != "`":
                    break  # 没闭合（误判，比如正则里的引号）：到行尾为止
                j += 1
            out.append(text[i:j + 1])
            i = j + 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def strip_css_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


def strip_html_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


def usable(ch: str) -> bool:
    o = ord(ch)
    # 控制字符、私用区、BOM、代理对残片不要
    return o > 0x7E and not (0x7F <= o < 0xA0 or 0xE000 <= o <= 0xF8FF or o == 0xFEFF or 0xD800 <= o <= 0xDFFF)


def json_strings(node, out: set[str]) -> None:
    """JSON 里的全部字符串（键和值）的字符；\\uXXXX 转义按解析后的字算"""
    if isinstance(node, str):
        out.update(node)
    elif isinstance(node, dict):
        for k, v in node.items():
            out.update(k)
            json_strings(v, out)
    elif isinstance(node, list):
        for v in node:
            json_strings(v, out)


SKIP_DIRS = {"node_modules", ".git", ".claude", "dist"}


def walk(root: str, exts: tuple[str, ...]):
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(files):
            if name.endswith(exts):
                yield os.path.join(dirpath, name)


def read_text(path: str) -> str:
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        return fh.read()


def scan() -> tuple[set[str], dict[str, int], dict[str, set[str]]]:
    """全部用字；返回（字符集，每类文件数，每类各自的字符集——--report 用）"""
    by_kind: dict[str, set[str]] = {"ts": set(), "css": set(), "html": set(), "json": set()}
    counts = {k: 0 for k in by_kind}
    src = os.path.join(REPO, "src")
    for path in walk(src, (".ts",)):
        by_kind["ts"].update(strip_ts_comments(read_text(path)))
        counts["ts"] += 1
    for path in walk(src, (".css",)):
        by_kind["css"].update(strip_css_comments(read_text(path)))
        counts["css"] += 1
    htmls = [os.path.join(REPO, f) for f in sorted(os.listdir(REPO)) if f.endswith(".html")] + list(walk(src, (".html",)))
    for path in htmls:
        by_kind["html"].update(strip_html_comments(read_text(path)))
        counts["html"] += 1
    for path in walk(os.path.join(REPO, "public"), (".json",)):
        if os.path.normcase(os.path.dirname(path)) == os.path.normcase(OUT_DIR):
            continue  # 字体自己的清单
        try:
            data = json.loads(read_text(path))
        except ValueError as err:
            sys.exit(f"{os.path.relpath(path, REPO)} 解析失败：{err}")
        json_strings(data, by_kind["json"])
        counts["json"] += 1
    for k in by_kind:
        by_kind[k] = {ch for ch in by_kind[k] if usable(ch)}
    chars = set().union(*by_kind.values())
    return chars, counts, by_kind


def charset(kind: str, scanned: set[str]) -> set[str]:
    if kind == "latin":
        return BASE_LATIN | NUMBER_EXTRA
    return BASE_LATIN | SYMBOLS | gb2312_chars(range(1, 4)) | LEVEL1 | scanned


def is_hanzi(ch: str) -> bool:
    o = ord(ch)
    return 0x3400 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF


# ───────────────────────────── 字体读写 ─────────────────────────────

def cmap_of(data_or_path) -> set[str]:
    font = TTFont(BytesIO(data_or_path) if isinstance(data_or_path, bytes) else data_or_path, lazy=True)
    out = {chr(c) for c in font.getBestCmap()}
    font.close()
    return out


def make_subset(src: str, chars: set[str], rename: list[tuple[str, str]], label: str) -> bytes:
    """原字体 → 子集 WOFF2（字节）"""
    opts = subset.Options()
    opts.layout_features = ["*"]       # 保留字距 / 标点挤压等特性
    opts.name_IDs = ["*"]              # 版权、许可证等名称记录原样保留
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    opts.flavor = "woff2"
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(ord(c) for c in chars))
    sub.subset(font)
    if rename:
        name = font["name"]
        name.names = [r for r in name.names if r.nameID not in DROP_IDS]
        for r in name.names:
            if r.nameID not in RENAME_IDS:
                continue
            s = r.toUnicode()
            for old, new in rename:
                s = s.replace(old, new)
            r.string = s
            if any(w in s for w in RESERVED):
                sys.exit(f"{label} 的名称记录 {r.nameID} 改名后仍含保留字体名：{s}")
    buf = BytesIO()
    subset.save_font(font, buf, opts)
    font.close()
    return buf.getvalue()


def ext_parts(f: dict, src: str, have: set[str], keep: set[str]) -> list[dict]:
    """余量：原字体减去子集已有的字（基础拉丁回退用不到），超过 8 MB 就按码位均分成几份"""
    rest = sorted(have - keep - BASE_LATIN, key=ord)
    e = f["ext"]
    parts = 1
    while True:
        chunk = (len(rest) + parts - 1) // parts
        outs = []
        for p in range(parts):
            suffix = "" if parts == 1 else str(p + 1)
            piece = set(rest[p * chunk:(p + 1) * chunk])
            rename = [(a, b + suffix) for a, b in e["rename"]]
            data = make_subset(src, piece, rename, e["out"] + suffix)
            outs.append({"out": e["out"] + suffix, "family": e["family"], "role": e["role"], "data": data, "count": len(piece)})
        if all(len(o["data"]) < MAX_BYTES for o in outs):
            return outs
        parts += 1


def unicode_ranges(chars: set[str]) -> str:
    """码位 → 合并成 U+XXXX-YYYY 段"""
    cps = sorted(ord(c) for c in chars)
    out = []
    start = prev = None
    for c in cps:
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            out.append((start, prev))
            start = prev = c
    if start is not None:
        out.append((start, prev))
    return ", ".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in out)


def build_css(entries: list[dict]) -> str:
    lines = [
        "/*",
        " * 由 scripts/web/fonts.py 生成，不要手改。打包的界面字体（SIL OFL 1.1，许可证在 public/assets/fonts/）。",
        " * unicode-range 按每个字体的实际字表：页面用到某段字时浏览器才下载那个文件（余量字体平时不下）。",
        " */",
    ]
    for e in entries:
        lines += [
            "",
            f"/* {e['role']}：{len(e['cmap'])} 个码位 */",
            "@font-face {",
            f"  font-family: \"{e['family']}\";",
            f"  src: url(\"/assets/fonts/{e['file']}\") format(\"woff2\");",
            "  font-weight: 400;",
            "  font-style: normal;",
            "  font-display: swap;",
            f"  unicode-range: {unicode_ranges(e['cmap'])};",
            "}",
        ]
    return "\n".join(lines) + "\n"


def build_notice(rows: list[str]) -> str:
    lines = [
        "灵火破晓 · 界面字体（scripts/web/fonts.py 生成，勿手改）",
        "",
        "全部字体按 SIL Open Font License 1.1 分发，许可证原文见同目录 OFL-*.txt。",
        "改动：按游戏用字裁成子集（GB2312 一级汉字 + 代码与数据里的全部文案 + 标点符号），去掉 hinting，转成 WOFF2；",
        "霞鹜文楷的 OFL 有保留字体名，子集改名为 WenKai SF / 文楷 SF，版权与许可证记录原样保留。",
        "",
    ] + rows
    return "\n".join(lines) + "\n"


def build_manifest(entries: list[dict], licenses: list[tuple[str, bytes]]) -> str:
    man = {
        "fonts": [{"file": e["file"], "family": e["family"], "origin": e["origin"], "sha256": sha256_bytes(e["data"]),
                   "glyphs": len(e["cmap"])} for e in entries],
        "licenses": [{"file": name, "sha256": sha256_bytes(data)} for name, data in licenses],
    }
    return json.dumps(man, ensure_ascii=False, indent=2) + "\n"


def lf(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n")


def read_bytes(path: str) -> bytes | None:
    if not os.path.exists(path):
        return None
    with open(path, "rb") as fh:
        return fh.read()


# ───────────────────────────── 核对（不需要原字体） ─────────────────────────────

def published() -> list[dict]:
    """按 fonts.json 读发布的字体：[{file, family, role, origin, data, cmap}]（role 按 FONTS 表还原）"""
    man = json.loads(read_text(MANIFEST))
    roles = {}
    for f in FONTS.values():
        roles[f["family"]] = f["role"]
        if f["ext"]:
            roles[f["ext"]["family"]] = f["ext"]["role"]
    out = []
    for x in man["fonts"]:
        data = read_bytes(os.path.join(OUT_DIR, x["file"]))
        out.append({**x, "role": roles.get(x["family"], x["family"]), "data": data,
                    "cmap": cmap_of(data) if data else set()})
    return out


def check(scanned: set[str]) -> int:
    problems: list[str] = []
    entries = published()
    by_family: dict[str, list[dict]] = {}
    for e in entries:
        if e["data"] is None:
            problems.append(f"{e['file']} 不存在")
            continue
        by_family.setdefault(e["family"], []).append(e)
        if sha256_bytes(e["data"]) != e["sha256"]:
            problems.append(f"{e['file']} 和 fonts.json 登记的 sha256 不一致")
    pinned = {f["family"]: f["sha256"] for f in FONTS.values()}
    pinned.update({f["ext"]["family"]: f["sha256"] for f in FONTS.values() if f["ext"]})
    for e in entries:
        if e.get("origin") != pinned.get(e["family"]):
            problems.append(f"{e['file']} 的 origin 不是 FONTS 表钉死的原字体")

    # 覆盖：想要的字 ∩ 原字体有的字 都得在子集里（余量里的字能显示，但每次要多下几 MB）
    for key in ("body", "title"):
        f = FONTS[key]
        sub = set().union(*(e["cmap"] for e in by_family.get(f["family"], [])))
        src = os.path.join(SRC_DIR, f["file"])
        if os.path.exists(src):
            have = cmap_of(src)
        else:
            # 没下原字体：正文的原字表 = 子集 ∪ 余量（余量就是原字体减子集）；标题按正文的字表近似
            body = FONTS["body"]
            have = set().union(*(e["cmap"] for fam in (body["family"], body["ext"]["family"]) for e in by_family.get(fam, [])))
        want = charset(f["charset"], scanned) & have
        miss = sorted(want - sub, key=ord)
        print(f"  {f['out']}.woff2：" + (f"缺 {len(miss)} 个字 {''.join(miss[:80])}" if miss else f"覆盖完整（{len(want)} 字）"))
        if miss:
            problems.append(f"{f['out']}.woff2 缺 {len(miss)} 个字")
    absent = sorted((ch for ch in scanned if is_hanzi(ch) and not any(ch in e["cmap"] for e in entries)), key=ord)
    if absent:
        print(f"  正文原字体也没有的汉字 {len(absent)} 个（显示走系统字体）：{''.join(absent[:40])}")

    # 发布物彼此对得上
    css = build_css([e for e in entries if e["data"] is not None]).encode("utf-8")
    if lf(read_bytes(CSS) or b"") != css:
        problems.append("src/ui/css/sf-fonts.css 和字体文件的字表对不上")
    man = json.loads(read_text(MANIFEST))
    for lic in man.get("licenses", []):
        data = read_bytes(os.path.join(OUT_DIR, lic["file"]))
        if data is None:
            problems.append(f"{lic['file']} 不存在")
        elif sha256_bytes(lf(data)) != lic["sha256"] and sha256_bytes(data) != lic["sha256"]:
            problems.append(f"{lic['file']} 和 fonts.json 登记的 sha256 不一致")
    want_lic = [f["license"][0] for f in FONTS.values()] + [NOTICE]
    if sorted(x["file"] for x in man.get("licenses", [])) != sorted(want_lic):
        problems.append(f"fonts.json 的许可证清单应为 {want_lic}")

    if problems:
        print("字体发布物有问题（跑 python scripts/web/fonts.py 重新生成）：")
        for p in problems:
            print("  " + p)
        return 1
    print("字体发布物覆盖全部用字，清单与样式表对得上")
    return 0


# ───────────────────────────── 生成 ─────────────────────────────

def generate(scanned: set[str]) -> int:
    ensure_sources()
    entries: list[dict] = []
    notice: list[str] = []
    licenses: list[tuple[str, bytes]] = []
    for f in FONTS.values():
        src = os.path.join(SRC_DIR, f["file"])
        have = cmap_of(src)
        keep = charset(f["charset"], scanned) & have
        absent = sorted((ch for ch in charset(f["charset"], scanned) - have if is_hanzi(ch)), key=ord)
        data = make_subset(src, keep, f["rename"], f["out"])
        if len(data) >= MAX_BYTES:
            sys.exit(f"{f['out']}.woff2 超过 8 MB（{len(data) / 1048576:.2f} MB）：缩小字表")
        entries.append({"file": f["out"] + ".woff2", "family": f["family"], "role": f["role"], "origin": f["sha256"],
                        "data": data, "cmap": cmap_of(data)})
        print(f"{f['out']}.woff2：{len(keep)} 字 → {len(data) / 1048576:.2f} MB" +
              (f"（原字体没有的汉字 {len(absent)} 个：{''.join(absent[:40])}）" if absent else ""))
        notice.append(f"{f['out']}.woff2  ←  {f['origin']}，{len(keep)} 字，原文件 sha256 {f['sha256']}，许可证 {f['license'][0]}")
        if f["ext"]:
            for part in ext_parts(f, src, have, keep):
                entries.append({"file": part["out"] + ".woff2", "family": part["family"], "role": part["role"],
                                "origin": f["sha256"], "data": part["data"], "cmap": cmap_of(part["data"])})
                print(f"{part['out']}.woff2：余量 {part['count']} 字 → {len(part['data']) / 1048576:.2f} MB")
                notice.append(f"{part['out']}.woff2  ←  同上，子集之外的其余 {part['count']} 字（回退用，用到才下载）")
        with open(os.path.join(SRC_DIR, f["license"][0]), "rb") as fh:
            licenses.append((f["license"][0], lf(fh.read())))
    notice_bytes = build_notice(notice).encode("utf-8")
    licenses.append((NOTICE, notice_bytes))

    writes: list[tuple[str, bytes]] = [(os.path.join(OUT_DIR, e["file"]), e["data"]) for e in entries]
    writes += [(os.path.join(OUT_DIR, name), data) for name, data in licenses]
    writes.append((MANIFEST, build_manifest(entries, licenses).encode("utf-8")))
    writes.append((CSS, build_css(entries).encode("utf-8")))
    os.makedirs(OUT_DIR, exist_ok=True)
    keep_files = {os.path.normcase(p) for p, _ in writes}
    for old in os.listdir(OUT_DIR):
        p = os.path.join(OUT_DIR, old)
        if old.endswith(".woff2") and os.path.normcase(p) not in keep_files:
            os.remove(p)  # 余量分份数变了留下的旧文件
            print("删了 " + os.path.relpath(p, REPO).replace("\\", "/"))
    for path, data in writes:
        old = read_bytes(path)
        if old is not None and (lf(old) == lf(data) if not path.endswith(".woff2") else old == data):
            continue
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
        print("写了 " + os.path.relpath(path, REPO).replace("\\", "/"))
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", action="store_true", help="只统计用字，不写文件")
    ap.add_argument("--check", action="store_true", help="只核对发布物（不写、不需要原字体）")
    a = ap.parse_args()

    scanned, counts, by_kind = scan()
    cjk = {ch for ch in scanned if is_hanzi(ch)}
    print(f"扫描：TS {counts['ts']} 个、CSS {counts['css']} 个、HTML {counts['html']} 个、数据 JSON {counts['json']} 个文件；"
          f"非 ASCII 字符 {len(scanned)} 个，其中汉字 {len(cjk)} 个（GB2312 一级之外 {len(cjk - LEVEL1)} 个）")
    if a.report:
        for k, s in by_kind.items():
            only = {ch for ch in s if is_hanzi(ch)} - LEVEL1 - set().union(*(v for kk, v in by_kind.items() if kk != k))
            print(f"  {k}：{len(s)} 个字符；一级字之外、只在这一类里出现的汉字 {len(only)} 个 {''.join(sorted(only, key=ord)[:60])}")
        return 0
    if a.check:
        return check(scanned)
    return generate(scanned)


if __name__ == "__main__":
    sys.exit(main())
