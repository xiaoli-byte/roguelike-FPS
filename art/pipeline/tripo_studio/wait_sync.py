import os, time, subprocess, sys
q = r"I:\projects\roguelike-FPS\unity\Library\SpiritfireBridge\queue"
t0 = time.time(); empty = 0
while time.time() - t0 < 3000:
    n = len([f for f in os.listdir(q) if f.endswith(".json")]) if os.path.isdir(q) else 0
    empty = empty + 1 if n == 0 else 0
    if empty >= 3:
        break
    time.sleep(10)
print("queue empty after", int(time.time() - t0), "s", flush=True)
r = subprocess.run(["bash", "scripts/unity/bridge.sh", "--timeout", "3000", "sync"], cwd=r"I:\projects\roguelike-FPS", capture_output=True, text=True, encoding="utf-8", errors="replace")
print(r.returncode); print(r.stdout[-4000:]); print(r.stderr[-2000:])
