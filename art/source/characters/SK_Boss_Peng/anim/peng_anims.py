"""鹏（SK_Boss_Peng）的手工关键帧（K 路「首领与精英动作 · 特效调优」）：Blender 无头脚本，一次生成全部片段。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Peng/anim/peng_anims.py -- [--out <目录>] [--review <poses.json>] [--preview <目录>]

产出（FBX 不入库，可重新生成）：
  unity/Assets/Art/Characters/SK_Boss_Peng/Anim/Keyframed/<状态>.fbx   swoopReady、swoopHold（新状态，循环）、dive、gust、roar（同名覆盖 E5 的采样片段）
  unity/Assets/Art/Characters/SK_Boss_Peng/Anim/SK_Boss_Peng.events.json   只改写这五个状态的条目
写法、坐标见 ../../SK_Boss_Kun/anim/kunpeng_keys.py（鲲鹏共用）；设计单 docs/art/vfx/kunpeng.md。

鹏的骨架：root（俯仰写在这里）→ hips → chest → neck → head；chest 两侧 wing_*_1 → 2 → 3（绑定姿势是举成 V 形的双翼，约 47° 朝上外张）、
wing_*_low（下翼片，朝下外张）；hips → tail_1 → 2 → 3、thigh → shin → talon。
  翅膀（左翼，右翼镜像）：绕 Y 正转 = 往外放平 / 下扇（V 形 → 一字展开 → 压到水平以下），负转 = 往上合拢；绕 Z 正转 = 翼尖往后掠，负转 = 往前兜。
  尾羽：绕 X 正转 = 上翘；腿：绕 X 正转 = 往后收、负转 = 往前探爪。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "SK_Boss_Kun" / "anim"))
import kunpeng_keys as kk  # noqa: E402
from kunpeng_keys import X, Y, Z  # noqa: E402

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

ABOUT = ("鹏的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。at = 片段内归一化时刻。swoopReady / swoopHold / dive / gust / roar 是手工关键帧"
         "（art/source/characters/SK_Boss_Peng/anim/peng_anims.py 生成这四条，别手改），其余是采样片段的手写叠加。hitOpen = 俯冲擦中判定起"
         "（整段线段检测），strike = 掠过玩家的扑击极限姿势，flap = 扇翼的每一下下扇（狂风的风浪按它发），gustStart = 狂风生效，"
         "cocked = 俯冲蓄满，spread = 化鹏长啸时双翼一字展开")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else UNITY / "Keyframed"
    review = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
    preview = Path(argv[argv.index("--preview") + 1]) if "--preview" in argv else None
    arm, meshes = kk.load_rig(ASSET, keep_meshes=preview is not None)
    nat = kk.load_native(ASSET)
    if preview:
        sel = {n: {"keys": [k for k in c["keys"] if n != "gust" or k[0] in (0, 12, 54, 60, 68, 162, 174)]} for n, c in CLIPS.items()}
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
