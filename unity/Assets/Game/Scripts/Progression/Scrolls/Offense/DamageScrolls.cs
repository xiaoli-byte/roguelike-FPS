namespace Spiritfire.Game
{
    /// <summary>
    /// 条件增伤秘卷的共同写法（TS s.outgoing((e) =&gt; 条件 ? 1 + k × n : 1)）：登记一个输出修饰器，条件成立时 × (1 + 每层 × 层数)。
    /// 输出修饰器对玩家的一切伤害生效（武器、技能、爆炸、持续伤害、反应……），同 TS Combat.outgoingMultiplier；在暴击掷骰之后求值。
    /// </summary>
    public abstract class ConditionalDamageScroll : ScrollDef
    {
        /// <summary>每层的增伤（0.2 = +20%）</summary>
        protected float perStack;

        /// <summary>这一击满足条件吗（target 已确认非空）</summary>
        protected abstract bool Applies(ScrollScope s, in HitContext c);

        public override void Install(ScrollScope s, int n)
        {
            float bonus = 1 + perStack * n;
            s.AddOutgoing((in HitContext c) => c.target && Applies(s, in c) ? bonus : 1f);
        }
    }

    /// <summary>先声夺人：对耐久（生命 + 护盾 + 护甲）高于 90% 的敌人伤害每层 +20%（耐久按这一击结算之前算）</summary>
    public sealed class FirstBloodScroll : ConditionalDamageScroll
    {
        public const float Threshold = 0.9f;

        public FirstBloodScroll()
        {
            id = "first_blood";
            name = "先声夺人";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "伤害" };
            description = "对耐久高于 90% 的敌人伤害每层 +20%。";
            perStack = 0.2f;
        }

        protected override bool Applies(ScrollScope s, in HitContext c) => ScrollKit.EnemyHealthFrac(c.target) > Threshold;
    }

    /// <summary>断命：对耐久低于 35% 的敌人伤害每层 +18%</summary>
    public sealed class ExecutionerScroll : ConditionalDamageScroll
    {
        public const float Threshold = 0.35f;

        public ExecutionerScroll()
        {
            id = "executioner";
            name = "断命";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "伤害" };
            description = "对耐久低于 35% 的敌人伤害每层 +18%。";
            perStack = 0.18f;
        }

        protected override bool Applies(ScrollScope s, in HitContext c) => ScrollKit.EnemyHealthFrac(c.target) < Threshold;
    }

    /// <summary>近身搏杀：对 7 米内（敌人脚下到玩家的水平距离）的敌人伤害每层 +10%。没有玩家时不生效</summary>
    public sealed class CloseCombatScroll : ConditionalDamageScroll
    {
        public const float Range = 7f;

        public CloseCombatScroll()
        {
            id = "close_combat";
            name = "近身搏杀";
            rarity = 0;
            maxStacks = 3;
            tags = new[] { "伤害" };
            description = "对 7 米内的敌人伤害每层 +10%。";
            perStack = 0.1f;
        }

        protected override bool Applies(ScrollScope s, in HitContext c) => ScrollKit.EnemyDistance(c.target, s.player) < Range;
    }

    /// <summary>百步穿杨：对 18 米外的敌人伤害每层 +15%。没有玩家时（距离无穷大）不生效</summary>
    public sealed class SharpshooterScroll : ConditionalDamageScroll
    {
        public const float Range = 18f;

        public SharpshooterScroll()
        {
            id = "sharpshooter";
            name = "百步穿杨";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "伤害" };
            description = "对 18 米外的敌人伤害每层 +15%。";
            perStack = 0.15f;
        }

        protected override bool Applies(ScrollScope s, in HitContext c)
        {
            float d = ScrollKit.EnemyDistance(c.target, s.player);
            return d > Range && !float.IsInfinity(d);
        }
    }
}
