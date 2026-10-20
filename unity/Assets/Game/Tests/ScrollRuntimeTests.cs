using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 秘卷运行时（S0）：作用域装卸不留残余（属性、事件、修饰器、任务、限时增益、条件属性）、叠层 = 卸载重装 + 批处理（上限只补净增量）、
    /// 内置冷却 / 状态槽、描述模板、数据校验、预览不碰全局、沙盒、读档；ScrollRoll 的权重公式与 Three.js Scrolls.ts 逐项一致，
    /// 10 万次抽样的分布与公式误差 &lt; 1%（docs/unity-parity.md 7.3）。
    /// EditMode：<see cref="ScrollTicker"/> 用手动时钟，<see cref="ScrollTicker.Step"/> 推进；不依赖场景和玩家。
    /// </summary>
    public sealed class ScrollRuntimeTests
    {
        const float Eps = 1e-4f;
        StatSheet savedStats;
        readonly List<GameObject> made = new();

        [SetUp]
        public void SetUp()
        {
            savedStats = Combat.playerStats;
            ScrollTicker.ResetForTests();
        }

        [TearDown]
        public void TearDown()
        {
            Combat.playerStats = savedStats;
            ScrollTicker.ResetForTests();
            ScrollSandbox.Clear();
            foreach (var go in made)
                if (go) Object.DestroyImmediate(go);
            made.Clear();
        }

        Damageable Enemy(Rank rank = Rank.Normal)
        {
            var go = new GameObject("test enemy");
            made.Add(go);
            var d = go.AddComponent<Damageable>();
            d.maxHealth = 100;
            d.rank = rank;
            return d;
        }

        /// <summary>什么钩子都登记一遍的测试秘卷</summary>
        sealed class ProbeScroll : ScrollDef
        {
            public int installs, lastStacks, healed, kills, ticks, everies;
            public Damageable enemy;
            public TimedBuff buff;
            public bool toggleOn;
            public Box<int> local, kept;

            public ProbeScroll()
            {
                id = "test_probe";
                name = "探针";
                description = "测试 {n}/{max} 层，伤害 +{n*10}%";
                rarity = 1;
                maxStacks = 3;
                tags = new[] { "测试" };
            }

            public override void Install(ScrollScope s, int n)
            {
                installs++;
                lastStacks = n;
                s.Stat(Stat.DamagePct, 0.1f * n);
                buff = s.Buff((Stat.CritChance, 0.2f));
                s.Toggle(new[] { (Stat.MoveSpeed, 1f) }, () => toggleOn);
                s.AddOutgoing((in HitContext c) => 2f);
                s.AddIncoming((in IncomingHit h) => 0.5f);
                if (enemy) s.AddEnemyIncoming(enemy, (in IncomingHit h) => 0.5f);
                s.OnPlayerHealed(_ => healed++);
                s.OnKill((in KillEvent e) => kills++);
                s.Task(_ => ticks++);
                s.Every(1f, () => everies++);
                local = s.Var("local", 0);
                kept = s.Keep("kept", 0);
            }
        }

        static KillEvent Kill(Damageable d, bool purge = false)
        {
            var info = DamageInfo.Simple(10, DamageSource.Weapon, Vector3.zero, Vector3.forward);
            if (purge) info.tags |= DamageTag.Purge;
            return new KillEvent { enemy = d, info = info };
        }

        // ───────────── 作用域 ─────────────

        [Test]
        public void InstallThenRemoveLeavesNoResidue()
        {
            var sheet = StatSheet.Default();
            var inv = new ScrollInventory();
            var probe = new ProbeScroll { enemy = Enemy() };
            int out0 = Combat.Outgoing.Count, in0 = PlayerVitals.Incoming.Count, tasks0 = ScrollTicker.TaskCount;

            Assert.IsTrue(inv.Gain(probe, sheet));
            Assert.AreEqual(out0 + 1, Combat.Outgoing.Count, "输出修饰器");
            Assert.AreEqual(in0 + 1, PlayerVitals.Incoming.Count, "玩家受伤修饰器");
            Assert.AreEqual(1, probe.enemy.Incoming.Count, "敌人承伤修饰器");
            Assert.AreEqual(tasks0 + 3, ScrollTicker.TaskCount, "逐帧 + 定时 + 增益 / 条件属性的状态任务");
            Assert.AreEqual(0.1f, sheet.Get(Stat.DamagePct), Eps);

            GameEvents.RaisePlayerHealed(5);
            var k = Kill(probe.enemy);
            GameEvents.RaiseEnemyKilled(in k);
            var purge = Kill(probe.enemy, true);
            GameEvents.RaiseEnemyKilled(in purge);
            Assert.AreEqual(1, probe.healed);
            Assert.AreEqual(1, probe.kills, "OnKill 跳过静默处决");

            probe.buff.Trigger(2);
            probe.toggleOn = true;
            ScrollTicker.Step(1.05f);
            Assert.AreEqual(0.25f, sheet.Get(Stat.CritChance), Eps, "限时增益生效");
            Assert.AreEqual(8.5f, sheet.Get(Stat.MoveSpeed), Eps, "条件属性生效");
            Assert.Greater(probe.ticks, 0);
            Assert.AreEqual(1, probe.everies);

            inv.Remove(probe.id);
            Assert.AreEqual(out0, Combat.Outgoing.Count, "卸载后输出修饰器回到原数");
            Assert.AreEqual(in0, PlayerVitals.Incoming.Count, "卸载后受伤修饰器回到原数");
            Assert.AreEqual(0, probe.enemy.Incoming.Count, "卸载后敌人承伤修饰器撤掉");
            Assert.AreEqual(tasks0, ScrollTicker.TaskCount, "卸载后任务回到原数");
            Assert.AreEqual(0, sheet.Get(Stat.DamagePct), Eps);
            Assert.AreEqual(0.05f, sheet.Get(Stat.CritChance), Eps);
            Assert.AreEqual(7.5f, sheet.Get(Stat.MoveSpeed), Eps);
            foreach (var src in new[] { "scroll:test_probe", "scroll:test_probe#buff0", "scroll:test_probe#toggle0" })
                Assert.IsFalse(sheet.HasSource(src), $"属性来源 {src} 没撤掉");
            Assert.AreEqual(0, inv.Stacks(probe.id));

            int healed = probe.healed, kills = probe.kills, ticks = probe.ticks;
            GameEvents.RaisePlayerHealed(5);
            GameEvents.RaiseEnemyKilled(in k);
            ScrollTicker.Step(2f);
            Assert.AreEqual(healed, probe.healed, "卸载后不再收到事件");
            Assert.AreEqual(kills, probe.kills);
            Assert.AreEqual(ticks, probe.ticks, "卸载后任务不再跑");
        }

        [Test]
        public void StackingReinstallsWithNewStacksAndKeepsOneOfEachHook()
        {
            var sheet = StatSheet.Default();
            var inv = new ScrollInventory();
            var probe = new ProbeScroll { enemy = Enemy() };
            int out0 = Combat.Outgoing.Count, tasks0 = ScrollTicker.TaskCount;
            for (int i = 0; i < 3; i++) Assert.IsTrue(inv.Gain(probe, sheet));
            Assert.IsFalse(inv.Gain(probe, sheet), "满层再加返回 false");
            Assert.AreEqual(3, probe.installs, "满层时不再重装");
            Assert.AreEqual(3, probe.lastStacks);
            Assert.AreEqual(0.3f, sheet.Get(Stat.DamagePct), Eps, "属性是 3 层的总量，不是 1 + 2 + 3 层累加");
            Assert.AreEqual(out0 + 1, Combat.Outgoing.Count, "叠层后只剩一个输出修饰器");
            Assert.AreEqual(1, probe.enemy.Incoming.Count);
            Assert.AreEqual(tasks0 + 3, ScrollTicker.TaskCount);
            GameEvents.RaisePlayerHealed(1);
            Assert.AreEqual(1, probe.healed, "叠层后事件只响应一次");
            inv.Clear();
        }

        [Test]
        public void StackingCommitsInOneBatchSoMaxHpIsNotGrantedTwice()
        {
            var sheet = StatSheet.Default();
            var inv = new ScrollInventory();
            var iron = ScrollLibrary.Get("iron_bones");
            Assert.IsNotNull(iron);
            // 模拟 PlayerVitals.OnStatsChanged：上限增加时当前值同步加，减少时截断
            float health = 50, last = sheet.Get(Stat.MaxHp);
            int changed = 0;
            sheet.Changed += () =>
            {
                changed++;
                float hp = sheet.Get(Stat.MaxHp);
                health = Mathf.Clamp(health + Mathf.Max(0, hp - last), 0, hp);
                last = hp;
            };
            Assert.IsTrue(inv.Gain(iron, sheet));
            Assert.AreEqual(1, changed, "一次获得只发一次 Changed");
            Assert.AreEqual(62, health, Eps);
            Assert.IsTrue(inv.Gain(iron, sheet));
            Assert.AreEqual(2, changed);
            Assert.AreEqual(74, health, Eps, "第二层只回 12（先撤后加若不批处理会再送 12）");
            Assert.AreEqual(124, sheet.Get(Stat.MaxHp), Eps);
            inv.Remove(iron.id);
            Assert.AreEqual(100, sheet.Get(Stat.MaxHp), Eps);
            Assert.AreEqual(74, health, Eps, "移除时只截断，不加");
        }

        [Test]
        public void StatScrollStackMathMatchesTs()
        {
            var sheet = StatSheet.Default();
            var inv = new ScrollInventory();
            var keen = ScrollLibrary.Get("keen_blade");
            for (int i = 0; i < 5; i++) inv.Gain(keen, sheet);
            Assert.AreEqual(0.30f, sheet.Get(Stat.DamagePct), Eps);
            Assert.AreEqual(1.30f, sheet.Mult(Stat.DamagePct), Eps);
            var recovery = ScrollLibrary.Get("quick_recovery");
            for (int i = 0; i < 3; i++) inv.Gain(recovery, sheet);
            Assert.AreEqual(3 - 1.2f, sheet.Get(Stat.ShieldRegenDelay), Eps);
            Assert.AreEqual(30 + 24f, sheet.Get(Stat.ShieldRegenRate), Eps);
            Assert.AreEqual(2, inv.Count);
            CollectionAssert.AreEqual(new[] { "keen_blade", "quick_recovery" }, inv.Order.ToArray(), "按获得顺序");
            inv.Clear();
            Assert.AreEqual(0, sheet.Get(Stat.DamagePct), Eps);
        }

        [Test]
        public void BuffRefreshesAndExpiresOnTheScrollClock()
        {
            var sheet = StatSheet.Default();
            var inv = new ScrollInventory();
            var probe = new ProbeScroll();
            inv.Gain(probe, sheet);
            probe.buff.Trigger(2);
            ScrollTicker.Step(1.5f);
            probe.buff.Trigger(0.3f);  // 更早到期：不缩短
            Assert.AreEqual(0.5f, probe.buff.Remaining, Eps);
            probe.buff.Trigger(2);  // 更晚到期：刷新
            ScrollTicker.Step(1.9f);
            Assert.IsTrue(probe.buff.IsActive);
            Assert.AreEqual(0.25f, sheet.Get(Stat.CritChance), Eps, "刷新不叠数值");
            ScrollTicker.Step(0.2f);
            Assert.IsFalse(probe.buff.IsActive);
            Assert.AreEqual(0.05f, sheet.Get(Stat.CritChance), Eps);
            inv.Clear();
        }

        [Test]
        public void ReadyCooldownsAndStateSlots()
        {
            var inv = new ScrollInventory();
            var probe = new ProbeScroll();
            inv.Gain(probe, (StatSheet)null);
            var scope = inv.ScopeOf(probe.id);
            Assert.IsTrue(scope.Ready("k", 1));
            Assert.IsFalse(scope.Ready("k", 1));
            Assert.IsTrue(scope.Ready("other", 1), "不同 key 互不影响");
            ScrollTicker.Step(0.6f);
            Assert.AreEqual(0.4f, scope.CooldownLeft("k"), Eps);
            ScrollTicker.Step(0.5f);
            Assert.IsTrue(scope.Ready("k", 1));

            var a = Enemy();
            var b = Enemy();
            Assert.IsTrue(scope.ReadyFor(a, "icd", 0.4f));
            Assert.IsFalse(scope.ReadyFor(a, "icd", 0.4f));
            Assert.IsTrue(scope.ReadyFor(b, "icd", 0.4f), "按目标分开");

            var cd = new ScrollKit.Cooldown();
            Assert.IsTrue(cd.Ready(2));
            Assert.IsFalse(cd.Ready(2));
            ScrollTicker.Step(2.01f);
            Assert.IsTrue(cd.IsReady);

            probe.local.value = 5;
            probe.kept.value = 7;
            inv.Gain(probe, (StatSheet)null);
            Assert.AreEqual(0, probe.local.value, "Var 随叠层重来");
            Assert.AreEqual(7, probe.kept.value, "Keep 跨叠层保留");
            inv.Remove(probe.id);
            inv.Gain(probe, (StatSheet)null);
            Assert.AreEqual(0, probe.kept.value, "整卷移除后 Keep 清掉");
            inv.Clear();
        }

        [Test]
        public void EnemyIncomingIsRemovedWhenItsHandleIsDisposedEarly()
        {
            var inv = new ScrollInventory();
            var d = Enemy();
            var def = new ProbeScroll();
            inv.Gain(def, (StatSheet)null);
            var scope = inv.ScopeOf(def.id);
            var h = scope.AddEnemyIncoming(d, (in IncomingHit x) => 0.25f);
            Assert.AreEqual(1, d.Incoming.Count);
            h.Dispose();
            h.Dispose();
            Assert.AreEqual(0, d.Incoming.Count);
            inv.Clear();
        }

        [Test]
        public void PreviewStatsIsADryRun()
        {
            var probe = new ProbeScroll();
            int out0 = Combat.Outgoing.Count, tasks0 = ScrollTicker.TaskCount;
            var stats = probe.PreviewStats(2);
            Assert.AreEqual(1, stats.Count);
            Assert.AreEqual(Stat.DamagePct, stats[0].stat);
            Assert.AreEqual(0.2f, stats[0].value, Eps);
            Assert.AreEqual(out0, Combat.Outgoing.Count, "预览不登记修饰器");
            Assert.AreEqual(tasks0, ScrollTicker.TaskCount, "预览不登记任务");
            var keen = ScrollLibrary.Get("keen_blade");
            Assert.AreEqual(0.18f, keen.PreviewStats(3)[0].value, Eps);
        }

        [Test]
        public void DescribeResolvesTemplates()
        {
            var probe = new ProbeScroll();
            Assert.AreEqual("测试 2/3 层，伤害 +20%", probe.Describe(2));
            var s = new StatScroll
            {
                id = "t", name = "t", maxStacks = 5, description = "武器伤害每层 {s0}（当前 {t0}），回复 {n*0.5} 秒，{unknown}",
                stats = new[] { (Stat.DamagePct, 0.06f) },
            };
            Assert.AreEqual("武器伤害每层 +6%（当前 +18%），回复 1.5 秒，{unknown}", s.Describe(3));
            Assert.AreEqual(ScrollLibrary.Get("keen_blade").description, ScrollLibrary.Get("keen_blade").Describe(2), "没有占位的描述原样返回");
        }

        [Test]
        public void ProcScaleMatchesTs()
        {
            Assert.AreEqual(1f, ScrollKit.ProcScale(1f), Eps);
            Assert.AreEqual(1f, ScrollKit.ProcScale(0.5f), Eps, "难度低于 1 不打折");
            Assert.AreEqual(1 + 1.28f * 0.85f, ScrollKit.ProcScale(2.28f), Eps);
            Assert.AreEqual(1f, ScrollKit.ProcScale(float.NaN), Eps);
        }

        // ───────────── 校验 ─────────────

        [Test]
        public void RegistryPassesValidation()
        {
            var errors = ScrollLibrary.Validate(Registry<ScrollDef>.All, out _);
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [Test]
        public void ValidationCatchesBadDefs()
        {
            var defs = new ScrollDef[]
            {
                new StatScroll { id = "dup", name = "甲", description = "x" },
                new StatScroll { id = "DUP", name = "乙", description = "x" },
                new StatScroll { id = "zero", name = "丙", description = "x", maxStacks = 0 },
                new StatScroll { id = "rar", name = "丁", description = "x", rarity = 5 },
                new StatScroll { id = "tpl", name = "戊", description = "每层 {s3}" },
                new StatScroll { id = "brace", name = "己", description = "每层 {n" },
                new StatScroll { id = "", name = "庚", description = "x" },
                new StatScroll { id = "nodesc", name = "辛" },
            };
            var errors = ScrollLibrary.Validate(defs, out _);
            string all = string.Join("\n", errors);
            StringAssert.Contains("重复", all);
            StringAssert.Contains("层数上限", all);
            StringAssert.Contains("稀有度", all);
            StringAssert.Contains("{s3}", all);
            StringAssert.Contains("花括号", all);
            StringAssert.Contains("id 为空", all);
            StringAssert.Contains("没有描述", all);
        }

        // ───────────── 抽取 ─────────────

        static StatScroll Def(string id, int rarity, int maxStacks = 3, string hero = null, params string[] tags) => new()
        {
            id = id, name = id, rarity = rarity, maxStacks = maxStacks, heroOnly = hero, description = "x",
            tags = tags.Length > 0 ? tags : new[] { "测试" },
        };

        static readonly ScrollDef[] Pool =
        {
            Def("c0", 0), Def("c1", 0, 5), Def("u0", 1), Def("u1", 1), Def("r0", 2), Def("e0", 3, 1), Def("l0", 4, 1),
            Def("owned", 1), Def("maxed", 0, 2), Def("fox_only", 2, 1, "fox"), Def("falcon_only", 2, 1, "falcon"),
            Def("rx_plain", 1, 3, null, "反应"), Def("rx_flow", 2, 3, null, "反应", "焚雷"), Def("rx_fox", 3, 1, "fox", "反应", "熔金"),
            Def("elem", 0, 3, null, "元素"),
        };

        static ScrollRoll.Context Ctx(bool elem = false) => new()
        {
            heroId = "fox", luck = 2, chapter = 1, hasElementSource = elem,
            stacks = new Dictionary<string, int> { ["owned"] = 1, ["maxed"] = 2 },
            flows = new HashSet<string> { "焚雷" },
        };

        [Test]
        public void WeightFormulaMatchesTs()
        {
            var c = Ctx();
            // 稀有度项：1 + r × (0.1 × 2 + 0.18 × 1) = 1 + 0.38r
            Assert.AreEqual(100f, ScrollRoll.Weight(Def("a", 0), c), Eps);
            Assert.AreEqual(52f * 1.38f, ScrollRoll.Weight(Def("a", 1), c), 1e-3f);
            Assert.AreEqual(26f * 1.76f, ScrollRoll.Weight(Def("a", 2), c), 1e-3f);
            Assert.AreEqual(11f * 2.14f, ScrollRoll.Weight(Def("a", 3), c), 1e-3f);
            Assert.AreEqual(4f * 2.52f, ScrollRoll.Weight(Def("a", 4), c), 1e-3f);
            Assert.AreEqual(52f * 1.38f * 1.3f, ScrollRoll.Weight(Pool.First(d => d.id == "owned"), c), 1e-3f, "已有 ×1.3");
            Assert.AreEqual(26f * 1.76f * 1.5f, ScrollRoll.Weight(Pool.First(d => d.id == "fox_only"), c), 1e-3f, "专属 ×1.5");
            Assert.AreEqual(52f * 1.38f * 0.5f, ScrollRoll.Weight(Pool.First(d => d.id == "rx_plain"), c), 1e-3f, "反应卷没有元素来源 ×0.5");
            Assert.AreEqual(52f * 1.38f * 1.4f, ScrollRoll.Weight(Pool.First(d => d.id == "rx_plain"), Ctx(true)), 1e-3f, "有元素来源 ×1.4");
            Assert.AreEqual(26f * 1.76f * 0.5f * 1.3f, ScrollRoll.Weight(Pool.First(d => d.id == "rx_flow"), c), 1e-3f, "未拥有且属于已投入流派 ×1.3");
            Assert.AreEqual(11f * 2.14f * 1.5f, ScrollRoll.Weight(Pool.First(d => d.id == "rx_fox"), c), 1e-3f, "专属反应卷不按元素来源降权");
            var zero = new ScrollRoll.Context { heroId = "fox" };
            CollectionAssert.AreEqual(new[] { 100f, 52f, 26f, 11f, 4f }, ScrollRoll.RarityWeight);
            Assert.AreEqual(4f, ScrollRoll.Weight(Def("a", 4), zero), Eps, "没有幸运和章节时就是基础权重");
        }

        [Test]
        public void RollFiltersMaxedOtherHeroesMinRarityAndExclude()
        {
            var c = Ctx();
            var pool = ScrollRoll.Pool(Pool, c).Select(d => d.id).ToList();
            CollectionAssert.DoesNotContain(pool, "maxed");
            CollectionAssert.DoesNotContain(pool, "falcon_only");
            CollectionAssert.Contains(pool, "fox_only");
            CollectionAssert.Contains(pool, "owned");
            c.minRarity = 2;
            c.exclude = new[] { "r0" };
            var hi = ScrollRoll.Pool(Pool, c);
            Assert.IsTrue(hi.All(d => d.rarity >= 2));
            Assert.IsFalse(hi.Any(d => d.id == "r0"));

            var rng = new RunRng(7);
            for (int i = 0; i < 200; i++)
            {
                var pick = ScrollRoll.Roll(Pool, 3, Ctx(), rng);
                Assert.AreEqual(3, pick.Count);
                Assert.AreEqual(3, pick.Distinct().Count(), "不放回");
            }
            Assert.AreEqual(ScrollRoll.Pool(Pool, Ctx()).Count, ScrollRoll.Roll(Pool, 99, Ctx(), rng).Count, "池子不够就少给");
            var nobody = new ScrollRoll.Context { heroId = null };
            Assert.IsFalse(ScrollRoll.Pool(Pool, nobody).Any(d => d.heroOnly != null), "没有英雄时不出专属");
        }

        [Test]
        public void RollDistributionMatchesFormulaOver100kSamples()
        {
            const int N = 100_000;
            var c = Ctx();
            var expected = ScrollRoll.Probabilities(Pool, c);
            var counts = new Dictionary<ScrollDef, int>();
            var rng = new RunRng(20261020);
            for (int i = 0; i < N; i++)
            {
                var d = ScrollRoll.Roll(Pool, 1, c, rng)[0];
                counts[d] = counts.TryGetValue(d, out var n) ? n + 1 : 1;
            }
            foreach (var kv in expected)
            {
                counts.TryGetValue(kv.Key, out var got);
                double p = (double)got / N;
                Assert.Less(System.Math.Abs(p - kv.Value), 0.01, $"{kv.Key.id}：抽样 {p:P2}，公式 {kv.Value:P2}");
            }
            Assert.AreEqual(expected.Count, counts.Count, "抽到了池子外的卷");
            // 按稀有度合计也比一遍
            for (int r = 0; r < Rarity.Count; r++)
            {
                double e = expected.Where(kv => kv.Key.rarity == r).Sum(kv => kv.Value);
                double g = counts.Where(kv => kv.Key.rarity == r).Sum(kv => kv.Value) / (double)N;
                Assert.Less(System.Math.Abs(g - e), 0.01, $"稀有度 {r}：抽样 {g:P2}，公式 {e:P2}");
            }
        }

        [Test]
        public void RegistryRollUsesTsWeights()
        {
            // 现有 16 卷（稀有度 0–2）、没有幸运 / 章节 / 持有：普通单卷 100、精良 52、稀有 26
            var c = new ScrollRoll.Context { heroId = "fox" };
            var p = ScrollRoll.Probabilities(Registry<ScrollDef>.All, c);
            double total = Registry<ScrollDef>.All.Where(d => d.heroOnly == null || d.heroOnly == "fox").Sum(d => (double)ScrollRoll.RarityWeight[d.rarity]);
            var keen = ScrollLibrary.Get("keen_blade");
            Assert.AreEqual(100 / total, p[keen], 1e-9);
        }

        [Test]
        public void ElementSourceAndFlows()
        {
            Assert.IsTrue(ScrollRoll.HasElementSource("fox", null, null));
            Assert.IsTrue(ScrollRoll.HasElementSource("falcon", null, null));
            Assert.IsFalse(ScrollRoll.HasElementSource("bear", null, null));
            Assert.IsTrue(ScrollRoll.HasElementSource("bear", null, new[] { Pool.First(d => d.id == "elem") }));
            var flows = ScrollRoll.Flows(new[] { Pool.First(d => d.id == "rx_flow"), Pool.First(d => d.id == "rx_fox") });
            CollectionAssert.AreEquivalent(new[] { "焚雷", "熔金" }, flows);
        }

        // ───────────── 沙盒 / 读档 ─────────────

        [Test]
        public void SandboxGrantsAndRemovesById()
        {
            ScrollSandbox.Clear();
            Assert.AreEqual(2, ScrollSandbox.Grant("keen_blade", 2));
            Assert.AreEqual(2, ScrollSandbox.Inventory.Stacks("keen_blade"));
            Assert.AreEqual(5, ScrollSandbox.Max("keen_blade"));
            Assert.AreEqual(0, ScrollSandbox.Grant("keen_blade"), "满层不再加");
            Assert.AreEqual(1, ScrollSandbox.SetStacks("streamer", 9), "夹到上限");
            StringAssert.Contains("利刃×5", ScrollSandbox.Describe());
            Assert.IsTrue(ScrollSandbox.Remove("keen_blade"));
            Assert.IsFalse(ScrollSandbox.Remove("keen_blade"));
            Assert.AreEqual(0, ScrollSandbox.Grant("no_such_scroll"));
            int all = ScrollSandbox.GrantAll(maxed: true);
            Assert.AreEqual(Registry<ScrollDef>.All.Count(d => d.heroOnly == null || d.heroOnly == ScrollRoll.ContextFor(ScrollSandbox.Inventory, null).heroId), all);
            ScrollSandbox.Clear();
            Assert.AreEqual(0, ScrollSandbox.Inventory.Count);
        }

        [Test]
        public void CaptureRestoreRoundTrip()
        {
            var sheet = StatSheet.Default();
            var inv = new ScrollInventory();
            inv.Gain(ScrollLibrary.Get("keen_blade"), sheet);
            inv.Gain(ScrollLibrary.Get("keen_blade"), sheet);
            inv.Gain(ScrollLibrary.Get("iron_bones"), sheet);
            var run = new RunState();
            inv.Capture(run);
            Assert.AreEqual(2, run.scrolls["keen_blade"]);
            Assert.AreEqual(1, run.scrolls["iron_bones"]);

            var sheet2 = StatSheet.Default();
            var inv2 = new ScrollInventory();
            int changed = 0;
            sheet2.Changed += () => changed++;
            run.scrolls["bogus"] = 3;
            inv2.Restore(run, sheet2);
            Assert.AreEqual(1, changed, "整批恢复只发一次 Changed");
            Assert.AreEqual(2, inv2.Stacks("keen_blade"));
            Assert.AreEqual(0.12f, sheet2.Get(Stat.DamagePct), Eps);
            Assert.AreEqual(112, sheet2.Get(Stat.MaxHp), Eps);
            Assert.IsFalse(inv2.Has("bogus"));
            inv.Clear();
            inv2.Clear();
        }
    }
}
