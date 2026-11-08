using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 战斗导演的数值规则（docs/level-design/run-variety.md §3、docs/balance.md 第十二节）：据点加量只加普通单位、不改模板、奖励按比例摊薄（据点总量不变）；
    /// 奖励倍率的概率取整期望不变；游荡怪每关的灵石 / 魂晶额度；调试局不加量。
    /// </summary>
    public sealed class CombatDirectorTests
    {
        [TearDown]
        public void TearDown()
        {
            CombatDirector.Force = null;
            CombatDirector.ResetRoamingBudget();
        }

        static EncounterSpec Spec() => EncounterSpec.Of(
            EncounterSpec.Wave("一", EncounterSpec.E("jerboa_blade", 4), EncounterSpec.E("scorpion_archer", 2), EncounterSpec.E("tomb_beast", 1)),
            EncounterSpec.Wave("二", EncounterSpec.E("fire_rat", 3), EncounterSpec.E("tomb_beast", 1).Elite(), EncounterSpec.E("apsara", 1)));

        [Test]
        public void Densify_OnlyNormalsWithTwoOrMore_SharesRewards()
        {
            CombatDirector.Force = true;
            var template = Spec();
            var run = template.Clone();
            float scale = CombatDirector.Densify(run);
            // 4 → 6、2 → 3、3 → 5；单只重型、精英、单只飞天不变
            Assert.AreEqual(new[] { 6, 3, 1 }, System.Array.ConvertAll(run.waves[0].entries, e => e.count));
            Assert.AreEqual(new[] { 5, 1, 1 }, System.Array.ConvertAll(run.waves[1].entries, e => e.count));
            Assert.AreEqual(12, template.Total, "模板不动");
            Assert.AreEqual(17, run.Total);
            Assert.AreEqual(12f / 17f, scale, 1e-5f, "每只奖励 × 原只数 ÷ 加量后只数：据点总量不变");
            Assert.AreEqual(template.Total, run.Total * scale, 1e-4f);
        }

        [Test]
        public void Densify_OffInDevRuns()
        {
            CombatDirector.Force = false;
            var run = Spec();
            Assert.AreEqual(1f, CombatDirector.Densify(run));
            Assert.AreEqual(12, run.Total);
        }

        [Test]
        public void RewardScale_ProbabilisticRounding_KeepsExpectation()
        {
            var rng = new RunRng(20261108);
            long sum = 0;
            const int n = 20000;
            for (int i = 0; i < n; i++) sum += RewardScale.Scale(7, 0.7f, rng);
            Assert.AreEqual(7 * 0.7, sum / (double)n, 0.05, "期望 = 7 × 0.7");
            Assert.AreEqual(5, RewardScale.Scale(5, 1f, rng));
            Assert.AreEqual(0, RewardScale.Scale(5, 0f, rng));
            Assert.AreEqual(0, RewardScale.Scale(0, 0.5f, rng));
            int one = 0;
            for (int i = 0; i < 1000; i++) one += RewardScale.Scale(1, 0.3f, rng);
            Assert.AreEqual(300, one, 60, "1 只魂晶 × 0.3 ≈ 30% 给 1");
        }

        [Test]
        public void LiveRun_RoamingCaps_KeepShopsAndTalentsInBand()
        {
            // 正式的局 = 离线模型（驻守点已按半价算）+ 每张开放图游荡怪额度打满（上限）
            var route = new System.Collections.Generic.HashSet<string>();
            foreach (var s in RunPlan.Playable) route.Add(s.code);
            float coins = 0, roam = 0;
            int fields = 0;
            foreach (var e in BalanceModel.EstimateRun())
            {
                if (!route.Contains(e.stage.code)) continue;
                coins += e.killCoins + e.cacheCoins + e.bossCoins;
                if (e.stage.IsBoss) continue;
                fields++;
                roam += EconomyConfig.RoamingCoinCap(e.stage.chapter - 1);
            }
            var lines = new System.Collections.Generic.List<string> { $"一局灵石 {coins:0} → {coins + roam:0}（+{roam / coins:P0}）" };
            foreach (var c in BalanceModel.Camps)
            {
                if (c.Chapter >= 3) continue; // 第四章还没建满，另算
                float budget = BalanceModel.CampBudget(c), shelf = BalanceModel.ShelfValue(c);
                // 每家店的预算含上一家店之后的三张开放图（1-3：1-1…1-3；2-4：2-1…2-3；3-4：3-1…3-3）
                float live = budget + 3 * EconomyConfig.RoamingCoinCap(c.Chapter);
                lines.Add($"{c.at} 店 {budget:0} → {live:0} / 整店 {shelf:0}（{budget / shelf:P0} → {live / shelf:P0}）");
                Assert.That(live / shelf, Is.InRange(0.45f, 0.9f), $"{c.at}：加上游荡怪额度也买不下整店");
            }
            float win = BalanceModel.RunEssence(), liveWin = win + fields * EconomyConfig.RoamingEssencePerStage;
            lines.Add($"通关魂晶 {win:0} → {liveWin:0}，点满天赋 {BalanceModel.TalentTotal / win:0.0} → {BalanceModel.TalentTotal / liveWin:0.0} 次通关");
            Debug.Log("[LiveEconomy] " + string.Join("；", lines));
            Assert.That(BalanceModel.TalentTotal / liveWin, Is.InRange(6f, 12f), "加上游荡怪的魂晶额度，点满天赋仍要六次以上通关");
        }

        [Test]
        public void RoamingBudget_CapsCoinsAndEssencePerStage()
        {
            CombatDirector.ResetRoamingBudget();
            int cap = EconomyConfig.RoamingCoinCap(EconomyConfig.Chapter);
            Assert.AreEqual(Mathf.RoundToInt(EconomyConfig.RoamingCoinsPerStage * EconomyConfig.KillChapterMult(EconomyConfig.Chapter)), cap);
            int coins = 0;
            for (int i = 0; i < 100; i++) coins += CombatDirector.ClaimRoamingCoins(4);
            Assert.AreEqual(cap, coins, "游荡怪灵石到额度为止");
            Assert.AreEqual(0, CombatDirector.ClaimRoamingCoins(10));
            int essence = 0;
            for (int i = 0; i < 100; i++) essence += CombatDirector.ClaimRoamingEssence(1);
            Assert.AreEqual(EconomyConfig.RoamingEssencePerStage, essence);
            CombatDirector.ResetRoamingBudget();
            Assert.AreEqual(4, CombatDirector.ClaimRoamingCoins(4), "进新的一关额度清零");
            Assert.AreEqual(Mathf.RoundToInt(35 * 1.3f), EconomyConfig.RoamingCoinCap(2), "第三章 35 × 1.3");
        }
    }
}
