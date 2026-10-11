"""Register built-in ImageGen hero turnarounds without reading API credentials.

Input JSON: [{"id": "SK_Hero_Fox", "path": "...png", "prompt": "exact prompt"}].
Retains the original, aligns its four panels to the existing rig cameras and opens
a new concept version. This command does not approve or publish any asset.
"""
import argparse
import json
import os
import shutil
from pathlib import Path

os.environ["ART_PIPELINE_SKIP_ENV"] = "1"
from lib import imaging
from lib.config import CFG, ROOT, PipelineError
from lib.state import AssetState, sha256
from stages.concept import register_sheet, compare_sheet

HEROES = {"SK_Hero_Fox", "SK_Hero_Bear", "SK_Hero_Falcon"}

def register(item, source_dir):
    if item["id"] not in HEROES or not item.get("prompt", "").strip():
        raise PipelineError("Expected a registered hero and its complete generation prompt")
    spec = CFG.asset(item["id"])
    state = AssetState(spec)
    bo = state.require("blockout")
    source = Path(item["path"])
    if not source.is_absolute():
        source = source_dir / source
    source = source.resolve()
    current = state.current("concept")
    source_hash = sha256(source)
    if current and current.get("source_sha256") == source_hash and current.get("prompt") == item["prompt"]:
        print(f"UNCHANGED {spec.id}", flush=True)
        return
    version = state.next_version("concept")
    out = spec.stage_dir("concept")
    stem = f"CN_{spec.id}_v{version:03d}"
    original = out / f"{stem}_sheet.png"
    shutil.copyfile(source, original)
    refs = [state.file(bo, f"BO_{spec.id}_v{bo['version']:03d}_{v}.png") for v in imaging.VIEW_ORDER]
    registered = register_sheet(original, refs)
    files = [original]
    for view, (panel, _record) in zip(imaging.VIEW_ORDER, registered):
        path = out / f"{stem}_{view}.png"
        panel.save(path)
        files.append(path)
    comparison = out / f"{stem}_compare.png"
    ious = compare_sheet(refs, [panel for panel, _ in registered], comparison)
    prompt_file = out / f"{stem}_prompt.txt"
    prompt_file.write_text(item["prompt"], encoding="utf-8")
    files.extend([comparison, prompt_file])
    state.add_version("concept", {
        "version": version, "from_blockout": bo["version"],
        "generator": "Codex built-in image_gen", "source_sha256": source_hash,
        "source_image": str(source), "prompt": item["prompt"],
        "registration": dict(zip(imaging.VIEW_ORDER, [record for _, record in registered])),
        "silhouette_iou": dict(zip(imaging.VIEW_ORDER, ious)),
    }, files)
    print(f"REGISTERED {spec.id} v{version:03d}: IoU {ious}", flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    path = args.source.resolve()
    for item in json.loads(path.read_text(encoding="utf-8")):
        register(item, path.parent)

if __name__ == "__main__":
    main()
