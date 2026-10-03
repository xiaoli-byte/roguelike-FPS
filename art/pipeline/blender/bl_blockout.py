"""白模四视图渲染：正交相机、平光、透明背景，同时写出每个视图的相机参数（像素 ↔ 世界坐标）。

这些相机参数是后续所有对齐工作的基准：概念重绘按这四格作画，投影贴图用同一组相机反投回模型。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import bpy  # noqa: E402
from bl_common import VIEW_ORDER, args, clear_scene, finish, import_glb, log, ortho_camera, set_render, view_params, world_bbox  # noqa: E402

P = args()
clear_scene()
objs = import_glb(P["blockout_glb"])
# 挂件（武器等）是独立资产，不进本资产的四视图；加法混合特效件、嵌套子节点里的件也不进，都不参与取景
hidden = [o for o in objs if o.name.split("_")[0] in ("attachment", "glowfx", "nested")]
for o in hidden:
    o.hide_render = True
objs = [o for o in objs if o not in hidden]
log(f"隐藏挂件 / 特效件 {len(hidden)} 个")
lo, hi = world_bbox(objs)

presentation = None
if P.get("presentation"):
    import numpy as np
    from mathutils import Matrix
    e = np.array(hi - lo)
    a0, a1, a2 = np.argsort(-e)  # 最长、居中、最短
    R = np.zeros((3, 3))
    R[2, a0] = R[0, a1] = R[1, a2] = 1.0  # 最长 → Z（竖直），居中 → X（画面横向），最短 → Y（朝相机的深度）
    if np.linalg.det(R) < 0:
        R[1] *= -1
    M = Matrix(R.tolist()).to_4x4()
    for o in [o for o in bpy.data.objects if o.parent is None]:
        o.matrix_world = M @ o.matrix_world
    bpy.context.view_layer.update()
    lo, hi = world_bbox(objs)
    presentation = R.tolist()
    log(f"展示姿态：轴 {a0}→Z {a1}→X {a2}→Y")
size = hi - lo
center = (lo + hi) / 2
log(f"白模包围盒 {tuple(round(x, 3) for x in size)} m")

pw, ph = P["panel"]
margin = P.get("margin", 1.12)
# 四个视图同一比例：高度和最宽的水平方向都要装得下
ortho = max(size.z * margin, max(size.x, size.y) * margin * ph / pw)

# 视口颜色取材质的基础色（glTF 导入后颜色在节点里，Workbench 读的是 diffuse_color）
for mat in bpy.data.materials:
    col = None
    if mat.node_tree:
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                col = n.inputs["Base Color"].default_value
                break
            if n.type in ("EMISSION", "RGB"):
                col = n.inputs[0].default_value if n.type == "EMISSION" else n.outputs[0].default_value
    if col is not None:
        mat.diffuse_color = (col[0], col[1], col[2], 1.0)

sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"
sh.color_type = "MATERIAL"
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.show_shadows = False
sh.show_object_outline = False
set_render(pw, ph, transparent=True)

out_dir = Path(P["out_dir"])
views = []
for v in VIEW_ORDER:
    cam = ortho_camera(f"cam_{v}", v, center, ortho)
    sc.camera = cam
    sc.render.filepath = str(out_dir / f"view_{v}.png")
    bpy.ops.render.render(write_still=True)
    views.append(view_params(v, center, ortho, pw, ph))
    log(f"渲染 {v}")

finish(P, {"views": views, "bbox_min": list(lo), "bbox_max": list(hi), "ortho_scale": ortho, "presentation": presentation})
