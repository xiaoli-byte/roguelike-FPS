using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 功能·机动类秘卷（Three.js 版 defsUtility.ts「机动」段，数值同原版；踏风 / 流光在 <see cref="UtilityStatScrolls"/>）：
    ///   凌云 额外跳跃（属性 ExtraJumps，PlayerVitals 映射到运动组件的 airJumps）· 幻影步 冲刺冷却 + 冲刺后增伤 ·
    ///   居高临下 滞空增伤（输出修饰器，所有伤害都吃，同 TS）· 战鼓 据点开战时射速 / 移速增益。
    /// 滞空 = 脚下没碰到地面（<see cref="ScrollKit.IsAirborne(PlayerVitals)"/>，同 TS !player.onGround）。
    /// </summary>
    [Defs(321)]
    public sealed class MobilityStatScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new StatScroll
            {
                id = "cloud_step", name = "凌云", tags = new[] { "机动" }, rarity = Rarity.Rare, maxStacks = 1,
                description = "额外跳跃次数 +1。", stats = new[] { (Stat.ExtraJumps, 1f) },
            },
        };
    }

    /// <summary>幻影步：冲刺冷却每层 −0.2 秒；冲刺后 2 秒内武器伤害每层 +8%</summary>
    [Defs(322)]
    public sealed class PhantomStepScroll : ScrollDef
    {
        public const float CooldownPerStack = -0.2f, Duration = 2f, DamagePerStack = 0.08f;

        public PhantomStepScroll()
        {
            id = "phantom_step";
            name = "幻影步";
            rarity = Rarity.Uncommon;
            maxStacks = 3;
            tags = new[] { "机动", "触发" };
            description = "冲刺冷却每层 −0.2 秒；冲刺后 2 秒内武器伤害每层 +8%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.DashCooldown, CooldownPerStack * n);
            var buff = s.Buff((Stat.DamagePct, DamagePerStack * n));
            s.OnPlayerDashed(_ => ScrollKit.ProcBuff(s, buff, Duration));
        }
    }

    /// <summary>居高临下：滞空时伤害每层 +10%</summary>
    [Defs(323)]
    public sealed class HighGroundScroll : ScrollDef
    {
        public const float DamagePerStack = 0.1f;

        public HighGroundScroll()
        {
            id = "high_ground";
            name = "居高临下";
            rarity = Rarity.Uncommon;
            maxStacks = 3;
            tags = new[] { "机动", "伤害" };
            description = "滞空时伤害每层 +10%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var motor = ScrollKit.MotorOf(s.player);
            float mult = 1 + DamagePerStack * n;
            s.AddOutgoing((in HitContext c) => ScrollKit.IsAirborne(motor) ? mult : 1f);
        }
    }

    /// <summary>战鼓：每处据点开战时（同 TS wave:started），8 秒内射速每层 +15%、移动速度每层 +0.5</summary>
    [Defs(324)]
    public sealed class WarDrumScroll : ScrollDef
    {
        public const float Duration = 8f, FireRatePerStack = 0.15f, MoveSpeedPerStack = 0.5f;

        public WarDrumScroll()
        {
            id = "war_drum";
            name = "战鼓";
            rarity = Rarity.Epic;
            maxStacks = 2;
            tags = new[] { "射速", "机动" };
            description = "每处据点开战时，8 秒内射速每层 +15%、移动速度每层 +0.5。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.Buff((Stat.FireRatePct, FireRatePerStack * n), (Stat.MoveSpeed, MoveSpeedPerStack * n));
            s.OnEncounterStarted(_ => ScrollKit.ProcBuff(s, buff, Duration));
        }
    }
}
