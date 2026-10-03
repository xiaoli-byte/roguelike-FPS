"""阶段 05 · 审核图：渲染成品效果、布线、LOD、姿势测试，拼成一张审核大图（人工闸门）。"""

from __future__ import annotations

import json

from PIL import Image, ImageDraw, ImageFont

from lib import blender
from lib.config import ROOT, AssetSpec, PipelineError
from lib.state import AssetState

TILE = (384, 512)
# 形变检测判据（用杂兵「面条腿」坏版本 v005 与修好的 v006 校准）：只看拉伸——
# 坏版本行走姿势拉伸 p99 = 2.68，好版本 1.32；压缩在举手时的肩部本来就大，不作判据
STRETCH_P99_LIMIT = 1.8
STRETCH_RATIO_LIMIT = 0.01

# 姿势测试：与游戏关节语义一致（局部欧拉角 XYZ，游戏坐标轴；见 src/enemies/Models.ts applyWalk）
HUMANOID_POSES = {
    # 游戏里的站立：手臂几乎垂下，肘部微屈
    "idle": {"armL": (0, 0, 0.06), "armR": (0, 0, -0.06), "elbowL": (-0.25, 0, 0), "elbowR": (-0.25, 0, 0)},
    # 步态相位 π/2、摆幅 0.7
    "walk": {"legL": (-0.7, 0, 0), "legR": (0.7, 0, 0), "kneeR": (0.6, 0, 0), "torso": (0.056, 0.084, 0),
             "armL": (0.525, 0, 0.06), "armR": (-0.525, 0, -0.06), "elbowL": (-0.53, 0, 0), "elbowR": (-0.25, 0, 0),
             "_hipsDrop": 0.0},
    # 近战举刀前摇：右臂高举、肘屈、躯干扭转
    "attack": {"armR": (-2.5, 0, -0.2), "elbowR": (-0.9, 0, 0), "armL": (0.3, 0, 0.25), "elbowL": (-0.6, 0, 0),
               "torso": (-0.15, 0.45, 0), "legL": (-0.35, 0, 0), "kneeL": (0.3, 0, 0), "legR": (0.25, 0, 0)},
}


def parts_poses(blockout_json, rom: dict | None = None, seed: int = 7) -> dict:
    """部件骨架的形变测试姿势。

    - 登记了 ROM（活动范围）姿势时用它：每个姿势是 {rig 字段名: [x, y, z]}，取自游戏招式代码里各关节的极限角度，
      经白模说明里的 fields 换成关节路径；未列出的关节保持构建姿势。这是游戏真正会摆出的姿势，形变检测按它判定。
    - 没有 ROM 时退回固定种子的随机扰动：每个非根节点在绑定旋转上叠加 ±0.35（a）/ ±0.6（b）弧度。
    """
    import random
    meta = json.loads(blockout_json.read_text(encoding="utf-8"))
    joints = meta["joints"]
    bind = {j["name"]: tuple(j["bindRotation"]) for j in joints}
    if rom:
        fields = meta.get("fields")
        if not fields:
            raise PipelineError("白模说明里没有 fields（rig 字段 → 关节）映射：用新版 exportEnemyParts 重新导出白模（几何不变时原地修订）")
        poses = {}
        for pname, spec_pose in rom.items():
            unknown = [f for f in spec_pose if f not in fields]
            if unknown:
                raise PipelineError(f"ROM 姿势 {pname} 里的字段不在 rig 上：{unknown}")
            poses[pname] = {**bind, **{fields[f]: tuple(v) for f, v in spec_pose.items()}}
        return poses
    poses = {}
    for name, amp in (("a", 0.35), ("b", 0.6)):
        rnd = random.Random(seed + len(name) + int(amp * 100))
        pose = {}
        for j in joints:
            if j["parent"] is None:
                continue
            bx, by, bz = j["bindRotation"]
            pose[j["name"]] = (bx + rnd.uniform(-amp, amp), by, bz + rnd.uniform(-amp, amp) * 0.6)
        poses[name] = pose
    return poses


