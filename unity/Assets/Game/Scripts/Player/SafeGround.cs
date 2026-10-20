using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 掉进危险区的处理参数（Three.js 版 src/world/Lava.ts 的 LAVA 表；<see cref="Lava"/> 原样照抄）：
    /// 踩进去瞬间扣最大生命的 burst，下沉期间在 tickTimes 时刻各扣 tick，sinkTime 秒后托回最近的安全落脚点，给 grace 秒无敌。
    /// 伤害走正常的玩家受伤流程（减伤、护盾、受伤修饰器），但无视冲刺 / 托回的短无敌（否则冲刺能免伤穿过熔岩、托回后马上再踩进去也不疼）；调试无敌照样生效。
    /// </summary>
    public struct HazardSpec
    {
        public float burst, tick;
        public float[] tickTimes;
        public float sinkTime, grace;
        public Element element;
        /// <summary>踩进去时的闪屏颜色（含 alpha）</summary>
        public Color flash;
        public string sound;

        /// <summary>熔岩：12% + 两跳 1.5%（0.2 / 0.4 s），0.5 s 后托回，1 s 无敌</summary>
        public static HazardSpec Lava => new()
        {
            burst = 0.12f, tick = 0.015f, tickTimes = new[] { 0.2f, 0.4f }, sinkTime = 0.5f, grace = 1f,
            element = Element.Fire, flash = new Color(1f, 0.42f, 0.1f, 0.45f), sound = "skill_fire",
        };

        /// <summary>掉出世界（深渊、地图外）：立刻托回，扣 10% 最大生命，1 s 无敌</summary>
        public static HazardSpec Fall => new()
        {
            burst = 0.1f, tick = 0, tickTimes = Array.Empty<float>(), sinkTime = 0, grace = 1f,
            element = Element.None, flash = new Color(0.05f, 0.04f, 0.04f, 0.7f), sound = "land",
        };
    }

    /// <summary>
    /// 安全落脚点与坠落回收（docs/unity-parity.md 3.10「防卡死 / 安全落脚点」，D14 的坠落回收）：
    ///   · 记录：站在可走的地面上、不在冲刺 / 突进中、脚下是静止的地形（不是会动的刚体），四周 0.5 m 也都有地面（不记悬崖边），
    ///     也不在任何已登记的危险区里（<see cref="RegisterHazard"/>：熔岩、深水、流沙中心……由各自的单元登记）——每 0.2 s 记一次，留最近 8 个；
    ///   · 坠落：低于 <see cref="killY"/>，或高速下坠且脚下 400 m 内什么都没有（掉进虚空）→ 托回最近的安全点，按 <see cref="HazardSpec.Fall"/> 扣血；
    ///   · 危险区：<see cref="Sink"/>（熔岩单元在玩家踩进熔岩时调用）→ 下沉、跳伤、托回、无敌。
    /// 托回点会再检查一次危险区（熔岩涨上来淹掉的点不用），全都不安全时退回进场位置。
    /// PlayerVitals 在 Awake 里确保它挂在玩家身上。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SafeGround : MonoBehaviour
    {
        public static SafeGround Instance { get; private set; }

        /// <summary>低于这个高度算掉出世界（关卡 / 边界单元可以按地形最低点改）</summary>
        public float killY = -60f;
        /// <summary>每隔多久尝试记录一次安全点（秒）</summary>
        public float recordInterval = 0.2f;
        /// <summary>四周探测半径：这个半径内有一边没有地面的点不算安全（不把人托回悬崖边）</summary>
        public float edgeProbe = 0.5f;
        /// <summary>两个安全点至少隔多远才另记一个（米）</summary>
        public float spacing = 1.5f;

        const int RingSize = 8;
        /// <summary>超过这个时长的无敌视为调试无敌：危险区不扣血</summary>
        const float DebugInvuln = 5f;
        /// <summary>高速下坠（m/s）时才检查脚下是不是虚空</summary>
        const float AbyssFallSpeed = 20f, AbyssProbe = 400f;

        static readonly List<Func<Vector3, bool>> hazards = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            hazards.Clear();
            Instance = null;
        }

        readonly Vector3[] ring = new Vector3[RingSize];
        int count, head;
        Vector3 origin;
        float minSafeY = float.PositiveInfinity;
        float nextRecord, nextAbyssCheck;
        PlayerMotor motor;
        PlayerVitals vitals;
        IDisposable sinkLock;
        // 下沉状态
        bool sinking;
        HazardSpec sinkSpec;
        float sinkT;
        int sinkTicks;

        /// <summary>最近的安全落脚点（还没记过时是进场位置）</summary>
        public Vector3 LastSafe => count > 0 ? ring[(head - 1 + RingSize) % RingSize] : origin;
        /// <summary>正在危险区里下沉、等待托回</summary>
        public bool Sinking => sinking;
        /// <summary>本关被托回的次数（调试 / 测试）</summary>
        public int Recoveries { get; private set; }
        /// <summary>被托回之后（托回点）</summary>
        public event Action<Vector3> Recovered;

        /// <summary>
        /// 登记一个危险区查询（脚底位置 → 是否危险）：命中的点不记成安全点、托回时也跳过。返回的句柄 Dispose 即撤销。
        /// 熔岩单元登记「离熔岩 1 m 以内」，水面单元登记「深水」……
        /// </summary>
        public static IDisposable RegisterHazard(Func<Vector3, bool> isHazard)
        {
            if (isHazard == null) throw new ArgumentNullException(nameof(isHazard));
            hazards.Add(isHazard);
            return new Handle(isHazard);
        }

        sealed class Handle : IDisposable
        {
            Func<Vector3, bool> fn;
            public Handle(Func<Vector3, bool> fn) => this.fn = fn;

            public void Dispose()
            {
                if (fn != null) hazards.Remove(fn);
                fn = null;
            }
        }

        /// <summary>某点是否落在任何已登记的危险区里</summary>
        public static bool IsHazard(Vector3 feet)
        {
            for (int i = hazards.Count - 1; i >= 0; i--)
            {
                if (i >= hazards.Count) continue;
                try
                {
                    if (hazards[i](feet)) return true;
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            return false;
        }

        void Awake()
        {
            Instance = this;
            motor = GetComponent<PlayerMotor>();
            vitals = GetComponent<PlayerVitals>();
            origin = transform.position;
            minSafeY = origin.y;
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
            sinkLock?.Dispose();
        }

        /// <summary>手动设一个安全点（出生、存档点、关卡切换后）：清掉旧的记录</summary>
        public void ResetTo(Vector3 feet)
        {
            count = head = 0;
            origin = feet;
            minSafeY = feet.y;
        }

        /// <summary>实际的出界高度：killY，与「记录过的最低安全点以下 40 m」取更低者（关卡整体很低时不会误判）</summary>
        public float KillLine => Mathf.Min(killY, minSafeY - 40f);

        void Update()
        {
            if (!motor || !vitals) return;
            if (vitals.Dead)
            {
                EndSink();
                return;
            }
            if (sinking)
            {
                UpdateSink(Time.deltaTime);
                return;
            }
            var p = transform.position;
            if (!float.IsFinite(p.x + p.y + p.z) || p.y < KillLine || FallingIntoVoid(p))
            {
                Recover(HazardSpec.Fall);
                return;
            }
            if (Time.time >= nextRecord && motor.OnWalkableGround && !motor.Dashing && !motor.Lunging && IsSafeSpot(p))
            {
                nextRecord = Time.time + recordInterval;
                Record(p);
            }
        }

        bool FallingIntoVoid(Vector3 p)
        {
            if (motor.Velocity.y > -AbyssFallSpeed || Time.time < nextAbyssCheck) return false;
            nextAbyssCheck = Time.time + 0.1f;
            return !Physics.Raycast(p + Vector3.up * 0.5f, Vector3.down, AbyssProbe, Layers.WorldMask, QueryTriggerInteraction.Ignore);
        }

        /// <summary>脚下与四周都是静止的可走地面，且不在危险区</summary>
        bool IsSafeSpot(Vector3 feet)
        {
            if (IsHazard(feet)) return false;
            if (!GroundAt(feet, out var hit) || hit.rigidbody) return false;
            for (int i = 0; i < 4; i++)
            {
                float a = i * Mathf.PI * 0.5f;
                var o = feet + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * edgeProbe;
                if (!GroundAt(o, out var h) || h.rigidbody || IsHazard(h.point)) return false;
            }
            return true;
        }

        static bool GroundAt(Vector3 feet, out RaycastHit hit) =>
            Physics.Raycast(feet + Vector3.up * 0.6f, Vector3.down, out hit, 1.4f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && hit.normal.y >= 0.7f;

        void Record(Vector3 feet)
        {
            minSafeY = Mathf.Min(minSafeY, feet.y);
            if (count > 0)
            {
                int last = (head - 1 + RingSize) % RingSize;
                // 离上一个点很近：原地更新（最新的位置最贴近玩家）
                if ((ring[last] - feet).sqrMagnitude < spacing * spacing)
                {
                    ring[last] = feet;
                    return;
                }
            }
            ring[head] = feet;
            head = (head + 1) % RingSize;
            count = Mathf.Min(RingSize, count + 1);
        }

        /// <summary>从新到旧找第一个仍然安全的点；都不安全时退回进场位置</summary>
        Vector3 PickRecoveryPoint()
        {
            for (int k = 1; k <= count; k++)
            {
                var p = ring[(head - k + RingSize * 2) % RingSize];
                if (!IsHazard(p) && GroundAt(p, out _)) return p;
            }
            return origin;
        }

        // ───────────── 危险区 / 坠落 ─────────────

        /// <summary>
        /// 踩进危险区（熔岩）：瞬间扣血 + 闪屏，锁住身体 sinkTime 秒（期间按 tickTimes 跳伤），然后托回安全点并给 grace 秒无敌。
        /// 已经在下沉中时忽略。sinkTime ≤ 0 时立刻托回。返回是否开始处理
        /// </summary>
        public bool Sink(in HazardSpec spec)
        {
            if (sinking || !vitals || vitals.Dead) return false;
            Recoveries++;
            if (spec.flash.a > 0) GameUI.ScreenFlash(spec.flash, 0.6f);
            if (!string.IsNullOrEmpty(spec.sound)) GameAudio.Play(spec.sound, 0.95f, 0.7f);
            CameraShake.Add(0.45f, 0.3f);
            Scorch(spec.burst, spec.element);
            if (vitals.Dead) return true;
            if (!(spec.sinkTime > 0))
            {
                Lift(spec);
                return true;
            }
            sinking = true;
            sinkSpec = spec;
            sinkT = 0;
            sinkTicks = 0;
            // 下沉期间站着不动：锁身体、移速归零（视角照常）
            sinkLock = motor.AddModifier(MotorMods.From((ref MotorFrame f) =>
            {
                f.locks |= MotorLock.Body;
                f.speedMult = 0;
            }), 1000);
            // TODO(F3)：镜头下沉 0.42 m（Three.js LAVA.sinkDepth）交给 CameraFeel
            return true;
        }

        /// <summary>掉出世界：立刻托回安全点，按 <see cref="HazardSpec.Fall"/> 扣血</summary>
        public void Recover() => Recover(HazardSpec.Fall);

        /// <summary>立刻托回安全点（不下沉），先托回再按 spec.burst 扣血</summary>
        public void Recover(in HazardSpec spec)
        {
            if (sinking) EndSink();
            Recoveries++;
            Lift(spec);
            // 先托回再扣血：真被扣死也死在安全点上，而不是虚空里
            Scorch(spec.burst, spec.element);
            if (spec.flash.a > 0) GameUI.ScreenFlash(spec.flash, 0.45f);
        }

        void UpdateSink(float dt)
        {
            sinkT += dt;
            var times = sinkSpec.tickTimes ?? Array.Empty<float>();
            while (sinkTicks < times.Length && sinkT >= times[sinkTicks])
            {
                sinkTicks++;
                Scorch(sinkSpec.tick, sinkSpec.element);
                GameAudio.Play("burn_tick", 0.9f, 0.7f);
                if (vitals.Dead)
                {
                    EndSink();
                    return;
                }
            }
            if (sinkT >= sinkSpec.sinkTime)
            {
                var spec = sinkSpec;
                EndSink();
                Lift(spec);
            }
        }

        void EndSink()
        {
            sinking = false;
            sinkLock?.Dispose();
            sinkLock = null;
        }

        /// <summary>托回最近的安全点，并给短暂无敌</summary>
        void Lift(in HazardSpec spec)
        {
            var to = PickRecoveryPoint();
            motor.Teleport(to + Vector3.up * 0.05f);
            motor.GrantInvulnerability(spec.grace);
            GameAudio.Play("dash", 0.5f, 0.8f);
            try
            {
                Recovered?.Invoke(to);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>按最大生命比例扣血：无视冲刺 / 托回的短无敌，调试无敌照样生效</summary>
        void Scorch(float fraction, Element element)
        {
            if (!(fraction > 0) || !vitals || vitals.Dead) return;
            float now = Time.time;
            if (vitals.invulnerableUntil - now > DebugInvuln) return;
            float savedMotor = motor.InvulnerableTime, savedUntil = vitals.invulnerableUntil;
            motor.ClearInvulnerability();
            vitals.invulnerableUntil = -1;
            try
            {
                Combat.DamagePlayer(vitals.MaxHealth * fraction, transform.position, element);
            }
            finally
            {
                motor.GrantInvulnerability(savedMotor);
                vitals.invulnerableUntil = Mathf.Max(vitals.invulnerableUntil, savedUntil);
            }
        }
    }
}
