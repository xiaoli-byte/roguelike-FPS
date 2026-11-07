"""Tripo Studio 纹理生成：给已发布的网格重出贴图，网格、尺寸、原点、挂点、关卡摆放都不动（2026-11-06 起）。

**2026-11-07 起不再用这条路给第三章件换贴图**：第三章 44 件重出的底色普遍偏紫（参考图把石面转成了冷暗紫，Tripo 把它烘进了固有色）、
锐度约减半，和用户 11-07「泛紫色、灰色」「贴图模糊」的反馈冲突；试点 3 件已退回 v001，全量铺开的 41 件不发布
（docs/art/ch3-kit.md 第 7.4 节）。固有色问题改用 texture_clean.py 在原始贴图上只调色。下面的 UV 核对、key_mask、tripo_source
仍被 texture_clean.py 引用。只有火坛（去掉烘进去的火苗）这种定点改内容的需求才值得再走一次，参考图要用中性白光、固有色。

Tripo Studio 左栏「纹理生成」可以上传自己的模型（OBJ / FBX / STL / GLB ≤ 150 MB），上传时打开「使用原始 UV」，
生成的底色贴图就落在原来的 UV 上。导出的 GLB 只带一张底色（4K JPEG），网格被 Tripo 归一化（高 = 1）并可能绕竖轴转 90°，
UV 不变——所以只取底色贴图，几何一律用我们自己的。

  python art/pipeline/retexture.py strip <ID...>
        去材质、只留几何 + UV 的上传件 → art/source/_tmp/retexture/<ID>_upload.glb
        Tripo 件取当前高模的 Tripo 原件（02_highpoly/HP_*_source.glb）；其他来源（Hunyuan）取已发布的 GLB
  python art/pipeline/retexture.py hp <ID> --file <Tripo 导出的 glb> --task <任务链接> [--note …]
        Tripo 件：Tripo 原件换上新底色 → art/source/_tripo_inbox/<UTC>_<ID>_retex.glb + 回执；
        接着照常 `tripo_assets.py import` → `assetctl build / validate / review / approve / publish`（法线、自发光遮罩、AO 按新底色重算）
  python art/pipeline/retexture.py build <ID> --file <Tripo 导出的 glb> --task <任务链接> [--bc <png>] [--e <png> | --e-none] [--note …]
        非 Tripo 件（高模不在本机，重跑不了 build）：当前发布件换底色（可选换自发光）出新的 build 版本，法线 / ORM 照旧；
        接着 `assetctl validate / review / approve / publish`
两条路都会先核对 Tripo 导出和上传件的 UV 是不是逐顶点对得上，对不上就拒绝。
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import struct
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import blender  # noqa: E402
from lib.config import CFG, ROOT, PipelineError  # noqa: E402
from lib.state import AssetState, portable_path, portable_record, sha256  # noqa: E402

WORK = ROOT / "art" / "source" / "_tmp" / "retexture"
INBOX = ROOT / "art" / "source" / "_tripo_inbox"
MANIFEST = ROOT / "public" / "assets" / "manifest.json"

# ───────────── GLB ─────────────

_CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def glb_read(path: Path) -> tuple[dict, bytes]:
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise PipelineError(f"{path} 不是 glTF 2.0 GLB")
    off, js, bn = 12, None, b""
    while off < length:
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            js = json.loads(chunk)
        elif ctype == b"BIN\x00":
            bn = bytes(chunk)
        off += 8 + clen
    return js, bn


def glb_write(path: Path, js: dict, bn: bytes) -> None:
    jb = json.dumps(js, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    jb += b" " * (-len(jb) % 4)
    bn += b"\0" * (-len(bn) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bn)
    out = struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(jb), b"JSON") + jb
    out += struct.pack("<I4s", len(bn), b"BIN\x00") + bn
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(out)


def image_bytes(js: dict, bn: bytes, index: int) -> bytes:
    bv = js["bufferViews"][js["images"][index]["bufferView"]]
    o = bv.get("byteOffset", 0)
    return bn[o: o + bv["byteLength"]]


def replace_images(js: dict, bn: bytes, new: dict[int, tuple[bytes, str]]) -> tuple[dict, bytes]:
    """Swap the bytes of some images (index → (bytes, mime)); every bufferView is re-laid out 4-byte aligned in order."""
    js = json.loads(json.dumps(js))
    by_view = {js["images"][i]["bufferView"]: (data, mime, i) for i, (data, mime) in new.items()}
    out = bytearray()
    for vi, bv in enumerate(js["bufferViews"]):
        o = bv.get("byteOffset", 0)
        chunk = by_view[vi][0] if vi in by_view else bn[o: o + bv["byteLength"]]
        out += b"\0" * (-len(out) % 4)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(chunk)
        out += chunk
    for data, mime, i in by_view.values():
        js["images"][i]["mimeType"] = mime
    js["buffers"][0]["byteLength"] = len(out)
    return js, bytes(out)


def base_color_image(js: dict) -> int:
    mat = js["materials"][0]
    tex = js["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    return tex.get("source", tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))


def emissive_image(js: dict) -> int | None:
    mat = js["materials"][0]
    if "emissiveTexture" not in mat:
        return None
    tex = js["textures"][mat["emissiveTexture"]["index"]]
    return tex.get("source", tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))


def geometry(js: dict, bn: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Positions and first UVs of every primitive (uncompressed GLBs only: the upload and the Tripo export)."""
    P, U = [], []

    def acc(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        dt, nc = _CT[a["componentType"]], _NC[a["type"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride") or np.dtype(dt).itemsize * nc
        raw = np.frombuffer(bn, np.uint8, count=stride * (a["count"] - 1) + np.dtype(dt).itemsize * nc, offset=start)
        rows = np.lib.stride_tricks.as_strided(raw, (a["count"], np.dtype(dt).itemsize * nc), (stride, 1))
        v = np.ascontiguousarray(rows).view(dt).reshape(a["count"], nc).astype(np.float64)
        if a.get("normalized") and dt != np.float32:
            v /= np.iinfo(dt).max
        return v

    for m in js["meshes"]:
        for pr in m["primitives"]:
            P.append(acc(pr["attributes"]["POSITION"]))
            U.append(acc(pr["attributes"]["TEXCOORD_0"]))
    return np.vstack(P), np.vstack(U)


def uv_match(upload: Path, export: Path) -> dict:
    """Tripo normalises the mesh (height 1) and may turn it in 90° steps about the vertical axis; find that turn,
    then check every exported vertex lands on an uploaded vertex with the same UV."""
    from scipy.spatial import cKDTree
    va, ua = geometry(*glb_read(upload))
    vb, ub = geometry(*glb_read(export))

    def norm(v):
        lo, hi = v.min(0), v.max(0)
        return (v - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]) / (hi[1] - lo[1])

    na, best = norm(va), None
    tree = cKDTree(na)
    for k in range(4):
        for flip in (1, -1):
            t = np.radians(90 * k)
            R = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]]) @ np.diag([flip, 1, 1])
            d, _ = tree.query(norm(vb @ R.T))
            if best is None or d.mean() < best[0]:
                best = (d.mean(), k, flip, d.max(), R)
    mean, k, flip, dmax, R = best
    h = float(va[:, 1].max() - va[:, 1].min())
    d, _ = cKDTree(np.hstack([na, ua])).query(np.hstack([norm(vb @ R.T), ub]))
    res = {"yaw_deg": 90 * k, "mirrored": bool(flip < 0), "pos_mean_mm": round(float(mean) * h * 1000, 3),
           "pos_max_mm": round(float(dmax) * h * 1000, 3), "uv_max": round(float(d.max()), 5),
           "uv_off_verts": int((d > 0.002).sum()), "verts_upload": len(va), "verts_export": len(vb)}
    if res["pos_max_mm"] > max(2.0, h * 1.0) or res["uv_off_verts"] > 0.001 * len(vb):
        raise PipelineError(f"{export.name}：和上传件对不上（{res}）——上传时没开「使用原始 UV」，或者 Tripo 改了网格")
    return res


