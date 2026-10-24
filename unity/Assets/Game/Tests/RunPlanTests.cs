using System.Linq;
using NUnit.Framework;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 十二关串联（I1）：RunPlan 的顺序 / 难度（D1）/ 首领关 / 补给营 / 清关奖励，试玩开关（demoEnd = 1-4：1-4 成为最后一关、Next 到此为止、
    /// 首领打完走胜利），命令行解析，关间结算卡读到的下一关信息。
    /// </summary>
    public sealed class RunPlanTests
    {
        string saved;

        [SetUp]
        public void SetUp() => saved = RunPlan.DemoEnd;

        [TearDown]
        public void TearDown() => RunPlan.DemoEnd = saved;

        [Test]
        public void TwelveStages_InOrder_WithD1Difficulty()
        {
            RunPlan.DemoEnd = null;
            var s = RunPlan.Stages;
            Assert.AreEqual(12, s.Count);
            Assert.AreEqual(new[] { "1-1", "1-2", "1-3", "1-4", "2-1", "2-2", "2-3", "2-4", "3-1", "3-2", "3-3", "3-4" }, s.Select(x => x.code).ToArray());
            for (int i = 0; i < s.Count; i++)
            {
                Assert.AreEqual(i, s[i].order);
                Assert.AreEqual(1 + 0.8f * (s[i].chapter - 1) + 0.16f * s[i].index, s[i].difficulty, 1e-5f, s[i].code);
                Assert.AreEqual(s[i].index == 3, s[i].IsBoss, $"{s[i].code} 首领关 = 章内第 4 关");
                Assert.AreEqual(s[i].IsBoss ? "weapon" : "scroll", s[i].clearReward, s[i].code);
                Assert.IsTrue(s[i].scene.StartsWith("Assets/Scenes/") && s[i].scene.EndsWith(".unity"), s[i].scene);
                Assert.AreSame(s[i], RunPlan.ForScene(s[i].scene));
                Assert.AreSame(i + 1 < s.Count ? s[i + 1] : null, RunPlan.Next(s[i]), $"{s[i].code} 的下一关");
            }
            Assert.AreEqual(1.48f, RunPlan.Get("1-4").difficulty, 1e-5f);
            Assert.AreEqual(2.28f, RunPlan.Get("2-4").difficulty, 1e-5f);
            Assert.AreEqual(3.08f, RunPlan.Get("3-4").difficulty, 1e-5f);
            Assert.AreSame(RunPlan.Get("3-4"), RunPlan.Final);
            Assert.IsTrue(RunPlan.IsFinal(RunPlan.Get("3-4")) && RunPlan.IsLast(RunPlan.Get("3-4")));
            Assert.IsFalse(RunPlan.IsFinal(RunPlan.Get("1-4")));
            Assert.AreEqual(12, RunPlan.Playable.Count);
        }

        [Test]
        public void SupplyCamps_BeforeEachBoss()
        {
            Assert.AreEqual(new[] { "1-3", "2-4", "3-4" }, RunPlan.Stages.Where(x => x.supplyCamp).Select(x => x.code).ToArray(),
                "补给营：第一章在 1-3 末段（1-4 月牙泉入口只是安全起步台），二、三章在首领场门槛外");
        }

        [Test]
        public void DemoSwitch_EndsTheRunAtStage14()
        {
            RunPlan.DemoEnd = RunPlan.DemoDefault;
            var s14 = RunPlan.Get("1-4");
            Assert.IsTrue(RunPlan.IsDemo);
            Assert.AreSame(s14, RunPlan.Final);
            Assert.IsTrue(RunPlan.IsFinal(s14), "试玩版：1-4 就是最后一关");
            Assert.IsFalse(RunPlan.IsLast(s14), "但不是完整版的最后一关（结算文案按这个区分）");
            Assert.IsNull(RunPlan.Next(s14), "1-4 之后没有下一关");
            Assert.AreSame(RunPlan.Get("1-2"), RunPlan.Next(RunPlan.First));
            Assert.AreEqual(4, RunPlan.Playable.Count);
            Assert.IsFalse(RunPlan.InPlay(RunPlan.Get("2-1")));
            Assert.AreEqual(BossEncounter.Outcome.Victory, BossEncounter.Decide(s14), "试玩版打完旱魃走胜利链");
            Assert.AreEqual(12, RunPlan.Stages.Count, "完整表不受开关影响（构建顺序、经济投影）");

            RunPlan.DemoEnd = null;
            Assert.IsFalse(RunPlan.IsDemo);
            Assert.AreSame(RunPlan.Get("2-1"), RunPlan.Next(s14));
            Assert.AreEqual(BossEncounter.Outcome.NextStage, BossEncounter.Decide(s14));

            RunPlan.DemoEnd = "3-4";
            Assert.IsFalse(RunPlan.IsDemo, "终点设成 3-4 等于完整版");
            RunPlan.DemoEnd = "9-9";
            Assert.IsFalse(RunPlan.IsDemo, "不在表里的编号等于关掉");
            Assert.AreSame(RunPlan.Get("3-4"), RunPlan.Final);
        }

        [Test]
        public void DemoSwitch_FromCommandLine()
        {
            Assert.AreEqual("1-4", RunPlan.ResolveDemoEnd(new[] { "game.exe", "-demo" }));
            Assert.AreEqual("2-4", RunPlan.ResolveDemoEnd(new[] { "game.exe", "-demoEnd", "2-4" }));
            Assert.AreEqual("1-3", RunPlan.ResolveDemoEnd(new[] { "game.exe", "-demoEnd=1-3", "-skipmenu" }));
            Assert.AreEqual("1-4", RunPlan.ResolveDemoEnd(new[] { "game.exe", "-demoEnd" }), "只写开关不写关卡 = 缺省终点");
#if !SPIRITFIRE_DEMO
            Assert.IsNull(RunPlan.ResolveDemoEnd(new[] { "game.exe", "-skipmenu" }));
            Assert.IsNull(RunPlan.ResolveDemoEnd(null));
#endif
        }
    }
}
