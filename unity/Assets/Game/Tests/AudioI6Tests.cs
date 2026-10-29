using NUnit.Framework;

namespace Spiritfire.Game.Tests
{
    /// <summary>音频超越（I6）：分层的距离配比、遮挡、每章声床与混响底</summary>
    public class AudioI6Tests
    {
        [Test]
        public void LayersKeepTheCrackNearAndTheTailFar()
        {
            // 近处三层都在（k = 1）
            Assert.That(GameAudio.LayerGain(GameAudio.LayerTransient, 2f, 1f), Is.EqualTo(1f).Within(1e-5f));
            Assert.That(GameAudio.LayerGain(GameAudio.LayerBody, 2f, 1f), Is.EqualTo(1f).Within(1e-5f));
            Assert.That(GameAudio.LayerGain(GameAudio.LayerTail, 2f, 1f), Is.EqualTo(1f).Within(1e-5f));
            // 25 m 外听不到「咔」
            Assert.That(GameAudio.LayerGain(GameAudio.LayerTransient, 26f, 0.37f), Is.EqualTo(0f).Within(1e-5f));
            // 尾音比主体衰减得缓：远处剩轰鸣和回声
            for (float k = 0.1f; k < 1f; k += 0.2f)
                Assert.That(GameAudio.LayerGain(GameAudio.LayerTail, 20f, k), Is.GreaterThan(GameAudio.LayerGain(GameAudio.LayerBody, 20f, k)), $"k = {k}");
        }

        [Test]
        public void OcclusionMufflesAndQuietens()
        {
            float lp = 0, gain = 1;
            AudioOcclusion.Apply(ref lp, ref gain);
            Assert.That(lp, Is.EqualTo(AudioOcclusion.CutoffHz));
            Assert.That(gain, Is.LessThan(1f).And.GreaterThan(0.4f));
            float lp2 = 900, gain2 = 1;
            AudioOcclusion.Apply(ref lp2, ref gain2);
            Assert.That(lp2, Is.EqualTo(900f), "原来已经更闷（远处）就不往回调");
        }

        [Test]
        public void EachChapterHasItsBedAndEnclosedLevelsRingMore()
        {
            Assert.That(AmbienceDirector.BedFor(1), Is.EqualTo("amb_desert"));
            Assert.That(AmbienceDirector.BedFor(2), Is.EqualTo("amb_frost"));
            Assert.That(AmbienceDirector.BedFor(3), Is.EqualTo("amb_inferno"));
            Assert.That(AmbienceDirector.BedFor(9), Is.EqualTo("amb_desert"), "未知章节按第一章");
            Assert.That(AmbienceDirector.ReverbBaseDb(1, "L1_1_GobiRoad"), Is.LessThan(AmbienceDirector.ReverbBaseDb(2, "L2_1_Icefall")), "沙漠开阔、混响最少");
            Assert.That(AmbienceDirector.ReverbBaseDb(3, "L3_2_ForgeWell"), Is.GreaterThan(AmbienceDirector.ReverbBaseDb(3, "L3_1_Causeway")), "铸神井（封闭）比熔湖堤道更响");
            Assert.That(AmbienceDirector.ReverbBaseDb(3, "L3_4_Zhurong"), Is.LessThanOrEqualTo(0f));
        }
    }
}
