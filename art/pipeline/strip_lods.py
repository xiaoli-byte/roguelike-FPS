"""Drop the far LODs (nodes <name>_LOD1, _LOD2 …) from published GLBs, keeping LOD0 byte for byte.

    python art/pipeline/strip_lods.py                 # every asset in public/assets/manifest.json (and its @hi variant)
    python art/pipeline/strip_lods.py SK_Boss_Kui …   # only these
    python art/pipeline/strip_lods.py --check         # list what would change, write nothing

2026-10-25, the user: 「不要减面了，所有的模型都不需要减少面数」. The builds now publish one LOD (pipeline.toml);
this migrates what was already published without rebuilding (most sources are not on every machine): the far-LOD
nodes go, and with them every mesh, skin, material, texture, image, accessor and buffer view that only they used.
Everything LOD0 keeps is copied unchanged (Draco streams and WebP images are not re-encoded). The manifest entry gets
lodDistance [0] and the new sha256 / bytes.
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.config import CFG, ROOT  # noqa: E402
from lib.state import now, sha256  # noqa: E402

FAR = re.compile(r"_LOD([1-9]\d*)$")
TEXTURE_SLOTS = ("baseColorTexture", "metallicRoughnessTexture")
MATERIAL_SLOTS = ("normalTexture", "occlusionTexture", "emissiveTexture")


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, _, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path} is not a GLB")
    off, doc, binc = 12, None, b""
    while off < len(data):
        n, kind = struct.unpack_from("<II", data, off)
        chunk = data[off + 8:off + 8 + n]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk.decode("utf-8"))
        elif kind == 0x004E4942:
            binc = chunk
        off += 8 + n
    return doc, binc


def write_glb(path: Path, doc: dict, binc: bytes) -> None:
    js = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    binc += b"\0" * (-len(binc) % 4)
    total = 12 + 8 + len(js) + (8 + len(binc) if binc else 0)
    out = struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
    if binc:
        out += struct.pack("<II", len(binc), 0x004E4942) + binc
    path.write_bytes(out)


def texture_refs(mat: dict) -> list[dict]:
    refs = [mat.get(k) for k in MATERIAL_SLOTS]
    refs += [mat.get("pbrMetallicRoughness", {}).get(k) for k in TEXTURE_SLOTS]
    return [r for r in refs if isinstance(r, dict) and "index" in r]


def strip(doc: dict, binc: bytes) -> tuple[dict, bytes, list[str]] | None:
    nodes = doc.get("nodes", [])
    drop = {i for i, n in enumerate(nodes) if FAR.search(n.get("name", ""))}
    if not drop:
        return None
    # a far-LOD node's children (none in practice) go with it
    stack = list(drop)
    while stack:
        for c in nodes[stack.pop()].get("children", []):
            if c not in drop:
                drop.add(c)
                stack.append(c)
    dropped = sorted(nodes[i]["name"] for i in drop)
    keep_n = [i for i in range(len(nodes)) if i not in drop]
    nmap = {o: k for k, o in enumerate(keep_n)}
    new_nodes = [dict(nodes[i]) for i in keep_n]
    for n in new_nodes:
        if "children" in n:
            n["children"] = [nmap[c] for c in n["children"] if c in nmap]
            if not n["children"]:
                del n["children"]
    for sc in doc.get("scenes", []):
        sc["nodes"] = [nmap[i] for i in sc.get("nodes", []) if i in nmap]
    skins = doc.get("skins", [])
    for sk in skins:
        sk["joints"] = [nmap[j] for j in sk["joints"]]          # joints are bones, never LOD nodes
        if "skeleton" in sk:
            sk["skeleton"] = nmap[sk["skeleton"]]
    for an in doc.get("animations", []):
        an["channels"] = [c for c in an["channels"] if c["target"].get("node") in nmap]
        for c in an["channels"]:
            c["target"]["node"] = nmap[c["target"]["node"]]

    def compact(key: str, used: set[int]) -> dict[int, int]:
        items = doc.get(key, [])
        order = [i for i in range(len(items)) if i in used]
        doc[key] = [items[i] for i in order]
        if not doc[key]:
            doc.pop(key, None)
        return {o: k for k, o in enumerate(order)}

    # meshes and skins still referenced
    mmap = compact("meshes", {n["mesh"] for n in new_nodes if "mesh" in n})
    smap = compact("skins", {n["skin"] for n in new_nodes if "skin" in n})
    for n in new_nodes:
        if "mesh" in n:
            n["mesh"] = mmap[n["mesh"]]
        if "skin" in n:
            n["skin"] = smap[n["skin"]]
    doc["nodes"] = new_nodes
    # materials → textures → images / samplers
    prims = [p for m in doc.get("meshes", []) for p in m["primitives"]]
    matmap = compact("materials", {p["material"] for p in prims if "material" in p})
    for p in prims:
        if "material" in p:
            p["material"] = matmap[p["material"]]
    used_tex = {r["index"] for m in doc.get("materials", []) for r in texture_refs(m)}
    texmap = compact("textures", used_tex)
    for m in doc.get("materials", []):
        for r in texture_refs(m):
            r["index"] = texmap[r["index"]]

    def tex_sources(t: dict) -> list[tuple[dict, str]]:
        out = [(t, "source")] if "source" in t else []
        out += [(e, "source") for e in t.get("extensions", {}).values() if isinstance(e, dict) and "source" in e]
        return out
    imap = compact("images", {holder[k] for t in doc.get("textures", []) for holder, k in tex_sources(t)})
    for t in doc.get("textures", []):
        for holder, k in tex_sources(t):
            holder[k] = imap[holder[k]]
    sampmap = compact("samplers", {t["sampler"] for t in doc.get("textures", []) if "sampler" in t})
    for t in doc.get("textures", []):
        if "sampler" in t:
            t["sampler"] = sampmap[t["sampler"]]
    # accessors
    used_acc = set()
    for p in prims:
        used_acc.update(p.get("attributes", {}).values())
        if "indices" in p:
            used_acc.add(p["indices"])
        for tg in p.get("targets", []):
            used_acc.update(tg.values())
    for sk in doc.get("skins", []):
        if "inverseBindMatrices" in sk:
            used_acc.add(sk["inverseBindMatrices"])
    for an in doc.get("animations", []):
        for s in an["samplers"]:
            used_acc.update((s["input"], s["output"]))
    amap = compact("accessors", used_acc)
    for p in prims:
        p["attributes"] = {k: amap[v] for k, v in p.get("attributes", {}).items()}
        if "indices" in p:
            p["indices"] = amap[p["indices"]]
        if "targets" in p:
            p["targets"] = [{k: amap[v] for k, v in tg.items()} for tg in p["targets"]]
    for sk in doc.get("skins", []):
        if "inverseBindMatrices" in sk:
            sk["inverseBindMatrices"] = amap[sk["inverseBindMatrices"]]
    for an in doc.get("animations", []):
        for s in an["samplers"]:
            s["input"], s["output"] = amap[s["input"]], amap[s["output"]]
    # buffer views: accessors, images, Draco streams; repacked into a new BIN in their old order
    holders = [a for a in doc.get("accessors", []) if "bufferView" in a]
    holders += [i for i in doc.get("images", []) if "bufferView" in i]
    holders += [p["extensions"]["KHR_draco_mesh_compression"] for p in prims
                if "KHR_draco_mesh_compression" in p.get("extensions", {})]
    vmap = compact("bufferViews", {h["bufferView"] for h in holders})
    for h in holders:
        h["bufferView"] = vmap[h["bufferView"]]
    out = bytearray()
    for v in doc.get("bufferViews", []):
        if v.get("buffer", 0) != 0:
            raise ValueError("GLB with external buffers")
        out += b"\0" * (-len(out) % 4)
        start = v.get("byteOffset", 0)
        chunk = binc[start:start + v["byteLength"]]
        v["byteOffset"] = len(out)
        out += chunk
    doc["buffers"] = [{"byteLength": len(out)}] if out else []
    if not doc["buffers"]:
        doc.pop("buffers")
    return doc, bytes(out), dropped


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("assets", nargs="*")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    manifest_path = ROOT / CFG.paths["manifest"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    ids = a.assets or sorted(manifest["assets"])
    changed = 0
    for asset in ids:
        entry = manifest["assets"][asset]
        touched = []
        for key, size_key in (("url", "bytes"), ("hiUrl", "hiBytes")):
            if key not in entry:
                continue
            path = ROOT / "public" / entry[key]
            doc, binc = read_glb(path)
            res = strip(doc, binc)
            if res is None:
                continue
            before = path.stat().st_size
            touched.append(f"{path.name} −{', '.join(res[2])}")
            if not a.check:
                write_glb(path, res[0], res[1])
                entry[size_key] = path.stat().st_size
                if key == "url":
                    entry["sha256"] = sha256(path)
                print(f"  {path.name}: {before // 1024} → {path.stat().st_size // 1024} KB")
        if len(entry.get("lodDistance", [])) > 1:
            entry["lodDistance"] = entry["lodDistance"][:1]
            touched.append("lodDistance")
        if touched:
            changed += 1
            print(f"{asset}: {'; '.join(touched)}")
    if changed and not a.check:
        fresh = json.loads(manifest_path.read_text(encoding="utf-8"))   # other tools write this file too
        for asset in ids:
            fresh["assets"][asset] = manifest["assets"][asset]
        fresh["updated"] = now()
        manifest_path.write_text(json.dumps(fresh, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{'would change' if a.check else 'changed'} {changed} / {len(ids)} assets")


if __name__ == "__main__":
    main()
