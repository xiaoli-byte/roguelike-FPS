"""按色键生成发光遮罩 _E（docs/unity-parity.md FX3：青鸟 / 河豚 / 豪彘 / 狐巫 / 镜）。

Three.js 版在着色器里现算：applyFrostGlow 按「贴图颜色（sRGB 的色相 / 饱和度 / 明度）× 资产空间的软边盒 / 球 / 竖直衰减」
给每个发光层算一个范围（src/enemies/fx/FrostSkirmishFx.ts）。Unity 版把这一步离线烘成一张遮罩贴图：
R / G / B = 发光层 0 / 1 / 2 的范围（0..1，线性），运行时 GlowMask 每帧乘「层色 × 强度」叠到 SF_StylizedLit 上。

  python art/pipeline/tools/emission_mask.py              # 全部
  python art/pipeline/tools/emission_mask.py qingniao fox_mirror --preview

做法：
  1. 网格：取 Unity 导出用的同一份 GLB（public/assets/<类别>/<ID>.glb，有 @hi 取 @hi；几何是 Draco 压缩的），
     用无头 Blender 解码后把绑定姿势的三角形（资产空间：米、x = 生物左侧、y 上、z 前，同 Three.js）和 UV 写成 npz。
  2. 在 UV 空间光栅化：每个纹素得到它在网格上的资产空间位置与法线（UV 与 Unity 的 FBX 一致，PNG 不翻转：v 从上往下）。
  3. 颜色取 Unity 里那张 BC 贴图（unity_export 从同一个 GLB 解出来的 PNG，像素相同），按规则算每层的范围
     （同 Three.js layerGlsl 的 smoothstep 写法；多条规则取最大），再往 UV 岛外扩几个纹素（防 mip / 接缝漏边）。
  4. 写 unity/Assets/Game/Resources/Fx/GlowMasks/<BC 名去掉 _BC>_E.png（默认 1024²，配置可写 size，RGB 8 位）。--preview 另存一张叠在 BC 上的预览到 _tmp。

第二批收尾 C 路（2026-10-31）加了首领用的三份：旱魃本体（龟裂）、日轮（轮体 / 火焰芒 / 轮毂）、熔心魔将大剑（剑脊熔铜纹 / 刃口），
和三种新规则（见下面「规则」）：thin（细线：龟裂这种画在暗皮肤上的细金线，和同色的大块衣料分开）、radial（到某根轴的距离：日轮的环带）、
edge（UV 岛内离岛边多少纹素：剑面靠边的那一圈就是刃口）、normalAbs（法线某个分量的绝对值：剑身侧面的窄条）；
每层还可以 grow 往外长几个纹素（细线发光要比画上去的线宽一点）。

本文件同时是 Blender 端的解码脚本（在 Blender 里运行时只做第 1 步）。
"""

from __future__ import annotations

import argparse
import colorsys
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
UNITY = ROOT / "unity" / "Assets"
OUT_DIR = UNITY / "Game" / "Resources" / "Fx" / "GlowMasks"
WORK = ROOT / "art" / "source" / "_tmp" / "emission_mask"
MASK_SIZE = 1024
DILATE = 6

