"""打包字体子集化（docs/unity-parity.md D18 / U1）：下载 OFL 原字体 → 按字表裁成子集 → 写进 Unity 的 Resources/UI/Fonts。

    python scripts/unity/subset_fonts.py              # 缺原字体就下载，然后重新生成全部子集
    python scripts/unity/subset_fonts.py --report     # 只扫描字表、打印统计，不写文件
    python scripts/unity/subset_fonts.py --check      # 已入库的子集是否覆盖当前代码里的全部中文字面量（缺字时退出码 1）

三套字体（都来自官方 GitHub 发布，版本与 SHA-256 钉死在 FONTS 表里）：
    正文 Noto Sans SC Regular         notofonts/noto-cjk  Sans2.004  Sans/SubsetOTF/SC
    标题 霞鹜文楷 LXGW WenKai Medium   lxgw/LxgwWenKai     v1.530     发布附件
    数字 Barlow Condensed SemiBold    jpt/barlow          1.422      fonts/ttf
原字体下载到 unity/Library/FontSources/（Library 不入库；丢了会按钉死的地址重新下载并校验 SHA-256）。

字表（正文 / 标题）：ASCII + Latin-1 + 常用标点 / 箭头 / 几何符号 + CJK 标点 + 全角字符 + GB2312 第 1–3 区符号 + GB2312 一级汉字（3755）
+ 扫描 unity/Assets/**/*.cs 与 src/**/*.ts 里注释以外出现的全部非 ASCII 字符（代码标识符都是 ASCII，所以就是字符串 / 字符 / 模板字面量），
外加 unity/Assets/Game/Resources 下 .json / .uxml / .uss / .txt 的全部字符。
数字字体只要 ASCII + Latin-1 + 几个符号（× · − ％ ↑ ↓ …），中文靠回退。

动态回退：正文另出一份「余量」文件 NotoSansSC-Regular-Ext.otf = 原字体减去子集已有的字（不重复），
UIBuilder 建的 FontAsset 回退链是  标题 / 数字 → 正文子集 → 正文余量，所以子集之外的字（以后新写的文案忘了重跑本脚本）
照样能显示，只是第一次出现时现生成字形。余量超过 8 MB 时按码位切成几份（-Ext1、-Ext2…）。
每个输出文件都必须 < 8 MB；同目录放各字体的 OFL 许可证文本和 FONTS-NOTICE.txt（来源、版本、改动）。

许可：霞鹜文楷的 OFL 声明了保留字体名（'霞鹜' '霞鶩' '落霞孤鹜' '落霞孤鶩' 'LXGW'），附加许可只放宽到网页字体，
游戏里打包子集属于「修改版」，所以子集改名为 WenKai SF / 文楷 SF（文件 WenKaiSF-Medium.ttf），版权与许可证记录原样保留。
Noto 与 Barlow 没有保留字体名，沿用原名。

写完字体后在主工作区跑 bash scripts/unity/bridge.sh ui，让 UIBuilder 重建 FontAsset 与 PanelSettings。
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
UNITY = os.path.join(REPO, "unity")
SRC_DIR = os.path.join(UNITY, "Library", "FontSources")
OUT_DIR = os.path.join(UNITY, "Assets", "Game", "Resources", "UI", "Fonts")
MAX_BYTES = 8 * 1024 * 1024

# 原字体。rename：名称表里的替换（保留字体名不能出现在修改版里）；ext：另出余量文件做动态回退
FONTS = {
    "body": {
        "file": "NotoSansSC-Regular.otf",
        "url": "https://github.com/notofonts/noto-cjk/raw/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
        "sha256": "faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9",
        "license": ("OFL-NotoSansSC.txt", "https://github.com/notofonts/noto-cjk/raw/Sans2.004/LICENSE"),
        "origin": "Noto Sans SC Regular 2.004（notofonts/noto-cjk 标签 Sans2.004，Sans/SubsetOTF/SC）",
        "charset": "cjk",
        "out": "NotoSansSC-Regular.otf",
        "rename": [],
        "ext": [("Noto Sans SC", "Noto Sans SC Ext"), ("NotoSansSC-Regular", "NotoSansSC-Regular-Ext")],
    },
    "title": {
        "file": "LXGWWenKai-Medium.ttf",
        "url": "https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Medium.ttf",
        "sha256": "f4b8a34d1f838fe411540cb7c97b1c384ac9738a876c4104500bc42508b2312a",
        "license": ("OFL-LXGWWenKai.txt", "https://github.com/lxgw/LxgwWenKai/raw/v1.530/OFL.txt"),
        "origin": "LXGW WenKai Medium 1.530（lxgw/LxgwWenKai 发布 v1.530）",
        "charset": "cjk",
        "out": "WenKaiSF-Medium.ttf",
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
        "out": "BarlowCondensed-SemiBold.ttf",
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
    req = urllib.request.Request(url, headers={"User-Agent": "spiritfire-subset-fonts"})
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
        if f["sha256"] and digest != f["sha256"]:
            sys.exit(f"{f['file']} 的 SHA-256 不对（{digest}）：删掉 {path} 重新下载，或核对 FONTS 表里的版本")
        if not f["sha256"]:
            print(f"  {f['file']} sha256 = {digest}（填进 FONTS 表）")
        lic_name, lic_url = f["license"]
        if not os.path.exists(os.path.join(SRC_DIR, lic_name)):
            fetch(lic_url, os.path.join(SRC_DIR, lic_name))


# ───────────────────────────── 字表 ─────────────────────────────

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


def strip_comments(text: str, lang: str) -> str:
    """去掉注释，保留代码与字符串。逐字符走：识别字符串（C# 逐字 / 原始字符串、TS 模板），字符串里的 // 不当注释"""
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
        if lang == "cs" and text.startswith('"""', i):
            # 原始字符串 """…"""：以同样多的引号结束
            k = i
            while k < n and text[k] == '"':
                k += 1
            j = text.find(text[i:k], k)
            j = n if j < 0 else j + (k - i)
            out.append(text[i:j])
            i = j
            continue
        if lang == "cs" and ((c == "@" and nxt == '"') or (c in "$@" and nxt in "$@" and text[i + 2:i + 3] == '"')):
            # 逐字字符串 @"…" / $@"…" / @$"…"：两个引号是转义
            j = text.find('"', i) + 1
            while j < n:
                if text[j] == '"':
                    if j + 1 < n and text[j + 1] == '"':
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(text[i:j])
            i = j
            continue
        if c in ('"', "'") or (lang == "ts" and c == "`"):
            j = i + 1
            while j < n and text[j] != c:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "\n" and c != "`":
                    break  # 没闭合（误判）：到行尾为止
                j += 1
            out.append(text[i:j + 1])
            i = j + 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def usable(ch: str) -> bool:
    o = ord(ch)
    # 控制字符、私用区、BOM、代理对残片不要
    return o > 0x7E and not (0x7F <= o < 0xA0 or 0xE000 <= o <= 0xF8FF or o == 0xFEFF or 0xD800 <= o <= 0xDFFF)


