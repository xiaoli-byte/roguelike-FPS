namespace Spiritfire.Game
{
    /// <summary>
    /// 「化合」（TS rxnDmg）：触发类词条，权重 6，区间 0.18–0.35（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：这把枪自己能引发反应（带元素 / 元素轮转 / 满蓄引爆 / 已抽到副元素词条）。
    /// 生效：本武器引发的元素反应（含崩解）造成的伤害 × (1 + 值)：输出修饰，只认带本武器 weaponUid 的反应伤害。
    /// </summary>
    [Defs(220)]
    public sealed class Affix_RxnDmg : TriggerAffixDef
    {
        public const string Id = "rxnDmg";

        public Affix_RxnDmg() : base(Id, 0.18f, 0.35f, 6) { }

        public override string Text(WeaponDef weapon, float v) => $"本武器引发的元素反应伤害 +{AffixText.Pct(v)}";

        public override bool Allow(in AffixContext c) => AffixRules.CanReact(c);

        public override IAffixEffect Effect => effect;

        static readonly RxnDmgEffect effect = new();

        sealed class RxnDmgEffect : AffixEffect
        {
            public override float Modifier(in AffixHook h, in HitContext c) => h.value > 0 && DamageCalc.IsReaction(c.info) ? 1 + h.value : 1;
        }
    }
}
