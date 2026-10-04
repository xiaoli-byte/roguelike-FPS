"""阶段 03 · 游戏化：调用 Blender（blender/bl_build.py）把高模加工成带 LOD、PBR 贴图、蒙皮的 GLB。"""

from __future__ import annotations

import json

from lib import blender, imaging
from lib.config import CFG, ROOT, AssetSpec
from lib.state import AssetState


def run(spec: AssetSpec, a) -> None:
    st = AssetState(spec)
    bo = st.require("blockout")
    cn = st.require("concept")
    hp = st.require("highpoly")
    b = CFG.section("build")
    cls = CFG.section("classes")[spec.cls]
    ex = CFG.section("export")

    # 可选的材质分区：必须出自同一个概念版本才用
    mid = st.current("matid")
    if mid and mid.get("from_concept") != cn["version"]:
        mid = None
    eid = st.current("emid")  # 可选的发光分区：同样必须出自同一个概念版本
    if eid and eid.get("from_concept") != cn["version"]:
        eid = None
    ver = st.next_version("build")
    work = spec.stage_dir("build")
    export_dir = spec.stage_dir("export")
    tag = f"{spec.id}_v{ver:03d}"
    name = spec.id.split("_", 1)[1]  # SK_Enemy_Grunt → Enemy_Grunt（贴图命名 T_Enemy_Grunt_BC）
    tex_dir = work / f"textures_v{ver:03d}"
    params = {
        "asset_id": spec.id, "kind": spec.kind, "garment": spec.raw.get("garment"),
        "anchor": "feet" if spec.blockout.get('source') == 'scene' or (spec.kind == "skeletal" and spec.raw.get("rig") != "parts") else "origin",
        "rig_mode": spec.raw.get("rig", "humanoid"), "rig_sigma": spec.raw.get("rig_sigma", 0.015),
        "arm_radius": spec.raw.get("arm_radius", 0.14), "rig_rigid": spec.raw.get("rig_rigid", False), "rig_rigid_joints": spec.raw.get("rig_rigid_joints", []),
        "highpoly_glb": str(st.file(hp, f"HP_{spec.id}_v{hp['version']:03d}.glb")),
        "views_json": str(st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}_views.json")),
        "blockout_json": str(st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}.json")),
        "blockout_glb": (None if bo.get("reference_mode") == "bounds_only" and spec.kind == "static"
                         else str(st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}.glb"))),
        "concept_views": {v: str(st.file(cn, f"CN_{spec.id}_v{cn['version']:03d}_{v}.png")) for v in imaging.VIEW_ORDER},
        "lod_tris": spec.lod_tris, "lod_distance": spec.lod_distance, "texture": spec.texture,
        "roughness": spec.material["roughness"], "metallic": spec.material["metallic"],
        "metal_roughness": spec.material.get("metal_roughness", 0.4), "metal_value": spec.material.get("metal_value", 0.75),
        "matid_views": ({v: str(st.file(mid, f"MID_{spec.id}_v{mid['version']:03d}_{v}.png")) for v in imaging.VIEW_ORDER}
                        if mid else None),
        "emid_views": ({v: str(st.file(eid, f"EID_{spec.id}_v{eid['version']:03d}_{v}.png")) for v in imaging.VIEW_ORDER}
                       if eid else None),
        "texture_dir": str(tex_dir), "texture_basename": f"T_{name}",
        "export_glb": str(export_dir / f"{tag}.glb"), "blend_path": str(work / f"{tag}.blend"),
        "bake_device": spec.raw.get("bake_device", cls.get("bake_device", b["bake_device"])),
        "min_component_fraction": spec.raw.get("min_component_fraction", cls.get("min_component_fraction", 0.01)),
        "remesh_voxel": spec.raw.get("remesh_voxel", cls.get("remesh_voxel", 0.0025)),
        "far_lod_budget_weld_max_fraction": cls.get("far_lod_budget_weld_max_fraction", 0),
        "ao_samples": b["ao_samples"], "bake_margin_px": b["bake_margin_px"],
        "cage_extrusion": b["cage_extrusion"], "projection_sharpness": b["projection_sharpness"],
        "max_bone_influences": b["max_bone_influences"],
        "draco": ex["draco"], "image_format": ex["image_format"], "tangents": ex["tangents"],
    }
    print(f"→ Blender 游戏化 {tag}（LOD 面数 {spec.lod_tris}，贴图 {spec.texture}²）…", flush=True)
    res = blender.run("bl_build.py", params, spec.dir / "_tmp" / f"build_v{ver:03d}", "build")

    metrics = work / f"{tag}_metrics.json"
    metrics.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    files = [work / f"{tag}.blend", export_dir / f"{tag}.glb", metrics, *sorted(tex_dir.glob("*.png"))]
    st.add_version("build", {
        "version": ver, "from": {"blockout": bo["version"], "concept": cn["version"], "highpoly": hp["version"],
                                 "matid": mid["version"] if mid else None, "emid": eid["version"] if eid else None},
        "align_iou": res["align"]["iou"], "uncovered_ratio": res["projection"]["uncovered_ratio"],
        "lods": [{"tris": l["tris"], "verts": l["verts"]} for l in res["lods"]],
        "export_kb": round(res["export"]["bytes"] / 1024, 1), "seconds": res["_seconds"], "bake_device": res["bake_device"],
    }, files)
    print(f"✔ 游戏化 v{ver:03d}：{(export_dir / f'{tag}.glb').relative_to(ROOT)}  "
          f"{res['export']['bytes'] / 1024:.0f} KB，LOD {[l['tris'] for l in res['lods']]}，"
          f"对齐 IoU {res['align']['iou']}，投影未覆盖 {res['projection']['uncovered_ratio']:.1%}，用时 {res['_seconds']} 秒")
