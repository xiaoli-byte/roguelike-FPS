namespace Spiritfire.Game
{
    /// <summary>
    /// 「换弹速度」（TS reload）：数值类词条，权重 9，区间 0.15–0.3（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：枪械（碎刃除外）。生效：换弹时间 ÷ max(0.25, 1 + 玩家换弹速度 + 值)。
    /// </summary>
    [Defs(30)]
    public sealed class Affix_Reload : AffixDef
    {
        public Affix_Reload() : base(AffixIds.Reload, 0.15f, 0.3f, 9) { }

        public override string Text(WeaponDef weapon, float v) => $"换弹速度 +{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => AffixRules.GunOnly(c.def);
    }
}
