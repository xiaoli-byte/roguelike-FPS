using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 追猎印记（Three.js 版 defsTactics.ts tac_focused_prey）：武器直接命中同一敌人后 4 秒内，对它的后续武器伤害每次命中每层 +3%，最多累计 5 次
    /// （满层上限 +45%）。命中刷新时长；同一帧对同一敌人只累计一次（霰弹）；过期后从 1 重新累计；不同敌人独立计数。
    /// 衍生、静默处决、没造成伤害的命中不累计；击杀时删除印记；换关 / 阵亡清空。
    /// </summary>
    [Defs(614)]
    public sealed class TacFocusedPrey : ScrollDef
    {
        public const int MaxHits = 5;
        public const float Window = 4f;

        struct Mark
        {
            public int hits;
            public float until;
            public double frame;
        }

        public TacFocusedPrey()
        {
            id = "tac_focused_prey";
            name = "追猎印记";
            rarity = 3;
            maxStacks = 3;
            tags = new[] { "命中", "伤害" };
            description = "武器直接命中同一敌人后，4 秒内后续武器伤害每次命中每层 +3%，最多累计 5 次；命中刷新持续时间，同帧对同一敌人只累计一次。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var marks = new Dictionary<Damageable, Mark>();
            var stale = new List<Damageable>();
            float per = 0.03f * n;

            void Prune()
            {
                float now = s.Now;
                foreach (var kv in marks)
                    if (!kv.Key || kv.Key.Dead || now >= kv.Value.until) stale.Add(kv.Key);
                foreach (var k in stale) marks.Remove(k);
                stale.Clear();
            }

            s.OnStageLoaded(_ => marks.Clear());
            s.OnPlayerDied(marks.Clear);
            s.OnUninstall(marks.Clear);
            s.AddOutgoing((in HitContext c) =>
                TacticsKit.IsWeaponHit(c.info) && c.target && marks.TryGetValue(c.target, out var m) && s.Now < m.until ? 1 + m.hits * per : 1f);
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var d = e.enemy;
                if (!d || !TacticsKit.Alive(s) || !TacticsKit.IsDirectWeaponHit(e.info) || !(e.result.total > 0)) return;
                if (e.result.killed)
                {
                    marks.Remove(d);
                    return;
                }
                double frame = TacticsKit.Frame;
                float now = s.Now;
                bool had = marks.TryGetValue(d, out var old);
                if (had && old.frame == frame) return;
                if (!had && marks.Count > 64) Prune();
                marks[d] = new Mark
                {
                    hits = System.Math.Min(MaxHits, (had && now < old.until ? old.hits : 0) + 1),
                    until = now + Window,
                    frame = frame,
                };
            });
        }
    }
}
