"""发布资产 → Unity 工程（unity/Assets/Art）。

  python art/pipeline/unity_export.py SK_Enemy_JerboaBlade SM_Tripo_DesertColumn ...
  python art/pipeline/unity_export.py --set showcase          第一章沙寺样板（展示场景用到的全部资产）
  python art/pipeline/unity_export.py --all                   清单里的全部资产
  python art/pipeline/unity_export.py --set showcase --force  忽略增量缓存，全部重导

来源是 public/assets/manifest.json 里已发布的 GLB（有 @hi 高清版本时取高清版本），所以审核闸门仍然在 assetctl 管线里；
这里只做格式转换，不改资产内容（人形资产的 T-pose 绑定除外，见 blender/bl_unity_export.py）。

每个资产产出一个目录 unity/Assets/Art/<类别>/<资产ID>/：
  <ID>.fbx          网格 + 骨骼 + LOD（Blender 无头导出）
  Textures/*.png    从 GLB 里取出的 BC / N / ORM / E 贴图（WebP 解码成 PNG，像素不变）
  <ID>.art.json     Unity 侧的唯一输入：规格档、LOD 距离、包围盒、材质参数、贴图角色、人形骨骼映射、来源校验和
Unity 菜单 Spiritfire ▸ Art ▸ Sync 读取 *.art.json 生成材质、Prefab（LODGroup / Animator / 碰撞体）并运行校验。
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import struct
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import blender  # noqa: E402
from lib.config import CFG, ROOT, PipelineError  # noqa: E402

EXPORTER_VERSION = 5
MANIFEST = ROOT / "public" / "assets" / "manifest.json"
UNITY_ART = ROOT / "unity" / "Assets" / "Art"
WORK = ROOT / "art" / "source" / "_tmp" / "unity_export"
CATEGORY_DIR = {"characters": "Characters", "weapons": "Weapons", "attachments": "Attachments",
                "props": "Props", "environment": "Environment"}

# 第一章沙寺样板：人形敌人、非人形敌人、英雄、第一人称枪与手臂、沙寺场景套件
SHOWCASE = [
    "SK_Enemy_JerboaBlade", "SK_Enemy_Apsara", "SM_EnemyPart_ApsaraPipa", "SK_Enemy_MirageToad", "SK_Hero_RedPanda",
    "SK_Weapon_Revolver", "SM_Arms_RedPandaR", "SM_Arms_RedPandaL",
    "SM_Tripo_DesertColumn", "SM_Tripo_DesertColumnRuin", "SM_Tripo_DesertRampart", "SM_Tripo_DesertRampartPlain",
    "SM_Tripo_DesertRampartPanel", "SM_Tripo_DesertRampartPlainPanel", "SM_Tripo_DesertRampartEndL", "SM_Tripo_DesertRampartEndR",
    "SM_Tripo_DesertGateway", "SM_Tripo_DesertCoverWall", "SM_Tripo_DesertBarricade", "SM_Tripo_DesertPlatformBlock",
    "SM_Tripo_DesertStairs", "SM_Tripo_DesertMarketStall", "SM_Tripo_DesertGoodsPile", "SM_Tripo_DesertTreasureHoard",
    "SM_Tripo_DesertCornerTower", "SM_Tripo_DesertBrazier", "SM_Tripo_DesertPortalShrine", "SM_Tripo_DesertColossus",
    "SM_Env_DesertSandstone", "SM_Env_DesertCliff", "SM_Env_DesertRuin",
]

# ───────────── Unity 人形骨骼映射（HumanTrait.BoneName 的写法）─────────────
# 两套命名：Tripo 语义重绑（hips / arm_L / thumb_1_L …）与 Mixamo（Hips / LeftArm / LeftHandThumb1 …）。
FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"]
PHALANX = ["Proximal", "Intermediate", "Distal"]


def _semantic_map() -> dict[str, str]:
    m = {"Hips": "hips", "Spine": "spine", "Chest": "chest", "Neck": "neck", "Head": "head"}
    for s, side in (("L", "Left"), ("R", "Right")):
        m |= {f"{side}Shoulder": f"shoulder_{s}", f"{side}UpperArm": f"arm_{s}", f"{side}LowerArm": f"forearm_{s}",
              f"{side}Hand": f"hand_{s}", f"{side}UpperLeg": f"thigh_{s}", f"{side}LowerLeg": f"shin_{s}",
              f"{side}Foot": f"foot_{s}", f"{side}Toes": f"toe_{s}"}
        for f in FINGERS:
            src = "pinky" if f == "Little" else f.lower()
            for i, ph in enumerate(PHALANX):
                m[f"{side} {f} {ph}"] = f"{src}_{i + 1}_{s}"
    return m


def _mixamo_map() -> dict[str, str]:
    m = {"Hips": "Hips", "Spine": "Spine", "Chest": "Spine1", "UpperChest": "Spine2", "Neck": "Neck", "Head": "Head"}
    for side in ("Left", "Right"):
        m |= {f"{side}Shoulder": f"{side}Shoulder", f"{side}UpperArm": f"{side}Arm", f"{side}LowerArm": f"{side}ForeArm",
              f"{side}Hand": f"{side}Hand", f"{side}UpperLeg": f"{side}UpLeg", f"{side}LowerLeg": f"{side}Leg",
              f"{side}Foot": f"{side}Foot", f"{side}Toes": f"{side}ToeBase"}
        for f in FINGERS:
            src = "Pinky" if f == "Little" else f
            for i, ph in enumerate(PHALANX):
                m[f"{side} {f} {ph}"] = f"{side}Hand{src}{i + 1}"
    return m


HUMAN_REQUIRED = ["Hips", "Spine", "Head"] + [f"{s}{b}" for s in ("Left", "Right") for b in
                                             ("UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot")]
PROFILES = {"semantic": _semantic_map(), "mixamo": _mixamo_map()}
# 骨架满足人形条件、但身体不是人形比例的资产：走 Generic + 程序动画（蛤蟆的「手臂」是前肢，套人形动作会很怪）
FORCE_GENERIC = {"SK_Enemy_MirageToad"}


def humanoid_map(asset_id: str, bones: list[str]) -> tuple[str | None, dict[str, str]]:
    if asset_id in FORCE_GENERIC:
        return None, {}
    names = set(bones)
    for profile, table in PROFILES.items():
        mapped = {h: b for h, b in table.items() if b in names}
        if all(h in mapped for h in HUMAN_REQUIRED):
            return profile, mapped
    return None, {}


# ───────────── 第一人称武器：语义零件与挂点（W3，docs/unity-parity.md 3.3）─────────────
# 白模（src/dev/artExport.ts exportWeaponParts）的骨骼按子节点索引路径命名（j_r / j_0 / j_16 …），
# blockout.json 的 fields 记着 WeaponModels 的 GunModel 字段 → 关节（muzzle / mag / cylinder / spinner / pump / bolt）。
# 导出时把关节改成这些语义名（同一关节有两个字段时按下面的优先级取一个，另一个记成别名），Unity 侧按名字找零件。
PART_PRIORITY = ["muzzle", "cylinder", "spinner", "pump", "bolt", "mag"]
# fields 里没有、但要有名字的分组：PROCEDURAL_PARTS 里的 sight 分组（rifle / burst 的 keep 关节）、蛊灯的灯笼（灯芯 = mag 的父节点）
PART_EXTRA = {"lantern": {"j_12": "lamp"}}
# 新拆出的关节（Blender 里加骨骼、把面的蒙皮权重改过去，几何不变）。坐标是 Three.js 枪模空间（= glTF 模型空间）。
#   赤蛟霰铳：铰链 reload.breech 在 (0, 0.004, −0.035)，面中心 z < −0.065 且 y > −0.025 的是枪管组（双管、护木、管口环；同 TS ReloadBreech）；
#   枪口关节跟着枪管走。
PART_SPLITS = {
    "magmashot": [{"name": "barrels", "parent": "j_r", "head": [0, 0.004, -0.035],
                   "zMax": -0.065, "yMin": -0.025, "children": ["j_0"]}],
}

# 挂点（Three.js 枪模空间，米；导出时 x 取反成 Unity 枪模空间）。
#   sight    开镜视线穿过的瞄准点：(−aimOffset.x, −aimOffset.y, 准星 / 红点 / 觇环所在的 z)（TS 开镜时相机在枪模空间的 −aimOffset）
#   leftGrip 左手握点（TS GunModel.leftHand；手枪没有前握，用 WeaponHandling.support 的双手包握）
#   load     换弹时左手送弹的位置（TS WeaponHandling.load；整匣换弹时跟着弹匣 / 转轮 / 能量罐走，所以挂在它下面）
#   finish   换弹收尾的操作点（TS WeaponHandling.finish：拉机柄、拍枪管、推泵）
#   eject    抛壳 / 排气口（TS 没有，按枪身结构定：位置 + 朝外的方向）
# parent 缺省 = 根；"@mag" = 弹匣所在的零件（整匣换弹的 load 跟着它）。
WEAPON_SOCKETS = {
    "revolver": {"sight": [0, 0.089, -0.24], "leftGrip": [-0.034, -0.04, 0.035], "load": ([-0.045, 0.038, -0.006], "@mag"),
                 "finish": [-0.025, 0.038, -0.05], "eject": ([0.03, 0.038, -0.05], [1, 0.4, 0])},
    "smg": {"sight": [0, 0.1, -0.19], "leftGrip": [0, 0.02, -0.235], "load": ([-0.015, -0.07, -0.11], "@mag"),
            "finish": [-0.035, 0.054, -0.07], "eject": ([0.027, 0.055, -0.03], [1, 0.5, 0.2])},
    "rifle": {"sight": [0, 0.1, -0.053], "leftGrip": [0, 0.006, -0.36], "load": ([-0.015, -0.065, -0.095], "@mag"),
              "finish": [-0.04, 0.06, 0.005], "eject": ([0.03, 0.055, -0.06], [1, 0.5, 0.2])},
    # 无托结构：弹匣在握把后面（z +0.1）。TS 的 load z −0.1 送到了扳机前面，这里改到弹匣口
    "burst": {"sight": [0, 0.132, -0.128], "leftGrip": [0, -0.005, -0.24], "load": ([-0.015, -0.06, 0.1], "@mag"),
              "finish": [-0.035, 0.055, -0.035], "eject": ([0.034, 0.07, 0.05], [1, 0.4, 0.3])},
    "shotgun": {"sight": [0, 0.096, -0.53], "leftGrip": ([0, -0.002, -0.3], "pump"), "load": [-0.018, -0.03, -0.08],
                "finish": ([0, -0.002, -0.3], "pump"), "eject": ([0.03, 0.055, -0.04], [1, 0.5, 0.1])},
    "sniper": {"sight": [0, 0.12, -0.17], "leftGrip": [0, 0.004, -0.3], "load": ([-0.018, -0.06, -0.06], "@mag"),
               "finish": [0.038, 0.056, 0.03], "eject": ([0.03, 0.05, 0.0], [1, 0.6, 0])},
    "launcher": {"sight": [-0.1, 0.18, -0.1], "leftGrip": [0, -0.01, -0.27], "load": ([0, 0.02, 0.08], "@mag"),
                 "finish": [-0.045, 0.045, -0.03], "eject": ([0.07, 0.065, 0.0], [1, 0.2, 0.3])},
    "crossbow": {"sight": [0, 0.16, -0.08], "leftGrip": [0, 0.01, -0.25], "load": ([-0.015, 0.075, -0.13], "@mag"),
                 "finish": [0, 0.08, -0.1], "eject": ([0.025, 0.074, -0.1], [1, 0.6, 0])},
    "beam": {"sight": [-0.05, 0.14, -0.15], "leftGrip": [0, 0, -0.17], "load": ([-0.025, 0.11, -0.04], "@mag"),
             "finish": [-0.04, 0.035, 0.02], "eject": ([0.035, 0.06, 0.0], [1, 0.6, 0])},
    "minigun": {"sight": [-0.14, 0.22, -0.07], "leftGrip": [-0.085, 0.03, -0.2], "load": ([-0.08, -0.065, -0.02], "@mag"),
                "finish": [-0.065, 0.06, -0.11], "eject": ([0.057, 0.03, -0.02], [1, -0.3, 0.2])},
    "swarm": {"sight": [-0.1, 0.2, -0.082], "leftGrip": [0, 0, -0.2], "load": ([0, 0.016, 0.075], "@mag"),
              "finish": [-0.055, 0.042, -0.055], "eject": ([0, 0.09, 0.03], [0, 0.2, 1])},
    "flamer": {"sight": [-0.12, 0.2, -0.14], "leftGrip": [0, -0.03, -0.26], "load": ([-0.035, -0.07, -0.088], "@mag"),
               "finish": [-0.045, 0.03, 0.015], "eject": ([0, 0.068, -0.13], [0, 1, 0])},
    "stormpod": {"sight": [-0.08, 0.17, -0.225], "leftGrip": [0, -0.02, -0.2], "load": ([-0.06, 0.03, -0.005], "@mag"),
                 "finish": [-0.025, 0.03, -0.03], "eject": ([0.055, 0.03, -0.03], [1, 0.3, 0])},
    "magmashot": {"sight": ([0, 0.075, -0.365], "barrels"), "leftGrip": ([0, -0.02, -0.16], "barrels"), "load": [0, 0.045, -0.04],
                  "finish": ([0, -0.02, -0.16], "barrels"), "eject": ([0, 0.04, -0.065], [0, 0.6, 1], "barrels")},
    "trinity": {"sight": [0, 0.09, -0.265], "leftGrip": [-0.034, -0.04, 0.03], "load": ([-0.048, 0.04, -0.003], "@mag"),
                "finish": [-0.027, 0.04, -0.05], "eject": ([0.035, 0.04, -0.05], [1, 0.4, 0])},
    "railgun": {"sight": [0, 0.13, -0.66], "leftGrip": [0, -0.02, -0.32], "load": ([-0.03, 0.085, 0.02], "@mag"),
                "finish": [-0.038, 0.055, 0.08], "eject": ([0.037, 0.012, -0.08], [1, 0, 0])},
    "lantern": {"sight": [-0.06, 0.15, -0.23], "leftGrip": [0, -0.02, -0.12], "load": ([-0.025, -0.03, -0.29], "@mag"),
                "finish": [-0.024, 0.02, -0.23], "eject": ([0, 0.03, -0.26], [0, 1, 0], "lamp")},
}
SOCKET_NAMES = ["muzzle", "sight", "leftGrip", "load", "finish", "eject"]
# 枪口：白模的枪口点比美术网格的最前端靠前超过这么多时（鹰隼狙击 11 cm、贯虹灵炮 9 cm），把枪口骨骼挪到网格最前端前 1 cm，
# 免得枪口火焰 / 曳光起点悬在枪管前面
MUZZLE_MAX_GAP, MUZZLE_LEAD = 0.03, 0.01


def _to_unity(v) -> list[float]:
    """Three.js / glTF 模型空间 → Unity 模型空间（导入时 X 取反，同 gltf_to_unity_bounds）。"""
    return [round(-float(v[0]), 6) + 0.0, round(float(v[1]), 6), round(float(v[2]), 6)]


def _blockout_meta(category: str, asset_id: str) -> dict | None:
    """当前版本白模的 blockout.json（fields / keep / joints）；没有白模时为 None。"""
    d = ROOT / CFG.paths["source"] / category / asset_id
    try:
        cur = json.loads((d / "asset.json").read_text(encoding="utf-8"))["stages"]["blockout"]["current"]
    except (OSError, KeyError, ValueError):
        return None
    p = d / "00_blockout" / f"BO_{asset_id}_v{int(cur):03d}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _mesh_front_z(glb: Path) -> float | None:
    """美术网格最前端（glTF 模型空间最小 z，枪管朝 −Z）：读 POSITION 访问器的 min（部件资产的网格节点没有变换）。"""
    try:
        doc, _ = read_glb(glb)
    except (OSError, PipelineError):
        return None
    zs = [doc["accessors"][prim["attributes"]["POSITION"]]["min"][2]
          for mesh in doc.get("meshes", []) for prim in mesh.get("primitives", [])
          if "POSITION" in prim.get("attributes", {}) and "min" in doc["accessors"][prim["attributes"]["POSITION"]]]
    return min(zs) if zs else None


def weapon_parts(asset_id: str, entry: dict, category: str) -> dict | None:
    """
    第一人称武器的语义零件、改名表、拆骨规则、挪骨与挂点；不是部件骨架武器时为 None。
    返回 {"rename": {关节: 语义名}, "splits": [...], "move": {关节: 新位置（glTF 空间）}, "art": art.json 的 weapon 段}。
    """
    bind = entry.get("bind") or {}
    if bind.get("source") != "weapon" or entry.get("class") != "weapon_fp":
        return None
    wid = bind.get("id")
    meta = _blockout_meta(category, asset_id)
    if not meta or wid not in WEAPON_SOCKETS:
        return None
    fields = meta.get("fields") or {}
    joints = {j["name"]: dict(j) for j in meta.get("joints", [])}
    move: dict[str, list[float]] = {}
    muzzle_joint = fields.get("muzzle")
    front = _mesh_front_z(ROOT / "public" / entry["url"])
    if muzzle_joint in joints and front is not None:
        pos = list(joints[muzzle_joint]["bindPosition"])
        if pos[2] < front - MUZZLE_MAX_GAP:
            pos[2] = round(front - MUZZLE_LEAD, 6)
            move[muzzle_joint] = pos
            joints[muzzle_joint]["bindPosition"] = pos
    rename: dict[str, str] = {}
    parts: dict[str, str] = {}
    for field in sorted(fields, key=lambda f: PART_PRIORITY.index(f) if f in PART_PRIORITY else len(PART_PRIORITY)):
        joint = fields[field]
        if joint not in joints:
            continue
        rename.setdefault(joint, field)
        parts[field] = rename[joint]
    for joint in meta.get("keep", []):
        if joint in joints and joint not in rename:
            rename[joint] = "sightGroup"
            parts["sightGroup"] = "sightGroup"
    for joint, name in PART_EXTRA.get(wid, {}).items():
        if joint in joints and joint not in rename:
            rename[joint] = name
            parts[name] = name
    splits = PART_SPLITS.get(wid, [])
    for s in splits:
        parts[s["name"]] = s["name"]

    named = set(parts.values()) | {"j_r"}
    sockets: dict[str, dict] = {"muzzle": {"bone": parts.get("muzzle", "j_0")}}
    for name, spec in WEAPON_SOCKETS[wid].items():
        # [x, y, z] | ([x, y, z], 父零件) | ([x, y, z], [方向]) | ([x, y, z], [方向], 父零件)
        items = list(spec) if isinstance(spec, tuple) else [spec]
        pos = items.pop(0)
        direction = items.pop(0) if items and isinstance(items[0], list) else None
        parent = items.pop(0) if items else None
        if parent == "@mag":
            parent = parts.get("mag")
        if parent and parent not in named:
            raise PipelineError(f"{asset_id}: 挂点 {name} 的父零件 {parent} 不存在（零件 {sorted(named)}）")
        s = {"parent": parent or "j_r", "pos": _to_unity(pos)}
        if direction:
            s["dir"] = _to_unity(direction)
        sockets[name] = s
    missing = [n for n in SOCKET_NAMES if n not in sockets]
    if missing:
        raise PipelineError(f"{asset_id}: 缺挂点 {missing}")
    art = {
        "id": wid,
        "parts": parts,
        "bindPose": {rename.get(n, n): _to_unity(j["bindPosition"]) for n, j in joints.items()}
                    | {s["name"]: _to_unity(s["head"]) for s in splits},
        "sockets": sockets,
    }
    return {"rename": rename, "splits": splits, "move": move, "art": art}


# ───────────── GLB 读取 ─────────────
def read_glb(path: Path) -> tuple[dict, bytes]:
    b = path.read_bytes()
    if b[:4] != b"glTF":
        raise PipelineError(f"{path} 不是 GLB")
    off, doc, binc = 12, None, b""
    while off < len(b):
        ln, typ = struct.unpack("<II", b[off:off + 8])
        chunk = b[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A:
            doc = json.loads(chunk)
        elif typ == 0x004E4942:
            binc = chunk
        off += 8 + ln
    return doc, binc


def image_bytes(doc: dict, binc: bytes, idx: int) -> bytes:
    im = doc["images"][idx]
    bv = doc["bufferViews"][im["bufferView"]]
    s = bv.get("byteOffset", 0)
    return binc[s:s + bv["byteLength"]]


def texture_image(doc: dict, tex_index: int) -> int:
    t = doc["textures"][tex_index]
    ext = t.get("extensions", {})
    for k in ("EXT_texture_webp", "KHR_texture_basisu"):
        if k in ext:
            return ext[k]["source"]
    return t["source"]


ROLE_SUFFIX = {"_BC": "BC", "_N": "N", "_ORM": "ORM", "_E": "E"}


def extract_materials(doc: dict, binc: bytes, tex_dir: Path) -> list[dict]:
    tex_dir.mkdir(parents=True, exist_ok=True)
    written: dict[int, str] = {}

    def save(tex_ref: dict | None, role: str) -> str | None:
        if not tex_ref:
            return None
        img = texture_image(doc, tex_ref["index"])
        if img not in written:
            name = doc["images"][img].get("name") or f"image_{img}"
            # 同一张 ORM 同时用作遮蔽与金属粗糙度，同一张图只写一次
            Image.open(io.BytesIO(image_bytes(doc, binc, img))).save(tex_dir / f"{name}.png", optimize=False)
            written[img] = name
        return f"Textures/{written[img]}.png"

    mats = []
    for m in doc.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        tex = {
            "BC": save(pbr.get("baseColorTexture"), "BC"),
            "N": save(m.get("normalTexture"), "N"),
            "ORM": save(pbr.get("metallicRoughnessTexture") or m.get("occlusionTexture"), "ORM"),
            "E": save(m.get("emissiveTexture"), "E"),
        }
        occ_separate = (m.get("occlusionTexture") and pbr.get("metallicRoughnessTexture")
                        and texture_image(doc, m["occlusionTexture"]["index"])
                        != texture_image(doc, pbr["metallicRoughnessTexture"]["index"]))
        mats.append({
            "name": m.get("name", "M_Unnamed"),
            "baseColor": pbr.get("baseColorFactor", [1, 1, 1, 1]),
            "metallic": pbr.get("metallicFactor", 1.0 if pbr.get("metallicRoughnessTexture") else 0.0),
            "roughness": pbr.get("roughnessFactor", 1.0),
            "emissive": m.get("emissiveFactor", [0, 0, 0]),
            "doubleSided": bool(m.get("doubleSided", False)),
            "alphaMode": m.get("alphaMode", "OPAQUE"),
            "alphaCutoff": m.get("alphaCutoff", 0.5),
            "hasOcclusion": bool(m.get("occlusionTexture")),
            "occlusionSeparate": bool(occ_separate),
            "textures": {k: v for k, v in tex.items() if v},
        })
    return mats


def gltf_to_unity_bounds(b: dict | None) -> dict | None:
    """glTF 右手系（+X = 角色左手）→ Unity 左手系（+X = 角色右手）：X 取反。"""
    if not b:
        return None
    lo, hi = b["min"], b["max"]
    return {"min": [-hi[0], lo[1], lo[2]], "max": [-lo[0], hi[1], hi[2]]}


def budget(cls_name: str | None) -> dict | None:
    """pipeline.toml 的规格档，Unity 校验按它检查贴图边长。面数不再是预算：2026-10-25 起不减面，只有一级 LOD。"""
    cls = CFG.data["classes"].get(cls_name or "")
    if not cls:
        return None
    return {"texture": cls.get("texture_hi") or cls.get("texture"), "maxFileKb": cls.get("max_file_kb")}


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def export_one(asset_id: str, entry: dict, force: bool) -> str:
    glb = ROOT / "public" / entry["url"]
    hi = glb.with_name(glb.stem + "@hi.glb")
    src = hi if hi.exists() else glb
    if not src.exists():
        raise PipelineError(f"{asset_id}: 找不到发布文件 {src}")
    category = entry["url"].split("/")[1]
    out_dir = UNITY_ART / CATEGORY_DIR.get(category, category.title()) / asset_id
    sidecar = out_dir / f"{asset_id}.art.json"
    src_hash = sha256(src)
    # registry.toml 的 [assets.<ID>.fur]：毛发 / 羽毛（Unity 导入时 FurBake 烘毛向，FurShells 按画质叠壳层），改了也要重导
    fur = CFG.registry.get(asset_id, {}).get("fur")
    # 第一人称武器：语义零件改名、拆骨、挂点（见 weapon_parts）；改了也要重导
    weapon = weapon_parts(asset_id, entry, category)
    if not force and sidecar.exists():
        old = json.loads(sidecar.read_text(encoding="utf-8"))
        if (old.get("source", {}).get("sha256") == src_hash and old.get("exporterVersion") == EXPORTER_VERSION
                and old.get("fur") == fur and old.get("weapon") == (weapon["art"] if weapon else None)):
            return "unchanged"

    doc, binc = read_glb(src)
    materials = extract_materials(doc, binc, out_dir / "Textures")

    # 先读骨骼名决定人形映射（T-pose 链要传给 Blender）
    joints = []
    for s in doc.get("skins", [])[:1]:
        joints = [doc["nodes"][i].get("name", "") for i in s["joints"]]
    profile, human = humanoid_map(asset_id, joints)
    chains = None
    # T-pose 只给英雄：它们走 Unity Humanoid + Mixamo 重定向，需要 T-pose 参考。
    # 敌人用 Three.js 版采样来的专属动作（Generic，逐骨骼还原），保持 GLB 原来的绑定姿势最精确，不必再做 T-pose 修正。
    if profile and (entry.get("bind") or {}).get("source") == "hero":
        chains = {"L": [human["LeftUpperArm"], human["LeftLowerArm"], human["LeftHand"]],
                  "R": [human["RightUpperArm"], human["RightLowerArm"], human["RightHand"]]}

    fbx = out_dir / f"{asset_id}.fbx"
    mesh_nodes = [n.get("name", "") for n in doc["nodes"] if "mesh" in n]
    params = {"glb": str(src), "fbx": str(fbx), "tpose_chains": chains, "mesh_nodes": mesh_nodes}
    if weapon:
        params |= {"rename_bones": weapon["rename"], "split_joints": weapon["splits"], "move_bones": weapon["move"]}
    res = blender.run("bl_unity_export.py", params, WORK / asset_id, "unity_export")

    rig_mode = (entry.get("rig") or {}).get("mode")
    art = {
        "schema": 1,
        "exporterVersion": EXPORTER_VERSION,
        "id": asset_id,
        "kind": entry.get("kind"),
        "class": entry.get("class"),
        "category": category,
        "bind": entry.get("bind"),
        "keepGlow": entry.get("keepGlow"),
        "lodDistance": entry.get("lodDistance") or [0],
        "budget": budget(entry.get("class")),
        # registry.toml 的 qa_waivers（检查项名 → 理由）：Unity 侧 QA 同名检查记为「已豁免」，不阻塞
        "qaWaivers": CFG.registry.get(asset_id, {}).get("qa_waivers", {}),
        **({"fur": fur} if fur else {}),
        **({"weapon": weapon["art"]} if weapon else {}),
        "bounds": gltf_to_unity_bounds(entry.get("bounds")),
        "rig": {
            "type": "humanoid" if profile else ("generic" if res["armature"] else "none"),
            "profile": profile,
            "partsMode": rig_mode,
            "human": human,
            "tpose": res["tpose"],
            "bones": res["bones"],
        },
        "meshes": res["meshes"],
        "materials": materials,
        "source": {"glb": src.relative_to(ROOT).as_posix(), "sha256": src_hash, "hiRes": src == hi,
                   "version": entry.get("version"), "generator": entry.get("generator"),
                   "license": entry.get("license")},
        "exported": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    sidecar.write_text(json.dumps(art, ensure_ascii=False, indent=2), encoding="utf-8")
    tris = [m["tris"] for m in sorted(res["meshes"], key=lambda m: (m["lod"] is None, m["lod"] or 0))]
    return f"{art['rig']['type']}{'/' + profile if profile else ''} · tris {tris} · {len(materials)} 材质"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("assets", nargs="*")
    ap.add_argument("--set", choices=["showcase"])
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))["assets"]
    ids = list(a.assets) + (SHOWCASE if a.set == "showcase" else []) + (list(manifest) if a.all else [])
    if not ids:
        ap.error("给出资产 ID，或 --set showcase / --all")
    failed = []
    for i, asset_id in enumerate(dict.fromkeys(ids), 1):
        if asset_id not in manifest:
            print(f"[{i}/{len(ids)}] {asset_id}: ✘ 清单里没有（未发布）")
            failed.append(asset_id)
            continue
        try:
            print(f"[{i}/{len(ids)}] {asset_id}: {export_one(asset_id, manifest[asset_id], a.force)}", flush=True)
        except Exception as e:  # 单个失败不中断批次
            print(f"[{i}/{len(ids)}] {asset_id}: ✘ {e}", flush=True)
            failed.append(asset_id)
    if failed:
        print(f"\n失败 {len(failed)} 个：{' '.join(failed)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
