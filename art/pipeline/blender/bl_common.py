"""Blender 侧公共工具（在 Blender 自带的 Python 里运行）。

坐标约定：游戏 / glTF 是 Y 向上、角色朝 +Z；导入 Blender 后变成 Z 向上、角色朝 −Y。
四个标准视图（相机看向的方向 d、画面向右的方向 r，均为 Blender 坐标）：
  front  相机在角色正前方（−Y 侧）看向 +Y，画面右 = +X（角色的左手边）
  left   相机在角色左侧（+X 侧）看向 −X，画面右 = +Y（角色背后），角色面朝画面左
  back   相机在角色身后（+Y 侧）看向 −Y，画面右 = −X
  right  相机在角色右侧（−X 侧）看向 +X，画面右 = −Y，角色面朝画面右
"""

import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

VIEWS = {
    "front": (Vector((0, 1, 0)), Vector((1, 0, 0))),
    "left": (Vector((-1, 0, 0)), Vector((0, 1, 0))),
    "back": (Vector((0, -1, 0)), Vector((-1, 0, 0))),
    "right": (Vector((1, 0, 0)), Vector((0, -1, 0))),
}
VIEW_ORDER = ["front", "left", "back", "right"]
UP = Vector((0, 0, 1))


def log(msg: str) -> None:
    print(f"[art] {msg}", flush=True)


def args() -> dict:
    p = Path(sys.argv[sys.argv.index("--") + 1])
    return json.loads(p.read_text(encoding="utf-8"))


def finish(params: dict, result: dict) -> None:
    Path(params["result_path"]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str) -> list:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def world_bbox(objs) -> tuple[Vector, Vector]:
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


def ortho_camera(name: str, view: str, center: Vector, ortho_scale: float, distance: float = 20.0):
    d, r = VIEWS[view]
    cam_data = bpy.data.cameras.new(name)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_data.clip_start = 0.01
    cam_data.clip_end = distance * 4
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    # 相机 −Z 看向 d，+X 指向 r，+Y 指向上
    rot = Matrix((r, UP, -d)).transposed().to_4x4()
    cam.matrix_world = Matrix.Translation(center - d * distance) @ rot
    return cam


def view_params(view: str, center: Vector, ortho_scale: float, px_w: int, px_h: int) -> dict:
    """画面像素 ↔ 世界坐标的换算参数：像素 (x, y) 对应 center + r·(x/px_w − 0.5)·W + up·(0.5 − y/px_h)·H。"""
    d, r = VIEWS[view]
    h = ortho_scale if px_h >= px_w else ortho_scale * px_h / px_w
    w = h * px_w / px_h
    return {"view": view, "dir": list(d), "right": list(r), "up": list(UP), "center": list(center),
            "world_w": w, "world_h": h, "px_w": px_w, "px_h": px_h}


def set_render(width: int, height: int, transparent: bool = True) -> None:
    sc = bpy.context.scene
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
