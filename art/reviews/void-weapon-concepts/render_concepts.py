import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

OUT = Path(__file__).resolve().parent


def rgba(value):
    value = value.lstrip('#')
    rgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c < 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb) + (1,)


def mat(name, color, metallic=0.0, roughness=0.65, emission=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = rgba(color)
    m.use_nodes = True
    bsdf = next(node for node in m.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = rgba(color)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = rgba(color)
        bsdf.inputs['Emission Strength'].default_value = emission
    return m


M = {}


def materials():
    specs = {
        'charcoal': ('252735', 0.35, 0.55),
        'navy': ('25354b', 0.4, 0.52),
        'indigo': ('303557', 0.25, 0.58),
        'obsidian': ('242331', 0.25, 0.47),
        'copper': ('9a6646', 0.7, 0.38),
        'gold': ('bda16a', 0.72, 0.36),
        'brass': ('c0ae84', 0.65, 0.4),
        'ivory': ('d5c9ab', 0.05, 0.72),
        'wood': ('482d35', 0.0, 0.78),
        'lacquer': ('272630', 0.05, 0.5),
        'celadon': ('6e9991', 0.0, 0.64),
        'purple': ('755086', 0.0, 0.58),
        'black': ('010104', 0.0, 1.0),
        'violet': ('b18aff', 0.0, 0.4),
        'violet_dim': ('67469d', 0.0, 0.5),
        'cyan': ('99c9e6', 0.0, 0.45),
    }
    for key, (color, metal, rough) in specs.items():
        M[key] = mat(key, color, metal, rough, 3.0 if key in {'violet', 'cyan'} else 1.1 if key == 'violet_dim' else 0)


def assign(obj, material):
    obj.data.materials.append(M[material] if isinstance(material, str) else material)
    return obj


def bevel(obj, width=0.06, segments=1):
    if width:
        mod = obj.modifiers.new('Broad edge bevels', 'BEVEL')
        mod.width = width
        mod.segments = segments
        mod.affect = 'EDGES'
        mod = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        mod.weight = 40
    return obj


def cube(name, loc, dims, material, bevel_width=0.06, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rot:
        obj.rotation_euler = rot
    assign(obj, material)
    bevel(obj, bevel_width)
    return obj


def cyl(name, loc, radius, depth, material, axis='X', vertices=16, bevel_width=0.035):
    rot = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, end_fill_type='NGON', location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    assign(obj, material)
    bevel(obj, bevel_width)
    return obj


def torus(name, loc, radius, tube, material, axis='X', rot_extra=None):
    rot = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    if rot_extra:
        rot = tuple(rot[i] + rot_extra[i] for i in range(3))
    bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=8, location=loc, rotation=rot, major_radius=radius, minor_radius=tube)
    obj = bpy.context.object
    obj.name = name
    assign(obj, material)
    return obj


def prism(name, profile, width, material, y=0, bevel_width=0.05):
    verts = [(x, y - width / 2, z) for x, z in profile] + [(x, y + width / 2, z) for x, z in profile]
    n = len(profile)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, material)
    bevel(obj, bevel_width)
    return obj


def beam(name, a, b, width, depth, material):
    a, b = Vector(a), Vector(b)
    obj = cube(name, (a + b) / 2, (width, depth, (b - a).length), material, min(width, depth) * 0.18)
    obj.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return obj


def stroke(name, points, radius, material):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 1
    data.bevel_depth = radius
    data.bevel_resolution = 1
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    assign(obj, material)
    return obj


def singularity(center, radius=0.55, cold=False):
    x, y, z = center
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=radius, location=center)
    obj = bpy.context.object
    obj.name = 'Absolute black singularity'
    assign(obj, 'black')
    glow = 'cyan' if cold else 'violet'
    for idx, (start, end, tilt, thick) in enumerate([(-0.35, 3.65, 0.16, 0.026), (2.75, 5.9, -0.2, 0.017)]):
        pts = []
        for i in range(45):
            a = start + (end - start) * i / 44
            rr = radius * (1.13 + 0.04 * math.sin(a * 3))
            pts.append((x + rr * math.cos(a) * tilt, y + rr * math.cos(a), z + rr * math.sin(a)))
        stroke(f'Accretion crescent {idx}', pts, thick, glow if idx == 0 else 'violet_dim')
    for i, a in enumerate((0.5, 2.4, 4.5)):
        pts = []
        for j in range(8):
            t = j / 7
            rr = radius * (1.65 - 0.42 * t)
            aa = a + 0.35 * t
            pts.append((x - 0.03, y + rr * math.cos(aa), z + rr * math.sin(aa)))
        stroke(f'Inward light streak {i}', pts, 0.011, 'violet_dim')


