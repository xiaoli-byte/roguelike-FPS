"""tone_match.py measure|apply <ID> [--factor F|qmap] [--run]: pull a Tripo base colour's chroma back to the concept.

Why (2026-11-27, ch1 rebuild kit): Tripo「纹理生成」with 去光处理 comes out 1.25–2× more saturated than the four-view
concept it was made from (median Lab chroma), hue and lightness unchanged — sand reads as orange paint, sandstone as
lava, whitewash as cream.  texture_clean.py does not catch it (it only fixes purple casts and leaves saturated
orange alone as lava colour).

  measure  prints median lightness / chroma / hue of the Tripo base colour vs the concept front figure
  apply    scales the base colour's Lab a*/b* (colour only, original resolution, no smoothing; geometry and UV untouched):
             --factor 0.7   uniform scale
             --factor qmap  per-texel ratio from matching the chroma distribution to the concept's (never raises
                            chroma) — for pieces whose pale and saturated parts are off by different amounts
           writes art/source/_tripo_inbox/<UTC>_<ID>_tone.glb + receipt; --run then imports + build / validate / review
           (log appended to logs/<ID>.log); approve / publish with ap.sh afterwards.
"""
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # repo root (art/pipeline/tripo_studio/..)
PIPE = ROOT / "art" / "pipeline"
sys.path.insert(0, str(PIPE))
os.chdir(PIPE)
import cv2
import numpy as np
from PIL import Image
from lib.config import CFG
from lib.state import AssetState, portable_path, sha256
from retexture import INBOX, base_color_image, glb_read, glb_write, image_bytes, replace_images, tripo_source


def lab(rgb8):
    v = cv2.cvtColor(np.ascontiguousarray(rgb8), cv2.COLOR_RGB2LAB).astype(np.float32)
    return v[..., 0] * (100 / 255), v[..., 1] - 128, v[..., 2] - 128


def stats(L, a, b, m):
    C = np.hypot(a, b)[m]
    h = np.degrees(np.arctan2(b, a))[m] % 360
    return {"L50": round(float(np.median(L[m])), 1), "C50": round(float(np.median(C)), 1),
            "C90": round(float(np.percentile(C, 90)), 1), "h50": round(float(np.median(h)), 1)}


def concept_front(aid):
    """The current concept's front figure (RGBA, transparent background) → L, a, b, mask."""
    figs = sorted((ROOT / "art" / "source").glob(f"*/{aid}/01_concept/CN_{aid}_v*_front.png"))
    if not figs:
        sys.exit(f"{aid}: no concept front figure")
    c = np.asarray(Image.open(figs[-1]).convert("RGBA"))
    L, a, b = lab(c[..., :3])
    return L, a, b, c[..., 3] > 200


def load(aid):
    spec = CFG.asset(aid)
    src, src_hp = tripo_source(spec, AssetState(spec))
    js, bn = glb_read(src)
    img = Image.open(io.BytesIO(image_bytes(js, bn, base_color_image(js)))).convert("RGB")
    return src, src_hp, js, bn, np.asarray(img)


def measure(aid):
    src, _, _, _, t = load(aid)
    L, a, b = lab(t)
    ts, cs = stats(L, a, b, L > 4), stats(*concept_front(aid))
    print(aid, "tex", ts, "concept", cs, "ratio C50", round(cs["C50"] / max(ts["C50"], 1e-3), 3), src.name)
    return ts, cs


def qmap_ratio(aid, L, a, b):
    C = np.hypot(a, b)
    cL, ca, cb, cm = concept_front(aid)
    ps = np.linspace(0, 100, 101)
    qt = np.maximum.accumulate(np.percentile(C[L > 4], ps) + np.arange(101) * 1e-4)
    qc = np.percentile(np.hypot(ca, cb)[cm], ps)
    return np.clip(np.interp(C, qt, qc) / np.maximum(C, 1e-3), 0.3, 1.0)


def apply(aid, factor, run):
    src, src_hp, js, bn, t = load(aid)
    L, a, b = lab(t)
    f = qmap_ratio(aid, L, a, b) if factor == "qmap" else factor
    out = cv2.cvtColor(np.stack([np.clip(L * 255 / 100, 0, 255), np.clip(a * f + 128, 0, 255), np.clip(b * f + 128, 0, 255)], -1)
                       .astype(np.uint8), cv2.COLOR_LAB2RGB)
    if factor == "qmap":
        factor = {"mode": "chroma quantile match to concept front",
                  "ratio_p10_p50_p90": [round(float(np.percentile(f[L > 4], p)), 3) for p in (10, 50, 90)]}
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, "PNG")
    njs, nbn = replace_images(js, bn, {base_color_image(js): (buf.getvalue(), "image/png")})
    stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    dst = INBOX / f"{stamp}_{aid}_tone.glb"
    glb_write(dst, njs, nbn)
    ts, cs = measure(aid)
    rec = {"asset": aid, "task": "local:tone_match", "source": portable_path(dst), "sha256": sha256(dst),
           "geometry_from": portable_path(src), "geometry_sha256": sha256(src), "retexture_of_highpoly": src_hp,
           "tone_match": {"chroma_factor": factor, "tex_before": ts, "concept": cs},
           "glb": {"bytes": dst.stat().st_size, "images": 1},
           "note": "底色只调彩度（Lab a*/b* 缩放，向四视图概念的彩度靠，见 tone_match），原分辨率、不平滑；几何与 UV 不动",
           "archived_utc": stamp}
    dst.with_suffix(".json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", dst)
    if not run:
        return
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    (PIPE / "tripo_studio" / "logs").mkdir(exist_ok=True)
    with open(PIPE / "tripo_studio" / "logs" / f"{aid}.log", "a", encoding="utf-8") as log:
        steps = [["tripo_assets.py", "import", aid, "--file", portable_path(dst), "--task", "local:tone_match"]]
        steps += [["assetctl.py", s, aid] for s in ("build", "validate", "review")]
        for args in steps:
            log.write("$ " + " ".join(args) + "\n")
            log.flush()
            r = subprocess.run([sys.executable] + args, cwd=PIPE, env=env, stdout=log, stderr=subprocess.STDOUT)
            print(args[0], args[1], "ok" if r.returncode == 0 else "FAIL")
            if r.returncode:
                sys.exit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 3 or sys.argv[1] not in ("measure", "apply"):
        sys.exit(__doc__)
    cmd, aid = sys.argv[1], sys.argv[2]
    if cmd == "measure":
        measure(aid)
    else:
        fa = sys.argv[sys.argv.index("--factor") + 1] if "--factor" in sys.argv else "qmap"
        apply(aid, fa if fa == "qmap" else float(fa), "--run" in sys.argv)
