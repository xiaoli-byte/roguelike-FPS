"""发布 GLB → Unity FBX（在 Blender 里运行，由 unity_export.py 调用）。

做三件事：
1. 导入发布的 GLB（含 Draco / WebP），网格、骨骼、LOD 节点名原样保留；
2. 人形资产（params.humanoid 给出 Unity 人形骨骼映射）把双臂摆成 T-pose 并设为新的绑定姿势：
   Unity Humanoid 以 T-pose 为肌肉空间的参考，A-pose 绑定会让重定向来的动画手臂整体偏低；
3. 导出 FBX（不嵌贴图、不带材质贴图路径、不加叶骨骼），并回报每个网格的面数、材质槽、LOD 序号。
第一人称武器另有两个可选参数（unity_export.weapon_parts 给出，其他资产不传、行为不变）：
  split_joints  拆出新关节：加一根骨骼，把面中心落在规则区域里的面的蒙皮权重整块改到它（先沿区域边界把边拆开，几何不变）；
  move_bones    挪动不带蒙皮的关节（枪口点挪到美术网格最前端），glTF 空间坐标；
  rename_bones  白模关节名 j_N → 语义零件名（muzzle / mag / cylinder …），顶点组跟着改名。

坐标：Blender 里角色朝 −Y、Z 向上；FBX 用默认的 −Z 前 / Y 上，Unity 端打开 bakeAxisConversion。轴向参数只改文件里的坐标系声明，Unity 会按声明换算回来，换哪组参数角色都朝 Unity −Z；所以导出前把顶层物体绕 Z 转 180°（不应用到数据，只写在根节点上），
导入后角色朝 +Z、Y 向上、1 单位 = 1 米，与游戏 / glTF 一致（X 轴随左右手系翻转）。
"""

import math
import re
import sys
from pathlib import Path

import bmesh
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


def gltf_of(p: Vector) -> Vector:
    """Blender 世界坐标 → glTF（= Three.js 模型）空间：glTF 导入器把 Y 上换成了 Z 上，Blender (x, y, z) = glTF (x, −z, y)。"""
    return Vector((p.x, p.z, -p.y))


def blender_of(g) -> Vector:
    return Vector((g[0], -g[2], g[1]))


def split_joints(arm_obj, meshes, splits: list) -> list:
    """
    每条规则：name / parent / head（glTF 空间）/ zMax / yMin / children。新骨骼的方向与 roll 抄父骨骼，头放在铰链处；
    面中心（glTF 空间）z < zMax 且 y > yMin 的面整块改绑到新骨骼——刚体分段的部件资产每个顶点只跟一根骨骼，
    先把区域边界上的边拆开（顶点复制一份），两边才能各自转动、不会拉伸。children 里的关节改挂到新骨骼下（枪口跟着枪管走）。
    """
    report = []
    for s in splits:
        bpy.context.view_layer.objects.active = arm_obj
        arm_obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        ebs = arm_obj.data.edit_bones
        if s["parent"] not in ebs:
            raise RuntimeError(f"拆骨 {s['name']}：父骨骼 {s['parent']} 不存在（{[b.name for b in ebs]}）")
        parent = ebs[s["parent"]]
        head = arm_obj.matrix_world.inverted() @ blender_of(s["head"])
        axis = parent.tail - parent.head
        eb = ebs.new(s["name"])
        eb.head = head
        eb.tail = head + (axis.normalized() * max(axis.length, 0.01) if axis.length > 1e-6 else Vector((0, 0.05, 0)))
        eb.roll = parent.roll
        eb.parent = parent
        eb.use_connect = False
        for c in s.get("children", []):
            if c in ebs:
                ebs[c].use_connect = False
                ebs[c].parent = eb
        bpy.ops.object.mode_set(mode="OBJECT")

        faces_moved = verts_moved = split_edges = 0
        for m in meshes:
            if not any(md.type == "ARMATURE" for md in m.modifiers):
                continue
            vg = m.vertex_groups.get(s["name"]) or m.vertex_groups.new(name=s["name"])
            bm = bmesh.new()
            bm.from_mesh(m.data)
            dl = bm.verts.layers.deform.verify()
            mw = m.matrix_world
            sel = set()
            for f in bm.faces:
                c = Vector((0, 0, 0))
                for v in f.verts:
                    c += mw @ v.co
                g = gltf_of(c / len(f.verts))
                if g.z < s["zMax"] and g.y > s["yMin"]:
                    sel.add(f)
            boundary = [e for e in bm.edges
                        if any(f in sel for f in e.link_faces) and any(f not in sel for f in e.link_faces)]
            if boundary:
                bmesh.ops.split_edges(bm, edges=boundary)
            verts = {v for f in sel for v in f.verts}
            for v in verts:
                d = v[dl]
                d.clear()
                d[vg.index] = 1.0
            bm.to_mesh(m.data)
            bm.free()
            m.data.update()
            faces_moved += len(sel)
            verts_moved += len(verts)
            split_edges += len(boundary)
        if faces_moved == 0:
            raise RuntimeError(f"拆骨 {s['name']}：规则区域里没有面")
        report.append({"name": s["name"], "faces": faces_moved, "verts": verts_moved, "splitEdges": split_edges})
        log(f"拆出关节 {s['name']}：{faces_moved} 个面、{verts_moved} 个顶点，拆开边界 {split_edges} 条边")
    return report


