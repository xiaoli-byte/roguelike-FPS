using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 武器摊：一把已经掷好的枪（品质、元素、词条都定了），标价按稀有度 × 章节系数。有限：买一次就售罄、展示的枪收起；
    /// 两个槽都满时替换手上那把，被换下的枪落在摊位前（可以再捡回来）。
    /// 提示卡：玩家来买时同地上的枪（<see cref="WeaponDescriber.Prompt"/>：逐项 ▲▼ 对比手上那把 + 特性 + 替换说明）；
    /// 测试顾客（没有武器控制器）退回简版：枪名 + 「购买 · 稀有度 · 元素」，伤害 / 秒伤和词条（最多 3 条），槽满时注明替换哪把
    /// </summary>
    public sealed class WeaponOffer : ShopOffer
    {
        public readonly WeaponInstance weapon;

        public WeaponOffer(WeaponInstance weapon, int chapter)
        {
            this.weapon = weapon;
            price = weapon != null ? ShopPricing.Weapon(weapon.rarity, chapter) : 100;
        }

        public override string Kind => "weapon";
        public override Color Color => weapon != null ? Rarity.Color(weapon.rarity) : Color.white;
        public override string Title(IShopCustomer c) => weapon != null ? weapon.Title : "武器";

        public override string Refusal(IShopCustomer c) => weapon == null ? "没有货" : null;

        public override InteractPrompt Prompt(IShopCustomer c)
        {
            if (weapon == null) return InteractPrompt.Of("武器");
            // 玩家来买：同地上的枪，逐项对比手上那把（WC8，TS 商店也走 weaponPrompt）
            if (c is PlayerShopCustomer)
            {
                var wc = PlayerVitals.Instance ? PlayerVitals.Instance.GetComponent<WeaponController>() : null;
                if (wc)
                {
                    var p = WeaponDescriber.Prompt(weapon, "购买", 0, wc);
                    p.cost = Mathf.Max(0, price);
                    p.canAfford = price <= 0 || c.Coins >= price;
                    return p;
                }
            }
            var lines = new List<string>();
            var (dmg, dps) = c != null ? c.WeaponNumbers(weapon) : (0f, 0f);
            if (dmg > 0) lines.Add($"伤害 {dmg:0.#}　秒伤 {dps:0}");
            int n = 0;
            foreach (var a in weapon.affixes)
            {
                if (n >= 3) break;
                string text = null;
                try
                {
                    text = AffixText.Describe(weapon.def, a);
                }
                catch
                {
                    // 词条表缺项时不让提示卡整个出错
                }
                if (string.IsNullOrEmpty(text)) continue;
                lines.Add(text);
                n++;
            }
            if (c != null && c.Weapons != null)
            {
                bool full = true;
                foreach (var w in c.Weapons)
                    if (w == null)
                        full = false;
                if (full && c.ActiveWeapon != null) lines.Add($"替换手上的 {c.ActiveWeapon.Title}");
            }
            string element = ElementName(weapon.element);
            string sub = $"购买 · {Rarity.Name(weapon.rarity)}{(element != null ? " · " + element : "")}";
            return Card(c, weapon.Title, sub, Color, price, lines.ToArray());
        }

        public override void Grant(IShopCustomer c, Vector3 front)
        {
            var old = c.GiveWeapon(weapon);
            c.Sound("pickup_weapon");
            c.Notify($"购得武器：{weapon.Title}", Color);
            if (old != null) c.DropWeapon(old, front);
            SoldOut = true;
        }

        /// <summary>元素名（无元素为 null）</summary>
        public static string ElementName(Element e) => e switch
        {
            Element.Fire => "火",
            Element.Shock => "雷",
            Element.Corrode => "蚀",
            _ => null,
        };
    }
}
