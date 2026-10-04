"""阶段 04 · 自动 QA：对照规格检查导出的 GLB（包级）和 Blender 侧度量（DCC 级）。

结论分三级：✔ 通过 / ⚠ 警告（记录在案，不阻塞）/ ✘ 错误（阻塞后续阶段）。
"""

from __future__ import annotations

import json
import re

from lib.config import CFG, ROOT, AssetSpec, PipelineError
from lib.glb import Glb
from lib.state import AssetState

SUPPORTED_EXT = {"KHR_draco_mesh_compression", "EXT_texture_webp", "KHR_texture_transform",
                 "KHR_materials_emissive_strength", "KHR_mesh_quantization", "EXT_meshopt_compression"}
TEX_SUFFIX = re.compile(r"^T_[A-Z][A-Za-z]+_[A-Z][A-Za-z0-9]+_(BC|N|ORM|E)$")


def run(spec: AssetSpec, a) -> None:
    st = AssetState(spec)
    bd = st.require("build")
    bo = st.require("blockout")
    tag = f"{spec.id}_v{bd['version']:03d}"
    glb_path = st.file(bd, f"{tag}.glb")
    m = json.loads(st.file(bd, f"{tag}_metrics.json").read_text(encoding="utf-8"))
    blockout = json.loads(st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}.json").read_text(encoding="utf-8"))
    views = json.loads(st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}_views.json").read_text(encoding="utf-8"))
    g = Glb(glb_path)
    J = g.json
    checks: list[tuple[str, str, str]] = []
    # QA 豁免：登记表 qa_waivers = { "<检查项名>" = "<理由>" }，用于有意的设计偏差；不通过时记为「已豁免」并留档
    waivers: dict = spec.raw.get("qa_waivers", {})

    def ok(name, cond, detail, level="error"):
        if not cond and name in waivers:
            checks.append(("waived", name, f"{detail}  —— 豁免：{waivers[name]}"))
        else:
            checks.append(("pass" if cond else level, name, detail))

    # ── 包级 ──
    ok("文件大小", g.size <= spec.max_file_kb * 1024, f"{g.size / 1024:.0f} KB / 上限 {spec.max_file_kb} KB")
    req = set(J.get("extensionsRequired", []))
    ok("扩展可用", req <= SUPPORTED_EXT, f"必需扩展 {sorted(req)}")
    nodes = {n["name"]: n for n in J.get("nodes", []) if "name" in n}
    lod_nodes = sorted([n for n in nodes if re.fullmatch(rf"{spec.id}_LOD\d", n)])
    ok("LOD 数量", len(lod_nodes) == len(spec.lod_tris), f"{lod_nodes}，规格 {len(spec.lod_tris)} 级")
    for i, name in enumerate(lod_nodes):
        n = nodes[name]
        tris = g.mesh_tris(n["mesh"])
        budget = spec.lod_tris[i] if i < len(spec.lod_tris) else 0
        ok(f"LOD{i} 面数", tris <= budget * 1.02, f"{tris} / 预算 {budget}")
        if i > 0:
            prev = g.mesh_tris(nodes[lod_nodes[i - 1]]["mesh"])
            ok(f"LOD{i} 递减", tris < prev, f"{prev} → {tris}", "warn")
        ok(f"LOD{i} 切换距离", n.get("extras", {}).get("lod_distance") == spec.lod_distance[i],
           f"extras.lod_distance={n.get('extras', {}).get('lod_distance')}", "warn")
        if i == 0 and spec.blockout.get('source') == 'scene':
            # 白模提供目标尺度。引擎 fitScenePropScale 按真实碰撞体和朝向等比收纳；
            # 原始美术尺寸超出参考时警告，极端尺寸仍拒绝，避免以参考轮廓约束生成造型。
            lo, hi = g.mesh_bounds(n['mesh'])
            blo, bhi = blockout['bounds']['min'], blockout['bounds']['max']
            for ax in (0, 2):
                size = hi[ax] - lo[ax]
                limit = bhi[ax] - blo[ax]
                ok(f"场景参考占地 {'XYZ'[ax]} 轴", size <= limit * 1.15, f'{size:.3f} m / 参考 {limit * 1.15:.3f} m；超出时引擎按碰撞体等比适配', 'warn')
                ok(f"场景有效尺寸 {'XYZ'[ax]} 轴", 0 < size <= limit * 3, f'{size:.3f} m / 极限 {limit * 3:.3f} m')
                minimum_fraction = CFG.section('classes')[spec.cls].get('min_reference_span_fraction', 0)
                if minimum_fraction:
                    minimum = limit * minimum_fraction
                    ok(f"自然三维体量 {'XYZ'[ax]} 轴", size >= minimum,
                       f'{size:.3f} m / 最低 {minimum:.3f} m；薄片须由 Hunyuan 重生成，不能拉伸修补')
            h_bo = bhi[1] - blo[1]
            ok('场景高度', abs((hi[1] - lo[1]) - h_bo) <= h_bo * 0.15, f'{hi[1]-lo[1]:.3f} m / 参考 {h_bo:.3f} m')
            ok('场景脚底落地', abs(lo[1]) <= 0.015, f'最低点 y={lo[1]:.4f}')
            ok('场景轴心居中', abs((lo[0]+hi[0])/2) <= 0.10 and abs((lo[2]+hi[2])/2) <= 0.10, f'中心 x={(lo[0]+hi[0])/2:.3f} z={(lo[2]+hi[2])/2:.3f}', 'warn')
        elif i == 0 and (spec.kind == "static" or spec.raw.get("presentation")):
            # 挂件 / 按展示姿态重建的部件资产（枪）：原点是挂点，对比挂点局部空间里的三轴尺寸与中心（白模说明里的 bounds 就在这个空间）
            lo, hi = g.mesh_bounds(n["mesh"])
            blo, bhi = blockout["bounds"]["min"], blockout["bounds"]["max"]
            size = [h - l for l, h in zip(lo, hi)]
            bsize = [h - l for l, h in zip(blo, bhi)]
            big = max(bsize)
            thin = bsize.index(min(bsize))  # 展示姿态里朝相机的深度轴：单视图重建只能猜它，误差最大
            for ax in range(3):
                ok(f"尺寸 {'XYZ'[ax]} 轴" + ("（深度轴）" if ax == thin else ""),
                   abs(size[ax] - bsize[ax]) <= max(0.15 * bsize[ax], 0.03 * big),
                   f"{size[ax]:.3f} m（白模 {bsize[ax]:.3f} m）", "warn" if ax == thin else "error")
            off = max(abs((l + h) / 2 - (bl + bh) / 2) for l, h, bl, bh in zip(lo, hi, blo, bhi))
            ok("相对挂点位置", off <= 0.06 * big, f"中心偏移 {off:.3f} m（上限 {0.06 * big:.3f}）")
        elif i == 0:
            lo, hi = g.mesh_bounds(n["mesh"])
            h_bo = views["bbox_max"][2] - views["bbox_min"][2]
            ok("高度", abs((hi[1] - lo[1]) - h_bo) / h_bo <= 0.06, f"{hi[1] - lo[1]:.3f} m（白模 {h_bo:.3f} m）")
            if spec.raw.get("rig") == "parts":
                # 部件骨架没有脚底可对：查竖直中心是否与白模一致（上下错位会让网格和关节对不上）。
                # 不查最低点：漂浮怪的冰锥尾尖、Boss 的细长冠刺在重建里常被做短，最低点会偏，但网格并没有错位
                b_lo, b_hi = blockout["bounds"]["min"][1], blockout["bounds"]["max"][1]
                c, bc = (lo[1] + hi[1]) / 2, (b_lo + b_hi) / 2
                ok("竖直中心与白模一致", abs(c - bc) <= 0.03 * h_bo,
                   f"中心 y={c:.3f}（白模 {bc:.3f}），最低点 {lo[1]:.3f} / 最高点 {hi[1]:.3f}（白模 {b_lo:.3f} / {b_hi:.3f}）")
            else:
                ok("轴心在脚底", abs(lo[1]) <= 0.01, f"最低点 y={lo[1]:.4f}")
            cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
            ok("水平居中", abs(cx) <= 0.06 and abs(cz) <= 0.08, f"包围盒中心 x={cx:.3f} z={cz:.3f}", "warn")

    mats = J.get("materials", [])
    ok("材质数量", len(mats) == 1, f"{[x.get('name') for x in mats]}（一个资产一个材质，便于合批）", "warn")
    ok("材质命名", all(re.fullmatch(r"M_[A-Z][A-Za-z]+_[A-Z][A-Za-z0-9]+", x.get("name", "")) for x in mats),
       f"{[x.get('name') for x in mats]}")
    for i, img in enumerate(J.get("images", [])):
        w, h, fmt = g.image_size(i)
        nm = img.get("name", "")
        ok(f"贴图 {nm}", w == h == spec.texture and (w & (w - 1)) == 0, f"{w}×{h} {fmt}（规格 {spec.texture}²）")
        ok(f"贴图命名 {nm}", bool(TEX_SUFFIX.match(nm)), "T_<类>_<名>_BC|N|ORM|E")
    if mats:
        ef = mats[0].get("emissiveFactor") or [0, 0, 0]
        if max(ef) > 0:  # 有自发光强度却没有遮罩贴图 = 整个模型发光
            ok("自发光贴图", "emissiveTexture" in mats[0], f"emissiveFactor {ef}")
        pbr = mats[0].get("pbrMetallicRoughness", {})
        ok("BaseColor 贴图", "baseColorTexture" in pbr, "")
        ok("法线贴图", "normalTexture" in mats[0], "")
        ok("ORM 贴图", "metallicRoughnessTexture" in pbr and "occlusionTexture" in mats[0], "AO / 粗糙度 / 金属度")

    # ── 骨骼 ──
    if spec.kind == "skeletal":
        skins = J.get("skins", [])
        ok("蒙皮", len(skins) == 1, f"{len(skins)} 个 skin")
        if skins:
            names = {J["nodes"][j]["name"] for j in skins[0]["joints"]}
            want = {j["name"] for j in blockout["joints"]}
            ok("骨骼与游戏关节一致", names == want, f"缺 {sorted(want - names)} 多 {sorted(names - want)}")
        bp = m.get("bind_pose")
        if bp:
            dl, dr = bp["armSpreadL"] - bp["base"], bp["armSpreadR"] - bp["base"]
            ok("骨骼适配幅度", max(abs(dl), abs(dr)) <= 0.25,
               f"上臂绑定角 L {bp['armSpreadL']:.3f} / R {bp['armSpreadR']:.3f}（白模 {bp['base']}）", "warn")
            ok("左右对称", abs(dl - dr) <= 0.12, f"左右适配差 {abs(dl - dr):.3f} rad", "warn")
        # 手臂骨的影响不应铺到身体上：主导顶点离骨段的 p90 超过 登记半径 × 1.6 就报错
        arm_r = spec.raw.get("arm_radius", 0.14)
        for b, sp in m.get("skin", {}).get("spread", {}).items():
            if b[:-1] in ("arm", "elbow", "hand"):
                ok(f"{b} 影响范围", sp["p90_m"] <= arm_r * 1.6, f"主导 {sp['verts']} 个顶点，离骨段 p90 {sp['p90_m']} m（上限 {arm_r * 1.6:.2f}）")
        for lod, s in m.get("skin", {}).get("per_lod", {}).items():
            ok(f"{lod} 影响骨骼数", s["max_influences"] <= 4, f"最多 {s['max_influences']}")
            ok(f"{lod} 无权重顶点", s["unweighted_verts"] == 0, f"{s['unweighted_verts']}")
            ok(f"{lod} bone heat 覆盖", s.get("heat_failed_verts", 0) <= 20, f"{s.get('heat_failed_verts', 0)} 个顶点改用平滑邻近权重", "warn")

    # ── DCC 级 ──
    for l in m["lods"]:
        ok(f"{l['name']} UV 范围", min(l["uv_min"]) >= -1e-3 and max(l["uv_max"]) <= 1 + 1e-3, f"{l['uv_min']}..{l['uv_max']}")
    ok("UV 利用率", m["lods"][0]["uv_utilization"] >= 0.5, f"{m['lods'][0]['uv_utilization']:.0%}", "warn")
    if "uv" in m:
        u = m["uv"]
        if u.get("method", "merged") == "merged":
            ok("UV 翻折", u["flipped_ratio"] <= 0.005, f"{u['flipped_faces']} 个面（{u['flipped_ratio']:.2%}），图块 {u['charts']} 个", "warn")
    ok("高模对齐", m["align"]["iou"] >= 0.75, f"剪影 IoU {m['align']['iou']}（{m['align']['iou_per_view']}）", "warn")
    ok("投影覆盖", m["projection"]["uncovered_ratio"] <= 0.45, f"未覆盖顶点 {m['projection']['uncovered_ratio']:.0%}（扩散补色）", "warn")

    errors = [c for c in checks if c[0] == "error"]
    waived = [c for c in checks if c[0] == "waived"]
    warns = [c for c in checks if c[0] == "warn"]
    icon = {"pass": "✔", "warn": "⚠", "error": "✘", "waived": "◇"}
    for lvl, name, detail in checks:
        print(f"  {icon[lvl]} {name:22} {detail}")
    # Bounds-only generation retries keep every QA verdict and its original file hash.
    validation_version = st.next_version("validate")
    suffix = f"_validation_v{validation_version:03d}.json" if spec.raw.get('reference_mode') == 'bounds_only' else '_validation.json'
    report = spec.stage_dir("review") / f"{tag}{suffix}"
    report.write_text(json.dumps([{"level": l, "check": n, "detail": d} for l, n, d in checks], ensure_ascii=False, indent=2), encoding="utf-8")
    st.add_version("validate", {"version": validation_version, "from_build": bd["version"],
                                "errors": len(errors), "warnings": len(warns), "waived": [c[1] for c in waived],
                                "passed": not errors}, [report])
    if spec.raw.get('reference_mode') == 'bounds_only':
        with st._locked():
            validated_build = st._find('build', bd['version'])
            validated_build['quality_status'] = 'failed' if errors else 'passed'
            validated_build['quality_errors'] = [c[1] for c in errors]
    print(f"{'✘' if errors else '✔'} 校验 {tag}：{len(checks) - len(errors) - len(warns) - len(waived)} 通过，"
          f"{len(warns)} 警告，{len(waived)} 豁免，{len(errors)} 错误"
          f"  → {report.relative_to(ROOT)}")
    if errors:
        raise PipelineError(f"{spec.id} 校验未通过（{len(errors)} 个错误）")
