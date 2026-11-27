"""音频烘焙第二步：把 audio-bake.html 渲出的 WAV 转成 ogg，直接写进网页的发布目录 public/assets/audio（src/audio/AudioBank 按清单加载）。

    python -I scripts/audio/bake.py <烘焙输出目录>             全量：目标目录里旧的 ogg（这次没有渲出来的）会删掉
    python -I scripts/audio/bake.py <烘焙输出目录> --partial   增量（audio-bake.html?only=i6 渲的那一部分）：
                                                              只新增 / 覆盖这次渲出来的片段，不删别的；清单按 id 并进现有的
    python -I scripts/audio/bake.py --check                    只核对发布目录：清单能解析、clips / musicClips 和目录里的 ogg 一一对应、
                                                              每个 ogg 开头是 OggS（本机 DLP 透明加密会把文件存成以 %TSD-Header 开头的密文）

  sfx/*.wav    → public/assets/audio/sfx/*.ogg     单声道 Vorbis q5
  music/*.wav  → public/assets/audio/music/*.ogg   立体声 Vorbis q6（配乐、环境声床）
  manifest.json → public/assets/audio/audio-manifest.json（sampleRate / generated / beamLoop / mix / sfx / music，
                  再加 clips = sfx/ 下实际有的片段名、musicClips = music/ 下实际有的曲目名：浏览器列不了目录，运行时靠它判断有哪些片段）
全量时保证片段与清单一致。需要 PATH 里有 ffmpeg。
2026-11-27 前成品先进 Unity（Resources/Audio），再由 scripts/web/publish-audio.mjs 拷到网页；Unity 删除后直出这里。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEST = os.path.join(ROOT, "public", "assets", "audio")
SFX = os.path.join(DEST, "sfx")
MUSIC = os.path.join(DEST, "music")
MANIFEST = os.path.join(DEST, "audio-manifest.json")


def convert(src_dir, dst_dir, quality, channels, partial):
    os.makedirs(dst_dir, exist_ok=True)
    made = set()
    if not os.path.isdir(src_dir):
        return 0
    for name in sorted(os.listdir(src_dir)):
        if not name.endswith(".wav"):
            continue
        out = os.path.join(dst_dir, name[:-4] + ".ogg")
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(src_dir, name),
               "-ac", str(channels), "-c:a", "libvorbis", "-q:a", str(quality), out]
        subprocess.run(cmd, check=True)
        made.add(os.path.basename(out))
    if not partial:
        for name in os.listdir(dst_dir):
            if name.endswith(".ogg") and name not in made:
                os.remove(os.path.join(dst_dir, name))
    return len(made)


def merge(rows, updates):
    """按 id 把 updates（id → 参数）并进 rows（数组）：已有的只覆盖给出的字段，没有的追加"""
    by_id = {r["id"]: r for r in rows}
    for k, v in updates.items():
        if k in by_id:
            by_id[k].update(v)
        else:
            rows.append(dict(id=k, **v))
    return rows


def clip_names(d):
    return sorted(f[:-4] for f in os.listdir(d) if f.endswith(".ogg")) if os.path.isdir(d) else []


def check():
    problems = []
    try:
        m = json.load(open(MANIFEST, encoding="utf-8-sig"))
    except Exception as e:  # noqa: BLE001
        sys.exit(f"{MANIFEST} 读不了：{e}")
    for key, d in (("clips", SFX), ("musicClips", MUSIC)):
        have = clip_names(d)
        if m.get(key) != have:
            listed = set(m.get(key) or [])
            problems.append(f"{key} 和 {os.path.relpath(d, ROOT)} 对不上：清单多 {sorted(listed - set(have))[:8]}，目录多 {sorted(set(have) - listed)[:8]}")
        for n in have:
            with open(os.path.join(d, n + ".ogg"), "rb") as f:
                head = f.read(16)
            if not head.startswith(b"OggS"):
                problems.append(f"{os.path.relpath(os.path.join(d, n + '.ogg'), ROOT)} 开头不是 OggS（{head[:12]!r}）")
    sfx = set(m.get("clips") or [])
    missing = []
    for e in m.get("sfx", []):
        missing += [f"{e['id']}_{i}" for i in range(e.get("variants", 0)) if f"{e['id']}_{i}" not in sfx]
    if missing:
        print(f"清单登记了但没有片段（运行时跳过）：{'、'.join(missing[:20])}")
    if problems:
        for p in problems:
            print("  " + p, file=sys.stderr)
        sys.exit(f"有 {len(problems)} 个问题")
    print(f"一致：音效 {len(m['clips'])} 个、配乐 / 声床 {len(m['musicClips'])} 首")


def main():
    if "--check" in sys.argv:
        return check()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    partial = "--partial" in sys.argv
    src = os.path.abspath(args[0])
    manifest = os.path.join(src, "manifest.json")
    if not os.path.exists(manifest):
        sys.exit(f"{manifest} 不存在：烘焙页还没跑完")
    m = json.load(open(manifest, encoding="utf-8"))
    n_sfx = convert(os.path.join(src, "sfx"), SFX, 5, 1, partial)
    n_music = convert(os.path.join(src, "music"), MUSIC, 6, 2, partial)
    if partial:
        out = json.load(open(MANIFEST, encoding="utf-8-sig"))
        out["sfx"] = merge(out.get("sfx", []), m.get("sfx", {}))
        out["music"] = merge(out.get("music", []), m.get("music", {}))
    else:
        # 清单的 sfx / music 是数组（id → 参数 的表展开），src/audio/AudioBank 照这个格式读
        out = {
            "sampleRate": m["sampleRate"],
            "generated": m["generated"],
            "beamLoop": m.get("beamLoop", ""),
            "mix": m["mix"],
            "sfx": [dict(id=k, **v) for k, v in m["sfx"].items()],
            "music": [dict(id=k, **v) for k, v in m["music"].items()],
        }
    out["clips"] = clip_names(SFX)
    out["musicClips"] = clip_names(MUSIC)
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(DEST) for f in fs if f.endswith(".ogg"))
    print(f"{'增量：' if partial else ''}音效 {n_sfx} 个、配乐 / 声床 {n_music} 首 → {DEST}（ogg 共 {size / 1048576:.1f} MB）")


if __name__ == "__main__":
    main()
