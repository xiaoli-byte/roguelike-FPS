using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 属性网格（U4；Three.js InventoryPanel.ts renderStatGrid + css/panels.css .gf-statgrid）：两列「名称 · 数值」，
    /// 偏离基础值的按增益 / 减益上色（越低越好的属性反过来，<see cref="StatInfo.lowerIsBetter"/>），绝对值类属性另附变化量。
    /// Tab 面板（full：常驻关键属性 + 所有偏离基础值的属性）与暂停菜单（精简）共用。
    /// </summary>
    public static class StatGrid
    {
        /// <summary>Tab 面板常驻的关键属性（TS KEY_STATS）</summary>
        public static readonly Stat[] KeyStats =
        {
            Stat.MaxHp, Stat.MaxShield, Stat.DamageReduction, Stat.MoveSpeed,
            Stat.DamagePct, Stat.CritChance, Stat.CritDamagePct, Stat.FireRatePct, Stat.ReloadSpeedPct,
            Stat.ElementChancePct, Stat.ElementDamagePct, Stat.SkillDamagePct, Stat.SkillHaste, Stat.Luck,
        };

        /// <summary>暂停菜单的精简属性（TS PAUSE_STATS）</summary>
        public static readonly Stat[] PauseStats =
        {
            Stat.MaxHp, Stat.MaxShield, Stat.DamagePct, Stat.CritChance, Stat.CritDamagePct,
            Stat.FireRatePct, Stat.ReloadSpeedPct, Stat.MoveSpeed, Stat.SkillHaste, Stat.DamageReduction,
        };

        /// <summary>按「加成」显示（带符号）的属性：名字以 Pct 结尾的，外加技能 / 反应急速</summary>
        public static bool Signed(Stat s) => s.ToString().EndsWith("Pct") || s == Stat.SkillHaste || s == Stat.ReactionHaste;

        /// <summary>数值文字：加成类带符号（+12%），其余是当前值（暴击率 17%、护盾恢复延迟 2.5秒、冲刺次数 3、移速 7.5）</summary>
        public static string Value(Stat s, float v)
        {
            if (float.IsNaN(v) || float.IsInfinity(v)) v = 0;
            if (Signed(s)) return StatInfo.Format(s, v);
            return StatInfo.Of(s).format switch
            {
                StatFormat.Pct => $"{Mathf.RoundToInt(v * 100)}%",
                StatFormat.Sec => $"{v:0.0}秒",
                StatFormat.Int => Mathf.RoundToInt(v).ToString(),
                _ => (Mathf.Round(v * 100) / 100).ToString("0.##"),
            };
        }

        /// <summary>
        /// 渲染进 parent（先清空）。stats 为空时写一行占位。full：在 keys 之后追加所有偏离基础值的属性（按枚举顺序）。
        /// 返回行数
        /// </summary>
        public static int Render(VisualElement parent, StatSheet stats, IReadOnlyList<Stat> keys, bool full, bool compact = false)
        {
            parent.Clear();
            parent.AddToClassList("sf-statgrid");
            parent.EnableInClassList("sf-statgrid--compact", compact);
            if (stats == null)
            {
                ScreenKit.Text("sf-empty", parent, "没有玩家数据。");
                return 0;
            }
            var list = new List<Stat>(keys);
            if (full)
                foreach (var info in StatInfo.All)
                {
                    if (list.Contains(info.stat)) continue;
                    if (Mathf.Abs(stats.Get(info.stat) - stats.GetBase(info.stat)) > 1e-5f) list.Add(info.stat);
                }
            foreach (var s in list)
            {
                float v = stats.Get(s), b = stats.GetBase(s), d = v - b;
                var row = ScreenKit.El("sf-stat", parent);
                ScreenKit.Text("sf-stat__name", row, StatInfo.Of(s).name);
                var tail = ScreenKit.El("sf-stat__tail", row);
                var val = ScreenKit.Text("sf-stat__val", tail, Value(s, v), UIFontRole.Number);
                if (Mathf.Abs(d) > 1e-5f)
                {
                    val.AddToClassList(StatInfo.IsGood(s, d) ? "sf-stat__val--buff" : "sf-stat__val--debuff");
                    if (!Signed(s)) ScreenKit.Text("sf-stat__delta", tail, StatInfo.Format(s, d), UIFontRole.Number);
                }
            }
            return list.Count;
        }
    }
}
