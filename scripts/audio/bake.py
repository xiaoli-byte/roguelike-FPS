"""音频烘焙第二步：把 audio-bake.html 渲出的 WAV 转成 ogg，放进 Unity（Resources/Audio，运行时按名字加载）。

    python -I scripts/audio/bake.py <烘焙输出目录>             全量：目标目录里旧的 ogg（这次没有渲出来的）会删掉
    python -I scripts/audio/bake.py <烘焙输出目录> --partial   增量（audio-bake.html?only=i6 渲的那一部分）：
                                                              只新增 / 覆盖这次渲出来的片段，不删别的；清单按 id 并进现有的

  sfx/*.wav    → unity/Assets/Game/Resources/Audio/Sfx/*.ogg   单声道 Vorbis q5
  music/*.wav  → unity/Assets/Game/Resources/Audio/Music/*.ogg 立体声 Vorbis q6（配乐、环境声床）
  manifest.json → unity/Assets/Game/Resources/Audio/audio-manifest.json
全量时保证片段与清单一致。需要 PATH 里有 ffmpeg。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEST = os.path.join(ROOT, "unity", "Assets", "Game", "Resources", "Audio")


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
                meta = os.path.join(dst_dir, name + ".meta")
                if os.path.exists(meta):
                    os.remove(meta)
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


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    partial = "--partial" in sys.argv
    src = os.path.abspath(args[0])
    manifest = os.path.join(src, "manifest.json")
    if not os.path.exists(manifest):
        sys.exit(f"{manifest} 不存在：烘焙页还没跑完")
    m = json.load(open(manifest, encoding="utf-8"))
    n_sfx = convert(os.path.join(src, "sfx"), os.path.join(DEST, "Sfx"), 5, 1, partial)
    n_music = convert(os.path.join(src, "music"), os.path.join(DEST, "Music"), 6, 2, partial)
    dest_manifest = os.path.join(DEST, "audio-manifest.json")
    if partial:
        out = json.load(open(dest_manifest, encoding="utf-8"))
        out["sfx"] = merge(out.get("sfx", []), m.get("sfx", {}))
        out["music"] = merge(out.get("music", []), m.get("music", {}))
    else:
        # Unity 的 JsonUtility 不认字典：id → 参数 的表换成数组
        out = {
            "sampleRate": m["sampleRate"],
            "generated": m["generated"],
            "beamLoop": m.get("beamLoop", ""),
            "mix": m["mix"],
            "sfx": [dict(id=k, **v) for k, v in m["sfx"].items()],
            "music": [dict(id=k, **v) for k, v in m["music"].items()],
        }
    with open(dest_manifest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(DEST) for f in fs if f.endswith(".ogg"))
    print(f"{'增量：' if partial else ''}音效 {n_sfx} 个、配乐 / 声床 {n_music} 首 → {DEST}（ogg 共 {size / 1048576:.1f} MB）")


if __name__ == "__main__":
    main()
