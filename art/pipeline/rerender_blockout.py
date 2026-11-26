"""重渲染白模四视图：00_blockout/*.png 不入库（.gitignore），换了机器或被清理后就缺，概念阶段要用它们当参考图。

    python art/pipeline/rerender_blockout.py <资产ID> [...]

白模几何（BO_*.glb）和相机说明（*_views.json）都在库里，这里用同一个 bl_blockout.py 按当前版本重新渲染，
原地写回 BO_<ID>_v###_{front,left,back,right,sheet}.png 并刷新状态档案里的校验和——不开新版本，不作废下游。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import blender, imaging  # noqa: E402
from lib.config import CFG, ROOT  # noqa: E402
from lib.state import AssetState  # noqa: E402
from stages.blockout import INPUT_BG, PANEL  # noqa: E402


def rerender(asset_id: str) -> None:
    spec = CFG.asset(asset_id)
    st = AssetState(spec)
    cur = st.require("blockout")
    stem = f"BO_{asset_id}_v{cur['version']:03d}"
    out = spec.stage_dir("blockout")
    glb = out / f"{stem}.glb"
    views = json.loads((out / f"{stem}_views.json").read_text(encoding="utf-8"))
    render_dir = spec.dir / "_tmp" / f"{stem}_rerender"
    res = blender.run("bl_blockout.py", {"blockout_glb": str(glb), "out_dir": str(render_dir), "panel": list(PANEL),
                                         "presentation": views.get("presentation") is not None},
                      render_dir, "blockout")
    panels = []
    for v in imaging.VIEW_ORDER:
        p = out / f"{stem}_{v}.png"
        shutil.copyfile(render_dir / f"view_{v}.png", p)
        panels.append(p)
    imaging.compose_row(panels, out / f"{stem}_sheet.png", bg=INPUT_BG)
    st.refresh_hashes("blockout", cur)
    print(f"✔ {asset_id} 白模 v{cur['version']:03d} 四视图已重渲染（{res['_seconds']:.0f} s）：{(out / f'{stem}_sheet.png').relative_to(ROOT)}")


if __name__ == "__main__":
    for aid in sys.argv[1:]:
        rerender(aid)
