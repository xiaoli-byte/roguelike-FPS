using UnityEngine;
using C = Spiritfire.Game.CombatTuning.Collapse;

namespace Spiritfire.Game
{
    /// <summary>
    /// 崩解（引爆单一状态，或身上的组合都在冷却）：伤害入队时已按当时的剩余量算好（job.fixedBase，已乘引爆倍率）——
    ///   灼烧 / 蚀化：剩余持续伤害的 30%；雷殛：强度的 50%，再从它身上重新弹射一次（<see cref="EnemyStatus.ChainFrom"/>）；单次上限 30 × S。
    /// 元素同状态（火 / 蚀 / 雷），带 Reaction + Collapse 标签（吃反应伤害加成）。不消耗状态，不派发 <see cref="GameEvents.Reacted"/>。
    /// </summary>
    [Defs]
    public sealed class CollapseHandler : ReactionHandler
    {
        public override string Id => "collapse";
        public override DetonateOutcome Kind => DetonateOutcome.Collapse;

        public override void Execute(ReactionJob j)
        {
            var e = j.enemy;
            if (!e || e.Dead) return;
            var el = ReactionMath.ElementOf(j.collapse);
            var color = DamageTable.ElementColor(el);
            var c = ReactionSystem.CenterOf(e);
            j.center = c;
            float dmg = j.fixedBase ?? 0;
            j.B = dmg;
            if (dmg > 0 && ReactionSystem.Hit(e, dmg, el, j.depth, c, DamageTag.Reaction | DamageTag.Collapse, null, j.weaponUid)) j.hits++;
            if (j.collapse == StatusId.Shock && j.pin > 0) EnemyStatus.ChainFrom(e, j.pin, j.depth);

            // 表现（同 Three.js runCollapse 的元素色爆发 + 白环；B 路改成「先往里一吸、再啪地炸开」，Fx.Collapse）
            Fx.Collapse(c, Fx.ElementColor(el));
            Fx.Ring(ReactionSystem.Ground(c), C.RingRadius, Color.white, 0.25f, false);
            GameAudio.PlayAt("hit_crit", c, 0.8f, 0.8f);
            ReactionSystem.Label(e, c, "崩解", color, false);
        }
    }
}
