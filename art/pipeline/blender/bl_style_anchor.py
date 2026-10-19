"""已发布角色的三分之四视角渲染（灰底 #D6D6D6），给新角色设计稿当画风锚点（redesign_sheets.py 的 style_ref_images）。

参数：{"items": [{"asset": ID, "glb": path}], "out": 目录, "size": 边长}。每个资产一张 <ID>.png；只渲 LOD0，隐藏其余 LOD。
"""

import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bl_common import args, finish  # noqa: E402

LOD = re.compile(r"_LOD(\d+)$")


def main() -> None:
    p = args()
    out = Path(p["out"])
    out.mkdir(parents=True, exist_ok=True)
    done = []
    for item in p["items"]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=item["glb"])
        objs = [o for o in bpy.data.objects if o not in before]
        meshes = []
        for o in objs:
            if o.type != "MESH":
                continue
            m = LOD.search(o.name)
            if m and int(m.group(1)) > 0:
                o.hide_render = True
            else:
                meshes.append(o)
        bpy.context.view_layer.update()
        lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
        for o in meshes:
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                lo, hi = Vector(map(min, lo, w)), Vector(map(max, hi, w))
        center, size = (lo + hi) / 2, max(hi - lo)
        scene = bpy.context.scene
        engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
        scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
        scene.render.resolution_x = scene.render.resolution_y = p.get("size", 768)
        scene.view_settings.view_transform = "Standard"
        world = bpy.data.worlds.new("w")
        scene.world = world
        world.use_nodes = True
        bg = world.node_tree.nodes["Background"]
        bg.inputs[0].default_value = (0.672, 0.672, 0.672, 1)  # #D6D6D6 in linear
        bg.inputs[1].default_value = 1.0
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scene.collection.objects.link(cam)
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = size * 1.2
        d = Vector((0.8, -1.0, 0.35)).normalized() * size * 4  # 正面朝 -Y：从右前方略高处看
        cam.location = center + d
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        scene.collection.objects.link(sun)
        sun.data.energy = 2.2
        sun.rotation_euler = (math.radians(40), 0, math.radians(35))
        scene.render.filepath = str(out / f"{item['asset']}.png")
        bpy.ops.render.render(write_still=True)
        done.append(item["asset"])
    finish(p, {"rendered": done})


main()