def screw(loc, material='copper', radius=0.09):
    return cyl('Large mechanical fastener', loc, radius, 0.06, material, 'Y', 8, 0.012)


def grip_and_trigger(x, z, material='wood'):
    prism('Angled pistol grip', [(x - 0.3, z + 0.45), (x + 0.28, z + 0.42), (x + 0.08, z - 0.75), (x - 0.52, z - 0.68)], 0.58, material, bevel_width=0.08)
    for i in range(4):
        cube('Broad grip wrap', (x - 0.17 + i * 0.035, -0.31, z - 0.43 + i * 0.22), (0.48, 0.07, 0.07), 'charcoal', 0.018, (0, -0.12, 0))
    stroke('Trigger guard', [(x + 0.12, -0.03, z + 0.3), (x + 0.65, -0.03, z + 0.23), (x + 0.7, -0.03, z - 0.2), (x + 0.15, -0.03, z - 0.24)], 0.045, 'charcoal')
    beam('Trigger', (x + 0.36, -0.03, z + 0.18), (x + 0.31, -0.03, z - 0.04), 0.06, 0.08, 'copper')


def build_a():
    cyl('Octagonal armoured receiver', (-0.35, 0, 1.85), 1.03, 3.25, 'charcoal', 'X', 8, 0.09)
    cube('Receiver side armour', (-0.35, -0.91, 1.87), (2.45, 0.16, 1.05), 'navy', 0.11)
    cube('Ivory forward armour block', (0.55, -1.015, 1.92), (0.65, 0.12, 0.82), 'ivory', 0.08)
    cube('Rear armour block', (-1.18, -1.01, 1.92), (0.55, 0.12, 0.84), 'indigo', 0.07)
    for x in (-1.45, 0.98):
        cyl('Copper receiver locking band', (x, 0, 1.85), 1.07, 0.18, 'copper', 'X', 8, 0.025)
    cyl('Containment collar', (1.43, 0, 1.85), 1.03, 0.34, 'copper', 'X', 12, 0.045)
    torus('Front containment rim', (1.68, 0, 1.85), 0.85, 0.13, 'charcoal')
    cube('Upper containment jaw', (2.05, 0, 2.77), (1.18, 0.82, 0.38), 'navy', 0.09)
    cube('Lower containment jaw', (2.05, 0, 0.93), (1.18, 0.82, 0.38), 'navy', 0.09)
    cube('Near containment jaw', (2.05, -0.91, 1.85), (1.18, 0.36, 0.95), 'charcoal', 0.08)
    cube('Far containment jaw', (2.05, 0.91, 1.85), (1.18, 0.36, 0.95), 'charcoal', 0.08)
    for z in (1.48, 1.85, 2.22):
        cube('Deep containment groove', (2.16, -1.105, z), (0.66, 0.035, 0.055), 'violet_dim', 0.015)
    singularity((2.23, 0, 1.85), 0.59)
    cube('Void-cell magazine', (-0.1, 0, 0.62), (0.88, 0.78, 1.15), 'indigo', 0.1, (0, -0.09, 0))
    cube('Magazine copper latch', (-0.1, -0.43, 0.78), (0.52, 0.08, 0.22), 'copper', 0.035)
    grip_and_trigger(-1.15, 0.78)
    cube('Stock spine', (-2.25, 0, 1.75), (1.25, 0.48, 0.42), 'charcoal', 0.07)
    prism('Short shoulder stock', [(-3.25, 2.15), (-2.48, 2.06), (-2.42, 1.4), (-3.2, 1.15)], 0.72, 'navy', bevel_width=0.09)
    cube('Stock butt pad', (-3.25, 0, 1.65), (0.18, 0.84, 1.12), 'wood', 0.07)
    for x in (-1.15, 0.4):
        screw((x, -1.115, 1.9), 'copper', 0.1)


