"""洗底色贴图：去紫、补斑、压平噪点、提固有色（2026-11-07 起，用户：「这些模型都泛紫色、灰色，生成的贴图太脏了」）。

为什么会紫：第三章的概念图和四视图都是紫色环境光下画的，Tripo 把画进去的紫色暗部当成固有色烘进底色，去光处理只去明暗、不去色相；
场景光照（docs/art/ch3-look.md）本来就铺一层紫，固有色再紫一层，整件读成紫灰。紫色留给光照，固有色回到暖灰石、铜、朱漆。
为什么脏：Tripo 底色是成千上万个碎 UV 块拼的，紫色暗部在铜面 / 石面上留下斑块，加上细碎噪点。

每张底色按这个顺序处理（Lab 空间，熔岩色键命中的纹素原样不动，自发光遮罩不会移位）：
  1. 色偏判定：Lab 色相落在蓝紫 → 品红区间、彩度不高的纹素算「色偏」；
  2. 补斑：色偏在局部只占少数（铜面上的紫斑）→ 从周围实色材质借色，亮度只拉低频；
  3. 中性化：色偏在局部占多数（整面石墙、底座）→ 它就是材质本身，改成低彩度暖灰，亮度略提；
  4. 提固有色：真实材质色（铜、朱漆、金）彩度 ×1.45 以内、亮度半强度拉伸到 8–88（暗场景里暗底色会糊成一片）。
只改颜色、原分辨率、不做任何平滑：第一版用均值漂移压平色块，细节跟着被抹掉，用户 11-07 指出「这个贴图都是模糊的」。
模糊本身修不回来——Tripo「纹理生成」上传网格沿用原 UV 重出的贴图（retexture.py）明显比原始生成糊，那种件应回到原始贴图，不是洗。

    python art/pipeline/texture_clean.py hp <ID...> [--run] [--preview DIR]
        Tripo 件：高模的 Tripo 原件 + 洗过的底色 → art/source/_tripo_inbox/<UTC>_<ID>_clean.glb + 回执；
        --run 接着跑 tripo_assets.py import → assetctl build / validate / review（审核图出来后再 approve / publish）
        --preview 只出洗前 / 洗后底色到 DIR，不写 inbox
"""
from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import CFG, ROOT, PipelineError  # noqa: E402
from lib.state import AssetState, portable_path, sha256  # noqa: E402
from retexture import INBOX, base_color_image, glb_read, glb_write, image_bytes, key_mask, replace_images, tripo_source  # noqa: E402

PARAMS = {
    "cast_hue": [235.0, 368.0],   # Lab 色相（度，>360 绕回）：蓝紫 → 紫 → 品红 → 粉紫；朱漆约 35–45° 不在内
    "cast_max_chroma": 45.0,      # 彩度越高越不算色偏（饱和的紫 / 品红是有意画的）
    "warm_hue": 70.0,             # 中性化的去向：暖灰 / 砂岩
    "minority": [0.4, 0.65],      # 局部色偏占比：低于 → 斑（借色），高于 → 材质本身（中性化）
    "rose_hue": [340.0, 392.0],   # 粉 / 玫瑰（绕回到 32°）
    "rose_max_chroma": 42.0,
    "vibrance": 0.45,
    "value_stretch": [8.0, 88.0],
    "repair_value_pull": 0.35,    # 斑块的亮度往周围材质拉多少（只拉低频，高频细节原样留着）
    "work": 4096,                 # 原分辨率处理；只改颜色、不做任何平滑（用户 11-07：「这个贴图都是模糊的」）
}


def _lab(rgb8: np.ndarray):
    lab = cv2.cvtColor(rgb8, cv2.COLOR_RGB2LAB).astype(np.float32)
    return lab[..., 0] * (100 / 255), lab[..., 1] - 128, lab[..., 2] - 128


def _rgb(L, a, b) -> np.ndarray:
    lab = np.stack([np.clip(L * 255 / 100, 0, 255), np.clip(a + 128, 0, 255), np.clip(b + 128, 0, 255)], -1).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)


def _blur(x, sigma):
    return cv2.GaussianBlur(x, (0, 0), sigma)


