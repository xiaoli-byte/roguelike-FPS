namespace Spiritfire.Game
{
    /// <summary>
    /// 「散布」（TS spread）：数值类词条，权重 6，区间 0.2–0.35（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：命中扫描枪（不含光束、投射物、碎刃）。生效：散布 × max(0.1, (1 + 玩家散布%) × (1 − 值))。
    /// </summary>
    [Defs(70)]
    public sealed class Affix_Spread : AffixDef
    {
        public Affix_Spread() : base(AffixIds.Spread, 0.2f, 0.35f, 6) { }

        public override string Text(WeaponDef weapon, float v) => $"散布 −{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => c.def.IsHitscan && AffixRules.GunOnly(c.def);
    }
}
