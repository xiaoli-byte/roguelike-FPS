namespace Spiritfire.Game
{
    /// <summary>生命强化（TS vitality）：每级生命上限 +8，满级 +40</summary>
    [Defs(0)]
    public sealed class Talent_Vitality : TalentDef
    {
        public Talent_Vitality() : base("vitality", "生命强化", Stat.MaxHp, 8f, "每级生命上限 +8") { }
    }
}
