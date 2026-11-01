"""熔心魔将 · 新模型（人形骨架）的手 K 构建器：Blender 无头脚本，一次生成全部片段（剑士化 v2，docs/art/vfx/warlord.md 第 13 章）。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Warlord/anim/warlord_anims_humanoid.py -- [--out <目录>] [--dry]

状态：结构和关键姿势先写好（2026-11-01），**新网格还没生成**——骨骼坐标等 Tripo 网格出来、模型路发布 public/assets/characters/SK_Boss_Warlord.glb 后
按实测微调（REST_RELAX、L_GRIP、HAND_SHARE、脚掌落点）。模型落地之前跑它会因为缺骨直接退出（不会拿旧部件骨架出一套错的片段）；
落地后它取代 warlord_anims.py（旧部件骨架的构建器），产出位置一样：
  unity/Assets/Art/Characters/SK_Boss_Warlord/Anim/Keyframed/<状态>.fbx   一个状态一个文件（文件名 = Animator 状态名，Unity 按本体 Avatar 导成人形肌肉曲线，
                                                                           socket_sword 的旋转是非人形骨的曲线，照样保留）
  unity/Assets/Art/Characters/SK_Boss_Warlord/Anim/SK_Boss_Warlord.events.json   事件叠加表（片段表里的事件，帧位置和旧版一样）
  --out <目录>  试跑时写到别处（不碰 Unity 工程）；--dry  只解算姿势、检查骨骼，不导出

骨架约定（模型路 2026-11-01；照旱魃：语义人形命名，Unity 里 Humanoid；Blender 坐标 front = −Y，生物的左 = +X，up = +Z）：
  root（不变形）→ hips → spine → chest → neck → head；shoulder_L/R → arm_L/R → forearm_L/R → hand_L/R，五指各两节 {thumb,index,middle,ring,pinky}_{1,2}_{L,R}；
  thigh_L/R → shin_L/R → foot_L/R → toe_L/R；肩甲 pauldron_L/R（变形骨，挂在 shoulder 下，不 K 就跟着锁骨走）；
  弹簧链（不 K）：skirt_F1..3 / skirt_B1..3 / skirt_L1..2 / skirt_R1..2、tassel_*（运行时 CreatureRigBuilder 归到 cloth 族）。
  挂点（不变形、绑定矩阵单位阵）：socket_sword（右手掌心握点，挂在 hand_R 下；绑定姿势下大剑按单位变换挂上去就是剑尖朝下、剑面朝前，剑资产原点 = 右手握点、剑身朝 −Y）、
  socket_sword_tip（剑尖，socket_sword 下）、socket_core（胸口地火之心 = 弱点，chest 下）、socket_helm（角盔盔脊，head 下）、socket_pauldron_L/R（肩甲顶，狂怒火舌）。

姿势：和旧构建器共用 warlord_poses.py 的姿势库与片段表（角色坐标，骨架无关）。这里的解释：
  drop / fwd / yaw → hips 平移 / 绕竖轴转（脚掌落点跟着 yaw 转）；pitch / twist / roll → spine 40% + chest 60%；head (俯仰, 转头) → neck 30% + head 70%；
  grip → 右手 IK（hand_R 头到两肩中点的偏移处，肘朝外下）；arm_R / fore_R / arm_L / fore_L → 直接给方向；
  sword → 剑身方向：手腕（hand_R）分担 HAND_SHARE、其余转 socket_sword（换握 / 转剑直接 K 挂点）；edge → 绕剑身轴转 socket_sword；
  grip_L → 左手 IK 到剑柄上（握点往剑首方向 L_GRIP 米）；握剑时两手五指收拳；feet → 两骨 IK 踩回地面、脚掌放平；air / legs → 悬空腿；
  cape → 忽略（战裙是弹簧链）。
用户概念图（art/source/characters/_design/inferno/inferno_boss_warlord/user_concept_molten_warlord.webp）的三张 ACTION POSES 是招牌招式的关键姿势参考：
  ① 低身横抡、剑在身前拖出熔岩月牙（横扫 SWEEP_HIT / 收刀横斩 / 横剑气）；② 举剑过头、剑光大弧（下劈 C_COCK → C_HIT、回旋 spin）；
  ③ 大剑砸地、熔岩炸起（下劈入地 C_HIT、跃击落地 LAND_HIT、插剑 PLANT_HIT）。网格出来后按这三张修关键姿势的剪影。
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from warlord_poses import CLIPS, P  # noqa: E402

ROOT = Path(__file__).resolve().parents[5]
GLB = ROOT / "public/assets/characters/SK_Boss_Warlord.glb"
UNITY = ROOT / "unity/Assets/Art/Characters/SK_Boss_Warlord/Anim"
FPS = 30
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

FINGERS = ("thumb", "index", "middle", "ring", "pinky")
REQUIRED = (["root", "hips", "spine", "chest", "neck", "head", "socket_sword", "socket_sword_tip", "socket_core", "socket_helm"]
            + [f"{b}_{s}" for b in ("shoulder", "arm", "forearm", "hand", "thigh", "shin", "foot", "pauldron") for s in "LR"])
# 每一个关键帧都 K 的骨（弹簧链、肩甲、其余挂点不 K）
KEYED = (["hips", "spine", "chest", "neck", "head", "socket_sword"]
         + [f"{b}_{s}" for b in ("arm", "forearm", "hand", "thigh", "shin", "foot") for s in "LR"]
         + [f"{f}_{k}_{s}" for f in FINGERS for k in (1, 2) for s in "LR"])

# ── 网格出来后实测微调的量 ──
# 待机放松的手臂方向（角色坐标；静止姿势多半是 T / A 字，姿势没写到的那只手先垂下来）
REST_RELAX = {"arm_R": (0.28, 0.05, -0.96), "forearm_R": (0.2, 0.25, -0.95), "arm_L": (-0.28, 0.05, -0.96), "forearm_L": (-0.2, 0.25, -0.95)}
# 左手握点：沿剑柄往剑首方向（米；模型路说约 0.35 m，准确值等剑的网格）
L_GRIP = 0.35
# 剑身方向由手腕分担的比例（最多 45°），其余转 socket_sword
HAND_SHARE, HAND_MAX = 0.4, 45.0
# 握剑的五指弯曲（度：第 1 / 2 节；拇指另给）、放松的手
FIST, FIST_THUMB, RELAXED = (70, 85), (25, 35), (18, 22)
# 剑刃在 socket_sword 静止姿势里朝 ±X（剑面朝前）
EDGE_REST = Vector((1, 0, 0))


def D(right: float, fwd: float, up: float) -> Vector:
    """角色坐标 → Blender 方向（角色朝 -Y、右手 = -X）"""
    return Vector((-right, -fwd, up)).normalized()


# ───────────── Blender ─────────────
def load_rig():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    missing = [b for b in REQUIRED if not arm or b not in arm.pose.bones]
    if missing:
        print(f"WARLORD_HUMANOID 缺骨，退出（新模型还没发布？{GLB} 仍是旧部件骨架时请用 warlord_anims.py）：{', '.join(missing[:12])}")
        sys.exit(2)
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
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


def pb_(arm, name):
    return arm.pose.bones[name]


def rot_about_head(arm, bone: str, q: Quaternion):
    pb = pb_(arm, bone)
    m = pb.matrix.copy()
    head = m.translation.copy()
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m
    if bone != "hips":
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def turn(arm, bone: str, axis: Vector, deg: float):
    if abs(deg) > 1e-4:
        rot_about_head(arm, bone, Quaternion(axis, math.radians(deg)))


def vec(arm, bone: str) -> Vector:
    pb = pb_(arm, bone)
    return pb.tail - pb.head


def aim(arm, bone: str, target: Vector, share: float = 1.0, limit: float = 180.0):
    v = vec(arm, bone)
    if v.length < 1e-6 or target.length < 1e-6:
        return
    q = v.normalized().rotation_difference(target.normalized())
    ang = min(q.angle * share, math.radians(limit))
    if ang > 1e-5:
        rot_about_head(arm, bone, Quaternion(q.axis, ang))


def blade(arm) -> Vector:
    """剑身方向（握点 → 剑尖）"""
    return pb_(arm, "socket_sword_tip").head - pb_(arm, "socket_sword").head


def aim_sword(arm, target: Vector):
    """剑身指向 target：手腕先分担一部分（最多 HAND_MAX 度），其余转 socket_sword"""
    for bone, share, limit in (("hand_R", HAND_SHARE, HAND_MAX), ("socket_sword", 1.0, 180.0)):
        b = blade(arm)
        if b.length < 1e-6:
            return
        q = b.normalized().rotation_difference(target.normalized())
        ang = min(q.angle * share, math.radians(limit))
        if ang > 1e-5:
            rot_about_head(arm, bone, Quaternion(q.axis, ang))


def set_edge(arm, want: Vector):
    """绕剑身轴转 socket_sword，让最接近的那面刃朝 want"""
    pb = pb_(arm, "socket_sword")
    r = pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()
    axis = blade(arm).normalized()
    e = (r @ EDGE_REST).normalized()
    w = want - axis * want.dot(axis)
    if w.length < 1e-4:
        return
    w.normalize()
    if e.dot(w) < 0:
        w = -w
    rot_about_head(arm, "socket_sword", Quaternion(axis, math.atan2(axis.dot(e.cross(w)), e.dot(w))))


def two_bone(arm, upper: str, lower: str, end: str, target: Vector, pole: Vector):
    """两骨 IK：end 的头（手腕 / 脚踝）放到 target，中间关节朝 pole"""
    a = pb_(arm, upper).head.copy()
    l1, l2 = pb_(arm, upper).bone.length, pb_(arm, lower).bone.length
    t = target - a
    d = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-3, t.length))
    u = t.normalized()
    w = pole - u * pole.dot(u)
    w = w.normalized() if w.length > 1e-6 else Vector((0, -1, 0))
    x = (d * d + l1 * l1 - l2 * l2) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    joint = a + u * x + w * h
    aim(arm, upper, joint - a)
    aim(arm, lower, (a + u * d) - pb_(arm, lower).head)


def fingers(arm, side: str, curl: tuple, thumb: tuple):
    for f in FINGERS:
        a, b = thumb if f == "thumb" else curl
        for k, deg in ((1, a), (2, b)):
            name = f"{f}_{k}_{side}"
            if name in arm.pose.bones:
                # 手指绕手掌的侧轴弯向掌心：取这节骨和手掌法线（近似用世界 X）的叉积
                v = vec(arm, name)
                ax = v.cross(X).normalized() if v.cross(X).length > 1e-4 else Y
                turn(arm, name, ax, -deg)


class Rest:
    """静止姿势里量出来的东西：脚掌落点、两肩中点、髋高"""

    def __init__(self, arm):
        reset(arm)
        self.sole = {s: pb_(arm, f"foot_{s}").head.copy() for s in "LR"}
        self.shoulders = (pb_(arm, "arm_L").head + pb_(arm, "arm_R").head) * 0.5
        self.foot_q = {s: pb_(arm, f"foot_{s}").matrix.to_quaternion() for s in "LR"}


def build(arm, rest: Rest, p: dict):
    """放松底姿 → 髋（平移 / 转身 / 前倾）→ 上身 → 头 → 右臂 / 剑 → 左臂 → 手指 → 腿（IK 踩回地面、脚掌放平）"""
    reset(arm)
    for k, v in REST_RELAX.items():
        aim(arm, k, D(*v))
    drop, fwd, yaw = p.get("drop", 0.0), p.get("fwd", 0.0), p.get("yaw", 0.0)
    hips = pb_(arm, "hips")
    hips.matrix = Matrix.Translation(Vector((0, -fwd, -drop))) @ hips.matrix
    bpy.context.view_layer.update()
    turn(arm, "hips", Z, yaw)
    turn(arm, "hips", X, p.get("hips", 0.0))
    for bone, share in (("spine", 0.4), ("chest", 0.6)):
        turn(arm, bone, Z, p.get("twist", 0.0) * share)
        turn(arm, bone, Y, p.get("roll", 0.0) * share)
        turn(arm, bone, X, p.get("pitch", 0.0) * share)
    hp, hy = p.get("head", (0, 0))
    for bone, share in (("neck", 0.3), ("head", 0.7)):
        turn(arm, bone, Z, hy * share)
        turn(arm, bone, X, hp * share)
    holding = "grip" in p or p.get("grip_L")
    if "grip" in p:
        g = p["grip"]
        mid = (pb_(arm, "arm_L").head + pb_(arm, "arm_R").head) * 0.5
        two_bone(arm, "arm_R", "forearm_R", "hand_R", mid + Vector((-g[0], -g[1], g[2])), D(1, -0.2, -0.6))
    else:
        for key, bone in (("arm_R", "arm_R"), ("fore_R", "forearm_R")):
            if key in p:
                aim(arm, bone, D(*p[key]))
    if "sword" in p:
        aim_sword(arm, D(*p["sword"]))
    if "edge" in p:
        set_edge(arm, D(*p["edge"]))
    if p.get("grip_L"):
        target = pb_(arm, "socket_sword").head - blade(arm).normalized() * L_GRIP
        two_bone(arm, "arm_L", "forearm_L", "hand_L", target, D(-0.8, -0.3, -0.5))
    else:
        for key, bone in (("arm_L", "arm_L"), ("fore_L", "forearm_L")):
            if key in p:
                aim(arm, bone, D(*p[key]))
    fingers(arm, "R", FIST, FIST_THUMB)
    fingers(arm, "L", FIST if p.get("grip_L") else RELAXED, FIST_THUMB if p.get("grip_L") else RELAXED)
    if p.get("air"):
        th, sh = p.get("legs", (0, 0))
        for s in "LR":
            turn(arm, f"thigh_{s}", X, -th)
            turn(arm, f"shin_{s}", X, sh)
    else:
        feet = p.get("feet", {})
        spin = Matrix.Rotation(math.radians(yaw), 3, "Z")
        for s in "LR":
            off = feet.get(s, (0.0, 0.0))
            sole = spin @ (rest.sole[s] + Vector((-off[0], -off[1], off[2] if len(off) > 2 else 0.0)))
            two_bone(arm, f"thigh_{s}", f"shin_{s}", f"foot_{s}", sole, spin @ Vector((0, -1, 0.15)))
            # 脚掌放平：脚的世界朝向回到静止姿势（跟着转身转）
            foot = pb_(arm, f"foot_{s}")
            m = foot.matrix.copy()
            q = (Quaternion(Z, math.radians(yaw)) @ rest.foot_q[s]).to_matrix().to_4x4()
            foot.matrix = Matrix.Translation(m.translation) @ q
            foot.location = (0, 0, 0)
            bpy.context.view_layer.update()


def fcurves(act) -> list:
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def bake_clip(arm, rest: Rest, name: str, clip: dict):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    prev = {}
    for frame, p in clip["keys"]:
        build(arm, rest, p)
        for b in KEYED:
            if b not in arm.pose.bones:
                continue
            pb = arm.pose.bones[b]
            q = pb.rotation_quaternion.copy()
            if b in prev and q.dot(prev[b]) < 0:
                q.negate()
                pb.rotation_quaternion = q
            prev[b] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=b)
            if b == "hips":
                pb.keyframe_insert("location", frame=frame, group=b)
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
    clips = {}
    for name, c in CLIPS.items():
        e = {"events": [{"at": round(f / c["frames"], 4), "name": n} for f, n in c["events"]], "loop": bool(c.get("loop"))}
        if c.get("next"):
            e["next"] = c["next"]
        if c.get("speed"):
            e["speed"] = c["speed"]
        clips[name] = e
    doc = {"schema": 1,
           "about": ("熔心魔将（人形骨架）的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。片段是手工关键帧，本文件和 FBX 都由 "
                     "art/source/characters/SK_Boss_Warlord/anim/warlord_anims_humanoid.py 生成（姿势 / 片段表在 warlord_poses.py），别手改；"
                     "at = 片段内归一化时刻。hit / impact = 释放帧（刀到 / 落地 / 插剑 / 收刀 / 竖劈 / 第二圈），smear / smearEnd = 大剑拖影起止，"
                     "dash = 居合拔刀突进，fx:windup = 起手，step = 踏步，brake = 刹停，takeoff = 起跳，cast = 号令天火，gather / roar = 咆哮，"
                     "kneel / collapse = 倒下，glare = 登场抬头；speed = 步态录制速度（混合树阈值）；fx:*Warning 只是标注预警从哪一帧画"),
           "clips": clips}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else UNITY
    dry = "--dry" in argv
    arm = load_rig()
    rest = Rest(arm)
    if dry:
        for name, clip in CLIPS.items():
            for _, p in clip["keys"]:
                build(arm, rest, p)
        print(f"WARLORD_HUMANOID 试解算 {len(CLIPS)} 段，没有导出")
        return
    # 同 hanba_anims：导出前顶层物体绕 Z 转 180°（Unity 里角色朝 +Z），再放一个顶层空物体（单个顶层物体会被折叠，层级对不上 Avatar）
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    keep = bpy.data.objects.new("SK_Boss_Warlord_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report = {}
    for name, clip in CLIPS.items():
        act = bake_clip(arm, rest, name, clip)
        export_fbx(arm, act, name, clip["frames"], out / "Keyframed")
        report[name] = {"seconds": round(clip["frames"] / FPS, 2), "keys": [k[0] for k in clip["keys"]]}
    write_events(out / "SK_Boss_Warlord.events.json")
    print("WARLORD_HUMANOID " + json.dumps(report, ensure_ascii=False))


main()
