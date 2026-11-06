import sys, json, struct, os, time
from pathlib import Path
src = Path(__import__("os").environ.get("TRIPO_DOWNLOADS", r"S:\文档\Downloads")) / sys.argv[1]
t0 = time.time()
while not src.exists() and time.time() - t0 < 60: time.sleep(1)
last = -1
while True:
    s = src.stat().st_size
    if s == last: break
    last = s; time.sleep(2)
data = src.read_bytes()
hl = struct.unpack_from("<I", data, 0)[0]
head = json.loads(data[4:4 + hl]); off = 4 + hl
out = Path(__file__).parent / "sheets_raw"; out.mkdir(exist_ok=True)
for h in head:
    (out / h["name"]).write_bytes(data[off:off + h["size"]]); off += h["size"]
print(len(head), "files ->", out)
