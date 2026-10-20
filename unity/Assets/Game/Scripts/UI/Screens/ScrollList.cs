using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 已获得秘卷列表（U4；Three.js renderScrollList + .gf-owned）：按稀有度、层数从高到低。
    /// detailed = 每卷一行带当前层数下的说明（Tab 面板）；否则是一排小签（暂停菜单），左侧竖线 = 稀有度色。
    /// </summary>
    public static class ScrollList
    {
        /// <summary>本局持有的秘卷（掉落系统那一份；没有为 null）</summary>
        public static ScrollInventory Inventory => LootDirector.Instance ? LootDirector.Instance.scrolls : null;

        /// <summary>渲染进 parent（先清空），返回秘卷数</summary>
        public static int Render(VisualElement parent, ScrollInventory inv, bool detailed)
        {
            parent.Clear();
            var owned = inv?.Owned() ?? new List<(ScrollDef def, int stacks)>();
            if (owned.Count == 0)
            {
                ScreenKit.Text("sf-empty", parent, "尚未获得秘卷。清关宝箱与商店都能找到它们。");
                return 0;
            }
            owned.Sort((a, b) => a.def.rarity != b.def.rarity ? b.def.rarity.CompareTo(a.def.rarity) : b.stacks.CompareTo(a.stacks));
            foreach (var (def, stacks) in owned)
            {
                var rc = Rarity.Color(def.rarity);
                var row = ScreenKit.El(detailed ? "sf-owned sf-owned--detailed" : "sf-owned", parent);
                row.style.borderLeftColor = rc;
                var head = ScreenKit.El("sf-owned__head", row);
                var name = ScreenKit.Text("sf-owned__name", head, def.name, detailed ? UIFontRole.Title : UIFontRole.Body);
                name.style.color = Color.Lerp(rc, Color.white, 0.25f);
                ScreenKit.Text("sf-owned__stacks", head, def.maxStacks > 1 ? $"{stacks} / {def.maxStacks} 层" : Rarity.Name(def.rarity), UIFontRole.Number);
                if (!detailed) continue;
                ScrollChoiceScreen.SplitDownside(def, stacks, out var up, out var down);
                ScreenKit.Text("sf-owned__desc", row, up, rich: true);
                if (!string.IsNullOrEmpty(down)) ScreenKit.Text("sf-owned__down", row, "代价：" + down);
            }
            return owned.Count;
        }
    }
}
