using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第三章敌人 EN3a–c（炭童、祸斗、熔炉铁牛、火鼍、毕方、马面狱卒）的纯逻辑，对照 tests/inferno-pack / inferno-tanks / inferno-ranged.test.mjs：
    /// 定义数值与 Three.js 一致（复燃 / 余烬不掉落）；熔岩查询（网格熔岩、兜底、线段 / 岸边 / 熔岩边）；
    /// 炭童抛炭的弹道与踩散距离；祸斗吐火射程随吃火变化、扇形边缘留身宽（侧移躲得开）、包抄站位、吃火侧身站位；
    /// 铁牛铁甲 ×0.2 / 炉门 ×3（只在敞开、正面、打在炉门上）、吸力范围、喷吐扇面、铁渣墙排布；
    /// 火鼍岩甲 ×0.25 / 熔肉 ×2 / 接缝 ×0.5 / 潜熔 ×0.5、甩尾扫向熔岩、熔岩里绕开岸角；
    /// 毕方滑翔弧线与时长、断腿坠落弧线、换栖条件；马面拖拽长度（停在熔岩前 1.2 m、身前就是熔岩时不拖）、射链判定（链中段才算）。
    /// </summary>
    public sealed class InfernoEnemyTests
    {
        [SetUp]
        public void SetUp()
        {
            InfernoKit.Lava = null;
            FireFeed.ResetForTests();
        }

        [TearDown]
        public void TearDown()
        {
            InfernoKit.Lava = null;
            FireFeed.ResetForTests();
        }

        // ───────────── 定义 ─────────────

        [Test]
        public void DefsMatchTheRosterDoc()
        {
            var t = EnemyRoster.Get("tantong");
            var h = EnemyRoster.Get("huodou");
            var ox = EnemyRoster.Get("iron_ox");
            var tuo = EnemyRoster.Get("tuo");
            var bf = EnemyRoster.Get("bifang");
            var mm = EnemyRoster.Get("mamian");
            var reborn = EnemyRoster.Get(TantongAI.RebornId);
            var ember = EnemyRoster.Get(TantongAI.EmberId);
            foreach (var d in new[] { t, h, ox, tuo, bf, mm, reborn, ember }) Assert.IsNotNull(d);
            Assert.AreEqual((30f, 6.5f, 9f, 1.3f), (t.hp, t.speed, t.damage, t.scale), "炭童 hp 30、移速 6.5、伤害 9、1.0 m 美术 ×1.3");
            Assert.AreEqual((70f, 8f, 12f, 1.2f), (h.hp, h.speed, h.damage, h.scale), "祸斗 hp 70、移速 8、×1.2");
            Assert.AreEqual((700f, 260f, 2.4f, 40f, 1.4f), (ox.hp, ox.armor, ox.speed, ox.damage, ox.scale), "铁牛");
            Assert.AreEqual((650f, 120f, 2f, 38f, 1.3f), (tuo.hp, tuo.armor, tuo.speed, tuo.damage, tuo.scale), "火鼍");
            Assert.AreEqual((90f, 7f, 20f, 1.2f, 0.5f), (bf.hp, bf.speed, bf.damage, bf.scale, bf.knockbackResist), "毕方");
            Assert.AreEqual((140f, 4f, 12f, 1.2f, 0.45f), (mm.hp, mm.speed, mm.damage, mm.scale, mm.knockbackResist), "马面");
            Assert.AreEqual(Vector2Int.zero, reborn.coins, "复燃的炭童不掉落");
            Assert.AreEqual(0, reborn.essence);
            Assert.AreEqual(Vector2Int.zero, ember.coins, "炭堆不掉落");
            Assert.AreEqual(8f, ember.hp, "炭堆一枪就散");
            Assert.AreEqual(1f, ox.knockbackResist);
            Assert.AreEqual(1f, tuo.knockbackResist);
            Assert.IsTrue(bf.flying && !bf.groundOnly, "毕方栖高，不是只站地面");
            Assert.AreEqual(EnemyPlacement.Precision, bf.placementRole);
            Assert.AreEqual(EnemyPlacement.Flank, h.placementRole);
            Assert.AreEqual(EnemyPlacement.Ranged, mm.placementRole);
            Assert.AreEqual(typeof(TantongAI), reborn.ai, "复燃的炭童与本体共用行为");
            Assert.AreEqual(t.prefab, reborn.prefab, "复燃的炭童与本体共用美术");
        }

        // ───────────── 熔岩查询 ─────────────

        /// <summary>z ∈ [5, 7] 横贯 x ∈ [-20, 20] 的熔岩带（同 TS 马面测试的打桩）</summary>
        static LavaGrid Band() => new LavaGrid(-20, -20, 0.25f, 160, 160, 0.1f).Fill(-20, 5, 20, 7);

        [Test]
        public void FallbackHasNoLava()
        {
            Assert.IsInstanceOf<NoLava>(InfernoKit.Lava, "熔岩系统接上之前是兜底");
            Assert.IsFalse(InfernoKit.HasLava);
            Assert.IsFalse(InfernoKit.Lava.IsLava(Vector3.zero));
            Assert.IsFalse(InfernoKit.Lava.NearestLava(Vector3.zero, 50, out _));
            Assert.IsTrue(float.IsNaN(InfernoKit.Lava.SurfaceY(Vector3.zero)));
            Assert.IsNull(InfernoKit.LavaEdge(Vector3.zero, 8), "没有熔岩：祸斗找不到熔岩边");
            Assert.IsFalse(InfernoKit.CrossesLava(Vector3.zero, Vector3.forward * 10));
        }

        [Test]
        public void LavaGridAnswersCellsNearestAndShore()
        {
            var g = Band();
            InfernoKit.Lava = g;
            Assert.IsTrue(InfernoKit.HasLava);
            Assert.IsTrue(g.IsLava(new Vector3(0, 0, 6)));
            Assert.IsFalse(g.IsLava(new Vector3(0, 0, 4.9f)));
            Assert.AreEqual(0.1f, g.SurfaceY(new Vector3(3, 0, 6)), 1e-5f);
            Assert.IsTrue(g.NearestLava(new Vector3(1, 0, 0), 8, out var near));
            Assert.AreEqual(5.125f, near.z, 1e-4f, "最近的熔岩格中心");
            Assert.IsFalse(g.NearestLava(new Vector3(1, 0, -10), 8, out _), "8 m 内没有");
            Assert.IsTrue(g.ShoreToward(new Vector3(0, 0, 6), new Vector3(0, 0, 0), 12, out var bank));
            Assert.That(bank.z, Is.InRange(4.8f, 5f), "朝玩家走第一个不是熔岩的点");
            Assert.IsTrue(InfernoKit.CrossesLava(new Vector3(0, 0, 13), new Vector3(0, 0, 0)));
            Assert.IsFalse(InfernoKit.CrossesLava(new Vector3(0, 0, 13), new Vector3(0, 0, 8.5f)));
            Assert.IsTrue(InfernoKit.AllLava(new Vector3(-5, 0, 6), new Vector3(5, 0, 6)));
            var edge = InfernoKit.LavaEdge(new Vector3(0, 0, 1), 8);
            Assert.IsNotNull(edge, "祸斗没别的火时吃熔岩边");
            Assert.AreEqual(FireKind.Lava, edge.Kind);
            Assert.IsTrue(edge.Edible);
            edge.Consume();
            Assert.IsTrue(edge.Edible, "熔岩边吃不完");
        }

        // ───────────── 几何 ─────────────

        [Test]
        public void SegmentDistancesAndPlayerCapsule()
        {
            float d2 = InfernoKit.SegmentSegmentSq(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, -1), new Vector3(0, 1, 1), out float s, out float t);
            Assert.AreEqual(1f, d2, 1e-5f);
            Assert.AreEqual(0.5f, s, 1e-5f);
            Assert.AreEqual(0.5f, t, 1e-5f);
            var feet = Vector3.zero;
            Assert.IsTrue(InfernoKit.SegmentHitsCapsule(new Vector3(-3, 1, 0), new Vector3(3, 1, 0), feet, 0.2f), "钩头横穿胸口");
            Assert.IsFalse(InfernoKit.SegmentHitsCapsule(new Vector3(-3, 1, 1), new Vector3(3, 1, 1), feet, 0.2f), "侧移 1 m 躲开");
            Assert.IsFalse(InfernoKit.SegmentHitsCapsule(new Vector3(-3, 2.5f, 0), new Vector3(3, 2.5f, 0), feet, 0.2f), "头顶上方");
        }

        // ───────────── 炭童 ─────────────

        [Test]
        public void TantongCoalArcLandsOnTheTarget()
        {
            var from = new Vector3(0, 1, 0);
            var target = new Vector3(3, 0, 9);
            float T = TantongAI.CoalFlightTime(new Vector2(3, 9).magnitude);
            Assert.AreEqual(0.5f + new Vector2(3, 9).magnitude * 0.04f, T, 1e-5f, "0.5 + 距离 × 0.04");
            var v = TantongAI.BallisticVelocity(from, target, T, TantongAI.CoalGravity);
            var p = from;
            const int steps = 240;
            float dt = T / steps;
            for (int i = 0; i < steps; i++)
            {
                v.y -= TantongAI.CoalGravity * dt * 0.5f;
                p += v * dt;
                v.y -= TantongAI.CoalGravity * dt * 0.5f;
            }
            Assert.Less(Vector3.Distance(p, target), 0.05f, $"T 秒后落在目标上（{p}）");
        }

        [Test]
        public void EmberPileIsSteppedOnWithin75cm()
        {
            var pile = new Vector3(2, 0, 2);
            Assert.IsTrue(TantongEmberAI.ShouldStomp(new Vector3(2.4f, 0, 2.3f), pile));
            Assert.IsFalse(TantongEmberAI.ShouldStomp(new Vector3(2.8f, 0, 2.3f), pile), "0.85 m：没踩到");
            Assert.IsFalse(TantongEmberAI.ShouldStomp(new Vector3(2.2f, 0.8f, 2.1f), pile), "跳在上面（高差 0.8 m）不算踩");
            Assert.AreEqual(4f, TantongAI.RekindleTime);
            Assert.AreEqual(0.5f, TantongAI.RekindleHp, "复燃半血");
        }

        // ───────────── 祸斗 ─────────────

        [Test]
        public void HuodouSpitReachGrowsWithMeals()
        {
            Assert.AreEqual(8f, HuodouAI.SpitRangeFor(0), 1e-5f, "6.5 + 1.5 × max(1, 次数)");
            Assert.AreEqual(8f, HuodouAI.SpitRangeFor(1), 1e-5f);
            Assert.AreEqual(11f, HuodouAI.SpitRangeFor(HuodouAI.MaxMeals), 1e-5f);
        }

        [Test]
        public void HuodouConeLeavesRoomForASidestep()
        {
            var o = Vector3.zero;
            float yaw = 0; // 朝 +Z
            Assert.IsTrue(HuodouAI.InCone(o, yaw, 8, new Vector3(0, 0, 6)), "正前方 6 m");
            Assert.IsTrue(HuodouAI.InCone(o, yaw, 8, new Vector3(Mathf.Tan(HuodouAI.SpitHalf) * 6 + 0.2f, 0, 6)), "扇形边缘留一点身宽");
            Assert.IsFalse(HuodouAI.InCone(o, yaw, 8, new Vector3(4.5f, 0, 6)), "侧移 4.5 m 躲开");
            Assert.IsFalse(HuodouAI.InCone(o, yaw, 8, new Vector3(0, 0, 8.5f)), "射程外");
            Assert.IsFalse(HuodouAI.InCone(o, yaw, 8, new Vector3(0, 2.2f, 5)), "高差 1.8 m 以上");
            Assert.IsTrue(HuodouAI.InCone(o, yaw, 8, new Vector3(0.3f, 0, -0.2f)), "贴身 0.4 m 内都算");
        }

        [Test]
        public void HuodouPackSlotsFrontFlanksAndBehind()
        {
            var p = new Vector3(10, 0, 10);
            var fwd = Vector3.forward;
            var front = HuodouAI.SlotFor(0, p, fwd);
            Assert.AreEqual(HuodouAI.FrontR, (front - p).magnitude, 1e-4f);
            Assert.Greater(Vector3.Dot(front - p, fwd), 5.9f, "0 号守在玩家正前方 6 m");
            var a = HuodouAI.SlotFor(1, p, fwd) - p;
            var b = HuodouAI.SlotFor(2, p, fwd) - p;
            Assert.AreEqual(HuodouAI.FlankR, a.magnitude, 1e-4f);
            Assert.Less(a.x * b.x, 0, "1、2 号在两侧");
            var behind = HuodouAI.SlotFor(3, p, fwd) - p;
            Assert.Less(Vector3.Dot(behind.normalized, fwd), -0.99f, "3 号绕到身后");
        }

        [Test]
        public void HuodouEatsSideOnToThePlayer()
        {
            var fire = new Vector3(0, 0, 0);
            var player = new Vector3(0, 0, -10);
            var stand = HuodouAI.EatStand(fire, player, new Vector3(3, 0, 1), 0.5f);
            Assert.AreEqual(0.5f, new Vector2(stand.x, stand.z).magnitude, 1e-4f, "站在离火 reach 处");
            Assert.Greater(stand.x, 0.49f, "站在自己这一侧（与玩家视线垂直）：侧腹对着玩家");
            var other = HuodouAI.EatStand(fire, player, new Vector3(-3, 0, 1), 0.5f);
            Assert.Less(other.x, -0.49f);
        }

        // ───────────── 熔炉铁牛 ─────────────

        [Test]
        public void IronOxArmourAndFurnaceDoor()
        {
            Assert.AreEqual(0.2f, IronOxAI.ArmourFactor(false, false, false, true), 1e-6f, "铁甲到处 ×0.2");
            Assert.AreEqual(0.2f, IronOxAI.ArmourFactor(false, false, true, true), 1e-6f, "关着的炉门也是铁甲");
            Assert.AreEqual(3f, IronOxAI.ArmourFactor(false, true, true, true), 1e-6f, "敞开的炉门 ×3");
            Assert.AreEqual(0.2f, IronOxAI.ArmourFactor(false, true, true, false), 1e-6f, "从侧面打不进炉膛");
            Assert.AreEqual(0.2f, IronOxAI.ArmourFactor(false, true, false, true), 1e-6f, "炉门敞开时打在身上仍是铁甲");
            Assert.AreEqual(1f, IronOxAI.ArmourFactor(true, false, false, false), 1e-6f, "持续伤害不受铁甲影响");
            Assert.AreEqual(0.08f, IronOxAI.ChokeFraction, 1e-6f, "炉门累计 8% 呛火");
        }

        [Test]
        public void IronOxInhalePullsOnlyInFrontWithinRange()
        {
            float r = 0.95f * 1.4f;
            Assert.Greater(IronOxAI.PullStrength(10, 1, false, r), 0, "正前方 10 m 被拉");
            Assert.AreEqual(0, IronOxAI.PullStrength(21, 1, false, r), "20 m 外不拉");
            Assert.AreEqual(0, IronOxAI.PullStrength(10, 0.1f, false, r), "不在正前方不拉");
            Assert.AreEqual(0, IronOxAI.PullStrength(r + 1, 1, false, r), "贴脸不再拉");
            Assert.Greater(IronOxAI.PullStrength(10, 1, true, r), IronOxAI.PullStrength(10, 1, false, r), "精英吸力更强");
            Assert.Greater(IronOxAI.PullStrength(6, 1, false, r), IronOxAI.PullStrength(16, 1, false, r), "近的拉得更狠");
        }

        [Test]
        public void IronOxSpitFanAndSlagWallLayout()
        {
            var o = Vector3.zero;
            Assert.IsTrue(IronOxAI.InFan(o, 0, new Vector3(0, 0, 11), 1.3f), "12 m 扇面");
            Assert.IsTrue(IronOxAI.InFan(o, 0, new Vector3(Mathf.Sin(0.5f) * 8, 0, Mathf.Cos(0.5f) * 8), 1.3f), "±30° 内");
            Assert.IsFalse(IronOxAI.InFan(o, 0, new Vector3(Mathf.Sin(0.6f) * 8, 0, Mathf.Cos(0.6f) * 8), 1.3f), "30° 外");
            Assert.IsFalse(IronOxAI.InFan(o, 0, new Vector3(0, 0, 12.5f), 1.3f), "射程外");
            int segs = 0;
            foreach (var (d, lats) in IronOxAI.SlagRows)
                foreach (float lat in lats)
                {
                    var c = IronOxAI.SlagPoint(o, 0, d, lat);
                    Assert.AreEqual(d, c.z, 1e-4f, "墙段在喷吐方向上");
                    Assert.AreEqual(lat, c.x, 1e-4f, "横向排开");
                    segs++;
                }
            Assert.AreEqual(5, segs, "两排：5.5 m 两段、9 m 三段");
            var turned = IronOxAI.SlagPoint(o, Mathf.PI / 2, 5.5f, 1.7f);
            Assert.AreEqual(5.5f, turned.x, 1e-4f, "朝 +X 喷时墙段在 +X 方向");
        }

        // ───────────── 火鼍 ─────────────

        [Test]
        public void TuoPlatesFleshSeamAndSubmerged()
        {
            Assert.AreEqual(0.25f, TuoAI.ArmourFactor(false, false, false, false), 1e-6f, "完好的岩甲 ×0.25");
            Assert.AreEqual(2f, TuoAI.ArmourFactor(false, false, true, false), 1e-6f, "碎甲熔肉 ×2");
            Assert.AreEqual(0.5f, TuoAI.ArmourFactor(false, false, false, true), 1e-6f, "脊背接缝 ×0.5");
            Assert.AreEqual(0.5f, TuoAI.ArmourFactor(false, true, true, false), 1e-6f, "潜熔时一律 ×0.5");
            Assert.AreEqual(1f, TuoAI.ArmourFactor(true, true, true, true), 1e-6f, "持续伤害不算");
            Assert.AreEqual(8, TuoAI.Plates);
            Assert.AreEqual(3, TuoAI.RetreatBroken, "碎 3 块回熔");
        }

        [Test]
        public void TuoTailSweepKnocksTowardTheNearestLava()
        {
            var self = Vector3.zero;
            var player = new Vector3(0, 0, -3);
            var dry = TuoAI.SweepKnockFor(player, self, 1, NoLava.Instance);
            Assert.AreEqual(TuoAI.SweepUp, dry.y, 1e-5f);
            Assert.AreEqual(TuoAI.SweepKnock, new Vector2(dry.x, dry.z).magnitude, 1e-4f);
            Assert.Less(dry.z, 0, "没有熔岩：切向 + 往外");
            // 玩家西边 4 m 有一条熔岩
            var lava = new LavaGrid(-20, -20, 0.25f, 160, 160).Fill(-6, -20, -4, 20);
            var wet = TuoAI.SweepKnockFor(player, self, 1, lava);
            Assert.Less(wet.x, -TuoAI.SweepKnock * 0.6f, $"偏向最近的熔岩（{wet}）");
            Assert.AreEqual(TuoAI.SweepKnock, new Vector2(wet.x, wet.z).magnitude, 1e-4f);
        }

        [Test]
        public void TuoSwimsAroundAShoreCorner()
        {
            // L 形熔岩：沿 z 的河道（x ∈ [-2, 2]）在 z = 10 处拐向 +x
            var lava = new LavaGrid(-20, -20, 0.25f, 160, 160).Fill(-2, -10, 2, 12).Fill(-2, 8, 15, 12);
            var from = new Vector3(0, 0, 0);
            float straight = TuoAI.SwimHeading(lava, from, new Vector3(0, 0, 8), 0, 3, out bool arrived);
            Assert.IsFalse(arrived);
            Assert.AreEqual(0f, straight, 1e-4f, "直线通就直着游");
            // 目标在拐角后面（右前方的岸那边）：直线穿岸走不通，偏开一点沿河道游
            float bend = TuoAI.SwimHeading(lava, from, new Vector3(10, 0, 10), 0, 3, out _);
            var dir = InfernoKit.YawDir(bend);
            Assert.IsTrue(InfernoKit.AllLava(lava, from, from + dir * 3), "挑出来的航向 3 m 内全是熔岩");
            Assert.Greater(dir.z, 0.5f, "沿河道往前");
            TuoAI.SwimHeading(lava, from, new Vector3(0.3f, 0, 0.5f), 0, 3, out arrived);
            Assert.IsTrue(arrived, "1 m 内算到了");
        }

        // ───────────── 毕方 ─────────────

        [Test]
        public void BifangGlideArcAndTiming()
        {
            var a = new Vector3(0, 0, 0);
            var b = new Vector3(16, 5, 0);
            BifangAI.GlidePlan(a, b, out float time, out float apex);
            Assert.AreEqual(1.6f, time, 1e-4f, "16 m / 10 m/s");
            Assert.AreEqual(0.8f + 0.06f * 16 + 5 * 0.25f, apex, 1e-4f);
            BifangAI.GlidePlan(a, new Vector3(2, 0, 0), out float shortT, out _);
            Assert.AreEqual(BifangAI.GlideMin, shortT, 1e-5f, "最短 0.8 s");
            BifangAI.GlidePlan(a, new Vector3(40, 0, 0), out float longT, out _);
            Assert.AreEqual(BifangAI.GlideMax, longT, 1e-5f, "最长 2.6 s");
            Assert.Less(Vector3.Distance(BifangAI.GlidePoint(a, b, apex, 0), a), 1e-4f);
            Assert.Less(Vector3.Distance(BifangAI.GlidePoint(a, b, apex, 1), b), 1e-4f, "落在落脚点上");
            var mid = BifangAI.GlidePoint(a, b, apex, 0.5f);
            Assert.Greater(mid.y, Mathf.Lerp(a.y, b.y, 0.5f) + apex * 0.9f, "中段抬高");
            var top = new Vector3(0, 5, 0);
            var foot = new Vector3(2, 0, 0);
            Assert.Less(Vector3.Distance(BifangAI.FallPoint(top, foot, 1), foot), 1e-4f, "断腿摔到柱脚");
            Assert.Greater(BifangAI.FallPoint(top, foot, 0.2f).y, top.y, "先往上翻一点");
        }

        [Test]
        public void BifangRelocatesWhenHurtSeenAtItsHeightOrBlind()
        {
            const float hp = 90;
            Assert.IsFalse(BifangAI.WantsToMove(0, hp, true, -5, 20, 0), "高处、20 m、看得见：不动");
            Assert.IsTrue(BifangAI.WantsToMove(hp * 0.3f, hp, true, -5, 20, 0), "掉 30% 血换栖");
            Assert.IsTrue(BifangAI.WantsToMove(0, hp, true, -1, 8, 0), "玩家爬到差不多的高度、9 m 内");
            Assert.IsTrue(BifangAI.WantsToMove(0, hp, true, -5, 20, 2.6f), "2.5 s 看不到");
            Assert.IsTrue(BifangAI.WantsToMove(0, hp, false, 0, 20, 0), "在矮处 / 地面就想上高处");
            Assert.IsTrue(BifangAI.WantsToMove(0, hp, true, -5, 6, 0), "太近");
            Assert.IsTrue(BifangAI.WantsToMove(0, hp, true, -5, 37, 0), "太远");
        }

        // ───────────── 马面 ─────────────

        [Test]
        public void MamianDragsUpToEightMetresAndStopsInFront()
        {
            float len = MamianAI.DragLength(new Vector3(0, 0, 13), Vector3.zero, MamianAI.DragStop, NoLava.Instance, out var dir, out bool cut);
            Assert.IsFalse(cut);
            Assert.AreEqual(MamianAI.DragDist, len, 1e-4f, "最远 8 m");
            Assert.Less(dir.z, -0.99f, "朝马面拖");
            float near = MamianAI.DragLength(new Vector3(0, 0, 6), Vector3.zero, MamianAI.DragStop, NoLava.Instance, out _, out _);
            Assert.AreEqual(6 - MamianAI.DragStop, near, 1e-4f, "停在身前 2.4 m");
        }

        [Test]
        public void MamianDragStopsShortOfLava()
        {
            var lava = Band();
            float len = MamianAI.DragLength(new Vector3(0, 0, 13), Vector3.zero, MamianAI.DragStop, lava, out _, out bool cut);
            Assert.IsTrue(cut, "路线上有熔岩");
            Assert.Greater(13 - len, 7 + 0.8f, $"停在近岸，不进熔岩（停在 z = {13 - len:F2}）");
            Assert.Greater(len, 3f, "还是拖到了岸边");
            float none = MamianAI.DragLength(new Vector3(0, 0, 7.8f), Vector3.zero, MamianAI.DragStop, lava, out _, out bool cut2);
            Assert.IsTrue(cut2);
            Assert.Less(none, 0.6f, "岸边就在面前：不拖（只扯一下）");
        }

        [Test]
        public void MamianChainSnapsOnlyWhenShotMidway()
        {
            var root = new Vector3(0, 1.3f, 0);
            var tip = new Vector3(0, 1.0f, 8);
            var eye = new Vector3(6, 1.6f, 4);
            var mid = Vector3.Lerp(root, tip, 0.5f);
            float along = MamianAI.ChainShotAlong(eye, (mid - eye).normalized, 80, root, tip, MamianAI.ChainHitR, MamianAI.ChainSkipRoot, MamianAI.ChainSkipTip);
            Assert.Greater(along, 0, "瞄着链子中段开枪");
            Assert.AreEqual(Vector3.Distance(eye, mid), along, 0.05f);
            var nearRoot = Vector3.Lerp(root, tip, 0.05f);
            Assert.Less(MamianAI.ChainShotAlong(eye, (nearRoot - eye).normalized, 80, root, tip, MamianAI.ChainHitR, MamianAI.ChainSkipRoot, MamianAI.ChainSkipTip), 0,
                "腕铐边上那一段不算");
            var miss = mid + Vector3.up * 0.6f;
            Assert.Less(MamianAI.ChainShotAlong(eye, (miss - eye).normalized, 80, root, tip, MamianAI.ChainHitR, MamianAI.ChainSkipRoot, MamianAI.ChainSkipTip), 0,
                "从链子上方 0.6 m 擦过");
            Assert.Less(MamianAI.ChainShotAlong(eye, Vector3.right, 80, root, new Vector3(0, 1.2f, 1.2f), MamianAI.ChainHitR, MamianAI.ChainSkipRoot, MamianAI.ChainSkipTip), 0,
                "链太短（刚放出去）打不断");
            Assert.AreEqual(0.3f, MamianAI.LockBreak, 1e-6f, "锁芯 30% 缴械");
        }
    }
}