def receipt_base(asset_id: str, file: Path, task: str, match: dict, note: str) -> dict:
    js, bn = glb_read(file)
    bc = image_bytes(js, bn, base_color_image(js))
    with Image.open(io.BytesIO(bc)) as im:
        size = im.size
    return {"asset": asset_id, "task": task, "source": str(file), "sha256": sha256(file),
            "tripo": {"mode": "纹理生成（上传网格，使用原始 UV）", "delight": True, "export": "GLB 4k",
                      "base_color": {"size": list(size), "bytes": len(bc)}},
            "uv_match": match, "note": note, "archived_utc": time.strftime("%Y%m%dT%H%M%S", time.gmtime())}


# ───────────── commands ─────────────

def upload_path(asset_id: str) -> Path:
    return WORK / f"{asset_id}_upload.glb"


def tripo_source(spec, st: AssetState) -> tuple[Path, int]:
    """The original Tripo generation behind the current high poly: a retextured high poly (its import receipt carries
    `retexture_of_highpoly`) points back to the version whose geometry and old texture it reused."""
    hp = st.require("highpoly")
    for _ in range(20):
        graph = next((n for n in hp["files"] if n.endswith("_graph.json")), None)
        rec = json.loads(st.file(hp, graph).read_text(encoding="utf-8")) if graph else {}
        receipt = rec.get("bridge_receipt") or {}
        back = receipt.get("retexture_of_highpoly")
        if not back and receipt.get("geometry_from"):  # receipts written before the field existed (11-06 pilot)
            import re
            m = re.search(r"_v(\d+)_source\.glb$", receipt["geometry_from"])
            back = int(m.group(1)) if m else None
        if not back:
            break
        hp = next(v for v in st.stage("highpoly")["versions"] if v["version"] == back)
    name = next((n for n in hp["files"] if n.endswith("_source.glb")), None)
    if not name:
        raise PipelineError(f"{spec.id}: 高模 v{hp['version']:03d} 没有 GLB 原件")
    src = st.file(hp, name)
    if not src.exists():
        raise PipelineError(f"{spec.id}: {portable_path(src)} 不在本机")
    return src, hp["version"]


