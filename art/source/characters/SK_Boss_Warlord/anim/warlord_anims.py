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
  feet         {"R": (right, fwd), "L": ...}：脚掌落点相对静止站位的偏移（米），两骨 IK 让脚踩回地面；air = True 时腿按 legs 给的角度悬空
  legs         悬空时的 (大腿前抬, 小腿后屈)（度）
  cape         披风后扬（度）
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


# ───────────── 姿势库（角色坐标；见文件头） ─────────────
def P(**kw) -> dict:
    return kw


BASE = P()
# 横扫：右后蓄刀（拧腰、下沉）→ 刀头从右后绕过身前扫到左前（刃口领先）→ 左下沉刀收势（惩罚窗口）
SWEEP_LOAD = P(drop=0.12, pitch=-4, twist=-20, head=(0, 14), arm_R=(0.6, -0.1, -0.75), fore_R=(0.55, -0.45, -0.6), sword=(0.6, -0.75, -0.15),
               feet={"L": (0, 0.12)})
SWEEP_COCK = P(drop=0.3, pitch=6, twist=-48, roll=-6, head=(-4, 38), arm_R=(0.85, -0.25, -0.1), fore_R=(0.75, -0.6, 0.15), sword=(0.72, -0.58, 0.38),
               edge=(0.6, 0.75, 0), arm_L=(-0.35, 0.8, -0.1), fore_L=(-0.15, 0.95, 0.1), feet={"R": (0.12, -0.3), "L": (-0.05, 0.42)}, cape=8)
SWEEP_COCK_HOLD = dict(SWEEP_COCK, drop=0.34, twist=-53, sword=(0.68, -0.62, 0.4))
SWEEP_SMEAR = P(drop=0.34, pitch=10, twist=-20, head=(0, 18), arm_R=(0.75, 0.35, -0.35), fore_R=(0.75, 0.6, -0.1), sword=(0.92, 0.38, -0.05),
                edge=(-0.38, 0.92, 0), arm_L=(-0.45, 0.5, -0.45), fore_L=(-0.3, 0.6, -0.3), feet={"R": (0.12, -0.32), "L": (-0.05, 0.48)}, cape=4)
SWEEP_HIT = P(drop=0.38, pitch=14, twist=8, head=(2, -6), arm_R=(0.15, 0.9, -0.35), fore_R=(0.0, 1, -0.12), sword=(0.08, 1, -0.12), edge=(-1, 0.1, 0),
              arm_L=(-0.55, -0.4, -0.55), fore_L=(-0.4, -0.5, -0.4), feet={"R": (0.12, -0.35), "L": (-0.05, 0.5)}, cape=-6)
SWEEP_FOLLOW = P(drop=0.3, pitch=18, twist=58, roll=5, head=(4, -42), arm_R=(-0.45, 0.8, -0.3), fore_R=(-0.75, 0.6, -0.1), sword=(-0.9, 0.38, -0.08),
                 edge=(-0.35, -0.92, 0), arm_L=(-0.55, -0.6, -0.4), fore_L=(-0.4, -0.7, -0.2), feet={"R": (0.12, -0.35), "L": (-0.05, 0.5)}, cape=-14)
SWEEP_SETTLE = P(drop=0.32, pitch=20, twist=48, head=(6, -36), arm_R=(-0.35, 0.75, -0.5), fore_R=(-0.6, 0.55, -0.55), sword=(-0.62, 0.62, -0.42),
                 edge=(0, 0, -1), arm_L=(-0.5, -0.5, -0.55), fore_L=(-0.35, -0.5, -0.5), feet={"R": (0.12, -0.35), "L": (-0.05, 0.5)}, cape=-4)
# 反手再扫：从左下拧到左后蓄刀 → 刀头从左后扫到右前
BACK_COCK = P(drop=0.32, pitch=8, twist=62, roll=6, head=(-4, -44), arm_R=(-0.6, 0.55, 0.1), fore_R=(-0.75, -0.35, 0.4), sword=(-0.72, -0.5, 0.48),
              edge=(-0.6, 0.75, 0), arm_L=(-0.6, -0.5, -0.35), fore_L=(-0.5, -0.7, -0.1), feet={"R": (0.12, -0.35), "L": (-0.05, 0.5)}, cape=-10)
