"""Prepare bounds-only references and ImageGen concepts for three Hunyuan landmarks.

No placeholder GLB or artistic mesh is created; later shapes come only from local
Hunyuan3D. The existing nature workflow supplies physical four-view registration.
This script never calls ImageGen, ComfyUI or Blender and does not approve reviews.

  python art/pipeline/prepare_landmark_batch.py --check
  python art/pipeline/prepare_landmark_batch.py
  python art/pipeline/prepare_landmark_batch.py --concepts art/pipeline/landmark_concepts.json

Concept JSON: [{"id": "SM_Env_DesertRuin", "path": "...png", "prompt": "exact prompt"}]
Each image is one front / left / back / right sheet. Relative image paths resolve
beside the JSON, and the original source, prompt and checksums remain versioned.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

# The local, keyless workflow must not read API credentials from .env.
os.environ["ART_PIPELINE_SKIP_ENV"] = "1"

from PIL import Image

from lib import imaging
from lib.config import CFG, ROOT, PipelineError
from lib.state import AssetState, sha256
from prepare_nature_batch import REGISTRATION_VERSION, prepare_reference, reference_data, register_panels

ASSETS = ("SM_Env_DesertRuin", "SM_Env_FrostWayshrine", "SM_Env_InfernoFoundry")


def register_concept(item: dict, source_dir: Path) -> dict:
    asset_id = item["id"]
    if asset_id not in ASSETS:
        raise PipelineError(f"{asset_id}: this batch only manages the three registered landmarks")
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
        raise PipelineError(f"{asset_id}: exact ImageGen prompt is required for provenance")
    source_hash = sha256(source)
    generator = item.get("generator", "Codex built-in image_gen")
    current = state.current("concept")
    if (current and current.get("from_blockout") == bo["version"]
            and current.get("source_sha256") == source_hash and current.get("prompt") == prompt
            and current.get("generator") == generator
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
    record = state.add_version("concept", {
        "version": version, "from_blockout": bo["version"], "generator": generator,
        "registration_version": REGISTRATION_VERSION, "source_image": str(source),
        "source_sha256": source_hash, "prompt": prompt, "reference_mode": "bounds_only",
        "registration": registration,
    }, files)
    print(f"CONCEPT_READY_FOR_REVIEW {asset_id} {sheet_path.relative_to(ROOT)} (not approved)", flush=True)
    return record


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="read-only specification check; creates no source artifacts")
    parser.add_argument("--concepts", type=Path, help="ImageGen source list JSON; relative paths resolve beside this JSON")
    args = parser.parse_args()
    try:
        if args.check:
            if args.concepts:
                raise PipelineError("--check cannot register concepts")
            for asset_id in ASSETS:
                spec = CFG.asset(asset_id)
                meta, _views = reference_data(spec)
                if spec.cls != "nature_prop":
                    raise PipelineError(f"{asset_id}: landmark must use the existing nature_prop budget")
                print(f"SPEC_READY {asset_id} bounds={meta['bounds']} LOD={spec.lod_tris} texture={spec.texture} mode={spec.raw.get('highpoly_mode', 'single')}", flush=True)
            return 0
        for asset_id in ASSETS:
            prepare_reference(asset_id)
        if args.concepts:
            source_list = args.concepts.resolve()
            items = json.loads(source_list.read_text(encoding="utf-8"))
            if not isinstance(items, list):
                raise PipelineError("Concept source JSON must be a list")
            for item in items:
                register_concept(item, source_list.parent)
    except (PipelineError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"✘ {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
