"""阶段 06 · 发布：把审核通过的 GLB 拷进运行时目录（public/assets），更新资产清单 manifest.json。

清单是引擎和管线之间唯一的契约：引擎只读清单，不关心源资产目录。
每条记录：资产 ID、URL、类型、绑定目标、LOD 切换距离、包围盒、版本血缘、校验和。
"""

from __future__ import annotations

import json
import shutil

from lib.config import CFG, ROOT, AssetSpec, PipelineError
from lib.glb import Glb
from lib.state import AssetState, now, sha256


def run(spec: AssetSpec, a) -> None:
    st = AssetState(spec)
    rv = st.require("review")
    bd = st.require("build")
    if rv.get("from_build") != bd["version"]:
        raise PipelineError(f"{spec.id}: 审核过的是 build v{rv.get('from_build'):03d}，当前是 v{bd['version']:03d}，先重新出审核图")
    tag = f"{spec.id}_v{bd['version']:03d}"
    src = st.file(bd, f"{tag}.glb")
    dst = spec.runtime_path
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)

    g = Glb(dst)
    lo, hi = g.mesh_bounds(next(n["mesh"] for n in g.json["nodes"] if n.get("name") == f"{spec.id}_LOD0"))
    metrics = json.loads(st.file(bd, f"{tag}_metrics.json").read_text(encoding="utf-8"))
    bind_pose = metrics.get("bind_pose")
    rig = None
    if spec.raw.get("rig") == "parts":
        bo = st.require("blockout")
        bmeta = json.loads(st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}.json").read_text(encoding="utf-8"))
        rig = {"mode": "parts", "joints": [[j["name"], j["restLocal"]] for j in bmeta["joints"]], "keep": bmeta.get("keep", [])}
    manifest_path = ROOT / CFG.paths["manifest"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"schema": 1, "assets": {}}
    entry = {
        "url": spec.runtime_url,
        "kind": spec.kind,
        "class": spec.cls,
        "bind": spec.blockout,
        "keepGlow": spec.keep_glow,
        "lodDistance": spec.lod_distance,
        # 骨骼适配后的绑定姿势（运行时 applyBindPose 用它求逆绑定矩阵）
        **({"bindPose": {"armSpreadL": bind_pose["armSpreadL"], "armSpreadR": bind_pose["armSpreadR"]}} if bind_pose else {}),
        **({"rig": rig} if rig else {}),
        "bounds": {"min": lo, "max": hi},
        "version": {k: (st.current(k) or {}).get("version") for k in ("blockout", "concept", "highpoly", "build")},
        "sha256": sha256(dst),
        "bytes": dst.stat().st_size,
        "published": now(),
        "license": "Hunyuan3D 2.1 生成：Tencent Hunyuan 3D Community License，不得在欧盟 / 英国 / 韩国使用或分发",
    }
    manifest["assets"][spec.id] = entry
    manifest["updated"] = now()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    st.add_version("publish", {"version": st.next_version("publish"), "from_build": bd["version"], "url": spec.runtime_url}, [dst])
    print(f"✔ 已发布 {spec.id} → {dst.relative_to(ROOT)}（{entry['bytes'] / 1024:.0f} KB），清单 {manifest_path.relative_to(ROOT)}")
