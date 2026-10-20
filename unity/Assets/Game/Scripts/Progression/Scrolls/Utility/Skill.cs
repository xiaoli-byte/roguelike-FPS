using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 功能·技能类秘卷（Three.js 版 src/progression/scrolls/defsUtility.ts「技能」段，数值同原版）：
    ///   灵泉 技能急速 · 法力涌动 技能伤害 · 多重储备 副技能充能（纯属性，<see cref="StatScroll"/>）；
    ///   回响 放技能后的武器伤害增益 · 夺魂 击杀回复技能冷却。
    /// 技能急速 / 副技能充能由 <see cref="HeroSkills"/> 每帧读属性；冷却回复走 <see cref="HeroSkills.ReduceCooldowns"/>。
    /// </summary>
    [Defs(301)]
    public sealed class SkillStatScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new StatScroll
            {
                id = "spirit_spring", name = "灵泉", tags = new[] { "技能" }, rarity = Rarity.Common, maxStacks = 5,
                description = "技能急速每层 +8%。", stats = new[] { (Stat.SkillHaste, 0.08f) },
            },
            new StatScroll
            {
                id = "arcane_surge", name = "法力涌动", tags = new[] { "技能" }, rarity = Rarity.Uncommon, maxStacks = 4,
                description = "技能伤害每层 +15%。", stats = new[] { (Stat.SkillDamagePct, 0.15f) },
            },
            new StatScroll
            {
                id = "extra_charge", name = "多重储备", tags = new[] { "技能" }, rarity = Rarity.Epic, maxStacks = 1,
                description = "副技能（E）充能 +1。", stats = new[] { (Stat.SecondaryCharges, 1f) },
            },
        };
    }

    /// <summary>回响：释放技能后 5 秒内，武器伤害每层 +10%（限时增益，再放技能刷新时长）</summary>
    [Defs(302)]
    public sealed class SkillEchoScroll : ScrollDef
    {
        public const float Duration = 5f, DamagePerStack = 0.1f;

        public SkillEchoScroll()
        {
            id = "skill_echo";
            name = "回响";
            rarity = Rarity.Uncommon;
            maxStacks = 3;
            tags = new[] { "技能", "触发" };
            description = "释放技能后 5 秒内，武器伤害每层 +10%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.Buff((Stat.DamagePct, DamagePerStack * n));
            s.OnSkillUsed((_, _) => ScrollKit.ProcBuff(s, buff, Duration));
        }
    }

    /// <summary>夺魂：击杀敌人时，两个技能的冷却每层回复 0.3 秒（精英与首领 ×4）。静默处决不算</summary>
    [Defs(303)]
    public sealed class SoulReapScroll : ScrollDef
    {
        public const float SecondsPerStack = 0.3f, BigKillMult = 4f;

        public SoulReapScroll()
        {
            id = "soul_reap";
            name = "夺魂";
            rarity = Rarity.Rare;
            maxStacks = 3;
            tags = new[] { "技能", "击杀" };
            description = "击杀敌人时，所有技能冷却每层减少 0.3 秒（精英与首领为 4 倍）。";
        }

        /// <summary>一次击杀回复的秒数</summary>
        public static float Seconds(Rank rank, int stacks) => SecondsPerStack * stacks * (rank == Rank.Normal ? 1 : BigKillMult);

        public override void Install(ScrollScope s, int n)
        {
            s.OnKill((in KillEvent e) =>
            {
                if (!e.enemy) return;
                if (ScrollKit.ReduceSkillCooldowns(s.player, Seconds(e.enemy.rank, n))) s.Proc();
            });
        }
    }
}
