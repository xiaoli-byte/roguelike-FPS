"""狸猫行商（SK_Npc_Merchant）手工关键帧动作（ART7）：Blender 无头脚本，一次生成全部片段。

    blender -b --factory-startup --python art/source/characters/SK_Npc_Merchant/anim/merchant_anims.py -- [--review <poses.json>]

产出（都可以重新生成，FBX 按 unity/.gitignore 不入库）：
  unity/Assets/Art/Characters/SK_Npc_Merchant/Anim/Keyframed/<状态>.fbx   Idle、Talk（文件名 = Animator 状态名）
  unity/Assets/Art/Characters/SK_Npc_Merchant/Anim/SK_Npc_Merchant.events.json   循环标记（Talk 是持续型：进状态后一直循环，
                                                                                     玩法关掉商店界面时 CrossFade 回 Idle）
  --review <poses.json>   每段的关键姿势（解算成 [骨, 轴, 角度]），给 art/tools/review_native_creature.py 算拉伸

骨架来自发布的 public/assets/characters/SK_Npc_Merchant.glb（骨骼名见 art/pipeline/creature_rigs/SK_Npc_Merchant.json），
导出设置照 SK_Boss_Hanba/anim/hanba_anims.py（顶层物体绕 Z 转 180°、-Z 前 / Y 上、主骨轴 Y，另放一个顶层空物体），
Unity 用本体的 Avatar 把片段导成人形肌肉曲线。尾巴是运行时弹簧骨，片段里只给它一点摆动作为弹簧目标。

蒙皮审核（creature_rigs/review_poses/SK_Npc_Merchant.json）：手臂从下垂抬起超过约 60° 时腋下会拉开（Tripo 把袖子和袍身
熔在一起），所以所有手势都让上臂保持在下垂 50° 以内，靠小臂前伸、上抬来比划。

姿势写法（Blender 坐标：front = -Y，生物的左 = +X，up = +Z），同旱魃脚本：
  aim    手臂（arm / forearm / hand）直接给出骨头要指的方向；只写 "arm" 时按左边给并镜像到右边，写 "arm_R" 只管一边
  rot    [骨, 世界轴, 角度] 绕该骨头部转（连同子骨）
  torso  最后执行的躯干动作：hips / spine / chest / neck / head 绕 X 正转 = 前倾；绕 Z 正转 = 转向生物的左
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[5]
ASSET = "SK_Npc_Merchant"
GLB = ROOT / f"public/assets/characters/{ASSET}.glb"
UNITY = ROOT / f"unity/Assets/Art/Characters/{ASSET}/Anim"
FPS = 30
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

# 待机底姿：手臂比绑定的 A 字更垂、肘微屈，爪子在胯旁略向前
BASE_AIM = {"arm": (0.50, 0.02, -0.87), "forearm": (0.30, -0.30, -0.91), "hand": (0.25, -0.40, -0.88)}


def pose(aim=None, rot=(), torso=(), chin=3) -> list:
    """手臂朝向（覆盖底姿）→ 细节旋转 → 躯干（最后，带动手臂）"""
    a = dict(BASE_AIM)
    a.update(aim or {})
    ops = []
    for side, sx in (("L", 1), ("R", -1)):
        for part in ("arm", "forearm", "hand"):
            v = a.get(f"{part}_{side}")
            if v is None and part in a:
                v = (sx * a[part][0], a[part][1], a[part][2])
            if v is not None:
                ops.append([f"{part}_{side}", "aim", list(v)])
    return ops + [list(r) for r in rot] + [list(t) for t in torso] + [["head", X, chin]]


def tail(a: float) -> list:
    """尾巴向生物的左（a > 0）/ 右摆，越往尾尖越多"""
    return [["tail_1", Z, a], ["tail_2", Z, a * 0.8], ["tail_3", Z, a * 0.6]]


BASE = pose()
# 说话的手势：上臂最多从下垂抬到约 50°，小臂前伸上抬到胸前，爪心朝上（手掌绕小臂外旋）
OFFER_R = {"arm_R": (-0.50, -0.38, -0.78), "forearm_R": (-0.15, -0.90, 0.40), "hand_R": (-0.10, -0.95, 0.30)}
OFFER_L = {"arm_L": (0.50, -0.38, -0.78), "forearm_L": (0.15, -0.90, 0.40), "hand_L": (0.10, -0.95, 0.30)}
SPREAD = {"arm": (0.70, -0.25, -0.67), "forearm": (0.70, -0.62, 0.35), "hand": (0.75, -0.55, 0.37)}
BELLY_L = {"arm_L": (0.42, -0.10, -0.90), "forearm_L": (-0.30, -0.80, -0.52), "hand_L": (-0.55, -0.70, -0.45)}

CLIPS = {
    # 待机：呼吸、重心左右换、歪头、尾巴慢摆（循环 4 秒）
    "Idle": {"frames": 120, "loop": True, "keys": [
        (0, BASE + tail(0)),
        (30, pose({"arm": (0.53, 0.02, -0.85)}, torso=[["hips", Z, 3], ["spine", Y, -2], ["chest", X, -3], ["head", Z, -5]],
                  chin=1) + tail(12)),
        (60, pose(torso=[["chest", X, 1]], chin=4) + tail(0)),
        (90, pose({"arm": (0.53, 0.02, -0.85)}, torso=[["hips", Z, -3], ["spine", Y, 2], ["chest", X, -3], ["head", Z, 6]],
                  chin=0) + tail(-12)),
        (120, BASE + tail(0))]},
    # 说话（商店界面打开时一直循环 5 秒）：右爪捧向客人 → 点头 → 张开双臂「都是好货」→ 左爪摸肚子、右爪比划 → 回底姿
    "Talk": {"frames": 150, "loop": True, "keys": [
        (0, BASE + tail(0)),
        (18, pose(OFFER_R, torso=[["chest", X, 4], ["chest", Z, 8]], chin=6) + tail(8)),
        (32, pose(OFFER_R, torso=[["chest", X, 6], ["chest", Z, 8]], chin=14) + tail(8)),
        (44, pose(OFFER_R, torso=[["chest", X, 4], ["chest", Z, 6]], chin=2) + tail(4)),
        (70, pose(SPREAD, torso=[["spine", X, -3], ["chest", X, -5]], chin=-6) + tail(-10)),
        (84, pose(SPREAD, torso=[["spine", X, -3], ["chest", X, -4]], chin=-2) + tail(-6)),
        (108, pose({**BELLY_L, **OFFER_R}, torso=[["chest", X, 3], ["chest", Z, 10], ["head", Z, -8]], chin=8) + tail(10)),
        (124, pose({**BELLY_L, "arm_R": (-0.55, -0.25, -0.80), "forearm_R": (-0.35, -0.85, 0.40)},
                   torso=[["chest", X, 3], ["chest", Z, 6], ["head", Z, 6]], chin=12) + tail(4)),
        (150, BASE + tail(0))]},
}


# ───────────── Blender（同 hanba_anims.py）─────────────
def load_rig():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
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


def apply(arm, ops) -> list:
    """依次执行姿势，返回解算后的 [骨, 轴, 角度]（审核用）"""
    done = []
    for bone, kind, v in ops:
        pb = arm.pose.bones[bone]
        m = pb.matrix.copy()
        if kind == "aim":
            q = (pb.tail - pb.head).rotation_difference(Vector(v).normalized())
            axis, ang = q.axis, q.angle
        else:
            axis, ang = Vector(kind), math.radians(v)
        if abs(ang) < 1e-6:
            continue
        head = m.translation.copy()
        pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-head) @ m
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
        done.append([bone, [round(c, 5) for c in axis], round(math.degrees(ang), 3)])
    return done


def fcurves(act) -> list:
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def bake_clip(arm, name: str, clip: dict):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    bones = sorted({op[0] for _, ops in clip["keys"] for op in ops})
    prev, resolved = {}, []
    for frame, ops in clip["keys"]:
        reset(arm)
        resolved.append((frame, apply(arm, ops)))
        for b in bones:
            pb = arm.pose.bones[b]
            q = pb.rotation_quaternion.copy()
            if b in prev and q.dot(prev[b]) < 0:
                q.negate()
                pb.rotation_quaternion = q
            prev[b] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=b)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.easing = "AUTO"
        if clip.get("loop"):
            fc.modifiers.new("CYCLES")
    return act, resolved


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
    clips = {name: {"events": [], "loop": bool(c.get("loop"))} for name, c in CLIPS.items()}
    doc = {"schema": 1,
           "about": ("狸猫行商的动画叠加表（NativeClipBuilder 读）。片段是手工关键帧，本文件和 FBX 都由 "
                     "art/source/characters/SK_Npc_Merchant/anim/merchant_anims.py 生成，别手改。Talk 标成循环（持续型：进状态后"
                     "一直播，商店界面关掉时由玩法 CrossFade 回 Idle）。"),
           "clips": clips}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    review = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
    arm = load_rig()
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    keep = bpy.data.objects.new(f"{ASSET}_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report, keyposes = {}, {}
    for name, clip in CLIPS.items():
        act, resolved = bake_clip(arm, name, clip)
        export_fbx(arm, act, name, clip["frames"], UNITY / "Keyframed")
        keyposes[name] = resolved
        report[name] = {"seconds": round(clip["frames"] / FPS, 2), "keys": [f for f, _ in clip["keys"]]}
    write_events(UNITY / f"{ASSET}.events.json")
    if review:
        poses = {"base": keyposes["Idle"][0][1]}
        for name, keys in keyposes.items():
            for frame, ops in keys:
                if frame in (0, CLIPS[name]["frames"]):
                    continue
                poses[f"{name}_{frame:03d}"] = ops
        review.write_text(json.dumps(poses), encoding="utf-8")
    print("MERCHANT_ANIMS " + json.dumps(report, ensure_ascii=False))


main()