# ───────────────────────────── 规则 ─────────────────────────────
# 每条规则（同 Three.js FrostGlowLayer）：hue = (中心, 半宽)（sRGB 色相 0..1）、minSat / maxSat / minVal / maxVal、
# box = {min, max, soft, absX}（资产空间软边盒，absX = 左右对称只写 x ≥ 0 一侧）、sphere = {center, radius}、
# fadeY = (y0, y1)（y0 处全亮、y1 处熄灭）、facing = {dir, min}（法线与 dir 的夹角余弦下限，软边 0.15）。
# 第二批收尾加的：
#   radial = {axis, min?, max?, soft}：到资产空间某根轴（0 / 1 / 2 = x / y / z）的距离（米）在 [min, max] 里；
#   edge = {min?, max?, soft}：UV 岛内离岛边的距离（遮罩纹素）在 [min, max] 里（max = 靠边的一圈，min = 岛心）；
#   normalAbs = {axis, min?, max?, soft}：法线某个分量的绝对值在 [min, max] 里；
#   thin = {hue, minSat, minVal, open, grey: {maxSat, maxVal, radius, min}}：在 BC 原始分辨率上找「细线」——颜色按 hue / minSat / minVal 认，
#     再减去 open × open 的开运算（大块同色衣料被开运算保留下来、减掉；只剩比 open 窄的线），而且周围 radius 纹素里「暗皮肤」
#     （饱和度 ≤ maxSat、明度 ≤ maxVal）占比 ≥ min（去掉大色块边缘的毛刺）；结果按最大值缩到遮罩尺寸。
# layers[i] = 第 i 层（R / G / B）的规则表，取最大；grow[i] = 第 i 层在 UV 岛内往外长几个纹素（缺省 0）。
# size = 遮罩边长（缺省 1024；4096 底色、线很细的旱魃用 2048）。
# 层色 / 强度在 Unity 侧（GlowMask.cs），这里只管「哪里亮」。

# 魔将大剑：剑身（资产空间：握点在原点、剑尖朝 −y 到 −2.83 m）的熔铜色——橙到金黄、饱和、亮
_SWORD_MOLTEN = {"hue": (0.07, 0.09), "minSat": 0.56, "minVal": 0.62,
                 "box": {"min": (-9, -9, -9), "max": (9, -0.32, 9), "soft": 0.04}}

