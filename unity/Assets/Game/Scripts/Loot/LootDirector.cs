using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 掉落与奖励（Three.js 版 src/progression/Loot.ts，数值见 <see cref="EconomyConfig"/>）：
    ///   击杀：灵石 = EnemyDef.coins 掷整数 × 精英 3 × (1 + 0.15 × 章)（不是名册生成的单位按耐久折算）；首领没写时 60–100，另加首领包（2 弹药 + 2 生命）。
    ///         弹药 30%（所有枪弹匣 + 备弹都低于 35% 时 50%）、生命 10%；精英必掉弹药与生命，6% 掉灵兽封印；
    ///         秘卷「收割 / 摄魂」的击杀回血回盾在这里结算。静默处决、分身等 noReward 的死亡什么都不掉。
    ///   场地肃清 / 本关完成：0.8 s 后场上掉落物吸向玩家；场地配了奖励就落一个宝箱，档位按场地（有精英 → 精英，首领关 → 首领）。
    ///   进新关：补给 35% 备弹（第一关开局本来就满）。
    ///   Grant：宝箱奖励发放（按 key 分给 Loot/Rewards 的处理器）。
    ///   秘卷三选一：排队弹出（一次只开一个，两次之间隔 0.6 s；有别的模态界面、玩家阵亡时等着）；带保底稀有度，
    ///         保底池抽空就放宽，全部满层改发灵石 40 × 张数 × (1 + 0.35 × 章)。获得提示带稀有度色。
    /// 灵石一律先掉成拾取物，捡起时入账并乘灵石获取（<see cref="EconomyConfig.CreditCoins"/>）；场上掉落物满 240 个时直接入账。
    /// </summary>
    public sealed class LootDirector : MonoBehaviour
    {
        public static LootDirector Instance { get; private set; }

        const float OfferGap = 0.6f;

        public readonly ScrollInventory scrolls = new();
        readonly Queue<(int count, int minRarity)> offers = new();
        float offerReadyAt;

        void Awake() => Instance = this;

        void OnEnable()
        {
            GameEvents.EnemyKilled += OnKilled;
            EncounterSite.AnySiteCleared += OnSiteCleared;
            GameEvents.StageLoaded += OnStageLoaded;
            GameEvents.StageCleared += OnStageCleared;
            GameEvents.RunStarted += OnRunStarted;
        }

        void OnDisable()
        {
            GameEvents.EnemyKilled -= OnKilled;
            EncounterSite.AnySiteCleared -= OnSiteCleared;
            GameEvents.StageLoaded -= OnStageLoaded;
            GameEvents.StageCleared -= OnStageCleared;
            GameEvents.RunStarted -= OnRunStarted;
            if (Instance == this) Instance = null;
        }

        // Core 常驻，只在退出 Play / 卸载 Core 时销毁：卸掉秘卷，免得它们挂在静态事件上的回调活到下一次编译（编辑器退出 Play 不重载域）
        void OnDestroy() => scrolls.Clear();

        static RunRng Rng => RunState.Ensure().Stream("loot");

        void OnRunStarted(RunState s)
        {
            offers.Clear();
            offerReadyAt = 0;
        }

        void OnStageLoaded(StageSpec s)
        {
            var pv = PlayerVitals.Instance;
            var wc = pv ? pv.GetComponent<WeaponController>() : null;
            if (wc) wc.RefillReserve(EconomyConfig.StageAmmoRefill);
        }

        /// <summary>本关完成：场上掉落物吸向玩家（同 TS stage:cleared → vacuumCoins）</summary>
        void OnStageCleared(StageSpec s) => Pickup.Vacuum(EconomyConfig.VacuumDelay);

        void OnKilled(in KillEvent e)
        {
            var d = e.enemy;
            var pv = PlayerVitals.Instance;
            if (!d || d.noReward || !pv || ScrollKit.IsPurgeKill(in e)) return;
            var pos = ReactionSystem.CenterOf(d);
            var rng = Rng;
            int chapter = EconomyConfig.Chapter;
            var def = KillResolver.DefOf(d);
            var range = def != null ? def.coins : BulkCoins(d);
            int coins = EconomyConfig.KillCoins(range, d.rank, chapter, rng);
            if (coins > 0) DropCoins(pos, coins, d.IsBoss ? EconomyConfig.BossCoinToss : d.elite ? EconomyConfig.EliteCoinToss : 1f);

            if (d.IsBoss)
            {
                // 首领包：弹药、生命各两份，抛得更远
                for (int i = 0; i < EconomyConfig.BossPackAmmo; i++) Pickup.Spawn(Pickup.Kind.Ammo, pos, EconomyConfig.AmmoPickupFrac, 1.8f);
                for (int i = 0; i < EconomyConfig.BossPackHealth; i++) Pickup.Spawn(Pickup.Kind.Health, pos, 0, 1.8f);
            }
            else
            {
                float ammoChance = AllWeaponsLow(pv) ? EconomyConfig.AmmoDropChanceLow : EconomyConfig.AmmoDropChance;
                if (d.elite || rng.Chance(ammoChance)) Pickup.Spawn(Pickup.Kind.Ammo, pos, EconomyConfig.AmmoPickupFrac);
                if (d.elite || rng.Chance(EconomyConfig.HealthDropChance)) Pickup.Spawn(Pickup.Kind.Health, pos, 0);
                if (d.elite && rng.Chance(EconomyConfig.ElitePetChance)) PetSeal.DropRandom(pos, null, true);
            }

            float kh = pv.stats.Get(Stat.KillHeal), ks = pv.stats.Get(Stat.KillShield);
            if (kh > 0) pv.Heal(kh);
            if (ks > 0) pv.AddShield(ks);
        }

        /// <summary>不是名册生成的单位（训练木桩、关卡里手摆的敌人）：按耐久折算灵石区间（Unity 旧规则，TS 给 0）</summary>
        static Vector2Int BulkCoins(Damageable d)
        {
            float bulk = d.maxHealth + d.maxArmor + d.maxShield;
            int mid = Mathf.Clamp(Mathf.RoundToInt(bulk / 40f), 2, 14);
            return new Vector2Int(Mathf.Max(1, mid - 1), mid + 1);
        }

        /// <summary>每把枪的（弹匣 + 备弹）都低于容量的 35%：真的快没子弹了</summary>
        static bool AllWeaponsLow(PlayerVitals pv)
        {
            var wc = pv.GetComponent<WeaponController>();
            if (!wc) return false;
            bool any = false;
            foreach (var w in wc.slots)
            {
                if (w == null) continue;
                var r = WeaponStatsResolver.Resolve(w, pv.stats);
                int cap = r.magCap + r.reserveCap;
                if (cap <= 0) continue;
                any = true;
                if ((w.mag + w.reserve) / (float)cap >= EconomyConfig.LowAmmoFrac) return false;
            }
            return any;
        }

        /// <summary>
        /// 一笔灵石拆成几颗抛出（每颗约 3，最多 14 颗，≥ 60 的大笔最多 22 颗）；场上满了的部分直接入账。
        /// lateVacuum：奖励灵石，落地展示 1.1 s 后自动吸向玩家。灵石获取加成在入账时乘（这里给的是基数）
        /// </summary>
        public static void DropCoins(Vector3 pos, int amount, float toss = 1f, bool lateVacuum = false)
        {
            if (amount <= 0) return;
            int maxPieces = amount >= EconomyConfig.LargeCoinAmount ? EconomyConfig.MaxCoinPiecesLarge : EconomyConfig.MaxCoinPieces;
            int pieces = Mathf.Clamp(Mathf.CeilToInt(amount / (float)EconomyConfig.CoinPieceValue), 1, maxPieces);
            int each = amount / pieces, rem = amount - each * pieces, overflow = 0;
            for (int i = 0; i < pieces; i++)
            {
                int v = each + (i < rem ? 1 : 0);
                if (v <= 0) continue;
                var p = Pickup.Spawn(Pickup.Kind.Coin, pos, v, toss);
                if (!p) overflow += v;
                else if (lateVacuum) p.VacuumAfter(EconomyConfig.LateVacuumDelay);
            }
            if (overflow > 0) EconomyConfig.CreditCoins(overflow, "overflow");
        }

        void OnSiteCleared(EncounterSite site)
        {
            Pickup.Vacuum(EconomyConfig.VacuumDelay);
            if (string.IsNullOrEmpty(site.reward)) return;
            var p = site.transform.position + site.chestOffset;
            if (NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas)) p = hit.position;
            var face = PlayerVitals.Instance ? PlayerVitals.Instance.transform.position : p + Vector3.forward;
            Chest.Spawn(p, site.reward, face, TierOf(site));
            GameUI.Toast("宝箱出现了");
        }

        /// <summary>场地宝箱的档位：首领关 → 首领；场地里有精英 → 精英；其余普通</summary>
        public static ChestTier TierOf(EncounterSite site)
        {
            if (RunState.Current?.Stage is { IsBoss: true }) return ChestTier.Boss;
            if (site != null)
                foreach (var s in site.squads)
                    if (s != null && s.elite) return ChestTier.Elite;
            return ChestTier.Normal;
        }

        /// <summary>
        /// 宝箱奖励："weapon[:&lt;id&gt;][:稀有度][:min=N]" / "scroll[:min=N][:count=N]" / "coins[:tier=elite]" / "heal" / "upgrade" /
        /// "pet"（按权重抽）/ "pet:&lt;id&gt;" / "pet:rarity=&lt;0–2&gt;"。
        /// 按 key 分发给 Loot/Rewards 里的处理器（<see cref="RewardRegistry"/>）；新奖励种类加一个 &lt;Kind&gt;Reward.cs 就行。
        /// 宝箱档位已由 <see cref="EconomyConfig.ApplyTier"/> 写进奖励串。
        /// </summary>
        public void Grant(string reward, Vector3 pos) => RewardRegistry.Grant(reward, pos, this);

        /// <summary>排队一次秘卷三选一（minRarity：精英 / 首领奖励保底精良）</summary>
        public void OfferScrolls(int count, int minRarity = 0) => offers.Enqueue((Mathf.Max(1, count), Rarity.Clamp(minRarity)));

        /// <summary>排队中的三选一个数（测试 / 调试）</summary>
        public int PendingOffers => offers.Count;

        void Update()
        {
            if (offers.Count == 0 || ScrollChoice.Open || GameStateMachine.Blocked || Time.unscaledTime < offerReadyAt) return;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var (count, minRarity) = offers.Dequeue();
            var choices = ScrollLibrary.Roll(scrolls, count, minRarity);
            if (choices.Count == 0 && minRarity > 0) choices = ScrollLibrary.Roll(scrolls, count);
            if (choices.Count == 0)
            {
                int coins = EconomyConfig.RewardCoins(EconomyConfig.ScrollFallbackCoinsPerCard * count, EconomyConfig.Chapter);
                GameUI.Toast("秘卷已全部满层，改为灵石", new Color(1f, 0.84f, 0.29f));
                DropCoins(pv.transform.position + Vector3.up * 1.2f, coins, 1.2f, true);
                offerReadyAt = Time.unscaledTime + OfferGap;
                return;
            }
            ScrollChoice.Show(choices, scrolls, def =>
            {
                if (scrolls.Gain(def, pv))
                {
                    int n = scrolls.Stacks(def.id);
                    string stackText = def.maxStacks > 1 ? $"（{n}/{def.maxStacks} 层）" : "";
                    GameUI.Toast($"获得{Rarity.Name(def.rarity)}秘卷「{def.name}」{stackText}", Rarity.Color(def.rarity));
                }
                else GameUI.Toast($"「{def.name}」已达最大层数", new Color(0.6f, 0.63f, 0.66f));
                offerReadyAt = Time.unscaledTime + OfferGap;
            });
        }
    }
}