BACK_COCK_HOLD = dict(BACK_COCK, twist=66, sword=(-0.68, -0.55, 0.5))
BACK_SMEAR = P(drop=0.35, pitch=10, twist=30, head=(0, -20), arm_R=(-0.3, 0.8, -0.35), fore_R=(-0.7, 0.65, -0.1), sword=(-0.92, 0.38, -0.05),
               edge=(0.38, 0.92, 0), arm_L=(-0.6, -0.5, -0.45), feet={"R": (0.12, -0.35), "L": (-0.05, 0.5)}, cape=-4)
BACK_HIT = P(drop=0.38, pitch=14, twist=-6, head=(2, 6), arm_R=(0.35, 0.85, -0.3), fore_R=(0.15, 1, -0.1), sword=(0.05, 1, -0.1), edge=(1, 0.1, 0),
             arm_L=(-0.6, -0.35, -0.55), feet={"R": (0.12, -0.35), "L": (-0.05, 0.5)}, cape=6)
BACK_FOLLOW = P(drop=0.3, pitch=16, twist=-52, roll=-5, head=(4, 40), arm_R=(0.75, 0.35, -0.3), fore_R=(0.8, 0.35, -0.2), sword=(0.92, 0.35, -0.1),
                edge=(0.35, -0.92, 0), arm_L=(-0.4, 0.5, -0.5), feet={"R": (0.12, -0.35), "L": (-0.05, 0.5)}, cape=14)
BACK_SETTLE = P(drop=0.3, pitch=18, twist=-44, head=(6, 32), arm_R=(0.65, 0.4, -0.5), fore_R=(0.6, 0.45, -0.6), sword=(0.66, 0.6, -0.42), edge=(0, 0, -1),
                arm_L=(-0.4, 0.4, -0.6), feet={"R": (0.12, -0.35), "L": (-0.05, 0.5)}, cape=4)
# 连斩一：袈裟斩（右上 → 左下）
A_LIFT = P(drop=0.1, pitch=-4, twist=-18, head=(0, 12), arm_R=(0.55, 0.35, 0.55), fore_R=(0.45, 0.2, 0.8), sword=(0.5, 0.2, 0.84), edge=(-0.3, 0.9, 0),
           arm_L=(-0.3, 0.85, 0), fore_L=(-0.1, 0.95, 0.2))
A_COCK = P(drop=0.22, pitch=-12, twist=-38, roll=-5, head=(-6, 28), arm_R=(0.55, 0.05, 0.82), fore_R=(0.35, -0.35, 0.87), sword=(0.4, -0.55, 0.73),
           edge=(-0.35, 0.65, 0.65), arm_L=(-0.25, 0.92, 0.1), fore_L=(-0.05, 0.95, 0.25), feet={"R": (0.1, -0.25), "L": (-0.05, 0.35)}, cape=10)
A_COCK_HOLD = dict(A_COCK, pitch=-15, twist=-42, sword=(0.36, -0.62, 0.7))
A_SMEAR = P(drop=0.28, pitch=6, twist=-12, head=(0, 10), arm_R=(0.35, 0.75, 0.45), fore_R=(0.15, 0.95, 0.25), sword=(0.15, 0.92, 0.36),
            edge=(-0.35, 0.3, -0.88), arm_L=(-0.4, 0.4, -0.5), feet={"R": (0.1, -0.28), "L": (-0.05, 0.42)}, cape=2)
A_HIT = P(drop=0.36, pitch=22, twist=24, head=(6, -18), arm_R=(-0.15, 0.85, -0.5), fore_R=(-0.35, 0.8, -0.45), sword=(-0.38, 0.82, -0.42),
          edge=(-0.6, -0.1, -0.8), arm_L=(-0.55, -0.45, -0.55), fore_L=(-0.4, -0.55, -0.45), feet={"R": (0.1, -0.3), "L": (-0.05, 0.48)}, cape=-10)
A_FOLLOW = P(drop=0.34, pitch=26, twist=40, roll=4, head=(8, -30), arm_R=(-0.45, 0.65, -0.6), fore_R=(-0.65, 0.4, -0.6), sword=(-0.8, 0.45, -0.36),
             edge=(-0.3, -0.7, -0.65), arm_L=(-0.6, -0.5, -0.5), feet={"R": (0.1, -0.3), "L": (-0.05, 0.48)}, cape=-12)
# 连斩二：逆袈裟（左下 → 右上）
B_COCK = P(drop=0.32, pitch=12, twist=56, roll=5, head=(0, -40), arm_R=(-0.55, 0.35, -0.6), fore_R=(-0.6, -0.3, -0.5), sword=(-0.55, -0.45, -0.7),
           edge=(0.4, 0.85, 0.3), arm_L=(-0.6, -0.45, -0.5), feet={"R": (0.1, -0.3), "L": (-0.05, 0.48)}, cape=-10)
