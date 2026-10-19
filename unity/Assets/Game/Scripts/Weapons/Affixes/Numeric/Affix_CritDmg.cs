namespace Spiritfire.Game
{
    /// <summary>
    /// 「暴击伤害」（TS critDmg）：数值类词条，权重 8，区间 0.15–0.35（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：任何武器。生效：暴击倍率 × (1 + 值)。
    /// </summary>
    [Defs(40)]
    public sealed class Affix_CritDmg : AffixDef
    {
        public Affix_CritDmg() : base(AffixIds.CritDmg, 0.15f, 0.35f, 8) { }

        public override string Text(WeaponDef weapon, float v) => $"暴击伤害 +{AffixText.Pct(v)}";
    }
}
