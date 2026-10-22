"""Split the published closed chests into a body and a hinged lid (offline, no provider credits).

  python derive_chest_parts.py [ID ...]        default: the three chest tiers

The chests come from Tripo as one closed piece (a closed box reconstructs cleanly; an open lid does not). The lid has to
swing open in the game, so blender/bl_chest_parts.py cuts each LOD at the registry's lid_split height:

  <ID>Body   the box below the seam, closed by a shallow inset tray at the rim (origin: bottom centre, as the chest)
  <ID>Lid    the lid above the seam, closed underneath; origin = the hinge line (centre line, back of the cut, seam
             height), so the runtime opens it by rotating the lid about its local X axis (negative angle = back)

The lid sits at the body's `lidHinge` (glTF metres, written into both manifest entries). The closed <ID> stays published
as well (a cheap prop for chests that never open). Published straight into the manifest as derived assets
(generator.tool = "derived"), like derive_wall_corner.py. Re-run after republishing a chest.
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
CHESTS = ["SM_Prop_ChestCommon", "SM_Prop_ChestRare", "SM_Prop_ChestLegendary"]
TRAY_DEPTH = 0.12  # how far the open box's inner floor sits below the rim (m)
TRAY_LIP = 0.05    # rim width left around the tray (m)


def derive(src_id: str) -> None:
    spec = CFG.asset(src_id)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    parent = manifest["assets"][src_id]
    cls = CFG.data["classes"][spec.raw["class"]]
    body_id, lid_id = f"{src_id}Body", f"{src_id}Lid"
    out_body, out_lid = RUNTIME / f"{body_id}.glb", RUNTIME / f"{lid_id}.glb"
    work = ROOT / CFG.paths["source"] / "props" / src_id / "_tmp" / "chest_parts"
    res = blender.run("bl_chest_parts.py", {
        "source": str(ROOT / "public" / parent["url"]), "out_body": str(out_body), "out_lid": str(out_lid),
        "body_id": body_id, "lid_id": lid_id, "seam": spec.raw.get("lid_split", 0.6), "depth": TRAY_DEPTH, "lip": TRAY_LIP,
        "budget": cls["lod_tris"], "lod_distance": parent["lodDistance"],
        "image_format": CFG.data["export"]["image_format"], "draco": CFG.data["export"]["draco"]}, work, "chest_parts")
    hx, hy, hz = res["hinge"]
    hinge = [hx, hz, -hy]  # Blender (x, y, z) → glTF (x, z, −y)
    for row in res["lods"]:
        print(f"   {row['part']} LOD{row['lod']}: {row['tris']} 三角面")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))  # re-read: other tools write this file too
    for pid, out, mode in ((body_id, out_body, "chest_body"), (lid_id, out_lid, "chest_lid")):
        g = Glb(out)
        lo, hi = g.mesh_bounds(next(n["mesh"] for n in g.json["nodes"] if n.get("name") == f"{pid}_LOD0"))
        manifest["assets"][pid] = {
            "url": f"assets/props/{pid}.glb",
            "kind": "static",
            "class": spec.raw["class"],
            "bind": {**parent.get("bind", {}), "part": mode.split("_")[1]},
            "keepGlow": parent.get("keepGlow", "none"),
            "lodDistance": parent["lodDistance"],
            "bounds": {"min": lo, "max": hi},
            "lidHinge": [round(v, 4) for v in hinge],
            "sha256": sha256(out),
            "bytes": out.stat().st_size,
            "published": now(),
            "generator": {"tool": "derived", "mode": mode, "checkpoint": src_id},
            "derivedFrom": {"id": src_id, "sha256": parent["sha256"], "seam": res["seam"]},
            "license": parent.get("license", ""),
        }
        print(f"✔ {pid} → {out.relative_to(ROOT)}（{out.stat().st_size / 1024:.0f} KB），"
              f"包围盒 {[round(v, 2) for v in lo]} – {[round(v, 2) for v in hi]}")
    manifest["updated"] = now()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  盖子铰链（箱体空间，glTF）{hinge}")


def main() -> None:
    for src_id in sys.argv[1:] or CHESTS:
        derive(src_id)


if __name__ == "__main__":
    main()
