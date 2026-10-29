using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩法屏效（F4 GameplayVolumes）+ 画质档的后处理部分。几个运行时的全局 Volume，权重每帧按玩法状态算：
    ///   低血量（生命 &lt; 35% 起、10% 满）：去饱和 −38、对比 +6——世界褪色，让 HUD 的红色暗角和心跳更显眼（暗角本身 HUD 已经有，这里不再叠）；
    ///   受击：色差脉冲，强度 0.35 + 伤害占（生命 + 护盾上限）× 3，只扣护盾 × 0.6；0.03 s 起、约 0.35 s 褪完（红闪归 HUD）；
    ///   冲刺：色差 0.25 + 暗角收一点（到 0.3），跟着冲刺 0.32 s 退掉（FOV 冲击归 CameraFeel，风痕归 MovementFx）；
    ///   慢动作（只认仲裁器里阵亡 / 首领溃散的 DeathSlowMo，顿帧和暂停不算）：去饱和 −30、对比 +10、暗角 0.34、色差 0.15。
    /// 克制：色差最多 0.4（URP 0..1），不加模糊 / 镜头畸变 / 颗粒；全部再乘设置「屏幕特效」（0 = 关）。
    /// 叠加顺序（优先级 150–153，高于关卡 0、天气 50 / 60）：低血量 → 冲刺 → 慢动作 → 受击，色差这种「取大」的量后来的覆盖先来的，所以最强的受击放最后。
    /// 画质档（<see cref="QualityProfile"/>）：低档一个优先级 140 的 Volume 只覆盖 Bloom 的分辨率 / 迭代次数（强度、阈值照用关卡的）；
    /// 主相机的 SMAA 质量也跟着档位改。
    /// 第一次进场景时自动创建（DontDestroyOnLoad），不用摆进场景；所有时间用不缩放时间。
    /// </summary>
    [DefaultExecutionOrder(100)]
    public sealed class GameplayVolumes : MonoBehaviour
    {
        public static GameplayVolumes Instance { get; private set; }

        public const int QualityPriority = 140, LowHealthPriority = 150, DashPriority = 151, SlowPriority = 152, HurtPriority = 153;
        public const float LowHpStart = 0.35f, LowHpFull = 0.1f;
        public const float HurtAttack = 0.03f, HurtDecay = 0.14f, DashHold = 0.05f, DashFade = 0.27f;
        public const float HurtAberration = 0.4f, DashAberration = 0.25f, SlowAberration = 0.15f;

        Volume lowHp, hurt, dash, slow, quality;
        Bloom qualityBloom;
        float hurtAt = -10, hurtPeak, dashAt = -10, slowV, nextCamCheck;

        /// <summary>当前各屏效的最终权重（已乘「屏幕特效」，测试 / 截图用）</summary>
        public float LowHealthWeight => W(lowHp);
        public float HurtWeight => W(hurt);
        public float DashWeight => W(dash);
        public float SlowWeight => W(slow);
        public bool QualityVolumeActive => quality && quality.enabled;

        static float W(Volume v) => v && v.enabled ? v.weight : 0;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Instance = null;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            SceneManager.sceneLoaded -= OnLoaded;
            SceneManager.sceneLoaded += OnLoaded;
            Ensure();
        }

        static void OnLoaded(Scene s, LoadSceneMode m) => Ensure();

        /// <summary>确保有一个实例（Play 时）</summary>
        public static GameplayVolumes Ensure()
        {
            if (Instance || !Application.isPlaying) return Instance;
            var go = new GameObject("Gameplay Volumes");
            DontDestroyOnLoad(go);
            return go.AddComponent<GameplayVolumes>();
        }

        // ───────────── 纯函数（EditMode 测试）─────────────

        /// <summary>低血量权重：生命比例 35% 起、10% 满（平滑），阵亡 = 0（交给慢动作）</summary>
        public static float LowHealthTarget(float hpFraction, bool dead)
        {
            if (dead || float.IsNaN(hpFraction)) return 0;
            float t = Mathf.InverseLerp(LowHpStart, LowHpFull, hpFraction);
            return t * t * (3 - 2 * t);
        }

        /// <summary>受击峰值：0.35 + 伤害占总池 × 3，只扣护盾 × 0.6，夹到 1</summary>
        public static float HurtStrength(float toHp, float toShield, float pool)
        {
            float dmg = Mathf.Max(0, toHp) + Mathf.Max(0, toShield);
            if (dmg <= 0) return 0;
            float k = Mathf.Clamp01(0.35f + dmg / Mathf.Max(1, pool) * 3f);
            return toHp > 0 ? k : k * 0.6f;
        }

        /// <summary>受击包络：0.03 s 线性起，之后指数退（τ 0.14 s，0.35 s 时约剩 8%）</summary>
        public static float HurtEnvelope(float age)
        {
            if (age < 0) return 0;
            if (age < HurtAttack) return age / HurtAttack;
            float v = Mathf.Exp(-(age - HurtAttack) / HurtDecay);
            return v < 0.02f ? 0 : v;
        }

        /// <summary>冲刺包络：0.05 s 起到满，之后 0.27 s 二次退到 0</summary>
        public static float DashEnvelope(float age)
        {
            if (age < 0) return 0;
            if (age < DashHold) return age / DashHold;
            float k = 1 - (age - DashHold) / DashFade;
            return k <= 0 ? 0 : k * k;
        }

        /// <summary>慢动作目标权重：只认 DeathSlowMo；时间缩放 0.3 → 1（(1 − s) / 0.7）</summary>
        public static float SlowTarget(float timeScale, int priority)
        {
            if (priority != TimeScaleArbiter.Priority.DeathSlowMo || timeScale >= 0.98f) return 0;
            return Mathf.Clamp01((1 - timeScale) / 0.7f);
        }

        // ───────────── 运行时 ─────────────

        void Awake()
        {
            if (Instance && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;

            lowHp = Make("Low Health", LowHealthPriority, p =>
            {
                var c = p.Add<ColorAdjustments>();
                c.saturation.Override(-38f);
                c.contrast.Override(6f);
            });
            dash = Make("Dash", DashPriority, p =>
            {
                p.Add<ChromaticAberration>().intensity.Override(FeelProfile.Active.dashAberration);
                var v = p.Add<Vignette>();
                v.intensity.Override(0.3f);
                v.smoothness.Override(0.5f);
                v.color.Override(Color.black);
            });
            slow = Make("Slow Motion", SlowPriority, p =>
            {
                var c = p.Add<ColorAdjustments>();
                c.saturation.Override(-30f);
                c.contrast.Override(10f);
                var v = p.Add<Vignette>();
                v.intensity.Override(0.34f);
                v.smoothness.Override(0.5f);
                v.color.Override(Color.black);
                p.Add<ChromaticAberration>().intensity.Override(FeelProfile.Active.slowAberration);
            });
            hurt = Make("Hurt", HurtPriority, p => p.Add<ChromaticAberration>().intensity.Override(FeelProfile.Active.hurtAberration));
            quality = Make("Quality Post", QualityPriority, p => qualityBloom = p.Add<Bloom>());
        }

        Volume Make(string name, int priority, System.Action<VolumeProfile> fill)
        {
            var go = new GameObject($"Volume · {name}");
            go.transform.SetParent(transform, false);
            var v = go.AddComponent<Volume>();
            v.isGlobal = true;
            v.priority = priority;
            v.weight = 0;
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            profile.name = $"VP_Runtime_{name.Replace(' ', '_')}";
            profile.hideFlags = HideFlags.DontSave;
            fill(profile);
            v.sharedProfile = profile;
            v.enabled = false;
            return v;
        }

        void OnEnable()
        {
            GameEvents.PlayerHit += OnPlayerHit;
            GameEvents.PlayerDashed += OnDashed;
            GraphicsQuality.Applied += OnQuality;
            ArtQuality.Changed += OnArtQuality;
            OnQuality(QualityProfile.Current);
        }

        void OnDisable()
        {
            GameEvents.PlayerHit -= OnPlayerHit;
            GameEvents.PlayerDashed -= OnDashed;
            GraphicsQuality.Applied -= OnQuality;
            ArtQuality.Changed -= OnArtQuality;
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
            foreach (var v in new[] { lowHp, hurt, dash, slow, quality })
                if (v && v.sharedProfile) Destroy(v.sharedProfile);
        }

        void OnPlayerHit(in PlayerHitEvent e)
        {
            var pv = PlayerVitals.Instance;
            float pool = pv ? pv.MaxHealth + pv.MaxShield : 100;
            float k = HurtStrength(e.toHp, e.toShield, pool);
            if (k <= 0) return;
            // 正在褪的那一下没退完时取大的，不叠加
            float now = Time.unscaledTime;
            hurtPeak = Mathf.Max(k, hurtPeak * HurtEnvelope(now - hurtAt));
            hurtAt = now;
        }

        void OnDashed(Vector3 dir) => dashAt = Time.unscaledTime;

        /// <summary>直接触发一次受击屏效（测试 / 机关用；strength 0..1）</summary>
        public void PulseHurt(float strength)
        {
            hurtPeak = Mathf.Clamp01(strength);
            hurtAt = Time.unscaledTime;
        }

        /// <summary>直接触发一次冲刺屏效（测试用）</summary>
        public void PulseDash() => dashAt = Time.unscaledTime;

        void OnArtQuality(ArtQualityLevel l) => OnQuality(QualityProfile.For(l));

        void OnQuality(QualityProfile p)
        {
            if (!quality || p == null) return;
            bool on = p.bloomQuarter || p.bloomMaxIterations > 0;
            if (qualityBloom)
            {
                qualityBloom.downscale.overrideState = p.bloomQuarter;
                qualityBloom.downscale.value = p.bloomQuarter ? BloomDownscaleMode.Quarter : BloomDownscaleMode.Half;
                qualityBloom.maxIterations.overrideState = p.bloomMaxIterations > 0;
                if (p.bloomMaxIterations > 0) qualityBloom.maxIterations.value = p.bloomMaxIterations;
            }
            quality.weight = on ? 1 : 0;
            quality.enabled = on;
            nextCamCheck = 0;
        }

        void Update()
        {
            float now = Time.unscaledTime, dt = Time.unscaledDeltaTime;
            float amount = Mathf.Clamp01(GameSettings.ScreenEffects.Value);

            var pv = PlayerVitals.Instance;
            float low = 0;
            if (pv && pv.isActiveAndEnabled && pv.MaxHealth > 0) low = LowHealthTarget(pv.health / pv.MaxHealth, pv.Dead);

            float slowTarget = SlowTarget(TimeScaleArbiter.Current, TimeScaleArbiter.ActivePriority);
            slowV = Mathf.MoveTowards(slowV, slowTarget, dt * (slowTarget > slowV ? 5f : 2.5f));

            Set(lowHp, low * amount);
            Set(hurt, hurtPeak * HurtEnvelope(now - hurtAt) * amount);
            Set(dash, DashEnvelope(now - dashAt) * amount);
            Set(slow, slowV * amount);

            if (now >= nextCamCheck)
            {
                nextCamCheck = now + 0.5f;
                SyncCamera();
            }
        }

        static void Set(Volume v, float w)
        {
            if (!v) return;
            w = Mathf.Clamp01(w);
            bool on = w > 0.002f;
            if (v.enabled != on) v.enabled = on;
            v.weight = on ? w : 0;
        }

        /// <summary>主相机的 SMAA 质量跟着画质档（相机由 PlayerFactory 运行时生成，所以轮询）</summary>
        static void SyncCamera()
        {
            var cam = Camera.main;
            if (!cam || !cam.TryGetComponent<UniversalAdditionalCameraData>(out var data)) return;
            if (data.antialiasing != AntialiasingMode.SubpixelMorphologicalAntiAliasing) return;
            var want = QualityProfile.Current.smaa;
            if (data.antialiasingQuality != want) data.antialiasingQuality = want;
        }
    }
}
