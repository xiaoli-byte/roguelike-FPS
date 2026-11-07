"""饰带降对比：只在一段高度带里对底色做纯颜色映射（2026-11-07，3-4 美术收尾）。

3-4 圆殿八段弧墙眼高处的朱漆铜日纹饰带（红板 + 亮铜圆盘交替，一圈 48 个）在交战视角里是一条最密的横带，殿内太花
（docs/art/review/ch3-v2/3-4/composition-check.md）。这里不重画、不做任何滤波，也不往紫色偏：
  - 范围：网格上质心高度落在 band（Tripo 原件归一化高度 0..1）里的三角形，按原 UV 硬边光栅化（再描一圈三角形边，岛边的纹素不漏）；
  - 映射（Lab，逐纹素）：彩度 ×chroma、亮度往带内均值收 ×value（色相角不变）；熔岩色键命中的纹素原样不动。
几何、UV 都不动：原件换上新底色 → art/source/_tripo_inbox/<UTC>_<ID>_frieze.glb + 回执，接着照常
`tripo_assets.py import` → `assetctl build / validate / review / approve / publish`（法线、自发光遮罩、AO 按新底色重算）。

取的是**当前**高模的 Tripo 原件（不往回追溯）：以后 texture_clean.py 洗过底色，再跑这里会叠在洗过的底色上；
回执也不写 retexture_of_highpoly / geometry_from，texture_clean 反过来也会在这一版上洗，两边谁先谁后都不会互相抹掉。

    python art/pipeline/tools/frieze_recolor.py <ID> [--run] [--preview DIR]
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
from lib.config import CFG, PipelineError  # noqa: E402
from lib.state import AssetState, portable_path, sha256  # noqa: E402
from retexture import INBOX, _CT, base_color_image, geometry, glb_read, glb_write, image_bytes, key_mask, replace_images  # noqa: E402

# 每件的高度带（Tripo 原件归一化高度）和映射强度
FRIEZES = {
    # 朱漆铜日纹饰带：y 0.145–0.315（两面都有，里面一圈 8 个铜日纹盘）
    "SM_Tripo_InfernoRoundHallWall": {"band": [0.145, 0.315], "chroma": 0.4, "value": 0.42},
}


def recolor(asset_id: str, preview: Path | None = None) -> Path | None:
    if asset_id not in FRIEZES:
        raise PipelineError(f"{asset_id}: FRIEZES 里没有这件")
    p = FRIEZES[asset_id]
    spec = CFG.asset(asset_id)
    st = AssetState(spec)
    hp = st.require("highpoly")
    name = next((n for n in hp["files"] if n.endswith("_source.glb")), None)
    if not name:
        raise PipelineError(f"{asset_id}: 高模 v{hp['version']:03d} 没有 GLB 原件")
    src = st.file(hp, name)
    js, bn = glb_read(src)
    if len(js.get("images", [])) != 1:
        raise PipelineError(f"{src.name}: 原件有 {len(js.get('images', []))} 张贴图（只认只带底色的 Tripo 原件）")
    P, U = geometry(js, bn)
    pr = js["meshes"][0]["primitives"][0]
    a = js["accessors"][pr["indices"]]
    bv = js["bufferViews"][a["bufferView"]]
    idx = np.frombuffer(bn, _CT[a["componentType"]], count=a["count"],
                        offset=bv.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(-1, 3)
    y = P[idx][..., 1].mean(1)
    y0, y1 = (P[:, 1].min(), P[:, 1].max())
    yn = (y - y0) / max(y1 - y0, 1e-6)
    sel = idx[(yn >= p["band"][0]) & (yn <= p["band"][1])]

    old = Image.open(io.BytesIO(image_bytes(js, bn, base_color_image(js)))).convert("RGB")
    W, H = old.size
    mask = np.zeros((H, W), np.uint8)
    tris = np.round(U[sel] * [W, H] - 0.5).astype(np.int32)  # UV 的 v 和 PNG 一样从上往下（glTF 约定）
    cv2.fillPoly(mask, list(tris), 255, lineType=cv2.LINE_8)
    cv2.polylines(mask, list(tris), True, 255, 1, lineType=cv2.LINE_8)
    src_rgb = np.asarray(old)
    keep = key_mask(src_rgb.astype(np.float32) / 255, spec.raw.get("emissive_key")) > 0.5 if spec.raw.get("emissive_key") else np.zeros((H, W), bool)
    m = (mask > 0) & ~keep

    lab = cv2.cvtColor(src_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1] - 128, lab[..., 2] - 128
    Lm = float(L[m].mean())
    L2 = np.where(m, Lm + (L - Lm) * p["value"], L)
    A2 = np.where(m, A * p["chroma"], A)
    B2 = np.where(m, B * p["chroma"], B)
    out = np.stack([np.clip(L2, 0, 255), np.clip(A2 + 128, 0, 255), np.clip(B2 + 128, 0, 255)], -1).astype(np.uint8)
    new = cv2.cvtColor(out, cv2.COLOR_LAB2RGB)
    new[~m] = src_rgb[~m]
    stats = {"band": p["band"], "chroma": p["chroma"], "value": p["value"], "tris": int(len(sel)), "texels": round(float(m.mean()), 4),
             "band_L_mean": round(Lm * 100 / 255, 1), "lava_kept": int((keep & (mask > 0)).sum())}
    print(f"  {asset_id}：{stats}")
    img = Image.fromarray(new)
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
        old.save(preview / f"{asset_id}_frieze_before.png")
        img.save(preview / f"{asset_id}_frieze_after.png")
        Image.fromarray(mask).save(preview / f"{asset_id}_frieze_mask.png")
        return None
    buf = io.BytesIO()
    img.save(buf, "PNG")
    njs, nbn = replace_images(js, bn, {base_color_image(js): (buf.getvalue(), "image/png")})
    stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    INBOX.mkdir(parents=True, exist_ok=True)
    out_glb = INBOX / f"{stamp}_{asset_id}_frieze.glb"
    glb_write(out_glb, njs, nbn)
    rec = {"asset": asset_id, "task": "local:frieze_recolor", "source": portable_path(out_glb), "sha256": sha256(out_glb),
           "recolor_of": portable_path(src), "recolor_of_sha256": sha256(src), "recolor_of_highpoly": hp["version"],
           "frieze_recolor": stats, "glb": {"bytes": out_glb.stat().st_size, "images": 1},
           "note": "饰带降对比：高度带内的底色纯颜色映射（彩度、亮度收向均值，色相不变），不滤波；几何与 UV 不动", "archived_utc": stamp}
    out_glb.with_suffix(".json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✔ {asset_id}：{portable_path(out_glb)}")
    return out_glb


def run_pipeline(asset_id: str, glb: Path) -> None:
    steps = [["tripo_assets.py", "import", asset_id, "--file", portable_path(glb), "--task", "local:frieze_recolor"]]
    steps += [["assetctl.py", s, asset_id] for s in ("build", "validate", "review")]
    for args in steps:
        r = subprocess.run([sys.executable] + args, cwd=HERE, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
        tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
        print(f"    {args[0]} {args[1]}: {'ok' if r.returncode == 0 else 'FAIL'}  {tail[0][:160]}")
        if r.returncode:
            raise PipelineError(f"{asset_id}: {' '.join(args[:2])} 失败")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--preview")
    a = ap.parse_args()
    for aid in a.ids:
        out = recolor(aid, Path(a.preview) if a.preview else None)
        if out and a.run:
            run_pipeline(aid, out)
