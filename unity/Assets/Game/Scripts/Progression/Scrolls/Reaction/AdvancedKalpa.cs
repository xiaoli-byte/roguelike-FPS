using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 劫火（传说·高风险，Three.js 版 defsReaction.ts rx_kalpa）：每引发 10 次元素反应（不算强制反应，含本卷自己引发的），
    /// 向准星所指 30 米内的敌人（没有则玩家 15 米内最近的敌人）降下「三相天劫」：强制引发一次「归墟」
    /// （不需要元素状态，强度 100 × 强度成长，无视逐敌冷却，深度 0，标签 Kalpa）；代价：元素触发率 −8%。
    /// 没有目标、玩家阵亡或被反应预算拒绝时保留计数，下次反应再降。
    /// </summary>
    [Defs(523)]
    public sealed class RxKalpa : ScrollDef
    {
        public const int Every = 10;
        public const float AimRange = 30f, FallbackRange = 15f, Power = 100f;

        public RxKalpa()
        {
            id = "rx_kalpa";
            name = "劫火";
            rarity = 4;
            maxStacks = 1;
            tags = new[] { "元素", "反应", "归墟", "传说", "风险" };
            description = "每引发 10 次元素反应，向准星所指的敌人降下「三相天劫」：直接引发一次「归墟」（无需元素状态）；但元素触发率 −8%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.ElementChancePct, -0.08f);
            int count = 0;
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (ev.origin == ReactionOrigin.Forced) return;
                if (++count < Every) return;
                if (!TacticsKit.Alive(s)) return;
                var h = TacticsKit.Host;
                var target = h.AimTarget(AimRange, FallbackRange);
                if (!target || target.Dead) return;
                var opts = new TriggerOpts { power = Power * ScrollKit.ProcScale(), depth = 0, ignoreIcd = true, tag = DamageTag.Kalpa };
                if (h.Trigger(target, Reaction.Abyss, opts) == null) return;
                count = 0;
                Strike(target);
                s.Proc();
            });
        }

        /// <summary>三道天雷（火 / 雷 / 蚀色）从目标上方 12 米略微错开劈下（纯表现）</summary>
        static void Strike(Damageable target)
        {
            if (!Application.isPlaying || !target) return;
            var c = ScrollKit.BodyCenter(target);
            for (int i = 0; i < 3; i++)
            {
                float a = i * Mathf.PI * 2 / 3 + Random.value * 0.6f;
                var from = new Vector3(c.x + Mathf.Cos(a) * 0.8f, c.y + 12, c.z + Mathf.Sin(a) * 0.8f);
                TacticsKit.FxLightning(from, c, DamageTable.ElementColor(ReactionScrollKit.Trio[i]));
            }
            TacticsKit.Sfx("boss_slam", null, 0.6f, 1.3f);
        }
    }
}