def build_b():
    cube('Long indigo receiver', (-0.55, 0, 1.75), (3.6, 1.18, 1.28), 'indigo', 0.16)
    cube('Receiver lower keel', (-0.2, 0, 1.08), (2.65, 0.72, 0.34), 'navy', 0.07)
    for x in (-1.6, 0.35):
        cube('Antique gold receiver band', (x, 0, 1.75), (0.18, 1.28, 1.36), 'gold', 0.035)
    cube('Side enamel panel', (-0.6, -0.65, 1.78), (1.35, 0.12, 0.72), 'purple', 0.08)
    cyl('Winding side drum', (0.45, -0.88, 1.68), 0.55, 0.42, 'copper', 'Y', 16, 0.045)
    cyl('Winding drum face', (0.45, -1.12, 1.68), 0.39, 0.08, 'navy', 'Y', 12, 0.025)
    beam('Winding handle', (0.45, -1.18, 1.68), (0.83, -1.18, 1.3), 0.1, 0.1, 'gold')
    for i, (x, r) in enumerate(((1.25, 1.02), (1.85, 0.82), (2.4, 0.61))):
        torus(f'Thick armillary ring {i + 1}', (x, 0, 1.88), r, 0.115 if i == 0 else 0.095, 'gold' if i != 1 else 'brass')
        cube('Ring measuring block', (x, -r, 1.88), (0.24, 0.2, 0.34), 'indigo', 0.035)
        cube('Ring zenith block', (x, 0, 1.88 + r), (0.24, 0.34, 0.2), 'copper', 0.035)
    beam('Upper ring support', (0.65, 0, 2.25), (1.3, 0, 2.78), 0.22, 0.3, 'navy')
    beam('Lower ring support', (0.65, 0, 1.23), (1.3, 0, 0.98), 0.22, 0.3, 'navy')
    singularity((1.94, 0, 1.88), 0.48)
    grip_and_trigger(-1.25, 0.78, 'lacquer')
    cube('Compact stock', (-2.65, 0, 1.72), (1.05, 0.76, 0.9), 'navy', 0.13)
    cube('Stock butt', (-3.22, 0, 1.72), (0.2, 0.88, 1.1), 'wood', 0.06)
    screw((-0.65, -0.73, 1.8), 'gold', 0.11)


def build_c():
    prism('Heavy rear breech', [(-2.25, 2.35), (-0.35, 2.5), (0.45, 2.18), (0.45, 1.15), (-0.45, 0.98), (-2.2, 1.28)], 1.45, 'obsidian', bevel_width=0.12)
    cube('Breech side plate', (-1.05, -0.79, 1.77), (1.8, 0.16, 0.82), 'charcoal', 0.08)
    cyl('Rear locking ring', (-1.85, 0, 1.8), 0.94, 0.22, 'copper', 'X', 10, 0.035)
    prism('Upper obsidian demon jaw', [(0.0, 2.25), (0.85, 2.95), (2.5, 2.72), (3.02, 2.28), (2.72, 2.02), (1.0, 2.06)], 1.32, 'obsidian', bevel_width=0.09)
    prism('Lower obsidian demon jaw', [(0.0, 1.3), (1.0, 1.48), (2.72, 1.45), (3.0, 1.18), (2.35, 0.68), (0.75, 0.83)], 1.26, 'charcoal', bevel_width=0.09)
    for i, x in enumerate((0.95, 1.68, 2.36)):
        prism('Upper mineral locking fang', [(x - 0.24, 2.2), (x + 0.25, 2.18), (x + 0.06, 1.77 + 0.06 * (i % 2))], 0.64, 'ivory', y=-0.28, bevel_width=0.035)
        prism('Lower mineral locking fang', [(x - 0.24, 1.34), (x + 0.25, 1.36), (x + 0.04, 1.72 - 0.04 * (i % 2))], 0.62, 'ivory', y=-0.28, bevel_width=0.035)
    torus('Throat restraint ring', (1.25, 0, 1.78), 0.65, 0.1, 'copper')
    singularity((2.18, 0, 1.78), 0.53)
    grip_and_trigger(-1.25, 0.75, 'wood')
    cube('Short stock spine', (-2.65, 0, 1.67), (0.85, 0.55, 0.45), 'charcoal', 0.07)
    prism('Heavy short stock', [(-3.25, 2.05), (-2.72, 2.0), (-2.65, 1.25), (-3.18, 1.12)], 0.85, 'obsidian', bevel_width=0.08)
    for x in (-1.6, -0.55):
        screw((x, -0.9, 1.8), 'copper', 0.11)


