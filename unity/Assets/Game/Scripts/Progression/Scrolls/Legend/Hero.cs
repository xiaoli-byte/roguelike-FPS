namespace Spiritfire.Game
{
    // 英雄专属秘卷（Three.js 版 defsLegend.ts「英雄专属」段，数值同原版）：只进对应英雄的卡池（heroOnly = HeroDef.id），抽取权重 ×1.5（ScrollRoll）。
    // 燎 fox · 鼯 falcon · 磐 bear（鼯 / 磐的 HeroDef 由 HC1 / HC2 登记；没登记时校验只给警告）。磐的两卷按 D8 照常进卡池。

    /// <summary>火灵共鸣（燎）：灼烧伤害每层 +10%；放出副技能（E 燃爆雷）后，主技能（Q 尾焰火灵）冷却每层回复 1.5 秒</summary>
    [Defs(411)]
    public sealed class FoxResonanceScroll : ScrollDef
    {
        public const float FirePerStack = 0.1f, CooldownPerStack = 1.5f;

        public FoxResonanceScroll()
        {
            id = "fox_resonance";
            name = "火灵共鸣";
            heroOnly = "fox";
            rarity = Rarity.Rare;
            maxStacks = 3;
            tags = new[] { "英雄", "灼烧", "技能" };
            description = "灼烧伤害每层 +10%；使用燃爆雷（E）后，尾焰火灵（Q）冷却每层减少 1.5 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.FireDamagePct, FirePerStack * n);
            s.OnSkillUsed((slot, _) =>
            {
                if (slot == SkillSlot.Secondary && ScrollKit.ReduceSkillCooldowns(s.player, CooldownPerStack * n, SkillSlot.Primary)) s.Proc();
            });
        }
    }

    /// <summary>九天雷鸣（鼯）：雷殛伤害每层 +10%；滞空时暴击率每层 +6%（条件属性，每帧按是否着地开关）</summary>
    [Defs(412)]
    public sealed class FalconSkyScroll : ScrollDef
    {
        public const float ShockPerStack = 0.1f, AirCritPerStack = 0.06f;

        public FalconSkyScroll()
        {
            id = "falcon_sky";
            name = "九天雷鸣";
            heroOnly = "falcon";
            rarity = Rarity.Rare;
            maxStacks = 3;
            tags = new[] { "英雄", "雷殛", "暴击" };
            description = "雷殛伤害每层 +10%；滞空时暴击率每层 +6%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.ShockDamagePct, ShockPerStack * n);
            var motor = ScrollKit.MotorOf(s.player);
            s.Toggle(new[] { (Stat.CritChance, AirCritPerStack * n) }, () => ScrollKit.IsAirborne(motor));
        }
    }

    /// <summary>
    /// 不动如山（磐）：护盾上限每层 +15（PlayerVitals 加上限时同步加当前值，即「获得时补充 15 护盾」，叠层只补这一层）；
    /// 护盾没被打空时，受到的伤害每层 −6%
    /// </summary>
    [Defs(413)]
    public sealed class BearMountainScroll : ScrollDef
    {
        public const float ShieldPerStack = 15f, ReductionPerStack = 0.06f;

        public BearMountainScroll()
        {
            id = "bear_mountain";
            name = "不动如山";
            heroOnly = "bear";
            rarity = Rarity.Rare;
            maxStacks = 3;
            tags = new[] { "英雄", "护盾", "生存" };
            description = "护盾上限每层 +15（获得时同时补充 15 护盾）；护盾未被击破时，受到的伤害每层 −6%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.MaxShield, ShieldPerStack * n);
            float mult = 1 - ReductionPerStack * n;
            s.AddIncoming((in IncomingHit h) => s.player && s.player.shield > 0 ? mult : 1f);
        }
    }
}
