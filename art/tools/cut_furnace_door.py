"""Cut the chest furnace door out of the 熔炉铁牛 (SK_Enemy_IronOx) Tripo mesh and hollow a furnace behind it (headless Blender).

    blender -b --factory-startup --python art/tools/cut_furnace_door.py -- <in.fbx> <out.fbx> <height_m> [review_dir]

Why: the roster asks for a hinged chest door that swings open while the ox inhales, with a white-hot furnace mouth
behind it. Tripo fused the bronze door medallion into the chest surface, so rotating a bone there would only stretch the
chest. This tool, working in the native build's frame (uniform scale to <height_m>, feet on z = 0, centred; front = -Y,
the creature's left = +X, up = +Z):

 1. selects the door: faces inside an ellipse on the chest front (x, z) that are bronze in the provider texture or stand
    proud of the chest, keeps the largest connected patch and fills pin-holes in it;
 2. splits it off as its own island, scales it 5 % about its centre (it covers its frame), moves it DOOR_PROUD forward
    and gives it a DOOR_THICK back (Solidify), so the opened door has a back face and a box can hold all of it without
    touching the chest;
 3. extrudes the hole rim CAVITY_DEPTH into the chest (tapering) and caps it: the furnace cavity. Its faces are mapped to
    the brightest glowing patch of the provider texture (the runtime adds the white-hot core and the light);
 4. writes the mesh (provider texture embedded, axes unchanged so build_tripo_creature.py treats it like the inbox
    original) and <out>.furnace.json: door hinge, door rigid boxes for the rig JSON (one per 4 cm x/z cell plus 8 mm boxes for stragglers, checked
    against every non-door vertex), the cavity centre / radius and the face counts. Optional review renders.

The inbox original is never modified (art/source/_tripo_inbox is the provider archive).
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, height = Path(argv[0]), Path(argv[1]), float(argv[2])
review = Path(argv[3]).resolve() if len(argv) > 3 else None

# Door ellipse on the chest front (metres, build frame), measured on the 2.4 m mesh: bronze disc x ±0.24, z 0.53–1.11 (the hinge bracket above it stays on the chest).
ELL_C = (0.0, 0.82)
ELL_R = (0.245, 0.285)
FRONT_Y = -0.70           # only the chest front
PROUD_Y = -0.88           # faces this far forward are door even if the texel reads dark (deep relief)
DOOR_SCALE = 1.05
DOOR_PROUD = 0.06
DOOR_THICK = 0.025
CAVITY_DEPTH = 0.30
CAVITY_TAPER = 0.72
CELL = 0.04

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(src))
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"expected one mesh, got {[m.name for m in meshes]}")
mesh = meshes[0]
for o in list(bpy.data.objects):
    if o.type == "ARMATURE":
        bpy.data.objects.remove(o)
# Bake the build frame into the mesh data (the build re-derives the same frame: height and bbox are unchanged).
for o in bpy.context.view_layer.objects:
    o.select_set(o is mesh)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
V = np.array([v.co[:] for v in mesh.data.vertices])
lo, hi = V.min(0), V.max(0)
s = height / (hi[2] - lo[2])
mesh.data.transform(Matrix.Translation(Vector((0, 0, 0))) @ Matrix.Scale(s, 4) @
                    Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
mesh.data.update()

# provider texture (base colour) for the bronze test
img = None
for slot in mesh.material_slots:
    if slot.material and slot.material.use_nodes:
        for n in slot.material.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                img = n.image
                break
    if img:
        break
if img is None:
    raise RuntimeError("no provider texture on the mesh")
W, H = img.size
px = np.empty(W * H * 4, np.float32)
img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)[:, :, :3]


def texel(u: float, v: float) -> np.ndarray:
    x = min(W - 1, max(0, int(u % 1.0 * W)))
    y = min(H - 1, max(0, int(v % 1.0 * H)))
    return px[y, x]


def bronze(c: np.ndarray) -> bool:
    mx, mn = float(c.max()), float(c.min())
    sat = (mx - mn) / mx if mx > 1e-4 else 0.0
    return mx > 0.16 and sat > 0.28 and c[0] >= c[1] >= c[2] * 0.9 and not (mx > 0.85 and sat > 0.75)


bm = bmesh.new()
bm.from_mesh(mesh.data)
bm.faces.ensure_lookup_table()
bm.verts.ensure_lookup_table()
uv = bm.loops.layers.uv.active
sel = set()
for f in bm.faces:
    c = f.calc_center_median()
    ex = (c.x - ELL_C[0]) / ELL_R[0]
    ez = (c.z - ELL_C[1]) / ELL_R[1]
    if ex * ex + ez * ez > 1 or c.y > FRONT_Y:
        continue
    u = sum(l[uv].uv.x for l in f.loops) / len(f.loops)
    v = sum(l[uv].uv.y for l in f.loops) / len(f.loops)
    if bronze(texel(u, v)) or c.y < PROUD_Y:
        sel.add(f)
# fill pin-holes: an ellipse face whose edge neighbours are mostly door is door
for _ in range(3):
    add = []
    for f in bm.faces:
        if f in sel:
            continue
        c = f.calc_center_median()
        ex = (c.x - ELL_C[0]) / ELL_R[0]
        ez = (c.z - ELL_C[1]) / ELL_R[1]
        if ex * ex + ez * ez > 1 or c.y > FRONT_Y:
            continue
        nb = [g for e in f.edges for g in e.link_faces if g is not f]
        if nb and sum(g in sel for g in nb) >= len(nb) - 1:
            add.append(f)
    sel.update(add)
# largest edge-connected patch
best: list = []
seen = set()
for f in sel:
    if f in seen:
        continue
    comp, stack = [], [f]
    seen.add(f)
    while stack:
        g = stack.pop()
        comp.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h in sel and h not in seen:
                    seen.add(h)
                    stack.append(h)
    if len(comp) > len(best):
        best = comp
door_faces = best
if len(door_faces) < 80:
    raise RuntimeError(f"door patch too small ({len(door_faces)} faces)")

# 2. split the door off: its own island
door_set = set(door_faces)
seam = [e for e in bm.edges if len(e.link_faces) == 2 and (e.link_faces[0] in door_set) != (e.link_faces[1] in door_set)]
dup = bmesh.ops.duplicate(bm, geom=door_faces)
new_door_faces = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
bmesh.ops.delete(bm, geom=door_faces, context="FACES")
door_faces = new_door_faces
door_set = set(door_faces)
door_verts = {v for f in door_faces for v in f.verts}
DV = np.array([v.co[:] for v in door_verts])
centre = Vector(DV.mean(0).tolist())
for v in door_verts:
    d = v.co - centre
    v.co = centre + d * DOOR_SCALE + Vector((0, -DOOR_PROUD, 0))

# 3. cavity: extrude the hole rim into the chest
rim = [e for e in seam if e.is_valid and e.is_boundary]
rim_verts = {v for e in rim for v in e.verts}
RV = np.array([v.co[:] for v in rim_verts])
hole_c = Vector(RV.mean(0).tolist())
ext = bmesh.ops.extrude_edge_only(bm, edges=rim)
new_verts = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
new_edges = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMEdge) and g.is_boundary]
wall_faces = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMFace)]
back_y = float(RV[:, 1].max()) + CAVITY_DEPTH
for v in new_verts:
    v.co.x = hole_c.x + (v.co.x - hole_c.x) * CAVITY_TAPER
    v.co.z = hole_c.z + (v.co.z - hole_c.z) * CAVITY_TAPER
    v.co.y = back_y
fill = bmesh.ops.holes_fill(bm, edges=new_edges, sides=0)
cap_faces = fill["faces"]
tri = bmesh.ops.triangulate(bm, faces=cap_faces)
cavity_faces = wall_faces + list(tri["faces"])
# point the cavity at the brightest glowing patch of the texture (block average, so mips stay bright)
B = 16
blocks = px[: H - H % B, : W - W % B].reshape(H // B, B, W // B, B, 3).mean((1, 3))
heat = blocks[:, :, 0] * 0.6 + blocks[:, :, 1] * 0.4 - blocks[:, :, 2] * 0.8
by, bx = np.unravel_index(int(np.argmax(heat)), heat.shape)
glow_uv = ((bx + 0.5) * B / W, (by + 0.5) * B / H)
for f in cavity_faces:
    for l in f.loops:
        l[uv].uv = glow_uv
    f.material_index = door_faces[0].material_index
# cavity normals face into the cavity (towards the viewer in front)
bmesh.ops.recalc_face_normals(bm, faces=cavity_faces)
for f in cavity_faces:
    if f.normal.y > 0.3:
        f.normal_flip()

bm.verts.index_update()
door_idx = {v.index for v in door_verts}
bm.to_mesh(mesh.data)
bm.free()
mesh.data.update()

# door solid: separate the door island, Solidify (back face + rim), join back
door_c = centre + Vector((0, -DOOR_PROUD, 0))
for v in mesh.data.vertices:
    v.select = v.index in door_idx
for e in mesh.data.edges:
    e.select = all(i in door_idx for i in e.vertices)
for p in mesh.data.polygons:
    p.select = all(i in door_idx for i in p.vertices)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
door_obj = next(o for o in bpy.data.objects if o.type == "MESH" and o is not mesh)
sol = door_obj.modifiers.new("solid", "SOLIDIFY")
sol.thickness = DOOR_THICK
sol.offset = -1.0
sol.use_rim = True
sol.use_even_offset = False
for o in bpy.context.view_layer.objects:
    o.select_set(o is door_obj)
bpy.context.view_layer.objects.active = door_obj
bpy.ops.object.modifier_apply(modifier="solid")
door_V = np.array([v.co[:] for v in door_obj.data.vertices])
door_tris = sum(len(p.vertices) - 2 for p in door_obj.data.polygons)
for o in bpy.context.view_layer.objects:
    o.select_set(o in (mesh, door_obj))
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()

# 4. door rigid boxes: one per CELL x CELL (x, z) cell, depth = the door's own depth there (+ 5 mm), checked
#    against every non-door vertex (the chest behind the door must stay on the chest bone)
allV = np.array([v.co[:] for v in mesh.data.vertices])
door_key = {tuple(np.round(p, 5)) for p in door_V}
is_door = np.array([tuple(np.round(p, 5)) in door_key for p in allV])
body_V = allV[~is_door]
boxes, conflicts = [], 0
x0, z0 = door_V[:, 0].min(), door_V[:, 2].min()
nx = int(math.ceil((door_V[:, 0].max() - x0) / CELL)) + 1
nz = int(math.ceil((door_V[:, 2].max() - z0) / CELL)) + 1
for i in range(nx):
    for k in range(nz):
        bx0, bz0 = x0 + i * CELL - 1e-4, z0 + k * CELL - 1e-4
        bx1, bz1 = bx0 + CELL + 2e-4, bz0 + CELL + 2e-4
        m = (door_V[:, 0] >= bx0) & (door_V[:, 0] <= bx1) & (door_V[:, 2] >= bz0) & (door_V[:, 2] <= bz1)
        if not m.any():
            continue
        y0, y1 = float(door_V[m, 1].min()) - 0.005, float(door_V[m, 1].max()) + 0.005
        bm_ = (body_V[:, 0] >= bx0) & (body_V[:, 0] <= bx1) & (body_V[:, 2] >= bz0) & (body_V[:, 2] <= bz1) \
            & (body_V[:, 1] >= y0) & (body_V[:, 1] <= y1)
        if bm_.any():
            # pull the back of the box in front of the nearest chest vertex
            y1 = float(body_V[bm_, 1].min()) - 0.002
            conflicts += 1
        boxes.append([[round(bx0, 4), round(y0, 4), round(bz0, 4)], [round(bx1, 4), round(y1, 4), round(bz1, 4)]])
# door vertices a trimmed cell box no longer holds get their own 8 mm box (if no chest vertex is in it)
uncovered = 0
inside = lambda p, b: b[0][0] <= p[0] <= b[1][0] and b[0][1] <= p[1] <= b[1][1] and b[0][2] <= p[2] <= b[1][2]
for p in door_V:
    if any(inside(p, b) for b in boxes):
        continue
    b = [[round(float(p[0]) - 0.004, 4), round(float(p[1]) - 0.004, 4), round(float(p[2]) - 0.004, 4)],
         [round(float(p[0]) + 0.004, 4), round(float(p[1]) + 0.004, 4), round(float(p[2]) + 0.004, 4)]]
    if any(inside(q, b) for q in body_V):
        uncovered += 1
        continue
    boxes.append(b)
top = door_V[door_V[:, 2] > door_V[:, 2].max() - 0.04]
hinge = [0.0, round(float(top[:, 1].mean()), 4), round(float(door_V[:, 2].max()), 4)]

dst.parent.mkdir(parents=True, exist_ok=True)
for o in bpy.context.view_layer.objects:
    o.select_set(o is mesh)
bpy.context.view_layer.objects.active = mesh
bpy.ops.export_scene.fbx(filepath=str(dst), use_selection=True, path_mode="COPY", embed_textures=True,
                         add_leaf_bones=False, bake_anim=False)
rep = {
    "source": src.name, "output": dst.name, "height_m": height,
    "door": {"faces_selected": len(best), "tris_after_solidify": door_tris, "verts": int(len(door_V)),
             "centre": [round(float(c), 4) for c in door_c], "hinge": hinge,
             "bounds": [[round(float(c), 4) for c in door_V.min(0)], [round(float(c), 4) for c in door_V.max(0)]],
             "boxes": boxes, "box_conflicts_trimmed": conflicts, "verts_outside_boxes": uncovered},
    "cavity": {"centre": [round(hole_c.x, 4), round((float(RV[:, 1].mean()) + back_y) / 2, 4), round(hole_c.z, 4)],
               "mouth_y": round(float(RV[:, 1].mean()), 4), "back_y": round(back_y, 4),
               "radius": round(float(np.linalg.norm(RV[:, [0, 2]] - [hole_c.x, hole_c.z], axis=1).mean()), 4),
               "faces": len(cavity_faces), "glow_uv": [round(glow_uv[0], 4), round(glow_uv[1], 4)]},
    "faces_after": len(mesh.data.polygons),
}
Path(str(dst) + ".furnace.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
print("FURNACE", json.dumps({k: v for k, v in rep["door"].items() if k != "boxes"}), json.dumps(rep["cavity"]))

if review:
    review.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 700
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1.3
    tgt = Vector((0, -0.85, 0.85))
    for name, d in {"door_front": (0, -1, 0.05), "door_side": (1, -0.25, 0.1), "door_low": (0.35, -1, -0.35)}.items():
        dv = Vector(d).normalized()
        cam.location = tgt + dv * 6
        cam.rotation_euler = (-dv).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(review / f"{name}.png")
        bpy.ops.render.render(write_still=True)
    # the door swung open about its hinge (front edge up): the cavity must read as a furnace mouth
    piv = Vector(hinge)
    rot = Matrix.Rotation(-1.45, 4, "X")
    for v, d in zip(mesh.data.vertices, is_door):
        if d:
            v.co = piv + rot @ (v.co - piv)
    mesh.data.update()
    for name, d in {"door_open_front": (0, -1, 0.05), "door_open_side": (1, -0.6, 0.25)}.items():
        dv = Vector(d).normalized()
        cam.location = tgt + dv * 6
        cam.rotation_euler = (-dv).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(review / f"{name}.png")
        bpy.ops.render.render(write_still=True)
