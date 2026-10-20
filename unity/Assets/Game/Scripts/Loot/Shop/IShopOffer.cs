using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 商店里的顾客（玩家）：交易逻辑只经过这层接口读写灵石、生命护盾、武器、秘卷，所以整条交易链（拒绝、扣费、发放、防重入）能在 EditMode 里用假顾客测
    /// （port tests/shop-services.test.mjs）。实机实现是 <see cref="PlayerShopCustomer"/>。
    /// </summary>
    public interface IShopCustomer
    {
        /// <summary>本局灵石</summary>
        int Coins { get; }
        /// <summary>扣灵石（够才扣，发 CoinsChanged）；不够返回 false、什么都不变</summary>
        bool TrySpend(int price);
        /// <summary>能交易：正常游玩（没有暂停 / 模态 / 结算挡着）且玩家活着</summary>
        bool CanTrade { get; }
        /// <summary>当前帧号（同一帧只成交一次）</summary>
        int Frame { get; }
        /// <summary>at 附近正在交战的敌人数（&gt; 0 时拒绝交易：补给不能变成边打边回血）</summary>
        int HostilesNear(Vector3 at);
        /// <summary>商店所在章（0 起），价格 × (1 + 0.25 × 章)</summary>
        int Chapter { get; }

        float Health { get; }
        float MaxHealth { get; }
        float Shield { get; }
        float MaxShield { get; }
        float Heal(float amount);
        float AddShield(float amount);

        /// <summary>手上的枪（没有为 null）与两个槽位</summary>
        WeaponInstance ActiveWeapon { get; }
        IReadOnlyList<WeaponInstance> Weapons { get; }
        /// <summary>这把枪的备弹上限（已计入玩家属性与词条）</summary>
        int ReserveCapacity(WeaponInstance w);
        /// <summary>按备弹上限的比例补备弹，返回是否补了</summary>
        bool AddAmmoFraction(float fraction);
        /// <summary>给一把枪：有空槽放空槽，否则替换当前槽，返回被替换下来的枪</summary>
        WeaponInstance GiveWeapon(WeaponInstance w);
        /// <summary>强化到下一级的费用（满级 null）与强化</summary>
        int? UpgradeCost(WeaponInstance w);
        bool Upgrade(WeaponInstance w);
        /// <summary>这把枪现在的单发伤害与理论秒伤（强化预览）</summary>
        (float damage, float dps) WeaponNumbers(WeaponInstance w);

        int ScrollStacks(string id);
        bool GainScroll(ScrollDef def);

        /// <summary>反馈：拒绝提示（红字 + 拒绝音）、成交提示、音效、被换下的枪落在摊位前</summary>
        void Deny(string message);
        void Notify(string message, Color color);
        void Sound(string id, float volume = 1f);
        void DropWeapon(WeaponInstance w, Vector3 at);
    }

    /// <summary>
    /// 商店摊位上的一件商品（docs/unity-parity.md 4.3「商店摊位 → Loot/Shop/&lt;Kind&gt;Offer.cs」；Three.js src/progression/loot/Shop.ts 的 StallSpec + buy / prompt / tag）。
    /// 五种：<see cref="WeaponOffer"/>（有限、换下的枪落地）、<see cref="ScrollOffer"/>（有限、满层拒绝）、<see cref="PotionOffer"/>（可重复：回 40% 生命并补满护盾）、
    /// <see cref="AmmoOffer"/>（可重复：补满所有枪的备弹）、<see cref="UpgradeOffer"/>（强化台：可重复、按当前武器的强化费用、满级拒绝、带伤害 / 秒伤预览）。
    /// 一家店 7 个摊位：武器 ×2、秘卷 ×1–2、药剂、弹药箱、居中的强化台（<see cref="ShopStock"/>）。
    /// 交易由 <see cref="ShopCounter"/> 统一走：先问 <see cref="Refusal"/>，再按 <see cref="PriceFor"/> 扣钱，最后 <see cref="Grant"/>。
    /// </summary>
    public interface IShopOffer
    {
        /// <summary>种类 id：weapon / scroll / potion / ammo / upgrade</summary>
        string Kind { get; }
        /// <summary>价格牌标题与颜色</summary>
        string Title(IShopCustomer c);
        Color Color { get; }
        /// <summary>可重复购买（服务类）；否则买一次就售罄</summary>
        bool Repeatable { get; }
        bool SoldOut { get; }
        /// <summary>现在的价格（灵石）；&lt; 0 = 现在买不了（强化台：没枪 / 满级）</summary>
        int PriceFor(IShopCustomer c);
        /// <summary>现在买不了的理由（null = 可以买）：「生命与护盾已满」「弹药已满」「该秘卷已达最大层数」「当前武器已满级」…</summary>
        string Refusal(IShopCustomer c);
        /// <summary>价格牌的小字（null = 显示价格）：「已售罄」「已满级」「无武器」</summary>
        string Note(IShopCustomer c);
        /// <summary>交互提示卡（cost / canAfford 已填）</summary>
        InteractPrompt Prompt(IShopCustomer c);
        /// <summary>钱已经扣了：发货（front = 摊位前方，被换下的枪落在这里）</summary>
        void Grant(IShopCustomer c, Vector3 front);
    }

    /// <summary>商品基类：价格、颜色、售罄状态</summary>
    public abstract class ShopOffer : IShopOffer
    {
        public abstract string Kind { get; }
        public abstract string Title(IShopCustomer c);
        public abstract Color Color { get; }
        public virtual bool Repeatable => false;
        public bool SoldOut { get; protected set; }
        /// <summary>标价（已按章节系数取整到 5）</summary>
        public int price;

        public virtual int PriceFor(IShopCustomer c) => price;
        public virtual string Refusal(IShopCustomer c) => null;
        public virtual string Note(IShopCustomer c) => SoldOut ? "已售罄" : null;
        public abstract InteractPrompt Prompt(IShopCustomer c);
        public abstract void Grant(IShopCustomer c, Vector3 front);

        /// <summary>带价格的提示卡</summary>
        protected static InteractPrompt Card(IShopCustomer c, string title, string subtitle, Color color, int cost, params string[] lines) => new()
        {
            title = title, subtitle = subtitle, color = color, lines = lines != null && lines.Length > 0 ? lines : null,
            cost = Mathf.Max(0, cost), canAfford = cost <= 0 || (c != null && c.Coins >= cost),
        };
    }

    /// <summary>
    /// 商店价格（Three.js Shop.ts）：标价 × (1 + 0.25 × 章)，四舍五入到 5 的倍数，至少 5。
    /// 武器按稀有度 60 / 100 / 160 / 240 / 360，秘卷按稀有度 80 / 110 / 145 / 185 / 220，战备药剂 40，弹药箱 20；强化台按 <see cref="WeaponLibrary.UpgradeCost"/>（自带章节系数，不再乘）
    /// </summary>
    public static class ShopPricing
    {
        public static readonly int[] ScrollPrice = { 80, 110, 145, 185, 220 };

        /// <summary>价格系数 1 + 0.25 × 章</summary>
        public static float Factor(int chapter) => EconomyConfig.ShopChapterMult(chapter);

        /// <summary>max(5, round(基价 × 系数 / 5) × 5)（round = .5 进位，同 TS Math.round）</summary>
        public static int Price(int basePrice, int chapter) => Mathf.Max(5, Mathf.FloorToInt(basePrice * Factor(chapter) / 5f + 0.5f) * 5);

        public static int Weapon(int rarity, int chapter) => Price(EconomyConfig.WeaponPrice[Rarity.Clamp(rarity)], chapter);
        public static int Scroll(int rarity, int chapter) => Price(ScrollPrice[Rarity.Clamp(rarity)], chapter);
        public static int Potion(int chapter) => Price(EconomyConfig.PotionPrice, chapter);
        public static int Ammo(int chapter) => Price(EconomyConfig.AmmoCratePrice, chapter);
    }
}
