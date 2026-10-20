using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 镇岳（Three.js 版 defsReaction.ts rx_vs_capstone），对直接「封脉」（深度 0）：
    ///   · 这次封脉眩晕了非首领的中心敌人：再挂一次 0.7 + 每层 0.4 秒的眩晕（取较长值，相当于延长；精英由状态系统自动 ×0.75）；
    ///   · 中心是首领：6 秒内受到的伤害每层 +8%（叠在反应系统自己的「脉滞」之上）；
    ///   · 额外电弧：8 米内随机挑每层 1 名有视线的其他敌人，各受 0.3B 雷伤（来源 Scroll、不暴击、深度 +1），活着的再附蚀化（0.35B，深度 1）。
    /// </summary>
    [Defs(520)]
    public sealed class RxVsCapstone : ScrollDef
    {
        public const float ArcRange = 8f, ArcRatio = 0.3f, CorrodeRatio = 0.35f, BossSeconds = 6f;
        static readonly Color ArcColor = Hex.Rgb(0x5affd0);

        public RxVsCapstone()
        {
            id = "rx_vs_capstone";
            name = "镇岳";
            rarity = 3;
            maxStacks = 2;
            tags = new[] { "元素", "反应", "封脉", "控制" };
            description = "「封脉」造成的眩晕每层延长 0.4 秒，并额外放出每层 1 道电弧；首领被「封脉」后 6 秒内受到的伤害每层 +8%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var bossMarks = new EnemyTimers();
            var cands = new List<Damageable>();
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (ev.id != Reaction.Veinseal || ev.depth != 0) return;
                var center = ev.enemy;
                var o = ev.point;
                var h = TacticsKit.Host;
                bool alive = center && !center.Dead;
                if (ev.stunned && alive && !center.IsBoss) h.Stun(center, 0.7f + 0.4f * n);
                if (center && center.IsBoss) bossMarks.Set(center, s.Now + BossSeconds);

                h.Near(o, ArcRange, center, cands);
                if (cands.Count == 0) return;
                ScrollKit.Rng.Shuffle(cands);
                int picked = 0;
                for (int i = 0; i < cands.Count && picked < n; i++)
                {
                    if (!cands[i] || h.Blocked(o, cands[i])) continue;
                    cands[picked++] = cands[i];
                }
                var targets = cands.GetRange(0, picked).ToArray();
                cands.Clear();
                float arc = ArcRatio * ev.B, corrode = CorrodeRatio * ev.B;
                int depth = ev.depth + 1;
                foreach (var t in targets)
                {
                    if (!t || t.Dead) continue;
                    var at = ScrollKit.BodyCenter(t);
                    TacticsKit.FxLightning(o, at, ArcColor);
                    Combat.DamageEnemy(t, ScrollKit.ProcInfo(id, DamageSource.Scroll, arc, Element.Shock, depth, at, (at - o).normalized));
                    if (t && !t.Dead)
                        h.ApplyStatus(t, Element.Corrode, ReactionScrollKit.StatusPower(t, Element.Corrode, corrode), new StatusApplyOpts { depth = 1 });
                }
                if (targets.Length > 0) s.Proc();
            });
            float bossMult = 1 + 0.08f * n;
            s.AddOutgoing((in HitContext c) => bossMarks.Active(c.target, s.Now) ? bossMult : 1f);
            s.OnUninstall(bossMarks.Clear);
        }
    }
}
