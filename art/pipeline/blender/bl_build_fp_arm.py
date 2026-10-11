"""First-person arm from a published hero (headless Blender): cut the forearm + hand out of the hero's own mesh, curl the
fingers into a grip, bake the pose, and place it in the Viewmodel socket frame (arm_r / arm_l, see src/weapons/Viewmodel.ts
buildArm). The FP arms then match the hero exactly (same sleeve, bracer, glove and fur) with no new generation.

Socket frame (game, metres): right arm — origin at the pistol grip, wrist W_t, elbow E_t = W_t + forearm direction × length,
thumb side t_t; the hero's wrist / elbow / thumb side are mapped onto these by one similarity transform.
Blender is Z-up / front -Y; the glTF exporter converts to the game's Y-up, so targets are given in game coordinates and
converted here: game (x, y, z) → Blender (x, -z, y).
"""
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
from bl_common import args, finish, log  # noqa: E402

P = args()
name = P["asset_id"]
S = "Right" if P["side"] == "R" else "Left"
T0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P["hero_glb"])
for o in list(bpy.data.objects):
    if o.type == "MESH" and not o.name.endswith("LOD0"):
        bpy.data.objects.remove(o, do_unlink=True)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
pb = {b.name.split(":", 1)[-1]: b for b in arm.pose.bones}


def head(n: str) -> Vector:
    return arm.matrix_world @ pb[n].head


# ── 1. grip pose: fingers curl about their own bend axis (local X), thumb wraps
bpy.context.view_layer.update()
# landmarks in the bind pose (before the fingers curl: a curled hand measures shorter)
W = head(f"{S}Hand")
E = head(f"{S}ForeArm")
tip = head(f"{S}HandMiddle4") if f"{S}HandMiddle4" in pb else head(f"{S}HandMiddle3")
thumb_side = head(f"{S}HandThumb2") - head(f"{S}HandMiddle1")   # before the armature is removed
knuckle = head(f"{S}HandPinky1") - head(f"{S}HandIndex1")      # index → pinky across the knuckles
distal = head(f"{S}HandMiddle1") - W                             # wrist → middle knuckle


def g2b(p):  # game (x, y, z) → Blender (x, -z, y)
    return Vector((p[0], -p[2], p[1]))


def frame(a: Vector, b: Vector) -> Matrix:
    a = a.normalized()
    b = (b - a * b.dot(a)).normalized()
    return Matrix((a, b, a.cross(b))).transposed()


# Final orientation of the hand (its own target frame) and of the forearm (socket direction, rolled as little as possible
# away from the hand): the wrist bend between them goes into the pose, so the skin blends it like a real wrist.
R_hand = frame(g2b(P["hand_distal"]), g2b(P["hand_knuckle"])) @ frame(distal, knuckle).inverted()
f_src = (E - W).normalized()
f_now = R_hand @ f_src
f_dst = (g2b(P["elbow"]) - g2b(P["wrist"])).normalized()
R_fore = f_now.rotation_difference(f_dst).to_matrix() @ R_hand
bend = (R_fore.inverted() @ R_hand)                               # world-space wrist rotation applied in the pose
hb = pb[f"{S}Hand"]
Mw = arm.matrix_world.to_3x3().normalized()
B = (Mw.inverted() @ bend @ Mw).to_4x4()                          # the same rotation in armature space
hb.matrix = Matrix.Translation(hb.head) @ B @ Matrix.Translation(-hb.head) @ hb.matrix
bpy.context.view_layer.update()
d_after = head(f"{S}HandMiddle1") - head(f"{S}Hand")
log(f"腕部自检：姿势后手指方向与预期差 {math.degrees(d_after.angle(bend @ distal)):.1f}°")
curl = P["curl"]                       # {"Index": [a1,a2,a3], ...}
sign = P.get("curl_sign", 1.0)
for f, angles in curl.items():
    for j, a in enumerate(angles, 1):
        b = pb.get(f"{S}Hand{f}{j}")
        if b:
            b.rotation_mode = "XYZ"
            b.rotation_euler[0] += math.radians(a) * sign
bpy.context.view_layer.update()
tip_after = head(f"{S}HandMiddle4") if f"{S}HandMiddle4" in pb else head(f"{S}HandMiddle3")
log(f"手指自检：中指尖到手腕 {(tip - W).length:.3f} → {(tip_after - head(f'{S}Hand')).length:.3f}（变短 = 向掌心弯）")

