namespace Spiritfire.Game
{
    /// <summary>
    /// 「伤害」（TS dmg）：数值类词条，权重 12，区间 0.08–0.15（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：任何武器。生效：伤害倍率 × (1 + 值)。
    /// </summary>
    [Defs(0)]
    public sealed class Affix_Dmg : AffixDef
    {
        public Affix_Dmg() : base(AffixIds.Dmg, 0.08f, 0.15f, 12) { }

        public override string Text(WeaponDef weapon, float v) => $"伤害 +{AffixText.Pct(v)}";
    }
}
