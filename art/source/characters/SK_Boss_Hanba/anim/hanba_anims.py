"""旱魃（SK_Boss_Hanba）手工关键帧动作（ART2）：Blender 无头脚本，一次生成全部片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Hanba/anim/hanba_anims.py -- [--review <poses.json>]

产出（都可以重新生成，FBX 按 unity/.gitignore 不入库）：
  unity/Assets/Art/Characters/SK_Boss_Hanba/Anim/Keyframed/<状态>.fbx   一个状态一个文件（文件名 = Animator 状态名）
  unity/Assets/Art/Characters/SK_Boss_Hanba/Anim/SK_Boss_Hanba.events.json   事件叠加表（归一化时刻，NativeClipBuilder 写成 OnAnimEvent）
  --review <poses.json>   每段的关键姿势（解算成 [骨, 轴, 角度]），给 art/tools/review_native_creature.py 算拉伸、出审核图

骨架来自发布的 public/assets/characters/SK_Boss_Hanba.glb（骨骼名见 art/pipeline/creature_rigs/SK_Boss_Hanba.json），导出设置与
art/pipeline/blender/bl_unity_export.py 一致（顶层物体绕 Z 转 180°、-Z 前 / Y 上、主骨轴 Y），Unity 用本体的 Avatar（Copy From Other）
把片段导成人形肌肉曲线。悬浮漂移、日轮旋转、残衣 / 长发 / 袖垂片的弹簧骨是运行时程序层（BS1 / BS2），片段里不动这些骨。

姿势写法（Blender 坐标：front = -Y，生物的左 = +X，up = +Z）：
  aim    四肢（arm / forearm / hand）直接给出骨头要指的方向，最短弧旋转、不引入扭转。只写 "arm"、"forearm"、"hand" 时按左边给、
         镜像到两边（x 取反）；写 "arm_L" / "arm_R" 只管一边。方向按身体自身的坐标给，躯干前倾、转身在最后统一带动手臂。
  rot    [骨, 世界轴, 角度] 绕该骨头部转（连同子骨）：手掌、手指、腿的细节。手指绕 X 负转 = 向掌心弯；腿（竖直）绕 X 负转 = 向前抬。
  torso  最后执行的躯干动作：["hips", "loc", [dx, dy, dz]] 整体平移（米）；hips / spine / chest / neck / head 绕 X 正转 = 前倾、
         负转 = 后仰；绕 Z 正转 = 转向生物的左。
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[5]
GLB = ROOT / "public/assets/characters/SK_Boss_Hanba.glb"
UNITY = ROOT / "unity/Assets/Art/Characters/SK_Boss_Hanba/Anim"
FPS = 30
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
FINGERS = ("index", "middle", "ring", "pinky")


def curl(a: float, b: float) -> list:
    """四指两节都向掌心弯（度）"""
    return [[f"{f}_{k}_{s}", X, -(a if k == 1 else b)] for f in FINGERS for s in "LR" for k in (1, 2)]


# 待机底姿：手臂比 A 字略抬、肘微屈向前、四指半松、下巴微收。各段从它起、回到它，状态间过渡不跳
BASE_AIM = {"arm": (0.62, 0.05, -0.78), "forearm": (0.60, -0.20, -0.77)}


def pose(aim=None, rot=(), torso=(), fingers=(12, 15), chin=5) -> list:
    """四肢朝向（覆盖底姿）→ 手指 → 细节旋转 → 躯干（最后，带动手臂）"""
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
    ops += curl(*fingers) + [list(r) for r in rot] + [list(t) for t in torso] + [["head", X, chin]]
    # 长发回垂：头是发链的父骨，上身前倾 θ 时整片长发跟着翻成水平、扯开压在背上的发根。弹簧骨以片段姿势为目标，
    # 所以目标姿势里就让发链根节绕世界 X 回转 0.85θ（只补前倾；后仰时长发本来就贴着背）
    pitch = sum(v for b, axis, v in torso if axis == X and b in ("hips", "spine", "chest", "neck")) + chin - 5
    if pitch > 8:
        ops += [[f"hair_{c}1", X, -0.85 * pitch] for c in "CLR"]
    return ops


def legs(thigh: float, shin: float, foot: float = 0.0, right=None) -> list:
    """双腿：大腿前抬、小腿后屈、脚背（right = 右腿单独的 (thigh, shin, foot)）"""
    rt, rs, rf = right or (thigh, shin, foot)
    return [["thigh_L", X, -thigh], ["thigh_R", X, -rt], ["shin_L", X, shin], ["shin_R", X, rs], ["foot_L", X, foot], ["foot_R", X, rf]]


BASE = pose()
FOLD = pose({"arm": (0.20, -0.35, -0.92), "forearm": (0.05, -0.45, -0.89)}, fingers=(30, 40), chin=15,
            torso=[["spine", X, 25], ["chest", X, 15], ["neck", X, 15]])
OPEN = pose({"arm": (0.82, 0.15, 0.55), "forearm": (0.75, 0.05, 0.66)}, fingers=(4, 6), chin=-20,
            rot=[["thumb_1_L", Z, 15], ["thumb_1_R", Z, -15]], torso=[["spine", X, -6], ["chest", X, -10], ["neck", X, -12]])
SWEEP_ARMS = {"arm_R": (-0.35, -0.75, -0.56), "forearm_R": (-0.30, -0.80, -0.52), "arm_L": (0.70, 0.10, -0.70)}
GALE_PUSH = pose({"arm": (0.40, -0.88, -0.25), "forearm": (0.30, -0.95, -0.05)}, fingers=(4, 6),
                 rot=[["hand_L", X, -35], ["hand_R", X, -35]], torso=[["spine", X, 10], ["chest", X, 8]])
SUMMON_DOWN = pose({"arm": (0.45, -0.65, -0.61), "forearm": (0.35, -0.60, -0.72)}, rot=[["hand_L", X, 40], ["hand_R", X, 40]],
                   torso=[["spine", X, 12], ["chest", X, 10], ["neck", X, 8]])
SLAM = pose({"arm_R": (-0.25, -0.80, -0.55), "forearm_R": (-0.15, -0.60, -0.79), "arm_L": (0.70, 0.45, -0.55)},
            rot=[["hand_R", X, -55]] + legs(25, 30, 0, (15, 25, 0)), chin=-10,
            torso=[["hips", "loc", [0, -0.25, -0.55]], ["hips", X, 15], ["spine", X, 25], ["chest", X, 22], ["neck", X, -15]])
CALL_OPEN = pose({"arm": (0.85, -0.20, 0.48), "forearm": (0.80, -0.25, 0.55)}, fingers=(4, 6), chin=-15,
                 torso=[["chest", X, -8], ["neck", X, -12]])
EXPOSE_AIM = {"arm": (0.70, 0.55, -0.45), "forearm": (0.65, 0.60, -0.47)}
EXPOSE_TORSO = [["spine", X, -6], ["chest", X, -14], ["neck", X, -12]]
EXPOSE = pose(EXPOSE_AIM, torso=EXPOSE_TORSO, chin=-19)


def tremble(k: int) -> list:
    s = 1 if k % 2 else -1
    return pose(EXPOSE_AIM, rot=[["arm_L", Y, -3 * s], ["arm_R", Y, -3 * s]], chin=-19,
                torso=EXPOSE_TORSO + [["chest", X, 2 * s], ["head", Z, 3 * s]])


# 失力前倒（上身合计前倾约 70°、双膝弯起）→ 跪落（下沉 1.25 米、小腿后折成跪姿、上身前倾约 85°、双臂垂向地面）
COLLAPSE = pose({"arm": (0.30, -0.30, -0.90), "forearm": (0.20, -0.35, -0.91)}, fingers=(25, 30), rot=legs(20, 60, 20), chin=10,
                torso=[["hips", "loc", [0, -0.15, -0.7]], ["hips", X, 10], ["spine", X, 20], ["chest", X, 15], ["neck", X, 15]])
LOW = pose({"arm": (0.20, -0.50, -0.84), "forearm": (0.12, -0.55, -0.83)}, fingers=(25, 30), rot=legs(10, 95, 30), chin=15,
           torso=[["hips", "loc", [0, -0.25, -1.25]], ["hips", X, 5], ["spine", X, 30], ["chest", X, 20], ["neck", X, 15]])

# ───────────── 片段：frames = 总帧数（30 fps）；keys = [(帧, 姿势)]；events = [(帧, 事件名)] ─────────────
CLIPS = {
    # 待机悬浮：呼吸、手臂起伏（循环；悬浮升降和日轮旋转在运行时层）
    "Idle": {"frames": 90, "loop": True, "keys": [
        (0, BASE),
        (45, pose({"arm": (0.68, 0.05, -0.73), "forearm": (0.62, -0.25, -0.74)}, rot=[["hand_L", X, -8], ["hand_R", X, -8]],
                  torso=[["chest", X, -3], ["neck", X, -2], ["head", Z, 4]])),
        (90, BASE)], "events": []},
    # 登场：低垂沉睡 → 舒展双臂、仰头长啸 → 落回待机
    "intro": {"frames": 120, "keys": [
        (0, FOLD),
        (25, pose({"arm": (0.20, -0.35, -0.92), "forearm": (0.05, -0.45, -0.89)}, fingers=(30, 40), chin=5,
                  torso=[["spine", X, 22], ["chest", X, 12], ["neck", X, 12]])),
        (70, OPEN), (85, pose({"arm": (0.84, 0.15, 0.52), "forearm": (0.78, 0.05, 0.62)}, fingers=(4, 6), chin=-24,
                              rot=[["thumb_1_L", Z, 15], ["thumb_1_R", Z, -15]],
                              torso=[["spine", X, -6], ["chest", X, -10], ["neck", X, -12]])),
        (120, BASE)],
        "events": [(0, "sfx:telegraph"), (70, "roar"), (70, "sfx:boss_roar"), (70, "fx:shake")]},
    # 日轮扫射：右手高举召日（直线预警）→ 指向身前地面放出光束 → 上身从右扫到左 → 收手
    "sunSweep": {"frames": 96, "keys": [
        (0, BASE),
        (24, pose({"arm_R": (-0.45, -0.10, 0.89), "forearm_R": (-0.30, -0.15, 0.94), "arm_L": (0.60, -0.60, -0.53),
                   "forearm_L": (0.50, -0.75, -0.43)}, chin=-5, torso=[["chest", Z, -20], ["chest", X, -6], ["neck", X, -10]])),
        (36, pose(SWEEP_ARMS, chin=6, torso=[["chest", Z, -25], ["neck", X, 8]])),
        (72, pose(SWEEP_ARMS, chin=6, torso=[["chest", Z, 25], ["neck", X, 8]])),
        (96, BASE)],
        "events": [(0, "fx:lineWarning"), (0, "sfx:enemy_charge"), (36, "hit"), (36, "beamStart"), (72, "beamEnd")]},
    # 旱风：双臂后收、手到肩旁蓄力 → 向前推掌，扇形热浪
    "droughtGale": {"frames": 72, "keys": [
        (0, BASE),
        (22, pose({"arm": (0.60, 0.60, -0.53), "forearm": (0.10, -0.30, 0.95)}, chin=-8, torso=[["chest", X, -10]])),
        (30, GALE_PUSH), (44, GALE_PUSH), (72, BASE)],
        "events": [(0, "fx:sectorWarning"), (0, "sfx:telegraph"), (30, "hit"), (30, "fx:shake"), (30, "sfx:boss_roar")]},
    # 召唤沙魇：双臂高举 → 掌心向下压向地面，沙魇破土
    "summonWraiths": {"frames": 84, "keys": [
        (0, BASE),
        (28, pose({"arm": (0.75, 0.05, 0.66), "forearm": (0.55, 0.0, 0.83)}, fingers=(4, 6), chin=-15,
                  torso=[["chest", X, -10], ["neck", X, -10]])),
        (48, SUMMON_DOWN), (62, SUMMON_DOWN), (84, BASE)],
        "events": [(0, "fx:groundWarning"), (0, "sfx:telegraph"), (48, "summon"), (48, "fx:shake")]},
    # 焦裂按地：右手扬起（直线预警）→ 俯冲按掌，裂缝沿直线蔓延
    "crackPalm": {"frames": 84, "keys": [
        (0, BASE),
        (24, pose({"arm_R": (-0.50, 0.30, 0.81), "forearm_R": (-0.30, 0.20, 0.93), "arm_L": (0.75, 0.0, -0.66)}, chin=-6,
                  torso=[["chest", X, -12], ["chest", Z, 15]])),
        (36, SLAM), (50, SLAM), (84, BASE)],
        "events": [(0, "fx:lineWarning"), (0, "sfx:telegraph"), (36, "hit"), (36, "fx:shake"), (36, "sfx:boss_slam")]},
    # 飞天之殇：双手捧到心口（泉珠前）→ 向两侧上方展开，召出被腐化的邪飞天
    "apsaraCall": {"frames": 90, "keys": [
        (0, BASE),
        (30, pose({"arm": (0.30, -0.45, -0.84), "forearm": (-0.60, -0.52, 0.60)}, fingers=(20, 25), chin=12,
                  torso=[["neck", X, 6]])),
        (54, CALL_OPEN), (70, CALL_OPEN), (90, BASE)],
        "events": [(0, "sfx:telegraph"), (54, "summon"), (54, "fx:shake")]},
    # 日蚀：双臂后展、挺胸露出泉珠，颤抖 3 秒（日轮熄灭）→ 双臂上扬，日轮爆发强光
    "eclipse": {"frames": 135, "keys": [(0, BASE), (20, EXPOSE)] + [(20 + 15 * k, tremble(k)) for k in range(1, 6)] + [
        (110, EXPOSE),
        (118, pose({"arm": (0.60, 0.0, 0.80), "forearm": (0.50, 0.0, 0.87)}, fingers=(4, 6), chin=-20,
                   torso=[["chest", X, -6], ["neck", X, -15]])),
        (135, BASE)],
        "events": [(0, "sfx:telegraph"), (20, "eclipseStart"), (110, "eclipseEnd"), (118, "flare"), (118, "fx:shake"),
                   (118, "sfx:boss_roar")]},
    # 受击：上身后仰、双臂一扬（眩晕 / 重击时播；轻受击由运行时的受击弹簧做）
    "Hit": {"frames": 21, "keys": [
        (0, BASE),
        (4, pose({"arm": (0.75, 0.15, -0.64), "forearm": (0.60, -0.10, -0.79)}, chin=-12,
                 torso=[["spine", X, -6], ["chest", X, -10], ["neck", X, -6]])),
        (21, BASE)], "events": []},
    # 死亡：仰天挣扎、双手成爪 → 失力前倒、跪落（整体下沉 1.25 米）
    "death": {"frames": 120, "keys": [
        (0, BASE),
        (22, pose({"arm": (0.60, -0.20, 0.78), "forearm": (0.45, -0.35, 0.82)}, fingers=(50, 60), chin=-30,
                  torso=[["chest", X, -16], ["neck", X, -15]])),
        (60, COLLAPSE), (95, LOW), (120, LOW)],
        "events": [(0, "sfx:boss_roar"), (60, "collapse"), (60, "fx:shake"), (95, "fx:shake"), (95, "sfx:boss_slam")]},
}


# ───────────── Blender ─────────────
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
    """依次执行姿势，返回解算后的 [骨, 轴, 角度] / [骨, "loc", 位移]（审核用）"""
    done = []
    for bone, kind, v in ops:
        pb = arm.pose.bones[bone]
        m = pb.matrix.copy()
        if kind == "loc":
            pb.matrix = Matrix.Translation(Vector(v)) @ m
            done.append([bone, "loc", list(v)])
        else:
            if kind == "aim":
                q = (pb.tail - pb.head).rotation_difference(Vector(v).normalized())
                axis, ang = q.axis, q.angle
            else:
                axis, ang = Vector(kind), math.radians(v)
            if abs(ang) < 1e-6:
                continue
            head = m.translation.copy()
            pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-head) @ m
            if bone != "hips":
                pb.location = (0, 0, 0)
            done.append([bone, [round(c, 5) for c in axis], round(math.degrees(ang), 3)])
        pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
    return done


def fcurves(act) -> list:
    """动作的全部曲线（Blender 4.4 起是分层动作：layers → strips → channelbags）"""
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def bake_clip(arm, name: str, clip: dict):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    bones = sorted({op[0] for _, ops in clip["keys"] for op in ops})
    moves_hips = any(op[0] == "hips" and op[1] == "loc" for _, ops in clip["keys"] for op in ops)
    prev, resolved = {}, []
    for frame, ops in clip["keys"]:
        reset(arm)
        resolved.append((frame, apply(arm, ops)))
        for b in bones:
            pb = arm.pose.bones[b]
            q = pb.rotation_quaternion.copy()
            if b in prev and q.dot(prev[b]) < 0:   # 四元数连续性：别绕远路
                q.negate()
                pb.rotation_quaternion = q
            prev[b] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=b)
            if b == "hips" and moves_hips:
                pb.keyframe_insert("location", frame=frame, group=b)
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
    clips = {}
    for name, c in CLIPS.items():
        clips[name] = {"events": [{"at": round(f / c["frames"], 4), "name": n} for f, n in c["events"]], "loop": bool(c.get("loop"))}
    doc = {"schema": 1,
           "about": ("旱魃的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。片段是手工关键帧，本文件和 FBX 都由 "
                     "art/source/characters/SK_Boss_Hanba/anim/hanba_anims.py 生成，别手改；at = 片段内归一化时刻。hit = 出手 / 判定，"
                     "summon = 召唤物出现，fx:*Warning = 画预警，beamStart / beamEnd = 日轮光束起止，eclipseStart / eclipseEnd = 日轮熄灭 / "
                     "复燃（泉珠暴露窗口），flare = 日蚀后强光爆发，roar = 登场长啸，collapse = 死亡倒下"),
           "clips": clips}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    review = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
    arm = load_rig()
    # 导出前顶层物体绕 Z 转 180°（同 bl_unity_export：Unity 里角色朝 +Z）；只写在物体上，骨骼的局部动画不受影响
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    # 再放一个顶层空物体：FBX 里只有一个顶层物体时 Unity 会把它折叠成文件根节点，root 的父节点就不再是 SK_Boss_Hanba_Rig，
    # 和本体 Avatar 的层级对不上（Copy From Other 报 Rig Configuration mis-match）
    keep = bpy.data.objects.new("SK_Boss_Hanba_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report, keyposes = {}, {}
    for name, clip in CLIPS.items():
        act, resolved = bake_clip(arm, name, clip)
        export_fbx(arm, act, name, clip["frames"], UNITY / "Keyframed")
        keyposes[name] = resolved
        report[name] = {"seconds": round(clip["frames"] / FPS, 2), "keys": [f for f, _ in clip["keys"]],
                        "events": [[round(f / FPS, 2), n] for f, n in clip["events"]]}
    write_events(UNITY / "SK_Boss_Hanba.events.json")
    if review:
        # 每段的关键姿势（去掉开头 / 结尾的待机底姿），平移不影响拉伸，略去
        poses = {"base": [op for op in keyposes["Idle"][0][1] if op[1] != "loc"]}
        for name, keys in keyposes.items():
            for frame, ops in keys:
                if name != "intro" and frame == 0 or frame == CLIPS[name]["frames"] and name != "death":
                    continue
                poses[f"{name}_{frame:03d}"] = [op for op in ops if op[1] != "loc"]
        review.write_text(json.dumps(poses), encoding="utf-8")
    print("HANBA_ANIMS " + json.dumps(report, ensure_ascii=False))


main()
