"""把固定机位性能基线（bridge.sh playtest perf / perf-ch1 / perf-ch2 / perf-ch3 写的 unity/Assets/Art/_Review/perf_<关卡>.json）拼成 Markdown 表，
贴进 docs/performance-unity.md。协议见那份文档。本机基线入库在 art/reviews/perf-unity-20261030-rtx3070/。

    python scripts/unity/perf_table.py                       # 读 _Review/perf_*.json，每关每档一行（各机位均值 / 最重机位）
    python scripts/unity/perf_table.py --views               # 每个机位一行
    python scripts/unity/perf_table.py --dir <目录> --prefix perfcull --config 剔除关,当前   # 对照套件：两种配置并排（改前 → 改后）
    python scripts/unity/perf_table.py --summary             # 每档各项的最大值（预算用）

只读 JSON，不改任何东西。
"""
import argparse
import glob
import json
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
REVIEW = os.path.join(ROOT, "unity", "Assets", "Art", "_Review")
ORDER = ["1-1", "1-2", "1-3", "1-4", "2-1", "2-2", "2-3", "2-4", "3-1", "3-2", "3-3", "3-4"]
VIEWS = ["出生", "中段远眺", "战斗"]


def load(directory, prefix):
    files = {}
    for path in glob.glob(os.path.join(directory, f"{prefix}_*.json")):
        with open(path, encoding="utf-8-sig") as f:
            d = json.load(f)
        if not d.get("records") or "mainP50" not in d["records"][0]:
            continue  # 合并前旧格式（或别的套件）的文件
        files[d["level"]] = d
    return [files[k] for k in ORDER if k in files] + [v for k, v in files.items() if k not in ORDER]


def ms(v):
    return "—" if v is None or v <= 0 else f"{v:.2f}"


def k(v):
    return f"{v / 1000:.0f}k" if v >= 1000 else str(v)


def table(files, config=None):
    print("| 关卡 | 机位 | 档 | 主线程 P50 / P95 ms | 渲染线程 P95 ms | GPU P50 / P95 ms | 绘制调用 | SetPass | 三角面 | 投影体 | 视锥内渲染器 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for d in files:
        for r in d["records"]:
            if config and r.get("config") != config:
                continue
            print(f"| {r['level']} | {r['view']} | {r['tier']} | {ms(r['mainP50'])} / {ms(r['mainP95'])} | {ms(r['renderP95'])} | {ms(r['gpuP50'])} / {ms(r['gpuP95'])} | "
                  f"{r['drawCalls']} | {r['setPass']} | {k(r['triangles'])} | {r['shadowCasters']} | {r['frustumRenderers']} |")


def per_level(files, config=None):
    print("| 关卡 | 档 | 机位 | 主线程 P50 均值 / P95 最重 ms | GPU P50 均值 / P95 最重 ms | 绘制调用 均值 / 最多 | 三角面 均值 / 最多 | 投影体 最多 | 战斗机位 主线程 P95 |")
    print("|---|---|---:|---|---|---|---|---:|---:|")
    for d in files:
        for tier in ("高", "低"):
            rs = [r for r in d["records"] if r["tier"] == tier and (not config or r.get("config") == config)]
            if not rs:
                continue
            avg = lambda key: sum(r[key] for r in rs) / len(rs)
            mx = lambda key: max(r[key] for r in rs)
            fight = [r for r in rs if r.get("combat")]
            print(f"| {d['level']} | {tier} | {len(rs)} | {avg('mainP50'):.2f} / {mx('mainP95'):.2f} | {avg('gpuP50'):.2f} / {mx('gpuP95'):.2f} | "
                  f"{avg('drawCalls'):.0f} / {mx('drawCalls')} | {k(int(avg('triangles')))} / {k(mx('triangles'))} | {mx('shadowCasters')} | "
                  f"{(ms(fight[0]['mainP95']) if fight else '—')} |")


def compare(files, before, after):
    print("| 关卡 | 机位 | 档 | 主线程 P50 ms | GPU P50 ms | 绘制调用 | 三角面 | 投影体 | 视锥内渲染器 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for d in files:
        recs = d["records"]
        for r in recs:
            if r.get("config") != before:
                continue
            a = next((x for x in recs if x.get("config") == after and x["view"] == r["view"] and x["tier"] == r["tier"]), None)
            if not a:
                continue
            arrow = lambda f, g: f"{f} → {g}"
            print(f"| {r['level']} | {r['view']} | {r['tier']} | {arrow(ms(r['mainP50']), ms(a['mainP50']))} | {arrow(ms(r['gpuP50']), ms(a['gpuP50']))} | "
                  f"{arrow(r['drawCalls'], a['drawCalls'])} | {arrow(k(r['triangles']), k(a['triangles']))} | "
                  f"{arrow(r['shadowCasters'], a['shadowCasters'])} | {arrow(r['frustumRenderers'], a['frustumRenderers'])} |")


def summary(files):
    keys = ["gpuP95", "mainP95", "drawCalls", "setPass", "triangles", "frustumRenderers", "shadowCasters", "estRenderers", "estTriangles", "estDraws"]
    worst = {}
    for d in files:
        for r in d["records"]:
            t = r["tier"]
            w = worst.setdefault(t, {key: (0, "") for key in keys})
            for key in keys:
                v = r.get(key, 0)
                if key == "estDraws":
                    v = r.get("estDraws", 0) + r.get("estCasterDraws", 0)
                if v > w[key][0]:
                    w[key] = (v, f"{r['level']} {r['view']}")
    for t, w in worst.items():
        print(f"[{t}]")
        for key, (v, where) in w.items():
            print(f"  {key:>18} = {v:>10}  ({where})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=REVIEW)
    ap.add_argument("--prefix", default="perf")
    ap.add_argument("--config", default=None, help="只出这一种配置；两个用逗号隔开 = 改前,改后 对照")
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--views", action="store_true", help="每个机位一行")
    a = ap.parse_args()
    files = load(a.dir, a.prefix)
    if not files:
        sys.exit(f"{a.dir} 里没有 {a.prefix}_*.json（先跑 bridge.sh playtest perf-ch1 / perf-ch2 / perf-ch3）")
    if a.summary:
        summary(files)
    elif a.config and "," in a.config:
        before, after = a.config.split(",", 1)
        compare(files, before, after)
    elif a.views:
        table(files, a.config)
    else:
        per_level(files, a.config)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
