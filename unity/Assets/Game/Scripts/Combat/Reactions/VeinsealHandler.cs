using System.Collections.Generic;
using UnityEngine;
using V = Spiritfire.Game.CombatTuning.Veinseal;

namespace Spiritfire.Game
{
    /// <summary>
    /// 封脉（雷殛 ⇄ 蚀化）：中心雷伤 B（有护盾 ×2）；
    ///   非首领：眩晕 0.7 s（同一敌人 3.5 s 一次，不吃急速）+ 减速 40% 3 s；
    ///   首领：不眩晕、不减速，改为「脉滞」——4 s 内受到的伤害 ×1.12（<see cref="ReactionSystem.VulnMult"/>）；
    /// 导流：8 m 内最近 3 个有视线的敌人，各 0.3B 雷伤 + 附蚀 0.35B（深度 +1）。
    /// </summary>
    [Defs]
    public sealed class VeinsealHandler : ReactionHandler
    {
        public override string Id => "veinseal";
        public override DetonateOutcome Kind => DetonateOutcome.Veinseal;

        readonly List<Damageable> near = new();

        public override void Execute(ReactionJob j)
        {
            var e = j.enemy;
            var c = j.center;
            float b = j.B;
            int uid = j.weaponUid;
            var color = CombatTuning.ReactionColors[(int)Reaction.Veinseal];
            if (j.centerAlive)
            {
                if (ReactionSystem.Hit(e, b * (e.shield > 0 ? V.ShieldMult : 1), Element.Shock, j.depth, c, Reaction.Veinseal, uid)) j.hits++;
                if (e && !e.Dead)
                {
                    if (!e.IsBoss)
                    {
                        if (ReactionSystem.TryArmSealStun(e)) j.stunned = EnemyStatus.Stun(e, V.Stun);
                        EnemyStatus.Slow(e, V.Slow, V.SlowDuration);
                    }
                    else ReactionSystem.MarkVuln(e, V.BossVulnDuration);
                }
            }

            // 导流：8 m 内最近的 3 个敌人（要有视线；先选定再结算伤害）
            ReactionSystem.Nearest(c, V.ConductRange, V.ConductTargets, e, true, near);
            for (int i = 0; i < near.Count; i++)
            {
                var o = near[i];
                if (!o) continue;
                var oc = ReactionSystem.CenterOf(o);
                Lightning.Spawn(c, oc, color);
                if (ReactionSystem.Hit(o, b * V.ConductDamage, Element.Shock, j.depth, oc, Reaction.Veinseal, uid)) j.hits++;
                Combat.AttachFromReaction(o, Element.Corrode, b * V.ConductCorrode, j.depth + 1, uid);
            }
            near.Clear();

            // 表现（同 Three.js runVeinseal）：双层收紧的青环 + 头顶一团青光
            var g = ReactionSystem.Ground(c);
            Fx.Ring(g, V.RingRadius, color, 0.35f, false);
            Fx.Ring(g, V.RingRadius * 0.75f, color, 0.45f, false);
            Fx.Burst(c + Vector3.up * 0.8f, color, 10, 2f, 0.5f, 0.08f, 0);
            GameAudio.PlayAt("skill_shock", c, 0.5f, 0.8f);
            GameAudio.PlayAt("shock_zap", c, 0.6f, 0.7f);
        }
    }
}