B_COCK_HOLD = dict(B_COCK, twist=60, sword=(-0.5, -0.55, -0.66))
B_SMEAR = P(drop=0.3, pitch=6, twist=20, head=(0, -12), arm_R=(-0.2, 0.85, -0.35), fore_R=(-0.25, 0.95, -0.1), sword=(-0.3, 0.95, -0.1),
            edge=(0.6, 0.2, 0.75), arm_L=(-0.5, -0.4, -0.6), feet={"R": (0.1, -0.3), "L": (-0.05, 0.48)}, cape=-2)
B_HIT = P(drop=0.22, pitch=-4, twist=-22, head=(-4, 16), arm_R=(0.45, 0.8, 0.25), fore_R=(0.45, 0.75, 0.45), sword=(0.42, 0.72, 0.55),
          edge=(0.55, -0.15, 0.82), arm_L=(-0.5, -0.4, -0.6), feet={"R": (0.1, -0.3), "L": (-0.05, 0.48)}, cape=10)
B_FOLLOW = P(drop=0.18, pitch=-10, twist=-38, roll=-5, head=(-8, 28), arm_R=(0.6, 0.35, 0.7), fore_R=(0.45, 0.1, 0.88), sword=(0.55, -0.05, 0.84),
             edge=(0.3, -0.75, 0.6), arm_L=(-0.45, 0.4, -0.6), feet={"R": (0.1, -0.3), "L": (-0.05, 0.48)}, cape=12)
# 连斩收尾：双手过顶 → 竖劈入地（重、方、斩）
C_COCK = P(drop=-0.04, pitch=-16, head=(-14, 0), grip=(0.05, -0.12, 1.12), sword=(0.04, -0.62, 0.78), edge=(0, 0.78, 0.62),
           grip_L=True, feet={"R": (0.1, -0.25), "L": (-0.05, 0.38)}, cape=14)
C_COCK_HOLD = dict(C_COCK, pitch=-19, sword=(0.03, -0.72, 0.69))
C_SMEAR = P(drop=0.2, pitch=10, head=(0, 0), grip=(0.05, 0.72, 0.7), sword=(0.03, 0.88, 0.47), edge=(0, 0.47, -0.88),
            grip_L=True, feet={"R": (0.1, -0.3), "L": (-0.05, 0.45)}, cape=4)
C_HIT = P(drop=0.5, pitch=34, head=(10, 0), grip=(0.05, 0.85, -0.55), sword=(0.02, 0.8, -0.6), edge=(0, -0.78, -0.62),
          grip_L=True, feet={"R": (0.12, -0.38), "L": (-0.05, 0.55)}, cape=-16)
C_SETTLE = dict(C_HIT, drop=0.54, pitch=36, head=(16, 0), cape=-6)
# 冲锋：后仰蓄力 → 左肩在前的低身冲刺，大剑拖在右后、剑尖犁地（沿途留火）→ 刹停 / 撞墙
CH_REAR = P(drop=0.14, pitch=-12, twist=-16, head=(-8, 12), arm_R=(0.45, -0.55, -0.7), fore_R=(0.4, -0.75, -0.5), sword=(0.35, -0.8, -0.48),
            arm_L=(-0.4, 0.4, 0.3), fore_L=(0.45, 0.5, 0.75), feet={"L": (0, 0.2)})
CH_SET = P(drop=0.38, pitch=28, twist=-32, roll=-4, head=(-26, 30), arm_R=(0.42, -0.6, -0.68), fore_R=(0.35, -0.8, -0.5), sword=(0.3, -0.82, -0.49),
           edge=(0, 0, -1), arm_L=(-0.3, 0.75, 0.25), fore_L=(0.55, 0.55, 0.6), feet={"R": (0.12, -0.42), "L": (-0.08, 0.42)}, cape=16)
CH_SET_HOLD = dict(CH_SET, drop=0.42, pitch=31)
RUN = dict(CH_SET, drop=0.26, pitch=30, head=(-28, 30), cape=24)
CH_STOP = P(drop=0.4, pitch=-12, twist=-10, head=(-4, 8), arm_R=(0.35, 0.55, -0.6), fore_R=(0.3, 0.6, -0.7), sword=(0.3, 0.55, -0.78), edge=(0, 1, 0),
            arm_L=(-0.6, -0.2, 0.1), fore_L=(-0.7, 0.1, 0.4), feet={"R": (0.12, -0.45), "L": (-0.06, 0.7)}, cape=26)
