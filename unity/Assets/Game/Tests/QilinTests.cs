using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 火麒麟（BS4 玄鳞 + BS5 焚身）的定义、定档与炉心殿几何（port tests/inferno-boss.test.mjs 里与渲染 / 场景无关的部分）：
    ///   定义自检、血条刻度（85% / 70% 饮熔线 + 55% 换形，D23）、两个形态与各自的招式（焚身是飞行形态，换形后第一招熔流轮转）；
    ///   定档：3-4 难度 3.08 下按模拟秒伤（一阶段 + 换形演出 + 二阶段按焚身折算），锁扣砸中两次 / 一次 / 零次的整场击杀用时都落在 60–120 s
    ///   （docs/unity-parity.md 7.4），锁扣一两秒打得碎；
    ///   炉心殿：象限中线（西 / 北 / 东 / 南）、点落在哪个象限、俯视顺时针的下一个象限、熔岩渠与窄桥；
    ///   焚身：招式时间轴对齐 Three.js、熔流带贴着夹住象限的两条渠（只淹外段）、吐息从对岸扫满整个象限、从离玩家远的一侧扫起。
    /// </summary>
    public sealed class QilinTests
    {
        [Test]
        public void Def_Validates_TicksFormsAndMoves()
        {
            var def = new QilinDef();
            var errs = def.Validate();
            Assert.IsEmpty(errs, string.Join("；", errs));
            Assert.AreEqual(QilinDef.Id, def.id);
            Assert.IsTrue(def.id.StartsWith("boss"));
            CollectionAssert.AreEqual(new[] { 0.85f, 0.7f, QilinDef.TransformAt }, def.BarTicks.ToArray(), "血条刻度 = 两道饮熔线 + 换形");
            Assert.AreEqual(2, def.PhaseCount);
            Assert.AreEqual(QilinDef.BurnForm, def.phases[0].form, "55% 换焚身");
            Assert.AreEqual(1.9f, def.phases[0].SwapAt, 1e-4f, "熔岩柱最浓时换模型");
            Assert.AreEqual(QilinDef.XuanPrefab, def.FirstForm.prefab);
            Assert.AreEqual(QilinDef.BurnPrefab, def.Form(QilinDef.BurnForm).prefab);
            Assert.AreEqual("pearl", def.FirstForm.weakBone, "角根火珠是弱点");
            Assert.AreEqual(Element.Fire, def.element);

            var moves = def.moves.Select(m => m()).ToList();
            foreach (var id in new[] { ScaleGallop.MoveId, ScaleBlades.MoveId, ScaleBreath.MoveId, ScaleDrink.MoveId })
            {
                var m = moves.Single(x => x.Id == id);
                CollectionAssert.AreEqual(new[] { QilinDef.XuanForm }, m.forms, $"{id} 只在玄鳞");
            }
            var burnIds = new[] { BurnFlood.MoveId, BurnDives.MoveId, BurnPant.MoveId, BurnSweep.MoveId, BurnRain.MoveId, BurnRage.MoveId };
            foreach (var id in burnIds)
                CollectionAssert.AreEqual(new[] { QilinDef.BurnForm }, moves.Single(x => x.Id == id).forms, $"{id} 只在焚身");
            Assert.AreEqual(4 + burnIds.Length, moves.Count, "玄鳞四招 + 焚身六招（占位已删）");
            Assert.AreEqual(0f, moves.Single(x => x.Id == ScaleDrink.MoveId).weight, "饮熔只由血量线排上");
            Assert.AreEqual(0f, moves.Single(x => x.Id == BurnPant.MoveId).Weight(null), "喘息只由俯冲三踏排上");
            Assert.AreEqual(0f, moves.Single(x => x.Id == BurnRage.MoveId).Weight(null), "狂怒长啸只由 15% 排上");
            Assert.AreEqual(BurnFlood.MoveId, def.Form(QilinDef.BurnForm).firstMove, "换形后第一招熔流轮转（TS swapToBurn）");
            Assert.IsTrue(def.Form(QilinDef.BurnForm).flying, "焚身踏云：飞行形态");
            Assert.IsFalse(def.FirstForm.flying);
            var heart = def.hitZones.Single(z => z.id == "heart");
            Assert.IsTrue(heart.weak);
            Assert.AreEqual(QilinDef.BurnForm, heart.form, "胸口火心只在焚身");
            Assert.AreEqual(0.15f, def.enrageBelow, 1e-4f);
            // TS restFactor：焚身 0.9，狂怒 0.65
            Assert.AreEqual(0.9f, def.phases[0].restScale, 1e-4f);
            Assert.AreEqual(0.65f, def.phases[0].restScale * def.enrageRestScale, 0.01f);
        }

        [Test]
        public void Balance_KillTimeWithinBand_AtStageDifficulty()
        {
            var def = new QilinDef();
            var v = def.VitalsAt(QilinDef.StageDifficulty);
            Assert.AreEqual(QilinDef.TierHp, v.hp, 0.5f);
            Assert.AreEqual(QilinDef.TierArmor, v.armor, 0.5f);
            Assert.AreEqual(0f, v.shield, 1e-3f);
            float dps = QilinDef.ReferenceDps(QilinDef.StageDifficulty);
            Assert.AreEqual(BossBalance.Dps("3-4") * BossBalance.Uptime, dps, 0.5f, "3-4 浸泡实测 × 输出率");
            float two = QilinDef.EstimateKillSeconds(v, dps, 2), one = QilinDef.EstimateKillSeconds(v, dps, 1), none = QilinDef.EstimateKillSeconds(v, dps, 0);
            Assert.That(two, Is.InRange(60f, 120f), $"砸中两次 {two:F0} s");
            Assert.That(one, Is.InRange(60f, 120f), $"砸中一次 {one:F0} s");
            Assert.That(none, Is.InRange(60f, 120f), $"一次都不打 {none:F0} s");
            Assert.Less(two, one, "打锁扣砸鼎要有收益");
            Assert.Less(one, none);
            // 整场 = 一阶段 + 5.2 s 换形演出 + 二阶段（焚身折算）：二阶段单独也在合理范围
            float factor = QilinDef.BurnDpsFactor;
            Assert.That(factor, Is.InRange(0.75f, 1.05f), $"焚身输出折算 × {factor:F2}");
            float phase2 = v.hp * QilinDef.TransformAt / (dps * factor);
            Assert.That(phase2, Is.InRange(25f, 55f), $"二阶段 {phase2:F0} s");
            var bare = new BossVitals(v.hp, 0, 0);
            float expect = v.hp * (1f - QilinDef.TransformAt) / dps + QilinDef.TransitionSeconds + phase2;
            Assert.AreEqual(expect, QilinDef.EstimateKillSeconds(bare, dps, 0), 0.01f, "没有护甲时 = 一阶段 + 换形演出 + 二阶段");
            QilinDef.BurnRotation(out float rot, out float pant, out float crows);
            Assert.That(rot, Is.InRange(18f, 32f), $"焚身一轮 {rot:F1} s");
            Assert.AreEqual(BurnPant.Rest, pant, 1e-4f, "一轮里落地喘息 3.5 s");
            Assert.Greater(crows, 0f);
            // Three.js 原值（5000 + 1500 护甲 × 难度）护甲是定档的近两倍：不打锁扣时饮熔回满鳞甲拖得更长——护甲按定档 2400 不跟着加
            var ts = new BossVitals(5000, 0, 1500).Scaled(QilinDef.StageDifficulty);
            Assert.Greater(QilinDef.EstimateKillSeconds(ts, dps, 0) - QilinDef.EstimateKillSeconds(ts, dps, 2), two > 0 ? none - two : 0f,
                "Three.js 的护甲下，打不打锁扣的差距比定档更大");
            // 锁扣：110 × 难度，一两秒打得碎
            float lockHp = QilinLock.BaseHp * QilinDef.StageDifficulty;
            Assert.That(lockHp / dps, Is.InRange(0.5f, 3f), $"锁扣 {lockHp:F0} 血、{lockHp / dps:F1} s");
            // 旱魃那一档也用同一个模型校一下：1-4 的定档在 60–120 s 里
            float hanba = (HanbaDef.TierHp + HanbaDef.TierShield) / QilinDef.ReferenceDps(1.48f);
            Assert.That(hanba, Is.InRange(60f, 120f), $"旱魃 {hanba:F0} s");
        }

        [Test]
        public void Furnace_Quadrants_ClockwiseAndChannels()
        {
            var go = new GameObject("furnace");
            try
            {
                var f = go.AddComponent<QilinFurnace>();
                Assert.AreEqual(4, f.QuadrantCount);
                // 渠在对角线上（−135 / −45 / 45 / 135），象限中线 = 西 / 北 / 东 / 南
                Assert.AreEqual(-90f, f.QuadrantYaw(0), 1e-3f);
                Assert.AreEqual(0f, f.QuadrantYaw(1), 1e-3f);
                Assert.AreEqual(90f, f.QuadrantYaw(2), 1e-3f);
                Assert.AreEqual(180f, Mathf.Abs(f.QuadrantYaw(3)), 1e-3f);
                Assert.AreEqual(1, f.QuadrantOf(new Vector3(2, 0, 15)), "北");
                Assert.AreEqual(2, f.QuadrantOf(new Vector3(15, 0, -3)), "东");
                Assert.AreEqual(3, f.QuadrantOf(new Vector3(-1, 0, -15)), "南");
                Assert.AreEqual(0, f.QuadrantOf(new Vector3(-15, 0, 1)), "西");
                // 俯视（北朝上）顺时针：北 → 东 → 南 → 西 → 北
                Assert.AreEqual(2, f.ClockwiseNext(1));
                Assert.AreEqual(3, f.ClockwiseNext(2));
                Assert.AreEqual(0, f.ClockwiseNext(3));
                Assert.AreEqual(1, f.ClockwiseNext(0));
                // 熔岩渠：东北渠的外段（r 19）、内段（r 8）是熔岩，窄桥（r 12）不是；象限中线上不是
                Assert.IsTrue(f.OnChannel(f.Point(45, 19)));
                Assert.IsTrue(f.OnChannel(f.Point(45, 8)));
                Assert.IsFalse(f.OnChannel(f.Point(45, 12)), "窄桥");
                Assert.IsFalse(f.OnChannel(f.Point(0, 19)));
                Assert.IsFalse(f.OnChannel(f.Point(45, 5)), "熔池里不算渠");
                // 点 / 方位互逆
                var p = f.Point(-60f, 17f);
                Assert.AreEqual(-60f, f.YawOf(p), 1e-3f);
                Assert.AreEqual(17f, f.RadiusOf(p), 1e-3f);
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void Moves_TimingMatchesThreeJs()
        {
            var blades = new ScaleBlades();
            Assert.AreEqual(1f, blades.windup, 1e-4f, "人立 1 s");
            Assert.AreEqual(36, ScaleBlades.Count);
            Assert.AreEqual(0.4f, ScaleBlades.SecondDelay, 1e-4f, "85% 以下 0.4 s 后第二圈");
            var breath = new ScaleBreath();
            Assert.AreEqual(0.8f, breath.windup, 1e-4f);
            Assert.AreEqual(1.6f, breath.active, 1e-4f);
            var gallop = new ScaleGallop();
            Assert.AreEqual(9f, gallop.cooldown, 1e-4f);
            var drink = new ScaleDrink();
            Assert.AreEqual(1f, drink.windup, 1e-4f, "1 s 跃向池边");
            var def = new QilinDef();
            Assert.AreEqual(4f, def.drinkSeconds, 1e-4f);
            Assert.AreEqual(4f, QilinDef.StunSeconds, 1e-4f);
            Assert.AreEqual(2f, QilinDef.CrackTakenMult, 1e-4f);
            Assert.AreEqual(5.2f, def.phases[0].seconds, 1e-4f, "换形演出 5.2 s");
        }

        [Test]
        public void BurnMoves_TimingMatchesThreeJs()
        {
            // 俯冲：三踏、蓄势 0.9 / 狂怒 0.7、俯冲 0.3、收势 0.45；落点 4.2 m 30、火环 13 m/s 到 15 m 16
            var dives = new BurnDives();
            Assert.AreEqual(3, BurnDives.Count);
            Assert.AreEqual(0.9f, BurnDives.Tele, 1e-4f);
            Assert.AreEqual(0.7f, BurnDives.TeleRage, 1e-4f);
            Assert.AreEqual(0.3f, BurnDives.DiveTime, 1e-4f);
            Assert.AreEqual(0.45f, BurnDives.LandRecover, 1e-4f);
            Assert.AreEqual(4.2f, BurnDives.Radius, 1e-4f);
            Assert.AreEqual(30f, BurnDives.BlastDamage, 1e-4f);
            Assert.AreEqual(16f, BurnDives.RingDamage, 1e-4f);
            Assert.AreEqual(10f, dives.cooldown, 1e-4f);
            Assert.AreEqual(2.8f, dives.weight, 1e-4f);
            // 喘息：降落 0.8、喘 3.5、起飞 0.7；起飞预警比 TS 的 0.5 s 宽松
            var pant = new BurnPant();
            Assert.AreEqual(0.8f, pant.windup, 1e-4f);
            Assert.AreEqual(3.5f, pant.active, 1e-4f);
            Assert.AreEqual(0.7f, pant.recover, 1e-4f);
            Assert.GreaterOrEqual(BurnPant.TakeoffWarn, 0.5f);
            // 吐息：蓄势 1.2、扫 2.6、半角 0.15 rad、每 0.15 s 9
            var sweep = new BurnSweep();
            Assert.AreEqual(1.2f + 2.6f + 0.3f, sweep.active, 1e-4f);
            Assert.AreEqual(0.15f * Mathf.Rad2Deg, BurnSweep.HalfBeam, 0.05f);
            Assert.AreEqual(9f, BurnSweep.TickDamage, 1e-4f);
            Assert.AreEqual(10f, sweep.cooldown, 1e-4f);
            // 熔流：冷却 34、开闸 1.2 s；预警 1.5、涨 6 / 狂怒 4、隔 0.6 / 狂怒 0.3、涨宽到 4 m；一轮（四个象限）不长于冷却
            var flood = new BurnFlood();
            Assert.AreEqual(34f, flood.cooldown, 1e-4f);
            Assert.AreEqual(1.2f, BurnFlood.OpenAt, 1e-4f);
            Assert.AreEqual(1.5f, QilinFlood.WarnSeconds, 1e-4f);
            Assert.AreEqual(6f, QilinFlood.OnSeconds, 1e-4f);
            Assert.AreEqual(4f, QilinFlood.OnSecondsRage, 1e-4f);
            Assert.AreEqual(4f, QilinFlood.FloodWidth, 1e-4f);
            Assert.LessOrEqual(4 * (QilinFlood.WarnSeconds + QilinFlood.OnSeconds + QilinFlood.GapSeconds), flood.cooldown + BurnFlood.OpenAt);
            // 火云雨：10 / 狂怒 14 颗、每 0.16 s、坠 1.25 s、半径 2.4、18；四只飞鸦
            var rain = new BurnRain();
            Assert.AreEqual(10, BurnRain.Meteors);
            Assert.AreEqual(14, BurnRain.MeteorsRage);
            Assert.AreEqual(0.16f, BurnRain.Every, 1e-4f);
            Assert.AreEqual(18f, BurnRain.Damage, 1e-4f);
            Assert.AreEqual(13f, rain.cooldown, 1e-4f);
            Assert.AreEqual(2.6f, rain.windup + rain.active + rain.recover, 1e-4f, "TS 2.6 s 收招");
            Assert.AreEqual(4, new QilinDef().rainCrows);
            // 踏云高度 4.5、俯冲蓄势 7.5
            Assert.AreEqual(4.5f, QilinBrain.SkyAlt, 1e-4f);
            Assert.AreEqual(7.5f, QilinBrain.HighAlt, 1e-4f);
        }

        /// <summary>3-4 的炉心殿几何（Level_3_4 的 QilinFurnace：熔池 7、殿墙 24、窄桥 10–14、渠半宽 0.8、渠在对角线）</summary>
        static QilinFurnace Furnace34(GameObject go)
        {
            var f = go.AddComponent<QilinFurnace>();
            f.poolRadius = 7f;
            f.wallRadius = 24f;
            f.trackRadius = 20.8f;
            f.bridgeInner = 10f;
            f.bridgeOuter = 14f;
            f.channelHalfWidth = 0.8f;
            f.channelYaws = new[] { -135f, -45f, 45f, 135f };
            return f;
        }

        [Test]
        public void Flood_Strips_HugChannelsOnQuadrantSide()
        {
            var go = new GameObject("furnace");
            try
            {
                var f = Furnace34(go);
                var strips = new List<QilinFlood.Strip>();
                for (int q = 0; q < f.QuadrantCount; q++)
                {
                    QilinFlood.Strips(f, q, strips);
                    Assert.AreEqual(2, strips.Count, $"象限 {q} 两条熔流带");
                    CollectionAssert.AreEquivalent(new[] { q, (q + 1) % 4 }, strips.Select(s => s.channel).ToArray(), "贴着夹住象限的两条渠");
                    foreach (var s in strips)
                    {
                        Assert.AreEqual(q, f.QuadrantOf(s.center), $"象限 {q} 的熔流带中心落在这个象限里");
                        Assert.AreEqual(f.channelYaws[s.channel], s.yaw, 1e-3f, "熔流带顺着渠");
                        // 总宽 4 m（含渠）：带宽 = (4 − 渠半宽) − (渠半宽 − 0.1)
                        Assert.AreEqual(QilinFlood.FloodWidth - 2f * f.channelHalfWidth + QilinFlood.Overlap, s.size.x, 1e-3f);
                        // 只淹外段：从窄桥外端到殿墙外
                        Assert.Greater(f.RadiusOf(s.from), f.bridgeOuter, "窄桥不淹");
                        Assert.Greater(f.RadiusOf(s.center) + s.size.y * 0.5f, f.wallRadius, "一直淹到殿墙");
                        // 离渠中线：内沿压进渠里 0.1 m，外沿离渠中线 4 − 渠半宽
                        var axis = new Vector3(Mathf.Sin(s.yaw * Mathf.Deg2Rad), 0, Mathf.Cos(s.yaw * Mathf.Deg2Rad));
                        var off = s.center - f.Center;
                        off -= axis * Vector3.Dot(off, axis);
                        Assert.AreEqual((f.channelHalfWidth - QilinFlood.Overlap + QilinFlood.FloodWidth - f.channelHalfWidth) * 0.5f, off.magnitude, 1e-3f);
                        // 象限中线上不淹（两条带之间留着路）
                        Assert.IsFalse(InBox(s, f.Point(f.QuadrantYaw(q), 19f)));
                        Assert.IsTrue(InBox(s, s.center));
                    }
                    // 也不压到隔壁象限的中线
                    int prev = (q + 3) % 4;
                    foreach (var s in strips) Assert.IsFalse(InBox(s, f.Point(f.QuadrantYaw(prev), 19f)));
                }
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        static bool InBox(QilinFlood.Strip s, Vector3 p)
        {
            var d = p - s.center;
            float a = s.yaw * Mathf.Deg2Rad;
            var fwd = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
            var right = new Vector3(Mathf.Cos(a), 0, -Mathf.Sin(a));
            return Mathf.Abs(Vector3.Dot(d, right)) <= s.size.x * 0.5f && Mathf.Abs(Vector3.Dot(d, fwd)) <= s.size.y * 0.5f;
        }

        [Test]
        public void Sweep_Plan_FromFarBankAcrossWholeQuadrant()
        {
            var go = new GameObject("furnace");
            try
            {
                var f = Furnace34(go);
                for (int q = 0; q < f.QuadrantCount; q++)
                {
                    float qy = f.QuadrantYaw(q);
                    // 玩家站在象限中线偏方位大的一侧（靠 channelYaws[q + 1] 那条渠）
                    var player = f.Point(qy + 25f, 18f);
                    BurnSweep.Plan(f, q, player, out var spot, out float y0, out float y1, out float range);
                    Assert.AreEqual(f.poolRadius + BurnSweep.SpotOut, f.RadiusOf(spot), 1e-3f, "落在熔池外 2.2 m");
                    Assert.AreEqual(0f, Mathf.DeltaAngle(qy + 180f, f.YawOf(spot)), 1e-3f, "落在对岸");
                    float span = Mathf.Abs(Mathf.DeltaAngle(y0, y1));
                    Assert.That(span, Is.InRange(55f, 80f), $"象限 {q} 扫 {span:F0}°");
                    // 两端正对着夹住象限的两条渠在殿墙边的端点：从离玩家远的那条（方位小的一侧）扫起
                    var a = f.Point(f.channelYaws[q], f.wallRadius - 1f);
                    var b = f.Point(f.channelYaws[(q + 1) % 4], f.wallRadius - 1f);
                    float ya = Mathf.Atan2(a.x - spot.x, a.z - spot.z) * Mathf.Rad2Deg, yb = Mathf.Atan2(b.x - spot.x, b.z - spot.z) * Mathf.Rad2Deg;
                    Assert.AreEqual(0f, Mathf.DeltaAngle(y0, ya), 1e-3f, "从离玩家远的那条渠扫起");
                    Assert.AreEqual(0f, Mathf.DeltaAngle(y1, yb), 1e-3f, "扫到玩家那一侧");
                    Assert.Greater(range, Vector3.Distance(spot, f.Point(qy, f.wallRadius - 2f)), "射程从落点算就够到殿墙跟前（口在落点前面几米，实际更远）");
                    // 象限中线上的点在扫过的扇形里
                    var mid = f.Point(qy, 16f);
                    float ym = Mathf.Atan2(mid.x - spot.x, mid.z - spot.z) * Mathf.Rad2Deg;
                    Assert.LessOrEqual(Mathf.Abs(Mathf.DeltaAngle(y0, ym)) + Mathf.Abs(Mathf.DeltaAngle(ym, y1)), span + 0.01f);
                    // 玩家换到另一侧：扫的方向反过来
                    BurnSweep.Plan(f, q, f.Point(qy - 25f, 18f), out _, out float z0, out float z1, out _);
                    Assert.AreEqual(0f, Mathf.DeltaAngle(z0, yb), 1e-3f);
                    Assert.AreEqual(0f, Mathf.DeltaAngle(z1, ya), 1e-3f);
                }
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }
    }
}
