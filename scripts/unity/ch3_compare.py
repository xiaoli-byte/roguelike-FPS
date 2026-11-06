"""第三章 v2 重做的改前 / 改后对比图（ch3-v2.md 7.2 S7、7.4「对比图」）。

目录约定（每张图一个，3-1…3-4）：
    docs/art/review/ch3-v2/<图>/before/   改前（已留存：N_名字.jpg、map.jpg、map.json、report.txt）
    docs/art/review/ch3-v2/<图>/after/    改后（用 collect 从本次构建的 _Review 截图拷过来）
    docs/art/review/ch3-v2/<图>/pairs.txt 可选：指定配对与标题（见下）
    docs/art/review/ch3-v2/<图>/compare/  输出：每组一张左右对照 NN-名字.jpg
    docs/art/review/ch3-v2/<图>/<图>-compare.jpg  输出：总览（全部组的缩略对照）
    docs/art/review/ch3-v2/<图>/<图>-compare-gray.jpg  输出：总览的灰度版（去掉颜色看明暗：焦点 / 剪影读不读得出）

用法：
    python scripts/unity/ch3_compare.py collect 3-4     # 拷改后图：unity/Assets/Art/_Review/level_3-4_* → after/（PNG 转 JPG、宽 ≤ 1600）
    python scripts/unity/ch3_compare.py 3-4 --list      # 只列配对结果，不出图
    python scripts/unity/ch3_compare.py 3-4             # 出对照图 + 总览
    python scripts/unity/ch3_compare.py all             # 四张图都出（缺 after/ 的跳过）

collect 只拷和 level_<图>_report.txt 同一次构建的截图（修改时间在报告前后 20 分钟内），旧构建留下的同前缀截图不拷；
--all 关掉这个过滤。拷之前会清空 after/ 里的 .jpg（只清这一个目录）。

配对规则：
  1. pairs.txt 里的每一行按顺序在前：`改前名 | 改后名 | 标题`（名字不带扩展名、编号前缀可省，# 开头是注释）。
     一边写 `-` 表示这一组只有一张（例如改后新增的场地，改前没有对应机位）。
  2. 其余按「去掉编号前缀后同名」自动配对（3_Spawn ↔ 4_Spawn；不分大小写）；俯视图 map ↔ map 单独配。
  3. 两边都没配上的图在 --list 里列出来，方便补 pairs.txt。

输出全是 JPG、宽 ≤ 1600。
"""
import argparse
import os
import re
import shutil
import sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
REVIEW = os.path.join(ROOT, "unity", "Assets", "Art", "_Review")
BASE = os.path.join(ROOT, "docs", "art", "review", "ch3-v2")
MAPS = ("3-1", "3-2", "3-3", "3-4")
MAX_W = 1600
GAP = 8
BG = (18, 16, 22)
INK = (240, 232, 220)
SUB = (205, 196, 182)
TAG_BEFORE = (150, 140, 128)
TAG_AFTER = (255, 196, 120)
IMG_EXT = (".jpg", ".jpeg", ".png")


def font(size):
    for name in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf", "simsun.ttc"):
        p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def key_of(stem: str) -> str:
    """配对键：去掉编号前缀、小写；没有编号前缀的（map）加 @ 区分，免得 map 和 2_Map 撞上"""
    m = re.match(r"^\d+[_-](.+)$", stem)
    return m.group(1).lower() if m else "@" + stem.lower()


def images(folder: str) -> dict:
    """目录里的图：名字（不带扩展名）→ 路径"""
    if not os.path.isdir(folder):
        return {}
    out = {}
    for f in sorted(os.listdir(folder)):
        stem, ext = os.path.splitext(f)
        if ext.lower() in IMG_EXT:
            out[stem] = os.path.join(folder, f)
    return out


def find(imgs: dict, name: str):
    """按名字找图：先精确，再按配对键（编号前缀可省）"""
    if name in ("", "-"):
        return None
    if name in imgs:
        return name
    k = key_of(name) if re.match(r"^\d+[_-]", name) else name.lower()
    for stem in imgs:
        if key_of(stem) == k or key_of(stem) == "@" + k:
            return stem
    return None


