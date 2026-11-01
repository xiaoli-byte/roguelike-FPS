"""熔心魔将的关键姿势库 + 片段表（骨架无关的纯数据，不 import bpy）：两个构建器共用——
  warlord_anims.py           旧部件骨架（j_*，新模型落地前的过渡；剑士化 v2 的新片段在它上面只是时机占位）
  warlord_anims_humanoid.py  新模型的人形骨架（2026-11-01 模型路定的骨名 / 挂点；网格出来后按实测骨骼坐标微调）

姿势写法（角色坐标：right = 角色右手方向，fwd = 前，up = 上）见 warlord_anims.py 文件头；两个构建器对同一个姿势字段的解释一致：
  drop / fwd 全身下沉 / 前移，pitch / twist / roll 上身前倾 / 转向左 / 侧弯，hips 髋前倾，head (俯仰, 转头)，yaw 全身绕竖轴转，
  arm_R / fore_R / arm_L / fore_L 四肢方向，grip 右拳 IK 到两肩中点的偏移，sword 剑身方向，edge 剑刃朝向，grip_L 左手握剑柄，
  feet 脚掌落点（IK），air / legs 悬空腿，cape 披风（人形骨架没有披风骨：战裙是弹簧链，忽略）。
片段表：frames / keys / events / next / loop / speed；出手事件的帧位置是定稿的（Unity 侧 WarlordSword.*At 按它拉伸片段），换骨架不改。
设计单：docs/art/vfx/warlord.md（第 13 章剑士化 v2）。
"""
import math

# ───────────── 姿势库（角色坐标；见文件头） ─────────────
def P(**kw) -> dict:
    return kw


# 第二批 B 路（2026-10-31）：底姿换成「双手斜持下段」——采样待机的第 0 帧是单手平端、剑尖直指前方（正面看剑缩成一个点，持剑姿势不对）。
# 现在右拳握在剑格、左手握剑首，双手收在右胯前，剑身从右胯斜指左前下方、剑尖离地约半米：正面看是一道从右胯斜到左下的长对角线。
# 所有招式片段的首尾帧都是这个底姿（和新的待机 / 步态之间过渡不跳）
GUARD = P(drop=0.1, pitch=6, twist=-8, head=(4, 6), grip=(0.22, 0.38, -0.8), sword=(-0.62, 0.6, -0.5), edge=(0, 0.25, -1), grip_L=True,
          feet={"R": (0.1, -0.16), "L": (-0.06, 0.22)}, cape=2)
BASE = GUARD
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

# ───────────── 第二批 B 路：待机 / 慢走 / 疾行（双手持大剑）、登场落地停顿 ─────────────
# 待机：两次呼吸（吸：身子微起、剑尖抬一点）+ 一次重心换到右腿、头往右扫一眼，3 s 一循环
GUARD_IN = dict(GUARD, drop=0.06, pitch=4, head=(2, 6), sword=(-0.6, 0.62, -0.46), cape=0)
GUARD_SHIFT = dict(GUARD, drop=0.13, pitch=7, twist=-14, roll=2, head=(6, 16), sword=(-0.62, 0.58, -0.53), cape=4)
# 疾行的持剑：双手把剑斜举在身前（剑身从右胯斜指左上方、刃朝前）——正面看是一道越过左肩的大斜线，冲过来的读感
CARRY = dict(grip=(0.18, 0.4, -0.5), sword=(-0.55, 0.32, 0.77), edge=(0, 1, 0), grip_L=True)
# 登场落地：单膝跪地、双手握剑插进身前地里、低头（停顿）→ 抬头怒视（角盔对着玩家）→ 起身到咆哮的缩身姿势（咆哮从那一帧接着播）
IL_IMPACT = P(drop=0.92, pitch=30, roll=-4, head=(24, 0), grip=(0.08, 0.62, -0.22), sword=(0.04, 0.72, -0.69), edge=(1, 0, 0), grip_L=True,
              feet={"R": (0.12, -0.62), "L": (-0.06, 0.45)}, cape=10)
# 披风挂在上身上：上身前压 pitch 度时披风跟着往后翘 pitch 度，cape = pitch 才是自然下垂。落地那一下披风还被下坠的风掀着（翘 20–30°），停顿里落下来、略过头再回
IL_SQUASH = dict(IL_IMPACT, drop=1.0, pitch=34, head=(30, 0), cape=4)
IL_HOLD = dict(IL_IMPACT, drop=0.96, pitch=32, head=(28, 0), cape=28)
IL_HOLD_B = dict(IL_IMPACT, drop=0.95, pitch=31, head=(26, 2), cape=33)
IL_GLARE = dict(IL_IMPACT, drop=0.88, pitch=22, head=(-12, 0), cape=20)


