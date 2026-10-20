namespace Spiritfire.Game
{
    /// <summary>护盾强化（TS barrier）：每级护盾上限 +6，满级 +30</summary>
    [Defs(1)]
    public sealed class Talent_Barrier : TalentDef
    {
        public Talent_Barrier() : base("barrier", "护盾强化", Stat.MaxShield, 6f, "每级护盾上限 +6") { }
    }
}
