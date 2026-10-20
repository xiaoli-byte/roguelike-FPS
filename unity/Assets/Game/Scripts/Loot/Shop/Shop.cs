using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 商店（docs/unity-parity.md 3.11 R3；Three.js src/progression/loot/Shop.ts 的 ShopManager.spawn）：弧形排开的 5–7 个摊位（<see cref="ShopLayout"/>），
    /// 货由 <see cref="ShopStock"/> 掷（武器 ×2、秘卷 ×1–2、战备药剂、弹药箱、居中的强化台），价格 × (1 + 0.25 × 章) 取整到 5（<see cref="ShopPricing"/>）。
    /// 交易统一经 <see cref="Counter"/>（拒绝提示、同帧 / 重入防重、战斗中拒绝），摊位按住交互键购买（<see cref="ShopStall"/>）。
    /// 摊位贴地：每个站位从商店中心高度往上 2.5 m 向下打射线，落在地形 / 台面上。强化台头顶立「百宝商铺」招牌。
    /// 关卡里由 <see cref="SupplyCamp"/>（首领前的补给营）生成；也可以直接 <see cref="Spawn"/>（测试场、调试命令）。
    /// <see cref="Close"/>：撤店——摊位下架、柜台关闭（之前拿到的摊位引用再交互也不会成交）、物体销毁。
    /// </summary>
    public sealed class Shop : MonoBehaviour
    {
        [Tooltip("摊位美术（MarketStall / PrayerTent / ForgeStall 之类，空 = 程序摊桌）")] public GameObject stallArt;
        [Tooltip("强化台美术（空 = 程序铁砧）")] public GameObject benchArt;
        public string signText = "百宝商铺";

        readonly List<ShopStall> stalls = new();
        static readonly List<Shop> all = new();

        /// <summary>场上开着的商店</summary>
        public static IReadOnlyList<Shop> All => all;
        public ShopCounter Counter { get; } = new();
        /// <summary>顾客（缺省玩家；测试可以换成假顾客）</summary>
        public IShopCustomer Customer { get; set; } = PlayerShopCustomer.Instance;
        public IReadOnlyList<ShopStall> Stalls => stalls;
        public bool Closed => Counter.Closed;
        /// <summary>商店正面朝向（世界 yaw，度）</summary>
        public float Yaw { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        /// <summary>
        /// 在 center 开一家店，正面朝 yawDeg（玩家从这一面走来，摊位排在中心后方的弧上）。stock 空 = 按本局当前章掷一份货
        /// </summary>
        public static Shop Spawn(Vector3 center, float yawDeg, ShopStock stock = null, Transform parent = null, GameObject stallArt = null, GameObject benchArt = null)
        {
            var go = new GameObject("Shop");
            go.transform.SetParent(parent, true);
            go.transform.SetPositionAndRotation(center, Quaternion.Euler(0, yawDeg, 0));
            var shop = go.AddComponent<Shop>();
            shop.stallArt = stallArt;
            shop.benchArt = benchArt;
            shop.Yaw = yawDeg;
            shop.Build(stock ?? ShopStock.RollForRun(EconomyConfig.Chapter));
            return shop;
        }

        void Build(ShopStock stock)
        {
            var center = transform.position;
            var stations = ShopLayout.Build(center, Yaw, stock.offers.Count, stock.Middle);
            for (int i = 0; i < stations.Count; i++)
            {
                var st = stations[i];
                var offer = stock.offers[i];
                var p = Snap(st.position, center.y);
                var s = ShopStall.Create(this, offer, p, st.facing, offer is UpgradeOffer ? benchArt : stallArt);
                stalls.Add(s);
                if (offer is UpgradeOffer && !string.IsNullOrEmpty(signText))
                {
                    var sign = ShopVisuals.Tag(s.transform, new Vector3(0, 3.1f, 0), 0.42f);
                    sign.text = $"<color=#ffd98a>{signText}</color>";
                }
            }
        }

        /// <summary>站位贴地：从参考高度往上 2.5 m 往下打 12 m 射线（世界层，忽略触发器）；打不到就用参考高度</summary>
        public static Vector3 Snap(Vector3 p, float refY)
        {
            var from = new Vector3(p.x, refY + 2.5f, p.z);
            p.y = Physics.Raycast(from, Vector3.down, out var hit, 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : refY;
            return p;
        }

        /// <summary>某种商品的第一个摊位（没有为 null）</summary>
        public ShopStall Find(string kind)
        {
            foreach (var s in stalls)
                if (s && s.Offer != null && s.Offer.Kind == kind)
                    return s;
            return null;
        }

        /// <summary>买这个摊位的东西（按住成交或 <see cref="ShopStall.BuyNow"/>）</summary>
        public TradeResult Buy(ShopStall s)
        {
            if (!s || Closed) return TradeResult.Ignored;
            var r = Counter.TryBuy(s.Offer, Customer, s.transform.position, s.Front);
            if (r != TradeResult.Bought) return r;
            var at = s.Focus;
            var c = s.Offer.Color;
            Fx.Burst(at, c, 18, 3f, 0.5f, 0.08f, s.Offer is UpgradeOffer ? -1f : 1f);
            if (s.Offer is UpgradeOffer) Fx.Ring(s.transform.position + Vector3.up * 0.05f, 1.8f, c, 0.4f);
            s.AfterSale();
            foreach (var other in stalls)
                if (other && other != s)
                    other.RefreshTag();
            return r;
        }

        /// <summary>撤店：柜台关闭（旧回调不再成交）、摊位下架、物体销毁。可重复调用</summary>
        public void Close()
        {
            if (Closed) return;
            Counter.Close();
            foreach (var s in stalls)
                if (s)
                    s.Remove();
            if (this) Destroy(gameObject);
        }
    }
}
