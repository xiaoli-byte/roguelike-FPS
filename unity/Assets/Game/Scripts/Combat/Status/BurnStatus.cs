using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 灼烧（Three.js 版 src/combat/Status.ts burn）：火属性命中附着。
    ///   每层独立计时 4 s，最多 3 层（满层替换剩余最短的一层）；每 0.5 s 跳 Σ存活层强度 × 0.16（一层烧满 8 跳 = 强度 × 1.28）。
    ///   新附着只新增一层、不会把已有的层续满，所以每次附着的总伤害固定。跳伤吃元素 / 精英 / 首领加成（强度附着时已除掉，见 DamageCalc）。
    /// </summary>
    [Defs]
    public sealed class BurnStatus : IStatusEffect
    {
        public const float Duration = 4f, TickInterval = 0.5f, Ratio = 0.16f;
        public const int MaxStacks = 3;
        internal static readonly Color GlowColor = new(1f, 0.45f, 0.12f, 0.45f);

        public string Id => "burn";
        public StatusId Status => StatusId.Burn;
        public string Name => "灼烧";
        public Color Color => DamageTable.ElementColor(Element.Fire);
        public StatusHosts Hosts => StatusHosts.Enemy;
        public Element Element => Element.Fire;
        public StatusInstance Create(IStatusHost host) => new BurnInstance(host as EnemyStatus);
    }

    /// <summary>挂在敌人身上的灼烧：各层强度与剩余时间、共享的跳伤计时</summary>
    public sealed class BurnInstance : EnemyStatusInstance
    {
        struct Layer
        {
            public float power, remaining;
        }

        const float Interval = BurnStatus.TickInterval;
        readonly List<Layer> layers = new();
        float tickTimer;
        Transform glow;

        public BurnInstance(EnemyStatus host) : base(host) { }

        public override StatusId Id => StatusId.Burn;
        public override bool Active => layers.Count > 0;
        public int Stacks => layers.Count;

        public override bool Apply(in StatusApply a)
        {
            float dur = a.duration > 0 ? a.duration : BurnStatus.Duration;
            float p = Cap(a.power);
            if (layers.Count == 0) tickTimer = Interval;
            if (layers.Count < BurnStatus.MaxStacks) layers.Add(new Layer { power = p, remaining = dur });
            else
            {
                // 满层：替换剩余时间最短（最旧）的一层。每层都有自己的到期时间，持续命中也不会让灼烧永不衰减
                int oldest = 0;
                for (int i = 1; i < layers.Count; i++)
                    if (layers[i].remaining < layers[oldest].remaining) oldest = i;
                layers[oldest] = new Layer { power = p, remaining = dur };
            }
            Glow(ref glow, BurnStatus.GlowColor, Vector3.zero);
            Notify(layers.Count);
            return true;
        }

        /// <summary>
        /// 跳伤计时与各层剩余时间同步递减：每层 4 s 正好吃到 8 跳（最后一跳与到期同帧，用容差防浮点误差丢跳）。
        /// 一跳只计入「这一跳发生时」仍存活的层——同一帧里先到期、后跳伤的层不算。
        /// </summary>
        public override void Tick(float dt)
        {
            for (int i = 0; i < layers.Count; i++)
            {
                var l = layers[i];
                l.remaining -= dt;
                layers[i] = l;
            }
            tickTimer -= dt;
            if (tickTimer <= StatusTiming.TickEps)
            {
                // tickTimer ≤ 0：这一跳发生在 −tickTimer 秒之前；层的到期时刻同理为 remaining
                float at = tickTimer;
                tickTimer = Mathf.Max(tickTimer + Interval, StatusTiming.TickEps * 2);
                float total = 0;
                foreach (var l in layers)
                    if (l.remaining >= at - StatusTiming.TickEps) total += l.power;
                Dot(total * BurnStatus.Ratio, Element.Fire);
                var hp = Hp;
                if (hp && hp.Dead) return;
            }
            // 跳伤期间的监听者可能消耗 / 重挂了灼烧：只按当前列表剔除到期的层
            for (int i = layers.Count - 1; i >= 0; i--)
                if (layers[i].remaining <= StatusTiming.TickEps) layers.RemoveAt(i);
        }

        /// <summary>剩余跳伤（不含属性倍率）：各层强度 × 0.16 × 该层按共享计时对齐的剩余跳数</summary>
        public override float RemainingDotRaw
        {
            get
            {
                float t = Mathf.Max(0, tickTimer), total = 0;
                foreach (var l in layers) total += l.power * StatusTiming.TicksLeft(l.remaining, t, Interval);
                return total * BurnStatus.Ratio;
            }
        }

        /// <summary>归墟消耗灼烧：返回剩余伤害的结清值（<see cref="RemainingDotRaw"/>）并清空</summary>
        public float Consume()
        {
            float cash = RemainingDotRaw;
            layers.Clear();
            return cash;
        }

        public override bool TryGet(out StatusView view)
        {
            view = new StatusView { id = StatusId.Burn };
            if (layers.Count == 0) return false;
            view.stacks = layers.Count;
            foreach (var l in layers)
            {
                view.power += l.power;
                view.remaining = Mathf.Max(view.remaining, l.remaining);
            }
            return true;
        }

        public override void Clear() => layers.Clear();

        public override void UpdateVisual(float pulse)
        {
            if (!glow) return;
            glow.gameObject.SetActive(layers.Count > 0);
            glow.localScale = Vector3.one * (1.6f + 0.3f * layers.Count + pulse);
        }
    }
}
