"""Build / publish a static hero attachment from a Tripo smart-mesh inbox file (no game blockout to fit against).

    python art/pipeline/build_hero_part.py SM_HeroPart_PangolinBall            # build + validate
    python art/pipeline/build_hero_part.py SM_HeroPart_PangolinBall --publish  # ... and publish to public/assets

Registry entry: kind = "static", class = "hero_attachment", bind = { source = "hero", id, attachment },
[assets.<id>.part] source = inbox FBX, task = Tripo URL, size = largest dimension in metres (origin = bounding-box centre).
Runtime: src/ui/heroPreview/heroes/heroShowFx.ts finds it with AssetLibrary.findAttachments('hero', id).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib import blender  # noqa: E402
from lib.config import CFG, ROOT, PipelineError  # noqa: E402
from lib.glb import Glb  # noqa: E402
from lib.state import now, resolve_path, sha256  # noqa: E402


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("asset")
    ap.add_argument("--publish", action="store_true")
    a = ap.parse_args()
    reg = tomllib.loads((ROOT / "art/pipeline/registry.toml").read_text(encoding="utf-8"))["assets"][a.asset]
    part = reg["part"]
    cls = CFG.section("classes")[reg["class"]]
    out = ROOT / "art/source/attachments" / a.asset
    for d in ("03_work", "04_export", "05_review"):
        (out / d).mkdir(parents=True, exist_ok=True)
    existing = [int(p.stem.rsplit("_v", 1)[1]) for p in (out / "04_export").glob(f"{a.asset}_v*.glb")]
    version = max(existing) + 1 if existing else 1
    stem = f"{a.asset}_v{version:03d}"
    glb = out / "04_export" / f"{stem}.glb"
    params = {"asset_id": a.asset, "source": str(resolve_path(part["source"])), "size": part["size"],
              "texture": cls["texture"], "lod_tris": cls["lod_tris"], "lod_distance": cls["lod_distance"],
              "roughness": reg.get("material", {}).get("roughness", 0.7),
              "out_glb": str(glb), "out_blend": str(out / "03_work" / f"{stem}.blend")}
    print(f"→ {a.asset} build v{version:03d} …", flush=True)
    metrics = blender.run("bl_build_hero_part.py", params, out / "_tmp" / stem, "part_build")
    g = Glb(glb)
    names = sorted(n["name"] for n in g.json["nodes"] if "_LOD" in n.get("name", ""))
    checks = [
        ("file size", g.size <= cls["max_file_kb"] * 1024, f"{g.size / 1024:.0f} KB / {cls['max_file_kb']} KB"),
        ("LOD count", len(names) == len(cls["lod_tris"]), str(names)),
        ("LOD budget", all(t <= b * 1.02 for t, b in zip(metrics["lod_tris"], cls["lod_tris"])), str(metrics["lod_tris"])),
        ("webp textures", all(i.get("mimeType") == "image/webp" for i in g.json.get("images", [])), str(len(g.json.get("images", [])))),
        ("draco", "KHR_draco_mesh_compression" in g.json.get("extensionsRequired", []), ""),
    ]
    for ok, (n, c, d) in ((c[1], c) for c in checks):
        print(f"  {'✔' if ok else '✘'} {n:16s} {d}")
    (out / "05_review" / f"{stem}_validation.json").write_text(json.dumps({"metrics": metrics, "checks": checks}, ensure_ascii=False, indent=2), encoding="utf-8")
    if not all(c[1] for c in checks):
        raise PipelineError("validation failed; not publishing")
    if not a.publish:
        print(f"✔ {stem} ready ({g.size / 1024:.0f} KB); rerun with --publish")
        return
    dst = ROOT / "public/assets/attachments" / f"{a.asset}.glb"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(glb, dst)
    lod0 = next(n for n in g.json["nodes"] if n.get("name") == f"{a.asset}_LOD0")
    lo, hi = Glb(dst).mesh_bounds(lod0["mesh"])
    manifest_path = ROOT / CFG.paths["manifest"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][a.asset] = {
        "url": f"assets/attachments/{a.asset}.glb", "kind": "static", "class": reg["class"], "bind": reg["blockout"],
        "keepGlow": "attachments", "lodDistance": cls["lod_distance"], "bounds": {"min": lo, "max": hi},
        "version": {"build": version}, "sha256": sha256(dst), "bytes": dst.stat().st_size, "published": now(),
        "generator": {"tool": "Tripo Studio", "mode": "tripo", "checkpoint": "P2.0"}, "source_task": part.get("task"),
        "license": "Tripo Studio paid-plan output (commercial use per Tripo terms)",
    }
    manifest["updated"] = now()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✔ published {dst.relative_to(ROOT)} ({dst.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