def read_pairs(folder: str):
    p = os.path.join(folder, "pairs.txt")
    rows = []
    if not os.path.exists(p):
        return rows
    with open(p, encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [s.strip() for s in line.split("|")]
            if len(parts) < 2:
                print(f"pairs.txt 第 {n} 行格式不对（要 改前名 | 改后名 | 标题）：{line}")
                continue
            rows.append((parts[0], parts[1], parts[2] if len(parts) > 2 else ""))
    return rows


def plan(map_id: str):
    """配对结果：[(标题, 改前路径或 None, 改后路径或 None, 输出名)]，以及两边没配上的名字"""
    folder = os.path.join(BASE, map_id)
    before, after = images(os.path.join(folder, "before")), images(os.path.join(folder, "after"))
    used_b, used_a, pairs = set(), set(), []
    for b_name, a_name, title in read_pairs(folder):
        b, a = find(before, b_name), find(after, a_name)
        if b_name not in ("", "-") and b is None:
            print(f"[{map_id}] pairs.txt：改前没有「{b_name}」")
        if a_name not in ("", "-") and a is None:
            print(f"[{map_id}] pairs.txt：改后没有「{a_name}」")
        if b is None and a is None:
            continue
        used_b.add(b)
        used_a.add(a)
        slug = key_of(a or b).lstrip("@")
        pairs.append((title or slug, before.get(b), after.get(a), slug))
    by_key = {}
    for stem in after:
        if stem not in used_a:
            by_key.setdefault(key_of(stem), stem)
    for stem in before:
        if stem in used_b:
            continue
        a = by_key.pop(key_of(stem), None)
        if a is None:
            continue
        used_b.add(stem)
        used_a.add(a)
        slug = key_of(a).lstrip("@")
        title = "俯视图" if slug == "map" else slug
        pairs.append((title, before[stem], after[a], slug))
    # 俯视图排最前，其余保持 pairs.txt 顺序 → 自动配对按改后编号
    def order(p):
        num = re.match(r"^(\d+)[_-]", os.path.splitext(os.path.basename(p[2] or p[1]))[0])
        return (0 if p[3] == "map" else 1, int(num.group(1)) if num else 0)
    explicit = len(read_pairs(folder))
    pairs = pairs[:explicit] + sorted(pairs[explicit:], key=order)
    lone_b = [s for s in before if s not in used_b]
    lone_a = [s for s in after if s not in used_a]
    return pairs, lone_b, lone_a


def fit(path, w):
    im = Image.open(path).convert("RGB")
    return im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)


