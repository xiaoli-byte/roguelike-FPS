"""Decode original Gunfire weapon MonoBehaviours using observed IL2CPP field layouts."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

import UnityPy

ROOT = Path(__file__).resolve().parents[2]
BUNDLES = {
    "1001": "data631", "1002": "data632", "1003": "data633", "1004": "data634",
    "1005": "data635", "1006": "data636", "1008": "data637", "1009": "data638",
    "1010": "data639", "1013": "data640", "1014": "data641", "1101": "data642",
    "1102": "data643", "1106": "data646", "1202": "data649", "1301": "data653",
}


def read_fields(data: bytes, fields: list[dict]) -> tuple[dict, bytes]:
    values = {}
    offset = 32
    for field in fields:
        if field["flags"] & 7 != 6:
            continue
        kind = field["type"]
        name = field["name"]
        if kind == "CameraSettingByGun.SightSetting":
            values[name] = struct.unpack_from("<i", data, offset)[0]
            offset += 4
            continue
        if kind == "UnityEngine.Vector2[]":
            count = struct.unpack_from("<i", data, offset)[0]
            offset += 4
            values[name] = [list(struct.unpack_from("<2f", data, offset + i * 8)) for i in range(count)]
            offset += count * 8
            continue
        sizes = {
            "System.Single": 4, "System.Double": 8, "System.Int32": 4, "System.UInt32": 4,
            "System.Boolean": 4, "UnityEngine.Vector2": 8, "UnityEngine.Vector3": 12,
            "UnityEngine.Vector4": 16, "UnityEngine.Quaternion": 16, "UnityEngine.Color": 16,
        }
        if kind not in sizes:
            raise ValueError(f"Unsupported public field {name}: {kind}")
        size = sizes[kind]
        raw = data[offset:offset + size]
        if len(raw) != size:
            raise ValueError(f"Field {name} exceeds {len(data)}-byte MonoBehaviour")
        if kind == "System.Single":
            values[name] = struct.unpack("<f", raw)[0]
        elif kind == "System.Double":
            values[name] = struct.unpack("<d", raw)[0]
        elif kind in ("System.Int32", "System.UInt32"):
            values[name] = struct.unpack("<i" if kind == "System.Int32" else "<I", raw)[0]
        elif kind == "System.Boolean":
            values[name] = raw[0] != 0
        else:
            values[name] = list(struct.unpack(f"<{size // 4}f", raw))
        offset += size
    return values, data[offset:]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weapons", nargs="+", default=list(BUNDLES))
    parser.add_argument("--layout", default="art/reviews/gunfire-reborn-analysis/weapon-type-layout.json")
    parser.add_argument("--output", default="art/reviews/gunfire-reborn-analysis/weapon-control-data.json")
    args = parser.parse_args()
    layouts = json.loads((ROOT / args.layout).read_text(encoding="utf-8-sig"))
    output = {}
    for weapon in args.weapons:
        bundle = BUNDLES[weapon]
        bundle_path = ROOT / "art/source/_tmp/gunfire-bundles/complete" / bundle
        if not bundle_path.exists():
            bundle_path = ROOT / "art/source/_tmp/gunfire-bundles/ten-more" / bundle
        environment = UnityPy.load(str(bundle_path))
        scripts = {
            obj.path_id: obj.read_typetree()["m_ClassName"]
            for obj in environment.objects if obj.type.name == "MonoScript"
        }
        records = []
        for obj in environment.objects:
            if obj.type.name != "MonoBehaviour":
                continue
            raw = obj.get_raw_data()
            script_id = struct.unpack_from("<q", raw, 20)[0]
            class_name = scripts.get(script_id)
            if class_name not in layouts:
                continue
            fields, remaining = read_fields(raw, layouts[class_name])
            records.append({
                "pathId": obj.path_id,
                "script": class_name,
                "rawBytes": len(raw),
                "fields": fields,
                "remainingBytes": len(remaining),
                "remainingHex": remaining.hex(),
            })
        output[weapon] = {"bundle": bundle, "components": records}
    path = ROOT / args.output
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        weapon: [(r["script"], r["rawBytes"], r["remainingBytes"]) for r in data["components"]]
        for weapon, data in output.items()
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
