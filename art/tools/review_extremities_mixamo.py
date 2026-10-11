"""Mixamo-skeleton copy of review_extremities.py (Tripo heroes keep Mixamo bone names).

Identical framing and output; only the joint names differ: LeftHand/RightHand, LeftForeArm/RightForeArm,
LeftLeg/RightLeg (with the "mixamorig:" prefix). The original 13-joint tool is unchanged.

Close-up review of hands and feet for humanoid art (finger / toe count, fused digits, broken wrists).

blender -b --python art/tools/review_extremities_mixamo.py -- <build.glb> <out.png>

Takes LOD0 of a published-style GLB in its A-pose bind, finds both hands (most lateral geometry at
arm height) and both feet (lowest geometry), and renders each from front, back, outer side and top
with the base-colour texture, so a reviewer can count digits before an asset is approved.
"""
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

glb, out = (str(Path(p).resolve()) for p in sys.argv[sys.argv.index("--") + 1:][:2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
lod0 = next(o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("LOD0"))
for o in list(bpy.data.objects):
    if o.type == "MESH" and o is not lod0:
        bpy.data.objects.remove(o)
dg = bpy.context.evaluated_depsgraph_get()
ev = lod0.evaluated_get(dg)
V = np.array([ev.matrix_world @ v.co for v in ev.to_mesh().vertices])
H = V[:, 2].max() - V[:, 2].min()
z0 = V[:, 2].min()

regions = []
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
bones = {b.name: (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local) for b in arm.data.bones} if arm else {}
# v2 hero builds drop the "mixamorig:" prefix; index both spellings
bones.update({"mixamorig:" + k: v for k, v in list(bones.items()) if not k.startswith("mixamorig:")})
for label, hand, elbow in (("右手 R", "mixamorig:RightHand", "mixamorig:RightForeArm"), ("左手 L", "mixamorig:LeftHand", "mixamorig:LeftForeArm")):
    if hand in bones and elbow in bones:
        # Palm and digits lie beyond the wrist joint along the forearm direction.
        wrist = np.array(bones[hand][0]); fore = wrist - np.array(bones[elbow][0])
        fore /= np.linalg.norm(fore) + 1e-9
        along = (V - wrist) @ fore
        radial = np.linalg.norm((V - wrist) - along[:, None] * fore, axis=1)
        pts = V[(along > -0.02 * H) & (along < 0.14 * H) & (radial < 0.08 * H)]
    else:
        sign = -1 if label.endswith("R") else 1
        lateral = V[(V[:, 0] * sign) > 0]
        xmax = np.abs(lateral[:, 0]).max()
        pts = lateral[np.abs(lateral[:, 0]) > xmax - 0.09 * H]
    if len(pts):
        regions.append((label, pts))
for label, knee in (("右脚 R", "mixamorig:RightLeg"), ("左脚 L", "mixamorig:LeftLeg")):
    sign = -1 if label.endswith("R") else 1
    cx = np.array(bones[knee][0])[0] if knee in bones else None
    sel = (V[:, 2] < z0 + 0.075 * H) & ((V[:, 0] * sign) > 0)
    if cx is not None:
        sel &= np.abs(V[:, 0] - cx) < 0.12 * H
    if sel.any():
        regions.append((label, V[sel]))

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_cavity = True
scene.render.resolution_x = scene.render.resolution_y = 384
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.55, 0.55, 0.58)
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

views = {"front": Vector((0, -1, 0)), "back": Vector((0, 1, 0)), "side": None, "top": Vector((0, 0, 1))}
tiles = []
tmp = Path(out).with_suffix("")
tmp.mkdir(parents=True, exist_ok=True)
for name, pts in regions:
    lo, hi = pts.min(0), pts.max(0)
    centre = Vector(((lo + hi) / 2).tolist())
    size = float(max(hi - lo)) * 1.2 + 0.01
    row = []
    for view, d in views.items():
        if d is None:
            d = Vector((1 if centre.x > 0 else -1, 0, 0))
        cam.location = centre + d * 3.0
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = size
        path = tmp / f"{len(tiles)}_{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        row.append(path)
    tiles.append((name, row))

# Contact sheet (rows = hand/foot, columns = front/back/side/top) via Blender image pixels.
cell = 384
sheet = np.ones((cell * len(tiles), cell * 4, 4), np.float32)
for r, (_, row) in enumerate(tiles):
    for c, path in enumerate(row):
        img = bpy.data.images.load(str(path))
        px = np.array(img.pixels[:], np.float32).reshape(cell, cell, 4)
        sheet[(len(tiles) - 1 - r) * cell:(len(tiles) - r) * cell, c * cell:(c + 1) * cell] = px
        bpy.data.images.remove(img)
out_img = bpy.data.images.new("sheet", cell * 4, cell * len(tiles), alpha=True)
out_img.pixels.foreach_set(sheet.ravel())
out_img.filepath_raw = out
out_img.file_format = "PNG"
out_img.save()
print("EXTREMITIES", out, [n for n, _ in tiles])
