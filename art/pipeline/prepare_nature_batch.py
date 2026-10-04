"""Register bounds-only references and built-in ImageGen concepts for Hunyuan nature assets.

No artistic mesh or placeholder GLB is created. The only shape source for the
later Blender build is the local Hunyuan highpoly. Concept images are uniformly
scaled to a physical height and centred in orthographic projection panels.

  python art/pipeline/prepare_nature_batch.py
  python art/pipeline/prepare_nature_batch.py --concepts art/pipeline/nature_concepts.json

The JSON is a list of {id, path, prompt, generator?}; each path is a four-view
sheet ordered front / left / back / right. No concept or review is approved here.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
from pathlib import Path

# This local, keyless workflow must not read API credentials from .env.
os.environ["ART_PIPELINE_SKIP_ENV"] = "1"

from PIL import Image

from lib import imaging
from lib.config import CFG, ROOT, PipelineError
from lib.state import AssetState, sha256

ASSETS = ("SM_Env_DesertSandstone", "SM_Env_FrostPine", "SM_Env_InfernoBasalt")
PANEL = (512, 1024)
REGISTRATION_VERSION = 1
VIEWS = {
    "front": ([0, 1, 0], [1, 0, 0]),
    "left": ([-1, 0, 0], [0, 1, 0]),
    "back": ([0, -1, 0], [-1, 0, 0]),
    "right": ([1, 0, 0], [0, -1, 0]),
}


def reference_data(spec) -> tuple[dict, dict]:
    if spec.kind != "static" or spec.raw.get("reference_mode") != "bounds_only":
        raise PipelineError(f"{spec.id}: requires a static bounds_only reference")
    dims = [float(v) for v in spec.raw["reference_dimensions"]]
    if len(dims) != 3 or any(not math.isfinite(v) or v <= 0 for v in dims):
        raise PipelineError(f"{spec.id}: reference_dimensions must contain three positive metres")
    width, height, depth = dims
    bounds = {"min": [-width / 2, 0, -depth / 2], "max": [width / 2, height, depth / 2]}
    meta = {"schema": 1, "assetId": spec.id, "source": {"kind": "scene", "id": spec.blockout["id"]},
            "reference_mode": "bounds_only", "bounds": bounds, "joints": [],
            "note": "Numeric size/pivot reference only. No blockout mesh; the artistic shape must come from local Hunyuan3D."}
    pw, ph = PANEL
    world_h = max(height * 1.12, max(width, depth) * 1.12 * ph / pw)
    cameras = []
    for view, (direction, right) in VIEWS.items():
        cameras.append({"view": view, "dir": direction, "right": right, "up": [0, 0, 1],
                        "center": [0, 0, height / 2], "world_w": world_h * pw / ph,
                        "world_h": world_h, "px_w": pw, "px_h": ph})
    views = {"panel": list(PANEL), "views": cameras, "bbox_min": [-width / 2, -depth / 2, 0],
             "bbox_max": [width / 2, depth / 2, height], "presentation": None,
             "reference_mode": "bounds_only"}
    return meta, views


def prepare_reference(asset_id: str) -> dict:
    spec = CFG.asset(asset_id)
    state = AssetState(spec)
    meta, views = reference_data(spec)
    current = state.current("blockout")
    if current and current.get("reference_mode") == "bounds_only":
        stem = f"BO_{asset_id}_v{current['version']:03d}"
        old_meta = json.loads(state.file(current, f"{stem}.json").read_text(encoding="utf-8"))
        old_views = json.loads(state.file(current, f"{stem}_views.json").read_text(encoding="utf-8"))
        if old_meta == meta and old_views == views:
            print(f"REFERENCE_UNCHANGED {asset_id} v{current['version']:03d}", flush=True)
            return current
    version = state.next_version("blockout")
    out = spec.stage_dir("blockout")
    stem = f"BO_{asset_id}_v{version:03d}"
    paths = [out / f"{stem}.json", out / f"{stem}_views.json"]
    for path, data in zip(paths, [meta, views]):
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    record = state.add_version("blockout", {"version": version, "source": meta["source"], "joints": 0,
                              "bounds": meta["bounds"], "reference_mode": "bounds_only",
                              "geometry_created": False}, paths)
    print(f"REFERENCE_READY {asset_id} bounds={meta['bounds']} (metadata only)", flush=True)
    return record


def register_panels(sheet: Image.Image, views: dict, height: float) -> tuple[list[Image.Image], dict]:
    figures = imaging.segment_figures(imaging.key_flat_background(sheet), 4)
    panels, registration = [], {}
    for view, figure, camera in zip(imaging.VIEW_ORDER, figures, views["views"]):
        mask = imaging.alpha_mask(figure)
        if not mask.any():
            raise PipelineError(f"{view}: concept view is empty")
        figure = figure.crop(imaging.bbox(mask))
        scale = height * camera["px_h"] / camera["world_h"] / figure.height
        width_px, height_px = max(1, round(figure.width * scale)), max(1, round(figure.height * scale))
        pw, ph = camera["px_w"], camera["px_h"]
        if width_px > pw - 4 or height_px > ph - 4:
            raise PipelineError(f"{view}: silhouette exceeds the numeric reference framing; adjust the reference dimensions or concept, do not squeeze the shape")
        resized = figure.resize((width_px, height_px), Image.Resampling.LANCZOS)
        panel = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        offset = [(pw - width_px) // 2, (ph - height_px) // 2]
        panel.alpha_composite(resized, tuple(offset))
        panels.append(panel)
        registration[view] = {"scale": scale, "offset": offset, "size": [width_px, height_px],
                              "physical_height_m": height, "method": "uniform_height_and_center"}
    return panels, registration


def register_concept(item: dict, source_dir: Path) -> dict:
    asset_id = item["id"]
    if asset_id not in ASSETS:
        raise PipelineError(f"{asset_id}: this script only manages the three registered nature assets")
    spec = CFG.asset(asset_id)
    state = AssetState(spec)
    bo = state.require("blockout")
    if bo.get("reference_mode") != "bounds_only":
        raise PipelineError(f"{asset_id}: prepare the numeric reference first")
    source = Path(item["path"])
    if not source.is_absolute():
        source = source_dir / source
    source = source.resolve()
    prompt = item.get("prompt", "").strip()
    if not prompt:
        raise PipelineError(f"{asset_id}: the exact ImageGen prompt is required for provenance")
    source_hash = sha256(source)
    generator = item.get("generator", "Codex built-in image_gen")
    current = state.current("concept")
    if (current and current.get("from_blockout") == bo["version"] and current.get("source_sha256") == source_hash
            and current.get("prompt") == prompt and current.get("generator") == generator
            and current.get("registration_version", 1) == REGISTRATION_VERSION):
        print(f"CONCEPT_UNCHANGED {asset_id} v{current['version']:03d}", flush=True)
        return current
    views_path = state.file(bo, f"BO_{asset_id}_v{bo['version']:03d}_views.json")
    views = json.loads(views_path.read_text(encoding="utf-8"))
    with Image.open(source) as image:
        panels, registration = register_panels(image.convert("RGBA"), views, spec.raw["reference_dimensions"][1])
    version = state.next_version("concept")
    out = spec.stage_dir("concept")
    stem = f"CN_{asset_id}_v{version:03d}"
    original = out / f"{stem}_source{source.suffix.lower()}"
    shutil.copyfile(source, original)
    files = [original]
    for view, panel in zip(imaging.VIEW_ORDER, panels):
        path = out / f"{stem}_{view}.png"
        panel.save(path)
        files.append(path)
    sheet_path = out / f"{stem}_sheet.png"
    imaging.compose_row(files[1:], sheet_path)
    prompt_path = out / f"{stem}_prompt.txt"
    prompt_path.write_text(prompt, encoding="utf-8")
    alignment_path = out / f"{stem}_registration.json"
    alignment_path.write_text(json.dumps(registration, indent=2), encoding="utf-8")
    files.extend([sheet_path, prompt_path, alignment_path])
    record = state.add_version("concept", {"version": version, "from_blockout": bo["version"],
                              "generator": generator, "registration_version": REGISTRATION_VERSION,
                              "source_image": str(source), "source_sha256": source_hash, "prompt": prompt,
                              "reference_mode": "bounds_only", "registration": registration}, files)
    print(f"CONCEPT_READY_FOR_REVIEW {asset_id} {sheet_path.relative_to(ROOT)} (not approved)", flush=True)
    return record


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--concepts", type=Path, help="ImageGen source list JSON; relative image paths resolve beside this JSON")
    args = parser.parse_args()
    try:
        for asset_id in ASSETS:
            prepare_reference(asset_id)
        if args.concepts:
            source_list = args.concepts.resolve()
            items = json.loads(source_list.read_text(encoding="utf-8"))
            if not isinstance(items, list):
                raise PipelineError("Concept source JSON must be a list")
            for item in items:
                register_concept(item, source_list.parent)
    except (PipelineError, OSError, ValueError, KeyError) as error:
        print(f"✘ {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
