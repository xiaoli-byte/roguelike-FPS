"""变脸傩巫源网格的 UV 收边（headless Blender，不花 Tripo 额度）。

    blender -b --factory-startup --python art/tools/nuo_uv_clamp.py

Tripo 智能网格的 UV 有几个岛贴着图集边（u / v ≈ 0.001）。build_tripo_creature 做 LOD1 / LOD2 的塌缩减面时，
UV 会被外插到 -0.002，LOD 校验（UV 必须在 0..1 内）就不过。本脚本只把离图集边不到 MARGIN 的 UV 坐标夹回到
[MARGIN, 1 - MARGIN]（不缩放、不挪动其它 UV；被夹的只是图集最外圈约 16 个源贴图像素，看不出来），网格和贴图原样保留。

输入：art/source/_tripo_inbox/20261011T150540_SK_Enemy_Nuo_smartmesh.fbx（只读，不改动）。
输出（art/source/characters/SK_Enemy_Nuo/02_highpoly/）：
  SK_Enemy_Nuo_uvclamp_v001.fbx  编辑后的源网格（已按 build 的规则缩放落地：1.8 米高、包围盒居中，build 再归一化时缩放 = 1）
  SK_Enemy_Nuo_uvclamp_v001.json 统计（夹了多少个 UV）
"""
import json
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art/source/_tripo_inbox/20261011T150540_SK_Enemy_Nuo_smartmesh.fbx"
OUT_DIR = ROOT / "art/source/characters/SK_Enemy_Nuo/02_highpoly"
STEM = "SK_Enemy_Nuo_uvclamp_v001"
HEIGHT = 1.8
MARGIN = 0.004

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(SRC))
for o in list(bpy.data.objects):
    if o.type == "ARMATURE":
        bpy.data.objects.remove(o, do_unlink=True)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
for o in bpy.context.view_layer.objects:
    o.select_set(False)
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
V = np.array([v.co[:] for v in mesh.data.vertices])
lo, hi = V.min(0), V.max(0)
s = HEIGHT / (hi[2] - lo[2])
mesh.location = Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])) * s
mesh.scale = (s, s, s)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

uv = mesh.data.uv_layers.active.data
co = np.zeros(len(uv) * 2)
uv.foreach_get("uv", co)
before = (co.min(), co.max())
clamped = int(((co < MARGIN) | (co > 1 - MARGIN)).sum())
co = np.clip(co, MARGIN, 1 - MARGIN)
uv.foreach_set("uv", co)
mesh.data.update()

OUT_DIR.mkdir(parents=True, exist_ok=True)
mesh.name = "SK_Enemy_Nuo_uvclamp"
bpy.ops.export_scene.fbx(filepath=str(OUT_DIR / f"{STEM}.fbx"), use_selection=False, object_types={"MESH"},
                         path_mode="COPY", embed_textures=True, mesh_smooth_type="OFF", use_mesh_modifiers=False,
                         add_leaf_bones=False, bake_anim=False)
info = {"source": str(SRC.relative_to(ROOT)).replace("\\", "/"), "margin": MARGIN, "clamped_uv_coords": clamped,
        "uv_range_before": [float(before[0]), float(before[1])], "scale": s}
(OUT_DIR / f"{STEM}.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
print("[art] UV 收边", json.dumps(info, ensure_ascii=False))
