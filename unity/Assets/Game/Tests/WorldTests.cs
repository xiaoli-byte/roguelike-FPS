using NUnit.Framework;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 世界系统（docs/unity-parity.md L3 / L8）：软边界的推回公式与尺度（走路顶到 +2.7 m、冲刺过不了 +14 m）、有符号距离场采样、区域风暴周期与远近、天气插值；
    /// 冰面牵引（平地逐帧模拟：冲刺余速在冰上滑约 8 m、平地 0.8 m，起步慢）、区域几何、流沙拉力 / 陷足（走不出芯、冲刺能脱身）、涉水减速。
    /// </summary>
    public sealed class WorldTests
    {
        // ───────────── 软边界 ─────────────

        [Test]
        public void PushIsFourPlusEighteenTimesWind()
        {
            var t = SoftBoundaryTuning.Default;
            Assert.AreEqual(0f, t.Push(0), 1e-5f, "没起风不推");
            Assert.AreEqual(13f, t.Push(0.5f), 1e-4f);
            Assert.AreEqual(22f, t.Push(1f), 1e-4f, "风力满 = 冲刺速度");
            Assert.AreEqual(0f, t.Wind(t.softStart - 1), 1e-5f);
            Assert.AreEqual(0.5f, t.Wind(t.softStart + t.windRamp * 0.5f), 1e-4f);
            Assert.AreEqual(1f, t.Wind(t.softStart + t.windRamp * 3f), 1e-5f);
            Assert.AreEqual(4f, t.PushAt(t.softStart + 1e-3f), 0.01f, "一起风就是 4 m/s 起步（同 Three.js）");
        }

        [Test]
        public void HoldDepthMatchesScaleTable()
        {
            var t = SoftBoundaryTuning.Default;
            Assert.AreEqual(t.softStart + 14f * 3.5f / 18f, t.HoldDepth(7.5f), 1e-3f, "走路 7.5 m/s 顶到 +2.7 m");
            Assert.AreEqual(t.softStart + 14f, t.HoldDepth(22f), 1e-3f, "冲刺 22 m/s 顶到 +14 m");
            Assert.IsTrue(float.IsPositiveInfinity(t.HoldDepth(23f)), "比风力满还快就顶得出去（只有技能位移），由兜底环管");
            Assert.Greater(t.failsafe, t.HoldDepth(22f) + 6f, "兜底环远在冲刺能顶到的地方之外");
        }

        [Test]
        public void WhiteoutLeadsThePush()
        {
            var t = SoftBoundaryTuning.Default;
            Assert.AreEqual(0f, t.Whiteout(t.softStart - t.hazeLead - 1), 1e-5f);
            Assert.Greater(t.Whiteout(t.softStart), 0.2f, "起风线上已经起雾");
            Assert.AreEqual(1f, t.Whiteout(t.softStart + t.windRamp * 0.6f), 1e-4f);
            float prev = -1;
            for (float d = -10; d < 20; d += 0.5f)
            {
                float w = t.Whiteout(d);
                Assert.GreaterOrEqual(w, prev - 1e-6f, "白化随距离单调");
                prev = w;
            }
        }

        /// <summary>沿梯度一维模拟：走路一直往外顶停在 HoldDepth；按冲刺节奏（22 m/s × 0.18 s，1.6 s 充能）往外冲也过不了 +14 m</summary>
        [Test]
        public void WalkingAndDashingAgainstTheWind()
        {
            var t = SoftBoundaryTuning.Default;
            const float dt = 1f / 60f;
            float d = -5;
            for (float time = 0; time < 10; time += dt) d += (7.5f - t.PushAt(d)) * dt;
            Assert.AreEqual(t.HoldDepth(7.5f), d, 0.25f, "走路的平衡位置");

            var m = MotorTuning.Default;
            d = -5;
            float maxD = d, cool = 0, dash = 0;
            for (float time = 0; time < 20; time += dt)
            {
                cool -= dt;
                if (cool <= 0)
                {
                    cool = m.dashCooldown;
                    dash = m.dashTime;
                }
                float v = dash > 0 ? m.dashSpeed : m.walkSpeed;
                dash -= dt;
                d += (v - t.PushAt(d)) * dt;
                maxD = Mathf.Max(maxD, d);
            }
            Assert.Less(maxD, t.softStart + t.windRamp, "连续冲刺过不了风力满的地方");
            Assert.Less(maxD, t.failsafe, "摸不到兜底环");
        }

        // ───────────── 距离场 ─────────────

        /// <summary>圆心 (0, 0)、半径 50 m 的可玩区：d = |p| − 50，范围 ±100 m、纹素 2 m</summary>
        static BoundaryField Circle()
        {
            const int n = 101;
            var data = new float[n * n];
            for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++)
                data[j * n + i] = new Vector2(-100 + i * 2, -100 + j * 2).magnitude - 50;
            return new BoundaryField(data, n, n, new Vector2(-100, -100), 2);
        }

        [Test]
        public void FieldSamplesSignedDistance()
        {
            var f = Circle();
            Assert.AreEqual(-50f, f.Sample(0, 0), 0.05f, "圆心在界内 50 m");
            Assert.AreEqual(10f, f.Sample(60, 0), 0.05f);
            Assert.AreEqual(-10f, f.Sample(0, -40), 0.05f);
            Assert.AreEqual(10f, f.Sample(51.96f, 30f), 0.2f, "纹素之间双线性");
            Assert.AreEqual(100f, f.Sample(150, 0), 0.05f, "范围外按边上的值 + 到范围的距离外推");
            Assert.AreEqual(new Rect(-100, -100, 200, 200), f.Area);
        }

        [Test]
        public void FieldGradientPointsOutward()
        {
            var f = Circle();
            var o = f.Outward(60, 0);
            Assert.AreEqual(1f, o.x, 0.02f);
            Assert.AreEqual(0f, o.y, 0.02f);
            var i = f.Inward(0, -70);
            Assert.AreEqual(0f, i.x, 0.02f);
            Assert.AreEqual(1f, i.y, 0.02f, "南边界外往北推");
            var p = f.MoveToDistance(10, 0, 0);
            Assert.AreEqual(50f, p.x, 0.1f, "沿梯度走到等值线");
            Assert.AreEqual(0f, f.Sample(p.x, p.y), 0.1f);
            var q = f.MoveToDistance(60, 0, -3);
            Assert.AreEqual(-3f, f.Sample(q.x, q.y), 0.1f, "拴绳的回拉点");
        }

        // ───────────── 拴绳 ─────────────

        /// <summary>直线边界 x = 0（界外 +x）：d = x，范围 ±60 m、纹素 2 m</summary>
        static BoundaryField Straight()
        {
            const int n = 61;
            var data = new float[n * n];
            for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++)
                data[j * n + i] = -60 + i * 2;
            return new BoundaryField(data, n, n, new Vector2(-60, -60), 2);
        }

        /// <summary>界内平地 y 0；界外是抬高的沙海：8 m 内缓缓抬到 12 m（同 1-1：+3 m 沙海 + 大沙丘）</summary>
        static float Dune(float x)
        {
            float u = Mathf.Clamp01(x / 8f);
            return 12f * u * u * (3 - 2 * u);
        }

        /// <summary>导航网格贴着地面、只铺到 navInset：near 的 radius 球内最近的网格点（沿 x 逐 5 cm 找）</summary>
        static BoundaryTether.NavSample DuneNav(float navInset) => (Vector3 near, float radius, out Vector3 hit) =>
        {
            hit = near;
            float best = radius;
            bool found = false;
            for (float x = near.x - radius; x <= near.x + radius; x += 0.05f)
            {
                if (x > navInset) break;
                var q = new Vector3(x, Dune(x), near.z);
                float d = Vector3.Distance(q, near);
                if (d > best) continue;
                best = d;
                hit = q;
                found = true;
            }
            return found;
        };

        /// <summary>
        /// 1-1 回归：跳鼠被放到界外 +10 m 的沙丘上（比界内高 12 m）。旧拴绳按敌人自己的高度在界内上空采样（8 m 球、再抬 6 m 采 14 m 球）整片落空，
        /// 每 0.25 s 重试都失败 → 永远拴不回；现在先找回拉点那里的地面，在地面附近找网格
        /// </summary>
        [Test]
        public void TetherSamplesNavAtTheGroundInsideNotAtTheDuneHeight()
        {
            var f = Straight();
            var t = SoftBoundaryTuning.Default;
            var nav = DuneNav(t.navInset);
            BoundaryTether.GroundProbe ground = (float x, float z, out float y) =>
            {
                y = Dune(x);
                return true;
            };
            var from = new Vector3(t.navInset + t.tetherSlack + 6f, 0, 3);
            from.y = Dune(from.x);
            var back = f.MoveToDistance(from.x, from.z, t.navInset - 3f);
            Assert.IsFalse(nav(new Vector3(back.x, from.y, back.y), 8f, out _), "旧做法：按沙丘高度在界内上空采 8 m 球，落空");
            Assert.IsFalse(nav(new Vector3(back.x, from.y + 6f, back.y), 14f, out _), "旧做法的第二次（抬 6 m、14 m 球）也落空");

            Assert.IsTrue(BoundaryTether.FindPoint(f, t, from, ground, nav, false, default, out var to), "按地面高度找得到");
            Assert.LessOrEqual(f.Sample(to.x, to.z), t.navInset, "拴回导航边缘以内");
            Assert.AreEqual(t.navInset - 3f, f.Sample(to.x, to.z), 0.1f, "就在回拉点（导航边缘内 3 m）");
            Assert.AreEqual(Dune(to.x), to.y, 0.05f, "落在地面上");
        }

        [Test]
        public void TetherFallsBackToTheLastNavPointAndGivesUpCleanly()
        {
            var f = Straight();
            var t = SoftBoundaryTuning.Default;
            var nav = DuneNav(t.navInset);
            var from = new Vector3(10, Dune(10), 3);
            // 没有地面探测（按敌人高度都找不到）：退回最后站过的导航点
            var last = new Vector3(-6, 0, 3);
            Assert.IsTrue(BoundaryTether.FindPoint(f, t, from, null, nav, true, last, out var to));
            Assert.AreEqual(last.x, to.x, 0.06f, "退回离网之前的位置");
            Assert.AreEqual(last.y, to.y, 0.05f);
            // 最后站过的点附近 4 m 也没有网格（被冲锋带上了沙丘）：不动，下次再试
            Assert.IsFalse(BoundaryTether.FindPoint(f, t, from, null, nav, true, new Vector3(6, Dune(6), 3), out to));
            Assert.AreEqual(from, to, "找不到时不动，下次再试");
            // 退回点附近找到的网格点在风里（离等值线超过 navInset + tetherSlack）也不用
            BoundaryTether.NavSample windy = (Vector3 near, float radius, out Vector3 hit) =>
            {
                hit = new Vector3(t.navInset + t.tetherSlack + 0.5f, 0, near.z);
                return true;
            };
            Assert.IsFalse(BoundaryTether.FindPoint(f, t, from, null, windy, true, last, out to), "落点必须在界内");
            // 附近根本没有导航网格
            BoundaryTether.NavSample none = (Vector3 near, float radius, out Vector3 hit) =>
            {
                hit = near;
                return false;
            };
            Assert.IsFalse(BoundaryTether.FindPoint(f, t, from, (float x, float z, out float y) => { y = 0; return true; }, none, true, last, out to));
            Assert.AreEqual(from, to);
        }

        // ───────────── 区域风暴 ─────────────

        static WeatherDirector.Region Storm() => new()
        {
            center = Vector3.zero, radius = 30, fade = 20, calm = 10, warn = 5, storm = 10, abate = 5, firstDelay = 3, armRadius = 80,
        };

        [Test]
        public void StormCycleArmsOnApproachAndLoops()
        {
            var r = Storm();
            r.Tick(5, new Vector3(200, 0, 0));
            Assert.AreEqual(StormPhase.Idle, r.phase, "没走近不计时");
            r.Tick(0.01f, new Vector3(70, 0, 0));
            Assert.AreEqual(StormPhase.Calm, r.phase);
            r.Tick(3f, Vector3.zero);
            Assert.AreEqual(StormPhase.Warning, r.phase, "走近 firstDelay 秒后第一次预警");
            r.Tick(2.5f, Vector3.zero);
            Assert.LessOrEqual(r.Intensity, 0.12f, "预警期只有薄尘");
            Assert.AreEqual(0.5f, r.Warning01, 0.02f);
            r.Tick(2.5f + 2.6f, Vector3.zero);
            Assert.AreEqual(StormPhase.Storm, r.phase);
            Assert.AreEqual(1f, r.Intensity, 1e-3f, "风暴 2.5 s 涨满");
            r.Tick(7.4f + 2.5f, Vector3.zero);
            Assert.AreEqual(StormPhase.Abating, r.phase);
            Assert.AreEqual(0.5f, r.Intensity, 0.02f);
            r.Tick(2.5f + 1f, Vector3.zero);
            Assert.AreEqual(StormPhase.Calm, r.phase, "循环回平静");
            Assert.AreEqual(0f, r.Intensity, 1e-5f);
        }

        [Test]
        public void StormWeightFadesWithDistance()
        {
            var r = Storm();
            r.Force(StormPhase.Storm, 5);
            Assert.AreEqual(1f, r.At(new Vector3(10, 5, 10)), 1e-4f, "半径内满强度（只看水平距离）");
            Assert.AreEqual(0.5f, r.At(new Vector3(40, 0, 0)), 0.01f, "淡出带中间一半");
            Assert.AreEqual(0f, r.At(new Vector3(51, 0, 0)), 1e-4f);
        }

        [Test]
        public void SandstormProfileCutsVisibilityTo25m()
        {
            var p = WeatherProfiles.Get(WeatherProfiles.Sandstorm);
            Assert.NotNull(p);
            Assert.AreEqual(25f, p.visibility, 1e-4f, "unity-maps-v1 1-1 ④：可见度降到 25 m");
            Assert.LessOrEqual(p.fogEnd, 40f);
            foreach (var theme in new[] { "Desert", "Frost", "Inferno" })
                Assert.NotNull(WeatherProfiles.Get(WeatherProfiles.WhiteoutFor(theme)), $"{theme} 的白化");
            var b = new WeatherState { fogColor = Color.white, fogStart = 40, fogEnd = 260, sunMult = 1, sunTint = Color.white, wind = 0.25f };
            var half = WeatherState.Lerp(b, p, 0.5f);
            Assert.AreEqual((260 + p.fogEnd) * 0.5f, half.fogEnd, 1e-3f);
            Assert.AreEqual((1 + p.sunMult) * 0.5f, half.sunMult, 1e-4f);
            var full = WeatherState.Lerp(b, p, 1);
            Assert.AreEqual(p.fogEnd, full.fogEnd, 1e-4f);
            Assert.AreEqual(1f, full.wind, 1e-4f);
            Assert.AreEqual(b.fogEnd, WeatherState.Lerp(b, p, 0).fogEnd, 1e-5f, "强度 0 不变");
        }

        // ───────────── 冰面（L8） ─────────────

        /// <summary>平地逐帧模拟（同 MotorTests）：可选地表，返回从速度 v0 不给输入滑到停下的距离</summary>
        static float Slide(float v0, SurfaceProfile? surface, float fps = 60)
        {
            var core = new MotorCore { t = MotorTuning.Default };
            core.ResetMotion(true);
            core.Launch(new Vector3(v0, 0, 0));
            float dt = 1f / fps, x = 0;
            for (float time = 0; time < 10; time += dt)
            {
                var f = MotorFrame.Neutral(core.t);
                f.grounded = core.grounded;
                if (surface.HasValue) SurfaceZone.Apply(ref f, surface.Value);
                f.Sanitize(core.t);
                var r = core.Step(new MotorInput { facing = Vector3.right }, f, dt);
                x += r.delta.x;
                core.AfterMove(new MotorFeedback { touching = true, groundNormal = Vector3.up, intended = r.delta, actual = new Vector3(r.delta.x, 0, r.delta.z) }, dt, out _);
                if (Mathf.Abs(core.velocity.x) < 1e-3f) break;
            }
            return x;
        }

        /// <summary>从静止按住前进，多久到 90% 走路速度</summary>
        static float TimeTo90(SurfaceProfile? surface)
        {
            var core = new MotorCore { t = MotorTuning.Default };
            core.ResetMotion(true);
            const float dt = 1f / 60f;
            for (float time = 0; time < 10; time += dt)
            {
                var f = MotorFrame.Neutral(core.t);
                f.grounded = core.grounded;
                if (surface.HasValue) SurfaceZone.Apply(ref f, surface.Value);
                f.Sanitize(core.t);
                var r = core.Step(new MotorInput { wish = Vector3.right, facing = Vector3.right }, f, dt);
                core.AfterMove(new MotorFeedback { touching = true, groundNormal = Vector3.up, intended = r.delta, actual = new Vector3(r.delta.x, 0, r.delta.z) }, dt, out _);
                if (core.velocity.x >= core.t.walkSpeed * 0.9f) return time + dt;
            }
            return float.PositiveInfinity;
        }

        [Test]
        public void IceDashSlidesFurther()
        {
            var t = MotorTuning.Default;
            float exit = t.dashSpeed * t.dashExitKeep;
            float normal = Slide(exit, null), ice = Slide(exit, SurfaceProfile.Ice);
            Assert.AreEqual(exit * exit / (2 * t.groundFriction), normal, 0.08f, "平地：冲刺余速 9.9 m/s 滑 0.82 m（尺度表）");
            Assert.AreEqual(exit * exit / (2 * t.groundFriction * SurfaceProfile.Ice.friction), ice, 0.4f, "冰面：刹车 ×0.1，滑约 8 m");
            Assert.Greater(ice, normal * 6, "冲刺在冰上滑得远得多");
            foreach (var fps in new[] { 30f, 144f })
                Assert.AreEqual(ice, Slide(exit, SurfaceProfile.Ice, fps), 0.25f, $"{fps} fps 冰面滑行距离一致");
            float frost = Slide(exit, SurfaceProfile.Frost);
            Assert.Greater(frost, normal * 3);
            Assert.Less(frost, ice, "冻带比冰面稍好走");
        }

        [Test]
        public void IceAccelerationIsSlow()
        {
            float normal = TimeTo90(null), ice = TimeTo90(SurfaceProfile.Ice);
            Assert.Less(normal, 0.15f, "平地 0.1 s 跑起来");
            Assert.Greater(ice, normal * 4, "冰面起步拖");
            Assert.Less(ice, 1.2f, "也不至于原地打转");
        }

        [Test]
        public void TractionDefaultsToOne()
        {
            Assert.AreEqual(1f, MotorFrame.Traction(0), "没设的牵引按 1");
            Assert.AreEqual(1f, MotorFrame.Traction(float.NaN));
            Assert.AreEqual(0.02f, MotorFrame.Traction(0.001f), 1e-6f, "不让地面完全失控");
            var f = default(MotorFrame);
            SurfaceZone.Apply(ref f, SurfaceProfile.Ice);
            Assert.AreEqual(SurfaceProfile.Ice.accel, f.groundAccelMult, 1e-5f, "没设过的帧按 1 再乘");
            var half = SurfaceProfile.Ice.Scaled(0.5f);
            Assert.AreEqual((1 + SurfaceProfile.Ice.accel) * 0.5f, half.accel, 1e-5f, "淡出一半");
            Assert.AreEqual(SurfaceProfile.Ice.stumble * 0.5f, half.stumble, 1e-5f);
        }

        [Test]
        public void ZoneAreaShapes()
        {
            var go = new GameObject("Zone");
            try
            {
                var t = go.transform;
                t.SetPositionAndRotation(new Vector3(10, 0.03f, 0), Quaternion.Euler(0, 90, 0));
                t.localScale = new Vector3(24, 0.06f, 6); // 测试场的条带：转了 90° 后沿世界 Z 24 m、沿 X 宽 6 m
                var box = ZoneArea.Box();
                Assert.AreEqual(0.06f, box.Top(t), 1e-4f, "单位立方体顶面");
                Assert.IsTrue(box.Contains(t, new Vector3(10, 0.06f, 11)), "沿长边 11 m 在里面");
                Assert.IsFalse(box.Contains(t, new Vector3(14, 0.06f, 0)), "沿短边 4 m 在外面");
                Assert.IsFalse(box.Contains(t, new Vector3(10, 2f, 0)), "跳起来 2 m 不算");
                var disc = ZoneArea.Disc(3);
                Assert.IsTrue(disc.Contains(t, new Vector3(12, 0.03f, 0)));
                Assert.AreEqual(1f / 3f, disc.Horizontal(t, new Vector3(12, 0, 0)), 1e-4f);
                Assert.AreEqual(-1f, disc.Horizontal(t, new Vector3(14, 0, 0)));
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        // ───────────── 流沙、水 ─────────────

        [Test]
        public void QuicksandTrapsWalkersButNotDashers()
        {
            var go = new GameObject("Quicksand");
            try
            {
                var q = go.AddComponent<Quicksand>();
                var m = MotorTuning.Default;
                Assert.AreEqual(q.pullEdge, q.PullAt(1), 1e-5f);
                Assert.AreEqual(q.pullCore, q.PullAt(0), 1e-5f);
                Assert.AreEqual(0f, q.PullAt(1.2f), 1e-5f, "圈外不拉");
                Assert.AreEqual(q.slowCore, q.SlowAt(q.coreRadius / q.radius * 0.5f), 1e-5f, "芯里最慢");
                Assert.AreEqual(q.slowEdge, q.SlowAt(1), 1e-5f);
                float atCore = q.coreRadius / q.radius;
                Assert.Less(m.walkSpeed * q.SlowAt(atCore), q.PullAt(atCore), "芯边上走路也走不过拉力：只能冲刺");
                Assert.Greater(m.walkSpeed * q.SlowAt(1), q.PullAt(1) + 2, "刚踩进边上能走出来");
                Assert.Greater((m.dashSpeed - q.pullCore) * m.dashTime, q.coreRadius, "一次冲刺能从圆心冲出芯");
                Assert.IsTrue(q.Contains(new Vector3(3, 0.2f, 0)));
                Assert.IsTrue(q.InCore(new Vector3(1, 0, 1)));
                Assert.IsFalse(q.InCore(new Vector3(4, 0, 0)));
                Assert.IsFalse(q.Contains(new Vector3(7, 0, 0)));
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void WadingSlowsWithDepth()
        {
            var go = new GameObject("Water");
            try
            {
                go.transform.position = new Vector3(0, 0.45f, 0);
                go.transform.localScale = new Vector3(10, 0.9f, 10); // 水底 y 0、水面 0.9
                var w = go.AddComponent<WaterVolume>();
                Assert.AreEqual(0.9f, w.Surface, 1e-4f);
                Assert.AreEqual(0.9f, w.DepthAt(new Vector3(1, 0, 1)), 1e-4f, "站在水底：水深 0.9 m");
                Assert.AreEqual(0f, w.DepthAt(new Vector3(1, 1.5f, 1)), 1e-5f, "水面之上");
                Assert.AreEqual(0f, w.DepthAt(new Vector3(6, 0, 0)), 1e-5f, "范围外");
                Assert.AreEqual(1f, w.SlowAt(0.1f), 1e-5f, "脚背深不减速");
                Assert.AreEqual(w.wadeSlow, w.SlowAt(w.deep), 1e-4f);
                Assert.Less(w.SlowAt(0.9f), 0.8f, "齐腰深明显变慢");
                Assert.Greater(w.SlowAt(0.9f), w.wadeSlow);
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }
    }
}
