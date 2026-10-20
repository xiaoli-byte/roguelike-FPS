using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 商店交易（R3；port tests/shop-services.test.mjs + shopLayout.ts）：战备药剂 / 弹药箱是可重复的付费服务（满了拒绝不收钱）、战斗中拒绝一切交易、
    /// 钱不够 / 不在游玩 / 阵亡什么都不发也不扣、发事件时重入与同帧二次购买不会重复发货、武器 / 秘卷是有限商品而强化台可重复付费、
    /// 价格 × (1 + 0.25 × 章) 取整到 5、货单顺序与强化台居中、弧形排布（顾客站位离中心 4.7 m）、强化预览。
    /// 用假顾客（<see cref="FakeCustomer"/>）驱动 <see cref="ShopCounter"/>，不需要场景。
    /// </summary>
    public sealed class ShopServiceTests
    {
        sealed class FakeScroll : ScrollDef
        {
            public FakeScroll(string id, string name, int rarity, int maxStacks)
            {
                this.id = id;
                this.name = name;
                this.rarity = rarity;
                this.maxStacks = maxStacks;
                description = "测试";
            }
        }

        /// <summary>同 TS fixture：生命 100 / 护盾 50、两个槽位（第二个空）、备弹上限 100、强化费 50 + 25 × 等级（+3 满级）、给枪 = 替换手上那把并返回旧的</summary>
        sealed class FakeCustomer : IShopCustomer
        {
            public int coins = 1000, frame, hostiles, chapter;
            public bool canTrade = true;
            public float hp = 100, shield = 50;
            public readonly WeaponInstance[] slots = new WeaponInstance[2];
            public readonly Dictionary<string, int> scrolls = new();
            public readonly List<string> denials = new();
            public readonly List<WeaponInstance> dropped = new();
            public int spends, heals, shields, ammo, gives, gains, upgrades;
            /// <summary>扣钱时（CoinsChanged）同步回调：模拟监听者重入</summary>
            public Action onSpend;

            public int Coins => coins;

            public bool TrySpend(int price)
            {
                if (coins < price) return false;
                coins -= price;
                spends++;
                onSpend?.Invoke();
                return true;
            }

            public bool CanTrade => canTrade;
            public int Frame => frame;
            public int HostilesNear(Vector3 at) => hostiles;
            public int Chapter => chapter;
            public float Health => hp;
            public float MaxHealth => 100;
            public float Shield => shield;
            public float MaxShield => 50;

            public float Heal(float amount)
            {
                heals++;
                float d = Mathf.Min(amount, 100 - hp);
                hp += d;
                return d;
            }

            public float AddShield(float amount)
            {
                shields++;
                float d = Mathf.Min(amount, 50 - shield);
                shield += d;
                return d;
            }

            public WeaponInstance ActiveWeapon => slots[0];
            public IReadOnlyList<WeaponInstance> Weapons => slots;
            public int ReserveCapacity(WeaponInstance w) => 100;

            public bool AddAmmoFraction(float fraction)
            {
                ammo++;
                foreach (var w in slots)
                    if (w != null)
                        w.reserve = 100;
                return true;
            }

            public WeaponInstance GiveWeapon(WeaponInstance w)
            {
                gives++;
                var old = slots[0];
                slots[0] = w;
                return old;
            }

            public int? UpgradeCost(WeaponInstance w) => w.level < 3 ? 50 + w.level * 25 : null;

            public bool Upgrade(WeaponInstance w)
            {
                upgrades++;
                w.level++;
                return true;
            }

            public (float damage, float dps) WeaponNumbers(WeaponInstance w) => (10, 50);
            public int ScrollStacks(string id) => scrolls.TryGetValue(id, out var n) ? n : 0;

            public bool GainScroll(ScrollDef def)
            {
                gains++;
                scrolls[def.id] = ScrollStacks(def.id) + 1;
                return true;
            }

            public void Deny(string message) => denials.Add(message);
            public void Notify(string message, Color color) { }
            public void Sound(string id, float volume = 1) { }
            public void DropWeapon(WeaponInstance w, Vector3 at) => dropped.Add(w);
        }

        static WeaponInstance NewWeapon(int rarity = 1)
        {
            var def = WeaponLibrary.All.First();
            return new WeaponInstance(def, rarity) { reserve = 100 };
        }

        static FakeCustomer Customer(int chapter = 0)
        {
            var c = new FakeCustomer { chapter = chapter };
            c.slots[0] = NewWeapon();
            return c;
        }

        static TradeResult Buy(ShopCounter counter, IShopOffer offer, FakeCustomer c) => counter.TryBuy(offer, c, Vector3.zero, Vector3.forward);

        // ───────────── 服务 ─────────────

        [Test]
        public void PotionAndAmmo_ArePricedRepeatableServices()
        {
            var c = Customer();
            var counter = new ShopCounter();
            var potion = new PotionOffer(0);
            var ammo = new AmmoOffer(0);
            c.hp = 10;
            c.shield = 2;
            Assert.AreEqual(TradeResult.Bought, Buy(counter, potion, c));
            Assert.AreEqual(50, c.hp, 1e-4f);
            Assert.AreEqual(50, c.shield, 1e-4f);
            Assert.AreEqual(960, c.coins);
            Assert.IsFalse(potion.SoldOut, "服务可重复购买");
            c.frame++;
            Buy(counter, potion, c);
            Assert.AreEqual(90, c.hp, 1e-4f);
            Assert.AreEqual(920, c.coins);
            c.frame++;
            Buy(counter, potion, c);
            Assert.AreEqual(100, c.hp, 1e-4f);
            Assert.AreEqual(880, c.coins);
            c.frame++;
            Assert.AreEqual(TradeResult.Denied, Buy(counter, potion, c));
            Assert.AreEqual(880, c.coins, "满血满盾不收钱");
            Assert.AreEqual("生命与护盾已满", counter.LastRefusal);
            c.shield = 1;
            c.frame++;
            Buy(counter, potion, c);
            Assert.AreEqual(100, c.hp, 1e-4f);
            Assert.AreEqual(50, c.shield, 1e-4f);
            Assert.AreEqual(840, c.coins, "只缺护盾也能补");

            c.slots[0].reserve = 5;
            c.frame++;
            Buy(counter, ammo, c);
            Assert.AreEqual(100, c.slots[0].reserve);
            Assert.AreEqual(820, c.coins);
            Assert.IsFalse(ammo.SoldOut);
            c.slots[0].reserve = 0;
            c.frame++;
            Buy(counter, ammo, c);
            Assert.AreEqual(800, c.coins);
            Assert.AreEqual(2, c.ammo);
            c.frame++;
            Assert.AreEqual(TradeResult.Denied, Buy(counter, ammo, c));
            Assert.AreEqual(800, c.coins, "满弹不收钱");
            Assert.AreEqual("弹药已满", counter.LastRefusal);
        }

        [Test]
        public void CombatNearby_RefusesEveryTrade_ThenReopens()
        {
            var c = Customer();
            var counter = new ShopCounter();
            c.hostiles = 1;
            c.hp = 10;
            c.shield = 0;
            c.slots[0].reserve = 0;
            var offers = new IShopOffer[] { new PotionOffer(0), new AmmoOffer(0), new UpgradeOffer(), new WeaponOffer(NewWeapon(), 0), new ScrollOffer(new FakeScroll("s", "秘卷", 1, 1), 0) };
            foreach (var o in offers)
            {
                Assert.AreEqual(TradeResult.Denied, Buy(counter, o, c));
                c.frame++;
            }
            Assert.AreEqual(1000, c.coins, "交战中不扣钱");
            Assert.AreEqual(10, c.hp, 1e-4f);
            Assert.IsTrue(c.denials.All(d => d == ShopCounter.InCombat));
            c.hostiles = 0;
            Assert.AreEqual(TradeResult.Bought, Buy(counter, offers[0], c));
            Assert.AreEqual(50, c.hp, 1e-4f);
            Assert.AreEqual(960, c.coins);
        }

        [Test]
        public void BrokeModalDeadOrFull_NeverGrantOrCharge_ChapterPricesScale()
        {
            var c = Customer(2);
            var counter = new ShopCounter();
            var potion = new PotionOffer(2);
            var ammo = new AmmoOffer(2);
            Assert.AreEqual(60, potion.Prompt(c).cost);
            Assert.AreEqual(30, ammo.Prompt(c).cost);
            Buy(counter, potion, c);
            c.frame++;
            Buy(counter, ammo, c);
            Assert.AreEqual(1000, c.coins);
            Assert.AreEqual(0, c.heals + c.shields + c.ammo);

            c.hp = 40;
            c.shield = 0;
            c.slots[0].reserve = 0;
            c.coins = 29;
            c.frame++;
            Assert.AreEqual(TradeResult.Denied, Buy(counter, potion, c));
            c.frame++;
            Assert.AreEqual(TradeResult.Denied, Buy(counter, ammo, c));
            Assert.AreEqual(ShopCounter.NotEnough, counter.LastRefusal);
            Assert.AreEqual(29, c.coins);
            Assert.AreEqual(40, c.hp, 1e-4f);
            Assert.AreEqual(0, c.slots[0].reserve);

            c.coins = 1000;
            c.canTrade = false; // 模态 / 阵亡 / 暂停
            c.frame++;
            Assert.AreEqual(TradeResult.Ignored, Buy(counter, potion, c));
            c.frame++;
            Assert.AreEqual(TradeResult.Ignored, Buy(counter, ammo, c));
            Assert.AreEqual(1000, c.coins);
            Assert.AreEqual(0, c.spends);
        }

        [Test]
        public void ReentryAndSameFrameSecondCall_NeverDuplicateGrant()
        {
            var c = Customer();
            var counter = new ShopCounter();
            var potion = new PotionOffer(0);
            var ammo = new AmmoOffer(0);
            c.hp = 0;
            c.shield = 0;
            c.slots[0].reserve = 0;
            c.onSpend = () =>
            {
                Buy(counter, potion, c);
                Buy(counter, ammo, c);
            };
            Buy(counter, potion, c);
            Buy(counter, potion, c);
            Assert.AreEqual(40, c.hp, 1e-4f);
            Assert.AreEqual(960, c.coins);
            Assert.AreEqual(1, c.heals);
            Buy(counter, ammo, c);
            Assert.AreEqual(0, c.slots[0].reserve, "跨摊位回调与同帧第二笔都被挡下");
            c.frame++;
            Buy(counter, ammo, c);
            Assert.AreEqual(100, c.slots[0].reserve);
            Assert.AreEqual(1, c.ammo);
            c.frame++;
            Buy(counter, potion, c);
            Assert.AreEqual(80, c.hp, 1e-4f);
            Assert.AreEqual(2, c.heals);
            Assert.AreEqual(3, c.spends);
        }

        [Test]
        public void WeaponAndScrollAreFinite_UpgradeIsPaidAndRepeatable()
        {
            var c = Customer();
            var counter = new ShopCounter();
            var weapon = new WeaponOffer(NewWeapon(2), 0);
            var scroll = new ScrollOffer(new FakeScroll("left", "左秘卷", 1, 2), 0);
            var upgrade = new UpgradeOffer();
            Assert.AreEqual(TradeResult.Bought, Buy(counter, weapon, c));
            c.frame++;
            Assert.AreEqual(TradeResult.Ignored, Buy(counter, weapon, c));
            Assert.AreEqual(1, c.gives);
            Assert.AreEqual(1, c.dropped.Count, "换下的枪落在摊位前");
            Assert.IsTrue(weapon.SoldOut);
            Assert.AreEqual("已售罄", weapon.Note(c));

            c.frame++;
            Buy(counter, scroll, c);
            c.frame++;
            Buy(counter, scroll, c);
            Assert.AreEqual(1, c.gains);
            Assert.IsTrue(scroll.SoldOut);

            c.frame++;
            int initial = c.coins;
            Assert.AreEqual(50, upgrade.PriceFor(c));
            Buy(counter, upgrade, c);
            Buy(counter, upgrade, c);
            Assert.AreEqual(1, c.ActiveWeapon.level);
            Assert.AreEqual(initial - 50, c.coins);
            c.frame++;
            Buy(counter, upgrade, c);
            Assert.AreEqual(2, c.ActiveWeapon.level);
            Assert.AreEqual(initial - 125, c.coins);
            c.frame++;
            Buy(counter, upgrade, c);
            Assert.AreEqual(3, c.ActiveWeapon.level);
            c.frame++;
            int full = c.coins;
            Assert.AreEqual(TradeResult.Denied, Buy(counter, upgrade, c));
            Assert.AreEqual(full, c.coins);
            Assert.AreEqual("当前武器已满级", counter.LastRefusal);
            Assert.AreEqual("已满级", upgrade.Note(c));
            Assert.IsFalse(upgrade.SoldOut, "强化台不售罄");
        }

        [Test]
        public void ScrollAtMaxStacks_IsRefused()
        {
            var c = Customer();
            var counter = new ShopCounter();
            var def = new FakeScroll("maxed", "满层秘卷", 2, 2);
            c.scrolls["maxed"] = 2;
            var offer = new ScrollOffer(def, 0);
            Assert.AreEqual(TradeResult.Denied, Buy(counter, offer, c));
            Assert.AreEqual("该秘卷已达最大层数", counter.LastRefusal);
            Assert.AreEqual(1000, c.coins);
            Assert.IsTrue(offer.Prompt(c).lines.Any(l => l.Contains("最大层数")));
        }

        [Test]
        public void ClosedCounter_IgnoresStaleCallbacks()
        {
            var c = Customer();
            var counter = new ShopCounter();
            c.hp = 0;
            var potion = new PotionOffer(0);
            counter.Close();
            Assert.AreEqual(TradeResult.Ignored, Buy(counter, potion, c));
            Assert.AreEqual(1000, c.coins);
            Assert.AreEqual(0, c.heals);
        }

        // ───────────── 价格 / 货单 / 排布 / 预览 ─────────────

        [Test]
        public void Prices_ScaleByChapterAndRoundToFive()
        {
            Assert.AreEqual(40, ShopPricing.Potion(0));
            Assert.AreEqual(60, ShopPricing.Potion(2));
            Assert.AreEqual(20, ShopPricing.Ammo(0));
            Assert.AreEqual(30, ShopPricing.Ammo(2));
            Assert.AreEqual(180, ShopPricing.Price(145, 1), "181.25 → 180");
            Assert.AreEqual(140, ShopPricing.Price(110, 1), "137.5 → .5 进位 → 140");
            Assert.AreEqual(540, ShopPricing.Weapon(Rarity.Legendary, 2));
            Assert.AreEqual(new[] { 60, 100, 160, 240, 360 }, Enumerable.Range(0, 5).Select(r => ShopPricing.Weapon(r, 0)).ToArray());
            Assert.AreEqual(new[] { 80, 110, 145, 185, 220 }, Enumerable.Range(0, 5).Select(r => ShopPricing.Scroll(r, 0)).ToArray());
            Assert.AreEqual(5, ShopPricing.Price(1, 0), "至少 5");
        }

        [Test]
        public void Stock_OrdersStallsWithBenchInTheMiddle()
        {
            var mins = new List<int>();
            WeaponInstance Roller(int ch, int min)
            {
                mins.Add(min);
                return NewWeapon(Mathf.Max(1, min));
            }
            List<ScrollDef> Two(int n) => new() { new FakeScroll("a", "甲", 1, 1), new FakeScroll("b", "乙", 3, 1) };
            var s = ShopStock.Roll(0, Roller, Two, null);
            Assert.AreEqual(new[] { "weapon", "scroll", "potion", "upgrade", "ammo", "scroll", "weapon" }, s.offers.Select(o => o.Kind).ToArray());
            Assert.AreEqual(3, s.Middle);
            Assert.AreEqual(new[] { 0, Rarity.Uncommon }, mins.ToArray(), "第一章：右手武器保底精良");
            mins.Clear();
            var s1 = ShopStock.Roll(1, Roller, n => new List<ScrollDef> { new FakeScroll("a", "甲", 1, 1) }, null);
            Assert.AreEqual(Rarity.Rare, mins[1], "第二章起保底稀有");
            Assert.AreEqual(6, s1.offers.Count);
            var s0 = ShopStock.Roll(0, Roller, n => new List<ScrollDef>(), null);
            Assert.AreEqual(5, s0.offers.Count, "秘卷全部满层时只剩 5 个摊位");
            Assert.AreEqual("upgrade", s0.offers[s0.Middle].Kind);
            Assert.AreEqual(ShopPricing.Scroll(3, 0), ((ScrollOffer)s.offers[5]).PriceFor(null));
        }

        [Test]
        public void Layout_IsAnArcBehindTheCenterFacingIt()
        {
            var center = new Vector3(10, 2, -4);
            var st = ShopLayout.Build(center, 0);
            Assert.AreEqual(7, st.Count);
            foreach (var s in st)
            {
                var d = s.position - center;
                Assert.AreEqual(ShopLayout.ArcRadius, new Vector2(d.x, d.z).magnitude, 1e-4f);
                var cd = s.customer - center;
                Assert.AreEqual(4.7f, new Vector2(cd.x, cd.z).magnitude, 1e-4f, "顾客站位离中心 4.7 m");
                var to = center - s.position;
                Assert.AreEqual(Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg, s.facing, 1e-3f, "朝向中心");
            }
            Assert.AreEqual(center.x, st[3].position.x, 1e-4f);
            Assert.AreEqual(center.z - ShopLayout.ArcRadius, st[3].position.z, 1e-4f, "正中的强化台在中心正后方（商店正面朝 +Z）");
            var turned = ShopLayout.Build(center, 90);
            Assert.AreEqual(center.x - ShopLayout.ArcRadius, turned[3].position.x, 1e-4f, "正面朝 +X 时强化台在 −X 侧");
            float step = Vector3.Angle(st[0].position - center, st[1].position - center);
            Assert.AreEqual(ShopLayout.ArcStepDeg, step, 1e-2f);
        }

        [Test]
        public void UpgradePreview_ShowsTwelvePercentStep()
        {
            var lines = UpgradeOffer.PreviewLines(100, 200, 0);
            Assert.AreEqual("每级武器伤害 +12%", lines[0]);
            Assert.AreEqual("伤害  100 → 112 ▲", lines[1]);
            Assert.AreEqual("秒伤  200 → 224 ▲", lines[2]);
            Assert.AreEqual(1.36f / 1.24f, UpgradeOffer.UpgradeRatio(2), 1e-5f);
            var c = Customer();
            var p = new UpgradeOffer().Prompt(c);
            Assert.AreEqual(50, p.cost);
            Assert.IsTrue(p.canAfford);
            Assert.IsTrue(p.subtitle.Contains("+0 → +1"));
            c.slots[1] = NewWeapon();
            p = new UpgradeOffer().Prompt(c);
            Assert.IsTrue(p.lines.Any(l => l.Contains("切枪")), "另一个槽位也列出来（切枪选择强化目标）");
        }
    }
}
