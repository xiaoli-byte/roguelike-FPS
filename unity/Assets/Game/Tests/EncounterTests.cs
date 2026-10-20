using System.Linq;
using NUnit.Framework;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 遭遇框架 v2（docs/unity-parity.md L2）里不用场景的部分：编排的复制 / 计数 / 旧编制互转、精英升格（不加怪、不改模板、
    /// 重型优先、先升没升过的种类、先落最后两波、首领和未登记的不升）、小队词缀的取词顺序、站位角色 / 到场延迟 / 锚点加分、出生体型。
    /// 站位打分和出生安全要 NavMesh 与碰撞体，放在 playtest encounter（TestArena）里测。
    /// </summary>
    public sealed class EncounterTests
    {
        sealed class FakeAffixes : IEliteAffixSource
        {
            public string rolled = "rolled";
            public bool Exists(string affixId) => affixId is "swift" or "volatile" or "rolled";
            public string Roll(EnemyDef def, RunRng rng) => rolled;
        }

        [TearDown]
        public void TearDown() => SquadAffixes.Source = null;

        static EncounterSpec TwoWaves() => EncounterSpec.Of(
            EncounterSpec.Wave("一", EncounterSpec.E("jerboa_blade", 3), EncounterSpec.E("scorpion_archer", 1, 0.5f)),
            EncounterSpec.Wave("二", EncounterSpec.E("tomb_beast", 1), EncounterSpec.E("jerboa_blade", 2)).After(1, 1.2f));

        static int Elites(EncounterSpec s) => s.waves.Sum(w => w.entries.Where(e => e.elite).Sum(e => e.count));

        // ───────────── 编排 ─────────────

        [Test]
        public void TotalsAndDeepClone()
        {
            var s = TwoWaves();
            Assert.AreEqual(7, s.Total);
            Assert.AreEqual(4, s.waves[0].Count);
            var c = s.Clone();
            c.waves[0].entries[0].count = 9;
            c.waves[1].entries = new WaveEntry[0];
            Assert.AreEqual(3, s.waves[0].entries[0].count, "改复制品的条目不能动到模板");
            Assert.AreEqual(2, s.waves[1].entries.Length);
            Assert.IsTrue(new EncounterSpec().IsEmpty);
            Assert.IsTrue(EncounterSpec.Of(EncounterSpec.Wave("空", EncounterSpec.E("jerboa_blade", 0))).IsEmpty, "只数全为 0 也算空");
        }

        [Test]
        public void LegacySquadsKeepTimingAndElites()
        {
            var squads = new[]
            {
                new EncounterSite.Squad { enemy = "jerboa_blade", count = 4 },
                new EncounterSite.Squad { enemy = "scorpion_archer", count = 1, delay = 2f, elite = true },
                new EncounterSite.Squad { enemy = "", count = 3 },
            };
            var s = EncounterSpec.FromSquads(squads, "旧场地");
            Assert.AreEqual(1, s.waves.Length);
            Assert.AreEqual(0f, s.gather, "旧编制开战即出场，不集结");
            Assert.AreEqual(5, s.Total, "空 id 的条目丢掉");
            Assert.AreEqual(0f, s.waves[0].entries[0].arrivalDelay, "旧的 delay 原样当到场延迟（不用角色默认值）");
            Assert.AreEqual(2f, s.waves[0].entries[1].arrivalDelay);
            Assert.IsTrue(s.waves[0].entries[1].elite);
            var back = s.ToSquads();
            Assert.AreEqual(2, back.Length);
            Assert.AreEqual("scorpion_archer", back[1].enemy);
            Assert.AreEqual(2f, back[1].delay);
            Assert.IsTrue(back[1].elite);
        }

        [Test]
        public void ToSquadsMarksPromotableBodiesForSizing()
        {
            var s = TwoWaves().Elites(1);
            var rows = s.ToSquads();
            Assert.AreEqual(s.Total, rows.Sum(r => r.count), "补的精英记录只数为 0，不改总数");
            CollectionAssert.AreEquivalent(new[] { "jerboa_blade", "scorpion_archer", "tomb_beast" },
                rows.Where(r => r.elite && r.count == 0).Select(r => r.enemy).ToArray(), "每种普通单位补一条精英记录（体型按精英算）");
        }

        [Test]
        public void SiteSquadsSetterWritesSpec()
        {
            var go = new UnityEngine.GameObject("site");
            try
            {
                var site = go.AddComponent<EncounterSite>();
                site.squads = new[] { new EncounterSite.Squad { enemy = "fire_rat", count = 3, delay = 1f } };
                Assert.AreEqual(3, site.spec.Total);
                Assert.AreEqual(1, site.squads.Length);
                Assert.AreEqual("fire_rat", site.squads[0].enemy);
                Assert.AreEqual(1, site.WaveCount);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(go);
            }
        }

        // ───────────── 精英升格 ─────────────

        [Test]
        public void PromotionReplacesBodiesWithoutAdding()
        {
            var template = TwoWaves();
            for (int seed = 1; seed <= 40; seed++)
            {
                var s = template.Clone();
                int done = EncounterSpec.Promote(s, 2, new RunRng(seed));
                Assert.AreEqual(2, done);
                Assert.AreEqual(template.Total, s.Total, "升格不加怪");
                Assert.AreEqual(2, Elites(s));
                Assert.AreEqual(1, s.waves[1].entries.Where(e => e.elite).Sum(e => e.count), "第 1 只落在最后一波");
                Assert.AreEqual(1, s.waves[0].entries.Where(e => e.elite).Sum(e => e.count), "第 2 只落在倒数第二波");
                Assert.IsFalse(s.waves.Any(w => w.entries.Any(e => e.count <= 0)), "只数减到 0 的条目要去掉");
                Assert.IsFalse(s.waves.Any(w => w.entries.Any(e => e.elite && e.holdBack)), "精英不拆侧翼");
            }
            Assert.AreEqual(0, Elites(template), "模板不被改动");
        }

        [Test]
        public void PromotionPrefersHeavyAndFreshKinds()
        {
            int beastFirst = 0;
            for (int seed = 1; seed <= 200; seed++)
            {
                var s = EncounterSpec.Of(EncounterSpec.Wave("", EncounterSpec.E("jerboa_blade", 3), EncounterSpec.E("tomb_beast", 1)));
                EncounterSpec.Promote(s, 1, new RunRng(seed));
                if (s.waves[0].entries.Any(e => e.elite && e.enemy == "tomb_beast")) beastFirst++;
            }
            Assert.Greater(beastFirst, 170, "镇墓兽（重型、冲锋）应远比跳鼠先升");

            var two = EncounterSpec.Of(EncounterSpec.Wave("", EncounterSpec.E("jerboa_blade", 3), EncounterSpec.E("tomb_beast", 2)));
            EncounterSpec.Promote(two, 2, new RunRng(7));
            CollectionAssert.AreEquivalent(new[] { "jerboa_blade", "tomb_beast" },
                two.waves[0].entries.Where(e => e.elite).Select(e => e.enemy).ToArray(), "同一场地先升没升过的种类");
        }

        [Test]
        public void PromotionSkipsUnknownAndStopsWhenNothingLeft()
        {
            var s = EncounterSpec.Of(EncounterSpec.Wave("", EncounterSpec.E("no_such_enemy", 4), EncounterSpec.E("fire_rat", 1)));
            Assert.AreEqual(1, EncounterSpec.Promote(s, 3, new RunRng(3)), "未登记的不升；可升的用完就停");
            Assert.AreEqual(5, s.Total);
            Assert.AreEqual(0, EncounterSpec.Promote(null, 2, new RunRng(1)));
            Assert.AreEqual(0, EncounterSpec.Promote(new EncounterSpec(), 2, new RunRng(1)));
        }

        // ───────────── 小队词缀 ─────────────

        [Test]
        public void AffixOrderEntryThenSquadThenRoll()
        {
            var def = EnemyRoster.Get("jerboa_blade");
            var rng = new RunRng(5);
            Assert.IsNull(SquadAffixes.Resolve(def, false, "swift", "volatile", rng), "普通单位不带词缀");
            Assert.AreEqual("swift", SquadAffixes.Resolve(def, true, "swift", "", rng), "没有词缀登记时写死的原样透传");
            Assert.IsNull(SquadAffixes.Resolve(def, true, "", "", rng), "没有词缀登记时不随机");

            var src = new FakeAffixes();
            SquadAffixes.Source = src;
            Assert.AreEqual("swift", SquadAffixes.Resolve(def, true, "swift", "volatile", rng), "条目优先");
            Assert.AreEqual("volatile", SquadAffixes.Resolve(def, true, "", "volatile", rng), "其次小队词缀");
            Assert.AreEqual("rolled", SquadAffixes.Resolve(def, true, "", "", rng), "最后随机");
            Assert.AreEqual("volatile", SquadAffixes.Resolve(def, true, "unknown_affix", "volatile", rng), "登记里没有的跳过（只打一次警告）");
            src.rolled = null;
            Assert.IsNull(SquadAffixes.Resolve(def, true, "", "", rng), "登记给不出词缀");
        }

        [Test]
        public void AffixRespectsExclusions()
        {
            var def = new EnemyDef { id = "test_bomber", affixExclusions = new[] { "volatile" } };
            SquadAffixes.Source = new FakeAffixes();
            Assert.AreEqual("rolled", SquadAffixes.Resolve(def, true, "volatile", "volatile", new RunRng(1)), "排除表里的词缀不给，改随机");
            var boss = new EnemyDef { id = "test_boss", rank = Rank.Boss };
            Assert.IsNull(SquadAffixes.Resolve(boss, true, "swift", "", new RunRng(1)), "首领不带词缀");
        }

        // ───────────── 站位 ─────────────

        [Test]
        public void RolesArrivalAndAnchorBonus()
        {
            Assert.AreEqual(StationRole.Flank, SpawnStations.Resolve(StationRole.Auto, EnemyRoster.Get("jerboa_blade")));
            Assert.AreEqual(StationRole.Ranged, SpawnStations.Resolve(StationRole.Auto, EnemyRoster.Get("scorpion_archer")));
            Assert.AreEqual(StationRole.Artillery, SpawnStations.Resolve(StationRole.Auto, EnemyRoster.Get("mirage_toad")));
            Assert.AreEqual(StationRole.Support, SpawnStations.Resolve(StationRole.Auto, EnemyRoster.Get("apsara")));
            Assert.AreEqual(StationRole.Assault, SpawnStations.Resolve(StationRole.Auto, EnemyRoster.Get("tomb_beast")));
            Assert.AreEqual(StationRole.Ranged, SpawnStations.Resolve(StationRole.Ranged, EnemyRoster.Get("apsara")), "条目写了角色就用写的");
            Assert.AreEqual(StationRole.Assault, SpawnStations.Resolve(StationRole.Auto, null));

            var order = new[] { StationRole.Assault, StationRole.Ranged, StationRole.Support, StationRole.Flank, StationRole.Precision, StationRole.Artillery }
                .Select(SpawnStations.DefaultArrival).ToArray();
            CollectionAssert.IsOrdered(order, "前排先到、远程稍晚、侧袭与狙击再晚、炮手最后");

            var q = new SpawnStations.Query { role = StationRole.Ranged, lane = 1 };
            Assert.AreEqual(8 + 2 + 3, SpawnStations.AnchorBonus(q, StationRole.Ranged, 1, true), 1e-4f, "角色 + lane + 远程上高台");
            Assert.AreEqual(-3, SpawnStations.AnchorBonus(q, StationRole.Flank, 0, false), 1e-4f, "角色不对");
            Assert.AreEqual(2, SpawnStations.AnchorBonus(q, StationRole.Auto, 1, false), 1e-4f, "Auto 站位不加不减");
            q.role = StationRole.Assault;
            Assert.AreEqual(8 - 1.5f, SpawnStations.AnchorBonus(q, StationRole.Assault, 0, true), 1e-4f, "正面不爱上高台");

            var charger = SpawnStations.ProfileOf(StationRole.Assault, true);
            Assert.Greater(charger.Mid, SpawnStations.ProfileOf(StationRole.Assault).Mid, "冲锋型的距离带更远");
        }

        [Test]
        public void BodySizeScalesWithEliteAndArt()
        {
            var def = EnemyRoster.Get("tomb_beast");
            var (r, h) = SpawnStations.BodySize(def, false);
            var (re, he) = SpawnStations.BodySize(def, true);
            Assert.AreEqual(def.radius * def.scale + 0.15f, r, 1e-4f);
            Assert.AreEqual(UnityEngine.Mathf.Max(def.height * def.scale + 0.1f, r * 2), h, 1e-4f, "高度至少是两倍半径（宽身体，如镇墓兽）");
            Assert.AreEqual(def.radius * def.scale * 1.25f + 0.15f, re, 1e-4f, "精英 ×1.25");
            Assert.Greater(he, h);
        }
    }
}
