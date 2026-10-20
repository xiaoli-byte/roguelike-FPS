namespace Spiritfire.Game
{
    /// <summary>武器精通（TS mastery）：每级武器伤害 +4%，满级 +20%</summary>
    [Defs(2)]
    public sealed class Talent_Mastery : TalentDef
    {
        public Talent_Mastery() : base("mastery", "武器精通", Stat.DamagePct, 0.04f, "每级武器伤害 +4%") { }
    }
}
