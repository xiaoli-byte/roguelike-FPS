"""Export five Gunfire Reborn weapons with meshes, PBR maps, materials and animation curves for local analysis."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import subprocess

import numpy as np
from PIL import Image
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

ROOT = Path(__file__).resolve().parents[2]
GAME = Path(os.environ.get("GUNFIRE_REBORN_HOME", r"G:\SteamLibrary\steamapps\common\Gunfire Reborn"))
BUNDLES = GAME / "Gunfire Reborn_Data" / "StreamingAssets" / "assetbundles"
OUT = ROOT / "art" / "reviews" / "gunfire-reborn-analysis" / "weapons"
WORK = ROOT / "art" / "source" / "_tmp" / "gunfire_weapon_analysis"
WEAPONS = {
    "1002": ["data244", "data243"],
    "1202": ["data245"],
    "1008": ["data251", "data255"],
    "1106": ["data268"],
    "1301": ["data295", "data296"],
}


def safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_") or "unnamed"


def load(bundle: str) -> UnityPy.Environment:
    raw = (BUNDLES / bundle).read_bytes()
    return UnityPy.load(io.BytesIO(raw[raw.find(b"UnityFS"):]))


class Exporter:
    def __init__(self, weapon: str, bundles: list[str]):
        self.weapon = weapon
        self.bundles = list(dict.fromkeys([*bundles, "data468"]))
        self.envs = {b: load(b) for b in self.bundles}
        self.objects = {b: {o.path_id: o for o in env.objects} for b, env in self.envs.items()}
        self.dependencies = {}
        for bundle, env in self.envs.items():
            ab = next(o.read() for o in env.objects if o.type.name == "AssetBundle")
            self.dependencies[bundle] = ab.m_Dependencies
        self.out = OUT / weapon
        self.textures = self.out / "textures"
        self.animations = self.out / "animations"
        for directory in [self.textures, self.animations]:
            directory.mkdir(parents=True, exist_ok=True)
        self.texture_names = {}
        self.materials = []
        self.material_indices = {}

    def resolve(self, bundle: str, pointer):
        path_id = getattr(pointer, "m_PathID", 0)
        if not path_id:
            return None
        if getattr(pointer, "m_FileID", 0) == 0 and path_id in self.objects[bundle]:
            return self.objects[bundle][path_id]
        matches = [obj for objects in self.objects.values() for pid, obj in objects.items() if pid == path_id]
        return matches[0] if len(matches) == 1 else None

    def export_texture(self, bundle: str, obj, role: str) -> dict:
        key = (bundle, obj.path_id, role)
        if key in self.texture_names:
            return self.texture_names[key]
        tex = obj.read()
        base = safe(tex.m_Name)
        stem = f"{base}_{role}"
        result = {"name": tex.m_Name, "role": role, "width": tex.m_Width, "height": tex.m_Height}
        image = tex.image.convert("RGBA")
        if role in {"S", "SPEC"}:
            pixels = np.asarray(image)
            orm = np.stack([pixels[:, :, 1], 255 - pixels[:, :, 3], pixels[:, :, 0]], axis=-1)
            filename = f"{stem}_ORM.png"
            Image.fromarray(orm).save(self.textures / filename)
            result["orm"] = f"textures/{filename}"
            emission = self.textures / f"{stem}_E.png"
            Image.fromarray(pixels[:, :, 2]).save(emission)
            result["emission"] = f"textures/{emission.name}"
        elif role in {"D", "DIFF", "C", "BC"}:
            filename = f"{stem}.png"
            image.save(self.textures / filename)
            result["baseColor"] = f"textures/{filename}"
        elif role in {"N", "NORM"}:
            filename = f"{stem}.png"
            image.save(self.textures / filename)
            result["normal"] = f"textures/{filename}"
        else:
            filename = f"{stem}.png"
            image.save(self.textures / filename)
            result["baseColor"] = f"textures/{filename}"
        self.texture_names[key] = result
        return result

    def export_material(self, bundle: str, obj) -> int:
        key = (bundle, obj.path_id)
        if key in self.material_indices:
            return self.material_indices[key]
        data = obj.read_typetree()
        saved = data["m_SavedProperties"]
        textures = {}
        for name, spec in saved["m_TexEnvs"]:
            texture = self.resolve(bundle, type("Ptr", (), spec["m_Texture"]))
            if not texture:
                continue
            role = "S" if "s" == texture.read().m_Name.lower().split("_")[-1] else "OTHER"
            if "norm" in texture.read().m_Name.lower() or texture.read().m_Name.lower().endswith("_n"):
                role = "N"
            elif any(x in name.lower() for x in ["maintex", "diff"]):
                role = "BC"
            elif "spec" in name.lower() or "gloss" in name.lower():
                role = "SPEC"
            textures[name] = self.export_texture(bundle, texture, role)
        for source_bundle in self.bundles:
            for texture in self.envs[source_bundle].objects:
                if texture.type.name != "Texture2D":
                    continue
                texture_name = texture.read().m_Name.lower()
                if ("norm" in texture_name or texture_name.endswith("_n")) and "_BumpMap" not in textures:
                    textures["_BumpMap"] = self.export_texture(source_bundle, texture, "N")
                elif (texture_name.endswith("_s") or "spec" in texture_name) and "_MetallicGlossMap" not in textures:
                    textures["_MetallicGlossMap"] = self.export_texture(source_bundle, texture, "SPEC")
        shader = self.resolve(bundle, type("Ptr", (), data["m_Shader"]))
        shader_name = ""
        if shader:
            shader_data = shader.read()
            shader_name = getattr(getattr(shader_data, "m_ParsedForm", None), "m_Name", "") or shader_data.m_Name
        record = {
            "name": data["m_Name"], "shader": shader_name, "keywords": data.get("m_ShaderKeywords", ""),
            "floats": dict(saved["m_Floats"]), "colors": dict(saved["m_Colors"]), "textures": textures,
        }
        index = len(self.materials)
        self.materials.append(record)
        self.material_indices[key] = index
        return index

    def mesh_material(self, bundle: str, mesh_id: int) -> int:
        for obj in self.envs[bundle].objects:
            if obj.type.name == "SkinnedMeshRenderer":
                renderer = obj.read()
                if renderer.m_Mesh.m_PathID != mesh_id:
                    continue
                pointers = renderer.m_Materials
            elif obj.type.name == "MeshRenderer":
                renderer = obj.read()
                game_object = renderer.m_GameObject.read()
                match = False
                for component in game_object.m_Components:
                    part = component.read()
                    if type(part).__name__ == "MeshFilter" and part.m_Mesh.m_PathID == mesh_id:
                        match = True
                        break
                if not match:
                    continue
                pointers = renderer.m_Materials
            else:
                continue
            if pointers:
                material = self.resolve(bundle, pointers[0])
                if material and material.read().m_Name != "Default-Material":
                    return self.export_material(bundle, material)
        if self.weapon == "1301":
            mesh_name = self.objects[bundle][mesh_id].read().m_Name
            material_name = "Arms" if mesh_name in {"Left", "Right"} else "ShotgunShell01" if mesh_name.startswith(("Slug", "Insert", "Reload")) else "1301"
            material = next((o for o in self.envs["data296"].objects if o.type.name == "Material" and o.read().m_Name == material_name), None)
            if material:
                return self.export_material("data296", material)
        return -1

    def export_meshes(self) -> list[dict]:
        primary = self.bundles[0]
        meshes = []
        for obj in self.envs[primary].objects:
            if obj.type.name != "Mesh":
                continue
            mesh = obj.read()
            handler = MeshHandler(mesh)
            handler.process()
            vertices = np.asarray(handler.m_Vertices, dtype=np.float64)
            vertices[:, 0] *= -1
            normals = np.asarray(handler.m_Normals, dtype=np.float64)
            normals[:, 0] *= -1
            normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)
            triangles = [tuple(reversed(t)) for submesh in handler.get_triangles() for t in submesh]
            meshes.append({
                "name": mesh.m_Name, "vertices": vertices.tolist(), "normals": normals.tolist(),
                "uv": handler.m_UV0, "triangles": triangles, "material": self.mesh_material(primary, obj.path_id),
            })
        return meshes

    def export_animation(self) -> list[dict]:
        records = []
        primary = self.bundles[0]
        for obj in self.envs[primary].objects:
            if obj.type.name not in {"AnimationClip", "AnimatorController", "AnimatorOverrideController"}:
                continue
            data = obj.read_typetree()
            name = data.get("m_Name", obj.type.name)
            filename = f"{safe(name)}.{obj.type.name}.json"
            (self.animations / filename).write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")
            records.append({"name": name, "type": obj.type.name, "file": f"animations/{filename}",
                            "sampleRate": data.get("m_SampleRate"), "stopTime": data.get("m_StopTime")})
        return records

    def run(self) -> dict:
        meshes = self.export_meshes()
        animations = self.export_animation()
        (self.out / "materials.json").write_text(json.dumps(self.materials, ensure_ascii=False, indent=2), encoding="utf-8")
        params = {"weapon": self.weapon, "meshes": meshes, "materials": self.materials,
                  "output": str(self.out / f"Gunfire_{self.weapon}_analysis.glb"),
                  "preview": str(self.out / "preview.png")}
        WORK.mkdir(parents=True, exist_ok=True)
        params_path = WORK / f"{self.weapon}.json"
        params_path.write_text(json.dumps(params, ensure_ascii=False), encoding="utf-8")
        blender = os.environ.get("ART_BLENDER", r"H:\Program Files\Blender Foundation\Blender 5.2\blender.exe")
        subprocess.run([blender, "-b", "--factory-startup", "--python-exit-code", "1", "--python",
                        str(ROOT / "art" / "tools" / "bl_gunfire_analysis.py"), "--", str(params_path)], check=True)
        report = {"weapon": self.weapon, "bundles": self.bundles, "meshCount": len(meshes),
                  "triangles": sum(len(m["triangles"]) for m in meshes), "materials": len(self.materials),
                  "textureFiles": len(list(self.textures.glob("*.png"))), "animations": animations,
                  "parts": [{"name": m["name"], "triangles": len(m["triangles"]), "material": m["material"]} for m in meshes]}
        (self.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return report


def main() -> None:
    reports = [Exporter(weapon, bundles).run() for weapon, bundles in WEAPONS.items()]
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
