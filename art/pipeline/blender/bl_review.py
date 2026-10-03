"""阶段 05 · 审核图渲染：成品 GLB 的贴图效果 / 布线 / LOD / 姿势测试，交给人工审核。

姿势测试用和游戏完全相同的关节语义：关节局部位置 restLocal 固定，局部旋转为欧拉角（XYZ，游戏坐标轴），
关节世界变换 G = G_parent · T(restLocal) · R。蒙皮绑定在白模的绑定姿势（G_bind，上臂外展），
所以蒙皮变换 S = G_pose · G_bind⁻¹，骨骼姿势矩阵 = S · 骨骼静止矩阵。
这与游戏运行时 SkinnedMesh 的计算完全一致（boneInverses 取自绑定姿势下的关节 matrixWorld）。
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

from bl_common import args, clear_scene, finish, import_glb, log, ortho_camera, set_render, world_bbox  # noqa: E402

P = args()
clear_scene()
objs = import_glb(P["glb"])
meshes = sorted([o for o in objs if o.type == "MESH"], key=lambda o: o.name)
arm = next((o for o in objs if o.type == "ARMATURE"), None)
lod_objs = {o.get("lod", i): o for i, o in enumerate(meshes)}
if P.get("presentation"):  # 静态挂件：转成展示姿态（最长轴竖直）再拍
    M = Matrix(P["presentation"]).to_4x4()
    for o in [o for o in objs if o.parent is None]:
        o.matrix_world = M @ o.matrix_world
    bpy.context.view_layer.update()
# 自发光遮罩（T_*_E）在游戏里按实例着色（元素色 / 稀有度色），审核图统一染成青色、中等强度显示发光区域
for m in {s.material for o in meshes for s in o.material_slots if s.material}:
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None) if nt else None
    if bsdf and bsdf.inputs["Emission Color"].is_linked:
        src = bsdf.inputs["Emission Color"].links[0].from_socket
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(src, mul.inputs[6])
        mul.inputs[7].default_value = (0.25, 0.85, 1.0, 1.0)
        nt.links.new(mul.outputs[2], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.5
lo, hi = world_bbox([lod_objs[0]])
center = (lo + hi) / 2
height = hi.z - lo.z
out = Path(P["out_dir"])
out.mkdir(parents=True, exist_ok=True)

sc = bpy.context.scene
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.world = bpy.data.worlds.new("W")
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.55, 0.55, 0.58, 1)
bg.inputs[1].default_value = 0.6


def light(name, rot, energy, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, "SUN")
    d.energy = energy
    d.color = color
    o = bpy.data.objects.new(name, d)
    o.rotation_euler = rot
    sc.collection.objects.link(o)


light("key", (math.radians(50), 0, math.radians(-35)), 3.2, (1, 0.96, 0.9))
light("fill", (math.radians(65), 0, math.radians(140)), 1.0, (0.85, 0.9, 1))
light("rim", (math.radians(110), 0, math.radians(0)), 1.5)
tile = P["tile"]
set_render(tile[0], tile[1], transparent=False)
sc.view_settings.view_transform = "Standard"

ortho = max(height * 1.08, (hi.x - lo.x) * 1.08 * tile[1] / tile[0])
files = {}


def shot(key: str, view: str, yaw_deg: float = 0.0, c=None, scale=None):
    """c / scale：取景中心与正交尺寸（缺省 = 静止姿势的包围盒）。"""
    c = center if c is None else c
    cam = ortho_camera(f"cam_{key}", view, c, scale or ortho)
    if yaw_deg:
        cam.matrix_world = Matrix.Translation(c) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z") @ Matrix.Translation(-c) @ cam.matrix_world
    sc.camera = cam
    p = out / f"{key}.png"
    sc.render.filepath = str(p)
    bpy.ops.render.render(write_still=True)
    files[key] = str(p)


def only(obj):
    for o in meshes:
        o.hide_render = o is not obj


# 1) 成品效果：LOD0 四视图 + 3/4 视角
only(lod_objs[0])
for v in ("front", "left", "back", "right"):
    shot(f"beauty_{v}", v)
shot("beauty_34", "front", -35)

# 2) 布线：白模材质 + 线框（每级 LOD 正面）
clay = bpy.data.materials.new("clay")
clay.diffuse_color = (0.7, 0.7, 0.7, 1)
saved = {o.name: list(o.data.materials) for o in meshes}
for i, o in sorted(lod_objs.items()):
    o.data.materials.clear()
    o.data.materials.append(clay)
    wf = o.modifiers.new("wire", "WIREFRAME")
    wf.thickness = height * 0.0012
    wf.use_replace = False
    wf.material_offset = 1
    wf.use_even_offset = False  # 均匀厚度会按 1/sin(夹角) 放大尖角处的偏移，在细长三角形上甩出长刺（只是渲染假象）
    wire = bpy.data.materials.new(f"wire{i}")
    wire.use_nodes = True
    wire.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.05, 0.05, 0.05, 1)
    o.data.materials.append(wire)
    only(o)
    shot(f"wire_lod{i}", "front", -35)
    o.modifiers.remove(wf)
    o.data.materials.clear()
    for m in saved[o.name]:
        o.data.materials.append(m)

# 3) 姿势测试（骨骼网格）
poses = P.get("poses") or {}
if arm and poses:
    only(lod_objs[0])
    C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_4x4()  # 游戏坐标 → Blender 坐标
    Ci = C.inverted()
    A = arm.matrix_world.copy()
    if P.get("presentation"):  # 展示姿态只是整体摆放：姿势在模型空间里算
        A = Matrix(P["presentation"]).to_4x4().inverted() @ A
    Ai = A.inverted()
    joints = {j["name"]: j for j in json.loads(Path(P["blockout_json"]).read_text(encoding="utf-8"))["joints"]}
    bones = arm.data.bones
    order = []

    def visit(b):
        order.append(b.name)
        for c in b.children:
            visit(c)

    for b in bones:
        if b.parent is None:
            visit(b)

    def chain(rot: dict, drop: float = 0.0) -> dict:
        G = {}
        for name in order:
            j = joints[name]
            pos = Vector(j["restLocal"])
            if j["parent"] is None:
                pos.y -= drop
            local = Matrix.Translation(pos) @ Euler(rot.get(name, (0, 0, 0)), "XYZ").to_matrix().to_4x4()
            if "bindScale" in j:
                local = local @ Matrix.Diagonal((*j["bindScale"], 1.0))
            G[name] = (G[j["parent"]] @ local) if j["parent"] else local
        return G

    bind_rot = {n: list(j["bindRotation"]) for n, j in joints.items()}
    bp = P.get("bind_pose") or {}
    if "armSpreadL" in bp:  # 游戏化阶段的骨骼适配改过手臂绑定角
        bind_rot["armL"][2] = bp["armSpreadL"]
        bind_rot["armR"][2] = -bp["armSpreadR"]
    G_bind = chain(bind_rot)
    # 自动形变检测：姿势下每条边相对静止长度的比值；大面积过度拉伸 / 压缩说明权重有问题（静态校验看不出来）
    import numpy as np

    lod0 = lod_objs[0]

    def deformed_coords(obj):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        return co.reshape(-1, 3)

    edges = np.empty(len(lod0.data.edges) * 2, np.int64)
    lod0.data.edges.foreach_get("vertices", edges)
    edges = edges.reshape(-1, 2)
    rest = deformed_coords(lod0)
    rest_len = np.linalg.norm(rest[edges[:, 0]] - rest[edges[:, 1]], axis=1)
    valid = rest_len > 1e-5
    # 每个顶点的主导骨骼：用来报告过度拉伸集中在哪对骨骼之间（审核时直接知道该看哪里、该改哪条规则）
    gname = {g.index: g.name for g in lod0.vertex_groups}
    dom = [gname.get(max(v.groups, key=lambda g: g.weight).group, "?") if v.groups else "?" for v in lod0.data.vertices]
    ve = edges[valid]
    deform = {}
    for pname, pose in poses.items():
        G = chain(pose, pose.get("_hipsDrop", 0.0))
        for name in order:
            S = Ai @ C @ G[name] @ G_bind[name].inverted() @ Ci @ A
            arm.pose.bones[name].matrix = S @ bones[name].matrix_local
            bpy.context.view_layer.update()
        co = deformed_coords(lod0)
        ratio = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1)[valid] / rest_len[valid]
        bad = (ratio > 1.8) | (ratio < 0.55)
        pairs = {}
        for a, b in ve[ratio > 1.8]:
            k = " ↔ ".join(sorted((dom[a], dom[b])))
            pairs[k] = pairs.get(k, 0) + 1
        deform[pname] = {"bad_edge_ratio": round(float(bad.mean()), 4),
                         "stretch_ratio": round(float((ratio > 1.8).mean()), 4),
                         "p99_stretch": round(float(np.percentile(ratio, 99)), 3),
                         "p1_compress": round(float(np.percentile(ratio, 1)), 3),
                         "stretch_pairs": dict(sorted(pairs.items(), key=lambda kv: -kv[1])[:6])}
        log(f"形变 {pname}：异常边 {bad.mean():.2%}，拉伸 p99 {deform[pname]['p99_stretch']}，压缩 p1 {deform[pname]['p1_compress']}")
        # 按姿势后的包围盒取景（俯冲、跳劈这类整体倾斜的姿势会移出静止姿势的画框）；尺度不小于静止姿势，便于各姿势对比
        M = np.array(lod0.matrix_world)
        cw = co @ M[:3, :3].T + M[:3, 3]
        plo, phi = cw.min(0), cw.max(0)
        pc = Vector(((plo + phi) / 2).tolist())
        rxy = float(np.sqrt(((cw[:, :2] - (plo[:2] + phi[:2]) / 2) ** 2).sum(1)).max())
        pscale = max(ortho, float(phi[2] - plo[2]) * 1.08, 2 * rxy * 1.05 * tile[1] / tile[0])
        shot(f"pose_{pname}_front", "front", c=pc, scale=pscale)
        shot(f"pose_{pname}_34", "front", -50, c=pc, scale=pscale)
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
else:
    deform = {}

finish(P, {"files": files, "lods": {str(k): len(o.data.polygons) for k, o in lod_objs.items()}, "deformation": deform})
log(f"审核图 {len(files)} 张")
