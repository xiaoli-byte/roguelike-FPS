using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 英雄专属「技能附加 trigger 时概率同时附加 give」（Three.js 版 defsReaction.ts 的 heroCatalyst）：火灵引雷（燎）、蚀羽惊雷（鼯）。
    /// 技能命中（含技能投射物的爆炸）这一击附上了 trigger、没打死时，逐敌 0.3 s 冷却后每层 30% 概率附加 give；该反应伤害每层 +10%。
    /// 雷殛叠满第 3 层会自删并眩晕：trigger 为雷殛时要求状态仍在身上。附着沿用这次技能命中的深度（直接命中为 0，弹射等衍生为 1）。
    /// </summary>
    public sealed class RxHeroCatalyst : ScrollDef
    {
        public Element trigger, give;
        public Reaction reaction;

        public override void Install(ScrollScope s, int n)
        {
            float chance = 0.3f * n;
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var d = e.enemy;
                if (!ReactionScrollKit.IsSkillReq(e.info) || e.result.statusApplied != trigger || e.result.killed || !d || d.Dead) return;
                var h = TacticsKit.Host;
                if (trigger == Element.Shock && !h.HasStatus(d, Element.Shock)) return;
                if (!s.ReadyFor(d, "catalyst", 0.3f) || !h.Chance(chance)) return;
                h.ApplyStatus(d, give, ReactionScrollKit.StatusPower(d, give, e.result.total), new StatusApplyOpts { depth = e.info.depth });
                s.Proc();
            });
            ReactionScrollKit.Boost(s, reaction, 1 + 0.1f * n);
        }
    }

    /// <summary>火灵引雷（燎 fox：灼烧 → 雷殛，焚雷）、蚀羽惊雷（鼯 falcon：雷殛 → 蚀化，封脉）</summary>
    [Defs(515)]
    public sealed class AdvancedHeroCatalysts : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new RxHeroCatalyst
            {
                id = "fox_thunderfire", name = "火灵引雷", rarity = 2, maxStacks = 3, heroOnly = "fox",
                tags = new[] { "英雄", "反应", "焚雷", "灼烧", "雷殛" },
                description = "技能附加灼烧时，每层 30% 概率同时附加雷殛（引发「焚雷」）；「焚雷」伤害每层 +10%。",
                trigger = Element.Fire, give = Element.Shock, reaction = Reaction.Thunderfire,
            },
            new RxHeroCatalyst
            {
                id = "falcon_veinseal", name = "蚀羽惊雷", rarity = 2, maxStacks = 3, heroOnly = "falcon",
                tags = new[] { "英雄", "反应", "封脉", "雷殛", "蚀化" },
                description = "技能附加雷殛时，每层 30% 概率同时附加蚀化（引发「封脉」）；「封脉」伤害每层 +10%。",
                trigger = Element.Shock, give = Element.Corrode, reaction = Reaction.Veinseal,
            },
        };
    }
}
