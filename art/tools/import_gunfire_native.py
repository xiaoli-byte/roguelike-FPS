"""Copy the native Gunfire weapon export and its engine-asset dependencies into this Unity project."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art" / "source" / "_tmp" / "gunfire-native" / "complete" / "ExportedProject" / "Assets"
TARGET = ROOT / "unity" / "Assets" / "Art" / "Original" / "Gunfire"
WEAPONS = ["1001", "1002", "1202", "1008", "1106", "1301"]
GUID = re.compile(r"guid: ([0-9a-f]{32})")
SKIP = {".cs", ".dll", ".asmdef", ".shader", ".shadergraph", ".shadervariants"}
TEXT_SUFFIXES = {".meta", ".prefab", ".mat", ".anim", ".controller", ".overridecontroller", ".asset"}


def normalize_text_assets() -> None:
    for root in [TARGET.parent, ROOT / "unity" / "Assets" / "Resources" / "Gunfire"]:
        for path in root.rglob("*"):
            if path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            text = path.read_text(encoding="utf-8-sig")
            normalized = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
            if normalized != text:
                path.write_text(normalized, encoding="utf-8", newline="")


def main() -> None:
    global SOURCE, WEAPONS
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="complete")
    parser.add_argument("--weapons", nargs="+", default=WEAPONS)
    parser.add_argument("--normalize-only", action="store_true")
    args = parser.parse_args()
    if args.normalize_only:
        normalize_text_assets()
        return
    SOURCE = ROOT / "art" / "source" / "_tmp" / "gunfire-native" / args.source / "ExportedProject" / "Assets"
    WEAPONS = args.weapons
    guid_paths: dict[str, Path] = {}
    for meta in SOURCE.rglob("*.meta"):
        match = GUID.search(meta.read_text(encoding="utf-8-sig"))
        if match:
            guid_paths[match.group(1)] = Path(str(meta)[:-5])
    queue = [SOURCE / "res" / "characters" / "weapons" / weapon / f"{weapon}.prefab" for weapon in WEAPONS]
    queue += [
        SOURCE / "res" / "effects" / "prefabs" / "common" / "1926_muzzle.prefab",
        SOURCE / "res" / "effects" / "prefabs" / "monster" / "bullet.prefab",
        *sorted((SOURCE / "res" / "soundma" / "wav" / "wpn" / "wpn_1202").glob("*.ogg")),
    ]
    selected: set[Path] = set()
    missing: set[Path] = set()
    while queue:
        source = queue.pop()
        if source in selected or source in missing:
            continue
        if not source.exists() or source.suffix.lower() in SKIP:
            missing.add(source)
            continue
        selected.add(source)
        text = source.read_text(encoding="utf-8-sig") if source.suffix.lower() in {".prefab", ".mat", ".controller", ".overridecontroller", ".anim", ".asset"} else ""
        for guid in GUID.findall(text):
            dependency = guid_paths.get(guid)
            if dependency is not None and dependency not in selected:
                queue.append(dependency)
    copied: list[Path] = []
    for source in sorted(selected):
        target = TARGET / source.relative_to(SOURCE)
        if args.source != "complete" and target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        meta = Path(str(source) + ".meta")
        if meta.exists():
            shutil.copy2(meta, Path(str(target) + ".meta"))
        copied.append(source)
    normalize_text_assets()
    report = {
        "source": "Gunfire Reborn, Unity 2018.4.36f1; native AssetRipper 2.0.0 export",
        "weapons": WEAPONS,
        "assetFiles": len(selected),
        "copiedFiles": len(copied),
        "bytes": sum(path.stat().st_size for path in selected),
        "missingOrExcluded": sorted(path.name for path in missing),
        "files": [str(path.relative_to(SOURCE)).replace("\\", "/") for path in sorted(selected)],
    }
    (ROOT / "art" / "reviews" / "gunfire-reborn-analysis").mkdir(parents=True, exist_ok=True)
    (ROOT / "art" / "reviews" / "gunfire-reborn-analysis" / f"native-import-{args.source}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "files"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
