"""Tripo 灵宠 GLB → Unity FBX + 底色贴图（在 Blender 里运行，由 art/pipeline/pet_export.py 调用）。

第一版灵宠是静态网格（docs/pet-system.md 第 7 节）：
1. 导入 Tripo 导出的 GLB，合并成一个网格，应用变换；
2. 按设计尺寸缩放（`size` 量的是 `measure` 轴：height = 竖直高度，span = 最长水平边），脚底落到 z=0，水平居中；
3. 底色贴图另存为 PNG（缩到 `texture` 边长），FBX 不嵌贴图；
4. 和 bl_unity_export.py 同一套坐标约定：Blender 里朝 −Y，导出前根节点绕 Z 转 180°，FBX −Z 前 / Y 上，
   Unity 打开 bakeAxisConversion 后朝 +Z、Y 向上、1 单位 = 1 米。
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bl_common import args, clear_scene, finish, import_glb, log, world_bbox  # noqa: E402


def main() -> None:
    p = args()
    clear_scene()
    objs = import_glb(p["glb"])
    meshes = [o for o in objs if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("GLB 里没有网格")
    # 去掉骨架 / 空物体的父子关系，保留世界变换后合并
    for m in meshes:
        mw = m.matrix_world.copy()
        m.parent = None
        m.matrix_world = mw
    for o in objs:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 朝向：Tripo 多视图的「正面」在 glTF +Z，导入后是 Blender −Y；需要时可额外绕 Z 转（yaw_deg）
    if p.get("yaw_deg"):
        body.data.transform(Matrix.Rotation(math.radians(p["yaw_deg"]), 4, "Z"))

    lo, hi = world_bbox([body])
    dims = hi - lo
    measure = p.get("measure", "height")
    current = dims.z if measure == "height" else max(dims.x, dims.y)
    s = p["size"] / max(current, 1e-6)
    center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    body.data.transform(Matrix.Translation(-center))
    body.data.transform(Matrix.Scale(s, 4))
    body.data.update()
    bpy.context.view_layer.update()
    vs = [v.co for v in body.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    log(f"缩放 ×{s:.3f} → {hi.x - lo.x:.2f} × {hi.y - lo.y:.2f} × {hi.z - lo.z:.2f} m")

    body.name = p["asset"]
    body.data.name = p["asset"]
    # 平滑着色：Tripo 智能网格是低模，按角度自动平滑，保留硬边
    for poly in body.data.polygons:
        poly.use_smooth = True
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(50))
    except Exception:
        pass

    # 底色贴图
    tex_out = Path(p["texture_dir"])
    tex_out.mkdir(parents=True, exist_ok=True)
    saved = None
    for mat in [s.material for s in body.material_slots if s.material]:
        if not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        link = next(iter(bsdf.inputs["Base Color"].links), None)
        node = link.from_node if link else None
        while node and node.type != "TEX_IMAGE":
            ins = [i for i in node.inputs if i.links]
            node = ins[0].links[0].from_node if ins else None
        if node and node.image:
            img = node.image
            size = p.get("texture", 1024)
            if max(img.size) > size:
                img.scale(size, size)
            path = tex_out / f"{p['asset']}_BaseColor.png"
            img.filepath_raw = str(path)
            img.file_format = "PNG"
            img.save()
            saved = str(path)
            break
    log(f"贴图：{saved or '没有底色贴图'}")
    # 只留一个材质槽，名字固定（Unity 端按名字建材质）
    body.data.materials.clear()
    body.data.materials.append(bpy.data.materials.new(f"M_{p['asset']}"))

    tris = sum(len(poly.vertices) - 2 for poly in body.data.polygons)
    flip = Matrix.Rotation(math.pi, 4, "Z")
    body.matrix_world = flip @ body.matrix_world
    bpy.context.view_layer.update()
    out = Path(p["fbx"])
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=str(out),
        use_selection=False,
        object_types={"MESH"},
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS",
        axis_forward="-Z",
        axis_up="Y",
        bake_space_transform=False,
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        use_tspace=False,
        use_custom_props=False,
        bake_anim=False,
        path_mode="STRIP",
        embed_textures=False,
    )
    log(f"导出 {out.name}（{out.stat().st_size // 1024} KB，{tris} 三角面）")
    finish(p, {"tris": tris, "texture": saved, "dims": [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z], "scale": s})


main()
