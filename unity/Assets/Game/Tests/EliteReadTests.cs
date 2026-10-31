using NUnit.Framework;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 精英远读（第二批收尾 D 路）：头顶印章的距离淡入 / 屏幕大小 / 让准星、元素结构（挂在精英血条顶上）；
    /// 飞行精英的金环投地判定（飞行 AI、定义标了 flying 的认作悬浮）；碎刃光点顶点色的「sRGB × HDR 倍率 → 线性」拆分。
    /// 画面效果（印章远读、金环贴地）在 elite-read 冒烟里拍。
    /// </summary>
    public sealed class EliteReadTests
    {
        [Test]
        public void SealFadesInWithDistance()
        {
            Assert.AreEqual(0f, EliteSeal.FadeAt(3f), "近处不画");
            Assert.AreEqual(0f, EliteSeal.FadeAt(EliteSeal.NearHide), "6 m 以内不画");
            Assert.That(EliteSeal.FadeAt(7.5f), Is.InRange(0.2f, 0.8f), "6–9 m 之间淡入");
            Assert.AreEqual(1f, EliteSeal.FadeAt(EliteSeal.NearFull), 1e-4f);
            Assert.AreEqual(1f, EliteSeal.FadeAt(30f), 1e-4f);
            for (float d = 0; d < 40; d += 0.5f)
                Assert.LessOrEqual(EliteSeal.FadeAt(d), EliteSeal.FadeAt(d + 0.5f) + 1e-5f, "距离越远越不淡（单调）");
        }

        [Test]
        public void SealKeepsReadableSizeFarAway()
        {
            Assert.AreEqual(EliteSeal.PxNear, EliteSeal.PixelsAt(EliteSeal.NearFull), 1e-3f);
            Assert.AreEqual(EliteSeal.PxFar, EliteSeal.PixelsAt(45f), 1e-3f, "30 m 以外不再变大");
            Assert.GreaterOrEqual(EliteSeal.PixelsAt(25f), 24f, "远处至少 24 像素（纹样读得出）");
            Assert.LessOrEqual(EliteSeal.PixelsAt(25f), 34f, "也不会大得喧宾夺主");
            Assert.Less(EliteSeal.PixelsAt(10f), EliteSeal.PixelsAt(25f), "远处略大一点，抵掉身体变小");
        }

        [Test]
        public void SealGivesWayToCrosshair()
        {
            Assert.AreEqual(1f, EliteSeal.AimFade(200f), 1e-4f);
            Assert.AreEqual(1f, EliteSeal.AimFade(EliteSeal.AimClear), 1e-4f);
            Assert.AreEqual(EliteSeal.AimAlpha, EliteSeal.AimFade(0f), 1e-4f, "压在准星上时淡到 0.35");
            Assert.Less(EliteSeal.AimFade(45f), 1f);
        }

        [Test]
        public void SealSitsOnTopOfTheBar()
        {
            var bar = new VisualElement();
            var seal = new EliteSeal(bar);
            Assert.AreSame(bar, seal.Root.parent, "印章是血条的子元素（跟着血条走、一起淡出）");
            Assert.AreEqual(Position.Absolute, seal.Root.style.position.value, "绝对定位：不挤血条的排版");
            Assert.AreEqual(DisplayStyle.None, seal.Root.style.display.value, "没分给精英之前不显示");
            seal.Bind(null, false);
            Assert.AreEqual(DisplayStyle.None, seal.Root.style.display.value, "普通敌人没有印章");
            seal.Bind(null, true);
            Assert.AreEqual(DisplayStyle.Flex, seal.Root.style.display.value);
            Assert.AreEqual(EliteSigil.None, seal.Sigil, "没有金环 / 词缀：四芒金星");
            seal.Tick(3f, 1.2f, new Vector2(960, 500), new Vector2(1920, 1080), 30f);
            Assert.AreEqual(0f, seal.Alpha, "3 m：不画");
            seal.Tick(20f, 0.7f, new Vector2(400, 300), new Vector2(1920, 1080), 30f);
            Assert.AreEqual(1f, seal.Alpha, 0.02f, "20 m、离准星远：满");
            Assert.AreEqual(EliteSeal.PixelsAt(20f), seal.Pixels, 1e-3f);
            Assert.AreEqual(EliteSeal.PixelsAt(20f) / EliteSeal.Width / 0.7f, seal.Root.style.scale.value.value.x, 1e-3f, "缩放抵掉血条自己的缩放");
            seal.Unbind();
            Assert.AreEqual(DisplayStyle.None, seal.Root.style.display.value);
        }

        [Test]
        public void SealTexturesHaveMips()
        {
            var f = EliteSealTextures.Frame;
            Assert.AreEqual(EliteSealTextures.W, f.width);
            Assert.AreEqual(EliteSealTextures.H, f.height);
            Assert.Greater(f.mipmapCount, 1, "带 mipmap：缩到 25 像素不闪");
            Assert.IsNotNull(EliteSealTextures.Core);
        }

        [Test]
        public void FlyersAreHoverAndWalkersAreNot()
        {
            Assert.IsTrue(EliteAura.IsHover(true, null), "飞行 AI：金环投到地面");
            Assert.IsTrue(EliteAura.IsHover(false, "apsara"), "定义里标了 flying（邪飞天浮在半空）");
            Assert.IsTrue(EliteAura.IsHover(false, "fire_crow"));
            Assert.IsFalse(EliteAura.IsHover(false, "jerboa_blade"), "地上走的金环挂在脚下");
            Assert.IsFalse(EliteAura.IsHover(false, null));
            Assert.IsFalse(EliteAura.IsHover(null));
        }

        [Test]
        public void GlintVertexColorSplitsHdrFromHue()
        {
            var purple = new Color(0.604f, 0.361f, 1f, 1f);
            var plain = BladeGlints.Vertex(purple);
            Assert.AreEqual(FxVertexColor.Linear(purple).r, plain.r, 1e-4f, "不超过 1 的直接转线性");
            var hdr = BladeGlints.Vertex(new Color(purple.r * 2.2f, purple.g * 2.2f, purple.b * 2.2f, 0.7f));
            Assert.AreEqual(plain.r * 2.2f, hdr.r, 1e-3f, "HDR 倍率不进幂次：色相转线性、倍率原样乘回");
            Assert.AreEqual(plain.g * 2.2f, hdr.g, 1e-3f);
            Assert.AreEqual(2.2f, hdr.b, 1e-3f);
            Assert.AreEqual(0.7f, hdr.a, 1e-5f, "alpha 不变");
        }
    }
}