CRASH_HIT = P(drop=0.18, pitch=34, twist=-30, head=(30, 20), arm_R=(0.5, -0.4, -0.7), sword=(0.35, -0.8, -0.48), arm_L=(-0.3, 0.6, 0.4),
              fore_L=(0.5, 0.5, 0.7), feet={"R": (0.12, -0.42), "L": (-0.08, 0.42)})
CRASH_BOUNCE = P(drop=0.05, pitch=-22, twist=-8, roll=8, head=(-30, -14), arm_R=(0.75, -0.25, 0.4), fore_R=(0.7, -0.1, 0.7), sword=(0.6, 0.25, 0.75),
                 arm_L=(-0.75, -0.3, 0.35), fore_L=(-0.7, -0.2, 0.6), feet={"R": (0.12, -0.3), "L": (-0.08, 0.15)}, cape=-16)
CRASH_DAZE = P(drop=0.32, pitch=18, roll=-6, head=(18, 16), arm_R=(0.4, 0.3, -0.85), fore_R=(0.3, 0.4, -0.85), sword=(0.35, 0.55, -0.76),
               arm_L=(-0.35, 0.3, -0.85), feet={"R": (0.15, -0.25), "L": (-0.1, 0.25)})
# 跃击：深蹲 → 拔地而起、大剑过顶 → 空中弓身 → 剑尖朝下下劈 → 落地剑插入地（陨火坠地）
CROUCH_DIP = P(drop=0.2, pitch=12, head=(-10, 0), arm_R=(0.35, -0.2, -0.9), sword=(0.4, 0.3, -0.85), feet={"L": (0, 0.15)})
CROUCH_DEEP = P(drop=0.58, pitch=32, head=(-30, 0), arm_R=(0.4, -0.55, -0.72), fore_R=(0.35, -0.75, -0.55), sword=(0.35, -0.75, -0.55),
                arm_L=(-0.3, -0.6, -0.7), fore_L=(-0.25, -0.7, -0.6), feet={"R": (0.15, -0.2), "L": (-0.1, 0.25)}, cape=10)
CROUCH_HOLD = dict(CROUCH_DEEP, drop=0.62, pitch=34)
LEAP_TAKEOFF = P(drop=-0.15, pitch=-10, head=(-20, 0), grip=(0.05, 0.15, 1.15), sword=(0.08, -0.2, 0.97), edge=(0, 1, 0),
                 grip_L=True, air=True, legs=(-18, 6), cape=-20)
LEAP_TUCK = P(drop=-0.1, pitch=-18, head=(-22, 0), grip=(0.05, -0.12, 1.1), sword=(0.03, -0.8, 0.6), edge=(0, 0.6, 0.8),
              grip_L=True, air=True, legs=(62, 105), cape=20)
LEAP_APEX = dict(LEAP_TUCK, pitch=-22, sword=(0.03, -0.88, 0.47), legs=(68, 112))
LEAP_SWING = P(drop=0, pitch=4, head=(-6, 0), grip=(0.05, 0.72, 0.85), sword=(0.03, 0.82, 0.57), edge=(0, 0.57, -0.82),
               grip_L=True, air=True, legs=(30, 40), cape=26)
LEAP_PLUNGE = P(drop=0, pitch=22, head=(4, 0), grip=(0.05, 0.85, -0.25), sword=(0.02, 0.55, -0.83), edge=(0, -0.83, -0.55),
                grip_L=True, air=True, legs=(14, 18), cape=32)
LAND_HIT = P(drop=0.66, pitch=36, head=(8, 0), grip=(0.05, 0.8, -0.7), sword=(0.03, 0.4, -0.92), edge=(0, -0.92, -0.4),
             grip_L=True, feet={"R": (0.22, -0.32), "L": (-0.18, 0.48)}, cape=-22)
LAND_HOLD = dict(LAND_HIT, drop=0.7, pitch=38, cape=-8)
LAND_RISE = dict(LAND_HIT, drop=0.52, pitch=26, head=(12, 0), cape=0)
# 陨石雨：压剑蓄 → 举剑指天（号令天火）
RAISE_ANT = P(drop=0.26, pitch=16, head=(14, 0), arm_R=(0.4, -0.35, -0.85), fore_R=(0.35, -0.55, -0.75), sword=(0.3, -0.6, -0.74),
              arm_L=(-0.3, 0.3, -0.9), feet={"L": (0, 0.2)})
