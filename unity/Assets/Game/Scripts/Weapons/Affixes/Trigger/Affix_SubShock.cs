namespace Spiritfire.Game
{
    /// <summary>
    /// 「副·雷」（TS subShock）：触发类词条，perHit，原始区间 0.1–0.18，权重 4。准入：实例元素不是雷、不是元素轮转武器。
    /// 生效：命中时按值掷骰，下一帧附加雷殛（规则见 <see cref="SubElementAffix"/>）。青冥雷蛊的固有「副·雷」40% 也走这里（同 TS innate）。
    /// </summary>
    [Defs(200)]
    public sealed class Affix_SubShock : SubElementAffix
    {
        public const string Id = "subShock";

        public Affix_SubShock() : base(Id, Element.Shock, "雷殛") { }
    }
}
