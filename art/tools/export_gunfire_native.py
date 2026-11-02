"""Export original Gunfire weapon AssetBundles as a native Unity project through AssetRipper."""
from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.parse
import urllib.request

import UnityPy

ROOT = Path(__file__).resolve().parents[2]
GAME = Path(os.environ.get("GUNFIRE_REBORN_HOME", r"G:\SteamLibrary\steamapps\common\Gunfire Reborn"))
BUNDLES = GAME / "Gunfire Reborn_Data" / "StreamingAssets" / "assetbundles"
RIPPER = ROOT / "art" / "source" / "_tmp" / "asset-ripper" / "AssetRipper.GUI.Free.exe"
WORK = ROOT / "art" / "source" / "_tmp"
WEAPONS = ["data631", "data632", "data649", "data637", "data646", "data653"]
EFFECTS = ["data685", "data723"]
AUDIO = ["data2480"]


def bundle_dependencies(path: Path) -> list[str]:
    raw = path.read_bytes()
    env = UnityPy.load(io.BytesIO(raw[raw.index(b"UnityFS"):]))
    bundle = next(obj.read() for obj in env.objects if obj.type.name == "AssetBundle")
    return bundle.m_Dependencies


def prepare(names: list[str], directory: Path) -> list[str]:
    directory.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    queue = list(names)
    while queue:
        name = queue.pop(0)
        if name in seen or name == "data2":
            continue
        path = BUNDLES / name
        if not path.exists():
            raise FileNotFoundError(path)
        seen.add(name)
        raw = path.read_bytes()
        (directory / name).write_bytes(raw[raw.index(b"UnityFS"):])
        queue.extend(bundle_dependencies(path))
    return sorted(seen)


def post(port: int, command: str, path: Path) -> None:
    body = urllib.parse.urlencode({"Path": str(path)}).encode()
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/{command}", body, timeout=600) as response:
        if response.status != 200:
            raise RuntimeError(f"{command}: HTTP {response.status}")


def export(port: int, input_dir: Path, output_dir: Path) -> None:
    if output_dir.exists():
        raise FileExistsError(f"Refusing to replace existing export: {output_dir}")
    post(port, "LoadFolder", input_dir)
    post(port, "Export/UnityProject", output_dir)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--effects", action="store_true")
    parser.add_argument("--audio", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--name", default="complete")
    parser.add_argument("--bundles", nargs="+")
    args = parser.parse_args()
    names = args.bundles or [*WEAPONS, *(EFFECTS if args.effects else []), *(AUDIO if args.audio else [])]
    input_dir = WORK / "gunfire-bundles" / args.name
    output_dir = WORK / "gunfire-native" / args.name
    names = prepare(names, input_dir)
    report = {"bundles": names, "sourceBytes": sum((input_dir / name).stat().st_size for name in names)}
    (WORK / "gunfire-native").mkdir(parents=True, exist_ok=True)
    (WORK / "gunfire-native" / f"{args.name}-export.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))
    if args.prepare_only:
        return
    process = subprocess.Popen([str(RIPPER), "--headless", "--port", str(args.port), "--log-path", str(WORK / "asset-ripper" / f"{args.name}-export.log")])
    try:
        for attempt in range(30):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{args.port}/", timeout=1).close()
                break
            except OSError:
                if process.poll() is not None:
                    raise RuntimeError("AssetRipper exited before opening its HTTP interface")
                time.sleep(0.2)
        else:
            raise TimeoutError("AssetRipper did not start")
        export(args.port, input_dir, output_dir)
    finally:
        process.terminate()
        process.wait(timeout=15)


if __name__ == "__main__":
    main()
