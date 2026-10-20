using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 归真（Three.js 版 defsReaction.ts rx_ab_amp）：「归墟」伤害每层 +30%；「归墟」的伤害（深度 ≤ 1）击杀敌人时，
    /// 向 8 米内最近的 2 名敌人各附加两种随机元素状态（强度为造成这次击杀的归墟威力 B × 每层 15%，沿用击杀那一击的深度）。
    /// 归墟的伤害先于该次反应事件结算：附加推迟到下一次秘卷任务阶段，那时已记下这次归墟的 B（没有记下时按那一击基础伤害 × 3）。
    /// </summary>
    [Defs(521)]
    public sealed class RxAbAmp : ScrollDef
    {
        public const float Range = 8f, Ratio = 0.15f;

        public RxAbAmp()
        {
            id = "rx_ab_amp";
            name = "归真";
            rarity = 3;
            maxStacks = 2;
            tags = new[] { "元素", "反应", "归墟", "击杀" };
            description = "「归墟」伤害每层 +30%；「归墟」击杀敌人时，向 8 米内最近的 2 名敌人各附加两种随机元素状态（强度为「归墟」威力的每层 15%）。";
        }

        public override void Install(ScrollScope s, int n)
        {
            ReactionScrollKit.Boost(s, Reaction.Abyss, 1 + 0.3f * n);
            float lastAbyssBase = 0;
            var buffer = new List<Damageable>();
            var trio = (Element[])ReactionScrollKit.Trio.Clone();
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (ev.id == Reaction.Abyss) lastAbyssBase = ev.B;
            });
            s.OnKill((in KillEvent k) =>
            {
                if (!k.info.Has(DamageTag.Abyss)) return;
                int depth = k.info.depth;
                if (depth >= 2) return;
                var dead = k.enemy;
                var c = dead ? ScrollKit.BodyCenter(dead) : k.info.point;
                float fallback = k.info.amount * 3;
                s.After(0, () =>
                {
                    float power = Ratio * n * (lastAbyssBase > 0 ? lastAbyssBase : fallback);
                    if (!(power > 0)) return;
                    var h = TacticsKit.Host;
                    var first = TacticsKit.Nearest(h, c, Range, dead, buffer);
                    if (!first) return;
                    var second = TacticsKit.Nearest(h, c, Range, first, buffer);
                    if (second == dead) second = null;
                    Spread(h, first, power, depth, trio);
                    if (second) Spread(h, second, power, depth, trio);
                    s.Proc();
                });
            });
        }

        static void Spread(IScrollHost h, Damageable e, float power, int depth, Element[] trio)
        {
            ScrollKit.Rng.Shuffle(trio);
            for (int i = 0; i < 2 && e && !e.Dead; i++)
                h.ApplyStatus(e, trio[i], ReactionScrollKit.StatusPower(e, trio[i], power), new StatusApplyOpts { depth = depth });
        }
    }
}
