"""蛮蛮（SK_Enemy_Manman，一翼一目；一对里右翼那只是同一模型 X 镜像）招牌招式「电弧横扫 sweep」（成对扫线）的手工关键帧
（第四章移植 E 路；设计单 docs/art/vfx/foes-ch4.md 5.1）。两只同帧出同一段，所以一段片段就是「成对」。

    blender -b --factory-startup --python art/source/characters/SK_Enemy_Manman/anim/manman_anims.py -- [--review <目录>]

产出 unity/Assets/Art/Characters/SK_Enemy_Manman/Anim/Keyframed/sweep.fbx（同名覆盖采样片段；FBX 不入库）和 events.json 里 sweep 的事件。
时长 = 招式总长 3.0 s（前摇 0.8 / 掠过 1.2 / 爬升 1.0），90 帧；hit 在第 24 帧（0.267）= 降到离地 1 m、电弧满亮的那一刻。
翅膀只有左边一扇（wing_1/2/3_L），绕 Z 正 = 往上抬。
节拍：
  0  平飞扇翅；4 大扇往上（拔高）；10 往下一压
  16 extreme：翅膀高举到顶、脖子伸长、腿往后收（全章最大的翼展剪影）；22 顶点上微颤（"in"）
  24 释放帧 hit：身子放平前倾、翅膀压成滑翔（smear）
  30–58 低空掠过：翅膀小幅颤动（每 6 帧一拍），身子平
  62 / 68 / 74 / 80 爬升：大扇翅（慢、低，好打）
  90 回到平飞
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "_plateau"))
from plateau_keys import X, Y, Z, both, flat, loc, rot, run  # noqa: E402


def P(hips=0.0, chest=0.0, neck=0.0, head=0.0, w1=0.0, w2=0.0, w3=0.0, thigh=0.0, shin=0.0, foot=0.0, tl=0.0):
    return flat(
        rot("hips", X, hips), rot("chest", X, chest),
        rot("wing_1_L", Z, w1), rot("wing_2_L", Z, w2), rot("wing_3_L", Z, w3),
        both("thigh", X, thigh), both("shin", X, shin), both("foot", X, foot),
        rot("neck", X, neck), rot("head", X, head),
        rot("tail_1", X, tl), rot("tail_2", X, tl * 0.6),
    )


KEYS = [
    (0, P(w1=10, w2=4)),
    (4, P(hips=-4, neck=-6, w1=58, w2=22, w3=10, thigh=20, shin=-10)),
    (10, P(hips=4, neck=-4, w1=-44, w2=-16, w3=-8, thigh=26, shin=-14)),
    (16, P(hips=-8, chest=-6, neck=-26, head=-8, w1=76, w2=30, w3=16, thigh=42, shin=-30, foot=20, tl=12)),
    (22, P(hips=-7, chest=-6, neck=-28, head=-10, w1=72, w2=28, w3=14, thigh=44, shin=-30, foot=22, tl=14), "in"),
    (24, P(hips=32, chest=6, neck=-14, head=4, w1=-6, w2=-6, w3=-4, thigh=55, shin=-36, foot=24, tl=-6), "out"),
]
for i, f in enumerate(range(30, 59, 6)):
    KEYS.append((f, P(hips=31, chest=5, neck=-14, head=4, w1=10 if i % 2 == 0 else -8, w2=4 if i % 2 == 0 else -4, thigh=55, shin=-36, foot=24, tl=-4)))
KEYS += [
    (62, P(hips=18, neck=-10, w1=60, w2=24, w3=12, thigh=40, shin=-24, tl=4)),
    (68, P(hips=12, neck=-8, w1=-46, w2=-18, w3=-8, thigh=34, shin=-20)),
    (74, P(hips=8, neck=-6, w1=58, w2=22, w3=10, thigh=28, shin=-16)),
    (80, P(hips=4, neck=-4, w1=-40, w2=-14, w3=-6, thigh=22, shin=-12)),
    (86, P(hips=2, w1=30, w2=10, thigh=12, shin=-6)),
    (90, P(w1=10, w2=4)),
]

SWEEP = {"frames": 90, "events": [(0, "warn"), (24, "hit"), (90, "end")], "keys": KEYS}

run("SK_Enemy_Manman", {"sweep": SWEEP}, "art/source/characters/SK_Enemy_Manman/anim/manman_anims.py", ortho=2.4, centre=(0, 0, 0.5))