def clean(img: Image.Image, key: dict | None, p: dict = PARAMS) -> tuple[Image.Image, dict]:
    work = min(p["work"], img.size[0])
    src = np.asarray(img.convert("RGB").resize((work, work), Image.Resampling.LANCZOS))
    keep = key_mask(src.astype(np.float32) / 255, key or {"hue": [0.02, 0.17], "min_sat": 0.55, "min_val": 0.75}) > 0.5
    L, a, b = _lab(src)
    C = np.hypot(a, b)
    hue = np.degrees(np.arctan2(b, a)) % 360
    hue = np.where(hue < 120, hue + 360, hue)
    lo, hi = p["cast_hue"]
    inband = np.clip((hue - lo) / 12, 0, 1) * np.clip((hi - hue) / 12, 0, 1)
    cast = (inband * np.clip(1.25 - C / p["cast_max_chroma"], 0, 1) * (~keep)).astype(np.float32)
    # 补斑：周围实色材质的颜色（归一化卷积）
    # 借色只借中等彩度的材质（铜、金、木、暖石）：朱漆 / 旗面这种高彩度的块在 UV 上紧挨着石面，借了会在石墙边抹出红痕
    solid = ((1 - inband) * np.clip((C - 4) / 6, 0, 1) * (1 - np.clip((C - 28) / 8, 0, 1)) * (~keep)).astype(np.float32)
    sig = work * 0.012
    ws = _blur(solid, sig)
    den = np.maximum(ws, 1e-4)
    na, nb, nL = _blur(a * solid, sig) / den, _blur(b * solid, sig) / den, _blur(L * solid, sig) / den
    support = np.clip((ws - 0.06) / 0.2, 0, 1)
    m0, m1 = p["minority"]
    minority = 1 - np.clip((_blur(cast, sig) - m0) / (m1 - m0), 0, 1)
    rep = cast * support * minority
    a1, b1 = a * (1 - rep) + na * rep, b * (1 - rep) + nb * rep
    # 亮度：只把斑块的低频亮度往周围拉，原图的高频细节（刻线、笔触）全部保留
    Llow = _blur(L, 2.0)
    L1 = L + (nL - Llow) * rep * p["repair_value_pull"]
    # 中性化：整片色偏 → 低彩度暖灰
    neu = cast * (1 - support * minority)
    tc = np.minimum(C * 0.3, 6) + 3.0
    wh = np.radians(p["warm_hue"])
    a2, b2 = a1 * (1 - neu) + tc * np.cos(wh) * neu, b1 * (1 - neu) + tc * np.sin(wh) * neu
    L2 = L1 + neu * np.clip(48 - L1, 0, 12) * 0.35
    # 粉紫光残留：浅色、低彩度的玫瑰 / 粉色墙面（紫光照在白墙 / 赭墙上画出来的，色相刚好在紫区间外）→ 转暖赭、不提彩度；
    # 朱漆 / 旗面彩度高，不在内
    C2 = np.hypot(a2, b2)
    h2 = np.degrees(np.arctan2(b2, a2)) % 360
    h2 = np.where(h2 < 120, h2 + 360, h2)
    r0, r1 = p["rose_hue"]
    rose = (np.clip((h2 - r0) / 10, 0, 1) * np.clip((r1 - h2) / 10, 0, 1) * np.clip((L2 - 45) / 10, 0, 1)
            * np.clip((p["rose_max_chroma"] - C2) / 8, 0, 1) * (~keep))
    hr = np.radians(h2 + (p["warm_hue"] - 8 + 360 - h2) * rose * 0.85)
    Cr = C2 * (1 - rose * 0.35)
    a2, b2 = Cr * np.cos(hr), Cr * np.sin(hr)
    # 提固有色
    C2 = np.hypot(a2, b2)
    vib = 1.0 + p["vibrance"] * np.clip((C2 - 5) / 10, 0, 1) * (1 - neu) * (1 - rose)
    s = np.where(C2 > 1e-3, np.minimum(vib, 60 / np.maximum(C2, 1e-3)), 1)
    a2, b2 = a2 * s, b2 * s
    used = L2 > 3
    p2, p98 = np.percentile(L2[used], 2), np.percentile(L2[used], 98)
    v0, v1 = p["value_stretch"]
    # 亮度拉伸主要给中性的石 / 铁；高彩度的颜色（朱漆墙、旗面）保持原亮度——深红一提亮就成了粉
    w = 0.5 * (1 - 0.8 * np.clip((np.hypot(a2, b2) - 15) / 20, 0, 1))
    L2 = L2 * (1 - w) + np.clip(v0 + (L2 - p2) * ((v1 - v0) / max(p98 - p2, 1e-3)), 0, 100) * w
    res = _rgb(L2, a2, b2)
    kd = cv2.dilate(keep.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    res[kd] = src[kd]
    stats = {"size": work, "cast": round(float((cast > 0.3).mean()), 3), "repaired": round(float((rep > 0.3).mean()), 3),
             "neutralized": round(float((neu > 0.3).mean()), 3), "lava_kept": round(float(keep.mean()), 4),
             "purple_before": round(float((inband[L > 4] * (C[L > 4] > 4)).mean()), 3)}
    return Image.fromarray(res), stats


def hp(asset_id: str, preview: Path | None = None) -> Path | None:
    spec = CFG.asset(asset_id)
    if spec.raw.get("source_provider") != "tripo":
        raise PipelineError(f"{asset_id}: 不是 Tripo 件")
    st = AssetState(spec)
    src, src_hp = tripo_source(spec, st)
    sjs, sbn = glb_read(src)
    if len(sjs.get("images", [])) != 1:
        raise PipelineError(f"{src.name}: 原件有 {len(sjs.get('images', []))} 张贴图（只认只带底色的 Tripo 原件）")
    old = Image.open(io.BytesIO(image_bytes(sjs, sbn, base_color_image(sjs)))).convert("RGB")
    new, stats = clean(old, spec.raw.get("emissive_key"))
    print(f"  {asset_id}：{old.size[0]} → {stats}")
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
        old.resize(new.size).save(preview / f"{asset_id}_before.png")
        new.save(preview / f"{asset_id}_clean.png")
        return None
    buf = io.BytesIO()
    new.save(buf, "PNG")
    njs, nbn = replace_images(sjs, sbn, {base_color_image(sjs): (buf.getvalue(), "image/png")})
    stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    INBOX.mkdir(parents=True, exist_ok=True)
    out = INBOX / f"{stamp}_{asset_id}_clean.glb"
    glb_write(out, njs, nbn)
    rec = {"asset": asset_id, "task": "local:texture_clean", "source": portable_path(out), "sha256": sha256(out),
           "geometry_from": portable_path(src), "geometry_sha256": sha256(src), "retexture_of_highpoly": src_hp,
           "texture_clean": {"params": PARAMS, "stats": stats}, "glb": {"bytes": out.stat().st_size, "images": 1},
           "note": "底色洗贴图（去紫 / 补斑 / 压平 / 提固有色），几何与 UV 不动", "archived_utc": stamp}
    out.with_suffix(".json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✔ {asset_id}：{portable_path(out)}")
    return out


def run_pipeline(asset_id: str, glb: Path) -> None:
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    here = Path(__file__).resolve().parent
    steps = [["tripo_assets.py", "import", asset_id, "--file", portable_path(glb), "--task", "local:texture_clean"]]
    steps += [["assetctl.py", s, asset_id] for s in ("build", "validate", "review")]
    for args in steps:
        r = subprocess.run([sys.executable] + args, cwd=here, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
        tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
        print(f"    {args[0]} {args[1]}: {'ok' if r.returncode == 0 else 'FAIL'}  {tail[0][:160]}")
        if r.returncode:
            raise PipelineError(f"{asset_id}: {' '.join(args[:2])} 失败")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("hp"); p.add_argument("ids", nargs="+"); p.add_argument("--run", action="store_true"); p.add_argument("--preview")
    a = ap.parse_args()
    failed = []
    for aid in a.ids:
        try:
            out = hp(aid, Path(a.preview) if a.preview else None)
            if out and a.run:
                run_pipeline(aid, out)
        except PipelineError as e:
            print(f"✘ {e}")
            failed.append(aid)
    sys.exit(1 if failed else 0)
