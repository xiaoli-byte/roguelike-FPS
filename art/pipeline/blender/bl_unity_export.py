"""发布 GLB → Unity FBX（在 Blender 里运行，由 unity_export.py 调用）。

做三件事：
1. 导入发布的 GLB（含 Draco / WebP），网格、骨骼、LOD 节点名原样保留；
2. 人形资产（params.humanoid 给出 Unity 人形骨骼映射）把双臂摆成 T-pose 并设为新的绑定姿势：
   Unity Humanoid 以 T-pose 为肌肉空间的参考，A-pose 绑定会让重定向来的动画手臂整体偏低；
3. 导出 FBX（不嵌贴图、不带材质贴图路径、不加叶骨骼），并回报每个网格的面数、材质槽、LOD 序号。

坐标：Blender 里角色朝 −Y、Z 向上；FBX 用默认的 −Z 前 / Y 上，Unity 端打开 bakeAxisConversion。轴向参数只改文件里的坐标系声明，Unity 会按声明换算回来，换哪组参数角色都朝 Unity −Z；所以导出前把顶层物体绕 Z 转 180°（不应用到数据，只写在根节点上），
导入后角色朝 +Z、Y 向上、1 单位 = 1 米，与游戏 / glTF 一致（X 轴随左右手系翻转）。
"""

import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bl_common import args, clear_scene, finish, import_glb, log  # noqa: E402

LOD_RE = re.compile(r"_LOD(\d+)$")


def bone_world_head(arm_obj, name: str) -> Vector:
    return arm_obj.matrix_world @ arm_obj.pose.bones[name].head


def rotate_bone_to(arm_obj, bone: str, child: str, target: Vector) -> float:
    """把 bone 绕自身头部旋转，让 bone→child 的方向对齐 target（世界方向），返回旋转角（度）。"""
    pb = arm_obj.pose.bones[bone]
    cur = bone_world_head(arm_obj, child) - bone_world_head(arm_obj, bone)
    if cur.length < 1e-6:
        return 0.0
    rot = cur.normalized().rotation_difference(target.normalized())
    angle = math.degrees(rot.angle)
    # 世界旋转换到骨架空间（骨架物体本身可能带旋转 / 缩放）
    to_arm = arm_obj.matrix_world.inverted()
    head = pb.head.copy()
    r_arm = (to_arm.to_3x3() @ rot.to_matrix() @ arm_obj.matrix_world.to_3x3()).to_4x4()
    pb.matrix = Matrix.Translation(head) @ r_arm @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()
    return angle


def apply_tpose(arm_obj, meshes, chains: dict) -> dict:
    """chains = {"L": [upper, lower, hand], "R": [...]}；角色左侧在 Blender +X。"""
    report = {}
    for side, (upper, lower, hand) in chains.items():
        cur = bone_world_head(arm_obj, lower) - bone_world_head(arm_obj, upper)
        sign = 1.0 if cur.x >= 0 else -1.0
        target = Vector((sign, 0.0, 0.0))
        before = math.degrees(math.atan2(-cur.z, abs(cur.x))) if cur.length > 1e-6 else 0.0
        a1 = rotate_bone_to(arm_obj, upper, lower, target)
        a2 = rotate_bone_to(arm_obj, lower, hand, target)
        report[side] = {"upper_drop_deg": round(before, 2), "upper_rot_deg": round(a1, 2), "lower_rot_deg": round(a2, 2)}
    if all(abs(r["upper_rot_deg"]) < 2 and abs(r["lower_rot_deg"]) < 2 for r in report.values()):
        for pb in arm_obj.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        report["applied"] = False
        return report

    # 网格先按当前姿势定形（应用骨架修改器），再把姿势设为静止姿势，最后重新挂回骨架修改器
    for m in meshes:
        mods = [md for md in m.modifiers if md.type == "ARMATURE"]
        if not mods:
            continue
        if m.data.shape_keys:
            raise RuntimeError(f"{m.name} 带形态键，不能直接应用骨架修改器")
        md = mods[0]
        name = md.name
        with bpy.context.temp_override(object=m, active_object=m, selected_objects=[m]):
            bpy.ops.object.modifier_apply(modifier=name)
        nm = m.modifiers.new(name="Armature", type="ARMATURE")
        nm.object = arm_obj
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    report["applied"] = True
    return report


def tri_count(m) -> int:
    return sum(len(p.vertices) - 2 for p in m.data.polygons)


def main() -> None:
    p = args()
    clear_scene()
    objs = import_glb(p["glb"])
    # glTF 导入器会额外建一个骨骼显示用的 Icosphere 网格：只保留 GLB 里真实存在的网格节点
    keep = set(p["mesh_nodes"])
    for o in [o for o in objs if o.type == "MESH" and o.name not in keep]:
        objs.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in objs if o.type == "MESH"]
    missing = keep - {m.name for m in meshes}
    if missing:
        raise RuntimeError(f"导入后缺少网格节点 {sorted(missing)}（Blender 改了名？）")
    arms = [o for o in objs if o.type == "ARMATURE"]
    arm_obj = arms[0] if arms else None
    log(f"导入 {Path(p['glb']).name}：{len(meshes)} 个网格，{'骨架 ' + arm_obj.name if arm_obj else '无骨架'}")

    tpose = None
    if arm_obj and p.get("tpose_chains"):
        bpy.context.view_layer.objects.active = arm_obj
        tpose = apply_tpose(arm_obj, meshes, p["tpose_chains"])
        log(f"T-pose：{tpose}")

    info = []
    for m in meshes:
        lod = LOD_RE.search(m.name)
        info.append({
            "name": m.name,
            "lod": int(lod.group(1)) if lod else None,
            "tris": tri_count(m),
            "verts": len(m.data.vertices),
            "materials": [s.material.name if s.material else None for s in m.material_slots],
            "skinned": any(md.type == "ARMATURE" for md in m.modifiers),
        })

    bones = [b.name for b in arm_obj.data.bones] if arm_obj else []
    flip = Matrix.Rotation(math.pi, 4, "Z")
    for o in [o for o in bpy.data.objects if o.parent is None]:
        o.matrix_world = flip @ o.matrix_world
    bpy.context.view_layer.update()
    out = Path(p["fbx"])
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.fbx(
        filepath=str(out),
        use_selection=False,
        object_types={"ARMATURE", "MESH", "EMPTY"},
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS",
        axis_forward="-Z",
        axis_up="Y",
        bake_space_transform=False,
        use_mesh_modifiers=False,
        mesh_smooth_type="OFF",
        use_tspace=True,
        use_custom_props=False,
        add_leaf_bones=False,
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        use_armature_deform_only=False,
        armature_nodetype="NULL",
        bake_anim=False,
        path_mode="STRIP",
        embed_textures=False,
    )
    log(f"导出 {out.name}（{out.stat().st_size // 1024} KB）")
    finish(p, {"meshes": info, "bones": bones, "armature": arm_obj.name if arm_obj else None, "tpose": tpose})


main()
