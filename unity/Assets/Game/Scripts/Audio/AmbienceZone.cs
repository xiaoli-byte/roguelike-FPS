using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 局部混响区（I6）：听者在球内时，SFX → Reverb 的发送再加 <see cref="extraDb"/>（洞窟、井底、殿内），球边 3 m 渐变。
    /// 关卡里需要的地方摆一个；整张图都是封闭空间的（铸神井、祝融炉心）直接由 <see cref="AmbienceDirector"/> 按场景给底，不用摆。
    /// </summary>
    public sealed class AmbienceZone : MonoBehaviour
    {
        public float radius = 20f;
        [Tooltip("在章节 / 关卡的混响发送上再加多少 dB")] public float extraDb = 8f;

        static readonly List<AmbienceZone> live = new();

        void OnEnable() => live.Add(this);
        void OnDisable() => live.Remove(this);

        /// <summary>听者所在位置的局部混响加量（dB，取最大的那个区）</summary>
        public static float ExtraAt(Vector3 p)
        {
            float best = 0;
            foreach (var z in live)
            {
                if (!z) continue;
                float d = Vector3.Distance(p, z.transform.position);
                float w = 1 - Mathf.Clamp01((d - z.radius) / 3f);
                best = Mathf.Max(best, z.extraDb * w);
            }
            return best;
        }
    }

    /// <summary>
    /// 环境声床 + 混响（I6；混音台的 Ambience 总线与 ReverbSend 暴露参数是 F5 给这里留的）：
    ///   · 声床：每章一条无缝循环（Resources/Audio/Music/amb_desert / amb_frost / amb_inferno，audio-bake 合成：
    ///     沙寺 = 低沉的风 + 一阵阵起沙的嘶声，霜山 = 更高更冷、带哨音的风 + 偶尔冰裂，熔火 = 低频轰鸣 + 熔岩冒泡 + 噼啪），
    ///     走 Ambience 总线（设置「环境音」），进关 2.5 s 淡入，阵亡时压低；
    ///   · 混响：SFX 往 Reverb 组的发送（片段里已经烘了一份短混响，这里是空间感的那一份），按章节给底
    ///     （沙寺开阔 −20 dB、霜山山谷回声 −12 dB、熔火岩洞 −10 dB），封闭的关卡（2-4 冰窟、3-2 铸神井、3-4 炉心圆殿）再加，
    ///     关卡里的 <see cref="AmbienceZone"/> 在听者附近再加；变化按 2 dB / 0.1 s 平滑。离开关卡（主菜单、测试场以外的场景切换）关掉发送。
    /// 没有声床片段（还没烘焙）时只做混响，提示一次。[GameSystem]：自动挂在 Game Systems 上。
    /// </summary>
    [GameSystem(140)]
    public sealed class AmbienceDirector : MonoBehaviour
    {
        /// <summary>声床电平（相对环境音总线；声床是持续的，压在音效底下）</summary>
        public const float BedLevel = 0.5f;
        const float FadeIn = 2.5f, DeadLevel = 0.35f, Off = -80f;

        AudioSource bed;
        float vol, sendDb = Off;
        Transform listener;

        /// <summary>当前放的声床 id（测试读）</summary>
        public string Bed { get; private set; }

        /// <summary>章节 → 声床 id</summary>
        public static string BedFor(int chapter) => chapter switch
        {
            2 => "amb_frost",
            3 => "amb_inferno",
            _ => "amb_desert",
        };

        /// <summary>章节 + 场景 → 混响发送的底（dB）</summary>
        public static float ReverbBaseDb(int chapter, string scene)
        {
            float db = chapter switch { 2 => -12f, 3 => -10f, _ => -20f };
            if (scene != null && (scene.StartsWith("L2_4") || scene.StartsWith("L3_2") || scene.StartsWith("L3_4"))) db += 5f;
            return db;
        }

        void Start()
        {
            Bed = BedFor(FxTone.Chapter);
            var clip = Resources.Load<AudioClip>("Audio/Music/" + Bed);
            if (!clip)
            {
                Debug.LogWarning($"[Audio] 没有环境声床 {Bed}（重跑 audio-bake.html 的 I6 段 + scripts/audio/bake.py --partial）");
                return;
            }
            bed = gameObject.AddComponent<AudioSource>();
            bed.clip = clip;
            bed.loop = true;
            bed.playOnAwake = false;
            bed.spatialBlend = 0;
            bed.priority = 8;
            bed.volume = 0;
            var g = AudioMix.Group(AudioBus.Ambience);
            if (g) bed.outputAudioMixerGroup = g;
            bed.time = Random.Range(0, clip.length * 0.9f);
            bed.Play();
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            if (bed)
            {
                var pv = PlayerVitals.Instance;
                float want = pv && pv.Dead ? DeadLevel : 1;
                vol = Mathf.MoveTowards(vol, want, dt / FadeIn);
                bed.volume = vol * BedLevel * GameAudio.UnroutedGain(AudioBus.Ambience);
            }
            var m = AudioMix.Mixer;
            if (!m) return;
            if (!listener || !listener.gameObject.activeInHierarchy)
            {
                var l = FindAnyObjectByType<AudioListener>();
                listener = l ? l.transform : null;
            }
            float target = ReverbBaseDb(FxTone.Chapter, SceneManager.GetActiveScene().name) + (listener ? AmbienceZone.ExtraAt(listener.position) : 0);
            target = Mathf.Min(0, target);
            sendDb = sendDb <= Off + 0.1f ? target : Mathf.MoveTowards(sendDb, target, dt * 20f);
            m.SetFloat(AudioMix.ParamReverbSend, sendDb);
        }

        void OnDisable()
        {
            if (AudioMix.Mixer) AudioMix.Mixer.SetFloat(AudioMix.ParamReverbSend, Off);
            sendDb = Off;
        }
    }
}
