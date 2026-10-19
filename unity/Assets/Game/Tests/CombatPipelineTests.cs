using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 战斗管线（C2 / C3）：持续伤害的属性乘区不重复计算、跳伤按计时对齐、首领眩晕规则、吸血、魂晶、
    /// 不可选中的「免疫」节流、静默处决不转发旧事件、状态注册表。数值对照 Three.js 版 src/combat/{Combat,Status,DamageCalc}.ts。
    /// 只用纯函数和不经过 Awake 的组件（EditMode 下 MonoBehaviour 不跑 Awake），不依赖场景。
    /// </summary>
    public sealed class CombatPipelineTests
    {
        const float Eps = 1e-4f;
        StatSheet savedStats;
        readonly List<GameObject> made = new();

        [SetUp]
        public void SetUp() => savedStats = Combat.playerStats;

        [TearDown]
        public void TearDown()
        {
            Combat.playerStats = savedStats;
            foreach (var go in made)
                if (go) Object.DestroyImmediate(go);
            made.Clear();
        }

        Damageable Enemy(Rank rank, float maxHp = 1000)
        {
            var go = new GameObject("test enemy");
            made.Add(go);
            var d = go.AddComponent<Damageable>();
            d.maxHealth = maxHp;
            d.rank = rank;
            return d;
        }

        /// <summary>元素 +20%、火 +50%、精英 +30%、首领 +40%、武器伤害 +100%、反应伤害 +25%</summary>
        static StatSheet Stats()
        {
            var s = new StatSheet();
            s.Add("test", Stat.ElementDamagePct, 0.2f);
            s.Add("test", Stat.FireDamagePct, 0.5f);
            s.Add("test", Stat.EliteDamagePct, 0.3f);
            s.Add("test", Stat.BossDamagePct, 0.4f);
            s.Add("test", Stat.DamagePct, 1f);
            s.Add("test", Stat.ReactionDamagePct, 0.25f);
            return s;
        }

        static DamageInfo Dot(Element e)
        {
            var i = DamageInfo.Simple(10, DamageSource.Status, Vector3.zero, Vector3.up);
            i.element = e;
            i.tags = DamageTag.Dot;
            i.depth = 1;
            return i;
        }

        // ───────────── 持续伤害乘区 ─────────────

        [Test]
        public void DotTakesElementAndRankMultipliersButNotWeaponDamage()
        {
            var s = Stats();
            var normal = Enemy(Rank.Normal);
            var elite = Enemy(Rank.Elite);
            var boss = Enemy(Rank.Boss);
            Assert.AreEqual(1.2f * 1.5f, DamageCalc.DotStatMultiplier(s, normal, Element.Fire), Eps);
            Assert.AreEqual(1.2f * 1.5f * 1.3f, DamageCalc.DotStatMultiplier(s, elite, Element.Fire), Eps);
            Assert.AreEqual(1.2f * 1.5f * 1.4f, DamageCalc.DotStatMultiplier(s, boss, Element.Fire), Eps);
            // 跳伤请求走 StatMultiplier 得到的就是同一个倍率（不吃武器伤害）
            foreach (var t in new[] { normal, elite, boss })
                Assert.AreEqual(DamageCalc.DotStatMultiplier(s, t, Element.Fire), DamageCalc.StatMultiplier(s, Dot(Element.Fire), t), Eps);
            // 雷殛弹射（Chain）同样只吃元素类 + 级别
            var chain = Dot(Element.Shock);
            chain.tags = DamageTag.Chain;
            Assert.AreEqual(1.2f * 1.3f, DamageCalc.StatMultiplier(s, chain, elite), Eps);
            // 熔池跳伤带 Reaction + Dot：只吃反应伤害
            var pool = Dot(Element.Fire);
            pool.reaction = true;
            Assert.AreEqual(1.25f, DamageCalc.StatMultiplier(s, pool, boss), Eps);
        }

        [Test]
        public void StatusPowerDividesOutWhatEachTickMultipliesBack()
        {
            Combat.playerStats = Stats();
            var elite = Enemy(Rank.Elite, 1000);
            float dealt = 100;
            float power = DamageCalc.StatusPowerFromDealt(elite, Element.Fire, dealt);
            float perTick = DamageCalc.DotStatMultiplier(elite, Element.Fire);
            Assert.AreEqual(dealt, power * perTick, 1e-3f, "附着时除掉、每一跳乘回：同一份加成只算一次");
            Assert.AreEqual(dealt, DamageCalc.ReactionPowerFromStatus(elite, Element.Fire, power), 1e-3f);
            // 一层灼烧烧满 = 那一击实际伤害 × 1.28（含加成，只乘一次）
            float full = power * BurnStatus.Ratio * StatusTiming.TicksLeft(BurnStatus.Duration, BurnStatus.TickInterval, BurnStatus.TickInterval) * perTick;
            Assert.AreEqual(dealt * 1.28f, full, 1e-3f);
            // 上限：最大生命 × 0.5
            Assert.AreEqual(500f, DamageCalc.StatusPowerFromDealt(elite, Element.Fire, 1e5f) * perTick, 1e-2f);
        }

        [Test]
        public void NoPlayerStatsMeansNoMultipliers()
        {
            Combat.playerStats = null;
            var boss = Enemy(Rank.Boss);
            Assert.AreEqual(1f, DamageCalc.DotStatMultiplier(boss, Element.Corrode), Eps);
            Assert.AreEqual(1f, DamageCalc.StatMultiplier(Dot(Element.Corrode), boss), Eps);
            Assert.AreEqual(40f, DamageCalc.StatusPowerFromDealt(boss, Element.Corrode, 40), Eps);
        }

        // ───────────── 跳伤计时 ─────────────

        [Test]
        public void TicksLeftAlignsToTheSharedTimer()
        {
            Assert.AreEqual(8, StatusTiming.TicksLeft(4f, 0.5f, 0.5f));
            Assert.AreEqual(10, StatusTiming.TicksLeft(5f, 0.5f, 0.5f));
            Assert.AreEqual(1, StatusTiming.TicksLeft(0.5f, 0.5f, 0.5f), "最后一跳与到期同一刻也算");
            Assert.AreEqual(0, StatusTiming.TicksLeft(0.3f, 0.5f, 0.5f));
            Assert.AreEqual(7, StatusTiming.TicksLeft(3.6f, 0.1f, 0.5f));
        }

        static int CountDrops(StatusInstance s, float seconds, float dt = 1f / 60f)
        {
            int drops = 0;
            float last = s.RemainingDotRaw;
            for (float t = 0; t < seconds; t += dt)
            {
                if (s.Active) s.Tick(dt);
                float now = s.Active ? s.RemainingDotRaw : 0;
                if (now < last - 1e-4f) drops++;
                last = now;
            }
            return drops;
        }

        [Test]
        public void BurnLayerTicksEightTimesThenExpires()
        {
            var burn = new BurnInstance(null);
            Assert.IsTrue(burn.Apply(new StatusApply(10)));
            Assert.AreEqual(10 * 0.16f * 8, burn.RemainingDotRaw, Eps);
            Assert.AreEqual(8, CountDrops(burn, 4.5f), "一层 4 s 正好 8 跳");
            Assert.IsFalse(burn.Active);

            for (int i = 0; i < 5; i++) burn.Apply(new StatusApply(10));
            Assert.AreEqual(BurnStatus.MaxStacks, burn.Stacks, "最多 3 层");
            Assert.AreEqual(3 * 10 * 0.16f * 8, burn.Consume(), Eps);
            Assert.IsFalse(burn.Active, "归墟消耗后清空");
        }

        [Test]
        public void CorrodeTicksTenTimesAndAppliesTakenAndSlow()
        {
            var cor = new CorrodeInstance(null);
            cor.Apply(new StatusApply(10));
            Assert.AreEqual(10 * 0.08f * 10, cor.RemainingDotRaw, Eps);
            Assert.AreEqual(1.2f, cor.TakenMult, Eps);
            Assert.AreEqual(0.8f, cor.SpeedMult, Eps);
            Assert.AreEqual(10, CountDrops(cor, 5.5f), "5 s 正好 10 跳");
            Assert.IsFalse(cor.Active);
            Assert.AreEqual(1f, cor.TakenMult, Eps);
        }

        [Test]
        public void ShockStacksAndClearsAtThree()
        {
            var shock = new ShockInstance(null);
            shock.Apply(new StatusApply(10, 0, 1));
            shock.Apply(new StatusApply(30, 0, 1));
            Assert.AreEqual(2, shock.Stacks);
            Assert.AreEqual(30f, shock.Power, Eps);
            shock.Apply(new StatusApply(5, 0, 1));
            Assert.IsFalse(shock.Active, "叠到 3 层清空（并眩晕）");
            Assert.AreEqual(0f, shock.Power, Eps, "清空后强度归零，下次重新取值");
        }

        [Test]
        public void SlowTakesStrongestAndExpiresPerEntry()
        {
            Assert.AreEqual(0.9f, SlowStatus.Strength(0.95f), Eps);
            Assert.AreEqual(0.3f, SlowStatus.Strength(30), Eps, "> 1 按百分数");
            var slow = new SlowInstance(null);
            slow.Apply(new StatusApply(0.3f, 1f));
            slow.Apply(new StatusApply(0.5f, 0.5f));
            Assert.AreEqual(0.5f, slow.SpeedMult, Eps);
            slow.Tick(0.6f);
            Assert.AreEqual(0.7f, slow.SpeedMult, Eps);
            slow.Tick(0.5f);
            Assert.IsFalse(slow.Active);
            Assert.AreEqual(1f, slow.SpeedMult, Eps);
        }

        // ───────────── 首领规则 ─────────────

        [Test]
        public void StunScalesByRank()
        {
            Assert.AreEqual(0.8f, StunStatus.ScaledDuration(Rank.Normal, 0.8f), Eps);
            Assert.AreEqual(0.75f, StunStatus.ScaledDuration(Rank.Elite, 1f), Eps);
            Assert.AreEqual(0.35f, StunStatus.ScaledDuration(Rank.Boss, 2f), Eps, "首领 ×0.35 且 ≤ 0.35 s");
            Assert.AreEqual(0.7f * 0.35f, StunStatus.ScaledDuration(Rank.Boss, 0.7f), Eps);
            Assert.AreEqual(0f, StunStatus.ScaledDuration(Rank.Normal, -1f), Eps);
        }

        // ───────────── 吸血 / 魂晶 ─────────────

        [Test]
        public void LifestealIsCappedPerHit()
        {
            Assert.AreEqual(1f, Combat.LifestealHeal(10, 0.1f, 100), Eps);
            Assert.AreEqual(5f, Combat.LifestealHeal(100, 0.1f, 100), Eps, "单次上限 = 最大生命 5%");
            Assert.AreEqual(2f, Combat.LifestealHeal(10, 0.5f, 10), Eps, "上限至少 2 点");
            Assert.AreEqual(0f, Combat.LifestealHeal(100, 0f, 100), Eps);
        }

        [Test]
        public void EssenceByDefAndRank()
        {
            var def = new EnemyDef { id = "test", essence = 3 };
            Assert.AreEqual(3, KillResolver.EssenceFor(def, Rank.Normal));
            Assert.AreEqual(15, KillResolver.EssenceFor(def, Rank.Elite), "精英 ×5");
            Assert.AreEqual(1, KillResolver.EssenceFor(null, Rank.Normal));
            Assert.AreEqual(60, KillResolver.EssenceFor(null, Rank.Boss));
            Assert.AreEqual(60, KillResolver.EssenceFor(new EnemyDef { id = "boss" }, Rank.Boss), "首领没写魂晶按 60");
            Assert.AreEqual(0, KillResolver.EssenceFor(new EnemyDef { id = "decoy", essence = 0 }, Rank.Normal), "分身不给");
        }

        // ───────────── 不可选中 / 处决 ─────────────

        [Test]
        public void ImmuneFeedbackIsThrottledAndSkipsDots()
        {
            var d = Enemy(Rank.Normal);
            d.untargetable = true;
            int immune = 0;
            void Count(Damageable t, DamageInfo info, DamageResult r)
            {
                if (t == d && r.immune) immune++;
            }
            Combat.EnemyDamaged += Count;
            try
            {
                var hit = DamageInfo.Simple(10, DamageSource.Weapon, Vector3.zero, Vector3.forward);
                var r = Combat.DamageEnemy(d, hit);
                Assert.IsTrue(r.immune);
                Assert.AreEqual(0f, r.total, Eps);
                Combat.DamageEnemy(d, hit);
                Combat.DamageEnemy(d, Dot(Element.Fire));
                Assert.AreEqual(1, immune, "0.4 s 内同一敌人只提示一次，跳伤不提示");
            }
            finally
            {
                Combat.EnemyDamaged -= Count;
            }
        }

        [Test]
        public void PurgeIsSilentAndUnrewarded()
        {
            Combat.playerStats = null;
            int damaged = 0, killed = 0, rewarded = 0;
            void OnDamaged(Damageable t, DamageInfo info, DamageResult r) => damaged++;
            void OnKilled(Damageable t, DamageInfo info) => killed++;
            void OnReward(in KillReward k) => rewarded++;
            Combat.EnemyDamaged += OnDamaged;
            Combat.EnemyKilled += OnKilled;
            KillResolver.Rewarded += OnReward;
            try
            {
                var a = Enemy(Rank.Normal);
                a.ResetVitals();
                var r = Combat.Execute(a, true);
                Assert.IsTrue(a.Dead && r.killed);
                Assert.AreEqual(0, damaged, "处决不转发旧的受伤事件（不弹数字）");
                Assert.AreEqual(0, killed, "静默处决不转发旧的击杀事件（不掉落）");
                Assert.AreEqual(0, rewarded, "静默处决没有战果");

                var b = Enemy(Rank.Normal);
                b.ResetVitals();
                Combat.Execute(b, false);
                Assert.AreEqual(0, damaged);
                Assert.AreEqual(1, killed, "普通处决照常算击杀");
                Assert.AreEqual(1, rewarded);
            }
            finally
            {
                Combat.EnemyDamaged -= OnDamaged;
                Combat.EnemyKilled -= OnKilled;
                KillResolver.Rewarded -= OnReward;
            }
        }

        // ───────────── 注册表 ─────────────

        [Test]
        public void EveryStatusHasOneDefinition()
        {
            foreach (StatusId id in System.Enum.GetValues(typeof(StatusId)))
            {
                var def = StatusRegistry.Get(id);
                Assert.IsNotNull(def, $"{id} 没有登记定义");
                Assert.AreEqual(id, def.Status);
                Assert.IsFalse(string.IsNullOrEmpty(def.Name));
                Assert.AreNotEqual(StatusHosts.None, def.Hosts);
            }
            foreach (var id in new[] { StatusId.Burn, StatusId.Shock, StatusId.Corrode, StatusId.Stun, StatusId.Slow })
                Assert.IsTrue((StatusRegistry.Get(id).Hosts & StatusHosts.Enemy) != 0, $"{id} 应能挂在敌人身上");
            Assert.AreEqual(Element.Fire, StatusRegistry.Get(StatusId.Burn).Element);
        }
    }
}
