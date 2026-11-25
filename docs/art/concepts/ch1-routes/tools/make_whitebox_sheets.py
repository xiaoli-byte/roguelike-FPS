"""第一章白盒对照图：每张图一张——左上路线概念图、右上白盒同机位（探针实测的路线）、左下俯视、右下探针结果、底下一排玩家视角。

用法（仓库根目录，先跑探针和截图）：
  node scripts/desert/whitebox-probe.mjs --json docs/art/concepts/ch1-routes/whitebox/probe.json
  node scripts/desert/whitebox-shots.mjs 5199 docs/art/concepts/ch1-routes/whitebox
  python docs/art/concepts/ch1-routes/tools/make_whitebox_sheets.py
输出 whitebox/<图>_whitebox.jpg。
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent.parent
WB = HERE / "whitebox"
FONT_DIRS = [Path("H:/Windows/Fonts"), Path("C:/Windows/Fonts")]
BG, INK, DIM, GOLD, OK, BAD = (22, 21, 26), (238, 232, 220), (168, 160, 148), (245, 196, 60), (143, 209, 138), (255, 138, 122)
CONCEPT = {"1-1": "raw/1-1_v4.png", "1-2": "raw/1-2_v3.png", "1-3": "raw/1-3_v2.png", "1-4": "raw/1-4_v3.png", "1-A": "raw/1-A_v3.png"}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for d in FONT_DIRS:
        for name in (["msyhbd.ttc"] if bold else []) + ["msyh.ttc", "simhei.ttf"]:
            if (d / name).exists():
                return ImageFont.truetype(str(d / name), size)
    return ImageFont.load_default()


def wrap(d: ImageDraw.ImageDraw, text: str, f, width: int) -> list[str]:
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=f) > width and cur:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def fit(path: Path, w: int, h: int) -> Image.Image:
    im = Image.open(path).convert("RGB")
    im.thumbnail((w, h), Image.LANCZOS)
    out = Image.new("RGB", (w, h), (30, 29, 34))
    out.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return out


def sheet(mid: str, report: dict) -> Image.Image:
    W, pad, cw, ch = 1600, 20, 780, 520
    f_t, f_h, f_b, f_s = font(34, True), font(20, True), font(17), font(15)
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    # 右下文字：走法表 + 点位检查
    lines: list[tuple[str, tuple[int, int, int], ImageFont.FreeTypeFont]] = []
    lines.append((f"可走面积 {round(report['walkArea'])} m²（占全图 {round(report['walkShare'] * 100)}%）", DIM, f_s))
    lines.append(("走法（探针在 0.5 m 行走面上实测）", GOLD, f_h))
    for r in report["routes"]:
        head = f"{'√' if r['ok'] else '×'} {'主线' if r['kind'] == 'main' else '侧翼 ' + r['id']}　{r['length']:.0f} m · 跑 {r['seconds']:.0f} s · 最陡 {r['maxSlope']:.0f}° · 最窄 {r['minWidth']:.1f} m · 爬升 {r['climb']:.0f} m"
        lines.append((head, OK if r["ok"] else BAD, f_b))
        for t in wrap(probe, r["name"] + ("　问题：" + "；".join(r["problems"]) if r["problems"] else ""), f_s, cw - 40):
            lines.append(("　" + t, DIM if r["ok"] else BAD, f_s))
    lines.append(("点位", GOLD, f_h))
    for kind in ["据点", "驻守点", "藏宝", "出口", "补给营", "首领", "俯射位", "荫蔽", "召唤点", "入场点", "视线"]:
        rows = [x for x in report["rows"] if x["kind"] == kind]
        if not rows:
            continue
        good = [x for x in rows if x["ok"]]
        if kind in ("据点", "视线", "入场点"):
            for x in rows:
                for k, t in enumerate(wrap(probe, f"{'√' if x['ok'] else '×'} {kind} {x['id']} {x['name']}：{x['detail']}", f_s, cw - 20)):
                    lines.append((("" if k == 0 else "　") + t, INK if x["ok"] else BAD, f_s))
        else:
            lines.append((f"{'√' if len(good) == len(rows) else '×'} {kind} {len(good)}/{len(rows)} 走得到" + ("" if len(good) == len(rows) else "：" + "、".join(x["id"] for x in rows if not x["ok"]) + " 走不到"), INK if len(good) == len(rows) else BAD, f_s))
    text_h = sum(f.size + 7 for _, _, f in lines) + 10
    row2 = max(ch, text_h)
    strip = [n for n in ["spawn", "s1", "sB", "s2", "s3", "s4", "exit"] if (WB / f"{mid}_{n}.jpg").exists()]
    sw = (W - pad * (len(strip) + 1)) // max(1, len(strip)) if strip else 0
    sh = int(sw * 2 / 3)
    H = 70 + ch + 36 + row2 + (sh + 60 if strip else 0) + pad * 3
    out = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(out)
    title = f"{report['id']} {report['name']} · 白盒"
    d.text((pad, 16), title, font=f_t, fill=INK)
    verdict = "探针全部通过" if not report["failures"] else f"探针 {report['failures']} 项不通过"
    d.text((pad + d.textlength(title, font=f_t) + 24, 28), verdict, font=f_h, fill=OK if not report["failures"] else BAD)
    y = 70
    out.paste(fit(HERE / CONCEPT[mid], cw, ch), (pad, y))
    out.paste(fit(WB / f"{mid}_concept.jpg", cw, ch), (pad * 2 + cw, y))
    d.text((pad, y + ch + 6), "路线概念图（ChatGPT 出图，线是示意）", font=f_s, fill=DIM)
    d.text((pad * 2 + cw, y + ch + 6), "白盒同机位（线是探针实测寻路的结果：图上有线 = 真走得通）", font=f_s, fill=DIM)
    y += ch + 36
    out.paste(fit(WB / f"{mid}_top.jpg", cw, row2), (pad, y))
    ty = y + 4
    for text, col, f in lines:
        d.text((pad * 2 + cw, ty), text, font=f, fill=col)
        ty += f.size + 7
    y += row2 + pad
    if strip:
        names = {"spawn": "出生第一眼", "s1": "① 进场", "sB": "首领 · 进场处看泉心", "s2": "② 进场", "s3": "③ 进场", "s4": "④ 进场", "exit": "出口"}
        d.text((pad, y), "玩家视角（眼高 1.6 m，主线上离目标 32 m 处看过去）", font=f_s, fill=DIM)
        y += 26
        for k, n in enumerate(strip):
            x = pad + k * (sw + pad)
            out.paste(fit(WB / f"{mid}_{n}.jpg", sw, sh), (x, y))
            d.text((x + 4, y + sh + 4), names[n], font=f_s, fill=INK)
    return out


def main() -> None:
    reports = json.loads((WB / "probe.json").read_text(encoding="utf-8"))
    for mid, report in reports.items():
        if not (WB / f"{mid}_concept.jpg").exists():
            print(mid, "没有截图，跳过")
            continue
        img = sheet(mid, report)
        img.save(WB / f"{mid}_whitebox.jpg", quality=90)
        print(f"{mid}_whitebox.jpg", img.size)


if __name__ == "__main__":
    main()