def strip(asset_id: str) -> Path:
    spec = CFG.asset(asset_id)
    st = AssetState(spec)
    src = tripo_source(spec, st)[0] if spec.raw.get("source_provider") == "tripo" else spec.runtime_path
    out = upload_path(asset_id)
    res = blender.run("bl_strip_materials.py", {"source": str(src), "out_glb": str(out)}, WORK / f"_strip_{asset_id}", "strip")
    print(f"✔ {asset_id}：上传件 {portable_path(out)}（{res['tris']} 三角面，{res['bytes'] / 1024:.0f} KB，来自 {portable_path(src)}）")
    return out


def key_mask(rgb: np.ndarray, key: dict) -> np.ndarray:
    """Same colour key as bl_build_tripo.py's emissive mask (registry emissive_key), 0..1 soft."""
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6.0

    def ramp(x, lo, soft):
        return np.clip((x - lo) / max(soft, 1e-6) + 0.5, 0, 1)

    h0, h1 = key.get("hue", [0.02, 0.17])
    soft = key.get("soft", 0.06)
    m = (ramp(hue, h0, 0.02) * (1 - ramp(hue, h1, 0.02))
         * ramp(sat, key.get("min_sat", 0.55), soft) * ramp(mx, key.get("min_val", 0.75), soft))
    return np.where(mx - mn < 1e-6, 0, m)


def keep_lava(new_bc: Image.Image, old_bc: Image.Image, key: dict) -> tuple[Image.Image, dict]:
    """Lava stays exactly where the old texture had it (the UVs are the same): old keyed texels are copied back as
    they were; anything else the new texture painted bright enough to pass the key (a red lacquer emblem, an orange
    speck) is dimmed below it, so the emissive mask the build cuts can only light the original lava seams."""
    from PIL import ImageFilter
    size = new_bc.size
    old = np.asarray(old_bc.convert("RGB").resize(size, Image.Resampling.LANCZOS), np.float32) / 255
    new = np.asarray(new_bc.convert("RGB"), np.float32) / 255
    old_m = key_mask(old, key)
    hard = Image.fromarray(((old_m > 0.5) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    w = np.asarray(hard.filter(ImageFilter.GaussianBlur(1.0)), np.float32)[..., None] / 255
    out = new * (1 - w) + old * w
    stray = (key_mask(out, key) > 0.02) & (w[..., 0] < 0.5)
    mx = out.max(-1, keepdims=True)
    dim = np.where(stray[..., None], np.minimum(1.0, 0.74 / np.maximum(mx, 1e-6)), 1.0)
    out = out * dim
    stats = {"lava_texels_old": round(float((old_m > 0.5).mean()), 4),
             "lava_texels_new_raw": round(float((key_mask(new, key) > 0.5).mean()), 4),
             "dimmed_texels": round(float(stray.mean()), 4)}
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)), stats


