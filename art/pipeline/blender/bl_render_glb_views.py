"""Render orthographic front / back / left / right views of a GLB for registration and review."""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

P = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
OUT = Path(P['out'])
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P['glb'])
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(corner) for o in meshes for corner in o.bound_box]
lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
center = (lo + hi) * 0.5
size = hi - lo

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = scene.render.resolution_y = P.get('resolution', 1024)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('Review World')
scene.world.color = (0.18, 0.18, 0.18)

cam_data = bpy.data.cameras.new('Review Camera')
cam = bpy.data.objects.new('Review Camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = 'ORTHO'
cam_data.ortho_scale = max(size.z, max(size.x, size.y) * 0.8) * 1.18
cam_data.clip_end = 1000

for name, loc, power, size_area in [('Key', (3, -4, 7), 900, 5), ('Fill', (-4, 1, 4), 650, 5), ('Rim', (1, 4, 6), 1000, 4)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = 'DISK'
    data.size = size_area
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector(center) - obj.location).to_track_quat('-Z', 'Y').to_euler()

views = P.get('views', {'front': (0, -1, 0), 'back': (0, 1, 0), 'left': (-1, 0, 0), 'right': (1, 0, 0)})
result = {}
for name, direction in views.items():
    cam.location = center + Vector(direction) * max(size) * 3
    cam.rotation_euler = (Vector(center) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    path = OUT / f'{name}.png'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    result[name] = str(path)

Path(P['result_path']).write_text(json.dumps({'views': result}, ensure_ascii=False, indent=2), encoding='utf-8')
