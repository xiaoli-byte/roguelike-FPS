namespace Spiritfire.Game
{
    /// <summary>幸运（TS fortune）：每级幸运 +1，满级 +5（更容易出现高稀有度的武器与秘卷）</summary>
    [Defs(9)]
    public sealed class Talent_Fortune : TalentDef
    {
        public Talent_Fortune() : base("fortune", "幸运", Stat.Luck, 1f, "每级幸运 +1（更容易出现高稀有度的武器与秘卷）") { }
    }
}
