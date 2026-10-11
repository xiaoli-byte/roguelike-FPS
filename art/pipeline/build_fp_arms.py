"""First-person arms for the v2 heroes, cut from each hero's own published model (blender/bl_build_fp_arm.py).

    python art/pipeline/build_fp_arms.py [fox|bear|falcon ...] [--publish]

Each hero gets SM_Arms_<Name>R / L (static, class fp_arm, bind fp / <hero id> / arm_r | arm_l) replacing the 2026-10-03
Hunyuan arms of the rejected heroes. Socket targets follow Viewmodel.buildArm's procedural boxes (right: grip origin,
forearm direction Euler(0.62, 0.38, 0); left: support-point origin, Euler(0.6, -0.5, 0)).
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib import blender  # noqa: E402
from lib.config import CFG, ROOT, PipelineError  # noqa: E402
from lib.glb import Glb  # noqa: E402
from lib.state import now, sha256  # noqa: E402

HEROES = {"fox": "RedPanda", "bear": "Pangolin", "falcon": "FlyingSquirrel"}
OLD = {"fox": "Fox", "bear": "Bear", "falcon": "Falcon"}


def euler_dir(rx: float, ry: float) -> list[float]:
    # THREE.Euler XYZ applied to (0, 0, 1): Ry first, then Rx
    x, y, z = math.sin(ry), 0.0, math.cos(ry)
    return [x, y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)]


def side_params(side: str, length: float) -> dict:
    if side == "R":
        d = euler_dir(0.62, 0.38)
        wrist = [0.024 - d[0] * 0.02, -0.098 - d[1] * 0.02, 0.1 - d[2] * 0.02]
        # palm on the grip's right-rear side, fingers wrapping forward-left around it, knuckle line running down the grip
        wrist = [0.06, -0.055, 0.06]
        return {"wrist": wrist, "elbow": [wrist[i] + d[i] * length for i in range(3)],
                "hand_distal": [-0.35, 0.05, -0.94], "hand_knuckle": [0.0, -1.0, 0.15],
                "curl": {"Index": [8, 18, 12], "Middle": [60, 75, 55], "Ring": [62, 75, 55], "Pinky": [62, 72, 50]}}
    d = euler_dir(0.6, -0.5)
    wrist = [-0.034 - d[0] * 0.02, -0.068 - d[1] * 0.02, 0.058 - d[2] * 0.02]
    # under the handguard: palm up, fingers forward along the barrel; a palm-up left hand has its thumb on the left,
    # so index → pinky runs to +X
    wrist = [0.028, -0.045, 0.05]
    return {"wrist": wrist, "elbow": [wrist[i] + d[i] * length for i in range(3)],
            "hand_distal": [0.0, 0.0, -1.0], "hand_knuckle": [1.0, 0.0, 0.0],
            "curl": {"Index": [62, 80, 60], "Middle": [65, 82, 60], "Ring": [66, 80, 58], "Pinky": [66, 78, 55]}}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("heroes", nargs="*", default=list(HEROES))
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--curl-sign", type=float, default=1.0)
    a = ap.parse_args()
    cls = CFG.section("classes")["fp_arm"]
    manifest_path = ROOT / CFG.paths["manifest"]
    for hid in a.heroes:
        name = HEROES[hid]
        hero_glb = ROOT / "public/assets/characters" / f"SK_Hero_{name}.glb"
        for side, length in (("R", 0.30), ("L", 0.36)):
            asset = f"SM_Arms_{name}{side}"
            out = ROOT / "art/source/weapons" / asset
            for d in ("04_export", "05_review", "_tmp"):
                (out / d).mkdir(parents=True, exist_ok=True)
            existing = [int(p.stem.rsplit("_v", 1)[1]) for p in (out / "04_export").glob(f"{asset}_v*.glb")]
            version = max(existing) + 1 if existing else 1
            stem = f"{asset}_v{version:03d}"
            glb = out / "04_export" / f"{stem}.glb"
            params = {"asset_id": asset, "hero_glb": str(hero_glb), "side": side, **side_params(side, length),
                      "curl_sign": a.curl_sign, "texture": cls["texture"] // 2, "lod_tris": cls["lod_tris"],
                      "hand_len": 0.15, "behind_elbow": 1.2, "scale_min": 0.35, "forearm_stretch": 1.7 if hid == "bear" else 2.4, "forearm_slim": 0.5 if hid == "bear" else 1.0,   # 磐's forearm scales turn into big petals when stretched far
                      # 鼯's gliding membrane hangs off the forearm: a tight radius keeps sleeve + bracer + glove only
                      "max_radius": 0.05 if hid == "falcon" else 0.12,
                      "out_glb": str(glb), "review_png": str(out / "05_review" / f"{stem}.png")}
            print(f"→ {asset} v{version:03d} …", flush=True)
            metrics = blender.run("bl_build_fp_arm.py", params, out / "_tmp" / stem, "fp_arm")
            g = Glb(glb)
            print(f"  {g.size / 1024:.0f} KB, LOD {metrics['lod_tris']}, scale {metrics['scale']:.3f}, verts {metrics['kept_verts']}")
            if g.size > cls["max_file_kb"] * 1024:
                raise PipelineError(f"{asset}: {g.size / 1024:.0f} KB over budget")
            if not a.publish:
                continue
            dst = ROOT / "public/assets/weapons" / f"{asset}.glb"
            shutil.copyfile(glb, dst)
            lod0 = next(n for n in g.json["nodes"] if n.get("name") == f"{asset}_LOD0")
            lo, hi = Glb(dst).mesh_bounds(lod0["mesh"])
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["assets"].pop(f"SM_Arms_{OLD[hid]}{side}", None)
            manifest["assets"][asset] = {
                "url": f"assets/weapons/{asset}.glb", "kind": "static", "class": "fp_arm",
                "bind": {"source": "fp", "id": hid, "attachment": "arm_r" if side == "R" else "arm_l"},
                "keepGlow": "none", "lodDistance": cls["lod_distance"], "bounds": {"min": lo, "max": hi},
                "version": {"build": version}, "sha256": sha256(dst), "bytes": dst.stat().st_size, "published": now(),
                "generator": {"tool": "cut from the published hero SK_Hero_" + name, "mode": "derived"},
            }
            manifest["updated"] = now()
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  ✔ published {dst.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
