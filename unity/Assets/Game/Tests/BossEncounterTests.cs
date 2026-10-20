using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 首领关流程 / 补给营（B2；port tests/boss-supply.test.mjs 里与地图无关的部分）：
    /// 补给营的整家店（摊位本体 + 顾客站位）都在安全区里、到达补给营不白给回复（药剂是付费服务）、首领宝箱的保底（第一章史诗起、第二章起传说，提示与发放一致）、
    /// 结算后的去向（最后一关胜利，其余进下一关 / 下一章）、拴绳判定（出场地 slack 米、掉出地面、位置非法）、安全区几何（圆柱、推到圈外）。
    /// </summary>
    public sealed class BossEncounterTests
    {
        [Test]
        public void WholeShopFitsInsideTheSupplyCampSafeZone()
        {
            var campDefault = new GameObject("camp").AddComponent<SupplyCamp>();
            try
            {
                float r = campDefault.safeRadius;
                foreach (float yaw in new[] { 0f, 37f, 90f, 200f })
                foreach (var st in ShopLayout.Build(Vector3.zero, yaw))
                {
                    Assert.IsTrue(SafeZone.Inside(Vector3.zero, r, 6f, st.position), "摊位中心在安全区里");
                    Assert.LessOrEqual(new Vector2(st.position.x, st.position.z).magnitude + ShopLayout.StallHalfWidth * 1.42f, r, "摊位整个（含对角）在安全区里");
                    Assert.LessOrEqual(new Vector2(st.customer.x, st.customer.z).magnitude + ShopLayout.CustomerHalfWidth, r, "顾客站位在安全区里");
                }
                Assert.IsFalse(campDefault.restoreOnArrive, "到达补给营不白给回复（同 TS：arrival does not freely restore health）");
            }
            finally
            {
                Object.DestroyImmediate(campDefault.gameObject);
            }
        }

        [Test]
        public void BossChest_GuaranteesEpicThenLegendary_HintMatchesGrant()
        {
            var rewards = new BossRewards();
            Assert.AreEqual("weapon", rewards.chest);
            Assert.AreEqual(ChestTier.Boss, rewards.chestTier);
            Assert.IsTrue(rewards.healPlayer);
            Assert.AreEqual("weapon:min=3", EconomyConfig.ApplyTier(rewards.chest, rewards.chestTier, 0));
            Assert.AreEqual("weapon:min=4", EconomyConfig.ApplyTier(rewards.chest, rewards.chestTier, 1));
            Assert.AreEqual("weapon:min=4", EconomyConfig.ApplyTier(rewards.chest, rewards.chestTier, 2));
            Assert.AreEqual(Rarity.Epic, WeaponReward.Parse(RewardRegistry.Split("weapon:min=3")).minRarity);
            Assert.AreEqual("一把史诗及以上品质的武器", RewardRegistry.Hint("weapon:min=3"));
            Assert.AreEqual("一把传说品质的武器", RewardRegistry.Hint("weapon:min=4"));
        }

        [Test]
        public void AfterTheBoss_FinalStageIsVictory_OthersGoOn()
        {
            Assert.AreEqual(BossEncounter.Outcome.Victory, BossEncounter.Decide(RunPlan.Stages[RunPlan.Stages.Count - 1]));
            Assert.AreEqual(BossEncounter.Outcome.NextStage, BossEncounter.Decide(RunPlan.Get("1-4")));
            Assert.AreEqual(BossEncounter.Outcome.NextStage, BossEncounter.Decide(RunPlan.Get("2-4")));
            Assert.AreEqual(BossEncounter.Outcome.NextStage, BossEncounter.Decide(null), "测试场（不在 RunPlan 里）开出口");
            Assert.AreEqual(2, RunPlan.Next(RunPlan.Get("1-4")).chapter, "1-4 之后进第二章");
        }

        [Test]
        public void Tether_PullsBackOutsideSlackFallenOrInvalid()
        {
            var go = new GameObject("arena");
            try
            {
                var a = go.AddComponent<BossArena>();
                a.shape = BossArenaShape.Circle;
                a.radius = 16f;
                Assert.IsFalse(BossEncounter.NeedsTether(a, new Vector3(10, 0, 0), 8f));
                Assert.IsFalse(BossEncounter.NeedsTether(a, new Vector3(23, 0, 0), 8f), "出场地 7 m：场地自己的走位会走回来");
                Assert.IsTrue(BossEncounter.NeedsTether(a, new Vector3(25, 0, 0), 8f), "出场地 9 m：拉回");
                Assert.IsTrue(BossEncounter.NeedsTether(a, new Vector3(0, -9, 0), 8f), "掉出地面");
                Assert.IsTrue(BossEncounter.NeedsTether(a, new Vector3(float.NaN, 0, 0), 8f), "位置非法");
                Assert.IsFalse(BossEncounter.NeedsTether(null, new Vector3(100, 0, 0), 8f), "没有场地不拴");
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void SafeZone_IsACylinderAndPushesOutsideTheRim()
        {
            var c = new Vector3(5, 1, 5);
            Assert.IsTrue(SafeZone.Inside(c, 10, 6, new Vector3(14, 1, 5)));
            Assert.IsFalse(SafeZone.Inside(c, 10, 6, new Vector3(16, 1, 5)));
            Assert.IsTrue(SafeZone.Inside(c, 10, 6, new Vector3(16, 1, 5), 1.5f), "按身体半径放宽");
            Assert.IsFalse(SafeZone.Inside(c, 10, 6, new Vector3(5, 8, 5)), "高处不算");
            var p = SafeZone.PushOut(c, 10, new Vector3(8, 3, 5), 2f);
            Assert.AreEqual(17f, p.x, 1e-4f);
            Assert.AreEqual(5f, p.z, 1e-4f);
            Assert.AreEqual(3f, p.y, 1e-4f, "高度不变");
            var q = SafeZone.PushOut(c, 10, c, 2f);
            Assert.AreEqual(12f, new Vector2(q.x - c.x, q.z - c.z).magnitude, 1e-4f, "正中心时也推得出去");
        }
    }
}
