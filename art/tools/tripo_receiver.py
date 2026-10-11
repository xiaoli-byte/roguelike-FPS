"""Blender-side receiver for Tripo Studio's official DCC Bridge.

Run a dedicated Blender:  blender --python art/tools/tripo_receiver.py
In Tripo Studio click "DCC Bridge" → Blender, then send any model. Every file the bridge receives is
archived byte-for-byte (the provider's original GLB/FBX, not a Blender re-export) into
art/source/_tripo_inbox/<UTC time>_<name>.<ext> with a JSON record (bytes, sha256, format, name)
before the bridge imports it into the scene. The art pipeline registers assets from that inbox.
"""
import bpy
import hashlib
import json
import shutil
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "art" / "source" / "_tripo_inbox"
INBOX.mkdir(parents=True, exist_ok=True)
STATUS = INBOX / "_receiver_status.json"
ADDON = "Tripo3d_Blender_Bridge"


def write_status(**extra):
    data = {"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "pid": __import__("os").getpid(), **extra}
    STATUS.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def safe(name: str) -> str:
    keep = "".join(c if c.isalnum() or c in "-_" else "_" for c in name.strip())
    return keep[:80] or "model"


def archive(file_path, file_format, model_name=None):
    src = Path(file_path)
    if not src.exists():
        return
    stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    stem = safe(model_name or src.stem)
    dst = INBOX / f"{stamp}_{stem}.{file_format.lower()}"
    shutil.copyfile(src, dst)
    data = dst.read_bytes()
    record = {"received_utc": stamp, "name": model_name or src.stem, "format": file_format.lower(),
              "file": dst.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
              "provider": "Tripo Studio via Tripo3d_Blender_Bridge"}
    dst.with_suffix(".json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[tripo_receiver] archived {dst.name} ({len(data)} bytes)", flush=True)


try:
    import addon_utils
    if not addon_utils.check(ADDON)[1]:
        bpy.ops.preferences.addon_enable(module=ADDON)
    import importlib
    loader_mod = importlib.import_module(ADDON + ".core.model_loader")
    importer = loader_mod.ModelImporter
    original = importer.import_model.__func__

    def import_model(cls, file_path, file_format, model_name=None):
        try:
            archive(file_path, file_format, model_name)
        except Exception:
            write_status(error=traceback.format_exc())
        return original(cls, file_path, file_format, model_name)

    importer.import_model = classmethod(import_model)
    status = importlib.import_module(ADDON + ".core.status_manager").status
    write_status(addon_enabled=True, inbox=str(INBOX))

    def heartbeat():
        try:
            write_status(addon_enabled=True, inbox=str(INBOX), connection=status.state.value,
                         client=status.client_name, last_log=status.last_log)
        except Exception:
            write_status(error=traceback.format_exc())
        return 5.0

    bpy.app.timers.register(heartbeat, persistent=True)
except Exception:
    write_status(error=traceback.format_exc())
    raise
