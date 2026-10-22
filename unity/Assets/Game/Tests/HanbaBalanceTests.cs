using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 旱魃定档与击杀用时（BS2，docs/unity-parity.md 7.4「用模拟秒伤算击杀用时，落在 60–120 s」）：
    ///   · 定档：1-4 难度 1.48 下 4400 生命 + 2200 护盾，阈值 60% / 30%，二、三阶段的第一招是飞天之殇、日蚀；BS2 的三招在对的阶段才可用；
    ///   · 时间轴：日蚀窗口 = 片段 eclipseStart → eclipseEnd（3 s，不吃节奏），焦裂的出手时长覆盖蔓延 + 逐段爆开；
    ///   · 模拟（<see cref="HanbaBalance"/>）：秒伤带下沿 / 中位 / 上沿三种打法，各 16 个种子的平均击杀用时都在 60–120 s，单个种子也不离谱（50–130 s）；
    ///     打法越强越快；每场都走过三个阶段、至少一次飞天之殇和一次日蚀；同一种子结果可复现。
    /// </summary>
    public sealed class HanbaBalanceTests
    {
        static HanbaDef Def => new();

        [Test]
        public void Tier_IsPlanValueAtStageDifficulty()
        {
            var d = Def;
            var v = d.VitalsAt(HanbaDef.StageDifficulty);
            Assert.AreEqual(4400f, v.hp, 1f);
            Assert.AreEqual(2200f, v.shield, 1f);
            Assert.AreEqual(0f, v.armor, 1e-3f);
            CollectionAssert.AreEqual(new[] { HanbaDef.ScorchedAt, HanbaDef.RedEarthAt }, d.BarTicks.ToArray());
            Assert.IsEmpty(d.Validate(), string.Join("；", d.Validate()));
            Assert.AreEqual(Phase2ApsaraCall.MoveId, d.phases[0].firstMove);
            Assert.AreEqual(Phase3Eclipse.MoveId, d.phases[1].firstMove);
        }

        [Test]
        public void Bs2Moves_UnlockByPhase()
        {
            var moves = Def.moves.Select(m => m()).ToDictionary(m => m.Id);
            Assert.AreEqual(1, moves[Phase2CrackLine.MoveId].minPhase, "焦裂从二阶段起");
            Assert.AreEqual(1, moves[Phase2ApsaraCall.MoveId].minPhase, "飞天之殇从二阶段起");
            Assert.AreEqual(2, moves[Phase3Eclipse.MoveId].minPhase, "日蚀从三阶段起");
            foreach (var id in new[] { Phase1SunSweep.MoveId, Phase1HotWind.MoveId, Phase1SandWraiths.MoveId })
                Assert.AreEqual(0, moves[id].minPhase, $"{id} 一阶段就有，之后也留着");
        }

        [Test]
        public void EclipseWindow_IsFixedThreeSecondsAndTriplesPearl()
        {
            var d = Def;
            Assert.AreEqual(3f, d.eclipseSeconds, 1e-4f);
            Assert.AreEqual(3f, d.eclipseWeakMult, 1e-4f);
            var e = new Phase3Eclipse();
            foreach (float pace in d.pace)
            {
                var plan = e.Plan(pace);
                Assert.AreEqual(Phase3Eclipse.Lead, plan.windup, 1e-4f, "日蚀前摇不吃节奏");
                Assert.AreEqual(d.eclipseSeconds, plan.active, 1e-4f, "日蚀窗口不吃节奏");
            }
            // 片段原速：eclipseStart 20 帧、eclipseEnd 110 帧（30 fps，135 帧）→ 窗口正好 3 s
            Assert.AreEqual(20f / 30f, Phase3Eclipse.Lead, 1e-3f);
            Assert.AreEqual(135f / 30f, Phase3Eclipse.ClipSeconds, 1e-3f);
            Assert.AreEqual((110f - 20f) / 30f, d.eclipseSeconds, 1e-3f);
        }

        [Test]
        public void CrackLine_ActiveCoversSpreadAndChain()
        {
            var c = new Phase2CrackLine();
            float len = Phase2CrackLine.MaxLength;
            float spread = len / Phase2CrackLine.CrackSpeed;
            float chain = Mathf.CeilToInt(len / Phase2CrackLine.Step) * Phase2CrackLine.ChainGap;
            Assert.Greater(Phase2CrackLine.ActiveSeconds(len), spread + Phase2CrackLine.ExplodeDelay + chain - 1e-3f);
            Assert.Less(c.Plan(1.4f).windup, c.Plan(1f).windup, "三阶段焦裂前摇更短");
        }

        [Test]
        public void PacePlans_ShortenWindupsInLaterPhases()
        {
            var d = Def;
            foreach (var m in d.moves.Select(f => f()).OfType<HanbaMove>())
            {
                if (m is Phase3Eclipse) continue;
                var p1 = m.Plan(d.PaceAt(0));
                var p3 = m.Plan(d.PaceAt(2));
                Assert.LessOrEqual(p3.windup, p1.windup + 1e-4f, m.Id);
                Assert.Greater(p1.Total, 0.5f, m.Id);
            }
        }

        [Test]
        public void KillTime_EveryProfileWithinSixtyToOneTwenty()
        {
            var d = Def;
            float prev = float.PositiveInfinity;
            foreach (var p in HanbaBalance.Profiles)
            {
                var (mean, min, max, sample) = HanbaBalance.Average(d, p, 16);
                TestContext.WriteLine($"{p}：平均 {mean:F1} s（{min:F1}–{max:F1}），样例 {sample}");
                Assert.That(mean, Is.InRange(HanbaBalance.TargetMin, HanbaBalance.TargetMax), $"{p.name} 平均击杀用时 {mean:F1} s");
                Assert.That(min, Is.GreaterThanOrEqualTo(50f), $"{p.name} 最快 {min:F1} s");
                Assert.That(max, Is.LessThanOrEqualTo(130f), $"{p.name} 最慢 {max:F1} s");
                Assert.Less(mean, prev, "打法越强越快");
                prev = mean;
            }
        }

        [Test]
        public void Simulation_VisitsAllPhasesAndSetPieces()
        {
            var d = Def;
            var r = HanbaBalance.Simulate(d, HanbaBalance.Mid, 1234);
            TestContext.WriteLine(r.ToString());
            Assert.IsTrue(r.killed, "中位打法打得死");
            Assert.Greater(r.phase2At, 0f);
            Assert.Greater(r.phase3At, r.phase2At);
            Assert.GreaterOrEqual(r.apsaras, 1, "二阶段至少一次飞天之殇（转阶段后的第一招）");
            Assert.GreaterOrEqual(r.eclipses, 1, "三阶段至少一次日蚀（转阶段后的第一招）");
            float transitions = d.phases.Sum(p => p.seconds);
            Assert.AreEqual(transitions, r.untargetable, 0.1f, "不可选中的时间 = 两段转阶段演出");
            Assert.AreEqual(HanbaBalance.Mid.pipaSeconds * r.apsaras, r.warded, 0.1f * r.apsaras, "每次护体都持续到琵琶被打碎");
            Assert.Greater(r.eclipseOpen, d.eclipseSeconds - 0.1f);
            var again = HanbaBalance.Simulate(d, HanbaBalance.Mid, 1234);
            Assert.AreEqual(r.seconds, again.seconds, 1e-4f, "同一种子可复现");
        }

        [Test]
        public void Simulation_TougherTierTakesLonger()
        {
            var d = Def;
            var at14 = HanbaBalance.Average(d, HanbaBalance.Mid, 8).mean;
            var harder = HanbaBalance.Average(d, HanbaBalance.Mid, 8, HanbaDef.StageDifficulty * 1.5f).mean;
            Assert.Greater(harder, at14 * 1.3f, "难度 × 1.5 时耐久等比放大，击杀用时明显变长");
        }
    }
}
