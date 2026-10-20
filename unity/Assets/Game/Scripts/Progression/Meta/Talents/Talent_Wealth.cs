namespace Spiritfire.Game
{
    /// <summary>财富（TS wealth；网页版叫金币，Unity 局内货币叫灵石，D13）：每级灵石获取 +8%，满级 +40%</summary>
    [Defs(8)]
    public sealed class Talent_Wealth : TalentDef
    {
        public Talent_Wealth() : base("wealth", "财富", Stat.CoinGainPct, 0.08f, "每级灵石获取 +8%") { }
    }
}
