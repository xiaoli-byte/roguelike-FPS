using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 「弹射」（TS ricochet）：触发类词条，权重 5，区间 0.25–0.45（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：命中扫描枪或弩（含碎刃两形态）。
    /// 生效：本武器直接命中时按几率（多弹丸武器 ÷ √弹丸数；斩击不折算）下一帧弹向 10 m 内最近的另一名敌人，
    /// 伤害 = 这一击的基础伤害 × 50%（可暴击，按本发元素与元素率附着，衍生深度 1——不会再弹）。
    /// </summary>
    [Defs(120)]
    public sealed class Affix_Ricochet : TriggerAffixDef
    {
        public const string Id = "ricochet";

        public Affix_Ricochet() : base(Id, 0.25f, 0.45f, 5) { }

        public override string Text(WeaponDef weapon, float v) => $"命中时 {AffixText.Pct(v)} 几率弹射至附近敌人（50% 伤害）";

        public override bool Allow(in AffixContext c) => AffixRules.DirectHit(c.def);

        public override IAffixEffect Effect => effect;

        static readonly RicochetEffect effect = new();

        /// <summary>每次命中的弹射几率：多弹丸武器按 1/√弹丸数 折算（一发霰弹期望约弹 √n 次），斩击原样</summary>
        public static float Chance(float value, WeaponDef def, bool slash) =>
            slash || def == null ? value : value / Mathf.Sqrt(Mathf.Max(1, def.HitsPerShot));

        sealed class RicochetEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (!(h.value > 0) || h.effects == null) return;
                if (h.effects.Random() >= Chance(h.value, h.stats.def, AffixEffects.IsSlash(in e.info))) return;
                h.effects.QueueRicochet(in h, e.enemy, e.info.point, e.info.amount * AffixEffects.RicochetDamage, e.info.element);
            }
        }
    }
}
