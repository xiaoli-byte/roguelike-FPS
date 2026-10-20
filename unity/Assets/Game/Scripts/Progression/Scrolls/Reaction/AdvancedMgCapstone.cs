using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 金乌坠（Three.js 版 defsReaction.ts rx_mg_capstone）：直接「熔金」（深度 0）留下的熔池在 1.5 秒后坍缩爆炸，
    /// 对 3.5 米（× 爆炸范围）内造成「熔金」威力 B × 每层 60% 的火焰伤害（来源 Scroll、不暴击、深度 +1，爆炸伤害由 Combat 乘）；
    /// 对无护甲敌人的「熔金」伤害每层 +25%。
    /// 同一帧的多次坍缩共用反应系统的大特效预算（每帧 3 个），超出的不播爆炸特效、改为轻量火星 + 地面光环。
    /// 延时是「非常驻」的（同 TS ctx.tasks.delay）：换关时取消还没坍缩的熔池。
    /// </summary>
    [Defs(519)]
    public sealed class RxMgCapstone : ScrollDef
    {
        public const float Delay = 1.5f, Radius = 3.5f, Ratio = 0.6f;
        public static readonly Color CollapseColor = Hex.Rgb(0xffc04a);

        public RxMgCapstone()
        {
            id = "rx_mg_capstone";
            name = "金乌坠";
            rarity = 3;
            maxStacks = 2;
            tags = new[] { "元素", "反应", "熔金", "爆炸" };
            description = "「熔金」留下的熔池在 1.5 秒后坍缩爆炸，对 3.5 米内造成「熔金」威力每层 60% 的火焰伤害；对无护甲敌人的「熔金」伤害每层 +25%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var pending = new List<IDisposable>();
            s.OnStageLoaded(_ =>
            {
                foreach (var p in pending.ToArray()) p.Dispose();
                pending.Clear();
            });
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (ev.id != Reaction.Meltdown || ev.depth != 0) return;
                var at = ev.point;
                float b = ev.B;
                int depth = ev.depth;
                IDisposable handle = null;
                handle = s.After(Delay, () =>
                {
                    pending.Remove(handle);
                    Collapse(s, at, Ratio * n * b, depth + 1);
                });
                pending.Add(handle);
            });
            float noArmor = 1 + 0.25f * n;
            s.AddOutgoing((in HitContext c) => c.target && c.target.armor <= 0 && c.info.Has(DamageTag.Meltdown) ? noArmor : 1f);
        }

        void Collapse(ScrollScope s, Vector3 at, float damage, int depth)
        {
            if (!(damage > 0)) return;
            float r = ScrollKit.BlastRadius(Radius);
            bool big = ReactionSystem.TryBigFx();
            var info = ScrollKit.ProcInfo(id, DamageSource.Scroll, damage, Element.Fire, depth, at, Vector3.up);
            var o = new ExplosionOptions(at, r, info) { noFx = !big, color = CollapseColor };
            TacticsKit.Host.Explode(in o);
            if (!big && Application.isPlaying)
            {
                // 超出本帧大爆炸预算：轻量表现（火星 + 地面光环）
                TacticsKit.FxBurst(at, 2f);
                TacticsKit.FxRing(ReactionSystem.Ground(at), r, CollapseColor, 0.4f);
            }
            s.Proc();
        }
    }
}
