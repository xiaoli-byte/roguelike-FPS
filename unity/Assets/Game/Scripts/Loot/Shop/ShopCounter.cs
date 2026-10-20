using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一次购买的结果：成交 / 被拒（有提示）/ 忽略（售罄、同一帧、不在游玩状态、玩家阵亡：什么都不说）</summary>
    public enum TradeResult { Bought, Denied, Ignored }

    /// <summary>
    /// 一家店的柜台（交易核心，纯逻辑，EditMode 可测；Three.js Shop.buy）：
    ///   忽略：商品售罄 / 已下架、正在成交中（发事件时回调又来买 = 重入）、同一帧已经成交过一笔（同帧连按 / 跨摊位回调）、不在正常游玩（暂停、模态、结算）、玩家阵亡；
    ///   拒绝（红字提示 + 拒绝音，不扣钱）：附近还有交战中的敌人「战斗中无法交易」→ 商品自己的理由（满血、满弹、满层、满级）→「灵石不足」；
    ///   成交：先上锁、记帧，再扣钱（发 CoinsChanged，监听者可能重入——锁已经在了）、发货，最后解锁。
    /// </summary>
    public sealed class ShopCounter
    {
        public const string InCombat = "战斗中无法交易", NotEnough = "灵石不足", Unavailable = "现在无法购买";

        bool transacting;
        int lastFrame = int.MinValue;

        /// <summary>柜台已撤（商店拆了）：之后的一切调用都忽略（旧回调不能再交易）</summary>
        public bool Closed { get; private set; }
        /// <summary>最近一次拒绝的理由（测试 / 调试）</summary>
        public string LastRefusal { get; private set; }
        /// <summary>成交笔数</summary>
        public int Sales { get; private set; }

        public void Close() => Closed = true;

        /// <summary>买 offer。at = 摊位位置（判断附近的敌人），front = 摊位前方（被换下的枪落在这里）</summary>
        public TradeResult TryBuy(IShopOffer offer, IShopCustomer c, Vector3 at, Vector3 front)
        {
            if (Closed || offer == null || c == null || offer.SoldOut || transacting) return TradeResult.Ignored;
            int frame = c.Frame;
            if (frame == lastFrame || !c.CanTrade) return TradeResult.Ignored;
            if (c.HostilesNear(at) > 0) return Deny(c, InCombat);
            string why = offer.Refusal(c);
            if (!string.IsNullOrEmpty(why)) return Deny(c, why);
            int price = offer.PriceFor(c);
            if (price < 0) return Deny(c, Unavailable);
            if (c.Coins < price) return Deny(c, NotEnough);
            // 先上锁再发事件：扣钱会派发 CoinsChanged，监听者可能在同一帧里再来买
            transacting = true;
            lastFrame = frame;
            try
            {
                if (!c.TrySpend(price)) return Deny(c, NotEnough);
                c.Sound("buy");
                offer.Grant(c, front);
                Sales++;
                LastRefusal = null;
                return TradeResult.Bought;
            }
            finally
            {
                transacting = false;
            }
        }

        TradeResult Deny(IShopCustomer c, string why)
        {
            LastRefusal = why;
            c.Deny(why);
            return TradeResult.Denied;
        }
    }

    /// <summary>
    /// 一家店的货（Three.js Shop.spawn 的商品清单，玩家视角从左到右）：
    ///   左：武器（按章节稀有度表掷）、秘卷 1、战备药剂；中：强化台；右：弹药箱、秘卷 2（一半概率有）、武器（第二章起保底稀有，第一章保底精良）。
    /// 秘卷抽不出来（全部满层）时那个摊位不摆，所以一家店 5–7 个摊位。
    /// </summary>
    public sealed class ShopStock
    {
        public readonly List<IShopOffer> offers = new();
        /// <summary>强化台在 offers 里的下标（排在正中）</summary>
        public int Middle { get; private set; }

        /// <summary>按当前局掷一份货（chapter 0 起）</summary>
        public static ShopStock Roll(int chapter, Func<int, int, WeaponInstance> rollWeapon, Func<int, List<ScrollDef>> rollScrolls, RunRng rng)
        {
            var s = new ShopStock();
            var w1 = rollWeapon?.Invoke(chapter, 0);
            var w2 = rollWeapon?.Invoke(chapter, chapter >= 1 ? Rarity.Rare : Rarity.Uncommon);
            int want = rng == null || rng.Chance(0.5f) ? 2 : 1;
            var scrolls = rollScrolls?.Invoke(want) ?? new List<ScrollDef>();
            var left = new List<IShopOffer>();
            if (w1 != null) left.Add(new WeaponOffer(w1, chapter));
            if (scrolls.Count > 0 && scrolls[0] != null) left.Add(new ScrollOffer(scrolls[0], chapter));
            left.Add(new PotionOffer(chapter));
            var right = new List<IShopOffer> { new AmmoOffer(chapter) };
            if (scrolls.Count > 1 && scrolls[1] != null) right.Add(new ScrollOffer(scrolls[1], chapter));
            if (w2 != null) right.Add(new WeaponOffer(w2, chapter));
            s.offers.AddRange(left);
            s.Middle = left.Count;
            s.offers.Add(new UpgradeOffer());
            s.offers.AddRange(right);
            return s;
        }

        /// <summary>实机：武器走 <see cref="WeaponRoller"/>，秘卷走 <see cref="ScrollLibrary.Roll"/>（同三选一的抽法：不重复、未满层、英雄专属）</summary>
        public static ShopStock RollForRun(int chapter)
        {
            var run = RunState.Current;
            var rng = run != null ? run.Stream("shop") : new RunRng(Environment.TickCount);
            var loot = LootDirector.Instance;
            return Roll(chapter,
                (ch, min) => WeaponRoller.Roll(new WeaponRoller.RollOptions { chapter = ch, minRarity = min }),
                n => loot ? ScrollLibrary.Roll(loot.scrolls, n) : new List<ScrollDef>(),
                rng);
        }
    }

    /// <summary>一个摊位的位置：柜台中心、顾客站位（柜台正前方 1.7 m）、朝向（世界 yaw，度，朝向商店中心）</summary>
    public struct ShopStation
    {
        public Vector3 position, customer;
        public float facing;
    }

    /// <summary>
    /// 商店的弧形排布（Three.js shopLayout.ts，纯函数）：摊位排在商店中心「后方」半径 6.4 m 的弧上，每 25° 一个，正中（middle）在中心正后方；
    /// 每个摊位朝向中心，顾客站位在柜台前 1.7 m（离中心 4.7 m）。yaw = 商店正面朝向（世界 yaw，度：玩家从这一面走来）
    /// </summary>
    public static class ShopLayout
    {
        public const float ArcRadius = 6.4f, StallHalfWidth = 0.62f, CustomerHalfWidth = 0.5f, CounterFront = 1.7f, ArcStepDeg = 25f;

        public static List<ShopStation> Build(Vector3 center, float yawDeg, int count = 7, int middle = 3)
        {
            var list = new List<ShopStation>(count);
            float yaw = yawDeg * Mathf.Deg2Rad, cy = Mathf.Cos(yaw), sy = Mathf.Sin(yaw);
            for (int i = 0; i < count; i++)
            {
                float a = (i - middle) * ArcStepDeg * Mathf.Deg2Rad;
                float lx = Mathf.Sin(a) * ArcRadius, lz = -Mathf.Cos(a) * ArcRadius;
                var p = new Vector3(center.x + lx * cy + lz * sy, center.y, center.z - lx * sy + lz * cy);
                float facing = Mathf.Atan2(center.x - p.x, center.z - p.z);
                list.Add(new ShopStation
                {
                    position = p,
                    facing = facing * Mathf.Rad2Deg,
                    customer = new Vector3(p.x + Mathf.Sin(facing) * CounterFront, center.y, p.z + Mathf.Cos(facing) * CounterFront),
                });
            }
            return list;
        }
    }
}
