"""Build, validate, review and publish a Tripo-rigged creature with its own (native) skeleton.

    python art/pipeline/build_tripo_creature.py SK_Enemy_MirageToad             # build + validate + review render
    python art/pipeline/build_tripo_creature.py SK_Enemy_MirageToad --publish   # ... and publish to public/assets

Why: the stock `assetctl.py build` skins art to the procedural blockout joints (parts rig), which gives creatures only a
handful of rigid joints. A Tripo auto-rig has real legs and toes; blender/bl_build_tripo_creature.py turns it into a
semantic rig (art/pipeline/creature_rigs/<asset>.json) that the runtime drives directly (src/assets/NativeRig.ts).

Outputs:
  art/source/characters/<asset>/03_work/<asset>_native_vNNN.blend
  art/source/characters/<asset>/04_export/<asset>_native_vNNN.glb
  art/source/characters/<asset>/05_review/<asset>_native_vNNN_validation.json / _turnaround.png
  public/assets/characters/<asset>.glb + manifest entry (--publish, only when validation has no errors)
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib import blender  # noqa: E402
from lib.config import CFG, ROOT, PipelineError  # noqa: E402
from lib.glb import Glb  # noqa: E402
from lib.state import now, portable_path, resolve_path, sha256  # noqa: E402

SUPPORTED_EXT = {"KHR_draco_mesh_compression", "EXT_texture_webp", "KHR_texture_transform",
                 "KHR_materials_emissive_strength", "KHR_mesh_quantization", "EXT_meshopt_compression"}


def validate(glb_path: Path, metrics: dict, asset: str, cls: dict, height: float, required: list[str]) -> list:
    g = Glb(glb_path)
    J = g.json
    checks: list[tuple[str, str, str]] = []

    def ok(name, cond, detail, level="error"):
        checks.append(("pass" if cond else level, name, detail))

    ok("file size", g.size <= cls["max_file_kb"] * 1024, f"{g.size / 1024:.0f} KB / {cls['max_file_kb']} KB")
    req = set(J.get("extensionsRequired", []))
    ok("extensions", req <= SUPPORTED_EXT, f"required {sorted(req)}")
    nodes = {n["name"]: n for n in J.get("nodes", []) if "name" in n}
    lods = sorted(n for n in nodes if n.startswith(f"{asset}_LOD") and n[-1].isdigit())
    ok("LOD count", len(lods) == len(cls["lod_tris"]), f"{lods}")
    for i, name in enumerate(lods):
        tris = g.mesh_tris(nodes[name]["mesh"])
        ok(f"LOD{i} tris", tris <= cls["lod_tris"][i] * 1.02, f"{tris} / {cls['lod_tris'][i]}")
        ok(f"LOD{i} skinned", "skin" in nodes[name], "node.skin")
    lo, hi = g.mesh_bounds(nodes[lods[0]]["mesh"])
    ok("height", abs((hi[1] - lo[1]) - height) <= 0.03 * height, f"{hi[1] - lo[1]:.3f} m (design {height} m)")
    ok("feet on ground", abs(lo[1]) <= 0.02, f"min y={lo[1]:.4f}")
    mats = J.get("materials", [])
    body = [m for m in mats if not m.get("name", "").endswith("_Glow")]
    shells = metrics.get("glow_shells") or {}
    ok("material count", len(body) == 1 and len(mats) - len(body) <= max(1, len(shells)), f"{[m.get('name') for m in mats]}")
    if body:
        pbr = body[0].get("pbrMetallicRoughness", {})
        ok("base colour texture", "baseColorTexture" in pbr, "")
        ok("ORM texture", "metallicRoughnessTexture" in pbr and "occlusionTexture" in body[0], "AO / roughness / metallic")
    for name, info in (metrics.get("glow_shells") or {}).items():
        ok(f"glow shell {name[len(asset) + 1:]}", name in nodes and "skin" in nodes[name] and info["tris"] > 0,
           f"{info['tris']} tris on '{info['group']}'")
    for i, img in enumerate(J.get("images", [])):
        w, h, fmt = g.image_size(i)
        ok(f"texture {img.get('name')}", w == h == cls["texture"] and fmt == "webp", f"{w}x{h} {fmt}")
    skins = J.get("skins", [])
    ok("one skin", len(skins) == 1, f"{len(skins)} skins")
    if skins:
        joints = {J["nodes"][j]["name"] for j in skins[0]["joints"]}
        ok("semantic joints", set(required) <= joints, f"{len(joints)} joints, missing {sorted(set(required) - joints)}")
    for lod, s in metrics["skin"]["per_lod"].items():
        ok(f"{lod} influences", s["max_influences"] <= 4, f"max {s['max_influences']}")
        ok(f"{lod} unweighted", s["unweighted_verts"] == 0, f"{s['unweighted_verts']}")
    for lod in metrics["lods"]:
        ok(f"{lod['name']} UV range", min(lod["uv_min"]) >= -1e-3 and max(lod["uv_max"]) <= 1 + 1e-3,
           f"{[round(x, 3) for x in lod['uv_min']]}..{[round(x, 3) for x in lod['uv_max']]}")
    reg = metrics["regions"]
    for key, n in reg.items():
        if key.endswith("_verts") and key not in ("fallback_verts",):
            ok(f"region {key[:-6]}", n > 20, f"{n} verts", "warn")
    ok("unweighted source verts", True, f"{reg['fallback_verts']} verts copied their nearest weighted neighbour")
    checks.append(("note", "normal map", "not baked: the provider mesh carries its form in geometry"))
    return checks


def publish(asset: str, glb: Path, version: int, rig: dict, cls_name: str, cls: dict, bind: dict,
            hi_glb: Path | None = None) -> dict:
    dst = ROOT / "public/assets/characters" / f"{asset}.glb"
    shutil.copyfile(glb, dst)
    hi_dst = ROOT / "public/assets/characters" / f"{asset}@hi.glb"
    if hi_glb is not None:
        shutil.copyfile(hi_glb, hi_dst)
    g = Glb(dst)
    lod0 = next(n for n in g.json["nodes"] if n.get("name") == f"{asset}_LOD0")
    lo, hi = g.mesh_bounds(lod0["mesh"])
    entry = {
        "url": f"assets/characters/{asset}.glb",
        "kind": "skeletal",
        "class": cls_name,
        "bind": bind,
        "keepGlow": "all",
        "lodDistance": cls["lod_distance"],
        # Native skeleton: the enemy drives these named bones directly (src/assets/NativeRig.ts).
        "skeleton": {"mode": "native", "convention": "creature", "joints": len(g.json["skins"][0]["joints"])},
        "bounds": {"min": lo, "max": hi},
        "version": {"native_build": version},
        "sha256": sha256(dst),
        "bytes": dst.stat().st_size,
        "published": now(),
        "generator": {"tool": "Tripo Studio P2.0 multiview + Tripo auto-rig; semantic re-rig in Blender",
                      "mode": "tripo_native", "checkpoint": "P2.0"},
        "source_task": rig.get("task"),
    }
    if hi_glb is not None:
        # 画质「高」时加载的高清贴图版本（同一套网格与骨骼，见 src/assets/AssetLibrary.ts）
        entry["hiUrl"] = f"assets/characters/{asset}@hi.glb"
        entry["hiBytes"] = hi_dst.stat().st_size
    manifest_path = ROOT / CFG.paths["manifest"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))    # re-read: other tools write this file too
    manifest["assets"][asset] = entry
    manifest["updated"] = now()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return entry


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("asset")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--variant", default="", help="build a side-by-side variant from creature_rigs/<asset>.<variant>.json "
                    "(own version numbers, never published)")
    a = ap.parse_args()
    spec = CFG.asset(a.asset)
    tag = f".{a.variant}" if a.variant else ""
    if a.variant and a.publish:
        raise PipelineError("variants are for comparison only; publish the main rig")
    rig_json = ROOT / "art/pipeline/creature_rigs" / f"{a.asset}{tag}.json"
    rig = json.loads(rig_json.read_text(encoding="utf-8"))
    cls = CFG.section("classes")[spec.raw["class"]]
    out = spec.dir
    kind = f"native_{a.variant}" if a.variant else "native"
    # 只认主版本文件（<stem>_vNNN.glb）；高清贴图版 _vNNN_hi.glb 不参与编号
    existing = [int(p.stem.rsplit("_v", 1)[1]) for p in (out / "04_export").glob(f"{a.asset}_{kind}_v*.glb")
                if p.stem.rsplit("_v", 1)[1].isdigit()]
    version = max(existing) + 1 if existing else 1
    stem = f"{a.asset}_{kind}_v{version:03d}"
    for d in ("03_work", "04_export", "05_review"):
        (out / d).mkdir(parents=True, exist_ok=True)
    glb = out / "04_export" / f"{stem}.glb"
    params = {"asset_id": a.asset, "source": str(resolve_path(rig["source"])), "rig_json": str(rig_json),
              "height": rig["height_m"], "texture": cls["texture"], "lod_tris": cls["lod_tris"],
              "lod_distance": cls["lod_distance"], "roughness": spec.raw.get("material", {}).get("roughness", 0.8),
              "out_glb": str(glb), "out_blend": str(out / "03_work" / f"{stem}.blend")}
    print(f"→ {a.asset} native build v{version:03d} …", flush=True)
    metrics = blender.run("bl_build_tripo_creature.py", params, out / "_tmp" / stem, "native_build")
    required = sorted(rig["bones"]) if "bones" in rig else sorted(set(rig["keep"].values()) | set(rig["add"]))
    checks = validate(glb, metrics, a.asset, cls, rig["height_m"], required)
    report = out / "05_review" / f"{stem}_validation.json"
    report.write_text(json.dumps({"asset": a.asset, "version": version, "glb": portable_path(glb), "metrics": metrics,
                                  "checks": checks}, ensure_ascii=False, indent=2), encoding="utf-8")
    errors = [c for c in checks if c[0] == "error"]
    for level, name, detail in checks:
        mark = {"pass": "✔", "warn": "⚠", "error": "✘"}.get(level, "·")
        print(f"  {mark} {name:24s} {detail}")
    if errors:
        raise PipelineError(f"{len(errors)} validation errors; not publishing")
    hi_glb = None
    if cls.get("texture_hi", 0) > cls["texture"]:
        # 高清贴图版本：同样的构建，只换贴图尺寸（画质「高」时加载）
        hi_glb = out / "04_export" / f"{stem}_hi.glb"
        hi_params = {**params, "texture": cls["texture_hi"], "out_glb": str(hi_glb),
                     "out_blend": str(out / "03_work" / f"{stem}_hi.blend")}
        print(f"→ hi texture variant ({cls['texture_hi']}) …", flush=True)
        hi_metrics = blender.run("bl_build_tripo_creature.py", hi_params, out / "_tmp" / f"{stem}_hi", "native_build_hi")
        hi_cls = {**cls, "texture": cls["texture_hi"], "max_file_kb": cls["max_file_kb"] * 2.5}
        hi_errors = [c for c in validate(hi_glb, hi_metrics, a.asset, hi_cls, rig["height_m"], required) if c[0] == "error"]
        if hi_errors:
            raise PipelineError(f"hi variant: {hi_errors}")
        print(f"  ✔ hi variant {hi_glb.stat().st_size // 1024} KB")
    if a.publish:
        entry = publish(a.asset, glb, version, rig, spec.raw["class"], cls, spec.blockout, hi_glb)
        hi_note = f", hi {entry['hiBytes'] // 1024} KB" if hi_glb else ""
        print(f"✔ published {a.asset} → {entry['url']} ({entry['bytes'] // 1024} KB{hi_note}, {entry['skeleton']['joints']} joints)")
    else:
        print(f"✔ {stem} ready ({glb.stat().st_size // 1024} KB); rerun with --publish")


if __name__ == "__main__":
    try:
        main()
    except PipelineError as e:
        print(f"✘ {e}")
        sys.exit(1)
