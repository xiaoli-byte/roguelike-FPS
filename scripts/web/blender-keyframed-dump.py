"""Blender 手 K 片段 → 网页动画数据的中间件（M12 第二期）。不改各资产的 *_anims.py，原样跑它们的 main()：

    blender -b --factory-startup --python scripts/web/blender-keyframed-dump.py -- \
        --kd-script art/source/characters/SK_Boss_Kun/anim/kun_anims.py --kd-asset SK_Boss_Kun --kd-dump <out.json> [脚本自己的参数…]

一般不直接跑，用 node scripts/web/export-keyframed-anims.mjs（它按表调本脚本，再交给 export-native-anims.mjs 并进 public/assets/anim/）。

做法：
  · bpy.ops.export_scene.fbx 换成采样器：脚本每导一段 FBX（文件名 = Animator 状态名），就在同一个帧区间（frame_start..frame_end，
    和 FBX 的 bake_anim_force_startend_keying / step 1 一样逐整帧）读每根骨骼的模型空间矩阵，换成 glTF 坐标（Y 上、+Z 前）记下来；
  · bpy.ops.import_scene.* 包一层：记住导入时骨架物体的世界矩阵（= GLB 场景空间）。脚本导出前把顶层物体绕 Z 转 180°（给 Unity 的约定），
    采样用导入时的矩阵，不受这一转影响；
  · 往 unity/ 里写的文件（事件叠加表）一律拦下不写：Unity 已冻结，事件以入库的 *.events.json 为准；
  · 读不到的 unity/ 文件（*.native-anim.json 不入库）退到主工作区去读（本仓库是 git worktree 时）。

输出（和 *.native-anim.json 同一种排版，export-native-anims.mjs 当第二个数据源用）：
  { schema, asset, fps, source: 'blender', script, bones: [名], rest: [每根 qx,qy,qz,qw,px,py,pz（模型空间）],
    clips: { 状态: { frames: [[每根 7 个数]…] } } }
  朝向含 Blender 骨骼自己的轴约定（导入时按骨骼朝向重排过轴）：导出端按「增量 = q(t)·q_rest⁻¹」用，同一根骨骼的轴约定抵消掉。
"""
import json
import runpy
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]


def main_checkout() -> Path:
    dot = ROOT / ".git"
    if dot.is_file():
        text = dot.read_text(encoding="utf-8")
        for line in text.splitlines():
            if line.startswith("gitdir:"):
                return Path(line.split(":", 1)[1].strip()).resolve().parents[2]
    return ROOT


MAIN = main_checkout()
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name: str):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else None


SCRIPT = Path(opt("--kd-script")).resolve()
ASSET = opt("--kd-asset")
DUMP = Path(opt("--kd-dump")).resolve()

# ───────────── 只读 unity/、读不到退主工作区 ─────────────
_unity_roots = [(ROOT / "unity").resolve(), (MAIN / "unity").resolve()]
blocked = []
_write_text, _write_bytes, _read_text, _read_bytes = Path.write_text, Path.write_bytes, Path.read_text, Path.read_bytes


def _in_unity(p: Path) -> bool:
    rp = p.resolve()
    return any(rp == u or u in rp.parents for u in _unity_roots)


def _fallback(p: Path) -> Path:
    if p.exists() or MAIN == ROOT:
        return p
    try:
        rel = p.resolve().relative_to(ROOT)
    except ValueError:
        return p
    alt = MAIN / rel
    return alt if alt.exists() else p


def write_text(self, *a, **k):
    if _in_unity(self):
        blocked.append(str(self))
        return 0
    return _write_text(self, *a, **k)


def write_bytes(self, *a, **k):
    if _in_unity(self):
        blocked.append(str(self))
        return 0
    return _write_bytes(self, *a, **k)


Path.write_text = write_text
Path.write_bytes = write_bytes
Path.read_text = lambda self, *a, **k: _read_text(_fallback(self), *a, **k)
Path.read_bytes = lambda self, *a, **k: _read_bytes(_fallback(self), *a, **k)

# ───────────── 导入：记住骨架物体的世界矩阵 ─────────────
import_mw = {}
_real_import = bpy.ops.import_scene
_real_export = bpy.ops.export_scene


class _ImportScene:
    def __getattr__(self, name):
        real = getattr(_real_import, name)

        def call(*a, **k):
            before = {o.name for o in bpy.data.objects}
            r = real(*a, **k)
            for o in bpy.data.objects:
                if o.type == "ARMATURE" and o.name not in before:
                    import_mw[o.name] = o.matrix_world.copy()
            return r
        return call


# ───────────── 导出：FBX 换成逐帧采样 ─────────────
out = {"schema": 1, "asset": ASSET, "fps": 30, "source": "blender", "script": str(SCRIPT.relative_to(ROOT)).replace("\\", "/"),
       "bones": None, "rest": None, "clips": {}}


def b2g(m: Matrix) -> list:
    """Blender 世界（Z 上、-Y 前）→ glTF 模型空间（Y 上、+Z 前）：位置 (x, z, -y)，四元数向量部分同样换轴"""
    loc, rot, _ = m.decompose()
    rot.normalize()
    return [rot.x, rot.z, -rot.y, rot.w, loc.x, loc.z, -loc.y]


def fake_fbx(filepath="", **_kw):
    scene = bpy.context.scene
    arms = [o for o in scene.objects if o.type == "ARMATURE" and o.animation_data and o.animation_data.action]
    if not arms:
        raise RuntimeError("导出 FBX 时场景里没有带动作的骨架")
    arm = arms[0]
    base = import_mw.get(arm.name, Matrix.Identity(4))
    names = [pb.name for pb in arm.pose.bones]
    if out["bones"] is None:
        out["bones"] = names
        rest = []
        for n in names:
            rest += b2g(base @ arm.data.bones[n].matrix_local)
        out["rest"] = [round(x, 7) for x in rest]
    elif out["bones"] != names:
        raise RuntimeError("同一资产的片段骨骼表不一致")
    name = Path(filepath).stem
    fps = scene.render.fps / (scene.render.fps_base or 1)
    out["fps"] = round(fps)
    frames = []
    for f in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ae = arm.evaluated_get(dg)
        row = []
        for n in names:
            row += b2g(base @ ae.pose.bones[n].matrix)
        frames.append([round(x, 7) for x in row])
    out["clips"][name] = {"frames": frames, "action": arm.animation_data.action.name, "range": [scene.frame_start, scene.frame_end]}
    print(f"KD_CLIP {name} {len(frames)} 帧")
    return {"FINISHED"}


class _ExportScene:
    def __getattr__(self, name):
        if name == "fbx":
            return fake_fbx
        return getattr(_real_export, name)


bpy.ops.import_scene = _ImportScene()
bpy.ops.export_scene = _ExportScene()

# ───────────── 跑资产脚本 ─────────────
sys.path.insert(0, str(SCRIPT.parent))
try:
    runpy.run_path(str(SCRIPT), run_name="__main__")
finally:
    bpy.ops.import_scene = _real_import
    bpy.ops.export_scene = _real_export
    Path.write_text, Path.write_bytes, Path.read_text, Path.read_bytes = _write_text, _write_bytes, _read_text, _read_bytes

if not out["clips"]:
    raise SystemExit(f"{SCRIPT.name} 没有导出任何片段")
DUMP.parent.mkdir(parents=True, exist_ok=True)
DUMP.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print(f"KD_DONE {ASSET} {len(out['clips'])} 片段 → {DUMP}  拦下的 unity/ 写入 {len(blocked)} 个")
