using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 流派符（雷火符 / 熔金符 / 封脉符，Three.js 版 defsReaction.ts 的 rx_*_charm）：带该反应标签的伤害每层 +12%
    /// （<see cref="ReactionScrollKit.Boost"/>，含中心伤害、余波、熔池），外加每层的属性加成。
    /// </summary>
    public sealed class RxCharm : ScrollDef
    {
        public Reaction reaction;
        public float boostPerStack = 0.12f;
        public (Stat stat, float perStack)[] stats = Array.Empty<(Stat, float)>();

        public override void Install(ScrollScope s, int n)
        {
            ReactionScrollKit.Boost(s, reaction, 1 + boostPerStack * n);
            foreach (var (stat, per) in stats) s.Stat(stat, per * n);
        }
    }

    /// <summary>雷火符、熔金符、封脉符（数值同 TS）</summary>
    [Defs(502)]
    public sealed class BasicCharms : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new RxCharm
            {
                id = "rx_tf_charm", name = "雷火符", rarity = 0, maxStacks = 4, tags = new[] { "元素", "反应", "焚雷", "灼烧", "雷殛" },
                description = "「焚雷」伤害每层 +12%；灼烧与雷殛伤害每层 +4%。",
                reaction = Reaction.Thunderfire, stats = new[] { (Stat.FireDamagePct, 0.04f), (Stat.ShockDamagePct, 0.04f) },
            },
            new RxCharm
            {
                id = "rx_mg_charm", name = "熔金符", rarity = 0, maxStacks = 4, tags = new[] { "元素", "反应", "熔金", "灼烧", "蚀化" },
                description = "「熔金」伤害每层 +12%；对护甲伤害每层 +6%。",
                reaction = Reaction.Meltdown, stats = new[] { (Stat.ArmorDamagePct, 0.06f) },
            },
            new RxCharm
            {
                id = "rx_vs_charm", name = "封脉符", rarity = 0, maxStacks = 4, tags = new[] { "元素", "反应", "封脉", "雷殛", "蚀化" },
                description = "「封脉」伤害每层 +12%；对护盾伤害每层 +6%。",
                reaction = Reaction.Veinseal, stats = new[] { (Stat.ShieldDamagePct, 0.06f) },
            },
        };
    }
}
