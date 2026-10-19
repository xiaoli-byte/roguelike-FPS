namespace Spiritfire.Game
{
    /// <summary>
    /// 「猎首」（TS hunter）：数值类词条，权重 6，区间 0.12–0.25（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：任何武器。生效：本武器对首领与精英的伤害 × (1 + 值)：输出修饰（<see cref="Effect"/>），由 <see cref="AffixRuntime"/> 派发；反应伤害与持续伤害不吃。
    /// </summary>
    [Defs(170)]
    public sealed class Affix_Hunter : AffixDef
    {
        public Affix_Hunter() : base(AffixIds.Hunter, 0.12f, 0.25f, 6) { }

        public override string Text(WeaponDef weapon, float v) => $"对首领与精英伤害 +{AffixText.Pct(v)}";

        public override IAffixEffect Effect => effect;

        static readonly HunterEffect effect = new();

        /// <summary>
        /// 倍率：目标是首领或精英、这一击是武器伤害（含武器投射物的爆炸、触发效果）且不是反应 / 持续伤害时 1 + 值，否则 1（同 TS AffixEffects.weaponModifier）
        /// </summary>
        public static float Mult(float value, Rank rank, in DamageInfo info) =>
            value > 0 && (rank == Rank.Boss || rank == Rank.Elite) && info.Has(DamageTag.Weapon) && !info.Has(DamageTag.Reaction) && !info.Has(DamageTag.Dot)
                ? 1 + value
                : 1;

        sealed class HunterEffect : AffixEffect
        {
            public override float Modifier(in AffixHook h, in HitContext c) => c.target ? Mult(h.value, c.target.rank, c.info) : 1;
        }
    }
}
