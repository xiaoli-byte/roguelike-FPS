using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 功能类纯属性秘卷（Three.js 版 src/progression/scrolls/defsUtility.ts，数值同原版）。
    /// 标签：第一个是卡面显示的主标签（沿用 Unity 原来的单标签），其余补齐 TS 的标签。
    /// 上限类（铁骨 / 灵盾）不用写「获得时回复」：PlayerVitals 加上限时会同步加当前值，叠层按差量提交，每层只回这一层的量。
    /// 稀有度已按 5 档（与 TS 一致：流光 稀有，其余普通 / 精良）。
    /// </summary>
    [Defs(300)]
    public sealed class UtilityStatScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new StatScroll
            {
                id = "iron_bones", name = "铁骨", tags = new[] { "生存" }, rarity = 0, maxStacks = 5, description = "生命上限每层 +12（获得时同时回复 12 生命）。",
                stats = new[] { (Stat.MaxHp, 12f) },
            },
            new StatScroll
            {
                id = "spirit_ward", name = "灵盾", tags = new[] { "护盾", "生存" }, rarity = 0, maxStacks = 5, description = "护盾上限每层 +10（获得时同时补充 10 护盾）。",
                stats = new[] { (Stat.MaxShield, 10f) },
            },
            new StatScroll
            {
                id = "quick_recovery", name = "回春", tags = new[] { "护盾", "生存" }, rarity = 1, maxStacks = 3, description = "护盾恢复延迟每层 −0.4 秒，恢复速度每层 +8/秒。",
                stats = new[] { (Stat.ShieldRegenDelay, -0.4f), (Stat.ShieldRegenRate, 8f) },
            },
            new StatScroll { id = "harvest", name = "收割", tags = new[] { "击杀", "生存" }, rarity = 1, maxStacks = 4, description = "击杀敌人时每层回复 3 生命。", stats = new[] { (Stat.KillHeal, 3f) } },
            new StatScroll { id = "soul_siphon", name = "摄魂", tags = new[] { "击杀", "护盾" }, rarity = 1, maxStacks = 4, description = "击杀敌人时每层回复 4 护盾。", stats = new[] { (Stat.KillShield, 4f) } },
            new StatScroll { id = "stone_skin", name = "石肤", tags = new[] { "生存" }, rarity = 1, maxStacks = 3, description = "伤害减免每层 +5%。", stats = new[] { (Stat.DamageReduction, 0.05f) } },
            new StatScroll { id = "wind_walker", name = "踏风", tags = new[] { "机动" }, rarity = 0, maxStacks = 3, description = "移动速度每层 +0.4。", stats = new[] { (Stat.MoveSpeed, 0.4f) } },
            new StatScroll { id = "streamer", name = "流光", tags = new[] { "机动" }, rarity = 2, maxStacks = 1, description = "冲刺次数 +1。", stats = new[] { (Stat.DashCharges, 1f) } },
            new StatScroll { id = "spirit_lure", name = "灵引", tags = new[] { "经济" }, rarity = 0, maxStacks = 2, description = "拾取范围每层 +2 米。", stats = new[] { (Stat.PickupRadius, 2f) } },
        };
    }
}
