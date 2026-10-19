using System.Collections.Generic;
using System.Globalization;

namespace Spiritfire.Game
{
    /// <summary>
    /// 词条与武器名的中文文本（同 TS Affixes.describeAffix / legendaryName、Describe.weaponDisplayName / traitLines）：
    ///   普通词条「伤害 +12%」；传说特性「【传说·天命】每第 5 发必定暴击」；武器显示名「天命·赤铜左轮」（不含 +N，调用方自己拼）。
    /// 百分比按 TS 的 Math.round 取整（.5 进位）。
    /// </summary>
    public static class AffixText
    {
        /// <summary>0.123 → "12%"</summary>
        public static string Pct(float v) => $"{WeaponStatsResolver.RoundHalfUp(v * 100)}%";

        /// <summary>一位小数（同 TS toFixed(1)）</summary>
        public static string Fixed1(float v) => v.ToString("0.0", CultureInfo.InvariantCulture);

        /// <summary>开火单位（同 TS shotUnit）：光束「跳」、多弹体「轮」、其余「发」</summary>
        public static string ShotUnit(WeaponDef d)
        {
            if (d == null) return "发";
            if (d.mode == FireMode.Beam) return "跳";
            if (d.projectile != null && d.projectile.count > 1) return "轮";
            return "发";
        }

        /// <summary>用给定定义格式化一条词条：传说加「【传说·名】」前缀</summary>
        public static string Format(AffixDef a, WeaponDef weapon, float value)
        {
            if (a == null) return null;
            var text = a.Text(weapon, value);
            return a is LegendaryDef l ? $"【传说·{l.name}】{text}" : text;
        }

        /// <summary>词条 / 特性的中文描述；未知词条（还没实现的单元）返回 null</summary>
        public static string Describe(WeaponDef weapon, WeaponAffix a) => Format(AffixLibrary.Get(a.id), weapon, a.value);

        /// <summary>传说特性名（武器名前缀）；不是传说 / 未知返回 null</summary>
        public static string LegendaryName(string id) => AffixLibrary.Get(id) is LegendaryDef l ? l.name : null;

        /// <summary>武器显示名：传说前缀 + 名称（「天命·赤铜左轮」）</summary>
        public static string DisplayName(string weaponName, string legendaryName) =>
            string.IsNullOrEmpty(legendaryName) ? weaponName : $"{legendaryName}·{weaponName}";

        /// <summary>实例的显示名（取最后一条传说特性的名字作前缀）</summary>
        public static string DisplayName(WeaponInstance w)
        {
            if (w == null) return "";
            string lg = null;
            foreach (var a in w.affixes)
                if (AffixLibrary.IsLegendary(a.id)) lg = LegendaryName(a.id) ?? lg;
            return DisplayName(w.def.name, lg);
        }

        /// <summary>特性行：固有特性（def.notes）→ 词条 → 传说（放最后）；未知词条跳过</summary>
        public static List<string> Traits(WeaponInstance w)
        {
            var traits = new List<string>();
            if (w == null) return traits;
            if (w.def.notes != null) traits.AddRange(w.def.notes);
            var legendary = new List<string>();
            foreach (var a in w.affixes)
            {
                var d = AffixLibrary.Get(a.id);
                var t = Format(d, w.def, a.value);
                if (t == null) continue;
                if (d is LegendaryDef) legendary.Add(t);
                else traits.Add(t);
            }
            traits.AddRange(legendary);
            return traits;
        }
    }
}