# ── 2. bake the posed mesh, keep forearm + hand
dg = bpy.context.evaluated_depsgraph_get()
ev = mesh.evaluated_get(dg)
baked = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
groups = {g.index: g.name.split(":", 1)[-1] for g in mesh.vertex_groups}
keep_bones = {f"{S}ForeArm", f"{S}Hand"} | {n for n in pb if n.startswith(f"{S}Hand")}
src = mesh.data
co = np.array([mesh.matrix_world @ v.co for v in baked.vertices])
dom = []
for v in src.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom.append(groups[best.group] if best else "")
axis = (W - E).normalized()
Lf = (W - E).length
ax = np.array(axis)
rel = co - np.array(E)
t = rel @ ax
radial = np.linalg.norm(rel - np.outer(t, ax), axis=1)
H = float(co[:, 2].max() - co[:, 2].min())
keep = np.array([d in keep_bones for d in dom]) & (t > -P.get("behind_elbow", 0.08) * Lf) & (radial < P.get("max_radius", 0.09) * H)
keep |= np.array([d == f"{S}Arm" for d in dom]) & (t > -P.get("behind_elbow", 0.08) * Lf) & (radial < P.get("max_radius", 0.09) * H)
log(f"保留 {int(keep.sum())} / {len(keep)} 顶点")

part = bpy.data.objects.new(f"{name}_LOD0", baked)
bpy.context.scene.collection.objects.link(part)
part.matrix_world = Matrix.Identity(4)
for i, v in enumerate(baked.vertices):
    v.co = Vector(co[i])
import bmesh  # noqa: E402
bm = bmesh.new()
bm.from_mesh(baked)
bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(~keep)[0]], context="VERTS")
bm.to_mesh(baked)
bm.free()
bpy.data.objects.remove(mesh, do_unlink=True)
bpy.data.objects.remove(arm, do_unlink=True)


# ── 3. similarity transform: forearm onto the socket direction, wrist onto the socket wrist, scaled by the hand
Wt = g2b(P["wrist"])
# scale by the hand (wrist → middle fingertip), not the forearm: chibi heroes have short forearms and big hands, and the
# hand is what has to fit the gun grip; the forearm keeps the socket's direction and runs off-screen behind the hand
k = P["hand_len"] / (tip - W).length
k = min(max(k, P.get("scale_min", 0.35)), P.get("scale_max", 1.6))
# chibi forearms are short: once the hand is fitted to the grip, the cut sleeve end sits inside the first-person frame.
# Stretch everything behind the wrist along the forearm axis so the cut runs off-screen (the eye reads it as a sleeve).
stretch = P.get("forearm_stretch", 1.0)
for v in baked.vertices:
    d = v.co - W
    along = d.dot(f_src)
    if along > 0:
        # slim: pull the forearm toward its own axis (big armour plates otherwise fill the screen when the arm swings
        # up during a reload); full slimming from 0.12 × forearm length behind the wrist, none at the wrist
        slim = P.get("forearm_slim", 1.0)
        if slim != 1.0:
            radial = d - f_src * along
            k_s = 1 - (1 - slim) * min(1.0, along / (0.12 * Lf))
            d = f_src * along + radial * k_s
        d = d + f_src * along * (stretch - 1)
    v.co = Wt + (R_fore @ d) * k
baked.update()
log(f"缩放 {k:.3f}，腕部弯折 {math.degrees(bend.to_quaternion().angle):.0f}°")

# ── 4. material (hero base colour, resized) + LODs
mat = baked.materials[0]
mat.name = f"M_{name.split('_', 1)[1]}"
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
for slot in ("Base Color",):
    lk = bsdf.inputs[slot].links
    if lk and lk[0].from_node.type == "TEX_IMAGE":
        img = lk[0].from_node.image
        img.scale(int(P["texture"]), int(P["texture"]))
        img.name = f"T_{name.split('_', 1)[1]}_BC"
for key in ("Normal",):
    for l in list(bsdf.inputs[key].links):
        mat.node_tree.links.remove(l)
lods = [part]
for i, budget in enumerate(P["lod_tris"]):
    o = part
    if i:
        o = part.copy()
        o.data = part.data.copy()
        o.name = f"{name}_LOD{i}"
        bpy.context.scene.collection.objects.link(o)
        lods.append(o)
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris > budget:
        d = o.modifiers.new("dec", "DECIMATE")
        d.ratio = budget / tris * 0.98
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="dec")
lod_tris = [sum(len(p.vertices) - 2 for p in o.data.polygons) for o in lods]

# ── 5. review render (hand close-up from the camera's side) + export
if P.get("review_png"):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 600
    scene.world = bpy.data.worlds.new("w")
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 0.55
    # the first-person camera sits behind the grip (+game Z) looking at -Z: Blender (0, +y? ) → game +Z = Blender -Y
    for i, (dirv, label) in enumerate(((Vector((0.15, -1, 0.25)), "fp"), (Vector((1, 0, 0)), "side"))):
        cam.location = Vector((0.06, -0.15, -0.06)) + dirv.normalized() * 2
        cam.rotation_euler = (-dirv).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = P["review_png"].replace(".png", f"_{label}.png")
        bpy.ops.render.render(write_still=True)
bpy.ops.object.select_all(action="DESELECT")
for o in lods:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=P["out_glb"], export_format="GLB", use_selection=True, export_apply=True,
                          export_image_format="WEBP", export_draco_mesh_compression_enable=True, export_yup=True)
finish(P, {"lod_tris": lod_tris, "scale": k, "kept_verts": int(keep.sum()), "seconds": round(time.time() - T0, 1)})
