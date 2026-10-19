namespace Spiritfire.Game
{
    /// <summary>
    /// 「射速」（TS rate）：数值类词条，权重 10，区间 0.08–0.15（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：任何武器。生效：射速 × (1 + 值)（点射间隔、机炮预热、蓄力时长一起变快）。
    /// </summary>
    [Defs(10)]
    public sealed class Affix_Rate : AffixDef
    {
        public Affix_Rate() : base(AffixIds.Rate, 0.08f, 0.15f, 10) { }

        public override string Text(WeaponDef weapon, float v) => $"射速 +{AffixText.Pct(v)}";
    }
}
