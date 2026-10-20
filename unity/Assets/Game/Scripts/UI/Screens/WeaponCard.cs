using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>武器卡（Tab 面板；Three.js InventoryPanel.renderWeapon + .gf-arm）：数值按玩家当前属性结算（<see cref="WeaponStatsResolver"/>）</summary>
    public static class WeaponCard
    {
        public static string ElementName(Element e) => e switch
        {
            Element.Fire => "灼烧",
            Element.Shock => "雷殛",
            Element.Corrode => "蚀化",
            _ => "无",
        };

        public static VisualElement Build(VisualElement parent, WeaponInstance w, int slot, bool active)
        {
            var card = ScreenKit.El("sf-arm", parent);
            card.name = "weapon-" + (slot + 1);
            card.EnableInClassList("sf-arm--active", active);
            ScreenKit.Text("sf-arm__slot", card, (slot + 1).ToString(), UIFontRole.Number);
            if (w == null)
            {
                card.AddToClassList("sf-arm--empty");
                ScreenKit.Text("sf-arm__name", card, "空槽", UIFontRole.Title);
                return card;
            }
            var rc = w.RarityColor;
            card.style.borderLeftColor = rc;
            var nameRow = ScreenKit.El("sf-arm__namerow", card);
            var name = ScreenKit.Text("sf-arm__name", nameRow, WeaponLibrary.DisplayName(w), UIFontRole.Title);
            name.style.color = Color.Lerp(rc, Color.white, 0.2f);
            if (w.level > 0) ScreenKit.Text("sf-arm__lvl", nameRow, "+" + w.level, UIFontRole.Number);
            if (active) ScreenKit.Text("sf-arm__inhand", nameRow, "手持");

            var meta = ScreenKit.El("sf-arm__meta", card);
            ScreenKit.Text("sf-arm__metaitem", meta, Rarity.Name(w.rarity)).style.color = rc;
            if (!string.IsNullOrEmpty(w.def.category)) ScreenKit.Text("sf-arm__metaitem", meta, w.def.category);
            if (w.def.cycle != null && w.def.cycle.Length > 1)
                ScreenKit.Text("sf-arm__metaitem sf-arm__tri", meta, "三相轮转");
            else if (w.element != Element.None)
                ScreenKit.Text("sf-arm__metaitem", meta, $"{HudArt.ElementGlyph(w.element)} {ElementName(w.element)}").style.color = UITheme.ElementColor(w.element);

            ResolvedWeapon r = null;
            try { r = WeaponStatsResolver.Resolve(w); }
            catch (System.Exception e) { Debug.LogException(e); }
            if (r != null)
            {
                var grid = ScreenKit.El("sf-arm__stats", card);
                int hits = Mathf.Max(1, w.def.HitsPerShot);
                Cell(grid, "伤害", hits > 1 ? $"{ScreenKit.Num1(r.damage)}×{hits}" : ScreenKit.Num1(r.damage));
                Cell(grid, w.def.mode == FireMode.Beam ? "跳 / 秒" : "射速", ScreenKit.Num1(r.fireRate * Mathf.Max(1, w.def.burstCount)));
                Cell(grid, "弹匣", r.magCap.ToString());
                Cell(grid, "换弹", $"{r.reloadTime:0.0}秒");
                Cell(grid, "暴击", $"×{ScreenKit.Num1(r.critMult)}");
                Cell(grid, "秒伤", ScreenKit.Num(r.dps));
            }
            var traits = AffixText.Traits(w);
            if (traits.Count > 0)
            {
                var list = ScreenKit.El("sf-arm__traits", card);
                int legendaryFrom = traits.Count;
                // 传说特性排在最后：数一下有几条
                int lg = 0;
                foreach (var a in w.affixes)
                    if (AffixIds.IsLegendary(a.id) && AffixText.Describe(w.def, a) != null) lg++;
                legendaryFrom = traits.Count - lg;
                for (int i = 0; i < traits.Count; i++)
                {
                    var t = ScreenKit.Text(i >= legendaryFrom ? "sf-arm__trait sf-arm__trait--legend" : "sf-arm__trait", list, traits[i], rich: true);
                    t.name = "trait-" + i;
                }
            }
            return card;
        }

        static void Cell(VisualElement grid, string label, string value)
        {
            var c = ScreenKit.El("sf-arm__cell", grid);
            ScreenKit.Text("sf-arm__num", c, value, UIFontRole.Number);
            ScreenKit.Text("sf-arm__label", c, label);
        }
    }
}
