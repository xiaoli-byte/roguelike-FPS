using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「合璧」（TS lg_bond）：只出现在带元素或元素轮转的武器上（附加的是本发实际元素，物理弹没有可附加的）。数值 1（不使用）。
    /// 生效：本武器直接命中仍存活、且身上带有其他元素状态的敌人时，这一击没附着上本发元素就下一帧必定附着（强度同副元素：上一帧合并伤害）。
    /// 同一名敌人按最短的两两反应冷却限频：max(0.3, 1 ÷ (1 + 反应急速)) 秒一次——更频繁的附着不会多引发反应，只会让雷殛一直叠满眩晕。
    /// </summary>
    [Defs(1060)]
    public sealed class Legendary_Bond : LegendaryDef
    {
        public const string Id = "lg_bond";
        /// <summary>同一敌人两次强制附着的最短间隔（焚雷冷却 1 s ÷ (1 + 反应急速)），下限 0.3 s</summary>
        public const float Gap = 1f, GapFloor = 0.3f;

        public Legendary_Bond() : base(Id, "合璧") { }

        public override bool Allow(in AffixContext c) => c.element != Element.None || (c.def.cycle != null && c.def.cycle.Length > 0);

        public override float Value(WeaponDef weapon) => 1;

        public override string Text(WeaponDef weapon, float v) => "命中带有其他元素状态的敌人时，必定附加本武器的元素";

        /// <summary>按反应急速缩短的限频间隔</summary>
        public static float GapFor(float reactionHaste) => Mathf.Max(GapFloor, Gap / Mathf.Max(0.05f, 1 + reactionHaste));

        public override IAffixEffect Effect => effect;

        static readonly BondEffect effect = new();

        sealed class BondEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                var fx = h.effects;
                var el = e.info.element;
                if (fx == null || el == Element.None || !AffixEffects.Live(in e) || e.result.statusApplied == el) return;
                if (!AffixEffects.HasOtherElement(fx.Env.Statuses(e.enemy), el) || h.now < fx.BondReadyAt(e.enemy)) return;
                fx.SetBondReadyAt(e.enemy, h.now + GapFor(fx.Env.ReactionHaste));
                fx.QueueSub(in h, e.enemy, el, e.result.total);
            }
        }
    }
}
