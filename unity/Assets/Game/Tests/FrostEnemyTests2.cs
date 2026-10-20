using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第二章冰系敌人 EN2d / EN2e（docs/unity-parity.md 3.8、7.4）的纯逻辑，移植 tests/frost-skirmishers / frost-ranged / frost-support.test.mjs
    /// 里与这五种敌人有关的断言：
    ///   冰棘豪彘：定义数值、冲锋提速曲线、16 根水平冰刺新星（一条辐条正对玩家、射程 12 m、离地 0.62 × 体型）、提前打死只射一半、残刺阵跳伤节奏；
    ///   夫诸：定义数值、蓄力后 30% 锁定、跳跃弧线（距离约 10 m、顶点 1.2–3.5 m）、冰光判定（站在线上命中、横移 2.5 m 躲开）、冻地打滑；
    ///   冰鲸：定义数值、冰柱落点（5 个、互相 ≥ 2.6 m、一个对准玩家、都在玩家看冰鲸的视野扇面里）、落地时刻、砸中衰减、拍击冲击波；
    ///   九尾狐巫：冰壁选址、冰壁分段与「不把人关进墙里」、霜甲（承伤 ×0.7、多只不叠加、碎镜立刻失效、5 s 到期）、照妖镜判定；
    ///   冰灯水母：定义数值、先连缺血多的三个、回血速率、玩家穿过触须、冻电范围。
    /// 带 Unity 物理 / 导航 / 动画的整体行为由冒烟套件（TestArena）覆盖，这里只测不依赖场景的部分。
    /// </summary>
    public sealed class FrostEnemyTests2
    {
        const float Dt = 1f / 60f;

        static EnemyDef Def(string id)
        {
            var d = Registry<EnemyDef>.Get(id);
            Assert.IsNotNull(d, $"{id} 没有登记");
            return d;
        }

        // ───────────── 定义 ─────────────

        [Test]
        public void DefsMatchThreeJs()
        {
            var h = Def("haozhi");
            Assert.AreEqual(typeof(HaozhiAI), h.ai);
            Assert.AreEqual(("SK_Enemy_Haozhi", 1.4f, 36f, 5.2f, 18f, 0.25f), (h.prefab, h.scale, h.hp, h.speed, h.damage, h.knockbackResist));
            Assert.AreEqual((0.3f, 0.9f, 0.66f, 0.26f), (h.radius, h.height, h.weakHeight, h.weakRadius));
            Assert.IsTrue(h.groundOnly && h.charger, "豪彘只站地面、是冲锋型");

            var f = Def("fuzhu");
            Assert.AreEqual(typeof(FuzhuAI), f.ai);
            Assert.AreEqual(("SK_Enemy_Fuzhu", 1.25f, 95f, 4.4f, 28f, 0.35f), (f.prefab, f.scale, f.hp, f.speed, f.damage, f.knockbackResist));
            Assert.AreEqual(EnemyPlacement.Precision, f.placementRole);

            var w = Def("ice_whale");
            Assert.AreEqual(typeof(IceWhaleAI), w.ai);
            Assert.AreEqual(("SK_Enemy_IceWhale", 1.1f, 340f, 1.7f, 22f, 1f), (w.prefab, w.scale, w.hp, w.speed, w.damage, w.knockbackResist));
            Assert.AreEqual(EnemyPlacement.Artillery, w.placementRole);
            Assert.AreEqual(HitboxMode.Ragdoll, w.hitboxes, "5 m 长的身体用布娃娃胶囊做命中盒");

            var x = Def("fox_witch");
            Assert.AreEqual(typeof(FoxWitchAI), x.ai);
            Assert.AreEqual(("SK_Enemy_FoxWitch", 1.15f, 130f, 4.6f, 12f, 0.25f), (x.prefab, x.scale, x.hp, x.speed, x.damage, x.knockbackResist));
            Assert.AreEqual("socket_mirror", x.weakBone, "弱点是悬浮铜镜");
            Assert.AreEqual(EnemyPlacement.Support, x.placementRole);

            var j = Def("lantern_jelly");
            Assert.AreEqual(typeof(LanternJellyAI), j.ai);
            Assert.IsTrue(typeof(FlyingEnemyAI).IsAssignableFrom(j.ai) && j.flying, "水母漂在半空：飞行基类");
            Assert.AreEqual(("SK_Enemy_LanternJelly", 1.1f, 110f, 3.4f, 10f, 0.4f), (j.prefab, j.scale, j.hp, j.speed, j.damage, j.knockbackResist));
            Assert.AreEqual(EnemyPlacement.Support, j.placementRole);

            Assert.IsNull(Registry<EnemyDef>.Get("fox_ice_wall"), "冰壁不是名册敌人（只由狐巫生成）");
        }

        // ───────────── 冰棘豪彘 ─────────────

        [Test]
        public void HaozhiChargeRampsFromFiveToTenAndAHalf()
        {
            Assert.AreEqual(5f, HaozhiAI.ChargeSpeedAt(0, false), 1e-6f);
            Assert.AreEqual(8.2f, HaozhiAI.ChargeSpeedAt(0.2f, false), 1e-5f);
            Assert.AreEqual(10.5f, HaozhiAI.ChargeSpeedAt(1f, false), 1e-6f);
            Assert.AreEqual(11.55f, HaozhiAI.ChargeSpeedAt(1f, true), 1e-5f, "精英 ×1.1");
            Assert.AreEqual(2.4f, HaozhiAI.ChargeMaxTime);
            Assert.AreEqual(1.1f, HaozhiAI.ChargeTurn, "迟钝转向：横移能甩开");
        }

        [Test]
        public void HaozhiNovaIsSixteenHorizontalQuillsWithOneLaneThroughThePlayer()
        {
            var player = new Vector3(0, 0, 14);
            // 停在 6 m 外蓄刺时的朝向（任意方向）
            var at = new Vector3(3.2f, 0, 9.1f);
            float yaw0 = HaozhiAI.YawTo(at, player);
            var toPlayer = (player - at).normalized;
            float best = -1;
            var dirs = Enumerable.Range(0, HaozhiAI.Quills).Select(i => HaozhiAI.QuillDirection(yaw0, i, HaozhiAI.Quills)).ToList();
            Assert.AreEqual(16, dirs.Count);
            foreach (var d in dirs)
            {
                Assert.AreEqual(0f, d.y, "冰刺水平飞");
                Assert.AreEqual(1f, d.magnitude, 1e-5f);
                best = Mathf.Max(best, Vector3.Dot(d, toPlayer));
            }
            Assert.Greater(best, 0.999f, "一条辐条正对玩家（辐条与冰刺方向一致）");
            // 相邻两根相差 22.5°：缝隙就是安全方向
            Assert.AreEqual(22.5f, Vector3.Angle(dirs[0], dirs[1]), 1e-3f);
            Assert.AreEqual(12f, HaozhiAI.QuillLifetime * HaozhiAI.QuillSpeed, 1e-5f, "射程 12 m");
            Assert.AreEqual(20f, HaozhiAI.QuillSpeed);
            Assert.AreEqual(0.868f, HaozhiAI.QuillY * Def("haozhi").scale, 1e-3f, "离地约 0.87 m：跳起来能躲");
        }

        [Test]
        public void HaozhiKilledEarlySpraysHalfTheQuillsAtHalfDamage()
        {
            Assert.AreEqual(8, HaozhiAI.Quills / 2);
            Assert.AreEqual(0.5f, HaozhiAI.EarlyDamageRatio);
            float yaw0 = 0.3f + HaozhiAI.EarlyYawOffset;
            var half = Enumerable.Range(0, 8).Select(i => HaozhiAI.QuillDirection(yaw0, i, 8)).ToList();
            Assert.AreEqual(45f, Vector3.Angle(half[0], half[1]), 1e-3f, "8 根均分一周");
            Assert.AreEqual(22.5f, HaozhiAI.EarlyYawOffset * Mathf.Rad2Deg, 1e-3f, "起始方向错开 22.5°");
        }

        [Test]
        public void HaozhiQuillFieldPricksEveryHalfSecondForFourSeconds()
        {
            Assert.AreEqual(2.4f, HaozhiAI.FieldRadius);
            Assert.AreEqual(0.3f, HaozhiAI.FieldRatio, "残刺跳伤 = 冰刺伤害 × 0.3");
            var c = new ZoneClock(0, HaozhiAI.FieldTime, HaozhiAI.FieldTick, HaozhiAI.FieldTick);
            int first = 0;
            for (float t = 0; t < 1.05f; t += Dt) first += c.Step(Dt);
            Assert.GreaterOrEqual(first, 2, "站在里面 1 s 内至少扎两下");
            for (float t = 0; t < 3.5f; t += Dt) c.Step(Dt);
            int after = 0;
            for (float t = 0; t < 1f; t += Dt) after += c.Step(Dt);
            Assert.AreEqual(0, after, "4 s 后消失");
            // 站位：TS zonePlayer 的半径 + 玩家半径的一半、高差 [−0.6, 1.2]
            var center = Vector3.zero;
            Assert.IsTrue(HazardZone.Contains(center, 2.4f, 0, 0.18f, -0.6f, 1.2f, new Vector3(1, 0, 0)));
            Assert.IsFalse(HazardZone.Contains(center, 2.4f, 0, 0.18f, -0.6f, 1.2f, new Vector3(1, 1.5f, 0)), "跳起来不扎");
        }

        // ───────────── 夫诸 ─────────────

        [Test]
        public void FuzhuLocksItsAimForTheLastThirtyPercent()
        {
            Assert.AreEqual(1.2f, FuzhuAI.ChargeTime);
            Assert.IsFalse(FuzhuAI.AimLocked(0.69f), "跟踪段");
            Assert.IsTrue(FuzhuAI.AimLocked(0.7f), "锁定段");
            Assert.IsTrue(FuzhuAI.AimLocked(1f));
            Assert.AreEqual((13f, 24f, 34f), (FuzhuAI.MinRange, FuzhuAI.MaxRange, FuzhuAI.BeamRange));
        }

        [Test]
        public void FuzhuBeamHitsAPlayerOnTheLineAndMissesASidestep()
        {
            var from = new Vector3(0, 1.8f, 0.5f);
            var dir = new Vector3(0, -0.04f, 1).normalized;
            var end = from + dir * FuzhuAI.BeamRange;
            Assert.IsTrue(FuzhuAI.SegmentHitsCapsule(from, end, FuzhuAI.BeamRadius, new Vector3(0, 0, 15), 0.35f, 1.8f), "站在锁定的线上被打中");
            Assert.IsFalse(FuzhuAI.SegmentHitsCapsule(from, end, FuzhuAI.BeamRadius, new Vector3(2.5f, 0, 15), 0.35f, 1.8f), "锁定后横移 2.5 m 躲开");
            // 被掩体挡住：光束终点停在掩体正面（z = 12），掩体后面的玩家不吃
            var blockedEnd = from + dir * ((12 - from.z) / dir.z);
            Assert.IsFalse(FuzhuAI.SegmentHitsCapsule(from, blockedEnd, FuzhuAI.BeamRadius, new Vector3(0, 0, 15), 0.35f, 1.8f));
        }

        [Test]
        public void FuzhuLeapsAboutTenMetresWithAPlausibleApex()
        {
            var from = Vector3.zero;
            var to = new Vector3(0, 0, -FuzhuAI.LeapDist);
            var v = FuzhuAI.LeapVelocity(from, to, FuzhuAI.LeapTime, FuzhuAI.Gravity);
            // 按脚本位移的积分（重力 26）逐帧走到落地
            var p = from;
            float peak = 0, t = 0;
            while (t < 3f)
            {
                v.y -= FuzhuAI.Gravity * Dt;
                p += v * Dt;
                t += Dt;
                peak = Mathf.Max(peak, p.y);
                if (p.y <= 0 && v.y < 0) break;
            }
            float moved = new Vector2(p.x - from.x, p.z - from.z).magnitude;
            Assert.That(moved, Is.InRange(8.5f, 11.5f), "跳跃距离");
            Assert.That(peak, Is.InRange(1.2f, 3.5f), "腾空顶点");
            Assert.AreEqual(FuzhuAI.LeapTime, t, 3 * Dt, "腾空约 0.8 s");
        }

        [Test]
        public void FrozenStripKeepsThePlayerSlidingAndOnlyWhereItLies()
        {
            // 以 6 m/s 冲上冰面后松开按键（地面刹车 60 m/s²）：0.25 s 后还在滑
            var v = new Vector3(6, 0, 0);
            var slip = v;
            for (int i = 0; i < Mathf.RoundToInt(0.25f / Dt); i++)
            {
                float s = v.magnitude;
                v *= Mathf.Max(0, s - 60 * Dt) / s;
                var imp = FuzhuIceStrip.SlipImpulse(v, slip, Dt);
                Assert.LessOrEqual(imp.magnitude, FuzhuIceStrip.MaxImpulse + 1e-5f, "单帧冲量 < 3 m/s：不触发击退硬直");
                v += imp;
                slip = v;
            }
            Assert.Greater(v.magnitude, 3f, $"冰面上 0.25 s 后还有 {v.magnitude:0.00} m/s");
            // 冰面范围：沿光束 [0, 长度]、横向 ≤ 半宽 + 半个玩家半径、高差 ≤ 0.6
            var a = Vector3.zero;
            var fwd = Vector3.forward;
            Assert.IsTrue(FuzhuIceStrip.OnStrip(a, fwd, 20, 0.9f, new Vector3(0.5f, 0, 6), 0.35f));
            Assert.IsFalse(FuzhuIceStrip.OnStrip(a, fwd, 20, 0.9f, new Vector3(1.5f, 0, 6), 0.35f), "冰面外");
            Assert.IsFalse(FuzhuIceStrip.OnStrip(a, fwd, 20, 0.9f, new Vector3(0, 0, -1), 0.35f), "起点后面");
            Assert.IsFalse(FuzhuIceStrip.OnStrip(a, fwd, 20, 0.9f, new Vector3(0, 1f, 6), 0.35f), "跳起来不滑");
            Assert.AreEqual(4f, FuzhuAI.StripTime, "冻地 4 s 后化掉");
        }

        // ───────────── 冰鲸 ─────────────

        [Test]
        public void IceWhalePillarSpotsAreSpreadAimedAndInView()
        {
            var whale = Vector3.zero;
            var player = new Vector3(0, 0, 16);
            float bodyR = 1.05f * Def("ice_whale").scale;
            var spots = new List<Vector3>();
            for (int seed = 1; seed <= 25; seed++)
            {
                IceWhaleAI.PickTargets(player, Vector3.zero, whale, bodyR, IceWhaleAI.Pillars, new System.Random(seed), null, spots);
                Assert.AreEqual(5, spots.Count, $"种子 {seed}：5 根冰柱");
                for (int i = 0; i < spots.Count; i++)
                for (int k = i + 1; k < spots.Count; k++)
                    Assert.GreaterOrEqual(new Vector2(spots[i].x - spots[k].x, spots[i].z - spots[k].z).magnitude, IceWhaleAI.MinSpacing - 1e-4f, "落点不重叠");
                Assert.IsTrue(spots.Any(s => new Vector2(s.x - player.x, s.z - player.z).magnitude < 0.5f), "一根对准玩家");
                float toWhale = Mathf.Atan2(whale.x - player.x, whale.z - player.z);
                foreach (var s in spots)
                {
                    Assert.GreaterOrEqual(new Vector2(s.x, s.z).magnitude, 4 + bodyR - 1e-4f, "不砸冰鲸自己");
                    var d = new Vector2(s.x - player.x, s.z - player.z);
                    if (d.magnitude < 1) continue;
                    float off = Mathf.Abs(Mathf.DeltaAngle(Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg, toWhale * Mathf.Rad2Deg)) * Mathf.Deg2Rad;
                    Assert.LessOrEqual(off, 2.0f, "落点在玩家朝冰鲸看时的视野扇面里");
                }
            }
            IceWhaleAI.PickTargets(player, Vector3.zero, whale, bodyR, IceWhaleAI.PillarsElite, new System.Random(3), null, spots);
            // 精英 7 根（候选点挤不下时同 TS 少一根）；第 4 个固定点（玩家身后 4 m）只给精英
            Assert.That(spots.Count, Is.InRange(6, 7), "精英 7 根");
            Assert.IsTrue(spots.Any(s => new Vector2(s.x - player.x, s.z - player.z - 4f).magnitude < 1e-3f), "精英多砸玩家身后");
        }

        [Test]
        public void IceWhalePillarsLandStaggeredAndHitHarderInTheCentre()
        {
            var times = new List<float>();
            IceWhaleAI.PillarTimes(5, new System.Random(11), times);
            Assert.AreEqual(5, times.Count);
            CollectionAssert.AreEquivalent(new[] { 1.35f, 1.51f, 1.67f, 1.83f, 1.99f }, times.Select(t => Mathf.Round(t * 100) / 100f).ToArray());
            Assert.IsTrue(times.All(t => t >= 1.35f && t <= 2.1f), "预警 1.35–2.1 s");
            Assert.AreEqual(1f, IceWhalePillar.Falloff(0, IceWhaleAI.PillarRadius), 1e-6f);
            Assert.AreEqual(0.6f, IceWhalePillar.Falloff(IceWhaleAI.PillarRadius, IceWhaleAI.PillarRadius), 1e-6f, "边缘 60%");
            Assert.AreEqual((1.3f, 5f, 1.9f), (IceWhalePillar.FieldRadius, IceWhalePillar.FieldTime, IceWhalePillar.FieldHeight), "冰棱阵 5 s");
        }

        [Test]
        public void IceWhaleSlamWaveCanBeJumped()
        {
            Assert.AreEqual(0.8f, IceWhaleAI.RearTime);
            Assert.AreEqual(0.21f, IceWhaleAI.SlamTime * 0.6f, 1e-6f, "昂身 0.8 s 后再 0.21 s 砸地");
            Assert.AreEqual(1.3f, IceWhaleAI.SlamCoreMult);
            var s = IceWhaleAI.SlamWave(Vector3.zero, IceWhaleAI.WaveRadius, 22, null);
            Assert.AreEqual(22 * 0.8f, s.damage, 1e-5f, "冲击波 ×0.8");
            Assert.AreEqual((9f, 13f), (s.maxRadius, s.speed));
            Assert.IsTrue(s.coverBlocks, "掩体挡波");
            Assert.Greater(1.0f, s.maxRise, "跳起时脚底离地 1 m：躲开");
            Assert.LessOrEqual(s.minRise, 0f);
            // 站在 8 m 处的玩家被前沿扫到（逐帧连续，不跳过）
            var front = new WaveFront(s.startRadius, s.speed, s.maxRadius, s.width * 0.5f, s.overshoot);
            bool crossed = false;
            while (!front.Done)
            {
                front.Step(Dt);
                crossed |= front.Crosses(8f);
            }
            Assert.IsTrue(crossed);
        }

        // ───────────── 九尾狐巫 + 冰壁 ─────────────

        [Test]
        public void IceWallSitsBetweenAlliesAndPlayerNeverOnThePlayer()
        {
            Assert.IsTrue(FoxWitchAI.PlanIceWall(new Vector3(0, 0, 10), new Vector3(0, 0, 24), out var c, out float yaw));
            Assert.AreEqual(10 + 14 * 0.4f, c.z, 1e-5f);
            Assert.AreEqual(0f, yaw, 1e-6f, "墙面朝玩家");
            Assert.IsTrue(FoxWitchAI.PlanIceWall(Vector3.zero, new Vector3(0, 0, 7), out c, out _));
            Assert.LessOrEqual(c.z, 7 - 3.5f + 1e-5f, "离玩家至少 3.5 m");
            Assert.IsFalse(FoxWitchAI.PlanIceWall(Vector3.zero, new Vector3(0, 0, 5), out _, out _), "太近站不下一道墙");
            // 重试时沿连线往玩家挪
            Assert.IsTrue(FoxWitchAI.PlanIceWall(new Vector3(0, 0, 10), new Vector3(0, 0, 24), out var c2, out _, 0.8f));
            Assert.AreEqual(c.z + 0.8f, c2.z, 1e-4f);
            // 墙沿法线的垂直方向展开
            var u = FoxWitchAI.WallAxis(Mathf.PI / 4);
            Assert.AreEqual(0f, Vector3.Dot(u, new Vector3(Mathf.Sin(Mathf.PI / 4), 0, Mathf.Cos(Mathf.PI / 4))), 1e-6f);
        }

        [Test]
        public void IceWallSegmentsCoverTheWidthAndSkipAnyoneStandingInThem()
        {
            Assert.AreEqual(6, FoxIceWall.Segments);
            Assert.AreEqual(-FoxIceWall.Width / 2 + FoxIceWall.Width / 12, FoxIceWall.SegmentCenter(0), 1e-5f);
            Assert.AreEqual(FoxIceWall.Width / 2 - FoxIceWall.Width / 12, FoxIceWall.SegmentCenter(5), 1e-5f);
            Assert.AreEqual((4f, 2.5f, 0.6f, 12f, 150f), (FoxIceWall.Width, FoxIceWall.Height, FoxIceWall.Thick, FoxIceWall.Life, FoxIceWall.BaseHp));
            // 玩家站在第 0 段里：只有它（和挨着的第 1 段，玩家胶囊有半径）不立
            var feet = new Vector3(FoxIceWall.SegmentCenter(0), 0, 0);
            var hit = Enumerable.Range(0, 6).Where(i => FoxIceWall.SegmentOverlaps(feet, i, 0.35f, 1.8f)).ToList();
            CollectionAssert.Contains(hit, 0);
            Assert.IsTrue(hit.All(i => i <= 1), "远处的段照常立起");
            Assert.IsFalse(Enumerable.Range(0, 6).Any(i => FoxIceWall.SegmentOverlaps(new Vector3(0, 0, 2), i, 0.35f, 1.8f)), "墙前 2 m 的人不挡");
            Assert.IsFalse(Enumerable.Range(0, 6).Any(i => FoxIceWall.SegmentOverlaps(new Vector3(0, 3f, 0), i, 0.35f, 1.8f)), "墙顶上方的不算");
        }

        sealed class Fox : IBuffSource
        {
            public bool active = true;
            public bool BuffActive => active;
        }

        [Test]
        public void FrostArmourCutsDamageTakenByThirtyPercentWithoutStacking()
        {
            var b = new EnemyBuffs();
            var f1 = new Fox();
            var f2 = new Fox();
            float now = Time.time;
            b.SetUntil(FoxWitchAI.FrostArmor, f1, FoxWitchAI.ArmorMods, now + FoxWitchAI.ArmorDuration);
            Assert.AreEqual(0.7f, b.Total.taken, 1e-6f, "承伤 ×0.7");
            Assert.AreEqual(1f, b.Total.damage, "霜甲不改输出");
            b.SetUntil(FoxWitchAI.FrostArmor, f2, FoxWitchAI.ArmorMods, now + FoxWitchAI.ArmorDuration);
            Assert.AreEqual(0.7f, b.Total.taken, 1e-6f, "两只狐巫不叠加");
            // 和邪飞天光环是不同通道：相乘
            b.SetUntil(EnemyBuffs.ApsaraAura, new Fox(), ApsaraAI.AuraMods, now + 100);
            Assert.AreEqual(0.7f * 0.75f, b.Total.taken, 1e-6f);
            b.RemoveChannel(EnemyBuffs.ApsaraAura);
            // 碎镜：她给的立刻失效；另一只还在给
            f1.active = false;
            b.Tick(now);
            Assert.AreEqual(0.7f, b.Total.taken, 1e-6f);
            f2.active = false;
            Assert.IsFalse(b.Has(FoxWitchAI.FrostArmor), "碎镜 / 死亡后查询立刻按失效算");
            b.Tick(now);
            Assert.AreEqual(1f, b.Total.taken);
            // 5 s 到期
            var c = new EnemyBuffs();
            c.SetUntil(FoxWitchAI.FrostArmor, new Fox(), FoxWitchAI.ArmorMods, now + FoxWitchAI.ArmorDuration);
            c.Tick(now + 4.9f);
            Assert.AreEqual(0.7f, c.Total.taken, 1e-6f);
            c.Tick(now + 5.1f);
            Assert.AreEqual(1f, c.Total.taken, "5 s 后撤掉");
        }

        [Test]
        public void MirrorBeamNeedsThePlayerOnTheLine()
        {
            var from = new Vector3(0, 1.3f, 0.6f);
            var chest = new Vector3(0, 1.1f, 15);
            var dir = (chest - from).normalized;
            Assert.IsTrue(FoxWitchAI.MirrorBeamHits(from, dir, 35, chest, 0.35f), "开阔地命中");
            Assert.IsFalse(FoxWitchAI.MirrorBeamHits(from, dir, 11, chest, 0.35f), "光束在 11 m 处被挡住：打不到后面的人");
            Assert.IsFalse(FoxWitchAI.MirrorBeamHits(from, dir, 35, chest + Vector3.right * 0.7f, 0.35f), "横移出 0.6 m 判定带就躲开");
            Assert.IsFalse(FoxWitchAI.MirrorBeamHits(from, -dir, 35, chest, 0.35f), "身后不算");
            Assert.AreEqual((0.7f, 1.5f), (FoxWitchAI.MirrorSlow, FoxWitchAI.MirrorSlowTime), "命中寒意 70% 1.5 s");
            Assert.AreEqual(0.3f, FoxWitchAI.MirrorBreak, "铜镜累计吃到最大生命 30% 才碎");
            Assert.AreEqual(1.6f, FoxWitchAI.MirrorTrack, "蓄光时瞄准线 1.6 rad/s 跟着玩家");
            Assert.AreEqual(2, FoxWitchAI.MaxWalls, "每只狐巫最多两道冰壁");
        }

        // ───────────── 冰灯水母 ─────────────

        [Test]
        public void LanternJellyLinksTheThreeMostWoundedAlliesFirst()
        {
            // TS：a 50/100 @4 m、b 80/100 @6 m、c 20/100 @5.8 m、d 10/100 @8 m → 连 d、c、a
            var list = new List<LanternJellyAI.LinkCandidate>
            {
                new() { index = 0, fraction = 0.5f, distance = 4 },
                new() { index = 1, fraction = 0.8f, distance = 6 },
                new() { index = 2, fraction = 0.2f, distance = 5.8f },
                new() { index = 3, fraction = 0.1f, distance = 8 },
            };
            list.Sort(LanternJellyAI.CompareNeed);
            CollectionAssert.AreEqual(new[] { 3, 2, 0 }, list.Take(LanternJellyAI.LinkMax).Select(c => c.index).ToArray());
            // 缺血一样时连近的
            var tie = new List<LanternJellyAI.LinkCandidate>
            {
                new() { index = 0, fraction = 0.4f, distance = 9 },
                new() { index = 1, fraction = 0.4f, distance = 3 },
            };
            tie.Sort(LanternJellyAI.CompareNeed);
            Assert.AreEqual(1, tie[0].index);
            Assert.AreEqual((12f, 3), (LanternJellyAI.LinkRange, LanternJellyAI.LinkMax));
        }

        [Test]
        public void LanternJellyHealsFourPercentPerSecond()
        {
            float hp = 50;
            for (int i = 0; i < Mathf.RoundToInt(2f / Dt); i++) hp += LanternJellyAI.HealStep(hp, 100, false, Dt);
            Assert.AreEqual(58f, hp, 0.25f, "2 s 回 8（4%/s × 100）");
            Assert.AreEqual(1f, LanternJellyAI.HealStep(99, 100, false, 1f), 1e-6f, "不超过缺的血");
            Assert.AreEqual(0f, LanternJellyAI.HealStep(100, 100, false, 1f));
            Assert.AreEqual(5f, LanternJellyAI.HealStep(0, 100, true, 1f), 1e-5f, "精英 ×1.25");
            Assert.AreEqual((2.5f, 3f, 1.2f), (LanternJellyAI.LosRetry, LanternJellyAI.CrossRetry, LanternJellyAI.StaggerRetry), "三种断开各自的重连冷却");
            Assert.AreEqual(0.12f, LanternJellyAI.StaggerFrac, "灯芯累计 12% 最大生命就缩一下");
        }

        [Test]
        public void PlayerSteppingThroughATendrilSnapsIt()
        {
            var a = new Vector3(0, 1, 0);
            var b = new Vector3(9, 1, 0);
            Assert.IsTrue(LanternJellyAI.BodyCrossesSegment(a, b, new Vector3(4.5f, 0, 0), 1.8f, 0.4f), "站到触须中段下面");
            Assert.IsFalse(LanternJellyAI.BodyCrossesSegment(a, b, new Vector3(4.5f, 0, 3), 1.8f, 0.4f), "旁边 3 m 不算");
            Assert.IsFalse(LanternJellyAI.BodyCrossesSegment(a + Vector3.up * 2, b + Vector3.up * 2, new Vector3(4.5f, 0, 0), 1.8f, 0.4f), "从头顶过去的不算");
        }

        [Test]
        public void LanternJellyShockRingReachesFiveAndAHalfMetres()
        {
            var ground = Vector3.zero;
            float pad = 0.35f * 0.5f;
            Assert.IsTrue(HazardZone.Contains(ground, LanternJellyAI.ShockRange, 0, pad, -0.6f, LanternJellyAI.ShockRise, new Vector3(3, 0, 0)), "3 m 内被电");
            Assert.IsFalse(HazardZone.Contains(ground, LanternJellyAI.ShockRange, 0, pad, -0.6f, LanternJellyAI.ShockRise, new Vector3(0, 0, 12)), "远处安全");
            Assert.AreEqual((0.8f, 0.4f, 1f), (LanternJellyAI.ShockWindup, LanternJellyAI.ShockSlow, LanternJellyAI.ShockSlowTime), "前摇 0.8 s，寒意 40% 1 s");
        }
    }
}