def to_hp(asset_id: str, file: str, task: str, note: str, lava: bool = True) -> None:
    spec = CFG.asset(asset_id)
    if spec.raw.get("source_provider") != "tripo":
        raise PipelineError(f"{asset_id}: 不是 Tripo 件，用 `retexture.py build`")
    st = AssetState(spec)
    src, src_hp = tripo_source(spec, st)
    export = Path(file)
    up = upload_path(asset_id)
    if not up.exists():
        up = strip(asset_id)
    match = uv_match(up, export)
    ejs, ebn = glb_read(export)
    bc = image_bytes(ejs, ebn, base_color_image(ejs))
    mime = ejs["images"][base_color_image(ejs)].get("mimeType", "image/jpeg")
    sjs, sbn = glb_read(src)
    imgs = len(sjs.get("images", []))
    if imgs != 1:
        raise PipelineError(f"{src.name}: 原件有 {imgs} 张贴图（只认只带底色的 Tripo 原件）")
    lava_stats = None
    key = spec.raw.get("emissive_key")
    if lava and key:
        old_img = Image.open(io.BytesIO(image_bytes(sjs, sbn, base_color_image(sjs))))
        fixed, lava_stats = keep_lava(Image.open(io.BytesIO(bc)), old_img, key)
        buf = io.BytesIO()
        fixed.save(buf, "PNG")
        bc, mime = buf.getvalue(), "image/png"
        print(f"  熔岩留在原位：{lava_stats}")
    njs, nbn = replace_images(sjs, sbn, {base_color_image(sjs): (bc, mime)})
    stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    INBOX.mkdir(parents=True, exist_ok=True)
    out = INBOX / f"{stamp}_{asset_id}_retex.glb"
    glb_write(out, njs, nbn)
    shutil.copyfile(export, INBOX / f"{stamp}_{asset_id}_retex_tripo_export.glb")
    rec = receipt_base(asset_id, export, task, match, note)
    rec |= {"sha256": sha256(out), "tripo_export": f"{stamp}_{asset_id}_retex_tripo_export.glb",
            "tripo_export_sha256": sha256(export), "geometry_from": portable_path(src), "retexture_of_highpoly": src_hp,
            "geometry_sha256": sha256(src), "glb": {"bytes": out.stat().st_size, "images": 1},
            "keep_lava": lava_stats}
    out.with_suffix(".json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✔ {asset_id}：{portable_path(out)}（原件几何 + 新底色，UV 对齐 {match}）")
    print(f"  下一步：python art/pipeline/tripo_assets.py import {asset_id} --file {portable_path(out)} --task {task}")


