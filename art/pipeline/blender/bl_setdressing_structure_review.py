"""Read-only elevated/underside views of the actual three new GLBs, all three LODs.

Run Blender -b -t 4 --python this_file -- SM_Env_FrozenSkiff.
Does not create or modify any art geometry, UVs, textures or exports.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from bl_common import clear_scene, import_glb, set_render, world_bbox

asset_id = sys.argv[sys.argv.index("--") + 1]
assert asset_id in ("SM_Env_MarketStall", "SM_Env_FrozenSkiff", "SM_Env_SlagCart")
root = Path(__file__).resolve().parents[3]
source = root / "art/source/props" / asset_id
state = json.loads((source / "asset.json").read_text(encoding="utf-8"))
stage = state["stages"]["build"]
build = next(v for v in stage["versions"] if v["version"] == stage["current"])
glb = next(f["path"] for f in build["files"].values() if f["path"].endswith(".glb"))
out = root / "art/reviews/authored-scenes-setdressing-20261004" / f"{asset_id}-structure-v{build['version']:03d}"
out.mkdir(parents=True, exist_ok=True)
clear_scene()
objects = import_glb(str(source / glb))
meshes = sorted((o for o in objects if o.type == "MESH"), key=lambda o: o.name)
lo, hi = world_bbox(meshes)
center = (lo + hi) / 2
size = (hi - lo).length
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.world = bpy.data.worlds.new("Review world")
sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.2, 0.23, 0.27, 1)
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
for index, (position, energy) in enumerate((((4, -6, 7), 1700), ((-5, 2, 4), 1200), ((1, 2, -5), 900))):
    data = bpy.data.lights.new(f"Review light {index}", "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = 6
    light = bpy.data.objects.new(data.name, data)
    sc.collection.objects.link(light)
    light.location = center + Vector(position)
    light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
camera_data = bpy.data.cameras.new("Structure camera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = size * 1.06
camera = bpy.data.objects.new(camera_data.name, camera_data)
sc.collection.objects.link(camera)
sc.camera = camera
set_render(768, 768, False)
files = []
for lod, mesh in enumerate(meshes):
    for other in meshes:
        other.hide_render = other is not mesh
    for label, direction in (("elevated", (0.8, -1.1, 1.8)), ("underside", (0.8, -1.1, -0.9))):
        camera.location = center + Vector(direction).normalized() * size * 3
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        filepath = out / f"lod{lod}-{label}.png"
        sc.render.filepath = str(filepath)
        bpy.ops.render.render(write_still=True)
        files.append(str(filepath))
(out / "evidence.json").write_text(json.dumps({"asset": asset_id, "sourceGLB": str(source / glb), "buildVersion": build["version"], "files": files, "readOnlyGeometry": True}, indent=2), encoding="utf-8")
print(json.dumps({"out": str(out), "files": files}))
