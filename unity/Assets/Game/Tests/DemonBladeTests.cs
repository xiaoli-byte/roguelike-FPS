using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 碎刃（docs/demon-blade-v2.md；移植 tests/demon-blade.test.mjs）：碎刃几何（128 片无空洞无重叠且形状各异、离刀顺序、轮廓尺寸、确定性），
    /// 网格（蒙皮骨骼、刀根三角化）、刃群状态（出窍 / 圆盾 / 刃球 / 炸散 / 归刀）。
    /// </summary>
    public sealed class DemonBladeTests
    {
        static IReadOnlyList<BladeCell> Cells => BladeShape.Cells;

        /// <summary>简单的伪随机（测试内采样用，同 TS 测试的 lcg）</summary>
        static Func<double> Lcg(uint seed)
        {
            uint s = seed;
            return () =>
            {
                s = unchecked(s * 1664525u + 1013904223u);
                return s / 4294967296.0;
            };
        }

        // ───────────── 几何（WC5） ─────────────

        [Test]
        public void BladeSplitsInto128FragmentsThatTileTheShardRegion()
        {
            Assert.AreEqual(128, Cells.Count);
            Assert.AreEqual(128, BladeShape.ShardCount);
            var region = BladeShape.ShardRegion();
            double total = Cells.Sum(c => c.area);
            double regionArea = BladeShape.PolyArea(region);
            Assert.Less(Math.Abs(total - regionArea) / regionArea, 0.003, $"碎片面积 {total} vs 区域 {regionArea}");
            foreach (var c in Cells)
            {
                Assert.GreaterOrEqual(c.poly.Length, 6, $"第 {c.index} 片至少 3 个顶点");
                Assert.Greater(c.area, 0.6e-4, $"第 {c.index} 片不是细条（{c.area * 1e4:F2} cm²）");
                Assert.IsTrue(BladeShape.PointInPoly(region, c.cx, c.cy), $"第 {c.index} 片的质心在刀身上");
            }
            // 随机点：几乎都恰好落在一片里（边界上的点允许落在两片或零片）
            var rnd = Lcg(7);
            double xs = double.MaxValue, xe = double.MinValue, ys = double.MaxValue, ye = double.MinValue;
            for (int i = 0; i < region.Length; i += 2)
            {
                xs = Math.Min(xs, region[i]);
                xe = Math.Max(xe, region[i]);
                ys = Math.Min(ys, region[i + 1]);
                ye = Math.Max(ye, region[i + 1]);
            }
            int inside = 0, none = 0, many = 0;
            while (inside < 20000)
            {
                double x = xs + rnd() * (xe - xs), y = ys + rnd() * (ye - ys);
                if (!BladeShape.PointInPoly(region, x, y)) continue;
                inside++;
                int n = 0;
                foreach (var c in Cells)
                    if (BladeShape.PointInPoly(c.poly, x, y)) n++;
                if (n == 0) none++;
                else if (n > 1) many++;
            }
            Assert.Less((double)none / inside, 0.002, $"没覆盖到 {none} / {inside}");
            Assert.Less((double)many / inside, 0.002, $"重叠 {many} / {inside}");
        }

        [Test]
        public void EveryFragmentHasItsOwnShape()
        {
            // 形状签名：顶点数 + 排序后的边长（0.1 mm）+ 面积（0.001 cm²）；全等的两片签名必然相同
            var keys = new HashSet<string>();
            foreach (var c in Cells)
            {
                var p = c.poly;
                int n = p.Length / 2;
                var edges = new List<long>();
                for (int i = 0; i < n; i++)
                {
                    int j = (i + 1) % n;
                    double dx = p[2 * j] - p[2 * i], dy = p[2 * j + 1] - p[2 * i + 1];
                    edges.Add((long)Math.Round(Math.Sqrt(dx * dx + dy * dy) * 1e4, MidpointRounding.AwayFromZero));
                }
                edges.Sort();
                keys.Add($"{n}|{string.Join(",", edges)}|{Math.Round(c.area * 1e7, MidpointRounding.AwayFromZero)}");
            }
            Assert.AreEqual(128, keys.Count);
        }

        [Test]
        public void FragmentsLeaveTipFirstAndRootLast()
        {
            CollectionAssert.AreEqual(Enumerable.Range(0, 128).ToArray(), Cells.Select(c => c.rank).OrderBy(r => r).ToArray());
            var byRank = Cells.OrderBy(c => c.rank).ToArray();
            Assert.Greater(byRank[0].cy, BladeShape.BladeLen * 0.85, "第一片在刀尖");
            Assert.Less(byRank[127].cy, BladeShape.RootBoundaryY(0) + 0.05, "最后一片挨着鬼面刀根");
            for (int k = 1; k < 128; k++) Assert.LessOrEqual(byRank[k].cy, byRank[k - 1].cy + 0.02, "离刀顺序从刀尖到刀根");
            var map = BladeShape.ByRank();
            for (int r = 0; r < 128; r++) Assert.AreEqual(r, Cells[map[r]].rank);
        }

        [Test]
        public void OutlineMatchesTheApprovedDesignSheet()
        {
            // 设计图正侧面：刀身长 0.78 米、宽约 5.1 cm 保持到 70% 处，刀身先向刃口一侧下垂再向刀背上挑，刀尖与刀背交于一点
            Assert.Less(Math.Abs(BladeShape.BladeLen - 0.778), 0.005);
            foreach (var y in new[] { 0.15, 0.3, 0.45 })
            {
                double w = BladeShape.BladeWidth(y);
                Assert.IsTrue(w > 0.048 && w < 0.054, $"{y} 处宽 {w}");
            }
            Assert.Less(BladeShape.BladeWidth(0.74), 0.03, "刀尖收窄");
            Assert.Less(BladeShape.BladeWidth(BladeShape.BladeLen), 1e-6, "刃口在刀尖与刀背交汇");
            Assert.Greater(BladeShape.BladeCenterX(0.4), BladeShape.BladeCenterX(0), "刀身中段向刃口下垂");
            Assert.Less(BladeShape.BladeCenterX(BladeShape.BladeLen), BladeShape.BladeCenterX(0.4) - 0.04, "刀尖向刀背上挑");
            // 刀根（鬼面）+ 碎刃区 = 整个刀身
            double whole = BladeShape.PolyArea(BladeShape.BladeOutline());
            double parts = BladeShape.PolyArea(BladeShape.RootPolygon()) + BladeShape.PolyArea(BladeShape.ShardRegion());
            Assert.Less(Math.Abs(whole - parts) / whole, 0.01, $"刀根 + 碎片 {parts} vs 轮廓 {whole}");
            // 刀根分界：刀背一侧更长（设计图里暗色刀根沿刀背延伸更远）
            Assert.Greater(BladeShape.RootBoundaryY(0), BladeShape.RootBoundaryY(1) + 0.05);
        }

        [Test]
        public void FragmentLayoutIsDeterministic()
        {
            var again = BladeShape.ComputeFresh();
            Assert.AreEqual(128, again.Length);
            for (int i = 0; i < 128; i++)
            {
                Assert.AreEqual(Cells[i].rank, again[i].rank);
                Assert.Less(Math.Abs(again[i].cx - Cells[i].cx), 1e-12);
                Assert.Less(Math.Abs(again[i].cy - Cells[i].cy), 1e-12);
            }
            // 与 Three.js 版逐片一致（同一 mulberry32 序列，种子 0x5eed7）：下面是 node 跑 TS bladeCells() 得到的值
            //   片号 名次 片心 x / y 面积（mm²） 顶点数
            (int i, int rank, double cx, double cy, double mm2, int n)[] ts =
            {
                (0, 51, 0.020703244, 0.430232249, 201.688162, 5),
                (63, 97, 0.014499328, 0.251937085, 223.927280, 6),
                (127, 118, -0.003493328, 0.167238928, 158.986137, 5),
            };
            foreach (var t in ts)
            {
                var c = Cells[t.i];
                Assert.AreEqual(t.rank, c.rank, $"第 {t.i} 片的名次");
                Assert.AreEqual(t.cx, c.cx, 1e-8, $"第 {t.i} 片的片心 x");
                Assert.AreEqual(t.cy, c.cy, 1e-8, $"第 {t.i} 片的片心 y");
                Assert.AreEqual(t.mm2, c.area * 1e6, 1e-5, $"第 {t.i} 片的面积");
                Assert.AreEqual(t.n, c.Count, $"第 {t.i} 片的顶点数");
            }
        }

        // ───────────── 网格（WC5） ─────────────

        [Test]
        public void ShardMeshBindsEachFragmentToItsOwnBone()
        {
            var mesh = BladeMeshes.BuildShards();
            try
            {
                Assert.AreEqual(128, mesh.bindposes.Length);
                var w = mesh.boneWeights;
                Assert.AreEqual(mesh.vertexCount, w.Length);
                var seen = new HashSet<int>();
                foreach (var b in w)
                {
                    Assert.AreEqual(1f, b.weight0, 1e-6f);
                    Assert.IsTrue(b.boneIndex0 >= 0 && b.boneIndex0 < 128);
                    seen.Add(b.boneIndex0);
                }
                Assert.AreEqual(128, seen.Count, "每片都有顶点");
                // bindpose = 平移(−片心)：骨骼放在片心就是原位
                var c = Cells[37];
                var p = mesh.bindposes[37].MultiplyPoint3x4(new Vector3((float)c.cx, (float)c.cy, 0));
                Assert.Less(p.magnitude, 1e-5f);
                // 包围盒 ≈ 碎刃区（长 ~0.6 m，宽 ~5 cm，厚不到 1 cm）
                var size = mesh.bounds.size;
                Assert.IsTrue(size.y > 0.5f && size.y < 0.8f && size.x < 0.1f && size.z < 0.01f, $"包围盒 {size}");
            }
            finally
            {
                Object.DestroyImmediate(mesh);
            }
        }

        [Test]
        public void RootSlabTriangulationCoversThePolygon()
        {
            var p = BladeShape.RootPolygon();
            var tris = BladeMeshes.Triangulate(p);
            Assert.AreEqual(0, tris.Count % 3);
            double area = 0;
            for (int t = 0; t < tris.Count; t += 3)
            {
                int a = tris[t], b = tris[t + 1], c = tris[t + 2];
                area += Math.Abs((p[2 * b] - p[2 * a]) * (p[2 * c + 1] - p[2 * a + 1]) - (p[2 * b + 1] - p[2 * a + 1]) * (p[2 * c] - p[2 * a])) / 2;
            }
            double want = BladeShape.PolyArea(p);
            Assert.Less(Math.Abs(area - want) / want, 1e-6, $"三角形面积和 {area} vs 多边形 {want}");
            var root = BladeMeshes.BuildRoot();
            var hilt = BladeMeshes.BuildHilt();
            try
            {
                Assert.Greater(root.vertexCount, 0);
                Assert.Greater(hilt.vertexCount, 0);
                // 刀柄从柄尾（−0.2955）到刀根套（+0.014）
                Assert.AreEqual(-0.2955f, hilt.bounds.min.y, 1e-4f);
                Assert.AreEqual(0.014f, hilt.bounds.max.y, 1e-4f);
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(hilt);
            }
        }

        // ───────────── 刃群（WC5） ─────────────

        sealed class FixedHome : IShardHome
        {
            public Vector3 origin;

            public float HomeWorld(int i, out Vector3 pos, out Quaternion rot)
            {
                var c = Cells[i];
                pos = origin + new Vector3((float)c.cx, (float)c.cy, 0);
                rot = Quaternion.identity;
                return 1;
            }
        }

        static void Run(BladeShards s, ref float now, float seconds, float dt = 1 / 60f)
        {
            for (float t = 0; t < seconds; t += dt)
            {
                now += dt;
                s.Update(dt, now);
            }
        }

        [Test]
        public void SwarmLaunchesTipFirstFormsAndRecallsHome()
        {
            var s = new BladeShards { provider = new FixedHome(), center = new Vector3(0, 1, 10) };
            float now = 0;
            Assert.IsTrue(s.AllHome());
            s.Launch(SwarmFormation.Vortex);
            Assert.AreEqual(128, s.AwayCount(), "下令出窍后全部算不在手里");
            Assert.AreEqual(128, Enumerable.Range(0, 128).Count(s.InHand), "还没出发的仍画在刀身上");
            Run(s, ref now, 0.05f);
            var byRank = BladeShape.ByRank();
            Assert.IsFalse(s.InHand(byRank[0]), "刀尖那片先离刀");
            Assert.IsTrue(s.InHand(byRank[127]), "刀根那片最后离刀");
            Run(s, ref now, 1.2f);
            Assert.AreEqual(1f, s.FormedFraction(), 1e-6f, "1.2 秒后全部到齐");
            for (int i = 0; i < 128; i++)
            {
                Assert.AreEqual(BladeShards.SwarmScale, s.scale[i], 1e-5f);
                Assert.Less(Vector3.Distance(s.pos[i], s.center), s.radius * 1.01f, "旋涡里的碎片在半径内");
            }
            s.Recall();
            Run(s, ref now, 1f);
            Assert.IsTrue(s.AllHome(), "归刀后全部回到手里");
            Assert.Greater(s.arrivedAt.Min(), 0, "记下了归位时刻");
        }

        [Test]
        public void ShieldRingsHoldAllFragmentsInsideTheDisc()
        {
            Assert.AreEqual(128, BladeShards.ShieldRings.Sum());
            var s = new BladeShards
            {
                provider = new FixedHome(), shieldCenter = new Vector3(0, 1.5f, 1.15f), shieldNormal = Vector3.forward, shieldRight = Vector3.right,
                shieldUp = Vector3.up, shieldRadius = 0.85f,
            };
            float now = 0;
            s.Launch(SwarmFormation.Shield);
            Run(s, ref now, 1f);
            Assert.AreEqual(1f, s.FormedFraction(), 1e-6f);
            for (int i = 0; i < 128; i++)
            {
                var d = s.pos[i] - s.shieldCenter;
                Assert.Less(Mathf.Abs(Vector3.Dot(d, s.shieldNormal)), 1e-4f, "碎片在盾面上");
                Assert.LessOrEqual(d.magnitude, s.shieldRadius + 1e-4f, "碎片在盾内");
            }
            s.FlashShield(s.shieldCenter + Vector3.right * 0.425f);
            Assert.AreEqual(0.5f, s.hitLocal.x, 1e-4f);
            Assert.AreEqual(0, s.membraneHit);
        }

        [Test]
        public void BallCompressesThenScatterThrowsShardsOutward()
        {
            var s = new BladeShards { provider = new FixedHome(), center = new Vector3(0, 1, 8) };
            float now = 0;
            s.Launch(SwarmFormation.Ball);
            Run(s, ref now, 1f);
            float Spread() => Enumerable.Range(0, 128).Max(i => Vector3.Distance(s.pos[i], s.center));
            float loose = Spread();
            s.ballCompress = 1;
            Run(s, ref now, 0.1f);
            Assert.Less(Spread(), loose * 0.5f, "刃球压缩");
            s.Scatter();
            Run(s, ref now, 0.5f);
            Assert.Greater(Spread(), 3f, "炸散后冲出好几米");
            // 切枪：瞬间归位
            s.SnapHome();
            Assert.IsTrue(s.AllHome());
            Assert.IsTrue(s.scale.All(v => v == 0));
        }

        [Test]
        public void RecallBeforeDepartureKeepsShardsInHand()
        {
            var s = new BladeShards { provider = new FixedHome(), center = new Vector3(0, 1, 10) };
            float now = 0;
            s.Launch(SwarmFormation.Vortex);
            Run(s, ref now, 0.03f);
            int departed = s.departed.Count(d => d);
            Assert.Greater(departed, 0);
            Assert.Less(departed, 128);
            s.Recall(0.4f);
            int home = Enumerable.Range(0, 128).Count(i => s.state[i] == BladeShards.Home);
            Assert.AreEqual(128 - departed, home, "还没出发的直接留在手里");
            Run(s, ref now, 1f);
            Assert.IsTrue(s.AllHome());
        }

        // ───────────── 数值与规则（WC6） ─────────────

        static WeaponDef Blade()
        {
            var d = WeaponLibrary.Get(DemonBladeDef.WeaponId);
            Assert.IsNotNull(d, "武器表里没有 demon_blade");
            return d;
        }

        [Test]
        public void DemonBladeNumbersStayInsideTheDesignBaseline()
        {
            var d = Blade();
            Assert.AreEqual(WeaponKind.Blade, d.kind);
            Assert.IsTrue(d.IsBlade, "有 v2 玩法参数");
            Assert.AreEqual("碎刃", d.name);
            Assert.AreEqual(BladeModel.PrefabId, d.prefab);
            Assert.AreEqual(0.6f, d.dropWeight, 1e-6f, "D7：掉落权重 0.6");
            var b = d.blade;
            float slashDps = DemonBladeDef.SlashDps(d);
            Assert.IsTrue(slashDps >= 95 && slashDps <= 112, $"斩击秒伤 {slashDps}");
            float swarmDps = DemonBladeDef.SwarmDps(d);
            Assert.IsTrue(swarmDps >= 55 && swarmDps <= 70, $"刃群秒伤 {swarmDps}");
            Assert.AreEqual(swarmDps, d.damage * d.fireRate, 1e-4f, "根字段描述刃群的一次结算");
            Assert.AreEqual(2.2f, b.combo[2].stretch, "第三段伸刃");
            Assert.Greater(b.combo[2].range, b.combo[0].range * 1.6f, "伸刃斩得更远");
            Assert.AreEqual(0, d.reserve);
            Assert.AreEqual(5f, b.qi.max / b.swarm.drain, 1e-6f, "满刃气出窍 5 秒");
            Assert.IsTrue(b.burst.cooldown >= 12 && b.burst.radius >= 5);
            Assert.AreEqual(8f, b.union.duration);
            Assert.AreEqual(1.1f, d.ComboCycleTime, 1e-5f, "一轮 1.1 秒");
            // 解析后的秒伤（普通品质、无加成）：斩 ≈ 109，刃群 60
            var r = WeaponStatsResolver.Resolve(new WeaponInstance(d), null);
            Assert.AreEqual(120f / 1.1f, r.meleeDps, 1e-3f);
            Assert.AreEqual(60f, r.dps, 1e-3f);
            Assert.AreEqual(1, r.magCap, "碎刃弹匣不吃加成");
        }

        [Test]
        public void GunOnlyAffixesAndLegendariesNeverRollOnTheDemonBlade()
        {
            var d = Blade();
            var banned = new HashSet<string>
            {
                AffixIds.Mag, AffixIds.Reload, AffixIds.Spread, AffixIds.Recoil, AffixIds.Pierce, "headBlast", "killRefill", AffixIds.Reserve, AffixIds.ProjSpeed,
                "lg_last", "lg_endless",
            };
            var rng = new System.Random(4242);
            for (int i = 0; i < 400; i++)
                foreach (var el in new[] { Element.None, Element.Fire, Element.Shock, Element.Corrode })
                    foreach (var a in AffixRoll.Roll(d, Rarity.Legendary, el, rng))
                        Assert.IsFalse(banned.Contains(a.id), $"抽到了 {a.id}");
        }

        [Test]
        public void SwarmDamageBypassesEnemyShields()
        {
            var host = new GameObject("DemonBladeTests Target") { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                var d = host.AddComponent<Damageable>();
                void Reset()
                {
                    d.maxHealth = 100;
                    d.ResetVitals();
                    d.health = 100;
                    d.shield = 50;
                    d.armor = 0;
                }
                Reset();
                d.ApplyLayers(new DamageInfo { amount = 30, source = DamageSource.Weapon }, 30, false);
                Assert.AreEqual(20f, d.shield, 1e-4f);
                Assert.AreEqual(100f, d.health, 1e-4f);
                Reset();
                var r = d.ApplyLayers(new DamageInfo { amount = 30, source = DamageSource.Weapon, bypassShield = true }, 30, false);
                Assert.AreEqual(50f, d.shield, 1e-4f, "护盾不动");
                Assert.AreEqual(70f, d.health, 1e-4f);
                Assert.AreEqual(DamageLayer.Health, r.firstLayer);
            }
            finally
            {
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void SlashesCountAsMeleeWeaponHits()
        {
            // 斩击：来源武器 + 近战标签——吃「武器伤害」、算武器直接命中（词条 / 秘卷 / 吸血），词条按斩击做 meleeHitScale 归一
            var slash = new DamageInfo { amount = 30, source = DamageSource.Weapon, tags = DamageTag.Melee, weaponUid = 7 };
            Assert.IsTrue(AffixEffects.IsWeaponHit(in slash));
            Assert.IsTrue(AffixEffects.IsSlash(in slash));
            var tags = DamageCalc.EffectiveTags(in slash);
            Assert.IsTrue((tags & DamageTag.Weapon) != 0 && (tags & DamageTag.Melee) != 0);
            // 刃群：武器直接命中，但不是斩击
            var swarm = new DamageInfo { amount = 6, source = DamageSource.Weapon, bypassShield = true, weaponUid = 7 };
            Assert.IsTrue(AffixEffects.IsWeaponHit(in swarm));
            Assert.IsFalse(AffixEffects.IsSlash(in swarm));
        }

        [Test]
        public void SectorHitsTheFrontArcByBodySurface()
        {
            var feet = Vector3.zero;
            var fwd = Vector3.forward;
            const float range = 3.2f, half = 0.9599f;
            bool In(Vector3 p, float r = 0.4f, float h = 1.8f) => DemonBladeDef.InSector(feet, fwd, 1.8f, range, half, 0.3f, 0.6f, p, r, h);
            Assert.IsTrue(In(new Vector3(0, 0, 3)), "正前方 3 米");
            Assert.IsTrue(In(new Vector3(0, 0, 3.5f)), "按胶囊表面算距离（3.5 − 0.4 ≤ 3.2）");
            Assert.IsFalse(In(new Vector3(0, 0, 3.7f)), "表面超出 3.2 米");
            Assert.IsTrue(In(new Vector3(2, 0, 1.6f)), "55° 扇形内");
            Assert.IsFalse(In(new Vector3(2.5f, 0, 0.3f)), "侧面超出扇形");
            Assert.IsFalse(In(new Vector3(0, 0, -2)), "身后");
            Assert.IsTrue(In(new Vector3(0.5f, 0, -0.1f)), "贴身时只排除正后方");
            Assert.IsFalse(In(new Vector3(0, 0, -0.6f)), "贴身但在正后方");
            Assert.IsFalse(In(new Vector3(0, 3, 2)), "头顶以上 0.6 米之外");
            Assert.IsFalse(In(new Vector3(0, -2.5f, 2)), "脚下 0.3 米之外");
            Assert.IsTrue(In(new Vector3(0, -1, 2)), "矮一截但身体跨进高度带");
        }

        [Test]
        public void BurstCooldownScalesWithSkillHaste()
        {
            var b = Blade().blade;
            Assert.AreEqual(15f, DemonBladeDef.CooldownTotal(b, 0), 1e-5f);
            Assert.AreEqual(10f, DemonBladeDef.CooldownTotal(b, 0.5f), 1e-5f);
            Assert.AreEqual(75f, DemonBladeDef.CooldownTotal(b, -0.9f), 1e-4f, "急速为负时按 0.2 封底");
            Assert.AreEqual("杀气爆发", DemonBladeDef.SkillName(false));
            Assert.AreEqual("人刀合一", DemonBladeDef.SkillName(true));
            Assert.AreEqual("blade", DemonBladeDef.ModeId(BladeMode.Hand), "在手里时准星是近战括号");
        }
    }
}
