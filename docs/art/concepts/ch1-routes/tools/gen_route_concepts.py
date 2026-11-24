"""第一章「关卡路线概念图」出图：OpenAI 图像接口（gpt-image-2.6-sunburst），每张图 = prompts/_style.txt + prompts/<图>.txt。

用法（仓库根目录）：
  python docs/art/concepts/ch1-routes/tools/gen_route_concepts.py v1 1-1 1-2 1-3 1-4 1-A
  python docs/art/concepts/ch1-routes/tools/gen_route_concepts.py v2 1-1 --ref raw/1-1_v1.png --extra prompts/1-1_v2_changes.txt
输出 raw/<图>_<版本>.png，记录写进 raw/records.json（模型、尺寸、耗时、请求号；不含密钥）。
密钥只从 art/pipeline/.env 读（本机系统环境变量里挂着一把没额度的旧 key，不用它）。
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parents[3]
MODEL = "gpt-image-2.6-sunburst"


def api_key() -> str:
    for line in (ROOT / "art/pipeline/.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("art/pipeline/.env 里没有 OPENAI_API_KEY")


def call(prompt: str, size: str, quality: str, ref: Path | None) -> tuple[bytes, dict]:
    key = api_key()
    t0 = time.time()
    if ref is None:
        body = json.dumps({"model": MODEL, "prompt": prompt, "size": size, "quality": quality, "n": 1}).encode("utf-8")
        req = urllib.request.Request("https://api.openai.com/v1/images/generations", data=body,
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        endpoint = "images/generations"
    else:
        boundary = uuid.uuid4().hex
        out = bytearray()
        for k, v in {"model": MODEL, "prompt": prompt, "size": size, "quality": quality, "n": "1"}.items():
            out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
        out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"{ref.name}\"\r\n"
                f"Content-Type: image/png\r\n\r\n").encode() + ref.read_bytes() + b"\r\n"
        out += f"--{boundary}--\r\n".encode()
        req = urllib.request.Request("https://api.openai.com/v1/images/edits", data=bytes(out), method="POST",
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}"})
        endpoint = "images/edits"
    last = ""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                data = json.loads(r.read())
                rid = r.headers.get("x-request-id")
            return base64.b64decode(data["data"][0]["b64_json"]), {
                "endpoint": endpoint, "model": MODEL, "size": size, "quality": quality, "request_id": rid,
                "seconds": round(time.time() - t0, 1), "usage": data.get("usage")}
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:600]}"
            if e.code in (400, 401, 403, 404):
                break
        except Exception as e:  # 网络抖动重试
            last = f"{type(e).__name__}: {e}"
        time.sleep(6 * (attempt + 1))
    raise RuntimeError(last)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("version")
    ap.add_argument("maps", nargs="+")
    ap.add_argument("--size", default="1536x1024")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--ref", help="参考图（相对 ch1-routes/），给了就走 images/edits")
    ap.add_argument("--extra", help="追加在提示词最前面的改稿清单（相对 ch1-routes/）")
    a = ap.parse_args()
    style = (HERE / "prompts/_style.txt").read_text(encoding="utf-8")
    raw = HERE / "raw"
    raw.mkdir(exist_ok=True)
    records_path = raw / "records.json"
    records = json.loads(records_path.read_text(encoding="utf-8")) if records_path.exists() else {}

    def one(m: str) -> str:
        own = HERE / f"prompts/{m}_style.txt"   # 首领场这类标注不一样的图用自己的风格 / 标注段
        prompt = (own.read_text(encoding="utf-8") if own.exists() else style) + "\n" + (HERE / f"prompts/{m}.txt").read_text(encoding="utf-8")
        # --ref / --extra 里的 {m} 换成图号：几张图各带各的参考图和改稿清单，一次并行出
        ref = HERE / a.ref.format(m=m) if a.ref else None
        extra = a.extra.format(m=m) if a.extra else None
        if extra:
            prompt = (HERE / extra).read_text(encoding="utf-8") + "\n\n" + prompt
        try:
            png, info = call(prompt, a.size, a.quality, ref)
        except Exception as e:
            return f"{m}: 失败 {e}"
        out = raw / f"{m}_{a.version}.png"
        out.write_bytes(png)
        info.update({"prompt_files": [f"prompts/{m}_style.txt" if own.exists() else "prompts/_style.txt", f"prompts/{m}.txt"] + ([extra] if extra else []),
                     "ref": a.ref.format(m=m) if a.ref else None, "chars": len(prompt)})
        records[f"{m}_{a.version}"] = info
        return f"{m}: {out.name} {len(png) // 1024} KB {info['seconds']} s"

    with ThreadPoolExecutor(max_workers=5) as ex:
        for line in ex.map(one, a.maps):
            print(line, flush=True)
    records_path.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
