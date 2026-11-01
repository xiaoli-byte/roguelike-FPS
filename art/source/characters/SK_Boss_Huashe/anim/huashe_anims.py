"""化蛇（SK_Boss_Huashe，4-1 圣湖海子领主）手工关键帧动作（第四章移植 B1 路）：Blender 无头脚本，一次生成全部手 K 片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Huashe/anim/huashe_anims.py -- [--review <目录>] [--only a,b] [--sheet <jpg>]

设计单见 docs/art/vfx/huashe.md（第 0 节动作气质、第 2 节节拍表、第 3 节登场 / 破防 / 死亡），时刻表见 docs/art/ch4-move-events.json 的
assets.SK_Boss_Huashe：片段帧数 = 三段之和 × 30（spit 2.55 s / lunge 2.25 s / dive 3.05 s 落在半帧上，取设计单表里的 76 / 67 / 91 帧，
游戏里按招式时长拉伸，差不到 1%），事件帧 = at × 帧数（取最近的半帧），events.json 的 at = 事件帧 ÷ 片段帧数（和表差 ≤ 0.25 帧）。
导出时打印每段的帧数、事件、身体链最大折角、逐帧最快转动、Idle 首尾差（HUASHE_ANIMS）；--review 另打印每个关键帧的网格拉伸（HUASHE_CHECK）。
蒙皮（native_build 6 重蒙皮，只改权重，见 art/pipeline/creature_rigs/SK_Boss_Huashe.json 的 doc）：jaw 只管嘴线以下的下巴和下颌底面，
口鼻整块跟 head，嘴按设计单张到 35–52°；水草 / 小簇整缕跟一组权重走，鬃毛和胸毛不再带翼根、前腿的权重，所以姿势里不用再躲。

产出（都可以重新生成，FBX 按 unity/.gitignore 不入库）：
  unity/Assets/Art/Characters/SK_Boss_Huashe/Anim/Keyframed/<状态>.fbx   一个状态一个文件（文件名 = Animator 状态名），同名时覆盖采样片段
  unity/Assets/Art/Characters/SK_Boss_Huashe/Anim/SK_Boss_Huashe.events.json   只改写这里手 K 的状态的事件，其余条目原样保留
  --review <目录>   每个状态关键帧的侧视 / 3/4 视 / 俯视（Workbench 贴图着色），拼成 docs/art/review/ch4-port/B1/huashe-keyposes.jpg
                    （--sheet 改写到别处、--only 只渲几段：迭代姿势时用；拼图走系统 Python 的 PIL，见 huashe_review_sheet.py）

骨架来自发布的 public/assets/characters/SK_Boss_Huashe.glb（骨骼见 art/pipeline/creature_rigs/SK_Boss_Huashe.json），导入 / 导出设置与
art/pipeline/blender/bl_unity_export.py 一致（顶层物体绕 Z 转 180°、-Z 前 / Y 上、主骨轴 Y，再放一个顶层空物体，同 qilin_anims.py）。
Unity 侧是 Generic，NativeClipBuilder 按骨骼名把曲线接到本体上。root 骨一直是单位变换（片段不带根运动），翻身、压低只动 hips。

姿势写法（Blender 坐标：front = -Y，生物的左 = +X，up = +Z；角度都是度）：
  每根骨一组 [pitch, yaw, roll] = 绕 X / Z / Y 的转角，在「父骨带着走的静止世界坐标」里算（D = Rz(yaw)·Rx(pitch)·Ry(roll)，绕骨头部）：
  hips 翻身 160° 以后，脊柱、尾巴、四肢的转角照样是身体自己的上下左右，游动波翻过来也还是侧向的波。
  · 身体链（head ← neck ← chest ← spine3 ← spine2 ← spine1 ← hips → tail_1 … tail_8，共 15 节）：
      pitch 正 = 往下弯（前半身低头；尾巴则是往上翘），yaw = 绕上轴的转角（正 = 前半身转向生物的左、尾巴甩向生物的右）；
      head / head_yaw 写的是头的「绝对」朝向（相对 hips 以外的整条链抵掉），脖子怎么弯都不影响头最后朝哪；tail_side 正 = 尾巴甩向生物的左。
  · 翅膀 w1 / w2 / w3 = (raise 上抬, sweep 往前扫, twist 绕翼轴拧)，左边按给的、右边镜像；
  · 四条腿 fl / fr / hl / hr = (up 往外上收, fwd 往前伸, bend 下一节往后折, end 爪 / 脚往后折)：外撇的短腿，收拢 = 往后贴着身侧；
  · jaw 正 = 张嘴；loc = hips 平移（米）。
动作气质（设计单第 0 节）：一切从波形派生——游动是一条从头传到尾的正弦（头幅度小、尾幅度大，每节相位差 0.7 rad）；
扑岸 = 把波压成 S 再一下拉直；翼拍浪 = 翅膀高举、3 帧拍下、身体跟着一抖；噎住 = 整身绕长轴翻 160°、四腿朝天乱蹬。
关键帧之间按通道做单调三次插值（不过冲、顶点不冻住），段上可指定缓动："in" 加速冲向下一帧（smear 段）、"out" 从这一帧减速出去、
"lin" 匀速、"smooth" 两头慢；程序层（游动波、扒地、乱蹬、甩头）按帧叠加在关键姿势上。最后逐帧打键，FBX 也是逐帧烘。
"""
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
ASSET = "SK_Boss_Huashe"
GLB = ROOT / f"public/assets/characters/{ASSET}.glb"
UNITY = ROOT / f"unity/Assets/Art/Characters/{ASSET}/Anim"
SHEET = ROOT / "docs/art/review/ch4-port/B1/huashe-keyposes.jpg"
FPS = 30
TAU = 2 * math.pi

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REVIEW = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
ONLY = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
SHEET_OUT = Path(argv[argv.index("--sheet") + 1]) if "--sheet" in argv else SHEET
# 迭代时的调试项：--res 单张分辨率、--views 多渲哪些视角（front = 正前）
RES = int(argv[argv.index("--res") + 1]) if "--res" in argv else 360
VIEW_NAMES = argv[argv.index("--views") + 1].split(",") if "--views" in argv else ["side", "q", "top"]

# 身体链：从 hips 往前、往后各一串；NODES 从头到尾排（游动波的相位按这个顺序递增）
FWD = ["hips", "spine1", "spine2", "spine3", "chest", "neck", "head"]
TAIL = [f"tail_{i}" for i in range(1, 9)]
NODES = ["head", "neck", "chest", "spine3", "spine2", "spine1", "hips"] + TAIL
PARENT = {"spine1": "hips", "spine2": "spine1", "spine3": "spine2", "chest": "spine3", "neck": "chest", "head": "neck", "tail_1": "hips"}
PARENT.update({TAIL[i]: TAIL[i - 1] for i in range(1, 8)})
# 平面投影里每节的长度（米，从关节往远离 hips 的方向量）与质量权重（算游动的反冲：整条身子的平均侧移保持为 0）
SEG = {"hips": 0.6, "spine1": 0.6, "spine2": 0.6, "spine3": 0.6, "chest": 0.75, "neck": 0.4, "head": 0.87, **{t: 0.55 for t in TAIL}}
MASS = {"hips": 1.6, "spine1": 1.6, "spine2": 1.6, "spine3": 1.6, "chest": 1.8, "neck": 1.2, "head": 1.4,
        "tail_1": 1.3, "tail_2": 1.2, "tail_3": 1.0, "tail_4": 0.85, "tail_5": 0.7, "tail_6": 0.55, "tail_7": 0.45, "tail_8": 0.4}
WINGS = ("wing_1", "wing_2", "wing_3")
FRONT = ("upperarm", "forearm", "paw")
HIND = ("thigh", "shin", "foot")


# ───────────── 姿势：{骨: [pitch, yaw, roll]}，"loc": [x, y, z]（hips 平移）─────────────
def add(p: dict, bone: str, pitch=0.0, yaw=0.0, roll=0.0) -> dict:
    v = p.setdefault(bone, [0.0, 0.0, 0.0])
    v[0] += pitch
    v[1] += yaw
    v[2] += roll
    return p


def add_lr(p: dict, bone: str, side: str, pitch=0.0, yaw=0.0, roll=0.0) -> dict:
    """左边按给的；右边镜像（绕 Z、绕 Y 的角取反）"""
    s = 1 if side == "L" else -1
    return add(p, f"{bone}_{side}", pitch, s * yaw, s * roll)


