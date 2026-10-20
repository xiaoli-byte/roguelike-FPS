using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一个摊位（Three.js Shop.ts 的 Stall）：桌子 / 铁砧 + 悬浮自转的展示物 + 头顶价格牌，按住交互键买下摊上的 <see cref="IShopOffer"/>。
    ///   按住购买（防误买）：按下交互键开始计时，一直对着这个摊位按住 <see cref="HoldSeconds"/> 秒才成交；松手 / 转开 / 走远就作废。
    ///     成交后要先松手才能再买下一份（服务类连买不会一按到底）。提示卡的按键位写「按住 F」，按住时副标题换成进度条。
    ///   价格牌每 0.25 s 刷新：标题（商品色）+ 价格（灵石不够时标红）/「已售罄」「已满级」「无武器」。
    ///   售罄：展示物收起、价格牌变灰、不再可交互。
    ///   贴地：摊位落在 <see cref="Shop"/> 给的站位上，从高处往下打射线贴到地形 / 台面上（坡上也不悬空、不陷地）。
    /// </summary>
    public sealed class ShopStall : MonoBehaviour, IInteractable
    {
        /// <summary>按住多久成交（秒，真实时间）</summary>
        public const float HoldSeconds = 0.4f;
        const float TagRefresh = 0.25f;

        Shop shop;
        Transform display, rune;
        TextMesh tag;
        float displayY, spin, phase, tagTimer, hold;
        bool holding, needRelease, removed;
        string shownTag;

        public IShopOffer Offer { get; private set; }
        public Vector3 Front { get; private set; }
        /// <summary>按住进度 0..1（没在按为 0）</summary>
        public float HoldProgress => holding ? Mathf.Clamp01(hold / HoldSeconds) : 0;
        /// <summary>价格牌当前的文字（测试用）</summary>
        public string TagText => tag ? tag.text : "";

        IShopCustomer Customer => shop ? shop.Customer : PlayerShopCustomer.Instance;

        internal static ShopStall Create(Shop shop, IShopOffer offer, Vector3 pos, float facingDeg, GameObject art)
        {
            var go = new GameObject($"Stall · {offer.Kind}");
            go.transform.SetParent(shop.transform, true);
            go.transform.SetPositionAndRotation(pos, Quaternion.Euler(0, facingDeg, 0));
            var s = go.AddComponent<ShopStall>();
            s.shop = shop;
            s.Offer = offer;
            s.Build(art);
            return s;
        }

        void Build(GameObject art)
        {
            bool bench = Offer is UpgradeOffer;
            phase = Random.value * 10f;
            spin = Offer is WeaponOffer ? 52f : 75f;
            if (art) ShopVisuals.Art(art, transform, bench ? 1.4f : 1.9f);
            else if (bench) rune = ShopVisuals.Anvil(transform);
            else ShopVisuals.Stall(transform, Offer.Color);
            if (art && bench) rune = ShopVisuals.Rune(transform);

            display = new GameObject("Display").transform;
            display.SetParent(transform, false);
            displayY = bench ? 0 : Offer is PotionOffer ? 1.22f : Offer is AmmoOffer ? 1.12f : 1.3f;
            display.localPosition = new Vector3(0, displayY, 0.02f);
            switch (Offer)
            {
                case WeaponOffer w:
                    ShopVisuals.Weapon(display, w.weapon);
                    break;
                case ScrollOffer s:
                    ShopVisuals.Scroll(display, s.Color);
                    break;
                case PotionOffer:
                    ShopVisuals.Potion(display);
                    break;
                case AmmoOffer:
                    ShopVisuals.AmmoCrate(display);
                    break;
            }
            tag = ShopVisuals.Tag(transform, new Vector3(0, bench ? 2.25f : 1.98f, 0.12f), 0.2f);

            // 碰撞：桌子 / 铁砧（和玩家当前位置重叠时不立，免得把人卡住，同 TS）
            float half = bench ? 0.5f : ShopLayout.StallHalfWidth;
            var pv = PlayerVitals.Instance;
            var p = transform.position;
            if (!pv || Mathf.Abs(pv.transform.position.x - p.x) > half + 0.45f || Mathf.Abs(pv.transform.position.z - p.z) > half + 0.45f)
            {
                var box = gameObject.AddComponent<BoxCollider>();
                box.size = new Vector3(half * 2, 0.86f, half * 2);
                box.center = new Vector3(0, 0.43f, 0);
            }
            Front = p + transform.forward * ShopLayout.CounterFront + Vector3.up * 0.8f;
            Interaction.Add(this);
            RefreshTag();
        }

        void OnDestroy() => Remove();

        /// <summary>下架：不再可交互（商店拆了 / 售罄）</summary>
        internal void Remove()
        {
            if (removed) return;
            removed = true;
            holding = false;
            Interaction.Remove(this);
        }

        // ───────────── IInteractable ─────────────

        public Vector3 Focus => transform.position + Vector3.up * (Offer is UpgradeOffer ? 0.95f : 1.15f);
        public float Radius => 2.3f;
        public bool CanInteract => !removed && Offer != null && !Offer.SoldOut && shop && !shop.Closed;
        public string Prompt => Offer != null ? Offer.Title(Customer) : "";

        public InteractPrompt PromptCard
        {
            get
            {
                var p = Offer.Prompt(Customer);
                p.action = $"按住 {HudArt.Key(GameAction.Interact)}";
                if (holding)
                {
                    int filled = Mathf.Clamp(Mathf.FloorToInt(HoldProgress * 10f), 0, 10);
                    p.subtitle = $"购买中 {new string('■', filled)}{new string('□', 10 - filled)}";
                }
                return p;
            }
        }

        /// <summary>按下交互键：开始按住计时（要先松开上一次的）</summary>
        public void Interact()
        {
            if (!CanInteract || needRelease) return;
            holding = true;
            hold = 0;
        }

        /// <summary>直接买（跳过按住；冒烟测试、调试）。返回柜台的结果</summary>
        public TradeResult BuyNow() => shop ? shop.Buy(this) : TradeResult.Ignored;

        /// <summary>冒烟测试里「交互键按着」（Interactor.TestMode 时代替真实按键；置 false = 松手）</summary>
        public static bool TestHeld = true;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => TestHeld = true;

        static bool KeyHeld => Interactor.TestMode ? TestHeld : GameInput.Down(GameAction.Interact);

        /// <summary>玩家的交互器正对着这个摊位（转开 / 走远就不是了）</summary>
        bool Focused
        {
            get
            {
                var pv = PlayerVitals.Instance;
                var it = pv ? pv.GetComponent<Interactor>() : null;
                return it && ReferenceEquals(it.Current, this);
            }
        }

        /// <summary>顾客站位：柜台正前方 1.7 m（地面）</summary>
        public Vector3 CustomerSpot => transform.position + transform.forward * ShopLayout.CounterFront;

        void Update()
        {
            float dt = Time.deltaTime;
            if (display && !(Offer?.SoldOut ?? true))
            {
                display.Rotate(0, spin * dt, 0, Space.World);
                display.localPosition = new Vector3(0, displayY + Mathf.Sin(Time.time * 2f + phase) * 0.05f, 0.02f);
            }
            if (rune)
            {
                rune.localRotation = Quaternion.Euler(Mathf.Sin(Time.time * 1.3f + phase) * 14f, Time.time * 40f, Time.time * 86f);
                rune.localPosition = new Vector3(0, 1.45f + Mathf.Sin(Time.time * 2f) * 0.05f, 0);
            }
            // 成交后要先松手（冒烟测试的按键是一次性的，直接算松开）
            if (needRelease && (Interactor.TestMode || !KeyHeld)) needRelease = false;
            if (holding)
            {
                if (!CanInteract || !KeyHeld || !Focused) holding = false;
                else
                {
                    hold += Time.unscaledDeltaTime;
                    if (hold >= HoldSeconds)
                    {
                        holding = false;
                        needRelease = true;
                        if (shop) shop.Buy(this);
                    }
                }
            }
            tagTimer -= dt;
            if (tagTimer <= 0)
            {
                tagTimer = TagRefresh;
                RefreshTag();
            }
        }

        /// <summary>价格牌：标题 + 价格（不够钱标红）/ 说明</summary>
        public void RefreshTag()
        {
            if (!tag || Offer == null) return;
            var c = Customer;
            string text;
            if (Offer.SoldOut) text = $"<color=#6f747c>{Offer.Title(c)}</color>\n<color=#8a8f96>已售罄</color>";
            else
            {
                string title = $"<color=#{ShopVisuals.Hex6(Offer.Color)}>{Offer.Title(c)}</color>";
                string note = Offer.Note(c);
                int price = Offer.PriceFor(c);
                if (!string.IsNullOrEmpty(note) || price < 0) text = $"{title}\n<color=#c8ccd2>{note ?? "—"}</color>";
                else text = $"{title}\n<color=#{(c.Coins >= price ? "ffd54a" : "ff5a4f")}>◆ {price}</color>";
            }
            if (text == shownTag) return;
            shownTag = text;
            tag.text = text;
        }

        /// <summary>成交后：售罄的收起展示物、价格牌立刻刷新</summary>
        internal void AfterSale()
        {
            if (Offer.SoldOut)
            {
                if (display) display.gameObject.SetActive(false);
                Remove();
            }
            tagTimer = 0;
            RefreshTag();
        }
    }
}
