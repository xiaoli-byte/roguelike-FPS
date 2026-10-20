using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第二章冰霜敌人 EN2a–c（冻鲛人、雪狌狌、冰甲旋龟、玄冰巨蟹、三青鸟、冰河豚）：移植 tests/frost-pack / frost-tanks / frost-skirmishers.test.mjs
    /// 里能脱离场景验证的部分——定义数值、投矛弹道、群刺门限与错开、鲛珠回复、跳砸弹道、找台沿、冰壳 / 钳墙的格挡（E2 命中区朝向门）、
    /// 旋壳加速与反弹次数、横扫冲击环、甩人冲量、冰羽横排、俯冲路线、河豚俯冲速度与冰爆、冻雾范围。
    /// 走位、出招时序、攀爬、歇脚这些要导航网格和动画的，由冒烟套件 frost（FrostEnemiesSuite）在 TestArena 里验。
    /// </summary>
    public sealed class FrostEnemyTests
    {
        readonly List<GameObject> spawned = new();
        static readonly Vector3 Far = new(-5000, 500, -5000);

        [SetUp]
        public void SetUp() => PackCoordinator.Reset();

        [TearDown]
        public void TearDown()
        {
            PackCoordinator.Reset();
            foreach (var go in spawned)
                if (go) Object.DestroyImmediate(go);
            spawned.Clear();
        }

        // ───────────── 定义 ─────────────

        [Test]
        public void DefsMatchTheThreeJsRoster()
        {
            void Check(string id, float hp, float armor, float speed, float damage, float scale, float kr, Type ai, bool flying, Vector2Int coins, int essence)
            {
                var d = Registry<EnemyDef>.Get(id);
                Assert.IsNotNull(d, $"{id} 没有登记");
                Assert.AreEqual(hp, d.hp, $"{id} hp");
                Assert.AreEqual(armor, d.armor, $"{id} armor");
                Assert.AreEqual(speed, d.speed, 1e-5f, $"{id} speed");
                Assert.AreEqual(damage, d.damage, $"{id} damage");
                Assert.AreEqual(scale, d.scale, 1e-5f, $"{id} scale");
                Assert.AreEqual(kr, d.knockbackResist, 1e-5f, $"{id} knockbackResist");
                Assert.AreEqual(ai, d.ai, $"{id} ai");
                Assert.AreEqual(flying, d.flying, $"{id} flying");
                Assert.AreEqual(coins, d.coins, $"{id} coins");
                Assert.AreEqual(essence, d.essence, $"{id} essence");
            }

            Check("jiaoren", 40, 0, 5.2f, 11, 1.15f, 0, typeof(JiaorenAI), false, new Vector2Int(1, 2), 1);
            Check("xingxing", 55, 0, 6.5f, 14, 1.3f, 0, typeof(XingxingAI), false, new Vector2Int(1, 2), 1);
            Check("xuangui", 560, 220, 1.8f, 36, 1.5f, 1, typeof(XuanGuiAI), false, new Vector2Int(8, 12), 3);
            Check("frost_crab", 620, 200, 2.4f, 40, 1.5f, 1, typeof(FrostCrabAI), false, new Vector2Int(8, 12), 3);
            Check("qingniao", 80, 0, 6f, 9, 1.2f, 0.4f, typeof(QingniaoAI), true, new Vector2Int(3, 5), 1);
            Check("ice_puffer", 34, 0, 4.5f, 24, 1f, 0.1f, typeof(IcePufferAI), true, new Vector2Int(1, 3), 1);
            var x = Registry<EnemyDef>.Get("xingxing");
            Assert.That(x.hp, Is.InRange(50, 60), "名册文档：hp ≈ 55");
            Assert.AreEqual(1.7f, x.scale * 1.3f, 0.05f, "名册文档：1.3 m 的美术放大到约 1.7 m");
            Assert.AreEqual("SK_Enemy_SnowXingxing", x.prefab);
            Assert.AreEqual(HitboxMode.Ragdoll, Registry<EnemyDef>.Get("qingniao").hitboxes, "三青鸟翼展 3.4 m：存活时布娃娃胶囊做命中盒（TS 骨骼上的命中球）");
            Assert.AreEqual(EnemyPlacement.Flank, Registry<EnemyDef>.Get("jiaoren").placementRole, "TS FLANK：冻鲛人、冰河豚");
            Assert.AreEqual(EnemyPlacement.Flank, Registry<EnemyDef>.Get("ice_puffer").placementRole);
            Assert.AreEqual(EnemyPlacement.Ranged, Registry<EnemyDef>.Get("qingniao").placementRole);
            Assert.IsTrue(Registry<EnemyDef>.Get("xuangui").charger, "TS CHARGERS 含旋龟");
            foreach (var id in new[] { "jiaoren", "xingxing", "xuangui", "frost_crab" })
                Assert.IsTrue(Registry<EnemyDef>.Get(id).groundOnly, $"{id} 在 TS GROUND_ONLY 里");
        }

        // ───────────── 冻鲛人 ─────────────

        [Test]
        public void SpearFliesAtTheChestAndOnlyLeadsHalfTheMotion()
        {
            var from = new Vector3(0, 1.2f, 0);
            var chest = new Vector3(0, 1.1f, 14);
            var v = JiaorenAI.SpearVelocity(from, chest, Vector3.zero, out float life);
            Assert.Greater(v.z, 20f, "矛朝玩家飞");
            Assert.Less(v.magnitude, 26f);
            float t = Vector3.Distance(from, chest) / JiaorenAI.SpearSpeed;
            Assert.AreEqual(t * 1.6f + 0.6f, life, 1e-4f);
            // 按重力 4 积分到玩家所在的 z：高度落在胸口附近（补偿了一半的落差）
            var p = Ballistic(from, v, JiaorenAI.SpearGravity, chest.z);
            Assert.AreEqual(chest.y, p.y, 0.35f, $"矛到玩家处的高度 {p.y:F2}");
            // 预判只取一半：玩家横移 6 m/s，矛瞄的是 0.5 × 6 × t
            var lead = JiaorenAI.SpearVelocity(from, chest, new Vector3(6, 0, 0), out _);
            var q = Ballistic(from, lead, JiaorenAI.SpearGravity, chest.z);
            Assert.AreEqual(0.5f * 6 * t, q.x, 0.15f, "横移就能躲：只预判一半");
        }

        [Test]
        public void PackGateHoldsAndElitesNeedOneMemberLess()
        {
            const string key = "test.pack";
            Assert.IsTrue(PackCoordinator.TryOpenGate(key, 100, JiaorenAI.PackGap));
            Assert.IsFalse(PackCoordinator.TryOpenGate(key, 103, JiaorenAI.PackGap), "同一群 4.5 s 内只发起一次");
            Assert.IsTrue(PackCoordinator.GateOpen("other.pack", 103, JiaorenAI.PackGap), "门限按群分开");
            Assert.IsTrue(PackCoordinator.TryOpenGate(key, 104.6f, JiaorenAI.PackGap));
            Assert.IsTrue(PackCoordinator.TryOpenGate(key, 1, JiaorenAI.PackGap), "时钟回退（新开一局）时复位");
            Assert.AreEqual(3, PackCoordinator.Needed(JiaorenAI.PackMin, false), "普通鲛人凑够 3 只才群刺（2 只不行）");
            Assert.AreEqual(2, PackCoordinator.Needed(JiaorenAI.PackMin, true), "精英带队 2 只就够");
            // 三只由近到远错开 0.12 s：第一只和第三只的前摇差 > 0.2 s
            float first = PackCoordinator.StaggerDelay(0, JiaorenAI.LungeStagger), third = PackCoordinator.StaggerDelay(2, JiaorenAI.LungeStagger);
            Assert.Greater(third - first, 0.2f);
            Assert.AreEqual(0.85f, JiaorenAI.LungeMult, "群刺伤害 ×0.85");
        }

        [Test]
        public void PearlHealsFivePercentAndTenForElites()
        {
            Assert.AreEqual(5f, JiaorenAI.PearlHealFor(100, false), "TS：最大生命 100 的玩家回 5");
            Assert.AreEqual(10f, JiaorenAI.PearlHealFor(100, true));
            Assert.AreEqual(4f, JiaorenAI.PearlHealFor(40, false), "至少 4");
            Assert.AreEqual(8f, JiaorenAI.PearlHealFor(150, false), "四舍五入（7.5 → 8）");
            Assert.AreEqual(0.8f, JiaorenPearl.Life, "鲛珠滚 0.8 s 后变成回复");
        }

        // ───────────── 雪狌狌 ─────────────

        [Test]
        public void SlamIsARealJumpToTheWarnedLanding()
        {
            var plan = XingxingAI.PlanSlam(Vector3.zero, new Vector3(0, 0, 5), Vector3.zero);
            Assert.AreEqual(4.5f, plan.dist, 1e-4f, "停在玩家身前 0.5 m");
            Assert.AreEqual(0.4f + 4.5f * 0.03f, plan.time, 1e-4f);
            float apex = plan.velocity.y * plan.velocity.y / (2 * XingxingAI.Gravity);
            Assert.Greater(apex, 0.5f, $"是真跳跃（最高 {apex:F2} m）");
            // 按重力 26 积分到落地：正好落在预警圈中心
            var p = Vector3.zero;
            var v = plan.velocity;
            float t = 0;
            const float dt = 1 / 240f;
            while (t < 2)
            {
                v.y -= XingxingAI.Gravity * dt;
                p += v * dt;
                t += dt;
                if (p.y <= 0 && v.y < 0) break;
            }
            Assert.AreEqual(plan.time, t, 0.02f, "飞行时间与落点预警一致");
            Assert.AreEqual(plan.landing.z, p.z, 0.1f);
            Assert.AreEqual(7.5f, XingxingAI.PlanSlam(Vector3.zero, new Vector3(0, 0, 20), Vector3.zero).dist, 1e-4f, "最远 7.5 m");
            Assert.AreEqual(1f, XingxingAI.PlanSlam(Vector3.zero, new Vector3(0, 0, 0.8f), Vector3.zero).dist, 1e-4f, "最近 1 m");
            var lead = XingxingAI.PlanSlam(Vector3.zero, new Vector3(0, 0, 5), new Vector3(5, 0, 0));
            Assert.Greater(lead.landing.x, 0.2f, "预判玩家的移动");
            Assert.AreEqual(XingxingAI.SlamRadius, 2.5f);
            Assert.AreEqual(0.35f, XingxingAI.ChillSlow, "冰环冻缓 −35%");
            Assert.AreEqual(1.5f, XingxingAI.ChillTime);
        }

        /// <summary>z ∈ [z0, z1] 内有一块高 h 的台子，其余是 y = 0 的平地</summary>
        static Func<float, float, float, float> Deck(float z0, float z1, float h) =>
            (x, z, probe) => z >= z0 && z <= z1 && probe >= h ? h : 0f;

        [Test]
        public void ClimbsALowDeckButNotATower()
        {
            // 2.4 m 的平台（z 3..8），玩家站在上面
            Assert.IsTrue(XingxingAI.FindLedge(new Vector3(0, 0, -1), new Vector3(0, 2.4f, 6), Deck(3, 8, 2.4f), out var b, out var top));
            Assert.AreEqual(2.4f, top.y, 1e-4f, "台面点在台面上");
            Assert.Less(b.z, 3f, "台下落脚点在台沿前");
            Assert.Greater(top.z, 3f, "台面点在台沿后");
            Assert.AreEqual(0f, b.y, 1e-4f);
            // 5 m 的塔：超过 3.5 m 爬不上去（改抛冰块）
            Assert.IsFalse(XingxingAI.FindLedge(new Vector3(0, 0, 2), new Vector3(0, 5, 8), Deck(6, 10, 5), out _, out _));
            // 台沿太远（4.5 m 内找不到）
            Assert.IsFalse(XingxingAI.FindLedge(new Vector3(0, 0, -10), new Vector3(0, 2.4f, 6), Deck(3, 8, 2.4f), out _, out _));
            // 中间隔着一道矮墙、玩家在更高的一层：不是玩家那一层不爬
            Assert.IsFalse(XingxingAI.FindLedge(new Vector3(0, 0, 0), new Vector3(0, 3, 3), (x, z, p) => z >= 1 && z <= 1.4f ? 1.2f : z > 2 ? 3 : 0, out _, out _));
            Assert.AreEqual(0.55f + 10 * 0.035f, XingxingAI.ChunkFlightTime(10), 1e-5f, "冰块飞行时间");
            Assert.AreEqual(0.75f, XingxingAI.ChunkMult);
            Assert.AreEqual(12f, XingxingAI.RallyRadius, "12 m 内的同伴起哄");
        }

        // ───────────── 冰甲旋龟 / 玄冰巨蟹：格挡 ─────────────

        /// <summary>测试敌人（没跑 Awake）：身体胶囊（区 body）+ 身后的弱点球（区 weak），面朝 +Z</summary>
        (EnemyBody body, HitZone bodyZone, HitZone weak) Shell()
        {
            var go = new GameObject("FrostShell");
            spawned.Add(go);
            go.transform.position = Far;
            var cap = go.AddComponent<CapsuleCollider>();
            cap.center = Vector3.up;
            cap.height = 2;
            cap.radius = 1f;
            var d = go.AddComponent<Damageable>();
            var body = go.AddComponent<EnemyBody>();
            var bz = HitZone.Create(cap, d, body, "body");
            var tail = new GameObject("Snake");
            tail.transform.SetParent(go.transform, false);
            tail.transform.localPosition = new Vector3(0, 1.5f, -1.6f);
            var sphere = tail.AddComponent<SphereCollider>();
            sphere.radius = 0.32f;
            var wz = HitZone.Create(sphere, d, body, "weak", 1f, true, 10);
            Physics.SyncTransforms();
            return (body, bz, wz);
        }

        /// <summary>从 shooter（相对敌人的偏移）打向敌人的一枪</summary>
        static DamageInfo ShotFrom(Vector3 shooter)
        {
            var dir = -shooter;
            dir.y = 0;
            return DamageInfo.Simple(10, DamageSource.Weapon, Far + Vector3.up, dir.normalized);
        }

        [Test]
        public void XuanGuiShellTakesFifteenPercentFromTheFront()
        {
            var (body, bz, wz) = Shell();
            FrostKit.ApplyGuard(body, XuanGuiAI.GuardFor("advance", false));
            Assert.AreEqual(0.15f, bz.MultiplierFor(ShotFrom(new Vector3(0, 0, 12))), 1e-6f);
            Assert.AreEqual(0.15f, bz.MultiplierFor(ShotFrom(new Vector3(3, 0, 10))), 1e-6f, "正面的锥很宽（cos 0.3）");
            Assert.AreEqual(1f, bz.MultiplierFor(ShotFrom(new Vector3(0, 0, -12))), "蛇尾那一侧不挡");
            Assert.AreEqual(1f, bz.MultiplierFor(ShotFrom(new Vector3(12, 0, 0))), "侧面不挡");
            var dot = DamageInfo.Simple(5, DamageSource.Status, Far + Vector3.up, Vector3.down);
            Assert.IsNull(body.ZoneAt(dot), "持续伤害不算区：冰壳不挡 DoT");
            Assert.AreEqual(1f, wz.MultiplierFor(ShotFrom(new Vector3(0, 0, -12))), "蛇头（弱点）照常");
            FrostKit.ApplyGuard(body, XuanGuiAI.GuardFor("spin", false));
            Assert.AreEqual(0.4f, bz.MultiplierFor(ShotFrom(new Vector3(0, 0, -12))), 1e-6f, "旋转中全方位 ×0.4");
            Assert.AreEqual(0.4f, wz.multiplier, 1e-6f, "旋壳里的蛇头也是");
            FrostKit.ApplyGuard(body, XuanGuiAI.GuardFor("overheat", false));
            Assert.AreEqual(1f, bz.MultiplierFor(ShotFrom(new Vector3(0, 0, 12))), "过热翻倒不挡");
            Assert.AreEqual(1f, wz.multiplier);
            Assert.AreEqual(ZoneFacing.Any, XuanGuiAI.GuardFor("advance", true).facing, "被眩晕时不挡");
            foreach (var s in new[] { "peckWindup", "peck", "biteWindup", "bite", "retract", "backoff", "idle" })
                Assert.AreEqual(0.15f, XuanGuiAI.GuardFor(s, false).mult, $"{s} 时冰壳照挡");
            Assert.AreEqual(1f, XuanGuiAI.GuardFor("rightself", false).mult);
        }

        [Test]
        public void XuanGuiSpinRampsAndBouncesAtMostTwice()
        {
            Assert.AreEqual(6f, XuanGuiAI.SpinSpeedAt(0, false), 1e-5f);
            Assert.AreEqual(6f + 0.2f * 22, XuanGuiAI.SpinSpeedAt(0.2f, false), 1e-4f);
            Assert.AreEqual(12.5f, XuanGuiAI.SpinSpeedAt(1, false), 1e-5f);
            Assert.AreEqual(12.5f * 1.15f, XuanGuiAI.SpinSpeedAt(1, true), 1e-4f, "精英转得更快");
            Assert.IsFalse(XuanGuiAI.SpinStopsAt(1, false));
            Assert.IsFalse(XuanGuiAI.SpinStopsAt(2, false), "最多反弹 2 次");
            Assert.IsTrue(XuanGuiAI.SpinStopsAt(3, false), "第 3 次撞墙停下");
            Assert.IsFalse(XuanGuiAI.SpinStopsAt(3, true), "精英多反弹一次");
            Assert.IsTrue(XuanGuiAI.SpinStopsAt(4, true));
            // 撞墙按法线反弹
            var r = FrostKit.Reflect(new Vector3(1, 0, 1).normalized, Vector3.left);
            Assert.AreEqual(-1f / Mathf.Sqrt(2), r.x, 1e-4f);
            Assert.AreEqual(1f / Mathf.Sqrt(2), r.z, 1e-4f);
            Assert.AreEqual(Vector3.back, FrostKit.Reflect(Vector3.forward, Vector3.zero), "法线退化时掉头");
            Assert.AreEqual(1.25f, XuanGuiAI.SpinMult, "撞到玩家 ×1.25");
            Assert.AreEqual(0.8f, XuanGuiAI.SpinHitGap, "同一次旋转 0.8 s 内不重复命中");
            Assert.AreEqual(2.4f, XuanGuiAI.OverheatTime);
            Assert.AreEqual(0.7f, XuanGuiAI.BiteMult);
            Assert.AreEqual(1f, XuanGuiAI.PeckMult);
        }

        [Test]
        public void CrabClawWallAndBrokenGuard()
        {
            var (body, bz, _) = Shell();
            FrostKit.ApplyGuard(body, FrostCrabAI.GuardFor("advance", false, false));
            Assert.AreEqual(0.15f, bz.MultiplierFor(ShotFrom(new Vector3(0, 0, 12))), 1e-6f);
            Assert.AreEqual(1f, bz.MultiplierFor(ShotFrom(new Vector3(0, 0, -12))), "背后鳃缝那一侧不挡");
            Assert.AreEqual(1f, FrostCrabAI.GuardFor("shellBreak", false, true).mult, "碎钳演出不挡");
            Assert.AreEqual(1f, FrostCrabAI.GuardFor("grabRecover", false, false).mult, "收钳不挡（输出窗口）");
            FrostKit.ApplyGuard(body, FrostCrabAI.GuardFor("advance", false, true));
            Assert.AreEqual(0.5f, bz.MultiplierFor(ShotFrom(new Vector3(0, 0, 12))), 1e-6f, "断钳后正面只剩一半");
            Assert.AreEqual(0.25f, FrostCrabAI.GuardCos);
            Assert.AreEqual(0.35f, FrostCrabAI.BreakAt, "血量低于 35% 断钳");
            Assert.Greater(FrostCrabAI.BreakSpeed, 1.3f, "断钳后走得更快");
        }

        [Test]
        public void CrabGrabFlingsAndTheSweepWaveIsJumpable()
        {
            var go = new GameObject("Crab");
            spawned.Add(go);
            go.transform.rotation = Quaternion.identity;
            var fling = FrostCrabAI.FlingImpulse(go.transform);
            Assert.Greater(new Vector2(fling.x, fling.z).magnitude, 10f, "被夹中的玩家被甩出去");
            Assert.Greater(fling.y, 0f);
            Assert.Greater(fling.x, 0f, "甩向巨钳那一侧（生物右侧）");
            Assert.AreEqual(1.6f, FrostCrabAI.GrabMult);
            var w = FrostCrabAI.SweepWave(Far, 30, null);
            Assert.AreEqual(1.4f, w.startRadius);
            Assert.AreEqual(6.5f, w.maxRadius);
            Assert.AreEqual(18f, w.speed);
            Assert.AreEqual(0.6f, w.maxRise, "跳起 0.6 m 就躲开");
            Assert.IsFalse(w.needGrounded, "按高度判（同 TS），不看是否落地");
            Assert.AreEqual(7f, w.knockback);
            Assert.AreEqual(4f, w.knockUp);
            // 前沿逐帧扫过：站在 4 m 处的玩家在 (4 − 1.4 − 0.4) / 18 s 后被扫到
            var front = new WaveFront(w.startRadius, w.speed, w.maxRadius, w.width * 0.5f, w.overshoot);
            float t = 0;
            while (!front.Done && !front.Crosses(4f))
            {
                front.Step(1 / 60f);
                t += 1 / 60f;
            }
            Assert.AreEqual((4f - 1.4f - 0.4f) / 18f, t, 1 / 30f);
        }

        // ───────────── 三青鸟 ─────────────

        [Test]
        public void FeathersFormALineAcrossThePlayer()
        {
            var muzzle = new Vector3(0, 10, 0);
            var target = new Vector3(0, 1.1f, 20);
            var t = new Vector3[QingniaoAI.Feathers];
            QingniaoAI.FeatherTargets(muzzle, target, t);
            Assert.AreEqual(5, t.Length);
            for (int i = 1; i < t.Length; i++) Assert.AreEqual(2f, Vector3.Distance(t[i], t[i - 1]), 1e-4f, "相邻冰羽间距 2 m");
            Assert.AreEqual(target, t[2], "中间那根打在玩家身上");
            Assert.Less(t[0].x, 0f, "左翼尖的冰羽落在出手者的左边");
            Assert.Greater(t[4].x, 0f);
            Assert.AreEqual(22f, QingniaoAI.FeatherSpeed);
            Assert.AreEqual(0.5f, QingniaoAI.VolleyWindup);
        }

        [Test]
        public void SwoopPassesBesideThePlayerAndClimbsAwayOnTheFarSide()
        {
            QingniaoAI.SwoopPath(new Vector3(0, 10, 0), new Vector3(0, 0, 18), 1, 9, 0, out var low, out var end);
            Assert.AreEqual(1.6f, new Vector2(low.x, low.z - 18).magnitude, 1e-4f, "掠过点在玩家身侧 1.6 m");
            Assert.AreEqual(0.25f, low.y, 1e-4f, "胸口高度（脚底 + 0.25）");
            Assert.AreEqual(18f + 16f, end.z, 1e-4f, "拉升到玩家另一侧 16 m");
            Assert.AreEqual(9f, end.y, 1e-4f, "盘旋高度");
            QingniaoAI.SwoopPath(new Vector3(0, 10, 0), new Vector3(0, 0, 18), -1, 9, 0, out var other, out _);
            Assert.AreEqual(-low.x, other.x, 1e-4f, "横移方向决定从哪一侧掠过");
            Assert.AreEqual(0.3f, QingniaoAI.SwoopTrigger, "累计掉血 30% 触发");
            Assert.AreEqual(22f, QingniaoAI.SwoopDamage);
            Assert.AreEqual(3f, QingniaoAI.PerchTime, "歇 3 s");
        }

        // ───────────── 冰河豚 ─────────────

        [Test]
        public void PufferDivesInflatesAndLeavesASlowingFog()
        {
            Assert.AreEqual(6f, IcePufferAI.DiveSpeedAt(0), 1e-5f);
            Assert.AreEqual(9.5f, IcePufferAI.DiveSpeedAt(0.25f), 1e-5f);
            Assert.AreEqual(11f, IcePufferAI.DiveSpeedAt(1), 1e-5f, "最高 11 m/s");
            Assert.AreEqual(0.8f, IcePufferAI.InflateTime, "鼓气 0.8 s");
            Assert.AreEqual(2f, IcePufferAI.InflateScale, "鼓成两倍大");
            Assert.AreEqual(3f, IcePufferAI.BurstRadius);
            Assert.AreEqual(0.4f, IcePufferAI.FogSlow, "冻雾移速 −40%");
            Assert.AreEqual(4f, IcePufferAI.FogTime);
            Assert.AreEqual(30f, IcePufferAI.DeathBlastDamage(1, false), "鼓气中被打爆：30 × 等级");
            Assert.AreEqual(90f, IcePufferAI.DeathBlastDamage(2, true), "精英 ×1.5");
            var c = Vector3.zero;
            Assert.IsTrue(FrostFog.Inside(c, 3, new Vector3(3.1f, 0, 0)), "边缘外扩 0.175 m");
            Assert.IsFalse(FrostFog.Inside(c, 3, new Vector3(3.3f, 0, 0)));
            Assert.IsTrue(FrostFog.Inside(c, 3, new Vector3(0, 2.3f, 0)));
            Assert.IsFalse(FrostFog.Inside(c, 3, new Vector3(0, 2.5f, 0)), "雾顶 2.4 m");
            Assert.IsFalse(FrostFog.Inside(c, 3, new Vector3(0, -1.3f, 0)));
        }

        // ───────────── 通用 ─────────────

        [Test]
        public void GuardProfileLeavesWeakZonesUngated()
        {
            var (body, bz, wz) = Shell();
            FrostKit.ApplyGuard(body, new GuardProfile(0.2f, ZoneFacing.Front, 0.5f, 0.8f));
            Assert.AreEqual(ZoneFacing.Front, bz.facing);
            Assert.AreEqual(0.5f, bz.facingCos);
            Assert.AreEqual(ZoneFacing.Any, wz.facing, "弱点区不加朝向门");
            Assert.AreEqual(0.8f, wz.multiplier, 1e-6f);
            FrostKit.ApplyGuard(body, GuardProfile.Open);
            Assert.AreEqual(1f, bz.multiplier);
            Assert.AreEqual(ZoneFacing.Any, bz.facing);
            Assert.AreEqual(1f, wz.multiplier);
            Assert.IsTrue(GuardProfile.Open.Equals(new GuardProfile(1f, ZoneFacing.Any)));
        }

        /// <summary>从 from 以 v 出发、重力 g，积分到 z 坐标 targetZ 时的位置</summary>
        static Vector3 Ballistic(Vector3 from, Vector3 v, float g, float targetZ)
        {
            var p = from;
            const float dt = 1 / 480f;
            for (int i = 0; i < 4800 && p.z < targetZ; i++)
            {
                v.y -= g * dt;
                p += v * dt;
            }
            return p;
        }
    }
}
