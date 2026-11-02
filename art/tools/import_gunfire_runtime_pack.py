"""Build five runtime Gunfire weapons with project rigid-part skeletons, materials and sockets."""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess

import numpy as np
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

ROOT = Path(__file__).resolve().parents[2]
GAME = Path(os.environ.get("GUNFIRE_REBORN_HOME", r"G:\SteamLibrary\steamapps\common\Gunfire Reborn"))
BUNDLES = GAME / "Gunfire Reborn_Data" / "StreamingAssets" / "assetbundles"
ANALYSIS = ROOT / "art" / "reviews" / "gunfire-reborn-analysis" / "weapons"
WORK = ROOT / "art" / "source" / "_tmp" / "gunfire_runtime_pack"
LICENSE = "Gunfire Reborn installed-game asset; local prototype use only, no redistribution rights implied"

CONFIG = {
    "1002": {
        "target": "smg", "bundle": "data244", "axis": "y", "scale": 0.43, "origin": [0, 0, 0],
        "fields": {"muzzle": "j_0", "mag": "j_13"},
        "boneMap": {"1102_Bone007/Bone001": "j_13", "1102_Bone007/1102_Bone002": "j_0"},
        "joints": {"j_0": [0, 0.04, -0.35], "j_13": [0, -0.05, -0.14]},
        "sockets": {"sight": [0, 0.09, -0.08], "leftGrip": [0, 0.015, -0.18], "load": [[-0.02, -0.06, -0.14], "@mag"], "finish": [-0.04, 0.05, 0.03], "eject": [[0.03, 0.055, -0.06], [1, 0.5, 0.2]]},
    },
    "1202": {
        "target": "revolver", "bundle": "data245", "axis": "y", "scale": 0.42, "origin": [0, 0.35, 0.45],
        "fields": {"muzzle": "j_0", "cylinder": "j_13", "mag": "j_13"},
        "boneMap": {"1202_Bone001/1202_Bone003/1202_Bone006/1202_Bone007": "j_13", "1202_Bone001/1202_Bone003/1202_Bone006": "j_13"},
        "joints": {"j_0": [0, 0.055, -0.25], "j_13": [0, 0.038, -0.05]},
        "sockets": {"sight": [0, 0.075, -0.053], "leftGrip": [-0.02, -0.03, 0.02], "load": [[-0.025, -0.04, -0.05], "@mag"], "finish": [-0.025, 0.05, -0.05], "eject": [[0.03, 0.05, -0.04], [1, 0.4, 0]]},
    },
    "1008": {
        "target": "railgun", "bundle": "data251", "axis": "y", "scale": 0.68, "origin": [0, 0.08, 0.25],
        "fields": {"muzzle": "j_0", "spinner": "j_13", "mag": "j_13"},
        "meshBones": {"weapon_1008_1": "j_13"},
        "joints": {"j_0": [0, 0.035, -0.55], "j_13": [0, -0.064, -0.054]},
        "sockets": {"sight": [0, 0.1, -0.1], "leftGrip": [0, -0.02, -0.3], "load": [[-0.02, -0.12, -0.054], "@mag"], "finish": [-0.04, 0.06, 0.03], "eject": [[0.03, 0.055, -0.04], [1, 0.5, 0.2]]},
    },
    "1106": {
        "target": "sniper", "bundle": "data268", "axis": "x", "scale": 0.012, "origin": [5, 0, -2],
        "fields": {"muzzle": "j_0", "mag": "j_13"},
        "joints": {"j_0": [0, 0.045, -0.57], "j_13": [0, -0.06, -0.1]},
        "sockets": {"sight": [0, 0.12, -0.17], "leftGrip": [0, -0.02, -0.28], "load": [[-0.02, -0.06, -0.1], "@mag"], "finish": [-0.04, 0.06, 0.03], "eject": [[0.03, 0.055, -0.04], [1, 0.5, 0.2]]},
    },
    "1301": {
        "target": "shotgun", "bundle": "data295", "axis": "z", "scale": 0.45, "origin": [0.064, 0.1, 0.55],
        "fields": {"muzzle": "j_0", "pump": "j_13"},
        "meshBones": {"PumpMesh": "j_13"},
        "joints": {"j_0": [0, 0.04, -0.44], "j_13": [0, 0.073, -0.086]},
        "sockets": {"sight": [0, 0.08, -0.2], "leftGrip": [[0, 0.073, -0.086], "pump"], "load": [0, -0.02, 0], "finish": [[0, 0.073, -0.086], "pump"], "eject": [[0.03, 0.055, -0.04], [1, 0.5, 0.1]]},
    },
}


