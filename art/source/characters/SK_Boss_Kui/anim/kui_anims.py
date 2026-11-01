"""夔（SK_Boss_Kui，4-1 经幡山头领主，一足雷兽）手工关键帧动作：Blender 无头脚本，一次生成全部手 K 片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Kui/anim/kui_anims.py -- [--review <目录>] [--only a,b] [--nocheck]

设计单 docs/art/vfx/kui.md（第 0 节动作气质、第 2 节逐招节拍表、第 3 节登场 / 破鼓 / 死亡），招式时长和出手事件 = docs/art/ch4-move-events.json 的
assets.SK_Boss_Kui（片段帧数 = windup + active + recover，30 fps；事件帧 ÷ 片段帧数 = events.json 的 at）。

产出（都可以重新生成）：
  unity/Assets/Art/Characters/SK_Boss_Kui/Anim/Keyframed/<状态>.fbx   一个状态一个文件（文件名 = Animator 状态名），同名时覆盖采样片段
  unity/Assets/Art/Characters/SK_Boss_Kui/Anim/SK_Boss_Kui.events.json 事件叠加表：只改这里手 K 且带出手事件的状态，其余条目原样保留
  --review <目录>   每段关键帧的侧视 / 3/4 视小图（Workbench）+ 每段一条拼图，再拼成 docs/art/review/ch4-port/B1/kui-keyposes.jpg
  默认还跑一遍体检（--nocheck 跳过）：拳 / 蹄 / 身体最低点（穿地）、着地帧蹄子和撑地拳的漂移（滑步）、网格边最大拉伸比、循环片段首尾骨骼差

骨架来自发布的 public/assets/characters/SK_Boss_Kui.glb（19 根骨，见 art/pipeline/creature_rigs/SK_Boss_Kui.json），导入 / 导出设置与
art/pipeline/blender/bl_unity_export.py 一致（顶层物体绕 Z 转 180°、-Z 前 / Y 上、主骨轴 Y），Unity 侧 Generic，NativeClipBuilder 按骨骼名接曲线。
片段不带根运动：root 骨不动；腾空高度、水平位移、转身由代码驱动（KuiBrain / bosses.ts 的抛物线），片段只管姿势；蹲 / 跪平移 hips。

写法（Blender 坐标：front = -Y，生物的左 = +X，up = +Z；角度都是度）：
  每一帧都按关键姿势的参数插值后重新解算（FK + 两骨 IK）再逐帧打键，所以着地的蹄子、撑地的拳在着地段里是钉死的（不滑步）。
  参数插值默认单调三次（相当于 Bézier 自动钳制：极值处不冲过头）；关键帧可带缓动，管「从这一帧到下一帧」那一段：
    "in" 加速冲向下一帧（蓄力 → 释放帧的 smear）、"out" 从这一帧减速出去、"back" 冲过头再回来、"lin" 匀速
  躯干   drop / fwd / side（hips 平移，米：下沉 / 前移 / 往生物左）；pitch / yaw / roll（hips 整体：正 = 前倾 / 转向生物左 / 往右侧倒）；
         spine / chest / neck（逐节相对前弯）、bend（spine 侧弯）、twist（chest 绕自身轴扭向生物左）；
         head（头的绝对俯仰：正 = 低头，身体怎么弯都不影响头最后朝哪）、head_yaw / head_roll；
         stretch（躯干拉长比例：squash 负、stretch 正，spine / chest / neck 沿骨轴平移）；drum_x / drum_z（鼓面骨的旋转抖动）
  独腿   plant（0–1，1 = 蹄子钉在地上：两骨 IK 把踝放回钉点、蹄子保持静止朝向；toe = 绕蹄尖抬后跟）；
         hoof_fwd / hoof_up（钉点相对静止位置的偏移，地面坐标）；thigh / shin / hoof（腾空时三节的绝对摆角，相对静止朝向：正 = 往后摆）
  双臂   L / R（或 arms 同时给两边，镜像）= A(out, fwd, up, ...)：拳底（指节着地点）放到哪（out = 往外为正）；
         ref="c" 胸腔静止坐标系（随身体走）、ref="w" 本帧的根坐标（换算成胸腔坐标，之后仍随身体走）、pin=True 地面坐标钉死（撑地）；
         aim 拳的朝向（腕 → 指节；缺省 = 肩 → 拳的连线），pole 肘尖朝哪（胸腔坐标，缺省朝外后），clav = (上耸, 前伸) 锁骨角
  片段 lag = 长臂滞后身体的帧数（overlapping action：自由的手臂按 lag 帧之前的身体姿势求目标）；speed = 拄拳的根速度（米 / 帧，
         钉在地面坐标里的拳和蹄在根坐标里以这个速度往后走）
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[5]
ASSET = "SK_Boss_Kui"
GLB = ROOT / f"public/assets/characters/{ASSET}.glb"
RIG = ROOT / f"art/pipeline/creature_rigs/{ASSET}.json"
UNITY = ROOT / f"unity/Assets/Art/Characters/{ASSET}/Anim"
SHEET = ROOT / "docs/art/review/ch4-port/B1/kui-keyposes.jpg"
FPS = 30

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REVIEW = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
ONLY = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
CHECK = "--nocheck" not in argv

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
FWD = Vector((0, -1, 0))

# ───────────── 骨架（静止位置按 creature_rigs/SK_Boss_Kui.json，米制）─────────────
_rig = json.loads(RIG.read_text(encoding="utf-8"))["bones"]
HEAD = {b: Vector(v["head"]) for b, v in _rig.items()}
VEC = {b: Vector(v["tail"]) - Vector(v["head"]) for b, v in _rig.items()}
L_ARM, L_FORE, L_FIST = VEC["arm_L"].length, VEC["forearm_L"].length, VEC["fist_L"].length
ANKLE = HEAD["hoof"].copy()                 # 踝（蹄骨头）静止位置
TOE_PIVOT = Vector((0, 0.36, 0.02))          # 蹄尖着地点（蹄子网格最前沿，抬后跟时绕它转）
STRETCH = (("spine", 1.0), ("chest", 0.85), ("neck", 0.6))   # stretch = 0.08 → 三节共平移 0.2 m ≈ 躯干（2.45 m）长 8%


def side_vec(v, s: int) -> Vector:
    """(out, fwd, up) → Blender；s = +1 左 / -1 右"""
    return Vector((s * v[0], -v[1], v[2]))


def from_side(v: Vector, s: int) -> tuple:
    return (s * v.x, -v.y, v.z)


SHOULDER = {s: HEAD["arm_" + n].copy() for s, n in ((1, "L"), (-1, "R"))}
REST_KNUCKLE = (1.1, 0.35, 0.1)                       # 拳底（json 的 fist 尾）
REST_AIM = (-0.02, 0.05, -1.15)                       # 腕 → 指节（静止）


def _elbow_frame(s: int):
    """静止时的肩 → 腕方向、肘尖偏离方向（垂直于肩—腕连线）和肘的铰链轴"""
    n = "L" if s > 0 else "R"
    sh, el, wr = HEAD["arm_" + n], HEAD["forearm_" + n], HEAD["fist_" + n]
    u = (wr - sh).normalized()
    w = (el - sh) - u * (el - sh).dot(u)
    return u, w.normalized(), u.cross(w.normalized()).normalized()


ARM_HINGE0 = {s: _elbow_frame(s)[2] for s in (1, -1)}
DEF_POLE = from_side(_elbow_frame(1)[1], 1)           # 肘尖朝外后（= 静止时肘偏离肩—腕连线的方向，BASE 就是绑定姿势）
LEG_HINGE0 = Vector((-1, 0, 0))                       # 独腿的铰链轴（膝往前弯：大腿 × 前 = -X）
POLE_B = (0.4, -1.0, -0.2)                            # 肘尖往后收（大动作用：肘少往外张，侧腹的权重膜小一些）
# 着地探针（静止时网格底面的几个角，骨架空间）：没钉住的拳 / 蹄解算完后低于地面就把目标抬起来
FIST_PROBES = [Vector((x, y, z)) for x in (0.76, 1.5) for y in (-0.72, 0.02) for z in (0.12, 1.25)] + [Vector((1.1, -0.35, 0.1))]
HOOF_PROBES = [Vector((x, y, z)) for x in (-0.33, 0.33) for y in (0.37, 1.09) for z in (0.01, 0.9)] + [Vector((0, 0.6, 0.0))]


def A(out, fwd, up, ref="c", pin=False, aim=None, pole=None, clav=(0.0, 0.0)) -> dict:
    """一只手臂的目标：拳底放到 (out, fwd, up)（见文件头）"""
    return {"p": (out, fwd, up), "ref": ref, "pin": pin, "aim": aim, "pole": pole or DEF_POLE, "clav": clav}


ARM_REST = A(*REST_KNUCKLE, aim=REST_AIM)

BODY_KEYS = ("drop", "fwd", "side", "pitch", "yaw", "roll", "spine", "bend", "chest", "twist", "neck", "head", "head_yaw", "head_roll",
             "stretch", "drum_x", "drum_z")
LEG_KEYS = ("plant", "thigh", "shin", "hoof", "hoof_fwd", "hoof_up", "toe")
ARM_KEYS = ("anchor", "wx", "wy", "wz", "cdx", "cdy", "cdz", "cr", "awx", "awy", "awz", "acx", "acy", "acz", "pcx", "pcy", "pcz", "clav_up", "clav_fwd")
CHANNELS = list(BODY_KEYS) + list(LEG_KEYS) + [f"{k}_{s}" for s in "LR" for k in ARM_KEYS]
CI = {k: i for i, k in enumerate(CHANNELS)}


def P(**kw) -> dict:
    """一个关键姿势（参数见文件头；缺省 = 静止站姿）"""
    p = {k: 0.0 for k in BODY_KEYS + LEG_KEYS}
    p["plant"] = 1.0
    p["L"] = p["R"] = ARM_REST
    if "arms" in kw:
        p["L"] = p["R"] = kw.pop("arms")
    p.update(kw)
    return p


def mod(p: dict, **kw) -> dict:
    """在一个姿势上改几项（arms / L / R 同 P）"""
    q = dict(p)
    if "arms" in kw:
        q["L"] = q["R"] = kw.pop("arms")
    q.update(kw)
    return q


# ═════════════ 关键姿势 ═════════════
BASE = P()

# ── 小跳 hop / 转身跳 turnLeap（§2.1 / §2.4）──
# 肘尖：大动作多用 POLE_B（往后收），看着更沉；侧腹的权重在 native_build 7 重蒙皮后已不再被手臂拉成膜
HOP_CROUCH = P(drop=0.55, pitch=18, spine=4, chest=2, head=6, stretch=-0.03,
               arms=A(1.3, -1.4, 0.6, ref="w", aim=(0, -0.45, -1), pole=POLE_B))
HOP_HOLD = mod(HOP_CROUCH, drop=0.6, pitch=19, arms=A(1.3, -1.65, 0.7, ref="w", aim=(0, -0.5, -1), pole=POLE_B))
HOP_PUSH = P(drop=0.0, pitch=4, spine=-2, chest=-3, head=-4, stretch=0.06, toe=10, arms=A(1.3, 1.2, 1.2, pole=POLE_B))
HOP_TUCK = P(drop=-0.05, pitch=8, spine=3, chest=1, head=6, plant=0, thigh=-70, shin=45, hoof=55, arms=A(1.3, 2.5, 2.0, pole=POLE_B))
HOP_APEX = P(drop=-0.05, pitch=6, spine=2, head=4, plant=0, thigh=-78, shin=60, hoof=65, arms=A(1.35, 2.7, 2.6, pole=POLE_B))
HOP_REACH = P(drop=0.05, pitch=10, spine=2, head=6, plant=0, thigh=-14, shin=4, hoof=8, arms=A(1.7, 1.9, 1.2, pole=POLE_B))
HOP_LAND = P(drop=0.45, pitch=16, spine=4, chest=2, head=8, stretch=-0.04,
             arms=A(2.0, 1.4, 0.35, ref="w", aim=(0.25, 0.25, -1), pole=POLE_B))
HOP_REBOUND = P(drop=0.0, pitch=3, chest=-1, head=2, stretch=0.025, arms=A(1.5, 0.7, 0.45, pole=POLE_B))

# ── 大跳 leap / 连环大跳 leapChain（§2.2 / §2.3）──
ARM_BACKUP = (0.3, 0.2, -1.0)    # 手臂甩到身后上方时肘尖朝下
LEAP_ANTIC = P(pitch=-8, chest=-4, head=-6, stretch=0.04, arms=A(1.35, 0.9, 0.6, pole=POLE_B))
LEAP_DOWN = P(drop=0.6, pitch=18, spine=3, head=6, stretch=-0.02, arms=A(1.35, -1.6, 1.6, ref="w", pole=POLE_B))
LEAP_DEEP = P(drop=1.1, pitch=30, spine=6, chest=4, head=14, stretch=-0.05,
              arms=A(1.6, -2.5, 5.6, ref="w", aim=(0.05, -0.5, 0.85), pole=ARM_BACKUP))
LEAP_HOLD = mod(LEAP_DEEP, drop=1.15, pitch=31, head_roll=2, arms=A(1.65, -2.7, 5.85, ref="w", aim=(0.05, -0.55, 0.83), pole=ARM_BACKUP))
LEAP_PUSH = P(drop=0.0, pitch=6, spine=-4, chest=-4, head=-6, stretch=0.08, toe=12,
              arms=A(1.3, -1.6, 8.0, ref="w", pole=(0.3, -0.6, -0.6)))
LEAP_TUCK = P(drop=-0.05, pitch=4, spine=6, chest=2, head=6, plant=0, thigh=-95, shin=35, hoof=45, arms=A(1.3, 1.9, 7.8, pole=POLE_B))
LEAP_APEX = P(drop=-0.05, pitch=-8, spine=-2, chest=-6, head=-8, plant=0, thigh=-100, shin=45, hoof=50, stretch=0.03,
              arms=A(1.25, -0.4, 8.9, clav=(12, 0), pole=POLE_B))
LEAP_SLAMDOWN = P(drop=0.0, pitch=26, spine=8, chest=2, head=4, plant=0, thigh=-22, shin=6, hoof=10, arms=A(1.4, 4.0, 3.0, pole=POLE_B))
LEAP_LAND = P(drop=0.9, pitch=40, spine=8, chest=4, head=10, stretch=-0.06,
              arms=A(1.45, 3.1, 0.02, pin=True, aim=(0.05, 0.3, -1), pole=POLE_B))
LEAP_OVER = mod(LEAP_LAND, drop=0.98, pitch=42, stretch=-0.07, head=12)
LEAP_GRIND = mod(LEAP_LAND, drop=0.93, pitch=40, head=8)
LEAP_GRIND2 = mod(LEAP_LAND, drop=0.9, pitch=39, head=6, chest=3)
LEAP_PULL = P(drop=0.55, pitch=26, spine=4, head=4, arms=A(1.45, 2.6, 0.7, ref="w", pole=POLE_B))

CH_START = P(drop=0.55, pitch=22, spine=3, head=8, arms=A(1.4, -0.6, 1.0, ref="w", pole=POLE_B))
CH_DEEP = P(drop=0.83, pitch=26, spine=5, chest=3, head=12, stretch=-0.04,
            arms=A(1.55, -2.4, 5.0, ref="w", aim=(0.05, -0.5, 0.85), pole=ARM_BACKUP))
CH_HOLD = mod(CH_DEEP, drop=0.86, pitch=27, arms=A(1.6, -2.6, 5.25, ref="w", aim=(0.05, -0.55, 0.83), pole=ARM_BACKUP))
CH_PUSH = mod(LEAP_PUSH, stretch=0.07)
CH_LAND = mod(LEAP_LAND, drop=0.85, pitch=38)
CH_OVER = mod(CH_LAND, drop=0.93, pitch=40, stretch=-0.07)
CH_PULL = P(drop=0.7, pitch=30, spine=4, head=8, arms=A(1.45, 1.4, 0.8, ref="w", pole=POLE_B))

# ── 雷掌 clap（§2.6）：双臂侧平举张到最开（剪影「T」、胸前空门大开）→ 两掌在身前合拢 ──
CLAP_ANTIC = P(pitch=-6, chest=-2, head=-2, arms=A(1.35, -1.4, 0.8, pole=POLE_B))
CLAP_RISE = P(pitch=-6, chest=-5, head=-5, arms=A(3.7, 0.1, 2.6, clav=(6, -4)))
CLAP_WIDE = P(pitch=-6, chest=-8, head=-8, stretch=0.03, arms=A(5.35, 0.2, 4.75, aim=(1, 0.05, 0.02), clav=(10, -8)))
CLAP_HOLD = mod(CLAP_WIDE, chest=-9, head=-9, arms=A(5.35, -0.15, 4.8, aim=(1, -0.05, 0.03), clav=(11, -10)))
CLAP_HIT = P(pitch=10, spine=5, chest=0, head=4, stretch=0.04,
             arms=A(0.44, 4.25, 4.0, aim=(-0.12, 1, -0.05), pole=(1.0, 0.0, -0.6), clav=(4, 16)))
CLAP_OVER = P(pitch=12, spine=6, chest=1, head=6, stretch=0.02,
              arms=A(0.34, 4.35, 3.55, aim=(-0.12, 1, -0.2), pole=(1.0, 0.0, -0.6), clav=(3, 18)))
CLAP_AFTER = P(pitch=9, spine=4, head=4, arms=A(0.7, 4.1, 3.4, aim=(-0.05, 1, -0.3), pole=(1.0, 0.0, -0.6), clav=(2, 12)))
CLAP_RETRACT = P(pitch=4, spine=2, head=2, arms=A(1.5, 2.0, 1.4, pole=POLE_B))

# ── 捶胸引雷 drum / drum5（§2.7）：人立、双拳举过头握紧 → 左右拳交替从头顶砸下来贴住鼓面（另一只拳举在头顶上等着）──
DRUM_UP_ARM = A(1.25, 0.6, 8.5, clav=(16, 0), pole=(1, -0.3, 0))
DRUM_COCK = A(1.75, 1.0, 6.9, clav=(12, 2), pole=(1, -0.2, -0.3))
DRUM_SMEAR = A(1.15, 1.9, 5.0, clav=(6, 6), pole=(1, 0.1, -0.5))
DRUM_HIT = A(0.32, 1.12, 3.65, aim=(-0.45, -0.55, -0.7), clav=(2, 10), pole=(1, 0.2, -0.6))
DRUM_REBOUND = A(1.6, 1.7, 5.4, clav=(8, 6), pole=(1, 0, -0.4))
DRUM_REAR = P(pitch=-10, spine=-3, chest=-4, head=-10, stretch=0.04, arms=DRUM_UP_ARM)
DRUM_CLENCH = mod(DRUM_REAR, pitch=-11, chest=-6, head=-12, arms=A(1.2, 0.8, 8.4, clav=(17, 0), pole=(1, -0.3, 0)))
DRUM_DOWN = P(drop=0.1, pitch=6, chest=3, head=6, arms=A(1.4, 0.9, 0.7, pole=POLE_B))
DRUM_PANT_OUT = P(drop=0.18, pitch=12, spine=4, chest=6, head=14, stretch=-0.03, arms=A(1.35, 0.9, 0.45, pole=POLE_B))
DRUM_PANT_IN = P(drop=0.08, pitch=6, spine=1, chest=-2, head=6, stretch=0.02, arms=A(1.4, 0.8, 0.5, pole=POLE_B))


def drum_body(lean: float) -> dict:
    """捶鼓那一下的躯干：上身前压 lean（相对人立）"""
    return dict(pitch=-10 + lean, spine=-3 + lean * 0.3, chest=-4 + lean * 0.4, head=-10 + lean * 0.6, stretch=0.04 - lean * 0.004)


def drum_keys(beats: list, total: int, end_frames: tuple) -> list:
    """beats = [(帧, "L" / "R" / "LR")]：每一捶 b-6 起手高举 → b-2 smear（in）→ b 拳贴鼓面（out）→ b+4 反弹"""
    keys = [(0, BASE), (9, DRUM_REAR), (16, DRUM_CLENCH)]
    for i, (b, who) in enumerate(beats):
        both = who == "LR"
        last = i == len(beats) - 1
        cock = DRUM_UP_ARM if both else DRUM_COCK
        pre = P(**drum_body(-1), drum_x=1, **{s: (cock if s in who else DRUM_COCK) for s in "LR"})
        smear = P(**drum_body(3), **{s: (DRUM_SMEAR if s in who else DRUM_COCK) for s in "LR"})
        hit = P(**drum_body(8 if not both else 11), drum_x=-4 if not both else -6, drum_z=(3 if who == "L" else -3) if not both else 0,
                **{s: (DRUM_HIT if s in who else DRUM_COCK) for s in "LR"})
        reb = P(**drum_body(2), drum_x=2, drum_z=(-1.5 if who == "L" else 1.5) if not both else 0,
                **{s: (DRUM_REBOUND if s in who else DRUM_COCK) for s in "LR"})
        if b - 6 > keys[-1][0] + 1:
            keys.append((b - 6, pre))
        keys += [(b - 2, smear, "in"), (b, hit, "out"), (b + 4, reb)]
        if not last:
            nb = beats[i + 1][0]
            if nb - 6 > b + 8:
                keys.append((b + 9, P(**drum_body(0), drum_x=0.5, **{s: DRUM_COCK for s in "LR"})))
    f_down, f_pant, f_end = end_frames
    keys += [(f_down, DRUM_DOWN), (f_pant, DRUM_PANT_OUT), (f_pant + 6, DRUM_PANT_IN), (f_pant + 12, DRUM_PANT_OUT), (f_end, BASE)]
    return keys


# ── 破鼓 kneel / 死亡 sink（§3.3 / §3.4）──
KNEEL_LEG = dict(plant=0, thigh=-32, shin=96, hoof=135)
KNEEL_ARMS = A(1.3, 2.3, 0.02, pin=True, aim=(0.06, 0.25, -1), pole=POLE_B)
KNEEL_BUCKLE = P(drop=0.75, pitch=18, spine=6, chest=2, head=12, stretch=-0.03, arms=A(1.35, 1.9, 0.5, ref="w", pole=POLE_B))
KNEEL_DOWN = P(drop=1.4, pitch=28, spine=8, chest=4, neck=6, head=32, stretch=-0.04, arms=KNEEL_ARMS, **KNEEL_LEG)
KNEEL_OVER = mod(KNEEL_DOWN, drop=1.47, pitch=30, head=36, stretch=-0.05)
KNEEL_IN = mod(KNEEL_DOWN, drop=1.36, pitch=25, chest=-3, neck=4, head=26, stretch=-0.01, drum_x=-1.5)
KNEEL_OUT = mod(KNEEL_DOWN, drop=1.43, pitch=30, chest=6, neck=8, head=38, stretch=-0.05, drum_x=1.5)
KNEEL_LOOK = mod(KNEEL_DOWN, drop=1.34, pitch=24, chest=-2, head=12, stretch=-0.01)
KNEEL_PUSH = P(drop=0.9, pitch=24, spine=6, head=10, plant=0.5, thigh=-20, shin=50, hoof=60, arms=KNEEL_ARMS)
KNEEL_RISE = P(drop=0.35, pitch=10, spine=3, head=4, arms=A(1.4, 1.1, 0.35, ref="w", pole=POLE_B))

SINK_TIP = P(drop=1.3, pitch=6, spine=2, chest=-6, neck=-2, head=-4, plant=0, thigh=-40, shin=95, hoof=130,
             arms=A(1.6, 1.6, 0.9, ref="w", pole=POLE_B))
SINK_FALL = P(drop=1.32, pitch=-30, spine=-8, chest=-8, neck=-6, head=-34, plant=0, thigh=-62, shin=50, hoof=70,
              arms=A(2.4, 1.0, 3.6, ref="w", pole=POLE_B))
SINK_HIT = P(drop=1.04, pitch=-68, spine=-10, chest=-8, neck=-8, head=-62, stretch=-0.03, plant=0, thigh=-86, shin=10, hoof=30,
             arms=A(3.0, -1.4, 0.4, ref="w", aim=(0.4, -0.3, -0.8), pole=POLE_B))
SINK_BOUNCE = mod(SINK_HIT, drop=0.96, pitch=-62, head=-56, thigh=-80, shin=16)
SINK_REST = mod(SINK_HIT, drop=1.04, pitch=-71, head=-66, thigh=-88, shin=8, stretch=-0.04)
SINK_STILL = mod(SINK_REST, pitch=-73, head=-68, drop=1.06, drum_x=-2)

# ── 登场 rise / 吼 roar（§3.1）──
RISE_CURL = P(drop=1.36, pitch=55, spine=16, chest=12, neck=10, head=58, stretch=-0.06, plant=0, thigh=-112, shin=128, hoof=120,
              arms=A(0.75, 1.55, 2.4, aim=(-0.5, -0.3, -0.8), pole=(1, -0.6, -0.5)))
RISE_UNFURL1 = P(drop=1.3, pitch=44, spine=12, chest=8, neck=6, head=42, stretch=-0.05, plant=0, thigh=-104, shin=118, hoof=112,
                 arms=A(1.1, 1.9, 1.9, aim=(-0.3, 0.3, -0.9)))
RISE_UNFURL2 = P(drop=1.2, pitch=28, spine=6, chest=2, head=18, stretch=-0.02, plant=0, thigh=-72, shin=82, hoof=80,
                 arms=A(2.0, 1.9, 1.9, pole=POLE_B))
RISE_UP = P(drop=0.7, pitch=8, chest=-4, head=-4, stretch=0.03, plant=0, thigh=-32, shin=42, hoof=34,
            arms=A(1.35, 0.8, 7.8, clav=(10, 0), pole=POLE_B))
RISE_TOP = P(drop=0.45, pitch=2, chest=-6, head=-8, stretch=0.05, plant=0.5, thigh=-8, shin=8, hoof=6,
             arms=A(1.25, -0.2, 8.6, clav=(12, 0), pole=POLE_B))
RISE_SLAM = P(drop=0.8, pitch=36, spine=6, chest=2, head=8, stretch=-0.05,
              arms=A(1.45, 2.8, 0.02, pin=True, aim=(0.05, 0.3, -1), pole=POLE_B))
RISE_OVER = mod(RISE_SLAM, drop=0.87, pitch=38, stretch=-0.06)
RISE_STAND = P(drop=0.2, pitch=4, chest=-4, head=-12, arms=A(1.5, 1.3, 1.0, ref="w", pole=POLE_B))
RISE_ROAR = P(pitch=-6, chest=-6, neck=-4, head=-28, stretch=0.03, arms=A(1.7, 0.8, 0.8, pole=POLE_B))
RISE_END = P(pitch=-2, chest=-2, head=-10, arms=A(1.3, 0.5, 0.35))

# 吼：双拳举到头两边、肘往下（「W」字剪影），仰头挺胸（登场特写镜头里读得清）
ROAR_GATHER = P(drop=0.25, pitch=12, spine=4, chest=6, head=18, stretch=-0.03, arms=A(1.05, 0.7, 1.1, pole=POLE_B))
ROAR_POLE = (0.7, 0.3, -1.0)
ROAR_A = P(pitch=-8, spine=-4, chest=-8, neck=-6, head=-38, stretch=0.05, arms=A(2.35, 1.2, 5.75, aim=(0.3, 0.15, 1), clav=(10, 2), pole=ROAR_POLE))
ROAR_B = mod(ROAR_A, head=-41, drum_x=2, arms=A(2.45, 1.1, 5.85, aim=(0.32, 0.12, 1), clav=(11, 2), pole=ROAR_POLE))
ROAR_C = mod(ROAR_A, head=-36, drum_x=-2, chest=-9, arms=A(2.25, 1.3, 5.65, aim=(0.28, 0.18, 1), clav=(9, 2), pole=ROAR_POLE))
ROAR_FADE = P(pitch=-4, chest=-4, head=-26, stretch=0.02, arms=A(1.9, 1.2, 4.2, aim=(0.2, 0.3, 0.6), clav=(6, 2), pole=ROAR_POLE))
ROAR_DOWN = P(pitch=3, head=2, arms=A(1.6, 0.8, 1.0, pole=POLE_B))

# ── 待机 Idle ──
IDLE_EX = P(drop=0.04, pitch=2, spine=1, chest=1.5, head=1.5, stretch=-0.006, arms=A(1.12, 0.42, 0.2, aim=REST_AIM))
IDLE_IN_L = P(drop=0.0, pitch=1, chest=-2, head=-1, stretch=0.012, roll=1.2, side=0.03, yaw=-1.5, head_yaw=3,
              L=A(1.2, 0.3, 0.24, aim=REST_AIM), R=A(1.16, 0.55, 0.2, aim=REST_AIM))
IDLE_EX2 = P(drop=0.05, pitch=2.5, spine=1, chest=2, head=2.5, stretch=-0.008, drum_x=0.6,
             arms=A(1.12, 0.45, 0.18, aim=REST_AIM))
IDLE_IN_R = P(drop=0.0, pitch=1, chest=-2, head=-1, stretch=0.012, roll=-1.2, side=-0.03, yaw=2, head_yaw=-4,
              L=A(1.16, 0.55, 0.2, aim=REST_AIM), R=A(1.2, 0.3, 0.24, aim=REST_AIM))


# ── 拄拳 knuckle（§2.5）：三步 × 39 帧，根速度 3.25 m / 步 ──
KN_STRIDE = 3.25
KN_V = KN_STRIDE / 39.0
# 每步的相对帧 r：0 蹄落地（step）→ 6 拳抬起 → 10.5 拳在空中往前 → 15 拳落地 → 18 蹬地 → 27 身子从两拳间荡过（最低）→ 33 / 36 腿往前伸 → 39 = 下一步 0
KN_BODY = {
    0: dict(drop=0.62, pitch=27, fwd=-0.05, spine=5, chest=2, head=-6, stretch=-0.03),
    6: dict(drop=0.5, pitch=24, fwd=0.0, spine=4, chest=1, head=-6, stretch=0.0),
    10.5: dict(drop=0.47, pitch=23, fwd=0.05, spine=3, chest=1, head=-5, stretch=0.01),
    15: dict(drop=0.52, pitch=26, fwd=0.1, spine=4, chest=2, head=-5, stretch=-0.01),
    18: dict(drop=0.5, pitch=28, fwd=0.16, spine=4, chest=2, head=-5, stretch=0.0, toe=10),
    21: dict(drop=0.58, pitch=30, fwd=0.22, spine=5, chest=2, head=-4, stretch=-0.01),
    27: dict(drop=0.8, pitch=32, fwd=0.3, spine=6, chest=3, head=-3, stretch=-0.02),
    33: dict(drop=0.72, pitch=30, fwd=0.22, spine=5, chest=2, head=-4, stretch=-0.01),
    36: dict(drop=0.66, pitch=28, fwd=0.1, spine=5, chest=2, head=-5, stretch=-0.02),
}
KN_LEG = {21: dict(thigh=-14, shin=58, hoof=62), 27: dict(thigh=-30, shin=58, hoof=56), 33: dict(thigh=-34, shin=0, hoof=4),
          36: dict(thigh=-30, shin=-12, hoof=-6)}
KN_HOOF0 = 0.75       # 蹄落地时（根坐标）在静止位置前方多少米
KN_FIST_LAND = 1.65   # 拳落地时（根坐标）在拳的静止位置前方多少米
KN_FIST_OUT = 1.35


def knuckle_keys() -> list:
    keys = []
    for k in range(-1, 4):
        b = 39 * k
        hoof_g = KN_HOOF0 + KN_V * b                       # 本步蹄子的地面坐标（钉住段）
        fist_g = KN_FIST_LAND + KN_V * (b + 15)            # 本步拳落地的地面坐标（相对拳的静止位置）
        prev_fist_g = fist_g - KN_STRIDE
        for r, body in KN_BODY.items():
            p = P(**body)
            # 蹄：0–18 钉住，之后腾空摆腿
            if r <= 18:
                p.update(plant=1.0, hoof_fwd=hoof_g)
            else:
                p.update(plant=0.0, hoof_fwd=hoof_g + KN_STRIDE * (r - 18) / 21, **KN_LEG[r])
            # 拳：上一步的拳钉到 r = 6，6–15 在空中往前，15 起钉在本步落点
            fwd0 = REST_KNUCKLE[1]
            if r <= 6:
                arm = A(KN_FIST_OUT, fwd0 + prev_fist_g, 0.02, pin=True, aim=(0.06, 0.25, -1), pole=POLE_B)
            elif r < 15:
                mid = prev_fist_g + (fist_g - prev_fist_g) * 0.5
                arm = A(KN_FIST_OUT + 0.1, fwd0 + mid, 0.85, pin=True, aim=(0.05, 0.7, -0.7), pole=POLE_B)
            else:
                arm = A(KN_FIST_OUT, fwd0 + fist_g, 0.02, pin=True, aim=(0.06, 0.25, -1), pole=POLE_B)
            p["L"] = p["R"] = arm
            ease = "out" if r == 0 else None
            keys.append((b + r, p, ease) if ease else (b + r, p))
    return keys


def cyclic(keys: list, period: float, pad: int = 2) -> list:
    """循环片段：首尾各补 pad 个关键帧（平移一个周期），让首尾的切线按周期算"""
    inner = [k for k in keys if 0 <= k[0] < period]
    before = [(k[0] - period,) + tuple(k[1:]) for k in inner[-pad:]]
    after = [(k[0] + period,) + tuple(k[1:]) for k in inner[:pad + 1]]
    return before + inner + after


# ═════════════ 片段：frames = 总帧数（30 fps）；keys = [(帧, 姿势[, 缓动])]；events = [(帧, 事件名)] ═════════════
CLIPS = {
    # 小跳（1.1 s）：f6 蹲 → f8 蓄力顶点 → f9 蹬地（stretch）→ f12 收腿 → f20 顶点 → f24 伸腿找地 → f25.5 落地（land，squash）→ f28 回弹 → f33
    "hop": {"frames": 33, "lag": 2, "air": (9, 25.5, 1.4), "keys": [
        (0, BASE), (6, HOP_CROUCH), (8, HOP_HOLD, "in"), (9, HOP_PUSH, "out"), (12, HOP_TUCK), (20, HOP_APEX), (24, HOP_REACH, "in"),
        (25.5, HOP_LAND, "out"), (28.5, HOP_REBOUND), (33, BASE)],
        "events": [(25.5, "land")]},
    # 转身跳（1.1 s）：同小跳，蹲时身子往转向那侧（生物的左）拧 15°；空中双拳往外甩开当配重；f24 落地（land）
    "turnLeap": {"frames": 33, "lag": 2, "air": (9, 24, 1.4), "keys": [
        (0, BASE), (6, mod(HOP_CROUCH, yaw=15, twist=8, head_yaw=18)), (8, mod(HOP_HOLD, yaw=17, twist=10, head_yaw=22), "in"),
        (9, mod(HOP_PUSH, yaw=18, twist=10, head_yaw=24), "out"),
        (13, mod(HOP_TUCK, yaw=8, twist=-6, head_yaw=10, arms=A(2.5, 1.9, 2.4, pole=POLE_B))),
        (19, mod(HOP_APEX, yaw=-4, twist=-10, head_yaw=-4, arms=A(2.7, 1.8, 2.7, pole=POLE_B))),
        (22.5, mod(HOP_REACH, yaw=-8, twist=-8, head_yaw=-8, arms=A(2.2, 1.6, 1.4, pole=POLE_B)), "in"),
        (24, mod(HOP_LAND, yaw=-8, twist=-4, head_yaw=-6), "out"), (27, mod(HOP_REBOUND, yaw=-3)), (33, BASE)],
        "events": [(24, "land")]},
    # 大跳（2.6 s）：f7 反向预备 → f15 glint → f18 深蹲（extreme）→ f21 蓄力顶点 → f22.5 蹬地 → f30 收腿 → f40 顶点 → f50 双拳下砸 →
    #   f54 双拳砸地（land，三点着地）→ f56 过冲 → f60–f72 双拳插在地里 → f74 拔拳 → f78
    "leap": {"frames": 78, "lag": 2, "air": (22.5, 54, 4.2), "keys": [
        (0, BASE), (7, LEAP_ANTIC), (14, LEAP_DOWN), (18, LEAP_DEEP), (21, LEAP_HOLD, "in"), (22.5, LEAP_PUSH, "out"), (30, LEAP_TUCK),
        (40, LEAP_APEX), (50, LEAP_SLAMDOWN, "in"), (54, LEAP_LAND, "out"), (56.5, LEAP_OVER), (62, LEAP_GRIND), (72, LEAP_GRIND2),
        (74.5, LEAP_PULL), (78, BASE)],
        "events": [(15, "glint"), (54, "land")]},
    # 连环大跳（1.75 s，三连时整段重播）：首尾同一个起蹲姿势（三跳之间不回底姿）；f12 深蹲（0.75 深度）→ f15 蹬地 → f42 落地（land）→ f45 过冲 → f52 接下一跳的蹲
    "leapChain": {"frames": 52, "lag": 2, "air": (15, 42, 3.2), "keys": cyclic(
        [(0, CH_START), (12, CH_DEEP), (14, CH_HOLD, "in"), (15, CH_PUSH, "out"), (22, LEAP_TUCK), (30, LEAP_APEX), (38, LEAP_SLAMDOWN, "in"),
         (42, CH_LAND, "out"), (45, CH_OVER), (48, CH_PULL)], 52),
        "events": [(42, "land")]},
    # 拄拳（3.9 s，三步可循环）：拳撑住 → 身子和腿从两拳之间荡过去 → 蹄落地（step，每步第 39 帧）→ 拳抬起往前伸 → 拳落地
    "knuckle": {"frames": 117, "lag": 0, "speed": KN_V, "loop_check": True, "keys": knuckle_keys(),
                "review": [0, 6, 10.5, 15, 18, 21, 27, 33, 36, 39],
                "events": [(39, "step"), (78, "step"), (117, "step")]},
    # 雷掌（1.4 s）：f5 后仰、双臂下垂往后 → f15 双臂侧平举（T）→ f17 → f18 两掌合拢（hit）→ f20 过冲 → f30 收 → f42
    "clap": {"frames": 42, "lag": 0, "keys": [
        (0, BASE), (5, CLAP_ANTIC), (10.5, CLAP_RISE), (15, CLAP_WIDE), (17, CLAP_HOLD, "in"), (18, CLAP_HIT, "out"), (20.5, CLAP_OVER),
        (25, CLAP_AFTER), (31, CLAP_RETRACT), (42, BASE)],
        "events": [(10.5, "glint"), (18, "hit")]},
    # 捶胸引雷（3.6 s）：f9 人立、双拳举过头 → f16 握紧 → f24 / f42 / f60 左右拳交替砸鼓（beat）→ f78 双拳垂下 → f90 喘 → f108
    "drum": {"frames": 108, "lag": 0, "keys": drum_keys([(24, "L"), (42, "R"), (60, "L")], 108, (78, 90, 108)),
             "events": [(24, "beat"), (42, "beat"), (60, "beat")]},
    # 捶胸 × 5（4.8 s）：f24 / 42 / 60 / 78 左右交替，f96 双拳一起砸 → f114 垂下 → f126 喘 → f144
    "drum5": {"frames": 144, "lag": 0, "keys": drum_keys([(24, "L"), (42, "R"), (60, "L"), (78, "R"), (96, "LR")], 144, (114, 126, 144)),
              "events": [(24, "beat"), (42, "beat"), (60, "beat"), (78, "beat"), (96, "beat")]},
    # 破鼓（4.0 s）：f5 一软 → f12 单膝跪地、双拳撑地（extreme）→ f15 过冲 → 每 36 帧一口喘（头垂）→ f100 抬头 → f108 撑起 → f120
    "kneel": {"frames": 120, "lag": 1, "keys": [
        (0, BASE), (5, KNEEL_BUCKLE, "in"), (12, KNEEL_DOWN, "out"), (15, KNEEL_OVER), (30, KNEEL_IN), (48, KNEEL_OUT), (66, KNEEL_IN),
        (84, KNEEL_OUT), (100, KNEEL_LOOK), (108, KNEEL_PUSH), (114, KNEEL_RISE), (120, BASE)],
        "events": []},
    # 死亡「倒回残鼓」（4.8 s）：先跪下（同破鼓）→ f30 起往后倒、双臂摊开 → f78 仰面砸地 → f84 弹一下 → f96 躺定（缩小、溶解由代码做）
    "sink": {"frames": 144, "lag": 2, "keys": [
        (0, BASE), (5, KNEEL_BUCKLE, "in"), (12, KNEEL_DOWN, "out"), (16, KNEEL_OVER), (30, KNEEL_IN), (44, SINK_TIP),
        (60, SINK_FALL, "in"), (78, SINK_HIT, "out"), (84, SINK_BOUNCE), (96, SINK_REST), (144, SINK_STILL)],
        "events": []},
    # 登场（3.2 s）：蜷在鼓里 → 一节节舒展 → 双臂高举 → f66 一足落地 + 双拳砸地 → f69 过冲 → 站起 → 仰头吼
    "rise": {"frames": 96, "lag": 2, "keys": [
        (0, RISE_CURL), (20, RISE_UNFURL1), (38, RISE_UNFURL2), (52, RISE_UP), (61, RISE_TOP, "in"), (66, RISE_SLAM, "out"),
        (69, RISE_OVER), (80, RISE_STAND), (88, RISE_ROAR), (96, RISE_END)],
        "events": []},
    # 仰头吼（2.5 s）：f8 收拢蓄气 → f15 仰头张臂（extreme）→ 抖 → f60 收 → f75
    "roar": {"frames": 75, "lag": 1, "keys": [
        (0, BASE), (8, ROAR_GATHER, "in"), (15, ROAR_A, "out"), (21, ROAR_B), (27, ROAR_C), (33, ROAR_B), (39, ROAR_C), (45, ROAR_B),
        (51, ROAR_C), (58, ROAR_A), (64, ROAR_FADE), (70, ROAR_DOWN), (75, BASE)],
        "events": []},
    # 待机（4 s 循环）：两口呼吸、重心在独腿上左右微调、长臂轻晃（lag 3）
    "Idle": {"frames": 120, "lag": 3, "loop": True, "loop_check": True, "keys": cyclic(
        [(0, IDLE_EX), (30, IDLE_IN_L), (60, IDLE_EX2), (90, IDLE_IN_R)], 120),
        "review": [0, 30, 60, 90],
        "events": []},
}
# 有出手事件的状态写进叠加表（其余状态没有事件条目，叠加表里也不加）
EVENT_STATES = [n for n, c in CLIPS.items() if c["events"]]


# ═════════════ 插值 ═════════════
EASE = {
    "in": lambda u: u * u,
    "out": lambda u: 1 - (1 - u) * (1 - u),
    "lin": lambda u: u,
    "back": lambda u: 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2,
}


class Track:
    """关键帧向量的单调三次插值（Fritsch–Butland 切线；首尾切线 0）；带缓动的段按缓动曲线直插"""

    def __init__(self, xs: list, ys: list, eases: list):
        self.xs, self.ys, self.eases = xs, ys, eases
        n, d = len(xs), len(ys[0])
        self.ms = [[0.0] * d for _ in range(n)]
        for i in range(1, n - 1):
            h0, h1 = xs[i] - xs[i - 1], xs[i + 1] - xs[i]
            for c in range(d):
                d0 = (ys[i][c] - ys[i - 1][c]) / h0
                d1 = (ys[i + 1][c] - ys[i][c]) / h1
                if d0 * d1 <= 0:
                    self.ms[i][c] = 0.0
                else:
                    self.ms[i][c] = 3 * (h0 + h1) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1)

    def at(self, t: float) -> list:
        xs, ys = self.xs, self.ys
        if t <= xs[0]:
            return list(ys[0])
        if t >= xs[-1]:
            return list(ys[-1])
        i = max(j for j in range(len(xs) - 1) if xs[j] <= t)
        h = xs[i + 1] - xs[i]
        u = (t - xs[i]) / h
        e = self.eases[i]
        if e:
            f = EASE[e](u)
            return [a + (b - a) * f for a, b in zip(ys[i], ys[i + 1])]
        h00, h10, h01, h11 = 2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u, -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2
        m0, m1 = self.ms[i], self.ms[i + 1]
        return [h00 * a + h10 * h * ma + h01 * b + h11 * h * mb for a, b, ma, mb in zip(ys[i], ys[i + 1], m0, m1)]


# ═════════════ Blender：解算 ═════════════
def load_rig():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = None
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if o.parent == arm and mesh is None:
            mesh = o
        else:
            bpy.data.objects.remove(o)
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm, mesh


def upd():
    bpy.context.view_layer.update()


def reset(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    upd()


def Q(axis, deg: float) -> Quaternion:
    return Quaternion(Vector(axis), math.radians(deg))


def rot_about_head(pb, q: Quaternion):
    m = pb.matrix.copy()
    h = m.translation.copy()
    pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ m
    upd()


def delta_rot(pb):
    return pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()


def cur_dir(pb) -> Vector:
    return delta_rot(pb) @ VEC[pb.name]


def aim(pb, target: Vector):
    v = cur_dir(pb)
    if v.length < 1e-6 or target.length < 1e-6:
        return
    rot_about_head(pb, v.normalized().rotation_difference(target.normalized()))


def orient(pb, d1: Vector, n1: Vector, n0: Vector):
    """把骨头的（静止方向、铰链轴 n0）转到（d1、n1）：方向和扭转都定死（不靠最短弧，免得前臂扭麻花）"""
    def frame(d, n):
        d = d.normalized()
        n = n - d * n.dot(d)
        n = n.normalized() if n.length > 1e-6 else d.orthogonal().normalized()
        return Matrix((d, n, d.cross(n))).transposed()
    r = frame(d1, n1) @ frame(VEC[pb.name], n0).transposed()
    pb.matrix = Matrix.Translation(pb.matrix.translation) @ (r @ pb.bone.matrix_local.to_3x3()).to_4x4()
    upd()


def two_bone(arm, upper: str, lower: str, target: Vector, pole: Vector, n0: Vector):
    """两骨 IK：肘 / 膝朝 pole 那边弯，两节的扭转由铰链轴（肩—腕连线 × 肘尖方向）定"""
    pu, pl = arm.pose.bones[upper], arm.pose.bones[lower]
    a = pu.matrix.translation.copy()
    l1, l2 = VEC[upper].length, VEC[lower].length
    t = target - a
    d = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-4, t.length))
    u = t.normalized()
    w = pole - u * pole.dot(u)
    w = w.normalized() if w.length > 1e-6 else Vector((0, -1, 0))
    x = (d * d + l1 * l1 - l2 * l2) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    knee = a + u * x + w * h
    n = u.cross(w).normalized()
    orient(pu, knee - a, n, n0)
    orient(pl, (a + u * d) - knee, n, n0)


def seg_angle(v: Vector) -> float:
    """侧视里一节肢体相对竖直向下的角度（正 = 往后摆）"""
    return math.degrees(math.atan2(v.y, -v.z))


REST_ANG = {b: seg_angle(VEC[b]) for b in ("thigh", "shin", "hoof")}


def build_body(arm, p: dict) -> Matrix:
    """躯干（hips 平移 / 转 → 脊柱 → 头 → 鼓面抖动），返回胸腔的姿势变换 Δ（静止 → 当前，骨架空间）"""
    reset(arm)
    s = p["stretch"]
    if abs(s) > 1e-6:
        for b, k in STRETCH:
            arm.pose.bones[b].location = (0, s * k, 0)
        upd()
    pbs = arm.pose.bones
    hips = pbs["hips"]
    hips.matrix = Matrix.Translation(Vector((p["side"], -p["fwd"], -p["drop"]))) @ hips.matrix
    upd()
    qy = Q(Z, p["yaw"])
    rot_about_head(hips, qy @ Q(Y, p["roll"]) @ Q(X, p["pitch"]))
    x1, y1 = qy @ X, qy @ Y
    if p["spine"] or p["bend"]:
        rot_about_head(pbs["spine"], Q(x1, p["spine"]) @ Q(y1, p["bend"]))
    if p["chest"]:
        rot_about_head(pbs["chest"], Q(x1, p["chest"]))
    if p["twist"]:
        rot_about_head(pbs["chest"], Q(cur_dir(pbs["chest"]).normalized(), p["twist"]))
    if p["neck"]:
        rot_about_head(pbs["neck"], Q(x1, p["neck"]))
    hb = pbs["head"]
    r = (qy @ Q(Z, p["head_yaw"]) @ Q(X, p["head"]) @ Q(Y, p["head_roll"])).to_matrix()
    hb.matrix = Matrix.Translation(hb.matrix.translation) @ (r @ hb.bone.matrix_local.to_3x3()).to_4x4()
    upd()
    if p["drum_x"] or p["drum_z"]:
        sp = delta_rot(pbs["spine"])
        rot_about_head(pbs["drum"], Q(sp @ X, p["drum_x"]) @ Q(sp @ Z, p["drum_z"]))
    ch = pbs["chest"]
    return ch.matrix @ ch.bone.matrix_local.inverted()


def hoof_pin(p: dict, t: float, v: float):
    """钉住的踝位置与蹄子朝向（根坐标）：静止位置 + 偏移（地面坐标 → 根坐标）+ 绕蹄尖抬后跟"""
    off = Vector((0, -p["hoof_fwd"], p["hoof_up"])) - FWD * (v * t)
    rq = Q(X, p["toe"])
    ankle = off + TOE_PIVOT + rq @ (ANKLE - TOE_PIVOT)
    return ankle, rq @ VEC["hoof"]


def probe_min(pb, pts, mirror: int = 1) -> float:
    m = pb.matrix @ pb.bone.matrix_local.inverted()
    return min((m @ Vector((q.x * mirror, q.y, q.z))).z for q in pts)


def solve_leg(arm, p: dict, t: float, v: float, floor: float = 0.0):
    pbs = arm.pose.bones
    qy = Q(Z, p["yaw"])
    plant = min(1.0, max(0.0, p["plant"]))
    fk = {b: qy @ (Q(X, p[b]) @ VEC[b].normalized()) for b in ("thigh", "shin", "hoof")}
    hinge = qy @ LEG_HINGE0
    if plant < 0.999:
        for b in ("thigh", "shin", "hoof"):
            orient(pbs[b], fk[b], hinge, LEG_HINGE0)
    if plant > 0.001:
        ankle, hdir = hoof_pin(p, t, v)
        fk_ankle = pbs["hoof"].matrix.translation.copy()
        target = ankle if plant >= 0.999 else fk_ankle.lerp(ankle, plant)
        two_bone(arm, "thigh", "shin", target, qy @ Vector((0, -1, 0.05)), LEG_HINGE0)
        d = hdir.normalized() if plant >= 0.999 else fk["hoof"].lerp(hdir.normalized(), plant)
        orient(pbs["hoof"], d, hinge, LEG_HINGE0)
    if plant < 0.999:
        # 没钉住（跪下 / 摆腿 / 落地前）：蹄子不许钻进地里——低了就把踝往上抬再解一次
        for _ in range(2):
            low = probe_min(pbs["hoof"], HOOF_PROBES) - floor
            if low >= 0.005:
                break
            d = cur_dir(pbs["hoof"]).normalized()
            target = pbs["hoof"].matrix.translation + Vector((0, 0, 0.01 - low))
            two_bone(arm, "thigh", "shin", target, qy @ Vector((0, -1, 0.05)), LEG_HINGE0)
            orient(pbs["hoof"], d, hinge, LEG_HINGE0)


def leg_angles(arm, p: dict) -> dict:
    """解算后的三节绝对摆角（在 hips 转向系里，相对静止朝向）"""
    qi = Q(Z, p["yaw"]).inverted()
    return {b: seg_angle(qi @ cur_dir(arm.pose.bones[b])) - REST_ANG[b] for b in ("thigh", "shin", "hoof")}


def solve_arm(arm, s: int, ch: dict, t: float, v: float, dlt: Matrix, dlag: Matrix, floor: float = 0.0):
    """ch = 这一侧插值后的通道（anchor / w / cd / cr / aw / ac / pc / clav）"""
    n = "L" if s > 0 else "R"
    pbs = arm.pose.bones
    rot = dlt.to_3x3()
    sh = pbs["shoulder_" + n]
    if abs(ch["clav_up"]) > 1e-4:
        rot_about_head(sh, Q(rot @ Vector((0, -s, 0)), ch["clav_up"]))
    if abs(ch["clav_fwd"]) > 1e-4:
        rot_about_head(sh, Q(rot @ Vector((0, 0, -s)), ch["clav_fwd"]))
    c_pt = SHOULDER[s] + ch["cd"].normalized() * ch["cr"]
    k_c = dlag @ c_pt
    k_w = ch["w"] - FWD * (v * t)
    a = min(1.0, max(0.0, ch["anchor"]))
    knuckle = k_c.lerp(k_w, a)
    aimv = (rot @ ch["ac"]).normalized().lerp(ch["aw"].normalized(), a).normalized()
    pole = rot @ ch["pc"].normalized()
    wrist = knuckle - aimv * L_FIST
    two_bone(arm, "arm_" + n, "forearm_" + n, wrist, pole, ARM_HINGE0[s])
    aim(pbs["fist_" + n], aimv)
    if a < 0.999:
        # 没撑地的拳：低于地面就把整只拳往上抬再解一次（撑地的拳由钉点决定，不改）
        for _ in range(2):
            low = probe_min(pbs["fist_" + n], FIST_PROBES, s) - floor
            if low >= 0.005:
                break
            wrist = wrist + Vector((0, 0, 0.01 - low))
            two_bone(arm, "arm_" + n, "forearm_" + n, wrist, pole, ARM_HINGE0[s])
            aim(pbs["fist_" + n], aimv)
    return knuckle


def unpack(vec: list) -> dict:
    p = {k: vec[CI[k]] for k in BODY_KEYS + LEG_KEYS}
    for s in "LR":
        g = lambda k: vec[CI[f"{k}_{s}"]]
        p[s] = {"anchor": g("anchor"), "w": Vector((g("wx"), g("wy"), g("wz"))), "cd": Vector((g("cdx"), g("cdy"), g("cdz"))),
                "cr": g("cr"), "aw": Vector((g("awx"), g("awy"), g("awz"))), "ac": Vector((g("acx"), g("acy"), g("acz"))),
                "pc": Vector((g("pcx"), g("pcy"), g("pcz"))), "clav_up": g("clav_up"), "clav_fwd": g("clav_fwd")}
    return p


def resolve_key(arm, frame: float, pose: dict, v: float) -> list:
    """把一个关键姿势解成通道向量：腿在钉住时读回 IK 解出的摆角，手臂同时给出地面坐标 / 胸腔坐标两种表示"""
    dlt = build_body(arm, pose)
    vec = [0.0] * len(CHANNELS)
    for k in BODY_KEYS + LEG_KEYS:
        vec[CI[k]] = float(pose[k])
    if pose["plant"] >= 0.999:
        solve_leg(arm, pose, frame, v)
        for b, a in leg_angles(arm, pose).items():
            vec[CI[b]] = a
    inv = dlt.inverted()
    rot = dlt.to_3x3()
    for s, n in ((1, "L"), (-1, "R")):
        spec = pose[n]
        pt = side_vec(spec["p"], s)
        if spec["pin"]:
            w_g = pt
            root = pt - FWD * (v * frame)
            c_pt = inv @ root
            anchor = 1.0
        else:
            if spec["ref"] == "w":
                root = pt
                c_pt = inv @ root
            else:
                c_pt = pt
                root = dlt @ c_pt
            w_g = root + FWD * (v * frame)
            anchor = 0.0
        if spec["aim"] is None:
            aw = (root - dlt @ SHOULDER[s]).normalized()
        elif spec["pin"] or spec["ref"] == "w":
            aw = side_vec(spec["aim"], s).normalized()
        else:
            aw = (rot @ side_vec(spec["aim"], s)).normalized()
        ac = (rot.inverted() @ aw).normalized()
        rel = c_pt - SHOULDER[s]
        vals = {"anchor": anchor, "wx": w_g.x, "wy": w_g.y, "wz": w_g.z, "cdx": rel.normalized().x, "cdy": rel.normalized().y,
                "cdz": rel.normalized().z, "cr": rel.length, "awx": aw.x, "awy": aw.y, "awz": aw.z, "acx": ac.x, "acy": ac.y, "acz": ac.z}
        pc = side_vec(spec["pole"], s).normalized()
        vals.update(pcx=pc.x, pcy=pc.y, pcz=pc.z, clav_up=spec["clav"][0], clav_fwd=spec["clav"][1])
        for k, val in vals.items():
            vec[CI[f"{k}_{n}"]] = val
    return vec


def make_track(arm, clip: dict) -> Track:
    v = clip.get("speed", 0.0)
    keys = [(k[0], k[1], k[2] if len(k) > 2 else None) for k in clip["keys"]]
    keys.sort(key=lambda k: k[0])
    xs = [k[0] for k in keys]
    ys = [resolve_key(arm, f, pose, v) for f, pose, _ in keys]
    return Track(xs, ys, [e for _, _, e in keys])


def air_lift(clip: dict, t: float) -> float:
    """腾空段代码把根抬到抛物线上（bosses.ts：H·4k(1−k)，k = 出手段进度）"""
    air = clip.get("air")
    if not air or not air[0] < t < air[1]:
        return 0.0
    k = (t - air[0]) / (air[1] - air[0])
    return air[2] * 4 * k * (1 - k)


def solve_frame(arm, clip: dict, tr: Track, t: float, body_cache: dict) -> dict:
    v = clip.get("speed", 0.0)
    lag = clip.get("lag", 0)

    def body_at(tt):
        key = round(tt, 3)
        if key not in body_cache:
            body_cache[key] = build_body(arm, unpack(tr.at(tt)))
        return body_cache[key]

    t_lag = max(tr.xs[0], t - lag)   # 循环片段在 0 帧之前也有关键帧
    dlag = body_at(t_lag)
    p = unpack(tr.at(t))
    p_lag = unpack(tr.at(t_lag))
    dlt = build_body(arm, p)
    floor = -air_lift(clip, t)
    solve_leg(arm, p, t, v, floor)
    info = {"plant": p["plant"], "pin": hoof_pin(p, t, v)}
    for s, n in ((1, "L"), (-1, "R")):
        ch = dict(p[n])
        # 自由的手臂按 lag 帧之前的胸腔目标（overlapping action）；钉住的部分（anchor）不滞后
        ch["cd"], ch["cr"] = p_lag[n]["cd"], p_lag[n]["cr"]
        solve_arm(arm, s, ch, t, v, dlt, dlag, floor)
        info[n] = (ch["anchor"], ch["w"] - FWD * (v * t))
    return info


def fcurves(act) -> list:
    """动作的全部曲线（Blender 4.4 起是分层动作：layers → strips → channelbags）"""
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def bake_clip(arm, name: str, clip: dict):
    """逐帧解算、逐帧打键（旋转 + 位置），返回动作和每帧的着地信息（体检用）"""
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    tr = make_track(arm, clip)
    cache, prev, infos = {}, {}, {}
    for f in range(clip["frames"] + 1):
        infos[f] = solve_frame(arm, clip, tr, float(f), cache)
        for pb in arm.pose.bones:
            q = pb.rotation_quaternion.copy()
            if pb.name in prev and q.dot(prev[pb.name]) < 0:   # 四元数连续性：别绕远路
                q.negate()
                pb.rotation_quaternion = q
            prev[pb.name] = q
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            pb.keyframe_insert("location", frame=f, group=pb.name)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    return act, infos


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


# ═════════════ 事件叠加表 ═════════════
def write_events(path: Path):
    """只改手 K 且带事件的状态（数组简写），其余条目、about 原样保留"""
    doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"about": "", "clips": {}}
    clips = doc.setdefault("clips", {})
    def at(f, frames):
        a = round(min(1.0, f / frames), 3)
        return int(a) if a == int(a) else a   # 1 写成 1（和手写的条目一致）

    for name in EVENT_STATES:
        c = CLIPS[name]
        clips[name] = [{"at": at(f, c["frames"]), "name": n} for f, n in c["events"]]
    # LF 换行（Windows 上 write_text 默认会写成 CRLF）
    with open(path, "w", encoding="utf-8", newline="\n") as fp:
        fp.write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")


# ═════════════ 体检 ═════════════
def mesh_groups(mesh):
    import numpy as np
    vg = {g.index: g.name for g in mesh.vertex_groups}
    n = len(mesh.data.vertices)
    owner = np.empty(n, dtype=object)
    for v in mesh.data.vertices:
        owner[v.index] = vg[max(v.groups, key=lambda g: g.weight).group] if len(v.groups) else ""
    cat = np.zeros(n, dtype=np.int8)   # 0 身体 1 拳 2 蹄 3 腿（大腿 / 小腿）
    cat[(owner == "fist_L") | (owner == "fist_R")] = 1
    cat[owner == "hoof"] = 2
    cat[(owner == "thigh") | (owner == "shin")] = 3
    edges = np.empty(len(mesh.data.edges) * 2, dtype=np.int32)
    mesh.data.edges.foreach_get("vertices", edges)
    edges = edges.reshape(-1, 2)
    rest = np.empty(n * 3)
    mesh.data.vertices.foreach_get("co", rest)
    rest = rest.reshape(-1, 3)
    rl = np.linalg.norm(rest[edges[:, 0]] - rest[edges[:, 1]], axis=1)
    keep = rl > 0.02
    return cat, edges[keep], rl[keep], owner


def check_clip(arm, mesh, groups, name: str, clip: dict, act, infos: dict) -> dict:
    import numpy as np
    cat, edges, rl, owner = groups
    sc = bpy.context.scene
    arm.animation_data.action = act
    n = len(mesh.data.vertices)
    co = np.empty(n * 3)
    # stretch = 全网格最大边拉伸比（静止边长 > 2 cm）；p99 = 每帧 99 分位拉伸比的最大值；grow = 最大伸长（米）
    out = {"minz": {"fist": (9, 0), "hoof": (9, 0), "leg": (9, 0), "body": (9, 0)}, "stretch": (0, 0, ""), "p99": (0, 0),
           "grow": (0, 0), "hoof_slide": (0, 0), "fist_slide": (0, 0)}
    air = clip.get("air")
    names = {0: "body", 1: "fist", 2: "hoof", 3: "leg"}
    for f in range(clip["frames"] + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dg)
        me = ev.to_mesh()
        me.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        p = co.reshape(-1, 3)
        lift = air_lift(clip, f)   # 腾空段按世界高度算穿地
        for c, nm in names.items():
            m = p[cat == c][:, 2].min() + lift
            if m < out["minz"][nm][0]:
                out["minz"][nm] = (round(float(m), 3), f)
        dl = np.linalg.norm(p[edges[:, 0]] - p[edges[:, 1]], axis=1)
        ratio = dl / rl
        i = int(ratio.argmax())
        if ratio[i] > out["stretch"][0]:
            out["stretch"] = (round(float(ratio[i]), 2), f, owner[edges[i, 0]] + "/" + owner[edges[i, 1]])
        q = float(np.percentile(ratio, 99))
        if q > out["p99"][0]:
            out["p99"] = (round(q, 3), f)
        g = float((dl - rl).max())
        if g > out["grow"][0]:
            out["grow"] = (round(g, 3), f)
        # 着地帧的蹄 / 撑地的拳：骨骼实际位置 vs 钉点
        inf = infos[f]
        pbs = arm.pose.bones
        if inf["plant"] >= 0.999:
            ankle, _ = inf["pin"]
            d = (pbs["hoof"].matrix.translation - ankle).length
            if d > out["hoof_slide"][0]:
                out["hoof_slide"] = (round(d, 4), f)
        for s, nm in ((1, "L"), (-1, "R")):
            a, w = inf[nm]
            if a >= 0.999:
                fist = pbs["fist_" + nm]
                tip = fist.matrix.translation + cur_dir(fist).normalized() * L_FIST
                d = (tip - w).length
                if d > out["fist_slide"][0]:
                    out["fist_slide"] = (round(d, 4), f)
    if clip.get("loop_check"):
        sc.frame_set(0)
        a0 = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones}
        sc.frame_set(clip["frames"])
        worst = (0.0, 0.0)
        for pb in arm.pose.bones:
            q0, l0 = a0[pb.name]
            ang = math.degrees(q0.rotation_difference(pb.rotation_quaternion).angle)
            ang = min(ang, 360 - ang)
            worst = (max(worst[0], ang), max(worst[1], (l0 - pb.location).length))
        out["loop_seam"] = {"deg": round(worst[0], 4), "m": round(worst[1], 5)}
    return out


# ═════════════ 审核联系表 ═════════════
TILE = 300


def review_frames(clip: dict) -> list:
    if "review" in clip:
        return clip["review"]
    fs = sorted({k[0] for k in clip["keys"] if 0 <= k[0] <= clip["frames"]})
    return fs


def setup_review(mesh):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_cavity = True
    sh.show_shadows = False
    sc.render.resolution_x = sc.render.resolution_y = TILE
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.16, 0.17, 0.2)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 10.5
    # 地面：一块薄板 + 侧视时看得见的地平线（薄盒子，顶面 z = 0）
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.03))
    ground = bpy.context.active_object
    ground.scale = (14, 14, 0.06)
    gm = bpy.data.materials.new("ground")
    gm.diffuse_color = (0.32, 0.34, 0.3, 1)
    ground.data.materials.append(gm)
    # 标签：挂在相机上的文字
    cu = bpy.data.curves.new("label", "FONT")
    cu.size = 0.55
    txt = bpy.data.objects.new("label", cu)
    sc.collection.objects.link(txt)
    tm = bpy.data.materials.new("label")
    tm.diffuse_color = (1.0, 0.85, 0.3, 1)
    cu.materials.append(tm)
    txt.parent = cam
    txt.location = (-10.5 / 2 + 0.2, 10.5 / 2 - 0.75, -5)
    return sc, cam, txt


def render_review(arm, mesh, actions: dict, out: Path):
    import numpy as np
    out.mkdir(parents=True, exist_ok=True)
    sc, cam, txt = setup_review(mesh)
    centre = Vector((0, -0.4, 4.25))
    rows = []
    for name, clip in CLIPS.items():
        if ONLY and name not in ONLY:
            continue
        arm.animation_data.action = actions[name]
        cols = []
        for f in review_frames(clip):
            fi = int(math.floor(f))
            sc.frame_set(fi, subframe=f - fi)
            col = []
            for view, yaw, up in (("side", 90, 0.0), ("q", 35, 0.22)):
                a = math.radians(yaw)
                d = Vector((math.sin(a), -math.cos(a), up)).normalized()
                cam.location = centre + d * 30
                cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
                txt.data.body = f"{name} f{f:g}" if view == "side" else ""
                p = out / f"_{name}_{f:05.1f}_{view}.png"
                sc.render.filepath = str(p)
                bpy.ops.render.render(write_still=True)
                img = bpy.data.images.load(str(p))
                px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
                bpy.data.images.remove(img)
                col.append(px[::-1, :, :3])   # 上 → 下
            cols.append(np.concatenate(col, axis=0))
        strip = np.concatenate(cols, axis=1)
        save_jpg(strip, out / f"{name}.jpg")
        rows.append(strip)
    # 总图：每段一行（列太多就折行），每列 = 侧视在上、3/4 在下；缩到半尺寸，宽 ≤ 2400
    half = TILE // 2
    per = 2400 // half
    blocks = []
    for strip in rows:
        small = strip.reshape(strip.shape[0] // 2, 2, strip.shape[1] // 2, 2, 3).mean(axis=(1, 3))
        ncol = small.shape[1] // half
        for i in range(0, ncol, per):
            seg = small[:, i * half:(i + per) * half]
            pad = np.full((seg.shape[0], per * half - seg.shape[1], 3), 0.1, dtype=np.float32)
            blocks.append(np.concatenate([seg, pad], axis=1))
            blocks.append(np.full((4, per * half, 3), 0.55, dtype=np.float32))
    if blocks:
        sheet = np.concatenate(blocks, axis=0)
        save_jpg(sheet, out / "kui-keyposes.jpg")
        if not ONLY:
            SHEET.parent.mkdir(parents=True, exist_ok=True)
            save_jpg(sheet, SHEET)


def save_jpg(arr, path: Path):
    import numpy as np
    h, w = arr.shape[:2]
    img = bpy.data.images.new(path.stem, w, h, alpha=False)
    rgba = np.concatenate([arr[::-1], np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = str(path)
    img.file_format = "JPEG"
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    img.save_render(str(path), scene=sc)
    sc.render.image_settings.file_format = "PNG"
    bpy.data.images.remove(img)


# ═════════════ 主流程 ═════════════
def main():
    arm, mesh = load_rig()
    actions, infos = {}, {}
    for name, clip in CLIPS.items():
        if ONLY and name not in ONLY:
            continue
        actions[name], infos[name] = bake_clip(arm, name, clip)
    report = {}
    if CHECK:
        groups = mesh_groups(mesh)
        for name in actions:
            report[name] = check_clip(arm, mesh, groups, name, CLIPS[name], actions[name], infos[name])
            print("KUI_CHECK " + name + " " + json.dumps(report[name], ensure_ascii=False))
    if REVIEW:
        render_review(arm, mesh, actions, REVIEW)
        print("KUI_REVIEW " + str(REVIEW))
        return
    # 导出前顶层物体绕 Z 转 180°（同 bl_unity_export：Unity 里角色朝 +Z）；只写在物体上，骨骼的局部动画不受影响
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    # 再放一个顶层空物体：FBX 里只有一个顶层物体时 Unity 会把它折叠成文件根节点，层级就和本体对不上（同 hanba_anims.py）
    keep = bpy.data.objects.new(f"{ASSET}_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    summary = {}
    for name, act in actions.items():
        clip = CLIPS[name]
        export_fbx(arm, act, name, clip["frames"], UNITY / "Keyframed")
        summary[name] = {"frames": clip["frames"], "seconds": round(clip["frames"] / FPS, 3),
                         "events": [[f, n, round(f / clip["frames"], 3)] for f, n in clip["events"]]}
    if not ONLY:
        write_events(UNITY / f"{ASSET}.events.json")
    print("KUI_ANIMS " + json.dumps(summary, ensure_ascii=False))


main()
