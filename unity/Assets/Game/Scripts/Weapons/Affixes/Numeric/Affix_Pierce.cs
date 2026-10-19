namespace Spiritfire.Game
{
    /// <summary>
    /// 「穿透」（TS pierce）：数值类词条，权重 4，数值固定 1（不随稀有度放大）。
    /// 准入：命中扫描枪或弩（碎刃除外）。生效：穿透 + round(值)。
    /// </summary>
    [Defs(130)]
    public sealed class Affix_Pierce : AffixDef
    {
        public Affix_Pierce() : base(AffixIds.Pierce, 1f, 1f, 4, isFixed: true) { }

        public override string Text(WeaponDef weapon, float v) => $"穿透 +{WeaponStatsResolver.RoundHalfUp(v)}";

        public override bool Allow(in AffixContext c) => AffixRules.DirectHit(c.def) && AffixRules.GunOnly(c.def);
    }
}
