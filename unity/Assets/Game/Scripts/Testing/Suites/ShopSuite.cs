using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 商店冒烟（R3，bridge.sh playtest shop；场景 TestArena）：在测试场东南的 SupplyCamp 标记处（场景没重建时用同样的坐标）开一家店——
    ///   · 摆摊：7 个摊位（两把枪、两卷秘卷、药剂、弹药箱、居中的强化台）、贴地（每个摊位脚下就是地面）、价格牌有字、招牌；
    ///   · 按住购买：站到每个摊位的顾客站位、对着它按交互键（Interactor 的测试按键），按住 0.4 s 后成交——扣的钱 = 标价，效果到位（换枪 / 秘卷层数 / 回血回盾 / 补满备弹 / 强化 +1）；
    ///   · 防误买：按下后立刻松手不成交；售罄的摊位收起展示物、价格牌写「已售罄」、不能再交互；
    ///   · 拒绝：没钱「灵石不足」、附近有敌人「战斗中无法交易」、满级「当前武器已满级」、满血满盾「生命与护盾已满」——都不扣钱；
    ///   · 撤店：之前拿到的摊位再买也不会成交，交互登记清空。
    /// </summary>
    public sealed class ShopSuite : PlaytestSuite
    {
        public override string Id => "shop";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        /// <summary>测试场里商店的位置（与 Level_TestArena 的 SupplyCamp 标记一致）</summary>
        public static readonly Vector3 FallbackCenter = new(40, 0, -34);

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Interactor interactor;
        Transform eye;
        Shop shop;
        int logErrors;
        string lastError;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            interactor = vitals ? vitals.GetComponent<Interactor>() : null;
            if (!weapons || !motor || !vitals || !interactor || !LootDirector.Instance)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} interactor={interactor} loot={LootDirector.Instance}（场景不是 TestArena？）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            ShopStall.TestHeld = true;
            Application.logMessageReceived += OnLog;
            EnemyRegistry.PurgeAll();

            yield return Build();
            if (shop)
            {
                yield return BuyEach();
                yield return HoldCancel();
                yield return Refusals();
                yield return CloseCase();
            }

            ShopStall.TestHeld = true;
            Application.logMessageReceived -= OnLog;
            if (shop) shop.Close();
            Line($"合计：运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        // ───────────── 摆摊 ─────────────

        IEnumerator Build()
        {
            var marker = GameObject.Find("SupplyCamp");
            var center = marker ? marker.transform.position : FallbackCenter;
            var spawn = GameObject.Find("PlayerSpawn");
            var toward = (spawn ? spawn.transform.position : new Vector3(0, 0, -44)) - center;
            float yaw = marker ? marker.transform.eulerAngles.y : Mathf.Atan2(toward.x, toward.z) * Mathf.Rad2Deg;
            if (!marker) Line($"场景里没有 SupplyCamp 标记（TestArena 还没重建：bridge.sh level arena），在 {center} 开店");
            // 两卷秘卷都摆上（实机一半概率只有一卷）
            var inv = LootDirector.Instance.scrolls;
            var stock = ShopStock.Roll(EconomyConfig.Chapter, (ch, min) => WeaponRoller.Roll(new WeaponRoller.RollOptions { chapter = ch, minRarity = min }),
                n => ScrollLibrary.Roll(inv, n), null);
            shop = Shop.Spawn(center, yaw, stock);
            yield return null;
            var kinds = shop.Stalls.Select(s => s.Offer.Kind).ToList();
            float worstSnap = 0;
            foreach (var s in shop.Stalls)
            {
                var p = s.transform.position;
                // 地面 = 脚下最近的、不属于商店的碰撞体
                float ground = float.NaN, best = float.PositiveInfinity;
                foreach (var h in Physics.RaycastAll(p + Vector3.up * 3f, Vector3.down, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                {
                    if (h.collider.transform.IsChildOf(shop.transform) || h.distance >= best) continue;
                    best = h.distance;
                    ground = h.point.y;
                }
                if (float.IsNaN(ground)) Fail($"摊位 {s.Offer.Kind} 脚下没有地面");
                else worstSnap = Mathf.Max(worstSnap, Mathf.Abs(ground - p.y));
            }
            Line($"摆摊：{shop.Stalls.Count} 个（{string.Join("、", kinds)}），正中 {kinds.ElementAtOrDefault(stock.Middle)}，贴地偏差最大 {worstSnap:F2} m，" +
                 $"价格牌「{shop.Stalls.FirstOrDefault()?.TagText?.Replace('\n', ' ')}」");
            if (shop.Stalls.Count != 7) Fail($"摊位 {shop.Stalls.Count} 个（两卷秘卷时应 7 个）");
            if (kinds.ElementAtOrDefault(stock.Middle) != "upgrade") Fail("强化台不在正中");
            if (worstSnap > 0.1f) Fail($"摊位没贴地（偏差 {worstSnap:F2} m）");
            if (shop.Stalls.Any(s => string.IsNullOrEmpty(s.TagText))) Fail("有摊位的价格牌没有字");
            Teleport(motor, center + (Quaternion.Euler(0, yaw, 0) * Vector3.forward) * 3f);
            Aim(motor, eye, center + Vector3.up * 1.2f - (Quaternion.Euler(0, yaw, 0) * Vector3.forward) * 6f);
            yield return null;
            Shot(weapons.eye, "shop_overview");
        }

        // ───────────── 逐摊购买 ─────────────

        IEnumerator BuyEach()
        {
            var run = RunState.Ensure();
            run.coins = 0;
            run.Credit(5000, "playtest");
            var seen = new HashSet<string>();
            foreach (var stall in shop.Stalls.ToList())
            {
                var o = stall.Offer;
                // 先把状态弄成「需要这项服务」
                if (o is PotionOffer)
                {
                    vitals.health = vitals.MaxHealth * 0.2f;
                    vitals.shield = 0;
                }
                if (o is AmmoOffer)
                    foreach (var w in weapons.slots)
                        if (w != null)
                            w.reserve = 0;
                if (o is UpgradeOffer && weapons.Active != null) weapons.Active.level = 0;
                int coins0 = run.coins, price = o.PriceFor(PlayerShopCustomer.Instance);
                var active0 = weapons.Active;
                int level0 = active0?.level ?? -1;
                float hp0 = vitals.health;
                string scrollId = (o as ScrollOffer)?.scroll?.id;
                int stacks0 = scrollId != null ? LootDirector.Instance.scrolls.Stacks(scrollId) : 0;
                int pickups0 = FindObjectsByType<WeaponPickup>(FindObjectsSortMode.None).Length;

                yield return Hold(stall);

                int paid = coins0 - run.coins;
                string effect;
                bool ok;
                switch (o)
                {
                    case WeaponOffer wo:
                        ok = weapons.slots.Contains(wo.weapon) && o.SoldOut;
                        effect = $"拿到 {wo.weapon.Title}（{(weapons.Active == wo.weapon ? "手上" : "副槽")}），地上的枪 {pickups0} → {FindObjectsByType<WeaponPickup>(FindObjectsSortMode.None).Length}";
                        break;
                    case ScrollOffer so:
                        int stacks = LootDirector.Instance.scrolls.Stacks(scrollId);
                        ok = stacks == stacks0 + 1 && o.SoldOut;
                        effect = $"秘卷「{so.scroll.name}」{stacks0} → {stacks} 层";
                        break;
                    case PotionOffer:
                        ok = vitals.health > hp0 + 1 && vitals.shield >= vitals.MaxShield - 0.01f && !o.SoldOut;
                        effect = $"生命 {hp0:F0} → {vitals.health:F0}，护盾 {vitals.shield:F0}/{vitals.MaxShield:F0}";
                        break;
                    case AmmoOffer:
                        ok = weapons.slots.Where(w => w != null).All(w => w.reserve >= WeaponStatsResolver.Resolve(w).reserveCap) && !o.SoldOut;
                        effect = $"备弹 {string.Join(" / ", weapons.slots.Where(w => w != null).Select(w => $"{w.reserve}/{WeaponStatsResolver.Resolve(w).reserveCap}"))}";
                        break;
                    case UpgradeOffer:
                        ok = active0 != null && active0.level == level0 + 1;
                        effect = $"{active0?.Title} +{level0} → +{active0?.level}，价格牌「{stall.TagText.Replace('\n', ' ')}」";
                        break;
                    default:
                        ok = false;
                        effect = "?";
                        break;
                }
                bool priceOk = paid == price;
                Line($"购买 {o.Kind}「{o.Title(PlayerShopCustomer.Instance)}」：标价 {price}，扣 {paid} {(priceOk ? "✓" : "✗")}，{effect} {(ok ? "✓" : "✗")}");
                if (!priceOk) Fail($"{o.Kind}：扣的钱 {paid} ≠ 标价 {price}（按住购买没成交？柜台理由：{shop.Counter.LastRefusal}）");
                if (!ok) Fail($"{o.Kind}：效果不对（{effect}）");
                if (seen.Add(o.Kind)) Shot(weapons.eye, $"shop_{o.Kind}");
                if (o.SoldOut)
                {
                    yield return new WaitForSeconds(0.3f);
                    bool soldTag = stall.TagText.Contains("已售罄");
                    if (!soldTag || stall.CanInteract) Fail($"{o.Kind} 售罄后价格牌「{stall.TagText}」/ 仍可交互 {stall.CanInteract}");
                }
                yield return new WaitForSeconds(0.1f);
            }
        }

        /// <summary>站到摊位前、对着它按交互键、按住到成交</summary>
        IEnumerator Hold(ShopStall stall)
        {
            Teleport(motor, stall.CustomerSpot);
            Aim(motor, eye, stall.Focus);
            yield return null;
            yield return null;
            ShopStall.TestHeld = true;
            interactor.testInteract = true;
            float t0 = Time.time;
            while (Time.time - t0 < ShopStall.HoldSeconds + 0.4f)
            {
                Aim(motor, eye, stall.Focus);
                yield return null;
            }
        }

        // ───────────── 防误买 / 拒绝 ─────────────

        IEnumerator HoldCancel()
        {
            var potion = shop.Find("potion");
            if (!potion) yield break;
            vitals.health = vitals.MaxHealth * 0.3f;
            int coins0 = RunState.Current.coins;
            Teleport(motor, potion.CustomerSpot);
            Aim(motor, eye, potion.Focus);
            yield return null;
            yield return null;
            interactor.testInteract = true;
            yield return null;
            bool started = potion.HoldProgress > 0 || interactor.Current == (IInteractable)potion;
            ShopStall.TestHeld = false; // 立刻松手
            float t0 = Time.time;
            while (Time.time - t0 < ShopStall.HoldSeconds + 0.3f) yield return null;
            ShopStall.TestHeld = true;
            bool bought = RunState.Current.coins != coins0;
            Line($"防误买：按下即松手 {(bought ? "✗ 成交了" : "✓ 没成交")}（交互器对准 {(started ? "✓" : "✗")}）");
            if (bought) Fail("按下就松手也成交了（按住购买没生效）");
            if (!started) Fail("交互器没有对准药剂摊（站位 / 朝向不对）");
        }

        IEnumerator Refusals()
        {
            var run = RunState.Current;
            var c = PlayerShopCustomer.Instance;
            // 没钱
            var ammo = shop.Find("ammo");
            if (ammo)
            {
                foreach (var w in weapons.slots)
                    if (w != null)
                        w.reserve = 0;
                run.coins = 0;
                yield return null;
                ammo.RefreshTag();
                var r = ammo.BuyNow();
                bool red = ammo.TagText.Contains("ff5a4f");
                Line($"没钱买弹药：{r}「{shop.Counter.LastRefusal}」，价格牌标红 {(red ? "✓" : "✗")}");
                if (r != TradeResult.Denied || shop.Counter.LastRefusal != ShopCounter.NotEnough) Fail($"没钱时应拒绝「{ShopCounter.NotEnough}」，结果 {r}「{shop.Counter.LastRefusal}」");
                if (weapons.slots.Any(w => w != null && w.reserve > 0)) Fail("没钱也补了弹药");
                if (!red) Fail("钱不够时价格牌没有标红");
            }
            run.Credit(3000, "playtest");
            yield return null;

            // 满血满盾
            var potion = shop.Find("potion");
            if (potion)
            {
                vitals.Heal(99999);
                vitals.AddShield(99999);
                int c0 = run.coins;
                var r = potion.BuyNow();
                Line($"满血买药：{r}「{shop.Counter.LastRefusal}」");
                if (r != TradeResult.Denied || run.coins != c0) Fail("满血满盾时买药没有被拒 / 扣了钱");
            }
            yield return null;

            // 满级
            var bench = shop.Find("upgrade");
            if (bench && weapons.Active != null)
            {
                weapons.Active.level = WeaponLibrary.MaxUpgrade;
                yield return null;
                int c0 = run.coins;
                var r = bench.BuyNow();
                bench.RefreshTag();
                Line($"满级强化：{r}「{shop.Counter.LastRefusal}」，价格牌「{bench.TagText.Replace('\n', ' ')}」");
                if (r != TradeResult.Denied || run.coins != c0) Fail("满级时强化没有被拒 / 扣了钱");
                if (!bench.TagText.Contains("已满级")) Fail("满级时价格牌没写「已满级」");
                weapons.Active.level = 0;
            }
            yield return null;

            // 战斗中
            if (potion)
            {
                vitals.health = vitals.MaxHealth * 0.3f;
                var e = EnemyRoster.Spawn("jerboa_blade", potion.transform.position + potion.transform.forward * 8f, Quaternion.identity, 1, false);
                yield return null;
                int c0 = run.coins;
                var r = potion.BuyNow();
                Line($"附近有敌人时买药：{r}「{shop.Counter.LastRefusal}」");
                if (r != TradeResult.Denied || shop.Counter.LastRefusal != ShopCounter.InCombat || run.coins != c0) Fail("附近有敌人时应拒绝「战斗中无法交易」且不扣钱");
                if (e) Destroy(e.gameObject);
                EnemyRegistry.PurgeAll();
                yield return null;
                yield return null;
                var r2 = potion.BuyNow();
                Line($"敌人清掉后买药：{r2}");
                if (r2 != TradeResult.Bought) Fail($"敌人清掉后仍买不了药（{shop.Counter.LastRefusal}）");
            }
        }

        IEnumerator CloseCase()
        {
            var stale = shop.Stalls.Where(s => s).ToList();
            var potion = shop.Find("potion");
            vitals.health = vitals.MaxHealth * 0.3f;
            int c0 = RunState.Current.coins;
            shop.Close();
            // 同一帧（物体还没销毁）拿旧摊位再买：柜台已关，一笔都不成交
            var results = stale.Select(s => s ? s.BuyNow() : TradeResult.Ignored).ToList();
            bool canInteract = potion && potion.CanInteract;
            yield return null;
            bool registered = Interaction.All.Any(i => i is ShopStall);
            Line($"撤店：旧摊位再买 {results.Count(r => r == TradeResult.Bought)} 笔成交，交互登记里还有摊位 {(registered ? "✗" : "✓ 没有")}");
            if (results.Any(r => r == TradeResult.Bought) || RunState.Current.coins != c0) Fail("撤店后旧摊位还能成交");
            if (registered) Fail("撤店后交互登记里还有摊位");
            if (canInteract) Fail("撤店后摊位仍可交互");
            shop = null;
        }
    }
}
