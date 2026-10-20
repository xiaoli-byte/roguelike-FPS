using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔岩撼地（磐专属，Three.js 版 defsReaction.ts bear_magma）：裂地重击（E）先跃起、落地才砸（最长约 1.8 s）——
    /// 释放后 2.2 s 内的第一次无元素技能命中开一个 0.05 s 窗口，窗口内（同一次砸地的全部命中、没打死的）依次附加灼烧与蚀化
    /// （强度为该次伤害的 40%，上限最大生命 × 0.5），引发「熔金」；窗口过后解除。「熔金」伤害每层 +10%。
    /// 附着沿用砸地命中的深度（0）：引发的熔金是直接反应，金乌坠 / 熔铸对它生效。
    /// </summary>
    [Defs(517)]
    public sealed class RxBearMagma : ScrollDef
    {
        public const float ArmSeconds = 2.2f, Window = 0.05f, PowerRatio = 0.4f;

        public RxBearMagma()
        {
            id = "bear_magma";
            name = "熔岩撼地";
            rarity = 2;
            maxStacks = 3;
            heroOnly = "bear";
            tags = new[] { "英雄", "反应", "熔金", "技能" };
            description = "裂地重击（E）命中的敌人依次附加灼烧与蚀化（强度为该次伤害的 40%），引发「熔金」；「熔金」伤害每层 +10%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float armedUntil = -1, windowEnd = -1;
            s.OnSkillUsed((slot, _) =>
            {
                if (slot != SkillSlot.Secondary) return;
                armedUntil = s.Now + ArmSeconds;
                windowEnd = -1;
            });
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                float now = s.Now;
                if (now >= armedUntil) return;
                var d = e.enemy;
                if (!ReactionScrollKit.IsSkillReq(e.info) || e.info.element != Element.None || e.result.killed || !d || d.Dead) return;
                if (windowEnd < 0) windowEnd = now + Window;
                if (now > windowEnd)
                {
                    armedUntil = -1;
                    return;
                }
                float power = Mathf.Min(PowerRatio * e.result.total, d.maxHealth * 0.5f);
                if (!(power > 0)) return;
                var opts = new StatusApplyOpts { depth = e.info.depth };
                var h = TacticsKit.Host;
                h.ApplyStatus(d, Element.Fire, ReactionScrollKit.StatusPower(d, Element.Fire, power), opts);
                h.ApplyStatus(d, Element.Corrode, ReactionScrollKit.StatusPower(d, Element.Corrode, power), opts);
                s.Proc();
            });
            ReactionScrollKit.Boost(s, Reaction.Meltdown, 1 + 0.1f * n);
        }
    }
}
