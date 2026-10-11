"""Split a published wall section into a modular kit (run by derive_wall_kit.py inside Blender).

Each piece is the source cut by up to two planes x = lo / x = hi (Blender world metres, after the node
transforms), on every LOD, with the cut capped so the shell is closed: neighbouring pieces then meet face
to face and nothing can be seen through a joint. Cap faces take the UVs of the cut edge they close, so
they carry the surrounding sandstone colour. Material and textures are the source's own.

Params (JSON file passed after --): {"source": glb, "pieces": [{"id", "lo", "hi", "out"}], "image_format", "draco", "result_path"}
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Vector

P = json.loads(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8").read())
RESULT = {"pieces": []}


def lod_objects():
    out = {}
    for ob in bpy.data.objects:
        if ob.type == "MESH" and "_LOD" in ob.name:
            out[int(ob.name.rsplit("_LOD", 1)[1].split(".")[0])] = ob
    return [out[k] for k in sorted(out)]


def cut(bm: bmesh.types.BMesh, x: float, keep_above: bool) -> None:
    """Bisect at x and drop the other side."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((x, 0, 0)), plane_no=Vector((1, 0, 0)),
                           clear_inner=keep_above, clear_outer=not keep_above, dist=1e-5)


BIN, GAP = .12, 2.5


def cap(bm: bmesh.types.BMesh, x: float, outward: float) -> int:
    """Close the cut at x; faces point along +X * outward. Returns the face count.

    Tripo meshes are split into many UV islands, so the cut outline is not one clean loop to triangulate.
    A wall's cross-section is solid from its front to its back at every height, so the cap is built per
    height band instead: the frontmost and backmost cut points of each band, joined to the next band up
    unless they are more than GAP apart (above the parapet a crenel the plane passes through has no points).
    """
    pts = [v for v in bm.verts if abs(v.co.x - x) < 1e-4 and v.link_loops]
    if len(pts) < 3:
        return 0
    bands: dict[int, list] = {}
    for v in pts:
        bands.setdefault(int(v.co.z // BIN), []).append(v)
    uv = bm.loops.layers.uv.active

    def uv_of(v):
        return sum((l[uv].uv for l in v.link_loops), Vector((0, 0))) / len(v.link_loops) if uv else None

    rows = {}
    for k, vs in bands.items():
        z = sum(v.co.z for v in vs) / len(vs)
        front, back = min(vs, key=lambda v: v.co.y), max(vs, key=lambda v: v.co.y)
        if back.co.y - front.co.y < .02:
            continue
        rows[k] = [(bm.verts.new((x, front.co.y, z)), uv_of(front)), (bm.verts.new((x, back.co.y, z)), uv_of(back))]
    made = 0
    keys = sorted(rows)
    for k, k2 in zip(keys, keys[1:]):
        # Coarse LODs cut few edges, so bands with points can be metres apart; the wall is solid between.
        if (k2 - k) * BIN > GAP:
            continue
        (a, ua), (b, ub) = rows[k]
        (c, uc), (d, ud) = rows[k2]
        f = bm.faces.new((a, b, d, c))
        f.normal_update()
        if f.normal.x * outward < 0:
            f.normal_flip()
        if uv:
            lookup = {a: ua, b: ub, c: uc, d: ud}
            for loop in f.loops:
                loop[uv].uv = lookup[loop.vert]
        made += 1
    return made


src = bpy.ops.import_scene.gltf
bpy.ops.wm.read_factory_settings(use_empty=True)
src(filepath=P["source"])
lods = lod_objects()
for ob in lods:
    # Bake node transforms into the mesh so the cut planes are in the published model's own metres.
    ob.data.transform(ob.matrix_world)
    ob.matrix_world.identity()
    ob.parent = None

def decimated(source: bpy.types.Mesh, ratio: float, name: str) -> bpy.types.Object:
    """A lower LOD from the cut LOD0: weld first, then collapse with UV islands kept.

    Tripo meshes are split into UV islands. Decimating them unwelded (as the build's LODs were) simplifies
    each island's border on its own and opens hairline cracks between blocks that show the sky; welding
    first keeps the surface continuous, and the UV delimit keeps island borders (texture seams) in place.
    """
    mesh = source.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type, mod.ratio, mod.use_collapse_triangulate, mod.delimit = "COLLAPSE", ratio, True, {"UV"}
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
        if mesh.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    return ob


# The build's LOD ratios (triangles relative to LOD0), kept for the kit's own LODs.
lod_ratio = [1.0] + [len(ob.data.polygons) / max(1, len(lods[0].data.polygons)) for ob in lods[1:]]

for piece in P["pieces"]:
    made = []
    # LOD0 is cut from the source's LOD0 (Tripo's own surface, crack-free); lower LODs are re-derived from it.
    mesh = lods[0].data.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    caps = 0
    if piece.get("lo") is not None:
        cut(bm, piece["lo"], True)
        caps += cap(bm, piece["lo"], -1)
    if piece.get("hi") is not None:
        cut(bm, piece["hi"], False)
        caps += cap(bm, piece["hi"], 1)
    bm.to_mesh(mesh)
    bm.free()
    lod0 = bpy.data.objects.new(f"{piece['id']}_LOD0", mesh)
    bpy.context.scene.collection.objects.link(lod0)
    made.append(lod0)
    for n, ratio in enumerate(lod_ratio[1:], start=1):
        made.append(decimated(mesh, ratio, f"{piece['id']}_LOD{n}"))
    for n, ob in enumerate(made):
        RESULT["pieces"].append({"id": piece["id"], "lod": n, "tris": len(ob.data.polygons), "caps": caps if n == 0 else None})
    bpy.ops.object.select_all(action="DESELECT")
    for ob in made:
        ob.select_set(True)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    opts = dict(filepath=piece["out"], export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
                export_image_format=P["image_format"], export_animations=False, export_extras=True,
                export_cameras=False, export_lights=False,
                export_draco_mesh_compression_enable=P["draco"], export_draco_mesh_compression_level=6,
                export_draco_position_quantization=14, export_draco_normal_quantization=10,
                export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})
    for ob in made:
        bpy.data.objects.remove(ob)

open(P["result_path"], "w", encoding="utf-8").write(json.dumps(RESULT, ensure_ascii=False, indent=1))
