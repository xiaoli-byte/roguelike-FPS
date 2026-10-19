namespace Spiritfire.Game
{
    /// <summary>
    /// 「后坐力」（TS recoil）：数值类词条，权重 5，区间 0.25–0.4（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：非光束枪械。生效：后坐 × max(0, (1 + 玩家后坐%) × (1 − 值))。
    /// </summary>
    [Defs(80)]
    public sealed class Affix_Recoil : AffixDef
    {
        public Affix_Recoil() : base(AffixIds.Recoil, 0.25f, 0.4f, 5) { }

        public override string Text(WeaponDef weapon, float v) => $"后坐力 −{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => c.def.mode != FireMode.Beam && AffixRules.GunOnly(c.def);
    }
}