PROFILES: dict[str, dict] = {
    # 三青鸟（Qingniao.ts applyFrostGlow）：0 胸口霜晶、1 翼展外侧的羽尖冰刃、2 尾羽末端的冰羽
    "qingniao": {
        "glb": "characters/SK_Enemy_Qingniao",
        "bc": "Art/Characters/SK_Enemy_Qingniao/Textures/T_Enemy_Qingniao_BC.png",
        "layers": [
            [{"hue": (0.53, 0.12), "minSat": 0.25, "minVal": 0.55, "sphere": {"center": (0, 1.8, 0.5), "radius": 0.16}}],
            [{"hue": (0.55, 0.14), "minVal": 0.78, "maxSat": 0.55, "box": {"min": (0.75, 1.3, -0.2), "max": (1.6, 2.4, 0.8), "soft": 0.08, "absX": True}}],
            [{"hue": (0.55, 0.14), "minVal": 0.78, "maxSat": 0.55, "box": {"min": (-0.6, -0.1, -0.7), "max": (0.6, 0.62, 0.2), "soft": 0.08}}],
        ],
    },
    # 冰河豚（IcePuffer.ts）：0 发白偏冷的冰刺、1 整个身体的冷光（鼓满前的最后一下）
    "ice_puffer": {
        "glb": "characters/SK_Enemy_IcePuffer",
        "bc": "Art/Characters/SK_Enemy_IcePuffer/Textures/T_Enemy_IcePuffer_BC.png",
        "layers": [
            [{"hue": (0.55, 0.12), "minVal": 0.72, "maxSat": 0.42}],
            [{"hue": (0.58, 0.15), "minSat": 0.2}],
            [],
        ],
    },
    # 冰棘豪彘（Haozhi.ts）：0 刺冠里发白的冰棱（越靠根越亮）、1 青色小眼
    "haozhi": {
        "glb": "characters/SK_Enemy_Haozhi",
        "bc": "Art/Characters/SK_Enemy_Haozhi/Textures/T_Enemy_Haozhi_BC.png",
        "layers": [
            [{"hue": (0.6, 0.14), "minVal": 0.62, "box": {"min": (0, 0.44, -0.6), "max": (0.36, 0.95, 0.5), "soft": 0.04, "absX": True}, "fadeY": (0.5, 0.86)}],
            [{"hue": (0.5, 0.1), "minSat": 0.3, "minVal": 0.55, "box": {"min": (0.05, 0.33, 0.33), "max": (0.17, 0.45, 0.47), "soft": 0.01, "absX": True}}],
            [],
        ],
    },
    # 九尾狐巫（Three.js 版没有材质发光，只有镜上的玉钮 / 镜面两个发光件）：Unity 版给本体两层——
    #   0 尾尖 / 衣襟上饱和的天蓝狐火（施法前摇亮）、1 翠玉饰件（常亮微光，照镜时亮）
    "fox_witch": {
        "glb": "characters/SK_Enemy_FoxWitch",
        "bc": "Art/Characters/SK_Enemy_FoxWitch/Textures/T_Enemy_FoxWitch_BC.png",
        "layers": [
            [{"hue": (0.585, 0.05), "minSat": 0.5, "minVal": 0.62}],
            [{"hue": (0.42, 0.07), "minSat": 0.35, "minVal": 0.3}],
            [],
        ],
    },
    # 铜镜（挂在 socket_mirror 上的 SM_EnemyPart_FoxWitchMirror；镜面朝 +z）：0 青玉镶嵌（同 Three.js 玉钮，常亮、前摇更亮）、
    #   1 正面发白的镜面（照妖镜蓄光，同 Three.js mirrorGlow）
    "fox_mirror": {
        "glb": "attachments/SM_EnemyPart_FoxWitchMirror",
        "bc": "Art/Attachments/SM_EnemyPart_FoxWitchMirror/Textures/T_EnemyPart_FoxWitchMirror_BC.png",
        "layers": [
            [{"hue": (0.5, 0.06), "minSat": 0.5, "minVal": 0.55}],
            [{"maxSat": 0.12, "minVal": 0.86, "facing": {"dir": (0, 0, 1), "min": 0.55}}],
            [],
        ],
    },
    # 旱魃本体（docs/art/boss-hanba.md：炭黑龟裂皮肤透金光；Three.js 版没有）：0 皮肤上的龟裂细金线（白金裂光：平时微亮、日蚀时烧亮、复燃到峰值）。
    #   残衣是大块的金黄 / 橙红色块，和裂纹同色——靠 thin 只留下暗皮肤里比 9 纹素（4096 底色）窄的线
    "hanba": {
        "glb": "characters/SK_Boss_Hanba",
        "bc": "Art/Characters/SK_Boss_Hanba/Textures/T_Boss_Hanba_BC.png",
        "size": 2048,
        "layers": [
            [{"thin": {"hue": (0.105, 0.065), "minSat": 0.44, "minVal": 0.64, "open": 9,
                       "grey": {"maxSat": 0.47, "maxVal": 0.67, "radius": 10, "min": 0.4}}}],
            [],
            [],
        ],
        "grow": [1, 0, 0],
    },
    # 日轮（轮面朝 ±z，轮心在原点，外半径 3 m）：0 轮体（整面白金，亮的地方更亮，凹槽 / 铆钉留暗）、1 外缘火焰芒（日蚀时只剩它：日冕）、
    #   2 轮毂与八辐（聚光、复燃时最亮）
    "hanba_ring": {
        "glb": "attachments/SM_BossPart_HanbaSunRing",
        "bc": "Art/Attachments/SM_BossPart_HanbaSunRing/Textures/T_BossPart_HanbaSunRing_BC.png",
        "layers": [
            [{"minVal": 0.82}],
            [{"radial": {"axis": 2, "min": 2.35, "soft": 0.12}}],
            [{"radial": {"axis": 2, "max": 1.6, "soft": 0.12}}],
        ],
    },
    # 熔心魔将的熔心大剑（SM_BossWeapon_Greatsword）：0 剑脊熔铜纹（剑面中间那几道熔痕和分叉）、1 刃口（剑面靠边 24 纹素的熔铜带 + 剑身侧面的窄条）。
    #   剑格、剑柄、配重的金铜色不算（只认剑身：握点以下 0.32 m）
    "warlord_sword": {
        "glb": "attachments/SM_BossWeapon_Greatsword",
        "bc": "Art/Attachments/SM_BossWeapon_Greatsword/Textures/T_BossWeapon_Greatsword_BC.png",
        "layers": [
            [{**_SWORD_MOLTEN, "edge": {"min": 24, "soft": 4}, "normalAbs": {"axis": 2, "min": 0.55, "soft": 0.1}}],
            [{**_SWORD_MOLTEN, "edge": {"max": 24, "soft": 4}},
             {**_SWORD_MOLTEN, "normalAbs": {"axis": 2, "max": 0.55, "soft": 0.1}}],
            [],
        ],
    },
}