RAISE_UP = P(drop=-0.05, pitch=-12, head=(-28, 0), arm_R=(0.14, 0.06, 0.99), fore_R=(0.05, 0.04, 1), sword=(0.06, 0.1, 0.99), edge=(1, 0, 0),
             arm_L=(-0.3, 0.6, -0.6), fore_L=(0.75, 0.6, 0.25), feet={"L": (0, 0.2)}, cape=-8)
RAISE_CAST = dict(RAISE_UP, sword=(0.09, 0.16, 0.98), head=(-32, 0))
RAISE_HOLD_A = dict(RAISE_UP, pitch=-10, head=(-26, 3))
RAISE_HOLD_B = dict(RAISE_UP, pitch=-13, head=(-29, -3), sword=(0.04, 0.08, 1))
# 熔铜渠：反握举剑过头 → 单膝跪地、大剑直插入地（引动熔铜渠）
PLANT_UP = P(drop=-0.06, pitch=-10, head=(-12, 0), grip=(0.05, 0.55, 1.1), sword=(0.02, 0.2, -0.98), edge=(1, 0, 0),
             grip_L=True, feet={"L": (0, 0.2)}, cape=-6)
PLANT_HIT = P(drop=0.72, pitch=24, head=(6, 0), grip=(0.05, 0.75, -0.75), sword=(0.02, 0.12, -0.99), edge=(1, 0, 0),
              grip_L=True, feet={"R": (0.1, -0.55), "L": (-0.05, 0.42)}, cape=-18)
PLANT_HOLD = dict(PLANT_HIT, drop=0.74, pitch=26, head=(-4, 0), cape=-4)
# 咆哮（转阶段 / 狂怒换挡）：缩身蓄 → 双臂炸开仰天长啸
ROAR_GATHER = P(drop=0.28, pitch=26, head=(22, 0), arm_R=(0.3, 0.5, -0.8), fore_R=(-0.5, 0.65, 0.1), sword=(0.6, -0.1, -0.79),
                arm_L=(-0.3, 0.5, -0.8), fore_L=(0.5, 0.65, 0.1), feet={"R": (0.1, 0), "L": (-0.1, 0)})
ROAR_OPEN = P(drop=-0.04, pitch=-18, head=(-36, 0), arm_R=(0.92, 0.1, 0.38), fore_R=(0.82, 0.1, 0.56), sword=(0.6, 0.05, 0.8), edge=(0, 1, 0),
              arm_L=(-0.92, 0.1, 0.38), fore_L=(-0.82, 0.2, 0.54), feet={"R": (0.15, 0), "L": (-0.15, 0)}, cape=-28)
ROAR_SHAKE_A = dict(ROAR_OPEN, pitch=-16, head=(-33, 4))
ROAR_SHAKE_B = dict(ROAR_OPEN, pitch=-19, head=(-37, -4))
# 登场下坠：抱身、剑尖朝下（自己就是一颗陨火）
FALL = P(drop=0, pitch=14, head=(10, 0), grip=(0.05, 0.55, -0.3), sword=(0.03, 0.22, -0.97), edge=(1, 0, 0), grip_L=True,
         air=True, legs=(55, 95), cape=40)
FALL_B = dict(FALL, pitch=17, legs=(60, 100), cape=46)
# 受击：上身被打得后仰、剑往外一甩 → 往前一沉 → 回待机
HIT_RECOIL = P(drop=0.06, pitch=-14, roll=5, head=(-18, 6), arm_R=(0.55, 0.1, -0.5), fore_R=(0.6, 0.35, -0.3), sword=(0.55, 0.75, 0.1),
               arm_L=(-0.5, -0.2, -0.6), cape=-12)
HIT_SAG = P(drop=0.16, pitch=10, head=(12, 0), arm_R=(0.35, 0.3, -0.85), sword=(0.4, 0.85, -0.2), cape=6)
# 倒下：中招后仰 → 踉跄、拄剑 → 单膝跪地低头 → 剑滑、向前扑倒
DEATH_RECOIL = P(drop=-0.04, pitch=-24, head=(-30, 0), arm_R=(0.6, -0.55, 0.45), fore_R=(0.6, -0.6, 0.5), sword=(0.5, -0.4, 0.77),
                 arm_L=(-0.6, -0.55, 0.45), fore_L=(-0.6, -0.6, 0.5), feet={"L": (0, -0.1)}, cape=-24)
