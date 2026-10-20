using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 敌方危险物库（docs/unity-parity.md 3.7 / E4）的纯逻辑：
    /// 危险区计时（与改动前 FireZone 的跳数逐帧一致、预警期不伤人、提前结束、掉帧补跳上限）与站位判定；
    /// 冲击波前沿（低帧率不漏、镇墓兽踏地波抽出后的覆盖范围与改动前逐点一致）；
    /// 延时队列（按时刻 + 登记顺序、同一步里接着跑新登记的、异常隔离）；连环爆（由近到远、跳过自己 / 已引爆 / 范围外、
    /// 间隔 0.14 + 0.07i、整条连锁经 HazardClock 的先后与时刻）；地上的火的登记表（最近、占用、高差、熄灭、占用者销毁）；爆炸衰减。
    /// </summary>
    public sealed class HazardTests
    {
        [SetUp]
        public void SetUp()
        {
            HazardClock.ResetForTests();
            FireFeed.ResetForTests();
        }

        [TearDown]
        public void TearDown()
        {
            HazardClock.ResetForTests();
            FireFeed.ResetForTests();
        }

        // ───────────── 危险区计时 ─────────────

        /// <summary>改动前的 FireZone：先扣寿命（到 0 就销毁、这一帧不再跳），计时从 tick × 0.5 开始，归零就跳一下并加回 tick</summary>
        static int OldFireZoneTicks(float duration, float tick, float dt)
        {
            float life = duration, timer = tick * 0.5f;
            int n = 0;
            for (int frame = 0; frame < 100000; frame++)
            {
                life -= dt;
                if (life <= 0) break;
                timer -= dt;
                if (timer > 0) continue;
                timer += tick;
                n++;
            }
            return n;
        }

        static int NewTicks(ZoneClock c, float dt, float seconds)
        {
            int n = 0;
            for (float t = 0; t < seconds; t += dt) n += c.Step(dt);
            return n;
        }

        [TestCase(1f / 60f)]
        [TestCase(1f / 30f)]
        [TestCase(0.1f)]
        public void FloorFireTicksLikeOldFireZone(float dt)
        {
            // 镇墓兽的日火裂痕 3 s / 0.5 s、火浣鼠的余火
            foreach (var (duration, tick) in new[] { (3f, 0.5f), (2.2f, 0.5f), (4f, 0.4f) })
            {
                var c = new ZoneClock(0, duration, tick, tick * 0.5f);
                Assert.AreEqual(OldFireZoneTicks(duration, tick, dt), NewTicks(c, dt, duration + 1f), $"{duration} s / {tick} s @ dt {dt}");
            }
            Assert.AreEqual(6, NewTicks(new ZoneClock(0, 3, 0.5f, 0.25f), 1f / 60f, 4f), "3 s、0.5 s 一跳、0.25 s 首跳：0.25 … 2.75 共 6 跳");
        }

        [Test]
        public void ZoneArmsBeforeTickingAndStopsAtEnd()
        {
            var c = new ZoneClock(0.4f, 2f, 0.5f, 0.1f);
            Assert.IsTrue(c.Arming);
            Assert.AreEqual(0, c.Step(0.39f), "预警期不跳");
            Assert.IsTrue(c.Arming);
            Assert.AreEqual(0, c.Step(0.05f));
            Assert.IsTrue(c.Live);
            Assert.AreEqual(1, c.Step(0.07f), "生效后 0.1 s 第一跳（0.5）");
            Assert.AreEqual(3, c.Step(1.5f), "1.0 / 1.5 / 2.0");
            Assert.AreEqual(0, c.Step(0.5f), "2.5 已经过了生效结束 2.4");
            Assert.IsTrue(c.Ended);
            Assert.AreEqual(2.4f, c.End, 1e-5f);
        }

        [Test]
        public void ZoneCatchUpIsCappedAndResyncs()
        {
            var c = new ZoneClock(0, 10, 0.1f, 0);
            Assert.AreEqual(4, c.Step(5f), "一步最多补 4 跳");
            Assert.AreEqual(1, c.Step(0.1f), "补不完的丢掉，从现在重新计");
        }

        [Test]
        public void ZoneExpireStopsTicking()
        {
            var c = new ZoneClock(0, 3, 0.5f, 0.25f);
            Assert.AreEqual(2, c.Step(1f));
            c.Expire();
            Assert.IsTrue(c.Ended);
            Assert.AreEqual(0, c.Step(1f));

            var arming = new ZoneClock(1f, 3, 0.5f, 0);
            arming.Step(0.5f);
            arming.Expire();
            Assert.IsTrue(arming.Ended, "预警中的直接作废");
            Assert.AreEqual(0, arming.Step(2f));
        }

        [Test]
        public void ZoneContainsUsesPadHeightBandAndRing()
        {
            var o = Vector3.zero;
            Assert.IsTrue(HazardZone.Contains(o, 2, 0, 0.35f, -1.2f, 1.2f, new Vector3(2.3f, 0, 0)));
            Assert.IsFalse(HazardZone.Contains(o, 2, 0, 0.35f, -1.2f, 1.2f, new Vector3(2.4f, 0, 0)));
            Assert.IsTrue(HazardZone.Contains(o, 2, 0, 0.35f, -1.2f, 1.2f, new Vector3(0, 1.2f, 0)), "高差含端点（同改动前 |dy| ≤ 1.2）");
            Assert.IsFalse(HazardZone.Contains(o, 2, 0, 0.35f, -1.2f, 1.2f, new Vector3(0, 1.25f, 0)), "跳起来躲开");
            Assert.IsFalse(HazardZone.Contains(o, 2, 0, 0.35f, -1.2f, 1.2f, new Vector3(0, -1.3f, 0)));
            Assert.IsFalse(HazardZone.Contains(o, 4, 1, 0.35f, -1, 1, new Vector3(0.5f, 0, 0)), "环带：内圈里不算");
            Assert.IsTrue(HazardZone.Contains(o, 4, 1, 0.35f, -1, 1, new Vector3(0.7f, 0, 0)));
        }

        [Test]
        public void FloorFireRegistersAndGoesOutWhenEaten()
        {
            int eaten = 0;
            var fire = FloorFire.Spawn(new Vector3(0, -500, 0), 1.2f, 3f, 4f, 0.5f, null, true, () => eaten++);
            try
            {
                Assert.AreEqual(1, FireFeed.Count, "地火默认登记给祸斗吃");
                Assert.IsTrue(fire.Edible);
                Assert.AreSame(fire, FireFeed.Find(new Vector3(2, -500, 0), 5, "huodou"));
                fire.Consume();
                Assert.IsTrue(fire.Eaten);
                Assert.IsTrue(fire.Ended, "吃掉 = 熄灭，不再伤人");
                Assert.IsFalse(fire.Edible);
                Assert.AreEqual(1, eaten);
                Assert.AreEqual(0, FireFeed.Count);
                fire.Consume();
                Assert.AreEqual(1, eaten, "只能吃一次");
            }
            finally
            {
                Object.DestroyImmediate(fire.gameObject);
            }
            var plain = FloorFire.Spawn(new Vector3(0, -500, 0), 1f, 2f, 1f, 0.5f, null, false);
            Assert.AreEqual(0, FireFeed.Count, "edible = false 不登记");
            Object.DestroyImmediate(plain.gameObject);
        }

        // ───────────── 冲击波 ─────────────

        /// <summary>前沿以 speed 走，按 dt 一步步扫，dist 处有没有被扫到过</summary>
        static bool Swept(WaveFront w, float dt, float dist)
        {
            for (int i = 0; i < 100000 && !w.Done; i++)
            {
                w.Step(dt);
                if (w.Crosses(dist)) return true;
            }
            return false;
        }

        [Test]
        public void WaveFrontDoesNotSkipAtLowFrameRate()
        {
            foreach (float dt in new[] { 1f / 60f, 0.1f, 0.25f })
            {
                var w = new WaveFront(0, 16, 9, 0.7f, 1f);
                foreach (float d in new[] { 2f, 5.55f, 8.9f, 10.6f }) Assert.IsTrue(Swept(w, dt, d), $"dt {dt}：{d} m 处应被扫到");
                Assert.IsFalse(Swept(w, dt, 10.8f), $"dt {dt}：前沿最远判到 max + overshoot + 0.7");
            }
        }

        /// <summary>改动前镇墓兽的踏地波：r = 经过时间 × 16，r &gt; 10 结束（这一帧不判），|dist − r| ≤ 0.7 且 dist &gt; 1.6 × 体型</summary>
        static bool OldStompReaches(float dist, float size, float dt)
        {
            for (float t = dt; t < 5f; t += dt)
            {
                float r = t * 16f;
                if (r > 10f) return false;
                if (dist <= 1.6f * size || Mathf.Abs(dist - r) > 0.7f) continue;
                return true;
            }
            return false;
        }

        [Test]
        public void TombBeastStompWaveKeepsItsNumbers()
        {
            var s = TombBeastAI.StompWave(Vector3.zero, 1.25f, 10f, null);
            Assert.AreEqual(9f, s.maxRadius);
            Assert.AreEqual(16f, s.speed);
            Assert.AreEqual(7f, s.damage, 1e-5f, "×0.7");
            Assert.AreEqual(1.6f * 1.25f, s.innerRadius, 1e-5f, "爆心 1.6 × 体型以内不吃");
            Assert.AreEqual(1.4f, s.width, 1e-5f, "环带 ±0.7 m");
            Assert.AreEqual(1f, s.overshoot, 1e-5f, "前沿走到 10 m 才结束");
            Assert.AreEqual(-1.2f, s.minRise, 1e-5f);
            Assert.AreEqual(1.2f, s.maxRise, 1e-5f);
            Assert.IsTrue(s.needGrounded, "跳起来躲开");
            Assert.IsFalse(s.coverBlocks);
            Assert.AreEqual(0f, s.knockback);
            Assert.AreEqual(0f, s.knockUp);

            // 60 帧下，抽出前后能打到的距离逐点一致（采样点避开边界上的浮点误差）；
            // 唯一的差别在最外沿：改动前最后一帧的半径 ≤ 10 m（60 帧时 9.87 m，最远打到 10.57 m），现在最后一步停在 10 m，最远 10.7 m
            const float dt = 1f / 60f;
            for (float d = 0.013f; d < 11.5f; d += 0.05f)
            {
                var w = new WaveFront(s.startRadius, s.speed, s.maxRadius, s.width * 0.5f, s.overshoot);
                bool now = d > s.innerRadius && Swept(w, dt, d);
                bool old = OldStompReaches(d, 1.25f, dt);
                if (d < 10.5f || d > 10.75f) Assert.AreEqual(old, now, $"{d:F3} m");
                else if (d < 10.69f) Assert.IsTrue(now, $"{d:F3} m：最外沿现在一定扫到");
            }
        }

        // ───────────── 延时队列 ─────────────

        [Test]
        public void DelayQueueRunsByTimeThenOrder()
        {
            var q = new DelayQueue();
            var log = new List<string>();
            q.Add(0.3f, () => log.Add("a"));
            q.Add(0.1f, () => log.Add("b"));
            q.Add(0.1f, () =>
            {
                log.Add("c");
                q.Add(0.15f, () => log.Add("c+"));
                q.Add(0.9f, () => log.Add("late"));
            });
            Assert.AreEqual(3, q.Run(0.2f));
            CollectionAssert.AreEqual(new[] { "b", "c", "c+" }, log, "同一时刻按登记顺序；任务里登记的、已到点的同一次 Run 接着跑");
            q.Run(0.5f);
            CollectionAssert.AreEqual(new[] { "b", "c", "c+", "a" }, log);
            Assert.AreEqual(1, q.Count);
        }

        [Test]
        public void DelayQueueIsolatesExceptions()
        {
            var q = new DelayQueue();
            int ran = 0;
            q.Add(0, () => throw new System.InvalidOperationException("boom"));
            q.Add(0, () => ran++);
            LogAssert.Expect(LogType.Exception, new Regex("boom"));
            Assert.AreEqual(2, q.Run(1));
            Assert.AreEqual(1, ran, "前一个抛异常不影响后面的");
        }

        [Test]
        public void HazardClockUsesManualTimeOutsidePlayMode()
        {
            int ran = 0;
            HazardClock.Delay(0.25f, () => ran++);
            HazardClock.Step(0.2f);
            Assert.AreEqual(0, ran);
            HazardClock.Step(0.1f);
            Assert.AreEqual(1, ran);
            Assert.AreEqual(0, HazardClock.Pending);
        }

        // ───────────── 连环爆 ─────────────

        sealed class FakeKin : IExplosiveKin
        {
            public readonly string name;
            public Vector3 at;
            public float radius = 0.3f;
            public bool alive = true, primed;
            public float scheduledDelay = -1;
            public System.Action<FakeKin> onDetonate;

            public FakeKin(string name, Vector3 at)
            {
                this.name = name;
                this.at = at;
            }

            public bool ChainArmed => alive && !primed;
            public Vector3 ChainCenter => at;
            public float ChainRadius => radius;

            public void ChainDetonate(float delay)
            {
                if (!ChainArmed) return;
                primed = true;
                scheduledDelay = delay;
                HazardClock.Delay(delay, () =>
                {
                    alive = false;
                    onDetonate?.Invoke(this);
                });
            }

            public override string ToString() => name;
        }

        [Test]
        public void KinAreOrderedNearToFarSkippingSourceDeadPrimedAndOutOfRange()
        {
            var src = new FakeKin("S", Vector3.zero);
            var a = new FakeKin("A", new Vector3(1, 0, 0));
            var b = new FakeKin("B", new Vector3(-2.5f, 0, 0));
            var c = new FakeKin("C", new Vector3(0, 0, 2));
            var d = new FakeKin("D", new Vector3(0, 3.5f, 0)) { radius = 0.6f };
            var e = new FakeKin("E", new Vector3(4, 0, 0));
            var dead = new FakeKin("dead", new Vector3(0.5f, 0, 0)) { alive = false };
            var primed = new FakeKin("primed", new Vector3(0, 0, -0.5f)) { primed = true };
            var g = new FakeKin("G", new Vector3(2, 0, 0));
            var pool = new List<IExplosiveKin> { e, b, src, d, dead, c, a, primed, g };
            var got = new List<IExplosiveKin>();
            Assert.AreEqual(5, ExplosiveChain.KinInRadius(Vector3.zero, 3, src, pool, got));
            CollectionAssert.AreEqual(new[] { "A", "C", "G", "B", "D" }, got.Select(k => k.ToString()).ToArray(),
                "由近到远；同距离（C、G 都是 2 m）按池里的先后；D 在 3 + 0.6 内、E 在 3 + 0.3 外");
            CollectionAssert.AreEqual(new[] { 0.14f, 0.21f, 0.28f, 0.35f, 0.42f }, Enumerable.Range(0, 5).Select(i => (float)System.Math.Round(ExplosiveChain.HopDelay(i), 4)).ToArray());
        }

        [Test]
        public void ChainDetonationsPropagateInOrder()
        {
            var src = new FakeKin("S", Vector3.zero);
            var a = new FakeKin("A", new Vector3(1, 0, 0));
            var c = new FakeKin("C", new Vector3(0, 0, 2));
            var b = new FakeKin("B", new Vector3(-2.5f, 0, 0));
            var d = new FakeKin("D", new Vector3(4, 0, 0));
            var far = new FakeKin("far", new Vector3(20, 0, 0));
            var pool = new List<IExplosiveKin> { far, d, b, c, a, src };
            var log = new List<(string who, float at)>();
            void OnBoom(FakeKin k)
            {
                log.Add((k.name, HazardClock.Now));
                ExplosiveChain.Explode(new ExplosiveChain.Spec(k.at, 3f, 0, 0, ExplosiveChain.Mode.Detonate, k), pool);
            }
            foreach (var k in pool) ((FakeKin)k).onDetonate = OnBoom;

            // S 在 0 s 炸（炸了就是死了）：0.06 s 结算 → A 0.20、C 0.27、B 0.34；A 炸完再 0.06 s 结算，D（只在 A 的范围里）0.40
            src.alive = false;
            ExplosiveChain.Explode(new ExplosiveChain.Spec(Vector3.zero, 3f, 0, 0, ExplosiveChain.Mode.Detonate, src), pool);
            // 1/128 s 一步：二进制精确，时钟累加没有浮点漂移（每个延时最多晚一步）
            const float step = 1f / 128f;
            for (int i = 0; i < 160; i++) HazardClock.Step(step);

            CollectionAssert.AreEqual(new[] { "A", "C", "B", "D" }, log.Select(l => l.who).ToArray(), "每只只炸一次，由近到远，连锁继续往外传");
            var expect = new[] { 0.20f, 0.27f, 0.34f, 0.40f };
            for (int i = 0; i < expect.Length; i++)
            {
                Assert.GreaterOrEqual(log[i].at, expect[i] - 1e-4f, log[i].who);
                Assert.LessOrEqual(log[i].at, expect[i] + 2 * step, log[i].who);
            }
            Assert.IsTrue(far.ChainArmed, "范围外的不受影响");
            Assert.AreEqual(0, HazardClock.Pending);
        }

        [Test]
        public void DamageModeDoesNotDetonateKin()
        {
            var a = new FakeKin("A", new Vector3(1, 0, 0));
            var pool = new List<IExplosiveKin> { a };
            Assert.AreEqual(0, ExplosiveChain.Resolve(new ExplosiveChain.Spec(Vector3.zero, 3, 0, 0, ExplosiveChain.Mode.Damage, null), pool),
                "飞鸦空中打爆：只伤害，不直接引爆同类");
            Assert.IsTrue(a.ChainArmed);
            Assert.AreEqual(1, ExplosiveChain.Resolve(new ExplosiveChain.Spec(Vector3.zero, 3, 0, 0, ExplosiveChain.Mode.Detonate, null), pool));
            Assert.AreEqual(ExplosiveChain.Hop, a.scheduledDelay, 1e-6f);
        }

        // ───────────── 地上的火 ─────────────

        sealed class FakeFire : IFireSource
        {
            public Vector3 at;
            public float radius = 0.5f;
            public bool edible = true;
            public int consumed;

            public FireKind Kind => FireKind.Floor;
            public Vector3 Position => at;
            public float Radius => radius;
            public bool Edible => edible;
            public object ClaimedBy { get; set; }

            public void Consume()
            {
                consumed++;
                edible = false;
            }
        }

        [Test]
        public void FireFeedFindsNearestFreeReachableFire()
        {
            var far = new FakeFire { at = new Vector3(3, 0, 0) };
            var near = new FakeFire { at = new Vector3(2, 0, 0), radius = 0.2f };
            var high = new FakeFire { at = new Vector3(1, 3, 0) };
            var cold = new FakeFire { at = new Vector3(0.5f, 0, 0), edible = false };
            foreach (var f in new[] { far, near, high, cold }) FireFeed.Register(f);
            FireFeed.Register(near);
            Assert.AreEqual(3, FireFeed.Count, "吃不了的清掉；重复登记忽略");

            object me = "huodou_1", other = "huodou_2";
            Assert.AreSame(near, FireFeed.Find(Vector3.zero, 10, me), "距离按火的边算：2 − 0.2 < 3 − 0.5；高台上的够不着");
            Assert.IsNull(FireFeed.Find(Vector3.zero, 1.5f, me), "maxDist 以内才算");
            Assert.IsTrue(FireFeed.Claim(near, other));
            Assert.IsFalse(FireFeed.Claim(near, me), "别人占着");
            Assert.AreSame(far, FireFeed.Find(Vector3.zero, 10, me));
            Assert.AreSame(near, FireFeed.Find(Vector3.zero, 10, other), "自己占着的照样能找到");
            FireFeed.Release(other);
            Assert.AreSame(near, FireFeed.Find(Vector3.zero, 10, me));
            near.Consume();
            Assert.AreSame(far, FireFeed.Find(Vector3.zero, 10, me));
            Assert.AreEqual(2, FireFeed.Count);
            Assert.AreSame(high, FireFeed.Find(new Vector3(1, 2.5f, 0), 10, me), "高处的火从高处找得到");
        }

        [Test]
        public void FireFeedReleasesClaimsOfDestroyedEaters()
        {
            var fire = new FakeFire { at = Vector3.zero };
            FireFeed.Register(fire);
            var eater = new GameObject("eater");
            Assert.IsTrue(FireFeed.Claim(fire, eater));
            Assert.IsNull(FireFeed.Find(Vector3.zero, 5, "someone"));
            Object.DestroyImmediate(eater);
            Assert.AreSame(fire, FireFeed.Find(Vector3.zero, 5, "someone"), "占用者销毁后自动放开");
            Assert.IsNull(fire.ClaimedBy);
        }

        [Test]
        public void LavaEdgeIsProvidedByTheLavaSystem()
        {
            Assert.IsNull(FireFeed.FindLavaEdge(Vector3.zero, 10), "熔岩系统接上之前没有熔岩边");
            var edge = new FakeFire { at = new Vector3(4, 0, 0) };
            FireFeed.LavaEdge = (from, max) => Vector3.Distance(from, edge.at) <= max ? edge : null;
            Assert.AreSame(edge, FireFeed.FindLavaEdge(Vector3.zero, 10));
            Assert.IsNull(FireFeed.FindLavaEdge(Vector3.zero, 2));
        }

        // ───────────── 爆炸 ─────────────

        [Test]
        public void BlastFalloffMatchesTsConvention()
        {
            Assert.AreEqual(1f, Blast.Falloff(0, 3, 0.5f), 1e-6f);
            Assert.AreEqual(0.75f, Blast.Falloff(1.5f, 3, 0.5f), 1e-6f);
            Assert.AreEqual(0.5f, Blast.Falloff(3, 3, 0.5f), 1e-6f, "TS falloff 0.5 → 边缘 50%");
            Assert.AreEqual(0.5f, Blast.Falloff(9, 3, 0.5f), 1e-6f, "半径外夹到边缘");
            Assert.AreEqual(0.7f, Blast.Falloff(3, 3, 0.7f), 1e-6f, "镇墓兽踏地 TS falloff 0.3 → edge 0.7");
            Assert.AreEqual(1f, Blast.Falloff(1, 0, 0.5f), 1e-6f, "半径 0：不衰减");
        }
    }
}
