"""Geometry-only GLB for an upload to Tripo Studio 纹理生成 (使用原始 UV): positions, normals and the first UV set,
no materials, no images, no Draco — so the uploaded file is small and the original UV layout survives unchanged.

params: {"source": <glb>, "out_glb": <glb>}
"""
from pathlib import Path

import bpy

import sys as _sys
_sys.path.insert(0, str(Path(__file__).parent))
from bl_common import args, clear_scene, finish, import_glb, log

P = args()
clear_scene()
objs = [o for o in import_glb(P["source"]) if o.type == "MESH"]
# Published GLBs may still carry far LODs (_LOD1…): upload only LOD0, the mesh the texture is painted for
lods = [o for o in objs if "_LOD" in o.name and not o.name.split("_LOD")[-1].startswith("0")]
for o in lods:
    bpy.data.objects.remove(o)
objs = [o for o in objs if o not in lods]
for o in objs:
    o.data.materials.clear()
    while len(o.data.uv_layers) > 1:
        o.data.uv_layers.remove(o.data.uv_layers[-1])
tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
verts = sum(len(o.data.vertices) for o in objs)
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
Path(P["out_glb"]).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=P["out_glb"], export_format="GLB", use_selection=True, export_materials="NONE",
                          export_texcoords=True, export_normals=True, export_yup=True,
                          export_draco_mesh_compression_enable=False, export_extras=False)
log(f"去材质导出 {Path(P['out_glb']).name}：{tris} 三角面，{verts} 顶点")
finish(P, {"tris": tris, "verts": verts, "bytes": Path(P["out_glb"]).stat().st_size})
