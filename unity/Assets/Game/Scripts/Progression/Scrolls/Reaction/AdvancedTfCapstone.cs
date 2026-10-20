using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 焚天雷狱（Three.js 版 defsReaction.ts rx_tf_capstone）：「焚雷」伤害每层 +20%；直接焚雷（深度 0）之后，
    /// 3 米（× 爆炸范围）内的其他敌人各补一层雷殛（强度 0.3B，深度 1）——焚雷已给周围点上灼烧，于是周围敌人各自接连引发次级焚雷（受逐敌冷却限制）。
    /// </summary>
    [Defs(518)]
    public sealed class RxTfCapstone : ScrollDef
    {
        public const float Range = 3f, ShockRatio = 0.3f;

        public RxTfCapstone()
        {
            id = "rx_tf_capstone";
            name = "焚天雷狱";
            rarity = 3;
            maxStacks = 2;
            tags = new[] { "元素", "反应", "焚雷" };
            description = "「焚雷」伤害每层 +20%；被「焚雷」波及的其他敌人额外附加雷殛，从而接连引发「焚雷」。";
        }

        public override void Install(ScrollScope s, int n)
        {
            ReactionScrollKit.Boost(s, Reaction.Thunderfire, 1 + 0.2f * n);
            var buffer = new List<Damageable>();
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (ev.id != Reaction.Thunderfire || ev.depth != 0) return;
                float power = ShockRatio * ev.B;
                if (!(power > 0)) return;
                var h = TacticsKit.Host;
                var targets = ReactionScrollKit.NearArray(h, ev.point, ScrollKit.BlastRadius(Range), ev.enemy, buffer);
                int applied = 0;
                foreach (var t in targets)
                {
                    if (!t || t.Dead) continue;
                    h.ApplyStatus(t, Element.Shock, ReactionScrollKit.StatusPower(t, Element.Shock, power), new StatusApplyOpts { depth = 1 });
                    applied++;
                }
                if (applied > 0) s.Proc();
            });
        }
    }
}