DEATH_STAGGER = P(drop=0.3, pitch=14, roll=-8, head=(16, 10), arm_R=(0.35, 0.45, -0.82), fore_R=(0.3, 0.45, -0.84), sword=(0.25, 0.4, -0.88),
                  arm_L=(-0.4, 0.2, -0.9), feet={"R": (0.15, 0.1), "L": (-0.1, -0.15)}, cape=6)
DEATH_KNEEL = P(drop=0.86, pitch=20, roll=-4, head=(30, 0), grip=(0.45, 0.65, -0.7), sword=(0.06, 0.2, -0.98), edge=(1, 0, 0),
                arm_L=(-0.25, 0.6, -0.75), fore_L=(-0.1, 0.4, -0.9), feet={"R": (0.1, -0.6), "L": (-0.05, 0.4)}, cape=-4)
DEATH_SLUMP = dict(DEATH_KNEEL, drop=0.92, pitch=30, head=(42, 0), roll=-7)
DEATH_FALL = P(drop=1.3, fwd=0.35, pitch=62, roll=-12, head=(30, -10), arm_R=(0.5, 0.6, -0.6), fore_R=(0.45, 0.6, -0.65), sword=(0.75, 0.6, -0.25),
               arm_L=(-0.4, 0.55, -0.73), fore_L=(-0.3, 0.6, -0.74), feet={"R": (0.1, -0.85), "L": (-0.05, -0.55)}, cape=10)

