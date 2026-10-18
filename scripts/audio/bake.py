"""音频烘焙第二步：把 audio-bake.html 渲出的 WAV 转成 ogg，放进 Unity（Resources/Audio，运行时按名字加载）。

    python -I scripts/audio/bake.py <烘焙输出目录>

  sfx/*.wav    → unity/Assets/Game/Resources/Audio/Sfx/*.ogg   单声道 Vorbis q5
  music/*.wav  → unity/Assets/Game/Resources/Audio/Music/*.ogg 立体声 Vorbis q6
  manifest.json → unity/Assets/Game/Resources/Audio/audio-manifest.json
目标目录里旧的 ogg（这次没有渲出来的）会删掉，保证片段与清单一致。需要 PATH 里有 ffmpeg。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEST = os.path.join(ROOT, "unity", "Assets", "Game", "Resources", "Audio")


def convert(src_dir, dst_dir, quality, channels):
    os.makedirs(dst_dir, exist_ok=True)
    made = set()
    for name in sorted(os.listdir(src_dir)):
        if not name.endswith(".wav"):
            continue
        out = os.path.join(dst_dir, name[:-4] + ".ogg")
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(src_dir, name),
               "-ac", str(channels), "-c:a", "libvorbis", "-q:a", str(quality), out]
        subprocess.run(cmd, check=True)
        made.add(os.path.basename(out))
    for name in os.listdir(dst_dir):
        if name.endswith(".ogg") and name not in made:
            os.remove(os.path.join(dst_dir, name))
            meta = os.path.join(dst_dir, name + ".meta")
            if os.path.exists(meta):
                os.remove(meta)
    return len(made)


def main():
    src = os.path.abspath(sys.argv[1])
    manifest = os.path.join(src, "manifest.json")
    if not os.path.exists(manifest):
        sys.exit(f"{manifest} 不存在：烘焙页还没跑完")
    m = json.load(open(manifest, encoding="utf-8"))
    n_sfx = convert(os.path.join(src, "sfx"), os.path.join(DEST, "Sfx"), 5, 1)
    n_music = convert(os.path.join(src, "music"), os.path.join(DEST, "Music"), 6, 2)
    # Unity 的 JsonUtility 不认字典：id → 参数 的表换成数组
    out = {
        "sampleRate": m["sampleRate"],
        "generated": m["generated"],
        "beamLoop": m.get("beamLoop", ""),
        "mix": m["mix"],
        "sfx": [dict(id=k, **v) for k, v in m["sfx"].items()],
        "music": [dict(id=k, **v) for k, v in m["music"].items()],
    }
    with open(os.path.join(DEST, "audio-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(DEST) for f in fs if f.endswith(".ogg"))
    print(f"音效 {n_sfx} 个、配乐 {n_music} 首 → {DEST}（ogg 共 {size / 1048576:.1f} MB）")


if __name__ == "__main__":
    main()
