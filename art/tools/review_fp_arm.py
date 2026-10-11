"""First-person arm fit check: the gun GLB and an FP arm GLB in the same socket frame (gun origin = grip top, game axes).

    blender -b --python art/tools/review_fp_arm.py -- <gun.glb> <arm_r.glb> <out.png> [<arm_l.glb> lx ly lz]

Renders from behind (the first-person camera's side), from the right and from above, side by side via three files
<out>_back.png / _right.png / _top.png. The left arm is placed at the given support point (game coordinates).
"""
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
gun, arm_r, out = argv[:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
for path in (gun, arm_r):
    bpy.ops.import_scene.gltf(filepath=path)
if len(argv) >= 7:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=argv[3])
    lx, ly, lz = map(float, argv[4:7])
    for o in set(bpy.data.objects) - before:
        if o.parent is None:
            o.location += Vector((lx, -lz, ly))          # game (x, y, z) → Blender (x, -z, y)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.name.endswith(("_LOD1", "_LOD2")):
        bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = scene.render.resolution_y = 560
scene.world = bpy.data.worlds.new("w")
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = 0.62
centre = Vector((0.0, 0.05, -0.08))                       # Blender coords around the grip
views = {"back": Vector((0.25, -1, 0.35)), "right": Vector((1, 0, 0.1)), "top": Vector((0, -0.05, 1))}
for name, d in views.items():
    cam.location = centre + d.normalized() * 3
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(Path(out).with_name(Path(out).stem + f"_{name}.png"))
    bpy.ops.render.render(write_still=True)
