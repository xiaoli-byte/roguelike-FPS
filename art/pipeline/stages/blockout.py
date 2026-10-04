"""阶段 00 · 白模：接收游戏导出的程序化模型，渲染四视图并记下相机参数。"""

from __future__ import annotations

import json
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from lib import blender, imaging
from lib.config import CFG, ROOT, PipelineError
from lib.state import AssetState, now, sha256

PANEL = (512, 1024)
INPUT_BG = (214, 214, 214, 255)  # 给概念阶段的参考图用中性浅灰底，方便模型分清格子


def incoming_dir(asset_id: str) -> Path:
    spec = CFG.asset(asset_id)
    d = spec.dir / "_tmp" / "incoming"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ingest(asset_id: str) -> dict:
    """把 _tmp/incoming 里的白模登记为新版本并渲染四视图。"""
    spec = CFG.asset(asset_id)
    st = AssetState(spec)
    inc = incoming_dir(asset_id)
    glb, meta = inc / "blockout.glb", inc / "blockout.json"
    if not glb.exists() or not meta.exists():
        raise PipelineError(f"{asset_id}: 没有收到白模（需要 blockout.glb + blockout.json）")
    m = json.loads(meta.read_text(encoding="utf-8"))
    if m.get("assetId") != asset_id:
        raise PipelineError(f"白模说明里的 assetId={m.get('assetId')} 与 {asset_id} 不符")

    # 几何没变、只是说明文件补了字段：在当前版本内修订，不作废下游（避免为元数据变更重出概念 / 高模）
    cur = st.current("blockout")
    if cur:
        cur_glb = st.file(cur, f"BO_{asset_id}_v{cur['version']:03d}.glb")
        cur_views = st.file(cur, f"BO_{asset_id}_v{cur['version']:03d}_views.json")
        scene_needs_upright = spec.blockout.get('source') == 'scene' and cur_views.exists() and json.loads(cur_views.read_text(encoding='utf-8')).get('presentation') is not None
        if cur_glb.exists() and sha256(cur_glb) == sha256(glb) and not scene_needs_upright:
            cur_meta = st.file(cur, f"BO_{asset_id}_v{cur['version']:03d}.json")
            shutil.copyfile(meta, cur_meta)
            cur.setdefault("amendments", []).append({"time": now(), "reason": "几何不变，更新白模说明"})
            st.refresh_hashes("blockout", cur)
            print(f"✔ {asset_id} 白模 v{cur['version']:03d} 几何未变，已原地更新说明文件（下游不受影响）")
            return cur

    ver = st.next_version("blockout")
    out = spec.stage_dir("blockout")
    stem = f"BO_{asset_id}_v{ver:03d}"
    dst_glb, dst_meta = out / f"{stem}.glb", out / f"{stem}.json"
    shutil.copyfile(glb, dst_glb)
    shutil.copyfile(meta, dst_meta)

    render_dir = spec.dir / "_tmp" / stem
    # 静态网格（挂件）按「最长轴竖直、最薄方向朝正面相机」摆展示姿态，正面图就是信息量最大的侧影
    res = blender.run("bl_blockout.py", {"blockout_glb": str(dst_glb), "out_dir": str(render_dir), "panel": list(PANEL),
                                         "presentation": (spec.kind == "static" and spec.blockout.get('source') != 'scene') or bool(spec.raw.get("presentation"))},
                      render_dir, "blockout")
    views_json = out / f"{stem}_views.json"
    views_json.write_text(json.dumps({"panel": list(PANEL), "views": res["views"], "bbox_min": res["bbox_min"],
                                      "bbox_max": res["bbox_max"], "presentation": res.get("presentation")}, indent=2),
                          encoding="utf-8")
    panels = []
    for v in imaging.VIEW_ORDER:
        p = out / f"{stem}_{v}.png"
        shutil.copyfile(render_dir / f"view_{v}.png", p)
        panels.append(p)
    sheet = out / f"{stem}_sheet.png"
    imaging.compose_row(panels, sheet, bg=INPUT_BG)

    rec = st.add_version("blockout", {
        "version": ver, "source": m["source"], "joints": len(m.get("joints", [])),
        "bounds": m["bounds"], "blender_seconds": res["_seconds"],
    }, [dst_glb, dst_meta, views_json, sheet, *panels])
    print(f"✔ {asset_id} 白模 v{ver:03d}：{sheet.relative_to(ROOT)}")
    return rec


class _Handler(BaseHTTPRequestHandler):
    def _reply(self, code: int, text: str) -> None:
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        parts = self.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "blockout" or parts[2] not in ("blockout.glb", "blockout.json"):
            return self._reply(404, "POST /blockout/<资产ID>/blockout.glb|blockout.json")
        asset_id, name = parts[1], parts[2]
        try:
            data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            (incoming_dir(asset_id) / name).write_bytes(data)
            print(f"← {asset_id}/{name}  {len(data) / 1024:.1f} KB", flush=True)
            if name == "blockout.json":  # 约定 JSON 最后发，收到即入库
                ingest(asset_id)
            self._reply(200, "ok")
        except PipelineError as e:
            print(f"✘ {e}", flush=True)
            self._reply(400, str(e))

    def log_message(self, *a) -> None:  # 安静
        pass


def serve(once: bool = False) -> None:
    port = int(CFG.tools["receiver_port"])
    srv = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    print(f"白模接收端已启动 http://127.0.0.1:{port}  —— 在 ?debug 的游戏控制台里执行 src/dev/artExport.ts 的导出函数", flush=True)
    if once:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
