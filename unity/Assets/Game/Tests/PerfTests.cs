using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// I4 性能（docs/performance-unity.md）：按图层剔除的分层规则与各档距离、固定机位规则（三类 + 主线链）、预算判定。
    /// 渲染设置（GPU 常驻绘制 / 遮挡关、SRP Batcher）归 RenderPerfSettingsTests。
    /// </summary>
    public sealed class PerfTests
    {
        readonly List<Object> made = new();

        [TearDown]
        public void TearDown()
        {
            foreach (var o in made)
                if (o) Object.DestroyImmediate(o);
            made.Clear();
        }

        MeshRenderer Cube(float size, string name = "cube")
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.localScale = Vector3.one * size;
            made.Add(go);
            return go.GetComponent<MeshRenderer>();
        }

        // ───────────── 按图层剔除 ─────────────

        [Test]
        public void ClassifyBySize()
        {
            Assert.AreEqual(CullLayers.Detail, CullLayers.Classify(Cube(1f)), "1 m 的件归小件层");
            Assert.AreEqual(CullLayers.Scatter, CullLayers.Classify(Cube(4f)), "4 m 的件归散布层");
            Assert.AreEqual(-1, CullLayers.Classify(Cube(10f)), "大件（建筑、崖壁）不剔");
        }

        [Test]
        public void ClassifySkipsGameplayAndNonDefault()
        {
            var withBody = Cube(1f);
            withBody.gameObject.AddComponent<Rigidbody>();
            Assert.AreEqual(-1, CullLayers.Classify(withBody), "带刚体的不动");

            var hurt = Cube(1f);
            hurt.gameObject.AddComponent<Damageable>();
            Assert.AreEqual(-1, CullLayers.Classify(hurt), "可受伤的不动");

            var water = Cube(1f);
            water.gameObject.layer = 4;
            Assert.AreEqual(-1, CullLayers.Classify(water), "Default 以外的层不动");

            var off = Cube(1f);
            off.enabled = false;
            Assert.AreEqual(-1, CullLayers.Classify(off), "关着的渲染器不动");
        }

        [Test]
        public void CullDistancesPerTier()
        {
            var (hd, hs) = CullLayers.Distances(QualityProfile.High, 380);
            Assert.AreEqual(120f, hd, 1e-3f, "高档小件 120 m");
            Assert.AreEqual(380f, hs, 1e-3f, "高档散布到雾终点（被雾吞掉之后才剔）");
            var (ld, ls) = CullLayers.Distances(QualityProfile.Low, 380);
            Assert.Less(ld, hd);
            Assert.Less(ls, hs);
            var (_, noFog) = CullLayers.Distances(QualityProfile.High, 0);
            Assert.AreEqual(CullLayers.ScatterFallback, noFog, 1e-3f, "没开雾用兜底距离");
            for (int i = 1; i < QualityProfile.All.Length; i++)
            {
                var lo = QualityProfile.All[i - 1];
                var hi = QualityProfile.All[i];
                Assert.LessOrEqual(lo.detailCullDistance, hi.detailCullDistance, $"{lo.label} → {hi.label} 小件距离");
                Assert.LessOrEqual(lo.scatterCullFog, hi.scatterCullFog, $"{lo.label} → {hi.label} 散布比例");
            }
            foreach (var p in QualityProfile.All)
                Assert.GreaterOrEqual(CullLayers.Distances(p, 380).scatter, CullLayers.Distances(p, 380).detail, $"{p.label}：散布不比小件近");
        }

        [Test]
        public void CameraGetsSphericalLayerDistances()
        {
            var go = new GameObject("cam");
            made.Add(go);
            var cam = go.AddComponent<Camera>();
            CullLayers.ApplyTo(cam, QualityProfile.High, 360);
            Assert.IsTrue(cam.layerCullSpherical);
            Assert.AreEqual(120f, cam.layerCullDistances[CullLayers.Detail], 1e-3f);
            Assert.AreEqual(360f, cam.layerCullDistances[CullLayers.Scatter], 1e-3f);
            Assert.AreEqual(0f, cam.layerCullDistances[0], "Default 层不设距离");
            try
            {
                CullLayers.Disabled = true;
                CullLayers.ApplyTo(cam, QualityProfile.High, 360);
                Assert.AreEqual(0f, cam.layerCullDistances[CullLayers.Detail], "关掉时不剔");
            }
            finally
            {
                CullLayers.Disabled = false;
            }
        }

        [Test]
        public void LayersAreNamedAndCoveredByWorldMasks()
        {
            Assert.AreEqual(CullLayers.DetailName, LayerMask.LayerToName(CullLayers.Detail));
            Assert.AreEqual(CullLayers.ScatterName, LayerMask.LayerToName(CullLayers.Scatter));
            foreach (int l in new[] { CullLayers.Detail, CullLayers.Scatter })
            {
                Assert.AreNotEqual(0, Layers.WorldMask & (1 << l), "小件 / 散布照样挡子弹、视线、能站");
                Assert.AreNotEqual(0, Layers.ShotMask & (1 << l));
            }
        }

        // ───────────── 固定机位 ─────────────

        static LevelPoi Poi(MapPoiKind k, string name, float x, float z, bool optional = false) =>
            new() { kind = k, name = name, position = new Vector3(x, 0, z), optional = optional };

        [Test]
        public void ViewsFromLevelData()
        {
            var pois = new List<LevelPoi>
            {
                Poi(MapPoiKind.Site, "近场", 20, 0),
                Poi(MapPoiKind.Site, "远场", 200, 0),
                Poi(MapPoiKind.Site, "可选", 5, 0, optional: true),
                Poi(MapPoiKind.Camp, "营地", 100, 10),
                Poi(MapPoiKind.Cache, "藏宝", 101, 0),
                Poi(MapPoiKind.Exit, "出口", 260, 0),
            };
            var v = PerfViews.Compute(Vector3.zero, Quaternion.identity, pois, new Rect(0, -50, 260, 100));
            Assert.AreEqual(new[] { PerfViews.Spawn, PerfViews.Vista, PerfViews.Fight }, v.Select(x => x.name).ToArray());
            var fight = v[2];
            Assert.IsTrue(fight.combat);
            Assert.AreEqual(20f, fight.look.x, 1e-3f, "战斗 = 离出生点最近的必清场地（可选场地不算）");
            Assert.AreEqual(10f, fight.stand.x, 1e-3f, "往出生点一侧退 10 m");
            Assert.AreEqual(100f + 8f * (-100f / Mathf.Sqrt(100 * 100 + 10 * 10)), v[1].stand.x, 1e-2f, "中段 = 离俯视图中心最近的地点（藏宝点不算），退 8 m");
            Assert.AreEqual(260f, v[1].look.x, 1e-3f, "看离它最远的地点");
            // 重算一遍完全一样（固定机位）
            var again = PerfViews.Compute(Vector3.zero, Quaternion.identity, pois, new Rect(0, -50, 260, 100));
            Assert.AreEqual(v.Select(x => x.stand).ToArray(), again.Select(x => x.stand).ToArray());
        }

        [Test]
        public void BossLevelFightsAtArena()
        {
            var pois = new List<LevelPoi> { Poi(MapPoiKind.Boss, "旱魃", 0, 100), Poi(MapPoiKind.Exit, "出口", 0, 140) };
            var v = PerfViews.Compute(Vector3.zero, Quaternion.identity, pois, default);
            Assert.AreEqual(100f, v.Last().look.z, 1e-3f);
            Assert.AreEqual(90f, v.Last().stand.z, 1e-3f);
            Assert.AreEqual(1, PerfViews.Compute(Vector3.zero, Quaternion.identity, new List<LevelPoi>(), default).Count, "没有地点只有出生机位");
        }

        [Test]
        public void EstimateHonoursFrustumAndLayerDistance()
        {
            var view = new PerfView { name = "t", stand = Vector3.zero, look = new Vector3(0, PlayerFactory.EyeHeight, 100) };
            var ahead = Cube(1f, "ahead");
            ahead.transform.position = new Vector3(0, 1, 30);
            var behind = Cube(1f, "behind");
            behind.transform.position = new Vector3(0, 1, -30);
            var far = Cube(1f, "far small");
            far.transform.position = new Vector3(0, 1, 200);
            var big = Cube(10f, "far big");
            big.transform.position = new Vector3(0, 5, 600);
            var list = new List<Renderer> { ahead, behind, far, big };
            var e = PerfViews.Measure(view, list, QualityProfile.High, 380, 90);
            Assert.AreEqual(2, e.renderers, "视锥后面的、超过小件距离的不算；远处大件照算");
            Assert.AreEqual(24, e.triangles, "两个方块各 12 面");
            Assert.AreEqual(2, e.casters, "阴影距离内投影的（前后两个）");
        }

        [Test]
        public void ChainLinksRequiredPoisByNearestNeighbour()
        {
            var pois = new List<LevelPoi>
            {
                Poi(MapPoiKind.Site, "远", 100, 0),
                Poi(MapPoiKind.Site, "近", 30, 0),
                Poi(MapPoiKind.Site, "可选", 10, 0, optional: true),
                Poi(MapPoiKind.Cache, "藏宝", 60, 0),
                Poi(MapPoiKind.Exit, "出口", 160, 0),
            };
            var chain = PerfViews.Chain(Vector3.zero, pois);
            Assert.AreEqual(3, chain.Count, "出生点 → 近 → 远 → 出口：三段（可选、藏宝不算）");
            Assert.IsTrue(chain.All(v => v.chain && !v.combat));
            Assert.AreEqual(0f, chain[0].stand.x, 1e-3f);
            Assert.AreEqual(30f, chain[0].look.x, 1e-3f);
            Assert.AreEqual(30f, chain[1].stand.x, 1e-3f);
            Assert.AreEqual(160f, chain[2].look.x, 1e-3f);
            Assert.AreEqual(3 + 3, PerfViews.Compute(Vector3.zero, Quaternion.identity, pois, default, chain: true).Count, "三类机位 + 主线三段");
        }

        // ───────────── 预算 ─────────────

        [Test]
        public void BudgetFlagsOnlyOverruns()
        {
            foreach (bool high in new[] { true, false })
            {
                var l = PerfBudget.For(high);
                Assert.Greater(l.gpuP95Ms, 0, "运行时预算要有数");
                Assert.Greater(l.mainP95Ms, 0);
                Assert.Greater(l.drawCalls, 0);
                Assert.Greater(l.triangles, 0);
                Assert.IsNull(PerfBudget.Check(high, 1, 1, 1, 1, 1, 1));
                StringAssert.Contains("绘制调用", PerfBudget.Check(high, 1, 1, l.drawCalls + 1, 1, 1, 1));
                StringAssert.Contains("GPU P95", PerfBudget.Check(high, l.gpuP95Ms + 1, 1, 1, 1, 1, 1));
                Assert.IsNull(PerfBudget.Check(high, -1, -1, 0, 0, 0, 0), "拿不到的量不检查");
                Assert.IsNull(PerfBudget.CheckStatic(high, 1, 1, 1));
                var s = high ? PerfBudget.StaticHigh : PerfBudget.StaticLow;
                Assert.Greater(s.triangles, 0, "L5 预算要有数");
                StringAssert.Contains("三角面", PerfBudget.CheckStatic(high, 1, s.triangles + 1, 1));
            }
            Assert.GreaterOrEqual(PerfBudget.High.drawCalls, PerfBudget.Low.drawCalls, "低档预算不比高档宽");
            Assert.GreaterOrEqual(PerfBudget.High.gpuP95Ms, PerfBudget.Low.gpuP95Ms);
            Assert.GreaterOrEqual(PerfBudget.StaticHigh.triangles, PerfBudget.StaticLow.triangles);
        }
    }
}