def step_pose(phi: float, base: dict, stride: float, lift: float, beta: float, drop: float, bob: float, twist: float, twist_amp: float,
              pitch: float, cape: float, swing: float) -> dict:
    """
    步态第 phi（0–1）处的姿势：右脚 phi = 0 落地（踩在前方 stride 米）、左脚晚半拍；支撑段（beta）脚掌匀速往后滑到 -stride（= 身体匀速前进），
    摆动段抬脚 lift 米、余弦缓动回到前方。上身：支撑中段最低（drop + bob）、一个周期起伏两次；肩反拧（右脚在前时上身往右拧）、头反向找平；
    披风滞后起伏；剑随步子上下点一点（swing）
    """
    feet = {}
    for side, off in (("R", 0.0), ("L", 0.5)):
        psi = (phi - off) % 1.0
        if psi < beta:
            fwd, up = stride - 2 * stride * psi / beta, 0.0
        else:
            u = (psi - beta) / (1 - beta)
            fwd, up = -stride + 2 * stride * (0.5 - 0.5 * math.cos(math.pi * u)), lift * math.sin(math.pi * u)
        feet[side] = (0.0, fwd, up)
    c2 = math.cos(4 * math.pi * (phi - beta / 2))
    tw = twist - twist_amp * math.cos(2 * math.pi * phi)
    sw = base["sword"]
    sword = (sw[0], sw[1], sw[2] + swing * math.cos(4 * math.pi * (phi - beta / 2 - 0.08)))
    return dict(base, drop=drop + bob * c2, pitch=pitch + 1.5 * c2, twist=tw, roll=2.5 * math.sin(2 * math.pi * phi),
                head=(base.get("head", (0, 0))[0] - 1.5 * c2, -0.6 * (tw - twist)), sword=sword, feet=feet,
                cape=cape + 5 * math.cos(4 * math.pi * (phi - beta / 2 - 0.12)))


def gait_clip(frames: int, speed: float, **kw) -> dict:
    keys = [(f, step_pose(f / frames, **kw)) for f in range(0, frames + 1, 2)]
    if keys[-1][0] != frames:
        keys.append((frames, keys[0][1]))
    # 脚步声在两次落地（右脚 phi = 0、左脚 0.5）
    return {"frames": frames, "loop": True, "speed": speed, "keys": keys, "events": [(0.5, "sfx:footstep"), (frames / 2 + 0.5, "sfx:footstep")]}


# ── 剑士化 v2 的时机占位姿势（旧部件骨架上粗摆，不精修；新骨架落地后重写）──
# 居合：剑收到左腰后（拔刀式）→ 深蹲按刀 → 拔刀突进（smear）→ 剑横在右侧（拔出）→ 缓缓纳刀 → 「咔」
IAI_LOAD = P(drop=0.16, pitch=10, twist=20, head=(-4, -14), grip=(-0.28, 0.12, -0.82), sword=(-0.3, -0.9, -0.3), edge=(0, 0, 1), grip_L=True,
             feet={"R": (0.12, -0.2), "L": (-0.08, 0.3)}, cape=4)
IAI_SET = P(drop=0.4, pitch=24, twist=34, roll=4, head=(-14, -30), grip=(-0.35, 0.05, -0.85), sword=(-0.25, -0.95, -0.2), edge=(0, 0, 1), grip_L=True,
            feet={"R": (0.15, -0.3), "L": (-0.1, 0.45)}, cape=8)
IAI_SET_HOLD = dict(IAI_SET, drop=0.43, twist=36)
IAI_SMEAR = P(drop=0.3, pitch=14, twist=0, head=(-6, 0), grip=(0.1, 0.5, -0.4), sword=(0.3, 0.9, 0.1), edge=(1, 0, 0),
              feet={"R": (0.15, -0.45), "L": (-0.1, 0.55)}, cape=20)
IAI_DRAWN = P(drop=0.34, pitch=12, twist=-40, roll=-4, head=(-2, 30), arm_R=(0.9, 0.3, -0.1), fore_R=(0.95, 0.25, 0), sword=(0.95, 0.2, 0.05),
              edge=(0, -1, 0), arm_L=(-0.4, 0.6, -0.5), fore_L=(-0.3, 0.7, -0.4), feet={"R": (0.15, -0.45), "L": (-0.1, 0.55)}, cape=-10)
