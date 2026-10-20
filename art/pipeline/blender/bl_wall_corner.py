"""Build a 90-degree corner from a published straight wall section (run by derive_wall_corner.py inside Blender).

The straight wall runs along X with its front face toward -Y (Blender; glTF +Z) and flat cut ends. One arm keeps
the wall shifted so its right end lands at x = arm and its body reaches past the corner; it is cut by the miter
plane x = y (keeping x >= y). The other arm is that arm mirrored across the same plane, (x, y) -> (y, x), so the
two cut outlines are identical and weld vertex for vertex: no caps, no seam, the same rammed-earth texture on both
arms (mirrored on the second). Centre lines meet at the origin; arm A runs along +X, arm B along +Y (glTF -Z,
behind the front face), so both front faces form the outside of the L. Every LOD is processed on its own and then
collapsed to the kit budget with UV-island borders kept.

Params (JSON after --): {"source", "out", "arm", "budget": [..], "image_format", "draco", "result_path"}
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Vector

P = json.loads(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8").read())
RESULT = {"lods": []}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P["source"])
lods = {}
for ob in bpy.data.objects:
    if ob.type == "MESH" and "_LOD" in ob.name:
        lods[int(ob.name.rsplit("_LOD", 1)[1].split(".")[0])] = ob
lods = [lods[k] for k in sorted(lods)]
for ob in lods:
    ob.data.transform(ob.matrix_world)
    ob.matrix_world.identity()
    ob.parent = None

x_max = max(v.co.x for v in lods[0].data.vertices)
shift = P["arm"] - x_max  # the source's flat right end becomes the far end of arm A

made = []
for n, src in enumerate(lods):
    mesh = src.data.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.translate(bm, vec=Vector((shift, 0, 0)), verts=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    # plane x - y = 0, normal (1, -1, 0): clear_inner drops the x < y side
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((0, 0, 0)), plane_no=Vector((1, -1, 0)).normalized(),
                           clear_inner=True, clear_outer=False, dist=1e-5)
    # arm B: mirror a copy across x = y and flip its winding
    dup = bmesh.ops.duplicate(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:])
    new_verts = [e for e in dup["geom"] if isinstance(e, bmesh.types.BMVert)]
    new_faces = [e for e in dup["geom"] if isinstance(e, bmesh.types.BMFace)]
    for v in new_verts:
        v.co.x, v.co.y = v.co.y, v.co.x
    bmesh.ops.reverse_faces(bm, faces=new_faces, flip_multires=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(f"{P['id']}_LOD{n}", mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob["lod"] = n
    ob["lod_distance"] = P["lod_distance"][n]
    budget = P["budget"][n]
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    if tris > budget:
        mod = ob.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type, mod.ratio, mod.use_collapse_triangulate, mod.delimit = "COLLAPSE", budget / tris * 0.995, True, {"UV"}
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    tri = bpy.data.objects[ob.name].modifiers.new("tri", "TRIANGULATE")
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=tri.name)
        if mesh.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    made.append(ob)
    co = [v.co for v in ob.data.vertices]
    RESULT["lods"].append({"lod": n, "tris": len(ob.data.polygons),
                           "bbox_min": [round(min(c[i] for c in co), 4) for i in range(3)],
                           "bbox_max": [round(max(c[i] for c in co), 4) for i in range(3)]})

for ob in lods:
    bpy.data.objects.remove(ob)
bpy.ops.object.select_all(action="DESELECT")
for ob in made:
    ob.select_set(True)
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
opts = dict(filepath=P["out"], export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
            export_image_format=P["image_format"], export_animations=False, export_extras=True,
            export_cameras=False, export_lights=False,
            export_draco_mesh_compression_enable=P["draco"], export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14, export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})
open(P["result_path"], "w", encoding="utf-8").write(json.dumps(RESULT, ensure_ascii=False, indent=1))
