"""Image generation through the local Codex CLI, signed in with the user's ChatGPT account (no API credits).

Same contract as openai_image.generate / edit: returns (PNG bytes, record info). Selected with pipeline.toml
[concept] provider = "codex"; the model Codex runs is [concept] codex_model (the default model in ~/.codex/config.toml
may not be available to ChatGPT sign-in, so it is always passed explicitly and the user's config is never changed).
"""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from .config import PipelineError

INSTRUCTION = """Use your image generation tool to create exactly ONE image from the PROMPT below. Pass the prompt to the tool
as written: do not add, remove or reinterpret any content. {refs}Output a wide landscape image with a 2:1 aspect ratio
(the target is {size}). Generate it once and stop: do not copy, edit or post-process files, do not do anything else and do
not ask questions. Reply with only the word DONE.

PROMPT:
{prompt}"""

REFS = ("The attached image is the exact design reference: keep the same character or object, shapes, colours, "
        "materials, proportions and stylization. ")


def _codex() -> str:
    exe = shutil.which("codex")
    if not exe:
        raise PipelineError("没有找到 codex 命令行（需要已用 ChatGPT 账号登录的 Codex CLI）")
    return exe


def _run(prompt: str, images: list[Path], *, model: str, size: str, retries: int) -> tuple[bytes, dict]:
    from PIL import Image
    w, h = (int(v) for v in size.split("x"))
    last = None
    for attempt in range(retries + 1):
        work = Path(tempfile.mkdtemp(prefix="codex_img_"))
        try:
            refs = []
            for i, p in enumerate(images):
                ref = work / f"ref_{i}{Path(p).suffix or '.png'}"
                shutil.copyfile(p, ref)
                refs.append(ref)
            text = INSTRUCTION.format(prompt=prompt, size=size, refs=REFS if refs else "")
            cmd = [_codex(), "exec", "--skip-git-repo-check", "-m", model, "-c", 'model_reasoning_effort="low"',
                   "-s", "workspace-write", "-C", str(work)]
            for ref in refs:
                cmd += ["-i", str(ref)]
            cmd.append("-")  # the prompt is read from stdin (long, multi-line)
            t0 = time.time()
            run = subprocess.run(cmd, input=text.encode("utf-8"), capture_output=True, timeout=900)
            # Take the image from THIS run's own folder (~/.codex/generated_images/<session id>/). Codex's own copy to
            # out.png picks "the newest generated image", which mixed up sheets when several runs were in flight.
            log = (run.stdout + run.stderr).decode("utf-8", "replace")
            session = re.search(r"session id:\s*([0-9a-f-]{36})", log)
            made = sorted((Path.home() / ".codex" / "generated_images" / session.group(1)).glob("*.png"),
                          key=lambda p: p.stat().st_mtime) if session else []
            if not made:
                last = f"codex 本次会话没有生成图片（退出码 {run.returncode}）：{log[-1500:]}"
                continue
            out = made[-1]
            with Image.open(out) as im:
                got = im.size
                image = im.convert("RGB")
            if got[0] < got[1] * 1.3:  # the tool ignored the wide layout: a sheet squeezed into a square is unusable
                last = f"codex 出图比例不对：{got[0]}x{got[1]}"
                continue
            if got[0] * h < got[1] * w:
                # The ChatGPT tool often returns 3:2 (1536x1024). Stretching it to 2:1 would distort every view, so widen
                # the canvas with the sheet's own flat border colour instead and keep the drawing's proportions.
                import numpy as np
                px = np.asarray(image)
                bg = tuple(int(c) for c in np.median(np.concatenate([px[:, 0], px[:, -1], px[0], px[-1]]), axis=0))
                canvas = Image.new("RGB", (round(got[1] * w / h), got[1]), bg)
                canvas.paste(image, ((canvas.width - got[0]) // 2, 0))
                image = canvas
            if image.size != (w, h):
                image = image.resize((w, h), Image.LANCZOS)
            buf = io.BytesIO()
            image.save(buf, "PNG")
            return buf.getvalue(), {"provider": "codex", "model": model, "size": size, "generated_size": list(got),
                                    "references": [Path(p).name for p in images], "codex_session": session.group(1), "attempt": attempt + 1,
                                    "seconds": round(time.time() - t0, 1)}
        except subprocess.TimeoutExpired:
            last = "codex 超时（15 分钟）"
        finally:
            shutil.rmtree(work, ignore_errors=True)
    raise PipelineError(f"Codex 出图失败：{last}")


def generate(prompt: str, *, model: str, size: str, retries: int = 1, **_ignored) -> tuple[bytes, dict]:
    """Text-to-image. quality / background of the API call do not apply to the ChatGPT tool and are ignored."""
    return _run(prompt, [], model=model, size=size, retries=retries)


def edit(prompt: str, images: list[Path], *, model: str, size: str, retries: int = 1, **_ignored) -> tuple[bytes, dict]:
    """Image-to-image: the reference images are attached to the Codex prompt."""
    return _run(prompt, list(images), model=model, size=size, retries=retries)
