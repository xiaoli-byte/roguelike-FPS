namespace Spiritfire.Game
{
    /// <summary>
    /// 「乘隙」（TS statusHunter）：触发类词条，权重 5，区间 0.05–0.09（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：任何武器。生效：本武器的武器伤害（直接命中、弹射、爆炸；不含反应与持续伤害）× (1 + 值 × 目标身上元素状态的种数)。
    /// 输出修饰在元素附着之前求值：数的是这一击命中前身上的状态。
    /// </summary>
    [Defs(250)]
    public sealed class Affix_StatusHunter : TriggerAffixDef
    {
        public const string Id = "statusHunter";

        public Affix_StatusHunter() : base(Id, 0.05f, 0.09f, 5) { }

        public override string Text(WeaponDef weapon, float v) => $"目标每带有一种元素状态，伤害 +{AffixText.Pct(v)}";

        public override IAffixEffect Effect => effect;

        static readonly StatusHunterEffect effect = new();

        /// <summary>倍率：1 + 值 × 元素状态种数（不是武器伤害为 1）</summary>
        public static float Mult(float value, StatusMask statuses, in DamageInfo info) =>
            value > 0 && AffixEffects.IsWeaponHit(in info) && !info.Has(DamageTag.Dot) ? 1 + value * AffixEffects.CountElements(statuses) : 1;

        sealed class StatusHunterEffect : AffixEffect
        {
            public override float Modifier(in AffixHook h, in HitContext c) =>
                c.target && h.value > 0 ? Mult(h.value, AffixEffects.StatusesOf(in h, c.target), in c.info) : 1;
        }
    }
}
