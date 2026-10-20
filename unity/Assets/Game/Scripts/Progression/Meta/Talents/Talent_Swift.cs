namespace Spiritfire.Game
{
    /// <summary>迅捷（TS swift）：每级移动速度 +0.15（m/s），满级 +0.75</summary>
    [Defs(4)]
    public sealed class Talent_Swift : TalentDef
    {
        public Talent_Swift() : base("swift", "迅捷", Stat.MoveSpeed, 0.15f, "每级移动速度 +0.15") { }
    }
}
