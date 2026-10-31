"""举父（SK_Enemy_Jufu）招牌招式「远投 throw」（举石 / 投石）的手工关键帧（第四章移植 E 路；设计单 docs/art/vfx/foes-ch4.md 4.2）。

    blender -b --factory-startup --python art/source/characters/SK_Enemy_Jufu/anim/jufu_anims.py -- [--review <目录>]

产出 unity/Assets/Art/Characters/SK_Enemy_Jufu/Anim/Keyframed/throw.fbx（同名覆盖采样片段；FBX 不入库）和 events.json 里 throw 的事件。
时长 = 招式总长 1.9 s（举石 1.0 / 出手 0.1 / 收招 0.8），57 帧；release 在第 30 帧（0.526）。手里的石头由玩法挂在两手之间。
节拍：
  0  待机
  5  key：弯腰、双手往下抠石（hips 前倾、膝屈，重心压低）
  10 抠起：双手合拢在膝前
  16 breakdown：直起来，石头沿身前往上举
  24 举过头顶
  28 extreme：整个身子往后弓（反向预备最狠）、石头在头后（"in"：冲向释放帧）
  30 释放帧 release：往前甩——上身前压、双臂甩到身前（stretch / smear）
  34 follow-through：双臂甩过头往下，上身压得更低
  40 双臂垂下（胸口掌印亮的窗口）
  57 回到待机
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "_plateau"))
from plateau_keys import X, Y, Z, both, flat, loc, rot, run  # noqa: E402


def P(hips_y=0.0, hips=0.0, spine=0.0, chest=0.0, neck=0.0, head=0.0, arm=0.0, arm_out=0.0, forearm=0.0, hand=0.0, fingers=0.0, thigh=0.0, shin=0.0, foot=0.0):
    """arm：手臂往前抬（负 = 往前上举，-180 ≈ 举过头顶）；arm_out：往外张（左右镜像）"""
    return flat(
        loc("hips", y=hips_y),
        rot("hips", X, hips), rot("spine", X, spine), rot("chest", X, chest),
        both("thigh", X, thigh), both("shin", X, shin), both("foot", X, foot),
        both("arm", X, arm), both("arm", Z, arm_out, True), both("forearm", X, forearm), both("hand", X, hand), both("fingers", X, fingers),
        rot("neck", X, neck), rot("head", X, head),
    )


THROW = {
    "frames": 57,
    "events": [(0, "warn"), (30, "release"), (57, "end")],
    "keys": [
        (0, P()),
        (5, P(hips_y=-0.16, hips=26, spine=18, neck=-10, head=-8, arm=18, forearm=-18, thigh=-30, shin=45, foot=-12)),
        (10, P(hips_y=-0.18, hips=28, spine=20, neck=-12, head=-10, arm=10, arm_out=-8, forearm=-30, fingers=40, thigh=-32, shin=48, foot=-14)),
        (16, P(hips_y=-0.06, hips=8, spine=4, arm=-80, arm_out=-6, forearm=-45, fingers=40, thigh=-10, shin=14)),
        (24, P(hips_y=0.02, hips=-8, spine=-10, chest=-8, head=-14, arm=-150, arm_out=10, forearm=-40, fingers=40)),
        (28, P(hips_y=0.0, hips=-14, spine=-15, chest=-14, neck=-6, head=-20, arm=-170, arm_out=14, forearm=-62, fingers=40, thigh=10, shin=6), "in"),
        (30, P(hips_y=-0.08, hips=18, spine=16, chest=12, neck=4, head=10, arm=-52, arm_out=4, forearm=8, hand=10, fingers=-10, thigh=-14, shin=22), "out"),
        (34, P(hips_y=-0.12, hips=26, spine=22, chest=14, neck=8, head=14, arm=12, forearm=-6, hand=14, thigh=-18, shin=28)),
        (40, P(hips_y=-0.08, hips=16, spine=12, chest=6, neck=4, head=6, arm=6, forearm=-10, thigh=-12, shin=18), "back"),
        (57, P()),
    ],
}

run("SK_Enemy_Jufu", {"throw": THROW}, "art/source/characters/SK_Enemy_Jufu/anim/jufu_anims.py", ortho=3.4, centre=(0, 0, 1.0))
