"""熔心魔将（SK_Boss_Warlord，部件骨架 rig.mode = parts、关节 j_*）手工关键帧动作：Blender 无头脚本，一次生成全部片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Warlord/anim/warlord_anims.py -- [--review <目录>]

产出（FBX 按 unity/.gitignore 不入库，可以重新生成）：
  unity/Assets/Art/Characters/SK_Boss_Warlord/Anim/Keyframed/<状态>.fbx   一个状态一个文件（文件名 = Animator 状态名），同名时覆盖采样片段
  unity/Assets/Art/Characters/SK_Boss_Warlord/Anim/SK_Boss_Warlord.events.json   事件叠加表（关键帧片段 + 仍用采样的片段，NativeClipBuilder 写成 OnAnimEvent）
  --review <目录>   每段关键姿势带模型和熔心大剑渲一张三分之四视角小图 + 一张拼图（看姿势用，不入库）

设计单：docs/art/vfx/warlord.md（节拍表：起手 / 预警 / 蓄力顶点 / 释放帧 / 收招 / 余韵，和关键姿势一一对应）。

骨架：public/assets/characters/SK_Boss_Warlord.glb 的部件骨架（骨骼名见 art/pipeline/registry.toml 的 SK_Boss_Warlord，Hunyuan 网格按部件刚性蒙皮）。
  j_0 全身（脚底原点）→ j_0_0 髋（→ 两腿 j_0_0_11/12 大腿、_1 小腿）、j_0_1 腰以上（→ 披风 _20、右臂 _21 → 前臂 _21_1 → 大剑握点 _21_1_5（剑身 _10 / 剑尖 _11）、
  左臂 _22 → 前臂 _22_1、头 _24 → 角 / 角盔弱点 _8）。网格里没有剑：熔心大剑 SM_BossWeapon_Greatsword 是单独的挂件，运行时挂在 _21_1_5 上（WarlordBrain）。
导出设置与 art/pipeline/blender/bl_unity_export.py 一致（顶层物体绕 Z 转 180°、-Z 前 / Y 上、主骨轴 Y），Unity 按 Generic 导入、按骨骼名重定向曲线。

底姿：采样待机片段的第 0 帧（Three.js 模型空间，嵌在 IDLE0 里），所以关键帧片段和仍用采样的待机 / 步态之间过渡不跳。
姿势写法（角色坐标：right = 角色右手方向，fwd = 前，up = 上；Blender 里角色朝 -Y、角色右 = -X）：
  drop / fwd   全身（j_0）下沉 / 前移（米）；pitch 上身前倾（度，正 = 前倾）、twist 上身转向（正 = 转向角色左）、roll 侧弯；hips 髋前倾
  head         (俯仰, 转头)：俯仰正 = 低头
  arm_R / fore_R / sword、arm_L / fore_L   直接给骨头（解剖方向：肩 → 肘、肘 → 拳、握点 → 剑尖）要指的方向（角色坐标），最短弧旋转
  grip         右拳（大剑握点）放到两肩中点偏移 (right, fwd, up) 米处（两骨 IK，肘朝外下）：双手持剑的姿势用它，免得左手够不着
  edge         剑刃朝哪（角色坐标，挥砍时 = 刀头运动方向）：绕剑身轴转到最接近的那面刃
  grip_L       左手握到剑柄上（两骨 IK，肘朝外下）
  feet         {"R": (right, fwd[, up]), "L": ...}：脚掌落点相对静止站位的偏移（米），两骨 IK 让脚踩回地面（up = 摆动腿抬脚高度）；air = True 时腿按 legs 给的角度悬空
  legs         悬空时的 (大腿前抬, 小腿后屈)（度）
  cape         披风后扬（度）
  yaw          全身（j_0）绕竖轴转（度，正 = 转向角色左）：回旋斩整个人转圈用

剑士化 v2（2026-11-01，设计单第 13 章）：新招式的片段（居合 iai、剑气 waveSlash / waveCross、突刺 thrustReady / thrust / thrustCut、
回旋 spin / spinTwice、连斩上挑 slashUp）在这副旧部件骨架上只是「时机占位」：关键姿势借现有姿势库粗摆，出手事件的帧位置
（WarlordSword.*At，Unity 侧按它们拉伸片段）是定稿的；新模型（人形骨架）落地后在新骨架上重写，帧位置不变。
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[5]
GLB = ROOT / "public/assets/characters/SK_Boss_Warlord.glb"
SWORD_GLB = ROOT / "public/assets/attachments/SM_BossWeapon_Greatsword.glb"
UNITY = ROOT / "unity/Assets/Art/Characters/SK_Boss_Warlord/Anim"
FPS = 30

BONE = dict(body="j_0", hips="j_0_0", thigh_R="j_0_0_11", shin_R="j_0_0_11_1", thigh_L="j_0_0_12", shin_L="j_0_0_12_1",
            torso="j_0_1", cape="j_0_1_20", arm_R="j_0_1_21", fore_R="j_0_1_21_1", sword="j_0_1_21_1_5", arm_L="j_0_1_22",
            fore_L="j_0_1_22_1", head="j_0_1_24")
# 解剖方向（Blender 静止姿势，米）：肩 → 肘、肘 → 拳、握点 → 剑尖、髋 → 膝、膝 → 脚底
VEC = {"arm_R": (0, 0, -0.70), "fore_R": (0, -0.06, -0.72), "sword": (0, 0, -2.70), "arm_L": (0, 0, -0.70), "fore_L": (0, -0.06, -0.72),
       "thigh_R": (0, 0, -0.74), "shin_R": (0, 0, -0.75), "thigh_L": (0, 0, -0.74), "shin_L": (0, 0, -0.75)}
EDGE_REST = (1, 0, 0)  # 剑刃在静止姿势里朝 ±X（剑面朝前后）

# 采样待机第 0 帧（Three.js 模型空间：四元数 xyzw + 位置），见文件头
IDLE0 = {"j_r": [0, 0, 0, 1, 0, 0, 0], "j_0": [0, 0, 0, 1, 0, 0, 0], "j_0_0": [0, 0, 0, 1, 0, 1.62, 0], "j_0_0_11": [0, 0, 0, 1, -0.3, 1.52, 0],
         "j_0_0_11_1": [0, 0, 0, 1, -0.3, 0.78, 0], "j_0_0_12": [0, 0, 0, 1, 0.3, 1.52, 0], "j_0_0_12_1": [0, 0, 0, 1, 0.3, 0.78, 0],
         "j_0_1": [0.02344, 0, 0, 0.99973, 0, 1.9, 0], "j_0_1_13": [0.02344, 0, 0, 0.99973, -0.84, 2.91888, 0.04781],
         "j_0_1_18": [0.02344, 0, 0, 0.99973, 0.84, 2.91888, 0.04781], "j_0_1_19": [0.02344, 0, 0, 0.99973, 0, 2.39711, 0.07338],
         "j_0_1_20": [0.08257, 0, 0, 0.99659, 0, 2.96853, -0.37032], "j_0_1_21": [-0.15071, -0.00905, -0.05928, 0.98676, -0.86, 2.77903, 0.04125],
         "j_0_1_21_1": [-0.39015, 0.00589, -0.05967, 0.9188, -0.9438, 2.11575, 0.2487],
         "j_0_1_21_1_5": [-0.78288, 0.03378, -0.04954, 0.61927, -1.016, 1.66304, 0.80713],
         "j_0_1_21_1_5_10": [-0.78288, 0.03378, -0.04954, 0.61927, -1.01896, 1.74379, 1.14767],
         "j_0_1_21_1_5_11": [-0.78288, 0.03378, -0.04954, 0.61927, -1.03887, 2.28598, 3.43418],
         "j_0_1_22": [-0.02644, 0.00239, 0.08985, 0.9956, 0.86, 2.77903, 0.04125], "j_0_1_22_1": [-0.22371, -0.01551, 0.08853, 0.9705, 0.98532, 2.09131, 0.07781],
         "j_0_1_24": [0.02344, 0, 0, 0.99973, 0, 3.17719, 0.08997], "j_0_1_24_5": [0.02085, -0.01072, 0.45721, 0.88905, -0.26, 3.39788, 0.0803],
         "j_0_1_24_5_1": [0.02333, -0.00234, 0.09981, 0.99473, -0.66671, 3.6884, 0.09394],
         "j_0_1_24_6": [0.02085, 0.01072, -0.45721, 0.88905, 0.26, 3.39788, 0.0803],
         "j_0_1_24_6_1": [0.02333, 0.00234, -0.09981, 0.99473, 0.66671, 3.6884, 0.09394], "j_0_1_24_8": [0.02344, 0, 0, 0.99973, 0, 3.27708, 0.09466]}
REST_Q = {"j_0_1_24_5": [0, 0, 0.45734, 0.88929], "j_0_1_24_5_1": [0, 0, 0.09983, 0.995], "j_0_1_24_6": [0, 0, -0.45734, 0.88929],
          "j_0_1_24_6_1": [0, 0, -0.09983, 0.995]}

# Three.js（Y 上、Z 前）→ Blender（Z 上、-Y 前）：绕 X 转 +90°
C3 = Matrix.Rotation(math.radians(90), 3, "X")


def D(right: float, fwd: float, up: float) -> Vector:
    """角色坐标 → Blender 方向（角色朝 -Y、右手 = -X）"""
    return Vector((-right, -fwd, up)).normalized()


# 姿势库与片段表（骨架无关）在 warlord_poses.py：两个构建器共用
sys.path.insert(0, str(Path(__file__).resolve().parent))
from warlord_poses import *  # noqa: E402,F401,F403


# ───────────── Blender ─────────────
def load_rig(keep_mesh: bool):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if keep_mesh and o.name.startswith("SK_Boss_Warlord"):
            continue
        bpy.data.objects.remove(o)
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def reset(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def three_q(q) -> Matrix:
    return Quaternion((q[3], q[0], q[1], q[2])).to_matrix()


def apply_idle(arm):
    """底姿：采样待机第 0 帧（模型空间朝向增量 D = q · q_rest⁻¹，换到 Blender 坐标，乘到骨骼静止朝向上）"""
    order = sorted(arm.pose.bones, key=lambda pb: len(pb.parent_recursive))
    for pb in order:
        d = IDLE0.get(pb.name)
        if not d:
            continue
        rest_q = REST_Q.get(pb.name, [0, 0, 0, 1])
        delta = three_q(d[:4]) @ three_q(rest_q).inverted()
        delta_bl = C3 @ delta @ C3.inverted()
        pos = C3 @ Vector(d[4:7])
        rest = pb.bone.matrix_local.to_3x3()
        pb.matrix = Matrix.Translation(pos) @ (delta_bl @ rest).to_4x4()
        bpy.context.view_layer.update()


def rot_about_head(arm, bone: str, q: Quaternion):
    pb = arm.pose.bones[bone]
    m = pb.matrix.copy()
    head = m.translation.copy()
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m
    bpy.context.view_layer.update()


def cur_vec(arm, key: str) -> Vector:
    pb = arm.pose.bones[BONE[key]]
    r = pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()
    return r @ Vector(VEC[key])


def aim(arm, key: str, target: Vector):
    v = cur_vec(arm, key)
    if v.length < 1e-6 or target.length < 1e-6:
        return
    rot_about_head(arm, BONE[key], v.normalized().rotation_difference(target.normalized()))


def head_of(arm, key: str) -> Vector:
    return arm.pose.bones[BONE[key]].matrix.translation.copy()


def two_bone(arm, upper: str, lower: str, target: Vector, pole: Vector):
    a = head_of(arm, upper)
    l1, l2 = Vector(VEC[upper]).length, Vector(VEC[lower]).length
    t = target - a
    d = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-3, t.length))
    u = t.normalized()
    w = (pole - u * pole.dot(u))
    w = w.normalized() if w.length > 1e-6 else Vector((0, -1, 0))
    x = (d * d + l1 * l1 - l2 * l2) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    knee = a + u * x + w * h
    aim(arm, upper, knee - a)
    aim(arm, lower, (a + u * d) - head_of(arm, lower))


def set_edge(arm, want: Vector):
    """绕剑身轴转，让最接近的那面刃朝 want（投影到剑身法平面）"""
    pb = arm.pose.bones[BONE["sword"]]
    r = pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()
    axis = (r @ Vector(VEC["sword"])).normalized()
    e = (r @ Vector(EDGE_REST)).normalized()
    w = want - axis * want.dot(axis)
    if w.length < 1e-4:
        return
    w.normalize()
    if e.dot(w) < 0:
        w = -w
    ang = math.atan2(axis.dot(e.cross(w)), e.dot(w))
    rot_about_head(arm, BONE["sword"], Quaternion(axis, ang))


REST_SOLE = {"R": Vector((-0.3, 0, 0.03)), "L": Vector((0.3, 0, 0.03))}


def build(arm, p: dict):
    """底姿 → 全身平移 → 髋 / 上身 / 头 → 右臂 / 大剑 → 左臂 → 腿（IK 踩回地面）→ 披风"""
    reset(arm)
    apply_idle(arm)
    drop, fwd = p.get("drop", 0.0), p.get("fwd", 0.0)
    body = arm.pose.bones[BONE["body"]]
    body.matrix = Matrix.Translation(Vector((0, -fwd, -drop))) @ body.matrix
    bpy.context.view_layer.update()
    if p.get("yaw"):
        rot_about_head(arm, BONE["body"], Quaternion((0, 0, 1), math.radians(p["yaw"])))
    if p.get("hips"):
        rot_about_head(arm, BONE["hips"], Quaternion((1, 0, 0), math.radians(p["hips"])))
    torso = BONE["torso"]
    if p.get("twist"):
        rot_about_head(arm, torso, Quaternion((0, 0, 1), math.radians(p["twist"])))
    if p.get("roll"):
        rot_about_head(arm, torso, Quaternion((0, 1, 0), math.radians(p["roll"])))
    if p.get("pitch"):
        rot_about_head(arm, torso, Quaternion((1, 0, 0), math.radians(p["pitch"])))
    hp, hy = p.get("head", (0, 0))
    if hy:
        rot_about_head(arm, BONE["head"], Quaternion((0, 0, 1), math.radians(hy)))
    if hp:
        rot_about_head(arm, BONE["head"], Quaternion((1, 0, 0), math.radians(hp)))
    if "grip" in p:
        # 右拳（大剑握点）IK 到两肩中点的偏移处（角色坐标），肘朝外下
        mid = (head_of(arm, "arm_R") + head_of(arm, "arm_L")) * 0.5
        g = p["grip"]
        two_bone(arm, "arm_R", "fore_R", mid + Vector((-g[0], -g[1], g[2])), D(1, -0.2, -0.6))
    else:
        for k in ("arm_R", "fore_R"):
            if k in p:
                aim(arm, k, D(*p[k]))
    if "sword" in p:
        aim(arm, "sword", D(*p["sword"]))
    if "edge" in p:
        set_edge(arm, D(*p["edge"]))
    if p.get("grip_L"):
        sw = arm.pose.bones[BONE["sword"]]
        blade = cur_vec(arm, "sword").normalized()
        grip = sw.matrix.translation - blade * 0.24
        two_bone(arm, "arm_L", "fore_L", grip, D(-0.8, -0.3, -0.5))
    else:
        for k in ("arm_L", "fore_L"):
            if k in p:
                aim(arm, k, D(*p[k]))
    if p.get("air"):
        th, sh = p.get("legs", (0, 0))
        for s in ("R", "L"):
            rot_about_head(arm, BONE["thigh_" + s], Quaternion((1, 0, 0), math.radians(-th)))
            rot_about_head(arm, BONE["shin_" + s], Quaternion((1, 0, 0), math.radians(sh)))
    else:
        feet = p.get("feet", {})
        for s in ("R", "L"):
            off = feet.get(s, (0.0, 0.0))
            # 第三个分量 = 抬脚高度（米；步态的摆动腿）
            sole = REST_SOLE[s] + Vector((-off[0], -off[1], off[2] if len(off) > 2 else 0.0))
            two_bone(arm, "thigh_" + s, "shin_" + s, sole, Vector((0, -1, 0.15)))
    if p.get("cape"):
        rot_about_head(arm, BONE["cape"], Quaternion((1, 0, 0), math.radians(-p["cape"])))


def fcurves(act) -> list:
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def bake_clip(arm, name: str, clip: dict):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    prev = {}
    for frame, p in clip["keys"]:
        build(arm, p)
        for pb in arm.pose.bones:
            q = pb.rotation_quaternion.copy()
            if pb.name in prev and q.dot(prev[pb.name]) < 0:
                q.negate()
                pb.rotation_quaternion = q
            prev[pb.name] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)
            pb.keyframe_insert("location", frame=frame, group=pb.name)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        if clip.get("loop"):
            fc.modifiers.new("CYCLES")
    return act


def export_fbx(arm, act, name: str, frames: int, out_dir: Path):
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 0, frames
    arm.animation_data.action = act
    out_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=str(out_dir / f"{name}.fbx"), use_selection=False, object_types={"ARMATURE", "EMPTY"},
        apply_unit_scale=True, apply_scale_options="FBX_SCALE_UNITS", axis_forward="-Z", axis_up="Y",
        bake_space_transform=False, add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X",
        use_armature_deform_only=False, armature_nodetype="NULL",
        bake_anim=True, bake_anim_use_all_bones=True, bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False,
        bake_anim_force_startend_keying=True, bake_anim_step=1.0, bake_anim_simplify_factor=0.0, path_mode="STRIP")


def write_events(path: Path):
    """关键帧片段的事件表 + 连段 next / 循环 / 录制速度；表里没有的状态沿用原叠加表里的条目"""
    old = {}
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8")).get("clips", {})
        except ValueError:
            old = {}
    clips = {k: v for k, v in old.items() if k not in CLIPS}
    for name, c in CLIPS.items():
        e = {"events": [{"at": round(f / c["frames"], 4), "name": n} for f, n in c["events"]], "loop": bool(c.get("loop"))}
        if c.get("next"):
            e["next"] = c["next"]
        # 步态的录制速度（混合树阈值；手工片段替换采样片段时采样数据里的 speed 不会带过来）
        if c.get("speed"):
            e["speed"] = c["speed"]
        clips[name] = e
    doc = {"schema": 1,
           "about": ("熔心魔将的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。招式片段是手工关键帧，本文件和 FBX 都由 "
                     "art/source/characters/SK_Boss_Warlord/anim/warlord_anims.py 生成，别手改；at = 片段内归一化时刻。"
                     "hit = 释放帧（刀到 / 落地 / 插剑；顿帧、震屏、出手特效由招式判定那一刻触发，这个事件用来量动作和判定差几帧），smear / smearEnd = 大剑拖影起止，"
                     "fx:windup = 起手（焰刃开始烧亮），step = 冲锋 / 突刺踏步，brake = 刹停，impact = 撞墙 / 横竖两刀的竖劈 / 回旋二连的第二圈，takeoff = 起跳，cast = 举剑号令天火，"
                     "dash = 居合拔刀突进（居合的 hit = 收刀「咔」），"
                     "gather / roar = 咆哮的缩身 / 炸开，kneel / collapse = 倒下的跪地 / 扑倒，glare = 登场落地后抬头怒视（角盔一亮）；"
                     "Idle / Walk / Move 也是手工关键帧（双手持剑），speed = 录制速度（混合树阈值）；fx:*Warning 只是标注预警从哪一帧画（预警由招式画）"),
           "clips": clips}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ───────────── 审核渲染 ─────────────
def setup_review(arm):
    """熔心大剑挂到握点上（静止姿势下对齐：剑的原点 = 握点、剑尖朝下），三分之四视角相机、工作台渲染"""
    reset(arm)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SWORD_GLB))
    sword_objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    pb = arm.pose.bones[BONE["sword"]]
    head = arm.matrix_world @ pb.bone.head_local
    tail_m = arm.matrix_world @ pb.bone.matrix_local @ Matrix.Translation((0, pb.bone.length, 0))
    for o in sword_objs:
        mw = o.matrix_world.copy()
        o.parent = arm
        o.parent_type = "BONE"
        o.parent_bone = pb.name
        o.matrix_parent_inverse = tail_m.inverted()
        o.matrix_basis = Matrix.Translation(head) @ mw
    for o in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("Icosphere")]:
        bpy.data.objects.remove(o)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = False
    scene.render.resolution_x, scene.render.resolution_y = 360, 420
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    scene.world = world
    cams = []
    # 两个机位：玩家视角（正前方、略高）+ 俯视三分之四（看挥砍的水平弧线）
    for name, pos in (("front", Vector((0, -13, 3.2))), ("top", Vector((-7.5, -6.5, 10.5)))):
        cam = bpy.data.cameras.new(name)
        cam.type = "ORTHO"
        cam.ortho_scale = 7.6
        co = bpy.data.objects.new(name, cam)
        scene.collection.objects.link(co)
        co.location = pos
        look = Vector((0, 0, 1.7))
        co.rotation_euler = (look - pos).to_track_quat("-Z", "Y").to_euler()
        cams.append(co)
    scene["cams"] = [c.name for c in cams]
    # 地面
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    return scene


def render_reviews(arm, out: Path, only=None):
    out.mkdir(parents=True, exist_ok=True)
    scene = setup_review(arm)
    files = []
    for name, clip in list(CLIPS.items()) + list(REVIEW_EXTRA.items()):
        if only and name not in only:
            continue
        for frame, p in clip["keys"]:
            if p is BASE and frame and name != "Idle":
                continue
            build(arm, p)
            for cname in scene["cams"]:
                scene.camera = bpy.data.objects[cname]
                f = out / f"{name}_{frame:03d}_{cname}.png"
                scene.render.filepath = str(f)
                bpy.ops.render.render(write_still=True)
            files.append(f"{name}_{frame:03d}")
    (out / "index.json").write_text(json.dumps(files), encoding="utf-8")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    review = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    arm = load_rig(keep_mesh=review is not None)
    if review:
        render_reviews(arm, review, only)
        print("WARLORD_REVIEW " + str(review))
        return
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    keep = bpy.data.objects.new("SK_Boss_Warlord_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report = {}
    for name, clip in CLIPS.items():
        act = bake_clip(arm, name, clip)
        export_fbx(arm, act, name, clip["frames"], UNITY / "Keyframed")
        report[name] = {"seconds": round(clip["frames"] / FPS, 2), "keys": [f for f, _ in clip["keys"]],
                        "events": [[round(f / FPS, 2), n] for f, n in clip["events"]]}
    write_events(UNITY / "SK_Boss_Warlord.events.json")
    print("WARLORD_ANIMS " + json.dumps(report, ensure_ascii=False))


main()
