using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 熔心魔将 · 剑士化 v2（docs/art/vfx/warlord.md 第 13 章）的纯函数：判定几何（扇形 / 长条 / 环带 / 飞行剑气扫过的长方体）、
    /// 各阶段的剑气编排、居合纳刀与回旋二连的间隔（按片段事件位置推出来）。
    /// </summary>
    public sealed class WarlordSwordTests
    {
        const float Pr = 0.4f;

        [Test]
        public void Sector_MatchesTheWarning()
        {
            var o = Vector3.zero;
            Assert.IsTrue(WarlordSword.InSector(o, 0f, 52f, 4.8f, new Vector3(0, 0, 4.8f), Pr, 3f), "正前方边上");
            Assert.IsFalse(WarlordSword.InSector(o, 0f, 52f, 4.8f, new Vector3(0, 0, 5.5f), Pr, 3f), "超出半径");
            Assert.IsFalse(WarlordSword.InSector(o, 0f, 52f, 4.8f, new Vector3(0, 0, -2f), Pr, 3f), "身后");
            Assert.IsTrue(WarlordSword.InSector(o, 90f, 40f, 4.4f, new Vector3(3f, 0, 0.5f), Pr, 3f), "朝右的扇形");
            Assert.IsFalse(WarlordSword.InSector(o, 0f, 52f, 4.8f, new Vector3(0, 3.5f, 2f), Pr, 3f), "跳得够高");
        }

        [Test]
        public void Lane_CoversLengthAndWidth()
        {
            var from = new Vector3(1, 0, 1);
            var dir = Vector3.right;
            Assert.IsTrue(WarlordSword.InLane(from, dir, 10f, 1.5f, new Vector3(9, 0, 2.6f), Pr, 3f));
            Assert.IsFalse(WarlordSword.InLane(from, dir, 10f, 1.5f, new Vector3(9, 0, 3.2f), Pr, 3f), "侧面出了线宽");
            Assert.IsFalse(WarlordSword.InLane(from, dir, 10f, 1.5f, new Vector3(12f, 0, 1f), Pr, 3f), "线尾之外");
            Assert.IsFalse(WarlordSword.InLane(from, dir, 10f, 1.5f, new Vector3(-1f, 0, 1f), Pr, 3f), "线头之后");
        }

        [Test]
        public void Ring_InnerIsSafe()
        {
            var c = Vector3.zero;
            Assert.IsTrue(WarlordSword.InRing(c, 0f, 6.2f, new Vector3(6f, 0, 0), Pr, 2.2f));
            Assert.IsFalse(WarlordSword.InRing(c, 0f, 6.2f, new Vector3(7f, 0, 0), Pr, 2.2f));
            Assert.IsFalse(WarlordSword.InRing(c, 2.6f, 9f, new Vector3(1.5f, 0, 0), Pr, 2.2f), "二连的第二圈：贴身安全");
            Assert.IsTrue(WarlordSword.InRing(c, 2.6f, 9f, new Vector3(8f, 0, 0), Pr, 2.2f));
        }

        [Test]
        public void Wave_HorizontalIsJumpable_VerticalIsSidestepped()
        {
            var o = Vector3.zero;
            var dir = Vector3.forward;
            // 横剑气：宽而矮——站着被扫到，跳到 1 m 以上躲过
            Assert.IsTrue(WarlordSword.WaveSweeps(o, dir, 9f, 10f, WarlordSwordWave.HHalf, 0f, WarlordSwordWave.HTop, new Vector3(2.5f, 0, 9.5f), Pr));
            Assert.IsFalse(WarlordSword.WaveSweeps(o, dir, 9f, 10f, WarlordSwordWave.HHalf, 0f, WarlordSwordWave.HTop, new Vector3(2.5f, 1.1f, 9.5f), Pr));
            // 竖剑气：窄而高——跳不过，侧移 1.5 m 躲过
            Assert.IsTrue(WarlordSword.WaveSweeps(o, dir, 9f, 10f, WarlordSwordWave.VHalf, 0f, WarlordSwordWave.VTop, new Vector3(0.5f, 1.3f, 9.5f), Pr));
            Assert.IsFalse(WarlordSword.WaveSweeps(o, dir, 9f, 10f, WarlordSwordWave.VHalf, 0f, WarlordSwordWave.VTop, new Vector3(1.5f, 0, 9.5f), Pr));
            // 这一帧没扫到的地方
            Assert.IsFalse(WarlordSword.WaveSweeps(o, dir, 9f, 10f, WarlordSwordWave.VHalf, 0f, WarlordSwordWave.VTop, new Vector3(0, 0, 14f), Pr));
            // 横剑气的离地上限低于玩家跳高（8.6² / 2 / 26 ≈ 1.42 m），有一段可以跳过的窗口
            Assert.Less(WarlordSwordWave.HTop, 8.6f * 8.6f / (2f * 26f) - 0.3f);
        }

        [Test]
        public void WavePatterns_GrowWithPhase()
        {
            var (a0, b0) = WarlordSwordWave.Pattern(0);
            Assert.AreEqual(1, a0.Length);
            Assert.AreEqual(0, b0.Length);
            Assert.AreEqual(WarlordSwordWave.Kind.Vertical, a0[0].kind, "一阶段教竖剑气（侧移）");
            var (a1, b1) = WarlordSwordWave.Pattern(1);
            Assert.AreEqual(WarlordSwordWave.Kind.Horizontal, a1[0].kind, "二阶段先横（跳）");
            Assert.AreEqual(WarlordSwordWave.Kind.Vertical, b1[0].kind, "再竖（侧移）");
            var (a2, b2) = WarlordSwordWave.Pattern(2);
            Assert.AreEqual(4, a2.Length + b2.Length, "狂怒十字剑气：一横三竖");
            // 十字：中间那道竖剑气比横剑气快，追得上
            Assert.Greater(b2[0].speed, a2[0].speed);
        }

        [Test]
        public void Timing_DerivedFromClipEvents()
        {
            // 居合：拔刀 24 / 48、收刀 36 / 48 → 突进 + 纳刀 = 按刀 × 0.5
            Assert.AreEqual(0.95f * 0.5f - WarlordSword.IaiDash, WarlordIai.SheatheFor(0.95f), 1e-4f);
            Assert.GreaterOrEqual(WarlordIai.SheatheFor(0.3f), 0.16f, "纳刀至少 0.16 s（读得出「咔」）");
            // 回旋二连：两圈在 18 / 54、32 / 54
            Assert.AreEqual(0.6f * (32f / 18f - 1f), WarlordSpin.GapFor(0.6f), 1e-4f);
            // 横竖两刀：15 / 40、23 / 40
            Assert.AreEqual(23f / 15f, WarlordSword.CrossImpactAt / WarlordSword.CrossHitAt, 1e-4f);
        }
    }
}
