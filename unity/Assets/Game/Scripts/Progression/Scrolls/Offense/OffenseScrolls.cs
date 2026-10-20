using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 攻击类秘卷（S1，Three.js 版 src/progression/scrolls/defsOffense.ts 共 24 卷）：这里登记 <see cref="OffenseStatScrolls"/> 之外的 18 卷，
    /// 名字、描述、稀有度、层数上限、标签、数值都照 TS；顺序也照 TS 分组（通用伤害 → 暴击 / 爆头 → 射速 / 换弹 / 弹匣 → 爆炸）。
    /// 纯属性的写成 <see cref="StatScroll"/>，带行为的各是一个类（DamageScrolls / CritScrolls / AmmoScrolls / BlastScrolls.cs）。
    /// 已在 OffenseStatScrolls 里的 6 卷：利刃、鹰目、致命诀、骤雨、疾手、百宝囊（另有 Unity 独有的破绽）。
    /// </summary>
    [Defs(101)]
    public sealed class OffenseScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            // ── 通用伤害 ──
            new StatScroll
            {
                id = "giant_slayer", name = "屠巨", tags = new[] { "伤害" }, rarity = 1, maxStacks = 3, description = "对精英与首领的伤害每层 +12%。",
                stats = new[] { (Stat.EliteDamagePct, 0.12f), (Stat.BossDamagePct, 0.12f) },
            },
            new StatScroll
            {
                id = "shield_breaker", name = "破盾", tags = new[] { "伤害" }, rarity = 0, maxStacks = 3, description = "对护盾的伤害每层 +20%。",
                stats = new[] { (Stat.ShieldDamagePct, 0.2f) },
            },
            new StatScroll
            {
                id = "armor_piercer", name = "穿甲", tags = new[] { "伤害" }, rarity = 0, maxStacks = 3, description = "对护甲的伤害每层 +20%。",
                stats = new[] { (Stat.ArmorDamagePct, 0.2f) },
            },
            new FirstBloodScroll(),
            new ExecutionerScroll(),
            new CloseCombatScroll(),
            new SharpshooterScroll(),
            // ── 暴击 / 爆头 ──
            new HeadsmanScroll(),
            new CritStreakScroll(),
            // ── 射速 / 换弹 / 弹匣 ──
            new StatScroll
            {
                id = "steady", name = "稳如磐石", tags = new[] { "精准" }, rarity = 0, maxStacks = 3, description = "散布每层 −12%，后坐力每层 −15%。",
                stats = new[] { (Stat.SpreadPct, -0.12f), (Stat.RecoilPct, -0.15f) },
            },
            new MeteorShotScroll(),
            new LastRoundsScroll(),
            new ReloadRushScroll(),
            new ReloadNovaScroll(),
            // ── 爆炸 ──
            new StatScroll
            {
                id = "blast_master", name = "爆破专家", tags = new[] { "爆炸" }, rarity = 0, maxStacks = 4, description = "爆炸范围每层 +10%，爆炸伤害每层 +12%。",
                stats = new[] { (Stat.ExplosionRadiusPct, 0.1f), (Stat.ExplosionDamagePct, 0.12f) },
            },
            new ChainBlastScroll(),
            new VolatileRoundsScroll(),
            new ThunderJudgmentScroll(),
        };
    }
}
