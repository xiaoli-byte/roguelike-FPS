using System.Collections.Generic;
using UnityEngine;
using T = Spiritfire.Game.CombatTuning.Thunderfire;

namespace Spiritfire.Game
{
    /// <summary>
    /// 焚雷（灼烧 ⇄ 雷殛）：中心火伤 B；3 m 爆炸 0.6B（边缘 60%、击退 7，排除中心）；从中心向被炸到的敌人画雷弧（最多 4 道）；
    /// 周围敌人附灼烧 0.2B（深度 +1：带雷殛的再焚雷、带蚀化的熔金）。大特效（爆炸声 + 大爆闪）受每帧预算限制，超出的走小号表现。
    /// </summary>
    [Defs]
    public sealed class ThunderfireHandler : ReactionHandler
    {
        public override string Id => "thunderfire";
        public override DetonateOutcome Kind => DetonateOutcome.Thunderfire;

        // 自有缓冲：伤害可能嵌套查询 / 击杀，不和别人共用
        readonly List<Damageable> hitList = new();
        readonly List<Damageable> near = new();

        public override void Execute(ReactionJob j)
        {
            var e = j.enemy;
            var c = j.center;
            float b = j.B;
            int uid = j.weaponUid;
            var color = CombatTuning.ReactionColors[(int)Reaction.Thunderfire];
            if (j.centerAlive && ReactionSystem.Hit(e, b, Element.Fire, j.depth, c, Reaction.Thunderfire, uid)) j.hits++;

            bool big = ReactionSystem.TryBigFx();
            float r = ReactionSystem.Radius(T.Radius);
            var info = ReactionSystem.ReactionHit(b * T.Splash, Element.Fire, j.depth, c, Reaction.Thunderfire, uid);
            info.knockback = T.Knockback;
            hitList.Clear();
            var o = new ExplosionOptions(c, r, info)
            {
                excludeOne = e, falloff = T.Falloff, hitList = hitList, flatKnockback = true, noFx = !big, color = color,
            };
            Combat.Explode(in o);
            j.hits += hitList.Count;

            // 扩散：周围的敌人也烧起来（带雷殛的再焚雷、带蚀化的熔金）
            ReactionSystem.Nearest(c, r, T.SpreadTargets, e, false, near);
            for (int i = 0; i < near.Count; i++)
                Combat.AttachFromReaction(near[i], Element.Fire, b * T.SpreadBurn, j.depth + 1, uid);

            for (int i = 0; i < hitList.Count && i < T.MaxArcs; i++)
                if (hitList[i]) Lightning.Spawn(c, ReactionSystem.CenterOf(hitList[i]), T.ArcColor);
            // 表现（同 Three.js runThunderfire）：大特效预算内由 Combat.Explode 播金色爆炸；预算用完时只出一团爆发 + 一圈环
            if (!big)
            {
                Fx.Burst(c, color, 18, 7f, 0.45f, 0.13f, 2f);
                Fx.Ring(ReactionSystem.Ground(c), r, color, 0.4f);
            }
            GameAudio.PlayAt("shock_zap", c, 0.5f, 1.1f);
            hitList.Clear();
            near.Clear();
        }
    }
}
