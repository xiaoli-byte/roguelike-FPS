"""Build a runtime rigid-parts weapon from the Gunfire analysis pack."""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

params = json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text(encoding="utf-8"))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
asset = params["asset"]
joint_names = [j["name"] for j in params["joints"]]

arm_data = bpy.data.armatures.new(asset + "_Skeleton")
arm = bpy.data.objects.new(asset + "_Skeleton", arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for spec in params["joints"]:
    bone = arm_data.edit_bones.new(spec["name"])
    x, y, z = spec["bindPosition"]
    bone.head = Vector((x, -z, y))
    bone.tail = bone.head + Vector((0, 0, 0.03))
    if spec["parent"]:
        bone.parent = arm_data.edit_bones[spec["parent"]]
bpy.ops.object.mode_set(mode="OBJECT")

materials = []
for spec in params["materials"]:
    material = bpy.data.materials.new(spec["name"])
    material.use_nodes = True
    material.use_backface_culling = False
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = 0.35
    bsdf.inputs["Roughness"].default_value = 0.63
    base_path = next((Path(params["materialRoot"]) / t["baseColor"] for t in spec["textures"].values() if "baseColor" in t), None)
    normal_path = next((Path(params["materialRoot"]) / t["normal"] for t in spec["textures"].values() if "normal" in t), None)
    orm_path = next((Path(params["materialRoot"]) / t["orm"] for t in spec["textures"].values() if "orm" in t), None)
    emission_path = next((Path(params["materialRoot"]) / t["emission"] for t in spec["textures"].values() if "emission" in t), None)
    if base_path and base_path.exists():
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(base_path), check_existing=True)
        node.image.colorspace_settings.name = "sRGB"
        links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    if normal_path and normal_path.exists():
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(normal_path), check_existing=True)
        node.image.colorspace_settings.name = "Non-Color"
        normal = nodes.new("ShaderNodeNormalMap")
        links.new(node.outputs["Color"], normal.inputs["Color"])
        links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    if orm_path and orm_path.exists():
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(orm_path), check_existing=True)
        node.image.colorspace_settings.name = "Non-Color"
        separate = nodes.new("ShaderNodeSeparateColor")
        links.new(node.outputs["Color"], separate.inputs["Color"])
        links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
        group = nodes.new("ShaderNodeGroup")
        group.node_tree = bpy.data.node_groups.get("glTF Material Output")
        if group.node_tree is None:
            group.node_tree = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
            group.node_tree.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        links.new(separate.outputs["Red"], group.inputs["Occlusion"])
    if emission_path and emission_path.exists() and "_EMISSION" in spec.get("keywords", ""):
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(emission_path), check_existing=True)
        node.image.colorspace_settings.name = "Non-Color"
        links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    materials.append(material)

for spec in params["meshes"]:
    mesh = bpy.data.meshes.new(spec["name"])
    mesh.from_pydata(spec["vertices"], [], spec["triangles"])
    mesh.update()
    obj = bpy.data.objects.new(spec["name"], mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = arm
    if spec["material"] >= 0:
        mesh.materials.append(materials[spec["material"]])
    groups = {}
    for v, bone in enumerate(spec["weights"]):
        if bone not in groups:
            groups[bone] = obj.vertex_groups.new(name=bone)
        groups[bone].add([v], 1.0, "REPLACE")
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = arm
    uv = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        uv.data[loop.index].uv = spec["uv"][loop.vertex_index] if spec["uv"] else (0, 0)
    mesh.normals_split_custom_set_from_vertices([Vector(v).normalized() for v in spec["normals"]])
    obj["lod"] = 0
    obj["lod_distance"] = 0.0
    obj["source_part"] = spec["name"]
    obj.select_set(False)

bpy.ops.object.select_all(action="DESELECT")
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
joined.name = asset + "_LOD0"
joined.data.name = asset + "_LOD0"
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
joined.select_set(True)
bpy.context.view_layer.objects.active = arm
out = Path(params["output"])
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", use_selection=True,
    export_yup=True, export_apply=False, export_animations=False, export_skins=True,
    export_tangents=True, export_extras=True, export_image_format="AUTO",
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
metrics = {"asset": asset, "triangles": sum(len(m["triangles"]) for m in params["meshes"]),
           "sourceParts": [{"name": m["name"], "triangles": len(m["triangles"])} for m in params["meshes"]],
           "joints": joint_names, "lodReduction": False}
metrics_path = Path(params["metrics"])
metrics_path.parent.mkdir(parents=True, exist_ok=True)
metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(metrics, ensure_ascii=False))