def merge(*ps) -> dict:
    out = {}
    for p in ps:
        for k, v in p.items():
            if k == "loc":
                lo = out.setdefault("loc", [0.0, 0.0, 0.0])
                for i in range(3):
                    lo[i] += v[i]
            else:
                add(out, k, *v)
    return out


def scaled(p: dict, k: float) -> dict:
    return {b: [c * k for c in v] for b, v in p.items()}


def P(hips=(0, 0, 0), loc=(0, 0, 0), spine=(0, 0, 0, 0), spine_yaw=(0, 0, 0, 0), neck=0.0, neck_yaw=0.0, head=0.0, head_yaw=0.0,
      head_roll=0.0, head_rel=False, jaw=0.0, tail=(0,) * 8, tail_side=(0,) * 8, w1=(0, 0, 0), w2=(0, 0, 0), w3=(0, 0, 0),
      wr=None, fl=(0, 0, 0, 0), fr=None, hl=(0, 0, 0, 0), hr=None) -> dict:
    """一个关键姿势（参数见文件头）。wr = 右翼单独的 (w1, w2, w3)；fr / hr 缺省 = 和左边一样（镜像）"""
    p = {"loc": list(loc)}
    add(p, "hips", hips[0], hips[1], hips[2])
    for b, a, y in zip(("spine1", "spine2", "spine3", "chest"), spine, spine_yaw):
        add(p, b, a, y)
    add(p, "neck", neck, neck_yaw)
    if head_rel:
        add(p, "head", head, head_yaw, head_roll)
    else:
        # 头的绝对朝向：把 hips 到 neck 的俯仰、转向都抵掉
        add(p, "head", head - hips[0] - sum(spine) - neck, head_yaw - hips[1] - sum(spine_yaw) - neck_yaw, head_roll)
    add(p, "jaw", jaw)
    for t, a, s in zip(TAIL, tail, tail_side):
        add(p, t, a, -s)
    wings = {"L": (w1, w2, w3), "R": wr or (w1, w2, w3)}
    for side, segs in wings.items():
        for b, (rise, sweep, twist) in zip(WINGS, segs):
            # 左翼：绕 -Y 转 = 上抬（Ry 负），绕 Z 负转 = 往前扫；右边镜像
            add_lr(p, b, side, pitch=twist, yaw=-sweep, roll=-rise)
    for side, spec, bones in (("L", fl, FRONT), ("R", fr or fl, FRONT), ("L", hl, HIND), ("R", hr or hl, HIND)):
        up, fwd, bend, end = (tuple(spec) + (0, 0, 0, 0))[:4]
        add_lr(p, f"{bones[0]}", side, yaw=-fwd, roll=-up)
        add_lr(p, f"{bones[1]}", side, pitch=bend)
        add_lr(p, f"{bones[2]}", side, pitch=end)
    return p


def tail_curve(total: float, start=0, shape=1.0) -> tuple:
    """把总角度分到八节尾巴（从 start 节起，越往后越多：shape > 1 集中在末端）"""
    w = [0.0 if i < start else (i - start + 1) ** shape for i in range(8)]
    s = sum(w) or 1.0
    return tuple(total * x / s for x in w)


# ───────────── 程序层 ─────────────
def smooth01(u: float) -> float:
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def env(f: float, pts) -> float:
    """包络：pts = [(帧, 权重)]，相邻点之间 smoothstep"""
    if f <= pts[0][0]:
        return pts[0][1]
    for (f0, a), (f1, b) in zip(pts, pts[1:]):
        if f <= f1:
            return a + (b - a) * smooth01((f - f0) / (f1 - f0))
    return pts[-1][1]


def plan_fk(heads: dict) -> list:
    """平面里按每节的绝对转角（yaw，度）摆出整条身子，返回 [(节, 中点 x, 权重)]（hips 关节在原点）"""
    out = []
    x = 0.0
    for b in FWD:
        a = math.radians(heads.get(b, 0.0))
        L = SEG[b]
        out.append((b, x + 0.5 * L * math.sin(a), MASS[b] * L))
        x += L * math.sin(a)
    x = 0.0
    for b in TAIL:
        a = math.radians(heads.get(b, 0.0))
        L = SEG[b]
        out.append((b, x - 0.5 * L * math.sin(a), MASS[b] * L))
        x -= L * math.sin(a)
    return out


def swim(theta: float, amps, k=0.7, pitch_amp=0.0, recoil=True) -> dict:
    """
    游动波：第 n 节（从头数）的绝对转角 ψn = Ψn·sin(θ − k·n)，波从头传到尾；换成相对父骨的转角。
    recoil：hips 侧移抵掉整条身子的平均侧移（自由游动的反冲，身子不会被波整个带偏）。
    pitch_amp：尾巴另加一道小的上下波（末端最大）。
    """
    heads = {b: amps[n] * math.sin(theta - k * n) for n, b in enumerate(NODES)}
    p = {}
    for b in NODES:
        par = PARENT.get(b)
        add(p, b, yaw=heads[b] - (heads[par] if par else 0.0))
    if recoil:
        pts = plan_fk(heads)
        mean = sum(x * w for _, x, w in pts) / sum(w for _, _, w in pts)
        p["loc"] = [-mean, 0.0, 0.0]
    if pitch_amp:
        for i, t in enumerate(TAIL):
            add(p, t, pitch=pitch_amp * (i + 1) / 8 * math.sin(theta - k * (7 + i) + 1.2) * 0.5)
    return p


# 头稳、尾大：每节的转角幅度（从头到尾，度）
IDLE_AMPS = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 8, 10, 12.5, 15, 18, 21.5, 25, 28.5, 32]


def scale_amps(amps, k: float, head_k: float = None) -> list:
    hk = k if head_k is None else head_k
    return [a * (hk + (k - hk) * n / 14) for n, a in enumerate(amps)]


# ───────────── 底姿 ─────────────
# 翅膀半收、贴着背往后折；四条短腿往后收拢贴身（水里划水的底姿）。各段从它起、回到它，状态之间过渡不跳
W1_FOLD, W2_FOLD, W3_FOLD = (-20, -22, 4), (-6, -26, 0), (2, -18, 0)
FL_TUCK = (10, -46, 34, 26)
HL_TUCK = (8, -40, 14, 34)
BASE = P(w1=W1_FOLD, w2=W2_FOLD, w3=W3_FOLD, fl=FL_TUCK, hl=HL_TUCK, jaw=2)


def idle_layer(frames: int):
    """待机：游动波（一个周期 = 整段）、翅膀随波轻摆（比胸口晚一点）、四条腿交替划水（两个周期）、头轻点、嘴一张一合"""
    def fn(f):
        th = TAU * f / frames
        p = swim(th, IDLE_AMPS, pitch_amp=6)
        p["loc"][2] += 0.035 * math.sin(th + 0.6)
        add(p, "hips", pitch=0.8 * math.sin(th + 0.6))
        for side, sgn in (("L", 1), ("R", -1)):
            # 翅膀：上下随波轻摆（同相），再加一点左右反相（身子往哪边弯，那边的翅膀往里收一点）
            ph = th - 0.7 * 2 - 0.6
            add_lr(p, "wing_1", side, roll=-(3.0 * math.sin(ph) + 2.0 * sgn * math.sin(th - 1.4)))
            add_lr(p, "wing_2", side, roll=-2.5 * math.sin(ph - 0.6), yaw=1.5 * math.sin(ph - 0.6))
            add_lr(p, "wing_3", side, roll=-3.0 * math.sin(ph - 1.2), yaw=2.0 * math.sin(ph - 1.2))
        # 划水：对角两条腿同相（左前 + 右后、右前 + 左后），往前伸时下一节伸直、往后划时折起来
        for leg, bones, ph0, amp in (("L", FRONT, 0.0, 14), ("R", FRONT, math.pi, 14), ("L", HIND, math.pi, 12), ("R", HIND, 0.0, 12)):
            ph = 2 * th + ph0
            add_lr(p, f"{bones[0]}", leg, yaw=-amp * math.sin(ph), roll=-3 * math.cos(ph))
            add_lr(p, f"{bones[1]}", leg, pitch=10 * math.cos(ph))
            add_lr(p, f"{bones[2]}", leg, pitch=8 * math.cos(ph - 0.8))
        add(p, "head", pitch=1.6 * math.sin(th + 1.0))
        add(p, "jaw", pitch=2.0 * math.sin(th - 0.5))
        return p
    return fn


