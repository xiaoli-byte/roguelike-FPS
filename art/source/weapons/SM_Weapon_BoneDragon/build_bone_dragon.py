import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "art/source/weapons/SM_Weapon_BoneDragon"
EXPORT = OUT / "04_export"
REVIEW = OUT / "05_review"
for folder in (EXPORT, REVIEW):
    folder.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials):
    bpy.data.materials.remove(data)


def material(name, color, roughness=0.65, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    pbr = mat.node_tree.nodes.get("Principled BSDF")
    pbr.inputs["Base Color"].default_value = (*color, 1)
    pbr.inputs["Roughness"].default_value = roughness
    pbr.inputs["Metallic"].default_value = metallic
    return mat


IRON = material("M_BoneDragon_DarkIron", (0.055, 0.047, 0.068), 0.42, 0.65)
STEEL = material("M_BoneDragon_EdgeSteel", (0.105, 0.095, 0.13), 0.38, 0.72)
BLACK = material("M_BoneDragon_MuzzleBlack", (0.006, 0.005, 0.009), 0.82, 0.05)
WINE = material("M_BoneDragon_Oxblood", (0.19, 0.045, 0.062), 0.72, 0.05)
HORN = material("M_BoneDragon_Horn", (0.115, 0.055, 0.075), 0.58, 0.15)
BONE = [
    material("M_BoneDragon_Ivory", (0.76, 0.70, 0.58), 0.78),
    material("M_BoneDragon_IvoryLight", (0.86, 0.80, 0.68), 0.76),
    material("M_BoneDragon_IvoryShade", (0.61, 0.55, 0.45), 0.82),
]
BRASS = material("M_BoneDragon_Rivets", (0.24, 0.17, 0.10), 0.45, 0.7)


def empty(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    if parent:
        obj.parent = parent
    return obj


def keep_parent(obj, parent):
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


ROOT_OBJ = empty("SM_Weapon_BoneDragon_LOD0")
RIG_ROOT = empty("j_r", (0, 0, 0), ROOT_OBJ)
MUZZLE = empty("j_0", (0, -0.585, 0.28), RIG_ROOT)
UPPER = empty("Jaw_Upper_Pivot", (0, 0.13, 0.32), ROOT_OBJ)
LOWER = empty("Jaw_Lower_Pivot", (0, 0.13, 0.20), ROOT_OBJ)


def mesh_object(name, verts, faces, mat, parent=ROOT_OBJ):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    keep_parent(obj, parent)
    return obj


def bevel(obj, amount=0.012):
    mod = obj.modifiers.new("Broad single chamfer", "BEVEL")
    mod.width = amount
    mod.segments = 1
    mod.affect = "EDGES"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    return obj


def cube(name, location, scale, mat, parent=ROOT_OBJ, chamfer=0.012, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if chamfer:
        bevel(obj, chamfer)
    keep_parent(obj, parent)
    return obj


def cylinder(name, location, radius, depth, mat, parent=ROOT_OBJ, axis="Y", vertices=16, chamfer=0.006):
    rotation = (math.pi / 2, 0, 0) if axis == "Y" else ((0, math.pi / 2, 0) if axis == "X" else (0, 0, 0))
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, end_fill_type="NGON", location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if chamfer:
        bevel(obj, chamfer)
    keep_parent(obj, parent)
    return obj


def prism_x(name, polygon, x0, x1, mat, parent=ROOT_OBJ, chamfer=0.0):
    verts = [(x, y, z) for x in (x0, x1) for y, z in polygon]
    count = len(polygon)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    obj = mesh_object(name, verts, faces, mat, parent)
    if chamfer:
        bevel(obj, chamfer)
    return obj


def cone_between(name, start, end, radius, mat, parent=ROOT_OBJ, vertices=5):
    start, end = Vector(start), Vector(end)
    direction = end - start
    midpoint = (start + end) * 0.5
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0.002, depth=direction.length, location=midpoint)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    keep_parent(obj, parent)
    return obj


def horn(name, points, radii, mat, parent):
    sides = 7
    verts = []
    for i, (point, radius) in enumerate(zip(points, radii)):
        tangent = Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)])
        tangent.normalize()
        side = tangent.cross(Vector((1, 0, 0)))
        if side.length < 0.01:
            side = tangent.cross(Vector((0, 1, 0)))
        side.normalize()
        up = tangent.cross(side).normalized()
        for j in range(sides):
            angle = j / sides * math.tau
            pos = Vector(point) + radius * (side * math.cos(angle) + up * math.sin(angle))
            verts.append(tuple(pos))
    faces = []
    for i in range(len(points) - 1):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple((len(points) - 1) * sides + j for j in range(sides)))
    return mesh_object(name, verts, faces, mat, parent)


