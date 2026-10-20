namespace Spiritfire.Game
{
    /// <summary>技能急速（TS haste）：每级技能急速 +5%，满级 +25%</summary>
    [Defs(7)]
    public sealed class Talent_Haste : TalentDef
    {
        public Talent_Haste() : base("haste", "技能急速", Stat.SkillHaste, 0.05f, "每级技能急速 +5%") { }
    }
}
