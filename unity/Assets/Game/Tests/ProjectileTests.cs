using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// C4 投射物：反弹能量、挡弹区几何、线段距离、追踪评分、外观注册（纯数学）；
    /// 投射物弱点判定（身体之后 1.5 m 内穿过弱点 = 爆头）、穿透每个敌人只吃一次、弱点直击必暴（物理查询，测试体放在远离场景的地方）。
    /// </summary>
    public sealed class ProjectileTests
    {
        static readonly Vector3 Far = new(20000, 5000, 20000);
        readonly List<GameObject> spawned = new();

        [TearDown]
        public void TearDown()
        {
            ProjectilePools.Clear();
            foreach (var go in spawned)
                if (go)
                    Object.DestroyImmediate(go);
            spawned.Clear();
        }

        // ───────────── 纯数学 ─────────────

        [Test]
        public void BounceKeepsNormalAndTangentEnergyLikeTs()
        {
            var v = ProjectileMath.Bounce(new Vector3(4, -10, 0), Vector3.up);
            Assert.AreEqual(4 * 0.78f, v.x, 1e-4f, "切向保留 78%");
            Assert.AreEqual(10 * 0.55f, v.y, 1e-4f, "法向反向、保留 55%");
            Assert.AreEqual(0, v.z, 1e-6f);
            var away = new Vector3(1, 2, 3);
            Assert.AreEqual(away, ProjectileMath.Bounce(away, Vector3.up), "已经在远离表面的速度不变");
        }

        [Test]
        public void DiscWardBlocksSegmentsThroughItFromEitherSide()
        {
            var c = new Vector3(0, 1, 2);
            var n = Vector3.back;
            Assert.IsTrue(ProjectileMath.CrossesDisc(c, n, 1, new Vector3(0, 1, 0), Vector3.forward, 3, out float t));
            Assert.AreEqual(2, t, 1e-4f);
            Assert.IsTrue(ProjectileMath.CrossesDisc(c, n, 1, new Vector3(0.5f, 1, 4), Vector3.back, 3, out _), "背面飞来的也挡");
            Assert.IsFalse(ProjectileMath.CrossesDisc(c, n, 1, new Vector3(0, 3, 0), Vector3.forward, 3, out _), "从圆盘外侧经过");
            Assert.IsFalse(ProjectileMath.CrossesDisc(c, n, 1, new Vector3(0, 1, 0), Vector3.forward, 1.5f, out _), "这一帧还没飞到");
            Assert.IsFalse(ProjectileMath.CrossesDisc(c, n, 1, new Vector3(0, 1, 0), Vector3.up, 5, out _), "平行于盘面");
        }

        [Test]
        public void SphereWardOnlyBlocksShotsComingFromOutside()
        {
            var c = Vector3.zero;
            Assert.IsTrue(ProjectileMath.EntersSphere(c, 1, new Vector3(0, 0, -3), Vector3.forward, 5, out float t));
            Assert.AreEqual(2, t, 1e-4f);
            Assert.IsFalse(ProjectileMath.EntersSphere(c, 1, new Vector3(0, 0, 0.5f), Vector3.forward, 5, out _), "罩子里面打出去的不挡");
            Assert.IsFalse(ProjectileMath.EntersSphere(c, 1, new Vector3(0, 0, -3), Vector3.back, 5, out _), "背离罩子");
        }

        [Test]
        public void SegmentDistanceToPlayerCapsule()
        {
            var a = new Vector3(0, 0.35f, 0);
            var b = new Vector3(0, 1.45f, 0);
            float d = ProjectileMath.SegmentSegmentDistance(new Vector3(-1, 1, 0.5f), new Vector3(1, 1, 0.5f), a, b, out float s);
            Assert.AreEqual(0.5f, d, 1e-4f);
            Assert.AreEqual(0.5f, s, 1e-4f, "最近点在线段中点");
            Assert.AreEqual(1f, ProjectileMath.SegmentSegmentDistance(new Vector3(0, 2.45f, 0), new Vector3(0, 3, 0), a, b), 1e-4f, "头顶上方");
        }

        [Test]
        public void HomingPrefersTargetsNearTheAimOverCloserOnesOffToTheSide()
        {
            float aimed = ProjectileMath.HomingScore(Mathf.Cos(10 * Mathf.Deg2Rad), 30);
            float side = ProjectileMath.HomingScore(Mathf.Cos(45 * Mathf.Deg2Rad), 5);
            Assert.Less(aimed, side, "准星附近 30 m 的敌人优先于侧面 5 m 的");
            Assert.IsTrue(float.IsPositiveInfinity(ProjectileMath.HomingScore(-0.5f, 3)), "身后的不追");
        }

        [Test]
        public void VisualRegistryHasEveryBuiltinLook()
        {
            foreach (var id in new[] { "grenade", "orb", "rocket", "arrow", "flame", "lantern", "bolt", "feather", "quill", "spear", "chunk", "shard" })
                Assert.IsTrue(ProjectileVisuals.Has(id), $"缺外观 {id}");
            Assert.AreEqual(ProjectileVisuals.Fallback, ProjectileVisuals.Get("no_such_look").id, "未知外观回退到 orb");
        }

        [Test]
        public void ViewSizeFollowsTsRules()
        {
            // 焚城榴弹：半径 0.14、缩放 1.1 → 1.1 × clamp(0.14 / 0.12, 0.7, 2.2)
            Assert.AreEqual(1.1f * (0.14f / 0.12f), ProjectileVisuals.ViewSize("grenade", 0.14f, 1.1f), 1e-4f);
            // 青冥雷蛊：以半径为单位 → 0.15 × 0.9
            Assert.AreEqual(0.135f, ProjectileVisuals.ViewSize("orb", 0.15f, 0.9f), 1e-4f);
            // 箭：碰撞半径再大，模型最多放大 1.6 倍
            Assert.AreEqual(1.6f, ProjectileVisuals.ViewSize("arrow", 1f, 1f), 1e-4f);
        }

        // ───────────── 命中检测（物理查询）─────────────

        /// <summary>一个测试敌人：身体胶囊（0–2 m，半径 0.4）+ 包在胶囊顶部里的弱点球（1.75 m，半径 0.25）</summary>
        Damageable Enemy(Vector3 at)
        {
            var go = new GameObject("TestEnemy");
            spawned.Add(go);
            go.transform.position = at;
            var body = go.AddComponent<CapsuleCollider>();
            body.center = Vector3.up;
            body.height = 2;
            body.radius = 0.4f;
            var d = go.AddComponent<Damageable>();
            d.maxHealth = 1000;
            d.ResetVitals();
            var hb = go.AddComponent<Hitbox>();
            hb.owner = d;
            var head = new GameObject("WeakPoint");
            head.transform.SetParent(go.transform, false);
            head.transform.localPosition = new Vector3(0, 1.75f, 0);
            head.AddComponent<SphereCollider>().radius = 0.25f;
            var wb = head.AddComponent<Hitbox>();
            wb.owner = d;
            wb.weakpoint = true;
            Physics.SyncTransforms();
            return d;
        }

        [Test]
        public void SweepCountsWeakpointBehindBodyCapsuleAsHeadshot()
        {
            var d = Enemy(Far);
            Assert.IsTrue(PlayerProjectile.Sweep(Far + new Vector3(0, 1.75f, -5), Vector3.forward, 10, 0.05f, null, out var head));
            Assert.AreEqual(d, head.enemy);
            Assert.IsTrue(head.weakpoint, "先进身体胶囊、1.5 m 内穿过弱点：按爆头算（同命中扫描）");
            Assert.IsTrue(head.hitbox && head.hitbox.weakpoint);

            Assert.IsTrue(PlayerProjectile.Sweep(Far + new Vector3(0, 0.8f, -5), Vector3.forward, 10, 0.05f, null, out var body));
            Assert.AreEqual(d, body.enemy);
            Assert.IsFalse(body.weakpoint, "打在腰上不算爆头");

            Assert.IsFalse(PlayerProjectile.Sweep(Far + new Vector3(0, 0.8f, -5), Vector3.forward, 4, 0.05f, null, out _), "这一段还没飞到");
            Assert.IsFalse(PlayerProjectile.Sweep(Far + new Vector3(0, 0.8f, -5), Vector3.forward, 10, 0.05f, new HashSet<Damageable> { d }, out _),
                "已经穿过的敌人不再命中");
        }

        PlayerProjectile Fire(Vector3 from, Vector3 velocity, float amount, int pierce, List<ProjectileHit> hits)
        {
            var info = DamageInfo.Simple(amount, DamageSource.Weapon, from, velocity.normalized);
            info.noCrit = true; // 关掉随机暴击：暴击只可能来自弱点
            var spec = new PlayerProjectileSpec(from, velocity, info, 0.09f, 2f) { pierce = pierce, visual = null, onHit = h => hits.Add(h) };
            return PlayerProjectile.Spawn(spec);
        }

        [Test]
        public void PierceHitsEachEnemyOnceThenStops()
        {
            var a = Enemy(Far);
            var b = Enemy(Far + new Vector3(0, 0, 3));
            var c = Enemy(Far + new Vector3(0, 0, 6));
            var hits = new List<ProjectileHit>();
            var p = Fire(Far + new Vector3(0, 0.8f, -3), new Vector3(0, 0, 60), 0, 1, hits);
            for (int i = 0; i < 20 && p.Alive; i++) p.Step(0.02f);
            Assert.AreEqual(2, hits.Count, "穿透 1：打中两个敌人后停下");
            Assert.AreEqual(a, hits[0].enemy);
            Assert.AreEqual(b, hits[1].enemy);
            Assert.IsFalse(p.Alive);
            Assert.AreNotEqual(c, hits[1].enemy);

            hits.Clear();
            var q = Fire(Far + new Vector3(0, 0.8f, -3), new Vector3(0, 0, 60), 0, 0, hits);
            for (int i = 0; i < 20 && q.Alive; i++) q.Step(0.02f);
            Assert.AreEqual(1, hits.Count, "不穿透：只打第一个");
        }

        [Test]
        public void ProjectileWeakpointHitCrits()
        {
            // 伤害结算会派发事件；编辑模式下可能有上次 Play 留下的监听者报错，这里只关心结算结果
            LogAssert.ignoreFailingMessages = true;
            Enemy(Far);
            var hits = new List<ProjectileHit>();
            var head = Fire(Far + new Vector3(0, 1.75f, -3), new Vector3(0, 0, 60), 10, 0, hits);
            for (int i = 0; i < 20 && head.Alive; i++) head.Step(0.02f);
            Assert.AreEqual(1, hits.Count);
            Assert.IsTrue(hits[0].weakpoint);
            Assert.IsTrue(hits[0].result.crit, "投射物打中弱点必定暴击（P0：原来投射物打不出爆头）");

            hits.Clear();
            var body = Fire(Far + new Vector3(0, 0.8f, -3), new Vector3(0, 0, 60), 10, 0, hits);
            for (int i = 0; i < 20 && body.Alive; i++) body.Step(0.02f);
            Assert.AreEqual(1, hits.Count);
            Assert.IsFalse(hits[0].weakpoint);
            Assert.IsFalse(hits[0].result.crit, "身体 + noCrit：不暴击");
        }
    }
}
