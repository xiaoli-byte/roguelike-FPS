namespace Spiritfire.Game
{
    /// <summary>
    /// 传说秘卷（稀有度 4、唯一）的基类。高风险卷（TS 标签「风险」，显示为「高风险」，docs/unity-parity.md 3.5）的描述分两段：
    ///   收益 <see cref="upside"/> 照常显示；代价 <see cref="downside"/> 另起一行、用红色富文本（<see cref="DownsideLine"/>）。
    /// <see cref="ScrollDef.description"/> 由两段拼成，模板占位照常解析：界面直接显示 Describe(n) 就有红色负面行（uGUI / UI Toolkit 的富文本默认开着）；
    /// 想自己排版的界面（三选一卡面的传说金框）读 upside / downside，或用 <see cref="HasDownside"/> 判断任意秘卷有没有代价。
    /// 别的单元的高风险卷（劫火…）不继承本类也可以：标签写 <see cref="RiskTag"/>，描述末尾拼上 <see cref="DownsideLine"/>。
    /// </summary>
    public abstract class LegendScroll : ScrollDef
    {
        /// <summary>高风险标签（卡面标签行显示）</summary>
        public const string RiskTag = "高风险";
        /// <summary>传说主标签</summary>
        public const string LegendTag = "传说";
        /// <summary>代价行的颜色（RRGGBB，同 HUD「灵石不足」的红）</summary>
        public const string DownsideHex = "ff6a50";
        /// <summary>代价行的前缀</summary>
        public const string DownsidePrefix = "代价：";

        /// <summary>收益（模板，同 description 的占位）</summary>
        public string upside;
        /// <summary>代价（模板）；null = 没有代价（万剑归宗）</summary>
        public string downside;

        /// <summary>有代价的高风险卷</summary>
        public bool HighRisk => !string.IsNullOrEmpty(downside);

        protected LegendScroll()
        {
            rarity = Rarity.Legendary;
            maxStacks = 1;
        }

        /// <summary>设置描述：收益一行 + （有代价时）红色代价一行</summary>
        protected void Text(string upside, string downside = null)
        {
            this.upside = upside;
            this.downside = string.IsNullOrEmpty(downside) ? null : downside;
            description = this.downside == null ? upside : upside + "\n" + DownsideLine(this.downside);
        }

        /// <summary>红色代价行（富文本）：「代价：…」</summary>
        public static string DownsideLine(string text) => $"<color=#{DownsideHex}>{DownsidePrefix}{text}</color>";

        /// <summary>任意秘卷有没有代价（高风险标签或带红色代价行）</summary>
        public static bool HasDownside(ScrollDef def) =>
            def != null && (def is LegendScroll { HighRisk: true } || def.HasTag(RiskTag) ||
                            (def.description != null && def.description.Contains($"<color=#{DownsideHex}>")));
    }
}
