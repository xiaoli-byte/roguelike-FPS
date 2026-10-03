"""本地 ComfyUI 客户端：上传图片、提交工作流、等结果。Hunyuan3D 2.1 走 ComfyUI 原生节点。"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .config import CFG, PipelineError

URL = CFG.tools["comfyui_url"].rstrip("/")


def _get(path: str):
    with urllib.request.urlopen(URL + path, timeout=30) as r:
        return json.loads(r.read())


def ping() -> dict:
    try:
        return _get("/system_stats")
    except (urllib.error.URLError, TimeoutError) as e:
        raise PipelineError(f"连不上 ComfyUI（{URL}）：{e}。先启动 ComfyUI。") from e


def upload_image(path: Path, subfolder: str = "spiritfire") -> str:
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\n{subfolder}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{path.name}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(URL + "/upload/image", data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    return f"{d['subfolder']}/{d['name']}" if d.get("subfolder") else d["name"]


def run(graph: dict, timeout: float = 1800) -> dict:
    req = urllib.request.Request(URL + "/prompt", data=json.dumps({"prompt": graph, "client_id": uuid.uuid4().hex}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            pid = json.loads(r.read())["prompt_id"]
    except urllib.error.HTTPError as e:
        raise PipelineError(f"ComfyUI 拒绝了工作流：{e.read().decode('utf-8', 'replace')[:2000]}") from e
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = _get(f"/history/{pid}")
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                msgs = [m for m in st.get("messages", []) if m[0] == "execution_error"]
                raise PipelineError(f"ComfyUI 执行失败：{json.dumps(msgs, ensure_ascii=False)[:2000]}")
            if st.get("completed"):
                return h[pid]["outputs"]
        time.sleep(2)
    raise PipelineError(f"ComfyUI 超时（{timeout} 秒）")


def free_memory() -> None:
    """生成完释放显存，避免和 Blender 烘焙抢 GPU。"""
    req = urllib.request.Request(URL + "/free", data=json.dumps({"unload_models": True, "free_memory": True}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.URLError:
        pass


def hunyuan3d_graph(image_name: str, prefix: str, p: dict, seed: int) -> dict:
    """Hunyuan3D 2.1 单图生成形状：图像编码 → DiT 采样 → VAE 解码体素 → Surface Net 提面 → GLB。"""
    return {
        "1": {"class_type": "ImageOnlyCheckpointLoader", "inputs": {"ckpt_name": p["checkpoint"]}},
        "2": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "3": {"class_type": "CLIPVisionEncode", "inputs": {"clip_vision": ["1", 1], "image": ["2", 0], "crop": "none"}},
        "4": {"class_type": "Hunyuan3Dv2Conditioning", "inputs": {"clip_vision_output": ["3", 0]}},
        "5": {"class_type": "EmptyLatentHunyuan3Dv2", "inputs": {"resolution": 4096, "batch_size": 1}},
        "6": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": p["shift"]}},
        "7": {"class_type": "KSampler", "inputs": {
            "model": ["6", 0], "seed": seed, "steps": p["steps"], "cfg": p["cfg"], "sampler_name": "euler",
            "scheduler": "normal", "positive": ["4", 0], "negative": ["4", 1], "latent_image": ["5", 0], "denoise": 1.0}},
        "8": {"class_type": "VAEDecodeHunyuan3D", "inputs": {
            "samples": ["7", 0], "vae": ["1", 2], "num_chunks": p["num_chunks"], "octree_resolution": p["octree_resolution"]}},
        "9": {"class_type": "VoxelToMesh", "inputs": {"voxel": ["8", 0], "algorithm": "surface net", "threshold": p["threshold"]}},
        "10": {"class_type": "SaveGLB", "inputs": {"mesh": ["9", 0], "filename_prefix": prefix}},
    }


def hunyuan3d_mv_graph(image_names: dict, prefix: str, p: dict, seed: int) -> dict:
    """Hunyuan3D 2mv 多视图生成形状：front / left / back / right 四个视图各自图像编码 → 多视图条件 → DiT 采样 → 解码 → 提面 → GLB。
    单视图只能猜深度，前后对称的宽裙摆、厚斗篷常被做薄；多视图用侧视图约束深度。"""
    g = {
        "1": {"class_type": "ImageOnlyCheckpointLoader", "inputs": {"ckpt_name": p["checkpoint_mv"]}},
        "4": {"class_type": "Hunyuan3Dv2ConditioningMultiView", "inputs": {}},
        "5": {"class_type": "EmptyLatentHunyuan3Dv2", "inputs": {"resolution": p["latent_resolution_mv"], "batch_size": 1}},
        "6": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": p["shift"]}},
        "7": {"class_type": "KSampler", "inputs": {
            "model": ["6", 0], "seed": seed, "steps": p["steps"], "cfg": p["cfg"], "sampler_name": "euler",
            "scheduler": "normal", "positive": ["4", 0], "negative": ["4", 1], "latent_image": ["5", 0], "denoise": 1.0}},
        "8": {"class_type": "VAEDecodeHunyuan3D", "inputs": {
            "samples": ["7", 0], "vae": ["1", 2], "num_chunks": p["num_chunks"], "octree_resolution": p["octree_resolution"]}},
        "9": {"class_type": "VoxelToMesh", "inputs": {"voxel": ["8", 0], "algorithm": "surface net", "threshold": p["threshold"]}},
        "10": {"class_type": "SaveGLB", "inputs": {"mesh": ["9", 0], "filename_prefix": prefix}},
    }
    for i, (view, name) in enumerate(image_names.items()):
        g[f"2{i}"] = {"class_type": "LoadImage", "inputs": {"image": name}}
        g[f"3{i}"] = {"class_type": "CLIPVisionEncode", "inputs": {"clip_vision": ["1", 1], "image": [f"2{i}", 0], "crop": "none"}}
        g["4"]["inputs"][view] = [f"3{i}", 0]
    return g


def output_file(outputs: dict, node: str = "10") -> Path:
    out = outputs.get(node, {})
    items = out.get("3d") or out.get("meshes") or out.get("images") or []
    if not items:
        raise PipelineError(f"ComfyUI 没有返回模型文件：{json.dumps(outputs)[:500]}")
    it = items[0]
    return Path(CFG.tools["comfyui_output"]) / it.get("subfolder", "") / it["filename"]
