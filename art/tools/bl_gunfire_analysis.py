"""Build static, textured inspection GLBs and previews for exported Gunfire weapons."""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

params = json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text(encoding="utf-8"))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

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
    base_path = next((Path(params["output"]).parent / t["baseColor"] for t in spec["textures"].values() if "baseColor" in t), None)
    normal_path = next((Path(params["output"]).parent / t["normal"] for t in spec["textures"].values() if "normal" in t), None)
    orm_path = next((Path(params["output"]).parent / t["orm"] for t in spec["textures"].values() if "orm" in t), None)
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
    materials.append(material)

bounds_min = Vector((float("inf"),) * 3)
bounds_max = Vector((float("-inf"),) * 3)
for spec in params["meshes"]:
    mesh = bpy.data.meshes.new(spec["name"])
    mesh.from_pydata(spec["vertices"], [], spec["triangles"])
    mesh.update()
    obj = bpy.data.objects.new(spec["name"], mesh)
    bpy.context.collection.objects.link(obj)
    if spec["material"] >= 0:
        mesh.materials.append(materials[spec["material"]])
    uv = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        uv.data[loop.index].uv = spec["uv"][loop.vertex_index] if spec["uv"] else (0, 0)
        if spec["material"] >= 0 and not spec["name"].startswith("Circle"):
            point = mesh.vertices[loop.vertex_index].co
            for axis in range(3):
                bounds_min[axis] = min(bounds_min[axis], point[axis])
                bounds_max[axis] = max(bounds_max[axis], point[axis])
    mesh.normals_split_custom_set_from_vertices([Vector(v).normalized() for v in spec["normals"]])

out = Path(params["output"])
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", export_yup=True,
    export_apply=False, export_animations=False, export_tangents=True,
    export_image_format="AUTO", export_draco_mesh_compression_enable=True)

for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        obj.hide_render = not obj.data.materials or obj.name.startswith("Circle")

center = (bounds_min + bounds_max) * 0.5
size = max(bounds_max - bounds_min)
scene = bpy.context.scene
scene.view_settings.exposure = 4.0 if params["weapon"] == "1106" else 3.0 if params["weapon"] == "1301" else 0
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1000
scene.render.resolution_y = 750
scene.render.resolution_percentage = 100
scene.world.color = (0.12, 0.12, 0.12)
for name, energy, area, location in [("Key", 700, 4, (2, -3, 4)), ("Fill", 450, 3, (-3, 1, 2)), ("Rim", 600, 3, (1, 3, 3))]:
    light = bpy.data.lights.new(name, "AREA")
    light.energy = energy
    light.shape = "DISK"
    light.size = area
    obj = bpy.data.objects.new(name, light)
    bpy.context.collection.objects.link(obj)
    obj.location = center + Vector(location) * max(size, 0.5)
    obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()
camera = bpy.data.cameras.new("Inspection")
cam = bpy.data.objects.new("Inspection", camera)
bpy.context.collection.objects.link(cam)
cam.location = center + Vector((1.8, -3.2, 1.5)) * max(size, 0.4)
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
camera.type = "ORTHO"
camera.ortho_scale = size * 1.25
scene.camera = cam
scene.render.filepath = params["preview"]
bpy.ops.render.render(write_still=True)
print(f"Exported {out} and {params['preview']}")
