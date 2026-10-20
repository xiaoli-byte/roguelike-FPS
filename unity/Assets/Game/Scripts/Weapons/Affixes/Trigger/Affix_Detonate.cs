namespace Spiritfire.Game
{
    /// <summary>
    /// 「破势」（TS detonate）：触发类词条，权重 4，区间 0.6–0.9（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：命中扫描枪或弩，且不是蓄力武器（满蓄引爆已经自带）。
    /// 生效：本武器直接命中暴击或爆头、敌人仍存活且身上有元素状态时，下一帧引爆它身上的状态（三相 → 归墟，两相 → 两两反应，单相 → 崩解），
    /// 强度 = 上一帧本武器对它的合并伤害 × 值；同一把枪 1.5 s 内最多引爆一次。
    /// </summary>
    [Defs(270)]
    public sealed class Affix_Detonate : TriggerAffixDef
    {
        public const string Id = "detonate";

        public Affix_Detonate() : base(Id, 0.6f, 0.9f, 4) { }

        public override string Text(WeaponDef weapon, float v) => $"暴击或爆头时引爆目标的元素状态（强度 {AffixText.Pct(v)}，每 1.5 秒一次）";

        public override bool Allow(in AffixContext c) => AffixRules.DirectHit(c.def) && c.def.mode != FireMode.Charge;

        public override IAffixEffect Effect => effect;

        static readonly DetonateEffect effect = new();

        sealed class DetonateEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (!(h.value > 0) || h.effects == null || !AffixEffects.Live(in e)) return;
                if (!AffixEffects.IsWeak(in e.info) && !e.result.crit) return;
                if (AffixEffects.CountElements(h.effects.Env.Statuses(e.enemy)) == 0) return;
                var rt = h.Runtime;
                if (h.now - rt.lastDetonate < AffixEffects.DetonateIcd) return;
                rt.lastDetonate = h.now;
                h.effects.QueueDetonate(in h, e.enemy, e.result.total, h.value);
            }
        }
    }
}
