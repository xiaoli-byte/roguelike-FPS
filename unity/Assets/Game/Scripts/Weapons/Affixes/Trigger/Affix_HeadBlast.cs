namespace Spiritfire.Game
{
    /// <summary>
    /// 「爆头爆炸」（TS headBlast）：触发类词条，权重 5，区间 0.5–0.8（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：命中扫描枪或弩（碎刃除外）。
    /// 生效：本武器直接命中弱点（爆头）时，下一帧在命中点引发半径 2.2 m（× 玩家爆炸范围）的爆炸：伤害 = 每次扣扳机的总伤害 × 值，
    /// 武器来源（吃武器与爆炸伤害）、不暴击、按本发元素与元素率附着、衍生深度 1；同一把枪 0.08 s 内只炸一次（一发霰弹多颗弹丸爆头只炸一次）。
    /// </summary>
    [Defs(90)]
    public sealed class Affix_HeadBlast : TriggerAffixDef
    {
        public const string Id = "headBlast";
        /// <summary>爆炸击退</summary>
        public const float Knockback = 4f;

        public Affix_HeadBlast() : base(Id, 0.5f, 0.8f, 5) { }

        public override string Text(WeaponDef weapon, float v) => $"爆头时引发小范围爆炸（{AffixText.Pct(v)} 单发伤害）";

        public override bool Allow(in AffixContext c) => AffixRules.DirectHit(c.def) && AffixRules.GunOnly(c.def);

        public override IAffixEffect Effect => effect;

        static readonly HeadBlastEffect effect = new();

        sealed class HeadBlastEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (!(h.value > 0) || h.effects == null || !AffixEffects.IsWeak(in e.info)) return;
                var rt = h.Runtime;
                if (h.now - rt.lastHeadBlast <= AffixEffects.HeadBlastGap) return;
                rt.lastHeadBlast = h.now;
                var r = h.stats;
                h.effects.QueueBlast(in h, Id, e.info.point, r.perShot * h.value, AffixEffects.HeadBlastRadius * r.blastMult, e.info.element, r.elementChance,
                    1, Knockback);
            }
        }
    }
}