def clip_idle() -> dict:
    frames = 86
    return {"frames": frames, "loop": True, "keys": [(0, BASE), (frames, BASE)], "layers": [idle_layer(frames)], "events": [],
            "review": [0, 22, 43, 65]}


# ───────────── 姿势零件 ─────────────
def front(h: float) -> tuple:
    """前半身抬起 h 度（负 = 压低）：分到 spine1 … chest 四节（越往前越多），每节都不折成尖角"""
    return tuple(-h * w for w in (0.16, 0.24, 0.29, 0.31))


def S_yaw(h: float) -> dict:
    """扑岸的 S 形蓄力（俯视）：spine1 / spine2 往左、spine3 / chest 往右、脖子再往左，头最后朝正前（h = 0…1）"""
    return {"spine_yaw": (20 * h, 16 * h, -22 * h, -28 * h), "neck_yaw": 34 * h, "hips": (0, -8 * h, 0),
            "tail_side": tuple(v for v in tail_curve(-30 * h, 0, 0.7))}


def legs_pair(f_spec, h_spec) -> dict:
    return {"fl": f_spec, "hl": h_spec}


# 翅膀（每节 = (上抬, 往前扫, 拧)）
W_TIGHT = ((-32, -34, 22), (-10, -30, 6), (0, -22, 0))            # 潜游：贴死在背上
W_PRESS = ((-36, -16, 0), (-10, -18, 0), (0, -12, 0))           # 翼拍浪的反向预备：往下压
W_HIGH = ((48, 14, -10), (-6, 20, 0), (-4, 18, 0))            # 翼拍浪的最高点：wing_1 抬到快竖直，wing_2 / 3 往外展开
W_SMEAR = ((-18, 16, -6), (8, 18, 0), (14, 14, 0))              # 拍下的拖影：根已经下来、翼尖还拖在上面
W_FLAT = ((-40, 18, 34), (-22, 22, 6), (-6, 20, 0))              # 拍在水面：完全展平
W_FLAT_X = ((-42, 18, 4), (-28, 22, 0), (-14, 22, 0))           # 拍下后翼尖再甩一下（follow-through）
W_REBOUND = ((-30, 12, 2), (-14, 14, 0), (-2, 12, 0))
W_HALF = ((-10, 6, 0), (-6, 4, 0), (-2, 4, 0))                  # 半张
W_SPREAD = ((8, 14, -6), (-14, 26, 0), (-8, 26, 0))             # 展开 9 m（破水、吼叫）
W_BACK = ((2, -10, 0), (-8, -6, 0), (-4, -4, 0))                # 半张往后（吼叫）

# 四条腿（up, fwd, bend, end）
FL_TIGHT, HL_TIGHT = (14, -52, 36, 30), (10, -48, 14, 40)       # 潜游：贴身往后
FL_GATHER, HL_GATHER = (2, -6, 34, 10), (2, -18, 18, 20)        # 蓄力：收到身下
FL_REACH, HL_PUSH = (-6, 40, -26, -18), (-4, -40, -6, 30)       # 扑出：两前腿往前伸、后腿往后蹬
FL_SPLAY, HL_SPLAY = (18, 26, -4, -6), (12, -6, 6, 10)        # 搁浅：摊开扒地


def W(segs) -> dict:
    return {"w1": segs[0], "w2": segs[1], "w3": segs[2]}


def K(**kw) -> dict:
    """关键姿势：没写的部分取底姿（翅膀半收、四腿收拢、嘴微张）"""
    base = {"w1": W1_FOLD, "w2": W2_FOLD, "w3": W3_FOLD, "fl": FL_TUCK, "hl": HL_TUCK, "jaw": 2}
    extra = []
    if "S" in kw:
        extra.append(S_yaw(kw.pop("S")))
    if "lift" in kw:
        # 前半身抬起 h 度：hips 带三成（尾巴根反向抵掉，尾巴还平着）、脊柱四节分七成
        h = kw.pop("lift")
        extra.append({"hips": (-0.3 * h, 0, 0), "spine": front(0.7 * h), "tail": (0.3 * h,) + (0,) * 7})
    if "wings" in kw:
        base.update(W(kw.pop("wings")))
    base.update(kw)
    # 零件和显式写的同名项相加（hips、脊柱、尾巴）
    for s in extra:
        for k, v in s.items():
            base[k] = tuple(a + b for a, b in zip(base[k], v)) if k in base else v
    return P(**base)


def lerp_pose(a: dict, b: dict, u: float) -> dict:
    return merge(scaled(a, 1 - u), scaled(b, u))


# ───────────── 程序层 ─────────────
def fast_swim(f0: float, period: float, k: float, pts) -> callable:
    """水下快速游动（潜游）：游动波周期 period 帧、幅度 × k，包络 pts"""
    amps = scale_amps(IDLE_AMPS, k, head_k=0.8 * k)

    def fn(f):
        e = env(f, pts)
        return scaled(swim(TAU * (f - f0) / period, amps, pitch_amp=4), e) if e > 1e-4 else {}
    return fn


def scrabble(pts, period=12.0, tail_period=20.0) -> callable:
    """搁浅：四条短腿轮流往前扒、往后拽（每 0.4 s 一下），身子跟着一拧一拧、头一抬一抬；尾巴在水里上下拍"""
    def fn(f):
        e = env(f, pts)
        if e < 1e-4:
            return {}
        p = {}
        for leg, bones, ph0, amp in (("L", FRONT, 0.0, 30), ("R", FRONT, math.pi, 30), ("L", HIND, math.pi * 0.5, 18), ("R", HIND, math.pi * 1.5, 18)):
            ph = TAU * f / period + ph0
            add_lr(p, bones[0], leg, yaw=-amp * math.sin(ph), roll=6 * max(0.0, math.cos(ph)))
            add_lr(p, bones[1], leg, pitch=18 * math.cos(ph) + 6)
            add_lr(p, bones[2], leg, pitch=14 * math.cos(ph - 0.7))
        pull = math.sin(TAU * f / period)
        add(p, "chest", yaw=4 * pull)
        add(p, "spine2", yaw=-3 * pull)
        add(p, "neck", pitch=-4 * abs(math.sin(TAU * f / period)), yaw=-3 * pull)
        add(p, "head", pitch=2 * abs(math.sin(TAU * f / period)), yaw=-2 * pull)
        slap = math.sin(TAU * f / tail_period)
        for i, t in enumerate(TAIL):
            add(p, t, pitch=(6 + 10 * i / 7) * math.sin(TAU * f / tail_period - 0.45 * i), yaw=3 * slap * i / 7)
        return scaled(p, e)
    return fn


def struggle(pts) -> callable:
    """噎住：翻着肚子乱蹬——四条腿各自的频率（不同步）、尾巴每 0.5 s 抽一下（从根传到尾鳍）、头晃、嘴一张一合喘、翅膀抽动"""
    legs = (("L", FRONT, 9.0, 0.0, 34), ("R", FRONT, 11.0, 2.1, 34), ("L", HIND, 10.0, 4.0, 28), ("R", HIND, 13.0, 1.0, 28))

    def fn(f):
        e = env(f, pts)
        if e < 1e-4:
            return {}
        p = {}
        for leg, bones, per, ph0, amp in legs:
            ph = TAU * f / per + ph0
            add_lr(p, bones[0], leg, yaw=-amp * math.sin(ph), roll=-10 * math.sin(0.5 * ph + 1))
            add_lr(p, bones[1], leg, pitch=26 * math.sin(ph + 1.3))
            add_lr(p, bones[2], leg, pitch=22 * math.sin(ph + 2.2))
        for i, t in enumerate(TAIL):
            add(p, t, yaw=(6 + 10 * i / 7) * math.sin(TAU * f / 15.0 - 0.55 * i), pitch=4 * math.sin(TAU * f / 15.0 - 0.55 * i + 1.0))
        add(p, "spine2", yaw=3 * math.sin(TAU * f / 15.0 + 1.5))
        add(p, "neck", yaw=6 * math.sin(TAU * f / 40.0))
        add(p, "head", yaw=8 * math.sin(TAU * f / 40.0 + 0.6), pitch=5 * math.sin(TAU * f / 23.0))
        add(p, "jaw", pitch=12 * math.sin(TAU * f / 17.0))
        for side, per in (("L", 13.0), ("R", 14.5)):
            add_lr(p, "wing_1", side, roll=-5 * math.sin(TAU * f / per))
            add_lr(p, "wing_2", side, roll=-4 * math.sin(TAU * f / per - 0.8))
            add_lr(p, "wing_3", side, roll=-5 * math.sin(TAU * f / per - 1.6))
        return scaled(p, e)
    return fn


