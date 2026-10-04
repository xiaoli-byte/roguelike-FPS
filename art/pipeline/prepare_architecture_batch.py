"""Register six bounds-only architectural references and original ImageGen concepts.

No artistic mesh, placeholder GLB, image generation, inference or approval is
performed here. Local Hunyuan3D multi-view reconstruction supplies the geometry.
Original four-view sheets, exact prompts, registrations and hashes stay versioned.
The registered gate clearance is a requirement, not a measurement of generated
geometry; the finished opening must be checked before review approval.

  python art/pipeline/prepare_architecture_batch.py --check
  python art/pipeline/prepare_architecture_batch.py
  python art/pipeline/prepare_architecture_batch.py --concepts art/pipeline/architecture_concepts.json

Concept JSON is a list of {id, path, prompt, generator?}. Each original sheet is
ordered front / left / back / right; relative paths resolve beside that JSON.
For edited concepts, reference_images preserves the original native input paths
and copies their exact pixels with versioned filenames and hashes.
Use --assets to prepare or register a subset without touching the other assets.
"""
from __future__ import annotations

import argparse
import json
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
from prepare_nature_batch import REGISTRATION_VERSION, prepare_reference, reference_data, register_panels

ASSETS = tuple(f"SM_Env_{theme}{role}" for theme in ("Desert", "Frost", "Inferno") for role in ("Wall", "Gate"))
DIMENSIONS = {"wall": [6.6, 4.4, 1.3], "gate": [10.5, 6.8, 1.7]}
# Original ImageGen silhouettes are registered at their actual aspect without
# squeezing. Runtime placement can uniformly fit its reserved envelope.
DIMENSION_OVERRIDES = {"SM_Env_DesertWall": [7.5, 4.4, 1.5],
                       "SM_Env_FrostWall": [7.9, 4.4, 1.7],
                       "SM_Env_InfernoWall": [9.0, 4.4, 2.1]}


def check_spec(asset_id: str) -> dict:
    """Check this batch's numerical requirements without creating source files."""
    if asset_id not in ASSETS:
        raise PipelineError(f"{asset_id}: not one of the six architecture assets")
    spec = CFG.asset(asset_id)
    meta, _views = reference_data(spec)
    role = spec.raw.get("architecture_role")
    if role not in DIMENSIONS or role != ("wall" if asset_id.endswith("Wall") else "gate"):
        raise PipelineError(f"{asset_id}: architecture_role must match its asset ID")
    dimensions = DIMENSION_OVERRIDES.get(asset_id, DIMENSIONS[role])
    if list(spec.raw["reference_dimensions"]) != dimensions:
        raise PipelineError(f"{asset_id}: unexpected width/height/depth reference")
    if (spec.cls != "nature_prop" or spec.lod_tris != [5000, 1600, 500]
            or spec.texture != 1024 or spec.max_file_kb != 900):
        raise PipelineError(f"{asset_id}: preserve the existing nature_prop LOD/texture/file budget")
    if spec.raw.get("highpoly_mode") != "multiview":
        raise PipelineError(f"{asset_id}: architectural volume requires Hunyuan multi-view")
    if spec.raw.get("qa_waivers"):
        raise PipelineError(f"{asset_id}: this batch must not waive QA checks")
    requirements = {"role": role, "dimensions_m": dimensions}
    if role == "gate":
        if (spec.raw.get("passage_min_width_m") != 6.4
                or spec.raw.get("lintel_bottom_target_m") != 3.8):
            raise PipelineError(f"{asset_id}: preserve the 6.4m clear opening and 3.8m lintel target")
        requirements.update({"passage_min_width_m": 6.4, "lintel_bottom_target_m": 3.8,
                             "ground_passage_open": True})
    return {"bounds": meta["bounds"], "requirements": requirements}


def register_concept(item: dict, source_dir: Path) -> dict:
    asset_id = item["id"]
    checked = check_spec(asset_id)
    spec = CFG.asset(asset_id)
    state = AssetState(spec)
    bo = state.require("blockout")
    if bo.get("reference_mode") != "bounds_only" or bo.get("geometry_created") is not False:
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
    reference_images = item.get("reference_images", [])
    if not isinstance(reference_images, list):
        raise PipelineError(f"{asset_id}: reference_images must be a list of original input paths")
    reference_paths, reference_records = [], []
    for path in reference_images:
        reference = Path(path)
        if not reference.is_absolute():
            reference = source_dir / reference
        reference = reference.resolve()
        reference_paths.append(reference)
        reference_records.append({"source_image": str(reference), "source_sha256": sha256(reference)})
    current = state.current("concept")
    if (current and current.get("from_blockout") == bo["version"]
            and current.get("source_sha256") == source_hash and current.get("prompt") == prompt
            and current.get("generator") == generator
            and current.get("registration_version", 1) == REGISTRATION_VERSION
            and current.get("architecture_requirements") == checked["requirements"]
            and (not reference_records or current.get("reference_provenance_version") == 1)
            and [{k: r[k] for k in ("source_image", "source_sha256")} for r in current.get("reference_images", [])] == reference_records):
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
    for index, (reference, record) in enumerate(zip(reference_paths, reference_records), start=1):
        copied = out / f"{stem}_reference_{index:02d}{reference.suffix.lower()}"
        shutil.copyfile(reference, copied)
        files.append(copied)
        record["registered_file"] = copied.name
    panel_paths = []
    for view, panel in zip(imaging.VIEW_ORDER, panels):
        path = out / f"{stem}_{view}.png"
        panel.save(path)
        files.append(path)
        panel_paths.append(path)
    sheet_path = out / f"{stem}_sheet.png"
    imaging.compose_row(panel_paths, sheet_path)
    prompt_path = out / f"{stem}_prompt.txt"
    prompt_path.write_text(prompt, encoding="utf-8")
    alignment_path = out / f"{stem}_registration.json"
    alignment_path.write_text(json.dumps(registration, indent=2), encoding="utf-8")
    files.extend([sheet_path, prompt_path, alignment_path])
    record = state.add_version("concept", {
        "version": version, "from_blockout": bo["version"], "generator": generator,
        "registration_version": REGISTRATION_VERSION, "source_image": str(source),
        "source_sha256": source_hash, "prompt": prompt, "reference_mode": "bounds_only",
        "reference_images": reference_records, "reference_provenance_version": 1,
        "highpoly_mode": "multiview", "architecture_requirements": checked["requirements"],
        "registration": registration,
    }, files)
    print(f"CONCEPT_READY_FOR_REVIEW {asset_id} {sheet_path.relative_to(ROOT)} (not approved)", flush=True)
    return record


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="read-only specification check; creates no source artifacts")
    parser.add_argument("--concepts", type=Path, help="original ImageGen source list; relative paths resolve beside this JSON")
    parser.add_argument("--assets", nargs="+", choices=ASSETS, help="limit this operation to the selected assets")
    args = parser.parse_args()
    try:
        asset_ids = tuple(args.assets or ASSETS)
        if len(set(asset_ids)) != len(asset_ids):
            raise PipelineError("--assets must not contain duplicates")
        if args.check and args.concepts:
            raise PipelineError("--check cannot register concepts")
        for asset_id in asset_ids:
            checked = check_spec(asset_id)
            if args.check:
                print(f"SPEC_READY {asset_id} bounds={checked['bounds']} LOD=5000/1600/500 texture=1024 max_file_kb=900 mode=multiview requirements={checked['requirements']}", flush=True)
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
                raise PipelineError("Concept source list must contain unique architecture IDs")
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
