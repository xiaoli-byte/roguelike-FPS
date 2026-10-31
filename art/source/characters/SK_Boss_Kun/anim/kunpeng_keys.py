"""鲲 / 鹏手工关键帧的公共部分（Blender 无头脚本 kun_anims.py / ../../SK_Boss_Peng/anim/peng_anims.py 共用）。

两只都是 Generic 骨架（不是人形）：Unity 按骨骼名把关键帧 FBX 的局部变换曲线重定向到本体（NativeClipBuilder.CopyKeyframed，
丢掉 Animator 根物体自己的曲线，骨骼 root 的曲线保留）。所以：
  · 骨架、绑定姿势必须和本体一样：都从发布的 public/assets/characters/<资产>.glb 导入，导出设置照 bl_unity_export.py
    （顶层物体绕 Z 转 180°、-Z 前 / Y 上、主骨轴 Y，再放一个顶层空物体，同旱魃 hanba_anims.py）；
  · 鲲的「绕水线俯仰升降」宿主运动在 root 骨上（E5 采样片段约定：root 抬高 10 个模型单位 = 13 m，KunPengBrain 按 root 离原点
    4 个单位以上判定片段烘过宿主运动），手 K 的片段同样要把 root 抬起来，俯仰也写在 root 上；鹏的俯仰同样在 root 上。

姿势 = 底姿（Three.js 采样片段的某一帧，<资产>.native-anim.json，保证和没替换的片段接得上）+ 手 K 的增量：
  ops 依次执行，每条 [骨, 轴, 角度] 绕该骨头部、按 Blender 世界轴转（连同子骨）；[骨, "loc", [dx, dy, dz]] 平移（米，只给 root）。
  Blender 坐标：front = -Y，生物的左 = +X，up = +Z。绕 X 正转 = 低头 / 前倾（头往 -Y、往下），负转 = 仰头 / 后仰；
  绕 Z 正转 = 转向生物的左；绕 Y 正转 = 向生物的右侧滚。
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[5]
FPS = 30
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


# ───────────── 骨架 / 采样底姿 ─────────────
def load_rig(asset: str, keep_meshes=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    glb = ROOT / f"public/assets/characters/{asset}.glb"
    hi = glb.with_name(glb.stem + "@hi.glb")
    bpy.ops.import_scene.gltf(filepath=str(hi if hi.exists() else glb))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not keep_meshes:
        for o in meshes:
            bpy.data.objects.remove(o)
        meshes = []
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm, meshes


def load_native(asset: str) -> dict:
    p = ROOT / f"unity/Assets/Art/Characters/{asset}/Anim/{asset}.native-anim.json"
    return json.loads(p.read_text(encoding="utf-8"))


def _g2b(v) -> Vector:
    """glTF / Three.js 模型空间（Y 上、+Z 前）→ Blender（Z 上、-Y 前）"""
    return Vector((v[0], -v[2], v[1]))


def _q(f, i) -> Quaternion:
    x, y, z, w = f[i:i + 4]
    return Quaternion((w, x, -z, y))  # 轴按 _g2b 换算


def depth_order(arm) -> list:
    def depth(b):
        n = 0
        while b.parent:
            b, n = b.parent, n + 1
        return n
    return sorted(arm.pose.bones, key=lambda pb: depth(pb.bone))


def reset(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def set_native(arm, nat: dict, clip: str, frame: int):
    """把采样片段 clip 的第 frame 帧（负数 = 倒数）摆到骨架上：每根骨的世界旋转增量 + 绝对位置（只有 root 带位移，其余骨长度不变）"""
    reset(arm)
    bones = nat["bones"]
    rest = nat["rest"]
    frames = nat["clips"][clip]["frames"]
    fr = frames[frame]
    idx = {b: i for i, b in enumerate(bones)}
    for pb in depth_order(arm):
        i = idx.get(pb.name)
        if i is None:
            continue
        d = _q(fr, i * 7) @ _q(rest, i * 7).inverted()
        m0 = pb.bone.matrix_local.copy()
        r0 = m0.to_3x3().to_4x4()
        head = _g2b(fr[i * 7 + 4:i * 7 + 7]) if pb.name == "root" else None
        if head is None:
            pb.matrix = Matrix.Translation(pb.matrix.translation if pb.parent else m0.translation) @ d.to_matrix().to_4x4() @ r0
            pb.location = (0, 0, 0)
        else:
            pb.matrix = Matrix.Translation(head) @ d.to_matrix().to_4x4() @ r0
        pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()


def apply(arm, ops) -> list:
    """依次执行增量（绕骨头部、世界轴），返回解算后的 [骨, 轴, 角度] / [骨, "loc", 位移]（审核用）"""
    done = []
    for bone, kind, v in ops:
        pb = arm.pose.bones[bone]
        m = pb.matrix.copy()
        if kind == "loc":
            pb.matrix = Matrix.Translation(Vector(v)) @ m
            done.append([bone, "loc", list(v)])
        else:
            axis, ang = Vector(kind).normalized(), math.radians(v)
            if abs(ang) < 1e-6:
                continue
            head = m.translation.copy()
            pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-head) @ m
            if bone != "root":
                pb.location = (0, 0, 0)
            done.append([bone, [round(c, 5) for c in axis], round(v, 3)])
        pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
    return done


def pose(arm, nat, spec) -> list:
    """spec = (采样片段, 帧, ops)"""
    clip, frame, ops = spec
    set_native(arm, nat, clip, frame)
    return apply(arm, ops)


# ───────────── 烘片段 / 导出 ─────────────
def fcurves(act) -> list:
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def bake_clip(arm, nat, name: str, clip: dict):
    """clip = {frames, keys: [(帧, (采样片段, 帧, ops))], loop?}；每个关键帧给所有骨骼打旋转（root 另打位置）"""
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    prev, resolved = {}, []
    for frame, spec in clip["keys"]:
        resolved.append((frame, pose(arm, nat, spec)))
        for pb in arm.pose.bones:
            q = pb.rotation_quaternion.copy()
            if pb.name in prev and q.dot(prev[pb.name]) < 0:
                q.negate()
                pb.rotation_quaternion = q
            prev[pb.name] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)
            if pb.name == "root":
                pb.keyframe_insert("location", frame=frame, group=pb.name)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        if clip.get("loop"):
            fc.modifiers.new("CYCLES")
    return act, resolved


def prepare_export(arm, asset: str):
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    keep = bpy.data.objects.new(f"{asset}_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)


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


# ───────────── 事件叠加表 ─────────────
def write_events(path: Path, clips: dict, about: str = None):
    """把手 K 的片段写进 events.json：只替换这些状态的条目（对象形式：events / next / loop），其余状态原样保留；每个事件一行"""
    doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"schema": 1, "clips": {}}
    if about:
        doc["about"] = about
    for name, c in clips.items():
        entry = {"events": [{"at": round(f / c["frames"], 4), "name": n} for f, n in c.get("events", [])]}
        if c.get("next"):
            entry["next"] = c["next"]
        entry["loop"] = bool(c.get("loop"))
        entry["keyframed"] = True
        doc["clips"][name] = entry
    lines = ["{", f'  "schema": {json.dumps(doc.get("schema", 1))},', f'  "about": {json.dumps(doc.get("about", ""), ensure_ascii=False)},', '  "clips": {']
    names = list(doc["clips"].keys())
    for k, name in enumerate(names):
        c = doc["clips"][name]
        tail = "," if k < len(names) - 1 else ""
        evs = c if isinstance(c, list) else c.get("events", [])
        ev_lines = [f'      {{ "at": {e["at"]}, "name": {json.dumps(e["name"], ensure_ascii=False)} }}' for e in evs]
        if isinstance(c, list):
            lines.append(f'    {json.dumps(name)}: [')
            lines += [l + ("," if i < len(ev_lines) - 1 else "") for i, l in enumerate(ev_lines)]
            lines.append(f"    ]{tail}")
        else:
            lines.append(f'    {json.dumps(name)}: {{')
            extra = [(k2, v) for k2, v in c.items() if k2 != "events"]
            lines.append('      "events": [' + ("" if ev_lines else "]" + ("," if extra else "")))
            if ev_lines:
                lines += ["  " + l + ("," if i < len(ev_lines) - 1 else "") for i, l in enumerate(ev_lines)]
                lines.append("      ]" + ("," if extra else ""))
            for i, (k2, v) in enumerate(extra):
                lines.append(f'      {json.dumps(k2)}: {json.dumps(v, ensure_ascii=False)}' + ("," if i < len(extra) - 1 else ""))
            lines.append(f"    }}{tail}")
    lines += ["  }", "}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ───────────── 关键姿势预览（Workbench 正交侧视 + 3/4 前视，审核用） ─────────────
def render_keyposes(arm, meshes, nat, clips: dict, out_dir: Path, size=(360, 360)):
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w") if not scene.world else scene.world
    scene.world = world
    cam_data = bpy.data.cameras.new("rev")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("rev", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = []
    for name, clip in clips.items():
        for frame, spec in clip["keys"]:
            pose(arm, nat, spec)
            mw = arm.matrix_world
            pts = [mw @ pb.head for pb in arm.pose.bones if pb.name != "root"] + [mw @ pb.tail for pb in arm.pose.bones if pb.name != "root"]
            lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
            hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            c = (lo + hi) / 2
            ext = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) * 1.55
            for view, d in (("side", Vector((1, 0, 0))), ("front", Vector((0.55, -0.83, 0.12)).normalized())):
                cam.location = c + d * 60
                cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
                cam_data.ortho_scale = ext
                f = out_dir / f"{name}_{frame:03d}_{view}.png"
                scene.render.filepath = str(f)
                bpy.ops.render.render(write_still=True)
                shots.append({"clip": name, "frame": frame, "view": view, "file": f.name})
    (out_dir / "shots.json").write_text(json.dumps(shots, ensure_ascii=False), encoding="utf-8")
    return shots