def head_shake(pts, f0: float, swing=18.0) -> callable:
    """吼叫：头每 swing 帧（0.6 s）往一边甩一下（近似方波，甩到头停一停），脖子跟一点；全身轻颤、翅膀抖"""
    def fn(f):
        e = env(f, pts)
        if e < 1e-4:
            return {}
        s = math.tanh(2.5 * math.sin(math.pi * (f - f0) / swing)) / math.tanh(2.5)
        p = {}
        add(p, "head", yaw=13 * s, roll=-5 * s)
        add(p, "neck", yaw=5 * s)
        add(p, "chest", yaw=-2 * s, pitch=0.8 * math.sin(TAU * f / 4))
        add(p, "spine3", pitch=0.6 * math.sin(TAU * f / 4 + 1))
        for side in "LR":
            add_lr(p, "wing_2", side, roll=-3 * math.sin(TAU * f / 6))
            add_lr(p, "wing_3", side, roll=-4 * math.sin(TAU * f / 6 - 1))
        return scaled(p, e)
    return fn


def flutter(pts, period=14.0, amp=6.0) -> callable:
    def fn(f):
        e = env(f, pts)
        if e < 1e-4:
            return {}
        p = {}
        for side in "LR":
            add_lr(p, "wing_1", side, roll=-amp * math.sin(TAU * f / period))
            add_lr(p, "wing_2", side, roll=-amp * 0.7 * math.sin(TAU * f / period - 0.8))
            add_lr(p, "wing_3", side, roll=-amp * 0.9 * math.sin(TAU * f / period - 1.6))
        return scaled(p, e)
    return fn


def tremble(pts, period=5.0, amp=1.2) -> callable:
    """蓄力顶点上的微颤（moving hold：顶点上还有微动，不冻住）"""
    def fn(f):
        e = env(f, pts)
        if e < 1e-4:
            return {}
        p = {}
        add(p, "chest", pitch=amp * math.sin(TAU * f / period), yaw=0.6 * amp * math.sin(TAU * f / period * 0.7))
        add(p, "neck", pitch=-amp * math.sin(TAU * f / period + 1))
        for i, t in enumerate(TAIL[4:]):
            add(p, t, yaw=amp * 1.5 * math.sin(TAU * f / period - 0.6 * i))
        return scaled(p, e)
    return fn


# ───────────── 片段 ─────────────
def ev_frame(at: float, frames: int) -> float:
    """事件帧 = at × 帧数，取最近的半帧"""
    return round(at * frames * 2) / 2


def clip_wingslap() -> dict:
    """
    翼拍浪（0.8 + 0.4 + 0.6 = 1.8 s = 54 帧，hit 0.444 → f24）：
    f0 → f6 翅膀先往下压（反向预备）、前身微抬 → f21 双翼举到最高（wing_1 抬到快竖直、wing_2 / 3 往外展开、前身抬 30°、仰头）
    → f21–f24 三帧拍下（翼尖拖在后面）→ f24 拍在水面（翼完全展平、前身压进水里、头往前）→ f26 反弹上抬 10° → f36 → f40 收翼 → f54 底姿
    """
    frames = 54
    hit = ev_frame(0.444, frames)
    antic = K(wings=W_PRESS, spine=front(6), head=8, neck=4, tail=tail_curve(-8, 2))
    rise = K(wings=lerp_wings(W_PRESS, W_HIGH, 0.55), lift=20, neck=-6, head=-10, jaw=6, tail=tail_curve(6, 2))
    top = K(wings=W_HIGH, lift=28, neck=-10, head=-18, jaw=10, tail=tail_curve(12, 2), fl=FL_GATHER)
    top_x = K(wings=bump_wings(W_HIGH, 3), lift=30, neck=-12, head=-20, jaw=12, tail=tail_curve(14, 2), fl=FL_GATHER)
    smear = K(wings=W_SMEAR, spine=front(2), neck=6, head=0, jaw=14, tail=tail_curve(8, 2), fl=FL_GATHER)
    slam = K(wings=W_FLAT, spine=front(-12), neck=12, head=10, jaw=16, loc=(0, -0.05, -0.22), tail=tail_curve(16, 3), fl=FL_SPLAY)
    slam_x = K(wings=W_FLAT_X, spine=front(-14), neck=13, head=12, jaw=14, loc=(0, -0.05, -0.26), tail=tail_curve(20, 3), fl=FL_SPLAY)
    rebound = K(wings=W_REBOUND, spine=front(10), neck=-2, head=-4, jaw=8, loc=(0, 0, 0.06), tail=tail_curve(-6, 3), fl=FL_SPLAY)
    settle = K(wings=W_REBOUND, spine=front(-3), neck=4, head=2, jaw=6, loc=(0, 0, -0.04), tail=tail_curve(4, 3))
    hold = K(wings=lerp_wings(W_REBOUND, W_HALF, 0.5), spine=front(2), head=0, jaw=4)
    fold = K(wings=lerp_wings(W_HALF, (W1_FOLD, W2_FOLD, W3_FOLD), 0.55), spine=front(1))
    keys = [(0, BASE), (6, antic), (14, rise), (19, top), (21, top_x, "in"), (23, smear, "lin"), (24, slam, "out"), (25, slam_x),
            (28, rebound), (32, settle), (38, hold), (44, fold), (54, BASE)]
    return {"frames": frames, "keys": keys, "layers": [tremble([(16, 0), (19, 1), (21, 1), (22, 0)], period=4, amp=1.5)],
            "events": [(hit, "hit")], "review": [0, 6, 14, 21, 23, 24, 28, 44]}


def lerp_wings(a, b, u):
    return tuple(tuple(x + (y - x) * u for x, y in zip(sa, sb)) for sa, sb in zip(a, b))


def bump_wings(w, d):
    """顶点再多抬一点（moving hold）"""
    return ((w[0][0] + d, w[0][1], w[0][2]), (w[1][0] - d, w[1][1] + d, w[1][2]), (w[2][0] - d, w[2][1] + d, w[2][2]))


def strike_poses(head_up: float = 0.0):
    """扑出（拉直）→ 过冲 → 咬合 → 搁浅（头胸贴地、四腿摊开扒地）的一组姿势；head_up = 破水扑出时前身多抬多少（潜游突袭）"""
    strike = K(lift=head_up, spine=front(-4), neck=10 - head_up * 0.4, head=6 - head_up * 0.8, jaw=40, loc=(0, -0.5, 0.05 + head_up * 0.006),
               wings=W_HALF, fl=FL_REACH, hl=HL_PUSH, tail=tail_curve(10, 2))
    over = K(lift=head_up * 1.1, spine=front(-7), neck=14 - head_up * 0.4, head=10 - head_up * 0.8, jaw=46,
             loc=(0, -0.62, 0.02 + head_up * 0.006), wings=W_HALF, fl=FL_REACH, hl=HL_PUSH, tail=tail_curve(14, 2))
    bite = K(spine=front(-14), neck=24, head=16, jaw=-2, loc=(0, -0.6, -0.14), wings=lerp_wings(W_HALF, W_REBOUND, 0.5),
             fl=FL_SPLAY, hl=HL_SPLAY, tail=tail_curve(6, 2))
    land = K(spine=front(-20), neck=34, head=14, jaw=6, loc=(0, -0.55, -0.26), wings=W_REBOUND, fl=FL_SPLAY, hl=HL_SPLAY,
             tail=tail_curve(-6, 2))
    land2 = K(spine=front(-19), neck=32, head=12, jaw=10, loc=(0, -0.5, -0.25), wings=W_REBOUND, fl=FL_SPLAY, hl=HL_SPLAY,
              tail=tail_curve(-4, 2))
    slide = K(spine=front(-6), neck=10, head=6, jaw=4, loc=(0, 0.12, -0.12), wings=lerp_wings(W_REBOUND, (W1_FOLD, W2_FOLD, W3_FOLD), 0.6),
              fl=(4, 20, 10, 10), hl=(4, -14, 8, 20), tail=tail_curve(4, 2))
    return strike, over, bite, land, land2, slide


