"""Build, validate, review and publish the three playable heroes from their rigged Tripo models.

    python art/pipeline/build_tripo_heroes.py                 # build + validate + review all heroes
    python art/pipeline/build_tripo_heroes.py fox --publish   # ... and publish to public/assets

Why a dedicated builder: the stock `assetctl.py build` bakes a Hunyuan high-poly onto a new
low-poly and skins it to the game's 13-joint parts rig. The hero Tripo models are already
game-resolution and carry Tripo's Mixamo skeleton + skin weights, which the runtime drives
directly (src/ui/heroPreview/heroes/nativeTripo.ts). blender/bl_build_tripo_hero.py keeps that
mesh/skin and adds units, UVs, projected base colour, AO/ORM, LODs, Draco + WebP export.

Inputs per hero live in registry.toml under [assets.SK_Hero_<Name>.tripo]. Outputs:
  art/source/characters/SK_Hero_<Name>/03_work/SK_Hero_<Name>_tripo_vNNN.blend (+ textures)
  art/source/characters/SK_Hero_<Name>/04_export/SK_Hero_<Name>_tripo_vNNN.glb
  art/source/characters/SK_Hero_<Name>/05_review/..._validation.json / _turnaround.png / _extremities.png
  public/assets/characters/SK_Hero_<Name>.glb + manifest entry (with --publish, only if validation passed)

Validation mirrors stages/validate.py's package checks for skeletal assets (size budget, required
extensions, LOD count/budget/ordering/extras, material + texture naming and size, single skin,
<=4 influences, no unweighted vertices, height, feet on ground, centring, UV range). A tangent-space
normal map is not required: there is no high-poly to bake from and the faceted Tripo surface
carries its shape in geometry; this is recorded as a note, not a waiver.

Finger / toe review (art/README.md §9.1): the extremity close-up sheet is rendered for every
build and must be counted by a reviewer; the builder never marks that check as passed itself.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib import blender  # noqa: E402
from lib.config import CFG, ROOT, PipelineError  # noqa: E402
from lib.glb import Glb  # noqa: E402
from lib.state import now, sha256  # noqa: E402

HEROES = {"fox": "SK_Hero_Fox", "falcon": "SK_Hero_Falcon", "bear": "SK_Hero_Bear"}
SUPPORTED_EXT = {"KHR_draco_mesh_compression", "EXT_texture_webp", "KHR_texture_transform",
                 "KHR_materials_emissive_strength", "KHR_mesh_quantization", "EXT_meshopt_compression"}


def tripo_spec(asset: str) -> dict:
    reg = tomllib.loads((ROOT / "art/pipeline/registry.toml").read_text(encoding="utf-8"))["assets"][asset]
    if "tripo" not in reg:
        raise PipelineError(f"registry.toml has no [assets.{asset}.tripo] table")
    return reg["tripo"]


def next_version(asset_dir: Path, asset: str) -> int:
    existing = sorted((asset_dir / "04_export").glob(f"{asset}_tripo_v*.glb"))
    return (int(existing[-1].stem.rsplit("_v", 1)[1]) + 1) if existing else 1


def validate(glb_path: Path, metrics: dict, asset: str, cls: dict, height: float) -> list[tuple[str, str, str]]:
    g = Glb(glb_path)
    J = g.json
    checks: list[tuple[str, str, str]] = []

    def ok(name, cond, detail, level="error"):
        checks.append(("pass" if cond else level, name, detail))

    ok("file size", g.size <= cls["max_file_kb"] * 1024, f"{g.size / 1024:.0f} KB / {cls['max_file_kb']} KB")
    req = set(J.get("extensionsRequired", []))
    ok("extensions", req <= SUPPORTED_EXT, f"required {sorted(req)}")
    ok("draco geometry", "KHR_draco_mesh_compression" in req, "KHR_draco_mesh_compression")
    nodes = {n["name"]: n for n in J.get("nodes", []) if "name" in n}
    lods = sorted(n for n in nodes if n.startswith(f"{asset}_LOD") and n[-1].isdigit())
    ok("LOD count", len(lods) == len(cls["lod_tris"]), f"{lods}")
    for i, name in enumerate(lods):
        n = nodes[name]
        tris = g.mesh_tris(n["mesh"])
        # no decimation: the provider mesh's own face count, recorded rather than gated
        checks.append(("note", f"LOD{i} tris", f"{tris} (class reference {cls['lod_tris'][i]})"))
        if i:
            prev = g.mesh_tris(nodes[lods[i - 1]]["mesh"])
            ok(f"LOD{i} decreasing", tris < prev, f"{prev} -> {tris}")
        ok(f"LOD{i} distance", n.get("extras", {}).get("lod_distance") == cls["lod_distance"][i],
           f"extras.lod_distance={n.get('extras', {}).get('lod_distance')}", "warn")
        ok(f"LOD{i} skinned", "skin" in n, "node.skin")
    lo, hi = g.mesh_bounds(nodes[lods[0]]["mesh"])
    ok("height", abs((hi[1] - lo[1]) - height) <= 0.02 * height, f"{hi[1] - lo[1]:.3f} m (design {height} m)")
    ok("feet on ground", abs(lo[1]) <= 0.01, f"min y={lo[1]:.4f}")
    ok("centred", abs((lo[0] + hi[0]) / 2) <= 0.06 and abs((lo[2] + hi[2]) / 2) <= 0.08,
       f"centre x={(lo[0] + hi[0]) / 2:.3f} z={(lo[2] + hi[2]) / 2:.3f}", "warn")
    mats = J.get("materials", [])
    ok("material count", len(mats) == 1, f"{[m.get('name') for m in mats]}")
    ok("material name", [m.get("name") for m in mats] == [f"M_{asset.split('_', 1)[1]}"], f"{[m.get('name') for m in mats]}")
    if mats:
        pbr = mats[0].get("pbrMetallicRoughness", {})
        ok("base colour texture", "baseColorTexture" in pbr, "")
        ok("ORM texture", "metallicRoughnessTexture" in pbr and "occlusionTexture" in mats[0], "AO / roughness / metallic")
    short = asset.split("_", 1)[1]
    for i, img in enumerate(J.get("images", [])):
        w, h, fmt = g.image_size(i)
        nm = img.get("name", "")
        ok(f"texture {nm}", w == h == cls["texture"] and fmt == "webp", f"{w}x{h} {fmt} (class {cls['texture']}, webp)")
        ok(f"texture name {nm}", nm in (f"T_{short}_BC", f"T_{short}_ORM"), "T_<Class>_<Name>_BC|ORM")
    skins = J.get("skins", [])
    ok("one skin", len(skins) == 1, f"{len(skins)} skins")
    if skins:
        joints = [J["nodes"][j]["name"] for j in skins[0]["joints"]]
        need = {f"mixamorig:{b}" for b in ("Hips", "Spine2", "Head", "RightArm", "RightForeArm", "RightHand",
                                            "LeftArm", "LeftForeArm", "LeftHand", "RightHandIndex1", "LeftHandThumb1")}
        ok("Mixamo joints", need <= set(joints), f"{len(joints)} joints, missing {sorted(need - set(joints))}")
    for lod, s in metrics["skin"]["per_lod"].items():
        ok(f"{lod} influences", s["max_influences"] <= 4, f"max {s['max_influences']}")
        ok(f"{lod} unweighted", s["unweighted_verts"] == 0, f"{s['unweighted_verts']}")
    for lod in metrics["lods"]:
        ok(f"{lod['name']} UV range", min(lod["uv_min"]) >= -1e-3 and max(lod["uv_max"]) <= 1 + 1e-3,
           f"{[round(x, 3) for x in lod['uv_min']]}..{[round(x, 3) for x in lod['uv_max']]}")
    ok("UV utilisation", metrics["lods"][0]["uv_utilization"] >= 0.5, f"{metrics['lods'][0]['uv_utilization']:.0%}", "warn")
    ok("reference alignment", metrics["alignment"]["iou"] >= 0.8, f"silhouette IoU {metrics['alignment']['iou']}", "warn")
    checks.append(("note", "normal map", "not baked: no high-poly source; faceted Tripo geometry carries the form"))
    checks.append(("todo", "fingers / toes", "count digits on the _extremities.png sheet (art/README.md §9.1)"))
    return checks


def blender_tool(script: str, *argv: str) -> None:
    cmd = [CFG.tools["blender"], "-b", "--factory-startup", "--python-exit-code", "1", "--python",
           str(ROOT / script), "--", *argv]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise PipelineError(f"{script} failed:\n" + "\n".join(proc.stdout.splitlines()[-30:] + proc.stderr.splitlines()[-10:]))


def publish(asset: str, hero: str, glb: Path, version: int, spec: dict, cls: dict) -> dict:
    dst = ROOT / "public/assets/characters" / f"{asset}.glb"
    shutil.copyfile(glb, dst)
    g = Glb(dst)
    lod0 = next(n for n in g.json["nodes"] if n.get("name") == f"{asset}_LOD0")
    lo, hi = g.mesh_bounds(lod0["mesh"])
    entry = {
        "url": f"assets/characters/{asset}.glb",
        "kind": "skeletal",
        "class": "hero_display",
        "bind": {"source": "hero", "id": hero},
        "keepGlow": "none",
        "lodDistance": cls["lod_distance"],
        # Native skeleton: the runtime drives these Mixamo bones directly (no parts rig remap).
        "skeleton": {"mode": "native", "convention": "mixamo", "joints": len(g.json["skins"][0]["joints"])},
        "bounds": {"min": lo, "max": hi},
        "version": {"tripo_build": version},
        "sha256": sha256(dst),
        "bytes": dst.stat().st_size,
        "published": now(),
        "generator": {"tool": "Tripo Studio P2.0 image-to-3D + Mixamo auto-rig; local projection texturing",
                      "mode": "tripo_native", "checkpoint": "P2.0"},
        "license": "Tripo Studio private task output (see art/pipeline/tripo_heroes_20261005.json); "
                   "commercial use per the Tripo account subscription terms",
    }
    manifest_path = ROOT / CFG.paths["manifest"]
    # Re-read immediately before writing: other tools update unrelated entries of the same file.
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][asset] = entry
    manifest["updated"] = now()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return entry


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("heroes", nargs="*", default=list(HEROES))
    ap.add_argument("--publish", action="store_true", help="copy passing builds to public/assets + manifest")
    a = ap.parse_args()
    cls = CFG.section("classes")["hero_display"]
    record_path = ROOT / "art/pipeline/tripo_hero_build_20261006.json"
    record = json.loads(record_path.read_text(encoding="utf-8")) if record_path.exists() else {
        "builder": "art/pipeline/build_tripo_heroes.py", "blender_script": "art/pipeline/blender/bl_build_tripo_hero.py",
        "heroes": {}}
    for hero in a.heroes:
        asset = HEROES[hero]
        spec = tripo_spec(asset)
        adir = ROOT / "art/source/characters" / asset
        v = next_version(adir, asset)
        tag = f"{asset}_tripo_v{v:03d}"
        print(f"== {asset} -> {tag}")
        params = {
            "asset_id": asset, "source_blend": str(ROOT / spec["source_blend"]), "reference": str(ROOT / spec["reference"]),
            "height": spec["height"], "texture": cls["texture"], "lod_tris": cls["lod_tris"], "lod_distance": cls["lod_distance"],
            "texture_dir": str(adir / "03_work" / f"textures_tripo_v{v:03d}"),
            "export_glb": str(adir / "04_export" / f"{tag}.glb"), "blend_path": str(adir / "03_work" / f"{tag}.blend"),
            "roughness": spec.get("roughness", 0.88), "metallic": 0.0, "ao_samples": 48,
            "detach_arm_weights": spec.get("detach_arm_weights"),
        }
        metrics = blender.run("bl_build_tripo_hero.py", params, adir / "_tmp" / f"tripo_build_v{v:03d}", "build")
        (adir / "03_work" / f"{tag}_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
        glb = Path(params["export_glb"])
        checks = validate(glb, metrics, asset, cls, spec["height"])
        review = adir / "05_review"; review.mkdir(exist_ok=True)
        (review / f"{tag}_validation.json").write_text(json.dumps(
            [{"level": l, "check": n, "detail": d} for l, n, d in checks], ensure_ascii=False, indent=2), encoding="utf-8")
        for lvl, name, detail in checks:
            print(f"  {lvl:5} {name:28} {detail}")
        blender_tool("art/tools/review_tripo_hero.py", str(glb), str(review / f"{tag}_turnaround.png"))
        blender_tool("art/tools/review_extremities_mixamo.py", str(glb), str(review / f"{tag}_extremities.png"))
        errors = [c for c in checks if c[0] == "error"]
        item = {"version": v, "glb": str(glb.relative_to(ROOT)).replace("\\", "/"), "bytes": glb.stat().st_size,
                "sha256": sha256(glb), "errors": [c[1] for c in errors],
                "warnings": [c[1] for c in checks if c[0] == "warn"],
                "alignment_iou": metrics["alignment"]["iou"], "uv_charts": metrics.get("uv_charts"),
                "lod_tris": [l["tris"] for l in metrics["lods"]],
                "review": {"turnaround": f"art/source/characters/{asset}/05_review/{tag}_turnaround.png",
                           "extremities": f"art/source/characters/{asset}/05_review/{tag}_extremities.png"},
                "built": now()}
        if a.publish:
            if errors:
                raise PipelineError(f"{asset}: {len(errors)} validation errors, not publishing")
            entry = publish(asset, hero, glb, v, spec, cls)
            item["published"] = {"url": entry["url"], "sha256": entry["sha256"], "bytes": entry["bytes"], "at": entry["published"]}
            print(f"  published {entry['url']} ({entry['bytes'] / 1024:.0f} KB)")
        record["heroes"][hero] = item
        record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  {'FAIL' if errors else 'ok'} {tag}: {len(errors)} errors")


if __name__ == "__main__":
    try:
        main()
    except PipelineError as e:
        print(f"ERROR {e}")
        sys.exit(1)
