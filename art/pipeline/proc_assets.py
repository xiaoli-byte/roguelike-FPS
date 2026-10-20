"""Blender-modelled map kit (registry `source_provider = "blender"`, recipe in [assets.<ID>.proc]).

  python proc_assets.py build <ID> [<ID> ...]

The user turned down the Tripo chapter-1 kit (2026-10-20: mushy blobs, broken leaf patches, a lump of sand for a
base) and asked for local Blender modelling. blender/bl_proc_desert.py builds every LOD from a code recipe and paints
its own atlas; this script records the result in the normal asset state so the rest of the route is unchanged:

  blockout  bounds-only reference sized from the model itself (the recipe decides the size; a mismatch with the
            registry's reference_dimensions is reported so the registry can be updated)
  concept   the four orthographic renders, already in the reference camera frames (no keying / registration)
  highpoly  the generated GLB (tool Blender, mode procedural, recipe@seed) — there is no separate sculpt
  build     the same GLB with its .blend, textures and metrics (LODs are modelled, not decimated)

Then: assetctl validate / review / approve / publish → unity_export.py → bridge.sh sync.
A three-quarter beauty render goes to docs/art/review/<asset>-v<build>.jpg for the report.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

from lib import blender, imaging
from lib.config import CFG, ROOT, PipelineError  # before prepare_nature_batch: it disables .env (ART_BLENDER) on import
from lib.state import AssetState, portable_record, sha256

import prepare_nature_batch as nature  # bounds-only reference

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REVIEW_DIR = ROOT / "docs" / "art" / "review"


def kebab(asset_id: str) -> str:
    name = asset_id.split("_", 2)[-1]
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


def build(asset_id: str) -> None:
    spec = CFG.asset(asset_id)
    if spec.raw.get("source_provider") != "blender":
        raise PipelineError(f"{asset_id}: registry entry is not a Blender-modelled asset")
    proc = spec.raw.get("proc") or {}
    if "recipe" not in proc:
        raise PipelineError(f"{asset_id}: [assets.{asset_id}.proc] recipe missing")
    st = AssetState(spec)
    ver = st.next_version("build")
    tag = f"{asset_id}_v{ver:03d}"
    work, export_dir = spec.stage_dir("build"), spec.stage_dir("export")
    name = asset_id.split("_", 1)[1]
    tmp = spec.dir / "_tmp" / f"proc_v{ver:03d}"
    beauty = tmp / "beauty.png"
    params = {"asset_id": asset_id, "recipe": proc["recipe"], "seed": proc.get("seed", 1), "texture": spec.texture,
              "lod_tris": spec.lod_tris, "lod_distance": spec.lod_distance,
              "texture_dir": str(work / f"textures_v{ver:03d}"), "texture_basename": f"T_{name}",
              "out_glb": str(export_dir / f"{tag}.glb"), "out_blend": str(work / f"{tag}.blend"),
              "render_dir": str(tmp / "views"), "beauty_png": str(beauty)}
    print(f"→ Blender 建模 {tag}（{proc['recipe']} @ seed {params['seed']}，LOD {spec.lod_tris}，贴图 {spec.texture}²）…", flush=True)
    res = blender.run("bl_proc_desert.py", params, tmp, "proc")

    # blockout: the reference is the model's own size
    dims = res["reference_dimensions"]
    if [round(float(x), 2) for x in spec.raw.get("reference_dimensions", [])] != dims:
        print(f"  ⚠ registry reference_dimensions {spec.raw.get('reference_dimensions')} ≠ 模型 {dims}；"
              f"请把 registry 改成 reference_dimensions = {dims}")
    spec.raw["reference_dimensions"] = dims
    bo = nature.prepare_reference(asset_id)
    bo = AssetState(spec).current("blockout")
    st = AssetState(spec)

    # concept: the renders are already the registered panels
    cv = st.next_version("concept")
    stem = f"CN_{asset_id}_v{cv:03d}"
    cdir = spec.stage_dir("concept")
    panels = []
    for view in imaging.VIEW_ORDER:
        dst = cdir / f"{stem}_{view}.png"
        shutil.copyfile(tmp / "views" / f"{view}.png", dst)
        panels.append(dst)
    sheet = cdir / f"{stem}_sheet.png"
    imaging.compose_row(panels, sheet)
    st.add_version("concept", {"version": cv, "from_blockout": bo["version"], "generator": "Blender procedural render",
                               "recipe": proc["recipe"], "seed": params["seed"], "reference_mode": "bounds_only",
                               "highpoly_mode": "procedural",
                               "registration": {"method": "rendered in the reference cameras"}}, [*panels, sheet])

    # highpoly: the generated GLB itself
    hv = st.next_version("highpoly")
    hp = spec.stage_dir("highpoly") / f"HP_{asset_id}_v{hv:03d}.glb"
    shutil.copyfile(export_dir / f"{tag}.glb", hp)
    st.add_version("highpoly", {"version": hv, "from_concept": cv, "mode": "procedural",
                                "tool": f"Blender {CFG.tools.get('blender_version', '5.2')} bpy",
                                "checkpoint": f"{proc['recipe']}@{params['seed']}",
                                "license": "project-original procedural model (art/pipeline/blender/bl_proc_desert.py)",
                                "faces": res["lods"][0]["tris"], "source_sha256": sha256(hp)}, [hp])

    metrics = work / f"{tag}_metrics.json"
    metrics.write_text(json.dumps(portable_record(res), ensure_ascii=False, indent=2), encoding="utf-8")
    tex = sorted((work / f"textures_v{ver:03d}").glob("*.png"))
    st.add_version("build", {
        "version": ver, "from": {"blockout": bo["version"], "concept": cv, "highpoly": hv, "matid": None, "emid": None},
        "align_iou": 1.0, "uncovered_ratio": 0.0, "procedural": {"recipe": proc["recipe"], "seed": params["seed"]},
        "lods": [{"tris": l["tris"], "verts": l["verts"]} for l in res["lods"]],
        "export_kb": round(res["export"]["bytes"] / 1024, 1), "seconds": res["_seconds"], "bake_device": res["bake_device"],
    }, [work / f"{tag}.blend", export_dir / f"{tag}.glb", metrics, *tex])

    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    jpg = REVIEW_DIR / f"{kebab(asset_id)}-v{ver:03d}.jpg"
    Image.open(beauty).convert("RGB").save(jpg, quality=88)
    print(f"✔ {asset_id} build v{ver:03d}：LOD {[l['tris'] for l in res['lods']]}，{res['export']['bytes'] / 1024:.0f} KB，"
          f"尺寸 {dims}（宽 × 高 × 深），审核图 {jpg.relative_to(ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("ids", nargs="+")
    a = ap.parse_args()
    try:
        for i in a.ids:
            build(i)
    except PipelineError as e:
        print(f"✘ {e}")
        sys.exit(1)
