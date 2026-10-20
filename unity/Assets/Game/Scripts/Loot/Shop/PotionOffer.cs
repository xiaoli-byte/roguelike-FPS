using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 战备药剂（服务，可重复购买）：回复 40% 最大生命并补满护盾；生命与护盾都满时拒绝、不收钱。
    /// 首领补给营没有免费回血：到达补给营不回满，回复是要花钱的服务（同 TS boss-supply 测试）；战斗中拒绝交易由 <see cref="ShopCounter"/> 统一处理
    /// </summary>
    public sealed class PotionOffer : ShopOffer
    {
        /// <summary>每瓶回复最大生命的比例</summary>
        public const float HealFraction = 0.4f;
        public static readonly Color Pink = Hex.Rgb(0xff8a96);

        public PotionOffer(int chapter) => price = ShopPricing.Potion(chapter);

        public override string Kind => "potion";
        public override Color Color => Pink;
        public override bool Repeatable => true;
        public override string Title(IShopCustomer c) => "战备药剂";

        public static bool NeedsRecovery(IShopCustomer c) => c.Health < c.MaxHealth - 0.01f || c.Shield < c.MaxShield - 0.01f;

        public override string Refusal(IShopCustomer c) => NeedsRecovery(c) ? null : "生命与护盾已满";

        public override InteractPrompt Prompt(IShopCustomer c)
        {
            bool full = c != null && !NeedsRecovery(c);
            return Card(c, "战备药剂", $"购买 · 回复 {Mathf.RoundToInt(HealFraction * 100)}% 生命并补满护盾", Pink, price,
                full ? "生命与护盾已满" : "可重复购买；每次按当前缺失状态恢复");
        }

        public override void Grant(IShopCustomer c, Vector3 front)
        {
            float healed = c.Heal(c.MaxHealth * HealFraction);
            float shield = c.AddShield(c.MaxShield);
            c.Sound("pickup_health");
            c.Notify($"战备药剂：回复 {Mathf.RoundToInt(healed)} 生命、{Mathf.RoundToInt(shield)} 护盾", Pink);
        }
    }
}
