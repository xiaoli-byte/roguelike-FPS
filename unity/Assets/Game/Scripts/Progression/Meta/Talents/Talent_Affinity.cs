namespace Spiritfire.Game
{
    /// <summary>元素亲和（TS affinity）：每级元素触发率 +3%，满级 +15%</summary>
    [Defs(6)]
    public sealed class Talent_Affinity : TalentDef
    {
        public Talent_Affinity() : base("affinity", "元素亲和", Stat.ElementChancePct, 0.03f, "每级元素触发率 +3%") { }
    }
}
