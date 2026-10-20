using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 首领危险物（B1，docs/unity-parity.md 3.9）的纯几何与定义：线段最近距离、光束打胶囊、光束扫掠（低帧率一帧扫过玩家也不漏、跳过 / 射程外 / 身前死区不算）、
    /// 冲击波环带（玩家半径放宽、高度、扇形）、圆柱范围、抛物线，以及「危险物样机」的定义自检与参考招式清单。
    /// </summary>
    public sealed class BossHazardTests
    {
        const float Pr = 0.35f, Ph = 1.8f;

        // ───────────── 线段 ─────────────

        [Test]
        public void SegSegDistance_MatchesClosedForms()
        {
            // 平行：相距 2
            Assert.AreEqual(4f, BossHazards.SegSegDistSq(new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(0, 2, 0), new Vector3(10, 2, 0)), 1e-4f);
            // 十字交叉：0
            Assert.AreEqual(0f, BossHazards.SegSegDistSq(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 1, 0)), 1e-5f);
            // 端点最近：(1,0,0) 到 (3,0,0)
            Assert.AreEqual(4f, BossHazards.SegSegDistSq(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(3, 0, 0), new Vector3(3, 0, 0)), 1e-4f);
            // 两个点
            Assert.AreEqual(25f, BossHazards.SegSegDistSq(Vector3.zero, Vector3.zero, new Vector3(3, 4, 0), new Vector3(3, 4, 0)), 1e-4f);
        }

        [Test]
        public void BeamSegment_HitsCapsuleAtKneeHeight_MissesOverHead()
        {
            var feet = new Vector3(0, 0, 10);
            Assert.IsTrue(BossHazards.SegmentHitsCapsule(new Vector3(-5, 0.55f, 10), new Vector3(5, 0.55f, 10), 0.22f, feet, Pr, Ph));
            Assert.IsFalse(BossHazards.SegmentHitsCapsule(new Vector3(-5, 2.6f, 10), new Vector3(5, 2.6f, 10), 0.22f, feet, Pr, Ph));
            // 从侧面 1 m 外擦过：半径 0.22 + 0.35 不够
            Assert.IsFalse(BossHazards.SegmentHitsCapsule(new Vector3(-5, 1f, 11f), new Vector3(5, 1f, 11f), 0.22f, feet, Pr, Ph));
        }

        [Test]
        public void AngleDiff_WrapsToHalfOpenPi()
        {
            Assert.AreEqual(0.2f, BossHazards.AngleDiff(Mathf.PI - 0.1f, -Mathf.PI + 0.1f), 1e-4f);
            Assert.AreEqual(-0.2f, BossHazards.AngleDiff(-Mathf.PI + 0.1f, Mathf.PI - 0.1f), 1e-4f);
            Assert.AreEqual(1f, BossHazards.AngleDiff(0, 1), 1e-5f);
        }

        // ───────────── 光束扫掠 ─────────────

        static bool Sweep(float prevDeg, float curDeg, Vector3 feet) =>
            BossHazards.BeamSweepHits(Vector3.zero, 0, prevDeg * Mathf.Deg2Rad, curDeg * Mathf.Deg2Rad, ColossusRef.BeamY, ColossusRef.BeamRadius, ColossusRef.BeamStart,
                ColossusRef.BeamRange, feet, Pr, Ph, out _, out _);

        [Test]
        public void BeamSweep_HitsInsideSweptSector_MissesOutside()
        {
            var player = new Vector3(0, 0, 10); // yaw 0
            Assert.IsTrue(Sweep(-5, 5, player));
            Assert.IsTrue(Sweep(5, -5, player), "反向扫一样算");
            Assert.IsFalse(Sweep(20, 40, player));
            Assert.IsFalse(Sweep(-40, -20, player));
        }

        [Test]
        public void BeamSweep_LowFrameRateDoesNotSkipPlayer()
        {
            // 10 fps、1.95 rad/s：一帧转 11°，玩家落在两帧光束之间也算被扫到
            var player = new Vector3(Mathf.Sin(5.5f * Mathf.Deg2Rad), 0, Mathf.Cos(5.5f * Mathf.Deg2Rad)) * 12f;
            Assert.IsTrue(Sweep(0, 11, player));
            bool segAtFrames = BossHazards.SegmentHitsCapsule(new Vector3(0, 0.55f, 3), new Vector3(0, 0.55f, 39), 0.22f, player, Pr, Ph)
                               || BossHazards.SegmentHitsCapsule(new Vector3(Mathf.Sin(11 * Mathf.Deg2Rad) * 3, 0.55f, Mathf.Cos(11 * Mathf.Deg2Rad) * 3),
                                   new Vector3(Mathf.Sin(11 * Mathf.Deg2Rad) * 39, 0.55f, Mathf.Cos(11 * Mathf.Deg2Rad) * 39), 0.22f, player, Pr, Ph);
            Assert.IsFalse(segAtFrames, "只看两帧的光束线段会漏掉（扫掠判定存在的理由）");
        }

        [Test]
        public void BeamSweep_JumpOverRangeAndDeadZone()
        {
            Assert.IsFalse(Sweep(-5, 5, new Vector3(0, 1.0f, 10)), "脚底离地 1 m：跳过去了");
            Assert.IsTrue(Sweep(-5, 5, new Vector3(0, 0.6f, 10)), "脚底 0.6 m：还没跳过");
            Assert.IsFalse(Sweep(-5, 5, new Vector3(0, 0, 45)), "射程外");
            Assert.IsFalse(Sweep(-5, 5, new Vector3(0, 0, 1.5f)), "身前起点以内（贴身）不在光束上");
        }

        // ───────────── 冲击波 / 范围 / 抛物线 ─────────────

        [Test]
        public void WaveBand_UsesPlayerRadiusHeightAndArc()
        {
            var c = Vector3.zero;
            // 环带 [5 − 0.45, 6 + 0.45]，玩家半径放宽
            Assert.IsTrue(BossHazards.WaveTouches(c, 5, 6, 0.45f, 0.85f, true, 0, 0, new Vector3(0, 0, 6.7f), Pr));
            Assert.IsFalse(BossHazards.WaveTouches(c, 5, 6, 0.45f, 0.85f, true, 0, 0, new Vector3(0, 0, 7.2f), Pr));
            Assert.IsFalse(BossHazards.WaveTouches(c, 5, 6, 0.45f, 0.85f, true, 0, 0, new Vector3(0, 0, 3.9f), Pr), "已经扫过去了");
            Assert.IsFalse(BossHazards.WaveTouches(c, 5, 6, 0.45f, 0.85f, true, 0, 0, new Vector3(0, 1f, 5.5f), Pr), "跳过");
            // 扇形：中线 +Z、半角 64.7°
            float half = WarlordRef.SweepHalf * Mathf.Deg2Rad;
            Assert.IsTrue(BossHazards.WaveTouches(c, 5, 6, 0.65f, 1f, false, 0, half, new Vector3(3, 0, 4.6f), Pr));
            Assert.IsFalse(BossHazards.WaveTouches(c, 5, 6, 0.65f, 1f, false, 0, half, new Vector3(0, 0, -5.5f), Pr), "背后");
            Assert.IsFalse(BossHazards.WaveTouches(c, 5, 6, 0.65f, 1f, false, 0, half, new Vector3(5.5f, 0, -0.5f), Pr), "侧后方扇区外");
        }

        [Test]
        public void Blast_IsAHeightLimitedCylinder()
        {
            var c = new Vector3(0, 0, 0);
            Assert.IsTrue(BossHazards.InBlast(c, 3.6f, 2.2f, new Vector3(3.9f, 0, 0), Pr), "半径 + 玩家半径以内");
            Assert.IsFalse(BossHazards.InBlast(c, 3.6f, 2.2f, new Vector3(4.0f, 0, 0), Pr));
            Assert.IsFalse(BossHazards.InBlast(c, 3.6f, 2.2f, new Vector3(0, 2.3f, 0), Pr), "高于上限");
            Assert.IsFalse(BossHazards.InBlast(c, 3.6f, 2.2f, new Vector3(0, -1.6f, 0), Pr), "低于中心 1.5 m 以上");
            Assert.IsTrue(BossHazards.InBlast(c, 3.6f, 2.2f, new Vector3(0, -1.4f, 0), Pr));
        }

        [Test]
        public void LobArc_StartsEndsAndPeaksMidway()
        {
            var a = new Vector3(0, 2, 0);
            var b = new Vector3(10, 0, 0);
            Assert.AreEqual(a, BossHazards.LobPosition(a, b, 5, 0));
            Assert.AreEqual(b, BossHazards.LobPosition(a, b, 5, 1));
            var mid = BossHazards.LobPosition(a, b, 5, 0.5f);
            Assert.AreEqual(1f + 5f, mid.y, 1e-4f, "中点 = 两端高度中点 + arc");
            Assert.AreEqual(b, BossHazards.LobPosition(a, b, 5, 3), "进度夹到 1");
        }

        // ───────────── 定义 ─────────────

        [Test]
        public void HazardLab_IsRegisteredValidAndCarriesEveryReferenceMove()
        {
            var def = Bosses.Get(ReferenceBossDef.Id);
            Assert.IsNotNull(def, "危险物样机已登记");
            CollectionAssert.IsEmpty(def.Validate());
            var moves = ReferenceBossDef.All.Select(f => f()).ToList();
            Assert.AreEqual(14, moves.Count);
            Assert.IsTrue(moves.All(m => m is ReferenceMove), "全部是参考招式");
            CollectionAssert.AllItemsAreUnique(moves.Select(m => m.Id));
            var prefixes = new HashSet<string>(moves.Select(m => m.Id.Split('_')[0]));
            CollectionAssert.AreEquivalent(new[] { "colossus", "matriarch", "warlord" }, prefixes);
            Assert.AreEqual(2, def.phases.Count, "两道阈值：二、三阶段的变体都能出到");
            foreach (var m in moves)
            {
                Assert.Greater(m.windup, 0, $"{m.Id} 有前摇");
                Assert.Greater(m.cooldown, 0, $"{m.Id} 有冷却");
            }
        }

        [Test]
        public void SpecDefaults_MatchThreeJs()
        {
            var w = new BossWaveSpec(Vector3.zero, 11.5f, 34, 20, Color.white);
            Assert.AreEqual(0.5f, w.startRadius);
            Assert.AreEqual(0.9f, w.width);
            Assert.AreEqual(0.85f, w.height);
            Assert.IsTrue(w.FullCircle);
            var z = new BossZoneSpec(Vector3.zero, 2, 3, 4, Color.white);
            Assert.AreEqual(0.4f, z.arm);
            Assert.AreEqual(0.5f, z.interval);
            Assert.AreEqual(0.6f, z.maxHeight);
            Assert.AreEqual(Element.Fire, z.element);
            var e = new BossEruptSpec(Vector3.zero, 1.15f, 0.85f, 20, Color.white, SpikeKind.Rock);
            Assert.AreEqual(1.3f, e.height);
            Assert.IsTrue(e.warn);
            var l = new BossLobSpec(Vector3.zero, Vector3.one, 1.25f, 0, 3, 22, Color.white, LobKind.Meteor);
            Assert.IsTrue(l.warn);
        }
    }
}
