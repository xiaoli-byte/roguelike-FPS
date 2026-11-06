"""run_pipe.py <ID> [--from build]: import latest inbox GLB → build → validate → review; log to logs/<ID>.log"""
import sys, subprocess, json, glob, os
from pathlib import Path
R = Path(__file__).resolve().parents[3]; P = R / "art" / "pipeline"
aid = sys.argv[1]; start = sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--from" else "import"
log = Path(__file__).parent / "logs"; log.mkdir(exist_ok=True)
out = open(log / f"{aid}.log", "a", encoding="utf-8")
def run(args):
    out.write("$ " + " ".join(args) + "\n"); out.flush()
    r = subprocess.run([sys.executable] + args, cwd=P, stdout=out, stderr=subprocess.STDOUT, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    if r.returncode: out.write(f"!! exit {r.returncode}\n"); out.flush(); print("FAIL", args[:2]); sys.exit(1)
if start == "import":
    f = sorted(glob.glob(str(R / "art/source/_tripo_inbox" / f"*_{aid}.glb")))[-1]
    rec = json.loads(Path(f).with_suffix(".json").read_text(encoding="utf-8"))
    run(["tripo_assets.py", "import", aid, "--file", str(Path(f).relative_to(R)).replace("\\", "/"), "--task", rec["task"]])
for st in ["build", "validate", "review"]:
    run(["assetctl.py", st, aid])
print("DONE", aid)