IAI_SHEATHE = P(drop=0.32, pitch=16, twist=10, head=(4, 8), grip=(-0.3, 0.15, -0.8), sword=(-0.3, -0.9, -0.25), edge=(0, 0, 1), grip_L=True,
                feet={"R": (0.15, -0.4), "L": (-0.1, 0.5)}, cape=-4)
IAI_CLICK = dict(IAI_SHEATHE, drop=0.36, pitch=20, head=(8, 4), sword=(-0.25, -0.95, -0.15))
# 剑气：举过头顶竖劈出去（不劈进地里，剑停在身前偏下）
WAVE_HIT = P(drop=0.3, pitch=22, head=(4, 0), grip=(0.05, 0.9, -0.2), sword=(0.02, 0.95, -0.3), edge=(0, -0.3, -0.95), grip_L=True,
             feet={"R": (0.12, -0.3), "L": (-0.06, 0.45)}, cape=-8)
WAVE_FOLLOW = dict(WAVE_HIT, drop=0.32, pitch=26, sword=(0.02, 0.7, -0.7), cape=-4)
# 突刺：剑往右胯后收、剑尖朝前（拉满）→ 低身压上 → 剑尖在前的奔跑 → 刹住
TH_REAR = P(drop=0.15, pitch=-6, twist=-25, head=(-6, 22), grip=(0.35, -0.15, -0.55), sword=(0.05, 1, 0.05), edge=(0, 0, 1), grip_L=True,
            feet={"R": (0.12, -0.25), "L": (-0.08, 0.3)}, cape=6)
TH_SET = P(drop=0.42, pitch=26, twist=-30, roll=-3, head=(-24, 28), grip=(0.4, -0.2, -0.6), sword=(0.0, 1, 0.08), edge=(0, 0, 1), grip_L=True,
           feet={"R": (0.12, -0.45), "L": (-0.08, 0.5)}, cape=12)
TH_SET_HOLD = dict(TH_SET, drop=0.45, pitch=28)
TH_RUN = dict(TH_SET, drop=0.28, pitch=30, twist=-12, head=(-28, 12), grip=(0.15, 0.75, -0.35), sword=(0, 1, 0.05), cape=26)
TH_STOP = P(drop=0.4, pitch=-10, twist=-6, head=(-4, 6), grip=(0.1, 0.6, -0.5), sword=(0.1, 0.8, -0.6), edge=(0, 0, -1), grip_L=True,
            feet={"R": (0.12, -0.3), "L": (-0.08, 0.45)}, cape=10)
# 连斩上挑：剑拖到右后下方 → 从下往上撩到左上 → 举过头顶（接下劈）
UP_COCK = P(drop=0.38, pitch=22, twist=-30, head=(-10, 24), grip=(0.4, -0.1, -0.85), sword=(0.35, -0.6, -0.72), edge=(0, 0.5, 0.86), grip_L=True,
            feet={"R": (0.12, -0.3), "L": (-0.06, 0.4)}, cape=6)
UP_COCK_HOLD = dict(UP_COCK, drop=0.42, pitch=25)
UP_SMEAR = P(drop=0.25, pitch=6, twist=-8, head=(-8, 8), grip=(0.15, 0.6, -0.3), sword=(0.05, 0.92, 0.38), edge=(0, 0.38, 0.92), grip_L=True,
             feet={"R": (0.12, -0.3), "L": (-0.06, 0.45)}, cape=2)
UP_HIT = P(drop=0.05, pitch=-14, twist=8, head=(-24, 0), grip=(0, 0.5, 0.9), sword=(-0.05, 0.4, 0.92), edge=(0, -0.92, 0.4), grip_L=True,
           feet={"R": (0.12, -0.3), "L": (-0.06, 0.45)}, cape=-6)
UP_FOLLOW = P(drop=-0.02, pitch=-16, head=(-14, 0), grip=(0.05, 0.1, 1.1), sword=(0.03, -0.62, 0.78), edge=(0, 0.78, 0.62), grip_L=True,
              feet={"R": (0.12, -0.3), "L": (-0.06, 0.45)}, cape=-2)


