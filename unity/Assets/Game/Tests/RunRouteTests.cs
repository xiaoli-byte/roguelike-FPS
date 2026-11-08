using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 每局路线（docs/level-design/run-variety.md）：<see cref="RunRoute"/> 按种子洗每章的开放图（补给营那张钉在章内最后、首领永远章末、
    /// 槽位编号 / 难度按位置）、同种子同路线、没建好的图往前补；<see cref="RunPlan"/> 在有路线的局里按路线答、没路线时照旧；
    /// 路线进续玩档 / 接力档再读回来是同一条；图内布局变体 <see cref="LevelLayout.Pick"/> 的抽法。
    /// </summary>
    public sealed class RunRouteTests
    {
        string savedDemo, root;
        RunState savedRun;

        [SetUp]
        public void SetUp()
        {
            // RunState.Begin 会发开局事件（天赋快照读档）：档放到临时目录，不碰本机的真档
            root = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "spiritfire-route-tests-" + System.Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(root);
            SaveService.UseRoot(root);
            savedDemo = RunPlan.DemoEnd;
            savedRun = RunState.Current;
            RunState.Current = null;
            RunPlan.DemoEnd = null;
            RunPlan.SceneReady = s => s.chapter < 4;
        }

        [TearDown]
        public void TearDown()
        {
            RunPlan.DemoEnd = savedDemo;
            RunPlan.SceneReady = null;
            RunState.Current = savedRun;
            SaveService.UseRoot(null);
            try { System.IO.Directory.Delete(root, true); }
            catch (System.IO.IOException) { }
        }

        static string Maps(RunRoute r, int chapter) => string.Join(",", r.Slots.Where(s => s.chapter == chapter).Select(s => s.map.code));

        [Test]
        public void Unshuffled_IsTheDesignedOrder()
        {
            var r = RunRoute.Build(42, false);
            Assert.AreEqual(12, r.Count);
            CollectionAssert.AreEqual(RunPlan.Stages.Take(12).Select(s => s.code).ToArray(), r.maps);
            CollectionAssert.AreEqual(r.maps, r.Slots.Select(s => s.code).ToArray(), "不洗牌时槽位编号 = 地图编号");
            for (int i = 0; i < r.Count; i++)
            {
                Assert.AreEqual(i, r.Slots[i].order);
                Assert.AreSame(r, r.Slots[i].route);
                Assert.AreSame(RunPlan.Stages[i], r.Slots[i].map);
                Assert.AreEqual(RunPlan.Stages[i].difficulty, r.Slots[i].difficulty, 1e-6f);
            }
        }

        [Test]
        public void Shuffle_PermutesFieldMaps_PinsSupplyCamp_KeepsBosses()
        {
            var ch1 = new HashSet<string>();
            var ch2 = new HashSet<string>();
            var ch3 = new HashSet<string>();
            for (int seed = 1; seed <= 200; seed++)
            {
                var r = RunRoute.Build(seed * 7919);
                Assert.AreEqual(12, r.Count, $"种子 {seed}");
                CollectionAssert.AreEqual(new[] { "1-1", "1-2", "1-3", "1-4", "2-1", "2-2", "2-3", "2-4", "3-1", "3-2", "3-3", "3-4" },
                    r.Slots.Select(s => s.code).ToArray(), "槽位编号按位置");
                foreach (var s in r.Slots)
                {
                    Assert.AreEqual(s.map.chapter, s.chapter, "地图不跨章");
                    Assert.AreEqual(s.index == 3, s.IsBoss, $"{s.code}：首领永远在章末");
                    Assert.AreEqual(RunPlan.Difficulty(s.chapter, s.index), s.difficulty, 1e-6f, "难度按槽位");
                    Assert.AreEqual(s.map.scene, s.scene);
                    Assert.AreEqual(s.map.title, s.title);
                    Assert.AreEqual(s.map.clearReward, s.clearReward);
                }
                Assert.AreEqual("1-3", r.Get("1-3").map.code, "沉沙古城有首领前的补给营：钉在第一章最后一张开放图");
                Assert.IsTrue(r.Get("1-3").supplyCamp);
                CollectionAssert.AreEquivalent(new[] { "1-1", "1-2", "1-3", "1-4" }, Maps(r, 1).Split(','));
                CollectionAssert.AreEquivalent(new[] { "2-1", "2-2", "2-3", "2-4" }, Maps(r, 2).Split(','));
                CollectionAssert.AreEquivalent(new[] { "3-1", "3-2", "3-3", "3-4" }, Maps(r, 3).Split(','));
                ch1.Add(Maps(r, 1));
                ch2.Add(Maps(r, 2));
                ch3.Add(Maps(r, 3));
            }
            Assert.AreEqual(2, ch1.Count, "第一章：古道 / 雅丹两种先后（沉沙古城钉住）");
            Assert.AreEqual(6, ch2.Count, "第二章三张开放图六种先后都出现过");
            Assert.AreEqual(6, ch3.Count, "第三章三张开放图六种先后都出现过");
        }

        [Test]
        public void SameSeed_SameRoute_ChaptersIndependent()
        {
            CollectionAssert.AreEqual(RunRoute.Build(20261108).maps, RunRoute.Build(20261108).maps);
            // 第四章多建好一张图，不改变前三章的顺序（每章各自派生随机序列）
            var a = RunRoute.Build(777);
            RunPlan.SceneReady = s => s.chapter < 4 || s.code == "4-1";
            var b = RunRoute.Build(777);
            CollectionAssert.AreEqual(a.maps, b.maps.Take(12).ToArray());
        }

        [Test]
        public void UnbuiltMaps_AreSkipped_LaterSlotsMoveUp()
        {
            // 现状：第四章只建好 4-1、4-3（4-2、4-4 还没有场景）
            RunPlan.SceneReady = s => s.chapter < 4 || s.code == "4-1" || s.code == "4-3";
            for (int seed = 1; seed <= 20; seed++)
            {
                var r = RunRoute.Build(seed);
                Assert.AreEqual(14, r.Count);
                var ch4 = r.Slots.Where(s => s.chapter == 4).ToArray();
                CollectionAssert.AreEqual(new[] { "4-1", "4-2" }, ch4.Select(s => s.code).ToArray(), "两个槽位，编号不跳");
                CollectionAssert.AreEquivalent(new[] { "4-1", "4-3" }, ch4.Select(s => s.map.code).ToArray());
                Assert.AreSame(ch4[1], r.Last);
                Assert.AreSame(r.Last, r.Final);
                Assert.IsNull(r.Next(r.Last));
            }
        }

        [Test]
        public void RunPlan_FollowsTheCurrentRunsRoute()
        {
            var route = RunRoute.Build(31337);
            var run = RunState.Begin("fox", 31337, null, false, route);
            try
            {
                Assert.AreSame(run, RunState.Current);
                Assert.IsNotNull(run.Route);
                Assert.AreEqual(route.First.map, run.Stage.map, "开局在路线的第一关");
                Assert.AreEqual("1-1", run.stageCode);
                Assert.AreEqual(1f, run.difficulty, 1e-6f);
                Assert.AreSame(run.Route.First, RunPlan.First);
                // 顺着 Next 走完整条路线，每一关的场景都能按路径查回同一个槽位
                var s = RunPlan.First;
                int n = 0;
                while (s != null)
                {
                    Assert.AreSame(s, RunPlan.ForScene(s.scene), s.code);
                    Assert.AreSame(s, RunPlan.Get(s.code), s.code);
                    Assert.AreEqual(n, s.order);
                    var next = RunPlan.Next(s);
                    if (next == null) Assert.IsTrue(RunPlan.IsFinal(s) && RunPlan.IsLast(s));
                    else Assert.IsFalse(RunPlan.IsFinal(s));
                    s = next;
                    n++;
                }
                Assert.AreEqual(12, n);
                Assert.AreEqual(12, RunPlan.Playable.Count);
                Assert.AreSame(run.Route.Last, RunPlan.Final);
                Assert.AreEqual(BossEncounter.Outcome.Victory, BossEncounter.Decide(RunPlan.Get("3-4")));
                Assert.AreEqual(BossEncounter.Outcome.NextStage, BossEncounter.Decide(RunPlan.Get("1-4")));

                // 规划表本身不受影响（构建顺序、经济投影、关卡构建器）
                Assert.AreEqual("L1_1_GobiRoad", System.IO.Path.GetFileNameWithoutExtension(RunPlan.Canonical("1-1").scene));
                Assert.IsNull(RunPlan.Canonical("1-1").route);
            }
            finally
            {
                RunState.Current = null;
            }
            Assert.AreSame(RunPlan.Stages[0], RunPlan.First, "没有局时回到规划表");
        }

        [Test]
        public void Begin_WithCanonicalFirstStage_FindsItsSlot()
        {
            // 调试：从规划表的某张图开局（比如直接打开了 1-2 的场景），路线上用同一张图的槽位
            var route = RunRoute.Build(9);
            var map = RunPlan.Canonical("2-2");
            var run = RunState.Begin("fox", 9, map, false, route);
            try
            {
                Assert.AreSame(map, run.Stage.map);
                Assert.AreEqual(route.ForMap(map).code, run.stageCode);
            }
            finally
            {
                RunState.Current = null;
            }
        }

        [Test]
        public void Route_SurvivesSaveAndClone()
        {
            var route = RunRoute.Build(424242);
            var run = new RunState { heroId = "fox", seed = 424242, route = (string[])route.maps.Clone() };
            run.EnterStage(run.Route.Get("2-3"));
            var back = RunStateJson.Deserialize(RunStateJson.Serialize(run));
            CollectionAssert.AreEqual(route.maps, back.route);
            Assert.AreEqual(run.Stage.map, back.Stage.map, "续玩档读回来还在同一张图");
            var clone = SceneFlow.CloneRun(run);
            CollectionAssert.AreEqual(route.maps, clone.route);
            Assert.AreNotSame(run.route, clone.route, "重来本关的快照拷一份路线");
            Assert.AreEqual(run.Stage.map, clone.Stage.map);

            // 旧档没有路线：按规划表
            var old = new RunState { heroId = "fox", seed = 1 };
            old.EnterStage(RunPlan.Canonical("1-2"));
            Assert.IsNull(old.Route);
            Assert.AreSame(RunPlan.Canonical("1-2"), old.Stage);
            // 坏档：路线里有不认识的编号
            var bad = new RunState { heroId = "fox", seed = 1, route = new[] { "1-1", "9-9" } };
            Assert.IsNull(bad.Route);
        }

        [Test]
        public void DemoSwitch_CutsTheRouteAtTheSlot()
        {
            RunPlan.DemoEnd = "1-4";
            var route = RunRoute.Build(5);
            Assert.IsTrue(route.IsDemo);
            Assert.AreSame(route.Get("1-4"), route.Final);
            Assert.IsNull(route.Next(route.Get("1-4")));
            Assert.AreEqual(4, route.Playable.Count);
            Assert.IsFalse(route.InPlay(route.Get("2-1")));
            Assert.IsFalse(route.IsLast(route.Get("1-4")));
        }

        [Test]
        public void LayoutPick_ForcedOrMainWithoutRoute_SeededWithRoute()
        {
            var variants = new[]
            {
                new LevelLayout.Variant { id = "main" },
                new LevelLayout.Variant { id = "reverse" },
                new LevelLayout.Variant { id = "debug", weight = 0 },
            };
            Assert.AreEqual(1, LevelLayout.Pick(variants, "REVERSE", null), "指定 id（不分大小写）");
            Assert.AreEqual(2, LevelLayout.Pick(variants, "debug", null), "权重 0 的只能指定");
            Assert.AreEqual(0, LevelLayout.Pick(variants, null, null), "没有局：主走法");
            var dev = new RunState { heroId = "fox", seed = 3, dev = true };
            dev.EnterStage(RunPlan.Canonical("1-1"));
            Assert.AreEqual(0, LevelLayout.Pick(variants, null, dev), "没有路线的局（调试局 / 生涯第一局）：主走法");

            var seen = new int[3];
            for (int seed = 1; seed <= 200; seed++)
            {
                RunState Make()
                {
                    var r = new RunState { heroId = "fox", seed = seed, route = RunRoute.Build(seed).maps };
                    r.EnterStage(r.Route.First);
                    return r;
                }
                int a = LevelLayout.Pick(variants, null, Make()), b = LevelLayout.Pick(variants, null, Make());
                Assert.AreEqual(a, b, "同一局同一关（重来 / 续玩）抽到同一个变体");
                seen[a]++;
            }
            Assert.Greater(seen[0], 60);
            Assert.Greater(seen[1], 60);
            Assert.AreEqual(0, seen[2]);
        }
    }
}
