"""Remove stray sliver shells from a Tripo FBX (headless Blender) and write a trimmed copy for the native creature build.

    blender -b --factory-startup --python art/tools/trim_tripo_islands.py -- <in.fbx> <out.fbx> [max_faces] [min_edge_m] [height_m]

Tripo smart meshes sometimes carry loose "rope" strands from the concept: separate mesh islands of a few long, needle-thin
triangles floating around the model (玄冰巨蟹: eight strands up to 1.7 m long between the back pole and the claws). They
are not part of the form, render as grey slivers and widen the bounds. An island is removed when it has at most
`max_faces` faces (default 10) AND its longest edge is longer than `min_edge_m` (default 0.2 m, measured after uniform
scaling to `height_m`, the rig's design height). Everything else (posts, barnacles, ice spikes) is kept untouched; the
mesh, UVs and the embedded provider texture are written back unchanged (same axes, so build_tripo_creature.py treats the
copy exactly like the inbox original). A JSON report lands next to the output (<out>.trim.json).

The inbox original is never modified (art/source/_tripo_inbox is the provider archive).
"""
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = Path(argv[0]), Path(argv[1])
max_faces = int(argv[2]) if len(argv) > 2 else 10
min_edge = float(argv[3]) if len(argv) > 3 else 0.2
height = float(argv[4]) if len(argv) > 4 else 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(src))
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"expected one mesh, got {[m.name for m in meshes]}")
mesh = meshes[0]
mw = mesh.matrix_world.copy()
V = np.array([mw @ v.co for v in mesh.data.vertices])
scale = height / float(V[:, 2].max() - V[:, 2].min()) if height > 0 else 1.0

bm = bmesh.new()
bm.from_mesh(mesh.data)
bm.verts.ensure_lookup_table()
# islands by face connectivity (union-find over edges)
parent = list(range(len(bm.verts)))


def find(i: int) -> int:
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


for e in bm.edges:
    a, b = find(e.verts[0].index), find(e.verts[1].index)
    if a != b:
        parent[a] = b
islands: dict[int, list] = {}
for f in bm.faces:
    islands.setdefault(find(f.verts[0].index), []).append(f)
removed = []
drop = []
for root, faces in islands.items():
    if len(faces) > max_faces:
        continue
    longest = max((mw.to_3x3() @ (e.verts[0].co - e.verts[1].co)).length for f in faces for e in f.edges) * scale
    if longest <= min_edge:
        continue
    pts = np.array([mw @ v.co for f in faces for v in f.verts]) * scale
    removed.append({"faces": len(faces), "longest_edge_m": round(longest, 3),
                    "centre_m": [round(float(x), 3) for x in pts.mean(0)]})
    drop += faces
bmesh.ops.delete(bm, geom=drop, context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(mesh.data)
bm.free()
mesh.data.update()

dst.parent.mkdir(parents=True, exist_ok=True)
for o in bpy.context.view_layer.objects:
    o.select_set(o is mesh)
bpy.context.view_layer.objects.active = mesh
bpy.ops.export_scene.fbx(filepath=str(dst), use_selection=True, path_mode="COPY", embed_textures=True,
                         add_leaf_bones=False, bake_anim=False)
report = {"source": src.name, "output": dst.name, "max_faces": max_faces, "min_edge_m": min_edge, "height_m": height,
          "islands_before": len(islands), "removed": removed,
          "faces_after": len(mesh.data.polygons)}
Path(str(dst) + ".trim.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print("TRIM", json.dumps({"removed": len(removed), "faces_after": report["faces_after"]}))
