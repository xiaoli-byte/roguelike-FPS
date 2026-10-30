"""旱魃（SK_Boss_Hanba）手工关键帧动作（ART2）：Blender 无头脚本，一次生成全部片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Hanba/anim/hanba_anims.py -- [--review <poses.json>] [--out <目录>]

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

关键帧 = (帧, 姿势) 或 (帧, 姿势, 缓动)：缓动管「从这一帧到下一帧」那一段（默认 Bézier 自动钳制）：
  "in"   加速冲向下一帧（蓄力顶点 → 释放帧的 smear 段：越来越快，砸在释放帧上）
  "out"  从这一帧减速出去（释放帧之后的余势）
  "back" 冲过头再回来（follow-through 的过冲）
  "lin"  匀速（日轮扫射的持续段）
招式的节拍按 docs/art/vfx/hanba.md 的节拍表：起手（反向预备 + 下蹲）→ 蓄力顶点（moving hold：顶点上还有微动，不冻住）→
smear（2–3 帧冲到释放帧）→ 释放帧（extreme，身体拉伸）→ 过冲 → 收招（follow-through，回到底姿）。
出手事件（hit / beamStart / summon / eclipseStart / flare）的帧位与旧版一致，招式代码按事件在片段里的位置拉伸片段，不用跟着改。
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
SLAM =pose({"arm_R": (-0.25, -0.80, -0.55), "forearm_R": (-0.15, -0.60, -0.79), "arm_L": (0.70, 0.45, -0.55)},
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

# ───────────── 招牌招式的节拍姿势（VFX 调优 H 路，docs/art/vfx/hanba.md）─────────────
# 命名：_ANTIC 起手（反向预备）、_X 极限姿势（extreme，带过冲）、_HOLD 蓄力顶点（moving hold）、_SMEAR 冲向释放帧的过渡、
# _STRIKE / _PUSH / _PRESS 释放帧（extreme，身体拉伸）、_OVER 释放后的过冲 / 压缩、其余为 breakdown。

# 日轮扫射：右手先往下后方收（反向预备、下蹲）→ 高举召日并上浮（过冲）→ 顶点上指尖张开、日轮聚光 → 2 帧劈向身前地面（手臂成一条直线指向光束落点）
SS_ANTIC = pose({"arm_R": (-0.40, 0.40, -0.82), "forearm_R": (-0.35, 0.45, -0.82), "arm_L": (0.55, -0.25, -0.80)}, chin=14,
                torso=[["hips", "loc", [0, 0.05, -0.12]], ["spine", X, 8], ["chest", X, 6], ["chest", Z, 10]])
SS_RAISE_X = pose({"arm_R": (-0.28, -0.05, 0.96), "forearm_R": (-0.18, -0.08, 0.98), "arm_L": (0.62, -0.62, -0.48),
                   "forearm_L": (0.52, -0.78, -0.35)}, fingers=(4, 6), chin=-16,
                  torso=[["hips", "loc", [0, 0, 0.16]], ["chest", Z, -24], ["chest", X, -12], ["neck", X, -10]])
SS_RAISE = pose({"arm_R": (-0.45, -0.10, 0.89), "forearm_R": (-0.30, -0.15, 0.94), "arm_L": (0.60, -0.60, -0.53),
                 "forearm_L": (0.50, -0.75, -0.43)}, fingers=(4, 6), chin=-10,
                torso=[["hips", "loc", [0, 0, 0.10]], ["chest", Z, -20], ["chest", X, -8], ["neck", X, -10]])
SS_HOLD = pose({"arm_R": (-0.36, 0.02, 0.93), "forearm_R": (-0.24, -0.02, 0.97), "arm_L": (0.62, -0.58, -0.53),
                "forearm_L": (0.52, -0.74, -0.42)}, fingers=(2, 3), chin=-14,
               torso=[["hips", "loc", [0, 0.02, 0.13]], ["chest", Z, -26], ["chest", X, -13], ["neck", X, -10]])
SS_SMEAR = pose({"arm_R": (-0.40, -0.62, 0.30), "forearm_R": (-0.38, -0.70, 0.10), "arm_L": (0.66, -0.10, -0.74)}, fingers=(2, 3), chin=-2,
                torso=[["hips", "loc", [0, -0.04, 0.04]], ["chest", Z, -24], ["chest", X, 3]])
SS_STRIKE = pose({"arm_R": (-0.30, -0.88, -0.36), "forearm_R": (-0.26, -0.90, -0.34), "arm_L": (0.72, 0.22, -0.66)}, fingers=(2, 3), chin=4,
                 rot=[["hand_R", X, -20]], torso=[["hips", "loc", [0, -0.08, -0.04]], ["spine", X, 6], ["chest", X, 10], ["chest", Z, -22], ["neck", X, 4]])
SS_RECOIL = pose({"arm_R": (-0.32, -0.82, -0.47), "forearm_R": (-0.28, -0.84, -0.46), "arm_L": (0.70, 0.12, -0.70)}, chin=6,
                 torso=[["hips", "loc", [0, 0.02, 0]], ["chest", X, 3], ["chest", Z, -12], ["neck", X, 8]])


def ss_beam(k: int) -> list:
    """光束持续段：手臂一直指着光束落点（整个人跟着光束转身，躯干不另外扭），肩膀吃着反冲微微颤（k 交替）"""
    s = 1 if k % 2 else -1
    return pose({"arm_R": (-0.32, -0.80 + 0.02 * s, -0.50), "forearm_R": (-0.28, -0.82, -0.49), "arm_L": (0.70, 0.12, -0.70)}, chin=6,
                torso=[["hips", "loc", [0, 0.01, 0]], ["chest", X, 4 + 2 * s], ["chest", Z, -10], ["neck", X, 8], ["head", Z, 2 * s]])


SS_FOLLOW = pose({"arm_R": (-0.10, -0.80, -0.59), "forearm_R": (-0.05, -0.75, -0.66), "arm_L": (0.66, 0.20, -0.72)}, chin=8,
                 torso=[["chest", X, 6], ["chest", Z, 8], ["neck", X, 6]])
SS_SETTLE = pose({"arm_R": (-0.50, -0.30, -0.81), "forearm_R": (-0.48, -0.42, -0.77)}, chin=6, torso=[["chest", Z, 3]])

# 旱风：双臂先在身前一抱（反向预备、含胸下蹲）→ 甩到身后、手到肩旁、后仰上浮（极限）→ 2 帧推出去、整个人往前一送（拉伸）→ 过冲 → 推掌停住 → 收
GA_ANTIC = pose({"arm": (0.22, -0.55, -0.80), "forearm": (-0.10, -0.60, -0.79)}, fingers=(25, 30), chin=14,
                torso=[["hips", "loc", [0, -0.04, -0.12]], ["spine", X, 6], ["chest", X, 12]])
GA_DRAW = pose({"arm": (0.60, 0.68, -0.42), "forearm": (0.10, -0.30, 0.95)}, fingers=(4, 6), chin=-12,
               rot=[["hand_L", X, 25], ["hand_R", X, 25]], torso=[["hips", "loc", [0, 0.16, 0.10]], ["spine", X, -6], ["chest", X, -16]])
GA_HOLD = pose({"arm": (0.58, 0.70, -0.41), "forearm": (0.08, -0.28, 0.96)}, fingers=(2, 3), chin=-14,
               rot=[["hand_L", X, 28], ["hand_R", X, 28]], torso=[["hips", "loc", [0, 0.18, 0.12]], ["spine", X, -7], ["chest", X, -18]])
GA_SMEAR = pose({"arm": (0.55, -0.20, -0.25), "forearm": (0.35, -0.85, 0.15)}, fingers=(2, 3), chin=-6,
                torso=[["hips", "loc", [0, 0.0, 0.04]], ["chest", X, 4]])
GA_PUSH = pose({"arm": (0.36, -0.92, -0.15), "forearm": (0.26, -0.96, 0.02)}, fingers=(2, 3), chin=-2,
               rot=[["hand_L", X, -45], ["hand_R", X, -45]], torso=[["hips", "loc", [0, -0.26, -0.04]], ["spine", X, 12], ["chest", X, 14]])
GA_OVER = pose({"arm": (0.36, -0.93, -0.10), "forearm": (0.26, -0.96, 0.06)}, fingers=(2, 3), chin=0,
               rot=[["hand_L", X, -48], ["hand_R", X, -48]], torso=[["hips", "loc", [0, -0.30, -0.06]], ["spine", X, 14], ["chest", X, 18]])
GA_HELD = pose({"arm": (0.40, -0.88, -0.25), "forearm": (0.30, -0.95, -0.05)}, fingers=(4, 6),
               rot=[["hand_L", X, -35], ["hand_R", X, -35]], torso=[["hips", "loc", [0, -0.18, 0]], ["spine", X, 10], ["chest", X, 8]])
GA_EASE = pose({"arm": (0.44, -0.82, -0.36), "forearm": (0.34, -0.88, -0.30)}, fingers=(8, 10),
               rot=[["hand_L", X, -20], ["hand_R", X, -20]], torso=[["hips", "loc", [0, -0.12, 0]], ["spine", X, 6], ["chest", X, 6]])
GA_SETTLE = pose({"arm": (0.55, -0.25, -0.80), "forearm": (0.50, -0.40, -0.77)}, torso=[["chest", X, 3]])

# 召沙魇：先往下一沉 → 双臂高举上浮（过冲）→ 十指成爪攥住 → 2 帧掌心砸向地面、整个人往下一压
SW_ANTIC = pose({"arm": (0.50, 0.25, -0.83), "forearm": (0.45, 0.10, -0.89)}, chin=10,
                torso=[["hips", "loc", [0, 0, -0.10]], ["chest", X, 8]])
SW_RAISE_X = pose({"arm": (0.72, 0.05, 0.69), "forearm": (0.50, 0.0, 0.87)}, fingers=(4, 6), chin=-18,
                  torso=[["hips", "loc", [0, 0, 0.18]], ["chest", X, -14], ["neck", X, -12]])
SW_RAISE = pose({"arm": (0.75, 0.05, 0.66), "forearm": (0.55, 0.0, 0.83)}, fingers=(4, 6), chin=-15,
                torso=[["hips", "loc", [0, 0, 0.14]], ["chest", X, -10], ["neck", X, -10]])
SW_HOLD = pose({"arm": (0.70, 0.10, 0.70), "forearm": (0.52, 0.04, 0.85)}, fingers=(35, 45), chin=-16,
               torso=[["hips", "loc", [0, 0, 0.20]], ["chest", X, -15], ["neck", X, -10]])
SW_SMEAR = pose({"arm": (0.60, -0.50, 0.05), "forearm": (0.45, -0.70, -0.20)}, fingers=(20, 25), chin=0,
                torso=[["hips", "loc", [0, 0, 0.05]], ["chest", X, 2]])
SW_PRESS = pose({"arm": (0.45, -0.62, -0.64), "forearm": (0.35, -0.58, -0.74)}, rot=[["hand_L", X, 50], ["hand_R", X, 50]],
                torso=[["hips", "loc", [0, -0.08, -0.22]], ["spine", X, 16], ["chest", X, 13], ["neck", X, 10]])
SW_OVER = pose({"arm": (0.45, -0.60, -0.66), "forearm": (0.35, -0.55, -0.76)}, rot=[["hand_L", X, 52], ["hand_R", X, 52]],
               torso=[["hips", "loc", [0, -0.08, -0.26]], ["spine", X, 18], ["chest", X, 14], ["neck", X, 10]])
SW_HELD = pose({"arm": (0.45, -0.65, -0.61), "forearm": (0.35, -0.60, -0.72)}, rot=[["hand_L", X, 40], ["hand_R", X, 40]],
               torso=[["hips", "loc", [0, -0.05, -0.15]], ["spine", X, 12], ["chest", X, 10], ["neck", X, 8]])

# 焦裂：右手先往下后方一甩（反向预备、下蹲）→ 扬到头顶、整个人上浮后仰（过冲）→ 五指成爪攥着火 → 2 帧俯冲按掌（拉伸、下沉）→ 压缩过冲 →
#       掌一直按在地上推着裂缝走（出手段）→ 收招时把掌拔出来（fx:palmOut）、起身
CP_ANTIC = pose({"arm_R": (-0.35, 0.30, -0.89), "forearm_R": (-0.30, 0.35, -0.89), "arm_L": (0.55, -0.45, -0.70)}, chin=12,
                torso=[["hips", "loc", [0, 0.04, -0.12]], ["chest", X, 8], ["chest", Z, -6]])
CP_RAISE_X = pose({"arm_R": (-0.42, 0.32, 0.85), "forearm_R": (-0.25, 0.22, 0.94), "arm_L": (0.78, -0.05, -0.62)}, chin=-10,
                  torso=[["hips", "loc", [0, 0.10, 0.32]], ["chest", X, -16], ["chest", Z, 18]])
CP_RAISE = pose({"arm_R": (-0.48, 0.30, 0.82), "forearm_R": (-0.30, 0.20, 0.93), "arm_L": (0.76, 0.0, -0.65)}, chin=-8,
                torso=[["hips", "loc", [0, 0.08, 0.26]], ["chest", X, -13], ["chest", Z, 16]])
CP_HOLD = pose({"arm_R": (-0.45, 0.35, 0.82), "forearm_R": (-0.28, 0.25, 0.93), "arm_L": (0.78, 0.02, -0.63)}, fingers=(40, 50), chin=-12,
               rot=[["thumb_1_R", Z, -20]], torso=[["hips", "loc", [0, 0.10, 0.30]], ["chest", X, -17], ["chest", Z, 17]])
CP_SMEAR = pose({"arm_R": (-0.35, -0.55, 0.20), "forearm_R": (-0.25, -0.75, -0.20), "arm_L": (0.72, 0.25, -0.62)}, fingers=(20, 25), chin=-4,
                torso=[["hips", "loc", [0, -0.15, -0.10]], ["spine", X, 10], ["chest", X, 12], ["chest", Z, 6]])
CP_SLAM = pose({"arm_R": (-0.22, -0.82, -0.53), "forearm_R": (-0.12, -0.62, -0.78), "arm_L": (0.72, 0.48, -0.50)},
               rot=[["hand_R", X, -60]] + legs(28, 34, 0, (16, 28, 0)), chin=-12,
               torso=[["hips", "loc", [0, -0.32, -0.66]], ["hips", X, 16], ["spine", X, 27], ["chest", X, 24], ["neck", X, -16]])
CP_SQUASH = pose({"arm_R": (-0.22, -0.80, -0.56), "forearm_R": (-0.12, -0.60, -0.79), "arm_L": (0.70, 0.50, -0.51)},
                 rot=[["hand_R", X, -62]] + legs(30, 38, 0, (18, 32, 0)), chin=-12,
                 torso=[["hips", "loc", [0, -0.34, -0.74]], ["hips", X, 17], ["spine", X, 30], ["chest", X, 26], ["neck", X, -17]])
CP_PRESS2 = pose({"arm_R": (-0.25, -0.80, -0.55), "forearm_R": (-0.15, -0.60, -0.79), "arm_L": (0.68, 0.42, -0.60)},
                 rot=[["hand_R", X, -55]] + legs(25, 30, 0, (15, 25, 0)), chin=-8,
                 torso=[["hips", "loc", [0, -0.27, -0.58]], ["hips", X, 15], ["spine", X, 24], ["chest", X, 21], ["neck", X, -14]])
CP_PULL = pose({"arm_R": (-0.30, -0.55, -0.78), "forearm_R": (-0.28, -0.45, -0.85), "arm_L": (0.66, 0.25, -0.71)}, fingers=(25, 30),
               rot=legs(14, 20), chin=0, torso=[["hips", "loc", [0, -0.15, -0.35]], ["hips", X, 8], ["spine", X, 12], ["chest", X, 14]])
CP_RISE = pose({"arm_R": (-0.55, -0.30, -0.78), "forearm_R": (-0.52, -0.42, -0.74)}, chin=4,
               torso=[["hips", "loc", [0, -0.05, -0.08]], ["chest", X, 5]])

# 飞天之殇：先把双臂微微张开（反向预备）→ 捧到心口、上身含住 → 2 帧向两侧上方展开、上浮（释放）→ 过冲
AP_ANTIC = pose({"arm": (0.70, -0.10, -0.70), "forearm": (0.62, -0.20, -0.76)}, chin=-4, torso=[["chest", X, -4]])
AP_CUP = pose({"arm": (0.30, -0.45, -0.84), "forearm": (-0.60, -0.52, 0.60)}, fingers=(20, 25), chin=12, torso=[["neck", X, 6]])
AP_HOLD = pose({"arm": (0.28, -0.47, -0.84), "forearm": (-0.62, -0.50, 0.60)}, fingers=(30, 35), chin=14,
               torso=[["hips", "loc", [0, 0, -0.08]], ["chest", X, 6], ["neck", X, 8]])
AP_SMEAR = pose({"arm": (0.65, -0.40, 0.10), "forearm": (0.55, -0.45, 0.30)}, fingers=(8, 10), chin=0, torso=[["chest", X, -2]])
AP_OPEN = pose({"arm": (0.85, -0.20, 0.48), "forearm": (0.80, -0.25, 0.55)}, fingers=(4, 6), chin=-15,
               torso=[["hips", "loc", [0, 0, 0.12]], ["chest", X, -12], ["neck", X, -12]])
AP_OVER = pose({"arm": (0.90, -0.15, 0.40), "forearm": (0.85, -0.20, 0.48)}, fingers=(2, 3), chin=-17,
               torso=[["hips", "loc", [0, 0, 0.14]], ["chest", X, -14], ["neck", X, -12]])

# 日蚀：先含胸、双手捂住心口（反向预备：护住泉珠）→ 2 帧把双臂甩到身后、挺胸露出泉珠（过冲）→ 颤抖 3 秒 →
#       窗口快结束时往里一缩、攥拳蓄力（fx:gather，强光的前兆）→ 2 帧双臂上扬、仰天、上浮（强光爆发）→ 过冲
EC_ANTIC = pose({"arm": (0.25, -0.55, -0.80), "forearm": (-0.55, -0.60, 0.58)}, fingers=(30, 35), chin=16,
                torso=[["hips", "loc", [0, 0, -0.12]], ["spine", X, 6], ["chest", X, 14]])
EC_SMEAR = pose({"arm": (0.70, 0.15, -0.50), "forearm": (0.65, 0.20, -0.55)}, fingers=(8, 10), chin=-6,
                torso=[["hips", "loc", [0, 0, 0]], ["chest", X, -6]])
EC_EXPOSE_X = pose({"arm": (0.70, 0.62, -0.36), "forearm": (0.65, 0.66, -0.38)}, chin=-22,
                   torso=[["hips", "loc", [0, 0.06, 0.10]], ["spine", X, -7], ["chest", X, -18], ["neck", X, -14]])
EC_GATHER = pose({"arm": (0.40, 0.10, -0.91), "forearm": (0.20, -0.30, -0.93)}, fingers=(35, 45), chin=14,
                 torso=[["hips", "loc", [0, 0, -0.18]], ["spine", X, 8], ["chest", X, 12]])
EC_GATHER2 = pose({"arm": (0.36, 0.08, -0.93), "forearm": (0.16, -0.34, -0.93)}, fingers=(45, 55), chin=16,
                  torso=[["hips", "loc", [0, 0, -0.22]], ["spine", X, 9], ["chest", X, 14]])
EC_RISE = pose({"arm": (0.65, 0.0, 0.30), "forearm": (0.58, 0.0, 0.45)}, fingers=(10, 12), chin=-8,
               torso=[["hips", "loc", [0, 0, 0.02]], ["chest", X, -2]])
EC_FLARE = pose({"arm": (0.62, 0.05, 0.78), "forearm": (0.52, 0.0, 0.85)}, fingers=(2, 3), chin=-26,
                torso=[["hips", "loc", [0, 0, 0.18]], ["chest", X, -12], ["neck", X, -16]])
EC_FLARE_X = pose({"arm": (0.66, 0.10, 0.74), "forearm": (0.56, 0.05, 0.83)}, fingers=(2, 3), chin=-28,
                  torso=[["hips", "loc", [0, 0, 0.22]], ["chest", X, -15], ["neck", X, -16]])

# ───────────── 片段：frames = 总帧数（30 fps）；keys = [(帧, 姿势[, 缓动])]；events = [(帧, 事件名)] ─────────────
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
    # 日轮扫射（121 帧）：起手 0–7（右手往下后方收、下蹲）→ 高举召日、上浮 17（过冲）→ 23 落定 → 蓄力顶点 31（moving hold）→
    #   smear 34 → 释放帧 36（beamStart：手臂一条直线劈向光束落点）→ 反冲 41 → 持续段 46–95（整个人跟着光束转、手一直指着落点，肩膀吃着反冲颤）→
    #   beamEnd 95 → 过冲 101 → 收 121。持续段 59 帧 ≈ 前摇 36 帧 × 1.64（扫射 110° 的时长 / 前摇，各阶段同比），光束在手停之前不会先熄
    "sunSweep": {"frames": 121, "keys": [
        (0, BASE), (7, SS_ANTIC), (17, SS_RAISE_X), (23, SS_RAISE), (31, SS_HOLD, "in"), (34, SS_SMEAR, "in"), (36, SS_STRIKE, "out"),
        (41, SS_RECOIL)] + [(46 + 12 * k, ss_beam(k), "lin") for k in range(4)] + [
        (95, ss_beam(4)), (101, SS_FOLLOW, "back"), (110, SS_SETTLE), (121, BASE)],
        "events": [(0, "fx:lineWarning"), (0, "sfx:enemy_charge"), (17, "fx:raise"), (36, "hit"), (36, "beamStart"), (95, "beamEnd")]},
    # 旱风（84 帧）：起手 0–7（双臂身前一抱、含胸）→ 甩到身后蓄力 19（极限：后仰上浮）→ 蓄力顶点 26 → smear 28 → 释放帧 30（推掌，整个人前送）→
    #   过冲 34 → 推掌停住 46 → 松 58 → 收 84（推掌停到热浪扫完，收招段才放下手）
    "droughtGale": {"frames": 84, "keys": [
        (0, BASE), (7, GA_ANTIC), (19, GA_DRAW), (26, GA_HOLD, "in"), (28, GA_SMEAR, "in"), (30, GA_PUSH, "out"), (34, GA_OVER),
        (46, GA_HELD), (58, GA_EASE), (72, GA_SETTLE), (84, BASE)],
        "events": [(0, "fx:sectorWarning"), (0, "sfx:telegraph"), (30, "hit"), (30, "fx:shake"), (30, "sfx:boss_roar")]},
    # 召唤沙魇（84 帧）：起手 0–7（往下一沉）→ 双臂高举上浮 24（过冲）→ 30 → 十指成爪 42 → smear 46 → 释放帧 48（掌心砸向地面、往下一压）→ 过冲 52 → 按住 64 → 收
    "summonWraiths": {"frames": 84, "keys": [
        (0, BASE), (7, SW_ANTIC), (24, SW_RAISE_X), (30, SW_RAISE), (42, SW_HOLD, "in"), (46, SW_SMEAR, "in"), (48, SW_PRESS, "out"),
        (52, SW_OVER), (64, SW_HELD), (84, BASE)],
        "events": [(0, "fx:groundWarning"), (0, "sfx:telegraph"), (48, "summon"), (48, "fx:shake")]},
    # 焦裂按地（150 帧）：起手 0–7（右手往下后方一甩）→ 扬到头顶、上浮后仰 19（过冲）→ 25 → 蓄力顶点 31（五指成爪）→ smear 34 →
    #   释放帧 36（hit：俯冲按掌，下沉 0.66 m）→ 压缩过冲 39 → 掌按在地上推着裂缝走 46–112（出手段）→ 拔掌 120（fx:palmOut，收招开始）→ 起身 → 收 150
    "crackPalm": {"frames": 150, "keys": [
        (0, BASE), (7, CP_ANTIC), (19, CP_RAISE_X), (25, CP_RAISE), (31, CP_HOLD, "in"), (34, CP_SMEAR, "in"), (36, CP_SLAM, "out"),
        (39, CP_SQUASH), (46, SLAM), (80, CP_PRESS2), (112, SLAM, "in"), (120, CP_PULL, "out"), (134, CP_RISE), (150, BASE)],
        "events": [(0, "fx:lineWarning"), (0, "sfx:telegraph"), (36, "hit"), (36, "fx:shake"), (36, "sfx:boss_slam"), (116, "fx:palmOut")]},
    # 飞天之殇（90 帧）：起手 0–8（双臂微张）→ 捧到心口 30 → 含住 46 → smear 52 → 释放帧 54（向两侧上方展开、上浮）→ 过冲 58 → 70 → 收
    "apsaraCall": {"frames": 90, "keys": [
        (0, BASE), (8, AP_ANTIC), (30, AP_CUP), (46, AP_HOLD, "in"), (52, AP_SMEAR, "in"), (54, AP_OPEN, "out"), (58, AP_OVER),
        (70, CALL_OPEN), (90, BASE)],
        "events": [(0, "sfx:telegraph"), (54, "summon"), (54, "fx:shake")]},
    # 日蚀（135 帧）：起手 0–7（含胸捂住心口）→ smear 18 → 释放帧 20（eclipseStart：双臂甩到身后、挺胸露出泉珠）→ 过冲 24 → 颤抖 35–95 →
    #   往里一缩、攥拳 104（fx:gather：强光的前兆，窗口还剩 0.2 s）→ 110 eclipseEnd → smear 116 → 强光 118（flare：双臂上扬、仰天、上浮）→ 过冲 123 → 收
    "eclipse": {"frames": 135, "keys": [(0, BASE), (7, EC_ANTIC, "in"), (18, EC_SMEAR, "in"), (20, EXPOSE, "out"), (24, EC_EXPOSE_X)]
                + [(20 + 15 * k, tremble(k)) for k in range(1, 6)] + [
        (104, EC_GATHER, "in"), (110, EC_GATHER2, "in"), (116, EC_RISE, "in"), (118, EC_FLARE, "out"), (123, EC_FLARE_X), (135, BASE)],
        "events": [(0, "sfx:telegraph"), (20, "eclipseStart"), (104, "fx:gather"), (110, "eclipseEnd"), (118, "flare"), (118, "fx:shake"),
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


# 缓动 → (插值, 缓入缓出)：管从这一帧到下一帧那一段
EASE = {"in": ("QUAD", "EASE_IN"), "out": ("QUAD", "EASE_OUT"), "back": ("BACK", "EASE_OUT"), "lin": ("LINEAR", "AUTO")}


def keys_of(clip: dict) -> list:
    """片段的关键帧统一成 (帧, 姿势, 缓动或 None)"""
    return [(k[0], k[1], k[2] if len(k) > 2 else None) for k in clip["keys"]]


def bake_clip(arm, name: str, clip: dict):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    keys = keys_of(clip)
    bones = sorted({op[0] for _, ops, _ in keys for op in ops})
    moves_hips = any(op[0] == "hips" and op[1] == "loc" for _, ops, _ in keys for op in ops)
    ease = {frame: EASE[e] for frame, _, e in keys if e}
    prev, resolved = {}, []
    for frame, ops, _ in keys:
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
            interp, easing = ease.get(int(round(kp.co.x)), ("BEZIER", "AUTO"))
            kp.interpolation = interp
            kp.easing = easing
            if interp == "BACK":
                kp.back = 1.4
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
    # --out <目录>：试跑时把 FBX 和事件表写到别处（不碰 Unity 工程，编辑器里别的会话不会提前导入半成品）
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else UNITY
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
        export_fbx(arm, act, name, clip["frames"], out / "Keyframed")
        keyposes[name] = resolved
        report[name] = {"seconds": round(clip["frames"] / FPS, 2), "keys": [k[0] for k in clip["keys"]],
                        "events": [[round(f / FPS, 2), n] for f, n in clip["events"]]}
    write_events(out / "SK_Boss_Hanba.events.json")
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
