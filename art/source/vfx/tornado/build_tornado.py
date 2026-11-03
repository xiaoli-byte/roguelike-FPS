import bpy
import math
import random
import json
from pathlib import Path
from mathutils import Vector

random.seed(29)
ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "unity/Assets/Art/VFX/Tornado"
OUT.mkdir(parents=True, exist_ok=True)
HEIGHT = 8.0
TOP_RADIUS = 2.2
BONES = 8
FRAMES = 120

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = FRAMES
scene.render.fps = 30


def material(name, color, texture=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = 0.35
    bsdf.inputs['Roughness'].default_value = 0.8
    if texture:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(OUT / 'T_VFX_WindRibbon.png'), check_existing=True)
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        mat.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.surface_render_method = 'DITHERED'
    return mat


wind_mat = material('M_VFX_Wind', (0.36, 0.72, 0.78), True)
cloud_mat = material('M_VFX_Cloud', (0.25, 0.47, 0.56))
ring_mat = material('M_VFX_GroundRing', (0.25, 0.62, 0.7), True)

arm_data = bpy.data.armatures.new('TornadoSkeleton')
arm = bpy.data.objects.new('TornadoRig', arm_data)
scene.collection.objects.link(arm)
arm.show_in_front = True
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for i in range(BONES):
    bone = arm_data.edit_bones.new(f'wind_{i:02d}')
    bone.head = (0, 0, HEIGHT * i / (BONES - 1))
    bone.tail = (0, 0, HEIGHT * (i + 0.55) / (BONES - 1))
    if i:
        bone.parent = arm_data.edit_bones[f'wind_{i - 1:02d}']
bpy.ops.object.mode_set(mode='OBJECT')


def bind(obj, weights):
    groups = [obj.vertex_groups.new(name=f'wind_{i:02d}') for i in range(BONES)]
    for v in obj.data.vertices:
        z = max(0, min(HEIGHT, v.co.z))
        x = z / HEIGHT * (BONES - 1)
        i = min(BONES - 2, int(x))
        blend = x - i
        groups[i].add([v.index], 1 - blend, 'REPLACE')
        groups[i + 1].add([v.index], blend, 'REPLACE')
    mod = obj.modifiers.new('Tornado skin', 'ARMATURE')
    mod.object = arm
    obj.parent = arm


def axis(u):
    return Vector((0.55 * u ** 1.65 + 0.16 * math.sin(u * 4.4) * u,
                   0.28 * math.sin(u * 3.2) * u, HEIGHT * u))


verts, faces, uv_values = [], [], []
SEG = 36
for band in range(72):
    start = 0.0 if band < 3 else random.uniform(0.02, 0.38)
    span = 1.0 if band < 3 else random.uniform(0.35, 0.9)
    base_angle = random.uniform(0, math.tau)
    twist = random.uniform(3.8, 6.2)
    radius_mul = random.uniform(0.85, 1.08)
    width_mul = random.uniform(0.65, 1.35)
    for i in range(SEG + 1):
        v = i / SEG
        u = min(1.0, start + span * v)
        angle = base_angle + u * twist
        radius = (0.16 + TOP_RADIUS * u ** 1.45) * radius_mul
        radial = Vector((math.sin(angle), math.cos(angle), 0))
        center = axis(u) + radial * radius
        width = (0.025 + 0.075 * u) * width_mul * math.sin(math.pi * v) ** 0.38
        lift = Vector((0, 0, width * 0.5)) + radial * width * 0.14
        for side in range(3):
            verts.append(center + lift * (1 - side))
            uv_values.append((side * 0.5, v))
    offset = band * (SEG + 1) * 3
    for i in range(SEG):
        for side in range(2):
            k = offset + i * 3 + side
            faces.append((k, k + 1, k + 4, k + 3))
            faces.append((k + 3, k + 4, k + 1, k))

mesh = bpy.data.meshes.new('TornadoFlowMesh')
mesh.from_pydata(verts, [], faces)
mesh.update()
flow = bpy.data.objects.new('TornadoFlow', mesh)
scene.collection.objects.link(flow)
flow.data.materials.append(wind_mat)
uv = mesh.uv_layers.new(name='WindUV')
for poly in mesh.polygons:
    for li in poly.loop_indices:
        uv.data[li].uv = uv_values[mesh.loops[li].vertex_index]
bind(flow, None)

