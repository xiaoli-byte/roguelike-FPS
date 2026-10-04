"""Prepare three full-bodied Hunyuan cliff masses using bounds-only references.

  python art/pipeline/prepare_cliff_batch.py --check
  python art/pipeline/prepare_cliff_batch.py --concepts art/pipeline/cliff_concepts_v001.json

Reuses the landmark batch's original-image / exact-prompt / hash registration.
No artistic mesh, ImageGen call, GPU inference, approval or publish occurs here.
The concept JSON is a list of {id, path, prompt, generator?}; each original sheet
contains front / left / back / right views at a common physical scale.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

os.environ["ART_PIPELINE_SKIP_ENV"] = "1"

import prepare_landmark_batch as landmark_registration
from PIL import Image
from lib.config import CFG, PipelineError
from lib.state import AssetState, sha256
from prepare_nature_batch import prepare_reference, reference_data

ASSETS = ("SM_Env_DesertCliff", "SM_Env_FrostCliff", "SM_Env_InfernoCliff")
# Original silhouettes are wider than the nominal 12m art brief. Preserve their
# physical aspect at 9m height; runtime placement uniformly fits its own envelope.
REFERENCE_WIDTHS = {"SM_Env_DesertCliff": 15.0, "SM_Env_FrostCliff": 15.6,
                    "SM_Env_InfernoCliff": 14.5}


def check_spec(asset_id: str) -> dict:
    if asset_id not in ASSETS:
        raise PipelineError(f"{asset_id}: this batch only manages the three cliff assets")
    spec = CFG.asset(asset_id)
    meta, _views = reference_data(spec)
    if list(spec.raw["reference_dimensions"]) != [REFERENCE_WIDTHS[asset_id], 9.0, 7.0]:
        raise PipelineError(f"{asset_id}: preserve the actual concept width and 9h / 7d metre reference")
    if (spec.cls != "nature_prop" or spec.lod_tris != [5000, 1600, 500]
            or spec.texture != 1024 or spec.max_file_kb != 900):
        raise PipelineError(f"{asset_id}: preserve the existing nature_prop budgets")
    if spec.raw.get("highpoly_mode") != "multiview" or spec.raw.get("qa_waivers"):
        raise PipelineError(f"{asset_id}: use Hunyuan multi-view with no QA waivers")
    return meta


def register_concept(item: dict, source_dir: Path) -> dict:
    check_spec(item["id"])
    # The existing helper has a batch-local allowlist. Scope it only during this
    # synchronous call and restore it, leaving its source and other batches intact.
    previous = landmark_registration.ASSETS
    try:
        landmark_registration.ASSETS = ASSETS
        record = landmark_registration.register_concept(item, source_dir)
    finally:
        landmark_registration.ASSETS = previous
    spec = CFG.asset(item["id"])
    out = spec.stage_dir("concept")
    stem = f"CN_{spec.id}_v{record['version']:03d}"
    files, references = [], []
    reference_images = item.get("reference_images", [])
    if not isinstance(reference_images, list):
        raise PipelineError(f"{spec.id}: reference_images must be original input paths")
    for index, value in enumerate(reference_images, start=1):
        source = Path(value)
        if not source.is_absolute():
            source = source_dir / source
        source = source.resolve()
        digest = sha256(source)
        copied = out / f"{stem}_reference_{index:02d}{source.suffix.lower()}"
        if copied.exists():
            if sha256(copied) != digest:
                raise PipelineError(f"{spec.id}: never overwrite an existing reference input")
        else:
            shutil.copyfile(source, copied)
        files.append(copied)
        references.append({"source_image": str(source), "source_sha256": digest,
                           "registered_file": copied.name})
    design_prompt = item.get("original_design_prompt")
    if design_prompt is not None:
        if not isinstance(design_prompt, str) or not design_prompt.strip():
            raise PipelineError(f"{spec.id}: original_design_prompt must preserve the actual original prompt")
        prompt_path = out / f"{stem}_original_design_prompt.txt"
        if prompt_path.exists() and prompt_path.read_text(encoding="utf-8") != design_prompt:
            raise PipelineError(f"{spec.id}: never overwrite an existing original design prompt")
        if not prompt_path.exists():
            prompt_path.write_text(design_prompt, encoding="utf-8")
        files.append(prompt_path)
    with Image.open(record["source_image"]) as image:
        histogram = image.convert("RGBA").getchannel("A").histogram()
        transparent_fraction = sum(histogram[:250]) / sum(histogram)
    state = AssetState(spec)
    with state._locked():
        target = state._find("concept", record["version"])
        if target.get("reference_images") not in (None, references):
            raise PipelineError(f"{spec.id}: original reference provenance changed; register a new concept")
        if references:
            target["reference_images"] = references
        if design_prompt is not None:
            target["original_design_prompt"] = design_prompt
        target["native_alpha"] = {"transparent_fraction": transparent_fraction,
                                  "existing_alpha_preserved": transparent_fraction > 0.05}
        for path in files:
            target["files"][path.name] = {"path": state._rel(path), "sha256": sha256(path)}
    print(f"ORIGINAL_PROVENANCE_READY {spec.id} CN v{record['version']:03d} references={len(references)} native_alpha_fraction={transparent_fraction:.4f}", flush=True)
    return target


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="read-only specification check; creates no source artifacts")
    parser.add_argument("--concepts", type=Path, help="original ImageGen source list; paths resolve beside this JSON")
    parser.add_argument("--assets", nargs="+", choices=ASSETS, help="limit this operation to a subset")
    args = parser.parse_args()
    try:
        asset_ids = tuple(args.assets or ASSETS)
        if len(set(asset_ids)) != len(asset_ids):
            raise PipelineError("--assets must not contain duplicates")
        if args.check and args.concepts:
            raise PipelineError("--check cannot register concepts")
        for asset_id in asset_ids:
            meta = check_spec(asset_id)
            if args.check:
                print(f"SPEC_READY {asset_id} bounds={meta['bounds']} LOD=5000/1600/500 texture=1024 max_file_kb=900 mode=multiview", flush=True)
        if args.check:
            return 0
        items = []
        if args.concepts:
            source_list = args.concepts.resolve()
            items = json.loads(source_list.read_text(encoding="utf-8"))
            if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
                raise PipelineError("Concept source JSON must be a list of objects")
            ids = [item["id"] for item in items]
            if len(set(ids)) != len(ids) or any(asset_id not in ASSETS for asset_id in ids):
                raise PipelineError("Concept source list must contain unique cliff IDs")
        for asset_id in asset_ids:
            prepare_reference(asset_id)
        for item in items:
            if item["id"] in asset_ids:
                register_concept(item, source_list.parent)
    except (PipelineError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"✘ {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
