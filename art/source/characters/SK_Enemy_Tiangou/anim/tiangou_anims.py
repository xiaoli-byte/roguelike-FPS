"""天狗（SK_Enemy_Tiangou）招牌招式「扑咬 pounce」的手工关键帧（第四章移植 E 路；设计单 docs/art/vfx/foes-ch4.md 2.2）。

    blender -b --factory-startup --python art/source/characters/SK_Enemy_Tiangou/anim/tiangou_anims.py -- [--review <目录>]

产出 unity/Assets/Art/Characters/SK_Enemy_Tiangou/Anim/Keyframed/pounce.fbx（同名覆盖采样片段；FBX 不入库）和 events.json 里 pounce 的事件。
时长 = 招式总长 1.4 s（前摇 0.3 / 出手 0.4 / 收招 0.7），42 帧 @30 fps；hit 在第 9 帧（0.214）= 起跳的释放帧。
节拍：
  0  起手：待机
  3  key：前半身压低、后腿收到肚子下（squash 开始），耳朵贴后
  8  extreme：伏到最低、屁股翘高、尾巴绷直往上，头压在两前爪之间——蓄力顶点（"in"：冲向释放帧）
  9  释放帧 hit：后腿蹬直、身子拉长，前爪伸到最远（stretch / smear）
  15 腾空：前腿还往前探、后腿收一点，身子微抬头
  21 落地（出手段结束）：前爪先着地，肩膀压下去
  24 压缩：肩膀压到最低、头埋低（squash）
  30 落地滑一下、低头（破绽）
  36 尾巴、耳朵往前甩（follow-through）
  42 回到待机
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "_plateau"))
from plateau_keys import X, Y, Z, both, flat, loc, rot, run  # noqa: E402

TAIL = [f"tail_{i}" for i in range(1, 6)]


def tail(deg):
    return [rot(t, X, deg) for t in TAIL]


def P(hips_y=0.0, hips=0.0, spine=0.0, neck=0.0, head=0.0, fore=0.0, forearm=0.0, paw=0.0, thigh=0.0, shin=0.0, foot=0.0, tl=0.0, ear=0.0):
    return flat(
        loc("hips", y=hips_y),
        rot("hips", X, hips),
        rot("spine", X, spine),
        both("upperarm", X, fore), both("forearm", X, forearm), both("paw", X, paw),
        both("thigh", X, thigh), both("shin", X, shin), both("foot", X, foot),
        rot("neck", X, neck), rot("head", X, head),
        both("ear", X, ear),
        tail(tl),
    )


POUNCE = {
    "frames": 42,
    "events": [(0, "warn"), (9, "hit"), (42, "end")],
    "keys": [
        (0, P()),
        (3, P(hips_y=-0.1, hips=9, spine=5, neck=-12, head=-6, fore=16, forearm=-28, thigh=-30, shin=48, tl=8, ear=25)),
        (8, P(hips_y=-0.2, hips=15, spine=7, neck=-22, head=-10, fore=26, forearm=-46, thigh=-52, shin=78, foot=-10, tl=16, ear=40), "in"),
        (9, P(hips_y=-0.02, hips=-7, spine=-5, neck=10, head=12, fore=-72, forearm=14, paw=12, thigh=58, shin=-16, foot=22, tl=4, ear=45), "out"),
        (15, P(hips_y=0.0, hips=-11, spine=-3, neck=4, head=6, fore=-55, forearm=8, paw=6, thigh=30, shin=10, foot=10, tl=18, ear=35)),
        (21, P(hips_y=-0.08, hips=12, spine=4, neck=8, head=4, fore=-18, forearm=-4, thigh=18, shin=18, tl=8, ear=20)),
        (24, P(hips_y=-0.18, hips=17, spine=6, neck=22, head=12, fore=6, forearm=-36, thigh=-10, shin=40, tl=-6, ear=10), "back"),
        (30, P(hips_y=-0.1, hips=10, spine=3, neck=24, head=14, fore=2, forearm=-16, thigh=-2, shin=20, tl=-8)),
        (36, P(hips_y=-0.03, hips=3, neck=10, head=6, tl=-12, ear=-10)),
        (42, P()),
    ],
}

run("SK_Enemy_Tiangou", {"pounce": POUNCE}, "art/source/characters/SK_Enemy_Tiangou/anim/tiangou_anims.py", ortho=3.0, centre=(0, 0, 0.7))
