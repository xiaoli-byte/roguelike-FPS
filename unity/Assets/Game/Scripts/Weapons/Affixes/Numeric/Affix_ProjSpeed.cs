namespace Spiritfire.Game
{
    /// <summary>
    /// 「弹速」（TS projSpeed）：数值类词条，权重 5，区间 0.2–0.4（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：投射物武器。生效：弹速 × 玩家弹速% × (1 + 值)。
    /// </summary>
    [Defs(150)]
    public sealed class Affix_ProjSpeed : AffixDef
    {
        public Affix_ProjSpeed() : base(AffixIds.ProjSpeed, 0.2f, 0.4f, 5) { }

        public override string Text(WeaponDef weapon, float v) => $"弹速 +{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => c.def.projectile != null;
    }
}