# ───────────────────────────── Blender 端 ─────────────────────────────


def blender_dump(glb: str, out: str) -> None:
    """在 Blender 里运行：导入 GLB，把所有网格的绑定姿势三角形（glTF 坐标）、顶点法线、UV（glTF 约定：v 从上往下）写成 npz"""
    import bpy  # type: ignore
    import numpy as np

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    pos, nrm, uvs, obj_ids, names = [], [], [], [], []
    for oi, ob in enumerate(o for o in bpy.context.scene.objects if o.type == "MESH"):
        me = ob.data
        me.calc_loop_triangles()
        uv_layer = me.uv_layers.active
        if uv_layer is None:
            continue
        mw = ob.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        names.append(ob.name)
        for tri in me.loop_triangles:
            p3, n3, u3 = [], [], []
            for li, vi in zip(tri.loops, tri.vertices):
                co = mw @ me.vertices[vi].co
                no = (nm @ me.vertices[vi].normal).normalized()
                # Blender（z 上）→ glTF（y 上）：(x, y, z)_gltf = (x, z, −y)_blender
                p3.append((co.x, co.z, -co.y))
                n3.append((no.x, no.z, -no.y))
                u, v = uv_layer.data[li].uv
                u3.append((u, 1.0 - v))
            pos.append(p3)
            nrm.append(n3)
            uvs.append(u3)
            obj_ids.append(len(names) - 1)
    np.savez_compressed(out, pos=np.array(pos, np.float32), nrm=np.array(nrm, np.float32), uv=np.array(uvs, np.float32),
                        obj=np.array(obj_ids, np.int32), names=np.array(names))
    print(f"[art] {Path(glb).name}: {len(pos)} 个三角形，{len(names)} 个网格")


def in_blender() -> bool:
    try:
        import bpy  # type: ignore  # noqa: F401
        return True
    except ImportError:
        return False


# ───────────────────────────── 普通 Python 端 ─────────────────────────────


def blender_exe() -> str:
    sys.path.insert(0, str(ROOT / "art" / "pipeline"))
    from lib.config import CFG  # noqa: E402
    return CFG.tools["blender"]


def glb_path(rel: str) -> Path:
    base = ROOT / "public" / "assets" / f"{rel}.glb"
    hi = base.with_name(base.stem + "@hi.glb")
    return hi if hi.exists() else base


def dump_mesh(key: str, glb: Path) -> Path:
    WORK.mkdir(parents=True, exist_ok=True)
    out = WORK / f"{key}.npz"
    if out.exists() and out.stat().st_mtime > glb.stat().st_mtime and out.stat().st_mtime > Path(__file__).stat().st_mtime:
        return out
    log = WORK / f"{key}.blender.log"
    cmd = [blender_exe(), "-b", "--factory-startup", "--python-exit-code", "1", "--python", str(Path(__file__).resolve()),
           "--", "--dump", str(glb), str(out)]
    with open(log, "w", encoding="utf-8", errors="replace") as f:
        code = subprocess.call(cmd, stdout=f, stderr=subprocess.STDOUT)
    if code != 0 or not out.exists():
        tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-30:]
        raise SystemExit(f"Blender 解码 {glb.name} 失败（退出码 {code}），日志 {log}：\n" + "\n".join(tail))
    return out


