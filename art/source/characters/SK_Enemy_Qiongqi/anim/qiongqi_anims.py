"""穷奇（SK_Enemy_Qiongqi）招牌招式「掠空扑杀 glide」（滑翔展翼 + 落地扑杀）的手工关键帧（第四章移植 E 路；设计单 docs/art/vfx/foes-ch4.md 8.2）。

    blender -b --factory-startup --python art/source/characters/SK_Enemy_Qiongqi/anim/qiongqi_anims.py -- [--review <目录>]

产出 unity/Assets/Art/Characters/SK_Enemy_Qiongqi/Anim/Keyframed/glide.fbx（同名覆盖采样片段；FBX 不入库）和 events.json 里 glide 的事件。
时长 = 招式总长 3.1 s（前摇 0.7 / 滑翔 ≤ 1.6 / 收招 0.8），93 帧；glint 第 13.5 帧、hit（起飞）第 21 帧、land 第 69 帧。
滑翔提前落地时玩法跳到片段的收招段（第 69 帧起）。翅膀：wing_1 绕 Z = 往上抬，wing_1/2/3 绕 Y = 往外展开（左右镜像）。
节拍：
  0  待机（双翼收在背上）
  6  反向预备：往后缩一下、双翼半张
  15 extreme：伏到最低、双翼全张往上举、雷冠朝前（蓄力顶点；"in"）
  21 释放帧 hit（起飞）：后腿一蹬、身子拉长，双翼往下一扇（stretch / smear）
  26 滑翔：双翼平展、前爪往前探、后腿拖在后面
  40 / 52 / 62 滑翔里双翼慢慢起伏（不冻住）
  66 落地前：前爪往下伸、身子前倾
  69 落地扑杀 land：双前爪砸地、肩膀压下去、双翼往前一包（squash）
  72 压缩；80 低头（破绽）；88 双翼往回收（follow-through）；93 回到待机
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "_plateau"))
from plateau_keys import X, Y, Z, both, flat, loc, rot, run  # noqa: E402

TAIL = [f"tail_{i}" for i in range(1, 6)]


def wings(spread=0.0, lift=0.0):
    """spread 0..1 展开（绕 Y 往外），lift 往上抬（度，绕 Z；负 = 往下压）"""
    return [
        both("wing_1", Z, 52 * spread + lift, True), both("wing_1", Y, -34 * spread, True),
        both("wing_2", Y, -40 * spread, True), both("wing_3", Y, -24 * spread, True),
    ]


def P(hips_y=0.0, hips=0.0, spine=0.0, neck=0.0, head=0.0, fore=0.0, forearm=0.0, paw=0.0, thigh=0.0, shin=0.0, foot=0.0, tl=0.0, spread=0.0, lift=0.0):
    return flat(
        loc("hips", y=hips_y),
        rot("hips", X, hips), rot("spine", X, spine),
        both("upperarm", X, fore), both("forearm", X, forearm), both("paw", X, paw),
        both("thigh", X, thigh), both("shin", X, shin), both("foot", X, foot),
        rot("neck", X, neck), rot("head", X, head),
        [rot(t, X, tl) for t in TAIL],
        wings(spread, lift),
    )


GLIDE = {
    "frames": 93,
    "events": [(0, "warn"), (13.5, "glint"), (21, "hit"), (69, "land"), (93, "end")],
    "keys": [
        (0, P()),
        (6, P(hips_y=-0.05, hips=-6, neck=-6, fore=-6, thigh=8, tl=6, spread=0.3)),
        (15, P(hips_y=-0.3, hips=12, spine=6, neck=-18, head=-8, fore=28, forearm=-40, thigh=-45, shin=60, foot=-12, tl=16, spread=0.75, lift=34), "in"),
        (21, P(hips_y=0.05, hips=-10, spine=-6, neck=6, head=8, fore=-60, forearm=10, thigh=55, shin=-10, foot=20, tl=10, spread=1.0, lift=-28), "out"),
        (26, P(hips=-4, neck=10, head=6, fore=-66, forearm=8, paw=10, thigh=50, shin=-6, foot=16, tl=6, spread=1.0, lift=2)),
        (40, P(hips=-3, neck=10, head=6, fore=-64, forearm=8, paw=10, thigh=48, shin=-6, foot=16, tl=8, spread=1.0, lift=8)),
        (52, P(hips=-2, neck=12, head=6, fore=-62, forearm=8, paw=10, thigh=48, shin=-6, foot=16, tl=4, spread=1.0, lift=-4)),
        (62, P(hips=-1, neck=12, head=8, fore=-60, forearm=6, paw=8, thigh=46, shin=-4, foot=14, tl=6, spread=1.0, lift=5)),
        (66, P(hips_y=-0.02, hips=10, neck=14, head=8, fore=-40, forearm=-6, thigh=30, shin=10, tl=10, spread=0.9, lift=-6), "in"),
        (69, P(hips_y=-0.25, hips=18, spine=6, neck=20, head=10, fore=-4, forearm=-10, thigh=-10, shin=30, tl=14, spread=0.65, lift=-30), "out"),
        (72, P(hips_y=-0.35, hips=20, spine=8, neck=28, head=14, fore=6, forearm=-28, thigh=-24, shin=44, tl=10, spread=0.6, lift=-26)),
        (80, P(hips_y=-0.25, hips=14, spine=5, neck=26, head=14, fore=4, forearm=-18, thigh=-16, shin=30, tl=2, spread=0.45, lift=-10)),
        (88, P(hips_y=-0.08, hips=5, neck=12, head=6, fore=0, forearm=-6, thigh=-6, shin=10, tl=-6, spread=0.15, lift=4), "back"),
        (93, P()),
    ],
}

run("SK_Enemy_Qiongqi", {"glide": GLIDE}, "art/source/characters/SK_Enemy_Qiongqi/anim/qiongqi_anims.py", ortho=5.0, centre=(0, 0, 1.0))
