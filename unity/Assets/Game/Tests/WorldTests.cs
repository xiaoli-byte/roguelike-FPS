using NUnit.Framework;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 世界系统（docs/unity-parity.md L3）：软边界的推回公式与尺度（走路顶到 +2.7 m、冲刺过不了 +14 m）、有符号距离场采样、区域风暴周期与远近、天气插值。
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
    }
}