def rasterize(npz: Path, size: int):
    """UV 空间光栅化：返回每个纹素的资产空间位置 / 法线（H×W×3）与覆盖（H×W bool）"""
    import numpy as np

    d = np.load(npz)
    # 只要资产本体（<ID>_LOD0）：glTF 导入器顺带建的骨骼显示球（Icosphere）、发光壳不算
    names = [str(n) for n in d["names"]]
    keep = [i for i, n in enumerate(names) if n.startswith(("SK_", "SM_")) and "GlowShell" not in n] or list(range(len(names)))
    sel = np.isin(d["obj"], keep)
    pos, nrm, uv = d["pos"][sel], d["nrm"][sel], d["uv"][sel]
    P = np.zeros((size, size, 3), np.float32)
    N = np.zeros((size, size, 3), np.float32)
    cov = np.zeros((size, size), bool)
    px = uv * size - 0.5  # 纹素中心在整数坐标上
    for t in range(len(px)):
        a, b, c = px[t]
        x0 = int(max(0, np.floor(min(a[0], b[0], c[0])))); x1 = int(min(size - 1, np.ceil(max(a[0], b[0], c[0]))))
        y0 = int(max(0, np.floor(min(a[1], b[1], c[1])))); y1 = int(min(size - 1, np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1, dtype=np.float32), np.arange(y0, y1 + 1, dtype=np.float32))
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        w2 = 1 - w0 - w1
        eps = -1e-4
        inside = (w0 >= eps) & (w1 >= eps) & (w2 >= eps)
        if not inside.any():
            continue
        iy, ix = ys[inside].astype(int), xs[inside].astype(int)
        W = np.stack([w0[inside], w1[inside], w2[inside]], 1)
        P[iy, ix] = W @ pos[t]
        N[iy, ix] = W @ nrm[t]
        cov[iy, ix] = True
    n = np.linalg.norm(N, axis=2, keepdims=True)
    N = np.where(n > 1e-6, N / np.maximum(n, 1e-6), 0)
    return P, N, cov


