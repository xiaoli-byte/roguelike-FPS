using System.Collections.Generic;
using UnityEngine;
using A = Spiritfire.Game.CombatTuning.Abyss;

namespace Spiritfire.Game
{
    /// <summary>
    /// 归墟（三相齐聚）：判定时已消耗灼烧（结清值存在 job.cash）与雷殛、预警 0.35 s。执行：
    ///   结清灼烧：一次普通持续伤害（火、Dot 标签，不吃反应加成）；
    ///   三色天雷：火 / 雷 / 蚀各 B/3（每段吃到最有利的层倍率：火打血、雷打盾、蚀打甲）；
    ///   余波：3 m 爆炸 0.3B（中心已死 0.6B，边缘 60%、击退 9，无属性，排除中心）。不扩散元素（归墟是终点）。
    /// </summary>
    [Defs]
    public sealed class AbyssHandler : ReactionHandler
    {
        public override string Id => "abyss";
        public override DetonateOutcome Kind => DetonateOutcome.Abyss;

        static readonly Element[] Bolts = { Element.Fire, Element.Shock, Element.Corrode };

        readonly List<Damageable> hitList = new();

        public override void Execute(ReactionJob j)
        {
            var e = j.enemy;
            var c = j.center;
            float b = j.B;
            int uid = j.weaponUid;
            var color = CombatTuning.ReactionColors[(int)Reaction.Abyss];
            GameAudio.PlayAt("hit_crit", c, 0.8f, 0.8f);
            if (j.centerAlive)
            {
                if (j.cash > 0)
                {
                    // 灼烧结清：普通持续伤害（不带反应标记）
                    var cash = DamageInfo.Simple(j.cash, DamageSource.Status, c, Vector3.up);
                    cash.element = Element.Fire;
                    cash.depth = j.depth + 1;
                    cash.tags = DamageTag.Dot;
                    cash.weaponUid = uid;
                    cash.noCrit = true;
                    Combat.DamageEnemy(e, cash);
                }
                // 三色天雷：火打血、雷打盾、蚀打甲，各 B/3（中心算一个受击敌人）
                bool any = false;
                for (int i = 0; i < Bolts.Length; i++)
                {
                    if (!e || e.Dead) break;
                    if (ReactionSystem.Hit(e, b / 3f, Bolts[i], j.depth, c, Reaction.Abyss, uid)) any = true;
                }
                if (any) j.hits++;
            }

            bool centerDead = !e || e.Dead;
            var after = ReactionSystem.ReactionHit(b * (centerDead ? A.SplashDead : A.Splash), Element.None, j.depth, c, Reaction.Abyss, uid);
            after.knockback = A.Knockback;
            bool big = ReactionSystem.TryBigFx();
            hitList.Clear();
            var o = new ExplosionOptions(c, ReactionSystem.Radius(A.Radius), after)
            {
                // 归墟有自己的爆开特效（下面的 Fx.Abyss），不播通用爆炸
                excludeOne = e, falloff = A.Falloff, hitList = hitList, flatKnockback = true, noFx = true, color = color,
            };
            Combat.Explode(in o);
            j.hits += hitList.Count;
            hitList.Clear();

            // 表现（同 Three.js runAbyss）：三色天雷从头顶一圈劈下；大特效预算内播归墟爆开（紫色闪光 + 三色光粒甩出 + 紫环带光墙 + 灯 + 震屏），
            // 预算用完时只出一团紫色爆发 + 一圈环
            for (int i = 0; i < Bolts.Length; i++)
            {
                float a = i / (float)Bolts.Length * Mathf.PI * 2 + Random.value * 0.6f;
                var top = c + new Vector3(Mathf.Cos(a) * 0.7f, A.BoltHeight, Mathf.Sin(a) * 0.7f);
                Lightning.Spawn(top, c, Fx.ElementColor(Bolts[i]), 0.12f);
            }
            if (big)
            {
                Fx.Abyss(c, A.RingRadius);
                GameAudio.PlayAt("explosion", c, 0.75f, 0.9f);
            }
            else
            {
                Fx.Ring(ReactionSystem.Ground(c), A.RingRadius, color, 0.5f);
                Fx.Burst(c, color, 22, 6f, 0.5f, 0.14f, 0);
                CameraShake.Add(0.3f, 0.25f);
            }
        }
    }
}
