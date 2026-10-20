using System.Linq;
using NUnit.Framework;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 英雄内容（HC1 鼯）：数值与 Three.js 一致（skills/falcon.ts、Heroes.ts、labels.ts 的 HERO_META），
    /// 凌空的滞空增伤只认玩家打出的伤害、滑翔规则（运动修饰器）在平地模拟里把下落速度压到 2.4 m/s、额外跳跃属性真的给出二段跳（≈ 2.7 m），
    /// 雷目·裁决的弹射判定与伤害，被动装卸干净。
    /// </summary>
    public sealed class HeroTests
    {
        // ───────────── 定义 ─────────────

        [Test]
        public void HeroesAreRegisteredInThreeJsOrder()
        {
            var ids = HeroLibrary.All.Select(h => h.id).ToList();
            Assert.AreEqual("fox", ids[0], "燎在最前（缺省英雄）");
            Assert.Contains("falcon", ids);
            Assert.Less(ids.IndexOf("fox"), ids.IndexOf("falcon"));
            foreach (var h in HeroLibrary.All)
            {
                Assert.AreEqual(0, h.unlockCost, $"{h.id}：D8 三人默认全开");
                Assert.IsNotNull(WeaponLibrary.Get(h.startWeapon), $"{h.id} 的初始武器 {h.startWeapon} 没有登记");
                StringAssert.StartsWith("SM_Arms_", h.armR);
                StringAssert.StartsWith("SM_Arms_", h.armL);
            }
        }

        [Test]
        public void FalconNumbersMatchThreeJs()
        {
            var h = HeroLibrary.Get("falcon");
            Assert.IsNotNull(h, "鼯（falcon）没有登记");
            Assert.AreEqual("鼯", h.name);
            Assert.AreEqual("雷鼓机关师", h.title);
            Assert.AreEqual(90f, h.maxHp);
            Assert.AreEqual(70f, h.maxShield);
            Assert.AreEqual(7.5f, h.moveSpeed, "TS base 没写移速 = 基础 7.5");
            CollectionAssert.AreEqual(new[] { (Stat.ExtraJumps, 1f) }, h.baseStats);
            Assert.AreEqual("revolver", h.startWeapon);
            Assert.AreEqual("SM_Arms_FlyingSquirrelR", h.armR);
            Assert.AreEqual("SM_Arms_FlyingSquirrelL", h.armL);
            Assert.AreEqual(Hex.Rgb(0x6fd8ff), h.color);
            Assert.AreEqual(3, h.difficulty);
            CollectionAssert.AreEqual(new[] { "雷殛", "空战", "精准" }, h.tags);

            var q = h.CreatePrimary();
            Assert.IsInstanceOf<FalconHawkVerdict>(q);
            Assert.AreEqual("falcon_hawk_verdict", q.Id);
            Assert.AreEqual(25f, q.cooldown);
            Assert.AreEqual(1, q.maxCharges);
            Assert.AreEqual(8f, ((TimedSkill)q).duration, "雷目·裁决持续 8 s");
            StringAssert.Contains("40%", q.description);
            StringAssert.Contains("55%", q.description);

            var e = h.CreateSecondary();
            Assert.IsInstanceOf<FalconStormBeacon>(e);
            Assert.AreEqual("falcon_storm_beacon", e.Id);
            Assert.AreEqual(10f, e.cooldown);
            Assert.AreEqual(2, e.maxCharges);
            Assert.AreEqual(7f, ThunderBeacon.Radius);
            Assert.AreEqual(5f, ThunderBeacon.Duration);
            Assert.AreEqual(0.5f, ThunderBeacon.Interval);
            Assert.AreEqual(4, ThunderBeacon.Targets);
            Assert.AreEqual(45f, ThunderBeacon.Damage);
            Assert.AreEqual(1.05f, ThunderBeacon.Top);
            Assert.AreEqual(19f, FalconStormBeacon.Speed);
            Assert.AreEqual(3.5f, FalconStormBeacon.Lift);
            Assert.AreEqual(22f, FalconStormBeacon.Gravity);

            var p = h.CreatePassive();
            Assert.AreEqual("凌空", p.Name);
            StringAssert.Contains("15%", p.Description);
        }

        // ───────────── 凌空 ─────────────

        [Test]
        public void AirBonusOnlyForPlayerDamageWhileAirborne()
        {
            foreach (var src in new[] { DamageSource.Weapon, DamageSource.Skill, DamageSource.Explosion, DamageSource.Scroll, DamageSource.Melee })
            {
                var info = DamageInfo.Simple(10, src, Vector3.zero, Vector3.forward);
                Assert.AreEqual(1.15f, FalconSkills.AirMultiplier(true, in info), 1e-6f, $"{src} 在空中 +15%");
                Assert.AreEqual(1f, FalconSkills.AirMultiplier(false, in info), $"{src} 在地上不加");
            }
            var dot = DamageInfo.Simple(10, DamageSource.Status, Vector3.zero, Vector3.forward);
            dot.tags = DamageTag.Dot;
            Assert.AreEqual(1f, FalconSkills.AirMultiplier(true, in dot), "持续伤害跳伤不吃（TS source ≠ status）");
            var tick = DamageInfo.Simple(10, DamageSource.Weapon, Vector3.zero, Vector3.forward);
            tick.tags = DamageTag.Dot;
            Assert.AreEqual(1f, FalconSkills.AirMultiplier(true, in tick), "带持续伤害标签的也不吃");
            foreach (var src in new[] { DamageSource.Pet, DamageSource.Environment, DamageSource.Enemy })
            {
                var info = DamageInfo.Simple(10, src, Vector3.zero, Vector3.forward);
                Assert.AreEqual(1f, FalconSkills.AirMultiplier(true, in info), $"{src} 不是玩家打出的");
            }
        }

        [Test]
        public void SkybornePassiveInstallsAndRemovesCleanly()
        {
            int before = Combat.Outgoing.Count;
            var p = new FalconSkyborne();
            var handle = p.Apply(null);
            Assert.AreEqual(before + 1, Combat.Outgoing.Count, "滞空增伤登记成输出修饰器");
            Assert.IsNull(p.Glider, "没有运动组件时不装滑翔");
            handle.Dispose();
            handle.Dispose();
            Assert.AreEqual(before, Combat.Outgoing.Count, "换英雄时被动撤销干净");
        }

        static MotorFrame Falling(float vy)
        {
            var f = MotorFrame.Neutral(MotorTuning.Default);
            f.velocity = new Vector3(0, vy, 0);
            f.dt = 1 / 60f;
            return f;
        }

        [Test]
        public void GlideRuleNeedsFallingAirborneAndHeldJump()
        {
            var f = Falling(-5);
            Assert.IsTrue(Glide.Apply(ref f, true));
            Assert.AreEqual(0.3f, f.gravityScale, 1e-6f);
            Assert.AreEqual(2.4f, f.maxFallSpeed, 1e-6f);
            Assert.AreEqual(9f, f.fallBrake, 1e-6f);
            Assert.AreEqual(26f, f.airAccel, 1e-6f, "滑翔时空中控制 20 → 26");

            void Rejects(MotorFrame g, string why)
            {
                var before = g;
                Assert.IsFalse(Glide.Apply(ref g, true), why);
                Assert.AreEqual(before.gravityScale, g.gravityScale, why);
                Assert.AreEqual(before.maxFallSpeed, g.maxFallSpeed, why);
            }

            var notHeld = Falling(-5);
            Assert.IsFalse(Glide.Apply(ref notHeld, false), "不按跳跃不滑翔");
            var grounded = Falling(-5);
            grounded.grounded = true;
            Rejects(grounded, "站在地上");
            Rejects(Falling(3), "上升段不滑翔");
            var dashing = Falling(-5);
            dashing.dashing = true;
            Rejects(dashing, "冲刺中");
            var pressed = Falling(-5);
            pressed.jumpPressed = true;
            Rejects(pressed, "这一帧按下跳跃（可能是二段跳）");
            var locked = Falling(-5);
            locked.locks = MotorLock.Jump;
            Rejects(locked, "跳跃被锁");
        }

        /// <summary>平地世界逐帧模拟（同 MotorTests.Sim 的简化版）：y ≤ 0 落地；glide = 按住跳跃时套滑翔规则</summary>
        sealed class Sim
        {
            public readonly MotorCore core = new();
            public float y;
            public float top;
            const float Dt = 1 / 60f;

            public Sim(int airJumps)
            {
                var t = MotorTuning.Default;
                t.airJumps = airJumps;
                core.t = t;
                core.ResetMotion(true);
            }

            public void Step(bool jumpPressed, bool glide)
            {
                var input = new MotorInput { facing = Vector3.forward, jumpPressed = jumpPressed, jumpHeld = jumpPressed || glide };
                var f = MotorFrame.Neutral(core.t);
                f.grounded = core.grounded;
                f.velocity = core.velocity;
                f.dashing = core.dashing;
                f.jumpHeld = input.jumpHeld;
                f.jumpPressed = jumpPressed;
                f.dt = Dt;
                if (glide) Glide.Apply(ref f, true);
                f.Sanitize(core.t);
                var r = core.Step(input, f, Dt);
                float ny = y + r.delta.y;
                bool ground = ny <= 0;
                if (ground) ny = 0;
                core.AfterMove(new MotorFeedback { touching = ground, groundNormal = Vector3.up, intended = r.delta, actual = new Vector3(r.delta.x, ny - y, r.delta.z) },
                    Dt, out _);
                y = ny;
                top = Mathf.Max(top, y);
            }
        }

        [Test]
        public void GlideCapsFallSpeedAndBrakesFastFalls()
        {
            var s = new Sim(0);
            s.Step(true, false);
            float minVy = 0;
            for (int i = 0; i < 300 && (i < 5 || !s.core.grounded); i++)
            {
                s.Step(false, true);
                if (s.core.velocity.y < 0 && i > 40) minVy = Mathf.Min(minVy, s.core.velocity.y);
            }
            Assert.GreaterOrEqual(minVy, -2.4f - 1e-3f, "滑翔下落不超过 2.4 m/s");

            // 高处才开伞：从 20 m/s 的下落平滑刹到 2.4（每秒按 9 趋近），0.6 s 内基本到位
            var fast = new Sim(0);
            fast.y = 50;
            fast.core.ResetMotion(false);
            fast.core.Launch(new Vector3(0, -20, 0));
            float vy = -20;
            for (int i = 0; i < 36; i++)
            {
                fast.Step(false, true);
                Assert.GreaterOrEqual(fast.core.velocity.y, vy - 1e-4f, "开伞后不再叠加重力：下落速度只减不增");
                vy = fast.core.velocity.y;
            }
            Assert.Greater(vy, -2.6f, "0.6 s 后接近滑翔速度");
        }

        [Test]
        public void ExtraJumpStatGivesFalconADoubleJump()
        {
            var falcon = HeroLibrary.Get("falcon");
            var stats = StatSheet.Default();
            foreach (var (stat, value) in falcon.baseStats) stats.SetBase(stat, value);
            int airJumps = Mathf.RoundToInt(stats.Get(Stat.ExtraJumps));
            Assert.AreEqual(1, airJumps, "额外跳跃 1（PlayerVitals 写进 motor.airJumps）");

            float Peak(int jumps)
            {
                var s = new Sim(jumps);
                s.Step(true, false);
                bool second = false;
                for (int i = 0; i < 400; i++)
                {
                    bool press = !second && s.core.velocity.y <= 0;
                    if (press) second = true;
                    s.Step(press, false);
                    if (s.core.grounded) break;
                }
                return s.top;
            }

            Assert.AreEqual(2.68f, Peak(airJumps), 0.1f, "鼯：二段跳 ≈ 2.7 m（尺度表）");
            Assert.AreEqual(1.42f, Peak(0), 0.02f, "没有额外跳跃时空中再按无效");
        }

        // ───────────── 雷目·裁决 ─────────────

        [Test]
        public void HawkVerdictChainsOnlyFromDirectWeaponHits()
        {
            Assert.AreEqual(55f, FalconSkills.ChainDamage(100), 1e-4f);
            Assert.AreEqual(6f, FalconSkills.ChainDamage(4), "至少 6 点");
            var weapon = DamageInfo.Simple(10, DamageSource.Weapon, Vector3.zero, Vector3.forward);
            Assert.IsTrue(FalconSkills.IsWeaponHit(in weapon));
            var blast = DamageInfo.Simple(10, DamageSource.Explosion, Vector3.zero, Vector3.forward);
            Assert.IsFalse(FalconSkills.IsWeaponHit(in blast), "技能 / 反应的爆炸不算");
            blast.tags = DamageTag.Weapon | DamageTag.Explosion;
            Assert.IsTrue(FalconSkills.IsWeaponHit(in blast), "武器投射物的爆炸算");
            var skill = DamageInfo.Simple(10, DamageSource.Skill, Vector3.zero, Vector3.forward);
            Assert.IsFalse(FalconSkills.IsWeaponHit(in skill), "弹射本身是技能伤害：不会再弹");
            var melee = DamageInfo.Simple(10, DamageSource.Melee, Vector3.zero, Vector3.forward);
            Assert.IsFalse(FalconSkills.IsWeaponHit(in melee), "同 TS：只认 source weapon");
        }
    }
}
