using UnityEngine;
using UnityEngine.Audio;

namespace Spiritfire.Game
{
    /// <summary>混音总线：每个发声源接到 Mixer 的哪一组</summary>
    public enum AudioBus { Sfx, Music, Ui, Ambience }

    /// <summary>
    /// 混音台（F5）：Resources/Audio/Spiritfire.mixer（AudioMixerBuilder 生成，bridge.sh audio）。
    /// <code>
    /// Master   [衰减 ← 主音量] [Compressor 限幅：−2 dB，10 ms / 120 ms]
    /// ├─ World [衰减 ← 快照：游玩 0 dB / 暂停 0.45 / 结算 0.8] [Lowpass Simple ← 快照：暂停 6 kHz]
    /// │  ├─ SFX      [衰减 ← 音效音量] [Send → Reverb，默认 −80 dB，暴露为 ReverbSend 留给 I6 混响区]
    /// │  ├─ Music    [衰减 ← 音乐音量]
    /// │  ├─ Ambience [衰减 ← 环境音量]（风声、以后的环境声床）
    /// │  └─ Reverb   [Receive] [SFX Reverb：纯湿声] [衰减]
    /// └─ UI    [衰减 ← 界面音量]（按钮音不被暂停压低）
    /// </code>
    /// 玩家音量走暴露参数（dB），快照只管 World 和低通——暴露参数一旦 SetFloat 就不再受快照控制，所以两者分在不同的推子上。
    /// 混音台用不缩放时间（暂停时 timeScale = 0 也能过渡）。
    /// 基础电平（audio-manifest 的 master 0.8 / sfx 0.9 / music 0.3 与各音效 gain）仍由 <see cref="GameAudio"/> 乘在 AudioSource 上，Mixer 只做总线。
    /// 没有 .mixer（还没生成）时 GameAudio 退回老办法：玩家音量直接乘在 AudioSource 上，不压低、不限幅。
    /// </summary>
    public static class AudioMix
    {
        public const string MixerName = "Spiritfire", ResourcePath = "Audio/" + MixerName;
        public const string SnapshotGameplay = "Gameplay", SnapshotPaused = "Paused", SnapshotSummary = "Summary";
        public const string ParamMaster = "MasterVolume", ParamSfx = "SfxVolume", ParamMusic = "MusicVolume", ParamUi = "UiVolume",
            ParamAmbience = "AmbienceVolume", ParamWorld = "WorldVolume", ParamReverbSend = "ReverbSend";

        /// <summary>组路径（FindMatchingGroups 用）</summary>
        public const string PathMaster = "Master", PathWorld = "Master/World", PathSfx = "Master/World/SFX", PathMusic = "Master/World/Music",
            PathAmbience = "Master/World/Ambience", PathReverb = "Master/World/Reverb", PathUi = "Master/UI";

        public static readonly string[] GroupPaths = { PathMaster, PathWorld, PathSfx, PathMusic, PathAmbience, PathReverb, PathUi };
        public static readonly string[] Snapshots = { SnapshotGameplay, SnapshotPaused, SnapshotSummary };
        public static readonly string[] ExposedParams = { ParamMaster, ParamSfx, ParamMusic, ParamUi, ParamAmbience, ParamWorld, ParamReverbSend };

        /// <summary>限幅器：阈值 dB、起音 ms、释音 ms（Unity Compressor 的硬拐点高压缩比，当限幅器用）</summary>
        public const float LimiterThreshold = -2f, LimiterAttack = 10f, LimiterRelease = 120f;
        /// <summary>暂停时 World 总线的低通截止频率（Hz）；游玩 / 结算 22 kHz = 不滤</summary>
        public const float PausedLowpass = 6000f, OpenLowpass = 22000f;

        static AudioMixer mixer;
        static bool tried;
        static AudioMixerGroup[] groups;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            mixer = null;
            tried = false;
            groups = null;
        }

        /// <summary>混音台（没生成过 = null）</summary>
        public static AudioMixer Mixer
        {
            get
            {
                if (mixer || tried) return mixer;
                tried = true;
                mixer = Resources.Load<AudioMixer>(ResourcePath);
                if (!mixer) Debug.LogWarning($"[Audio] 没有 Resources/{ResourcePath}.mixer（bridge.sh audio 生成），不压低、不限幅");
                return mixer;
            }
        }

        public static bool Active => Mixer;

        /// <summary>某条总线的输出组（没有混音台 = null，AudioSource 直接出到监听器）</summary>
        public static AudioMixerGroup Group(AudioBus bus)
        {
            var m = Mixer;
            if (!m) return null;
            if (groups == null)
            {
                groups = new AudioMixerGroup[4];
                groups[(int)AudioBus.Sfx] = Find(m, PathSfx);
                groups[(int)AudioBus.Music] = Find(m, PathMusic);
                groups[(int)AudioBus.Ui] = Find(m, PathUi);
                groups[(int)AudioBus.Ambience] = Find(m, PathAmbience);
            }
            return groups[(int)bus];
        }

        /// <summary>按路径找组：FindMatchingGroups 是子串匹配，再核对末段名字（我们的组名不重复）</summary>
        public static AudioMixerGroup Find(AudioMixer m, string path)
        {
            if (!m) return null;
            string leaf = path.Substring(path.LastIndexOf('/') + 1);
            foreach (var g in m.FindMatchingGroups(path))
                if (g && g.name == leaf) return g;
            return null;
        }

        /// <summary>线性音量 → dB（0 = −80 dB 静音）</summary>
        public static float LinearToDb(float v) => v <= 0.0001f ? -80f : Mathf.Clamp(20f * Mathf.Log10(v), -80f, 20f);

        /// <summary>dB → 线性（−80 dB 及以下 = 0）</summary>
        public static float DbToLinear(float db) => db <= -79.9f ? 0f : Mathf.Pow(10f, db / 20f);

        /// <summary>把设置里的音量写到暴露参数上；返回是否全部写进去了（混音台还没激活时 SetFloat 可能不生效，调用方下一帧再试）</summary>
        public static bool ApplyVolumes()
        {
            var m = Mixer;
            if (!m) return true;
            bool ok = true;
            ok &= Write(m, ParamMaster, GameSettings.MasterVolume.Value);
            ok &= Write(m, ParamSfx, GameSettings.SfxVolume.Value);
            ok &= Write(m, ParamMusic, GameSettings.MusicVolume.Value);
            ok &= Write(m, ParamUi, GameSettings.UiVolume.Value);
            ok &= Write(m, ParamAmbience, GameSettings.AmbienceVolume.Value);
            return ok;
        }

        static bool Write(AudioMixer m, string param, float linear)
        {
            float db = LinearToDb(linear);
            if (!m.SetFloat(param, db)) return false;
            return m.GetFloat(param, out float now) && Mathf.Abs(now - db) < 0.05f;
        }

        /// <summary>读一个暴露参数（dB）；读不到返回 NaN</summary>
        public static float Read(string param)
        {
            var m = Mixer;
            return m && m.GetFloat(param, out float v) ? v : float.NaN;
        }
    }
}
