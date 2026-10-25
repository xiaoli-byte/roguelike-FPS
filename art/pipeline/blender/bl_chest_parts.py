"""Split a published closed chest into a body and a hinged lid (run by derive_chest_parts.py inside Blender).

The chest stands on z = 0 with its front toward -Y (Blender; glTF +Z) and its hinges on the back (+Y). Every LOD is cut
by the horizontal plane z = seam: the part below is the body, the part above is the lid. Each cut opening is closed: the
body gets a shallow inset tray (a lip and a floor `depth` below the rim, so an opened chest reads as a box, not a solid
block), the lid a flat cap facing down. Cap UVs take the average UV of the rim they close, so they carry the rim colour
from the chest's own texture (one material, no new image). The lid's origin is moved to the hinge line: x = 0 (the
chest's centre line), y = the back of the cut, z = seam, so rotating the lid about its local X opens it.

Params (JSON after --): {"source", "out_body", "out_lid", "body_id", "lid_id", "seam", "depth", "lip",
"lod_distance": [..], "image_format", "draco", "result_path"}
Result: {"seam", "hinge" (Blender xyz of the lid origin in body space), "lods": [{part, lod, tris, bbox_min, bbox_max}]}
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

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

zs = [v.co.z for v in lods[0].data.vertices]
z0, z1 = min(zs), max(zs)
SEAM = z0 + (z1 - z0) * P["seam"]
RESULT["seam"] = round(SEAM, 4)


def close_opening(bm, top: bool, depth: float) -> None:
    """Fill the open boundary loops left by the cut (all lie on z = SEAM). The body (top=True) gets an inset tray."""
    uv = bm.loops.layers.uv.active
    edges = [e for e in bm.edges if e.is_boundary and all(abs(v.co.z - SEAM) < 1e-3 for v in e.verts)]
    if not edges:
        return
    rim_uv = {}
    for e in edges:
        for v in e.verts:
            for lp in v.link_loops:
                rim_uv.setdefault(v, []).append(lp[uv].uv.copy())
    res = bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    caps = res["faces"]
    if not caps:
        return
    for f in caps:
        # average rim UV of this cap: one flat colour sampled from the chest's own texture
        us = [u for v in f.verts for u in rim_uv.get(v, [])]
        avg = sum(us, Vector((0, 0))) / max(len(us), 1)
        for lp in f.loops:
            lp[uv].uv = avg
        f.normal_update()
        if (f.normal.z < 0) if top else (f.normal.z > 0):
            f.normal_flip()
    if top and depth > 0:
        ins = bmesh.ops.inset_region(bm, faces=caps, thickness=P["lip"], depth=0.0, use_even_offset=True)
        inner = caps  # inset_region keeps the original faces as the inner region
        moved = {v for f in inner for v in f.verts}
        for v in moved:
            v.co.z -= depth
        # the walls of the tray take the rim colour too
        for f in ins["faces"]:
            us = [lp[uv].uv for lp in f.loops]
            avg = sum(us, Vector((0, 0))) / max(len(us), 1)
            for lp in f.loops:
                lp[uv].uv = avg
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])


def part(src, n: int, keep_top: bool, name: str):
    mesh = src.data.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((0, 0, SEAM)), plane_no=Vector((0, 0, 1)),
                           clear_inner=keep_top, clear_outer=not keep_top, dist=1e-5)
    close_opening(bm, top=not keep_top, depth=P["depth"])
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(f"{name}_LOD{n}", mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob["lod"] = n
    ob["lod_distance"] = P["lod_distance"][n]
    tri = ob.modifiers.new("tri", "TRIANGULATE")
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=tri.name)
        if mesh.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    return ob


bodies = [part(src, n, keep_top=False, name=P["body_id"]) for n, src in enumerate(lods)]
lids = [part(src, n, keep_top=True, name=P["lid_id"]) for n, src in enumerate(lods)]

# hinge: the back edge of the lid's cut, on the chest's centre line
cut = [v.co for v in lids[0].data.vertices if abs(v.co.z - SEAM) < 2e-3]
y_back = max(c.y for c in cut) if cut else max(v.co.y for v in lids[0].data.vertices)
hinge = Vector((0.0, y_back, SEAM))
RESULT["hinge"] = [round(hinge.x, 4), round(hinge.y, 4), round(hinge.z, 4)]
for ob in lids:
    ob.data.transform(Matrix.Translation(-hinge))

for ob in lods:
    bpy.data.objects.remove(ob)


def export(objs, path: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        co = [v.co for v in ob.data.vertices]
        RESULT["lods"].append({"part": ob.name.rsplit("_LOD", 1)[0], "lod": ob["lod"], "tris": len(ob.data.polygons),
                               "bbox_min": [round(min(c[i] for c in co), 4) for i in range(3)],
                               "bbox_max": [round(max(c[i] for c in co), 4) for i in range(3)]})
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    opts = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
                export_image_format=P["image_format"], export_animations=False, export_extras=True,
                export_cameras=False, export_lights=False,
                export_draco_mesh_compression_enable=P["draco"], export_draco_mesh_compression_level=6,
                export_draco_position_quantization=14, export_draco_normal_quantization=10,
                export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})


export(bodies, P["out_body"])
export(lids, P["out_lid"])
open(P["result_path"], "w", encoding="utf-8").write(json.dumps(RESULT, ensure_ascii=False, indent=1))
