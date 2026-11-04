"""Extract a Wwise bank from Gunfire's PCK and map events to media IDs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
GAME = Path(r"G:\SteamLibrary\steamapps\common\Gunfire Reborn")
DEFAULT_PCK = GAME / "Gunfire Reborn_Data" / "StreamingAssets" / "wwise" / "wpn.pck"


def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def parse_hirc(data: bytes, version: int) -> tuple[dict[int, dict], dict[int, str]]:
    objects: dict[int, dict] = {}
    names: dict[int, str] = {}
    offset = 0
    while offset + 8 <= len(data):
        tag = data[offset:offset + 4]
        size = u32(data, offset + 4)
        body = offset + 8
        end = body + size
        if tag == b"HIRC":
            count = u32(data, body)
            cursor = body + 4
            for _ in range(count):
                object_type = data[cursor]
                length = u32(data, cursor + 1)
                object_id = u32(data, cursor + 5)
                payload_start = cursor + 9
                payload_end = payload_start + length - 4
                payload = data[payload_start:payload_end]
                record = {"id": object_id, "type": object_type, "size": length}
                if object_type == 4:
                    width = 1 if version >= 134 else 4
                    action_count = payload[0] if width == 1 else u32(payload, 0)
                    record["actions"] = [u32(payload, width + i * 4) for i in range(action_count)]
                elif object_type == 3:
                    record.update(scope=payload[0], action=payload[1], target=u32(payload, 2))
                elif object_type == 2:
                    record.update(storage=payload[4], audioId=u32(payload, 5), sourceId=u32(payload, 9))
                record["payload"] = payload
                objects[object_id] = record
                cursor = payload_end
        elif tag == b"STID":
            count = u32(data, body + 4)
            cursor = body + 8
            for _ in range(count):
                object_id = u32(data, cursor)
                length = data[cursor + 4]
                names[object_id] = data[cursor + 5:cursor + 5 + length].decode("utf-8")
                cursor += 5 + length
        offset = end
    return objects, names


def resolve_audio(objects: dict[int, dict], root: int) -> list[int]:
    resolved: set[int] = set()
    visiting: set[int] = set()

    def visit(object_id: int) -> None:
        if object_id in visiting:
            return
        obj = objects.get(object_id)
        if not obj:
            return
        if obj["type"] == 2:
            for key in ("audioId", "sourceId"):
                if obj[key]:
                    resolved.add(obj[key])
                    break
            return
        if obj["type"] not in (5, 6, 7, 9):
            return
        visiting.add(object_id)
        for child in obj.get("children", []):
            visit(child)
        visiting.remove(object_id)

    visit(root)
    return sorted(resolved)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pck", type=Path, default=DEFAULT_PCK)
    parser.add_argument("--output", default="art/source/_tmp/wwise/wpn-analysis")
    parser.add_argument("--report", default="art/reviews/gunfire-reborn-analysis/wwise-wpn-map.json")
    parser.add_argument("--events-from", default="art/reviews/gunfire-reborn-analysis/runtime-audio-events.jsonl")
    args = parser.parse_args()
    package = args.pck.read_bytes()
    if package[:4] != b"AKPK":
        raise ValueError("Not a Wwise PCK package")
    header_length, _, languages_length, banks_length, streams_length = struct.unpack_from("<5I", package, 4)
    cursor = 24
    has_externals = header_length != languages_length + banks_length + streams_length + 16
    if has_externals:
        cursor += 4
    cursor += languages_length
    bank_count = u32(package, cursor)
    cursor += 4
    if bank_count != 1:
        raise ValueError(f"Expected one embedded bank, found {bank_count}")
    bank_id, block_size, length, start_block, language = struct.unpack_from("<5I", package, cursor)
    offset = start_block * max(block_size, 1)
    bank = package[offset:offset + length]
    if bank[:4] != b"BKHD":
        raise ValueError("Embedded bank does not start with BKHD")
    output = ROOT / args.output
    output.mkdir(parents=True, exist_ok=True)
    (output / "wpn.bnk").write_bytes(bank)
    version, embedded_id = struct.unpack_from("<2I", bank, 8)
    objects, names = parse_hirc(bank, version)
    for obj in objects.values():
        payload = obj.pop("payload")
        if obj["type"] not in (5, 6, 7, 9):
            continue
        candidates = []
        for index in range(0, len(payload) - 4, 4):
            count = u32(payload, index)
            if not 0 < count <= 2048 or index + 4 + count * 4 > len(payload):
                continue
            ids = [u32(payload, index + 4 + i * 4) for i in range(count)]
            if all(child in objects and child != obj["id"] for child in ids):
                candidates.append(ids)
        stride = 8 if obj["type"] == 5 else 4
        for index in range(0, len(payload) - 2):
            count = struct.unpack_from("<H", payload, index)[0]
            if not 0 < count <= 2048 or index + 2 + count * stride > len(payload):
                continue
            ids = [u32(payload, index + 2 + i * stride) for i in range(count)]
            if all(child in objects and child != obj["id"] for child in ids):
                candidates.append(ids)
        if candidates:
            obj["children"] = max(candidates, key=len)
    events = []
    for object_id, obj in sorted(objects.items()):
        if obj["type"] != 4:
            continue
        actions = []
        audio_ids = set()
        for action_id in obj.get("actions", []):
            action = objects.get(action_id)
            if not action:
                continue
            resolved = resolve_audio(objects, action["target"])
            audio_ids.update(resolved)
            actions.append({
                "id": action_id,
                "scope": action["scope"],
                "action": action["action"],
                "target": action["target"],
                "audioIds": resolved,
            })
        events.append({"id": object_id, "name": names.get(object_id), "audioIds": sorted(audio_ids), "actions": actions})
    observed_ids = []
    events_path = ROOT / args.events_from
    if events_path.exists():
        for line in events_path.read_text(encoding="utf-8-sig").splitlines():
            entry = json.loads(line)
            if entry.get("id") is not None and entry["id"] not in observed_ids:
                observed_ids.append(entry["id"])
    report = {
        "package": str(args.pck),
        "bankId": bank_id,
        "embeddedBankId": embedded_id,
        "bankVersion": version,
        "bankBytes": length,
        "objectCounts": {str(kind): sum(obj["type"] == kind for obj in objects.values()) for kind in sorted({obj["type"] for obj in objects.values()})},
        "observedEvents": [event for event in events if event["id"] in observed_ids],
        "unresolvedObservedIds": [object_id for object_id in observed_ids if object_id not in objects],
        "events": events,
    }
    report_path = ROOT / args.report
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "events"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
