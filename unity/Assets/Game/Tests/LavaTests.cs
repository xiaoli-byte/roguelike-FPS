using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// L7 熔岩的纯逻辑（Three.js 版 tests/lava.test.mjs 的玩家 / 敌人部分移植；生成器 / NavGrid 部分换成 Unity 的 NavMesh 区域与代理类型）：
    ///   · 数值与 TS 的 LAVA 表一致（HazardSpec.Lava、LavaTuning）；
    ///   · 判定体几何：转过的盒、圆、到边距离、最近点、高度窗口（岛 / 堤道高出熔岩面不算）；
    ///   · 玩家：踩进去一次算一次、托回后再踩还算；贴地冲刺一帧跨过窄渠也算、传送不算；跳过 1.6 m 的渠不算、落进去算、在熔岩上空不算；
    ///     从洞口掉进熔岩（脚底低于熔岩面）不着地也算；安全落脚点离熔岩至少 1 m（SafeGround 危险区）；
    ///   · 敌人：自己走进去拉回、击退窗口 0.6 s 内落进去烧死、首领 / 飞行 / 熔岩生物不受影响、被掀在熔岩上空的落地前不算；
    ///   · 涨落：自动涨落的阶段与涨幅、脚本 RiseTo 的预警 → 涨 → 高位、涨上来以后堤道上的点算熔岩、导航挖洞的时机；
    ///   · 只给 XZ 的查询（注入高度函数代替射线）：湖床 / 岛 / 岸坡 / 地形洞，最近的岸、朝目标上岸、岸上找最近的熔岩边；
    ///   · 钩子：有熔岩时 SafeGround 危险区与祸斗熔岩边自动接上、没了自动撤；熔岩面网格的顶点数据；工程里的 Lava 区域与 LavaSwimmer 代理类型。
    /// </summary>
    public sealed class LavaTests
    {
        [SetUp]
        public void SetUp()
        {
            FireFeed.ResetForTests();
            LavaField.ResetForTests();
        }

        [TearDown]
        public void TearDown()
        {
            LavaField.ResetForTests();
            FireFeed.ResetForTests();
        }

        // ───────────── 数值 ─────────────

        [Test]
        public void TuningMatchesThreeJsLavaTable()
        {
            var s = HazardSpec.Lava;
            Assert.AreEqual(0.12f, s.burst, 1e-6f, "LAVA.burst");
            Assert.AreEqual(0.015f, s.tick, 1e-6f, "LAVA.burnTick");
            CollectionAssert.AreEqual(new[] { 0.2f, 0.4f }, s.tickTimes, "LAVA.burnAt");
            Assert.AreEqual(0.5f, s.sinkTime, 1e-6f, "LAVA.sinkTime");
            Assert.AreEqual(1f, s.grace, 1e-6f, "LAVA.grace");
            Assert.AreEqual(Element.Fire, s.element);
            Assert.AreEqual(0.3f, LavaTuning.StandRise, 1e-6f, "LAVA.standRise");
            Assert.AreEqual(1f, LavaTuning.SafeMargin, 1e-6f, "LAVA.safeMargin");
            Assert.AreEqual(0.6f, LavaTuning.KnockWindow, 1e-6f, "LAVA.knockWindow");
            Assert.AreEqual(4f, LavaTuning.TeleportStep, 1e-6f, "超过 4 m 的位移是传送");
        }

        // ───────────── 几何 ─────────────

        [Test]
        public void RotatedBoxAndDiscFootprints()
        {
            // 24 × 6 的条带转 90°：长边沿世界 X
            var box = new LavaBody(LavaShape.Box, new Vector3(10, 0, 5), new Vector2(6, 24), 0, 90);
            Assert.IsTrue(box.Contains(10 + 11.5f, 5), "转过之后长边沿 X");
            Assert.IsFalse(box.Contains(10, 5 + 4f), "短边沿 Z（半宽 3）");
            Assert.AreEqual(3f, box.Inset(10, 5), 1e-4f, "中心离最近的边 3 m");
            Assert.AreEqual(-1f, box.Inset(10, 5 + 4), 1e-4f, "边外 1 m");
            var rect = box.WorldRect;
            Assert.AreEqual(24f, rect.width, 1e-3f);
            Assert.AreEqual(6f, rect.height, 1e-3f);
            var cp = box.ClosestPoint(10, 5 + 10);
            Assert.AreEqual(5 + 3f, cp.z, 1e-4f, "最近点落在边上");

            var disc = new LavaBody(LavaShape.Disc, Vector3.zero, new Vector2(5, 0), 2);
            Assert.IsTrue(disc.Contains(3, 3.9f));
            Assert.IsFalse(disc.Contains(4, 4));
            Assert.AreEqual(5f, disc.Inset(0, 0), 1e-4f);
            Assert.AreEqual(5f, disc.ClosestPoint(10, 0).x, 1e-4f);
            Assert.AreEqual(2f, disc.ClosestPoint(10, 0).y, 1e-4f, "最近点的 y 是熔岩面");
        }

        [Test]
        public void HeightWindowExcludesIslandsCausewaysAndDeepTunnels()
        {
            var lake = new LavaBody(LavaShape.Disc, Vector3.zero, new Vector2(30, 0), 0, 0, 3);
            Assert.IsTrue(lake.Touches(new Vector3(5, 0, 0)), "熔岩面上");
            Assert.IsTrue(lake.Touches(new Vector3(5, -1.5f, 0)), "湖床（熔岩面下 1.5 m）");
            Assert.IsTrue(lake.Touches(new Vector3(5, 0.29f, 0)), "standRise 以内");
            Assert.IsFalse(lake.Touches(new Vector3(5, 0.31f, 0)), "高出 standRise 不算（掩体顶、跳在半空）");
            Assert.IsFalse(lake.Touches(new Vector3(5, 1.4f, 0)), "堤道高出熔岩 1.4 m");
            Assert.IsFalse(lake.Touches(new Vector3(5, -3.5f, 0)), "depth 以下（地底隧道）不算");
            Assert.IsFalse(lake.Touches(new Vector3(31, 0, 0)), "形状外");
            Assert.IsTrue(lake.Submerged(new Vector3(5, -0.5f, 0)));
            Assert.IsFalse(lake.Submerged(new Vector3(5, -0.1f, 0)), "刚没过脚底不算「掉进去」");
            lake.enabled = false;
            Assert.IsFalse(lake.Touches(new Vector3(5, 0, 0)), "停用的熔岩不算");
        }

        // ───────────── 玩家 ─────────────

        /// <summary>沿 Z 的 1.6 m 窄渠（inferno-5 的放射渠），熔岩面 y 0；offset = 离渠中线的 X</summary>
        static List<LavaBody> Channel() => new() { new LavaBody(LavaShape.Box, Vector3.zero, new Vector2(1.6f, 40), 0) };

        static Vector3 At(float offset, float y = 0) => new(offset, y, 3);

        [Test]
        public void SteppingIntoLavaCountsOncePerEntryAndAgainAfterTheLift()
        {
            var lava = Channel();
            var t = new LavaContactTracker();
            for (int i = 0; i < 10; i++) Assert.IsFalse(t.Step(lava, At(-3), true), "站在岸上");
            Assert.IsTrue(t.Step(lava, At(0), true), "走进去：踩入");
            // 下沉期间（LavaField 每帧 Reset，SafeGround 锁身体）不再算
            for (int i = 0; i < 30; i++) t.Reset();
            // 托回岸上（传送）→ 再走进去，又算一次
            Assert.IsFalse(t.Step(lava, At(-3), true));
            Assert.IsFalse(t.Step(lava, At(-1.5f), true), "离渠中线 1.5 m 还在岸上");
            Assert.IsTrue(t.Step(lava, At(-0.5f), true), "重新踩进去");
        }

        [Test]
        public void GroundedDashCannotCrossLavaButATeleportIsNotAnEntry()
        {
            var lava = Channel();
            var t = new LavaContactTracker();
            t.Step(lava, At(-3), true);
            Assert.IsFalse(t.Step(lava, At(-1.9f), true));
            Assert.IsTrue(t.Step(lava, At(1.9f), true), "贴地一帧 3.8 m 跨过 1.6 m 的渠：这一帧滑过的整段碰到熔岩");
            t.Reset();
            Assert.IsFalse(t.Step(lava, At(-3), true));
            Assert.IsFalse(t.Step(lava, At(20), true), "一帧 23 m：传送（检查点、挑战入口），不算");
        }

        [Test]
        public void JumpingAChannelIsSafeAndLandingInItHurts()
        {
            var lava = Channel();
            var t = new LavaContactTracker();
            int entries = 0;
            // 7.5 m/s 助跑，渠中线前 1.3 m 起跳、过中线 1.3 m 落地，空中离地 0.6 m
            const float v = 7.5f, dt = 1f / 60f;
            for (float s = -3; s <= 3; s += v * dt)
            {
                bool air = Mathf.Abs(s) < 1.3f;
                if (t.Step(lava, At(s, air ? 0.6f : 0), !air)) entries++;
            }
            for (int i = 0; i < 10; i++)
                if (t.Step(lava, At(3), true)) entries++;
            Assert.AreEqual(0, entries, "跳过 1.6 m 的渠不受伤");
            Assert.IsFalse(t.Step(lava, At(0, 0.8f), false), "在熔岩上空离地 0.8 m");
            Assert.IsTrue(t.Step(lava, At(0), true), "落进渠里");
        }

        [Test]
        public void FallingIntoALavaWellCountsEvenWhileAirborne()
        {
            // 熔岩井：地形洞下 5 m 的熔岩面（下面没有地，玩家不会着地）
            var well = new List<LavaBody> { new(LavaShape.Disc, new Vector3(0, -5, 0), new Vector2(4, 0), -5, 0, 3) };
            var t = new LavaContactTracker();
            Assert.IsFalse(t.Step(well, new Vector3(0, -2, 0), false), "还在井口下落");
            Assert.IsFalse(t.Step(well, new Vector3(0, -5.1f, 0), false), "刚碰到熔岩面");
            Assert.IsTrue(t.Step(well, new Vector3(0, -5.4f, 0), false), "脚底已低于熔岩面：掉进去了");
        }

        [Test]
        public void SafeSpotsKeepAMetreFromLavaThroughSafeGround()
        {
            var body = new LavaBody(LavaShape.Box, Vector3.zero, new Vector2(1.6f, 40), 0);
            Assert.IsFalse(SafeGround.IsHazard(new Vector3(-0.5f, 0, 3)), "没登记熔岩之前不是危险区");
            LavaField.Register(body);
            Assert.IsTrue(SafeGround.IsHazard(new Vector3(0, 0, 3)), "熔岩上");
            Assert.IsTrue(SafeGround.IsHazard(new Vector3(-0.8f - 0.95f, 0, 3)), "离熔岩边 0.95 m");
            Assert.IsFalse(SafeGround.IsHazard(new Vector3(-0.8f - 1.05f, 0, 3)), "离熔岩边 1.05 m");
            Assert.IsFalse(SafeGround.IsHazard(new Vector3(-0.8f - 0.5f, 3f, 3)), "高出熔岩 3 m 的台子（岸坡 / 桥头另算）");
            for (float a = 0; a < Mathf.PI * 2; a += Mathf.PI / 16)
            {
                var p = new Vector3(-3 + Mathf.Cos(a) * 0.9f, 0, 3 + Mathf.Sin(a) * 0.9f);
                Assert.IsFalse(LavaField.IsLava(p), "离熔岩 1 m 以外记的安全点，周围 0.9 m 都不是熔岩");
            }
            LavaField.Unregister(body);
            Assert.IsFalse(SafeGround.IsHazard(new Vector3(0, 0, 3)), "熔岩都撤了，危险区也撤");
        }

        // ───────────── 敌人 ─────────────

        [Test]
        public void GroundEnemiesWalkingInArePushedBackKnockedInBurnImmuneIgnore()
        {
            const float now = 10f;
            Assert.AreEqual(LavaEnemyAction.PushBack, LavaEnemyRule.Decide(false, true, now, float.NegativeInfinity), "自己走进去：拉回岸上");
            Assert.AreEqual(LavaEnemyAction.Burn, LavaEnemyRule.Decide(false, true, now, now), "被击退进去：烧死");
            Assert.AreEqual(LavaEnemyAction.Burn, LavaEnemyRule.Decide(false, true, now, now - 0.3f), "击退结束后还在滑，0.6 s 内落进去也算");
            Assert.AreEqual(LavaEnemyAction.PushBack, LavaEnemyRule.Decide(false, true, now, now - 0.7f), "击退过去 0.7 s 才走进去：拉回");
            Assert.AreEqual(LavaEnemyAction.None, LavaEnemyRule.Decide(false, false, now, now), "不在熔岩里");
            Assert.AreEqual(LavaEnemyAction.None, LavaEnemyRule.Decide(true, true, now, now), "首领 / 飞行 / 熔岩生物不受影响");
            // 被掀在熔岩上空 2 m：落地之前不算在熔岩里
            var lava = Channel();
            Assert.IsFalse(LavaGeometry.Touches(lava, At(0, 2)));
            Assert.AreEqual(LavaEnemyAction.None, LavaEnemyRule.Decide(false, LavaGeometry.Touches(lava, At(0, 2)), now, now));
            Assert.AreEqual(LavaEnemyAction.Burn, LavaEnemyRule.Decide(false, LavaGeometry.Touches(lava, At(0, 0.1f)), now + 0.4f, now), "落下来还在窗口里：烧死");
        }

        /// <summary>
        /// 击退窗口只由明确的击退信号打开（同 TS knockedBack）：失控滑行（冲量 &gt; 2 m/s，0.25 s × (1 − 抗性)）、被掀飞。
        /// 回归 playtest lava「自己走进熔岩的敌人死了」：旧版把「这一帧挪得比导航快、又不到 4 m」当成被推着滑——冒烟测试把敌人 Warp 回岸边（1–2 m）
        /// 两帧后再挪进熔岩，就落在 0.6 s 的击退窗口里被烧死；落地吸附、坠落回收这类短距瞬移也一样
        /// </summary>
        [Test]
        public void OnlyRealKnockbackOpensTheBurnWindowNotTeleports()
        {
            Assert.AreEqual(0.25f, EnemyAI.ControlLoss(new Vector3(9, 0, 0), 0), 1e-6f, "TS controlLoss = 0.25 × k");
            Assert.AreEqual(0.15f, EnemyAI.ControlLoss(new Vector3(0, 0, -9), 0.4f), 1e-5f, "抗性 0.4");
            Assert.AreEqual(0f, EnemyAI.ControlLoss(new Vector3(1.5f, 0, 1f), 0), "轻推（≤ 2 m/s）不失控");
            Assert.AreEqual(0f, EnemyAI.ControlLoss(new Vector3(9, 0, 0), 1), "抗性满（首领）不失控");
            Assert.AreEqual(0f, EnemyAI.ControlLoss(new Vector3(0, 9, 0), 0), "只看水平分量（往上掀是 LaunchUp）");
            Assert.IsTrue(LavaEnemyRule.Knocked(true, false), "被掀飞");
            Assert.IsTrue(LavaEnemyRule.Knocked(false, true), "失控滑行");
            Assert.IsFalse(LavaEnemyRule.Knocked(false, false), "传送 / 吸附 / 回收：没有击退信号");

            // 逐帧：第 0 帧被 Warp 1.5 m 回岸边（没有击退信号），第 2 帧挪进熔岩 → 拉回岸上
            var lava = Channel();
            float knockAt = float.NegativeInfinity, t = 10f;
            const float dt = 1f / 60f;
            var path = new[] { At(-4.5f), At(-3), At(-3), At(0) };
            var action = LavaEnemyAction.None;
            foreach (var p in path)
            {
                if (LavaEnemyRule.Knocked(false, false)) knockAt = t;
                action = LavaEnemyRule.Decide(false, LavaGeometry.Touches(lava, p), t, knockAt);
                t += dt;
            }
            Assert.IsFalse(LavaGeometry.Touches(lava, path[2]), "Warp 之后还在岸上");
            Assert.IsTrue(LavaGeometry.Touches(lava, path[^1]), "最后一帧在熔岩里");
            Assert.AreEqual(LavaEnemyAction.PushBack, action, "自己走进去：拉回，不烧死");
        }

        // ───────────── 涨落 ─────────────

        [Test]
        public void TideCyclesThroughWarningRiseHighFall()
        {
            var tide = LavaTide.Channel;
            Assert.AreEqual(20f, tide.Period, 1e-4f, "8 + 1.5 + 2.5 + 5 + 3");
            Assert.AreEqual(0f, tide.Sample(1, out var ph));
            Assert.AreEqual(LavaTidePhase.Low, ph);
            Assert.AreEqual(0f, tide.Sample(8.5f, out ph), "预警期还没涨");
            Assert.AreEqual(LavaTidePhase.Warning, ph);
            Assert.AreEqual(0.5f, tide.Sample(9.5f + 1.25f, out ph), 1e-4f, "涨到一半（缓入缓出的中点）");
            Assert.AreEqual(LavaTidePhase.Rising, ph);
            Assert.AreEqual(1f, tide.Sample(14, out ph));
            Assert.AreEqual(LavaTidePhase.High, ph);
            float f = tide.Sample(18.5f, out ph);
            Assert.AreEqual(LavaTidePhase.Falling, ph);
            Assert.IsTrue(f > 0 && f < 1);
            Assert.AreEqual(0f, tide.Sample(21, out ph), "循环");
            Assert.AreEqual(LavaTidePhase.Low, ph);
            tide.offset = 10;
            tide.Sample(1, out ph);
            Assert.AreEqual(LavaTidePhase.Rising, ph, "相位错开 10 s");

            var d = new LavaLevelDriver(2, LavaTide.Channel);
            float lvl = 2;
            var seen = new List<LavaTidePhase>();
            for (int i = 0; i < 21 * 30; i++)
            {
                d.Step(1f / 30f);
                if (seen.Count == 0 || seen[^1] != d.Phase) seen.Add(d.Phase);
                lvl = Mathf.Max(lvl, d.Level);
            }
            CollectionAssert.AreEqual(new[] { LavaTidePhase.Low, LavaTidePhase.Warning, LavaTidePhase.Rising, LavaTidePhase.High, LavaTidePhase.Falling, LavaTidePhase.Low }, seen);
            Assert.AreEqual(3.2f, lvl, 1e-3f, "涨到基准面 + 1.2 m");
        }

        [Test]
        public void ScriptedRiseWarnsThenFloodsTheCauseway()
        {
            var body = new LavaBody(LavaShape.Box, Vector3.zero, new Vector2(10, 10), 0);
            var lava = new List<LavaBody> { body };
            var d = new LavaLevelDriver(0);
            var causeway = new Vector3(2, 1f, 0);
            Assert.IsFalse(LavaGeometry.Touches(lava, causeway), "堤面高出熔岩 1 m");
            Assert.IsFalse(d.Flooding);

            d.MoveTo(0.9f, 1f, 0.5f);
            Assert.AreEqual(LavaTidePhase.Warning, d.Phase);
            Assert.IsTrue(d.Flooding, "预警时导航就挖掉（敌人先躲）");
            Assert.IsFalse(d.Step(0.25f), "预警期熔岩面不动");
            Assert.AreEqual(0f, d.Level);
            Assert.IsTrue(d.Step(0.5f), "预警完开始涨（多出来的 0.25 s 算进涨）");
            Assert.AreEqual(LavaTidePhase.Rising, d.Phase);
            Assert.IsTrue(d.Level > 0 && d.Level < 0.9f);
            for (int i = 0; i < 30; i++) d.Step(0.05f);
            Assert.AreEqual(LavaTidePhase.High, d.Phase);
            Assert.AreEqual(0.9f, d.Level, 1e-5f);
            body.level = d.Level;
            Assert.IsTrue(LavaGeometry.Touches(lava, causeway), "熔岩涨到 0.9 m：堤面在熔岩面 + 0.3 m 以内，算熔岩");
            Assert.IsTrue(LavaGeometry.Submerged(lava, new Vector3(2, 0f, 0)), "原来的地面被淹没");

            d.MoveTo(d.BaseLevel, 0.5f);
            Assert.AreEqual(LavaTidePhase.Falling, d.Phase);
            for (int i = 0; i < 20; i++) d.Step(0.05f);
            Assert.AreEqual(LavaTidePhase.Low, d.Phase);
            Assert.IsFalse(d.Flooding, "退回低位，导航的洞撤掉");
            body.level = d.Level;
            Assert.IsFalse(LavaGeometry.Touches(lava, causeway));

            d.Snap(0.4f);
            Assert.AreEqual(0.4f, d.Level);
            Assert.IsTrue(d.Flooding, "高出基准面 0.35 m 以上算涨潮");
            d.ReleaseToTide();
            Assert.IsFalse(d.Scripted);
        }

        // ───────────── 只给 XZ 的查询 ─────────────

        /// <summary>
        /// 熔岩湖（熔岩面 y 0，形状半径 16 m，比岸线大一圈）：湖床 −1.5，r 10–14 m 是岸坡升到 +3，湖心 r 2 m 的岛顶 +2；
        /// (−8, 0) 一带 2 m 内是地形洞（下面什么都没有）
        /// </summary>
        static bool LakeProbe(float x, float z, float top, float bottom, out float y)
        {
            float r = new Vector2(x, z).magnitude;
            y = float.NaN;
            if (new Vector2(x + 8, z).magnitude < 2) return false;
            float g = r < 2 ? 2f : r < 10 ? -1.5f : r < 14 ? Mathf.Lerp(-1.5f, 3f, (r - 10) / 4) : 3f;
            if (g > top || g < bottom) return false;
            y = g;
            return true;
        }

        static List<LavaBody> Lake() => new() { new LavaBody(LavaShape.Disc, Vector3.zero, new Vector2(16, 0), 0, 0, 3) };

        [Test]
        public void IsLavaAtProbesTheGroundUnderTheSurface()
        {
            var lake = Lake();
            Assert.IsTrue(LavaGeometry.IsLavaAt(lake, 5, 0, LakeProbe, out float g));
            Assert.AreEqual(-1.5f, g, 1e-4f, "湖床");
            Assert.IsFalse(LavaGeometry.IsLavaAt(lake, 1, 0, LakeProbe, out _), "湖心岛");
            Assert.IsTrue(LavaGeometry.IsLavaAt(lake, 11, 0, LakeProbe, out _), "岸坡下段（−0.375）还在熔岩里");
            Assert.IsFalse(LavaGeometry.IsLavaAt(lake, 13, 0, LakeProbe, out _), "岸坡上段（+1.875）");
            Assert.IsFalse(LavaGeometry.IsLavaAt(lake, 15, 0, LakeProbe, out _), "形状里的岸上（靠高度排除）");
            Assert.IsFalse(LavaGeometry.IsLavaAt(lake, 20, 0, LakeProbe, out _), "形状外");
            Assert.IsTrue(LavaGeometry.IsLavaAt(lake, -8, 0, LakeProbe, out g), "地形洞：下面是空的，算熔岩");
            Assert.AreEqual(0f, g, 1e-4f, "没有地面时 groundY 取熔岩面");
        }

        [Test]
        public void NearestShoreBankTowardAndNearestLavaEdge()
        {
            var lake = Lake();
            // 离岛（r 2）4 m、离外岸（r ≈ 11.6）5.6 m：最近的岸是岛
            Assert.IsTrue(LavaGeometry.NearestShore(lake, new Vector3(6, -1.5f, 0), 10, LakeProbe, out var shore));
            Assert.IsFalse(LavaGeometry.IsLavaAt(lake, shore.x, shore.z, LakeProbe, out _));
            Assert.Less(new Vector2(shore.x, shore.z).magnitude, 2.6f, $"最近的岸是湖心岛（{shore}）");
            // 离外岸 2.6 m、离岛 7 m
            Assert.IsTrue(LavaGeometry.NearestShore(lake, new Vector3(0, -1.5f, 9), 10, LakeProbe, out shore));
            Assert.Greater(new Vector2(shore.x, shore.z).magnitude, 11.3f, $"最近的岸是外岸（{shore}）");
            Assert.IsFalse(LavaGeometry.NearestShore(lake, new Vector3(6, -1.5f, 0), 1, LakeProbe, out _), "1 m 内没有岸");

            // 火鼍朝玩家扑上岸：从 (6, 0) 朝 +X，第一个不是熔岩的点在岸坡 r ≈ 11.6
            Assert.IsTrue(LavaGeometry.BankToward(lake, new Vector3(6, -1.5f, 0), new Vector3(30, 3, 0), 12, LakeProbe, out var bank));
            Assert.AreEqual(11.6f, bank.x, 0.3f);
            Assert.AreEqual(0f, bank.z, 1e-3f);
            Assert.IsTrue(bank.y > 0.3f, "落点在熔岩面 standRise 以上");

            // 祸斗在岸上找熔岩边
            Assert.IsTrue(LavaGeometry.NearestLava(lake, new Vector3(0, 3, 15), 6, LakeProbe, out var lavaPt, out var edge));
            Assert.IsTrue(LavaGeometry.IsLavaAt(lake, lavaPt.x, lavaPt.z, LakeProbe, out _));
            Assert.IsFalse(LavaGeometry.IsLavaAt(lake, edge.x, edge.z, LakeProbe, out _), "岸边点不在熔岩里");
            Assert.Less(Vector3.Distance(new Vector3(lavaPt.x, 0, lavaPt.z), new Vector3(edge.x, 0, edge.z)), 0.8f, "岸边点紧挨着熔岩");
            Assert.AreEqual(11.6f, new Vector2(lavaPt.x, lavaPt.z).magnitude, 0.8f);
            Assert.IsFalse(LavaGeometry.NearestLava(lake, new Vector3(0, 3, 40), 5, LakeProbe, out _, out _), "5 m 内没有熔岩");
        }

        [Test]
        public void SweepAndSurfaceQueries()
        {
            var lava = Channel();
            Assert.IsTrue(LavaGeometry.Sweep(lava, At(-2), At(2)));
            Assert.IsFalse(LavaGeometry.Sweep(lava, At(-3), At(-1)));
            Assert.IsFalse(LavaGeometry.Sweep(lava, At(-2, 1), At(2, 1)), "离地 1 m 飞过");
            Assert.IsTrue(LavaGeometry.SurfaceAt(lava, 0.5f, 10, out float y, out var b));
            Assert.AreEqual(0f, y);
            Assert.AreSame(lava[0], b);
            Assert.IsFalse(LavaGeometry.SurfaceAt(lava, 2, 10, out _, out _));
            // 两片重叠取熔岩面高的（涨上来的渠盖过湖）
            lava.Add(new LavaBody(LavaShape.Box, Vector3.zero, new Vector2(4, 4), 0.8f));
            Assert.IsTrue(LavaGeometry.SurfaceAt(lava, 0.5f, 1, out y, out _));
            Assert.AreEqual(0.8f, y);
        }

        // ───────────── 钩子 ─────────────

        [Test]
        public void RegisteringLavaHooksTheFireFeedEdgeAndUnregisteringRemovesIt()
        {
            LavaField.Probe = LakeProbe;
            Assert.IsNull(FireFeed.FindLavaEdge(new Vector3(0, 3, 15), 6), "没有熔岩时没有熔岩边");
            var body = Lake()[0];
            LavaField.Register(body);
            Assert.IsTrue(LavaField.Any);
            var edge = FireFeed.FindLavaEdge(new Vector3(0, 3, 15), 6);
            Assert.IsNotNull(edge, "有熔岩时祸斗的熔岩边自动接上");
            Assert.AreEqual(FireKind.Lava, edge.Kind);
            Assert.IsTrue(edge.Edible);
            edge.Consume();
            Assert.IsTrue(edge.Edible, "熔岩边吃不完");
            edge.ClaimedBy = this;
            Assert.IsNull(edge.ClaimedBy, "熔岩边不占用");
            Assert.IsFalse(LavaField.IsLavaAt(edge.Position), "熔岩边的位置是岸上的落脚点");
            Assert.IsNull(FireFeed.FindLavaEdge(new Vector3(0, 3, 15), 1), "太远");
            Assert.IsTrue(LavaField.IsLava(new Vector3(5, -1.5f, 0)));
            Assert.AreEqual(0f, LavaField.SurfaceHeight(new Vector3(5, 9, 0)), 1e-5f);
            Assert.IsTrue(float.IsNaN(LavaField.SurfaceHeight(new Vector3(40, 0, 0))));
            LavaField.Unregister(body);
            Assert.IsFalse(LavaField.Any);
            Assert.IsNull(FireFeed.FindLavaEdge(new Vector3(0, 3, 15), 6), "熔岩都撤了，熔岩边也撤");
        }

        [Test]
        public void LavaSurfaceMeshCarriesShapeDataForTheShader()
        {
            var m = LavaVolume.BuildMesh(LavaShape.Box, new Vector2(24, 6), false, new Vector2(0, 0.4f));
            Assert.AreEqual(24f, m.bounds.size.x, 1e-3f);
            Assert.AreEqual(6f, m.bounds.size.z, 1e-3f);
            var uv1 = new List<Vector4>();
            m.GetUVs(1, uv1);
            Assert.AreEqual(new Vector4(12, 3, 0, 0), uv1[0], "uv1 = (半宽, 半长, 盒, 不按深度)");
            var uv2 = new List<Vector4>();
            m.GetUVs(2, uv2);
            Assert.AreEqual(0.4f, uv2[0].y, 1e-6f, "uv2.xy = 流动");
            var v = m.vertices;
            var tri = m.triangles;
            for (int i = 0; i < tri.Length; i += 3)
            {
                var n = Vector3.Cross(v[tri[i + 1]] - v[tri[i]], v[tri[i + 2]] - v[tri[i]]);
                Assert.Greater(n.y, 0, "三角形朝上（从上面看得见）");
            }
            Object.DestroyImmediate(m);

            var d = LavaVolume.BuildMesh(LavaShape.Disc, new Vector2(5, 0), true);
            Assert.AreEqual(10f, d.bounds.size.x, 0.05f);
            d.GetUVs(1, uv1);
            Assert.AreEqual(new Vector4(5, 5, 1, 1), uv1[0], "uv1 = (半径, 半径, 圆, 按深度)");
            v = d.vertices;
            tri = d.triangles;
            for (int i = 0; i < tri.Length; i += 3)
                Assert.Greater(Vector3.Cross(v[tri[i + 1]] - v[tri[i]], v[tri[i + 2]] - v[tri[i]]).y, 0, "圆的三角形朝上");
            Object.DestroyImmediate(d);
        }

        [Test]
        public void ProjectHasLavaNavAreaAndSwimmerAgentType()
        {
            int area = NavMesh.GetAreaFromName(LavaField.AreaName);
            Assert.GreaterOrEqual(area, 3, "ProjectSettings/NavMeshAreas.asset 里有 Lava 区域（改了文件要重启编辑器才生效）");
            Assert.AreEqual(50f, NavMesh.GetAreaCost(area), 1e-4f, "Lava 区代价 50：地面敌人绕路走");
            var type = LavaField.SwimmerAgentType;
            Assert.IsTrue(type.HasValue, "有 LavaSwimmer 代理类型");
            var settings = NavMesh.GetSettingsByID(type.Value);
            Assert.AreEqual(0.9f, settings.agentRadius, 1e-4f);
            Assert.AreEqual(1 << area, LavaField.LavaAreaMask);
            Assert.AreEqual(0, LavaField.DryAreaMask & LavaField.LavaAreaMask);
        }
    }
}
