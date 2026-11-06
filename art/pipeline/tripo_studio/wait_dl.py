"""wait_dl.py <name-prefix> [timeout s]: wait for S:/文档/Downloads/<prefix>*.glb to appear and its size to be stable for 6 s."""
import sys, time, glob, os
pre = sys.argv[1]; tmo = float(sys.argv[2]) if len(sys.argv) > 2 else 300
d = r"S:\文档\Downloads"
t0 = time.time(); last = None; stable = 0
while time.time() - t0 < tmo:
    fs = [f for f in glob.glob(os.path.join(d, pre + "*")) if not f.endswith((".crdownload", ".tmp"))]
    part = glob.glob(os.path.join(d, pre + "*.crdownload"))
    if fs and not part:
        f = max(fs, key=os.path.getmtime); s = os.path.getsize(f)
        if s == last and s > 0:
            stable += 1
            if stable >= 3:
                print("READY", f, s); sys.exit(0)
        else:
            stable = 0
        last = s
    time.sleep(2)
print("TIMEOUT", glob.glob(os.path.join(d, pre + "*"))); sys.exit(1)
