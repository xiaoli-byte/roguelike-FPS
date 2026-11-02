using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第三章 v2 的 S1 / S2 不用场景的部分：编组库 G01–G14 的自查（每波 ≤ 3 种、远程 ≤ 3、名册里都有）、出场方式字段的默认值与复制、
    /// 站位按出场方式筛选（有这种站位只用它们，没有退回现身）、路遇的设置。真正的出场表现在 playtest squads-ch3（TestArena）里测。
    /// </summary>
    public sealed class InfernoSquadsTests
    {
        readonly List<GameObject> made = new();

        [TearDown]
        public void TearDown()
        {
            foreach (var go in made)
                if (go)
                    Object.DestroyImmediate(go);
            made.Clear();
        }

        [Test]
        public void AllSquadsPassTheirOwnRules()
        {
            Assert.AreEqual(14, InfernoSquads.All.Count);
            var problems = new List<string>();
            foreach (var s in InfernoSquads.All)
            {
                var w = s.make();
                Assert.IsNotNull(w, s.id);
                Assert.Greater(w.Count, 0, $"{s.id} 是空的");
                Assert.AreEqual(s.name, w.label, $"{s.id} 的波次名");
                InfernoSquads.Check(w, s.id, problems.Add);
            }
            Assert.IsEmpty(problems, string.Join("\n", problems));
        }

        [Test]
        public void EliteSquadsCarryFixedAffixes()
        {
            var g12 = InfernoSquads.G12();
            var elite = g12.entries.Single(e => e.elite);
            Assert.AreEqual(InfernoSquads.Mamian, elite.enemy);
            Assert.AreEqual(InfernoSquads.Frenzied, elite.affix);
            Assert.AreEqual(SpawnMode.Drop, elite.via);
            var g02 = InfernoSquads.G02(eliteAffix: InfernoSquads.Swift);
            Assert.AreEqual(4, g02.entries.Where(e => e.enemy == InfernoSquads.Huodou).Sum(e => e.count), "升精英不加怪");
            Assert.AreEqual(1, g02.entries.Count(e => e.elite));
            Assert.AreEqual(0, InfernoSquads.G01().entries.Count(e => e.elite), "余烬潮不配精英");
        }

        [Test]
        public void ZeroCountsDropAndPlusExtends()
        {
            var w = InfernoSquads.G03(tuo: 0, mamian: 1, tantong: 3).Plus(EncounterSpec.E(InfernoSquads.Huodou, 2), EncounterSpec.E(InfernoSquads.Bifang, 0)).Named("狱卒巡岸");
            Assert.AreEqual("狱卒巡岸", w.label);
            Assert.IsFalse(w.entries.Any(e => e.enemy == InfernoSquads.Tuo), "只数 0 的不留条目");
            Assert.IsFalse(w.entries.Any(e => e.enemy == InfernoSquads.Bifang));
            Assert.AreEqual(6, w.Count);
            Assert.AreEqual(3, InfernoSquads.Species(w));
            Assert.AreEqual(1, InfernoSquads.Ranged(w));
        }

        [Test]
        public void CheckFlagsTooManyKindsAndRanged()
        {
            var bad = EncounterSpec.Of(EncounterSpec.Wave("杂烩",
                EncounterSpec.E(InfernoSquads.Tantong, 2), EncounterSpec.E(InfernoSquads.Huodou, 2),
                EncounterSpec.E(InfernoSquads.Mamian, 2).Elite(InfernoSquads.Shielded), EncounterSpec.E(InfernoSquads.Mamian, 1),
                EncounterSpec.E(InfernoSquads.Bifang, 1), EncounterSpec.E("no_such_enemy", 1)));
            var msgs = new List<string>();
            int n = InfernoSquads.Check(bad, "测试", msgs.Add);
            Assert.AreEqual(3, n, string.Join("\n", msgs));
            Assert.IsTrue(msgs.Any(m => m.Contains("种怪")), "5 种怪");
            Assert.IsTrue(msgs.Any(m => m.Contains("远程 4")), "精英马面算原种、算远程");
            Assert.IsTrue(msgs.Any(m => m.Contains("no_such_enemy")));
        }

        [Test]
        public void ViaDefaultsToAppearAndSurvivesClone()
        {
            Assert.AreEqual(SpawnMode.Appear, EncounterSpec.E("tantong", 2).via, "默认现身：旧编排不受影响");
            var s = EncounterSpec.Of(EncounterSpec.Wave("一", EncounterSpec.E("tantong", 2).Via(SpawnMode.Ember)));
            var c = s.Clone();
            Assert.AreEqual(SpawnMode.Ember, c.waves[0].entries[0].via);
            c.waves[0].entries[0].via = SpawnMode.Gate;
            Assert.AreEqual(SpawnMode.Ember, s.waves[0].entries[0].via, "改复制品不动模板");
            Assert.AreEqual(SpawnMode.Gate, InfernoSquads.G04().AllVia(SpawnMode.Gate).entries[0].via);
        }

        Transform Anchor(string name, SpawnMode mode)
        {
            var a = SpawnAnchor.Create(null, name, Vector3.zero).Via(mode);
            made.Add(a.gameObject);
            return a.transform;
        }

        [Test]
        public void AnchorsFilterByModeWithFallback()
        {
            var plain = new GameObject("plain").transform; // 没挂组件的旧锚点 = 现身
            made.Add(plain.gameObject);
            var appear = Anchor("appear", SpawnMode.Appear);
            var lava = Anchor("lava", SpawnMode.LavaCrawl);
            var anchors = new[] { plain, appear, lava };

            Assert.AreEqual(SpawnMode.Appear, SpawnAnchor.ModeOf(plain));
            Assert.AreEqual(SpawnMode.LavaCrawl, SpawnStations.ModeFor(anchors, SpawnMode.LavaCrawl, out bool any1));
            Assert.IsTrue(any1);
            Assert.IsFalse(SpawnModes.Accepts(SpawnMode.Appear, SpawnMode.LavaCrawl, any1), "要爬出时只用爬出站位");
            Assert.IsTrue(SpawnModes.Accepts(SpawnMode.LavaCrawl, SpawnMode.LavaCrawl, any1));

            Assert.AreEqual(SpawnMode.Appear, SpawnStations.ModeFor(anchors, SpawnMode.Drop, out bool any2), "没有跃下站位 → 退回现身");
            Assert.IsTrue(any2);
            Assert.IsFalse(SpawnModes.Accepts(SpawnMode.LavaCrawl, SpawnMode.Appear, any2), "现身条目不站熔岩里的站位");

            Assert.AreEqual(SpawnMode.Appear, SpawnStations.ModeFor(new[] { lava }, SpawnMode.Appear, out bool any3));
            Assert.IsFalse(any3);
            Assert.IsTrue(SpawnModes.Accepts(SpawnMode.LavaCrawl, SpawnMode.Appear, any3), "一个现身站位都没有时用全部站位");
        }

        [Test]
        public void AnchorChainBuildsHelperPoints()
        {
            var a = SpawnAnchor.Create(null, "drop", new Vector3(1, 0, 2), StationRole.Ranged, 1).Via(SpawnMode.Drop).DropFrom(new Vector3(1, 6, 6)).LookAt(new Vector3(1, 0, -10));
            made.Add(a.gameObject);
            Assert.AreEqual(SpawnMode.Drop, a.mode);
            Assert.IsNotNull(a.dropFrom);
            Assert.AreEqual(6f, a.dropFrom.position.y, 1e-4f);
            Assert.Less(Vector3.Dot(a.transform.forward, Vector3.forward), -0.99f, "朝向看向南");
            a.DropFrom(new Vector3(0, 8, 0));
            Assert.AreEqual(1, a.transform.childCount, "再设一次复用同一个子物体");
        }

        [Test]
        public void RoadsideIsOptionalAndQuiet()
        {
            var go = new GameObject("site");
            made.Add(go);
            var site = go.AddComponent<EncounterSite>();
            site.reward = "weapon";
            site.AsRoadside(11f);
            Assert.IsTrue(site.roadside);
            Assert.IsTrue(site.optional);
            Assert.IsTrue(site.autoTrigger);
            Assert.AreEqual(11f, site.triggerRadius);
            Assert.AreEqual("", site.reward, "路遇不落宝箱");
            Assert.AreEqual(60f, site.ArmRadius, "默认预生成半径至少 60 m");
        }
    }
}
