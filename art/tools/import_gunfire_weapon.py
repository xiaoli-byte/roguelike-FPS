"""Convert Gunfire Reborn weapon 1001 into the project's rigid-parts weapon contract."""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

ROOT = Path(__file__).resolve().parents[2]
ASSET = "SK_Weapon_Gunfire1001"
BUNDLE = Path(os.environ.get("GUNFIRE_REBORN_HOME", r"G:\SteamLibrary\steamapps\common\Gunfire Reborn"))
DATA = BUNDLE / "Gunfire Reborn_Data" / "StreamingAssets" / "assetbundles" / "data241"
WORK = ROOT / "art" / "source" / "_tmp" / "gunfire_weapon_1001"
SOURCE = ROOT / "art" / "source" / "weapons" / ASSET
OUT = ROOT / "public" / "assets" / "weapons" / f"{ASSET}.glb"
SCALE = 0.665
ORIGIN_Y = 0.14
ORIGIN_Z = 0.62
PARTS = {"Main": "j_r", "Clip": "j_13", "Mantel": "j_r", "Trigger": "j_r"}
LICENSE = "Gunfire Reborn installed-game asset; local prototype use only, no redistribution rights implied"


def environment() -> UnityPy.Environment:
    raw = DATA.read_bytes()
    offset = raw.find(b"UnityFS")
    if offset < 0:
        raise RuntimeError(f"{DATA} has no UnityFS payload")
    return UnityPy.load(io.BytesIO(raw[offset:]))


def blender_point(v: list[float] | tuple[float, float, float]) -> list[float]:
    x, y, z = v
    return [-x * SCALE, (z - ORIGIN_Z) * SCALE, (y - ORIGIN_Y) * SCALE]


def gltf_point(v: list[float] | tuple[float, float, float]) -> list[float]:
    x, y, z = v
    return [-x * SCALE, (y - ORIGIN_Y) * SCALE, -(z - ORIGIN_Z) * SCALE]


def convert_geometry(env: UnityPy.Environment) -> tuple[list[dict], dict]:
    converted = []
    bounds_min = np.full(3, np.inf)
    bounds_max = np.full(3, -np.inf)
    for obj in env.objects:
        if obj.type.name != "Mesh":
            continue
        mesh = obj.read()
        if mesh.m_Name not in PARTS:
            continue
        handler = MeshHandler(mesh)
        handler.process()
        source_vertices = np.asarray(handler.m_Vertices, dtype=np.float64)
        vertices = np.asarray([blender_point(v) for v in source_vertices], dtype=np.float32)
        normals = np.asarray([blender_point((v[0], v[1] + ORIGIN_Y, v[2] + ORIGIN_Z)) for v in handler.m_Normals], dtype=np.float32)
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)
        triangles = [tuple(reversed(t)) for submesh in handler.get_triangles() for t in submesh]
        gltf_vertices = np.asarray([gltf_point(v) for v in source_vertices])
        bounds_min = np.minimum(bounds_min, gltf_vertices.min(axis=0))
        bounds_max = np.maximum(bounds_max, gltf_vertices.max(axis=0))
        converted.append({
            "name": mesh.m_Name,
            "bone": PARTS[mesh.m_Name],
            "vertices": vertices.tolist(),
            "normals": normals.tolist(),
            "uv": handler.m_UV0,
            "triangles": triangles,
        })
    if set(PARTS) != {m["name"] for m in converted}:
        raise RuntimeError(f"Missing source meshes: {set(PARTS) - {m['name'] for m in converted}}")
    return converted, {"min": bounds_min.tolist(), "max": bounds_max.tolist()}


