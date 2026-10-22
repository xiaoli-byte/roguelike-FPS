using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 音频（Three.js 版 src/audio/AudioSystem.ts 的 Unity 版）。片段由 audio-bake.html 从 Three.js 的合成配方离线渲出
    /// （scripts/audio/bake.py 转 ogg 放进 Resources/Audio，清单 audio-manifest.json 带每个 SfxId 的混音参数）。
    ///   音效：<see cref="Play"/>（玩家自己的、不带位置）/ <see cref="PlayAt"/>（世界里的：带位置时优先用敌方音色 &lt;id&gt;@enemy）。
    ///         同 id 节流（敌方音色单独节流）、48 声道（满了按优先级抢占最旧的）、随机音高 ±meta.pitch、
    ///         带位置的按距离衰减（2 m 内不衰减、40 m 外静音，k^1.6），10 m 外渐闷、背后发闷（低通），近处声像收窄
    ///   光束：<see cref="HoldBeam"/> 每次开火刷新，0.24 s 没刷新就淡出（无缝循环片段 shot_beam_loop）
    ///   配乐：<see cref="SetMusic"/> 交叉淡化（旧曲淡出 1.6 s、新曲淡入 1.3 s），曲目是无缝循环的 ogg
    /// 基础音量（meta.gain）与混响已经烘进片段，这里只乘调用方的 volume 与总线比例（音效 0.9 / 音乐 0.3，主音量 0.8）。
    /// 第一次调用时自动创建（不用摆进场景）。
    /// </summary>
    public sealed class GameAudio : MonoBehaviour
    {
        const int MaxVoices = 48;
        const float SilentDist = 40, NearDist = 2, BeamHold = 0.24f, FadeOut = 1.6f, FadeIn = 1.3f;

        [Serializable] class SfxEntry { public string id; public int variants, enemyVariants, prio; public float gain, pitch, throttle, send; }
        [Serializable] class MusicEntry { public string id; public float seconds, loopSeconds, bpm, level, send; }
        [Serializable] class Mix { public float master = 0.8f, sfx = 0.9f, music = 0.3f; }
        [Serializable] class Manifest { public string beamLoop; public Mix mix; public SfxEntry[] sfx; public MusicEntry[] music; }

        sealed class Def
        {
            public SfxEntry meta;
            public AudioClip[] clips, enemy;
        }

        sealed class Voice
        {
            public AudioSource src;
            public AudioLowPassFilter lp;
            public int prio;
            public float start, end;
        }

        sealed class Track
        {
            public AudioSource src;
            public string id;
            public float vol, target, rate;
        }

        static GameAudio instance;
        static bool failed;

        /// <summary>设置里的音量（0..1），跟着 <see cref="GameSettings"/> 走</summary>
        public static float MasterVolume = 1, SfxVolume = 1, MusicVolume = 1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void BindSettings()
        {
            GameSettings.Changed -= OnSetting;
            GameSettings.Changed += OnSetting;
            OnSetting(null);
        }

        static void OnSetting(SettingDef d)
        {
            if (d != null && d != GameSettings.MasterVolume && d != GameSettings.MusicVolume && d != GameSettings.SfxVolume) return;
            MasterVolume = GameSettings.MasterVolume.Value;
            MusicVolume = GameSettings.MusicVolume.Value;
            SfxVolume = GameSettings.SfxVolume.Value;
        }

        readonly Dictionary<string, Def> defs = new();
        readonly Dictionary<string, float> lastPlayed = new(), lastEnemy = new();
        readonly HashSet<string> warned = new();
        readonly List<Voice> voices = new();
        readonly List<Track> tracks = new();
        Mix mix = new();
        AudioSource beam;
        float beamHeld = -1, beamTarget;
        string musicId = "none";
        Transform listener;

        /// <summary>当前配乐 id（"none" = 无）</summary>
        public static string CurrentMusic => instance ? instance.musicId : "none";

        static GameAudio Get()
        {
            if (instance) return instance;
            // 不在 Play 模式（EditMode 测试）：返回真 null。Play 模式退出后静态字段还指着已销毁的对象（关了进 Play 模式的域重载时），
            // 原样返回它的话 Get()?.X 会绕过 Unity 的判空、在销毁的对象上调用，抛 MissingReferenceException
            if (failed || !Application.isPlaying) return null;
            var go = new GameObject("Game Audio");
            DontDestroyOnLoad(go);
            instance = go.AddComponent<GameAudio>();
            return instance;
        }

        /// <summary>玩家自己的声音（枪声、受伤、拾取、界面…）：不带位置</summary>
        public static void Play(string id, float volume = 1, float pitch = 1) => Get()?.PlayInternal(id, false, default, volume, pitch);

        /// <summary>世界里的声音：带位置（敌人、爆炸、宝箱…），有敌方音色时用敌方音色</summary>
        public static void PlayAt(string id, Vector3 at, float volume = 1, float pitch = 1) => Get()?.PlayInternal(id, true, at, volume, pitch);

        /// <summary>光束武器持续音：开火期间每次都调用（刷新保持时间）</summary>
        public static void HoldBeam(float volume = 1, float pitch = 1) => Get()?.HoldBeamInternal(volume, pitch);

        /// <summary>切换配乐：menu / calm / combat / boss / none（相同曲目忽略）</summary>
        public static void SetMusic(string id) => Get()?.SetMusicInternal(id);

        /// <summary>某个音效有没有片段（测试用）</summary>
        public static bool Has(string id) => Get() is { } a && a.defs.TryGetValue(id, out var d) && d.clips.Length > 0;

        /// <summary>正在发声的声道数（测试用）</summary>
        public static int ActiveVoices
        {
            get
            {
                if (!instance) return 0;
                int n = 0;
                foreach (var v in instance.voices) if (v.src.isPlaying) n++;
                return n;
            }
        }

        public static bool BeamPlaying => instance && instance.beam && instance.beam.isPlaying;

        void Awake()
        {
            instance = this;
            var text = Resources.Load<TextAsset>("Audio/audio-manifest");
            if (!text)
            {
                Debug.LogWarning("[Audio] 没有 Resources/Audio/audio-manifest.json（先跑 audio-bake.html + scripts/audio/bake.py），静音运行");
                failed = true;
                enabled = false;
                return;
            }
            var m = JsonUtility.FromJson<Manifest>(text.text);
            if (m.mix != null) mix = m.mix;
            var clips = new Dictionary<string, AudioClip>();
            foreach (var c in Resources.LoadAll<AudioClip>("Audio/Sfx")) clips[c.name] = c;
            AudioClip[] Collect(string prefix, int n)
            {
                var list = new List<AudioClip>();
                for (int i = 0; i < n; i++) if (clips.TryGetValue($"{prefix}_{i}", out var c)) list.Add(c);
                return list.ToArray();
            }
            foreach (var e in m.sfx ?? Array.Empty<SfxEntry>())
                defs[e.id] = new Def { meta = e, clips = Collect(e.id, e.variants), enemy = Collect(e.id + "@enemy", e.enemyVariants) };

            for (int i = 0; i < MaxVoices; i++)
            {
                var go = new GameObject($"Voice {i}");
                go.transform.SetParent(transform, false);
                var src = go.AddComponent<AudioSource>();
                Setup(src);
                var lp = go.AddComponent<AudioLowPassFilter>();
                lp.enabled = false;
                lp.lowpassResonanceQ = 0.7f;
                voices.Add(new Voice { src = src, lp = lp });
            }
            beam = gameObject.AddComponent<AudioSource>();
            Setup(beam);
            beam.loop = true;
            if (!string.IsNullOrEmpty(m.beamLoop) && clips.TryGetValue(m.beamLoop, out var bc)) beam.clip = bc;
        }

        static void Setup(AudioSource s)
        {
            s.playOnAwake = false;
            s.dopplerLevel = 0;
            s.spatialBlend = 0;
            // 距离衰减自己算（同 Three.js），Unity 的衰减曲线拉平
            s.rolloffMode = AudioRolloffMode.Custom;
            s.SetCustomCurve(AudioSourceCurveType.CustomRolloff, AnimationCurve.Constant(0, 1, 1));
            s.maxDistance = SilentDist;
            s.spread = 40;
        }

        Transform Listener()
        {
            if (listener && listener.gameObject.activeInHierarchy) return listener;
            var l = FindAnyObjectByType<AudioListener>();
            listener = l ? l.transform : null;
            return listener;
        }

        float SfxBus => mix.sfx * mix.master * SfxVolume * MasterVolume;

        void PlayInternal(string id, bool positional, Vector3 at, float volume, float pitch)
        {
            if (!enabled) return;
            if (!defs.TryGetValue(id, out var d) || d.clips.Length == 0)
            {
                if (warned.Add(id)) Debug.LogWarning($"[Audio] 没有音效 {id}");
                return;
            }
            bool enemy = positional && d.enemy.Length > 0;
            var lastMap = enemy ? lastEnemy : lastPlayed;
            float now = Time.unscaledTime;
            if (d.meta.throttle > 0 && lastMap.TryGetValue(id, out var last) && now - last < d.meta.throttle) return;
            if (!(volume >= 0) || float.IsInfinity(volume)) volume = 1;
            float gain = Mathf.Min(4, volume) * SfxBus;
            float lowpass = 0, blend = 0;
            if (positional)
            {
                if (!(float.IsFinite(at.x) && float.IsFinite(at.y) && float.IsFinite(at.z))) return;
                var l = Listener();
                if (l)
                {
                    var dv = at - l.position;
                    float dist = dv.magnitude;
                    if (dist >= SilentDist) return;
                    float k = dist <= NearDist ? 1 : 1 - (dist - NearDist) / (SilentDist - NearDist);
                    gain *= Mathf.Pow(k, 1.6f);
                    if (dist > 0.3f)
                    {
                        // 近处声像收窄（同 Three.js：pan × min(1, dist/3) × 0.85）；远处渐闷、背后发闷
                        blend = Mathf.Min(1, dist / 3) * 0.85f;
                        float front = Vector3.Dot(dv / dist, l.forward);
                        float far = dist > 10 ? 900 + 17000 * Mathf.Pow(1 - dist / (SilentDist + 8), 2) : 20000;
                        float behind = front < -0.25f ? 5500 : 20000;
                        float lp = Mathf.Min(far, behind);
                        if (lp < 19000) lowpass = lp;
                    }
                }
            }
            if (!(gain >= 0.003f)) return;
            if (!(pitch > 0) || float.IsInfinity(pitch)) pitch = 1;
            float p = Mathf.Clamp(pitch * (1 + UnityEngine.Random.Range(-1f, 1f) * d.meta.pitch), 0.25f, 3f);

            // 玩家自己的光束武器（不带位置）走持续音
            if (id == "shot_beam" && !positional)
            {
                lastMap[id] = now;
                HoldBeamInternal(volume, pitch);
                return;
            }
            var v = FreeVoice(d.meta.prio, now);
            if (v == null) return;
            // 只有真正发声才计入节流
            lastMap[id] = now;
            var clips = enemy ? d.enemy : d.clips;
            var clip = clips[UnityEngine.Random.Range(0, clips.Length)];
            var s = v.src;
            s.Stop();
            s.clip = clip;
            s.pitch = p;
            s.volume = Mathf.Min(1, gain);
            s.spatialBlend = blend;
            if (positional) s.transform.position = at;
            v.lp.enabled = lowpass > 0;
            if (lowpass > 0) v.lp.cutoffFrequency = lowpass;
            v.prio = d.meta.prio;
            v.start = now;
            v.end = now + clip.length / p;
            s.Play();
        }

        /// <summary>空闲声道；满了抢占优先级不高于它的里面最低、最旧的（同 Three.js steal）</summary>
        Voice FreeVoice(int prio, float now)
        {
            Voice best = null;
            foreach (var v in voices)
            {
                if (!v.src.isPlaying) return v;
                if (v.prio > prio) continue;
                if (best == null || v.prio < best.prio || (v.prio == best.prio && v.start < best.start)) best = v;
            }
            return best;
        }

        void HoldBeamInternal(float volume, float pitch)
        {
            if (!beam || !beam.clip) return;
            beamHeld = Time.time;
            beamTarget = Mathf.Clamp01(volume * SfxBus);
            beam.pitch = Mathf.Clamp(pitch, 0.5f, 2f);
            if (!beam.isPlaying)
            {
                beam.volume = 0;
                beam.time = UnityEngine.Random.Range(0, beam.clip.length * 0.9f);
                beam.Play();
            }
        }

        void SetMusicInternal(string id)
        {
            if (string.IsNullOrEmpty(id)) id = "none";
            if (id == musicId) return;
            musicId = id;
            foreach (var t in tracks)
            {
                t.target = 0;
                t.rate = 1 / FadeOut;
            }
            if (id == "none") return;
            var clip = Resources.Load<AudioClip>("Audio/Music/" + id);
            if (!clip)
            {
                if (warned.Add("music:" + id)) Debug.LogWarning($"[Audio] 没有配乐 {id}");
                return;
            }
            var src = gameObject.AddComponent<AudioSource>();
            Setup(src);
            src.clip = clip;
            src.loop = true;
            src.priority = 0;
            src.volume = 0;
            src.Play();
            tracks.Add(new Track { src = src, id = id, vol = 0, target = 1, rate = 1 / FadeIn });
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            // 光束：0.24 s（游戏时间）没被刷新就淡出；暂停时立刻收声
            if (beam && beam.isPlaying)
            {
                bool held = Time.timeScale > 0 && Time.time - beamHeld <= BeamHold;
                float want = held ? beamTarget : 0;
                beam.volume = Mathf.MoveTowards(beam.volume, want, dt / (held ? 0.05f : 0.12f) * Mathf.Max(0.2f, beamTarget));
                if (!held && beam.volume <= 0.001f) beam.Stop();
            }
            // 配乐交叉淡化
            float musicBus = mix.music * mix.master * MusicVolume * MasterVolume;
            for (int i = tracks.Count - 1; i >= 0; i--)
            {
                var t = tracks[i];
                t.vol = Mathf.MoveTowards(t.vol, t.target, dt * t.rate);
                t.src.volume = t.vol * musicBus;
                if (t.target <= 0 && t.vol <= 0)
                {
                    t.src.Stop();
                    Destroy(t.src);
                    tracks.RemoveAt(i);
                }
            }
        }
    }
}
