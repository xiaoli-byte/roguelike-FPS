"""Cut published chapter-3 kit pieces into separately placeable parts (offline, no provider credits).

  python derive_inferno_parts.py [ID ...]      default: every registry asset with a `parts` list

The parts are listed in the registry entry (`parts = [{ id, box | component | rest, origin }]`, glTF metres of the
published mesh, see blender/bl_inferno_parts.py). Each part is published straight into the manifest as a derived asset
(generator.tool = "derived", like derive_chest_parts.py) with `partOrigin` = where its origin sits in the parent asset
(glTF metres), so prefabs / level builders can reassemble the piece. The one-piece parent stays published as well.
Re-run after republishing a parent. docs/art/ch3-kit.md lists the parts and what they are for.
"""
from __future__ import annotations

import json
import sys

from lib import blender
from lib.config import CFG, ROOT
from lib.glb import Glb
from lib.state import now, sha256

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RUNTIME = ROOT / CFG.paths["runtime"] / "props"
MANIFEST = ROOT / CFG.paths["manifest"]


def derive(src_id: str) -> None:
    spec = CFG.asset(src_id)
    parts = spec.raw.get("parts") or []
    if not parts:
        raise SystemExit(f"{src_id}: registry has no parts list")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    parent = manifest["assets"][src_id]
    work = ROOT / CFG.paths["source"] / "props" / src_id / "_tmp" / "parts"
    params = {"source": str(ROOT / "public" / parent["url"]), "lod_distance": parent["lodDistance"],
              "image_format": CFG.data["export"]["image_format"], "draco": CFG.data["export"]["draco"],
              "parts": [{**p, "out": str(RUNTIME / f"{p['id']}.glb")} for p in parts]}
    res = blender.run("bl_inferno_parts.py", params, work, "inferno_parts")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))  # re-read: other tools write this file too
    for row in res["parts"]:
        pid = row["id"]
        out = RUNTIME / f"{pid}.glb"
        g = Glb(out)
        lo, hi = g.mesh_bounds(next(n["mesh"] for n in g.json["nodes"] if n.get("name") == f"{pid}_LOD0"))
        manifest["assets"][pid] = {
            "url": f"assets/props/{pid}.glb",
            "kind": "static",
            "class": spec.raw["class"],
            "bind": {**parent.get("bind", {}), "part": pid[len(src_id):]},
            "keepGlow": parent.get("keepGlow", "none"),
            "lodDistance": parent["lodDistance"],
            "bounds": {"min": lo, "max": hi},
            "partOrigin": row["origin_gltf"],
            "sha256": sha256(out),
            "bytes": out.stat().st_size,
            "published": now(),
            "generator": {"tool": "derived", "mode": "inferno_parts", "checkpoint": src_id},
            "derivedFrom": {"id": src_id, "sha256": parent["sha256"]},
            "license": parent.get("license", ""),
        }
        print(f"✔ {pid}：{row['tris']} 三角面，封口 {row['caps']}，原点在母件 {row['origin_gltf']}，"
              f"包围盒 {[round(v, 2) for v in lo]} – {[round(v, 2) for v in hi]}（{out.stat().st_size / 1024:.0f} KB）")
    manifest["updated"] = now()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    ids = sys.argv[1:] or [a for a in CFG.all_assets() if CFG.registry[a].get("parts")]
    for src_id in ids:
        derive(src_id)


if __name__ == "__main__":
    main()
