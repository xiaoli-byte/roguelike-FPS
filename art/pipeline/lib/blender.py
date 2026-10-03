"""以无头模式调用 Blender 跑 art/pipeline/blender/ 下的脚本。

参数通过一个 JSON 文件传入（路径放在 `--` 之后），脚本结束时把结果写回同一目录的 *.result.json。
Blender 输出全部写进日志文件，失败时打印最后几十行。
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from .config import CFG, PIPELINE_DIR, PipelineError

SCRIPTS = PIPELINE_DIR / "blender"


def run(script: str, params: dict, work_dir: Path, tag: str) -> dict:
    work_dir.mkdir(parents=True, exist_ok=True)
    args_path = work_dir / f"{tag}.args.json"
    result_path = work_dir / f"{tag}.result.json"
    log_path = work_dir / f"{tag}.blender.log"
    result_path.unlink(missing_ok=True)
    params = {**params, "result_path": str(result_path)}
    args_path.write_text(json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8")

    cmd = [CFG.tools["blender"], "-b", "--factory-startup", "--python-exit-code", "1",
           "--python", str(SCRIPTS / script), "--", str(args_path)]
    t0 = time.time()
    with open(log_path, "w", encoding="utf-8", errors="replace") as log:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace")
        assert proc.stdout
        for line in proc.stdout:
            log.write(line)
            if line.startswith("[art]"):
                print("   " + line.rstrip(), flush=True)
        code = proc.wait()
    dt = time.time() - t0
    if code != 0 or not result_path.exists():
        tail = log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-40:]
        raise PipelineError(f"Blender {script} 失败（退出码 {code}，{dt:.0f} 秒），日志 {log_path}：\n" + "\n".join(tail))
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result["_seconds"] = round(dt, 1)
    return result