def scan_literals() -> tuple[set[str], dict[str, int]]:
    """代码字面量与 Resources 文本里的全部非 ASCII 字符；返回（字符集，每类文件数）"""
    chars: set[str] = set()
    counts = {"cs": 0, "ts": 0, "res": 0}
    for root, ext, lang in ((os.path.join(UNITY, "Assets"), ".cs", "cs"), (os.path.join(REPO, "src"), ".ts", "ts")):
        for dirpath, dirnames, files in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", "Library", "Temp")]
            for name in files:
                if name.endswith(ext):
                    with open(os.path.join(dirpath, name), encoding="utf-8", errors="replace") as fh:
                        chars.update(ch for ch in strip_comments(fh.read(), lang) if usable(ch))
                    counts[lang] += 1
    for dirpath, _, files in os.walk(os.path.join(UNITY, "Assets", "Game", "Resources")):
        for name in files:
            if name.endswith((".json", ".uxml", ".uss", ".txt")) and not name.startswith(("OFL-", "FONTS-")):
                with open(os.path.join(dirpath, name), encoding="utf-8", errors="replace") as fh:
                    chars.update(ch for ch in fh.read() if usable(ch))
                counts["res"] += 1
    return chars, counts


def charset(kind: str, scanned: set[str]) -> set[str]:
    if kind == "latin":
        return BASE_LATIN | NUMBER_EXTRA
    return BASE_LATIN | SYMBOLS | gb2312_chars(range(1, 4)) | LEVEL1 | scanned


# ───────────────────────────── 子集化 ─────────────────────────────

def cmap_chars(path: str) -> set[str]:
    font = TTFont(path, lazy=True)
    out = {chr(c) for c in font.getBestCmap()}
    font.close()
    return out


def make_subset(src: str, dst: str, chars: set[str], rename: list[tuple[str, str]]) -> int:
    opts = subset.Options()
    opts.layout_features = ["*"]       # 保留字距 / 标点挤压等特性
    opts.name_IDs = ["*"]              # 版权、许可证等名称记录原样保留
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False               # SDF 用不到 hinting
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
                sys.exit(f"{os.path.basename(dst)} 的名称记录 {r.nameID} 改名后仍含保留字体名：{s}")
    subset.save_font(font, dst, opts)
    font.close()
    return os.path.getsize(dst)


