namespace Spiritfire.Game
{
    /// <summary>
    /// 「备弹上限」（TS reserve）：数值类词条，权重 6，区间 0.25–0.5（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：枪械（碎刃除外）。生效：备弹 = round(定义 × 玩家备弹% × (1 + 值))。
    /// </summary>
    [Defs(160)]
    public sealed class Affix_Reserve : AffixDef
    {
        public Affix_Reserve() : base(AffixIds.Reserve, 0.25f, 0.5f, 6) { }

        public override string Text(WeaponDef weapon, float v) => $"备弹上限 +{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => AffixRules.GunOnly(c.def);
    }
}
