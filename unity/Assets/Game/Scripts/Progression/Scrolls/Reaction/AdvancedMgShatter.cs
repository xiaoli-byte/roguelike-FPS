using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔铸（Three.js 版 defsReaction.ts rx_mg_shatter）：「熔金」的伤害击碎敌人护甲时（深度 ≤ 1 的熔金伤害），熔甲碎片迸射至 5 米内的其他敌人，
    /// 各造成 min(被击碎者护甲上限 × 每层 15%, 每层 60 × 强度成长) 的蚀化伤害并必定附加蚀化（来源 Scroll、不暴击、深度 +1）。
    /// 伤害在下一次秘卷任务阶段结算（同 TS 在 enemy:damaged 回调里一律 delay(0)，不在伤害管线里嵌套造成伤害）。
    /// </summary>
    [Defs(512)]
    public sealed class RxMgShatter : ScrollDef
    {
        public const float Range = 5f;

        public RxMgShatter()
        {
            id = "rx_mg_shatter";
            name = "熔铸";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "元素", "反应", "熔金", "护甲" };
            description = "「熔金」击碎敌人护甲时，熔甲碎片迸射至 5 米内的敌人，造成其护甲上限每层 15% 的蚀化伤害（单体上限随关卡强度）并附加蚀化。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buffer = new List<Damageable>();
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (!e.result.armorBroken || !e.info.Has(DamageTag.Meltdown)) return;
                int depth = e.info.depth;
                var broken = e.enemy;
                if (depth >= 2 || !broken) return;
                float maxArmor = broken.maxArmor;
                var c = ScrollKit.BodyCenter(broken);
                TacticsKit.FxBurst(c, 2f);
                s.After(0, () =>
                {
                    float dmg = Mathf.Min(maxArmor * 0.15f * n, 60f * n * ScrollKit.ProcScale());
                    if (!(dmg > 0)) return;
                    var targets = ReactionScrollKit.NearArray(TacticsKit.Host, c, Range, broken, buffer);
                    foreach (var t in targets)
                    {
                        if (!t || t.Dead) continue;
                        var at = ScrollKit.BodyCenter(t);
                        var info = ScrollKit.ProcInfo(id, DamageSource.Scroll, dmg, Element.Corrode, depth + 1, at, (at - c).normalized);
                        info.statusChance = 1;
                        Combat.DamageEnemy(t, info);
                    }
                    if (targets.Length > 0) s.Proc();
                });
            });
        }
    }
}
