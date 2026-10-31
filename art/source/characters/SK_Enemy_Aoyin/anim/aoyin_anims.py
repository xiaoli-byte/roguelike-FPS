"""獓狠（SK_Enemy_Aoyin，雷牦同一份）招牌招式的手工关键帧（第四章移植 E 路；设计单 docs/art/vfx/foes-ch4.md 3.1 / 3.3）：
「刨地 → 领群踩踏 stampede」的起步、「雷球砸地 slam」。

    blender -b --factory-startup --python art/source/characters/SK_Enemy_Aoyin/anim/aoyin_anims.py -- [--review <目录>]

产出 unity/Assets/Art/Characters/SK_Enemy_Aoyin/Anim/Keyframed/{stampede,slam}.fbx（同名覆盖采样片段；FBX 不入库）和 events.json 里这两项的事件。

stampede（5.2 s = 156 帧：刨地 1.0 / 踩踏 ≤ 3.0 / 打滑 1.2；glint 第 22.5 帧、hit 第 30 帧）：
  0  待机；4 重心往后坐、低头、右前蹄抬起（反向预备）
  9 / 18 右前蹄抬起往前，13 / 22 往后刨（每刨一下土块往后甩，玩法在 0.3 / 0.6 s 出土）
  27 extreme：前半身压到最低、四腿都屈、角尖对准冲撞方向（squash 最狠；"in" 冲向释放帧）
  30 释放帧 hit：后腿一蹬、身子往前拉长、前腿迈出第一步（stretch）
  32–120 踩踏：按 13 m/s 的奔跑相位逐 2 帧写（同网页 anim.ts 的四足对角步态，幅度 1.3 倍、低头冲）
  122 打滑：屁股往前坐、前腿撑直往前；138 慢慢抬头；156 回到待机
  踩踏出手段可能提前收（撞到东西 / 到 40 m）：玩法跳到片段的收招段（第 120 帧起）。

slam（2.7 s = 81 帧：人立 1.4 / 砸 0.3 / 收 1.0；glint 第 34.5 帧、hit 第 42 帧）：
  0 待机；6 前腿收、重心往后腿压（预备）
  16 人立到一半（breakdown）；28 人立到顶（extreme：前腿收在胸前、头往后仰、雷球举到最高）
  34 / 38 顶点微颤（moving hold，不冻住）；40 smear：前蹄往下砸
  42 释放帧 hit：前蹄砸地、头砸下去；45 压缩（再往下压一点）；51 压着地
  65 慢慢起身；81 回到待机
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "_plateau"))
from plateau_keys import X, Y, Z, both, flat, loc, rot, run  # noqa: E402

TAIL = ["tail_1", "tail_2", "tail_3"]


def P(hips_y=0.0, hips_z=0.0, hips=0.0, spine=0.0, chest=0.0, neck=0.0, head=0.0, fl=(0, 0, 0), fr=(0, 0, 0), hl=(0, 0, 0), hr=(0, 0, 0), tl=0.0, extra=()):
    """fl / fr / hl / hr：前左 / 前右 / 后左 / 后右腿三节（上臂·前臂·蹄 / 大腿·小腿·蹄）的摆角"""
    return flat(
        loc("hips", y=hips_y, z=hips_z),
        rot("hips", X, hips), rot("spine", X, spine), rot("chest", X, chest),
        rot("upperarm_L", X, fl[0]), rot("forearm_L", X, fl[1]), rot("fhoof_L", X, fl[2]),
        rot("upperarm_R", X, fr[0]), rot("forearm_R", X, fr[1]), rot("fhoof_R", X, fr[2]),
        rot("thigh_L", X, hl[0]), rot("shin_L", X, hl[1]), rot("hhoof_L", X, hl[2]),
        rot("thigh_R", X, hr[0]), rot("shin_R", X, hr[1]), rot("hhoof_R", X, hr[2]),
        rot("neck", X, neck), rot("head", X, head),
        [rot(t, X, tl) for t in TAIL],
        list(extra),
    )


def gallop(phase: float, k: float = 1.3) -> list:
    """四足对角小跑（同 anim.ts：左前 + 右后同相），大腿前后摆、小腿在抬起段往后收；低头冲"""
    out = {}
    for leg, off, front in (("fl", 0.0, True), ("fr", math.pi, True), ("hl", math.pi, False), ("hr", 0.0, False)):
        ph = phase + off
        up = -math.sin(ph) * 31 * k
        lo = max(0.0, math.cos(ph)) * 40 * k
        out[leg] = (up, lo if front else -lo * 0.6, -lo * 0.5 if front else lo * 0.4)
    bob = abs(math.sin(phase)) * 0.06
    return P(hips_y=bob - 0.03, hips=6, neck=32, head=20, fl=out["fl"], fr=out["fr"], hl=out["hl"], hr=out["hr"], tl=12 + 6 * math.sin(phase * 2))


STAMPEDE_KEYS = [
    (0, P()),
    (4, P(hips=-3, neck=20, head=12, fr=(-14, 20, 0), tl=-4)),
    (9, P(hips=-2, neck=24, head=14, fr=(-35, 42, -10))),
    (13, P(hips=-1, neck=26, head=15, fr=(30, 55, 15)), "out"),
    (18, P(hips=-2, neck=28, head=16, fr=(-32, 40, -10))),
    (22, P(hips=0, neck=30, head=18, fr=(30, 55, 15)), "out"),
    (27, P(hips_y=-0.18, hips=8, neck=36, head=26, fl=(10, -20, 0), fr=(12, -22, 0), hl=(-26, 36, 0), hr=(-26, 36, 0), tl=10), "in"),
    (30, P(hips_y=0.05, hips=-4, neck=30, head=22, fl=(-40, 12, -8), fr=(-10, 30, 0), hl=(36, -10, 12), hr=(30, -6, 10), tl=18), "out"),
]
RATE = 13 / 1.6 * math.pi / 30  # 每帧的步态相位（13 m/s、步幅 1.6 m）
for f in range(32, 121, 2):
    STAMPEDE_KEYS.append((f, gallop((f - 32) * RATE)))
STAMPEDE_KEYS += [
    (122, P(hips_y=-0.08, hips=-12, neck=28, head=14, fl=(-30, 0, 0), fr=(-30, 0, 0), hl=(-30, 18, 0), hr=(-30, 18, 0), tl=-6), "out"),
    (130, P(hips_y=-0.06, hips=-8, neck=22, head=10, fl=(-18, 0, 0), fr=(-18, 0, 0), hl=(-20, 12, 0), hr=(-20, 12, 0))),
    (138, P(hips=-3, neck=10, head=4, fl=(-5, 0, 0), fr=(-5, 0, 0), hl=(-6, 4, 0), hr=(-6, 4, 0))),
    (156, P()),
]

STAMPEDE = {"frames": 156, "events": [(0, "warn"), (22.5, "glint"), (30, "hit"), (156, "end")], "keys": STAMPEDE_KEYS}


def rear(h: float, tremble: float = 0.0, **kw):
    """人立：后腿撑地（大腿往后、小腿往前收），前腿收到胸前，hips 抬起"""
    return P(hips_y=0.06 * h, hips=-50 * h + tremble, spine=-8 * h, neck=10 * h, head=-16 * h - tremble,
             fl=(-60 * h, 90 * h, 0), fr=(-60 * h, 90 * h, 0), hl=(40 * h, -18 * h, 6 * h), hr=(40 * h, -18 * h, 6 * h), tl=-10 * h, **kw)


SLAM = {
    "frames": 81,
    "events": [(0, "warn"), (34.5, "glint"), (42, "hit"), (81, "end")],
    "keys": [
        (0, P()),
        (6, P(hips_y=-0.08, hips=4, neck=8, fl=(10, -15, 0), fr=(10, -15, 0), hl=(-8, 10, 0), hr=(-8, 10, 0))),
        (16, rear(0.55)),
        (28, rear(1.0)),
        (34, rear(1.02, tremble=1.5)),
        (38, rear(0.98, tremble=-1.5), "in"),
        (40, P(hips_y=0.06, hips=-14, neck=22, head=6, fl=(-12, 22, 0), fr=(-12, 22, 0), hl=(18, -8, 0), hr=(18, -8, 0))),
        (42, P(hips_y=-0.15, hips=10, spine=4, neck=30, head=16, fl=(16, -10, 0), fr=(16, -10, 0), hl=(-10, 14, 0), hr=(-10, 14, 0), tl=8), "out"),
        (45, P(hips_y=-0.22, hips=12, spine=5, neck=36, head=20, fl=(20, -24, 0), fr=(20, -24, 0), hl=(-16, 24, 0), hr=(-16, 24, 0), tl=4)),
        (51, P(hips_y=-0.2, hips=11, neck=34, head=18, fl=(18, -20, 0), fr=(18, -20, 0), hl=(-14, 20, 0), hr=(-14, 20, 0))),
        (65, P(hips_y=-0.06, hips=4, neck=14, head=8, fl=(6, -6, 0), fr=(6, -6, 0), hl=(-4, 6, 0), hr=(-4, 6, 0))),
        (81, P()),
    ],
}

run("SK_Enemy_Aoyin", {"stampede": STAMPEDE, "slam": SLAM}, "art/source/characters/SK_Enemy_Aoyin/anim/aoyin_anims.py", ortho=6.0, centre=(0, 0, 1.6))
