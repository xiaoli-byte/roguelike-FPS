namespace Spiritfire.Game
{
    /// <summary>
    /// 「疾化」（TS rxnHaste）：触发类词条，权重 4，区间 0.12–0.22（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：这把枪自己能引发反应。
    /// 生效：本武器引发的元素反应执行后 3 s 内，这把枪射速 × (1 + 值)（点射间隔、预热、蓄力随之加快；再次引发刷新时长）。
    /// </summary>
    [Defs(240)]
    public sealed class Affix_RxnHaste : TriggerAffixDef
    {
        public const string Id = "rxnHaste";

        public Affix_RxnHaste() : base(Id, 0.12f, 0.22f, 4) { }

        public override string Text(WeaponDef weapon, float v) => $"本武器引发元素反应后 3 秒内射速 +{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => AffixRules.CanReact(c);

        public override IAffixEffect Effect => effect;

        static readonly RxnHasteEffect effect = new();

        sealed class RxnHasteEffect : AffixEffect
        {
            public override void OnReaction(in AffixHook h, in ReactionEvent e)
            {
                if (h.value > 0) h.Runtime.rxnHasteUntil = h.now + AffixEffects.RxnHasteTime;
            }

            public override float FireRate(in AffixHook h) => h.value > 0 && h.now < h.Runtime.rxnHasteUntil ? 1 + h.value : 1;
        }
    }
}
