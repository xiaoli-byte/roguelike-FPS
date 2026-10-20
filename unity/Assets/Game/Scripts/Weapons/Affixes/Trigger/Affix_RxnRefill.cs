namespace Spiritfire.Game
{
    /// <summary>
    /// 「回元」（TS rxnRefill）：触发类词条，权重 4，区间 0.08–0.15（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：这把枪自己能引发反应。
    /// 生效：本武器引发的元素反应执行时回填 max(1, round(弹匣容量 × 值)) 发，同一把枪 0.3 s 内最多一次。
    /// </summary>
    [Defs(230)]
    public sealed class Affix_RxnRefill : TriggerAffixDef
    {
        public const string Id = "rxnRefill";

        public Affix_RxnRefill() : base(Id, 0.08f, 0.15f, 4) { }

        public override string Text(WeaponDef weapon, float v) => $"本武器引发元素反应时回填 {AffixText.Pct(v)} 弹匣";

        public override bool Allow(in AffixContext c) => AffixRules.CanReact(c);

        public override IAffixEffect Effect => effect;

        static readonly RxnRefillEffect effect = new();

        sealed class RxnRefillEffect : AffixEffect
        {
            public override void OnReaction(in AffixHook h, in ReactionEvent e)
            {
                if (!(h.value > 0) || h.effects == null) return;
                var rt = h.Runtime;
                if (h.now - rt.lastRefill <= AffixEffects.RxnProcGap) return;
                rt.lastRefill = h.now;
                h.effects.Env.Refill(h.weapon, Affix_KillRefill.Rounds(h.stats.magCap, h.value));
            }
        }
    }
}