def to_build(asset_id: str, file: str, task: str, bc_png: str | None, e_png: str | None, e_none: bool, note: str) -> None:
    spec = CFG.asset(asset_id)
    if spec.raw.get("source_provider") == "tripo":
        raise PipelineError(f"{asset_id}: Tripo 件走 `retexture.py hp`，让 build 按新底色重算法线和自发光")
    st = AssetState(spec)
    prev = st.require_any("build")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))["assets"][asset_id]
    base = spec.runtime_path
    if sha256(base) != manifest["sha256"]:
        raise PipelineError(f"{portable_path(base)} 和清单的校验和对不上")
    export = Path(file)
    up = upload_path(asset_id)
    if not up.exists():
        up = strip(asset_id)
    match = uv_match(up, export)

    size = spec.texture
    if bc_png:
        bc_img = Image.open(bc_png).convert("RGB")
    else:
        ejs, ebn = glb_read(export)
        bc_img = Image.open(io.BytesIO(image_bytes(ejs, ebn, base_color_image(ejs)))).convert("RGB")
    bc_img = bc_img.resize((size, size), Image.Resampling.LANCZOS)

    js, bn = glb_read(base)
    new: dict[int, tuple[bytes, str]] = {}

    def webp(im: Image.Image) -> bytes:
        b = io.BytesIO()
        im.save(b, "WEBP", quality=90, method=6)
        return b.getvalue()

    ei = emissive_image(js)
    glow_stats = None
    if ei is not None and not (e_png or e_none or bc_png):
        # Keep the published emissive mask: where it lights, put the old paint back (the glow and its colour stay
        # where they were); elsewhere dim anything the new texture painted bright orange enough to read as lava.
        from PIL import ImageFilter
        old_bc = Image.open(io.BytesIO(image_bytes(js, bn, base_color_image(js)))).convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
        old_e = Image.open(io.BytesIO(image_bytes(js, bn, ei))).convert("L").resize((size, size), Image.Resampling.LANCZOS)
        hard = old_e.point(lambda v: 255 if v > 128 else 0).filter(ImageFilter.MaxFilter(3))
        w = np.asarray(hard.filter(ImageFilter.GaussianBlur(1.0)), np.float32)[..., None] / 255
        nb = np.asarray(bc_img, np.float32) / 255
        ob = np.asarray(old_bc, np.float32) / 255
        out = nb * (1 - w) + ob * w
        key = spec.raw.get("emissive_key") or {"hue": [0.02, 0.17], "min_sat": 0.6, "min_val": 0.8}
        stray = (key_mask(out, key) > 0.02) & (w[..., 0] < 0.5)
        mx = out.max(-1, keepdims=True)
        out = out * np.where(stray[..., None], np.minimum(1.0, 0.74 / np.maximum(mx, 1e-6)), 1.0)
        bc_img = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
        glow_stats = {"glow_texels": round(float((w[..., 0] > 0.5).mean()), 4), "dimmed_texels": round(float(stray.mean()), 4)}
        print(f"  自发光遮罩不动，发光处放回旧底色：{glow_stats}")
    new[base_color_image(js)] = (webp(bc_img), "image/webp")
    e_img = None
    if e_png or e_none:
        if ei is None:
            raise PipelineError(f"{asset_id}: 发布件没有自发光贴图可换")
        e_img = Image.new("RGB", (size, size)) if e_none else Image.open(e_png).convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
        new[ei] = (webp(e_img), "image/webp")
    njs, nbn = replace_images(js, bn, new)

    ver = st.next_version("build")
    tag = f"{asset_id}_v{ver:03d}"
    work, export_dir = spec.stage_dir("build"), spec.stage_dir("export")
    out_glb = export_dir / f"{tag}.glb"
    glb_write(out_glb, njs, nbn)
    tex_dir = work / f"textures_v{ver:03d}"
    tex_dir.mkdir(parents=True, exist_ok=True)
    name = asset_id.split("_", 1)[1]
    files = [out_glb]
    for i, img in enumerate(njs["images"]):
        p = tex_dir / f"{img.get('name') or f'T_{name}_{i}'}.png"
        Image.open(io.BytesIO(image_bytes(njs, nbn, i))).save(p)
        files.append(p)
    prev_metrics_name = f"{asset_id}_v{prev['version']:03d}_metrics.json"
    metrics = json.loads(st.file(prev, prev_metrics_name).read_text(encoding="utf-8")) if prev_metrics_name in prev["files"] else {}
    stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    keep = shutil.copyfile(export, INBOX / f"{stamp}_{asset_id}_retex_tripo_export.glb")
    rec = receipt_base(asset_id, export, task, match, note) | {"tripo_export": Path(keep).name}
    Path(keep).with_suffix(".json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    metrics["retexture"] = {"from_build": prev["version"], "base_glb": portable_path(base), "base_sha256": manifest["sha256"],
                            "tripo_task": task, "tripo_export": portable_path(keep), "uv_match": match,
                            "replaced": ["BC"] + (["E"] if e_img is not None else []), "keep_glow": glow_stats,
                            "bc_source": portable_path(bc_png) if bc_png else "Tripo 导出的底色", "note": note}
    metrics["export"] = {"path": portable_path(out_glb), "bytes": out_glb.stat().st_size}
    mpath = work / f"{tag}_metrics.json"
    mpath.write_text(json.dumps(portable_record(metrics), ensure_ascii=False, indent=2), encoding="utf-8")
    files.append(mpath)
    st.add_version("build", {
        "version": ver, "from": prev.get("from"), "retexture_of": prev["version"], "tripo_task": task,
        "align_iou": prev.get("align_iou"), "uncovered_ratio": prev.get("uncovered_ratio"), "lods": prev.get("lods"),
        "export_kb": round(out_glb.stat().st_size / 1024, 1), "seconds": 0, "bake_device": "none (texture swap)",
        "note": note,
    }, files)
    print(f"✔ {asset_id} build v{ver:03d}：{portable_path(out_glb)}（{out_glb.stat().st_size / 1024:.0f} KB，换了 {metrics['retexture']['replaced']}）")
    print(f"  下一步：python art/pipeline/assetctl.py validate {asset_id} && … review / approve / publish")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("strip"); p.add_argument("ids", nargs="+")
    p = sub.add_parser("hp"); p.add_argument("id"); p.add_argument("--file", required=True); p.add_argument("--task", required=True)
    p.add_argument("--note", default="")
    p.add_argument("--no-keep-lava", action="store_true", help="不把熔岩缝按旧贴图放回原位（默认放回，并压暗新贴图里其他会被抠成自发光的亮橙红）")
    p = sub.add_parser("build"); p.add_argument("id"); p.add_argument("--file", required=True); p.add_argument("--task", required=True)
    p.add_argument("--bc"); p.add_argument("--e"); p.add_argument("--e-none", action="store_true"); p.add_argument("--note", default="")
    a = parser.parse_args()
    try:
        if a.cmd == "strip":
            for i in a.ids:
                strip(i)
        elif a.cmd == "hp":
            to_hp(a.id, a.file, a.task, a.note, not a.no_keep_lava)
        else:
            to_build(a.id, a.file, a.task, a.bc, a.e, a.e_none, a.note)
    except PipelineError as e:
        print(f"✘ {e}")
        sys.exit(1)
