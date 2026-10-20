namespace Spiritfire.Game
{
    /// <summary>装填（TS reload）：每级换弹速度 +5%，满级 +25%</summary>
    [Defs(5)]
    public sealed class Talent_Reload : TalentDef
    {
        public Talent_Reload() : base("reload", "装填", Stat.ReloadSpeedPct, 0.05f, "每级换弹速度 +5%") { }
    }
}
