namespace Spiritfire.Game
{
    /// <summary>
    /// 「化盾」（TS rxnShield）：触发类词条，权重 4，区间 4–8 点（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45），取整。
    /// 准入：这把枪自己能引发反应。
    /// 生效：本武器引发的元素反应执行时获得值点护盾（不超过上限），同一把枪 0.3 s 内最多一次。
    /// </summary>
    [Defs(260)]
    public sealed class Affix_RxnShield : TriggerAffixDef
    {
        public const string Id = "rxnShield";

        public Affix_RxnShield() : base(Id, 4f, 8f, 4) { }

        public override string Text(WeaponDef weapon, float v) => $"本武器引发元素反应时获得 {WeaponStatsResolver.RoundHalfUp(v)} 点护盾";

        public override bool Allow(in AffixContext c) => AffixRules.CanReact(c);

        /// <summary>取整（同 TS roundValue 的 rxnShield 分支）</summary>
        public override float Round(float v) => WeaponStatsResolver.RoundHalfUp(v);

        public override IAffixEffect Effect => effect;

        static readonly RxnShieldEffect effect = new();

        sealed class RxnShieldEffect : AffixEffect
        {
            public override void OnReaction(in AffixHook h, in ReactionEvent e)
            {
                if (!(h.value > 0) || h.effects == null) return;
                var rt = h.Runtime;
                if (h.now - rt.lastShield <= AffixEffects.RxnProcGap) return;
                rt.lastShield = h.now;
                h.effects.Env.AddShield(h.value);
            }
        }
    }
}
