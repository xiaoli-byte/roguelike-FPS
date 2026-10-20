using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 强化台（商店居中的铁砧，可重复）：把手上那把枪强化一级，费用 = <see cref="WeaponLibrary.UpgradeCost"/>（50 × (等级 + 1) × (1 + 0.3 × 章)）；
    /// 没枪 / 满级（+5）时拒绝，价格牌写「无武器」「已满级」。
    /// 可选任一槽位（docs/unity-parity.md 3.11）：强化对象是手上那把，切枪就换目标；提示卡列出两个槽位各自的等级与费用。
    /// 强化预览：每级武器伤害 +12%，并给出伤害 / 秒伤「现在 → 强化后 ▲」（按 (1 + 0.12 × (L + 1)) / (1 + 0.12 × L) 折算，词条与玩家属性不变）
    /// </summary>
    public sealed class UpgradeOffer : ShopOffer
    {
        public static readonly Color Blue = Hex.Rgb(0x6fb8ff);

        public override string Kind => "upgrade";
        public override Color Color => Blue;
        public override bool Repeatable => true;

        public override string Title(IShopCustomer c)
        {
            var a = c?.ActiveWeapon;
            return a == null || c.UpgradeCost(a) == null ? "强化台" : $"强化 +{a.level + 1}";
        }

        public override int PriceFor(IShopCustomer c)
        {
            var a = c?.ActiveWeapon;
            return a == null ? -1 : c.UpgradeCost(a) ?? -1;
        }

        public override string Refusal(IShopCustomer c)
        {
            var a = c.ActiveWeapon;
            if (a == null) return "没有可强化的武器";
            return c.UpgradeCost(a) == null ? "当前武器已满级" : null;
        }

        public override string Note(IShopCustomer c)
        {
            var a = c?.ActiveWeapon;
            if (a == null) return "无武器";
            return c.UpgradeCost(a) == null ? "已满级" : null;
        }

        public override InteractPrompt Prompt(IShopCustomer c)
        {
            var a = c?.ActiveWeapon;
            if (a == null) return new InteractPrompt { title = "强化台", subtitle = "没有可强化的武器", color = Blue };
            int? cost = c.UpgradeCost(a);
            var lines = new List<string>();
            if (cost == null) lines.Add($"强化等级 {a.level}（已满）");
            else
            {
                var (dmg, dps) = c.WeaponNumbers(a);
                lines.AddRange(PreviewLines(dmg, dps, a.level));
            }
            // 另一个槽位：切枪就能强化它
            if (c.Weapons != null)
                foreach (var w in c.Weapons)
                {
                    if (w == null || w == a) continue;
                    int? oc = c.UpgradeCost(w);
                    lines.Add(oc == null ? $"另一把 {w.Title}：已满级" : $"另一把 {w.Title}：+{w.level} → +{w.level + 1}，{oc} 灵石（切枪选择）");
                }
            if (cost == null) return new InteractPrompt { title = "强化台", subtitle = $"{a.Title} 已满级", color = Blue, lines = lines.ToArray() };
            return Card(c, "强化台", $"强化 · {WeaponLibrary.DisplayName(a)} +{a.level} → +{a.level + 1}", Blue, cost.Value, lines.ToArray());
        }

        /// <summary>
        /// 强化预览（纯函数）：「每级武器伤害 +12%」+ 伤害、秒伤「现在 → 强化后 ▲」。damage / dps ≤ 0 的那项不列
        /// </summary>
        public static List<string> PreviewLines(float damage, float dps, int level)
        {
            var lines = new List<string> { $"每级武器伤害 +{Mathf.RoundToInt(WeaponLibrary.UpgradeStep * 100)}%" };
            float k = UpgradeRatio(level);
            if (damage > 0) lines.Add($"伤害  {damage:0.#} → {damage * k:0.#} ▲");
            if (dps > 0) lines.Add($"秒伤  {dps:0} → {dps * k:0} ▲");
            return lines;
        }

        /// <summary>升一级的伤害倍率变化：(1 + 0.12 × (L + 1)) / (1 + 0.12 × L)</summary>
        public static float UpgradeRatio(int level) =>
            (1 + WeaponLibrary.UpgradeStep * (level + 1)) / (1 + WeaponLibrary.UpgradeStep * Mathf.Max(0, level));

        public override void Grant(IShopCustomer c, Vector3 front)
        {
            var a = c.ActiveWeapon;
            if (a == null || !c.Upgrade(a)) return;
            c.Sound("skill_buff", 0.6f);
            c.Notify($"{WeaponLibrary.DisplayName(a)} 强化至 +{a.level}", Blue);
        }
    }
}
