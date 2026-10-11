"""九尾狐巫第九条尾巴（headless Blender，不花 Tripo 额度）。

    blender -b --factory-startup --python art/tools/foxwitch_ninth_tail.py -- [params.json]

Tripo 智能网格只生成了 8 条尾巴（左右各 4）。本脚本复制其中一条尾巴的网格（默认 L4：最完整、本身就是向上扬起的那条），
在尾根处用平面切开（切口是一圈平面环，补成封口），放大 1.08 倍后旋到两扇之间的正中，从腰后向上、向后扬起，
作为整扇的主尾；尾根封口埋进深衣的空腔里（从外面看不到切口）。UV 原样保留（复用同一块贴图），
逐角法线随旋转一起转（保留 Tripo 的硬边 / 平滑）。

输入：art/source/_tripo_inbox/20261010T151723_SK_Enemy_FoxWitch_smartmesh.fbx（只读，不改动）。
输出（art/source/characters/SK_Enemy_FoxWitch/02_highpoly/）：
  SK_Enemy_FoxWitch_ninetail_v001.fbx   编辑后的源网格（已按 build 的规则缩放落地：1.8 米高、包围盒居中，
                                         所以 build 再归一化时缩放 = 1、偏移 = 0，骨骼坐标直接可用）
  SK_Enemy_FoxWitch_ninetail_v001.blend 同一份网格（方便人工检查）
  SK_Enemy_FoxWitch_ninetail_v001.json  第九条尾巴的三节骨骼点（tail_C_1..3，建绑定用）、限制盒、面数统计

坐标与 creature_rigs/SK_Enemy_FoxWitch.json 一致：front = -Y，生物的左 = +X，up = +Z，米。
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
P = json.loads(Path(argv[0]).read_text(encoding="utf-8")) if argv else {}
SRC = ROOT / P.get("source", "art/source/_tripo_inbox/20261010T151723_SK_Enemy_FoxWitch_smartmesh.fbx")
RIG = json.loads((ROOT / "art/pipeline/creature_rigs/SK_Enemy_FoxWitch.json").read_text(encoding="utf-8"))
OUT_DIR = Path(P["out_dir"]) if "out_dir" in P else ROOT / "art/source/characters/SK_Enemy_FoxWitch/02_highpoly"
STEM = P.get("stem", "SK_Enemy_FoxWitch_ninetail_v001")
HEIGHT = float(RIG["height_m"])

TAIL = P.get("tail", "L4")              # 复制哪条尾巴
CUT = float(P.get("cut", 0.06))         # 尾根切面离尾根骨骼头多远（米，沿第一节骨骼）
SCALE = float(P.get("scale", 1.08))      # 主尾略大
ROOT_AT = Vector(P.get("root_at", [0.0, -0.15, 0.84]))   # 切口圆心放在哪（深衣空腔里）
TILT = math.radians(float(P.get("tilt_deg", 40)))       # 尾根 → 尾尖连线偏离竖直、向后倾的角度
BULGE = float(P.get("bulge", 1.0))      # 尾巴弯曲的鼓出方向：+1 向后（尾尖往前上方回卷），-1 向前
YAW = math.radians(float(P.get("yaw_deg", 0.0)))        # 可选：绕主轴转（让尾巴的扁面朝后）
Y_MAX = float(P.get("y_max", 0.384))    # 不能超出原包围盒（build 按包围盒居中，超了整个骨架会偏）
Z_MAX = float(P.get("z_max", 1.75))
TAPER = float(P.get("taper", 1.0))      # 尾根粗细系数（1 = 不收细）
TAPER_LEN = float(P.get("taper_len", 0.3))   # 收细段长度（米，沿主轴从切口算起）
TAPER_HOLD = float(P.get("taper_hold", 0.0))  # 从切口到这里保持最细，再到 TAPER_LEN 恢复原粗细


def log(msg: str) -> None:
    print(f"[ninetail] {msg}", flush=True)


# ───────────── 导入、按 build 的规则归一化（1.8 米、居中、落地） ─────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(SRC))
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
for o in bpy.context.view_layer.objects:
    o.select_set(False)
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = mesh.data
V = np.array([v.co[:] for v in me.vertices])
lo, hi = V.min(0), V.max(0)
s = HEIGHT / (hi[2] - lo[2])
off = np.array([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
# 法线先取出来（缩放是均匀的，方向不变）
nrm0 = np.array([n.vector[:] for n in me.corner_normals])
me.transform(Matrix.Translation(Vector(off.tolist())))
me.transform(Matrix.Scale(s, 4))
me.update()
V = np.array([v.co[:] for v in me.vertices])
bbox0 = (V.min(0), V.max(0))
tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
log(f"源网格 {len(V)} 顶点 / {tris0} 三角面，包围盒 {bbox0[0].round(4)} .. {bbox0[1].round(4)}")

att = me.attributes.new("nt_nrm", "FLOAT_VECTOR", "CORNER")
att.data.foreach_set("vector", nrm0.ravel())

bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()
uv = bm.loops.layers.uv.active
nl = bm.loops.layers.float_vector["nt_nrm"]
n_faces0 = len(bm.faces)


def chain(name: str) -> np.ndarray:
    b = RIG["bones"]
    return np.array([b[f"tail_{name}_1"]["head"], b[f"tail_{name}_1"]["tail"], b[f"tail_{name}_2"]["tail"],
                     b[f"tail_{name}_3"]["tail"]], float)


def island_faces(seed) -> list:
    seen, st = {seed}, [seed]
    while st:
        a = st.pop()
        for e in a.link_edges:
            b = e.other_vert(a)
            if b not in seen:
                seen.add(b)
                st.append(b)
    return list({f for v in seen for f in v.link_faces})


C = chain(TAIL)
d0 = (C[1] - C[0]) / np.linalg.norm(C[1] - C[0])
plane_co = C[0] + d0 * CUT
tip_v = bm.verts[int(np.argmin(np.linalg.norm(V - C[-1], axis=1)))]
src_faces = island_faces(tip_v)
log(f"尾巴 {TAIL} 所在网格岛：{len(src_faces)} 面")

# ───────────── 复制整个网格岛 → 在尾根切开 → 只留从尾尖连过来的那一段 ─────────────
dup = bmesh.ops.duplicate(bm, geom=src_faces)
dverts = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMVert)]
dgeom = dup["geom"]
vmap = dup["vert_map"]
tip_dup = vmap[tip_v]
res = bmesh.ops.bisect_plane(bm, geom=dgeom, plane_co=Vector(plane_co.tolist()), plane_no=Vector(d0.tolist()),
                             dist=1e-6, clear_inner=True)
cut_verts = {g for g in res["geom_cut"] if isinstance(g, bmesh.types.BMVert)}
# 从尾尖出发连通的部分（切面另一侧已删，邻近尾巴若在切面外侧和它分开，就不会被连上）
alive = set()
st = [tip_dup]
alive.add(tip_dup)
while st:
    a = st.pop()
    for e in a.link_edges:
        b = e.other_vert(a)
        if b not in alive:
            alive.add(b)
            st.append(b)
dup_all = set()
for g in res["geom"]:
    if isinstance(g, bmesh.types.BMVert) and g.is_valid:
        dup_all.add(g)
for v in dverts:
    if v.is_valid:
        dup_all.add(v)
junk = [v for v in dup_all if v not in alive]
bmesh.ops.delete(bm, geom=junk, context="VERTS")
tail_verts = [v for v in alive if v.is_valid]
tail_faces = list({f for v in tail_verts for f in v.link_faces})
loop_edges = [e for e in {e for v in tail_verts for e in v.link_edges}
              if e.is_boundary and all(v in cut_verts for v in e.verts)]
other_open = sum(1 for e in {e for v in tail_verts for e in v.link_edges} if e.is_boundary) - len(loop_edges)
log(f"切下的尾巴：{len(tail_verts)} 顶点 / {len(tail_faces)} 面；切口环 {len(loop_edges)} 条边，其他开口边 {other_open}")
if not loop_edges:
    raise SystemExit("切面没有切出封闭环")

# ───────────── 封口（埋在身体里，看不到；UV 取相邻面同一顶点的 UV） ─────────────
cap = bmesh.ops.contextual_create(bm, geom=loop_edges)
cap_faces = [f for f in cap["faces"]]
if not cap_faces:
    cap = bmesh.ops.holes_fill(bm, edges=loop_edges, sides=0)
    cap_faces = list(cap["faces"])
tri = bmesh.ops.triangulate(bm, faces=cap_faces)
cap_faces = list(tri["faces"]) or cap_faces
cut_center = np.array([v.co[:] for v in cut_verts if v.is_valid]).mean(0)
for f in cap_faces:
    # 封口朝里（法线指向尾根方向的反面 = 朝身体）
    if Vector(f.normal).dot(Vector(d0.tolist())) > 0:
        f.normal_flip()
# 封口所有角共用一个 UV（切口环上离图集边最远的那个点）：若沿用各顶点侧面的 UV，封口三角在 UV 里会翻折，
# build 的塌陷减面插值时会把 UV 外推到 0..1 之外（尾根环正好贴着图集下边）
ring_uvs = [l2[uv].uv.copy() for f in cap_faces for lp in f.loops for l2 in lp.vert.link_loops if l2.face not in cap_faces]
cap_uv = max(ring_uvs, key=lambda u: min(u.x, u.y, 1 - u.x, 1 - u.y))
for f in cap_faces:
    for lp in f.loops:
        lp[uv].uv = cap_uv
        lp[nl] = (-Vector(d0.tolist())).to_tuple()
tail_faces = list(set(tail_faces) | set(cap_faces))
tail_verts = list({v for f in tail_faces for v in f.verts})

# ───────────── 摆位：放大、旋到正中（主轴向上向后），切口圆心移到深衣空腔里 ─────────────
tip = C[-1]
a_s = (tip - cut_center) / np.linalg.norm(tip - cut_center)
mid = C[1:3].mean(0)
b_s = (mid - cut_center) - a_s * ((mid - cut_center) @ a_s)
b_s /= np.linalg.norm(b_s)
c_s = np.cross(a_s, b_s)
a_t = np.array([0.0, math.sin(TILT), math.cos(TILT)])           # 向上、向后（+Y = 后）
b_t = np.array([0.0, math.cos(TILT), -math.sin(TILT)]) * BULGE  # 在正中竖直面里、垂直于主轴
if YAW:
    q = Matrix.Rotation(YAW, 3, Vector(a_t.tolist()))
    b_t = np.array(q @ Vector(b_t.tolist()))
c_t = np.cross(a_t, b_t)
R = np.stack([a_t, b_t, c_t], 1) @ np.stack([a_s, b_s, c_s], 1).T
assert abs(np.linalg.det(R) - 1) < 1e-6
Rm = Matrix(R.tolist())
root_at = np.array(ROOT_AT[:])


def place(p: np.ndarray) -> np.ndarray:
    return root_at + R @ ((p - cut_center) * SCALE)




def taper(q: np.ndarray) -> np.ndarray:
    """尾根收细：离切口 h 米处，垂直于主轴的分量乘 g(h)：TAPER_HOLD 以内 = TAPER，到 TAPER_LEN 平滑恢复到 1。
    让尾根从两扇尾根骨骼之间穿过（否则热扩散会把尾根两侧的顶点分给 L3/L4/R3/R4 的第一节）。"""
    if TAPER >= 1:
        return q
    rel = q - root_at
    h = rel @ a_t
    u = np.clip((h - TAPER_HOLD) / max(TAPER_LEN - TAPER_HOLD, 1e-6), 0, 1)
    g = TAPER + (1 - TAPER) * u * u * (3 - 2 * u)
    return root_at + a_t * h + (rel - a_t * h) * g


for v in tail_verts:
    v.co = Vector(taper(place(np.array(v.co[:]))).tolist())
for f in tail_faces:
    for lp in f.loops:
        lp[nl] = (Rm @ Vector(lp[nl])).normalized().to_tuple()
bm.normal_update()
if TAPER < 1:
    # 收细改变了尾根一段的形状：那一段（不含封口）用重新算的平滑法线
    for f in tail_faces:
        if f in cap_faces:
            continue
        for lp in f.loops:
            if (np.array(lp.vert.co[:]) - root_at) @ a_t < TAPER_LEN * 1.2:
                lp[nl] = lp.vert.normal.normalized().to_tuple()
NV = np.array([v.co[:] for v in tail_verts])
nlo, nhi = NV.min(0), NV.max(0)
log(f"新尾巴包围盒 {nlo.round(3)} .. {nhi.round(3)}")
if nhi[1] > Y_MAX or nhi[2] > Z_MAX:
    raise SystemExit(f"新尾巴超出允许范围（y ≤ {Y_MAX}，z ≤ {Z_MAX}）：调小 tilt / scale 或移动 root_at")

bm.to_mesh(me)
bm.free()
me.update()
nrm = np.zeros(len(me.loops) * 3)
me.attributes["nt_nrm"].data.foreach_get("vector", nrm)
me.attributes.remove(me.attributes["nt_nrm"])
me.normals_split_custom_set(nrm.reshape(-1, 3).tolist())
me.update()
V2 = np.array([v.co[:] for v in me.vertices])
bbox1 = (V2.min(0), V2.max(0))
tris1 = sum(len(p.vertices) - 2 for p in me.polygons)
assert np.allclose(bbox0[0], bbox1[0], atol=1e-5) and np.allclose(bbox0[1], bbox1[1], atol=1e-5), (bbox0, bbox1)
log(f"编辑后 {len(V2)} 顶点 / {tris1} 三角面（+{tris1 - tris0}），包围盒不变")

# ───────────── 第九条尾巴的骨骼点（原尾巴的骨骼链跟着同一个变换走） ─────────────
CJ = np.array([place(p) for p in C])
# 第一节骨骼头放在切口圆心（尾巴从这里长出来）；原链的第一个点在切口后面、身体更深处
CJ[0] = root_at
pad = 0.04
box = [(nlo - pad).round(3).tolist(), (nhi + pad).round(3).tolist()]
info = {
    "source": str(SRC.relative_to(ROOT)).replace("\\", "/"),
    "tail_copied": TAIL, "cut_m": CUT, "scale": SCALE, "root_at": list(ROOT_AT), "tilt_deg": math.degrees(TILT),
    "bulge": BULGE, "rotation": R.round(6).tolist(), "cut_center_src": cut_center.round(4).tolist(),
    "verts_added": len(V2) - len(V), "tris": {"before": tris0, "after": tris1},
    "tail_bbox": [nlo.round(4).tolist(), nhi.round(4).tolist()], "limit_box": box,
    "chain": {"tail_C_1": [CJ[0].round(4).tolist(), CJ[1].round(4).tolist()],
              "tail_C_2": [CJ[1].round(4).tolist(), CJ[2].round(4).tolist()],
              "tail_C_3": [CJ[2].round(4).tolist(), CJ[3].round(4).tolist()]},
}
if P.get("dump_verts"):
    info["tail_verts"] = NV.round(4).tolist()
info["taper"] = [TAPER, TAPER_HOLD, TAPER_LEN]
OUT_DIR.mkdir(parents=True, exist_ok=True)
(OUT_DIR / f"{STEM}.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
log(json.dumps(info["chain"]))

mesh.name = "SK_Enemy_FoxWitch_ninetail"
bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / f"{STEM}.blend"), compress=True)
bpy.ops.export_scene.fbx(filepath=str(OUT_DIR / f"{STEM}.fbx"), use_selection=False, object_types={"MESH"},
                         path_mode="COPY", embed_textures=True, mesh_smooth_type="OFF", use_mesh_modifiers=False,
                         add_leaf_bones=False, bake_anim=False)
log(f"写出 {OUT_DIR / (STEM + '.fbx')}")
