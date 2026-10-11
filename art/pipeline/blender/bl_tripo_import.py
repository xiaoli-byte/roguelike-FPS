"""Tripo Studio original (FBX/GLB from the DCC Bridge inbox) → one GLB high-poly with the provider's PBR images.

Only transforms are applied; topology, UVs and textures stay exactly as Tripo produced them.
"""
from pathlib import Path

import bpy

import sys as _sys
_sys.path.insert(0, str(Path(__file__).parent))
from bl_common import args, clear_scene, finish, log

P = args()
RESULT: dict = {}
clear_scene()
src = Path(P["source"])
before = set(bpy.data.objects)
if src.suffix.lower() == ".fbx":
    bpy.ops.import_scene.fbx(filepath=str(src), use_image_search=True)
else:
    bpy.ops.import_scene.gltf(filepath=str(src))
meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
if not meshes:
    raise RuntimeError(f"{src.name}: no mesh in provider file")
for o in [o for o in bpy.data.objects if o.type not in {"MESH"}]:
    bpy.data.objects.remove(o)
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
hp = bpy.context.view_layer.objects.active
hp.name = "HP"
images = sorted({n.image.name: [n.image.size[0], n.image.size[1]] for m in hp.data.materials if m and m.use_nodes
                 for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}.items())
for img in bpy.data.images:
    if img.size[0] > 0 and not img.packed_file:
        img.pack()
dims = hp.dimensions
RESULT.update({"faces": len(hp.data.polygons), "verts": len(hp.data.vertices),
               "tris": sum(len(p.vertices) - 2 for p in hp.data.polygons),
               "materials": [m.name for m in hp.data.materials if m], "images": images,
               "uv_layers": [u.name for u in hp.data.uv_layers],
               "dimensions_blender": [round(float(v), 4) for v in dims]})
out = Path(P["out_glb"])
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", use_selection=False, export_yup=True,
                          export_texcoords=True, export_normals=True, export_materials="EXPORT",
                          export_image_format="AUTO", export_animations=False, export_skins=False)
RESULT["bytes"] = out.stat().st_size
log(f"Tripo 原件 {src.name} → {out.name}：{RESULT['tris']} 三角面，贴图 {len(images)} 张")
finish(P, RESULT)
