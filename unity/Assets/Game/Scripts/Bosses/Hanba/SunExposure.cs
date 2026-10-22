using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 日晒与荫蔽（旱魃核心机制，docs/level-design/unity-maps-v1.md 第 3 节；docs/unity-parity.md BS1「SunExposure：每 0.1 s 从胸 / 头朝太阳打射线 + 主光投影；浅水减灼烧」）。
    /// 挂在旱魃身上（<see cref="HanbaBrain"/> 生成时挂），首领登场后、倒下前每 <see cref="Interval"/> 秒判定一次玩家：
    ///   · 光柱：从胸口、头顶两个探针沿主光反方向（指向太阳）打射线——穴顶开口由 <see cref="SunShaft"/> 声明（射线在穴顶高度要落进裂缝），
    ///     开口以下被岩岛、月牙阁、沙丘、悬垂岩体挡住就是在影子里。真实阴影来自同一盏主光，射线与投影看到的是同一套几何；
    ///   · 日轮直射：探针到日轮轮心（<see cref="SunRing.Center"/>）在 <see cref="RingRange"/> 以内、中间没有世界几何挡着（首领自己的身体不算）。
    ///     平时 14 m，日轮炽度越高越远（扫射时 24 m）——躲到岩岛、月牙阁、沙丘背后，或者拉开距离；
    ///   · 每个探针各占一半：只露出头 = 半份；光柱与日轮的增益相加；脚下有浅水（<see cref="WaterVolume"/>）时整份 × <see cref="waterFactor"/>（0.5）。
    /// 增益 &gt; 0 时把这 0.1 s 交给 <see cref="PlayerStatus.SunExposure"/>（日晒灼烧：每 0.5 s 暴露叠一层、最多 10 层，每层每跳 0.6 × 首领伤害倍率的火伤；
    /// 0.3 s 没暴露就每秒消退 3 层——躲进影子约 3 s 清空）。叠层速度、每层伤害、距离都在 <see cref="HanbaDef"/> 里调。
    /// 第一次被晒到时提示一次躲法；叠到 7 层以上每 1.2 s 一下暖色闪屏。读数（<see cref="LastGain"/> 等）给冒烟测试和调试叠层。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SunExposure : MonoBehaviour
    {
        /// <summary>判定间隔（秒）</summary>
        public const float Interval = 0.1f;
        /// <summary>两个探针：胸口（身高 55%）、头顶（眼睛）</summary>
        public const float ChestFraction = 0.55f;

        [Tooltip("光柱整份暴露的叠层增益")] public float shaftGain = 1f;
        [Tooltip("日轮直射整份暴露的叠层增益")] public float ringGain = 0.6f;
        [Tooltip("日轮平时 / 最炽时的直射距离（米）")] public float ringRange = 14f, ringBlazeRange = 24f;
        [Tooltip("踩浅水时的增益倍率")] public float waterFactor = 0.5f;
        [Tooltip("每层每跳伤害（难度 1；乘首领伤害倍率）")] public float damagePerStack = SunburnStatus.DamagePerStack;
        [Tooltip("关掉 = 暂停判定（演出、倒下）")] public bool active = true;

        [System.NonSerialized] public BossBrain owner;
        [System.NonSerialized] public SunRing ring;

        float timer, flashAt;
        bool hinted;

        // ───────────── 读数 ─────────────

        /// <summary>判定过几次 / 其中有几次晒到</summary>
        public int Samples { get; private set; }
        public int ExposedSamples { get; private set; }
        /// <summary>最近一次：光柱份额（0 / 0.5 / 1）、日轮份额、浅水倍率、合计增益（含浅水）与未乘浅水的增益</summary>
        public float LastShaft { get; private set; }
        public float LastRing { get; private set; }
        public float LastWater { get; private set; } = 1f;
        public float LastRaw { get; private set; }
        public float LastGain { get; private set; }
        public bool LastInWater { get; private set; }
        /// <summary>累计折算的暴露秒数（增益 × 间隔）</summary>
        public float ExposedSeconds { get; private set; }

        /// <summary>在判定：开着、首领登场完、没倒下</summary>
        public bool Running => active && owner && !owner.Dead && owner.IntroDone;

        /// <summary>每层每跳的实际伤害（× 首领伤害倍率：难度、精英、光环）</summary>
        public float DamagePerStack => damagePerStack * (owner ? owner.DamageMult : 1f);

        /// <summary>日轮直射的距离：按炽度在平时与最炽之间插值</summary>
        public float RingRange
        {
            get
            {
                if (!ring) return ringRange;
                float k = Mathf.Clamp01((ring.Blaze - ring.idleBlaze) / Mathf.Max(0.01f, 1f - ring.idleBlaze));
                return Mathf.Lerp(ringRange, ringBlazeRange, k);
            }
        }

        void Update()
        {
            if (!Running) return;
            timer -= Time.deltaTime;
            if (timer > 0) return;
            timer = Mathf.Max(0, timer + Interval);
            Tick();
        }

        /// <summary>判定一次（测试可以直接调）：返回这次交给日晒灼烧的增益（0 = 没晒到）</summary>
        public float Tick()
        {
            Samples++;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || !Probes(out var feet, out var chest, out var head))
            {
                LastShaft = LastRing = LastRaw = LastGain = 0;
                return 0;
            }
            float raw = GainAt(feet, chest, head, out float shaft, out float ringShare, out float water);
            LastShaft = shaft;
            LastRing = ringShare;
            LastWater = water;
            LastInWater = water < 1f;
            LastRaw = raw;
            LastGain = raw * water;
            if (LastGain <= 0) return 0;
            ExposedSamples++;
            ExposedSeconds += LastGain * Interval;
            var from = ringShare > 0 && ring ? ring.Center : head + SunShaft.ToSun * 20f;
            PlayerStatus.SunExposure(Interval, LastGain, DamagePerStack, from);
            Feedback();
            return LastGain;
        }

        /// <summary>额外灼烧（扫射光束、旱风热浪打中时）：直接按 seconds 秒暴露叠层，不看影子</summary>
        public bool Burn(float seconds, Vector3 from) =>
            seconds > 0 && PlayerStatus.SunExposure(seconds, 1f, DamagePerStack, from);

        /// <summary>某组探针的暴露增益（不乘浅水）：光柱份额 × 光柱增益 + 日轮份额 × 日轮增益；water = 脚下的浅水倍率</summary>
        public float GainAt(Vector3 feet, Vector3 chest, Vector3 head, out float shaft, out float ringShare, out float water)
        {
            var toSun = SunShaft.ToSun;
            shaft = (ShaftLit(chest, toSun) ? 0.5f : 0) + (ShaftLit(head, toSun) ? 0.5f : 0);
            ringShare = (RingLit(chest) ? 0.5f : 0) + (RingLit(head) ? 0.5f : 0);
            water = WaterVolume.At(feet, out float depth) && depth > 0.05f ? Mathf.Clamp01(waterFactor) : 1f;
            return shaft * shaftGain + ringShare * ringGain;
        }

        /// <summary>这一点朝太阳看得到天（穴顶开口 + 物理遮挡）</summary>
        public static bool ShaftLit(Vector3 point, Vector3 toSun)
        {
            if (!SunShaft.SkyOpen(point, toSun, out float dist)) return false;
            return !Physics.Raycast(point, toSun, dist, Layers.WorldMask, QueryTriggerInteraction.Ignore);
        }

        /// <summary>这一点朝太阳看得到天（用场景当前的主光方向）</summary>
        public static bool ShaftLit(Vector3 point) => ShaftLit(point, SunShaft.ToSun);

        /// <summary>这一点被日轮直射：在直射距离内、到轮心之间没有世界几何（首领身体在 Character 层，不挡）</summary>
        public bool RingLit(Vector3 point)
        {
            if (!ring || !ring.Ring) return false;
            var c = ring.Center;
            if ((c - point).sqrMagnitude > RingRange * RingRange) return false;
            return Combat.LineClear(point, c, 0.6f);
        }

        /// <summary>玩家的脚底、胸口、头顶（眼睛）探针</summary>
        public static bool Probes(out Vector3 feet, out Vector3 chest, out Vector3 head)
        {
            chest = head = default;
            if (!BossHazards.PlayerBody(out feet, out _, out float height)) return false;
            chest = feet + Vector3.up * height * ChestFraction;
            var pv = PlayerVitals.Instance;
            var motor = pv ? pv.GetComponent<Spiritfire.Art.PlayerMotor>() : null;
            head = motor && motor.eye ? motor.eye.position : feet + Vector3.up * height * 0.92f;
            return true;
        }

        /// <summary>第一次晒到提示躲法；叠到 7 层以上每 1.2 s 一下暖色闪屏</summary>
        void Feedback()
        {
            if (!hinted)
            {
                hinted = true;
                GameUI.Toast("烈日灼身——躲进岩岛、月牙阁或沙丘的影子里，站在浅水里灼烧减半", new Color(1f, 0.84f, 0.45f), 4f);
            }
            var st = PlayerStatus.Instance;
            var inst = st ? st.Get<SunburnInstance>(StatusId.Sunburn) : null;
            if (inst == null || inst.Stacks < 7 || Time.time < flashAt) return;
            flashAt = Time.time + 1.2f;
            GameUI.ScreenFlash(new Color(1f, 0.78f, 0.36f, 0.16f), 0.35f);
        }

        /// <summary>玩家此刻的日晒层数（没有为 0）</summary>
        public static int PlayerStacks
        {
            get
            {
                var st = PlayerStatus.Instance;
                var inst = st ? st.Get<SunburnInstance>(StatusId.Sunburn) : null;
                return inst != null && inst.Active ? inst.Stacks : 0;
            }
        }
    }
}
