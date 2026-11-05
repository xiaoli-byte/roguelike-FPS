using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 精英出手分量层的姿态弹簧（<see cref="EliteStrike.Spring"/>）：整局机器人 × 4 倍时间、卡顿帧下 dt 很大，
    /// 以前只分 6 步、单步 ω·h 超过 2 发散成 NaN（3-4 run-3-4 里精英铁牛的模型节点被写成 NaN 缩放 / 旋转）。
    /// 现在按 1/60 s 子步进、结果不是有限数就回到目标；正常帧率下和以前逐位一致（手感不变）。
    /// </summary>
    public sealed class EliteStrikeSpringTests
    {
        const float Freq = 7.5f, Zeta = 0.38f;

        /// <summary>修改前的积分（每步 dt / ⌈60·dt⌉，最多 6 步）：dt ≤ 0.1 s 时新旧应完全一样</summary>
        static void OldSpring(ref float x, ref float v, float target, float dt)
        {
            float w = Freq * Mathf.PI * 2f;
            int steps = Mathf.Clamp(Mathf.CeilToInt(dt * 60f), 1, 6);
            float h = dt / steps;
            for (int i = 0; i < steps; i++)
            {
                v += (-2f * Zeta * w * v - w * w * (x - target)) * h;
                x += v * h;
            }
        }

        [Test]
        public void LargeDeltaTimeStaysFinite()
        {
            foreach (float dt in new[] { 0.2f, 0.34f, 0.5f, 1.0f, 1.33f, 4f, 30f })
            foreach (var (x0, target) in new[] { (0.16f, -0.1f), (-0.16f, 0.16f), (16f, -16f), (0f, 8f) })
            {
                float x = x0, v = 0;
                for (int frame = 0; frame < 120; frame++)
                {
                    EliteStrike.Spring(ref x, ref v, frame % 20 < 10 ? target : 0, dt);
                    Assert.IsTrue(float.IsFinite(x) && float.IsFinite(v), $"dt {dt} 第 {frame} 帧出现非有限数：x {x}，v {v}");
                    Assert.LessOrEqual(Mathf.Abs(x), 64f + 1e-3f, $"dt {dt} 第 {frame} 帧越界：x {x}");
                }
            }
        }

        [Test]
        public void LargeDeltaTimeSettlesOnTarget()
        {
            float x = 0.16f, v = 0;
            for (int frame = 0; frame < 10; frame++) EliteStrike.Spring(ref x, ref v, -0.08f, 1.33f);
            Assert.AreEqual(-0.08f, x, 0.01f, "× 4 倍时间下几帧之内停在目标上");
            Assert.AreEqual(0f, v, 0.05f);
        }

        [Test]
        public void NormalFrameRateUnchanged()
        {
            foreach (float dt in new[] { 1f / 144f, 1f / 60f, 1f / 30f, 0.05f, 0.1f })
            {
                float x = 0.16f, v = 0, ox = 0.16f, ov = 0;
                for (int frame = 0; frame < 90; frame++)
                {
                    float target = frame < 30 ? -0.1f : frame < 60 ? 0.12f : 0;
                    EliteStrike.Spring(ref x, ref v, target, dt);
                    OldSpring(ref ox, ref ov, target, dt);
                    Assert.AreEqual(ox, x, 1e-6f, $"dt {dt} 第 {frame} 帧和修改前不一致");
                    Assert.AreEqual(ov, v, 1e-5f);
                }
            }
        }

        [Test]
        public void BadInputIsIgnored()
        {
            float x = 0.1f, v = 0.5f;
            EliteStrike.Spring(ref x, ref v, 0, float.NaN);
            Assert.AreEqual(0.1f, x);
            EliteStrike.Spring(ref x, ref v, 0, 0);
            Assert.AreEqual(0.1f, x);
            float nx = float.NaN, nv = 0;
            EliteStrike.Spring(ref nx, ref nv, -0.05f, 1f / 60f);
            Assert.AreEqual(-0.05f, nx, "位移已经是 NaN：回到目标");
            Assert.AreEqual(0f, nv);
        }
    }
}
