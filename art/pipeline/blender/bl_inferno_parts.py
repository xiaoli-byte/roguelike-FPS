"""Cut a published static asset into separately placeable parts (run by derive_inferno_parts.py inside Blender).

Used for the chapter-3 v2 kit (docs/art/ch3-kit.md): the parts that move, break or get placed on their own (hanging-forge
corner pillars, bellows bag, geyser crust, crane winch / hook) must not stay welded into the main mesh.

A part is either
  * a box in glTF asset space (metres, x = asset left/right, y up, z = front): the mesh is first bisected by the box's
    six planes (clean straight cuts), then every face whose centre lies inside the box goes to the part; or
  * a loose component of the mesh ("component": "top" / "bottom" / "largest"), for kits generated as separate pieces.
The remainder is the "rest" part. Every cut opening is closed with flat caps whose UVs take the rim's average UV
(one material, no new image), the same way bl_chest_parts.py closes the chest lid.

Each part is re-centred on its own origin ("base" = bottom centre, "center" = bounding-box centre); the origin's position
in the parent asset (glTF metres) is reported so a prefab / level builder can put the parts back together.

Params (JSON after --): {"source", "parts": [{"id", "out", "box": [[x0,y0,z0],[x1,y1,z1]] | "component": .. | "rest": true,
 "origin": "base"|"center"}], "lod_distance", "image_format", "draco", "result_path"}
Result: {"parts": [{"id", "tris", "origin_gltf", "bbox_min", "bbox_max"}]}
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Vector

P = json.loads(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8").read())
RESULT = {"parts": []}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P["source"])
src = next(ob for ob in bpy.data.objects if ob.type == "MESH" and ob.name.split(".")[0].endswith("_LOD0"))
src.data.transform(src.matrix_world)
src.matrix_world.identity()
src.parent = None


def g2b(p):  # glTF (x, y up, z front) -> Blender (x, -z, y)
    return Vector((p[0], -p[2], p[1]))


def b2g(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


PLANES = []  # (axis, value) of every cut plane, Blender space


def on_plane(v):
    return any(abs(v.co[a] - val) < 2e-3 for a, val in PLANES)


def cap(bm):
    """Close only the openings made by the cuts (boundary edges lying on a cut plane); seams already open in the
    provider mesh are left alone so no stray faces get stretched across them."""
    uv = bm.loops.layers.uv.active
    edges = [e for e in bm.edges if e.is_boundary and on_plane(e.verts[0]) and on_plane(e.verts[1])]
    if not edges:
        return 0
    rim = {}
    for e in edges:
        for v in e.verts:
            for lp in v.link_loops:
                rim.setdefault(v, []).append(lp[uv].uv.copy())
    faces = bmesh.ops.holes_fill(bm, edges=edges, sides=0)["faces"]
    for f in faces:
        us = [u for v in f.verts for u in rim.get(v, [])]
        avg = sum(us, Vector((0, 0))) / max(len(us), 1)
        for lp in f.loops:
            lp[uv].uv = avg
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    return len(faces)


# working copy: bisect by all part boxes once, so neighbouring parts share identical cut lines
work = bmesh.new()
work.from_mesh(src.data)
bmesh.ops.remove_doubles(work, verts=work.verts, dist=1e-3)
for p in P["parts"]:
    if "box" not in p:
        continue
    lo, hi = g2b(p["box"][0]), g2b(p["box"][1])
    lo, hi = Vector(map(min, lo, hi)), Vector(map(max, lo, hi))
    for axis in range(3):
        for value in (lo[axis], hi[axis]):
            no = Vector((0, 0, 0)); no[axis] = 1
            co = Vector((0, 0, 0)); co[axis] = value
            PLANES.append((axis, value))
            geom = work.verts[:] + work.edges[:] + work.faces[:]
            bmesh.ops.bisect_plane(work, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
work.faces.ensure_lookup_table()

owner = [None] * len(work.faces)  # part index per face
islands = None
for k, p in enumerate(P["parts"]):
    if "box" in p:
        lo, hi = g2b(p["box"][0]), g2b(p["box"][1])
        lo, hi = Vector(map(min, lo, hi)), Vector(map(max, lo, hi))
        for i, f in enumerate(work.faces):
            if owner[i] is None:
                c = f.calc_center_median()
                if all(lo[a] - 1e-4 <= c[a] <= hi[a] + 1e-4 for a in range(3)):
                    owner[i] = k
    elif "component" in p:
        if islands is None:
            # loose parts by face connectivity
            islands, seen = [], set()
            for f in work.faces:
                if f.index in seen:
                    continue
                stack, isl = [f], []
                seen.add(f.index)
                while stack:
                    g = stack.pop(); isl.append(g.index)
                    for e in g.edges:
                        for h in e.link_faces:
                            if h.index not in seen:
                                seen.add(h.index); stack.append(h)
                islands.append(isl)
            islands.sort(key=len, reverse=True)
            islands = [isl for isl in islands if len(isl) >= max(20, len(islands[0]) * 0.02)]
        def zc(isl):
            return sum(work.faces[i].calc_center_median().z for i in isl) / len(isl)
        mode = p["component"]
        cand = [isl for isl in islands if all(owner[i] is None for i in isl[:5])]
        isl = max(cand, key=zc) if mode == "top" else min(cand, key=zc) if mode == "bottom" else cand[0]
        for i in isl:
            owner[i] = k
rest = next((k for k, p in enumerate(P["parts"]) if p.get("rest")), None)
if rest is not None:
    owner = [rest if o is None else o for o in owner]


def export(ob, path):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    opts = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
                export_image_format=P["image_format"], export_animations=False, export_extras=True,
                export_cameras=False, export_lights=False,
                export_draco_mesh_compression_enable=P["draco"], export_draco_mesh_compression_level=6,
                export_draco_position_quantization=14, export_draco_normal_quantization=10,
                export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})


base_mesh = bpy.data.meshes.new("work")
work.to_mesh(base_mesh)
for m in src.data.materials:
    base_mesh.materials.append(m)
for k, p in enumerate(P["parts"]):
    keep = {i for i, o in enumerate(owner) if o == k}
    if not keep:
        raise RuntimeError(f"{p['id']}: no faces selected")
    bm = bmesh.new()
    bm.from_mesh(base_mesh)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
    caps = cap(bm)
    xs = [v.co for v in bm.verts]
    lo = Vector([min(c[a] for c in xs) for a in range(3)])
    hi = Vector([max(c[a] for c in xs) for a in range(3)])
    org = (lo + hi) / 2
    if p.get("origin", "base") == "base":
        org.z = lo.z
    for v in bm.verts:
        v.co -= org
    mesh = bpy.data.meshes.new(p["id"])
    bm.to_mesh(mesh)
    bm.free()
    for m in base_mesh.materials:
        mesh.materials.append(m)
    ob = bpy.data.objects.new(f"{p['id']}_LOD0", mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob["lod"] = 0
    ob["lod_distance"] = P["lod_distance"][0]
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        if mesh.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    export(ob, p["out"])
    RESULT["parts"].append({"id": p["id"], "tris": len(mesh.polygons), "caps": caps, "origin_gltf": b2g(org),
                            "bbox_min": b2g(Vector((lo.x - org.x, hi.y - org.y, lo.z - org.z))),
                            "bbox_max": b2g(Vector((hi.x - org.x, lo.y - org.y, hi.z - org.z)))})
    bpy.data.objects.remove(ob)
open(P["result_path"], "w", encoding="utf-8").write(json.dumps(RESULT, ensure_ascii=False, indent=1))
