using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 反应·基础的纯属性秘卷（Three.js 版 src/progression/scrolls/defsReaction.ts，数值同原版）：催化、灵动。
    /// 反应组 [Defs] 顺序 500–523 按 TS REACTION_SCROLLS 的下标排（本组 500）。
    /// </summary>
    [Defs(500)]
    public sealed class BasicReactionStatScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new StatScroll
            {
                id = "rx_catalyst", name = "催化", tags = new[] { "元素", "反应", "伤害" }, rarity = 0, maxStacks = 5,
                description = "元素反应伤害每层 +8%。", stats = new[] { (Stat.ReactionDamagePct, 0.08f) },
            },
            new StatScroll
            {
                id = "rx_haste", name = "灵动", tags = new[] { "元素", "反应" }, rarity = 0, maxStacks = 4,
                description = "元素反应急速每层 +10%（同一敌人再次发生同种反应的间隔缩短）。", stats = new[] { (Stat.ReactionHaste, 0.1f) },
            },
        };
    }
}
