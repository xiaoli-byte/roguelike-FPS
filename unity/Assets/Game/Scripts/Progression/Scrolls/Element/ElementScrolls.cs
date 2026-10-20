using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 元素秘卷（S2，Three.js 版 src/progression/scrolls/defsElement.ts，共 10 卷：7 个 scroll() + 3 个 elementalRounds()）：
    ///   元素之心 ×3、五行共鸣（纯属性）· 燃弹 / 雷弹 / 蚀弹（武器命中按概率额外附着）· 野火燎原 / 静电弧 / 蚀爆（状态联动）。
    /// 名字、描述、稀有度、层数上限、标签、数值照 TS，顺序照 TS。带行为的在 ElementalRounds.cs / ElementLinkScrolls.cs。
    /// 「元素」标签参与出卡加权里的元素来源判定（<see cref="ScrollRoll"/>）。
    /// </summary>
    [Defs(200)]
    public sealed class ElementScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new StatScroll
            {
                id = "ember_heart", name = "炎心", tags = new[] { "元素", "灼烧" }, rarity = 0, maxStacks = 4, description = "灼烧伤害每层 +15%，元素触发率每层 +3%。",
                stats = new[] { (Stat.FireDamagePct, 0.15f), (Stat.ElementChancePct, 0.03f) },
            },
            new StatScroll
            {
                id = "thunder_heart", name = "雷心", tags = new[] { "元素", "雷殛" }, rarity = 0, maxStacks = 4, description = "雷殛伤害每层 +15%，元素触发率每层 +3%。",
                stats = new[] { (Stat.ShockDamagePct, 0.15f), (Stat.ElementChancePct, 0.03f) },
            },
            new StatScroll
            {
                id = "venom_heart", name = "蚀心", tags = new[] { "元素", "蚀化" }, rarity = 0, maxStacks = 4, description = "蚀化伤害每层 +15%，元素触发率每层 +3%。",
                stats = new[] { (Stat.CorrodeDamagePct, 0.15f), (Stat.ElementChancePct, 0.03f) },
            },
            new StatScroll
            {
                id = "five_elements", name = "五行共鸣", tags = new[] { "元素" }, rarity = 2, maxStacks = 3, description = "所有元素伤害每层 +10%，元素触发率每层 +5%。",
                stats = new[] { (Stat.ElementDamagePct, 0.1f), (Stat.ElementChancePct, 0.05f) },
            },
            new ElementalRoundsScroll("ignite_rounds", "燃弹", Element.Fire, "灼烧"),
            new ElementalRoundsScroll("storm_rounds", "雷弹", Element.Shock, "雷殛"),
            new ElementalRoundsScroll("acid_rounds", "蚀弹", Element.Corrode, "蚀化"),
            new WildfireScroll(),
            new StaticArcScroll(),
            new AcidBurstScroll(),
        };
    }
}
