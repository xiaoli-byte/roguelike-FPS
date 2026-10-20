using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// W1：开火模式（<see cref="IFireMode"/>）与武器状态机（<see cref="WeaponStateMachine"/>）的时间逻辑——不建场景，用假宿主按固定帧长驱动。
    /// 新模式（点射 / 预热 / 蓄力 / 齐射）的定义还没进武器表（WC1–WC3），这里按 TS WeaponDefs.ts 的数值现造。
    /// 末尾是 6 把现有武器的持续秒伤回归（见 <see cref="SixWeaponsSustainedDps"/> 的说明）。
    /// </summary>
    public sealed class FireModeTests
    {
        const float Dt60 = 1f / 60f;

        // ───────────── 假宿主 ─────────────

        /// <summary>只给开火模式用：记每一发、每一枚、每个提示音；弹匣可设</summary>
        sealed class Host : IFireHost
        {
            public int mag = 999, shots, volleyShots, consumed;
            public bool infinite;
            public readonly List<ShotMods> mods = new();
            public readonly List<(int index, int count, bool feedback)> projectiles = new();
            public readonly List<FireCue> cues = new();
            public bool HasAmmo => infinite || mag > 0;
            public float Cooldown { get; set; }
            public void ConsumeTrigger() => consumed++;

            public void Shoot(in ShotMods m)
            {
                if (!infinite) mag--;
                if (m.deferred) volleyShots++;
                else shots++;
                mods.Add(m);
            }

            public void VolleyProjectile(int index, int count, bool feedback) => projectiles.Add((index, count, feedback));
            public void Cue(FireCue cue) => cues.Add(cue);
        }

        /// <summary>按状态机的帧顺序推进一个模式：冷却 −dt → Tick → 负冷却钳 0</summary>
        static void Step(IFireMode m, Host h, FireInput input)
        {
            h.Cooldown -= input.dt;
            m.Tick(in input, h);
            if (h.Cooldown < 0) h.Cooldown = 0;
        }

        static FireInput Input(bool down, float rate, float dt = Dt60, bool pulled = false, float rateMult = 1, bool ready = true) => new()
        {
            dt = dt, down = down, pulled = pulled, ready = ready, inputOk = true, rate = rate, rateMult = rateMult,
        };

        /// <summary>按住 seconds 秒，返回打出的发数和单帧最多发数</summary>
        static (int shots, int maxPerFrame) Hold(IFireMode m, Host h, float rate, float seconds, float dt)
        {
            int frames = Mathf.RoundToInt(seconds / dt), max = 0;
            for (int i = 0; i < frames; i++)
            {
                int before = h.shots;
                Step(m, h, Input(true, rate, dt));
                max = Mathf.Max(max, h.shots - before);
            }
            return (h.shots, max);
        }

        /// <summary>只给状态机用：记射击 / 弹体 / 通知，统计伤害（单发伤害 × 弹丸 × 修饰）</summary>
        sealed class Effects : IWeaponEffects
        {
            public int shots, projectiles;
            public float damage;
            public readonly List<WeaponNote> notes = new();
            public readonly List<ShotMods> mods = new();

            public void Shoot(WeaponInstance w, in ShotMods m, Element element)
            {
                mods.Add(m);
                if (m.deferred) return;
                shots++;
                damage += WeaponStatsResolver.Resolve(w, null).damage * w.def.pellets * m.mult;
            }

            public void VolleyProjectile(WeaponInstance w, int index, int count, bool feedback)
            {
                projectiles++;
                damage += WeaponStatsResolver.Resolve(w, null).damage;
            }

            public void Cue(WeaponInstance w, FireCue cue) { }
            public void Notify(WeaponNote note, WeaponInstance w, WeaponInstance other) => notes.Add(note);
            public int Count(WeaponNote n) => notes.FindAll(x => x == n).Count;
        }

        /// <summary>状态机 + 模拟时钟</summary>
        sealed class Rig
        {
            public readonly WeaponInstance[] slots = new WeaponInstance[2];
            public readonly Effects fx = new();
            public readonly WeaponStateMachine sm;
            public float time;
            public bool enemies = true;

            public Rig(params WeaponInstance[] ws)
            {
                for (int i = 0; i < ws.Length && i < 2; i++) slots[i] = ws[i];
                sm = new WeaponStateMachine(slots, fx, () => time, w => WeaponStatsResolver.Resolve(w, null)) { enemiesAlive = () => enemies };
            }

            public void Frame(bool down = false, bool pressed = false, bool reload = false, bool infinite = false, bool testAuto = false, float dt = Dt60, bool alive = true)
            {
                time += dt;
                sm.Tick(new WeaponFrame
                {
                    dt = dt, alive = alive, canAct = alive, fireDown = down, firePressed = pressed, reloadPressed = reload, infinite = infinite, testAuto = testAuto,
                });
            }

            /// <summary>空跑 seconds 秒（不按任何键）</summary>
            public void Idle(float seconds)
            {
                int n = Mathf.RoundToInt(seconds / Dt60);
                for (int i = 0; i < n; i++) Frame();
            }
        }

        static WeaponDef Def(string id)
        {
            var d = WeaponLibrary.Get(id);
            Assert.IsNotNull(d, $"武器表里没有 {id}");
            return d;
        }

        // TS WeaponDefs.ts 的新模式武器（只取时间相关字段）
        static WeaponDef Burst() => new() { id = "t_burst", mode = FireMode.Burst, damage = 24, fireRate = 1.6f, burstCount = 3, burstInterval = 0.065f, mag = 24, reserve = 168, reloadTime = 2.1f };
        static WeaponDef Minigun() => new() { id = "t_minigun", mode = FireMode.Spinup, damage = 7.5f, fireRate = 20, mag = 120, reserve = 480, reloadTime = 3.4f, spinup = 0.6f, moveSlow = 2 };
        static WeaponDef Railgun() => new() { id = "t_railgun", mode = FireMode.Charge, damage = 155, fireRate = 2, mag = 6, reserve = 36, reloadTime = 2.4f, chargeTime = 0.9f, chargeMinMult = 0.2f, chargeFullPierce = 3, chargeDetonate = true, pierce = 1 };
        static WeaponDef Swarm(bool fanFixed = false) => new()
        {
            id = "t_swarm", mode = FireMode.Semi, damage = 30, fireRate = 0.75f, mag = 4, reserve = 20, reloadTime = 2.8f,
            projectile = new ProjectileSpec { speed = 24, radius = 0.12f, explosionRadius = 1.8f, lifetime = 3.5f, visual = "rocket", homing = 4.5f, count = 5, stagger = 0.06f, fan = 0.16f, fanFixed = fanFixed },
        };

        // ───────────── 选模式 ─────────────

        [Test]
        public void FactoryPicksModeFromDefinition()
        {
            Assert.IsInstanceOf<SemiMode>(FireModes.Create(Def("revolver")));
            Assert.IsInstanceOf<AutoMode>(FireModes.Create(Def("smg")));
            Assert.IsInstanceOf<SemiMode>(FireModes.Create(Def("shotgun")));
            Assert.IsInstanceOf<SemiMode>(FireModes.Create(Def("launcher")));
            Assert.IsInstanceOf<BeamMode>(FireModes.Create(Def("beam")));
            Assert.IsInstanceOf<SemiMode>(FireModes.Create(Def("stormpod")));
            Assert.IsInstanceOf<BurstMode>(FireModes.Create(Burst()));
            Assert.IsInstanceOf<SpinupMode>(FireModes.Create(Minigun()));
            Assert.IsInstanceOf<ChargeMode>(FireModes.Create(Railgun()));
            Assert.IsInstanceOf<VolleyMode>(FireModes.Create(Swarm()), "projectile.count > 1 = 齐射");
        }

        // ───────────── 全自动 / 补发 ─────────────

        [TestCase(30f)]
        [TestCase(60f)]
        [TestCase(144f)]
        public void AutoFireRateIsExactAtAnyFrameRate(float fps)
        {
            var m = new AutoMode(Def("smg"));
            var h = new Host();
            var (shots, _) = Hold(m, h, 13, 10f, 1f / fps);
            Assert.That(shots, Is.InRange(129, 131), $"{fps} fps 下按住 10 s 应打约 130 发（13 发 / 秒），实际 {shots}");
        }

        [Test]
        public void AutoCatchUpIsCappedAtFourPerFrame()
        {
            var m = new AutoMode(Def("smg"));
            var h = new Host();
            // 300 发 / 秒、30 fps：每帧欠 10 发，只补 4 发
            var (shots, max) = Hold(m, h, 300, 1f, 1f / 30);
            Assert.AreEqual(WeaponTiming.MaxCatchUp, max);
            Assert.AreEqual(30 * WeaponTiming.MaxCatchUp, shots);
        }

        [Test]
        public void AutoDoesNotDumpAfterIdle()
        {
            var m = new AutoMode(Def("smg"));
            var h = new Host();
            for (int i = 0; i < 120; i++) Step(m, h, Input(false, 13));
            Step(m, h, Input(true, 13));
            Assert.AreEqual(1, h.shots, "停火 2 s 后再按：第一帧只打 1 发（负冷却每帧钳回 0）");
        }

        // ───────────── 半自动 / 缓冲 ─────────────

        [Test]
        public void SemiHeldFiresOnceUntilReleased()
        {
            var r = new Rig(new WeaponInstance(Def("revolver")));
            r.Frame(down: true, pressed: true);
            for (int i = 0; i < 60; i++) r.Frame(down: true);
            Assert.AreEqual(1, r.fx.shots, "按住不放只打一发");
            r.Frame();
            r.Frame(down: true, pressed: true);
            Assert.AreEqual(2, r.fx.shots, "松开再按又打一发");
        }

        [Test]
        public void SemiHeldThroughCooldownFiresWhenReady()
        {
            // 改造前的手感：冷却中按下不放，冷却一好就打出
            var r = new Rig(new WeaponInstance(Def("launcher")));
            r.Frame(down: true, pressed: true);
            r.Frame();
            r.Frame(down: true, pressed: true);
            Assert.AreEqual(1, r.fx.shots);
            float t0 = r.time;
            while (r.fx.shots < 2 && r.time - t0 < 2) r.Frame(down: true);
            Assert.AreEqual(2, r.fx.shots);
            Assert.That(r.time - t0, Is.EqualTo(1 / 1.1f).Within(2 * Dt60));
        }

        [Test]
        public void FireBufferCatchesEarlyClick()
        {
            var interval = 1 / 1.1f;
            // 冷却结束前 0.1 s 点一下就松开：缓冲 0.14 s 内冷却好了 → 打出
            var r = new Rig(new WeaponInstance(Def("launcher")));
            r.Frame(down: true, pressed: true);
            while (r.time < interval - 0.1f) r.Frame();
            r.Frame(down: true, pressed: true);
            for (int i = 0; i < 12; i++) r.Frame();
            Assert.AreEqual(2, r.fx.shots, "0.14 s 缓冲内的提前点击应该打出");
            // 提前 0.3 s 点一下就松开：缓冲过期 → 不打
            var q = new Rig(new WeaponInstance(Def("launcher")));
            q.Frame(down: true, pressed: true);
            while (q.time < interval - 0.3f) q.Frame();
            q.Frame(down: true, pressed: true);
            for (int i = 0; i < 40; i++) q.Frame();
            Assert.AreEqual(1, q.fx.shots, "缓冲过期的点击不该打出");
        }

        // ───────────── 点射 ─────────────

        [Test]
        public void BurstFiresCountAtIntervalThenWaitsRoundCooldown()
        {
            var m = new BurstMode(Burst());
            var h = new Host();
            var times = new List<float>();
            float t = 0;
            Step(m, h, Input(true, 1.6f, pulled: true));
            times.Add(0);
            for (int i = 0; i < 120; i++)
            {
                t += Dt60;
                int before = h.shots;
                Step(m, h, Input(false, 1.6f));
                if (h.shots > before) times.Add(t);
            }
            Assert.AreEqual(3, h.shots, "一次扣扳机打 3 发");
            Assert.That(times[1], Is.EqualTo(0.065f).Within(Dt60));
            Assert.That(times[2], Is.EqualTo(0.13f).Within(Dt60));
            Assert.IsFalse(m.Busy);
            // 轮间冷却从这一轮开始时算：0.625 s 前再扣不响应
            var h2 = new Host();
            var m2 = new BurstMode(Burst());
            Step(m2, h2, Input(true, 1.6f, pulled: true));
            for (int i = 0; i < 30; i++) Step(m2, h2, Input(false, 1.6f));
            Step(m2, h2, Input(true, 1.6f, pulled: true));
            Assert.AreEqual(3, h2.shots, "0.5 s 时再扣：轮间冷却没到");
            for (int i = 0; i < 8; i++) Step(m2, h2, Input(false, 1.6f));
            Step(m2, h2, Input(true, 1.6f, pulled: true));
            Assert.AreEqual(4, h2.shots, "0.65 s 时再扣：开始第二轮");
        }

        [Test]
        public void BurstAbortsWhenEmptyAndWhenNotReady()
        {
            var m = new BurstMode(Burst());
            var h = new Host { mag = 2 };
            Step(m, h, Input(true, 1.6f, pulled: true));
            for (int i = 0; i < 20; i++) Step(m, h, Input(false, 1.6f));
            Assert.AreEqual(2, h.shots);
            Assert.IsFalse(m.Busy, "打空后这一轮作废");
            var m2 = new BurstMode(Burst());
            var h2 = new Host();
            Step(m2, h2, Input(true, 1.6f, pulled: true));
            Step(m2, h2, Input(false, 1.6f, ready: false));
            for (int i = 0; i < 20; i++) Step(m2, h2, Input(false, 1.6f));
            Assert.AreEqual(1, h2.shots, "切枪 / 换弹（ready = false）打断这一轮");
        }

        [Test]
        public void BurstRateMultShortensInterval()
        {
            var m = new BurstMode(Burst());
            var h = new Host();
            Step(m, h, Input(true, 3.2f, pulled: true, rateMult: 2));
            int frames = 0;
            while (h.shots < 3 && frames < 60)
            {
                Step(m, h, Input(false, 3.2f, rateMult: 2));
                frames++;
            }
            Assert.That(frames * Dt60, Is.EqualTo(0.065f).Within(2 * Dt60), "射速 ×2 时一轮打完约 0.065 s");
        }

        // ───────────── 光束 ─────────────

        [Test]
        public void BeamTicksAtRateAndFirstTickIsImmediate()
        {
            var m = new BeamMode(Def("beam"));
            var h = new Host();
            Step(m, h, Input(true, 10));
            Assert.AreEqual(1, h.shots, "按下第一帧就放电");
            Assert.IsTrue(m.Firing);
            for (int i = 1; i < 60; i++) Step(m, h, Input(true, 10));
            Assert.That(h.shots, Is.InRange(10, 11), "按住 1 s ≈ 10 跳");
            Step(m, h, Input(false, 10));
            Assert.IsFalse(m.Firing);
        }

        [Test]
        public void BeamTappingCannotBeatFireRate()
        {
            var m = new BeamMode(Def("beam"));
            var h = new Host();
            for (int i = 0; i < 120; i++) Step(m, h, Input(i % 2 == 0, 10));
            Assert.That(h.shots, Is.LessThanOrEqualTo(21), "连点 2 s 不超过 20 跳");
        }

        // ───────────── 预热（机炮）─────────────

        [Test]
        public void SpinupFiresOnlyAfterSpinAndSlowsWhileFiring()
        {
            var m = new SpinupMode(Minigun());
            var h = new Host();
            float t = 0, first = -1;
            for (int i = 0; i < 90; i++)
            {
                t += Dt60;
                Step(m, h, Input(true, 20));
                if (first < 0 && h.shots > 0) first = t;
                if (h.shots == 0) Assert.AreEqual(0f, m.MoveSlow, "预热中不减速");
            }
            Assert.That(first, Is.EqualTo(0.6f).Within(2 * Dt60), "转满 0.6 s 才开火");
            Assert.AreEqual(1, h.cues.FindAll(c => c == FireCue.SpinUp).Count);
            Assert.IsTrue(m.Firing);
            Assert.AreEqual(2f, m.MoveSlow, "开火时移速 −2");
            Assert.That(h.shots, Is.InRange(18, 20), "转满后 20 发 / 秒（0.9 s 剩约 0.9 − 0.6 = 0.3 s × 20 + 1）");
            Step(m, h, Input(false, 20));
            Assert.AreEqual(0f, m.MoveSlow, "松手不再减速");
            for (int i = 0; i < 60; i++) Step(m, h, Input(false, 20));
            Assert.AreEqual(0f, m.Spin, 1e-4f, "松手 0.9 s 转停");
        }

        [Test]
        public void SpinupRateMultShortensSpinup()
        {
            var m = new SpinupMode(Minigun());
            var h = new Host();
            int frames = 0;
            while (h.shots == 0 && frames < 120)
            {
                Step(m, h, Input(true, 40, rateMult: 2));
                frames++;
            }
            Assert.That(frames * Dt60, Is.EqualTo(0.3f).Within(2 * Dt60));
        }

        // ───────────── 蓄力 ─────────────

        [Test]
        public void ChargeCurveAndFullChargeFlags()
        {
            var def = Railgun();
            Assert.AreEqual(0.2f, WeaponTiming.ChargeMult(0.2f, 0), 1e-6f);
            Assert.AreEqual(0.4f, WeaponTiming.ChargeMult(0.2f, 0.5f), 1e-6f);
            Assert.AreEqual(1f, WeaponTiming.ChargeMult(0.2f, 1), 1e-6f);
            var half = ChargeMode.Shot(def, 0.5f);
            Assert.IsFalse(half.full);
            Assert.AreEqual(0, half.pierceBonus);
            Assert.AreEqual(0.7f, half.strength, 1e-5f);
            var full = ChargeMode.Shot(def, 1);
            Assert.IsTrue(full.full);
            Assert.AreEqual(3, full.pierceBonus);
            Assert.AreEqual(1f, full.mult, 1e-6f);
        }

        [Test]
        public void ChargeReleaseFiresWithChargedMultiplier()
        {
            var m = new ChargeMode(Railgun());
            var h = new Host();
            // 按住 0.45 s（chargeTime 0.9 → t = 0.5）
            for (int i = 0; i < 27; i++) Step(m, h, Input(true, 2));
            Assert.AreEqual(0.5f, m.Charge, 0.02f);
            Assert.AreEqual(0, h.shots, "按住不发射");
            Step(m, h, Input(false, 2));
            Assert.AreEqual(1, h.shots);
            Assert.AreEqual(0.2f + 0.8f * 0.25f, h.mods[0].mult, 0.03f);
            Assert.IsFalse(h.mods[0].full);
            Assert.AreEqual(0.5f, h.Cooldown + Dt60, Dt60, "松手后冷却 1 / 射速");
            Assert.AreEqual(1, h.cues.FindAll(c => c == FireCue.ChargeStart).Count);
            // 蓄满
            for (int i = 0; i < 40; i++) Step(m, h, Input(false, 2));
            for (int i = 0; i < 60; i++) Step(m, h, Input(true, 2));
            Assert.IsTrue(m.Full);
            Assert.AreEqual(1, h.cues.FindAll(c => c == FireCue.ChargeFull).Count);
            Step(m, h, Input(false, 2));
            Assert.AreEqual(2, h.shots);
            Assert.IsTrue(h.mods[1].full);
            Assert.AreEqual(3, h.mods[1].pierceBonus);
        }

        [Test]
        public void ChargeIsVoidedWhenInterruptedOrInputLost()
        {
            var m = new ChargeMode(Railgun());
            var h = new Host();
            for (int i = 0; i < 30; i++) Step(m, h, Input(true, 2));
            // 暂停 / 弹窗：没有输入权时松开 → 作废
            var lost = Input(false, 2);
            lost.inputOk = false;
            Step(m, h, lost);
            Assert.AreEqual(0, h.shots);
            Assert.AreEqual(0f, m.Charge);
            // 换弹 / 切枪（ready = false）打断 → 作废
            for (int i = 0; i < 30; i++) Step(m, h, Input(true, 2));
            Step(m, h, Input(true, 2, ready: false));
            Step(m, h, Input(false, 2));
            Assert.AreEqual(0, h.shots);
            // 冲刺不打断蓄力
            for (int i = 0; i < 30; i++) Step(m, h, Input(true, 2));
            var dash = Input(true, 2);
            dash.blocked = true;
            Step(m, h, dash);
            Assert.Greater(m.Charge, 0.5f);
        }

        [Test]
        public void ChargeTestModeAutoReleasesWhenFull()
        {
            var m = new ChargeMode(Railgun());
            var h = new Host();
            var i0 = Input(true, 2);
            i0.testAuto = true;
            for (int i = 0; i < 180; i++) Step(m, h, i0);
            // 每轮：0.9 s 蓄满 + 1 帧松手；冷却 0.5 s 期间不蓄力 → 约 1.4 s 一发
            Assert.That(h.shots, Is.InRange(2, 3));
            foreach (var s in h.mods) Assert.IsTrue(s.full);
        }

        // ───────────── 齐射 ─────────────

        [Test]
        public void VolleyFiresCountStaggeredForOneRound()
        {
            var m = new VolleyMode(Swarm());
            var h = new Host { mag = 4 };
            float t = 0;
            var at = new List<float>();
            Step(m, h, Input(true, 0.75f, pulled: true));
            at.Add(0);
            Assert.AreEqual(1, h.volleyShots, "扣一下只扣 1 发弹药");
            Assert.AreEqual(3, h.mag);
            Assert.IsTrue(m.Busy);
            for (int i = 0; i < 30; i++)
            {
                t += Dt60;
                int before = h.projectiles.Count;
                Step(m, h, Input(true, 0.75f, pulled: true));
                if (h.projectiles.Count > before) at.Add(t);
            }
            Assert.AreEqual(5, h.projectiles.Count);
            Assert.AreEqual(1, h.volleyShots, "齐射中再扣不响应");
            Assert.IsFalse(m.Busy);
            for (int i = 0; i < 5; i++)
            {
                Assert.AreEqual(i, h.projectiles[i].index);
                Assert.IsTrue(h.projectiles[i].feedback, "随机散开：每枚都有后坐");
            }
            Assert.That(at[4] - at[0], Is.EqualTo(4 * 0.06f).Within(2 * Dt60));
        }

        [Test]
        public void VolleyFinishesOnSwitch()
        {
            var r = new Rig(new WeaponInstance(Swarm()), new WeaponInstance(Def("smg")));
            r.Frame(down: true, pressed: true);
            Assert.AreEqual(1, r.fx.projectiles);
            Assert.IsTrue(r.sm.Busy);
            r.sm.SwitchTo(1);
            Assert.AreEqual(5, r.fx.projectiles, "切枪时剩下的弹体立即打完");
            Assert.AreEqual(1, r.sm.ActiveSlot);
            // 齐射中不能换弹
            var q = new Rig(new WeaponInstance(Swarm()) { mag = 1 });
            q.Frame(down: true, pressed: true);
            Assert.IsFalse(q.sm.StartReload(), "齐射没打完不换弹");
            for (int i = 0; i < 30; i++) q.Frame();
            Assert.IsTrue(q.sm.Reloading, "打完后自动换弹");
        }

        [Test]
        public void FixedFanVolleyHasFeedbackOnlyOnFirst()
        {
            var m = new VolleyMode(Swarm(true));
            var h = new Host();
            Step(m, h, Input(true, 0.75f, pulled: true));
            for (int i = 0; i < 30; i++) Step(m, h, Input(false, 0.75f));
            Assert.AreEqual(5, h.projectiles.Count);
            Assert.IsTrue(h.projectiles[0].feedback);
            for (int i = 1; i < 5; i++) Assert.IsFalse(h.projectiles[i].feedback);
        }

        // ───────────── 状态机：切枪 / 冷却 / 换弹 / 弹药 ─────────────

        [Test]
        public void SwitchPoseHolstersThenDraws()
        {
            float T = WeaponTiming.SwitchTime;
            Assert.IsTrue(WeaponTiming.SwitchPose(T, true, out float l0));
            Assert.AreEqual(0f, l0, 1e-5f, "刚开始收枪：旧枪还没下沉");
            Assert.IsTrue(WeaponTiming.SwitchPose(T * (1 - 0.39f), true, out float l1));
            Assert.Greater(l1, 0.95f, "收枪快结束：旧枪几乎沉到底");
            Assert.IsFalse(WeaponTiming.SwitchPose(T * (1 - 0.41f), true, out float l2), "过了 40% 换成新枪");
            Assert.Greater(l2, 0.95f, "新枪从底下开始抬");
            Assert.IsFalse(WeaponTiming.SwitchPose(0.0001f, true, out float l3));
            Assert.Less(l3, 0.01f);
            Assert.IsFalse(WeaponTiming.SwitchPose(T * 0.5f, false, out float l4), "没有旧枪：新枪直接抬");
            Assert.AreEqual(0.5f, l4, 1e-5f);
        }

        [Test]
        public void SwitchingKeepsPerWeaponCooldown()
        {
            // 慢枪（0.5 发 / 秒）打一发后切走再切回：冷却按 readyAt 恢复，不会被切枪刷掉
            var slow = new WeaponDef { id = "t_slow", mode = FireMode.Semi, damage = 100, fireRate = 0.5f, mag = 5, reserve = 10, reloadTime = 1 };
            var r = new Rig(new WeaponInstance(slow), new WeaponInstance(Def("smg")));
            r.Frame(down: true, pressed: true);
            float shotAt = r.time;
            r.Frame();
            r.sm.SwitchTo(1);
            Assert.AreEqual(0f, r.sm.Cooldown, "冲锋枪自己的冷却是 0");
            Assert.AreEqual(WeaponTiming.SwitchTime, r.sm.SwitchTimer);
            Assert.AreEqual(r.slots[0], r.sm.Holster, "收枪阶段显示旧枪");
            r.Idle(0.5f);
            Assert.IsNull(r.sm.Holster);
            r.sm.SwitchTo(0);
            Assert.AreEqual(2f - (r.time - shotAt), r.sm.Cooldown, 0.02f, "切回来冷却接着算");
            while (r.time - shotAt < 1.9f) r.Frame(down: true, pressed: true);
            Assert.AreEqual(1, r.fx.shots, "冷却没到不能开火");
            for (int i = 0; i < 12; i++) r.Frame(down: true, pressed: true);
            Assert.AreEqual(2, r.fx.shots, "2 s 后可以了");
        }

        [Test]
        public void SwapIsDebouncedDuringHolster()
        {
            var r = new Rig(new WeaponInstance(Def("smg")), new WeaponInstance(Def("revolver")));
            Assert.IsTrue(r.sm.Swap());
            Assert.IsFalse(r.sm.Swap(), "收枪还没过半：滚轮连发不来回切");
            Assert.AreEqual(1, r.sm.ActiveSlot);
            r.Idle(0.2f);
            Assert.IsTrue(r.sm.Swap());
            Assert.AreEqual(0, r.sm.ActiveSlot);
        }

        [Test]
        public void GiveReplacesActiveWhenFull()
        {
            var a = new WeaponInstance(Def("smg"));
            var b = new WeaponInstance(Def("revolver"));
            var r = new Rig(a);
            Assert.IsNull(r.sm.Give(b), "有空槽：放进空槽");
            Assert.AreSame(b, r.sm.Active);
            Assert.AreSame(a, r.sm.Holster);
            var c = new WeaponInstance(Def("shotgun"));
            Assert.AreSame(b, r.sm.Give(c), "满了：替换当前槽，返回换下来的");
            Assert.AreSame(c, r.slots[1]);
            Assert.IsNull(r.sm.Holster, "替换当前槽：新枪直接抬起");
            Assert.AreEqual(1, r.fx.Count(WeaponNote.Acquired) - 1);
        }

        [Test]
        public void MagazineReloadTiming()
        {
            var w = new WeaponInstance(Def("smg")) { mag = 3 };
            var r = new Rig(w);
            r.Frame(reload: true);
            Assert.IsTrue(r.sm.Reloading);
            float t0 = r.time;
            while (r.sm.Reloading && r.time - t0 < 5) r.Frame();
            Assert.AreEqual(1.7f, r.time - t0, 2 * Dt60);
            Assert.AreEqual(36, w.mag);
            Assert.AreEqual(252 - 33, w.reserve);
            Assert.AreEqual(1, r.fx.Count(WeaponNote.Reloaded));
            Assert.AreEqual(0, r.fx.Count(WeaponNote.Racked), "整匣换弹不上膛");
        }

        [Test]
        public void ShellReloadInsertsThenRacks()
        {
            var w = new WeaponInstance(Def("shotgun")) { mag = 0 };
            var r = new Rig(w);
            r.Frame(reload: true);
            Assert.IsTrue(r.sm.ShellReload);
            float t0 = r.time;
            var inserts = new List<float>();
            float last = 0;
            while (r.sm.Reloading && r.time - t0 < 6)
            {
                r.Frame();
                if (r.sm.ShellsInserted > inserts.Count) inserts.Add(r.time - t0);
                if (!r.sm.Reloading) break;
                Assert.GreaterOrEqual(r.sm.ReloadProgress + 1e-4f, last, "进度单调");
                last = r.sm.ReloadProgress;
            }
            Assert.Greater(last, 0.9f, "装满前进度接近 1");
            Assert.AreEqual(6, w.mag);
            Assert.AreEqual(6, r.fx.Count(WeaponNote.ShellInserted));
            // 第一发 = 准备 0.4 + 0.48，之后每 0.48（同 TS）
            Assert.AreEqual(0.88f, inserts[0], 2 * Dt60);
            Assert.AreEqual(0.4f + 6 * 0.48f, inserts[5], 2 * Dt60);
            Assert.AreEqual(1, r.fx.Count(WeaponNote.Racked));
            Assert.Greater(r.sm.Cooldown, 0.25f, "装满后上膛 0.3 s");
            // 上膛期间扣住扳机：上膛完就打出（不到 0.3 s 不响）
            float t1 = r.time;
            r.Frame(down: true, pressed: true);
            Assert.AreEqual(0, r.fx.shots);
            while (r.fx.shots == 0 && r.time - t1 < 1) r.Frame(down: true);
            Assert.AreEqual(1, r.fx.shots);
            Assert.Greater(r.time - t1, 0.25f);
        }

        [Test]
        public void ShellReloadInterruptedByFireRacksAndFires()
        {
            var w = new WeaponInstance(Def("shotgun")) { mag = 0 };
            var r = new Rig(w);
            r.Frame(reload: true);
            while (r.sm.ShellsInserted < 1) r.Frame();
            float t0 = r.time;
            r.Frame(down: true, pressed: true);
            Assert.IsFalse(r.sm.Reloading, "装填中开火打断");
            Assert.AreEqual(1, r.fx.Count(WeaponNote.ReloadPartial), "已压进 1 发：算部分换弹");
            Assert.AreEqual(1, r.fx.Count(WeaponNote.Racked));
            Assert.AreEqual(0, r.fx.shots, "先上膛");
            while (r.fx.shots == 0 && r.time - t0 < 1) r.Frame(down: true);
            Assert.AreEqual(WeaponTiming.ShellRack, r.time - t0, 2 * Dt60, "上膛 0.3 s 后打出这一枪");
        }

        [Test]
        public void EmptyAutoReloadsAndDryFiresWithoutReserve()
        {
            var w = new WeaponInstance(Def("revolver")) { mag = 1 };
            var r = new Rig(w);
            r.Frame(down: true, pressed: true);
            Assert.AreEqual(0, w.mag);
            Assert.IsTrue(r.sm.Reloading, "按着扳机打空：立即换弹");
            var idle = new WeaponInstance(Def("revolver")) { mag = 1 };
            var q = new Rig(idle);
            q.Frame(down: true, pressed: true);
            Assert.IsTrue(q.sm.Reloading);
            var none = new WeaponInstance(Def("revolver")) { mag = 0, reserve = 0 };
            var z = new Rig(none) { enemies = false };
            z.Frame(down: true, pressed: true);
            Assert.AreEqual(1, z.fx.Count(WeaponNote.DryFire));
            z.Frame();
            z.Frame(down: true, pressed: true);
            Assert.AreEqual(1, z.fx.Count(WeaponNote.DryFire), "空仓音 0.3 s 一次");
            // 没按扳机时打空：0.25 s 后自动换弹
            var s = new WeaponInstance(Def("revolver")) { mag = 0 };
            var u = new Rig(s);
            u.Frame();
            Assert.IsFalse(u.sm.Reloading);
            u.Idle(0.3f);
            Assert.IsTrue(u.sm.Reloading);
        }

        [Test]
        public void InfiniteAmmoDoesNotConsumeAndCancelsReload()
        {
            var w = new WeaponInstance(Def("smg")) { mag = 10 };
            var r = new Rig(w);
            r.Frame(reload: true);
            Assert.IsTrue(r.sm.Reloading);
            r.Frame(infinite: true);
            Assert.IsFalse(r.sm.Reloading, "无限弹药开始：换弹中断");
            Assert.AreEqual(0, r.fx.Count(WeaponNote.Racked));
            for (int i = 0; i < 60; i++) r.Frame(down: true, infinite: true);
            Assert.Greater(r.fx.shots, 10);
            Assert.AreEqual(10, w.mag, "不耗弹匣");
            r.Frame(reload: true, infinite: true);
            Assert.IsFalse(r.sm.Reloading, "无限弹药期间 R 无效");
        }

        [Test]
        public void EmergencyResupplyOnlyInCombat()
        {
            var a = new WeaponInstance(Def("smg")) { mag = 0, reserve = 0 };
            var b = new WeaponInstance(Def("revolver")) { mag = 0, reserve = 0 };
            var r = new Rig(a, b) { enemies = false };
            r.Idle(3f);
            Assert.AreEqual(0, a.reserve, "没有敌人：不补");
            r.enemies = true;
            r.Idle(2.4f);
            Assert.AreEqual(0, a.reserve);
            r.Idle(0.2f);
            Assert.AreEqual(1, r.fx.Count(WeaponNote.Resupplied));
            // 补 1 匣备弹，随后自动换弹把它装进弹匣
            Assert.AreEqual(36, a.mag + a.reserve);
            Assert.AreEqual(0, b.reserve, "只补当前武器");
            // 另一把枪还有弹：不补
            var c = new WeaponInstance(Def("smg")) { mag = 0, reserve = 0 };
            var q = new Rig(c, new WeaponInstance(Def("revolver")) { mag = 1, reserve = 0 });
            q.Idle(3f);
            Assert.AreEqual(0, q.fx.Count(WeaponNote.Resupplied));
        }

        [Test]
        public void AmmoFractionAndStageRefill()
        {
            var a = new WeaponInstance(Def("smg")) { reserve = 0 };
            var b = new WeaponInstance(Def("revolver"));
            var r = new Rig(a, b);
            // 换关补给（LootDirector 在 StageLoaded 上调 RefillReserve(EconomyConfig.StageAmmoRefill) = 0.35）
            Assert.IsTrue(r.sm.AddAmmoFraction(EconomyConfig.StageAmmoRefill));
            Assert.AreEqual(Mathf.CeilToInt(252 * 0.35f), a.reserve);
            Assert.AreEqual(64, b.reserve, "已满的不动");
            a.reserve = 251;
            r.sm.AddAmmoFraction(0.001f);
            Assert.AreEqual(252, a.reserve, "至少补 1 发、不超上限");
            Assert.IsFalse(r.sm.AddAmmoFraction(0));
        }

        [Test]
        public void ClearForStageCompletesReload()
        {
            var w = new WeaponInstance(Def("smg")) { mag = 2 };
            var r = new Rig(w);
            r.Frame(reload: true);
            r.Idle(0.5f);
            r.sm.ClearForStage();
            Assert.IsFalse(r.sm.Reloading);
            Assert.AreEqual(36, w.mag, "换关时进行中的换弹直接完成");
            Assert.AreEqual(0, r.fx.Count(WeaponNote.Reloaded), "不发事件");
        }

        [Test]
        public void TestModeDrivesBurstAndVolleyWhileHeld()
        {
            var r = new Rig(new WeaponInstance(Burst()));
            for (int i = 0; i < 150; i++) r.Frame(down: true, testAuto: true);
            Assert.GreaterOrEqual(r.fx.shots, 9, "按住 2.5 s：TestMode 下点射自动连发（≥ 3 轮）");
            var q = new Rig(new WeaponInstance(Swarm()));
            for (int i = 0; i < 150; i++) q.Frame(down: true, testAuto: true);
            Assert.GreaterOrEqual(q.fx.projectiles, 10, "齐射也一样");
        }

        // ───────────── 秒伤回归 ─────────────

        /// <summary>
        /// 改造前 WeaponController 的帧循环（逐行照搬的时间模型）：打空且按着扳机就换弹 → 换弹（逐发：第一发在 reloadStart 就压进、没有上膛）→
        /// 冷却 −dt → 冷却到了就打一发并把冷却「重置」成 1 / 射速（丢掉不足一帧的余量）
        /// </summary>
        static float LegacyDps(WeaponDef def, float seconds, float dt)
        {
            var R = WeaponStatsResolver.Resolve(new WeaponInstance(def), null);
            bool shell = WeaponStateMachine.IsShell(def);
            int mag = R.magCap;
            float cd = 0, elapsed = 0, shellTimer = 0, damage = 0;
            bool reloading = false;
            int frames = Mathf.RoundToInt(seconds / dt);
            for (int f = 0; f < frames; f++)
            {
                if (mag <= 0 && !reloading)
                {
                    reloading = true;
                    elapsed = 0;
                    if (shell) shellTimer = R.reloadStart;
                }
                if (reloading)
                {
                    elapsed += dt;
                    if (shell)
                    {
                        shellTimer -= dt;
                        while (shellTimer <= 0 && mag < R.magCap)
                        {
                            mag++;
                            shellTimer += R.shellTime;
                        }
                        if (mag >= R.magCap) reloading = false;
                    }
                    else if (elapsed >= R.reloadTime)
                    {
                        mag = R.magCap;
                        reloading = false;
                    }
                }
                cd -= dt;
                if (cd <= 0 && !reloading && mag > 0)
                {
                    mag--;
                    damage += R.damage * def.pellets;
                    cd = 1f / Mathf.Max(0.1f, R.fireRate);
                }
            }
            return damage / seconds;
        }

        /// <summary>新状态机：完美玩家（全自动 / 光束按住；半自动每帧都点，换弹中不点）、备弹无限</summary>
        static float NewDps(WeaponDef def, float seconds, float dt, bool clickDuringReload = false)
        {
            var w = new WeaponInstance(def);
            var r = new Rig(w);
            int frames = Mathf.RoundToInt(seconds / dt);
            for (int f = 0; f < frames; f++)
            {
                w.reserve = def.reserve;
                bool click = clickDuringReload || !r.sm.Reloading;
                r.Frame(down: true, pressed: click, dt: dt);
            }
            return r.fx.damage / seconds;
        }

        /// <summary>
        /// 设计值：一匣按射速打完 + 换弹（逐发 = 准备 + 满匣发数 × 每发 + 上膛）。
        /// 半自动的冷却是「重置」（同 TS），两发间隔必然对齐到整帧：按 ⌈间隔 / dt⌉ 帧算；持续开火类补发，按定义射速算
        /// </summary>
        static float NominalDps(WeaponDef def, float dt)
        {
            var R = WeaponStatsResolver.Resolve(new WeaponInstance(def), null);
            float reload = WeaponStateMachine.IsShell(def) ? R.reloadStart + R.magCap * R.shellTime + WeaponTiming.ShellRack : R.reloadTime;
            float gap = 1 / R.fireRate;
            if (!FireModes.IsHold(FireModes.Create(def))) gap = Mathf.Ceil(gap / dt - 1e-3f) * dt;
            return R.magCap * R.damage * def.pellets / ((R.magCap - 1) * gap + reload);
        }

        /// <summary>
        /// 6 把现有武器的持续秒伤（身体、无暴击、无衰减、备弹无限，60 fps，120 s）。
        /// 名义秒伤（<see cref="ResolvedWeapon.dps"/>）W1 没动，6 把一分不差；下面比的是按帧模拟出来的「实际」持续秒伤：
        ///   · 左轮 / 榴弹 / 雷蛊：与改造前相差 ≤ 3%（实测 −0.8% / −1.1% / 0%：82.3→81.7、86.2→85.2、80.8→80.8）。
        ///   · 冲锋枪 / 雷弧：改造前每发丢掉不足一帧的冷却余量（60 fps 下冲锋枪 12 发 / 秒、雷弧约 7.4 跳 / 秒，帧率越低丢得越多），
        ///     补发后回到定义射速：冲锋枪 85.8→90.6（+5.6%）、雷弧 59.0→66.7（+13%）。
        ///   · 霰弹：按 TS 改成「准备 + 每发」与 0.3 s 上膛，满匣循环 102.6→91.8（−10.5%）；「装一发打一发」不再是无限弹匣（改造前约 150）。
        ///   · 6 把的新值都在设计值（一匣 + 换弹的循环）±3% 内，即 Three.js 秒伤带的基准（TS 实测：左轮 82、冲锋枪 91、霰弹 90、光束 74 不含暴击）。
        /// </summary>
        [Test]
        public void SixWeaponsSustainedDps()
        {
            const float T = 120f;
            var table = new List<string>();
            foreach (var id in new[] { "revolver", "smg", "shotgun", "launcher", "beam", "stormpod" })
            {
                var def = Def(id);
                float legacy = LegacyDps(def, T, Dt60), now = NewDps(def, T, Dt60), nominal = NominalDps(def, Dt60);
                table.Add($"{id,-9} 改造前 {legacy,6:F1}  现在 {now,6:F1}  设计 {nominal,6:F1}  变化 {100 * (now / legacy - 1),+6:F1}%");
                Assert.AreEqual(nominal, now, nominal * 0.03f, $"{id}：持续秒伤应在设计值 ±3% 内");
                switch (id)
                {
                    case "smg":
                    case "beam":
                        Assert.GreaterOrEqual(now, legacy, $"{id}：补发只会把丢掉的射速补回来");
                        break;
                    case "shotgun":
                        Assert.Less(now, legacy, "霰弹：TS 的逐发时序 + 上膛");
                        break;
                    default:
                        Assert.AreEqual(legacy, now, legacy * 0.03f, $"{id}：与改造前相差应 ≤ 3%");
                        break;
                }
                Assert.AreEqual(WeaponStatsResolver.Resolve(new WeaponInstance(def), null).dps,
                    def.damage * def.pellets * def.fireRate, 1e-3f, $"{id}：名义秒伤不变");
            }
            TestContext.Out?.WriteLine(string.Join("\n", table));
        }

        [Test]
        public void ShotgunLoadOneShootOneIsNoLongerInfinite()
        {
            // 每帧都点（装填中也点）：装一发 → 打断上膛 → 打出。上膛让它慢于整匣循环附近，而不是改造前的 1.4 发 / 秒
            float dps = NewDps(Def("shotgun"), 60f, Dt60, true);
            Assert.Less(dps, 100f, $"装一发打一发的持续秒伤 {dps:F1}");
        }
    }
}
