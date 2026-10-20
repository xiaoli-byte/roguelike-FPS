using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>弹药箱（服务，可重复购买）：补满两个槽位所有枪的备弹；都满时拒绝（「弹药已满」）、不收钱</summary>
    public sealed class AmmoOffer : ShopOffer
    {
        public static readonly Color Gold = Hex.Rgb(0xffd54a);

        public AmmoOffer(int chapter) => price = ShopPricing.Ammo(chapter);

        public override string Kind => "ammo";
        public override Color Color => Gold;
        public override bool Repeatable => true;
        public override string Title(IShopCustomer c) => "弹药箱";

        public static bool NeedsAmmo(IShopCustomer c)
        {
            if (c?.Weapons == null) return false;
            foreach (var w in c.Weapons)
                if (w != null && w.reserve < c.ReserveCapacity(w))
                    return true;
            return false;
        }

        public override string Refusal(IShopCustomer c) => NeedsAmmo(c) ? null : "弹药已满";

        public override InteractPrompt Prompt(IShopCustomer c) =>
            Card(c, "弹药箱", "购买 · 补满所有武器的备弹", Gold, price, NeedsAmmo(c) ? "可重复购买；补给后可照常换弹" : "弹药已满");

        public override void Grant(IShopCustomer c, Vector3 front)
        {
            c.AddAmmoFraction(1f);
            c.Sound("pickup_ammo");
            c.Notify("弹药箱：备弹已补满", Gold);
        }
    }
}
