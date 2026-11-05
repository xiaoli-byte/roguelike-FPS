"""Export Unity's native Gunfire prefabs, generic clips and motion data for Three.js."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import struct

import numpy as np
from PIL import Image
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler
import yaml

ROOT = Path(__file__).resolve().parents[2]
BUNDLE_DIR = ROOT / "Library" / "GunfireBundles"
UNITY = ROOT / "unity" / "Assets"
NATIVE = UNITY / "Art" / "Original" / "Gunfire"
OUT = ROOT / "public" / "assets" / "gunfire-original"
BUNDLES = {
    "1001": "data631", "1002": "data632", "1003": "data633", "1004": "data634",
    "1005": "data635", "1006": "data636", "1008": "data637", "1009": "data638",
    "1010": "data639", "1013": "data640", "1014": "data641", "1101": "data642",
    "1102": "data643", "1106": "data646", "1202": "data649", "1301": "data653",
}
TARGETS = {"1002": "smg", "1202": "revolver", "1008": "railgun"}
REFLECTION = np.diag([-1.0, 1.0, 1.0, 1.0])


def vector(value, keys="xyz"):
    return [float(getattr(value, key)) for key in keys]


def tree_vector(value, keys="xyz"):
    return [float(value[key]) for key in keys]


def reflected_matrix(value):
    matrix = np.array([[float(getattr(value, f"e{row}{col}")) for col in range(4)] for row in range(4)])
    return REFLECTION @ matrix @ REFLECTION


def yaml_document(path: Path):
    text = path.read_text(encoding="utf-8-sig")
    text = re.sub(r"^%.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^--- !u!\d+ &\d+", "---", text, flags=re.MULTILINE)
    return yaml.safe_load(text)


class Gltf:
    def __init__(self):
        self.doc = {
            "asset": {"version": "2.0", "generator": "Spiritfire Unity native weapon sync"},
            "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "skins": [],
            "animations": [], "materials": [], "textures": [], "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987}],
            "accessors": [], "bufferViews": [], "buffers": [],
        }
        self.binary = bytearray()

    def view(self, data: bytes, target=None):
        while len(self.binary) % 4:
            self.binary.append(0)
        index = len(self.doc["bufferViews"])
        view = {"buffer": 0, "byteOffset": len(self.binary), "byteLength": len(data)}
        if target:
            view["target"] = target
        self.doc["bufferViews"].append(view)
        self.binary.extend(data)
        return index

    def accessor(self, values, component_type, kind, target=34962):
        array = np.asarray(values)
        if array.dtype.byteorder not in ("=", "<", "|"):
            array = array.astype(array.dtype.newbyteorder("<"))
        data = array.tobytes()
        view = self.view(data, target)
        accessor = {
            "bufferView": view, "componentType": component_type, "count": int(len(array)),
            "type": kind,
        }
        if kind in {"VEC3", "SCALAR"} and array.size:
            accessor["min"] = np.atleast_1d(array.min(axis=0)).astype(float).tolist()
            accessor["max"] = np.atleast_1d(array.max(axis=0)).astype(float).tolist()
        index = len(self.doc["accessors"])
        self.doc["accessors"].append(accessor)
        return index

    def image(self, image: Image.Image):
        stream = io.BytesIO()
        image.save(stream, format="PNG", optimize=True)
        view = self.view(stream.getvalue())
        index = len(self.doc["images"])
        self.doc["images"].append({"bufferView": view, "mimeType": "image/png"})
        self.doc["textures"].append({"sampler": 0, "source": index})
        return index

    def write(self, path: Path):
        self.doc["buffers"] = [{"byteLength": len(self.binary)}]
        encoded = json.dumps(self.doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        while len(encoded) % 4:
            encoded += b" "
        while len(self.binary) % 4:
            self.binary.append(0)
        total = 12 + 8 + len(encoded) + 8 + len(self.binary)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as stream:
            stream.write(struct.pack("<4sII", b"glTF", 2, total))
            stream.write(struct.pack("<II", len(encoded), 0x4E4F534A))
            stream.write(encoded)
            stream.write(struct.pack("<II", len(self.binary), 0x004E4942))
            stream.write(self.binary)


class Exporter:
    def __init__(self, weapon: str, env, primary):
        self.weapon = weapon
        self.env = env
        self.primary = primary
        self.objects = [o for o in env.objects if o.assets_file.parent is primary]
        self.by_id = {o.path_id: o for o in self.objects}
        self.gos = {o.path_id: o.read() for o in self.objects if o.type.name == "GameObject"}
        self.transforms = {o.path_id: o.read() for o in self.objects if o.type.name == "Transform"}
        self.transform_by_go = {t.m_GameObject.m_PathID: (pid, t) for pid, t in self.transforms.items()}
        self.gltf = Gltf()
        self.nodes = {}
        self.paths = {}
        self.materials = {}
        self.arm_meshes = {}
        for name in ("hero_fpp_101_A_L", "hero_fpp_101_A_R"):
            native = yaml_document(NATIVE / "arts" / "artres" / "characters" / "heros" / "101" / f"{name}.asset")["Mesh"]["m_BindPose"]
            candidates = []
            for obj in env.objects:
                if obj.type.name != "Mesh" or obj.read().m_Name != name:
                    continue
                bindpose = obj.read_typetree()["m_BindPose"]
                error = max(abs(float(source[f"e{row}{col}"]) - float(target[f"e{row}{col}"])) for source, target in zip(bindpose, native) for row in range(4) for col in range(4))
                candidates.append((error, obj))
            if candidates:
                self.arm_meshes[name] = min(candidates, key=lambda item: item[0])[1]
        root_go = next(go for go in self.gos.values() if go.m_Name == weapon)
        root_transform = self.transform_by_go[next(pid for pid, go in self.gos.items() if go is root_go)][1]
        self.root_children = [ptr.m_PathID for ptr in root_transform.m_Children]
        self.gltf.doc["nodes"].append({"name": f"Gunfire_{weapon}", "children": []})
        self.gltf.doc["scenes"][0]["nodes"] = [0]
        self.role_roots = {}
        for role, suffix in (("Right", "_Right"), ("Left", "_Left")):
            child = next((pid for pid in self.root_children if self.gos[self.transforms[pid].m_GameObject.m_PathID].m_Name == weapon + suffix), None)
            if child is not None:
                self.role_roots[role] = child

    def path(self, transform_id: int, role_root: int):
        names = []
        current = transform_id
        while current != role_root:
            transform = self.transforms[current]
            names.append(self.gos[transform.m_GameObject.m_PathID].m_Name)
            current = transform.m_Father.m_PathID
        return "/".join(reversed(names))

    def active(self, transform_id: int, role_root: int):
        current = transform_id
        while True:
            if not self.gos[self.transforms[current].m_GameObject.m_PathID].m_IsActive:
                return False
            if current == role_root:
                return True
            current = self.transforms[current].m_Father.m_PathID

    def build_node(self, transform_id: int, role_root: int, role: str):
        transform = self.transforms[transform_id]
        go = self.gos[transform.m_GameObject.m_PathID]
        node = {
            "name": go.m_Name,
            "translation": [-transform.m_LocalPosition.x, transform.m_LocalPosition.y, transform.m_LocalPosition.z],
            "rotation": [transform.m_LocalRotation.x, -transform.m_LocalRotation.y, -transform.m_LocalRotation.z, transform.m_LocalRotation.w],
            "scale": vector(transform.m_LocalScale),
        }
        index = len(self.gltf.doc["nodes"])
        self.gltf.doc["nodes"].append(node)
        self.nodes[transform_id] = index
        self.paths[(role, self.path(transform_id, role_root))] = index
        children = []
        for ptr in transform.m_Children:
            child = ptr.m_PathID
            if child not in self.transforms:
                continue
            children.append(self.build_node(child, role_root, role))
        if children:
            node["children"] = children
        for component in go.m_Components:
            obj = self.by_id.get(component.m_PathID)
            if obj and obj.type.name == "SkinnedMeshRenderer":
                renderer = obj.read()
                if go.m_Name.startswith("hero_fpp_101_A_") or self.active(transform_id, role_root):
                    self.add_renderer(renderer, index, role)
        return index

    def texture(self, pointer, role: str):
        texture = pointer.read()
        image = texture.image.convert("RGBA")
        if role in {"S", "SPEC"}:
            pixels = np.asarray(image)
            orm = np.stack([pixels[:, :, 1], 255 - pixels[:, :, 3], pixels[:, :, 0]], axis=-1)
            return self.gltf.image(Image.fromarray(orm))
        return self.gltf.image(image)

    def material(self, pointer):
        key = (pointer.m_FileID, pointer.m_PathID)
        if key in self.materials:
            return self.materials[key]
        data = pointer.read_typetree()
        saved = data["m_SavedProperties"]
        material = {
            "name": data["m_Name"], "doubleSided": True,
            "pbrMetallicRoughness": {"metallicFactor": 0.35, "roughnessFactor": 0.63},
        }
        for name, spec in saved["m_TexEnvs"]:
            pointer_value = spec["m_Texture"]
            if not pointer_value["m_PathID"]:
                continue
            try:
                texture_pointer = self.resolve_pointer(pointer_value)
                texture = texture_pointer.read()
            except (ValueError, AttributeError):
                continue
            lower = texture.m_Name.lower()
            if name == "_MainTex" or "diff" in name.lower():
                material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": self.texture(texture_pointer, "BC")}
            elif name == "_BumpMap" or "norm" in lower or lower.endswith("_n"):
                material["normalTexture"] = {"index": self.texture(texture_pointer, "N")}
            elif "spec" in name.lower() or "gloss" in name.lower() or lower.endswith("_s"):
                orm = self.texture(texture_pointer, "SPEC")
                material["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"index": orm}
                material["occlusionTexture"] = {"index": orm}
                material["pbrMetallicRoughness"]["metallicFactor"] = 1.0
                material["pbrMetallicRoughness"]["roughnessFactor"] = 1.0
        index = len(self.gltf.doc["materials"])
        self.gltf.doc["materials"].append(material)
        self.materials[key] = index
        return index

    def resolve_pointer(self, value):
        class Pointer:
            pass
        pointer = Pointer()
        pointer.m_FileID = value["m_FileID"]
        pointer.m_PathID = value["m_PathID"]
        for obj in self.env.objects:
            if obj.path_id == pointer.m_PathID and obj.type.name in {"Texture2D", "Material", "Mesh"}:
                return obj
        raise ValueError(f"Unresolved native pointer {value}")

    def arm_material(self):
        key = "arms"
        if key in self.materials:
            return self.materials[key]
        base = NATIVE / "arts" / "artres" / "characters" / "heros" / "101" / "hero_fpp_101_A_c.png"
        material = {
            "name": "101_fpp", "doubleSided": True,
            "pbrMetallicRoughness": {"baseColorTexture": {"index": self.gltf.image(Image.open(base).convert("RGBA"))}, "metallicFactor": 0.1, "roughnessFactor": 0.7},
        }
        index = len(self.gltf.doc["materials"])
        self.gltf.doc["materials"].append(material)
        self.materials[key] = index
        return index

    def add_renderer(self, renderer, node_index: int, role: str):
        go = renderer.m_GameObject.read()
        arm = go.m_Name.startswith("hero_fpp_101_A_")
        if arm and not go.m_Name.endswith("_R" if role == "Right" else "_L"):
            return
        if not arm and role != "Right":
            return
        if arm:
            mesh_obj = self.arm_meshes.get(go.m_Name)
        else:
            mesh_obj = next((obj for obj in self.env.objects if obj.path_id == renderer.m_Mesh.m_PathID and obj.type.name == "Mesh"), None)
        if mesh_obj is None:
            return
        mesh = mesh_obj.read()
        handler = MeshHandler(mesh)
        handler.process()
        vertices = np.asarray(handler.m_Vertices, dtype=np.float32).copy()
        vertices[:, 0] *= -1
        normals = np.asarray(handler.m_Normals, dtype=np.float32).copy()
        normals[:, 0] *= -1
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)
        uv = np.asarray(handler.m_UV0 if handler.m_UV0 is not None else np.zeros((len(vertices), 2)), dtype=np.float32).copy()
        uv[:, 1] = 1.0 - uv[:, 1]
        if handler.m_BoneIndices is not None:
            joints = np.asarray(handler.m_BoneIndices, dtype=np.uint16).reshape(-1, 4)
            weights = np.asarray(handler.m_BoneWeights, dtype=np.float32).reshape(-1, 4)
            inferred = weights[:, 3] < 0
            weights[inferred, 3] = (30.0 + weights[inferred, 3]) / 31.0
            sums = weights.sum(axis=1, keepdims=True)
            if not np.isfinite(weights).all() or weights.min() < 0 or not np.allclose(sums, 1.0, atol=1e-5):
                raise ValueError(f"Invalid compressed skin weights in {mesh.m_Name}")
            weights /= np.maximum(sums, 1e-8)
        else:
            joints = np.zeros((len(vertices), 4), dtype=np.uint16)
            weights = np.zeros((len(vertices), 4), dtype=np.float32)
            weights[:, 0] = 1.0
        attributes = {
            "POSITION": self.gltf.accessor(vertices, 5126, "VEC3"),
            "NORMAL": self.gltf.accessor(normals, 5126, "VEC3"),
            "TEXCOORD_0": self.gltf.accessor(uv, 5126, "VEC2"),
            "JOINTS_0": self.gltf.accessor(joints, 5123, "VEC4"),
            "WEIGHTS_0": self.gltf.accessor(weights, 5126, "VEC4"),
        }
        triangles = handler.get_triangles()
        primitives = []
        for submesh, tris in enumerate(triangles):
            indices = np.asarray([i for tri in tris for i in reversed(tri)], dtype=np.uint32)
            primitive = {"attributes": attributes, "indices": self.gltf.accessor(indices, 5125, "SCALAR", 34963), "mode": 4}
            try:
                if arm:
                    primitive["material"] = self.arm_material()
                elif renderer.m_Materials:
                    primitive["material"] = self.material(renderer.m_Materials[min(submesh, len(renderer.m_Materials) - 1)])
            except (ValueError, AttributeError):
                pass
            primitives.append(primitive)
        if not primitives:
            return
        mesh_index = len(self.gltf.doc["meshes"])
        self.gltf.doc["meshes"].append({"name": mesh.m_Name, "primitives": primitives})
        bone_nodes = [self.nodes[ptr.m_PathID] for ptr in renderer.m_Bones if ptr.m_PathID in self.nodes]
        if not bone_nodes:
            return
        tree = mesh_obj.read_typetree()
        matrices = []
        for row in tree["m_BindPose"]:
            class Matrix:
                pass
            value = Matrix()
            for key, number in row.items():
                setattr(value, key, number)
            matrices.append(reflected_matrix(value))
        if len(matrices) != len(bone_nodes):
            return
        ibm = self.gltf.accessor(np.asarray(matrices, dtype=np.float32).transpose(0, 2, 1), 5126, "MAT4")
        skin = len(self.gltf.doc["skins"])
        self.gltf.doc["skins"].append({"joints": bone_nodes, "inverseBindMatrices": ibm})
        if renderer.m_RootBone.m_PathID in self.nodes:
            self.gltf.doc["skins"][-1]["skeleton"] = self.nodes[renderer.m_RootBone.m_PathID]
        self.gltf.doc["nodes"][node_index]["mesh"] = mesh_index
        self.gltf.doc["nodes"][node_index]["skin"] = skin

    def clip_path(self, role: str, action: str):
        candidates = []
        for path in NATIVE.rglob("*.anim"):
            name = path.name
            if not name.startswith(f"({self.weapon}_"):
                continue
            lower = name.lower()
            if action.lower() not in lower:
                continue
            left = "_l_" in lower
            if (role == "Left") != left:
                continue
            candidates.append(path)
        return sorted(candidates, key=lambda p: (len(p.name), p.name))[0] if candidates else None

    def add_clip(self, role: str, action: str):
        path = self.clip_path(role, action)
        if path is None:
            return None
        data = yaml_document(path)["AnimationClip"]
        animation = {"name": f"{role}_{action}", "channels": [], "samplers": []}
        for kind, curves, size, output in (
            ("rotation", "m_RotationCurves", 4, 5126),
            ("translation", "m_PositionCurves", 3, 5126),
            ("scale", "m_ScaleCurves", 3, 5126),
        ):
            for record in data.get(curves, []):
                target = self.paths.get((role, record["path"])) or self.paths.get((role, "Home/" + record["path"]))
                if target is None:
                    continue
                keys = record["curve"]["m_Curve"]
                if not keys:
                    continue
                times = np.asarray([float(key["time"]) for key in keys], dtype=np.float32)
                values = np.asarray([tree_vector(key["value"], "xyzw"[:size]) for key in keys], dtype=np.float32)
                if kind == "rotation":
                    values[:, 1:3] *= -1
                    values /= np.maximum(np.linalg.norm(values, axis=1, keepdims=True), 1e-8)
                elif kind == "translation":
                    values[:, 0] *= -1
                sampler = len(animation["samplers"])
                animation["samplers"].append({
                    "input": self.gltf.accessor(times, 5126, "SCALAR", None),
                    "output": self.gltf.accessor(values, output, "VEC4" if size == 4 else "VEC3", None),
                    "interpolation": "LINEAR",
                })
                animation["channels"].append({"sampler": sampler, "target": {"node": target, "path": kind}})
        if not animation["channels"]:
            return None
        self.gltf.doc["animations"].append(animation)
        return animation["name"]

    def run(self):
        for role, root in self.role_roots.items():
            node = self.build_node(root, root, role)
            self.gltf.doc["nodes"][0]["children"].append(node)
        clips = {}
        for role in self.role_roots:
            for action in ("Pose", "Fire", "Reload"):
                name = self.add_clip(role, action)
                if name:
                    clips[f"{role}_{action}"] = name
        output = OUT / f"Gunfire_{self.weapon}.glb"
        self.gltf.write(output)
        data = output.read_bytes()
        return {
            "url": f"assets/gunfire-original/{output.name}", "weapon": self.weapon,
            "target": TARGETS.get(self.weapon), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "motion": f"assets/gunfire-original/motion/{self.weapon}.json", "animations": clips,
            "meshes": len(self.gltf.doc["meshes"]), "skins": len(self.gltf.doc["skins"]),
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weapons", nargs="+", default=list(TARGETS))
    args = parser.parse_args()
    unknown = set(args.weapons) - set(BUNDLES)
    if unknown:
        raise ValueError(f"Unknown native weapons: {sorted(unknown)}")
    game = Path(os.environ.get("GUNFIRE_REBORN_HOME", r"G:\SteamLibrary\steamapps\common\Gunfire Reborn")) / "Gunfire Reborn_Data" / "StreamingAssets" / "assetbundles"
    names = dict.fromkeys([*(BUNDLES[weapon] for weapon in args.weapons), "data243", "data244", "data245", "data251", "data255", "data268", "data295", "data296", "data468", "data29"])
    paths = {}
    for name in names:
        path = next((candidate / name for candidate in (BUNDLE_DIR, game) if (candidate / name).exists()), None)
        if path is None:
            raise FileNotFoundError(f"Missing Unity source bundle: {name}")
        paths[name] = path
    env = UnityPy.load(*[str(path) for path in paths.values()])
    manifest = {"schema": 1, "source": "unity/Assets/Art/Original/Gunfire", "assets": {}}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "motion").mkdir(exist_ok=True)
    for weapon in BUNDLES:
        source = UNITY / "Resources" / "Gunfire" / "Motion" / f"{weapon}.json"
        if source.exists():
            (OUT / "motion" / source.name).write_bytes(source.read_bytes())
    for weapon in args.weapons:
        bundle = BUNDLES[weapon]
        result = Exporter(weapon, env, env.files[str(paths[bundle])]).run()
        manifest["assets"][weapon] = result
        print(json.dumps(result, ensure_ascii=False))
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
