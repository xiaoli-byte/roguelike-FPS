"""OpenAI 图像接口（GPT Image 2.5）。只用标准库：/v1/images/edits 以 multipart 上传参考图。

密钥从环境变量 / art/pipeline/.env 的 OPENAI_API_KEY 读取，绝不写进日志或记录文件。
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .config import PipelineError


def _multipart(fields: dict[str, str], files: list[tuple[str, Path]]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, p in files:
        out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{p.name}\"\r\n"
                f"Content-Type: image/png\r\n\r\n").encode()
        out += p.read_bytes() + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def edit(prompt: str, images: list[Path], *, model: str, size: str, quality: str,
         background: str = "transparent", retries: int = 2) -> tuple[bytes, dict]:
    """返回 (PNG 字节, 记录信息)。记录里有模型、尺寸、用量、请求号，没有密钥。"""
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise PipelineError("没有 OPENAI_API_KEY：复制 art/pipeline/.env.example 为 .env 并填写")
    base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    fields = {"model": model, "prompt": prompt, "size": size, "quality": quality,
              "background": background, "output_format": "png", "n": "1"}
    body, ctype = _multipart(fields, [("image[]", p) for p in images])
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(f"{base}/images/edits", data=body, method="POST",
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": ctype})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                data = json.loads(r.read())
                rid = r.headers.get("x-request-id")
            png = base64.b64decode(data["data"][0]["b64_json"])
            info = {"provider": "openai", "endpoint": "images/edits", "model": model, "size": size, "quality": quality,
                    "background": background, "usage": data.get("usage"), "request_id": rid,
                    "seconds": round(time.time() - t0, 1)}
            return png, info
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:2000]
            last = f"HTTP {e.code}: {msg}"
            if e.code in (400, 401, 403, 404):  # 参数 / 鉴权 / 审核问题，重试没用
                break
        except (urllib.error.URLError, TimeoutError) as e:
            last = f"网络错误：{e}"
        time.sleep(5 * (attempt + 1))
    raise PipelineError(f"OpenAI 图像接口调用失败：{last}")
