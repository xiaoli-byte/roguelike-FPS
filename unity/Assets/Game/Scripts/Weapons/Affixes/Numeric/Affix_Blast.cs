namespace Spiritfire.Game
{
    /// <summary>
    /// 「爆炸范围」（TS blast）：数值类词条，权重 7，区间 0.15–0.3（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：爆炸投射物武器。生效：爆炸半径 × 玩家爆炸范围% × (1 + 值)。
    /// </summary>
    [Defs(140)]
    public sealed class Affix_Blast : AffixDef
    {
        public Affix_Blast() : base(AffixIds.Blast, 0.15f, 0.3f, 7) { }

        public override string Text(WeaponDef weapon, float v) => $"爆炸范围 +{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => c.def.IsExplosive;
    }
}