# ───────────── 片段：frames = 总帧数（30 fps）；keys = [(帧, 姿势)]；events = [(帧, 事件名)]；next = 连段的下一个状态 ─────────────
# 时长对齐招式时间轴（WarlordMoves / WarlordBrain.Act 按实际前摇拉伸 ActScale）：释放帧落在拉伸后的出手时刻
CLIPS = {
    # 横扫（前摇 0.85 s / 二阶段 0.7 s，拉伸到前摇正好播完 → 接 sweep，第 1 帧就是刀到身前）
    "sweepReady": {"frames": 26, "next": "sweep", "keys": [(0, BASE), (7, SWEEP_LOAD), (19, SWEEP_COCK), (26, SWEEP_COCK_HOLD)],
                   "events": [(0, "fx:sectorWarning"), (0, "sfx:telegraph"), (7, "fx:windup")]},
    "sweep": {"frames": 24, "keys": [(0, SWEEP_SMEAR), (2, SWEEP_HIT), (5, SWEEP_FOLLOW), (14, SWEEP_SETTLE), (24, BASE)],
              "events": [(0, "smear"), (1, "hit"), (1, "sfx:blade_swing"), (6, "smearEnd")]},
    # 反手再扫（二阶段：第一扫后 0.2 s 起 0.55 s 蓄、再扫）
    "sweepReady2": {"frames": 17, "next": "sweepBack", "keys": [(0, SWEEP_SETTLE), (11, BACK_COCK), (17, BACK_COCK_HOLD)],
                    "events": [(0, "fx:sectorWarning"), (0, "sfx:telegraph"), (0, "fx:windup")]},
    "sweepBack": {"frames": 24, "keys": [(0, BACK_SMEAR), (2, BACK_HIT), (5, BACK_FOLLOW), (14, BACK_SETTLE), (24, BASE)],
                  "events": [(0, "smear"), (1, "hit"), (1, "sfx:blade_swing"), (6, "smearEnd")]},
    # 连斩：每斩 0.72 s（前 0.5 s 预警 + 蓄、0.5 s 出刀）。片段按 0.84 s 拉伸（WarlordBrain：ComboPer + 0.12），刀到在 15 / 25 = 0.6 → 0.505 s；
    # 片段比 0.72 s 长一截，下一刀的触发器到的时候这一刀还没开始退回待机（退场过渡里 AnyState 触发器进不来，会拖后下一刀）
    "slashA": {"frames": 25, "keys": [(0, BASE), (5, A_LIFT), (11, A_COCK), (13, A_COCK_HOLD), (14, A_SMEAR), (15, A_HIT), (17, A_FOLLOW), (25, A_FOLLOW)],
               "events": [(0, "fx:sectorWarning"), (2, "fx:windup"), (13, "smear"), (15, "hit"), (15, "sfx:blade_swing"), (18, "smearEnd")]},
    "slashB": {"frames": 25, "keys": [(0, A_FOLLOW), (8, B_COCK), (13, B_COCK_HOLD), (14, B_SMEAR), (15, B_HIT), (17, B_FOLLOW), (25, B_FOLLOW)],
               "events": [(0, "fx:sectorWarning"), (2, "fx:windup"), (13, "smear"), (15, "hit"), (15, "sfx:blade_swing"), (18, "smearEnd")]},
    "slashC": {"frames": 25, "keys": [(0, B_FOLLOW), (9, C_COCK), (13, C_COCK_HOLD), (14, C_SMEAR), (15, C_HIT), (17, C_SETTLE), (25, C_SETTLE)],
               "events": [(0, "fx:sectorWarning"), (2, "fx:windup"), (13, "smear"), (15, "hit"), (15, "sfx:blade_swing"), (16, "fx:shake"), (18, "smearEnd")]},
    # 冲锋（前摇 0.9 / 0.75 / 第二冲 0.65 s）→ charge（拖刀奔跑，跟脚步一拍一个火星）→ 刹停 chargeStop / 撞墙 crash
    "chargeReady": {"frames": 27, "next": "charge", "keys": [(0, BASE), (8, CH_REAR), (20, CH_SET), (27, CH_SET_HOLD)],
                    "events": [(0, "fx:lineWarning"), (0, "sfx:telegraph"), (8, "fx:windup"), (20, "step")]},
    "charge": {"frames": 36, "keys": [(0, dict(RUN, feet={"R": (0.12, -0.55), "L": (-0.08, 0.55)})),
                                      (3, dict(RUN, drop=0.32, feet={"R": (0.12, -0.2), "L": (-0.08, 0.25)})),
                                      (6, dict(RUN, drop=0.22, feet={"R": (0.12, 0.55), "L": (-0.08, -0.5)})),
                                      (9, dict(RUN, drop=0.32, feet={"R": (0.12, 0.2), "L": (-0.08, -0.2)})),
                                      (12, dict(RUN, feet={"R": (0.12, -0.55), "L": (-0.08, 0.55)})),
                                      (15, dict(RUN, drop=0.32, feet={"R": (0.12, -0.2), "L": (-0.08, 0.25)})),
                                      (18, dict(RUN, drop=0.22, feet={"R": (0.12, 0.55), "L": (-0.08, -0.5)})),
                                      (21, dict(RUN, drop=0.32, feet={"R": (0.12, 0.2), "L": (-0.08, -0.2)})),
                                      (24, dict(RUN, feet={"R": (0.12, -0.55), "L": (-0.08, 0.55)})),
                                      (27, dict(RUN, drop=0.32, feet={"R": (0.12, -0.2), "L": (-0.08, 0.25)})),
                                      (30, dict(RUN, drop=0.22, feet={"R": (0.12, 0.55), "L": (-0.08, -0.5)})),
                                      (33, dict(RUN, drop=0.32, feet={"R": (0.12, 0.2), "L": (-0.08, -0.2)})),
                                      (36, dict(RUN, feet={"R": (0.12, -0.55), "L": (-0.08, 0.55)}))],
               "events": [(0, "fx:shake"), (1, "hitOpen"), (0, "step"), (6, "step"), (12, "step"), (18, "step"), (24, "step"), (30, "step")]},
    "chargeStop": {"frames": 15, "keys": [(0, dict(RUN, feet={"R": (0.12, -0.3), "L": (-0.08, 0.3)})), (3, CH_STOP), (9, dict(CH_STOP, drop=0.36, pitch=-6)),
                                          (15, dict(CH_STOP, drop=0.24, pitch=2, cape=8))],
                   "events": [(2, "brake"), (2, "sfx:boss_slam")]},
    "crash": {"frames": 30, "keys": [(0, CRASH_HIT), (4, CRASH_BOUNCE), (12, CRASH_DAZE), (20, dict(CRASH_DAZE, head=(14, -18), roll=5)), (30, BASE)],
              "events": [(0, "impact"), (1, "fx:shake"), (1, "sfx:boss_slam")]},
    # 跃击（深蹲 0.48 / 0.38 s → 腾空约 1 s，落地那一刻由 WarlordBrain 触发 land）
    "crouch": {"frames": 15, "next": "leap", "keys": [(0, BASE), (4, CROUCH_DIP), (12, CROUCH_DEEP), (15, CROUCH_HOLD)],
               "events": [(0, "fx:groundWarning"), (0, "sfx:telegraph"), (4, "fx:windup")]},
    "leap": {"frames": 42, "keys": [(0, LEAP_TAKEOFF), (8, LEAP_TUCK), (18, LEAP_APEX), (26, LEAP_SWING), (32, LEAP_PLUNGE), (42, LEAP_PLUNGE)],
             "events": [(0, "sfx:jump"), (0, "takeoff"), (26, "smear")]},
    "land": {"frames": 24, "keys": [(0, LAND_HIT), (3, LAND_HOLD), (14, LAND_RISE), (24, BASE)],
             "events": [(0, "hit"), (0, "fx:shake"), (0, "sfx:boss_slam"), (1, "smearEnd")]},
    # 陨石雨（前摇 0.8 s：拉伸到 cast 正好在前摇结束 = 片段 33%）
    "raise": {"frames": 72, "keys": [(0, BASE), (10, RAISE_ANT), (21, RAISE_UP), (24, RAISE_CAST), (40, RAISE_HOLD_A), (52, RAISE_HOLD_B), (60, RAISE_HOLD_A),
                                     (72, BASE)],
              "events": [(0, "sfx:boss_roar"), (0, "sfx:telegraph"), (10, "fx:windup"), (24, "cast")]},
    # 熔铜渠涨落（前摇 0.45 s：hit 在片段 35%）
    "plant": {"frames": 39, "keys": [(0, BASE), (9, PLANT_UP), (13, dict(PLANT_UP, drop=-0.1, pitch=-13)), (14, PLANT_HIT), (17, PLANT_HOLD),
                                     (30, PLANT_HOLD), (39, BASE)],
              "events": [(0, "sfx:boss_roar"), (4, "fx:windup"), (14, "hit"), (14, "fx:shake"), (14, "sfx:boss_slam")]},
    # 咆哮：转阶段（2.2 s）、登场 70% 处
    "roar": {"frames": 72, "keys": [(0, BASE), (12, ROAR_GATHER), (22, ROAR_OPEN), (30, ROAR_SHAKE_A), (38, ROAR_SHAKE_B), (46, ROAR_SHAKE_A),
                                    (54, ROAR_SHAKE_B), (60, ROAR_OPEN), (72, BASE)],
             "events": [(0, "sfx:boss_roar"), (12, "gather"), (22, "roar"), (22, "fx:shake")]},
    # 受击 / 眩晕（框架在眩晕、硬直时按状态名播 Hit；以前部件骨架没有这个状态，眩晕时报「State could not be found」）
    "Hit": {"frames": 18, "keys": [(0, BASE), (3, HIT_RECOIL), (8, HIT_SAG), (18, BASE)], "events": []},
    "fall": {"frames": 20, "loop": True, "keys": [(0, FALL), (10, FALL_B), (20, FALL)], "events": []},
    "death": {"frames": 96, "keys": [(0, BASE), (6, DEATH_RECOIL), (24, DEATH_STAGGER), (40, DEATH_KNEEL), (70, DEATH_SLUMP), (84, DEATH_FALL),
                                     (96, DEATH_FALL)],
              "events": [(0, "sfx:boss_roar"), (40, "kneel"), (40, "fx:shake"), (84, "collapse"), (84, "fx:shake"), (84, "sfx:boss_slam")]},
}

