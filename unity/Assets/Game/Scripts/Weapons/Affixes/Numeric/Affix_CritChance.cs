namespace Spiritfire.Game
{
    /// <summary>
    /// 「暴击率」（TS critChance）：数值类词条，权重 7，区间 0.04–0.08（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：任何武器。生效：武器每次命中另掷一次（与玩家暴击率独立），掷中 forceCrit。
    /// </summary>
    [Defs(50)]
    public sealed class Affix_CritChance : AffixDef
    {
        public Affix_CritChance() : base(AffixIds.CritChance, 0.04f, 0.08f, 7) { }

        public override string Text(WeaponDef weapon, float v) => $"暴击率 +{AffixText.Pct(v)}";
    }
}
