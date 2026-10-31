"""鹏（SK_Boss_Peng）的手工关键帧（K 路「首领与精英动作 · 特效调优」，第二批 A 路补羽刃雨 / 落台 / 起飞 / 倒下）：Blender 无头脚本，一次生成全部片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Peng/anim/peng_anims.py -- [--out <目录>] [--review <poses.json>] [--preview <目录>]

产出（FBX 不入库，可重新生成）：
  unity/Assets/Art/Characters/SK_Boss_Peng/Anim/Keyframed/<状态>.fbx   swoopReady、swoopHold（新状态，循环）、dive、gust、roar（同名覆盖 E5 的采样片段）；
    第二批：spread（羽刃雨前摇 · 升空）→ spreadShed（新，循环：振翅洒羽）、spreadEnd（新：收翼）；perch（落台敛翼）→ perchRest（新，循环：栖落）、
    takeoff（起飞前摇 + 振翅离台）；death（新：中弹失衡 → 翼折 → 坠落 → 落地 → 余韵）→ deathRest（新，循环）
  unity/Assets/Art/Characters/SK_Boss_Peng/Anim/SK_Boss_Peng.events.json   只改写这些状态的条目
写法、坐标见 ../../SK_Boss_Kun/anim/kunpeng_keys.py（鲲鹏共用）；设计单 docs/art/vfx/kunpeng.md。

鹏的骨架：root（俯仰写在这里）→ hips → chest → neck → head；chest 两侧 wing_*_1 → 2 → 3（绑定姿势是举成 V 形的双翼，约 47° 朝上外张）、
wing_*_low（下翼片，朝下外张）；hips → tail_1 → 2 → 3、thigh → shin → talon。
  翅膀（左翼，右翼镜像）：绕 Y 正转 = 往外放平 / 下扇（V 形 → 一字展开 → 压到水平以下），负转 = 往上合拢；绕 Z 正转 = 翼尖往后掠，负转 = 往前兜。
  尾羽：绕 X 正转 = 上翘；腿：绕 X 正转 = 往后收、负转 = 往前探爪。
第二批的片段用 Q()：子骨先转、父骨后转（翅膀 / 腿 / 尾 → 头颈胸 → root），每个角度都相当于在「身体自己的坐标」里转——
  倒下时 root 前栽到 80°，P 那种先转 root、再按世界轴转翅膀的写法会把「下扇」变成拧翅；两翼可以不对称（wl / wr 叠在对称值上）。
落地的姿势（死亡落地、栖落）打 ground：烘之前量 LOD0 网格最低点，把 root 平移到最低点 = 模型原点所在的地面（+ 偏移，模型单位）。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "SK_Boss_Kun" / "anim"))
import kunpeng_keys as kk  # noqa: E402
from kunpeng_keys import X, Y, Z  # noqa: E402

import bpy  # noqa: E402

ASSET = "SK_Boss_Peng"
UNITY = kk.ROOT / f"unity/Assets/Art/Characters/{ASSET}/Anim"


def mirror(ops):
    out = []
    for b, ax, v in ops:
        out.append([b, ax, v])
        if "_L" in b:
            out.append([b.replace("_L", "_R"), ax, -v if ax in (Y, Z) else v])
    return out


def P(root=0.0, bob=0.0, hips=0.0, chest=0.0, neck=0.0, head=0.0, spread=0.0, sweep=0.0, curl=0.0, tip=0.0, low=None, tail=0.0, fan=0.0,
      thigh=0.0, shin=0.0, talon=0.0, roll=0.0):
    """一个姿势的增量：root 俯仰（+ 前倾）/ 上下（bob，模型单位）/ 横滚；hips…head 俯仰；
    翅膀 spread（+ 外放下扇、− 上合）、sweep（+ 后掠、− 前兜）、curl（第 2 节再往下 / 往外弯）、tip（第 3 节）；
    low = 下翼片外张（缺省跟主翼的一半）；tail 上翘、fan 尾尖再翘；腿 thigh / shin / talon"""
    ops = []
    if bob:
        ops.append(["root", "loc", [0, 0, bob]])
    if root:
        ops.append(["root", X, root])
    if roll:
        ops.append(["root", Y, roll])
    for b, v in (("hips", hips), ("chest", chest), ("neck", neck), ("head", head)):
        if v:
            ops.append([b, X, v])
    w = []
    if sweep:
        w.append(["wing_L_1", Z, sweep])
    if spread:
        w.append(["wing_L_1", Y, spread])
    if curl:
        w.append(["wing_L_2", Y, curl])
    if tip:
        w.append(["wing_L_3", Y, tip])
    lo = -0.5 * spread if low is None else low
    if lo:
        w.append(["wing_L_low", Y, lo])
    ops += mirror(w)
    for b, v in (("tail_1", tail), ("tail_2", fan * 0.5), ("tail_3", fan)):
        if v:
            ops.append([b, X, v])
    ops += mirror([op for op in (["thigh_L", X, thigh], ["shin_L", X, shin], ["talon_L", X, talon]) if op[2]])
    return ops


def K(frame, ops, base=("Idle", 0)):
    return (frame, (base[0], base[1], ops))


def _wing(side, spread=0.0, sweep=0.0, curl=0.0, tip=0.0, low=None):
    """一侧翅膀（side = "L" / "R"；右翼绕 Y / Z 取反）。low 缺省跟 spread 的一半反着走（同 P）"""
    k = 1 if side == "L" else -1
    ops = []
    for bone, ax, v in ((f"wing_{side}_3", Y, tip), (f"wing_{side}_2", Y, curl), (f"wing_{side}_low", Y, -0.5 * spread if low is None else low),
                        (f"wing_{side}_1", Y, spread), (f"wing_{side}_1", Z, sweep)):
        if v:
            ops.append([bone, ax, k * v])
    return ops


def Q(root=0.0, bob=0.0, hips=0.0, chest=0.0, neck=0.0, head=0.0, spread=0.0, sweep=0.0, curl=0.0, tip=0.0, low=None, tail=0.0, fan=0.0,
      thigh=0.0, shin=0.0, talon=0.0, roll=0.0, wl=None, wr=None, ground=None):
    """同 P 的参数，子骨先转、父骨后转（身体坐标）；wl / wr = 左 / 右翼在对称值上再叠的 {spread, sweep, curl, tip, low}；
    ground = 落在地面上（烘之前把网格最低点平移到模型原点 + ground 个单位）"""
    ops = []
    for side, extra in (("L", wl or {}), ("R", wr or {})):
        lo = (low if low is not None else -0.5 * spread) + extra.get("low", -0.5 * extra.get("spread", 0.0))
        ops += _wing(side, spread + extra.get("spread", 0.0), sweep + extra.get("sweep", 0.0), curl + extra.get("curl", 0.0),
                     tip + extra.get("tip", 0.0), lo)
    for b, v in (("tail_3", fan), ("tail_2", fan * 0.5), ("tail_1", tail)):
        if v:
            ops.append([b, X, v])
    for side in ("L", "R"):
        for b, v in ((f"talon_{side}", talon), (f"shin_{side}", shin), (f"thigh_{side}", thigh)):
            if v:
                ops.append([b, X, v])
    for b, v in (("head", head), ("neck", neck), ("chest", chest), ("hips", hips)):
        if v:
            ops.append([b, X, v])
    if roll:
        ops.append(["root", Y, roll])
    if root:
        ops.append(["root", X, root])
    if bob:
        ops.append(["root", "loc", [0, 0, bob]])
    if ground is not None:
        ops.append(["root", "ground", ground])
    return ops


# ───────────── 片段（30 fps；底姿是采样待机第 0 帧：root 前倾 2.9°、双翼半收）─────────────
# 扇翼狂风每一下下扇（释放帧），周期 17 帧 ≈ 0.57 s；第一下 60 帧 = 2.0 s = 前摇结束（PengGust 的出手段等 gustStart 事件，兜底 2.0 s）
GUST_DOWN = [60, 77, 94, 111, 128, 145, 162]


def gust_keys():
    keys = [
        K(0, []),
        # 起手：后仰、双翼往上往后收拢（蓄）、尾羽下压
        K(12, P(root=-10, chest=-6, head=-10, spread=-22, sweep=18, tail=-8, thigh=20)),
        # 前摇里两下慢扇（悬停爬升到冰窟上空）
        K(24, P(root=-4, bob=0.25, spread=30, sweep=-6, curl=8, tail=4, thigh=25)),
        K(36, P(root=-8, bob=-0.1, spread=-18, sweep=12, curl=-6, tail=-4, thigh=25)),
        K(46, P(root=-4, bob=0.25, spread=32, sweep=-8, curl=8, tail=4, thigh=25)),
        # 蓄力顶点（1.8 s）：双翼高举后掠、挺胸后仰、尾羽张开
        K(54, P(root=-14, chest=-8, neck=-6, head=-12, spread=-30, sweep=22, curl=-10, tip=-8, tail=-10, fan=10, thigh=30)),
        K(57, P(root=-15, chest=-9, neck=-6, head=-13, spread=-32, sweep=24, curl=-11, tip=-9, tail=-11, fan=11, thigh=30)),
    ]
    # 2.0 s 起：每 17 帧一下——下扇（释放帧：翼压到水平以下、前兜，身子前探、往上一窜）→ 上收（翼高举、后掠、身子回落）
    for k, d in enumerate(GUST_DOWN):
        strong = 1.0 if k == 0 else 0.85
        keys.append(K(d, P(root=16 * strong, bob=0.35, chest=6, head=8, spread=74 * strong, sweep=-24 * strong, curl=16, tip=12, tail=8, fan=6, thigh=35)))
        if d + 8 < 174 and k < len(GUST_DOWN) - 1:
            keys.append(K(d + 8, P(root=2, bob=-0.15, chest=-4, head=-4, spread=-24, sweep=18, curl=-8, tip=-6, tail=-4, thigh=32)))
    keys.append(K(174, []))
    return keys


CLIPS = {
    # 俯冲 · 瞄准：后仰抬头 → 锁定（前倾、伸颈低头盯住地面的线、双翼半展）→ 预警段（0.9 s）双翼高举后掠、收爪翘尾——蓄满
    "swoopReady": {"frames": 72, "next": "swoopHold", "keys": [
        K(0, []),
        K(10, P(root=-10, chest=-6, head=-12, spread=-16, sweep=10, tail=-6, thigh=20)),
        K(28, P(root=14, neck=8, head=10, spread=22, sweep=-4, curl=6, tail=4, thigh=30)),
        K(44, P(root=20, neck=10, head=12, spread=-24, sweep=26, curl=-8, tip=-6, tail=12, fan=8, thigh=45, shin=-20)),
        K(60, P(root=22, neck=11, head=13, spread=-28, sweep=30, curl=-10, tip=-8, tail=14, fan=10, thigh=48, shin=-22)),
        K(72, P(root=23, neck=11, head=13, spread=-30, sweep=32, curl=-10, tip=-8, tail=14, fan=10, thigh=50, shin=-24)),
    ], "events": [(0, "sfx:enemy_alert"), (44, "fx:lineWarning"), (44, "sfx:telegraph"), (60, "cocked")]},
    # 俯冲 · 蓄满悬停（循环）：瞄准超时 / 预警没走完时停在蓄满的姿势上微颤，等 PengSwoop 发 act_dive 再冲——
    #   改前 swoopReady 播完直接接 dive，瞄准比片段短时鹏在预警还没填满前就摆出俯冲姿势（beats-kunpeng 测到早 28 帧）
    "swoopHold": {"frames": 24, "loop": True, "keys": [
        K(0, P(root=23, neck=11, head=13, spread=-30, sweep=32, curl=-10, tip=-8, tail=14, fan=10, thigh=50, shin=-24)),
        K(6, P(root=24, bob=0.06, neck=11, head=14, spread=-33, sweep=34, curl=-11, tip=-10, tail=15, fan=11, thigh=50, shin=-24)),
        K(12, P(root=23, neck=11, head=13, spread=-29, sweep=31, curl=-10, tip=-7, tail=13, fan=9, thigh=50, shin=-24)),
        K(18, P(root=22.5, bob=-0.05, neck=10, head=12, spread=-32, sweep=33, curl=-11, tip=-9, tail=14, fan=10, thigh=50, shin=-24)),
        K(24, P(root=23, neck=11, head=13, spread=-30, sweep=32, curl=-10, tip=-8, tail=14, fan=10, thigh=50, shin=-24)),
    ], "events": []},
    # 俯冲 · 掠台：0 帧拖影（整只压成一支箭：翼贴身后掠、头前伸、尾收）→ 14 帧掠过（双翼外张刹风、爪往前探 = 扑击极限姿势）
    #   → 22 帧随势（下扇一记、往上拉起、尾羽下压、爪甩回）→ 36 帧回到盘旋
    "dive": {"frames": 36, "keys": [
        K(0, P(root=45, neck=10, head=6, spread=-12, sweep=58, curl=-6, tip=-6, low=6, tail=-6, thigh=55, shin=-25)),
        K(5, P(root=48, neck=12, head=7, spread=-14, sweep=64, curl=-6, tip=-6, low=8, tail=-8, thigh=58, shin=-26)),
        K(14, P(root=32, neck=4, head=0, spread=48, sweep=8, curl=12, tip=10, tail=10, fan=8, thigh=-55, shin=30, talon=-20)),
        K(22, P(root=14, bob=0.3, chest=-6, head=-8, spread=70, sweep=-18, curl=16, tip=12, tail=-12, thigh=20, shin=-10)),
        K(36, P(root=8, spread=4, sweep=4, thigh=25)),
    ], "events": [(0, "sfx:boss_roar"), (2, "hitOpen"), (14, "strike"), (22, "flap")]},
    # 扇翼狂风（整招 5.8 s = 前摇 2.0 + 出手 3.4 + 收招 0.4；PengGust 按整招时长播）：见 gust_keys
    "gust": {"frames": 174, "keys": gust_keys(),
             "events": [(0, "sfx:telegraph"), (30, "fx:zoneWarning"), (54, "apex"), (GUST_DOWN[0], "gustStart")] + [(d, "flap") for d in GUST_DOWN]},
    # 化而为鸟（转换演出 1.55 s 换形后的 3.05 s，ActScale ≈ 0.79）：雾里收拢成茧（翼合抱、低头、收爪）→ 升起中慢慢舒展
    #   → 50 帧（≈ 3.6 s 长啸）双翼一字展开、挺胸仰头、尾羽炸开 = 全场高潮 → 稳住
    "roar": {"frames": 72, "keys": [
        K(0, P(root=10, chest=10, neck=10, head=20, spread=-34, sweep=-22, curl=-12, tip=-10, low=10, tail=-10, thigh=40, shin=-30)),
        K(20, P(root=6, chest=6, neck=6, head=12, spread=-24, sweep=-14, curl=-8, tip=-6, tail=-6, thigh=36, shin=-26)),
        K(38, P(root=10, chest=8, neck=8, head=16, spread=-30, sweep=-26, curl=-12, tip=-10, low=8, tail=-8, thigh=40, shin=-28)),
        K(46, P(root=-6, chest=-6, neck=-8, head=-14, spread=40, sweep=-6, curl=10, tip=8, tail=12, fan=10, thigh=20, shin=-10)),
        K(50, P(root=-10, chest=-12, neck=-12, head=-24, spread=40, sweep=-14, curl=2, tip=-8, low=-26, tail=18, fan=16, thigh=10, shin=-6, talon=-15)),
        K(60, P(root=-8, chest=-10, neck=-10, head=-18, spread=36, sweep=-12, curl=2, tip=-6, low=-24, tail=14, fan=12, thigh=12, shin=-6, talon=-10)),
        K(72, P(root=-4, chest=-4, head=-8, spread=24, sweep=-6, curl=2, tip=-2, tail=8, fan=6, thigh=18)),
    ], "events": [(50, "spread"), (50, "fx:shake")]},
}

# ───────────── 第二批 A 路：羽刃雨 / 落台 / 起飞 / 倒下（Q 写法：身体坐标）─────────────
# 羽刃雨：前摇 0.9 s（spread 27 帧：上收 → 一记猛扇升空 → 展翅到洒羽的架势）→ 出手每 0.11 s 一枚、右左交替（spreadShed 循环 13 帧 ≈ 4 枚：
#   哪边出羽哪边翼尖往下一甩、身子往那边一歪）→ 收招 0.6 s（spreadEnd：收翼回盘旋）
SHED = dict(root=-6, chest=-8, neck=-4, head=-6, spread=34, sweep=-6, curl=6, low=-10, tail=-6, fan=14, thigh=32, shin=-10)
FLICK = dict(tip=34, curl=14, sweep=-12)       # 甩羽那一侧
RECOIL = dict(tip=-6, curl=-2, sweep=4)        # 另一侧回位


def shed(side, roll):
    return Q(**SHED, roll=roll * 1.6, wl=FLICK if side == "L" else RECOIL, wr=FLICK if side == "R" else RECOIL)


# 落台：perch 从下降开始播（下降 0.9 s = 27 帧：抬翅、刹风一扇、伸爪 → 第 27 帧触地 hit）→ 压一下回弹 → 敛翼（第 46 帧 fold）→ perchRest 循环
REST = dict(root=4, chest=4, neck=2, head=12, spread=-24, sweep=18, curl=-8, tip=-6, low=10, tail=2)
# 倒下的翅膀：左翼中弹后翼折（第二节往下折、翼尖耷拉、被风往后拖），右翼还在乱扑
BROKEN = dict(spread=-18, sweep=32, curl=46, tip=26)


def rest(**d):
    r = dict(REST)
    for k, v in d.items():
        r[k] = r.get(k, 0.0) + v
    return Q(**r)


CLIPS_B2 = {
    "spread": {"frames": 27, "next": "spreadShed", "keys": [
        K(0, []),
        K(6, Q(root=-8, chest=-4, head=-8, spread=-26, sweep=14, curl=-6, tail=-6, thigh=25)),
        K(13, Q(root=-4, bob=0.3, chest=2, head=2, spread=56, sweep=-12, curl=12, tip=10, tail=6, fan=6, thigh=30)),
        K(20, Q(root=-8, bob=0.1, chest=-6, head=-10, spread=-22, sweep=12, curl=-6, tip=-4, tail=-4, fan=8, thigh=30)),
        K(27, Q(**SHED)),
    ], "events": [(0, "sfx:telegraph"), (13, "flap")]},
    "spreadShed": {"frames": 13, "loop": True, "keys": [
        K(0, shed("R", 3)), K(3, shed("L", -3)), K(7, shed("R", 3)), K(10, shed("L", -3)), K(13, shed("R", 3)),
    ], "events": [(0, "projectile"), (3.25, "projectile"), (6.5, "projectile"), (9.75, "projectile")]},
    "spreadEnd": {"frames": 18, "keys": [
        K(0, Q(**SHED)),
        K(6, Q(root=-2, spread=-18, sweep=14, curl=-6, tail=-2, thigh=28)),
        K(12, Q(root=2, spread=8, sweep=2, thigh=25)),
        K(18, []),
    ], "events": []},
    "perch": {"frames": 54, "next": "perchRest", "keys": [
        K(0, []),
        K(6, Q(root=-12, chest=-6, head=-6, spread=-24, sweep=16, curl=-6, tail=-10, fan=8, thigh=-25, shin=18)),
        K(14, Q(root=-16, chest=-8, head=-8, spread=52, sweep=-16, curl=14, tip=10, tail=-14, fan=12, thigh=-35, shin=24, talon=-12)),
        K(21, Q(root=-12, chest=-6, head=-6, spread=-18, sweep=16, curl=-6, tail=-10, fan=10, thigh=-40, shin=28, talon=-15)),
        K(27, Q(root=6, bob=-0.05, chest=10, neck=6, head=10, spread=58, sweep=-6, curl=14, tip=10, low=-20, tail=10, fan=10, thigh=-6, shin=6)),
        K(31, Q(root=8, bob=-0.12, chest=13, neck=8, head=14, spread=64, sweep=-8, curl=16, tip=12, low=-24, tail=12, fan=12, thigh=-4, shin=8)),
        K(38, Q(root=2, bob=-0.05, chest=3, head=4, spread=14, sweep=8, curl=4, tail=4, fan=4)),
        K(46, Q(**REST)),
        K(54, Q(**REST)),
    ], "events": [(14, "flap"), (27, "hit"), (27, "sfx:boss_slam"), (46, "fold")]},
    # 栖落（循环 2 s）：呼吸、低头盯人（额头的鲛珠离地近）、翼尖抖一下、尾羽摆
    "perchRest": {"frames": 60, "loop": True, "keys": [
        K(0, rest()),
        K(20, rest(chest=2, head=-3, tip=-4, tail=3)),
        K(40, rest(chest=-1, head=3, tip=2, tail=-2)),
        K(60, rest()),
    ], "events": []},
    # 起飞：落台出手 4.0 s（起飞预警亮起）开始播——蹲下、双翼高举后掠、尾羽上翘（蓄）→ 第 18 帧颤一下 → 第 24 帧 = 4.8 s 一记猛扇离台（liftoff = 收招段开始：
    #   起飞翼风判定、风环、扶摇风线同一帧）→ 上收 → 第二扇 → 回盘旋
    "takeoff": {"frames": 48, "keys": [
        K(0, rest()),
        K(8, Q(root=10, bob=-0.2, chest=12, neck=4, head=6, spread=-32, sweep=24, curl=-10, tip=-8, low=10, tail=12, fan=8, thigh=12, shin=-6)),
        K(18, Q(root=11, bob=-0.26, chest=13, neck=4, head=7, spread=-36, sweep=28, curl=-12, tip=-10, low=12, tail=14, fan=10, thigh=14, shin=-8, roll=1.2)),
        K(22, Q(root=0, bob=-0.08, chest=4, spread=10, sweep=6, curl=2, tail=6, thigh=10)),
        K(24, Q(root=-10, bob=0.35, chest=-8, neck=-6, head=-10, spread=64, sweep=-20, curl=16, tip=12, low=-24, tail=-12, fan=12, thigh=40, shin=-20)),
        K(31, Q(root=-4, bob=0.2, chest=-4, head=-4, spread=-24, sweep=16, curl=-8, tip=-6, tail=-4, thigh=45, shin=-25)),
        K(38, Q(root=2, bob=0.25, chest=2, head=2, spread=50, sweep=-12, curl=12, tip=8, tail=6, thigh=40, shin=-22)),
        K(48, Q(root=4, spread=4, sweep=4, thigh=25)),
    ], "events": [(24, "liftoff"), (24, "sfx:boss_roar"), (38, "flap")]},
    # 倒下（4.0 s；倒下演出 4.4 s，第 3.87 s 溃散隐去）：模型往下掉由 KunPengDeath 按时间写（0.2 s 起加速下坠、2.4 s 触地 = 第 72 帧 land）
    #   失衡（第 3 帧：被打得往后一仰、往右一滚，左翼甩上去、右翼甩下来）→ 翼折（第 12 帧 wingBreak：左翼第二节往下一折）→ 右翼乱扑两下、头朝下栽
    #   → 第 72 帧胸口先着地（双翼摊开拍在冰上、尾羽被震得上翘、头颈往前甩）→ 弹一下 → 落定 → 第 88 帧最后抬头朝北冥一声（lastCry）→ 头落下、不动
    "death": {"frames": 120, "next": "deathRest", "keys": [
        K(0, []),
        K(3, Q(root=-14, chest=-10, neck=-14, head=-24, spread=6, sweep=-6, tail=-10, fan=14, thigh=-20, shin=10, roll=16,
               wl=dict(spread=-30, sweep=10), wr=dict(spread=30))),
        K(8, Q(root=4, chest=-2, neck=4, head=8, tail=6, fan=-6, thigh=-10, roll=24,
               wl=dict(spread=-8, sweep=24, curl=40, tip=22), wr=dict(spread=-28, sweep=16, curl=-8))),
        K(14, Q(root=14, chest=4, neck=12, head=18, tail=10, fan=-8, roll=32,
                wl=dict(spread=40, sweep=20, curl=60, tip=40, low=-6), wr=dict(spread=-36, sweep=18, curl=-10, tip=-8))),
        K(22, Q(root=34, chest=6, neck=10, head=20, tail=-14, fan=10, thigh=48, shin=-18, roll=38, wl=BROKEN, wr=dict(spread=-30, sweep=30, curl=-6))),
        K(34, Q(root=46, chest=6, neck=10, head=20, tail=-12, fan=8, thigh=50, shin=-20, roll=44, wl=BROKEN, wr=dict(spread=24, sweep=-6, curl=8))),
        K(46, Q(root=54, chest=6, neck=8, head=18, tail=-16, fan=10, thigh=50, shin=-20, roll=40, wl=BROKEN, wr=dict(spread=-32, sweep=32, curl=-8))),
        K(58, Q(root=60, chest=6, neck=6, head=14, tail=-14, fan=8, thigh=48, shin=-18, roll=34, wl=BROKEN, wr=dict(spread=14, sweep=-4, curl=6))),
        K(68, Q(root=66, chest=6, neck=4, head=8, tail=-16, fan=8, thigh=40, shin=-14, roll=26, wl=BROKEN, wr=dict(spread=-26, sweep=28, curl=-6))),
        K(72, Q(root=80, chest=10, neck=18, head=12, tail=-10, fan=8, thigh=40, shin=-10, roll=16,
                wl=dict(spread=46, sweep=-4, curl=40, tip=20, low=-12), wr=dict(spread=50, sweep=-8, curl=12, tip=8, low=-12), ground=-0.08)),
        K(75, Q(root=76, chest=8, neck=10, head=4, tail=-14, fan=-4, thigh=40, shin=-10, roll=14,
                wl=dict(spread=36, sweep=-2, curl=40, tip=18, low=-12), wr=dict(spread=40, sweep=-6, curl=10, tip=6, low=-12), ground=0.25)),
        K(80, Q(root=80, chest=10, neck=20, head=16, tail=-18, fan=-4, thigh=40, shin=-10, roll=16,
                wl=dict(spread=48, sweep=-4, curl=40, tip=20, low=-12), wr=dict(spread=50, sweep=-8, curl=12, tip=8, low=-12), ground=-0.08)),
        K(88, Q(root=78, chest=4, neck=-18, head=-24, tail=-16, fan=-2, thigh=40, shin=-10, roll=16,
                wl=dict(spread=48, sweep=-4, curl=40, tip=20, low=-12), wr=dict(spread=36, sweep=-10, curl=6, tip=4, low=-12), ground=-0.08)),
        K(100, Q(root=80, chest=12, neck=22, head=18, tail=-18, fan=-4, thigh=40, shin=-10, roll=16,
                 wl=dict(spread=50, sweep=-4, curl=40, tip=22, low=-12), wr=dict(spread=52, sweep=-8, curl=12, tip=10, low=-12), ground=-0.1)),
        K(110, Q(root=80, chest=13, neck=24, head=20, tail=-18, fan=-4, thigh=40, shin=-10, roll=16,
                 wl=dict(spread=50, sweep=-4, curl=40, tip=22, low=-12), wr=dict(spread=52, sweep=-8, curl=12, tip=10, low=-12), ground=-0.1)),
        K(120, Q(root=80, chest=13, neck=24, head=20, tail=-18, fan=-4, thigh=40, shin=-10, roll=16,
                 wl=dict(spread=50, sweep=-4, curl=40, tip=22, low=-12), wr=dict(spread=52, sweep=-8, curl=12, tip=10, low=-12), ground=-0.1)),
    ], "events": [(12, "wingBreak"), (34, "flail"), (58, "flail"), (72, "land"), (88, "lastCry"), (108, "still")]},
    "deathRest": {"frames": 60, "loop": True, "keys": [
        K(0, Q(root=80, chest=13, neck=24, head=20, tail=-18, fan=-4, thigh=40, shin=-10, roll=16,
               wl=dict(spread=50, sweep=-4, curl=40, tip=22, low=-12), wr=dict(spread=52, sweep=-8, curl=12, tip=10, low=-12), ground=-0.1)),
        K(30, Q(root=80, chest=14.5, neck=24, head=20, tail=-18, fan=-4, thigh=40, shin=-10, roll=16,
                wl=dict(spread=50, sweep=-4, curl=40, tip=24, low=-12), wr=dict(spread=52, sweep=-8, curl=12, tip=10, low=-12), ground=-0.1)),
        K(60, Q(root=80, chest=13, neck=24, head=20, tail=-18, fan=-4, thigh=40, shin=-10, roll=16,
                wl=dict(spread=50, sweep=-4, curl=40, tip=22, low=-12), wr=dict(spread=52, sweep=-8, curl=12, tip=10, low=-12), ground=-0.1)),
    ], "events": []},
}
CLIPS.update(CLIPS_B2)

ABOUT = ("鹏的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。at = 片段内归一化时刻。swoopReady / swoopHold / dive / gust / roar / spread / spreadShed / "
         "spreadEnd / perch / perchRest / takeoff / death / deathRest 是手工关键帧（art/source/characters/SK_Boss_Peng/anim/peng_anims.py 生成，别手改），"
         "其余是采样片段的手写叠加。hitOpen = 俯冲擦中判定起（整段线段检测），strike = 掠过玩家的扑击极限姿势，flap = 扇翼的每一下下扇（狂风的风浪按它发），"
         "gustStart = 狂风生效，cocked = 俯冲蓄满，spread = 化鹏长啸时双翼一字展开，projectile = 羽刃雨每一枚出手的甩翼，hit = 落台触地，fold = 敛翼，"
         "liftoff = 起飞猛扇离台（收招段开始），wingBreak = 倒下时翼折，flail = 坠落中乱扑，land = 倒下触地，lastCry = 最后抬头一声，still = 不动了")


_SOFT = {}


def lod0_low(meshes, soft=False) -> float:
    """LOD0 网格最低点（模型单位，相对模型原点）；soft = 不算须（barbel_*：软的，贴地时允许压进雪里）"""
    dg = bpy.context.evaluated_depsgraph_get()
    low = float("inf")
    for o in meshes:
        if not o.name.endswith("LOD0"):
            continue
        if o.name not in _SOFT:
            names = {g.index: g.name for g in o.vertex_groups}
            _SOFT[o.name] = {v.index for v in o.data.vertices
                             if v.groups and names[max(v.groups, key=lambda g: g.weight).group].startswith("barbel")}
        skip = _SOFT[o.name] if soft else ()
        ev = o.evaluated_get(dg)
        mw = ev.matrix_world
        for v in ev.data.vertices:
            if v.index not in skip:
                low = min(low, (mw @ v.co).z)
    return low


def resolve_ground(arm, meshes, nat):
    """把 ["root", "ground", 偏移] 换成实打实的 root 平移：摆好姿势、量 LOD0 最低点、平移到模型原点 + 偏移；打印每个落地姿势和爪子离地"""
    for name, clip in CLIPS.items():
        for frame, (bclip, bframe, ops) in clip["keys"]:
            g = [op for op in ops if op[1] == "ground"]
            if not g:
                continue
            ops[:] = [op for op in ops if op[1] != "ground"]
            kk.pose(arm, nat, (bclip, bframe, ops))
            low = lod0_low(meshes, soft=True)
            ops.append(["root", "loc", [0, 0, g[0][2] - low]])
            print(f"PENG_GROUND {name} f{frame}: 最低点 {low:+.2f} → {g[0][2]:+.2f}（root 平移 {g[0][2] - low:+.2f} 个单位）")


def report_feet(arm, meshes, nat):
    """落台 / 起飞每个关键姿势：LOD0 最低点和两爪的最低点（模型单位，地面 = 0；站着时应在 −0.45 … +0.1）"""
    for name in ("perch", "perchRest", "takeoff"):
        for frame, spec in CLIPS[name]["keys"]:
            kk.pose(arm, nat, spec)
            mw = arm.matrix_world
            feet = min((mw @ arm.pose.bones[f"talon_{s}"].tail).z for s in ("L", "R"))
            print(f"PENG_FEET {name} f{frame}: 网格最低 {lod0_low(meshes):+.2f}  爪尖 {feet:+.2f}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else UNITY / "Keyframed"
    review = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
    preview = Path(argv[argv.index("--preview") + 1]) if "--preview" in argv else None
    only = argv[argv.index("--only") + 1].split(",") if "--only" in argv else None
    arm, meshes = kk.load_rig(ASSET, keep_meshes=True)
    nat = kk.load_native(ASSET)
    resolve_ground(arm, meshes, nat)
    report_feet(arm, meshes, nat)
    if preview:
        sel = {n: {"keys": [k for k in c["keys"] if n != "gust" or k[0] in (0, 12, 54, 60, 68, 162, 174)]} for n, c in CLIPS.items()
               if not only or n in only}
        kk.render_keyposes(arm, meshes, nat, sel, preview)
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
    print("PENG_ANIMS " + json.dumps(report, ensure_ascii=False))


main()
