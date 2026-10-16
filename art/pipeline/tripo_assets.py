"""Tripo Studio route for bounds-only assets (registry `source_provider = "tripo"`).

  python tripo_assets.py concept <ID...>            GPT Image four-view sheet → registered CN views (review gate stays closed)
  python tripo_assets.py rekey <ID...>              re-register the current concept's source sheet as a new version (no API call)
  python tripo_assets.py adopt <ID> --design <KEY>  register the latest design turnaround (redesign_sheets.py --turnaround)
                                                    as this asset's concept views (review gate stays closed)
  python tripo_assets.py inputs <ID>                print the four registered views to upload as Tripo multiview input
  python tripo_assets.py import <ID> --file <inbox file> --task <studio url> [--model P2.0]
                                                    provider original from the DCC Bridge inbox → HP GLB + highpoly record
Then the normal stages run: assetctl build / validate / review / approve / publish.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from lib.config import CFG, PipelineError, _load_env
from lib import blender, imaging, openai_image
from lib.state import AssetState, portable_path, resolve_path, sha256
from PIL import Image

import prepare_nature_batch as nature  # bounds-only reference + four-figure registration (sets SKIP_ENV on import)

SCENE_STYLE = """Stylized hand-painted 3D game environment art for a fast first-person roguelite shooter, matching the
readable visual direction of Gunfire Reborn: bold chunky silhouettes, broad clean faceted planes, two or three dominant
colour blocks, soft painted gradients and a few restrained edge accents. {theme} Matte stone,
wood and cloth, restrained highlights on metal, sparse painted wear. No photorealism, micro-grain, dense tiny cracks,
elaborate miniature carvings, harsh specular highlights or baked cast shadows. Even neutral lighting."""

# Background key tolerance per theme: white snow sits close to the #D6D6D6 sheet background, so a loose key eats snow
# caps; the generated background is flat (border std < 1), so a tight key leaves no fringe.
KEY_TOL = {"desert": 28.0, "kunlun": 8.0, "taoist": 8.0, "beiming": 8.0,
           # Chapter 3's black iron / basalt / lava sits far from the grey background; a medium key also clears the
           # anti-aliased grey halo around dark silhouettes without reaching pale ash or bronze highlights.
           "zhurong": 18.0}

# Per-chapter look, chosen by the registry entry's `style_theme` (default: the desert chapter's).
SCENE_THEMES = {
    "desert": "East-Asian desert temple fantasy.",
    "kunlun": ("East-Asian snowy Kunlun mountain palace fantasy from the Shan Hai Jing: white jade stone, verdigris bronze, "
               "faded vermilion lacquer, thick soft snow caps and a few chunky glacier-blue ice shapes."),
    # Chapter 2 alternative B (寒山道观): timber cliff abbey instead of the jade palace.
    "taoist": ("East-Asian snowy Taoist cliff abbey fantasy in the style of the Hanging Temple: dark weathered timber frames, "
               "cinnabar-red lacquered posts, slate-grey tiled roofs with upturned eaves, yellow paper talismans, verdigris "
               "bronze fittings, thick soft snow caps and a few chunky icicles."),
    # Chapter 2 alternative C (北冥冰海): frozen polar sea, glacier cliffs, whale bone and shipwreck timber.
    "beiming": ("East-Asian frozen polar sea fantasy from the Zhuangzi's northern darkness: faceted glacier ice and dark ink-blue rock, "
                "weathered ivory whale bone, old dark ship timber with faded teal paint, frozen ropes, felt and a cold aqua "
                "deep-sea glow, thick soft snow caps and chunky icicles."),
    # Chapter 3 (祝融火狱): the fire god Zhurong's underground forge palace.
    "zhurong": ("East-Asian underground forge-palace fantasy of Zhurong, the Chinese god of fire: massive black iron (xuan tie) "
                "with heavy rivets, dark charcoal basalt blocks, deep vermilion lacquer, warm aged bronze ding cauldrons, chunky "
                "thick iron chains always attached flat to the surfaces, soot-darkened edges, and a few channels and cracks of "
                "molten lava. Lava, embers and fire are painted as opaque flat bright orange-yellow surfaces, never as smoke, "
                "loose sparks or transparent effects."),
}

SHEET_LAYOUT = """Output: one orthographic model turnaround sheet for 3D reconstruction. Exactly four separate complete views
of the SAME object in one row, left to right:
1. FRONT view: the object's front faces the viewer.
2. LEFT side view: the object turned 90 degrees so its front points to the LEFT edge of the image (camera at the
   object's right-hand side).
3. BACK view: the object's back faces the viewer.
4. RIGHT side view: the object turned 90 degrees so its front points to the RIGHT edge of the image.
Same scale and same ground line in all four, each centred in its quarter with generous empty margin, never touching or
overlapping; the whole object fits inside its quarter, nothing cropped.
Plain flat light neutral grey background (#D6D6D6). No floor, no ground shadow, no text, no labels, no frames, no
perspective."""


def tripo_spec(asset_id: str):
    spec = CFG.asset(asset_id)
    if spec.raw.get("source_provider") != "tripo":
        raise PipelineError(f"{asset_id}: registry entry is not a Tripo asset")
    return spec


def concept(asset_id: str) -> None:
    _load_env()
    spec = tripo_spec(asset_id)
    state = AssetState(spec)
    bo = nature.prepare_reference(asset_id)
    views = json.loads(state.file(bo, f"BO_{asset_id}_v{bo['version']:03d}_views.json").read_text(encoding="utf-8"))
    w, h, d = spec.raw["reference_dimensions"]
    style = SCENE_STYLE.format(theme=SCENE_THEMES[spec.raw.get("style_theme", "desert")])
    prompt = (f"{style}\n\nAsset ({w:g}m wide x {h:g}m tall x {d:g}m deep): {spec.raw['brief']}\n\n{SHEET_LAYOUT}")
    cfg = CFG.section("concept")
    print(f"→ {asset_id}: {cfg['model']} four-view sheet …", flush=True)
    png, info = openai_image.generate(prompt, model=cfg["model"], size="2048x1024", quality=cfg["quality"])
    register(spec, state, bo, views, png, prompt, info)


def rekey(asset_id: str) -> None:
    """Re-register the current concept's paid-for source sheet (e.g. after a key tolerance change) as a new version."""
    spec = tripo_spec(asset_id)
    state = AssetState(spec)
    # Works before review: the sheet under review is the one being re-keyed.
    current, bo = state.current("concept"), state.current("blockout")
    if not current or not bo:
        raise PipelineError(f"{asset_id}: no concept to re-key yet")
    views = json.loads(state.file(bo, f"BO_{asset_id}_v{bo['version']:03d}_views.json").read_text(encoding="utf-8"))
    source = state.file(current, f"CN_{asset_id}_v{current['version']:03d}_source.png")
    info = dict(current.get("generation") or {}, rekeyed_from=current["version"])
    register(spec, state, bo, views, source.read_bytes(), current["prompt"], info)


def register(spec, state, bo, views, png: bytes, prompt: str, info: dict) -> None:
    asset_id = spec.id
    h = spec.raw["reference_dimensions"][1]
    version = state.next_version("concept")
    stem = f"CN_{asset_id}_v{version:03d}"
    out = spec.stage_dir("concept")
    source = out / f"{stem}_source.png"
    source.write_bytes(png)
    with Image.open(source) as image:
        panels, registration = nature.register_panels(image, views, h, KEY_TOL[spec.raw.get("style_theme", "desert")])
    files, panel_paths = [source], []
    for view, panel in zip(imaging.VIEW_ORDER, panels):
        path = out / f"{stem}_{view}.png"
        panel.save(path)
        files.append(path); panel_paths.append(path)
    sheet = out / f"{stem}_sheet.png"
    imaging.compose_row(panel_paths, sheet)
    (out / f"{stem}_prompt.txt").write_text(prompt, encoding="utf-8")
    (out / f"{stem}_registration.json").write_text(json.dumps(registration, indent=2), encoding="utf-8")
    files += [sheet, out / f"{stem}_prompt.txt", out / f"{stem}_registration.json"]
    state.add_version("concept", {"version": version, "from_blockout": bo["version"], "generator": info["model"],
                                  "generation": info, "prompt": prompt, "source_sha256": sha256(source),
                                  "reference_mode": "bounds_only", "highpoly_mode": "tripo",
                                  "registration_version": 1, "registration": registration}, files)
    print(f"CONCEPT_READY_FOR_REVIEW {asset_id} {portable_path(sheet)}")


def adopt(asset_id: str, key: str) -> None:
    """New-roster characters are designed first (design sheet → turnaround); the approved turnaround is the concept."""
    spec = tripo_spec(asset_id)
    state = AssetState(spec)
    bo = state.require("blockout")
    found = sorted(resolve_path("art/source/characters/_design").glob(f"*/{key}/TV_{key}_v*.png"))
    sheets = [p for p in found if p.stem.count("_") == key.count("_") + 2]
    if not sheets:
        raise PipelineError(f"{key}: no turnaround yet (redesign_sheets.py --turnaround {key})")
    src = sheets[-1]
    version = state.next_version("concept")
    stem = f"CN_{asset_id}_v{version:03d}"
    out = spec.stage_dir("concept")
    # Register every view into the blockout camera frame (keyed alpha, uniform scale to the blockout height,
    # centred like the blockout bounds), so build can fit the provider mesh against the same silhouettes.
    views = json.loads(state.file(bo, f"BO_{asset_id}_v{bo['version']:03d}_views.json").read_text(encoding="utf-8"))
    height = views["bbox_max"][2] - views["bbox_min"][2]
    files, panels, registration = [], [], {}
    for view, camera in zip(imaging.VIEW_ORDER, views["views"]):
        with Image.open(src.with_name(f"{src.stem}_{view}.png")) as im:
            figure = imaging.key_flat_background(im.convert("RGBA"))
        mask = imaging.alpha_mask(figure)
        figure = figure.crop(imaging.bbox(mask))
        scale = height * camera["px_h"] / camera["world_h"] / figure.height
        w, h = max(1, round(figure.width * scale)), max(1, round(figure.height * scale))
        pw, ph = camera["px_w"], camera["px_h"]
        if w > pw - 4 or h > ph - 4:
            raise PipelineError(f"{view}: silhouette wider than the blockout frame; the design and blockout proportions differ too much")
        panel = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        offset = [(pw - w) // 2, (ph - h) // 2]
        panel.alpha_composite(figure.resize((w, h), Image.Resampling.LANCZOS), tuple(offset))
        path = out / f"{stem}_{view}.png"
        panel.save(path)
        files.append(path); panels.append(path)
        registration[view] = {"scale": scale, "offset": offset, "size": [w, h], "method": "uniform_height_and_center"}
    sheet = out / f"{stem}_sheet.png"
    imaging.compose_row(panels, sheet)
    files.append(sheet)
    state.add_version("concept", {"version": version, "from_blockout": bo["version"], "generator": "design turnaround",
                                  "design_key": key, "design_turnaround": portable_path(src),
                                  "source_sha256": sha256(src), "reference_mode": "design_turnaround",
                                  "highpoly_mode": "tripo", "registration": registration}, files)
    print(f"CONCEPT_READY_FOR_REVIEW {asset_id} {portable_path(sheet)}")


def inputs(asset_id: str) -> None:
    spec = tripo_spec(asset_id)
    state = AssetState(spec)
    cn = state.require("concept")
    for view in imaging.VIEW_ORDER:
        print(view, state.file(cn, f"CN_{asset_id}_v{cn['version']:03d}_{view}.png"))


def import_result(asset_id: str, source_file: str, task: str, model: str) -> None:
    spec = tripo_spec(asset_id)
    state = AssetState(spec)
    cn = state.require("concept")
    if cn.get("review", {}).get("verdict") != "approved":
        raise PipelineError(f"{asset_id}: concept v{cn['version']:03d} is not approved; review the sheet before spending Tripo credits")
    src = resolve_path(source_file)
    record_path = src.with_suffix(".json")
    receipt = json.loads(record_path.read_text(encoding="utf-8")) if record_path.exists() else {}
    if receipt.get("sha256") and receipt["sha256"] != sha256(src):
        raise PipelineError(f"{src.name}: inbox file changed since the bridge archived it")
    version = state.next_version("highpoly")
    out = spec.stage_dir("highpoly")
    stem = f"HP_{asset_id}_v{version:03d}"
    original = out / f"{stem}_source{src.suffix.lower()}"
    shutil.copyfile(src, original)
    glb = out / f"{stem}.glb"
    res = blender.run("bl_tripo_import.py", {"source": str(original), "out_glb": str(glb)},
                      spec.dir / "_tmp" / f"tripo_import_v{version:03d}", "tripo_import")
    graph = out / f"{stem}_graph.json"
    record = {"provider": "Tripo Studio", "task_url": task, "model": model, "inputs": "multiview (front/left/back/right)",
              "from_concept": cn["version"], "source_file": original.name, "source_sha256": sha256(original),
              "bridge_receipt": receipt, "import": res}
    graph.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    state.add_version("highpoly", {"version": version, "from_concept": cn["version"], "mode": "tripo",
                                   "tool": "Tripo Studio", "checkpoint": model, "task_url": task,
                                   "license": "Tripo Studio paid-plan output (commercial use per Tripo terms)",
                                   "faces": res["tris"], "source_sha256": record["source_sha256"]},
                      [original, glb, graph])
    print(f"✔ {asset_id} highpoly v{version:03d} ← Tripo {model}: {res['tris']} tris, images {len(res['images'])}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("concept"); p.add_argument("ids", nargs="+")
    p = sub.add_parser("rekey"); p.add_argument("ids", nargs="+")
    p = sub.add_parser("adopt"); p.add_argument("id"); p.add_argument("--design", required=True)
    p = sub.add_parser("inputs"); p.add_argument("id")
    p = sub.add_parser("import"); p.add_argument("id"); p.add_argument("--file", required=True)
    p.add_argument("--task", required=True); p.add_argument("--model", default="P2.0")
    a = parser.parse_args()
    try:
        if a.cmd == "concept":
            for asset in a.ids:
                concept(asset)
        elif a.cmd == "rekey":
            for asset in a.ids:
                rekey(asset)
        elif a.cmd == "adopt":
            adopt(a.id, a.design)
        elif a.cmd == "inputs":
            inputs(a.id)
        else:
            import_result(a.id, a.file, a.task, a.model)
    except PipelineError as e:
        print(f"✘ {e}")
        sys.exit(1)
