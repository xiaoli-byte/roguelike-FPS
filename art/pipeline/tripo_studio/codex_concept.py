"""Run `tripo_assets.py concept <ID>...` through the Codex desktop app's bundled codex-cli (ChatGPT sign-in quota).

The codex on PATH (0.146) rejects the configured model; the desktop bundle under %LOCALAPPDATA%/OpenAI/Codex/bin/<hash>/
works. A bash `PATH=...` with $LOCALAPPDATA silently falls back to 0.146, so the PATH is set here in Python.
  python codex_concept.py SM_Tripo_ZhurongStatue [more IDs]   (run from art/pipeline/tripo_studio or anywhere)"""
import glob
import os
import subprocess
import sys
from pathlib import Path

bins = [Path(p).parent for p in glob.glob(os.path.join(os.environ["LOCALAPPDATA"], "OpenAI", "Codex", "bin", "*", "codex.exe"))]
if not bins:
    sys.exit("Codex desktop bundle not found")
env = {**os.environ, "PATH": str(bins[0]) + os.pathsep + os.environ["PATH"], "PYTHONIOENCODING": "utf-8"}
env.pop("ART_CONCEPT_PROVIDER", None)
pipe = Path(__file__).resolve().parents[1]
sys.exit(subprocess.run([sys.executable, "tripo_assets.py", "concept", *sys.argv[1:]], cwd=pipe, env=env).returncode)
