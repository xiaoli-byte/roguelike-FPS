namespace Spiritfire.Game
{
    /// <summary>
    /// 「副·蚀」（TS subCorrode）：触发类词条，perHit，原始区间 0.1–0.18，权重 4。准入：实例元素不是蚀、不是元素轮转武器。
    /// 生效：命中时按值掷骰，下一帧附加蚀化（规则见 <see cref="SubElementAffix"/>）。
    /// </summary>
    [Defs(210)]
    public sealed class Affix_SubCorrode : SubElementAffix
    {
        public const string Id = "subCorrode";

        public Affix_SubCorrode() : base(Id, Element.Corrode, "蚀化") { }
    }
}
