"""Blender-side build for import_gunfire_weapon.py."""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

params = json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text(encoding="utf-8"))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

arm_data = bpy.data.armatures.new(params["asset"] + "_Skeleton")
arm = bpy.data.objects.new(params["asset"] + "_Skeleton", arm_data)
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

material = bpy.data.materials.new("M_Weapon_Gunfire1001")
material.use_nodes = True
material.use_backface_culling = False
nodes = material.node_tree.nodes
links = material.node_tree.links
bsdf = nodes.get("Principled BSDF")
bsdf.inputs["Metallic"].default_value = 1
bsdf.inputs["Roughness"].default_value = 1
textures = Path(params["textures"])

def image_node(name, suffix, color_space):
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(str(textures / f"T_Weapon_Gunfire1001_{suffix}.png"), check_existing=True)
    node.image.colorspace_settings.name = color_space
    node.label = name
    return node

base = image_node("Base Color", "BC", "sRGB")
links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
normal = image_node("Normal OpenGL", "N", "Non-Color")
normal_map = nodes.new("ShaderNodeNormalMap")
links.new(normal.outputs["Color"], normal_map.inputs["Color"])
links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
orm = image_node("R=AO G=Roughness B=Metallic", "ORM", "Non-Color")
separate = nodes.new("ShaderNodeSeparateColor")
links.new(orm.outputs["Color"], separate.inputs["Color"])
links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
output = nodes.new("ShaderNodeGroup")
output.node_tree = bpy.data.node_groups.get("glTF Material Output")
if output.node_tree is None:
    output.node_tree = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    output.node_tree.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
links.new(separate.outputs["Red"], output.inputs["Occlusion"])

for spec in params["meshes"]:
    mesh = bpy.data.meshes.new(spec["name"])
    mesh.from_pydata(spec["vertices"], [], spec["triangles"])
    mesh.update()
    obj = bpy.data.objects.new(params["asset"] + "_LOD0" if spec["name"] == "Main" else spec["name"], mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = arm
    obj.data.materials.append(material)
    group = obj.vertex_groups.new(name=spec["bone"])
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = arm
    uv = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        uv.data[loop.index].uv = spec["uv"][loop.vertex_index]
    normals = [Vector(v).normalized() for v in spec["normals"]]
    mesh.normals_split_custom_set_from_vertices(normals)
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
joined.name = params["asset"] + "_LOD0"
joined.data.name = params["asset"] + "_LOD0"

bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
joined.select_set(True)
bpy.context.view_layer.objects.active = arm
out = Path(params["output"])
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(out), export_format="GLB", use_selection=True,
    export_yup=True, export_apply=False, export_animations=False,
    export_skins=True, export_tangents=True, export_extras=True,
    export_image_format="AUTO", export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
)
metrics = {
    "asset": params["asset"], "triangles": sum(len(m["triangles"]) for m in params["meshes"]),
    "sourceParts": [{"name": m["name"], "bone": m["bone"], "triangles": len(m["triangles"])} for m in params["meshes"]],
    "lodReduction": False, "textures": ["BC 1024", "N 1024 OpenGL", "ORM 1024 linear"],
}
metrics_path = Path(params["metrics"])
metrics_path.parent.mkdir(parents=True, exist_ok=True)
metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(metrics, ensure_ascii=False))
