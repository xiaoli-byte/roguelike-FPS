"""火麒麟（SK_Boss_Qilin 玄鳞 / SK_Boss_QilinBurn 焚身）手工关键帧动作：Blender 无头脚本，一次生成一个形态的全部招牌片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Qilin/anim/qilin_anims.py -- [--form xuan|burn] [--review <目录>]
    （焚身也可以直接跑 art/source/characters/SK_Boss_QilinBurn/anim/qilin_burn_anims.py）

设计单见 docs/art/vfx/qilin.md（每个招式的节拍表、关键姿势和这里的帧号一一对应）。

产出（都可以重新生成，FBX 按 unity/.gitignore 不入库）：
  unity/Assets/Art/Characters/<资产>/Anim/Keyframed/<状态>.fbx   一个状态一个文件（文件名 = Animator 状态名），同名时覆盖原生采样片段
  unity/Assets/Art/Characters/<资产>/Anim/<资产>.events.json     事件叠加表：只改这里手 K 的状态，其余状态（饮熔、喘息、硬直…）原样保留
  --review <目录>   每段关键帧的侧视 / 3/4 视联系表（Workbench 贴图着色，审核用，不入库）

骨架来自发布的 public/assets/characters/<资产>.glb（骨骼名见 art/pipeline/creature_rigs/<资产>.json，两个形态骨骼名、层级相同、位置各自实测），
导入 / 导出设置与 art/pipeline/blender/bl_unity_export.py 一致（同一个 glTF 导入器给出的骨骼朝向、顶层物体绕 Z 转 180°、-Z 前 / Y 上、主骨轴 Y），
所以片段里每根骨的局部旋转和本体 FBX 的骨骼局部坐标一一对应；Unity 侧是 Generic，NativeClipBuilder 按骨骼名把曲线接到本体上（丢掉文件根节点的曲线）。

姿势写法（Blender 坐标：front = -Y，生物的左 = +X，up = +Z；角度都是度）：
  pitch   整个身体绕臀部（hips 头，尾根处）俯仰：正 = 低头 / 前身往下，负 = 前身抬起（人立）
  spine / chest / neck1 / neck2   脊柱逐节的相对弯曲（绕世界 X，正 = 往下弯）；chest_yaw / neck_yaw / head_yaw 绕世界 Z 的 S 形扭（正 = 转向生物的左）
  head    头的「绝对」俯仰（相对静止姿势、世界里的朝向）：正 = 低头，负 = 仰头；脖子怎么弯都不影响头最后朝哪
  jaw     张嘴（正 = 下颌往下张）
  fl / fr / hl / hr   四条腿每一节（上臂·前臂·掌骨·蹄 / 大腿·小腿·跖骨·蹄）的绝对摆角（相对静止姿势的世界朝向）：正 = 往后摆，负 = 往前摆；
                      None 的蹄子 = 踩地的腿保持蹄底水平，不踩地的跟着掌骨
  tail    三节尾巴的相对上翘（正 = 往上卷）；tail_yaw 三节绕 Z 的 S 形摆
  lift    整体抬高（米，腾空姿势用）；plant 哪几条腿踩地（"all" / "hind" / "front" / None）：踩地的腿解算完后把整个身体平移，让它们的蹄子回到静止时的高度和前后位置
形态：焚身（burn）的幅度乘 1.15、尾巴和脖子的 S 形扭再乘 1.5（轻、狂）；玄鳞（xuan）按原值，收招多一拍沉稳的落定（重、稳）。
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[5]
FPS = 30
X, Z = (1, 0, 0), (0, 0, 1)
ASSETS = {"xuan": "SK_Boss_Qilin", "burn": "SK_Boss_QilinBurn"}

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FORM = argv[argv.index("--form") + 1] if "--form" in argv else "xuan"
REVIEW = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
# --only a,b：审核图只渲这几段（迭代姿势时省时间）
ONLY = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
ASSET = ASSETS[FORM]
GLB = ROOT / f"public/assets/characters/{ASSET}.glb"
UNITY = ROOT / f"unity/Assets/Art/Characters/{ASSET}/Anim"
AMP = 1.15 if FORM == "burn" else 1.0
WHIP = 1.5 if FORM == "burn" else 1.0

FRONT = {"L": ("upperarm_L", "forearm_L", "fcannon_L", "fhoof_L"), "R": ("upperarm_R", "forearm_R", "fcannon_R", "fhoof_R")}
HIND = {"L": ("thigh_L", "shin_L", "hcannon_L", "hhoof_L"), "R": ("thigh_R", "shin_R", "hcannon_R", "hhoof_R")}


def P(pitch=0.0, spine=0.0, chest=0.0, neck1=0.0, neck2=0.0, head=0.0, jaw=0.0, chest_yaw=0.0, neck_yaw=0.0, head_yaw=0.0,
      fl=(0, 0, 0, None), fr=None, hl=(0, 0, 0, None), hr=None, tail=(0, 0, 0), tail_yaw=(0, 0, 0), lift=0.0, fwd=0.0, plant="all") -> dict:
    """一个关键姿势（参数见文件头）。fr / hr 缺省 = 和左边一样"""
    return {"pitch": pitch, "spine": spine, "chest": chest, "neck1": neck1, "neck2": neck2, "head": head, "jaw": jaw,
            "chest_yaw": chest_yaw, "neck_yaw": neck_yaw, "head_yaw": head_yaw, "fl": fl, "fr": fr or fl, "hl": hl, "hr": hr or hl,
            "tail": tail, "tail_yaw": tail_yaw, "lift": lift, "fwd": fwd, "plant": plant}


def amp(p: dict) -> dict:
    """按形态放大幅度（焚身轻、狂）"""
    if AMP == 1.0 and WHIP == 1.0:
        return p
    q = dict(p)
    for k in ("pitch", "spine", "chest", "neck1", "neck2", "head", "jaw"):
        q[k] = p[k] * AMP
    for k in ("chest_yaw", "neck_yaw", "head_yaw"):
        q[k] = p[k] * WHIP
    for k in ("fl", "fr", "hl", "hr"):
        q[k] = tuple(None if v is None else v * AMP for v in p[k])
    q["tail"] = tuple(v * AMP for v in p["tail"])
    q["tail_yaw"] = tuple(v * WHIP for v in p["tail_yaw"])
    return q


def ops_of(p: dict) -> list:
    """姿势 → 依次执行的 [骨, 轴, 角度] / [骨, "loc", 位移]（父在前、子在后；角度都是相对上一步的增量）"""
    p = amp(p)
    ops = [["hips", X, p["pitch"]]]
    body = p["pitch"]
    ops += [["spine", X, p["spine"]], ["chest", X, p["chest"]], ["chest", Z, p["chest_yaw"]]]
    chest_abs = body + p["spine"] + p["chest"]
    ops += [["neck_1", X, p["neck1"]], ["neck_1", Z, p["neck_yaw"]], ["neck_2", X, p["neck2"]]]
    neck_abs = chest_abs + p["neck1"] + p["neck2"]
    ops += [["head", X, p["head"] - neck_abs], ["head", Z, p["head_yaw"]], ["jaw", X, p["jaw"]]]
    for side in "LR":
        for bones, spec, parent_abs, planted in ((FRONT[side], p["f" + side.lower()], chest_abs, p["plant"] in ("all", "front")),
                                                 (HIND[side], p["h" + side.lower()], body, p["plant"] in ("all", "hind"))):
            prev = parent_abs
            for i, b in enumerate(bones):
                a = spec[i] if i < len(spec) else None
                if a is None:
                    # 蹄子：踩地的保持蹄底水平（绝对 0），不踩地的跟着掌骨
                    a = 0.0 if planted else prev
                ops.append([b, X, a - prev])
                prev = a
    t1, t2, t3 = p["tail"]
    y1, y2, y3 = p["tail_yaw"]
    # 尾巴挂在 hips 上：整体俯仰时先抵掉一半（尾巴不跟着身体整根翘到天上）
    ops += [["tail_1", X, t1 + p["pitch"] * 0.5], ["tail_1", Z, y1], ["tail_2", X, t2], ["tail_2", Z, y2], ["tail_3", X, t3], ["tail_3", Z, y3]]
    return ops


# ───────────── 关键姿势（玄鳞的设计值；焚身按 amp 放大）─────────────
BASE = P()
# 张鳞 / 长啸 · 人立
SQUASH = P(pitch=7, chest=3, neck1=8, head=16, fl=(-4, 6, -6), hl=(-14, 22, -10), tail=(-12, 0, 0))
RISE = P(pitch=-26, chest=-3, neck1=14, neck2=4, head=-10, jaw=6, fl=(-48, -30, 40, 30), fr=(-40, -20, 55, 40), hl=(-12, 18, -8), tail=(18, 6, -6),
         plant="hind")
REAR_X = P(pitch=-44, spine=-2, chest=-4, neck1=26, neck2=8, head=-26, jaw=22, fl=(-72, -50, 60, 40), fr=(-64, -36, 74, 52),
           hl=(-24, 18, -6), tail=(32, 14, -12), tail_yaw=(0, 10, -14), plant="hind")
REAR_HOLD = P(pitch=-48, spine=-3, chest=-5, neck1=28, neck2=8, head=-32, jaw=26, fl=(-66, -40, 70, 48), fr=(-74, -52, 58, 40),
              hl=(-26, 20, -6), tail=(36, 16, -14), tail_yaw=(0, -10, 14), plant="hind")
REAR_SMEAR = P(pitch=-18, spine=2, chest=2, neck1=16, neck2=4, head=2, jaw=10, fl=(-46, -46, -40), hl=(-16, 18, -6), tail=(8, 6, 0), plant="hind")
STAMP = P(pitch=5, chest=5, neck1=9, neck2=4, head=24, jaw=12, fl=(-14, -6, 4), hl=(-10, 14, -6), tail=(-16, -4, 6), plant="all")
STAMP_HOLD = P(pitch=7, chest=6, neck1=10, neck2=4, head=26, jaw=14, fl=(-16, -10, 8), hl=(-12, 18, -8), tail=(-18, -6, 6), plant="all")
RECOIL = P(pitch=-6, chest=-3, neck1=-4, head=-10, jaw=4, fl=(-6, 2, -2), hl=(-6, 8, -4), tail=(22, 10, -4), tail_yaw=(6, -8, 8))
SETTLE = P(pitch=2, neck1=2, head=4, tail=(-6, 2, 2), tail_yaw=(-3, 4, -4))
# 冲撞 · 刨蹄
WEIGHT_BACK = P(pitch=-5, neck1=12, head=24, hl=(-10, 16, -8), tail=(8, 0, 0))
PAW_UP = P(pitch=-6, neck1=14, head=28, fr=(-36, -30, 70, 40), fl=(-2, 0, 0), hl=(-12, 18, -8), tail=(14, 4, 0))
PAW_SCRAPE = P(pitch=-3, neck1=14, head=30, fr=(22, 18, 30), fl=(-4, 0, 0), hl=(-12, 18, -8), tail=(12, 4, 0))
LOAD = P(pitch=9, chest=4, neck1=22, neck2=6, head=46, fl=(-12, -6, 0), hl=(-28, 44, -22), tail=(26, 12, -8), tail_yaw=(0, 6, -8))
LOAD_HOLD = P(pitch=10, chest=5, neck1=24, neck2=6, head=48, fl=(-14, -8, 0), hl=(-30, 48, -24), tail=(28, 14, -8), tail_yaw=(0, -6, 8))
# 俯冲 · 蜷身 / 砸下（腾空）
GATHER = P(pitch=-8, chest=4, neck1=4, head=8, fl=(-30, -20, 40), hl=(-26, 34, -10), tail=(16, -6, -8), lift=0.15, plant=None)
COIL = P(pitch=-6, spine=10, chest=8, neck1=12, head=32, fl=(-62, -55, 80, 40), hl=(-56, 56, -28), tail=(40, -30, -40), tail_yaw=(0, 20, -25),
         lift=0.3, plant=None)
COIL_HOLD = P(pitch=-4, spine=12, chest=9, neck1=13, head=34, fl=(-64, -58, 84, 44), hl=(-58, 60, -30), tail=(44, -32, -42), tail_yaw=(0, -18, 24),
              lift=0.35, plant=None)
UNCOIL = P(pitch=-12, spine=6, chest=4, neck1=6, head=14, fl=(-58, -50, 70, 40), hl=(-50, 50, -24), tail=(36, -20, -30), lift=0.4, plant=None)
DIVE = P(pitch=26, spine=-2, chest=-2, neck1=6, head=22, fl=(-46, -42, -40), hl=(36, 34, 36), tail=(-8, 4, 6), tail_yaw=(0, 6, -6), lift=0.2, plant=None)
SLAM = P(pitch=12, spine=3, chest=7, neck1=10, neck2=4, head=34, jaw=16, fl=(-16, -4, 22), hl=(-12, 24, -10), tail=(46, -18, -26),
         tail_yaw=(0, 18, -22), plant="front")
SLAM_HOLD = P(pitch=14, spine=4, chest=8, neck1=11, neck2=4, head=36, jaw=18, fl=(-18, -8, 26), hl=(-14, 26, -12), tail=(48, -20, -28),
              tail_yaw=(0, 20, -24), plant="front")
ROAR_UP = P(pitch=-8, chest=-3, neck1=-8, head=-16, jaw=20, fl=(-8, 2, -2), hl=(-8, 12, -6), tail=(22, 8, -8), tail_yaw=(0, -12, 14))
# 吐息
INHALE = P(pitch=-7, chest=-6, neck1=-6, neck2=-3, head=-30, jaw=0, fl=(-8, 0, 0), hl=(-8, 12, -6), tail=(10, 4, 0))
INHALE_HOLD = P(pitch=-8, chest=-7, neck1=-7, neck2=-4, head=-34, jaw=2, fl=(-9, 0, 0), hl=(-9, 13, -6), tail=(12, 4, 0))
BLOW = P(pitch=6, chest=4, neck1=18, neck2=8, head=22, jaw=30, fl=(-12, -4, 0), hl=(-6, 10, -4), tail=(-6, 6, 4), tail_yaw=(0, 6, -6))
BLOW_B = P(pitch=5, chest=4, neck1=17, neck2=8, head=20, jaw=24, neck_yaw=3, fl=(-12, -4, 0), hl=(-6, 10, -4), tail=(-4, 4, 6), tail_yaw=(0, -6, 6))


# ───────────── 第二批 B 路（2026-10-31，设计单 §2.9–2.12）：跃起、饮熔、硬直、喘息、焚身踏云步态 ─────────────
# 跃起（玄鳞：先在地上蹲 0.28 s 再起跳，ScaleDrink 的抛物线也晚 0.28 s 起；焚身：从熔岩柱里冲出来已在半空）
# plant="level"：四蹄都踩地，身体俯仰由前后腿的长短自动补（apply）；"ground"：趴 / 跪，腿上最低点落地
LEAP_CROUCH = P(pitch=-8, chest=4, neck1=10, head=20, fl=(-18, 22, -4), hl=(-14, 22, -10), tail=(-10, 0, 0), plant="level")
LEAP_PUSH = P(pitch=-22, spine=-2, neck1=8, head=6, fl=(-52, -44, 74, 42), hl=(30, 28, 34), tail=(14, 6, -4), plant=None)
LEAP_RISE = P(pitch=-14, neck1=14, head=14, fl=(-70, -60, 95, 50), hl=(24, 22, 30), tail=(22, 10, -6), plant=None)
LEAP_APEX = P(pitch=0, spine=4, chest=3, neck1=16, head=26, fl=(-62, -56, 86, 46), hl=(-50, 58, -24), tail=(28, -10, -16),
              tail_yaw=(0, 8, -10), plant=None)
LEAP_DESCEND = P(pitch=14, neck1=10, head=26, fl=(-42, -38, -24), hl=(-30, 40, -14), tail=(34, -16, -24), tail_yaw=(0, -8, 10), plant=None)
LEAP_REACH = P(pitch=18, neck1=6, head=20, fl=(-30, -26, -18), hl=(-16, 26, -10), tail=(38, -14, -24), plant=None)
LEAP_LAND = P(pitch=8, chest=5, neck1=12, head=28, jaw=6, fl=(-12, 8, -2), hl=(-20, 36, -18), tail=(40, -16, -26), tail_yaw=(0, 10, -12))
# 饮熔：落地缓冲 → 前腿往前撑开、前身压低、脖子伸长探向熔池 → 一口一口地吞（下颌一张一合、喉部一缩、尾巴慢摆）→ 喝完抬头鳞光
# （前腿撑开压低前身、后腿几乎伸直：前后腿一短一长，level 解出来前身往下压）
DRINK_RECOIL = P(pitch=2, neck1=4, head=10, fl=(-10, 4, 2), hl=(-6, 10, -4), tail=(30, -8, -16), tail_yaw=(0, -6, 8), plant="level")
DRINK_REACH = P(pitch=14, chest=10, neck1=38, neck2=24, head=80, jaw=10, fl=(-52, -26, 30), hl=(8, -20, 12), tail=(10, 4, 6), plant="level")
DRINK_SIP_A = P(pitch=15, chest=11, neck1=40, neck2=26, head=84, jaw=18, fl=(-54, -28, 32), hl=(8, -20, 12), tail=(8, 4, 6), tail_yaw=(4, 8, -6),
                plant="level")
DRINK_SIP_B = P(pitch=13, spine=-3, chest=7, neck1=33, neck2=18, head=72, jaw=3, fl=(-50, -24, 28), hl=(8, -20, 12), tail=(10, 6, 4),
                tail_yaw=(-4, -8, 6), plant="level")
DRINK_DONE = P(pitch=-6, chest=-3, neck1=2, head=-14, jaw=18, fl=(-8, 2, -2), hl=(-12, 20, -10), tail=(26, 10, -8), tail_yaw=(0, -10, 12), plant="level")
# 硬直（鼎角砸在背上）：一砸、四腿一软 → 前腿跪地、后腿折起，瘫在地上 → 晕眩摇头 → 前腿撑起、甩头起身
STUN_HIT = P(pitch=8, chest=6, neck1=18, neck_yaw=14, head=30, head_yaw=20, jaw=18, fl=(-14, 30, -20), hl=(6, -14, 8), tail=(30, 14, -10), plant="level")
STUN_BUCKLE = P(pitch=10, spine=4, chest=6, neck1=22, neck_yaw=10, head=38, head_yaw=14, jaw=12, fl=(-6, 10, 40, 20), hl=(-26, 46, -30),
                tail=(10, 4, 0), plant="ground")
STUN_DOWN = P(pitch=6, spine=5, chest=6, neck1=26, neck2=10, neck_yaw=8, head=42, head_yaw=14, jaw=10, fl=(-6, 4, 88, 40), hl=(-40, 76, -56),
              tail=(-14, -6, 4), tail_yaw=(6, -4, 2), plant="ground")
STUN_SETTLE = dict(STUN_DOWN, pitch=8, head=48, lift=-0.06)
DAZE_A = dict(STUN_DOWN, neck_yaw=12, head=38, head_yaw=18, jaw=8, tail_yaw=(6, -4, 2))
DAZE_B = dict(STUN_DOWN, neck_yaw=-10, head=48, head_yaw=-16, jaw=14, tail_yaw=(-4, 6, -4))
STUN_STRUGGLE = P(pitch=-4, spine=2, chest=4, neck1=12, head=20, jaw=6, fl=(-20, -10, 24, 10), hl=(-32, 56, -36), tail=(6, 4, 0), plant="ground")
STUN_SHAKE_A = P(pitch=2, neck1=6, neck_yaw=-10, head=10, head_yaw=20, jaw=8, fl=(-8, 6, 0), hl=(-8, 12, -6), tail=(16, 8, -4), tail_yaw=(0, -10, 12),
                 plant="level")
STUN_SHAKE_B = P(pitch=2, neck1=6, neck_yaw=10, head=12, head_yaw=-18, jaw=4, fl=(-6, 4, 0), hl=(-6, 10, -4), tail=(14, 6, -4), tail_yaw=(0, 10, -12),
                 plant="level")
# 喘息（焚身三踏之后落地）：砸地 → 前腿撑开、头垂到地、胸口一起一伏地喘（每 16 帧一口）→ 抬头盯玩家 → 压低蓄力准备起飞
PANT_SAG = P(pitch=10, spine=10, chest=10, neck1=36, neck2=16, head=64, jaw=18, fl=(-42, -18, 22), hl=(6, -18, 10), tail=(-18, -6, 4),
             tail_yaw=(4, -4, 4), plant="level")
PANT_IN = P(pitch=6, spine=4, chest=0, neck1=26, neck2=12, head=48, jaw=28, fl=(-36, -14, 18), hl=(2, -8, 4), tail=(-14, -4, 4), tail_yaw=(-3, 4, -2),
            plant="level")
PANT_OUT = P(pitch=11, spine=11, chest=11, neck1=38, neck2=16, head=68, jaw=10, fl=(-44, -20, 24), hl=(8, -22, 12), tail=(-18, -6, 6),
             tail_yaw=(3, -4, 4), plant="level")
PANT_LOOK = P(pitch=2, chest=3, neck1=14, head=18, jaw=8, fl=(-20, -4, 8), hl=(-8, 12, -6), tail=(6, 4, 0), plant="level")
PANT_GATHER = P(pitch=4, chest=4, neck1=10, head=24, fl=(-14, 18, -6), hl=(-16, 26, -12), tail=(22, 10, -6), tail_yaw=(0, 6, -8), plant="level")
PANT_GATHER_HOLD = P(pitch=6, chest=5, neck1=11, head=28, fl=(-16, 20, -6), hl=(-18, 30, -14), tail=(26, 12, -8), tail_yaw=(0, -6, 8), plant="level")


def leap_clip() -> dict:
    """跃起（ScaleDrink 前摇 1.0 s / 化焚身 3.6 s 跃回岸上 1.0 s）：最后一帧前蹄落地 = 饮熔第 0 帧（玄鳞接 drink，next）"""
    if FORM == "burn":
        keys = [(0, LEAP_PUSH), (6, LEAP_RISE), (14, LEAP_APEX), (21, LEAP_DESCEND), (26, LEAP_REACH), (30, LEAP_LAND)]
        return {"frames": 30, "keys": keys, "events": [(29.5, "hit")]}
    # 第 8 帧起跳 = ScaleDrink.CrouchFrac（0.28）：代码的抛物线在这一帧离地，最高点在第 19 帧前后
    keys = [(0, BASE), (5, LEAP_CROUCH), (8, LEAP_PUSH), (12, LEAP_RISE), (18, LEAP_APEX), (23, LEAP_DESCEND), (27, LEAP_REACH), (30, LEAP_LAND)]
    return {"frames": 30, "keys": keys, "events": [(8, "fx:qLeap"), (29.5, "hit")], "next": "drink"}


def drink_clip() -> dict:
    """饮熔（4.0 s = 120 帧，按 drinkSeconds 拉伸）：落地缓冲 → 探向熔池 → 每 10 帧一口 → 第 116 帧抬头（喝完的鳞光、长啸在 4.0 s）"""
    keys = [(0, LEAP_LAND), (5, DRINK_RECOIL), (14, DRINK_REACH)]
    f, k = 22, 0
    while f <= 100:
        keys.append((f, DRINK_SIP_A if k % 2 == 0 else DRINK_SIP_B))
        f, k = f + 10, k + 1
    keys += [(108, DRINK_REACH), (116, DRINK_DONE), (120, DRINK_DONE)]
    return {"frames": 120, "keys": keys, "events": [(1, "hit")]}


def stun_clip() -> dict:
    """
    硬直（鼎角砸晕 4.0 s = 120 帧；撞柱 1.6 s、倒下也用它，按时长拉伸）：f3 一砸 → f8 四腿一软 → f14 瘫倒（extreme）→ f20 再往下一沉 →
    f28–f96 晕眩摇头（每 12 帧左右换一次）→ f100 前腿撑起 → f110 / f116 甩头 → f120 站定。倒下时只播到 72%（QilinBrain：躺着不起来）
    """
    keys = [(0, BASE), (3, STUN_HIT), (8, STUN_BUCKLE), (14, STUN_DOWN), (20, STUN_SETTLE)]
    f, k = 28, 0
    while f <= 92:
        keys.append((f, DAZE_A if k % 2 == 0 else DAZE_B))
        f, k = f + 12, k + 1
    keys += [(100, STUN_STRUGGLE), (110, STUN_SHAKE_A), (116, STUN_SHAKE_B), (120, SETTLE)]
    return {"frames": 120, "keys": keys, "events": [(3, "fx:qStunHit"), (14, "fx:qStunDown")]}


def pant_clip() -> dict:
    """喘息（3.5 s = 105 帧）：砸地 → 垮下去 → 每 16 帧一口（吸：胸抬口张 / 呼：胸塌头垂）→ f76 抬头盯玩家 → f84 起压低蓄力（起飞预警在 f81）"""
    keys = [(0, SLAM_HOLD), (8, PANT_SAG)]
    f = 14
    while f <= 62:
        keys += [(f, PANT_IN), (f + 8, PANT_OUT)]
        f += 16
    keys += [(76, PANT_LOOK), (86, PANT_GATHER), (100, PANT_GATHER_HOLD), (105, PANT_GATHER_HOLD)]
    return {"frames": 105, "keys": keys, "events": [(3, "hit")]}


def _lerp_cyc(samples: list, u: float) -> tuple:
    """周期样条：samples = [(相位, 值元组)]（相位 0–1 递增），u 任意实数；相邻样本之间余弦缓动插值"""
    u %= 1.0
    n = len(samples)
    for i in range(n):
        p0, v0 = samples[i]
        p1, v1 = samples[(i + 1) % n]
        span = (p1 - p0) % 1.0 or 1.0
        d = (u - p0) % 1.0
        if d <= span + 1e-9:
            t = d / span
            t = 0.5 - 0.5 * math.cos(math.pi * t)
            return tuple(a + (b - a) * t for a, b in zip(v0, v1))
    return samples[0][1]


# 踏云步态（焚身专属的空中奔跑，循环 24 帧 = 0.8 s，录制速度沿用 Move 的 16 m/s）：四蹄成对踏云的「跳跃式奔驰」——
# 后蹄对踏（ψ = 0，后右晚 0.06）→ 前身扬起、前腿高高蜷起、后腿往后蹬直（飞驰）→ 前腿前探 → 前蹄对踏（ψ = 0.5）→ 前身一沉、后腿收到腹下 → 再踏。
# 每条腿：踏云起点（蹄在身下）→ 往后蹬到底 → 收起（掌骨往后折）→ 高蜷 → 前探 → 回到踏云起点
GAIT_FRONT = [(0.0, (-12, -8, -4)), (0.16, (26, 16, 34)), (0.34, (-14, -24, 78)), (0.56, (-56, -52, 86)), (0.80, (-46, -40, -18))]
GAIT_HIND = [(0.0, (-32, 32, -14)), (0.16, (32, 28, 36)), (0.36, (22, 52, 12)), (0.56, (-40, 62, -20)), (0.80, (-48, 42, -26))]
GAIT_LEGS = {"fl": (GAIT_FRONT, 0.50), "fr": (GAIT_FRONT, 0.56), "hl": (GAIT_HIND, 0.0), "hr": (GAIT_HIND, 0.06)}


def gait_pose(phi: float) -> dict:
    """踏云步态第 phi（0–1）处的姿势：身体跟着蹬踏起伏俯仰，脖子、头、尾巴按相位滞后跟随（没有鬃毛骨骼，「鬃尾随风」靠头颈和三节尾巴的滞后）"""
    s = lambda lag: math.sin(2 * math.pi * (phi - lag))
    legs = {k: tuple(v) + (None,) for k, (samples, off) in GAIT_LEGS.items() for v in [_lerp_cyc(samples, phi - off)]}
    pitch = -7 * math.sin(2 * math.pi * (phi + 0.05))
    return P(pitch=pitch, spine=4 * s(-0.3), chest=3 * s(-0.25), neck1=10 + 7 * s(0.07), neck2=4 + 4 * s(0.2), head=12 + 3 * s(0.25), jaw=5 + 3 * s(0.3),
             neck_yaw=2 * s(0.1), head_yaw=-1.5 * s(0.2), fl=legs["fl"], fr=legs["fr"], hl=legs["hl"], hr=legs["hr"],
             tail=(24 + 8 * s(0.15), 6 + 10 * s(0.3), -4 + 12 * s(0.45)), tail_yaw=(6 * s(0.1), 10 * s(0.25), 14 * s(0.4)),
             lift=0.14 * math.sin(2 * math.pi * phi), plant=None)


def gait_clip() -> dict:
    frames = 24
    keys = [(f, gait_pose(f / frames)) for f in range(0, frames + 1, 2)]
    return {"frames": frames, "keys": keys, "loop": True, "speed": 16, "events": [(1, "fx:qCloudH"), (13, "fx:qCloudF")]}


def breath_clip(frames: int, start: int) -> dict:
    """吐息：吸气（仰头扩胸）→ 预警倒计时最后两帧蓄满 → start 帧前探张口喷火 → 持续段下颌一张一合 → 收口落定"""
    keys = [(0, BASE), (start - 8, INHALE), (start - 2, INHALE_HOLD), (start, BLOW)]
    f, k = start + 9, 0
    while f < frames - 10:
        keys.append((f, BLOW_B if k % 2 == 0 else BLOW))
        f, k = f + 9, k + 1
    keys += [(frames - 6, SETTLE), (frames, BASE)]
    return {"frames": frames, "keys": keys, "events": [(start, "breathStart")]}


# ───────────── 片段：frames = 总帧数（30 fps）；keys = [(帧, 姿势)]；events = [(帧, 事件名)] ─────────────
# 片段在游戏里按招式的实际时长拉伸播放（BossBrain.PlayAct）：帧号按「设计时长」排，释放帧落在招式的出手时刻（详见设计单）
BREATH = breath_clip(114, 36) if FORM == "burn" else breath_clip(72, 24)
CLIPS = {
    # 人立长啸 → 前蹄砸地（张鳞的前摇 1.0 s；登场落地长啸、狂怒长啸也用它）：蹲 → 起 → 人立顶点 → 抖 → 下砸（拖影）→ 最后一帧砸地 = 出手
    "rear": {"frames": 30, "keys": [(0, BASE), (7, SQUASH), (16, RISE), (21, REAR_X), (26, REAR_HOLD), (28, REAR_SMEAR), (30, STAMP)],
             "events": [(21, "fx:qRearPeak"), (29, "hit")]},
    # 张鳞出手（0.6 s）：砸地姿势顿两帧 → 反弹 → 尾巴、头的滞后跟随 → 落定
    "scalesFire": {"frames": 18, "keys": [(0, STAMP), (2, STAMP_HOLD), (6, RECOIL), (11, SETTLE), (18, BASE)],
                   "events": [(0, "projectile")]},
    # 冲撞前刨蹄（1.0 s）：重心后坐、低头亮角 → 右前蹄刨两下 → 蓄力压低（臀部下蹲、头和角对准玩家）→ 冲出去
    "paw": {"frames": 30, "keys": [(0, BASE), (5, WEIGHT_BACK), (9, PAW_UP), (13, PAW_SCRAPE), (17, PAW_UP), (21, PAW_SCRAPE), (25, LOAD),
                                   (30, LOAD_HOLD)],
            "events": [(13, "fx:qPaw"), (21, "fx:qPaw"), (29.7, "hit")]},
    # 俯冲蓄势（0.9 s，狂怒 0.7 s）：收腿 → 蜷成一团、弓背、低头盯着落点、尾巴 S 形卷起 → 顶点微缩
    "tuck": {"frames": 27, "keys": [(0, P(plant=None)), (6, GATHER), (16, COIL), (22, COIL_HOLD), (27, COIL)],
             "events": [(16, "fx:qCoil")]},
    # 俯冲砸下（0.3 s 砸到 + 0.35 s 收势 = 0.65 s）：反向预备 → 伸展俯冲（拖影）→ 第 12 帧前蹄砸地 = 出手（0.3 s）→ 顿两帧 → 仰头 → 落定
    "stomp": {"frames": 26, "keys": [(0, COIL), (3, UNCOIL), (8, DIVE), (12, SLAM), (14, SLAM_HOLD), (19, ROAR_UP), (26, SETTLE)],
              "events": [(12, "hit")]},
    # 吐息（玄鳞麟火 0.8 + 1.6 s、焚身扫象限 1.2 + 2.6 s）：吸气 → 喷火 → 收口
    "breath": BREATH,
    # ── 第二批 B 路 ──
    # 跃起（玄鳞：ScaleDrink 前摇 1.0 s，先蹲 0.2 s 再起跳 → 接饮熔；焚身：化焚身时从熔岩柱跃回岸上）
    "leap": leap_clip(),
    # 硬直（鼎角砸晕 4 s；撞柱 1.6 s、倒下也用）
    "stun": stun_clip(),
    # 喘息（焚身三踏之后落地 3.5 s；玄鳞的同名采样片段一并换掉）
    "pant": pant_clip(),
}
if FORM == "xuan":
    # 饮熔（4 s，落地那一帧接跃起的最后一帧）
    CLIPS["drink"] = drink_clip()
else:
    # 焚身专属的空中踏云步态：替换焚身 Locomotion 里的 Move 槽位（焚身在地上从不奔跑；Walk 仍是采样的地面慢步，原地转身用）
    CLIPS["Move"] = gait_clip()


# ───────────── Blender ─────────────
def load_rig(keep_meshes: bool):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if not keep_meshes or o.parent != arm:
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


REST_HOOF = {}


def hoof_heads(arm, names) -> list:
    return [arm.pose.bones[n].head.copy() for n in names]


HOOVES_F, HOOVES_H = ("fhoof_L", "fhoof_R"), ("hhoof_L", "hhoof_R")
LEG_BONES = [b for side in "LR" for b in FRONT[side] + HIND[side]]
REST_LOW = [0.0]


def leg_low(arm) -> float:
    """四条腿上最低的一点（骨头首尾，Blender 世界高度）"""
    return min(min(arm.pose.bones[b].head.z, arm.pose.bones[b].tail.z) for b in LEG_BONES)


def apply(arm, pose: dict) -> list:
    """
    执行一个关键姿势，返回解算后的 [骨, 轴, 角度] / [骨, "loc", 位移]（审核用）。
    plant = "level"（第二批 B 路）：四蹄都踩地——前后腿屈得不一样长时，自动补身体俯仰，让前后蹄同时贴地
    （"all" 只让最低的那只贴地：后腿深蹲、前腿直立时后蹄会悬空一米多；早先的 LOAD / STAMP 就是这样）。姿势里的 pitch 是起点，解出来的是补过的
    """
    if pose["plant"] == "ground":
        # 趴 / 跪（第二批 B 路）：腿上最低的一点（膝、跗、蹄尖）落到静止时最低点的高度——瘫倒的姿势不钻地、不悬空；lift 是额外的偏移
        reset(arm)
        done = _apply(arm, dict(pose, plant=None, lift=0.0))
        dz = REST_LOW[0] - leg_low(arm) + pose["lift"]
        pb = arm.pose.bones["hips"]
        pb.matrix = Matrix.Translation(Vector((0, 0, dz))) @ pb.matrix
        bpy.context.view_layer.update()
        done.append(["hips", "loc", [0, 0, round(dz, 4)]])
        return done
    if pose["plant"] == "level":
        extra = 0.0
        for _ in range(6):
            reset(arm)
            done = _apply(arm, dict(pose, plant="all", pitch=pose["pitch"] + extra / AMP))
            hf = sum(arm.pose.bones[n].head.z - REST_HOOF[n].z for n in HOOVES_F) / 2
            hh = sum(arm.pose.bones[n].head.z - REST_HOOF[n].z for n in HOOVES_H) / 2
            span = abs(sum(arm.pose.bones[n].head.y for n in HOOVES_H) / 2 - sum(arm.pose.bones[n].head.y for n in HOOVES_F) / 2)
            if abs(hh - hf) < 0.015:
                break
            # 后蹄高 → 前身抬（pitch 往负）：绕臀部转，前蹄抬起、后蹄落下，再由「最低的贴地」整体放下去
            extra -= math.degrees(math.atan2(hh - hf, max(0.5, span)))
        done.append(["level", "pitch", round(pose["pitch"] * AMP + extra, 2)])
        return done
    return _apply(arm, pose)


def _apply(arm, pose: dict) -> list:
    done = []
    for bone, kind, v in ops_of(pose):
        pb = arm.pose.bones[bone]
        if abs(v) < 1e-6:
            continue
        m = pb.matrix.copy()
        head = m.translation.copy()
        pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(math.radians(v), 4, Vector(kind)) @ Matrix.Translation(-head) @ m
        if bone != "hips":
            pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
        done.append([bone, list(kind), round(v, 3)])
    # 踩地：把踩地的蹄子放回静止时的高度（最低的那只贴地）与前后位置（平均）；腾空姿势按 lift 抬高
    plant = pose["plant"]
    names = {"all": ["fhoof_L", "fhoof_R", "hhoof_L", "hhoof_R"], "front": ["fhoof_L", "fhoof_R"], "hind": ["hhoof_L", "hhoof_R"]}.get(plant, [])
    d = Vector((0, 0, pose["lift"]))
    if names:
        now = hoof_heads(arm, names)
        rest = [REST_HOOF[n] for n in names]
        # 取「最低的那只正好贴地」：有钻进地里的就抬到都不钻，全都悬空就落到最低那只着地
        d.z = max(r.z - c.z for r, c in zip(rest, now))
        d.y = sum(r.y - c.y for r, c in zip(rest, now)) / len(names)
    d.y += pose["fwd"]
    if d.length > 1e-6:
        pb = arm.pose.bones["hips"]
        pb.matrix = Matrix.Translation(d) @ pb.matrix
        bpy.context.view_layer.update()
        done.append(["hips", "loc", [round(c, 4) for c in d]])
    return done


def fcurves(act) -> list:
    """动作的全部曲线（Blender 4.4 起是分层动作：layers → strips → channelbags）"""
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


ANIM_BONES = ["hips", "spine", "chest", "neck_1", "neck_2", "head", "jaw", "tail_1", "tail_2", "tail_3"] + \
             [b for s in "LR" for b in FRONT[s] + HIND[s]]


def bake_clip(arm, name: str, clip: dict):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    prev, resolved = {}, []
    for frame, pose in clip["keys"]:
        reset(arm)
        resolved.append((frame, apply(arm, pose)))
        for b in ANIM_BONES:
            pb = arm.pose.bones[b]
            q = pb.rotation_quaternion.copy()
            if b in prev and q.dot(prev[b]) < 0:   # 四元数连续性：别绕远路
                q.negate()
                pb.rotation_quaternion = q
            prev[b] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=b)
            if b == "hips":
                pb.keyframe_insert("location", frame=frame, group=b)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.easing = "AUTO"
    # 顿帧（砸地后两帧同姿势）与人立顶点：前后两个键同值时 AUTO 柄会冲过头，改成 AUTO_CLAMPED 不回弹
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        # 循环片段（踏云步态）：首尾按周期接上（Cycles 修改器让自动柄按周期算，首尾切线一致，循环接缝不顿）
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


ABOUT = ("火麒麟 · {form}的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。at = 片段内归一化时刻。"
         "{clips} 是手工关键帧（art/source/characters/SK_Boss_Qilin/anim/qilin_anims.py 生成这几项，别手改），"
         "其余状态是原生采样片段、时刻取 Qilin.ts 的切换 / 判定时刻（手写）。"
         "hit / projectile = 释放帧（招式用 Cue 接住：事件和按时间兜底先到者算，两者按设计落在同一帧）；"
         "fx:q* = 只管外观的姿势节拍（QilinBrain.OnAnimEvent → Fx.Qilin*：人立顶点鳞光、刨蹄火星、蜷身聚火、起跳尘、硬直砸中 / 瘫倒、踏云的后蹄 / 前蹄踏出火云）；"
         "breathStart = 开始喷火。对象写法的条目带 next（连段）/ loop / speed（Move 的录制速度 = 混合树阈值）。"
         "音效和震屏一律由招式 / 首领代码在同一帧自己出（采样片段原来叠的 sfx: / fx:shake 也去掉了：代码里本来就有，叠着会同一下响两次）。设计单 docs/art/vfx/qilin.md")


def write_events(path: Path):
    doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"schema": 1, "clips": {}}
    clips = doc.get("clips", {})
    for name, c in CLIPS.items():
        evs = [{"at": round(min(1.0, f / c["frames"]), 4), "name": n} for f, n in c["events"]]
        extra = {k: c[k] for k in ("next", "loop", "speed") if k in c}
        # 连段 / 循环 / 录制速度要写成对象（数组简写只有事件）：手工片段替换采样片段时，采样数据里的 next / speed 不会带过来
        clips[name] = dict({"events": evs}, **extra) if extra else evs
    # 和手写的叠加表同一种排版：一个事件一行
    lines = ["{", '  "schema": 1,', f'  "about": {json.dumps(ABOUT.format(form="焚身" if FORM == "burn" else "玄鳞", clips=" / ".join(CLIPS)), ensure_ascii=False)},', '  "clips": {']
    names = list(clips)
    for i, name in enumerate(names):
        evs = clips[name]
        if isinstance(evs, list):
            body = ",\n".join("      " + json.dumps(e, ensure_ascii=False).replace("{", "{ ").replace("}", " }").replace('":', '":') for e in evs)
            arr = f'[\n{body}\n    ]' if evs else "[\n    ]"
            lines.append(f'    {json.dumps(name)}: {arr}' + ("," if i < len(names) - 1 else ""))
        else:
            # 对象写法（events + next / loop / speed）：事件照样一行一个
            ev = evs.get("events", [])
            body = ",\n".join("        " + json.dumps(e, ensure_ascii=False).replace("{", "{ ").replace("}", " }") for e in ev)
            parts = [f'      "events": [\n{body}\n      ]' if ev else '      "events": []']
            parts += [f'      {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in evs.items() if k != "events"]
            obj = "{\n" + ",\n".join(parts) + "\n    }"
            lines.append(f'    {json.dumps(name)}: {obj}' + ("," if i < len(names) - 1 else ""))
    lines += ["  }", "}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ───────────── 审核联系表 ─────────────
def review(arm, out: Path):
    import numpy as np  # noqa: F401（Blender 自带）
    out.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 360, 360
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.16, 0.17, 0.2)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 9.0
    # 地面线：一块薄板
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    centre = Vector((0, -0.4, 2.6))
    tiles = []
    for name, clip in CLIPS.items():
        if ONLY and name not in ONLY:
            continue
        for frame, pose in clip["keys"]:
            reset(arm)
            apply(arm, pose)
            for view, yaw, up in (("side", 90, 0.08), ("q", 35, 0.2)):
                a = math.radians(yaw)
                d = Vector((math.sin(a), -math.cos(a), up)).normalized()
                cam.location = centre + d * 30
                cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
                p = out / f"_{name}_{frame:03d}_{view}.png"
                sc.render.filepath = str(p)
                bpy.ops.render.render(write_still=True)
                tiles.append((name, frame, view, p))
    (out / "tiles.json").write_text(json.dumps([[n, f, v, str(p)] for n, f, v, p in tiles], ensure_ascii=False), encoding="utf-8")


def main():
    arm = load_rig(keep_meshes=REVIEW is not None)
    reset(arm)
    for n in ("fhoof_L", "fhoof_R", "hhoof_L", "hhoof_R"):
        REST_HOOF[n] = arm.pose.bones[n].head.copy()
    REST_LOW[0] = leg_low(arm)
    if REVIEW:
        review(arm, REVIEW)
        print("QILIN_REVIEW " + str(REVIEW))
        return
    if "--hooves" in argv:
        # 调姿势用：每个关键姿势四只蹄子离地多高（米；踩地的姿势应该都接近 0，差太多就是腿长对不上、有蹄子悬空 / 钻地）
        for name, clip in CLIPS.items():
            if ONLY and name not in ONLY:
                continue
            for frame, pose in clip["keys"]:
                reset(arm)
                done = apply(arm, pose)
                zs = [arm.pose.bones[n].head.z - REST_HOOF[n].z for n in ("fhoof_L", "fhoof_R", "hhoof_L", "hhoof_R")]
                # 腿上最低的一点（膝 / 跗 / 蹄尖，绝对高度，地面 = 0）：跪地 / 瘫倒的姿势应该在 0 上下
                low = leg_low(arm) - REST_LOW[0]
                lv = [d[2] for d in done if d[0] == "level"]
                print("QILIN_HOOVES", name, frame, " ".join(f"{z:+.2f}" for z in zs), f"low {low:+.2f}", f"pitch {lv[0]}" if lv else "")
        return
    # 导出前顶层物体绕 Z 转 180°（同 bl_unity_export：Unity 里角色朝 +Z）；只写在物体上，骨骼的局部动画不受影响
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    # 再放一个顶层空物体：FBX 里只有一个顶层物体时 Unity 会把它折叠成文件根节点，层级就和本体对不上（同 hanba_anims.py）
    keep = bpy.data.objects.new(f"{ASSET}_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report = {}
    for name, clip in CLIPS.items():
        act, _ = bake_clip(arm, name, clip)
        export_fbx(arm, act, name, clip["frames"], UNITY / "Keyframed")
        report[name] = {"seconds": round(clip["frames"] / FPS, 2), "keys": [f for f, _ in clip["keys"]],
                        "events": [[round(f / clip["frames"], 3), n] for f, n in clip["events"]]}
    write_events(UNITY / f"{ASSET}.events.json")
    print("QILIN_ANIMS " + FORM + " " + json.dumps(report, ensure_ascii=False))


main()
