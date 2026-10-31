"""飞廉（SK_Boss_Feilian，4-1 冰川口领主，风伯：鹿身雀头、鹿角、蛇尾羽扇）手工关键帧动作：Blender 无头脚本，一次生成全部手 K 片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Feilian/anim/feilian_anims.py -- [--review <目录>] [--only a,b] [--out <目录>]

设计单见 docs/art/vfx/feilian.md（第 0 节动作气质、第 2 节节拍表、第 3 节登场 / 破防 / 死亡），招式三段秒数与事件时刻见
docs/art/ch4-move-events.json 的 assets.SK_Boss_Feilian：片段帧数 = 三段之和 × 30，出手事件落在表里的时刻（误差 ≤ 1 帧）。

产出（都可以重新生成）：
  unity/Assets/Art/Characters/SK_Boss_Feilian/Anim/Keyframed/<状态>.fbx   一个状态一个文件（文件名 = Animator 状态名），同名时覆盖采样片段
  unity/Assets/Art/Characters/SK_Boss_Feilian/Anim/SK_Boss_Feilian.events.json   只改这里手 K 的状态，其余条目原样保留
  --review <目录>   每段关键帧的侧视 / 3/4 视小图（Workbench 贴图着色）+ 逐段联系表，并拼成
                    docs/art/review/ch4-port/B1/feilian-keyposes.jpg（--sheet <路径> 可改）；同时逐帧体检（穿地、拉伸、反折、滑步、循环接缝）
  --out <目录>      试跑时把 FBX 和事件表写到别处（不碰 Unity 工程）

骨架来自发布的 public/assets/characters/SK_Boss_Feilian.glb（骨骼见 art/pipeline/creature_rigs/SK_Boss_Feilian.json：鹿形四足，和火麒麟同一套
upperarm / forearm / fcannon / fhoof、thigh / shin / hcannon / hhoof，加 scapula / haunch 辅助骨；antler_L / R；orb 是风雷珠挂点；蛇尾 tail_1..7），
导入 / 导出设置与 qilin_anims.py、bl_unity_export.py 一致（顶层物体绕 Z 转 180°、-Z 前 / Y 上、主骨轴 Y），Unity 侧 Generic，NativeClipBuilder 按骨骼名接曲线。

和 qilin_anims.py 的区别（同一套参数化写法，求解改成逐帧）：
  · 逐帧求解：关键姿势的参数逐帧插值（单调三次 = Blender 的自动钳制柄；可按段指定缓动），每一帧重新解踩地，所以人立 / 刨蹄 / 下蹲时踩地的蹄子
    逐帧钉死（两骨 IK 只改上臂·前臂 / 大腿·小腿，掌骨和蹄保持给定的绝对角），不是只在关键帧上对齐。
  · 蛇尾 7 节逐节滞后（overlapping action）：第 i 节取 lag·i/7 帧之前的尾巴参数，尾尖滞后 lag 帧（默认 3，收招「滞后 3–4 帧回来」）。
  · 整身侧倾 roll（回旋往弧心倾、侧跃、侧倒）在身体姿势解完之后整体绕前后轴转；侧倒按网格最低点贴地（身体贴地、不穿地）。
  · 羽扇张开靠 tail_7 缩放（fan，设计单第 6 节：× 1.3）。
  · 片段不带根运动：root 骨不动；人立、下蹲、侧倒只平移 hips。
  · 没有下颌骨：长嘶只抬头、仰颈。

姿势写法（Blender 坐标：front = -Y，生物的左 = +X，up = +Z；角度都是度）：
  pitch   整个身体绕 hips 头（尾根上方）俯仰：正 = 前身往下（低头），负 = 前身抬起（人立）
  spine / chest / neck   脊柱逐节的相对弯曲（正 = 往下弯）；chest_yaw / neck_yaw / head_yaw 绕世界 Z（正 = 转向生物的左）
  head    头的「绝对」俯仰（相对静止姿势的世界朝向）：正 = 低头，负 = 仰头
  fl / fr / hl / hr   四条腿每一节（上臂·前臂·掌骨·蹄 / 大腿·小腿·跖骨·蹄）的绝对摆角：正 = 往后摆，负 = 往前摆；
                      蹄 None = 踩地的保持蹄底水平、不踩地的跟着掌骨。scapula / haunch 辅助骨分走上臂 / 大腿相对摆角的 30%，肩、胯不折
  spread  (前, 后) 腿往外张（绕前后轴，度）
  roll    整身侧倾（绕前后轴，正 = 背往生物的左倒）；roll_z 转轴高度（0 = 地面，侧倒用身体中心）
  tail / tail_yaw   蛇尾三个控制值（根 / 中 / 尖，逐节插到 7 节，每节的相对角）：tail 正 = 往上卷；tail_yaw 正 = 往生物的左摆
  fan     羽扇张开（tail_7 横向缩放）；lag 尾尖滞后帧数
  lift / fwd   身体在踩地解算之后再平移（米）：lift 负 = 下沉（踩地的腿自动屈膝），fwd 正 = 往后（人立时重心压到后蹄上方）
  plant   哪些蹄子踩地："all" / "hind" / "front" / "hind+fl" 这类组合（逐帧钉在静止位置）；"low" = 奔跑（最低的蹄子着地，不钉）；
          "mesh" = 侧倒（网格最低点贴地）；None = 腾空
关键帧 = (帧, 姿势) 或 (帧, 姿势, 缓动)：缓动管「从这一帧到下一帧」那一段（默认单调三次）："in" 加速冲向下一帧（smear 段，砸在释放帧上）、
"out" 从这一帧减速出去、"lin" 匀速。
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[5]
ASSET = "SK_Boss_Feilian"
GLB = ROOT / f"public/assets/characters/{ASSET}.glb"
UNITY = ROOT / f"unity/Assets/Art/Characters/{ASSET}/Anim"
SHEET = ROOT / "docs/art/review/ch4-port/B1/feilian-keyposes.jpg"
FPS = 30
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REVIEW = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
ONLY = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
OUT = Path(argv[argv.index("--out") + 1]) if "--out" in argv else UNITY
SHEET = Path(argv[argv.index("--sheet") + 1]) if "--sheet" in argv else SHEET
# 迭代用：--frames 26,28 只渲这些帧；--views side,q,front 视角；--tile 像素；--nocheck 跳过逐帧体检
FRAMES = [float(x) for x in argv[argv.index("--frames") + 1].split(",")] if "--frames" in argv else None
VIEWS = argv[argv.index("--views") + 1].split(",") if "--views" in argv else ["side", "q"]
TILE = int(argv[argv.index("--tile") + 1]) if "--tile" in argv else 320
NOCHECK = "--nocheck" in argv

# 四条腿：辅助骨（肩胛 / 胯）→ 上段 → 下段 → 掌骨 → 蹄
LEGS = {
    "fl": ("scapula_L", "upperarm_L", "forearm_L", "fcannon_L", "fhoof_L"),
    "fr": ("scapula_R", "upperarm_R", "forearm_R", "fcannon_R", "fhoof_R"),
    "hl": ("haunch_L", "thigh_L", "shin_L", "hcannon_L", "hhoof_L"),
    "hr": ("haunch_R", "thigh_R", "shin_R", "hcannon_R", "hhoof_R"),
}
HELPER_SHARE = 0.3      # 肩胛 / 胯分走上段相对摆角的比例
TAIL_COMP = 0.7         # 尾根反向抵掉 70% 的身体俯仰（人立时尾巴不跟着整根甩到地上 / 天上）
TAILS = [f"tail_{i}" for i in range(1, 8)]
PLANTS = {"all": ("fl", "fr", "hl", "hr"), "hind": ("hl", "hr"), "front": ("fl", "fr")}

SCALARS = ("pitch", "spine", "chest", "neck", "head", "chest_yaw", "neck_yaw", "head_yaw", "roll", "roll_z", "splay", "lift", "fwd", "fan", "lag")
VECS = (("fl", 4), ("fr", 4), ("hl", 4), ("hr", 4), ("spread", 2), ("tail", 3), ("tail_yaw", 3))
TAIL_CH = ("tail", "tail_yaw", "fan")


def plant_legs(plant) -> tuple:
    """plant → 钉住的腿（"low" / "mesh" / None 不钉）"""
    if not plant or plant in ("low", "mesh"):
        return ()
    if plant in PLANTS:
        return PLANTS[plant]
    legs = []
    for part in plant.split("+"):
        legs += PLANTS.get(part, (part,))
    return tuple(legs)


def P(pitch=0.0, spine=0.0, chest=0.0, neck=0.0, head=0.0, chest_yaw=0.0, neck_yaw=0.0, head_yaw=0.0, roll=0.0, roll_z=0.0, splay=0.0,
      fl=(0, 0, 0, None), fr=None, hl=(0, 0, 0, None), hr=None, spread=(0, 0), tail=(0, 0, 0), tail_yaw=(0, 0, 0), fan=1.0,
      lift=0.0, fwd=0.0, lag=3.0, plant="all", reach=None) -> dict:
    """一个关键姿势（参数见文件头）。fr / hr 缺省 = 和左边一样；蹄 None 按踩不踩地解成数值（插值要连续）"""
    p = {"pitch": pitch, "spine": spine, "chest": chest, "neck": neck, "head": head, "chest_yaw": chest_yaw, "neck_yaw": neck_yaw,
         "head_yaw": head_yaw, "roll": roll, "roll_z": roll_z, "splay": splay, "spread": tuple(spread), "tail": tuple(tail),
         "tail_yaw": tuple(tail_yaw), "fan": fan, "lift": lift, "fwd": fwd, "lag": lag, "plant": plant, "reach": dict(reach or {})}
    planted = plant_legs(plant)
    for k, v in (("fl", fl), ("fr", fr or fl), ("hl", hl), ("hr", hr or hl)):
        v = tuple(v) + (None,) * (4 - len(v))
        hoof = v[3] if v[3] is not None else (0.0 if k in planted or plant == "low" else v[2])
        p[k] = (float(v[0]), float(v[1]), float(v[2]), float(hoof))
    return p


def mod(p: dict, **kw) -> dict:
    """在一个姿势上改几项（新给的腿按新的 plant 解蹄；没给的腿沿用原值）"""
    q = dict(p)
    q.update(kw)
    planted = plant_legs(q["plant"])
    for k in ("fl", "fr", "hl", "hr"):
        if k in kw:
            v = tuple(kw[k]) + (None,) * (4 - len(kw[k]))
            hoof = v[3] if v[3] is not None else (0.0 if k in planted or q["plant"] == "low" else v[2])
            q[k] = (float(v[0]), float(v[1]), float(v[2]), float(hoof))
    for k in ("spread", "tail", "tail_yaw"):
        q[k] = tuple(q[k])
    return q


def flatten(p: dict) -> list:
    v = [float(p[k]) for k in SCALARS]
    for k, n in VECS:
        v += [float(x) for x in p[k]]
    return v


def unflatten(v: list) -> dict:
    p = {k: v[i] for i, k in enumerate(SCALARS)}
    i = len(SCALARS)
    for k, n in VECS:
        p[k] = tuple(v[i:i + n])
        i += n
    return p


CH_INDEX = {}
_i = len(SCALARS)
for _k, _n in VECS:
    CH_INDEX[_k] = list(range(_i, _i + _n))
    _i += _n
CH_INDEX["fan"] = [SCALARS.index("fan")]
NCH = _i


# ───────────── 插值：单调三次（Fritsch–Carlson，= Blender 自动钳制柄：极值处切线为 0、不过冲）+ 按段缓动 ─────────────
def _fc(d0, d1, h0, h1):
    if d0 * d1 <= 0:
        return 0.0
    w1, w2 = 2 * h1 + h0, h1 + 2 * h0
    return (w1 + w2) / (w1 / d0 + w2 / d1)


EASE = {"in": lambda t: t * t, "in3": lambda t: t * t * t, "out": lambda t: 1 - (1 - t) ** 2, "lin": lambda t: t,
        "smooth": lambda t: t * t * (3 - 2 * t)}


class Track:
    """一段片段的参数轨：sample(f) → 该帧（可以是小数帧）的参数向量；循环片段首尾按周期接上"""

    def __init__(self, clip: dict):
        keys = [(float(k[0]), k[1], k[2] if len(k) > 2 else None) for k in clip["keys"]]
        self.N = clip["frames"]
        self.loop = bool(clip.get("loop"))
        self.xs = [k[0] for k in keys]
        self.ys = [flatten(k[1]) for k in keys]
        self.ease = [k[2] for k in keys]
        self.plants = [k[1]["plant"] for k in keys]
        self.reach = [k[1].get("reach", {}) for k in keys]
        assert self.xs[0] == 0 and self.xs[-1] == self.N, f"关键帧要从 0 排到 {self.N}"
        n = len(self.xs)
        h = [self.xs[i + 1] - self.xs[i] for i in range(n - 1)]
        self.m = []
        for c in range(NCH):
            ys = [y[c] for y in self.ys]
            d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
            m = [0.0] * n
            for i in range(1, n - 1):
                m[i] = _fc(d[i - 1], d[i], h[i - 1], h[i])
            if self.loop and n > 2:
                m[0] = m[-1] = _fc(d[-1], d[0], h[-1], h[0])
            self.m.append(m)

    def seg(self, f: float):
        if self.loop:
            f %= self.N
        else:
            f = min(max(f, 0.0), float(self.N))
        for i in range(len(self.xs) - 1):
            if f <= self.xs[i + 1] or i == len(self.xs) - 2:
                return i, (f - self.xs[i]) / (self.xs[i + 1] - self.xs[i])
        return len(self.xs) - 2, 1.0

    def sample(self, f: float, chans=None) -> list:
        i, t = self.seg(f)
        h = self.xs[i + 1] - self.xs[i]
        y0, y1 = self.ys[i], self.ys[i + 1]
        e = self.ease[i]
        out = list(y0)
        for c in (chans if chans is not None else range(NCH)):
            if e:
                out[c] = y0[c] + (y1[c] - y0[c]) * EASE[e](t)
            else:
                t2, t3 = t * t, t * t * t
                out[c] = ((2 * t3 - 3 * t2 + 1) * y0[c] + (t3 - 2 * t2 + t) * h * self.m[c][i] + (-2 * t3 + 3 * t2) * y1[c]
                          + (t3 - t2) * h * self.m[c][i + 1])
        return out

    def frame(self, f: float) -> dict:
        """第 f 帧的完整参数：身体按当前帧，蛇尾 7 节逐节滞后；附上前后两个关键帧的 plant 和混合权重"""
        p = unflatten(self.sample(f))
        lag = p["lag"]
        tail_ch = CH_INDEX["tail"] + CH_INDEX["tail_yaw"] + CH_INDEX["fan"]
        bones = []
        for i in range(7):
            q = unflatten(self.sample(f - lag * (i + 1) / 7.0, tail_ch))
            u = i / 6.0
            def ctrl(v):
                return v[0] + (v[1] - v[0]) * u * 2 if u <= 0.5 else v[1] + (v[2] - v[1]) * (u - 0.5) * 2
            bones.append((ctrl(q["tail"]), ctrl(q["tail_yaw"])))
            if i == 6:
                p["fan"] = q["fan"]
        p["tail_bones"] = bones
        i, t = self.seg(f)
        p["plantA"], p["plantB"] = self.plants[i], self.plants[i + 1]
        p["reachA"], p["reachB"] = self.reach[i], self.reach[i + 1]
        p["t"] = t * t * (3 - 2 * t)
        return p


# ───────────── 骨架：自己做正向运动学（不走依赖图，逐帧求解快），最后换算成每根骨的局部变换 ─────────────
class Rig:
    def __init__(self, arm, mesh):
        self.arm, self.mesh = arm, mesh
        bones = arm.data.bones
        self.names = [b.name for b in bones]
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.rel_inv = {n: ((self.rest[pr].inverted() @ self.rest[n]).inverted() if pr else self.rest[n].inverted())
                        for n, pr in self.parent.items()}
        self.sub = {}
        for b in bones:
            self.sub[b.name] = [b.name] + [c.name for c in b.children_recursive]
        self.rest_hoof = {k: self.rest[LEGS[k][4]].translation.copy() for k in LEGS}
        # 两骨 IK 的默认弯向（静止姿势里膝 / 肘在大腿-胫 / 上臂-前臂连线的哪一侧）
        self.bend = {}
        for k, ch in LEGS.items():
            A, B, C = (self.rest[ch[i]].translation for i in (1, 2, 3))
            self.bend[k] = 1.0 if _cross2(C - A, B - A) >= 0 else -1.0
        # 蹄底两个触地点（蹄尖 / 蹄踵，静止时 z = 0），存成蹄骨局部坐标：蹄子怎么转都按真实的蹄底算贴地
        self.contact = {}
        for k, ch in LEGS.items():
            x = 0.36 if k[1] == "l" else -0.36
            pts = ((x, -2.20, 0.0), (x, -1.92, 0.0)) if k[0] == "f" else ((x, -0.36, 0.0), (x, -0.10, 0.0))
            inv = self.rest[ch[4]].inverted()
            self.contact[k] = [inv @ Vector(pt) for pt in pts]

    # 正向运动学：返回每根骨在骨架空间的矩阵
    def fk(self, p: dict, d=None, d2=None) -> dict:
        M = dict(self.rest)
        sub = self.sub

        def rot(bone, axis, deg, pivot=None):
            if abs(deg) < 1e-7:
                return
            c = (M[bone].translation if pivot is None else pivot).copy()
            R = Matrix.Translation(c) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-c)
            for n in sub[bone]:
                M[n] = R @ M[n]

        def move(v):
            if v is None or v.length < 1e-9:
                return
            T = Matrix.Translation(v)
            for n in sub["hips"]:
                M[n] = T @ M[n]

        body = p["pitch"]
        chest_abs = body + p["spine"] + p["chest"]
        neck_abs = chest_abs + p["neck"]
        rot("hips", X, body)
        rot("spine", X, p["spine"])
        rot("chest", X, p["chest"])
        rot("chest", Z, p["chest_yaw"])
        rot("neck", X, p["neck"])
        rot("neck", Z, p["neck_yaw"])
        rot("head", X, p["head"] - neck_abs)
        rot("head", Z, p["head_yaw"])
        for k, ch in LEGS.items():
            front = k[0] == "f"
            parent_abs = chest_abs if front else body
            a = p[k]
            helper = HELPER_SHARE * (a[0] - parent_abs)
            rot(ch[0], X, helper)
            prev = parent_abs + helper
            for i in range(4):
                rot(ch[i + 1], X, a[i] - prev)
                prev = a[i]
            s = p["spread"][0 if front else 1]
            rot(ch[1], Y, (-s if k[1] == "l" else s) - p["splay"])
        for i, (curl, yaw) in enumerate(p["tail_bones"]):
            rot(TAILS[i], X, curl - (body * TAIL_COMP if i == 0 else 0.0))
            rot(TAILS[i], Z, -yaw)
        move(d)
        if abs(p["roll"]) > 1e-6:
            rot("hips", Y, p["roll"], pivot=Vector((0.0, 0.0, p["roll_z"])))
        move(d2)
        return M

    def hoof(self, M, k) -> Vector:
        return M[LEGS[k][4]].translation

    def contact_z(self, M, k) -> float:
        """蹄底最低点的高度（静止 = 0，负 = 穿地）"""
        m = M[LEGS[k][4]]
        return min((m @ c).z for c in self.contact[k])

    def solve(self, p: dict, plant, reach=None):
        """踩地。钉腿的姿势：按「锚定腿」（有后腿钉着就用两条后腿，否则用钉着的腿）的髋 / 肩关节放身体——关节回到静止位置再加 lift / fwd，
        身体怎么俯仰都等于绕髋关节转；然后两骨 IK 把钉着的蹄子拉回静止位置（腿自己屈膝）。奔跑（low）：最低的蹄子贴地。
        最后整身侧倾、按支撑的蹄子再贴一次地。返回 (改过腿角的参数, 侧倾前的平移, 侧倾后的平移)"""
        q = dict(p)
        legs = plant_legs(plant)
        if plant == "mesh":
            d = Vector((0.0, p["fwd"], 0.0))
            M = self.fk(q, d)
            zmin = self.mesh_min(M, q["fan"])
            return q, d, Vector((0.0, 0.0, -zmin + p["lift"]))
        M = self.fk(q)
        support = legs if legs else (("fl", "fr", "hl", "hr") if plant == "low" else ())
        if legs:
            anchor = [k for k in ("hl", "hr") if k in legs] or list(legs)
            off = sum((self.rest[LEGS[k][1]].translation - M[LEGS[k][1]].translation for k in anchor), Vector()) / len(anchor)
            d = Vector((0.0, off.y + p["fwd"], off.z + p["lift"]))
        elif support:
            dz = max(-self.contact_z(M, k) for k in support)
            d = Vector((0.0, p["fwd"], dz + p["lift"]))
        else:
            d = Vector((0.0, p["fwd"], p["lift"]))
        for _ in range(3 if legs else 0):
            M = self.fk(q, d)
            for k in legs:
                self.ik(M, q, k, self.target(k, reach))
        d2 = Vector((0.0, 0.0, 0.0))
        if abs(p["roll"]) > 1e-6 and support:
            M = self.fk(q, d)
            d2.z = max(-self.contact_z(M, k) for k in support)
        return q, d, d2

    def target(self, k, reach) -> Vector:
        """钉住的蹄子要落的位置：静止位置 + reach（前后 / 上下偏移，米；刨冰往后扫、刹步前蹄撑到前面）"""
        dy, dz = (reach or {}).get(k, (0.0, 0.0))
        return self.rest_hoof[k] + Vector((0.0, dy, dz))

    def ik(self, M, q, k, target):
        """两骨 IK（矢状面 YZ）：上段 / 下段转到让掌骨头落到「蹄回静止位置」需要的地方，掌骨和蹄保持绝对角"""
        ch = LEGS[k]
        A, B, C, D = (M[ch[i]].translation.copy() for i in (1, 2, 3, 4))
        Ct = C + (target - D)
        L1 = math.hypot(B.y - A.y, B.z - A.z)
        L2 = math.hypot(C.y - B.y, C.z - B.z)
        ty, tz = Ct.y - A.y, Ct.z - A.z
        dist = min(max(math.hypot(ty, tz), abs(L1 - L2) + 1e-4), (L1 + L2) * 0.9999)
        phi_t = math.atan2(tz, ty)
        alpha = math.acos(max(-1.0, min(1.0, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))))
        side = self.bend[k]     # 一律按解剖方向弯（肘往后、膝往前），不跟着提示角反折
        best = None
        for phi in (phi_t + alpha, phi_t - alpha):
            Bn = Vector((0.0, A.y + L1 * math.cos(phi), A.z + L1 * math.sin(phi)))
            s = _cross2(Vector((0.0, ty, tz)), Bn - Vector((0.0, A.y, A.z)))
            if best is None or (s >= 0) == (side >= 0):
                best = (phi, Bn)
                if (s >= 0) == (side >= 0):
                    break
        phi_up, Bn = best
        d1 = _wrap(phi_up - math.atan2(B.z - A.z, B.y - A.y))
        phi_lo = math.atan2(C.z - B.z, C.y - B.y) + d1
        d2 = _wrap(math.atan2(Ct.z - Bn.z, Ct.y - Bn.y) - phi_lo)
        a = list(q[k])
        a[0] += math.degrees(d1)
        a[1] += math.degrees(d1 + d2)
        q[k] = tuple(a)

    def pose(self, p: dict):
        """第 f 帧的最终骨骼矩阵（踩地方式在两个关键帧之间变化时，两种解法按权重混合）"""
        qa, da, ea = self.solve(p, p["plantA"], p["reachA"])
        if (p["plantB"], p["reachB"]) == (p["plantA"], p["reachA"]) or p["t"] <= 0.0:
            q, d, e = qa, da, ea
        else:
            qb, db, eb = self.solve(p, p["plantB"], p["reachB"])
            t = p["t"]
            q = dict(qa)
            for k in ("fl", "fr", "hl", "hr"):
                q[k] = tuple(x + (y - x) * t for x, y in zip(qa[k], qb[k]))
            d, e = da.lerp(db, t), ea.lerp(eb, t)
        M = self.fk(q, d, e)
        # 地面：没钉住的蹄子（抬腿、落地、奔跑、腾空）蹄底低于地面时，两骨 IK 把它抬到正好贴地（不穿地）；侧倒按网格贴地，不管
        if not (p["plantA"] == "mesh" and p["plantB"] == "mesh"):
            pinned = set(plant_legs(p["plantA"])) & set(plant_legs(p["plantB"]))
            for _ in range(3):
                low = [(k, self.contact_z(M, k)) for k in LEGS if k not in pinned]
                low = [(k, c) for k, c in low if c < -0.003]
                if not low:
                    break
                for k, c in low:
                    self.ik(M, q, k, self.hoof(M, k) + Vector((0.0, 0.0, -c)))
                M = self.fk(q, d, e)
        return M, q

    def bases(self, M, fan=1.0) -> dict:
        """骨架空间矩阵 → 每根骨的局部变换（Blender pose basis）"""
        out = {}
        for n in self.names:
            pr = self.parent[n]
            out[n] = self.rel_inv[n] @ (M[pr].inverted() @ M[n] if pr else M[n])
        if abs(fan - 1.0) > 1e-4:
            out["tail_7"] = out["tail_7"] @ Matrix.Diagonal((fan, 1.0 + (fan - 1.0) * 0.25, fan, 1.0))
        return out

    def apply_pose(self, M, fan=1.0):
        for n, B in self.bases(M, fan).items():
            loc, rq, sc = B.decompose()
            pb = self.arm.pose.bones[n]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = rq
            pb.location = loc if n == "hips" else (0, 0, 0)
            pb.scale = sc if n == "tail_7" else (1, 1, 1)
        bpy.context.view_layer.update()

    # ── 网格（侧倒贴地、体检）──
    def mesh_coords(self):
        import numpy as np
        dg = bpy.context.evaluated_depsgraph_get()
        me = self.mesh.evaluated_get(dg).data
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        return co.reshape(-1, 3)

    def mesh_min(self, M, fan=1.0) -> float:
        self.apply_pose(M, fan)
        return float(self.mesh_coords()[:, 2].min())


def _cross2(u: Vector, v: Vector) -> float:
    return u.y * v.z - u.z * v.y


def _wrap(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi


# ═════════════ 关键姿势 ═════════════
BASE = P()

# ── 人立：蹲坐（反向预备）→ 扳起（三种幅度）→ 顶点前蹄交替蹬空 → 前身压下 → 前蹄踏地 ──
HIND_SIT = (-34, 28, -26, None)          # 人立时后腿：膝往前、跗关节屈（IK 只当弯向提示，蹄子钉死）
FOLD_A = (-38, -104, 10, 34)             # 前腿收起：前臂水平往前、掌骨垂下
FOLD_B = (-30, -92, 24, 44)
KICK_A = (-70, -128, -60, -30)           # 蹬空：前臂、掌骨往前上伸
KICK_B = (-58, -118, -40, -14)


def squat(tail_yaw=-3.6, sink=0.3) -> dict:
    """人立前的蹲坐：后腿屈、hips 沉、头低、尾巴往右收"""
    return P(pitch=-4, spine=2, neck=10, head=20, fl=(-6, 6, -4), hl=(-24, 34, -16), lift=-sink, fwd=0.1,
             tail=(-8, -4, -2), tail_yaw=(tail_yaw, tail_yaw, tail_yaw), fan=0.95, plant="all")


def rear(deg, neck_abs, head, fl=FOLD_A, fr=FOLD_B, tail=(6, 12, 10), tail_yaw=(0, 0, 0), fan=1.3, sink=0.4, back=0.3, chest=-4,
         head_yaw=0.0) -> dict:
    """人立：前身扳起 deg°（后蹄钉死、重心压到后蹄上方），颈的绝对俯仰 neck_abs（负 = 往后仰），头的绝对俯仰 head（负 = 仰）"""
    spine = -3
    neck = neck_abs - (-deg + spine + chest)
    return P(pitch=-deg, spine=spine, chest=chest, neck=neck, head=head, head_yaw=head_yaw, fl=fl, fr=fr, hl=HIND_SIT,
             tail=tail, tail_yaw=tail_yaw, fan=fan, lift=-sink, fwd=back, plant="hind")


# 扳起（蹲坐和人立之间：前蹄离地、前腿开始收）
RISE = P(pitch=-28, chest=-2, neck=20, head=-6, fl=(-40, -62, 22, 32), fr=(-30, -44, 12, 24), hl=(-28, 30, -18), tail=(4, 8, 6), fan=1.15,
         lift=-0.33, fwd=0.15, plant="hind")

# 狂风：人立 60°，前蹄踏地时颈前伸、尾羽扇往前一甩
GUST_REAR = rear(60, -6, -34)
GUST_KICK1 = rear(62, -10, -38, fl=KICK_A, fr=FOLD_B, tail=(8, 13, 12))
GUST_KICK2 = rear(63, -10, -40, fl=FOLD_A, fr=KICK_B, tail=(8, 13, 12))
GUST_SMEAR = P(pitch=-24, chest=2, neck=14, head=-4, fl=(-46, -60, -30, -10), hl=(-26, 30, -16), tail=(10, 12, 8), fan=1.25,
               lift=-0.3, fwd=0.15, plant="hind")
GUST_STAMP = P(pitch=6, spine=2, chest=4, neck=26, head=8, fl=(-18, -10, 6), hl=(-16, 22, -10), tail=(-14, -8, -6), tail_yaw=(0, 0, 0),
               fan=1.3, lift=-0.12, plant="all", lag=3)
GUST_STAMP_HOLD = mod(GUST_STAMP, pitch=7, neck=30, head=10, lift=-0.16, tail=(-16, -10, -8))
GUST_PUSH_A = mod(GUST_STAMP, pitch=5, neck=28, head=9, lift=-0.13, tail=(-12, -6, -4), tail_yaw=(1.5, 2.5, 3), fan=1.25)
GUST_PUSH_B = mod(GUST_STAMP, pitch=5, neck=28, head=10, lift=-0.13, tail=(-12, -6, -4), tail_yaw=(-1.5, -2.5, -3), fan=1.3)
LOW_HEAD = P(pitch=4, neck=24, head=38, fl=(-8, 2, -2), hl=(-10, 14, -6), tail=(-6, -2, 0), lift=-0.06, plant="all")

# 龙卷：人立 70° + 仰头长嘶（颈后仰 40°）
TOR_REAR = rear(70, -36, -56, tail=(6, 11, 11), tail_yaw=(-1, -2, -3), fan=1.35)
TOR_HOLD = rear(71, -40, -62, fl=KICK_B, fr=FOLD_A, tail=(7, 12, 12), tail_yaw=(-2, -3, -4), fan=1.35)
TOR_SMEAR = mod(GUST_SMEAR, head=-10)
TOR_STAMP = mod(GUST_STAMP, neck=18, head=-6, tail=(-6, -2, 0), fan=1.25)

# 风雷爆：人立 75°、双前蹄每 0.4 s 一起蹬空；顶点全身绷直；前蹄砸下（squash：前身压到最低、颈下压、尾羽扇往上炸开）
SB_REAR = rear(75, -24, -50, tail=(5, 10, 11), tail_yaw=(-1, -2, -3), fan=1.3)
SB_KICK = rear(76, -30, -56, fl=KICK_A, fr=KICK_A, tail=(6, 11, 13), tail_yaw=(-2, -3, -4), fan=1.35)
SB_TUCK = rear(74, -22, -48, fl=FOLD_A, fr=FOLD_A, tail=(5, 10, 11), tail_yaw=(-1, -2, -3), fan=1.3)
SB_TAUT = rear(78, -34, -62, fl=(-74, -132, -76, -40), fr=(-74, -132, -76, -40), tail=(6, 10, 15), tail_yaw=(-2, -4, -5), fan=1.4, sink=0.3, back=0.34)
SB_TAUT2 = rear(79, -36, -64, fl=(-76, -134, -80, -42), fr=(-76, -134, -80, -42), tail=(6, 11, 16), tail_yaw=(-2, -4, -6), fan=1.42, sink=0.3, back=0.34)
SB_SMEAR = P(pitch=-30, chest=2, neck=10, head=-10, fl=(-50, -70, -40, -20), hl=(-28, 32, -18), tail=(12, 16, 12), fan=1.3,
             lift=-0.32, fwd=0.18, plant="hind")
SB_SLAM = P(pitch=10, spine=4, chest=6, neck=36, head=40, fl=(-22, -14, 14), hl=(-22, 34, -18), tail=(26, 22, 18), fan=1.45,
            lift=-0.3, plant="all", lag=2)
SB_SLAM_HOLD = mod(SB_SLAM, pitch=11, neck=38, head=44, lift=-0.33, tail=(28, 24, 20), fan=1.5)
PANT_IN = P(pitch=6, spine=4, neck=30, head=44, fl=(-10, 4, -2), hl=(-14, 20, -10), tail=(-8, -4, -2), lift=-0.1, plant="all")
PANT_OUT = mod(PANT_IN, pitch=8, spine=6, neck=34, head=50, lift=-0.14, tail=(-10, -5, -3))

# 长嘶（登场特写、三阶段转阶段）：人立约 70°、前蹄交替蹬空、颈后仰、头仰起、尾羽扇高翘
ROAR_REAR = rear(70, -22, -50, fl=FOLD_A, fr=FOLD_B, tail=(7, 12, 12), fan=1.35)
ROAR_A = rear(71, -28, -56, fl=KICK_A, fr=FOLD_B, tail=(8, 12, 13), tail_yaw=(1.5, 2.5, 3), fan=1.38)
ROAR_B = rear(72, -30, -60, fl=FOLD_A, fr=KICK_B, tail=(8, 12, 13), tail_yaw=(-1.5, -2.5, -3), fan=1.38)
ROAR_LAND = P(pitch=4, chest=3, neck=18, head=-2, fl=(-14, -6, 4), hl=(-14, 20, -10), tail=(-6, -2, 2), fan=1.2, lift=-0.1, plant="all")

# ── 低头冲撞：后坐（反向预备、头抬、角往后仰）→ 低头（颈下压 45°、角朝前、珠降到 3 m）→ 右前蹄刨冰两下 → 后腿压低蓄力 → 蹬出 ──
WEIGHT_BACK = P(pitch=-6, neck=-8, head=-20, fl=(-6, 4, -2), hl=(-16, 24, -12), tail=(6, 2, 0), lift=-0.14, fwd=0.06, plant="all")
CH_LOW = P(pitch=8, chest=4, neck=45, head=82, fl=(-10, 0, -2), hl=(-12, 16, -8), tail=(4, 2, 0), lift=-0.05, plant="all")
PAW_UP = mod(CH_LOW, fr=(-34, -58, 40, 30), plant="hind+fl")
PAW_SCRAPE = mod(CH_LOW, fr=(16, 10, 20, 15), plant="all", reach={"fr": (0.45, 0.05)})   # 蹄尖贴着冰面往后扫
CH_LOAD = P(pitch=10, chest=5, neck=46, head=84, fl=(-14, -4, 0), hl=(-30, 46, -24), tail=(-2, -2, -2), tail_yaw=(0, 0, 0), fan=0.9,
            lift=-0.2, plant="all", lag=1.5)
CH_LOAD2 = mod(CH_LOAD, pitch=11, lift=-0.23, tail=(-3, -3, -3))
CH_PUSH = P(pitch=4, spine=-3, chest=-2, neck=40, head=74, fl=(-60, -70, -46), hl=(34, 30, 40), tail=(-8, -8, -6), fan=0.9,
            lift=0.05, plant=None, lag=2)
CH_BRAKE = P(pitch=-8, chest=-2, neck=20, head=36, fl=(-20, -24, -4), hl=(-6, 22, -8), tail=(10, 6, 4), tail_yaw=(0, 0, 0),
             lift=-0.15, plant="all", reach={"fl": (-0.3, 0.0), "fr": (-0.3, 0.0)}, lag=4)   # 前蹄撑到前面刹住
CH_PANT_IN = mod(PANT_IN, neck=36, head=60, lag=3)
CH_PANT_OUT = mod(PANT_OUT, neck=40, head=66, lag=3)

# 奔跑（冲撞 / 回旋的持续段，原地跑，前倾 8°；16 帧一步）：每条腿 (上段, 下段, 掌骨, 蹄) 的相位样本
GALLOP_PERIOD = 16
RUN_FRONT = [(0.00, (-30, -34, -30, -18)), (0.18, (-2, -6, -6, 0)), (0.36, (32, 26, 22, 34)), (0.52, (12, -14, 84, 64)),
             (0.72, (-46, -76, 26, 30)), (0.88, (-42, -50, -40, -26))]
RUN_HIND = [(0.00, (-30, -8, -32, -20)), (0.18, (-6, 12, -6, 0)), (0.38, (32, 36, 42, 52)), (0.54, (6, 58, -18, 12)),
            (0.76, (-42, 22, -50, -30)), (0.92, (-40, -4, -42, -30))]
RUN_PHASE = {"hl": 0.0, "hr": 0.08, "fl": 0.44, "fr": 0.54}


def _lerp_cyc(samples, u):
    u %= 1.0
    n = len(samples)
    for i in range(n):
        p0, v0 = samples[i]
        p1, v1 = samples[(i + 1) % n]
        span = (p1 - p0) % 1.0 or 1.0
        dd = (u - p0) % 1.0
        if dd <= span + 1e-9:
            t = 0.5 - 0.5 * math.cos(math.pi * dd / span)
            return tuple(a + (b - a) * t for a, b in zip(v0, v1))
    return samples[0][1]


def run_pose(phi, lean=0.0, look=0.0, low=1.0) -> dict:
    """奔跑第 phi 相位：后蹄蹬 → 前身扬起、前蹄着地 → 前身一沉；颈、头、尾按相位滞后跟随。lean = 往弧心倾（回旋），look = 头往弧心转"""
    s = lambda lag: math.sin(2 * math.pi * (phi - lag))
    legs = {k: _lerp_cyc(RUN_FRONT if k[0] == "f" else RUN_HIND, phi - off) for k, off in RUN_PHASE.items()}
    return P(pitch=8 + 4 * s(0.3), spine=3 * s(0.1), chest=2 * s(0.15), neck=30 * low + 6 * s(0.4), head=56 * low + 3 * s(0.5),
             chest_yaw=0.3 * look, neck_yaw=0.6 * look + 2 * s(0.2), head_yaw=0.8 * look, roll=lean + 1.5 * s(0.25),
             fl=legs["fl"], fr=legs["fr"], hl=legs["hl"], hr=legs["hr"],
             tail=(-6 + 3 * s(0.3), -4 + 4 * s(0.45), -2 + 5 * s(0.6)), tail_yaw=(3 * s(0.2) - 0.1 * lean, 5 * s(0.35) - 0.2 * lean, 7 * s(0.5)),
             fan=0.92, lift=0.06 * max(0.0, s(0.62)), plant="low", lag=3)


# ── 风刃：尾羽往左收到底（胸往右拧、头往左看）→ 3 帧甩到右边 → 过冲 → 回 ──
BL_WIND = P(chest_yaw=-12, neck_yaw=6, head_yaw=18, neck=4, head=6, hl=(-6, 10, -4), tail=(4, 6, 6), tail_yaw=(10, 10, 10), fan=1.25,
            lift=-0.06, plant="all", lag=1)
BL_WIND2 = mod(BL_WIND, chest_yaw=-13, head_yaw=20, tail=(5, 7, 7), tail_yaw=(10.5, 10.5, 10.5))
BL_WHIP = P(chest_yaw=8, neck_yaw=-4, head_yaw=-6, neck=6, head=8, hl=(-6, 10, -4), tail=(-2, 2, 2), tail_yaw=(-7, -7.5, -7),
            fan=1.3, lift=-0.04, plant="all", lag=1)
BL_OVER = mod(BL_WHIP, chest_yaw=10, head_yaw=-8, tail=(-3, 0, 0), tail_yaw=(-8, -9, -9.5), lag=2)
BL_BACK = P(chest_yaw=-2, head_yaw=2, tail=(0, 0, 0), tail_yaw=(1, 1.5, 2), fan=1.05, plant="all", lag=3.5)

# ── 侧跃（按往生物的右跳：先往左压 → 蹬地 → 四腿收拢腾空、身子往外倾 → 落地缓冲）──
SS_PRESS = P(roll=8, pitch=-2, neck=8, head=12, neck_yaw=-6, head_yaw=-10, fl=(-6, 10, -6), hl=(-22, 34, -18), lift=-0.28,
             tail=(-6, -2, 0), tail_yaw=(3, 3, 3), plant="all", lag=2)
SS_PUSH = P(roll=-10, pitch=-6, neck=4, head=2, neck_yaw=-8, head_yaw=-12, fl=(-20, -24, -10), hl=(22, 22, 30), spread=(6, 6),
            tail=(6, 4, 2), tail_yaw=(4, 4, 4), lift=0.25, plant=None, lag=2)
SS_TUCK = P(roll=-16, pitch=-2, spine=4, chest=3, neck=10, head=18, neck_yaw=-6, head_yaw=-10, fl=(-58, -96, 70, 40),
            hl=(-50, 58, -26), spread=(10, 8), tail=(12, 10, 8), tail_yaw=(5, 6, 7), fan=1.15, lift=1.0, plant=None, lag=3)
SS_TUCK2 = mod(SS_TUCK, roll=-14, lift=0.9, fl=(-60, -98, 74, 42), hl=(-52, 60, -28))
SS_REACH = P(roll=-8, pitch=2, neck=8, head=14, neck_yaw=-4, head_yaw=-6, fl=(-26, -30, -20), hl=(-18, 20, -12), spread=(5, 4),
             tail=(8, 6, 4), tail_yaw=(3, 4, 5), lift=0.45, plant=None, lag=3)
SS_LAND = P(roll=-4, pitch=4, neck=14, head=22, fl=(-10, 8, -4), hl=(-24, 36, -18), lift=-0.3, tail=(-8, -4, 0), tail_yaw=(-2, -3, -4),
            plant="all", lag=3)

# ── 侧倒（珠碎 / 撞晕）：一撞 → 四腿一软、整身绕前后轴滚 75° 倒向右侧（四腿往外伸、颈垂）→ 四腿交替蹬 → 前腿撑起、爬起 ──
DOWN_HIT = P(roll_z=2.0, pitch=-6, neck=-10, head=-18, neck_yaw=-8, head_yaw=-14, fl=(-8, 6, -6), hl=(-16, 26, -14), lift=-0.12,
             tail=(10, 6, 4), tail_yaw=(-4, -4, -4), plant="all", lag=2)
DOWN_BUCKLE = P(roll=-30, roll_z=2.0, splay=10, pitch=2, neck=6, head=14, neck_yaw=8, head_yaw=10, fl=(-4, -12, 40, 30), hl=(-30, 50, -30),
                tail=(4, 2, 0), plant="mesh", lag=2)
_DOWN = dict(roll=-75, roll_z=2.0, splay=22, pitch=4, spine=3, chest=2, neck=20, head=36, neck_yaw=-24, head_yaw=-18,
             tail=(-4, -2, 0), tail_yaw=(2, 3, 4), plant="mesh", lag=3)
DOWN_FLAT = P(**_DOWN, fl=(-36, -40, -10), fr=(-26, -30, 0), hl=(24, 20, 30), hr=(30, 24, 38))
DOWN_BOUNCE = P(**dict(_DOWN, lift=0.06, neck_yaw=-20), fl=(-34, -38, -8), fr=(-24, -28, 2), hl=(22, 18, 28), hr=(28, 22, 36))
DOWN_KICK_A = P(**_DOWN, fl=(-58, -62, -40), fr=(-12, -4, 30), hl=(42, 40, 52), hr=(8, 30, 6))
DOWN_KICK_B = P(**dict(_DOWN, neck_yaw=-26, head=40), fl=(-14, -6, 26), fr=(-56, -60, -38), hl=(6, 28, 4), hr=(44, 42, 54))
DOWN_LIFT = P(**dict(_DOWN, neck_yaw=-12, head=24, neck=14), fl=(-30, -34, -6), fr=(-22, -26, 4), hl=(20, 16, 26), hr=(26, 20, 34))
DOWN_PUSH = P(roll=-34, roll_z=2.0, splay=8, pitch=-6, neck=10, head=10, neck_yaw=-6, head_yaw=-6, fl=(-26, -12, 6), fr=(-30, -16, 4),
              hl=(-30, 54, -30), tail=(2, 2, 2), plant="mesh", lag=3)
DOWN_RISE = P(roll=-8, roll_z=2.0, pitch=-4, neck=8, head=10, fl=(-12, -2, 0), hl=(-20, 30, -14), lift=-0.2, tail=(4, 2, 0), plant="all", lag=3)

# ── 待机（72 帧循环）：呼吸、头慢慢环视、尾羽扇随风摆 ──
IDLE_FRAMES = 72


def idle_pose(phi) -> dict:
    s = lambda k, lag=0.0: math.sin(2 * math.pi * (k * phi - lag))
    return P(spine=0.5 * s(2), chest=-0.8 * s(2, 0.05), neck=2 * s(1, 0.2) + 0.8 * s(2, 0.15),
             head=2 * s(1, 0.3) - 1 * s(2, 0.2), neck_yaw=3 * s(1), head_yaw=5 * s(1, 0.06), chest_yaw=0.8 * s(1, -0.05),
             fl=(0.6 * s(2), 0, 0), hl=(-1.0 * s(2, 0.1), 1.6 * s(2, 0.1), -0.8 * s(2, 0.1)),
             tail=(1.5 * s(2, 0.3), 2 * s(2, 0.4), 2.5 * s(2, 0.5)), tail_yaw=(2.5 * s(1, 0.1), 3.5 * s(1, 0.2), 4.5 * s(1, 0.3)),
             fan=1.0 + 0.05 * s(3, 0.2), plant="all", lag=4)


# ═════════════ 片段 ═════════════
def roar_clip() -> dict:
    """长嘶（0.5 + 1.5 + 0.5 s = 75 帧）：蹲 → f15 人立 70° → f15–f54 前蹄交替蹬空、仰头嘶鸣 → f62 前蹄落地 → f75 底姿"""
    keys = [(0, BASE), (6, squat(sink=0.25)), (10, RISE), (15, ROAR_REAR)]
    f, k = 20, 0
    while f <= 52:
        keys.append((f, ROAR_A if k % 2 == 0 else ROAR_B))
        f, k = f + 8, k + 1
    keys += [(57, ROAR_REAR), (60, GUST_SMEAR, "in"), (63, ROAR_LAND), (68, mod(ROAR_LAND, pitch=2, lift=-0.04)), (75, BASE)]
    return {"frames": 75, "keys": keys, "events": [], "review": [6, 15, 20, 28, 44, 60, 63, 75]}


def gust_clip() -> dict:
    """蓄风狂风（1.0 + 0.6 + 0.8 s = 72 帧）：f7 蹲坐 → f20 人立 60° → f22–f28 前蹄交替蹬空 2 次（glint f22.5）→ f30 前蹄踏地（hit）→
    f30–f48 颈前伸 hold、尾羽扇抖 → f54 低头 → f72 底姿"""
    keys = [(0, BASE), (7, squat()), (13, RISE), (20, GUST_REAR), (23, GUST_KICK1), (26, GUST_KICK2), (28, GUST_REAR, "in"), (30, GUST_STAMP),
            (32, GUST_STAMP_HOLD), (37, GUST_PUSH_A), (42, GUST_PUSH_B), (48, GUST_STAMP_HOLD), (54, LOW_HEAD), (66, mod(LOW_HEAD, neck=6, head=8,
                                                                                                                       lift=-0.02)),
            (72, BASE)]
    return {"frames": 72, "keys": keys, "events": [(22.5, "glint"), (30, "hit")], "review": [7, 20, 23, 26, 30, 42, 54, 72]}


def tornado_clip() -> dict:
    """龙卷风柱（1.0 + 0.2 + 0.6 s = 54 帧）：f9 蹲坐 → f22 人立 70° + 仰头长嘶 → f30 前蹄踏下（release）→ f36 → f54 底姿"""
    keys = [(0, BASE), (9, squat()), (15, RISE), (22, TOR_REAR), (25, TOR_HOLD), (27, TOR_REAR, "in"), (30, TOR_STAMP), (33, mod(TOR_STAMP, lift=-0.16)),
            (40, LOW_HEAD), (48, mod(LOW_HEAD, neck=6, head=8, lift=-0.02)), (54, BASE)]
    return {"frames": 54, "keys": keys, "events": [(30, "release")], "review": [9, 22, 25, 28, 30, 40, 54]}


def stormburst_clip() -> dict:
    """风雷爆（4.0 + 0.3 + 1.5 s = 174 帧）：f12 蹲坐 → f24 人立 75° → 双前蹄每 12 帧一起蹬空 → f108–f118 绷直（glint f112.5）→
    f120 前蹄砸下（hit，squash）→ f130 → f174 低头喘"""
    keys = [(0, BASE), (12, squat(sink=0.34)), (18, RISE), (24, SB_REAR)]
    f = 30
    while f <= 102:
        keys += [(f, SB_KICK), (f + 6, SB_TUCK)]
        f += 12
    keys = [k for k in keys if k[0] < 106]
    keys += [(108, SB_TAUT), (116, SB_TAUT2, "in"), (120, SB_SLAM), (123, SB_SLAM_HOLD), (130, mod(SB_SLAM, lift=-0.22, fan=1.3)),
             (138, PANT_IN), (146, PANT_OUT), (154, PANT_IN), (162, PANT_OUT), (174, BASE)]
    return {"frames": 174, "keys": keys, "events": [(112.5, "glint"), (120, "hit")], "review": [12, 24, 30, 36, 108, 118, 120, 123, 146, 174]}


def charge_clip(frames: int, run_end: int, lean: float = 0.0, look: float = 0.0) -> dict:
    """低头冲撞（96 帧）/ 回旋冲撞（126 帧）：f6 后坐 → f12 低头 → f14 / f19 右前蹄刨冰 → f21–f24 蓄力 → f24 蹬出（hit）→ 原地奔跑 → 收步低头喘"""
    keys = [(0, BASE), (6, WEIGHT_BACK), (12, mod(CH_LOW, fr=(-20, -30, 20, 10), plant="hind+fl")), (14, PAW_SCRAPE), (16.5, PAW_UP),
            (19, PAW_SCRAPE), (21, CH_LOAD), (23, CH_LOAD2, "in"), (24, CH_PUSH)]
    # 奔跑：蹬出后 2 帧进入步态，回旋在 6 帧内倾到 lean
    f = 26
    while f <= run_end:
        ramp = min(1.0, (f - 24) / 8.0)
        keys.append((f, run_pose((f - 26) / GALLOP_PERIOD + 0.42, lean=lean * ramp, look=look * ramp)))
        f += 2
    end = keys[-1][0]
    keys += [(end + 6, CH_BRAKE), (end + 12, CH_PANT_IN), (end + 19, CH_PANT_OUT), (end + 26, CH_PANT_IN)]
    keys = [k for k in keys if k[0] < frames - 6]
    keys.append((frames, BASE))
    rev = [6, 12, 14, 19, 23, 24, 30, 34, end + 6, end + 19]
    return {"frames": frames, "keys": keys, "events": [(16.5, "glint"), (24, "hit"), (14, "fx:fPaw"), (19, "fx:fPaw")], "review": rev}


def blades_clip() -> dict:
    """风刃（0.6 + 0.1 + 0.6 s = 39 帧）：f15 尾羽往左收到底 → f18 3 帧甩到右边（release）→ f22 过冲 → f30 回 → f39 底姿（尾巴滞后 3 帧）"""
    keys = [(0, BASE), (11, BL_WIND), (15, BL_WIND2, "in"), (18, BL_WHIP), (22, BL_OVER), (30, BL_BACK), (39, BASE)]
    return {"frames": 39, "keys": keys, "events": [(18, "release")], "review": [11, 15, 16, 18, 22, 30, 39]}


def sidestep_clip() -> dict:
    """侧跃（0.1 + 0.6 + 0.2 s = 27 帧）：f3 往一侧压 → f6 蹬地 → f9–f21 四腿收拢腾空、身子往外倾 → f24 落地缓冲 → f27"""
    keys = [(0, BASE), (3, SS_PRESS), (6, SS_PUSH), (10, SS_TUCK), (17, SS_TUCK2), (21, SS_REACH), (24, SS_LAND), (27, BASE)]
    return {"frames": 27, "keys": keys, "events": [(6, "fx:fLeap"), (24, "fx:fLand")], "review": [3, 6, 10, 17, 21, 24, 27]}


def down_clip() -> dict:
    """侧倒（0.4 + 3.2 + 0.4 s = 120 帧）：f3 一撞 → f12 侧倒（滚 75°、四腿外伸、颈垂）→ f12–f108 四腿交替蹬（每 0.45 s）→ f120 爬起"""
    keys = [(0, BASE), (3, DOWN_HIT), (7, DOWN_BUCKLE, "in"), (12, DOWN_FLAT), (15, DOWN_BOUNCE), (19, DOWN_FLAT)]
    f, k = 26, 0
    while f <= 100:
        keys.append((int(round(f)), DOWN_KICK_A if k % 2 == 0 else DOWN_KICK_B))
        f, k = f + 13.5, k + 1
    keys += [(104, DOWN_LIFT), (110, DOWN_PUSH), (115, DOWN_RISE), (120, BASE)]
    return {"frames": 120, "keys": keys, "events": [(12, "fx:fFall")], "review": [3, 7, 12, 26, 40, 104, 110, 115, 120]}


def idle_clip() -> dict:
    keys = [(f, idle_pose(f / IDLE_FRAMES)) for f in range(0, IDLE_FRAMES + 1, 3)]
    return {"frames": IDLE_FRAMES, "keys": keys, "loop": True, "events": [], "review": [0, 18, 36, 54]}


CLIPS = {
    "roar": roar_clip(),
    "sidestep": sidestep_clip(),
    "wheel": charge_clip(126, 88, lean=18.0, look=14.0),
    "down": down_clip(),
    "gust": gust_clip(),
    "charge": charge_clip(96, 64),
    "tornado": tornado_clip(),
    "stormburst": stormburst_clip(),
    "blades": blades_clip(),
    "Idle": idle_clip(),
}


# ═════════════ Blender ═════════════
def load_rig():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = None
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if o.parent != arm:
            bpy.data.objects.remove(o)
        else:
            mesh = o
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm, mesh


def set_deform(rig, on: bool):
    for m in rig.mesh.modifiers:
        if m.type == "ARMATURE":
            m.show_viewport = m.show_render = on


def solve_clip(rig, clip: dict) -> list:
    """逐帧求解：[(骨架空间矩阵, 求解后的参数, 原始参数)]，0..frames 共 frames+1 帧"""
    tr = Track(clip)
    out = []
    for f in range(clip["frames"] + 1):
        p = tr.frame(f)
        M, q = rig.pose(p)
        out.append((M, q, p))
    return out


def fcurves(act) -> list:
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


KEYED = ["hips", "spine", "chest", "neck", "head"] + [b for ch in LEGS.values() for b in ch] + TAILS


def bake_clip(rig, name: str, frames: list):
    arm = rig.arm
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    series = {b: {"rotation_quaternion": [], "location": [], "scale": []} for b in KEYED}
    prev = {}
    for M, q, p in frames:
        B = rig.bases(M, p["fan"])
        for b in KEYED:
            loc, rq, sc = B[b].decompose()
            if b in prev and rq.dot(prev[b]) < 0:   # 四元数连续性：别绕远路
                rq.negate()
            prev[b] = rq
            series[b]["rotation_quaternion"].append(tuple(rq))
            series[b]["location"].append(tuple(loc) if b == "hips" else (0.0, 0.0, 0.0))
            series[b]["scale"].append(tuple(sc) if b == "tail_7" else (1.0, 1.0, 1.0))
    for b in KEYED:
        for prop, n in (("rotation_quaternion", 4), ("location", 3), ("scale", 3)):
            if prop == "location" and b != "hips" or prop == "scale" and b != "tail_7":
                continue
            path = f'pose.bones["{b}"].{prop}'
            vals = series[b][prop]
            for i in range(n):
                fc = act.fcurve_ensure_for_datablock(arm, path, index=i, group_name=b)
                fc.keyframe_points.add(len(vals))
                co = []
                for f, v in enumerate(vals):
                    co += [float(f), v[i]]
                fc.keyframe_points.foreach_set("co", co)
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"
                fc.update()
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
    """只改这里手 K 的状态，其余条目（about、别的状态）原样保留；排版同现有文件（json 缩进 2）"""
    doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"about": "", "clips": {}}
    clips = doc.setdefault("clips", {})
    for name, c in CLIPS.items():
        evs = sorted(c["events"], key=lambda e: e[0])
        if not evs and name not in clips:
            continue
        clips[name] = [{"at": round(min(1.0, f / c["frames"]), 4), "name": n} for f, n in evs]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(doc, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))   # 写成 LF（Windows 上 write_text 会写成 CRLF）


# ═════════════ 体检 ═════════════
def joint_angles(rig, M) -> dict:
    """矢状面关节弯角（子骨方向角 - 父骨方向角，度；方向角 = 在跟着身体转的参照系里从竖直往下量、往后为正，侧倒时也成立）"""
    body = (M["hips"] @ rig.rest["hips"].inverted()).to_3x3().inverted()

    def ang(b):
        v = body @ M[b].col[1].xyz
        return math.degrees(math.atan2(v.y, -v.z))
    out = {}
    for k, ch in LEGS.items():
        a = [ang(b) for b in ch[1:]]
        out[k] = (a[1] - a[0], a[2] - a[1], a[3] - a[2])
    return out


# 静止姿势的关节角 ± 允许范围（超出 = 反折）：前腿 肘（负 = 屈）/ 腕（正 = 屈）/ 球节；后腿 膝（正 = 屈）/ 跗（负 = 屈）/ 球节
JOINT_RANGE = {"f": ((-150, 18), (-40, 175), (-80, 120)), "h": ((-8, 160), (-175, 8), (-85, 120))}


def check_clip(rig, name, clip, frames, rest_edges, edges, vgroup_bone, hoof_mask, body_mask) -> dict:
    import numpy as np
    rep = {"frames": clip["frames"], "hoof_pen": 0.0, "body_pen": 0.0, "stretch": 1.0, "stretch_at": None, "slide": 0.0,
           "joint": [], "orb_hit": None}
    hit = next((f for f, n in clip["events"] if n in ("hit", "release")), None)
    for f, (M, q, p) in enumerate(frames):
        rig.apply_pose(M, p["fan"])
        co = rig.mesh_coords()
        hz = float(co[hoof_mask, 2].min())
        bz = float(co[body_mask, 2].min())
        if hz < rep["hoof_pen"]:
            rep["hoof_pen"], rep["hoof_pen_f"] = round(hz, 3), f
        if bz < rep["body_pen"]:
            rep["body_pen"], rep["body_pen_f"] = round(bz, 3), f
        if f % 2 == 0:
            ln = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1)
            r = ln / np.maximum(rest_edges, 1e-5)
            j = int(r.argmax())
            if r[j] > rep["stretch"]:
                rep["stretch"], rep["stretch_at"] = round(float(r[j]), 3), [f, vgroup_bone[edges[j, 0]], vgroup_bone[edges[j, 1]]]
            # 拉长超过 1.8 倍、且绝对拉长 > 6 cm 的边（看得见的撕裂）
            torn = int(((r > 1.8) & (ln - rest_edges > 0.06)).sum())
            if torn > rep.get("torn", 0):
                rep["torn"], rep["torn_f"] = torn, f
        # 钉住的蹄子：前后两个关键帧都踩着的腿，逐帧离静止位置多远
        pa, pb = plant_legs(p["plantA"]), plant_legs(p["plantB"])
        for k in set(pa) & set(pb):
            if p["reachA"].get(k) != p["reachB"].get(k):
                continue
            dd = (rig.hoof(M, k) - rig.target(k, p["reachA"]))
            if abs(p["roll"]) < 1e-3:
                dev = math.hypot(dd.y, dd.z)
                if dev > rep["slide"]:
                    rep["slide"], rep["slide_at"] = round(dev, 3), [f, k]
        for k, js in joint_angles(rig, M).items():
            for ji, (v, (lo, hi)) in enumerate(zip(js, JOINT_RANGE[k[0]])):
                if not lo <= v <= hi:
                    rep["joint"].append([f, k, ji, round(v, 1)])
        if hit is not None and f == int(round(hit)):
            rep["orb_hit"] = round(M["orb"].translation.z, 2)
    rep["orb_min"] = round(min(M["orb"].translation.z for M, _, _ in frames), 2)
    rep["joint"] = rep["joint"][:8] + ([f"…共 {len(rep['joint'])} 处"] if len(rep["joint"]) > 8 else [])
    if clip.get("loop"):
        B0 = rig.bases(frames[0][0], frames[0][2]["fan"])
        B1 = rig.bases(frames[-1][0], frames[-1][2]["fan"])
        rep["loop_seam_deg"] = round(max(math.degrees(B0[b].to_quaternion().rotation_difference(B1[b].to_quaternion()).angle) for b in KEYED), 4)
        rep["loop_seam_m"] = round(max((B0[b].translation - B1[b].translation).length for b in KEYED), 5)
    return rep


def mesh_tables(rig):
    """静止网格的边长、每个顶点权重最大的骨（拉伸定位）、蹄 / 身体顶点的掩码"""
    import numpy as np
    me = rig.mesh.data
    names = [g.name for g in rig.mesh.vertex_groups]
    dom = []
    for v in me.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        dom.append(names[best.group] if best else "")
    edges = np.empty(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get("vertices", edges)
    edges = edges.reshape(-1, 2)
    rig.apply_pose(rig.fk(_rest_params()))
    co = rig.mesh_coords()
    rest_edges = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1)
    legs = {b for ch in LEGS.values() for b in ch[1:]}
    hoof_mask = np.array([d in ("fhoof_L", "fhoof_R", "hhoof_L", "hhoof_R", "fcannon_L", "fcannon_R", "hcannon_L", "hcannon_R") for d in dom])
    body_mask = np.array([d not in legs for d in dom])
    # 尾尖（羽扇）缩放是有意的，不算拉伸
    keep = np.array([dom[a] != "tail_7" and dom[b] != "tail_7" for a, b in edges]) & (rest_edges > 0.02)   # 太短的边比值没意义
    return rest_edges[keep], edges[keep], dom, hoof_mask, body_mask


def _rest_params() -> dict:
    p = dict(BASE)
    p["tail_bones"] = [(0.0, 0.0)] * 7
    return p


# ═════════════ 审核联系表 ═════════════
def review(rig, solved: dict, out: Path):
    import numpy as np
    out.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_cavity = True
    T = TILE
    sc.render.resolution_x = sc.render.resolution_y = T
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.16, 0.17, 0.2)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    ORTHO = 8.6
    cam.data.ortho_scale = ORTHO
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.active_object
    gm = bpy.data.materials.new("ground")
    gm.diffuse_color = (0.36, 0.42, 0.5, 1.0)
    ground.data.materials.append(gm)
    # 标签：挂在相机上的文字
    txt = bpy.data.objects.new("label", bpy.data.curves.new("label", "FONT"))
    sc.collection.objects.link(txt)
    txt.data.size = ORTHO * 0.055
    tm = bpy.data.materials.new("label")
    tm.diffuse_color = (1.0, 0.85, 0.3, 1.0)
    txt.data.materials.append(tm)
    txt.parent = cam
    txt.location = (-ORTHO * 0.47, ORTHO * 0.42, -2.0)
    centre = Vector((0, 0.0, 3.4))
    rows = []
    for name, (clip, frames) in solved.items():
        side, q3, fr = [], [], []
        for f in FRAMES or clip.get("review") or [k[0] for k in clip["keys"]]:
            M, q, p = frames[int(f)]
            rig.apply_pose(M, p["fan"])
            views = (("side", 90, 0.06, side), ("q", 35, 0.22, q3), ("front", 0, 0.08, fr))
            for view, yaw, up, lst in [v for v in views if v[0] in VIEWS]:
                a = math.radians(yaw)
                dvec = Vector((math.sin(a), -math.cos(a), up)).normalized()
                cam.location = centre + dvec * 30
                cam.rotation_euler = (-dvec).to_track_quat("-Z", "Y").to_euler()
                txt.data.body = f"{name} f{int(f)}" + {"side": "", "q": " 3/4", "front": " front"}[view]
                bpy.context.view_layer.update()
                pth = out / f"_{name}_{int(f):03d}_{view}.png"
                sc.render.filepath = str(pth)
                bpy.ops.render.render(write_still=True)
                lst.append(pth)
        rows.append((name, side, q3))
        stitch([r for r in (side, q3, fr) if r], out / f"sheet_{name}.jpg", T)
    if FRAMES or VIEWS != ["side", "q"]:
        return
    # 总表：每段两行（侧视 / 3/4 视），宽 ≤ 2400
    cols = max(len(s) for _, s, _ in rows)
    tile = min(T, 2400 // cols)
    grid = []
    for _, s, q3 in rows:
        grid += [s, q3]
    stitch(grid, SHEET, T, scale_to=tile)


def stitch(grid, path: Path, T: int, scale_to: int = None):
    import numpy as np
    tile = scale_to or T
    cols = max(len(r) for r in grid)
    W, H = cols * tile, len(grid) * tile
    canvas = np.full((H, W, 4), 0.08, dtype=np.float32)
    canvas[..., 3] = 1.0
    for r, row in enumerate(grid):
        for c, pth in enumerate(row):
            img = bpy.data.images.load(str(pth))
            if tile != T:
                img.scale(tile, tile)
            px = np.empty(tile * tile * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            y0 = H - (r + 1) * tile
            canvas[y0:y0 + tile, c * tile:(c + 1) * tile] = px.reshape(tile, tile, 4)
            bpy.data.images.remove(img)
    img = bpy.data.images.new(path.stem, W, H, alpha=False)
    img.pixels.foreach_set(canvas.ravel())
    path.parent.mkdir(parents=True, exist_ok=True)
    img.filepath_raw = str(path)
    img.file_format = "JPEG"
    bpy.context.scene.render.image_settings.quality = 88
    img.save()
    bpy.data.images.remove(img)


def main():
    arm, mesh = load_rig()
    rig = Rig(arm, mesh)
    names = [n for n in CLIPS if not ONLY or n in ONLY]
    set_deform(rig, True)
    solved = {}
    for n in names:
        solved[n] = (CLIPS[n], solve_clip(rig, CLIPS[n]))
    if REVIEW:
        if not NOCHECK:
            tables = mesh_tables(rig)
            report = {n: check_clip(rig, n, c, fr, *tables) for n, (c, fr) in solved.items()}
            REVIEW.mkdir(parents=True, exist_ok=True)
            (REVIEW / "check.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
            print("FEILIAN_CHECK " + json.dumps(report, ensure_ascii=False))
        review(rig, solved, REVIEW)
        print("FEILIAN_REVIEW " + str(REVIEW))
        return
    set_deform(rig, False)
    for pb in arm.pose.bones:
        pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)
    # 导出前顶层物体绕 Z 转 180°（同 bl_unity_export：Unity 里角色朝 +Z）；只写在物体上，骨骼的局部动画不受影响
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    # 再放一个顶层空物体：FBX 里只有一个顶层物体时 Unity 会把它折叠成文件根节点，层级就和本体对不上（同 hanba_anims.py）
    keep = bpy.data.objects.new(f"{ASSET}_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report = {}
    for n in names:
        clip, frames = solved[n]
        act = bake_clip(rig, n, frames)
        export_fbx(arm, act, n, clip["frames"], OUT / "Keyframed")
        report[n] = {"frames": clip["frames"], "events": [[f, round(f / clip["frames"], 4), e] for f, e in clip["events"]]}
    if not ONLY:
        write_events(OUT / f"{ASSET}.events.json")
    print("FEILIAN_ANIMS " + json.dumps(report, ensure_ascii=False))


main()
