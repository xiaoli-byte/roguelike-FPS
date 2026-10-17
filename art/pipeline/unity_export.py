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


def budget(cls_name: str | None, asset_id: str = "") -> dict | None:
    """pipeline.toml 的规格档，Unity 校验按它检查每级 LOD 面数与贴图边长（registry.toml 的资产级 lod_tris 覆盖优先，
    与 assetctl validate 一致）。"""
    cls = CFG.data["classes"].get(cls_name or "")
    if not cls:
        return None
    lod_tris = CFG.registry.get(asset_id, {}).get("lod_tris", cls.get("lod_tris"))
    return {"lodTris": lod_tris, "texture": cls.get("texture_hi") or cls.get("texture"),
            "maxFileKb": cls.get("max_file_kb")}


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
    if not force and sidecar.exists():
        old = json.loads(sidecar.read_text(encoding="utf-8"))
        if old.get("source", {}).get("sha256") == src_hash and old.get("exporterVersion") == EXPORTER_VERSION:
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
    res = blender.run("bl_unity_export.py", {"glb": str(src), "fbx": str(fbx), "tpose_chains": chains,
                                             "mesh_nodes": mesh_nodes}, WORK / asset_id, "unity_export")

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
        "budget": budget(entry.get("class"), asset_id),
        # registry.toml 的 qa_waivers（检查项名 → 理由）：Unity 侧 QA 同名检查记为「已豁免」，不阻塞
        "qaWaivers": CFG.registry.get(asset_id, {}).get("qa_waivers", {}),
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