def placeholder(w, h, text, f):
    im = Image.new("RGB", (w, h), (34, 30, 38))
    d = ImageDraw.Draw(im)
    d.text((w // 2, h // 2), text, font=f, fill=SUB, anchor="mm")
    return im


def pair_sheet(title, b_path, a_path, width, title_f, cap_f, show_names=True):
    """一组左右对照：上标题，下两格（改前 / 改后），每格下面一行说明"""
    cell = (width - GAP) // 2
    ims = [fit(p, cell) if p else None for p in (b_path, a_path)]
    h = max((i.height for i in ims if i is not None), default=cell * 9 // 16)
    ims = [i if i is not None else placeholder(cell, h, "（无对应机位）", cap_f) for i in ims]
    th = title_f.size + 18
    ch = cap_f.size + 14
    sheet = Image.new("RGB", (width, th + h + ch), BG)
    d = ImageDraw.Draw(sheet)
    d.text((10, 8), title, font=title_f, fill=INK)
    for k, (im, path, tag, col) in enumerate(zip(ims, (b_path, a_path), ("改前", "改后"), (TAG_BEFORE, TAG_AFTER))):
        x = k * (cell + GAP)
        sheet.paste(im, (x, th + (h - im.height) // 2))
        name = os.path.splitext(os.path.basename(path))[0] if path else "—"
        d.text((x + 8, th + h + 5), f"{tag}" + (f" · {name}" if show_names else ""), font=cap_f, fill=col)
    return sheet


def compare(map_id: str, list_only=False) -> int:
    folder = os.path.join(BASE, map_id)
    if not os.path.isdir(os.path.join(folder, "after")):
        print(f"[{map_id}] 没有 after/，跳过（先 collect {map_id}）")
        return 0
    pairs, lone_b, lone_a = plan(map_id)
    print(f"[{map_id}] {len(pairs)} 组：")
    for k, (title, b, a, slug) in enumerate(pairs, 1):
        bn = os.path.basename(b) if b else "—"
        an = os.path.basename(a) if a else "—"
        print(f"  {k:02d} {title}：{bn} ↔ {an}")
    if lone_b:
        print(f"  改前没配上：{', '.join(lone_b)}")
    if lone_a:
        print(f"  改后没配上：{', '.join(lone_a)}")
    if list_only or not pairs:
        return len(pairs)

    out_dir = os.path.join(folder, "compare")
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.lower().endswith(".jpg"):
            os.remove(os.path.join(out_dir, f))
    big_t, big_c = font(28), font(20)
    for k, (title, b, a, slug) in enumerate(pairs, 1):
        sheet = pair_sheet(title, b, a, MAX_W, big_t, big_c)
        p = os.path.join(out_dir, f"{k:02d}-{slug}.jpg")
        sheet.save(p, quality=88)
    print(f"  → {out_dir}（{len(pairs)} 张）")

    # 总览：每行两组（每组左右两格），宽 1600
    small_t, small_c = font(20), font(15)
    half = (MAX_W - GAP * 3) // 2
    tiles = [pair_sheet(f"{k:02d} {t}", b, a, half, small_t, small_c, show_names=False) for k, (t, b, a, _) in enumerate(pairs, 1)]
    head = 64
    rows = [tiles[i:i + 2] for i in range(0, len(tiles), 2)]
    total_h = head + sum(max(t.height for t in r) + GAP * 2 for r in rows)
    ov = Image.new("RGB", (MAX_W, total_h), (10, 9, 12))
    d = ImageDraw.Draw(ov)
    d.text((14, 12), f"第三章 v2 · {map_id} 改前 / 改后（{len(pairs)} 组；每组左改前、右改后）", font=font(30), fill=INK)
    y = head
    for r in rows:
        for j, t in enumerate(r):
            ov.paste(t, (GAP + j * (half + GAP), y))
        y += max(t.height for t in r) + GAP * 2
    p = os.path.join(folder, f"{map_id}-compare.jpg")
    ov.save(p, quality=85)
    print(f"  → {p}（{ov.width}×{ov.height}）")
    # 灰度版：只看明暗（构图的焦点、大剪影和留白在没有颜色时还读不读得出）
    g = os.path.join(folder, f"{map_id}-compare-gray.jpg")
    ImageOps.grayscale(ov).save(g, quality=85)
    print(f"  → {g}（灰度）")
    return len(pairs)


def collect(map_id: str, keep_all=False) -> int:
    prefix = f"level_{map_id}_"
    report = os.path.join(REVIEW, f"{prefix}report.txt")
    if not os.path.exists(report):
        print(f"没有 {report}：先跑 bash scripts/unity/bridge.sh level {map_id}")
        return 0
    ref = os.path.getmtime(report)
    out = os.path.join(BASE, map_id, "after")
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.lower().endswith((".jpg", ".json", ".txt")):
            os.remove(os.path.join(out, f))
    n, stale = 0, []
    for f in sorted(os.listdir(REVIEW)):
        if not f.startswith(prefix) or f.endswith(".meta"):
            continue
        src = os.path.join(REVIEW, f)
        rest = f[len(prefix):]
        stem, ext = os.path.splitext(rest)
        if not keep_all and abs(os.path.getmtime(src) - ref) > 20 * 60:
            stale.append(rest)
            continue
        if ext.lower() == ".png":
            im = Image.open(src).convert("RGB")
            if im.width > MAX_W:
                im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
            im.save(os.path.join(out, stem + ".jpg"), quality=88)
            n += 1
        elif rest in ("map.json", "report.txt"):
            shutil.copyfile(src, os.path.join(out, rest))
    if stale:
        print(f"  跳过旧构建留下的：{', '.join(stale)}（--all 照拷）")
    print(f"[{map_id}] 拷了 {n} 张图 → {out}")
    return n


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", help="collect / 图号（3-1…3-4）/ all")
    ap.add_argument("map", nargs="?", help="collect 的图号")
    ap.add_argument("--list", action="store_true", help="只列配对结果")
    ap.add_argument("--all", action="store_true", help="collect 时不按构建时间过滤")
    a = ap.parse_args()
    if a.cmd == "collect":
        if a.map not in MAPS:
            ap.error(f"collect 要给图号：{' / '.join(MAPS)}")
        return 0 if collect(a.map, a.all) else 1
    targets = MAPS if a.cmd == "all" else (a.cmd,)
    if any(t not in MAPS for t in targets):
        ap.error(f"图号只认 {' / '.join(MAPS)} 或 all")
    made = sum(compare(t, a.list) for t in targets)
    return 0 if made else 1


if __name__ == "__main__":
    sys.exit(main())
