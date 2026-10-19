using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>属性的显示格式：Flat 原值、Pct 百分比（0.06 → +6%）、Sec 秒、Int 整数</summary>
    public enum StatFormat { Flat, Pct, Sec, Int }

    /// <summary>
    /// 属性的显示信息（Three.js 版 src/core/Stats.ts 的 STAT_INFO）：中文名、显示格式、是否越低越好。
    /// 秘卷描述、属性面板、调试叠层都从这里取，不各写一份。每个 <see cref="Stat"/> 都有一条。
    /// </summary>
    public readonly struct StatInfo
    {
        public readonly Stat stat;
        public readonly string name;
        public readonly StatFormat format;
        /// <summary>越低越好（冷却、延迟、散布、后坐）：数值下降才是增益，UI 按这个上色</summary>
        public readonly bool lowerIsBetter;

        StatInfo(Stat stat, string name, StatFormat format, bool lowerIsBetter = false)
        {
            this.stat = stat;
            this.name = name;
            this.format = format;
            this.lowerIsBetter = lowerIsBetter;
        }

        static readonly StatInfo[] table = Build();

        /// <summary>按 Stat 枚举顺序排列的全部属性信息</summary>
        public static IReadOnlyList<StatInfo> All => table;

        public static StatInfo Of(Stat s)
        {
            int i = (int)s;
            return i >= 0 && i < table.Length ? table[i] : new StatInfo(s, s.ToString(), StatFormat.Flat);
        }

        /// <summary>带符号的显示文本：+6%、−0.4秒、+1、+12</summary>
        public static string Format(Stat s, float value)
        {
            string sign = value > 0 ? "+" : value < 0 ? "−" : "";
            float a = Mathf.Abs(value);
            return Of(s).format switch
            {
                StatFormat.Pct => $"{sign}{Mathf.RoundToInt(a * 100)}%",
                StatFormat.Sec => $"{sign}{a:0.0}秒",
                StatFormat.Int => $"{sign}{Mathf.RoundToInt(a)}",
                _ => $"{sign}{a:0.##}",
            };
        }

        /// <summary>这次变化（delta）对玩家是不是增益</summary>
        public static bool IsGood(Stat s, float delta) => Of(s).lowerIsBetter ? delta < 0 : delta > 0;

        static StatInfo Info(Stat s) => s switch
        {
            Stat.MaxHp => new(s, "生命上限", StatFormat.Flat),
            Stat.MaxShield => new(s, "护盾上限", StatFormat.Flat),
            Stat.ShieldRegenDelay => new(s, "护盾恢复延迟", StatFormat.Sec, true),
            Stat.ShieldRegenRate => new(s, "护盾恢复速度", StatFormat.Flat),
            Stat.MoveSpeed => new(s, "移动速度", StatFormat.Flat),
            Stat.DashCharges => new(s, "冲刺次数", StatFormat.Int),
            Stat.DashCooldown => new(s, "冲刺冷却", StatFormat.Sec, true),
            Stat.CritChance => new(s, "暴击率", StatFormat.Pct),
            Stat.CritDamagePct => new(s, "暴击伤害", StatFormat.Pct),
            Stat.DamagePct => new(s, "武器伤害", StatFormat.Pct),
            Stat.FireRatePct => new(s, "射速", StatFormat.Pct),
            Stat.ReloadSpeedPct => new(s, "换弹速度", StatFormat.Pct),
            Stat.MagPct => new(s, "弹匣容量", StatFormat.Pct),
            Stat.DamageReduction => new(s, "伤害减免", StatFormat.Pct),
            Stat.PickupRadius => new(s, "拾取范围", StatFormat.Flat),
            Stat.SkillHaste => new(s, "技能急速", StatFormat.Pct),
            Stat.SkillDamagePct => new(s, "技能伤害", StatFormat.Pct),
            Stat.ExplosionDamagePct => new(s, "爆炸伤害", StatFormat.Pct),
            Stat.ElementChancePct => new(s, "元素触发率", StatFormat.Pct),
            Stat.KillHeal => new(s, "击杀回血", StatFormat.Flat),
            Stat.KillShield => new(s, "击杀回盾", StatFormat.Flat),
            Stat.WeakpointDamagePct => new(s, "弱点伤害", StatFormat.Pct),
            Stat.ReactionDamagePct => new(s, "反应伤害", StatFormat.Pct),
            Stat.ReactionHaste => new(s, "反应急速", StatFormat.Pct),
            Stat.ExplosionRadiusPct => new(s, "爆炸范围", StatFormat.Pct),
            Stat.PetDamagePct => new(s, "灵宠伤害", StatFormat.Pct),
            Stat.HpRegen => new(s, "每秒生命恢复", StatFormat.Flat),
            Stat.Lifesteal => new(s, "吸血", StatFormat.Pct),
            Stat.JumpVelocity => new(s, "跳跃力", StatFormat.Flat),
            Stat.ExtraJumps => new(s, "额外跳跃", StatFormat.Int),
            Stat.AmmoReservePct => new(s, "备弹上限", StatFormat.Pct),
            Stat.SpreadPct => new(s, "散布", StatFormat.Pct, true),
            Stat.RecoilPct => new(s, "后坐力", StatFormat.Pct, true),
            Stat.ProjectileSpeedPct => new(s, "弹速", StatFormat.Pct),
            Stat.BossDamagePct => new(s, "首领伤害", StatFormat.Pct),
            Stat.EliteDamagePct => new(s, "精英伤害", StatFormat.Pct),
            Stat.ShieldDamagePct => new(s, "对护盾伤害", StatFormat.Pct),
            Stat.ArmorDamagePct => new(s, "对护甲伤害", StatFormat.Pct),
            Stat.ElementDamagePct => new(s, "元素伤害", StatFormat.Pct),
            Stat.FireDamagePct => new(s, "灼烧伤害", StatFormat.Pct),
            Stat.ShockDamagePct => new(s, "雷殛伤害", StatFormat.Pct),
            Stat.CorrodeDamagePct => new(s, "蚀化伤害", StatFormat.Pct),
            Stat.SecondaryCharges => new(s, "副技能充能", StatFormat.Int),
            Stat.CoinGainPct => new(s, "灵石获取", StatFormat.Pct),
            Stat.Luck => new(s, "幸运", StatFormat.Flat),
            _ => default,
        };

        static StatInfo[] Build()
        {
            var values = (Stat[])Enum.GetValues(typeof(Stat));
            int n = 0;
            foreach (var v in values) n = Mathf.Max(n, (int)v + 1);
            var t = new StatInfo[n];
            foreach (var v in values)
            {
                var info = Info(v);
                if (info.name == null)
                {
                    // 新加了 Stat 却没登记显示信息：照样能用，只是名字是英文
                    Debug.LogError($"[StatInfo] {v} 没有登记中文名与格式");
                    info = new StatInfo(v, v.ToString(), StatFormat.Flat);
                }
                t[(int)v] = info;
            }
            return t;
        }
    }
}
