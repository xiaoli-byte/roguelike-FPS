using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 掉落与奖励（Three.js 版 src/progression/Loot.ts）：
    ///   击杀：灵石（按敌人基础耐久折算，精英 ×3）、弹药 30%（所有枪备弹都低于 35% 时 50%）、生命 10%；精英必掉弹药与生命，6% 掉灵兽封印；
    ///         秘卷「收割 / 摄魂」的击杀回血回盾在这里结算。分身、自爆等 noReward 的死亡什么都不掉
    ///   场地肃清：场上灵石全部吸向玩家；场地配了奖励就在场地上落一个宝箱
    ///   Grant：宝箱奖励发放（按 key 分给 Loot/Rewards 的处理器）；秘卷三选一排队弹出（一次只开一个，两次之间隔 0.6 s）
    /// </summary>
    public sealed class LootDirector : MonoBehaviour
    {
        public static LootDirector Instance { get; private set; }

        const float AmmoChance = 0.3f, AmmoChanceLow = 0.5f, LowAmmo = 0.35f, HealthChance = 0.1f, OfferGap = 0.6f, ElitePetChance = 0.06f;

        public readonly ScrollInventory scrolls = new();
        readonly Queue<int> offers = new();
        float offerReadyAt;

        void Awake() => Instance = this;

        void OnEnable()
        {
            Combat.EnemyKilled += OnKilled;
            EncounterSite.AnySiteCleared += OnSiteCleared;
        }

        void OnDisable()
        {
            Combat.EnemyKilled -= OnKilled;
            EncounterSite.AnySiteCleared -= OnSiteCleared;
            if (Instance == this) Instance = null;
        }

        void OnKilled(Damageable d, DamageInfo info)
        {
            var pv = PlayerVitals.Instance;
            if (d.noReward || !pv) return;
            var pos = d.transform.position + Vector3.up * 0.6f;
            var ai = d.GetComponent<EnemyAI>();
            var def = ai ? EnemyRoster.Get(ai.enemyId) : null;
            float bulk = def != null ? def.hp + def.armor + def.shield : d.maxHealth;
            int coins = Mathf.Clamp(Mathf.RoundToInt(bulk / 40f), 2, 14) * (d.elite ? 3 : 1);
            DropCoins(pos, coins);

            var wc = pv.GetComponent<WeaponController>();
            bool lowAmmo = true;
            if (wc)
                foreach (var w in wc.slots)
                    if (w != null && (w.mag + w.reserve) >= (w.def.mag + w.def.reserve) * LowAmmo) lowAmmo = false;
            if (d.elite || Random.value < (lowAmmo ? AmmoChanceLow : AmmoChance)) Pickup.Spawn(Pickup.Kind.Ammo, pos, 0.25f);
            if (d.elite || Random.value < HealthChance) Pickup.Spawn(Pickup.Kind.Health, pos, 0);
            if (d.elite && Random.value < ElitePetChance) PetSeal.DropRandom(pos, null, true);

            float kh = pv.stats.Get(Stat.KillHeal), ks = pv.stats.Get(Stat.KillShield);
            if (kh > 0) pv.Heal(kh);
            if (ks > 0) pv.AddShield(ks);
        }

        public static void DropCoins(Vector3 pos, int amount, float toss = 1f)
        {
            // 拆成几颗：每颗 1–5，最多 8 颗，大额的单颗更大
            int count = Mathf.Clamp(Mathf.CeilToInt(amount / 3f), 1, 8);
            int left = amount;
            for (int i = 0; i < count && left > 0; i++)
            {
                int v = i == count - 1 ? left : Mathf.Max(1, amount / count);
                left -= v;
                Pickup.Spawn(Pickup.Kind.Coin, pos, v, toss);
            }
        }

        void OnSiteCleared(EncounterSite site)
        {
            Pickup.Vacuum();
            if (string.IsNullOrEmpty(site.reward)) return;
            var p = site.transform.position + site.chestOffset;
            if (NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas)) p = hit.position;
            var face = PlayerVitals.Instance ? PlayerVitals.Instance.transform.position : p + Vector3.forward;
            Chest.Spawn(p, site.reward, face);
            GameUI.Toast("宝箱出现了");
        }

        /// <summary>
        /// 宝箱奖励："weapon:&lt;id&gt;[:稀有度]" / "scroll" / "coins" / "heal" / "pet"（按权重抽）/ "pet:&lt;id&gt;" / "pet:rarity=&lt;0–2&gt;"。
        /// 按 key 分发给 Loot/Rewards 里的处理器（<see cref="RewardRegistry"/>）；新奖励种类加一个 &lt;Kind&gt;Reward.cs 就行。
        /// </summary>
        public void Grant(string reward, Vector3 pos) => RewardRegistry.Grant(reward, pos, this);

        public void OfferScrolls(int count) => offers.Enqueue(count);

        void Update()
        {
            if (offers.Count == 0 || ScrollChoice.Open || Time.unscaledTime < offerReadyAt) return;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var hero = pv.GetComponent<HeroSkills>();
            var choices = ScrollLibrary.Roll(scrolls, offers.Dequeue(), 0, hero ? hero.heroId : null);
            if (choices.Count == 0) return;
            ScrollChoice.Show(choices, scrolls, def =>
            {
                if (scrolls.Gain(def, pv))
                {
                    int n = scrolls.Stacks(def.id);
                    GameUI.Toast($"获得秘卷「{def.name}」" + (def.maxStacks > 1 ? $" · {n} 层" : ""));
                }
                else GameUI.Toast($"「{def.name}」已达最大层数");
                offerReadyAt = Time.unscaledTime + OfferGap;
            });
        }
    }
}
