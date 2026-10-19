namespace Spiritfire.Game
{
    /// <summary>
    /// 「轻盈」（TS swift）：数值类词条，权重 4，区间 0.4–0.8（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：任何武器。生效：持握这把枪时移速 + 值（<see cref="AffixRuntime"/> 切枪时登记 weapon:held 来源）；取一位小数。
    /// </summary>
    [Defs(180)]
    public sealed class Affix_Swift : AffixDef
    {
        public Affix_Swift() : base(AffixIds.Swift, 0.4f, 0.8f, 4) { }

        public override string Text(WeaponDef weapon, float v) => $"持握时移动速度 +{AffixText.Fixed1(v)}";

        /// <summary>一位小数（同 TS roundValue 的 swift 分支）</summary>
        public override float Round(float v) => WeaponStatsResolver.RoundHalfUp(v * 10) / 10f;
    }
}