def ring_segment(name, center_y, center_z, inner, outer, depth, a0, a1, mat):
    steps = 3
    verts = []
    for y in (center_y - depth / 2, center_y + depth / 2):
        for radius in (inner, outer):
            for i in range(steps + 1):
                a = a0 + (a1 - a0) * i / steps
                verts.append((math.cos(a) * radius, y, center_z + math.sin(a) * radius))
    n = steps + 1
    faces = []
    for i in range(steps):
        faces += [
            (i, i + 1, n + i + 1, n + i),
            (2 * n + i, 3 * n + i, 3 * n + i + 1, 2 * n + i + 1),
            (i, 2 * n + i, 2 * n + i + 1, i + 1),
            (n + i, n + i + 1, 3 * n + i + 1, 3 * n + i),
        ]
    faces += [(0, n, 3 * n, 2 * n), (steps, 2 * n - 1, 4 * n - 1, 3 * n - 1)]
    return mesh_object(name, verts, faces, mat)


# Dark mechanical core: deliberately visible between the armour plates.
cube("Receiver_OctagonalCore", (0, -0.02, 0.27), (0.25, 0.66, 0.25), IRON, chamfer=0.035)
cube("Rear_Breech", (0, 0.29, 0.29), (0.23, 0.16, 0.22), STEEL, chamfer=0.025)
cylinder("Muzzle_InnerBarrel", (0, -0.43, 0.28), 0.133, 0.30, BLACK, vertices=24, chamfer=0.0)
cylinder("Muzzle_DarkThroat", (0, -0.585, 0.28), 0.116, 0.012, BLACK, vertices=24, chamfer=0.0)

# Segmented ivory muzzle crown, with real open bore.
for i in range(12):
    a0 = i / 12 * math.tau + 0.018
    a1 = (i + 1) / 12 * math.tau - 0.018
    ring_segment(f"Muzzle_BoneSegment_{i + 1:02d}", -0.52, 0.28, 0.128, 0.188 + (0.008 if i % 3 == 0 else 0), 0.12, a0, a1, BONE[i % 2])

# Cranial top ridge and layered cheek armour.
prism_x("Upper_CranialPlate", [(0.23, 0.39), (-0.10, 0.52), (-0.40, 0.44), (-0.48, 0.35), (-0.12, 0.37)], -0.105, 0.105, BONE[1], UPPER, 0.008)
prism_x("Upper_RearCrest", [(0.30, 0.37), (0.13, 0.56), (-0.05, 0.54), (-0.13, 0.43)], -0.085, 0.085, BONE[0], UPPER, 0.008)
for side in (-1, 1):
    x0, x1 = (side * 0.145, side * 0.185) if side > 0 else (side * 0.185, side * 0.145)
    prism_x(f"Upper_Cheek_{side}", [(0.18, 0.38), (-0.06, 0.43), (-0.40, 0.34), (-0.48, 0.25), (-0.17, 0.29), (0.10, 0.25)], x0, x1, BONE[0], UPPER, 0.006)
    prism_x(f"Lower_Jaw_{side}", [(0.12, 0.18), (-0.18, 0.12), (-0.47, 0.16), (-0.51, 0.23), (-0.18, 0.22), (0.08, 0.25)], x0, x1, BONE[2], LOWER, 0.006)
    prism_x(f"Lower_ChinBlade_{side}", [(-0.08, 0.12), (-0.40, 0.09), (-0.50, 0.15), (-0.25, 0.18)], side * 0.09, side * 0.125, BONE[0], LOWER, 0.004)

# Interlocking mechanical teeth: broad, sparse silhouettes rather than dense spikes.
for side in (-1, 1):
    for i in range(6):
        y = 0.08 - i * 0.085
        x = side * 0.122
        cone_between(f"Upper_Tooth_{side}_{i}", (x, y, 0.295), (x * 0.88, y - 0.025, 0.205), 0.032, BONE[(i + 1) % 2], UPPER, 4)
        cone_between(f"Lower_Tooth_{side}_{i}", (x, y - 0.035, 0.185), (x * 0.88, y - 0.055, 0.255), 0.028, BONE[i % 2], LOWER, 4)

# Two swept horns anchored in dark metal sockets.
for side in (-1, 1):
    cube(f"Horn_Socket_{side}", (side * 0.10, 0.02, 0.50), (0.105, 0.15, 0.11), STEEL, UPPER, 0.012, (0.0, side * 0.12, 0.0))
    horn(f"Swept_Horn_{side}", [
        (side * 0.105, 0.035, 0.53),
        (side * 0.13, 0.06, 0.62),
        (side * 0.15, 0.14, 0.69),
        (side * 0.16, 0.25, 0.72),
        (side * 0.17, 0.34, 0.70),
    ], [0.064, 0.060, 0.045, 0.027, 0.002], HORN, UPPER)

