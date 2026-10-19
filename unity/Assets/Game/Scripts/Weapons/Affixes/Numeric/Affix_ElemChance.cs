namespace Spiritfire.Game
{
    /// <summary>
    /// 「元素触发率」（TS elemChance）：数值类词条，权重 8，区间 0.06–0.14（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：带元素的实例（含随机元素）。生效：元素附着几率 = min(1, 定义 + 值)。
    /// </summary>
    [Defs(60)]
    public sealed class Affix_ElemChance : AffixDef
    {
        public Affix_ElemChance() : base(AffixIds.ElemChance, 0.06f, 0.14f, 8) { }

        public override string Text(WeaponDef weapon, float v) => $"元素触发率 +{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => c.element != Element.None;
    }
}
