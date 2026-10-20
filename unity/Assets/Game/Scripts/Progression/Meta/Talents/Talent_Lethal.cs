namespace Spiritfire.Game
{
    /// <summary>致命（TS lethal）：每级暴击率 +2%，满级 +10%</summary>
    [Defs(3)]
    public sealed class Talent_Lethal : TalentDef
    {
        public Talent_Lethal() : base("lethal", "致命", Stat.CritChance, 0.02f, "每级暴击率 +2%") { }
    }
}
