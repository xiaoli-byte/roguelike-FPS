"""Beauty turnaround of a built Tripo hero GLB (LOD0, bind pose, base-colour texture).

blender -b --python art/tools/review_tripo_hero.py -- <hero.glb> <out.png>

Renders front / three-quarter / side / back / three-quarter back with Workbench texture
shading and writes one contact sheet, used as review evidence by build_tripo_heroes.py.
"""
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

glb, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
for o in list(bpy.data.objects):
    if o.type == "MESH" and not o.name.endswith("LOD0"):
        bpy.data.objects.remove(o)
lod0 = next(o for o in bpy.data.objects if o.type == "MESH")
dg = bpy.context.evaluated_depsgraph_get()
V = np.array([lod0.matrix_world @ v.co for v in lod0.evaluated_get(dg).to_mesh().vertices])
lo, hi = V.min(0), V.max(0)
centre = Vector(((lo + hi) / 2).tolist())
size = float(max(hi[0] - lo[0], hi[2] - lo[2])) * 1.08
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "TEXTURE"
sc.display.shading.show_cavity = False
sc.render.resolution_x, sc.render.resolution_y = 420, 560
sc.world = bpy.data.worlds.new("w"); sc.world.color = (0.18, 0.19, 0.22)
cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = size
cam = bpy.data.objects.new("cam", cam_data); sc.collection.objects.link(cam); sc.camera = cam
tmp = Path(out).with_suffix(""); tmp.mkdir(parents=True, exist_ok=True)
tiles = []
for i, yaw in enumerate((0, 35, 90, 180, 215)):
    a = math.radians(yaw)
    d = Vector((math.sin(a), -math.cos(a), 0.12)).normalized()
    cam.location = centre + d * 6
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = str(tmp / f"{i}.png")
    bpy.ops.render.render(write_still=True)
    tiles.append(sc.render.filepath)
W, H = 420, 560
sheet = np.ones((H, W * len(tiles), 4), np.float32)
for c, path in enumerate(tiles):
    img = bpy.data.images.load(path)
    sheet[:, c * W:(c + 1) * W] = np.array(img.pixels[:], np.float32).reshape(H, W, 4)
    bpy.data.images.remove(img)
o = bpy.data.images.new("sheet", W * len(tiles), H, alpha=True)
o.pixels.foreach_set(sheet.ravel()); o.filepath_raw = out; o.file_format = "PNG"; o.save()
print("TURNAROUND", out)