def clip_lunge() -> dict:
    """
    扑岸（0.7 + 0.35 + 1.2 = 2.25 s ≈ 67 帧，glint 0.2 → f13.5，hit 0.311 → f21）：
    f6 头往后一抽（颈后缩）→ f18 收成 S（俯视的 S：spine1 / 2 往左、spine3 / chest 往右、颈往左，头低贴水面、嘴张 20°、翅膀贴身）
    → f18–f21 三帧拉直 → f21 拉直扑出（整条成直线、头最前、嘴张 40°、两前腿往前伸、翅膀半张）→ f23 过冲 → f26 咬合 →
    f31 冲上岸搁浅（头胸贴地）→ f31–f58 四腿乱扒、尾巴在水里拍 → f58–f67 滑回水里
    """
    frames = 67
    glint, hit = ev_frame(0.2, frames), ev_frame(0.311, frames)
    pull = K(S=0.35, spine=front(6), neck=-14, head=2, jaw=6, loc=(0, 0.14, 0), wings=lerp_wings((W1_FOLD, W2_FOLD, W3_FOLD), W_TIGHT, 0.6),
             fl=FL_GATHER, hl=HL_GATHER)
    coil = K(S=0.85, spine=front(-4), neck=20, head=4, jaw=16, loc=(0, 0.3, -0.04), wings=W_TIGHT, fl=FL_GATHER, hl=HL_GATHER)
    coil_x = K(S=1.0, spine=front(-6), neck=26, head=5, jaw=20, loc=(0, 0.36, -0.06), wings=W_TIGHT, fl=FL_GATHER, hl=HL_GATHER)
    smear = K(S=0.25, spine=front(-5), neck=14, head=5, jaw=32, loc=(0, -0.2, 0.0), wings=lerp_wings(W_TIGHT, W_HALF, 0.5),
              fl=lerp_leg(FL_GATHER, FL_REACH, 0.6), hl=HL_PUSH, tail=tail_curve(6, 2))
    strike, over, bite, land, land2, slide = strike_poses()
    keys = [(0, BASE), (6, pull), (14, coil), (18, coil_x, "in"), (20, smear, "lin"), (21, strike, "out"), (23, over), (26, bite),
            (31, land), (56, land2), (61, slide), (67, BASE)]
    return {"frames": frames, "keys": keys,
            "layers": [tremble([(12, 0), (15, 1), (18, 1), (19, 0)], period=4, amp=1.2), scrabble([(29, 0), (34, 1), (54, 1), (60, 0)])],
            "events": [(glint, "glint"), (hit, "hit")], "review": [0, 6, 14, 18, 20, 21, 26, 36, 61]}


def lerp_leg(a, b, u):
    return tuple(x + (y - x) * u for x, y in zip(a, b))


def clip_dive() -> dict:
    """
    潜游突袭（1.5 + 0.35 + 1.2 = 3.05 s ≈ 91 帧，glint 0.41 → f37.5，hit 0.492 → f45）：
    f4 吸一口（头微抬、尾巴往下）→ f12 头往下扎（颈 +50°）、尾巴抬出水 → f16 尾巴一甩 → f20–f36 水下快速游动（游动波周期 0.5 s）、
    翅膀贴死、腿收紧 → f36–f42 收成 S、头往上 → f42–f45 三帧拉直 → f45 破水扑出（整条拉直、前身抬起头冲出水、嘴大张）→ f48 过冲 →
    f55 咬合 → f60 搁浅（头胸贴地）→ f60–f80 四腿乱扒 → f80–f91 滑回。沉浮高度由代码做，片段只管姿势
    """
    frames = 91
    glint, hit = ev_frame(0.41, frames), ev_frame(0.492, frames)
    antic = K(spine=front(8), neck=-6, head=-10, jaw=8, tail=tail_curve(-14, 2))
    plunge = K(hips=(16, 0, 0), spine=(8, 10, 10, 10), neck=34, head=70, jaw=4, wings=W_TIGHT, fl=FL_TIGHT, hl=HL_TIGHT,
               tail=tail_curve(62, 2, 1.1), tail_side=tail_curve(34, 3, 1.5))
    flick = K(hips=(13, 0, 0), spine=(6, 8, 8, 8), neck=32, head=56, jaw=2, wings=W_TIGHT, fl=FL_TIGHT, hl=HL_TIGHT,
              tail=tail_curve(52, 2, 1.1), tail_side=tail_curve(-44, 3, 1.5))
    swim_pose = K(spine=front(-2), neck=6, head=4, jaw=2, wings=W_TIGHT, fl=FL_TIGHT, hl=HL_TIGHT)
    coil = K(S=0.6, spine=front(4), neck=6, head=-10, jaw=10, loc=(0, 0.2, -0.04), wings=W_TIGHT, fl=FL_GATHER, hl=HL_GATHER)
    coil_x = K(S=1.0, spine=front(12), neck=-4, head=-26, jaw=18, loc=(0, 0.34, -0.06), wings=W_TIGHT, fl=FL_GATHER, hl=HL_GATHER)
    smear = K(S=0.25, spine=front(20), neck=-6, head=-20, jaw=32, loc=(0, -0.2, 0.0), wings=lerp_wings(W_TIGHT, W_HALF, 0.5),
              fl=lerp_leg(FL_GATHER, FL_REACH, 0.6), hl=HL_PUSH, tail=tail_curve(6, 2))
    strike, over, bite, land, land2, slide = strike_poses(head_up=26)
    keys = [(0, BASE), (4, antic), (12, plunge, "out"), (16, flick), (21, swim_pose), (34, swim_pose), (42, coil_x, "in"),
            (44, smear, "lin"), (45, strike, "out"), (48, over), (55, bite), (60, land), (80, land2), (85, slide), (91, BASE)]
    # 水下游动（0.5 s 一个周期，从 f14 起波；收 S 之前退掉）
    layers = [fast_swim(12, 15, 1.35, [(14, 0), (21, 1), (33, 1), (39, 0)]),
              tremble([(37, 0), (39, 1), (42, 1), (43, 0)], period=4, amp=1.2), scrabble([(57, 0), (62, 1), (78, 1), (84, 0)])]
    return {"frames": frames, "keys": keys, "layers": layers, "events": [(glint, "glint"), (hit, "hit")],
            "review": [0, 12, 16, 27, 38, 42, 45, 55, 66, 85]}


ROLL = 160


def clip_choke() -> dict:
    """
    噎住（破防，0.4 + 3.2 + 0.4 = 4.0 s = 120 帧）：f3 嘴里喷出一大团水（头往上一甩、嘴大张）→ f12 整身绕长轴翻过来（165° 过冲，翅膀摊开、
    四腿朝天）→ f16 停在 160° → f12–f108 四腿乱蹬、尾巴每 0.5 s 抽一下、头晃、嘴一张一合 → f108–f120 翻回来
    """
    frames = 120
    spew = K(spine=front(10), neck=-10, head=-24, jaw=42, wings=lerp_wings((W1_FOLD, W2_FOLD, W3_FOLD), W_HALF, 0.7), fl=(0, 10, 0, 0))
    flipped = dict(hips=(0, 0, ROLL), loc=(0, 0, 0.5), spine=front(-18), neck=34, head=4, head_roll=-50, jaw=26,
                   wings=W_BELLY, wr=W_BELLY_R, fl=FL_KICK, hl=HL_KICK, tail=tail_curve(-10, 2))
    roll_x = K(**dict(flipped, hips=(0, 0, ROLL + 8), loc=(0, 0, 0.6)))
    roll_a = K(**flipped)
    roll_b = K(**dict(flipped, hips=(0, 0, ROLL - 4), loc=(0, 0, 0.5)))
    unroll = K(hips=(0, 0, 50), loc=(0, 0, 0.25), spine=front(-2), neck=4, head=-4, head_roll=-14, jaw=10,
               wings=lerp_wings(W_BELLY, (W1_FOLD, W2_FOLD, W3_FOLD), 0.6), wr=lerp_wings(W_BELLY_R, (W1_FOLD, W2_FOLD, W3_FOLD), 0.6),
               tail=tail_curve(-4, 2))
    mid = K(hips=(0, 0, 80), loc=(0, 0, 0.4), spine=front(6), neck=-12, head=-18, head_roll=-15, jaw=34, wings=W_HALF,
            fl=(-4, 14, -8, -8), hl=(-4, 4, -4, -4), tail=tail_curve(-14, 2))
    keys = [(0, BASE), (3, spew, "smooth"), (7, mid), (12, roll_x), (16, roll_a), (60, roll_b), (106, roll_a, "smooth"), (114, unroll),
            (120, BASE)]
    return {"frames": frames, "keys": keys, "layers": [struggle([(9, 0), (15, 1), (104, 1), (112, 0)])], "events": [],
            "review": [0, 3, 7, 12, 30, 52, 80, 114]}


