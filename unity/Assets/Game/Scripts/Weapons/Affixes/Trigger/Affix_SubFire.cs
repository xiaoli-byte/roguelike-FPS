namespace Spiritfire.Game
{
    /// <summary>
    /// 「副·焚」（TS subFire）：触发类词条，perHit，原始区间 0.1–0.18，权重 4。准入：实例元素不是火、不是元素轮转武器。
    /// 生效：命中时按值掷骰，下一帧附加灼烧（规则见 <see cref="SubElementAffix"/>）。
    /// </summary>
    [Defs(190)]
    public sealed class Affix_SubFire : SubElementAffix
    {
        public const string Id = "subFire";

        public Affix_SubFire() : base(Id, Element.Fire, "灼烧") { }
    }
}
