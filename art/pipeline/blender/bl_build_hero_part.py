"""Hero attachment build (headless Blender): a static Tripo smart-mesh part (e.g. 磐's curled-up scale ball) → runtime GLB.

The part has no blockout in the game, so it is fitted to a design size instead of a bounds reference:
  1. import the provider FBX, apply transforms (front = -Y, Z up), origin at the bounding-box centre, uniform scale so the
     largest dimension equals P["size"] metres;
  2. one LOD, the provider mesh as it is (no decimation), node name <asset>_LOD0;
  3. the provider base colour is resized to the class texture size; flat roughness, no metal;
  4. GLB export (Draco + WebP) + metrics JSON.
"""
import json
import sys
import time
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from bl_common import args, finish, log  # noqa: E402

P = args()
name = P["asset_id"]
T0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
if P["source"].lower().endswith((".glb", ".gltf")):  # committed Tripo originals (pet parts) are GLB
    bpy.ops.import_scene.gltf(filepath=P["source"])
else:
    bpy.ops.import_scene.fbx(filepath=P["source"])
for o in [o for o in bpy.data.objects if o.type != "MESH"]:
    bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
    for m in list(o.modifiers):
        o.modifiers.remove(m)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
V = np.array([v.co[:] for v in mesh.data.vertices])
lo, hi = V.min(0), V.max(0)
s = float(P["size"]) / float((hi - lo).max())
centre = (lo + hi) / 2
for v in mesh.data.vertices:
    v.co = (np.array(v.co[:]) - centre) * s
mesh.data.update()
mesh.name = f"{name}_LOD0"
log(f"导入：{len(mesh.data.polygons)} 面，缩放 {s:.3f}")

# texture: provider base colour resized, one material
mat = mesh.data.materials[0]
mat.name = f"M_{name.split('_', 1)[1]}"
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
img = bsdf.inputs["Base Color"].links[0].from_node.image
img.scale(int(P["texture"]), int(P["texture"]))
img.name = f"T_{name.split('_', 1)[1]}_BC"
for key in ("Metallic", "Roughness"):
    for l in list(bsdf.inputs[key].links):
        mat.node_tree.links.remove(l)
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = float(P.get("roughness", 0.7))
for l in list(bsdf.inputs["Normal"].links):
    mat.node_tree.links.remove(l)
for i in range(len(mesh.data.materials) - 1, 0, -1):
    mesh.data.materials.pop(index=i)

lods = [mesh]  # one LOD, the source mesh as it is: no decimation (2026-10-25)
src_tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
mesh["lod"] = 0
mesh["lod_distance"] = P["lod_distance"][0]
lod_tris = [sum(len(p.vertices) - 2 for p in o.data.polygons) for o in lods]
log(f"LOD {lod_tris}（源 {src_tris}）")

bpy.ops.object.select_all(action="DESELECT")
for o in lods:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=P["out_glb"], export_format="GLB", use_selection=True, export_apply=True,
                          export_image_format="WEBP", export_draco_mesh_compression_enable=True, export_extras=True,
                          export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=P["out_blend"])
finish(P, {"lod_tris": lod_tris, "source_tris": src_tris, "scale": s, "size": P["size"], "seconds": round(time.time() - T0, 1)})
