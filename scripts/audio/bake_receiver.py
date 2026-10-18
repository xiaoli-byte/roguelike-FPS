"""音频烘焙的本机接收器：audio-bake.html 在浏览器里用 OfflineAudioContext 渲出 Three.js 版的合成音效 / 配乐，
逐个 POST 到这里落盘（浏览器页面不能直接写文件）。

    python -I scripts/audio/bake_receiver.py <输出目录> [端口=8765]

  POST /save?path=<相对路径>   请求体写到 <输出目录>/<相对路径>（只允许 [A-Za-z0-9_@./-]，不许 ..）
  POST /done                    烘焙页收尾，接收器退出
只监听 127.0.0.1；带 CORS 头（页面来自 Vite 开发服务器，端口不同）。
"""
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "audio-bake-out")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
SAFE = re.compile(r"^[A-Za-z0-9_@./-]+$")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        url = urlparse(self.path)
        n = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(n) if n > 0 else b""
        if url.path == "/done":
            self._reply(200, b"bye")
            print("done", flush=True)
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if url.path != "/save":
            return self._reply(404, b"?")
        rel = (parse_qs(url.query).get("path") or [""])[0]
        if not rel or not SAFE.match(rel) or ".." in rel or rel.startswith("/"):
            return self._reply(400, b"bad path")
        dest = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(body)
        print(f"{rel} {len(body)}", flush=True)
        self._reply(200, b"ok")

    def _reply(self, code, data):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    print(f"receiver on 127.0.0.1:{PORT} -> {ROOT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
