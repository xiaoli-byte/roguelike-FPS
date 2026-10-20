using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷摊：一卷已经抽好的秘卷（<see cref="ScrollLibrary.Roll"/>，同三选一的抽法），标价按稀有度 × 章节系数。有限：买一次就售罄；
    /// 已达最大层数时拒绝（「该秘卷已达最大层数」），提示卡里注明已有几层
    /// </summary>
    public sealed class ScrollOffer : ShopOffer
    {
        public readonly ScrollDef scroll;

        public ScrollOffer(ScrollDef scroll, int chapter)
        {
            this.scroll = scroll;
            price = scroll != null ? ShopPricing.Scroll(scroll.rarity, chapter) : 150;
        }

        public override string Kind => "scroll";
        public override Color Color => scroll != null ? Rarity.Color(scroll.rarity) : Color.white;
        public override string Title(IShopCustomer c) => scroll != null ? scroll.name : "秘卷";

        public override string Refusal(IShopCustomer c)
        {
            if (scroll == null) return "没有货";
            return c.ScrollStacks(scroll.id) >= Mathf.Max(1, scroll.maxStacks) ? "该秘卷已达最大层数" : null;
        }

        public override InteractPrompt Prompt(IShopCustomer c)
        {
            if (scroll == null) return InteractPrompt.Of("秘卷");
            int have = c != null ? c.ScrollStacks(scroll.id) : 0;
            string desc;
            try
            {
                desc = scroll.Describe(Mathf.Min(have + 1, Mathf.Max(1, scroll.maxStacks)));
            }
            catch
            {
                desc = scroll.description;
            }
            string owned = have > 0 ? $" · 已有 {have}/{scroll.maxStacks} 层" : "";
            var lines = have >= scroll.maxStacks ? new[] { desc, "已达最大层数，无法购买" } : new[] { desc };
            return Card(c, scroll.name, $"购买 · {Rarity.Name(scroll.rarity)}秘卷{owned}", Color, price, lines);
        }

        public override void Grant(IShopCustomer c, Vector3 front)
        {
            if (c.GainScroll(scroll))
            {
                int n = c.ScrollStacks(scroll.id);
                string stack = scroll.maxStacks > 1 ? $"（{n}/{scroll.maxStacks} 层）" : "";
                c.Notify($"获得{Rarity.Name(scroll.rarity)}秘卷「{scroll.name}」{stack}", Color);
            }
            c.Sound("buy");
            SoldOut = true;
        }
    }
}
