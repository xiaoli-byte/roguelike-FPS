using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 熔心魔将的位移保护（11-07 boss-warlord 三遍里前两遍：突刺冲锋往下掉、触发坠落回收打断招式；第一遍跃击落点在预警圈外）。
    /// 根因是大帧时间：playtest 在出手段开头截图，下一帧 dt 被钳到 0.333 s，重力 30 一步沉 3.3 m，落地射线从新位置上方 3 m 打，起点已埋在地面下——
    /// 平地上直接穿地掉下去。在远处搭一块 20 × 20 m 的平台（+X 边外 15 m 深的坑，坑底有地面和导航网格；−X 边外接一块同高、但没烘导航网格的板），
    /// 烘一份临时导航网格，直接驱动脚本位移 <see cref="ScriptedMotion"/>（EnemyAI 每帧调的同一个函数）和跃击的落地决策：
    ///   · 大步长不穿地：dt 0.333 的冲刺贴着台面走；从高处落下时落在这一步竖直扫过的台面上，不穿到坑底；
    ///   · 平台边缘冲刺会刹住：突刺的预警线截到台沿前；护栏冲刺不靠预警线也会在台沿前刹住、hitLedge 置位；前方没有导航网格同样刹住；
    ///   · 大步长（dt 1/60、0.1、0.333）也不越界：每一帧都还在平台上、没往下掉；里程正好 = 预警线长度（最后一步不冲过头）；
    ///   · 不开护栏的脚本位移照旧（其他敌人 / 首领的手感不变）：会冲下台沿；
    ///   · 跃击落点贴到导航网格上、在场地里；任意步长下落地都在预警圈（落点 <see cref="WarlordRef.LeapMiss"/> 米）内，早着地时等到滞空时间到了才砸。
    /// </summary>
    public sealed class WarlordDashTests
    {
        static readonly Vector3 Far = new(3500f, 250f, -3500f);
        const float Half = 10f, Pit = 15f;
        static readonly float[] Steps = { 1f / 60f, 0.1f, 1f / 3f };

        GameObject root;
        NavMeshDataInstance nav;

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("WarlordDashTests");
            var platform = Box("Platform", new Vector3(0, -0.5f, 0), new Vector3(Half * 2, 1, Half * 2));
            var pitFloor = Box("Pit Floor", new Vector3(0, -Pit - 0.5f, 0), new Vector3(90, 1, 90));
            // −X 边外：同高的地面，但不进导航网格（模拟没烘到网格 / 被挖掉的地方）
            Box("No Nav Slab", new Vector3(-Half - 15f, -0.5f, 0), new Vector3(30, 1, Half * 2));
            Physics.SyncTransforms();
            var sources = new List<NavMeshBuildSource>();
            foreach (var c in new[] { platform, pitFloor })
                sources.Add(new NavMeshBuildSource
                {
                    shape = NavMeshBuildSourceShape.Box, transform = Matrix4x4.TRS(c.transform.position, Quaternion.identity, Vector3.one), size = c.size, area = 0,
                });
            var data = UnityEngine.AI.NavMeshBuilder.BuildNavMeshData(NavMesh.GetSettingsByID(0), sources,
                new Bounds(Vector3.zero, new Vector3(100, 40, 100)), Far + Vector3.down * 8f, Quaternion.identity);
            nav = NavMesh.AddNavMeshData(data);
            Assert.IsTrue(nav.valid, "临时导航网格没加上");
            Assert.IsTrue(NavMesh.SamplePosition(Far, out _, 1f, NavMesh.AllAreas), "平台上没烘出导航网格");
        }

        [TearDown]
        public void TearDown()
        {
            if (nav.valid) nav.Remove();
            if (root) Object.DestroyImmediate(root);
        }

        BoxCollider Box(string name, Vector3 local, Vector3 size)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root.transform, false);
            go.transform.position = Far + local;
            var box = go.AddComponent<BoxCollider>();
            box.size = size;
            return box;
        }

        /// <summary>按 dt 推一程脚本位移，直到水平速度停下（或 limit 秒）；每一帧交给 frame 检查</summary>
        static Vector3 Run(ref ScriptedMotion m, Vector3 p, float dt, float limit, System.Action<Vector3, float> frame = null)
        {
            for (float t = dt; t <= limit + 1e-4f; t += dt)
            {
                p = m.Step(p, dt);
                frame?.Invoke(p, t);
                if (new Vector2(m.velocity.x, m.velocity.z).sqrMagnitude < 1e-6f) break;
            }
            return p;
        }

        [Test]
        public void BigStep_DoesNotSinkThroughTheFloor([ValueSource(nameof(Steps))] float dt)
        {
            // 不开护栏也一样（共用的脚本位移）：平台中间朝 +Z 冲 0.6 s，每一帧都贴着台面
            var m = new ScriptedMotion(Vector3.forward * WarlordThrust.Speed, 30f);
            var p = Far + new Vector3(0, 0, -9f);
            for (float t = dt; t <= 0.67f; t += dt)
            {
                p = m.Step(p, dt);
                Assert.AreEqual(Far.y, p.y, 0.01f, $"dt {dt:F3}：第 {t:F2} s 沉到台面下 {Far.y - p.y:F2} m");
                Assert.IsTrue(m.grounded, $"dt {dt:F3}：第 {t:F2} s 不算落地");
            }
            // 从台面上方 21 m 自由落下（dt 0.333 时最后一步沉 13 m）：落在台面上，不穿到 15 m 下的坑底
            m = new ScriptedMotion(Vector3.zero, 30f);
            p = Far + new Vector3(0, 21f, 0);
            for (float t = dt; t <= 3f && !m.grounded; t += dt) p = m.Step(p, dt);
            Assert.AreEqual(Far.y, p.y, 0.01f, $"dt {dt:F3}：落到了 {p.y - Far.y:F2} m");
        }

        [Test]
        public void ThrustLine_StopsShortOfTheLedge()
        {
            // 魔将站在平台中间，玩家在 +X 方向 19 m（坑上方）：原来的预警线 = 24 m（越过玩家 5 m），会直接画到坑里
            float len = WarlordThrust.PlanLength(null, Far, Vector3.right, 19f, 40f);
            Assert.Less(len, Half, "预警线截到台沿以内");
            Assert.Greater(len, Half - ScriptedMotion.LedgeLead - 0.6f, "截到台沿前约 0.6 m，不是截得过短");
            // 平地上不截：玩家在 −Z 方向 6 m → 11 m，整段都在平台上
            Assert.AreEqual(11f, WarlordThrust.PlanLength(null, Far + new Vector3(0, 0, 9f), Vector3.back, 6f, 40f), 1e-3f);
        }

        [Test]
        public void GuardedDash_BrakesAtLedge_AtAnyStep([ValueSource(nameof(Steps))] float dt)
        {
            // 不靠预警线（里程给足 24 m）：只靠护栏也要在台沿前刹住
            var m = new ScriptedMotion(Vector3.right * WarlordThrust.Speed, 30f, 24f, ScriptedMotion.BossLedgeDrop);
            float maxX = float.MinValue, minY = float.MaxValue;
            var end = Run(ref m, Far, dt, 3f, (p, _) =>
            {
                maxX = Mathf.Max(maxX, p.x - Far.x);
                minY = Mathf.Min(minY, p.y - Far.y);
            });
            Assert.IsTrue(m.hitLedge, $"dt {dt:F3}：没有在台沿刹住");
            Assert.LessOrEqual(maxX, Half - 0.3f, $"dt {dt:F3}：冲过了台沿（最远 {maxX:F2} m，台沿 {Half} m）");
            Assert.GreaterOrEqual(minY, -0.01f, $"dt {dt:F3}：往下掉了 {-minY:F2} m");
            Assert.Greater(end.x - Far.x, Half - 1.5f, $"dt {dt:F3}：刹得太早（停在 {end.x - Far.x:F2} m）");
        }

        [Test]
        public void GuardedDash_RunsExactlyTheTelegraph_AtAnyStep([ValueSource(nameof(Steps))] float dt)
        {
            // 从 −8 m 处朝 +X：玩家 5 m → 预警线 10 m，整段在平台上；大步长下最后一步也不冲过线的尽头
            var from = Far + new Vector3(-8f, 0, 0);
            float len = WarlordThrust.PlanLength(null, from, Vector3.right, 5f, 40f);
            Assert.AreEqual(10f, len, 1e-3f);
            var m = new ScriptedMotion(Vector3.right * WarlordThrust.Speed, 30f, len, ScriptedMotion.BossLedgeDrop);
            var end = Run(ref m, from, dt, 3f);
            Assert.IsTrue(m.RunSpent, $"dt {dt:F3}：里程没用完");
            Assert.IsFalse(m.hitLedge, $"dt {dt:F3}：平地上误判成台沿");
            Assert.AreEqual(len, end.x - from.x, 0.01f, $"dt {dt:F3}：冲了 {end.x - from.x:F2} m（预警线 {len} m）");
            Assert.AreEqual(Far.y, end.y, 0.01f);
        }

        [Test]
        public void GuardedDash_BrakesWhereTheNavMeshEnds([ValueSource(nameof(Steps))] float dt)
        {
            // −X 边外地面同高、没有导航网格：离网格 4 m（交还导航的吸附半径）之前刹住，停下来交得回导航
            var m = new ScriptedMotion(Vector3.left * WarlordThrust.Speed, 30f, 24f, ScriptedMotion.BossLedgeDrop);
            var end = Run(ref m, Far, dt, 3f);
            Assert.IsTrue(m.hitLedge, $"dt {dt:F3}：没有导航网格的地方没刹住");
            Assert.IsTrue(NavMesh.SamplePosition(end, out _, ScriptedMotion.LedgeNavReach, NavMesh.AllAreas), $"dt {dt:F3}：停在网格 4 m 以外（{end.x - Far.x:F2} m）");
            Assert.Less(Far.x - end.x, Half + ScriptedMotion.LedgeNavReach, $"dt {dt:F3}：冲得太远");
        }

        [Test]
        public void ShallowDipIsNotALedge()
        {
            // 浅渠（0.6 m）照冲：平台中间挖一道 0.6 m 深、4 m 宽的槽（槽底也有地面），护栏不刹
            Box("Dip Floor", new Vector3(3f, -0.6f - 0.5f, 0), new Vector3(4, 1, Half * 2));
            var top = root.transform.Find("Platform").GetComponent<BoxCollider>();
            // 把平台拆成槽两边两块
            top.size = new Vector3(11, 1, Half * 2);
            top.center = new Vector3(-4.5f, 0, 0);
            Box("Platform East", new Vector3(7.5f, -0.5f, 0), new Vector3(5, 1, Half * 2));
            Physics.SyncTransforms();
            Assert.AreEqual(12f, ScriptedMotion.LedgeFree(Far + new Vector3(-6f, 0, 0), Vector3.right, 12f, ScriptedMotion.BossLedgeDrop), 1e-3f);
        }

        [Test]
        public void UnguardedMotion_Unchanged_StillRunsOffTheLedge()
        {
            // 不开护栏（其他敌人 / 首领的跳跃、冲锋）：和原来一样只管撞墙，会冲下台沿掉进坑
            var m = new ScriptedMotion(Vector3.right * WarlordThrust.Speed, 30f);
            var p = Far;
            for (float t = 0; t < 1.5f; t += 1f / 60f) p = m.Step(p, 1f / 60f);
            Assert.Greater(p.x - Far.x, Half, "没开护栏也被拦下了（行为变了）");
            Assert.Less(p.y - Far.y, -1f);
            Assert.IsFalse(m.hitLedge);
        }

        [Test]
        public void Leap_TargetSnapsOntoTheNavMeshInsideTheArena()
        {
            var arena = new GameObject("Arena").AddComponent<BossArena>();
            arena.transform.SetParent(root.transform, false);
            arena.transform.position = Far;
            arena.shape = BossArenaShape.Circle;
            arena.radius = 18f;
            // 玩家 0.35 s 后在坑上方（场地圆比平台大，夹进场地也还在坑上）：落点贴回平台的导航网格
            var target = WarlordLeap.PlanTarget(arena, Far + new Vector3(13f, 0, 2f));
            Assert.LessOrEqual(target.x - Far.x, Half, "落点在坑上方");
            Assert.AreEqual(Far.y, target.y, 0.05f, "落点不在台面上");
            Assert.IsTrue(NavMesh.SamplePosition(target, out var hit, 0.5f, NavMesh.AllAreas) && hit.position.y > Far.y - 1f, "落点不在导航网格上");
            Assert.IsTrue(arena.Contains(target, 1f));
            // 场地外：先夹进场地（离边 3 m），再贴网格
            arena.radius = 12f;
            var outside = WarlordLeap.PlanTarget(arena, Far + new Vector3(0, 0, -40f));
            Assert.IsTrue(arena.Contains(outside, 1f), "场地外的预判点没夹进场地");
            Assert.AreEqual(Far.y, outside.y, 0.05f);
            Assert.IsTrue(NavMesh.SamplePosition(outside, out _, 0.5f, NavMesh.AllAreas));
        }

        [Test]
        public void Leap_LandsInsideTheWarningCircle_AtAnyStep([ValueSource(nameof(Steps))] float dt)
        {
            const float air = 1f;
            var from = Far + new Vector3(-8f, 0, -3f);
            var target = WarlordLeap.PlanTarget(null, Far + new Vector3(8f, 0, 5f));
            // 同 WarlordLeap.OnActiveBegin 的抛物线初速
            var d = target - from;
            float dy = d.y;
            d.y = 0;
            var v = d / air;
            v.y = (dy + 0.5f * WarlordRef.LeapGravity * air * air) / air;
            var m = new ScriptedMotion(v, WarlordRef.LeapGravity);
            var p = from;
            float drift = 0, t = 0, landAt = -1;
            for (int i = 0; i < 200 && landAt < 0; i++)
            {
                t += dt;
                p = m.Step(p, dt);
                switch (WarlordLeap.Decide(t, air, m.grounded, p, target, m.hitWall))
                {
                    case WarlordLeap.LandStep.Pin:
                        drift = Mathf.Max(drift, Flat(p - target));
                        p = target;
                        m.velocity = Vector3.zero;
                        break;
                    case WarlordLeap.LandStep.Land:
                        if (!WarlordLeap.IsBlocked(p, target, m.hitWall))
                        {
                            drift = Mathf.Max(drift, Flat(p - target));
                            p = target;
                        }
                        landAt = t;
                        break;
                }
            }
            Assert.GreaterOrEqual(landAt, air - 0.12f, $"dt {dt:F3}：{landAt:F2} s 就砸下来了（预警 {air} s 才填满）");
            Assert.LessOrEqual(Flat(p - target), WarlordRef.LeapMiss, $"dt {dt:F3}：落在预警圈外（偏 {Flat(p - target):F2} m）");
            Assert.AreEqual(target.y, p.y, 0.05f);
            // 大步长下抛物线本身会早一帧着地、偏出预警圈：保护确实起了作用
            if (dt > 0.3f) Assert.Greater(drift, WarlordRef.LeapMiss, "dt 0.33 时抛物线本应偏出预警圈（测试场景没测到要保护的情形）");
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
    }
}