def write_ext(f: dict, src: str, have: set[str], keep: set[str]) -> list[tuple[str, int, int]]:
    """余量：原字体减去子集已有的字（基础拉丁回退用不到），超过 8 MB 就按码位均分成几份"""
    rest = sorted(have - keep - BASE_LATIN, key=ord)
    stem, ext = os.path.splitext(f["out"])
    for old in os.listdir(OUT_DIR):
        if old.startswith(stem + "-Ext") and old.endswith(ext):
            os.remove(os.path.join(OUT_DIR, old))
    parts = 1
    while True:
        chunk = (len(rest) + parts - 1) // parts
        outs = []
        for p in range(parts):
            name = f"{stem}-Ext{'' if parts == 1 else p + 1}{ext}"
            piece = set(rest[p * chunk:(p + 1) * chunk])
            suffix = "" if parts == 1 else str(p + 1)
            rename = [(a, b + suffix) for a, b in f["ext"]]
            outs.append((name, make_subset(src, os.path.join(OUT_DIR, name), piece, rename), len(piece)))
        if all(sz < MAX_BYTES for _, sz, _ in outs):
            return outs
        for name, _, _ in outs:
            os.remove(os.path.join(OUT_DIR, name))
        parts += 1


def write_notice(rows: list[str]) -> None:
    lines = [
        "灵火破晓 · 界面字体（scripts/unity/subset_fonts.py 生成，勿手改）",
        "",
        "全部字体按 SIL Open Font License 1.1 分发，许可证原文见同目录 OFL-*.txt。",
        "改动：按游戏用字裁成子集（GB2312 一级汉字 + 代码里的全部文案 + 标点符号），去掉 hinting；",
        "霞鹜文楷的 OFL 有保留字体名，子集改名为 WenKai SF / 文楷 SF，版权与许可证记录原样保留。",
        "",
    ] + rows
    with open(os.path.join(OUT_DIR, "FONTS-NOTICE.txt"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="只统计，不写文件")
    ap.add_argument("--check", action="store_true", help="检查已入库子集是否覆盖当前字面量")
    a = ap.parse_args()

    scanned, counts = scan_literals()
    cjk = {ch for ch in scanned if 0x3400 <= ord(ch) <= 0x9FFF or 0xF900 <= ord(ch) <= 0xFAFF}
    print(f"扫描：C# {counts['cs']} 个、TS {counts['ts']} 个、Resources 文本 {counts['res']} 个文件；"
          f"非 ASCII 字符 {len(scanned)} 个，其中汉字 {len(cjk)} 个（GB2312 一级之外 {len(cjk - LEVEL1)} 个）")

    if a.check:
        missing = 0
        for f in FONTS.values():
            out = os.path.join(OUT_DIR, f["out"])
            if not os.path.exists(out):
                print(f"  {f['out']}：不存在")
                missing += 1
                continue
            if f["charset"] != "cjk":
                continue
            want = charset("cjk", scanned)
            src = os.path.join(SRC_DIR, f["file"])
            if os.path.exists(src):
                want &= cmap_chars(src)  # 原字体本来就没有的字（emoji 等）不算缺
            miss = sorted(want - cmap_chars(out))
            missing += len(miss)
            print(f"  {f['out']}：" + (f"缺 {len(miss)} 个字 {''.join(miss[:80])}" if miss else "覆盖完整"))
        return 1 if missing else 0

    if a.report:
        return 0

    ensure_sources()
    os.makedirs(OUT_DIR, exist_ok=True)
    notice = []
    for f in FONTS.values():
        src = os.path.join(SRC_DIR, f["file"])
        have = cmap_chars(src)
        want = charset(f["charset"], scanned)
        keep = want & have
        absent = sorted(ch for ch in want - have if 0x3400 <= ord(ch) <= 0x9FFF)
        size = make_subset(src, os.path.join(OUT_DIR, f["out"]), keep, f["rename"])
        if size >= MAX_BYTES:
            sys.exit(f"{f['out']} 超过 8 MB（{size / 1048576:.2f} MB）：缩小字表")
        print(f"{f['out']}：{len(keep)} 字 → {size / 1048576:.2f} MB" +
              (f"（原字体没有的汉字 {len(absent)} 个：{''.join(absent[:40])}）" if absent else ""))
        notice.append(f"{f['out']}  ←  {f['origin']}，{len(keep)} 字，原文件 sha256 {f['sha256']}，许可证 {f['license'][0]}")
        if f["ext"]:
            for name, sz, n in write_ext(f, src, have, keep):
                print(f"{name}：余量 {n} 字 → {sz / 1048576:.2f} MB")
                notice.append(f"{name}  ←  同上，子集之外的其余 {n} 字（动态回退用）")
        lic_name = f["license"][0]
        with open(os.path.join(SRC_DIR, lic_name), "rb") as fh:
            data = fh.read()
        with open(os.path.join(OUT_DIR, lic_name), "wb") as fh:
            fh.write(data)
    write_notice(notice)
    print(f"输出：{OUT_DIR}")
    print("下一步（主工作区）：bash scripts/unity/bridge.sh ui")
    return 0


if __name__ == "__main__":
    sys.exit(main())
