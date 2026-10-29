using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>手感总表（I7，docs/feel.md）：默认值与原常数一致、震屏曲线等价于 trauma²、瞄准辅助不拉过头</summary>
    public class FeelProfileTests
    {
        [Test]
        public void DefaultsMatchTheTunedConstants()
        {
            var f = ScriptableObject.CreateInstance<FeelProfile>();
            Assert.That(f.killStop, Is.EqualTo(HitStop.KillStop));
            Assert.That(f.eliteKillStop, Is.EqualTo(HitStop.EliteKillStop));
            Assert.That(f.bossKillStop, Is.EqualTo(HitStop.BossKillStop));
            Assert.That(f.critStop, Is.EqualTo(HitStop.CritStop));
            Assert.That(f.reactionStop, Is.EqualTo(HitStop.ReactionStop));
            Assert.That(f.hitStopScale, Is.EqualTo(HitStop.DefaultScale));
            Assert.That(f.hurtAberration, Is.EqualTo(GameplayVolumes.HurtAberration));
            Assert.That(f.clearSlowMoScale, Is.InRange(0.2f, 0.6f), "清场慢动作看得出、但不拖");
            Assert.That(f.clearSlowMoSeconds, Is.InRange(0.2f, 0.6f), "慢动作不超过 0.6 s 真实时间");
            Object.DestroyImmediate(f);
        }

        [Test]
        public void ShakeCurveAtExponentTwoIsTraumaSquared()
        {
            var f = ScriptableObject.CreateInstance<FeelProfile>();
            foreach (float t in new[] { 0f, 0.25f, 0.5f, 0.8f, 1f })
                Assert.That(f.ShakeAmplitude(t), Is.EqualTo(Mathf.Min(f.shakeAmpMax, t * t * CameraShake.MaxStrength)).Within(1e-5f), $"trauma {t}");
            Object.DestroyImmediate(f);
        }

        [Test]
        public void AimAssistSlowsOnTargetAndNeverOvershoots()
        {
            // 准星正压在中心：减速到 slowdown 倍
            var d = AimAssist.Apply(new Vector2(1.5f, 0), Vector2.zero, 5f, 0.5f, 0.12f);
            Assert.That(d.x, Is.EqualTo(0.75f).Within(1e-4f));
            // 生效半径外缘：几乎不减速（再加一点往目标方向的吸附）
            var edge = AimAssist.Apply(new Vector2(1.5f, 0), new Vector2(4.99f, 0), 5f, 0.5f, 0.12f);
            Assert.That(edge.x, Is.GreaterThan(1.49f));
            // 摇杆不动：不拉（不替玩家瞄）
            Assert.That(AimAssist.Apply(Vector2.zero, new Vector2(2, 1), 5f, 0.5f, 0.12f), Is.EqualTo(Vector2.zero));
            // 拉力再大也不超过剩余角差
            var err = new Vector2(0.3f, -0.2f);
            var big = AimAssist.Apply(new Vector2(0.01f, 0), err, 5f, 1f, 50f);
            Assert.That((big - new Vector2(0.01f, 0)).magnitude, Is.LessThanOrEqualTo(err.magnitude + 1e-4f));
        }
    }
}