# 翻肚子时翅膀摊在水面（身体坐标里往下压：翻过来以后就是平摊在水面上）、四腿朝天乱蹬的底
# 翻 160°（不是 180°）：左翼会往水里扎、右翼翘起来，两边分开给，翻过来以后两翼都平摊在水面上
W_BELLY = ((-58, 10, 0), (-14, 18, 0), (-4, 16, 0))
W_BELLY_R = ((-22, 10, 0), (-10, 18, 0), (-2, 16, 0))
FL_KICK, HL_KICK = (-12, 8, -6, 0), (-8, -4, 0, 4)


def clip_roar() -> dict:
    """
    吼叫涨水（0.6 + 2.4 + 0.8 = 3.8 s = 114 帧）：f6 低头蓄一口 → f18 昂首（前半身抬 45°、颈后仰、双翼半张往后、嘴张到最大）
    → f18–f90 嘴张 50°、头每 0.6 s 往一边甩一下、全身轻颤 → f96 合嘴 → f114 底姿
    """
    frames = 114
    antic = K(spine=front(-6), neck=8, head=12, jaw=0, wings=W_PRESS, tail=tail_curve(-6, 2))
    up = K(lift=48, neck=-14, head=-28, jaw=48, wings=W_BACK, fl=(4, 10, 6, 0), tail=tail_curve(10, 2))
    up_x = K(lift=52, neck=-16, head=-32, jaw=52, wings=bump_wings(W_BACK, 3), fl=(4, 10, 6, 0), tail=tail_curve(12, 2))
    hold = K(lift=48, neck=-14, head=-28, jaw=50, wings=W_BACK, fl=(4, 10, 6, 0), tail=tail_curve(10, 2))
    close = K(lift=28, neck=-6, head=-10, jaw=4, wings=lerp_wings(W_BACK, (W1_FOLD, W2_FOLD, W3_FOLD), 0.5), tail=tail_curve(4, 2))
    keys = [(0, BASE), (6, antic), (18, up, "out"), (24, up_x), (60, hold), (90, up_x), (96, close), (114, BASE)]
    return {"frames": frames, "keys": keys, "layers": [head_shake([(20, 0), (27, 1), (86, 1), (93, 0)], f0=24)], "events": [],
            "review": [0, 6, 18, 33, 51, 96]}


def clip_spit() -> dict:
    """
    吐水弹（0.6 + 1.35 + 0.6 = 2.55 s ≈ 76 帧，release 0.235 / 0.412 / 0.588 → f18 / f31.5 / f44.5）：
    f6 前半身抬起（spine3 / chest 抬 25°）→ f15 仰头张嘴（颈后仰 30°、嘴张 35°）→ 每发：头往前一点（颈前探 12°、嘴再张 5°）→ 嘴合 10° → 再仰
    → f60 合嘴 → f76 底姿
    """
    frames = 76
    rel = [ev_frame(a, frames) for a in (0.235, 0.412, 0.588)]
    lift = K(lift=8, spine=(0, -3, -10, -12), neck=-4, head=-6, jaw=8, wings=W_HALF, tail=tail_curve(4, 2))
    cock = K(lift=10, spine=(0, -4, -12, -13), neck=-24, head=-40, jaw=35, wings=W_HALF, tail=tail_curve(8, 2))
    fire = K(lift=6, spine=(0, -3, -10, -11), neck=6, head=-6, jaw=40, loc=(0, -0.15, 0), wings=W_HALF, tail=tail_curve(10, 2))
    after = K(lift=8, spine=(0, -4, -11, -12), neck=-8, head=-20, jaw=30, wings=W_HALF, tail=tail_curve(8, 2))
    close = K(spine=front(10), neck=-2, head=-4, jaw=2, wings=lerp_wings(W_HALF, (W1_FOLD, W2_FOLD, W3_FOLD), 0.5))
    keys = [(0, BASE), (6, lift), (15, cock, "in")]
    for i, r in enumerate(rel):
        keys += [(r, fire, "out"), (r + 4, after)]
        if i < 2:
            keys.append((rel[i + 1] - 3.5, cock, "in"))
    keys += [(60, close), (76, BASE)]
    return {"frames": frames, "keys": keys, "layers": [], "events": [(r, "release") for r in rel],
            "review": [0, 6, 15, 18, 22, 32, 44, 60]}


def clip_tailsweep() -> dict:
    """
    尾扫（0.7 + 0.5 + 0.8 = 2.0 s = 60 帧，hit 0.35 → f21）：f6 尾巴先往右收（反向）→ f18 尾鳍翘出水面最高（tail_5–8 上翘 60°、整条尾往左收 40°）
    → f18–f21 三帧横扫 120°（从左扫到右）→ f24 过冲（尾鳍再甩）→ f36 → f60 底姿；前半身跟着反方向拧一点
    """
    frames = 60
    hit = ev_frame(0.35, frames)
    # 侧摆按「根部多、往后递减」分（整条尾巴一起甩，不是只有尾鳍在动）；hips 顺着尾巴的方向帮一把，脊柱反向抵掉，头一直朝前
    def side(total):
        return tuple(total * w for w in (0.30, 0.20, 0.15, 0.11, 0.08, 0.06, 0.06, 0.04))

    fin_up = (0, 0, 2, 4, 10, 14, 17, 15)       # tail_5–8 上翘约 60°
    antic = K(tail=tail_curve(8, 4), tail_side=side(-16), hips=(0, 4, 0), spine_yaw=(-2, -2, 0, 0))
    wind = K(tail=fin_up, tail_side=side(36), hips=(0, -8, 0), spine_yaw=(3, 3, 2, 0), spine=front(6), neck=-2, head=-6, jaw=8, wings=W_HALF)
    wind_x = K(tail=tuple(v * 1.06 for v in fin_up), tail_side=side(40), hips=(0, -9, 0), spine_yaw=(3, 3, 3, 0), spine=front(7), neck=-3,
               head=-8, jaw=10, wings=W_HALF)
    smear = K(tail=tuple(v * 0.95 for v in fin_up), tail_side=side(-36), hips=(0, 6, 0), spine_yaw=(-2, -2, -2, 0), spine=front(4), neck=0,
              head=-2, jaw=12, wings=W_HALF)
    sweep = K(tail=tuple(v * 0.9 for v in fin_up), tail_side=side(-68), hips=(0, 12, 0), spine_yaw=(-4, -4, -4, 0), spine=front(2), neck=2,
              head=2, jaw=10, wings=W_HALF)
    # 过冲：根先停，尾鳍还往前甩（follow-through）
    over = K(tail=tuple(v * 0.8 for v in fin_up), tail_side=tuple(a + b for a, b in zip(side(-66), (0, 0, 0, -2, -4, -6, -8, -8))), hips=(0, 13, 0),
             spine_yaw=(-5, -4, -4, 0), spine=front(1), neck=2, head=3, jaw=6, wings=W_HALF)
    back = K(tail=tail_curve(16, 3), tail_side=side(-24), hips=(0, 5, 0), spine_yaw=(-2, -2, -1, 0), jaw=4,
             wings=lerp_wings(W_HALF, (W1_FOLD, W2_FOLD, W3_FOLD), 0.5))
    keys = [(0, BASE), (6, antic), (15, wind), (18, wind_x, "in"), (20, smear, "lin"), (21, sweep, "out"), (25, over), (36, back), (60, BASE)]
    return {"frames": frames, "keys": keys, "layers": [tremble([(14, 0), (16, 1), (18, 1), (19, 0)], period=4, amp=1.0)],
            "events": [(hit, "hit")], "review": [0, 6, 18, 20, 21, 25, 36]}