# Dual grips from the approved concept: top carry handle and lower horizontal grip.
for side in (-1, 1):
    cube(f"TopHandle_Post_{side}", (side * 0.105, 0.20, 0.50), (0.055, 0.075, 0.22), IRON, chamfer=0.012, rotation=(0.18, 0, 0))
cube("TopHandle_Bridge", (0, 0.20, 0.615), (0.25, 0.075, 0.06), STEEL, chamfer=0.014)
cylinder("TopHandle_Leather", (0, 0.20, 0.617), 0.039, 0.19, WINE, axis="X", vertices=12, chamfer=0.004)
for side in (-1, 1):
    cylinder(f"LowerGrip_Boss_{side}", (side * 0.15, 0.02, 0.105), 0.065, 0.055, STEEL, axis="X", vertices=12)
cylinder("LowerGrip_Leather", (0, 0.02, 0.105), 0.047, 0.27, WINE, axis="X", vertices=12, chamfer=0.006)
for i in range(7):
    cylinder(f"LowerGrip_Wrap_{i}", (-0.105 + i * 0.035, 0.02, 0.105), 0.049, 0.008, HORN, axis="X", vertices=12, chamfer=0.0)

# A few large fasteners, not micro-detail.
for side in (-1, 1):
    for y, z in ((0.24, 0.28), (-0.25, 0.26)):
        cylinder(f"Receiver_Rivet_{side}_{y}", (side * 0.145, y, z), 0.022, 0.018, BRASS, axis="X", vertices=8, chamfer=0.002)

# Neutral review setup.
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1400
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.world.color = (0.18, 0.18, 0.18)
scene.view_settings.view_transform = "AgX"


def area(name, location, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, -0.03, 0.28)) - obj.location).to_track_quat("-Z", "Y").to_euler()


area("Key_Softbox", (1.4, -1.5, 2.4), 220, 2.2, (1.0, 0.90, 0.78))
area("Fill_Softbox", (-1.6, -0.5, 1.1), 140, 2.0, (0.72, 0.82, 1.0))
area("Rim_Softbox", (0.4, 1.5, 1.8), 260, 1.8, (1.0, 0.82, 0.66))
camera_data = bpy.data.cameras.new("ReviewCamera")
camera = bpy.data.objects.new("ReviewCamera", camera_data)
bpy.context.collection.objects.link(camera)
scene.camera = camera
camera.data.type = "ORTHO"
camera.data.ortho_scale = 1.65


def aim_camera(location, target=(0, -0.02, 0.36), scale=1.65):
    camera.location = location
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = scale


def render(name):
    scene.render.filepath = str(REVIEW / name)
    bpy.ops.render.render(write_still=True)


def export(name):
    bpy.ops.object.select_all(action="DESELECT")
    ROOT_OBJ.select_set(True)
    for obj in ROOT_OBJ.children_recursive:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = ROOT_OBJ
    ROOT_OBJ.rotation_euler.z = math.pi
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(
        filepath=str(EXPORT / name),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    ROOT_OBJ.rotation_euler.z = 0
    bpy.context.view_layer.update()


aim_camera((1.25, -1.55, 1.05))
render("SM_Weapon_BoneDragon_closed.png")
export("SM_Weapon_BoneDragon_v001.glb")
UPPER.rotation_euler.x = math.radians(-24)
LOWER.rotation_euler.x = math.radians(20)
render("SM_Weapon_BoneDragon_open.png")
export("SM_Weapon_BoneDragon_open_v001.glb")
UPPER.rotation_euler.x = 0
LOWER.rotation_euler.x = 0

for name, location, target, scale in [
    ("front", (0, -2.2, 0.36), (0, -0.05, 0.36), 0.92),
    ("left", (-2.0, 0, 0.36), (0, -0.02, 0.36), 1.55),
    ("back", (0, 2.2, 0.36), (0, 0.05, 0.36), 0.92),
    ("right", (2.0, 0, 0.36), (0, -0.02, 0.36), 1.55),
]:
    aim_camera(location, target, scale)
    render(f"SM_Weapon_BoneDragon_{name}.png")

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "03_work/SM_Weapon_BoneDragon_v001.blend"))
triangles = sum(len(obj.data.polygons) for obj in ROOT_OBJ.children_recursive if obj.type == "MESH")
print(f"BONE_DRAGON_OK mesh_faces={triangles} objects={sum(obj.type == 'MESH' for obj in ROOT_OBJ.children_recursive)}")
