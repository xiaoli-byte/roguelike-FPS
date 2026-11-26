"""第一章「玩家视角构图概念图」：白盒玩家视角截图（不带标注）→ OpenAI 图像接口 images/edits 重绘成成品画面，定构成 / 光 / 雾。
level-art.md 的顺序是 路线遭遇 → 白盒 → 构成 → 光影雾 → 特效 → 细节：白盒定了以后先在白盒的真实机位上画出成品该长什么样，再往下搭。

用法（仓库根目录；先跑 scripts/desert/whitebox-shots.mjs 出 whitebox/<图>_<机位>_plain.jpg）：
  python docs/art/concepts/ch1-routes/tools/gen_view_concepts.py v1                 全部图、全部机位
  python docs/art/concepts/ch1-routes/tools/gen_view_concepts.py v1 1-1 1-A --views spawn,s1
  python docs/art/concepts/ch1-routes/tools/gen_view_concepts.py v2 1-A --views spawn --extra prompts/views/1-A_spawn_v2_changes.txt
提示词 = prompts/views/_style.txt（画法 + 白盒配色图例 + 地编准则）+ prompts/views/<图>.txt 的图头（氛围、光、各体块是什么）+ 该机位的 [机位] 段。
输出 views/raw/<图>_<机位>_<版本>.png，记录写进 views/raw/records.json（模型、尺寸、耗时、请求号；不含密钥）。
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_route_concepts import HERE, call  # noqa: E402  同一个出图接口（密钥只从 art/pipeline/.env 读）

WB = HERE / "whitebox"
OUT = HERE / "views" / "raw"


def sections(text: str) -> tuple[str, dict[str, str]]:
    """图头 + 各 [机位] 段"""
    parts = re.split(r"^\[(\w+)\]\s*$", text, flags=re.M)
    head, views = parts[0].strip(), {}
    for i in range(1, len(parts), 2):
        views[parts[i]] = parts[i + 1].strip()
    return head, views


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("version")
    ap.add_argument("maps", nargs="*")
    ap.add_argument("--views", help="只出这些机位（逗号分隔）")
    ap.add_argument("--size", default="1536x1024")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--extra", help="追加在提示词最前面的改稿清单（相对 ch1-routes/，{m} = 图号，{v} = 机位）")
    ap.add_argument("--ref", help="参考图换成这张（相对 ch1-routes/，{m} {v} 同上；缺省 = 白盒截图）")
    a = ap.parse_args()
    style = (HERE / "prompts/views/_style.txt").read_text(encoding="utf-8")
    maps = a.maps or ["1-1", "1-2", "1-3", "1-4", "1-A"]
    only = set(a.views.split(",")) if a.views else None
    OUT.mkdir(parents=True, exist_ok=True)
    records_path = OUT / "records.json"
    records = json.loads(records_path.read_text(encoding="utf-8")) if records_path.exists() else {}
    jobs: list[tuple[str, str, str]] = []
    for m in maps:
        head, views = sections((HERE / f"prompts/views/{m}.txt").read_text(encoding="utf-8"))
        for v, text in views.items():
            if only and v not in only:
                continue
            prompt = f"{style}\n\n{head}\n\n{text}"
            if a.extra:
                extra = HERE / a.extra.format(m=m, v=v)
                if extra.exists():
                    prompt = extra.read_text(encoding="utf-8") + "\n\n" + prompt
            jobs.append((m, v, prompt))

    def one(job: tuple[str, str, str]) -> str:
        m, v, prompt = job
        src = HERE / a.ref.format(m=m, v=v) if a.ref else WB / f"{m}_{v}_plain.jpg"
        if not src.exists():
            return f"{m} {v}: 没有底图 {src.name}"
        # images/edits 要 png：jpg 转一下（存在 views/raw/_ref 里，不入库）
        ref = OUT / "_ref" / f"{m}_{v}.png"
        ref.parent.mkdir(exist_ok=True)
        buf = io.BytesIO()
        Image.open(src).convert("RGB").save(buf, "PNG")
        ref.write_bytes(buf.getvalue())
        try:
            png, info = call(prompt, a.size, a.quality, ref)
        except Exception as e:  # noqa: BLE001
            return f"{m} {v}: 失败 {e}"
        out = OUT / f"{m}_{v}_{a.version}.png"
        out.write_bytes(png)
        info.update({"ref": str(src.relative_to(HERE)).replace("\\", "/"), "chars": len(prompt), "extra": a.extra})
        records[f"{m}_{v}_{a.version}"] = info
        return f"{m} {v}: {out.name} {len(png) // 1024} KB {info['seconds']} s"

    with ThreadPoolExecutor(max_workers=6) as ex:
        for line in ex.map(one, jobs):
            print(line, flush=True)
    records_path.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