def move_bones(arm_obj, meshes, moves: dict) -> dict:
    """把关节头挪到新位置（glTF 空间，整根骨骼平移）；只许挪没有顶点权重的关节（枪口这类挂点），挪了网格也不动。"""
    done = {}
    for name, g in moves.items():
        for m in meshes:
            vg = m.vertex_groups.get(name)
            if vg and any(vg.index in [e.group for e in v.groups if e.weight > 0] for v in m.data.vertices):
                raise RuntimeError(f"挪骨 {name}：它带着顶点权重，挪了会拖动网格")
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, g in moves.items():
        eb = arm_obj.data.edit_bones.get(name)
        if not eb:
            continue
        head = arm_obj.matrix_world.inverted() @ blender_of(g)
        delta = head - eb.head
        eb.head += delta
        eb.tail += delta
        done[name] = [round(x, 4) for x in g]
    bpy.ops.object.mode_set(mode="OBJECT")
    if done:
        log(f"挪动关节：{done}")
    return done


def rename_bones(arm_obj, meshes, rename: dict) -> dict:
    """骨骼改名；顶点组同步改名（Blender 改骨骼名时通常已经顺带改了，这里兜底）。返回实际改了的。"""
    done = {}
    for old, new in rename.items():
        b = arm_obj.data.bones.get(old)
        if not b:
            continue
        if arm_obj.data.bones.get(new):
            raise RuntimeError(f"骨骼改名 {old} → {new}：已经有同名骨骼")
        b.name = new
        for m in meshes:
            vg = m.vertex_groups.get(old)
            if vg and not m.vertex_groups.get(new):
                vg.name = new
        done[old] = new
    if done:
        log(f"骨骼改名：{done}")
    return done


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

    splits = renamed = None
    if arm_obj and p.get("split_joints"):
        splits = split_joints(arm_obj, meshes, p["split_joints"])
    if arm_obj and p.get("move_bones"):
        move_bones(arm_obj, meshes, p["move_bones"])
    if arm_obj and p.get("rename_bones"):
        renamed = rename_bones(arm_obj, meshes, p["rename_bones"])

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
    result = {"meshes": info, "bones": bones, "armature": arm_obj.name if arm_obj else None, "tpose": tpose}
    if splits is not None:
        result["splits"] = splits
    if renamed is not None:
        result["renamed"] = renamed
    finish(p, result)


main()
