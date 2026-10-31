"""第四章雷魅手工关键帧的共用部分（第四章移植 E 路；设计单 docs/art/vfx/foes-ch4.md）。各资产的脚本只写关键姿势：

    blender -b --factory-startup --python art/source/characters/SK_Enemy_Tiangou/anim/tiangou_anims.py -- [--review <目录>]

姿势写法（和网页 src/world/plateau/play/poses.ts 同一套模型空间，方便对照采样打底的姿势：X = 生物左侧，Y = 上，Z = 前；角度是度）：
  ("rot", 骨, 轴, 角)    绕模型空间的轴在骨头的关节处转（连同子骨），按列出的顺序执行（先父后子）：
                           绕 X 正转 = 往前低头 / 腿往后摆 / 尾巴往上翘；绕 Y 正转 = 往左转；绕 Z 正转 = 左侧往上抬（右侧乘 −1）
  ("loc", 骨, (x, y, z)) 在模型空间平移（米；蹲、跪、人立抬升只动 hips）
  both(骨, 轴, 角, mirror)  左右两侧一起（_L / _R；绕 Y、Z 的转动 mirror = True 时右侧取反）
关键帧 = (帧, 姿势) 或 (帧, 姿势, 缓动)：缓动管「从这一帧到下一帧」那一段——"in" 加速冲向下一帧（蓄力顶点 → 释放帧的 smear 段），
"out" 从这一帧减速出去（释放帧之后的余势），"back" 冲过头再回（follow-through），"lin" 匀速；默认 Bézier 自动钳制。
模型空间 → Blender 世界：glTF 导入后 front = −Y、up = +Z、left = +X，所以 (x, y, z) → (x, −z, y)（行列式 1，转角不用换号）。
导出设置同 qilin_anims.py / bl_unity_export：顶层物体绕 Z 转 180°、−Z 前 / Y 上、主骨轴 Y；Unity 侧 Generic，NativeClipBuilder 按骨骼名接到本体（同名覆盖采样片段）。
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[4]
FPS = 30
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REVIEW = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
ONLY = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None


def to_blender(v):
    x, y, z = v
    return Vector((x, -z, y))


def rot(bone, axis, deg):
    return ("rot", bone, axis, deg)


def loc(bone, x=0.0, y=0.0, z=0.0):
    return ("loc", bone, (x, y, z))


def both(bone, axis, deg, mirror=False):
    """左右两侧：绕 X（俯仰 / 前后摆）两侧同号；绕 Y、Z（转向 / 侧抬）mirror 时右侧取反"""
    sr = -deg if mirror else deg
    return [rot(f"{bone}_L", axis, deg), rot(f"{bone}_R", axis, sr)]


def flat(*ops):
    out = []
    for o in ops:
        if isinstance(o, list):
            out += flat(*o)
        elif o is not None:
            out.append(o)
    return out


# ───────────── Blender ─────────────
def load_rig(asset: str, keep_meshes: bool):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / f"public/assets/characters/{asset}.glb"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if not keep_meshes or o.parent != arm:
            bpy.data.objects.remove(o)
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def reset(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def apply(arm, ops) -> list:
    """按顺序执行一个关键姿势（转动绕骨头当前的关节、模型空间的轴），返回执行了的操作（审核用）"""
    done = []
    names = {pb.name for pb in arm.pose.bones}
    for kind, bone, a, b in [(o[0], o[1], o[2], o[3] if len(o) > 3 else None) for o in ops]:
        if bone not in names:
            continue
        pb = arm.pose.bones[bone]
        if kind == "rot":
            if abs(b) < 1e-6:
                continue
            m = pb.matrix.copy()
            head = m.translation.copy()
            pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(math.radians(b), 4, to_blender(a)) @ Matrix.Translation(-head) @ m
        else:
            pb.matrix = Matrix.Translation(to_blender(a)) @ pb.matrix
        bpy.context.view_layer.update()
        done.append([bone, kind, list(a) if kind == "loc" else [list(a), round(b, 2)]])
    return done


def fcurves(act) -> list:
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


EASE = {"in": ("BEZIER", "EASE_IN"), "out": ("BEZIER", "EASE_OUT"), "back": ("BACK", "EASE_OUT"), "lin": ("LINEAR", "AUTO")}


def bake_clip(arm, name: str, clip: dict):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    bones = [pb.name for pb in arm.pose.bones]
    prev = {}
    eases = {}
    for key in clip["keys"]:
        frame, ops = key[0], key[1]
        eases[frame] = key[2] if len(key) > 2 else None
        reset(arm)
        apply(arm, ops)
        for b in bones:
            pb = arm.pose.bones[b]
            q = pb.rotation_quaternion.copy()
            if b in prev and q.dot(prev[b]) < 0:
                q.negate()
                pb.rotation_quaternion = q
            prev[b] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=b)
            if b == "hips":
                pb.keyframe_insert("location", frame=frame, group=b)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
            e = eases.get(int(round(kp.co.x)))
            if e:
                kp.interpolation, kp.easing = EASE[e]
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


def merge_events(path: Path, clips: dict, script: str):
    """把手 K 片段的事件写进 Anim/<资产>.events.json（只改这几项，其余状态原样保留；一个事件一行）"""
    doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"schema": 1, "clips": {}}
    out = doc.get("clips", {})
    for name, c in clips.items():
        out[name] = [{"at": round(min(1.0, f / c["frames"]), 4), "name": n} for f, n in c["events"]]
    about = doc.get("about", "")
    note = f"手 K 的状态（{' / '.join(clips)}）由 {script} 生成，别手改。"
    if note not in about:
        about = (about.rstrip("。 ") + "；" + note) if about else note
    lines = ["{", '  "schema": 1,', f'  "about": {json.dumps(about, ensure_ascii=False)},', '  "clips": {']
    names = list(out)
    for i, name in enumerate(names):
        evs = out[name]
        if isinstance(evs, dict):
            lines.append(f"    {json.dumps(name)}: {json.dumps(evs, ensure_ascii=False)}" + ("," if i < len(names) - 1 else ""))
            continue
        body = ",\n".join("      " + json.dumps(e, ensure_ascii=False).replace("{", "{ ").replace("}", " }") for e in evs)
        lines.append(f"    {json.dumps(name)}: [\n{body}\n    ]" + ("," if i < len(names) - 1 else ""))
    lines += ["  }", "}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def review(arm, clips: dict, out: Path, ortho=4.0, centre=(0, 0, 1.0)):
    """每段关键帧的侧视 / 3/4 视联系表（Workbench 贴图着色，审核用，不入库）"""
    out.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 320, 320
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.16, 0.17, 0.2)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    c = Vector(centre)
    tiles = []
    for name, clip in clips.items():
        if ONLY and name not in ONLY:
            continue
        for key in clip["keys"]:
            frame, ops = key[0], key[1]
            reset(arm)
            apply(arm, ops)
            for view, yaw, up in (("side", 90, 0.08), ("q", 35, 0.25)):
                a = math.radians(yaw)
                d = Vector((math.sin(a), -math.cos(a), up)).normalized()
                cam.location = c + d * 30
                cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
                p = out / f"_{name}_{frame:05.1f}_{view}.png"
                sc.render.filepath = str(p)
                bpy.ops.render.render(write_still=True)
                tiles.append([name, frame, view, str(p)])
    (out / "tiles.json").write_text(json.dumps(tiles, ensure_ascii=False), encoding="utf-8")


def run(asset: str, clips: dict, script: str, ortho=4.0, centre=(0, 0, 1.0)):
    unity = ROOT / f"unity/Assets/Art/Characters/{asset}/Anim"
    arm = load_rig(asset, keep_meshes=REVIEW is not None)
    reset(arm)
    if REVIEW:
        review(arm, clips, REVIEW, ortho, centre)
        print("PLATEAU_REVIEW " + asset + " " + str(REVIEW))
        return
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    keep = bpy.data.objects.new(f"{asset}_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report = {}
    for name, clip in clips.items():
        act = bake_clip(arm, name, clip)
        export_fbx(arm, act, name, clip["frames"], unity / "Keyframed")
        report[name] = {"seconds": round(clip["frames"] / FPS, 3), "keys": [k[0] for k in clip["keys"]],
                        "events": [[round(f / clip["frames"], 3), n] for f, n in clip["events"]]}
    merge_events(unity / f"{asset}.events.json", clips, script)
    print("PLATEAU_ANIMS " + asset + " " + json.dumps(report, ensure_ascii=False))