def run_keys(pose: dict, frames: int, step: int = 6) -> list:
    """剑尖在前的奔跑：每 step 帧一步（同 charge 的步点）"""
    feet = [{"R": (0.12, -0.55), "L": (-0.08, 0.55)}, {"R": (0.12, -0.2), "L": (-0.08, 0.25)},
            {"R": (0.12, 0.55), "L": (-0.08, -0.5)}, {"R": (0.12, 0.2), "L": (-0.08, -0.2)}]
    keys = []
    for i, f in enumerate(range(0, frames + 1, step // 2)):
        keys.append((f, dict(pose, drop=pose["drop"] + (0.06 if i % 2 else 0), feet=feet[i % 4])))
    return keys


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
    # ── 第二批 B 路 ──
    # 待机（3 s 循环）：替换采样待机（单手平端、剑尖直指前方）
    "Idle": {"frames": 90, "loop": True, "keys": [(0, GUARD), (22, GUARD_IN), (45, GUARD), (67, GUARD_SHIFT), (90, GUARD)], "events": []},
    # 慢走 2.3 m/s（26 帧一个周期、步长 1.2 m，支撑 60%）：斜持下段，剑尖随步子起伏；原地转身时混合树也播它（小碎步）
    "Walk": gait_clip(26, 2.3, base=GUARD, stride=0.6, lift=0.22, beta=0.6, drop=0.17, bob=0.04, twist=-8, twist_amp=7, pitch=8, cape=0, swing=0.05),
    # 疾行 4.6 m/s（22 帧、步长 1.32 m，支撑 42%：有腾空）：双手斜举、上身前压 14°、披风后扬
    "Move": gait_clip(22, 4.6, base=dict(GUARD, head=(-2, 0), **CARRY), stride=0.66, lift=0.32, beta=0.42, drop=0.24, bob=0.07, twist=-12,
                      twist_amp=9, pitch=14, cape=-10, swing=0.06),
    # 登场落地的停顿（0.8 s，按「落地 → 咆哮」的间隔拉伸）：f0 落地单膝跪地插剑（hit）→ f3 再一沉 → f9 / f14 停住、披风落下 → f18 抬头怒视（glare）→
    # f24 起身到咆哮的缩身姿势（WarlordBrain 让咆哮从缩身那一帧接着播）
    "introLand": {"frames": 24, "keys": [(0, IL_IMPACT), (3, IL_SQUASH), (9, IL_HOLD), (14, IL_HOLD_B), (18, IL_GLARE), (24, ROAR_GATHER)],
                  "events": [(0, "hit"), (1, "smearEnd"), (18, "glare")]},
    # ── 剑士化 v2（时机占位：帧位置 = WarlordSword.*At，新骨架重写时不变）──
    # 居合 48 帧：第 24 帧拔刀突进（dash）、第 36 帧收刀「咔」= 刀光现形（hit）；整段按「按刀 + 突进 + 纳刀」拉伸
    "iai": {"frames": 48, "keys": [(0, BASE), (6, IAI_LOAD), (18, IAI_SET), (22, IAI_SET_HOLD), (24, IAI_SMEAR), (26, IAI_DRAWN), (30, dict(IAI_DRAWN, twist=-46)),
                                   (34, IAI_SHEATHE), (36, IAI_CLICK), (48, BASE)],
            "events": [(0, "fx:lineWarning"), (6, "fx:windup"), (23, "smear"), (24, "dash"), (24, "sfx:blade_swing"), (27, "smearEnd"),
                       (36, "hit")]},
    # 一道竖剑气 30 帧：第 19 帧出手
    "waveSlash": {"frames": 30, "keys": [(0, BASE), (6, A_LIFT), (14, C_COCK), (17, C_COCK_HOLD), (18, C_SMEAR), (19, WAVE_HIT), (22, WAVE_FOLLOW), (30, BASE)],
                  "events": [(0, "fx:lineWarning"), (4, "fx:windup"), (18, "smear"), (19, "hit"), (19, "sfx:blade_swing"), (22, "smearEnd")]},
    # 横竖两刀 40 帧：第 15 帧横斩（hit，横剑气）、第 23 帧竖劈（impact，竖剑气）
    "waveCross": {"frames": 40, "keys": [(0, BASE), (8, SWEEP_LOAD), (13, SWEEP_COCK_HOLD), (14, SWEEP_SMEAR), (15, SWEEP_HIT), (18, SWEEP_FOLLOW), (21, C_COCK),
                                         (22, C_SMEAR), (23, WAVE_HIT), (26, WAVE_FOLLOW), (40, BASE)],
                  "events": [(0, "fx:lineWarning"), (6, "fx:windup"), (14, "smear"), (15, "hit"), (15, "sfx:blade_swing"), (17, "smearEnd"),
                             (22, "smear"), (23, "impact"), (23, "sfx:blade_swing"), (26, "smearEnd")]},
    # 突刺：前摇（拉伸到前摇正好播完 → 接 thrust）→ 剑尖在前的突进（按跑程定长）→ 刹住转身收刀横斩（第 12 帧刀到）
    "thrustReady": {"frames": 24, "next": "thrust", "keys": [(0, BASE), (8, TH_REAR), (18, TH_SET), (24, TH_SET_HOLD)],
                    "events": [(0, "fx:lineWarning"), (8, "fx:windup")]},
    "thrust": {"frames": 24, "keys": run_keys(TH_RUN, 24), "events": [(0, "fx:shake"), (0, "step"), (6, "step"), (12, "step"), (18, "step")]},
    "thrustCut": {"frames": 27, "keys": [(0, TH_STOP), (5, SWEEP_COCK), (10, SWEEP_COCK_HOLD), (11, SWEEP_SMEAR), (12, SWEEP_HIT), (15, SWEEP_FOLLOW),
                                         (21, SWEEP_SETTLE), (27, BASE)],
                  "events": [(0, "fx:sectorWarning"), (11, "smear"), (12, "hit"), (12, "sfx:blade_swing"), (15, "smearEnd")]},
    # 回旋斩 36 帧：第 18 帧刀扫过正前方（hit），全身绕一圈；二连 54 帧：第 18 / 32 帧（hit / impact），绕两圈
    "spin": {"frames": 36, "keys": [(0, BASE), (8, dict(SWEEP_COCK, yaw=-25)), (16, dict(SWEEP_COCK_HOLD, yaw=-35)), (17, dict(SWEEP_SMEAR, yaw=20)),
                                    (18, dict(SWEEP_HIT, yaw=80)), (21, dict(SWEEP_FOLLOW, yaw=200)), (24, dict(SWEEP_FOLLOW, yaw=300)),
                                    (27, dict(SWEEP_SETTLE, yaw=360)), (36, dict(BASE, yaw=360))],
             "events": [(0, "fx:groundWarning"), (8, "fx:windup"), (16, "smear"), (18, "hit"), (18, "sfx:blade_swing"), (24, "smearEnd")]},
    "spinTwice": {"frames": 54, "keys": [(0, BASE), (8, dict(SWEEP_COCK, yaw=-25)), (16, dict(SWEEP_COCK_HOLD, yaw=-35)), (17, dict(SWEEP_SMEAR, yaw=20)),
                                         (18, dict(SWEEP_HIT, yaw=80)), (21, dict(SWEEP_FOLLOW, yaw=200)), (24, dict(SWEEP_FOLLOW, yaw=300)),
                                         (27, dict(SWEEP_COCK, yaw=380)), (30, dict(SWEEP_SMEAR, yaw=430)), (32, dict(SWEEP_HIT, yaw=520)),
                                         (35, dict(SWEEP_FOLLOW, yaw=640)), (38, dict(SWEEP_SETTLE, yaw=720)), (54, dict(BASE, yaw=720))],
                  "events": [(0, "fx:groundWarning"), (8, "fx:windup"), (16, "smear"), (18, "hit"), (18, "sfx:blade_swing"),
                             (25, "smearEnd"), (30, "smear"), (32, "impact"), (32, "sfx:blade_swing"), (38, "smearEnd")]},
    # 连斩上挑 25 帧：第 15 帧刀到（同 slashA / B / C），收在头顶（接下劈）
    "slashUp": {"frames": 25, "keys": [(0, B_FOLLOW), (8, UP_COCK), (13, UP_COCK_HOLD), (14, UP_SMEAR), (15, UP_HIT), (17, UP_FOLLOW), (25, UP_FOLLOW)],
                "events": [(0, "fx:sectorWarning"), (2, "fx:windup"), (13, "smear"), (15, "hit"), (15, "sfx:blade_swing"), (18, "smearEnd")]},
}

# 仍用采样片段的状态：事件照旧（关键帧片段的事件由上面的表生成）
SAMPLED_EVENTS = {}
# 只在审核图里渲的对照姿势（不导出）：改前的底姿 = 采样待机第 0 帧（单手平端、剑尖直指前方）
REVIEW_EXTRA = {"sampledIdle0": {"frames": 0, "keys": [(0, P())], "events": []}}
