"""Tripo 灵宠 GLB → unity/Assets/Art/Pets/<ID>/（FBX + Textures/<ID>_BaseColor.png），之后在 Unity 里跑
「Spiritfire/Pets/Import Pet Models」（或桥接命令 pets）生成 Resources/Pets/<ID>.prefab。

    python art/pipeline/pet_export.py                    # 每只灵宠
    python art/pipeline/pet_export.py SK_Pet_Baize       # 只导一只

GLB 来源：Tripo Studio 导出（GLB、带贴图）→ art/source/_tripo_inbox/<UTC>_<ID>.glb（+ 同名 .json 收据，收件箱不入库）。
收件箱里有比入库版本新的 GLB 时，先把它归档成 art/source/pets/<ID>/03_model/<ID>_tripo_original.glb（入库，和英雄的
Tripo 原件同一惯例），再从归档导出；新机器上没有收件箱也能重建。Unity 侧的 FBX / 贴图不入库，跑完本脚本再在 Unity 里导入。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib import blender  # noqa: E402
from lib.config import ROOT  # noqa: E402

INBOX = ROOT / "art" / "source" / "_tripo_inbox"
UNITY = ROOT / "unity" / "Assets" / "Art" / "Pets"

# 设计尺寸（docs/pet-system.md）：height = 竖直高度；span = 最长水平边（翼展）
SIZES = {
    "SK_Pet_Dangkang": (0.7, "height"),
    "SK_Pet_Huan": (0.6, "height"),
    "SK_Pet_Jingwei": (0.9, "span"),
    "SK_Pet_Chongming": (1.5, "height"),  # 长尾垂下：按高度量，翼展约 0.95 m
    "SK_Pet_Suanni": (0.8, "height"),
    "SK_Pet_Zheng": (0.85, "height"),
    "SK_Pet_Baize": (1.3, "height"),
    "SK_Pet_Yinglong": (2.4, "height"),  # 竖着的 S 形身躯：按高度量
}


def latest(asset: str) -> Path | None:
    found = sorted(INBOX.glob(f"*_{asset}.glb"))
    return found[-1] if found else None


def source(asset: str) -> Path | None:
    """入库的 Tripo 原件；收件箱里有更新的（收据 sha 不同）就先归档过来"""
    model = ROOT / "art" / "source" / "pets" / asset / "03_model"
    archived = model / f"{asset}_tripo_original.glb"
    inbox = latest(asset)
    if inbox:
        receipt = inbox.with_suffix(".json")
        old = model / f"{asset}_tripo_original.json"
        new_sha = json.loads(receipt.read_text(encoding="utf-8")).get("sha256") if receipt.exists() else None
        old_sha = json.loads(old.read_text(encoding="utf-8")).get("sha256") if old.exists() else None
        if not archived.exists() or (new_sha and new_sha != old_sha):
            model.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(inbox, archived)
            if receipt.exists():
                shutil.copyfile(receipt, old)
            print(f"{asset}: 归档 {inbox.name} → {archived.relative_to(ROOT).as_posix()}", flush=True)
    return archived if archived.exists() else None


def export(asset: str) -> dict:
    glb = source(asset)
    if not glb:
        raise SystemExit(f"{asset}: 没有 Tripo 原件（art/source/pets/{asset}/03_model/ 或收件箱）")
    size, measure = SIZES[asset]
    out = UNITY / asset
    res = blender.run("bl_pet_export.py", {
        "asset": asset, "glb": str(glb), "size": size, "measure": measure, "texture": 1024,
        "fbx": str(out / f"{asset}.fbx"), "texture_dir": str(out / "Textures"),
    }, ROOT / "art" / "source" / "pets" / asset / "export", "pet_export")
    (out / f"{asset}.pet.json").write_text(json.dumps({
        "asset": asset, "source_glb": glb.relative_to(ROOT).as_posix(), "size_m": size, "measure": measure,
        "tris": res["tris"], "dims_m": [round(d, 3) for d in res["dims"]],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("assets", nargs="*")
    a = ap.parse_args()
    for asset in a.assets or [k for k in SIZES if source(k)]:
        r = export(asset)
        print(f"{asset}: {r['tris']} tris, {r['dims']}, {r['_seconds']} s", flush=True)


if __name__ == "__main__":
    main()
