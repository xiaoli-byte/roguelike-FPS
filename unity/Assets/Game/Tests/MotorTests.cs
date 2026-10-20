using NUnit.Framework;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// H1 运动规则（<see cref="MotorCore"/>，纯 C#）：在平地世界里逐帧模拟，断言关卡尺度表（docs/level-design/unity-maps-v1.md 第 0 节）——
    /// 跳 1.42 m、二段跳 ≈ 2.7 m、冲刺 ≈ 4 m、冲刺跳 ≈ 6 m——并且与帧率无关；外加地面 / 空中手感、冲刺锁定、跳跃打断冲刺、修饰器、突进、抛射。
    /// </summary>
    public sealed class MotorTests
    {
        static readonly float[] Rates = { 30, 60, 144 };

        /// <summary>平地世界：y ≤ 0 即落地；帧初站在地上、离地不超过 0.45 m 时吸附（同 PlayerMotor.SnapDown）</summary>
        sealed class Sim
        {
            public readonly MotorCore core = new();
            public readonly MotorModifierStack mods = new();
            public Vector3 pos;
            public float time;
            public readonly float dt;
            public MotorEvents events;

            public Sim(float fps, int airJumps = 0, int dashCharges = 1)
            {
                dt = 1f / fps;
                var t = MotorTuning.Default;
                t.airJumps = airJumps;
                t.dashCharges = dashCharges;
                core.t = t;
                core.dashCharge = dashCharges;
                core.ResetMotion(true);
            }

            public MotorFrame Frame(in MotorInput input)
            {
                var f = MotorFrame.Neutral(core.t);
                f.grounded = core.grounded;
                f.velocity = core.velocity;
                f.dashing = core.dashing;
                f.jumpHeld = input.jumpHeld;
                f.jumpPressed = input.jumpPressed;
                f.dt = dt;
                mods.Apply(ref f, time);
                f.Sanitize(core.t);
                return f;
            }

            public void Step(MotorInput input)
            {
                if (input.facing == Vector3.zero) input.facing = Vector3.forward;
                var f = Frame(input);
                var r = core.Step(input, f, dt);
                var p = pos + r.delta;
                bool ground = false;
                if (p.y <= 0)
                {
                    p.y = 0;
                    ground = true;
                }
                else if (r.snap && p.y <= 0.45f)
                {
                    p.y = 0;
                    ground = true;
                }
                var fb = new MotorFeedback { touching = ground, groundNormal = Vector3.up, intended = r.delta, actual = p - pos };
                events = r.events | core.AfterMove(fb, dt, out _);
                pos = p;
                time += dt;
            }

            /// <summary>重复 input 直到落地（或 limit 秒）；返回期间最高点</summary>
            public float RunUntilLanded(MotorInput input, float limit = 5f)
            {
                float top = pos.y;
                bool left = false;
                for (float t = 0; t < limit; t += dt)
                {
                    Step(input);
                    input.jumpPressed = input.dashPressed = false;
                    top = Mathf.Max(top, pos.y);
                    if (!core.grounded) left = true;
                    else if (left) break;
                }
                return top;
            }

            public void Idle(float seconds, MotorInput input = default)
            {
                for (float t = 0; t < seconds - 1e-5f; t += dt) Step(input);
            }
        }

        static MotorInput Hold(Vector3 wish) => new() { wish = wish, facing = Vector3.forward };

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;

        // ───────────── 尺度表 ─────────────

        [Test]
        public void JumpHeightIs142mAtAnyFrameRate()
        {
            float expect = 8.6f * 8.6f / (2 * 26f);
            foreach (var fps in Rates)
            {
                var s = new Sim(fps);
                float top = s.RunUntilLanded(new MotorInput { jumpPressed = true });
                Assert.AreEqual(expect, top, 0.01f, $"{fps} fps 跳跃高度");
                Assert.AreEqual(1.42f, top, 0.01f, "尺度表：跳 1.42 m");
            }
        }

        [Test]
        public void DoubleJumpReachesAbout27m()
        {
            foreach (var fps in Rates)
            {
                var s = new Sim(fps, airJumps: 1);
                s.Step(new MotorInput { jumpPressed = true });
                // 升到最高点再跳
                while (s.core.velocity.y > 0) s.Step(default);
                float top = s.RunUntilLanded(new MotorInput { jumpPressed = true });
                float expect = 8.6f * 8.6f / 52f + 8.6f * 0.94f * 8.6f * 0.94f / 52f;
                Assert.AreEqual(expect, top, 0.03f, $"{fps} fps 二段跳总高");
                Assert.AreEqual(2.7f, top, 0.05f, "尺度表：二段跳约 2.7 m");
            }
        }

        [Test]
        public void NoAirJumpWithoutExtraJumps()
        {
            var s = new Sim(60);
            s.Step(new MotorInput { jumpPressed = true });
            while (s.core.velocity.y > 0) s.Step(default);
            float top = s.RunUntilLanded(new MotorInput { jumpPressed = true });
            Assert.Less(top, 1.43f, "没有额外跳跃时空中按跳不起作用");
        }

        [Test]
        public void DashCovers396mAtAnyFrameRate()
        {
            foreach (var fps in Rates)
            {
                var s = new Sim(fps);
                s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
                Assert.IsTrue((s.events & MotorEvents.Dashed) != 0);
                while (s.core.dashing) s.Step(default);
                // 结束那一帧剩下的时间按出口速度 9.9 m/s 起步、照常刹车（60 m/s²）：扣掉它就是冲刺本身的位移
                float exitPart = s.time - 0.18f;
                float dashDist = s.pos.z - (9.9f * exitPart - 30f * exitPart * exitPart);
                Assert.AreEqual(22f * 0.18f, dashDist, 0.01f, $"{fps} fps 冲刺位移");
                Assert.AreEqual(22f * 0.45f - 60f * exitPart, Flat(s.core.velocity), 0.01f, "结束保留 45% 速度");
                Assert.AreEqual(0f, s.pos.y, 1e-4f, "地面冲刺贴地");
                // 松手：地面刹车 60 m/s² → 再滑 9.9² / 120 ≈ 0.82 m
                s.Idle(0.5f);
                Assert.AreEqual(3.96f + 9.9f * 9.9f / 120f, s.pos.z, 0.06f, "冲刺 + 刹车总位移");
            }
        }

        [Test]
        public void DashJumpFromStandstillCoversAbout6m()
        {
            foreach (var fps in Rates)
            {
                // 原地、按住前进，同一帧冲刺 + 跳：跳跃打断冲刺、带着 9.9 m/s 起跳，空中只按 3 m/s² 回落
                var s = new Sim(fps);
                s.RunUntilLanded(new MotorInput { wish = Vector3.forward, dashPressed = true, jumpPressed = true, facing = Vector3.forward });
                Assert.AreEqual(5.9f, s.pos.z, 0.25f, $"{fps} fps 冲刺跳距离（尺度表：约 6 m）");
            }
        }

        [Test]
        public void RunningJumpCoversAbout5m()
        {
            var s = new Sim(60);
            s.Idle(0.5f, Hold(Vector3.forward));
            Assert.AreEqual(7.5f, Flat(s.core.velocity), 1e-3f);
            float z0 = s.pos.z;
            s.RunUntilLanded(new MotorInput { wish = Vector3.forward, jumpPressed = true });
            Assert.AreEqual(7.5f * 2 * 8.6f / 26f, s.pos.z - z0, 0.2f, "助跑跳 ≈ 4.96 m（尺度表按 3.5 m 留余量）");
        }

        [Test]
        public void ApexDashCarriesMomentumThroughTheAir()
        {
            var s = new Sim(60);
            s.Step(new MotorInput { jumpPressed = true });
            while (s.core.velocity.y > 0) s.Step(default);
            s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            while (s.core.dashing) s.Step(default);
            Assert.Greater(s.pos.y, 1.3f, "冲刺期间不下坠");
            // 不按方向：空中阻力 1.2 m/s²，0.3 s 后仍有 ≈ 9.5 m/s（以前空中刹车 21 m/s² 会把它吃掉）
            for (int i = 0; i < 18; i++) s.Step(default);
            Assert.Greater(Flat(s.core.velocity), 9.4f);
            // 按住前进：超速只按 3 m/s² 回落
            var s2 = new Sim(60);
            s2.Step(new MotorInput { jumpPressed = true });
            while (s2.core.velocity.y > 0) s2.Step(default);
            s2.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            while (s2.core.dashing) s2.Step(Hold(Vector3.forward));
            for (int i = 0; i < 18; i++) s2.Step(Hold(Vector3.forward));
            Assert.AreEqual(9.9f - 3f * 0.3f, Flat(s2.core.velocity), 0.1f);
        }

        [Test]
        public void DashCannotGainHeight()
        {
            var s = new Sim(60);
            float top = s.RunUntilLanded(new MotorInput { jumpPressed = true, dashPressed = true, facing = Vector3.forward });
            Assert.LessOrEqual(top, 1.43f, "跳 + 冲刺最高仍是 1.42 m：2.5 m 以上的台子必须给坡道 / 二段跳");
            var s2 = new Sim(60);
            s2.Step(new MotorInput { jumpPressed = true });
            float top2 = s2.RunUntilLanded(new MotorInput { dashPressed = true, facing = Vector3.forward });
            Assert.LessOrEqual(top2, 1.43f);
        }

        // ───────────── 手感 ─────────────

        [Test]
        public void GroundAccelerationAndFrictionAreSnappy()
        {
            var s = new Sim(60);
            s.Idle(7.5f / 78f + 0.02f, Hold(Vector3.forward));
            Assert.AreEqual(7.5f, Flat(s.core.velocity), 1e-3f, "地面 0.1 s 内到满速");
            s.Idle(7.5f / 60f + 0.02f);
            Assert.AreEqual(0f, Flat(s.core.velocity), 1e-3f, "松手 0.13 s 内停住");
        }

        [Test]
        public void GroundOverspeedDecaysAt24()
        {
            var s = new Sim(60);
            s.core.velocity = new Vector3(0, 0, 9.9f);
            s.Idle(0.05f, Hold(Vector3.forward));
            Assert.AreEqual(9.9f - 24f * 0.05f, Flat(s.core.velocity), 0.05f);
            s.Idle(0.2f, Hold(Vector3.forward));
            Assert.AreEqual(7.5f, Flat(s.core.velocity), 1e-3f);
        }

        [Test]
        public void AirJumpRedirectsTowardInput()
        {
            var s = new Sim(60, airJumps: 1);
            s.Idle(0.3f, Hold(Vector3.forward));
            s.Step(new MotorInput { wish = Vector3.forward, jumpPressed = true });
            for (int i = 0; i < 10; i++) s.Step(Hold(Vector3.forward));
            var before = s.core.velocity;
            s.Step(new MotorInput { wish = Vector3.right, jumpPressed = true });
            Assert.IsTrue((s.events & MotorEvents.AirJumped) != 0);
            float sp = Mathf.Max(7.5f, Flat(before) * 0.9f);
            Assert.AreEqual(Mathf.Lerp(before.x, sp, 0.65f), s.core.velocity.x, 0.4f, "向右转 65%");
            Assert.Less(s.core.velocity.z, before.z * 0.45f, "原方向的速度大半转走");
            Assert.AreEqual(8.6f * 0.94f - 26f * s.dt, s.core.velocity.y, 1e-3f);
        }

        [Test]
        public void CoyoteTimeAndJumpBuffer()
        {
            // 土狼时间：离地 0.08 s 内仍能地面起跳
            var s = new Sim(60);
            s.pos.y = 0.6f; // 走出台边（吸附不到）
            s.core.ResetMotion(true);
            s.Step(default);
            Assert.IsFalse(s.core.grounded);
            for (int i = 0; i < 3; i++) s.Step(default);
            s.Step(new MotorInput { jumpPressed = true });
            Assert.IsTrue((s.events & MotorEvents.Jumped) != 0, "土狼时间内起跳");
            // 跳跃缓冲：落地前 0.1 s 按下，落地那一刻起跳
            var b = new Sim(60);
            b.Step(new MotorInput { jumpPressed = true });
            while (b.pos.y > 0.25f || b.core.velocity.y > 0) b.Step(default);
            b.Step(new MotorInput { jumpPressed = true });
            bool jumped = false;
            for (int i = 0; i < 12 && !jumped; i++)
            {
                b.Step(default);
                jumped = (b.events & MotorEvents.Jumped) != 0;
            }
            Assert.IsTrue(jumped, "缓冲的跳在落地后触发");
        }

        [Test]
        public void JumpCancelsDashAndKeepsExitSpeed()
        {
            var s = new Sim(60);
            s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            s.Step(default);
            Assert.IsTrue(s.core.dashing);
            s.Step(new MotorInput { jumpPressed = true });
            Assert.IsFalse(s.core.dashing);
            Assert.IsTrue((s.events & MotorEvents.DashEnded) != 0 && (s.events & MotorEvents.Jumped) != 0);
            Assert.AreEqual(9.9f, Flat(s.core.velocity), 0.01f);
            Assert.Greater(s.core.velocity.y, 8f);
        }

        [Test]
        public void DashLockoutBlocksImmediateRedash()
        {
            var s = new Sim(60, dashCharges: 2);
            s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            while (s.core.dashing) s.Step(default);
            s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            Assert.IsFalse(s.core.dashing, "冲刺结束后 0.06 s 内不能再冲");
            s.Idle(0.06f);
            s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            Assert.IsTrue(s.core.dashing, "锁定过后用第二格充能");
        }

        [Test]
        public void DashChargeRechargesOverCooldown()
        {
            var s = new Sim(60);
            s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            Assert.Less(s.core.dashCharge, 0.1f);
            s.Idle(1.6f);
            Assert.GreaterOrEqual(s.core.dashCharge, 1f - 1e-3f);
        }

        // ───────────── 修饰器 / API ─────────────

        [Test]
        public void SpeedModifiersMultiplyAndDispose()
        {
            var s = new Sim(60);
            var a = s.mods.Add(MotorMods.Speed(0.5f));
            var b = s.mods.Add(MotorMods.Speed(() => 0.8f));
            s.Idle(0.5f, Hold(Vector3.forward));
            Assert.AreEqual(7.5f * 0.4f, Flat(s.core.velocity), 1e-3f);
            a.Dispose();
            a.Dispose();
            s.Idle(0.5f, Hold(Vector3.forward));
            Assert.AreEqual(7.5f * 0.8f, Flat(s.core.velocity), 1e-3f);
            b.Dispose();
            Assert.AreEqual(0, s.mods.Count);
        }

        [Test]
        public void TimedModifierExpires()
        {
            var s = new Sim(60);
            s.mods.Add(MotorMods.Lock(MotorLock.Jump), 0, 0.2f);
            s.Step(new MotorInput { jumpPressed = true });
            Assert.IsTrue(s.core.grounded, "锁住跳跃");
            s.Idle(0.25f);
            Assert.AreEqual(0, s.mods.Count, "到期自动撤销");
            s.Step(new MotorInput { jumpPressed = true });
            Assert.IsTrue((s.events & MotorEvents.Jumped) != 0);
        }

        [Test]
        public void GlideStyleModifierCapsFallSpeed()
        {
            var s = new Sim(60);
            s.pos.y = 30;
            s.core.ResetMotion(false);
            s.Idle(1f);
            Assert.Less(s.core.velocity.y, -20f);
            s.mods.Add(MotorMods.From((ref MotorFrame f) =>
            {
                if (f.grounded || f.velocity.y >= 0 || !f.jumpHeld) return;
                f.gravityScale *= 0.3f;
                f.maxFallSpeed = 2.4f;
                f.fallBrake = 9f;
                f.airAccel = 26f;
            }));
            s.Idle(1f, new MotorInput { jumpHeld = true });
            Assert.AreEqual(-2.4f, s.core.velocity.y, 0.05f, "开伞后平滑刹到 2.4 m/s");
        }

        [Test]
        public void ThrowingModifierExceptionsDoesNotBreakTheStack()
        {
            var s = new Sim(60);
            s.mods.Add(MotorMods.From((ref MotorFrame f) => throw new System.InvalidOperationException("测试")));
            s.mods.Add(MotorMods.Speed(0.5f));
            UnityEngine.TestTools.LogAssert.Expect(LogType.Exception, new System.Text.RegularExpressions.Regex("测试"));
            s.Idle(0.5f, Hold(Vector3.forward));
            Assert.AreEqual(3.75f, Flat(s.core.velocity), 1e-3f);
        }

        [Test]
        public void HardLungeMovesExactDistanceAndHovers()
        {
            var s = new Sim(60);
            s.pos.y = 2;
            s.core.ResetMotion(false);
            Assert.IsTrue(s.core.Lunge(Vector3.forward, 20f, 0.25f, iframes: 0.25f, exitSpeed: 4f));
            Assert.IsTrue(s.core.invuln > 0.2f);
            while (s.core.Lunging) s.Step(new MotorInput { wish = Vector3.right, jumpPressed = true, dashPressed = true });
            Assert.AreEqual(5f, s.pos.z, 0.02f, "20 m/s × 0.25 s");
            Assert.AreEqual(0f, s.pos.x, 1e-4f, "硬突进无视输入");
            Assert.AreEqual(2f, s.pos.y, 1e-4f, "悬停");
            Assert.AreEqual(4f, Flat(s.core.velocity), 1e-3f, "出口速度");
            Assert.IsFalse(s.core.dashing);
        }

        [Test]
        public void LaunchLeavesGroundAndKeepsMomentum()
        {
            var s = new Sim(60);
            s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            s.core.Launch(new Vector3(0, 7, 8));
            Assert.IsFalse(s.core.dashing, "抛射结束冲刺");
            s.Step(default);
            Assert.IsFalse(s.core.grounded, "这一帧不贴地");
            Assert.Greater(s.pos.y, 0.05f);
            s.RunUntilLanded(default);
            Assert.Greater(s.pos.z, 8f * 2 * 7f / 26f * 0.95f, "空中阻力只有 1.2，水平惯性基本保留");
        }

        [Test]
        public void ImpulseUpwardDetachesAndKnockbackSoftensFriction()
        {
            var s = new Sim(60);
            s.core.AddImpulse(new Vector3(6, 0, 0));
            s.Step(default);
            s.Step(default);
            Assert.Greater(Flat(s.core.velocity), 5f, "击退 0.3 s 内地面摩擦降到 12");
            var u = new Sim(60);
            u.core.AddImpulse(new Vector3(0, 4, 0));
            u.Step(default);
            Assert.Greater(u.pos.y, 0.03f, "向上的冲量让角色离地");
        }

        [Test]
        public void InvulnerabilityCountsDown()
        {
            var s = new Sim(60);
            s.Step(new MotorInput { dashPressed = true, facing = Vector3.forward });
            Assert.Greater(s.core.invuln, 0.09f, "冲刺无敌帧");
            s.Idle(0.15f);
            Assert.AreEqual(0f, s.core.invuln, 1e-5f);
        }
    }
}