def build_d():
    prism('Long lacquered receiver', [(-2.55, 2.0), (0.95, 2.02), (1.35, 1.78), (1.15, 1.25), (-2.45, 1.22)], 0.9, 'lacquer', bevel_width=0.1)
    cube('Navy receiver upper shell', (-0.55, 0, 2.02), (3.45, 0.82, 0.3), 'navy', 0.07)
    cube('Pale brass structural side rail', (-0.15, -0.52, 1.77), (3.6, 0.1, 0.13), 'brass', 0.025)
    cube('Celadon enamel inset', (-1.15, -0.51, 1.55), (1.05, 0.09, 0.3), 'celadon', 0.045)
    prism('Upper split-fork emitter', [(0.8, 2.08), (3.38, 2.15), (3.65, 1.98), (3.32, 1.8), (1.0, 1.83)], 0.48, 'navy', y=0, bevel_width=0.065)
    prism('Lower split-fork emitter', [(0.8, 1.24), (3.32, 1.25), (3.65, 1.1), (3.35, 0.91), (0.9, 0.98)], 0.48, 'navy', y=0, bevel_width=0.065)
    cube('Upper brass barrel channel', (2.15, -0.26, 2.02), (2.25, 0.055, 0.07), 'violet_dim', 0.018)
    cube('Lower brass barrel channel', (2.15, -0.26, 1.12), (2.25, 0.055, 0.07), 'brass', 0.018)
    cyl('Emitter root collar', (1.05, 0, 1.62), 0.69, 0.24, 'brass', 'X', 12, 0.035)
    singularity((2.92, 0, 1.53), 0.43, cold=True)
    cyl('Cylindrical vacuum magazine', (-0.85, 0, 0.82), 0.34, 1.35, 'copper', 'X', 12, 0.04)
    for x in (-1.4, -0.35):
        cyl('Vacuum magazine end cap', (x, 0, 0.82), 0.38, 0.14, 'charcoal', 'X', 12, 0.025)
    grip_and_trigger(-1.75, 0.72, 'lacquer')
    beam('Long stock spine', (-2.4, 0, 1.65), (-3.2, 0, 1.48), 0.3, 0.45, 'brass')
    prism('Slim precision stock', [(-3.9, 1.98), (-3.05, 1.86), (-2.9, 1.12), (-3.75, 0.98)], 0.66, 'lacquer', bevel_width=0.08)
    cube('Stock butt pad', (-3.88, 0, 1.48), (0.16, 0.75, 1.08), 'wood', 0.055)
    for x in (-1.9, 0.3):
        screw((x, -0.56, 1.76), 'brass', 0.075)


def setup_and_render(filename):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = False
    if hasattr(scene, 'eevee'):
        scene.eevee.taa_render_samples = 64
    world = bpy.data.worlds.new('Neutral warm-grey studio')
    world.use_nodes = True
    background = next(node for node in world.node_tree.nodes if node.type == 'BACKGROUND')
    background.inputs['Color'].default_value = rgba('c9c7c2')
    background.inputs['Strength'].default_value = 0.8
    scene.world = world
    for name, loc, energy, size, color in (
        ('Large soft key', (1, -5, 8), 1500, 7, (1.0, 0.93, 0.84)),
        ('Cool fill', (-4, -1, 4), 950, 6, (0.75, 0.84, 1.0)),
        ('Upper rim', (3, 4, 7), 1700, 5, (0.9, 0.88, 1.0)),
    ):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector((0, 0, 1.5)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    data = bpy.data.cameras.new('Concept orthographic camera')
    camera = bpy.data.objects.new('Concept orthographic camera', data)
    bpy.context.collection.objects.link(camera)
    camera.location = (6.5, -12, 6.2)
    target = Vector((0, 0, 1.45))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = 9.1
    data.lens = 50
    scene.camera = camera
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    scene.render.filepath = str(OUT / filename)
    bpy.ops.render.render(write_still=True)


def main():
    materials()
    for builder, filename in (
        (build_a, 'A-void-reliquary.png'),
        (build_b, 'B-ruin-orrery.png'),
        (build_c, 'C-devourer-maw.png'),
        (build_d, 'D-horizon-lance.png'),
    ):
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        for data in list(bpy.data.meshes):
            if data.users == 0:
                bpy.data.meshes.remove(data)
        builder()
        setup_and_render(filename)
        print(f'RENDERED {filename}', flush=True)


if __name__ == '__main__':
    main()