for i in range(24):
    a = i / 24 * math.tau + random.uniform(-0.12, 0.12)
    r = random.uniform(1.55, 2.4)
    z = HEIGHT + random.uniform(-0.18, 0.35)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=(math.sin(a) * r + 0.5, math.cos(a) * r - 0.2, z))
    puff = bpy.context.object
    puff.name = f'TornadoCloud_{i:02d}'
    puff.scale = (random.uniform(0.18, 0.42), random.uniform(0.18, 0.42), random.uniform(0.08, 0.16))
    puff.data.materials.append(cloud_mat)
    for group in puff.vertex_groups:
        pass
    group = puff.vertex_groups.new(name=f'wind_{BONES - 1:02d}')
    group.add(list(range(len(puff.data.vertices))), 1.0, 'REPLACE')
    mod = puff.modifiers.new('Cloud skin', 'ARMATURE')
    mod.object = arm
    puff.parent = arm

ring_verts, ring_faces, ring_uv = [], [], []
for band, (radius, width, arc) in enumerate([(0.65, 0.035, 5.4), (1.2, 0.045, 5.8), (1.85, 0.03, 4.9)]):
    start = ring_verts.__len__()
    for i in range(65):
        v = i / 64
        a = band * 1.7 + v * arc
        for side in range(3):
            r = radius + (side - 1) * width + math.sin(a * 4.0 + band) * 0.045 + math.sin(a * 9.0) * 0.018
            ring_verts.append((math.sin(a) * r, math.cos(a) * r, 0.025 + band * 0.008))
            ring_uv.append((side * 0.5, v))
        if i == 64:
            continue
        k = start + i * 3
        ring_faces.extend([(k, k + 3, k + 4, k + 1), (k + 1, k + 4, k + 3, k), (k + 1, k + 4, k + 5, k + 2), (k + 2, k + 5, k + 4, k + 1)])
ring_mesh = bpy.data.meshes.new('TornadoGroundMesh')
ring_mesh.from_pydata(ring_verts, [], ring_faces)
ring_mesh.update()
ring = bpy.data.objects.new('TornadoGround', ring_mesh)
scene.collection.objects.link(ring)
ring.data.materials.append(ring_mat)
ruv = ring_mesh.uv_layers.new(name='GroundUV')
for poly in ring_mesh.polygons:
    for li in poly.loop_indices:
        ruv.data[li].uv = ring_uv[ring_mesh.loops[li].vertex_index]
group = ring.vertex_groups.new(name='wind_00')
group.add(list(range(len(ring.data.vertices))), 1.0, 'REPLACE')
mod = ring.modifiers.new('Ground skin', 'ARMATURE')
mod.object = arm
ring.parent = arm

arm.animation_data_create()
action = bpy.data.actions.new('TornadoLoop')
arm.animation_data.action = action
for frame in range(1, FRAMES + 1, 3):
    t = (frame - 1) / FRAMES
    for i, bone in enumerate(arm.pose.bones):
        k = i / (BONES - 1)
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (math.sin(t * math.tau + i * 0.55) * 0.055,
                               math.cos(t * math.tau + i * 0.4) * 0.065,
                               t * math.tau * (0.25 + k * 0.75))
        bone.location = (math.sin(t * math.tau + i * 0.45) * 0.07 * k,
                         math.cos(t * math.tau + i * 0.3) * 0.05 * k, 0)
        bone.keyframe_insert('rotation_euler', frame=frame)
        bone.keyframe_insert('location', frame=frame)
scene.frame_set(1)

world = bpy.data.worlds.new('TornadoWorld')
world.color = (0.015, 0.02, 0.035)
scene.world = world
bpy.ops.object.camera_add(location=(10, -16, 9))
camera = bpy.context.object
camera.rotation_euler = (Vector((0.25, 0, 4)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 48
scene.camera = camera
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.background_type = 'WORLD'
scene.render.resolution_x = 960
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(OUT / 'review_tornado.png')
bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/source/vfx/tornado/Tornado.blend'))
bpy.ops.export_scene.fbx(filepath=str(OUT / 'SK_VFX_Tornado.fbx'), use_selection=False,
                         object_types={'ARMATURE', 'MESH'}, add_leaf_bones=False, bake_anim=True,
                         path_mode='AUTO')
meta = {
    'height': HEIGHT, 'topRadius': TOP_RADIUS, 'bones': BONES, 'frames': FRAMES, 'fps': 30,
    'ribbons': 72, 'cloudPuffs': 24, 'groundRings': 3,
    'source': 'art/source/vfx/tornado/build_tornado.py',
}
(OUT / 'tornado-art.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
print('TORNADO_ASSET_COMPLETE', OUT)
