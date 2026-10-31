using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 带电（第四章「雪域天路」，docs/level-design/chuanzang-combat-v1.md 1.2；docs/unity-ch4-port.md 第 2 节契约）。
    ///   · 状态：带电有持续秒数（<see cref="Apply"/> 可叠时长，取剩余与新给的较大者），也可以常驻（<see cref="Hold"/>：夔一直带电、举父举着雷石、连鼓灵的雷心）。
    ///   · 反应：就元素反应而言，带电 = 身上有雷殛（<see cref="GameReactionEnv.Has"/> 读 <see cref="IsCharged"/>）——燎的火一碰就是焚雷，蚀化一碰就是封脉。
    ///     带电本身不挂雷殛状态，不吃雷殛的 3 层眩晕、弹射。
    ///   · 电会传：带电的怪被打死时，把电放给 <see cref="ArcRadius"/> 内最近的 <see cref="ArcTargets"/> 个同伴（它们带电 <see cref="DefaultSeconds"/> 秒、挨 <see cref="ArcDamage"/>），
    ///     连锁有上限：每次传电跳数 +1，到 <see cref="MaxHops"/> 就不再往下传（<see cref="Arc"/>）。首领不接电、首领倒下也不放电（有自己的死亡演出）。
    ///   · 视觉：边缘光的噼啪（<see cref="ChargeState"/>），不把整只染色。
    /// 所有入口对 null / 已死 / 不可选中的目标都是空操作。
    /// </summary>
    public static class Charge
    {
        /// <summary>传电给同伴时的带电秒数（combat 1.2「它们也带电 6 秒」）</summary>
        public const float DefaultSeconds = 6f;
        /// <summary>传电半径（米）与每次传电打的伤害</summary>
        public const float ArcRadius = 8f, ArcDamage = 6f;
        /// <summary>每次传给几个同伴</summary>
        public const int ArcTargets = 2;
        /// <summary>连锁跳数上限：第 0 跳是被直接打爆的那只放出去的电</summary>
        public const int MaxHops = 4;

        /// <summary>开始带电（从不带电变成带电的那一刻；续时长不再发）</summary>
        public static event Action<Damageable> Charged;
        /// <summary>电从 from 传到了 to（from 可能已死）</summary>
        public static event Action<Damageable, Damageable> Arced;

        static readonly List<Damageable> near = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Charged = null;
            Arced = null;
            near.Clear();
        }

        /// <summary>
        /// 让目标带电 seconds 秒（已经带电时取剩余与 seconds 的较大者，不累加）。source = 谁让它带的电（落雷、电网、传电的同伴…，只做记录）。
        /// 返回是否带上了（目标无效 / 已死 / 不可选中 / 秒数 ≤ 0 时 false）
        /// </summary>
        public static bool Apply(Damageable target, float seconds, UnityEngine.Object source = null) => Apply(target, seconds, source, 0);

        /// <summary>同 <see cref="Apply(Damageable, float, UnityEngine.Object)"/>，并记下这份电是第几跳传来的（<see cref="Arc"/> 用）</summary>
        internal static bool Apply(Damageable target, float seconds, UnityEngine.Object source, int hop)
        {
            if (!Valid(target) || !(seconds > 0) || !float.IsFinite(seconds)) return false;
            var s = ChargeState.Ensure(target);
            bool was = s.Active;
            s.Add(seconds, source, hop);
            if (!was) Raise(target);
            return true;
        }

        /// <summary>此刻带电（计时中或被常驻持有）</summary>
        public static bool IsCharged(Damageable target)
        {
            if (!target || target.Dead) return false;
            var s = target.GetComponent<ChargeState>();
            return s && s.Active;
        }

        /// <summary>剩余秒数（常驻为 +∞，不带电为 0）</summary>
        public static float Remaining(Damageable target)
        {
            if (!target || target.Dead) return 0;
            var s = target.GetComponent<ChargeState>();
            return s ? s.Remaining : 0;
        }

        /// <summary>
        /// 常驻带电（不计时）：返回句柄，Dispose 时撤掉这一份；多个来源可以同时持有，全部撤掉才停。
        /// 例：夔开打时 Hold、倒下时 Dispose；举父举起雷石时 Hold、扔出去 / 被打碎时 Dispose。目标无效时返回空句柄
        /// </summary>
        public static IDisposable Hold(Damageable target, UnityEngine.Object source = null)
        {
            if (!Valid(target)) return Handle.Empty;
            var s = ChargeState.Ensure(target);
            bool was = s.Active;
            var h = s.Hold(source);
            if (!was) Raise(target);
            return h;
        }

        /// <summary>立刻清掉计时的电（常驻的持有不动）</summary>
        public static void Clear(Damageable target)
        {
            var s = target ? target.GetComponent<ChargeState>() : null;
            if (s) s.ClearTimed();
        }

        /// <summary>
        /// 传电：从 from 向 radius 米内最近的 <see cref="ArcTargets"/> 个活着的同伴（非首领、可选中）放电——它们带电 <see cref="DefaultSeconds"/> 秒、
        /// 挨 <see cref="ArcDamage"/> 雷伤（深度 1，不再附着、不弹射），画一道紫红电弧。from 可以已死（死亡时自动调用）。
        /// 连锁：from 的电是第 h 跳传来的，这次传出去的是第 h + 1 跳；h + 1 &gt; maxHops 时不传。返回传到了几个
        /// </summary>
        public static int Arc(Damageable from, float radius = ArcRadius, int maxHops = MaxHops)
        {
            if (ReferenceEquals(from, null) || !from || !(radius > 0)) return 0;
            var st = from.GetComponent<ChargeState>();
            int hop = (st ? st.Hop : 0) + 1;
            if (hop > maxHops) return 0;
            var c = ReactionSystem.CenterOf(from);
            near.Clear();
            ReactionSystem.Nearest(c, radius, ArcTargets + 2, from, false, near);
            int n = 0;
            for (int i = 0; i < near.Count && n < ArcTargets; i++)
            {
                var t = near[i];
                if (!Valid(t) || t.IsBoss) continue;
                n++;
                var to = ReactionSystem.CenterOf(t);
                ChargeState.ArcFx(c, to);
                Apply(t, DefaultSeconds, from, hop);
                var dir = to - c;
                var info = DamageInfo.Simple(ArcDamage, DamageSource.Status, to, dir.sqrMagnitude > 1e-6f ? dir.normalized : Vector3.up);
                info.element = Element.Shock;
                info.depth = 1;
                info.tags = DamageTag.Chain;
                info.noCrit = true;
                Combat.DamageEnemy(t, info);
                if (n == 1) StatusAudio.Zap(c);
                if (Arced != null)
                    try
                    {
                        Arced(from, t);
                    }
                    catch (Exception e)
                    {
                        Debug.LogException(e);
                    }
            }
            near.Clear();
            return n;
        }

        static bool Valid(Damageable d) => d && !d.Dead && !d.untargetable;

        static void Raise(Damageable d)
        {
            if (Charged == null) return;
            try
            {
                Charged(d);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>常驻持有的句柄</summary>
        internal sealed class Handle : IDisposable
        {
            public static readonly Handle Empty = new(null);
            ChargeState owner;

            public Handle(ChargeState owner) => this.owner = owner;

            public void Dispose()
            {
                var o = owner;
                owner = null;
                if (o) o.Release(this);
            }
        }
    }

    /// <summary>
    /// 挂在带电单位上的状态（<see cref="Charge"/> 自动挂）：计时、常驻持有、第几跳传来的；死亡时放电（<see cref="Charge.Arc"/>）。
    /// 第一次带电时补一个 <see cref="EnemyStatus"/>（反应判定要求单位身上有状态宿主，见 <see cref="ReactionSystem.TryReact"/>）。
    /// 外观（C4-5「带电改用边缘光」）：不染整只，只把材质的轮廓光（SF_StylizedLit 的 _RimColor / _RimStrength，MaterialPropertyBlock）换成紫红雷光，
    /// 强度按「噼啪」节奏闪——底亮 + 不规则的短脉冲（每 0.08–0.3 s 一下）；脉冲时沿骨骼链贴身跳一道短电弧（<see cref="Lightning.Chain"/>，全场每秒限量）。
    /// 不带电时把轮廓光写回材质自己的值。首领也走同一套（夔一直带电）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ChargeState : MonoBehaviour
    {
        /// <summary>紫红雷光（邪火紫红，C4-4）：电弧线色</summary>
        public static readonly Color ArcColor = new(1f, 0.35f, 0.9f);
        /// <summary>轮廓光（线性 HDR）：底亮、脉冲峰</summary>
        public static readonly Color RimBase = new(1.6f, 0.32f, 1.55f), RimPeak = new(3.4f, 1.1f, 3.6f);
        public const float RimStrengthBase = 0.9f, RimStrengthPeak = 1.9f;
        /// <summary>贴身电弧全场每秒最多几道</summary>
        public const float ArcsPerSecond = 14f;

        static readonly int RimColorId = Shader.PropertyToID("_RimColor"), RimStrengthId = Shader.PropertyToID("_RimStrength");
        static float arcTokens;
        static int arcFrame = -1;
        static readonly Vector3[] chain = new Vector3[4];

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            arcTokens = 0;
            arcFrame = -1;
        }

        Damageable hp;
        float left;
        int hop;
        UnityEngine.Object lastSource;
        readonly List<Charge.Handle> holds = new();

        // 外观
        Renderer[] rends;
        Color[] baseRim;
        float[] baseRimStrength;
        Transform[] bones;
        MaterialPropertyBlock block;
        bool rimOn;
        // 相位种子：第一次画的时候取（字段初始化里不能调 Random，MonoBehaviour 构造时会报错）
        float pulse, nextPulse, seed = -1f;

        /// <summary>带电中（计时 &gt; 0 或有常驻持有）</summary>
        public bool Active => Hp && !Hp.Dead && (left > 0 || holds.Count > 0);

        /// <summary>宿主（第一次用时取，不靠 Awake：EditMode、生成时物体还停用着也成立）</summary>
        Damageable Hp
        {
            get
            {
                if (!hp) Bind();
                return hp;
            }
        }

        bool bound;

        /// <summary>取宿主并订阅它的死亡（只订一次）</summary>
        void Bind()
        {
            if (bound) return;
            hp = GetComponent<Damageable>();
            if (!hp) return;
            bound = true;
            hp.Died += OnDied;
        }
        /// <summary>剩余秒数（常驻 +∞）</summary>
        public float Remaining => !Active ? 0 : holds.Count > 0 ? float.PositiveInfinity : left;
        /// <summary>这份电是第几跳传来的（自己带的 / 落雷带的为 0）</summary>
        public int Hop => hop;
        /// <summary>最近一次让它带电的来源</summary>
        public UnityEngine.Object Source => lastSource;
        /// <summary>轮廓光正亮着（测试用）</summary>
        public bool RimShowing => rimOn;

        internal static ChargeState Ensure(Damageable d)
        {
            var s = d.GetComponent<ChargeState>();
            if (!s) s = d.gameObject.AddComponent<ChargeState>();
            s.Bind();
            if (!d.GetComponent<EnemyStatus>()) d.gameObject.AddComponent<EnemyStatus>();
            return s;
        }

        void Awake() => Bind();

        void OnDestroy()
        {
            if (hp) hp.Died -= OnDied;
        }

        void OnDisable() => RimOff();

        internal void Add(float seconds, UnityEngine.Object source, int fromHop)
        {
            // 新的电（不是传来的）把跳数归零；传来的电取较小的跳数（离源头更近的那份算数）
            hop = !Active ? fromHop : Mathf.Min(hop, fromHop);
            left = Mathf.Max(left, seconds);
            lastSource = source;
            enabled = true;
        }

        internal IDisposable Hold(UnityEngine.Object source)
        {
            if (!Active) hop = 0;
            var h = new Charge.Handle(this);
            holds.Add(h);
            lastSource = source;
            enabled = true;
            return h;
        }

        internal void Release(Charge.Handle h) => holds.Remove(h);

        internal void ClearTimed() => left = 0;

        void OnDied(DamageInfo info)
        {
            bool was = left > 0 || holds.Count > 0;
            left = 0;
            holds.Clear();
            RimOff();
            if (was && Hp && !Hp.IsBoss) Charge.Arc(Hp);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (left > 0) left = Mathf.Max(0, left - dt);
            if (!Active)
            {
                RimOff();
                if (holds.Count == 0 && left <= 0) enabled = false;
                return;
            }
            Crackle(dt);
        }

        // ───────────── 外观：轮廓光的噼啪 + 贴身短电弧 ─────────────

        void Collect()
        {
            if (rends != null) return;
            var list = new List<Renderer>();
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (r is not SkinnedMeshRenderer && r is not MeshRenderer) continue;
                var m = r.sharedMaterial;
                if (m && m.HasProperty(RimColorId) && m.HasProperty(RimStrengthId)) list.Add(r);
            }
            rends = list.ToArray();
            baseRim = new Color[rends.Length];
            baseRimStrength = new float[rends.Length];
            for (int i = 0; i < rends.Length; i++)
            {
                var m = rends[i].sharedMaterial;
                baseRim[i] = m.GetColor(RimColorId);
                baseRimStrength[i] = m.GetFloat(RimStrengthId);
            }
            var set = new HashSet<Transform>();
            foreach (var smr in GetComponentsInChildren<SkinnedMeshRenderer>())
                foreach (var b in smr.bones)
                    if (b && b != smr.rootBone)
                        set.Add(b);
            bones = new Transform[set.Count];
            set.CopyTo(bones);
            block ??= new MaterialPropertyBlock();
        }

        void Crackle(float dt)
        {
            Collect();
            // 噼啪：不规则的短脉冲（亮一下 0.05–0.09 s 衰减），之间是底亮的轻微抖动
            nextPulse -= dt;
            if (nextPulse <= 0)
            {
                nextPulse = UnityEngine.Random.Range(0.08f, 0.3f);
                pulse = 1f;
                if (TakeArc()) BodyArc();
            }
            pulse = Mathf.Max(0, pulse - dt * 14f);
            if (seed < 0) seed = UnityEngine.Random.value * 10f;
            float jitter = 0.85f + 0.15f * Mathf.Sin(Time.time * 47f + seed);
            var c = Color.Lerp(RimBase * jitter, RimPeak, pulse);
            float st = Mathf.Lerp(RimStrengthBase * jitter, RimStrengthPeak, pulse);
            for (int i = 0; i < rends.Length; i++)
            {
                var r = rends[i];
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetColor(RimColorId, c);
                block.SetFloat(RimStrengthId, st);
                r.SetPropertyBlock(block);
            }
            rimOn = true;
        }

        void RimOff()
        {
            if (!rimOn || rends == null) return;
            rimOn = false;
            for (int i = 0; i < rends.Length; i++)
            {
                var r = rends[i];
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetColor(RimColorId, baseRim[i]);
                block.SetFloat(RimStrengthId, baseRimStrength[i]);
                r.SetPropertyBlock(block);
            }
        }

        /// <summary>全场贴身电弧的令牌（每秒 <see cref="ArcsPerSecond"/> × 画质密度）</summary>
        static bool TakeArc()
        {
            if (arcFrame != Time.frameCount)
            {
                arcFrame = Time.frameCount;
                arcTokens = Mathf.Min(3f, arcTokens + Time.deltaTime * ArcsPerSecond * Fx.Density);
            }
            if (arcTokens < 1f) return false;
            arcTokens -= 1f;
            return true;
        }

        /// <summary>沿一根骨头往上 2–3 节父骨跳一道短电弧</summary>
        void BodyArc()
        {
            if (bones == null || bones.Length == 0) return;
            var b = bones[UnityEngine.Random.Range(0, bones.Length)];
            int n = 0;
            for (var t = b; t && n < chain.Length; t = t.parent)
            {
                chain[n++] = t.position;
                if (t == transform) break;
            }
            if (n < 2) return;
            Lightning.Chain(chain, Mathf.Min(n, 3), ArcColor, 0.035f);
        }

        /// <summary>传电的电弧（紫红，两点闪电）</summary>
        internal static void ArcFx(Vector3 from, Vector3 to) => Lightning.Spawn(from, to, ArcColor, 0.05f);
    }
}