def transform(values, cfg, normal=False):
    a = np.asarray(values, dtype=np.float64).copy()
    scale = cfg["scale"]
    ox, oy, oz = cfg["origin"]
    if cfg["axis"] == "y":
        out = np.column_stack((a[:, 0] * scale, (a[:, 2] - (0 if normal else oz)) * scale, (a[:, 1] - (0 if normal else oy)) * scale))
    elif cfg["axis"] == "x":
        out = np.column_stack((a[:, 1] * scale, (a[:, 2] - (0 if normal else oz)) * scale, (a[:, 0] - (0 if normal else ox)) * scale))
    else:
        out = np.column_stack(((a[:, 0] - (0 if normal else ox)) * scale, (a[:, 1] - (0 if normal else oy)) * scale, -(a[:, 2] - (0 if normal else oz)) * scale))
    if normal:
        out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-8)
    return out


def blender_values(values, cfg, normal=False):
    gltf = transform(values, cfg, normal)
    return np.column_stack((gltf[:, 0], -gltf[:, 2], gltf[:, 1]))


def source_rig(weapon: str):
    cfg = CONFIG[weapon]
    raw = (BUNDLES / cfg["bundle"]).read_bytes()
    env = UnityPy.load(io.BytesIO(raw[raw.find(b"UnityFS"):]))
    tos = {}
    for obj in env.objects:
        if obj.type.name == "Avatar":
            tos.update(dict(obj.read().m_TOS))
    result = {}
    for obj in env.objects:
        if obj.type.name != "Mesh":
            continue
        mesh = obj.read()
        handler = MeshHandler(mesh)
        handler.process()
        names = [tos.get(h, str(h)) for h in mesh.m_BoneNameHashes]
        result[(mesh.m_Name, sum(s.indexCount // 3 for s in mesh.m_SubMeshes))] = (handler, names)
    return result


def convert(weapon: str):
    cfg = CONFIG[weapon]
    analysis = json.loads((WORK.parent / "gunfire_weapon_analysis" / f"{weapon}.json").read_text(encoding="utf-8"))
    rig = source_rig(weapon)
    meshes = []
    bounds_min = np.full(3, np.inf)
    bounds_max = np.full(3, -np.inf)
    for source in analysis["meshes"]:
        if source["material"] < 0 or source["name"] in {"Left", "Right"}:
            continue
        handler, bone_names = rig[(source["name"], len(source["triangles"]))]
        vertices = transform(source["vertices"], cfg)
        bounds_min = np.minimum(bounds_min, vertices.min(axis=0))
        bounds_max = np.maximum(bounds_max, vertices.max(axis=0))
        indices = np.asarray(handler.m_BoneIndices).reshape(-1, 4) if handler.m_BoneIndices else np.zeros((len(vertices), 4), dtype=int)
        weights = np.asarray(handler.m_BoneWeights).reshape(-1, 4) if handler.m_BoneWeights else np.zeros((len(vertices), 4))
        bone_map = cfg.get("boneMap", {})
        mesh_bone = cfg.get("meshBones", {}).get(source["name"])
        dominant = []
        for v in range(len(vertices)):
            if mesh_bone:
                dominant.append(mesh_bone)
                continue
            best = int(np.argmax(weights[v])) if weights.size else 0
            original = bone_names[indices[v, best]] if bone_names else ""
            dominant.append(bone_map.get(original, "j_r"))
        meshes.append({
            "name": source["name"], "vertices": blender_values(source["vertices"], cfg).tolist(),
            "normals": blender_values(source["normals"], cfg, True).tolist(), "uv": source["uv"],
            "triangles": [tuple(reversed(t)) for t in source["triangles"]] if cfg["axis"] != "x" else source["triangles"],
            "material": source["material"], "weights": dominant,
        })
    return meshes, {"min": bounds_min.tolist(), "max": bounds_max.tolist()}


def write_asset(weapon: str, meshes, bounds):
    cfg = CONFIG[weapon]
    asset = f"SK_Weapon_Gunfire{weapon}"
    joints = [{"name": "j_r", "parent": None, "bindPosition": [0, 0, 0]}]
    joints += [{"name": name, "parent": "j_r", "bindPosition": pos} for name, pos in cfg["joints"].items()]
    for joint in joints:
        joint.update(restLocal=joint["bindPosition"], bindRotation=[0, 0, 0], bindScale=[1, 1, 1])
    source_dir = ROOT / "art" / "source" / "weapons" / asset
    blockout = source_dir / "00_blockout" / f"BO_{asset}_v001.json"
    blockout.parent.mkdir(parents=True, exist_ok=True)
    blockout.write_text(json.dumps({
        "schema": 1, "assetId": asset, "source": {"kind": "weapon", "id": cfg["target"]}, "rig": "parts",
        "space": {"up": "+Y", "forward": "+Z", "unit": "m", "origin": "model"}, "bounds": bounds,
        "joints": joints, "keep": [], "fields": cfg["fields"], "sockets": cfg["sockets"],
        "externalSource": f"Gunfire Reborn {cfg['bundle']} weapon {weapon}",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    params = {"asset": asset, "weapon": weapon, "joints": joints, "meshes": meshes,
              "materials": json.loads((ANALYSIS / weapon / "materials.json").read_text(encoding="utf-8")),
              "materialRoot": str(ANALYSIS / weapon), "output": str(ROOT / "public" / "assets" / "weapons" / f"{asset}.glb"),
              "metrics": str(source_dir / "03_work" / f"{asset}_v001_metrics.json")}
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / f"{weapon}.json"
    path.write_text(json.dumps(params, ensure_ascii=False), encoding="utf-8")
    blender = os.environ.get("ART_BLENDER", r"H:\Program Files\Blender Foundation\Blender 5.2\blender.exe")
    subprocess.run([blender, "-b", "--factory-startup", "--python-exit-code", "1", "--python",
                    str(ROOT / "art" / "tools" / "bl_gunfire_runtime_pack.py"), "--", str(path)], check=True)
    out = Path(params["output"])
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    manifest_path = ROOT / "public" / "assets" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][asset] = {
        "url": f"assets/weapons/{asset}.glb", "kind": "skeletal", "class": "weapon_fp",
        "bind": {"source": "weapon", "id": cfg["target"]}, "keepGlow": "all", "lodDistance": [0],
        "rig": {"mode": "parts", "joints": [["j_r", [0, 0, 0]], *[[name, pos] for name, pos in cfg["joints"].items()]], "keep": []},
        "bounds": bounds, "version": {"source": 1, "build": 1}, "sha256": digest, "bytes": out.stat().st_size,
        "generator": {"tool": "Gunfire Reborn AssetBundle", "mode": "runtime rigid-parts conversion", "checkpoint": f"{cfg['bundle']}/{weapon}"},
        "license": LICENSE,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (source_dir / "asset.json").write_text(json.dumps({
        "id": asset, "display": f"{cfg['target']} · Gunfire {weapon}", "kind": "skeletal", "class": "weapon_fp",
        "stages": {"blockout": {"current": 1}},
        "source": {"game": "Gunfire Reborn", "bundle": cfg["bundle"], "weapon": weapon, "license": LICENSE},
        "conversion": {"axis": cfg["axis"], "scale": cfg["scale"], "origin": cfg["origin"], "fields": cfg["fields"], "lodReduction": False},
        "published": {"glb": out.relative_to(ROOT).as_posix(), "sha256": digest, "bytes": out.stat().st_size},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(asset, len(meshes), "meshes", sum(len(m["triangles"]) for m in meshes), "triangles", out.stat().st_size, "bytes")


def main() -> None:
    for weapon in CONFIG:
        meshes, bounds = convert(weapon)
        write_asset(weapon, meshes, bounds)


if __name__ == "__main__":
    main()