# 仍用采样片段的状态：事件照旧（关键帧片段的事件由上面的表生成）
SAMPLED_EVENTS = {}


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
            sole = REST_SOLE[s] + Vector((-off[0], -off[1], 0))
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
    """关键帧片段的事件表 + 连段 next；仍用采样的状态（Idle / Walk / Move）沿用原叠加表里的条目"""
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
        clips[name] = e
    doc = {"schema": 1,
           "about": ("熔心魔将的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。招式片段是手工关键帧，本文件和 FBX 都由 "
                     "art/source/characters/SK_Boss_Warlord/anim/warlord_anims.py 生成，别手改；at = 片段内归一化时刻。"
                     "hit = 释放帧（刀到 / 落地 / 插剑；顿帧、震屏、出手特效由招式判定那一刻触发，这个事件用来量动作和判定差几帧），smear / smearEnd = 大剑拖影起止，"
                     "fx:windup = 起手（焰刃开始烧亮），step = 冲锋踏步（拖刀火星），brake = 刹停，impact = 撞墙，takeoff = 起跳，cast = 举剑号令天火，"
                     "gather / roar = 咆哮的缩身 / 炸开，kneel / collapse = 倒下的跪地 / 扑倒；fx:*Warning 只是标注预警从哪一帧画（预警由招式画）"),
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


def render_reviews(arm, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    scene = setup_review(arm)
    files = []
    for name, clip in CLIPS.items():
        for frame, p in clip["keys"]:
            if p is BASE and frame:
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
    arm = load_rig(keep_mesh=review is not None)
    if review:
        render_reviews(arm, review)
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