def convert_textures(env: UnityPy.Environment) -> None:
    textures = WORK / "textures"
    textures.mkdir(parents=True, exist_ok=True)
    found = set()
    for obj in env.objects:
        if obj.type.name != "Texture2D":
            continue
        texture = obj.read()
        if texture.m_Name == "1001_D":
            texture.image.save(textures / f"T_Weapon_Gunfire1001_BC.png")
            found.add(texture.m_Name)
        elif texture.m_Name == "1001_N":
            texture.image.save(textures / f"T_Weapon_Gunfire1001_N.png")
            found.add(texture.m_Name)
    if found != {"1001_D", "1001_N"}:
        raise RuntimeError(f"Missing source textures: {found}")
    orm = Image.new("RGB", (1024, 1024), (255, 160, 160))
    orm.save(textures / "T_Weapon_Gunfire1001_ORM.png")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_contract(bounds: dict) -> None:
    joints = [
        {"name": "j_r", "parent": None, "bindPosition": [0, 0, 0]},
        {"name": "j_0", "parent": "j_r", "bindPosition": [0, 0.042, -0.615]},
        {"name": "j_13", "parent": "j_r", "bindPosition": [0, 0, -0.105]},
    ]
    for joint in joints:
        joint.update(restLocal=joint["bindPosition"], bindRotation=[0, 0, 0], bindScale=[1, 1, 1])
    blockout = SOURCE / "00_blockout" / f"BO_{ASSET}_v001.json"
    blockout.parent.mkdir(parents=True, exist_ok=True)
    blockout.write_text(json.dumps({
        "schema": 1, "assetId": ASSET, "source": {"kind": "weapon", "id": "rifle"},
        "rig": "parts", "space": {"up": "+Y", "forward": "+Z", "unit": "m", "origin": "model"},
        "bounds": bounds, "joints": joints, "keep": [], "fields": {"muzzle": "j_0", "mag": "j_13"},
        "sockets": {
            "sight": [0, 0.07, -0.05],
            "leftGrip": [0, 0.025, -0.105],
            "load": [[-0.02, -0.07, -0.105], "@mag"],
            "finish": [-0.04, 0.06, 0.06],
            "eject": [[0.03, 0.055, -0.02], [1, 0.5, 0.2]],
        },
        "externalSource": "Gunfire Reborn data241 / weapon 1001",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    params = WORK / "build.json"
    params.write_text(json.dumps({
        "asset": ASSET,
        "meshes": json.loads((WORK / "geometry.json").read_text(encoding="utf-8")),
        "joints": joints,
        "textures": str(WORK / "textures"),
        "output": str(OUT),
        "metrics": str(SOURCE / "03_work" / f"{ASSET}_v001_metrics.json"),
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def update_manifest(bounds: dict) -> None:
    manifest_path = ROOT / "public" / "assets" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][ASSET] = {
        "url": f"assets/weapons/{ASSET}.glb", "kind": "skeletal", "class": "weapon_fp",
        "bind": {"source": "weapon", "id": "rifle"}, "keepGlow": "none", "lodDistance": [0],
        "rig": {"mode": "parts", "joints": [
            ["j_r", [0, 0, 0]], ["j_0", [0, 0.042, -0.615]], ["j_13", [0, 0, -0.105]],
        ], "keep": []},
        "bounds": bounds, "version": {"source": 1, "build": 1},
        "sha256": sha256(OUT), "bytes": OUT.stat().st_size,
        "generator": {"tool": "Gunfire Reborn AssetBundle", "mode": "rigid-parts conversion", "checkpoint": "data241/1001"},
        "license": LICENSE,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    SOURCE.mkdir(parents=True, exist_ok=True)
    (SOURCE / "asset.json").write_text(json.dumps({
        "id": ASSET, "display": "裂风步枪 · Gunfire 1001", "kind": "skeletal", "class": "weapon_fp",
        "stages": {"blockout": {"current": 1}},
        "source": {"game": "Gunfire Reborn", "bundle": "data241", "weapon": "1001", "meshes": list(PARTS), "license": LICENSE},
        "conversion": {"scale": SCALE, "originY": ORIGIN_Y, "originZ": ORIGIN_Z, "lodReduction": False, "rig": "project rigid parts"},
        "published": {"glb": OUT.relative_to(ROOT).as_posix(), "sha256": sha256(OUT), "bytes": OUT.stat().st_size},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    env = environment()
    meshes, bounds = convert_geometry(env)
    (WORK / "geometry.json").write_text(json.dumps(meshes), encoding="utf-8")
    convert_textures(env)
    write_contract(bounds)
    blender = os.environ.get("ART_BLENDER", r"H:\Program Files\Blender Foundation\Blender 5.2\blender.exe")
    subprocess.run([blender, "-b", "--factory-startup", "--python-exit-code", "1", "--python",
                    str(ROOT / "art" / "tools" / "bl_gunfire_weapon.py"), "--", str(WORK / "build.json")], check=True)
    update_manifest(bounds)
    print(f"Published {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
