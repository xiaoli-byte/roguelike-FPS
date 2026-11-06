"""archive.py <ID> <task-uuid> <face_target> [--views note] : copy Downloads/<ID>.glb into art/source/_tripo_inbox/<UTC>_<ID>.glb + receipt"""
import sys, json, shutil, hashlib, datetime, struct, os
from pathlib import Path
aid, task, faces = sys.argv[1], sys.argv[2], int(sys.argv[3])
note = sys.argv[4] if len(sys.argv) > 4 else "multiview front/left/right/back from the registered concept"
src = Path(os.environ.get("TRIPO_DOWNLOADS", r"S:\文档\Downloads")) / f"{aid}.glb"
inbox = Path(__file__).resolve().parents[3] / "art" / "source" / "_tripo_inbox"
utc = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%S")
dst = inbox / f"{utc}_{aid}.glb"
shutil.copyfile(src, dst)
data = dst.read_bytes()
sha = hashlib.sha256(data).hexdigest()
# glb json chunk: count triangles / images / materials
jl = struct.unpack_from("<I", data, 12)[0]
J = json.loads(data[20:20 + jl])
tris = 0
for m in J.get("meshes", []):
    for p in m["primitives"]:
        if "indices" in p:
            tris += J["accessors"][p["indices"]]["count"] // 3
rec = {"asset": aid, "task": f"https://studio.tripo3d.ai/workspace/generate/{task}", "source": str(src), "sha256": sha,
       "tripo": {"mode": "smart mesh, " + note, "model": "P2.0", "topology": "triangle", "face_target": faces,
                 "texture": "texture generation" + (", delight" if os.environ.get("TRIPO_DELIGHT", "1") == "1" else ""), "export": "GLB 4k"},
       "credits": {"mesh": 100, "texture": 30},
       "glb": {"bytes": len(data), "triangles": tris, "images": len(J.get("images", [])), "materials": len(J.get("materials", []))},
       "archived_utc": utc}
dst.with_suffix(".json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
print(dst, tris, len(data))
