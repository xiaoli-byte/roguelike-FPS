"""鲲（SK_Boss_Kun）的手工关键帧（K 路「首领与精英动作 · 特效调优」，第二批 A 路补潜袭 / 吐冰）：Blender 无头脚本，一次生成全部片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Kun/anim/kun_anims.py -- [--out <目录>] [--review <poses.json>] [--preview <目录>]

产出（FBX 按 unity/.gitignore 不入库，可重新生成）：
  unity/Assets/Art/Characters/SK_Boss_Kun/Anim/Keyframed/<状态>.fbx   slamWind、slam、inhale、bite、sink、erupt、spit（同名覆盖 E5 的采样片段）
  unity/Assets/Art/Characters/SK_Boss_Kun/Anim/SK_Boss_Kun.events.json   只改写这七个状态的条目（事件 / 连段 next），其余状态保持手写的样子
  --out <目录>       FBX 改写到别处（试 K 时不碰 Unity）
  --review           每段关键姿势解算成 [骨, 轴, 角度]，给 art/tools/review_native_creature.py 算拉伸
  --preview <目录>   关键姿势的 Workbench 侧视 / 3/4 前视截图（shots.json）
写法、坐标、root 宿主运动见 kunpeng_keys.py；设计单（节拍、关键姿势、和特效的对齐）见 docs/art/vfx/kunpeng.md。

每个关键姿势都量两条硬约束（打印 KUN_CHECK）：
  · 平切口（模型原点所在的平面，冰线以下不建模）一圈最高点要压在水面下 0.3 m 以上（KunPengMath.CutCeiling 的同一条约束，
    boss-kunpeng 冒烟按 −0.15 m 判不合格）：root 后仰时前缘翘起、前倾时后缘翘起，所以「人立」靠脊椎后弯、不靠 root 抬高；
  · 冰沿外（模型前方 3.54 个单位 = kunInset 4.6 m 以外）的网格不钻进环台地面（离地 ≥ −0.15 m）：猛砸、扑咬是头「砸在」环台上，不是插进去。
潜袭（sink / erupt）的沉浮不在片段里，是 KunDive 按时间写的 Sunk（0 = 露出水面，1 = 沉下去 13 m）：两条约束都按那一刻的 Sunk 量
（沉下去以后整只在环台地面以下，冰沿外的网格看不见，只量还露在地面以上的那部分），另外打印头顶离水面多高（破冰那几帧头要出水）。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kunpeng_keys as kk  # noqa: E402
from kunpeng_keys import X, Y, Z  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

ASSET = "SK_Boss_Kun"
UNITY = kk.ROOT / f"unity/Assets/Art/Characters/{ASSET}/Anim"
SCALE = 1.3
FLOOR = 14.0 / SCALE           # 环台地面在模型原点上方多少个模型单位（KunSunkY = −14 m）
WATER = (14.0 + 0.06) / SCALE  # 水面（Three.js 海面在地面上 0.06 m）
RIM_Y = -4.6 / SCALE           # 冰沿：模型前方 kunInset = 4.6 m
CUT = [(0, 3.0), (0, -2.8), (2.8, 0), (-2.8, 0), (2.0, 2.0), (-2.0, 2.0), (2.0, -2.0), (-2.0, -2.0)]  # 平切口一圈（Blender x, y；-y = 前）


def mirror(ops):
    """左右成对：只写 _L，右边绕 Y / Z 的角度取反"""
    out = []
    for b, ax, v in ops:
        out.append([b, ax, v])
        if "_L" in b:
            rv = -v if ax in (Y, Z) else v
            out.append([b.replace("_L", "_R"), ax, rv])
    return out


# 鳍的外张 / 前后摆都压在 ±23° 以内：外张超过约 25° 时鳍根的几片网格会被拉成细刺（review_native_creature 的拉伸 p99 > 2）
def body(root=0.0, lift=0.0, s1=0.0, s2=0.0, s3=0.0, head=0.0, fin=(0, 0), barbel=(0.0, 0.0, 0.0), roll=0.0, turn=0.0):
    """root 俯仰 / 升降（模型单位）/ 横滚、脊椎三节 + 头俯仰（+ 前倾低头，− 后仰抬头）、鳍（外张, 前后）、须（三节前后摆）"""
    ops = []
    if lift:
        ops.append(["root", "loc", [0, 0, lift]])
    if root:
        ops.append(["root", X, root])
    if roll:
        ops.append(["root", Y, roll])
    if turn:
        ops.append(["spine_2", Z, turn])
    for b, v in (("spine_1", s1), ("spine_2", s2), ("spine_3", s3), ("head", head)):
        if v:
            ops.append([b, X, v])
    fo, fb = fin
    ops += mirror([["fin_L", Y, fo], ["fin_L", X, fb]])
    for k, v in enumerate(barbel):
        if v:
            ops += mirror([[f"barbel_L_{k + 1}", X, v]])
    return [op for op in ops if not (op[1] != "loc" and abs(op[2]) < 1e-6)]


def K(clip, frame, ops):
    return (clip, frame, ops)


# ───────────── 潜袭的沉浮（KunDive.SunkAt 的同一条曲线，只用来量约束）─────────────
DIVE_SINK = (0.15, 0.8)     # 起手 0.15 s 后往下沉，0.8 s 沉到底（EaseInOut）
DIVE_BREACH = (1.6, 1.9)    # 1.6 s 破水而出（breach 事件），1.9 s 升到顶（1 − EaseOutCubic）；2.0 s 扑咬（erupt 第 1 帧 hit）
DIVE_WINDUP = 2.0


def _span(t, a, b):
    return min(1.0, max(0.0, (t - a) / (b - a))) if b > a else (1.0 if t >= b else 0.0)


def _ease_in_out(t):
    return 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2


def dive_sunk(t):
    """KunDive.SunkAt：秒 → 0（露出）… 1（沉到底）"""
    if t < DIVE_BREACH[0]:
        return _ease_in_out(_span(t, *DIVE_SINK))
    return 1 - (1 - (1 - _span(t, *DIVE_BREACH)) ** 3)


# ───────────── 片段 ─────────────
# 底姿取采样待机第 0 帧（root 已抬 10 个单位、微后仰 4°），所有增量都相对它。时长与招式段表一致：
#   slamWind = 猛砸前摇 1.1 s（33 帧，最后 4 帧是下砸的拖影帧），slam = 出手 0.85 + 收招 0.55 = 1.4 s（42 帧，第 1 帧 hit：头砸到环台）；
#   inhale = 吞吸前摇 0.9 + 出手 3.0 = 3.9 s（117 帧），bite = 收招 0.7 s（21 帧，第 1 帧 hit：一口咬合，和收招开始时的判定差 1 帧）。
I = "Idle"
CLIPS = {
    # 猛砸 · 起手 → 人立蓄力（脊椎后弯、仰头、鳍张开，须往前甩）→ 蓄力顶点颤一下 → 下砸拖影
    "slamWind": {"frames": 33, "next": "slam", "keys": [
        (0, K(I, 0, [])),
        (7, K(I, 0, body(root=-3, lift=-0.1, s1=-3, s2=-6, s3=-7, head=-9, fin=(7, -4.5), barbel=(-10, -6, -4)))),
        (19, K(I, 0, body(root=-8, lift=-0.3, s1=-6, s2=-12, s3=-14, head=-24, fin=(19.6, -12), barbel=(-22, -14, -10)))),
        (25, K(I, 0, body(root=-9, lift=-0.32, s1=-6, s2=-13, s3=-15, head=-27, fin=(22.4, -13.5), barbel=(-26, -16, -12), roll=1.5))),
        (29, K(I, 0, body(root=2, lift=-0.25, s1=-2, s2=-4, s3=-2, head=-8, fin=(18.2, -18), barbel=(-30, -20, -14)))),
        (33, K(I, 0, body(root=17, lift=-0.5, s1=3, s2=5, s3=6, head=8, fin=(9.8, -22.5), barbel=(-34, -24, -18)))),
    ], "events": [(0, "fx:groundWarning"), (8, "sfx:boss_roar"), (19, "apex")]},
    # 猛砸 · 释放帧（头砸上环台、鳍和须甩到前面）→ 压一下回弹 → 趴着（0.85 s 输出窗口，鲛珠离地最近）→ 撑起、往后仰过头一点 → 待机
    "slam": {"frames": 42, "keys": [
        (0, K(I, 0, body(root=27, lift=-0.75, s1=4, s2=5, s3=4, head=6, fin=(5.6, 12), barbel=(18, 14, 10)))),
        (2, K(I, 0, body(root=29, lift=-0.85, s1=4, s2=6, s3=5, head=8, fin=(2.8, 18), barbel=(26, 22, 16)))),
        (6, K(I, 0, body(root=26, lift=-0.72, s1=3, s2=5, s3=4, head=5, fin=(7, -3), barbel=(4, -6, -8)))),
        (12, K(I, 0, body(root=27, lift=-0.78, s1=4, s2=5, s3=4, head=6, fin=(5.6, 3), barbel=(10, 6, 4)))),
        (25, K(I, 0, body(root=26.5, lift=-0.76, s1=4, s2=5, s3=4, head=7, fin=(7, 1.5), barbel=(8, 6, 4), roll=1))),
        (29, K(I, 0, body(root=28, lift=-0.82, s1=5, s2=6, s3=5, head=9, fin=(4.2, 4.5), barbel=(10, 8, 6)))),
        (36, K(I, 0, body(root=-3, lift=-0.1, s1=-2, s2=-3, s3=-4, head=-8, fin=(2.8, -7.5), barbel=(-12, -10, -6)))),
        (42, K(I, 0, [])),
    ], "events": [(0, "hit"), (0, "fx:shake"), (0, "sfx:boss_slam"), (14, "wave2"), (29, "pushOff")]},
    # 吞吸 · 起手（抽身仰头、鳃鳍张开吸气）→ 0.9 s 出手：低头张口对准扇形，身子随气流左右摆、鳍抖；3.5 s 往后收头蓄咬 → 结尾前冲拖影
    "inhale": {"frames": 117, "next": "bite", "keys": [
        (0, K(I, 0, [])),
        (12, K(I, 0, body(root=-4, lift=-0.15, s2=-5, s3=-7, head=-16, fin=(15.4, -7.5), barbel=(-12, -8, -6)))),
        (22, K(I, 0, body(root=-5, lift=-0.18, s2=-6, s3=-8, head=-19, fin=(18.2, -9), barbel=(-14, -10, -8)))),
        (30, K(I, 0, body(root=6, lift=-0.2, s2=3, s3=4, head=9, fin=(11.2, 9), barbel=(14, 10, 8)))),
        (45, K(I, 0, body(root=7, lift=-0.22, s2=3, s3=5, head=10, fin=(14, 12), barbel=(18, 14, 10), roll=-2.5))),
        (60, K(I, 0, body(root=7, lift=-0.22, s2=4, s3=5, head=11, fin=(9.8, 7.5), barbel=(16, 12, 10), roll=2.5))),
        (75, K(I, 0, body(root=7.5, lift=-0.24, s2=3, s3=5, head=10, fin=(14.7, 12.8), barbel=(20, 14, 12), roll=-2.5))),
        (90, K(I, 0, body(root=7, lift=-0.22, s2=4, s3=5, head=11, fin=(9.8, 7.5), barbel=(16, 12, 10), roll=2))),
        (105, K(I, 0, body(root=-3, lift=-0.15, s2=-4, s3=-6, head=-12, fin=(16.8, -6), barbel=(-10, -8, -6)))),
        (112, K(I, 0, body(root=-4, lift=-0.16, s2=-5, s3=-7, head=-14, fin=(18.2, -7.5), barbel=(-14, -10, -8)))),
        (117, K(I, 0, body(root=12, lift=-0.35, s2=4, s3=4, head=10, fin=(8.4, -15), barbel=(-18, -14, -10)))),
    ], "events": [(0, "fx:sectorWarning"), (0, "sfx:telegraph"), (27, "suctionStart"), (93, "fx:groundWarning"), (105, "biteWind")]},
    # 扑咬 · 释放帧（第 1 帧：头扎到冰沿外、一口咬合；第 3 帧压实）→ 回弹 → 撑回待机
    "bite": {"frames": 21, "keys": [
        (0, K(I, 0, body(root=20, lift=-0.55, s2=4, s3=4, head=9, fin=(7, -9), barbel=(-12, -10, -8)))),
        (1, K(I, 0, body(root=23, lift=-0.62, s1=3, s2=5, s3=5, head=11, fin=(4.2, 12), barbel=(16, 12, 8)))),
        (3, K(I, 0, body(root=24, lift=-0.66, s1=3, s2=6, s3=5, head=12, fin=(2.8, 16.5), barbel=(24, 20, 14)))),
        (8, K(I, 0, body(root=19, lift=-0.5, s1=2, s2=4, s3=3, head=6, fin=(7, -4.5), barbel=(4, -4, -6)))),
        (21, K(I, 0, body(root=3, lift=-0.05, head=2, fin=(2.8, 0)))),
    ], "events": [(1, "hit"), (1, "fx:shake"), (1, "sfx:enemy_melee")]},

    # ───── 潜袭（第二批 A 路）：sink = 整段前摇 2.0 s（60 帧），erupt = 出手 0.3 + 收招 0.7 s（30 帧）；沉浮由 KunDive 按时间写（dive_sunk）─────
    # 起手（吸一口气、往后一抽、鳍张开）→ 下潜（侧身一拧、横滚着一头扎进水里，鳍贴身、须被水往后拖）→ 潜游（水下，看不见；身子 S 形摆）
    #   → 1.6 s 破水而出（breach：竖着往上冲、鳍贴身、须往下拖）→ 1.8 s 出水到顶人立（仰头、鳍张开、须甩到前面）→ 最后 4 帧往前下砸的拖影
    "sink": {"frames": 60, "next": "erupt", "sunk": dive_sunk, "keys": [
        (0, K(I, 0, [])),
        (5, K(I, 0, body(root=-4, lift=-0.12, s1=-2, s2=-5, s3=-6, head=-12, fin=(14, -6), barbel=(-12, -8, -6)))),
        (12, K(I, 0, body(root=6, lift=-0.2, s1=3, s2=5, s3=6, head=10, fin=(8, -14), barbel=(8, 6, 4), roll=12, turn=10))),
        (22, K(I, 0, body(root=16, lift=-0.3, s1=6, s2=9, s3=10, head=18, fin=(4, -21), barbel=(18, 14, 10), roll=24, turn=20))),
        (32, K(I, 0, body(root=10, s1=4, s2=-6, s3=8, head=6, fin=(6, -18), barbel=(10, 8, 6), roll=8, turn=-12))),
        (42, K(I, 0, body(root=10, s1=-3, s2=6, s3=-6, head=4, fin=(6, -18), barbel=(10, 8, 6), roll=-6, turn=12))),
        (48, K(I, 0, body(root=-2, s1=2, s2=2, s3=2, head=-6, fin=(3, -20), barbel=(14, 12, 10)))),
        (54, K(I, 0, body(root=-8, lift=-0.3, s1=-6, s2=-12, s3=-14, head=-24, fin=(19.6, -12), barbel=(-24, -16, -12)))),
        (56, K(I, 0, body(root=-8.5, lift=-0.32, s1=-6, s2=-12.5, s3=-14.5, head=-26, fin=(21, -13), barbel=(-28, -18, -13), roll=1.2))),
        (60, K(I, 0, body(root=6, lift=-0.36, s1=1, s2=2, s3=2, head=2, fin=(16, -20), barbel=(-14, -10, -8)))),
    ], "events": [(0, "sfx:telegraph"), (13, "plunge"), (13, "sfx:boss_slam"), (48, "breach"), (54, "apex")]},
    # 扑咬：第 1 帧头砸上冰沿外、一口咬合（hit：破冰重击 + 冰浪）→ 第 3 帧压实 → 回弹 → 趴在冰沿上（离水最近的输出窗口）→ 撑起 → 待机
    "erupt": {"frames": 30, "sunk": lambda t: 0.0, "keys": [
        (0, K(I, 0, body(root=18, lift=-0.5, s1=3, s2=4, s3=4, head=8, fin=(9.8, -16), barbel=(-24, -18, -12)))),
        (1, K(I, 0, body(root=25, lift=-0.7, s1=3, s2=5, s3=5, head=12, fin=(4.2, 12), barbel=(16, 12, 8)))),
        (3, K(I, 0, body(root=26, lift=-0.74, s1=3, s2=6, s3=5, head=13, fin=(2.8, 16.5), barbel=(24, 20, 14)))),
        (8, K(I, 0, body(root=21, lift=-0.58, s1=2, s2=4, s3=3, head=7, fin=(7, -4.5), barbel=(4, -4, -6)))),
        (16, K(I, 0, body(root=21, lift=-0.57, s1=2, s2=4, s3=4, head=8, fin=(6, 2), barbel=(8, 6, 4), roll=1))),
        (21, K(I, 0, body(root=22.5, lift=-0.62, s1=3, s2=5, s3=4, head=10, fin=(4.2, 4.5), barbel=(10, 8, 6)))),
        (26, K(I, 0, body(root=-3, lift=-0.1, s1=-2, s2=-3, s3=-4, head=-8, fin=(2.8, -7.5), barbel=(-12, -10, -6)))),
        (30, K(I, 0, [])),
    ], "events": [(1, "hit"), (1, "sfx:boss_roar"), (21, "pushOff")]},

    # ───── 吐冰（第二批 A 路）：spit = 前摇 0.7 + 出手 0.1 + 收招 0.5 = 1.3 s（39 帧），第 21 帧 projectile = 前摇结束 ─────
    # 起手（往后一抽、抬头）→ 蓄冰珠（仰头挺胸、鳍张开、须往前飘：口里的冰珠越来越亮，第 16 帧 apex 颤一下）→ 2 帧拖影
    #   → 喷吐（头往前一送、脊椎前压，鳍被后坐力压到后面）→ 后坐（身子往回弹、头点一下，须甩到后面再落）→ 待机
    "spit": {"frames": 39, "keys": [
        (0, K(I, 0, [])),
        (4, K(I, 0, body(root=-3, lift=-0.08, s2=-4, s3=-6, head=-10, fin=(10, -5), barbel=(-8, -6, -4)))),
        (12, K(I, 0, body(root=-6, lift=-0.18, s1=-3, s2=-8, s3=-10, head=-20, fin=(18, -9), barbel=(-16, -12, -8)))),
        (16, K(I, 0, body(root=-6.5, lift=-0.2, s1=-3, s2=-8.5, s3=-11, head=-22, fin=(19.6, -10), barbel=(-18, -13, -9), roll=1.5))),
        (19, K(I, 0, body(root=1, lift=-0.18, s1=-1, s2=-2, s3=-3, head=-6, fin=(15, -14), barbel=(-22, -16, -10)))),
        (21, K(I, 0, body(root=9, lift=-0.28, s1=3, s2=5, s3=6, head=13, fin=(8, -18), barbel=(-10, -8, -6)))),
        (24, K(I, 0, body(root=5, lift=-0.18, s1=2, s2=3, s3=3, head=5, fin=(10, 8), barbel=(16, 12, 8)))),
        (30, K(I, 0, body(root=2, lift=-0.06, s2=1, s3=2, head=3, fin=(6, 3), barbel=(6, 4, 2)))),
        (39, K(I, 0, [])),
    ], "events": [(0, "sfx:enemy_charge"), (16, "apex"), (21, "projectile")]},
}

ABOUT = ("鲲的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。at = 片段内归一化时刻。slamWind / slam / inhale / bite / sink / erupt / spit 是手工关键帧"
         "（art/source/characters/SK_Boss_Kun/anim/kun_anims.py 生成这七条，别手改；对象形式带 next 连段），其余是采样片段的手写叠加；"
         "hit = 出手 / 判定，apex = 蓄力顶点，wave2 = 鲲怒第二道冰浪，pushOff = 撑起，suctionStart = 吞吸气流起，biteWind = 收头蓄咬，"
         "plunge = 潜袭一头扎进水里，breach = 潜袭破水而出，projectile = 吐冰出手")


SUNK_M = 13.0  # Sunk = 1 时整只往下挪多少米（KunSunkY − KunBaseY）


def check(arm, meshes, label, sunk=0.0):
    """平切口最高点（相对水面，米）与冰沿外网格的最低点（相对环台地面，米）；sunk = 那一刻 KunDive 写的沉浮（整只再往下挪 13 m × sunk）"""
    root = arm.pose.bones["root"]
    m = root.matrix @ root.bone.matrix_local.inverted()
    drop = SUNK_M * sunk / SCALE
    cut = max((m @ Vector((x, y, 0))).z for x, y in CUT) - drop
    dg = bpy.context.evaluated_depsgraph_get()
    low, high, top = float("inf"), float("-inf"), float("-inf")
    for o in meshes:
        if not o.name.endswith("LOD0"):
            continue
        ev = o.evaluated_get(dg)
        mw = ev.matrix_world
        for v in ev.data.vertices:
            p = mw @ v.co
            z = p.z - drop
            top = max(top, z)
            if p.y < RIM_Y - 0.8:
                low, high = min(low, z), max(high, z)
    cut_m = (cut - WATER) * SCALE
    low_m = (low - FLOOR) * SCALE if low < float("inf") else float("nan")
    high_m = (high - FLOOR) * SCALE if high > float("-inf") else float("nan")
    top_m = (top - WATER) * SCALE
    # 冰沿外整段都在地面以下（沉在水里）时看不见，不算钻地
    buried = sunk > 0.3 and not (high_m > 0)
    ok = cut_m <= -0.3 and (buried or not (low_m < -0.75))
    extra = f"  头顶离水 {top_m:+.2f} m" + (f"（沉浮 {sunk:.2f}）" if sunk else "")
    print(f"KUN_CHECK {label}: 切口 {cut_m:+.2f} m（≤ −0.30）  冰沿外最低 {low_m:+.2f} m（≥ −0.75{'，整段在地面下' if buried and low < float('inf') else ''}）{extra} {'OK' if ok else '✗'}")
    return ok, cut_m, low_m


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else UNITY / "Keyframed"
    review = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
    preview = Path(argv[argv.index("--preview") + 1]) if "--preview" in argv else None
    arm, meshes = kk.load_rig(ASSET, keep_meshes=True)
    nat = kk.load_native(ASSET)
    bad = []
    if "--refcheck" in argv:
        for c in ("slamWind", "slam", "inhale", "bite", "sink", "erupt", "spit"):
            n = len(nat["clips"][c]["frames"])
            for f in sorted({0, n // 4, n // 2, 3 * n // 4, n - 1}):
                kk.set_native(arm, nat, c, f)
                check(arm, meshes, f"采样 {c} f{f}")
    for name, clip in CLIPS.items():
        sunk = clip.get("sunk")
        # erupt 接在 sink（2.0 s）后面
        t0 = DIVE_WINDUP if name == "erupt" else 0.0
        for frame, spec in clip["keys"]:
            kk.pose(arm, nat, spec)
            ok, _, _ = check(arm, meshes, f"{name} f{frame}", sunk(t0 + frame / kk.FPS) if sunk else 0.0)
            if not ok:
                bad.append(f"{name} f{frame}")
    if preview:
        kk.render_keyposes(arm, meshes, nat, CLIPS, preview)
    kk.prepare_export(arm, ASSET)
    report, keyposes = {}, {}
    for name, clip in CLIPS.items():
        act, resolved = kk.bake_clip(arm, nat, name, clip)
        kk.export_fbx(arm, act, name, clip["frames"], out)
        keyposes[name] = resolved
        report[name] = {"seconds": round(clip["frames"] / kk.FPS, 2), "keys": [f for f, _ in clip["keys"]],
                        "events": [[round(f / kk.FPS, 2), n] for f, n in clip["events"]]}
    if out == UNITY / "Keyframed":
        kk.write_events(UNITY / f"{ASSET}.events.json", CLIPS, ABOUT)
    if review:
        poses = {f"{n}_{f:03d}": [op for op in ops if op[1] != "loc"] for n, ks in keyposes.items() for f, ops in ks}
        review.write_text(json.dumps(poses), encoding="utf-8")
    print("KUN_ANIMS " + json.dumps({"clips": report, "bad": bad}, ensure_ascii=False))


main()
