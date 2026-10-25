"""Derive the Han Great Wall 90-degree corner from the published straight section (offline, no provider credits).

  python derive_wall_corner.py

A Tripo concept for the L-shaped corner drew its back as a convex corner and its rammed-earth courses unlike the
published straight wall, so the corner is cut from SM_Tripo_DesertHanWall itself (blender/bl_wall_corner.py):
one arm is the straight wall mitred at 45 degrees, the other is the same arm mirrored across the miter plane, so the
joint welds vertex for vertex and both arms carry exactly the straight wall's courses and texture.

  SM_Tripo_DesertHanWallCorner   centre lines meet at the origin; arm A runs along +X, arm B along glTF -Z (behind
                                 the front face), each reaching ARM metres from the origin and ending in the straight
                                 wall's own flat cut face, so straight sections butt on directly.

Published straight into the manifest as a derived asset (generator.tool = "derived"), like derive_wall_kit.py.
Re-run after republishing the straight wall.
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
SOURCE = "SM_Tripo_DesertHanWall"
ID = "SM_Tripo_DesertHanWallCorner"
ARM = 4.0  # metres from the corner's centre-line intersection to each arm's flat end


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    parent = manifest["assets"][SOURCE]
    out = RUNTIME / f"{ID}.glb"
    work = ROOT / CFG.paths["source"] / "props" / "_wall_kit"
    result = blender.run("bl_wall_corner.py", {"source": str(ROOT / "public" / parent["url"]), "out": str(out), "id": ID,
                                               "arm": ARM, "lod_distance": parent["lodDistance"],
                                               "image_format": CFG.data["export"]["image_format"],
                                               "draco": CFG.data["export"]["draco"]}, work, ID)
    for row in result["lods"]:
        print(f"   {ID} LOD{row['lod']}: {row['tris']} 三角面")
    g = Glb(out)
    lo, hi = g.mesh_bounds(next(n["mesh"] for n in g.json["nodes"] if n.get("name") == f"{ID}_LOD0"))
    entry = {
        "url": f"assets/props/{ID}.glb",
        "kind": "static",
        "class": "tripo_architecture_kit",
        "bind": {"source": "scene", "id": "desert.silkroad.hanWallCorner"},
        "keepGlow": "none",
        "lodDistance": parent["lodDistance"],
        "bounds": {"min": lo, "max": hi},
        "sha256": sha256(out),
        "bytes": out.stat().st_size,
        "published": now(),
        "generator": {"tool": "derived", "mode": "wall_corner", "checkpoint": SOURCE},
        "derivedFrom": {"id": SOURCE, "sha256": parent["sha256"], "arm": ARM},
        "license": parent.get("license", ""),
    }
    # other pipeline processes publish concurrently: merge into the manifest as it is now
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["assets"][ID] = entry
    manifest["updated"] = now()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✔ {ID} → {out.relative_to(ROOT)}（{out.stat().st_size / 1024:.0f} KB），包围盒 {[round(v, 2) for v in lo]} – {[round(v, 2) for v in hi]}")


if __name__ == "__main__":
    main()
