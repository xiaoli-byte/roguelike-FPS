namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「终焉」（TS lg_last）：不出现在光束与碎刃上。数值 = 伤害倍率 3。
    /// 生效：打出弹匣最后一发（这一发会扣弹、扣之前只剩 1 发；无限弹药 / 无尽免耗不算）时，本发伤害 × 值——霰弹整发、齐射整轮都吃。
    /// </summary>
    [Defs(1020)]
    public sealed class Legendary_Last : LegendaryDef
    {
        public const string Id = "lg_last";

        public Legendary_Last() : base(Id, "终焉") { }

        public override bool Allow(in AffixContext c) => c.def.mode != FireMode.Beam && AffixRules.GunOnly(c.def);

        public override float Value(WeaponDef weapon) => 3;

        public override string Text(WeaponDef weapon, float v) => $"弹匣最后一{AffixText.ShotUnit(weapon)}伤害 ×{AffixText.Num(v)}";

        public override IAffixEffect Effect => effect;

        static readonly LastEffect effect = new();

        sealed class LastEffect : AffixEffect
        {
            public override void OnFire(in AffixHook h, ref FireShot s)
            {
                if (h.value > 0 && s.Last) s.mult *= h.value;
            }
        }
    }
}
