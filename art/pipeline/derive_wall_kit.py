"""Derive the modular desert wall kit from the published Tripo wall sections (offline, no provider credits).

  python derive_wall_kit.py

The published SM_Tripo_DesertRampart / SM_Tripo_DesertRampartPlain are single 8 m sculpts with stepped ends.
Butting or overlapping them leaves seams, and cutting them at runtime leaves open shells. This splits them
once, in Blender, into pieces that tile:
  - SM_Tripo_DesertRampartPanel       one bay, cut through the centre lines of both pilasters (x = ±2.25 m);
  - SM_Tripo_DesertRampartEndL / EndR the stepped ends outside the pilaster centres (run ends at corners and
                                      openings);
  - SM_Tripo_DesertRampartPlainPanel  the plain variant's bay, cut through its end pilasters (x = ±3.25 m).
Every cut is capped, so neighbouring panels meet face to face and each shared pilaster is half from either
side. Pilaster centres were measured from LOD0 (front-depth profile at mid height).

Each piece is published straight into the manifest as a derived asset (generator.tool = "derived"), with
the source asset's sha256 recorded so a re-published source is easy to spot. Re-run after republishing a
source wall.
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

KITS = {
    "SM_Tripo_DesertRampart": [
        {"id": "SM_Tripo_DesertRampartPanel", "lo": -2.25, "hi": 2.25, "bind": "desert.v2.rampart.panel"},
        {"id": "SM_Tripo_DesertRampartEndL", "lo": None, "hi": -2.25, "bind": "desert.v2.rampart.endL"},
        {"id": "SM_Tripo_DesertRampartEndR", "lo": 2.25, "hi": None, "bind": "desert.v2.rampart.endR"},
    ],
    "SM_Tripo_DesertRampartPlain": [
        {"id": "SM_Tripo_DesertRampartPlainPanel", "lo": -3.25, "hi": 3.25, "bind": "desert.v2.rampartPlain.panel"},
    ],
    # Chapter 2 Kunlun kit (Hunyuan3D 2mv, 2026-10-11). Pilasters at the section ends, centres measured from LOD0
    # (front-depth profile at 5-6 m: pilasters x = -3.5..-2.3 and 2.15..3.5); the plain wall is cut through its
    # outer crenels (merlons at 8-8.7 m: crenel centres x = +-2.45), so it keeps three whole merlons.
    "SM_Tripo_FrostRampart": [
        {"id": "SM_Tripo_FrostRampartPanel", "lo": -2.85, "hi": 2.85, "bind": "frost.v2.rampart.panel"},
        {"id": "SM_Tripo_FrostRampartEndL", "lo": None, "hi": -2.85, "bind": "frost.v2.rampart.endL"},
        {"id": "SM_Tripo_FrostRampartEndR", "lo": 2.85, "hi": None, "bind": "frost.v2.rampart.endR"},
    ],
    "SM_Tripo_FrostRampartPlain": [
        {"id": "SM_Tripo_FrostRampartPlainPanel", "lo": -2.45, "hi": 2.45, "bind": "frost.v2.rampartPlain.panel"},
    ],
    # Chapter 2 North-Sea glacier cliff kit (Hunyuan3D 2mv, 2026-10-11): natural ice faces with no pilasters; the
    # sections came out 5.75 / 6.0 m wide, so the panels keep their middle 4.0 / 4.4 m and the tapered edges
    # outside +-2.0 m become the run ends.
    "SM_Tripo_FrostSeaRampart": [
        {"id": "SM_Tripo_FrostSeaRampartPanel", "lo": -2.0, "hi": 2.0, "bind": "frost_sea.v2.rampart.panel"},
        {"id": "SM_Tripo_FrostSeaRampartEndL", "lo": None, "hi": -2.0, "bind": "frost_sea.v2.rampart.endL"},
        {"id": "SM_Tripo_FrostSeaRampartEndR", "lo": 2.0, "hi": None, "bind": "frost_sea.v2.rampart.endR"},
    ],
    "SM_Tripo_FrostSeaRampartPlain": [
        {"id": "SM_Tripo_FrostSeaRampartPlainPanel", "lo": -2.2, "hi": 2.2, "bind": "frost_sea.v2.rampartPlain.panel"},
    ],
}


def main() -> None:
    """`python derive_wall_kit.py [source ids…]`: only the named source walls (default: every kit)."""
    only = set(sys.argv[1:])
    unknown = only - set(KITS)
    if unknown:
        raise SystemExit(f"unknown source wall(s): {sorted(unknown)}; known: {sorted(KITS)}")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    derived: dict = {}
    work = ROOT / CFG.paths["source"] / "props" / "_wall_kit"
    for source_id, pieces in KITS.items():
        if only and source_id not in only:
            continue
        parent = manifest["assets"][source_id]
        source = ROOT / "public" / parent["url"]
        for p in pieces:
            p["out"] = str(RUNTIME / f"{p['id']}.glb")
        result = blender.run("bl_wall_kit.py", {"source": str(source), "pieces": pieces, "image_format": CFG.data["export"]["image_format"],
                                                "draco": CFG.data["export"]["draco"]}, work, source_id)
        for row in result["pieces"]:
            print(f"   {row['id']} LOD{row['lod']}: {row['tris']} 三角面" + (f"，封口 {row['caps']} 面" if row["caps"] is not None else "（焊接后减面）"))
        for p in pieces:
            path = RUNTIME / f"{p['id']}.glb"
            g = Glb(path)
            mesh = next(n["mesh"] for n in g.json["nodes"] if n.get("name") == f"{p['id']}_LOD0")
            lo, hi = g.mesh_bounds(mesh)
            derived[p["id"]] = {
                "url": f"assets/props/{p['id']}.glb",
                "kind": "static",
                "class": "tripo_architecture_kit",
                "bind": {"source": "scene", "id": p["bind"]},
                "keepGlow": "none",
                "lodDistance": parent["lodDistance"],
                "bounds": {"min": lo, "max": hi},
                "sha256": sha256(path),
                "bytes": path.stat().st_size,
                "published": now(),
                "generator": {"tool": "derived", "mode": "wall_kit", "checkpoint": source_id},
                "derivedFrom": {"id": source_id, "sha256": parent["sha256"], "cut": [p["lo"], p["hi"]]},
                "license": parent.get("license", ""),
            }
            print(f"✔ {p['id']} → {path.relative_to(ROOT)}（{path.stat().st_size / 1024:.0f} KB），宽 {hi[0] - lo[0]:.3f} m")
    # Other pipeline processes publish concurrently: merge into the manifest as it is now, not as read above.
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["assets"].update(derived)
    manifest["updated"] = now()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