def clip_rise() -> dict:
    """
    破水而出（登场，1.0 + 1.5 + 0.5 = 3.0 s = 90 帧）：f0 蜷在水下（S 形、头往下、翅膀贴死）→ f30 再一收（蓄力）→ f40 前身冲起
    → f46 冲到顶（过冲）→ f56 双翼展开 9 m、张嘴 → f56–f75 翅膀扇动 → f90 收回底姿
    """
    frames = 90
    curl = K(S=0.55, hips=(8, 0, 0), spine=(4, 6, 6, 6), neck=22, head=44, jaw=2, loc=(0, 0.1, -0.2), wings=W_TIGHT, fl=FL_TIGHT,
             hl=HL_TIGHT, tail=tail_curve(-10, 2), tail_side=tail_curve(-24, 0, 0.7))
    curl2 = K(S=0.7, hips=(9, 0, 0), spine=(5, 7, 7, 7), neck=26, head=50, jaw=2, loc=(0, 0.14, -0.24), wings=W_TIGHT, fl=FL_TIGHT,
              hl=HL_TIGHT, tail=tail_curve(-12, 2), tail_side=tail_curve(-30, 0, 0.7))
    gather = K(S=0.8, hips=(10, 0, 0), spine=(6, 8, 8, 8), neck=30, head=56, jaw=0, loc=(0, 0.2, -0.3), wings=W_TIGHT, fl=FL_GATHER,
               hl=HL_GATHER, tail=tail_curve(-16, 2), tail_side=tail_curve(-34, 0, 0.7))
    surge = K(spine=front(42), neck=-10, head=-16, jaw=16, loc=(0, -0.1, 0.12), wings=lerp_wings(W_TIGHT, W_SPREAD, 0.35),
              fl=FL_REACH, hl=HL_PUSH, tail=tail_curve(14, 2))
    surge_x = K(spine=front(54), neck=-14, head=-22, jaw=24, loc=(0, -0.14, 0.18), wings=lerp_wings(W_TIGHT, W_SPREAD, 0.75),
                fl=FL_REACH, hl=HL_PUSH, tail=tail_curve(18, 2))
    spread = K(spine=front(48), neck=-12, head=-20, jaw=40, loc=(0, -0.1, 0.12), wings=W_SPREAD, fl=(0, 16, 0, 0), tail=tail_curve(12, 2))
    hold = K(spine=front(46), neck=-12, head=-18, jaw=44, loc=(0, -0.08, 0.1), wings=W_SPREAD, fl=(0, 16, 0, 0), tail=tail_curve(10, 2))
    calm = K(spine=front(18), neck=-4, head=-6, jaw=8, loc=(0, -0.03, 0.04), wings=lerp_wings(W_SPREAD, (W1_FOLD, W2_FOLD, W3_FOLD), 0.55),
             tail=tail_curve(4, 2))
    keys = [(0, curl), (20, curl2), (30, gather, "in"), (40, surge, "out"), (46, surge_x), (56, spread), (72, hold), (80, calm), (90, BASE)]
    return {"frames": frames, "keys": keys, "layers": [flutter([(52, 0), (58, 1), (72, 1), (78, 0)]), tremble([(18, 0), (24, 1), (30, 1), (34, 0)])],
            "events": [], "review": [0, 30, 40, 46, 56, 66, 80]}


# ───────────── 片段表 ─────────────
CLIPS = {
    "Idle": clip_idle(),
    "wingslap": clip_wingslap(),
    "dive": clip_dive(),
    "choke": clip_choke(),
    "lunge": clip_lunge(),
    "roar": clip_roar(),
    "spit": clip_spit(),
    "tailsweep": clip_tailsweep(),
    "rise": clip_rise(),
}


# ───────────── 采样：关键姿势插值 + 程序层 ─────────────
EXP = {"in": 1.7, "out": 2.0}


def _slopes(ts, vs) -> list:
    """单调三次 Hermite（PCHIP）的切线：两边斜率异号 / 有一边为 0 时切线为 0（极值处不过冲）；首尾为 0"""
    n = len(ts)
    m = [0.0] * n
    d = [(vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]) for i in range(n - 1)]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            continue
        h0, h1 = ts[i] - ts[i - 1], ts[i + 1] - ts[i]
        w1, w2 = 2 * h1 + h0, h1 + 2 * h0
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    return m


def _interp(ts, vs, eases, ms, f) -> float:
    if f <= ts[0]:
        return vs[0]
    if f >= ts[-1]:
        return vs[-1]
    i = max(j for j in range(len(ts) - 1) if ts[j] <= f)
    t0, t1, v0, v1 = ts[i], ts[i + 1], vs[i], vs[i + 1]
    h = t1 - t0
    u = (f - t0) / h
    e = eases[i]
    if e == "lin":
        return v0 + (v1 - v0) * u
    if e == "in":
        return v0 + (v1 - v0) * u ** EXP["in"]
    if e == "out":
        return v0 + (v1 - v0) * (1 - (1 - u) ** EXP["out"])
    if e == "smooth":
        return v0 + (v1 - v0) * smooth01(u)
    if e == "hold":
        return v0
    h00, h10, h01, h11 = 2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u, -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2
    return h00 * v0 + h10 * h * ms[i] + h01 * v1 + h11 * h * ms[i + 1]


def sampler(clip: dict):
    """返回 f → 姿势（关键姿势逐通道插值 + 程序层）"""
    keys = [(k[0], k[1], k[2] if len(k) > 2 else None) for k in clip["keys"]]
    ts = [k[0] for k in keys]
    eases = [k[2] for k in keys]
    chans = sorted({(b, i) for _, p, _ in keys for b in p for i in range(3)})
    table = {}
    for b, i in chans:
        vs = [(p.get(b) or [0.0, 0.0, 0.0])[i] for _, p, _ in keys]
        table[(b, i)] = (vs, _slopes(ts, vs))

    def at(f: float) -> dict:
        p = {}
        for (b, i), (vs, ms) in table.items():
            v = _interp(ts, vs, eases, ms, f)
            if b == "loc":
                p.setdefault("loc", [0.0, 0.0, 0.0])[i] = v
            else:
                p.setdefault(b, [0.0, 0.0, 0.0])[i] = v
        for layer in clip.get("layers", []):
            p = merge(p, layer(f))
        return p
    return at


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


REST_Q = {}


def basis_of(arm, p: dict) -> dict:
    """姿势 → 每根骨的 (局部四元数, 局部位移)：D 在静止世界坐标里给出，换成骨骼自己的静止坐标 q = R⁻¹·D·R"""
    out = {}
    for pb in arm.pose.bones:
        r = REST_Q[pb.name]
        v = p.get(pb.name)
        if v and pb.name != "root":
            pitch, yaw, roll = (math.radians(c) for c in v)
            d = Quaternion((0, 0, 1), yaw) @ Quaternion((1, 0, 0), pitch) @ Quaternion((0, 1, 0), roll)
            q = r.inverted() @ d @ r
        else:
            q = Quaternion()
        loc = Vector()
        if pb.name == "hips" and "loc" in p:
            loc = r.inverted() @ Vector(p["loc"])
        out[pb.name] = (q, loc)
    return out


def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def set_pose(arm, p: dict):
    for name, (q, loc) in basis_of(arm, p).items():
        pb = arm.pose.bones[name]
        pb.rotation_quaternion = q
        pb.location = loc
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def fcurves(act) -> list:
    """动作的全部曲线（Blender 4.4 起是分层动作：layers → strips → channelbags）"""
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def bake_clip(arm, name: str, clip: dict):
    """逐帧采样、逐帧打键（全部骨骼的旋转 + hips 位移；root 一直是单位变换）"""
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    at = sampler(clip)
    prev = {}
    samples = []
    for f in range(clip["frames"] + 1):
        b = basis_of(arm, at(f))
        samples.append(b)
        for pb in arm.pose.bones:
            q, loc = b[pb.name]
            if pb.name in prev and q.dot(prev[pb.name]) < 0:   # 四元数连续性：别绕远路
                q = -q
            prev[pb.name] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            if pb.name in ("hips", "root"):
                pb.location = loc
                pb.keyframe_insert("location", frame=f, group=pb.name)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
        if clip.get("loop"):
            fc.modifiers.new("CYCLES")
    return act, samples


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


