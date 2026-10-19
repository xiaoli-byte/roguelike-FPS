namespace Spiritfire.Game
{
    /// <summary>
    /// 「弹匣容量」（TS mag）：数值类词条，权重 9，区间 0.2–0.4（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：枪械（碎刃除外）。生效：弹匣 = round(定义 × 玩家弹匣% × (1 + 值))。
    /// </summary>
    [Defs(20)]
    public sealed class Affix_Mag : AffixDef
    {
        public Affix_Mag() : base(AffixIds.Mag, 0.2f, 0.4f, 9) { }

        public override string Text(WeaponDef weapon, float v) => $"弹匣容量 +{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => AffixRules.GunOnly(c.def);
    }
}