def font(size: int):
    for name in ("msyh.ttc", "simhei.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def run(spec: AssetSpec, a) -> None:
    st = AssetState(spec)
    bd = st.require("build")
    va = st.current("validate")
    if not va or va.get("from_build") != bd["version"] or not va.get("passed"):
        raise PipelineError(f"{spec.id}: build v{bd['version']:03d} 还没有通过 validate，先运行 validate")
    tag = f"{spec.id}_v{bd['version']:03d}"
    work = spec.dir / "_tmp" / f"review_v{bd['version']:03d}"
    bo = st.require("blockout")
    metrics = json.loads(st.file(bd, f"{tag}_metrics.json").read_text(encoding="utf-8"))
    rom = spec.raw.get("rom") if spec.raw.get("rig") == "parts" else None
    if spec.kind != "skeletal":
        poses = {}
    elif spec.raw.get("rig") == "parts":
        poses = parts_poses(st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}.json"), rom)
    else:
        poses = HUMANOID_POSES
    res = blender.run("bl_review.py", {
        "glb": str(st.file(bd, f"{tag}.glb")), "out_dir": str(work), "tile": list(TILE),
        "blockout_json": str(st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}.json")),
        "bind_pose": metrics.get("bind_pose"),
        "presentation": metrics.get("presentation"),
        "poses": poses,
    }, work, "review")
    f = res["files"]

    rows = [
        ("成品（LOD0）", [f"beauty_{v}" for v in ("front", "left", "back", "right", "34")]),
        ("布线 LOD0 / 1 / 2", [k for k in ("wire_lod0", "wire_lod1", "wire_lod2") if k in f]),
    ]
    if spec.kind == "skeletal" and rom:
        names = list(rom)
        for i in range(0, len(names), 3):  # 每行三个姿势（正面 + 3/4）
            group = names[i:i + 3]
            rows.append(("ROM：" + " / ".join(group), [f"pose_{p}_{v}" for p in group for v in ("front", "34")]))
    elif spec.kind == "skeletal" and spec.raw.get("rig") == "parts":
        rows.append(("姿势：随机关节扰动 小 / 大", [f"pose_{p}_{v}" for p in ("a", "b") for v in ("front", "34")]))
    elif spec.kind == "skeletal":
        rows.append(("姿势：待机 / 行走 / 攻击", [f"pose_{p}_{v}" for p in ("idle", "walk", "attack") for v in ("front", "34")]))
    tex = sorted((st.file(bd, k) for k in bd["files"] if k.endswith(".png")), key=lambda p: p.name)
    label_w, head_h = 170, 70
    cols = 6
    sheet = Image.new("RGB", (label_w + TILE[0] * cols, head_h + TILE[1] * (len(rows) + 1)), (40, 38, 36))
    d = ImageDraw.Draw(sheet)
    lods = " / ".join(str(l["tris"]) for l in metrics["lods"])
    d.text((16, 14), f"{spec.id}  {spec.display}   build v{bd['version']:03d}   LOD 三角面 {lods}   贴图 {spec.texture}²   "
                     f"GLB {metrics['export']['bytes'] / 1024:.0f} KB   对齐 IoU {metrics['align']['iou']}", fill=(240, 230, 210), font=font(22))
    d.text((16, 42), f"校验：{va['warnings']} 警告 / {va['errors']} 错误    烘焙 {metrics.get('bake_device')}    审核：assetctl.py approve {spec.id} review --by <审核人>",
           fill=(180, 170, 150), font=font(16))
    for r, (label, keys) in enumerate(rows):
        y = head_h + r * TILE[1]
        d.text((14, y + 14), label, fill=(240, 230, 210), font=font(18))
        for c, k in enumerate(keys):
            if k in f:
                sheet.paste(Image.open(f[k]).convert("RGB"), (label_w + c * TILE[0], y))
    y = head_h + len(rows) * TILE[1]
    d.text((14, y + 14), "贴图 BC / N / ORM", fill=(240, 230, 210), font=font(18))
    for c, p in enumerate(tex[:cols]):
        im = Image.open(p).convert("RGB").resize((TILE[1] - 40, TILE[1] - 40))
        sheet.paste(im, (label_w + c * TILE[0], y + 20))
        d.text((label_w + c * TILE[0], y + 2), p.stem, fill=(200, 190, 170), font=font(14))
    deform = res.get("deformation") or {}
    flags = [f"{k} 拉伸 p99 {v['p99_stretch']}、过度拉伸边 {v['stretch_ratio']:.1%}" for k, v in deform.items()
             if v["p99_stretch"] > STRETCH_P99_LIMIT or v["stretch_ratio"] > STRETCH_RATIO_LIMIT]
    if deform:
        d.text((900, 42), "形变检测：" + ("；".join(flags) + "  ⚠ 请重点检查" if flags else "通过（拉伸 p99 " +
               " / ".join(f"{k} {v['p99_stretch']}" for k, v in deform.items()) + "）"),
               fill=(255, 120, 90) if flags else (150, 200, 150), font=font(16))
    out = spec.stage_dir("review") / f"{tag}_review.png"
    sheet.save(out)
    st.add_version("review", {"version": st.next_version("review"), "from_build": bd["version"],
                              "deformation": deform, "auto_flags": flags}, [out])
    for f_ in flags:
        print(f"  ⚠ 形变检测：{f_}（上限 p99 {STRETCH_P99_LIMIT} / {STRETCH_RATIO_LIMIT:.0%}），审核时重点看这个姿势")
    print(f"✔ 审核图：{out.relative_to(ROOT)}")
    print(f"  审核：assetctl.py approve {spec.id} review --by <审核人>   或   reject … --note <原因>")
