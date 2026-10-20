namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「涅槃」（TS lg_nirvana）：任何武器。数值 = 威力比例 25%。
    /// 生效：本武器直接命中打死身负两种以上元素状态的敌人时（此刻状态还在），下一帧于其尸身强制引发对应反应：三种齐聚 → 归墟，
    /// 否则 焚雷 &gt; 熔金 &gt; 封脉；强度 = 它的最大生命 × 值，无视反应冷却，深度 1（中心已死，只结算范围部分；范围击杀是状态来源，不会再触发涅槃），标签 Nirvana。
    /// </summary>
    [Defs(1080)]
    public sealed class Legendary_Nirvana : LegendaryDef
    {
        public const string Id = "lg_nirvana";

        public Legendary_Nirvana() : base(Id, "涅槃") { }

        public override float Value(WeaponDef weapon) => 0.25f;

        public override string Text(WeaponDef weapon, float v) => $"击杀身负两种以上元素状态的敌人时，于其尸身引发对应反应（威力为其最大生命的 {AffixText.Pct(v)}）";

        public override IAffixEffect Effect => effect;

        static readonly NirvanaEffect effect = new();

        sealed class NirvanaEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (!(h.value > 0) || h.effects == null || !e.result.killed) return;
                var id = AffixEffects.ReactionOf(h.effects.Env.Statuses(e.enemy));
                if (id == null) return;
                h.effects.QueueNirvana(in h, e.enemy, h.effects.Env.Center(e.enemy), id.Value, e.enemy.maxHealth * h.value);
            }
        }
    }
}
