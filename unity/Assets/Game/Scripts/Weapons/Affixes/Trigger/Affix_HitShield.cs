namespace Spiritfire.Game
{
    /// <summary>
    /// 「命中回盾」（TS hitShield）：触发类词条，权重 6，区间 0.03–0.06（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：任何武器。生效：本武器直接命中造成伤害时，把实际伤害 × 值转化为护盾（不超过护盾上限；玩家死亡时不加）。
    /// </summary>
    [Defs(110)]
    public sealed class Affix_HitShield : TriggerAffixDef
    {
        public const string Id = "hitShield";

        public Affix_HitShield() : base(Id, 0.03f, 0.06f, 6) { }

        public override string Text(WeaponDef weapon, float v) => $"命中时将 {AffixText.Pct(v)} 伤害转化为护盾";

        public override IAffixEffect Effect => effect;

        static readonly HitShieldEffect effect = new();

        sealed class HitShieldEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (h.value > 0 && h.effects != null && e.result.total > 0) h.effects.Env.AddShield(e.result.total * h.value);
            }
        }
    }
}
