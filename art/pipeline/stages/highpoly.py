"""阶段 02 · 高模：用本地 ComfyUI 的 Hunyuan3D 生成高精度形状（无贴图）。

- single（默认）：Hunyuan3D 2.1，从配准后的正面概念图生成，细节最好，但深度只能猜。
- multiview：Hunyuan3D 2mv，四个配准后的概念视图一起作条件，深度由侧视图约束；前后很厚或很薄、
  宽裙摆 / 披风这类单视图容易猜错深度的资产用它（登记表 `highpoly_mode = "multiview"` 或命令行 `--mode multiview`）。
高模是「雕刻稿」的角色：只提供形状，后续在 Blender 里对齐、减面、烘焙法线与 AO。
输出不进 git（.gitignore），asset.json 里记录了可复现它的全部参数。
"""

from __future__ import annotations

import json
import shutil
import time

from PIL import Image

from lib import comfy, imaging
from lib.config import CFG, ROOT, AssetSpec
from lib.state import AssetState


def run(spec: AssetSpec, a) -> None:
    st = AssetState(spec)
    cn = st.require("concept")
    p = CFG.section("highpoly")
    seed = getattr(a, "seed", None) or p["seed"]
    stats = comfy.ping()

    mode = getattr(a, "mode", None) or spec.raw.get("highpoly_mode", "single")
    ver = st.next_version("highpoly")
    out = spec.stage_dir("highpoly")
    stem = f"HP_{spec.id}_v{ver:03d}"
    if mode == "multiview":
        panels = [Image.open(st.file(cn, f"CN_{spec.id}_v{cn['version']:03d}_{v}.png")).convert("RGBA") for v in imaging.VIEW_ORDER]
        imgs, xform = imaging.hunyuan_inputs_multiview(panels, p["input_size"], p["input_fill"])
        inputs, names = [], {}
        for v, im in zip(imaging.VIEW_ORDER, imgs):
            ip = out / f"{stem}_input_{v}.png"
            im.save(ip)
            inputs.append(ip)
            names[v] = comfy.upload_image(ip)
        graph = comfy.hunyuan3d_mv_graph(names, f"spiritfire/{stem}", p, seed)
        tool, ckpt = "Hunyuan3D 2mv（ComfyUI 原生节点，四视图条件）", p["checkpoint_mv"]
        license_ = "Tencent Hunyuan 3D 2.0 Community License：不得在欧盟 / 英国 / 韩国境内使用或分发"
    else:
        front = st.file(cn, f"CN_{spec.id}_v{cn['version']:03d}_front.png")
        inp, xform = imaging.hunyuan_input(Image.open(front).convert("RGBA"), p["input_size"], p["input_fill"])
        inp_path = out / f"{stem}_input.png"
        inp.save(inp_path)
        inputs = [inp_path]
        graph = comfy.hunyuan3d_graph(comfy.upload_image(inp_path), f"spiritfire/{stem}", p, seed)
        tool, ckpt = "Hunyuan3D 2.1（ComfyUI 原生节点）", p["checkpoint"]
        license_ = "Tencent Hunyuan 3D 2.1 Community License：不得在欧盟 / 英国 / 韩国境内使用或分发"
    print(f"→ {tool.split('（')[0]}（{p['steps']} 步，体素 {p['octree_resolution']}，种子 {seed}）…", flush=True)
    t0 = time.time()
    outputs = comfy.run(graph)
    dt = time.time() - t0
    src = comfy.output_file(outputs)
    glb = out / f"{stem}.glb"
    shutil.copyfile(src, glb)
    comfy.free_memory()

    params = {k: p[k] for k in ("steps", "cfg", "shift", "octree_resolution", "num_chunks", "threshold")}
    st.add_version("highpoly", {
        "version": ver, "from_concept": cn["version"], "mode": mode, "tool": tool, "checkpoint": ckpt,
        "license": license_,
        "seed": seed, **params, "input_transform": xform, "seconds": round(dt, 1),
        "comfyui": stats["system"].get("comfyui_version"), "gpu": stats["devices"][0]["name"],
        "size_mb": round(glb.stat().st_size / 1e6, 1),
    }, [*inputs, glb])
    print(f"✔ 高模 v{ver:03d}：{glb.relative_to(ROOT)}（{dt:.0f} 秒，{glb.stat().st_size / 1e6:.1f} MB）")
    (out / f"{stem}_graph.json").write_text(json.dumps(graph, indent=2), encoding="utf-8")
