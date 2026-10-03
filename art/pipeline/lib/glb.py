"""最小 GLB 读取器：只解析 JSON 块和图片头，用于导出后的包级校验（Draco 压缩的几何不解码，只读访问器元数据）。"""

from __future__ import annotations

import json
import struct
from pathlib import Path


class Glb:
    def __init__(self, path: Path) -> None:
        data = path.read_bytes()
        magic, version, length = struct.unpack_from("<4sII", data, 0)
        if magic != b"glTF" or version != 2:
            raise ValueError(f"{path} 不是 glTF 2.0 GLB")
        off = 12
        self.json: dict = {}
        self.bin = b""
        while off < length:
            clen, ctype = struct.unpack_from("<I4s", data, off)
            chunk = data[off + 8: off + 8 + clen]
            if ctype == b"JSON":
                self.json = json.loads(chunk)
            elif ctype == b"BIN\x00":
                self.bin = chunk
            off += 8 + clen
        self.size = len(data)

    def image_bytes(self, index: int) -> bytes:
        img = self.json["images"][index]
        bv = self.json["bufferViews"][img["bufferView"]]
        o = bv.get("byteOffset", 0)
        return self.bin[o: o + bv["byteLength"]]

    def image_size(self, index: int) -> tuple[int, int, str]:
        b = self.image_bytes(index)
        if b[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", b[16:24])
            return w, h, "png"
        if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
            kind = b[12:16]
            if kind == b"VP8 ":
                w, h = struct.unpack("<HH", b[26:30])
                return w & 0x3FFF, h & 0x3FFF, "webp"
            if kind == b"VP8L":
                bits = int.from_bytes(b[21:25], "little")
                return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, "webp"
            if kind == b"VP8X":
                return int.from_bytes(b[24:27], "little") + 1, int.from_bytes(b[27:30], "little") + 1, "webp"
        if b[:2] == b"\xff\xd8":
            i = 2
            while i < len(b):
                if b[i] != 0xFF:
                    break
                marker, seg = b[i + 1], struct.unpack(">H", b[i + 2:i + 4])[0]
                if marker in (0xC0, 0xC1, 0xC2):
                    h, w = struct.unpack(">HH", b[i + 5:i + 9])
                    return w, h, "jpeg"
                i += 2 + seg
        return 0, 0, "unknown"

    def mesh_tris(self, mesh_index: int) -> int:
        n = 0
        for prim in self.json["meshes"][mesh_index]["primitives"]:
            if "indices" in prim:
                n += self.json["accessors"][prim["indices"]]["count"] // 3
            else:
                n += self.json["accessors"][prim["attributes"]["POSITION"]]["count"] // 3
        return n

    def mesh_bounds(self, mesh_index: int) -> tuple[list[float], list[float]]:
        lo, hi = [1e9] * 3, [-1e9] * 3
        for prim in self.json["meshes"][mesh_index]["primitives"]:
            acc = self.json["accessors"][prim["attributes"]["POSITION"]]
            lo = [min(a, b) for a, b in zip(lo, acc["min"])]
            hi = [max(a, b) for a, b in zip(hi, acc["max"])]
        return lo, hi