# ───────────── 检查 ─────────────
def chain_dirs(arm) -> dict:
    return {b: (arm.pose.bones[b].tail - arm.pose.bones[b].head).normalized() for b in FWD + TAIL}


def sharpest_bend(arm) -> tuple:
    """身体链相邻两节的夹角（度）里最大的那个：脊柱折成尖角的检查"""
    d = chain_dirs(arm)
    worst = (0.0, "")
    pairs = [(PARENT[b], b) for b in FWD[1:] + TAIL[1:]]
    for a, b in pairs:
        if b == "head" or b == "neck":
            continue
        ang = math.degrees(d[a].angle(d[b]))
        if ang > worst[0]:
            worst = (ang, f"{a}→{b}")
    return worst


def loop_error(samples: list) -> float:
    """首尾帧每根骨旋转的最大差（度）"""
    a, b = samples[0], samples[-1]
    worst = 0.0
    for name in a:
        qa, la = a[name]
        qb, lb = b[name]
        worst = max(worst, math.degrees(qa.rotation_difference(qb).angle), (la - lb).length * 100)
    return worst


# ───────────── 事件叠加表 ─────────────
def write_events(path: Path):
    """只改写这里手 K、带事件的状态（数组写法，一个事件一行）；其余状态与 about 原样保留"""
    doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"about": "", "clips": {}}
    clips = doc.setdefault("clips", {})
    for name, c in CLIPS.items():
        if c["events"]:
            clips[name] = [{"at": round(f / c["frames"], 4), "name": n} for f, n in c["events"]]
    lines = ["{"]
    for k, v in doc.items():
        if k != "clips":
            lines.append(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},")
    lines.append('  "clips": {')
    names = list(clips)
    for i, name in enumerate(names):
        evs = clips[name]
        tail = "," if i < len(names) - 1 else ""
        if isinstance(evs, list):
            body = ",\n".join(f'      {{ "at": {e["at"]}, "name": {json.dumps(e["name"], ensure_ascii=False)} }}' for e in evs)
            lines.append(f"    {json.dumps(name)}: [\n{body}\n    ]{tail}" if evs else f"    {json.dumps(name)}: []{tail}")
        else:
            lines.append(f"    {json.dumps(name)}: {json.dumps(evs, ensure_ascii=False)}{tail}")
    lines += ["  }", "}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ───────────── 审核联系表 ─────────────
VIEWS = (("side", Vector((1, 0, 0.06)), Vector((0, -0.2, 2.0)), 11.5),
         ("q", Vector((0.55, -0.78, 0.32)), Vector((0, -0.4, 1.9)), 12.0),
         ("top", Vector((0, 0, 1)), Vector((0, -0.3, 0)), 12.0),
         ("front", Vector((0, -1, 0.12)), Vector((0, 0, 2.2)), 11.0))


class Stretch:
    """网格拉伸：每条边 当前长度 ÷ 静止长度（拉伸撕裂的检查）；只看静止长度 > 1 cm 的边"""

    def __init__(self, mesh_obj):
        import numpy as np
        self.np = np
        self.obj = mesh_obj
        me = mesh_obj.data
        e = np.empty(len(me.edges) * 2, dtype=np.int32)
        me.edges.foreach_get("vertices", e)
        self.e = e.reshape(-1, 2)
        self.rest = self.lengths()
        keep = self.rest > 0.01
        self.e, self.rest = self.e[keep], self.rest[keep]

    def lengths(self):
        np = self.np
        ev = self.obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.data
        co = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        return np.linalg.norm(co[self.e[:, 0]] - co[self.e[:, 1]], axis=1)

    def measure(self) -> tuple:
        """(最大拉伸, 99.9 分位, 拉伸 > 1.8 倍的边数)"""
        r = self.lengths() / self.rest
        return float(r.max()), float(self.np.percentile(r, 99.9)), int((r > 1.8).sum())


def review(arm, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    reset_pose(arm)
    stretch = Stretch(next(o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm))
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = RES, RES
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.16, 0.17, 0.2)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    # 水线参照：z = 0 处一根细横条（只在侧视 / 3/4 视里看得见，不挡身子）
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    bar = bpy.context.object
    bar.scale = (0.02, 14, 0.02)
    tiles = []
    for name, clip in CLIPS.items():
        if ONLY and name not in ONLY:
            continue
        at = sampler(clip)
        evs = {}
        for f, n in clip["events"]:
            evs.setdefault(int(round(f)), []).append(n)
        for frame in clip["review"]:
            set_pose(arm, at(frame))
            bend, where = sharpest_bend(arm)
            smax, s999, nbad = stretch.measure()
            print(f"HUASHE_CHECK {name} f{frame}: 最大折角 {bend:.1f}°（{where}）  拉伸 max {smax:.2f} / p99.9 {s999:.2f} / >1.8× {nbad} 条")
            for view, d, centre, scale in VIEWS:
                if view not in VIEW_NAMES:
                    continue
                cam.data.ortho_scale = scale
                d = d.normalized()
                cam.location = centre + d * 40
                if view == "top":
                    cam.rotation_euler = (0, 0, math.pi)
                else:
                    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
                bar.hide_render = view == "top"
                p = out / f"{name}_{frame:03d}_{view}.png"
                sc.render.filepath = str(p)
                bpy.ops.render.render(write_still=True)
                tiles.append({"clip": name, "frame": frame, "view": view, "file": str(p), "events": evs.get(frame, []),
                              "bend": round(bend, 1), "bendAt": where, "stretch": round(s999, 2)})
    (out / "tiles.json").write_text(json.dumps(tiles, ensure_ascii=False, indent=0), encoding="utf-8")
    py = shutil.which("python") or shutil.which("py")
    if py:
        subprocess.run([py, str(HERE / "huashe_review_sheet.py"), str(out / "tiles.json"), str(SHEET_OUT)], check=False)
    else:
        print("HUASHE_REVIEW 找不到系统 Python，联系表没拼：", out / "tiles.json")


def main():
    arm = load_rig(keep_meshes=REVIEW is not None)
    for pb in arm.pose.bones:
        REST_Q[pb.name] = pb.bone.matrix_local.to_quaternion()
    if REVIEW:
        review(arm, REVIEW)
        print("HUASHE_REVIEW " + str(SHEET_OUT))
        return
    # 导出前顶层物体绕 Z 转 180°（同 bl_unity_export：Unity 里角色朝 +Z）；只写在物体上，骨骼的局部动画不受影响
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    # 再放一个顶层空物体：FBX 里只有一个顶层物体时 Unity 会把它折叠成文件根节点，层级就和本体对不上（同 hanba_anims.py）
    keep = bpy.data.objects.new(f"{ASSET}_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report = {}
    for name, clip in CLIPS.items():
        if ONLY and name not in ONLY:
            continue
        act, samples = bake_clip(arm, name, clip)
        export_fbx(arm, act, name, clip["frames"], UNITY / "Keyframed")
        arm.animation_data.action = None
        bends = []
        at = sampler(clip)
        for f in range(0, clip["frames"] + 1):
            set_pose(arm, at(f))
            bends.append(sharpest_bend(arm) + (f,))
        worst = max(bends)
        report[name] = {"frames": clip["frames"], "seconds": round(clip["frames"] / FPS, 3),
                        "events": [[f, n, round(f / clip["frames"], 4)] for f, n in clip["events"]],
                        "sharpest": [round(worst[0], 1), worst[1], worst[2]]}
        if clip.get("loop"):
            report[name]["loopError"] = round(loop_error(samples), 4)
        # 逐帧最大的转动（度 / 帧）：查有没有跳帧（smear 段本来就快）
        jump = max((math.degrees(a[n][0].rotation_difference(b[n][0]).angle), n, f + 1)
                   for f, (a, b) in enumerate(zip(samples, samples[1:])) for n in a)
        report[name]["fastest"] = [round(jump[0], 1), jump[1], jump[2]]
    if not ONLY:
        write_events(UNITY / f"{ASSET}.events.json")
    print("HUASHE_ANIMS " + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
