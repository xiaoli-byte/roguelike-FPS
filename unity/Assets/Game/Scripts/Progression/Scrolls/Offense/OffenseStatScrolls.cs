using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 攻击类纯属性秘卷（Three.js 版 src/progression/scrolls/defsOffense.ts，数值同原版；破绽是 Unity 独有，D12）。
    /// 稀有度已按 5 档（与 TS 一致：利刃 / 鹰目 / 疾手 / 百宝囊 普通，致命诀 / 骤雨 / 破绽 精良）。
    /// 百宝囊 TS 另有「备弹上限每层 +20%」，等 W0-1 的 AmmoReservePct 落地由 S1 补上。
    /// [Defs(order)] 按 TS 分组顺序：攻击 100 · 元素 200 · 功能 300 · 传说 400 · 反应 500 · 战术 600。
    /// </summary>
    [Defs(100)]
    public sealed class OffenseStatScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new StatScroll { id = "keen_blade", name = "利刃", tags = new[] { "伤害" }, rarity = 0, maxStacks = 5, description = "武器伤害每层 +6%。", stats = new[] { (Stat.DamagePct, 0.06f) } },
            new StatScroll { id = "hawk_eye", name = "鹰目", tags = new[] { "暴击" }, rarity = 0, maxStacks = 5, description = "暴击率每层 +4%。", stats = new[] { (Stat.CritChance, 0.04f) } },
            new StatScroll { id = "fatal_art", name = "致命诀", tags = new[] { "暴击" }, rarity = 1, maxStacks = 4, description = "暴击伤害每层 +15%。", stats = new[] { (Stat.CritDamagePct, 0.15f) } },
            new StatScroll { id = "rapid_fire", name = "骤雨", tags = new[] { "射速" }, rarity = 1, maxStacks = 4, description = "射速每层 +7%。", stats = new[] { (Stat.FireRatePct, 0.07f) } },
            new StatScroll { id = "swift_hands", name = "疾手", tags = new[] { "换弹" }, rarity = 0, maxStacks = 5, description = "换弹速度每层 +10%。", stats = new[] { (Stat.ReloadSpeedPct, 0.1f) } },
            new StatScroll { id = "bottomless", name = "百宝囊", tags = new[] { "弹匣" }, rarity = 0, maxStacks = 3, description = "弹匣容量每层 +10%。", stats = new[] { (Stat.MagPct, 0.1f) } },
            new StatScroll { id = "weak_point", name = "破绽", tags = new[] { "暴击" }, rarity = 1, maxStacks = 3, description = "弱点伤害每层 +15%。", stats = new[] { (Stat.WeakpointDamagePct, 0.15f) } },
        };
    }
}