def smoothstep(e0, e1, x):
    import numpy as np
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hsv_image(bc_path: Path, size: int):
    import numpy as np
    from PIL import Image

    im = Image.open(bc_path).convert("RGB").resize((size, size), Image.Resampling.BOX)
    rgb = np.asarray(im, np.float32) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(2), rgb.min(2)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    rc = np.where(m, (mx - r) / np.maximum(d, 1e-6), 0)
    gc = np.where(m, (mx - g) / np.maximum(d, 1e-6), 0)
    bc = np.where(m, (mx - b) / np.maximum(d, 1e-6), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(m, (h / 6.0) % 1.0, 0)
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return np.stack([h, s, mx], 2), rgb


def band(x, lo, hi, soft):
    """x 在 [lo, hi] 里为 1，两侧 soft 宽的软边；lo / hi 为 None 表示那一侧不限"""
    import numpy as np

    m = np.ones_like(x)
    if lo is not None:
        m = m * smoothstep(lo - soft, lo + soft, x)
    if hi is not None:
        m = m * (1 - smoothstep(hi - soft, hi + soft, x))
    return m


def thin_map(bc_path: Path, spec: dict, size: int):
    """细线：在 BC 原始分辨率上认颜色、减掉开运算留下的大色块、要求周围是暗皮肤，再按最大值缩到 size"""
    import numpy as np
    from PIL import Image
    from scipy import ndimage as ndi

    full = Image.open(bc_path).size[0]
    hsv, _ = hsv_image(bc_path, full)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    c, w = spec["hue"]
    dist = np.abs(((h - c + 0.5) % 1.0) - 0.5)
    col = (1 - smoothstep(w * 0.6, w, dist)) * smoothstep(spec["minSat"] - 0.06, spec["minSat"] + 0.06, s) \
        * smoothstep(spec["minVal"] - 0.06, spec["minVal"] + 0.06, v)
    k = int(spec.get("open", 9))
    blobs = ndi.binary_opening(col > 0.5, structure=np.ones((k, k), bool))
    line = col * ~blobs
    g = spec["grey"]
    grey = (1 - smoothstep(g["maxSat"] - 0.05, g["maxSat"] + 0.05, s)) * (1 - smoothstep(g["maxVal"] - 0.05, g["maxVal"] + 0.05, v))
    around = ndi.uniform_filter(grey, 2 * int(g["radius"]) + 1)
    line = line * smoothstep(g["min"] - 0.1, g["min"] + 0.1, around)
    f = full // size
    if f >= 1 and f * size == full:
        return line.reshape(size, f, size, f).max(axis=(1, 3)).astype(np.float32)
    return np.asarray(Image.fromarray((line * 255).astype(np.uint8)).resize((size, size), Image.Resampling.BOX), np.float32) / 255.0


def rule_mask(rule: dict, hsv, P, N, ctx: dict | None = None):
    """一条规则的范围（同 Three.js layerGlsl）；ctx = 这张遮罩的附加量（edt：UV 岛内离岛边的纹素距离；thin：细线图，按规则缓存）"""
    import numpy as np

    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = np.ones_like(h)
    ctx = ctx or {}
    if "thin" in rule:
        key = repr(sorted(rule["thin"].items()))
        if key not in ctx.setdefault("thin", {}):
            ctx["thin"][key] = thin_map(ctx["bc"], rule["thin"], h.shape[0])
        m *= ctx["thin"][key]
    if "radial" in rule:
        rd = rule["radial"]
        ax = int(rd["axis"])
        others = [i for i in range(3) if i != ax]
        r = np.sqrt(P[..., others[0]] ** 2 + P[..., others[1]] ** 2)
        m *= band(r, rd.get("min"), rd.get("max"), rd.get("soft", 0.05))
    if "edge" in rule:
        ed = rule["edge"]
        if "edt" not in ctx:
            from scipy import ndimage as ndi
            ctx["edt"] = ndi.distance_transform_edt(ctx["cov"]).astype(np.float32)
        m *= band(ctx["edt"], ed.get("min"), ed.get("max"), ed.get("soft", 2))
    if "normalAbs" in rule:
        na = rule["normalAbs"]
        m *= band(np.abs(N[..., int(na["axis"])]), na.get("min"), na.get("max"), na.get("soft", 0.1))
    if "hue" in rule:
        c, w = rule["hue"]
        dist = np.abs(((h - c + 0.5) % 1.0) - 0.5)
        m *= 1 - smoothstep(w * 0.6, w, dist)
    if rule.get("minSat"):
        m *= smoothstep(rule["minSat"] - 0.08, rule["minSat"] + 0.08, s)
    if rule.get("maxSat", 1) < 1:
        m *= 1 - smoothstep(rule["maxSat"] - 0.08, rule["maxSat"] + 0.08, s)
    if rule.get("minVal"):
        m *= smoothstep(rule["minVal"] - 0.1, rule["minVal"] + 0.1, v)
    if rule.get("maxVal", 1) < 1:
        m *= 1 - smoothstep(rule["maxVal"] - 0.1, rule["maxVal"] + 0.1, v)
    if "box" in rule:
        bx = rule["box"]
        p = P.copy()
        if bx.get("absX"):
            p[..., 0] = np.abs(p[..., 0])
        lo, hi, sf = np.array(bx["min"]), np.array(bx["max"]), bx.get("soft", 0.05)
        a = smoothstep(lo - sf, lo + sf, p) * (1 - smoothstep(hi - sf, hi + sf, p))
        m *= a[..., 0] * a[..., 1] * a[..., 2]
    if "sphere" in rule:
        sp = rule["sphere"]
        dist = np.linalg.norm(P - np.array(sp["center"]), axis=2)
        r = sp["radius"]
        m *= 1 - smoothstep(r * 0.7, r, dist)
    if "fadeY" in rule:
        y0, y1 = rule["fadeY"]
        y = P[..., 1]
        m *= (1 - smoothstep(y0, y1, y)) if y1 >= y0 else smoothstep(y1, y0, y)
    if "facing" in rule:
        f = rule["facing"]
        dn = np.array(f["dir"], np.float32)
        dn /= np.linalg.norm(dn)
        cos = (N * dn).sum(2)
        m *= smoothstep(f["min"] - 0.15, f["min"] + 0.15, cos)
    return m


def dilate(mask, cov, steps: int):
    """往 UV 岛外扩 steps 个纹素：没被三角形覆盖的纹素取四邻域最大值（岛内不变）"""
    import numpy as np

    m = mask.copy()
    filled = cov.copy()
    for _ in range(steps):
        pad = np.pad(m, ((1, 1), (1, 1), (0, 0)))
        fp = np.pad(filled, 1)
        nb = np.maximum.reduce([pad[:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, :-2], pad[1:-1, 2:]])
        nf = fp[:-2, 1:-1] | fp[2:, 1:-1] | fp[1:-1, :-2] | fp[1:-1, 2:]
        grow = ~filled & nf
        m[grow] = nb[grow]
        filled |= grow
    return m


def bake(key: str, preview: bool) -> Path:
    import numpy as np
    from PIL import Image

    prof = PROFILES[key]
    glb = glb_path(prof["glb"])
    bc = UNITY / prof["bc"]
    if not glb.exists():
        raise SystemExit(f"{key}：找不到 {glb}")
    if not bc.exists():
        raise SystemExit(f"{key}：找不到 Unity 贴图 {bc}（先跑 unity_export）")
    npz = dump_mesh(key, glb)
    size = int(prof.get("size", MASK_SIZE))
    P, N, cov = rasterize(npz, size)
    hsv, rgb = hsv_image(bc, size)
    out = np.zeros((size, size, 3), np.float32)
    ctx = {"bc": bc, "cov": cov}
    for li, rules in enumerate(prof["layers"][:3]):
        for r in rules:
            out[..., li] = np.maximum(out[..., li], rule_mask(r, hsv, P, N, ctx))
    out *= cov[..., None]
    for li, g in enumerate(prof.get("grow", [])[:3]):
        if g > 0:
            from scipy import ndimage as ndi
            out[..., li] = ndi.maximum_filter(out[..., li], size=2 * int(g) + 1) * cov
    out = dilate(out, cov, DILATE)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    name = Path(prof["bc"]).stem
    name = (name[:-3] if name.endswith("_BC") else name) + "_E.png"
    path = OUT_DIR / name
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(path, optimize=True)
    cover = [float((out[..., i] > 0.5).mean() * 100) for i in range(3)]
    print(f"{key}: {path.relative_to(ROOT)}  覆盖 R {cover[0]:.2f}%  G {cover[1]:.2f}%  B {cover[2]:.2f}%  （UV 占用 {cov.mean() * 100:.1f}%）")
    if preview:
        WORK.mkdir(parents=True, exist_ok=True)
        tint = np.array([[1.0, 0.25, 0.1], [0.1, 1.0, 0.3], [0.25, 0.45, 1.0]], np.float32)
        glow = np.clip(out @ tint, 0, 1)
        pv = np.clip(rgb * 0.45 + glow * 0.9, 0, 1)
        Image.fromarray((pv * 255).astype(np.uint8)).resize((1024, 1024) if size > 1024 else (512, 512)).save(WORK / f"{key}_preview.png")
    return path


def main() -> None:
    if "--dump" in sys.argv:
        i = sys.argv.index("--dump")
        blender_dump(sys.argv[i + 1], sys.argv[i + 2])
        return
    ap = argparse.ArgumentParser(description="按色键生成发光遮罩 _E（R/G/B = 发光层 0/1/2）")
    ap.add_argument("keys", nargs="*", help=f"要生成的配置（缺省全部）：{', '.join(PROFILES)}")
    ap.add_argument("--preview", action="store_true", help="另存叠在 BC 上的预览到 art/source/_tmp/emission_mask/")
    a = ap.parse_args()
    keys = a.keys or list(PROFILES)
    for k in keys:
        if k not in PROFILES:
            raise SystemExit(f"没有配置 {k}（{', '.join(PROFILES)}）")
        bake(k, a.preview)


if __name__ == "__main__":
    main()
