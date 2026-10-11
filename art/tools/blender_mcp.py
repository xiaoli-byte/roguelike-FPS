"""Tiny client for a running Blender's BlenderMCP socket server (127.0.0.1:9876).

python art/tools/blender_mcp.py <file.py>    executes that file's code inside the GUI Blender and prints the result.
"""
import json
import socket
import sys


def execute(code: str, host: str = "127.0.0.1", port: int = 9876, timeout: float = 120.0) -> dict:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode("utf-8"))
        chunks = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            chunks += chunk
            try:
                return json.loads(chunks.decode("utf-8"))
            except json.JSONDecodeError:
                continue
    return json.loads(chunks.decode("utf-8"))


if __name__ == "__main__":
    source = open(sys.argv[1], encoding="utf-8").read()
    print(json.dumps(execute(source), ensure_ascii=False, indent=2))
