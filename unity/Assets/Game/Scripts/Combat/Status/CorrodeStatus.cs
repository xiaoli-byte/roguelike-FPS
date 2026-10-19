using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蚀化（Three.js 版 src/combat/Status.ts corrode）：蚀属性命中附着。
    ///   持续 5 s（再附着刷新时长、强度取较大），每 0.5 s 跳 强度 × 0.08（5 s 正好 10 跳）；期间承伤 ×1.2、移速 ×0.8。
    ///   设计上永不被反应消耗。
    /// </summary>
    [Defs]
    public sealed class CorrodeStatus : IStatusEffect
    {
        public const float Duration = 5f, TickInterval = 0.5f, Ratio = 0.08f, Taken = 1.2f, SpeedFactor = 0.8f;
        internal static readonly Color GlowColor = new(0.55f, 0.95f, 0.3f, 0.45f);

        public string Id => "corrode";
        public StatusId Status => StatusId.Corrode;
        public string Name => "蚀化";
        public Color Color => DamageTable.ElementColor(Element.Corrode);
        public StatusHosts Hosts => StatusHosts.Enemy;
        public Element Element => Element.Corrode;
        public StatusInstance Create(IStatusHost host) => new CorrodeInstance(host as EnemyStatus);
    }

    /// <summary>挂在敌人身上的蚀化</summary>
    public sealed class CorrodeInstance : EnemyStatusInstance
    {
        const float Interval = CorrodeStatus.TickInterval;
        float remaining, power, tickTimer;
        Transform glow;

        public CorrodeInstance(EnemyStatus host) : base(host) { }

        public override StatusId Id => StatusId.Corrode;
        public override bool Active => remaining > 0;
        public override float TakenMult => remaining > 0 ? CorrodeStatus.Taken : 1f;
        public override float SpeedMult => remaining > 0 ? CorrodeStatus.SpeedFactor : 1f;

        public override bool Apply(in StatusApply a)
        {
            if (remaining <= 0)
            {
                tickTimer = Interval;
                power = 0;
            }
            remaining = Mathf.Max(remaining, a.duration > 0 ? a.duration : CorrodeStatus.Duration);
            power = Mathf.Max(power, Cap(a.power));
            Glow(ref glow, CorrodeStatus.GlowColor, Vector3.down * 0.25f);
            Notify(1);
            return true;
        }

        public override void Tick(float dt)
        {
            remaining -= dt;
            tickTimer -= dt;
            if (tickTimer <= StatusTiming.TickEps)
            {
                tickTimer = Mathf.Max(tickTimer + Interval, StatusTiming.TickEps * 2);
                Dot(power * CorrodeStatus.Ratio, Element.Corrode);
                var hp = Hp;
                if (hp && hp.Dead) return;
            }
            if (remaining <= StatusTiming.TickEps) Clear();
        }

        /// <summary>剩余跳伤（不含属性倍率）：强度 × 0.08 × 按跳伤计时对齐的剩余跳数</summary>
        public override float RemainingDotRaw =>
            remaining > 0 ? power * CorrodeStatus.Ratio * StatusTiming.TicksLeft(remaining, Mathf.Max(0, tickTimer), Interval) : 0;

        public override bool TryGet(out StatusView view)
        {
            view = new StatusView { id = StatusId.Corrode };
            if (remaining <= 0) return false;
            view.stacks = 1;
            view.remaining = remaining;
            view.power = power;
            return true;
        }

        public override void Clear()
        {
            remaining = 0;
            power = 0;
        }

        public override void UpdateVisual(float pulse)
        {
            if (glow) glow.gameObject.SetActive(remaining > 0);
        }
    }
}
