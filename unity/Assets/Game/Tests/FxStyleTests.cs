using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>特效风格审查（docs/art/review/fx-polish/style-audit.md）：章节环境色、烟尘不用灰、闪光不过曝的几条底线</summary>
    public class FxStyleTests
    {
        static float Lum(Color c) => c.r * 0.3f + c.g * 0.59f + c.b * 0.11f;

        [Test]
        public void ChapterToneKeepsSandAndShiftsFrostCoolAndInfernoPurple()
        {
            var sand = Hex.Rgb(0xc4a27a);
            Assert.That(FxTone.Ground(sand, 1), Is.EqualTo(sand), "第一章（沙寺）原样用定义里的暖沙色");
            Assert.That(FxTone.Ground(sand, 4), Is.EqualTo(sand), "没有专门调色的章节按第一章");
            var frost = FxTone.Ground(sand, 2);
            Assert.That(frost.b, Is.GreaterThan(frost.r), "霜山的烟尘偏冷（蓝 > 红）");
            Assert.That(Mathf.Max(frost.r, frost.g, frost.b), Is.LessThan(0.98f), "雪雾偏冷白，但不到纯白");
            var inferno = FxTone.Ground(sand, 3);
            Assert.That(Lum(inferno), Is.LessThan(Lum(sand)), "熔火的烟压暗一档");
            Assert.That(inferno.r, Is.GreaterThan(inferno.g), "熔火的烟偏紫褐（红、蓝都高过绿）");
            Assert.That(inferno.b, Is.GreaterThan(inferno.g));
            // 同一章里明暗顺序不变（亮的烟还是比暗的碎石亮）
            var rock = Hex.Rgb(0x6e4c34);
            Assert.That(Lum(FxTone.Ground(rock, 2)), Is.LessThan(Lum(frost)));
            Assert.That(Lum(FxTone.Ground(rock, 3)), Is.LessThan(Lum(inferno)));
        }

        [Test]
        public void ExplosionSmokeAndDebrisUseTheChapterToneAndAreNotGrey()
        {
            foreach (var id in new[] { "ExplosionSmall", "Explosion", "ExplosionLarge" })
            {
                var p = Registry<FxPreset>.Get(id);
                Assert.That(p, Is.Not.Null, id);
                var env = p.Layers.Where(l => l.style is "ToonSmoke" or "ToonDust" or "Chunk").ToArray();
                Assert.That(env, Is.Not.Empty, $"{id} 应该有烟 / 碎石");
                foreach (var l in env)
                {
                    Assert.That(l.color, Is.EqualTo(FxColor.Ground), $"{id} · {l.style}：烟尘碎屑按章节调色");
                    Assert.That(l.fixedColor.r - l.fixedColor.b, Is.GreaterThan(0.12f), $"{id} · {l.style}：沙寺的烟尘是暖色，不是灰");
                }
            }
        }

        [Test]
        public void BigFlashesAreSmallAndTinted()
        {
            // 闪光柔光球不超过 1.3 m（规模 1 时），也不是纯白：「白」留给硬边的亮芯
            foreach (var id in new[] { "ExplosionSmall", "Explosion", "ExplosionLarge", "RxMeltdown", "RxThunderfire", "RxVeinseal", "RxCollapse", "Abyss", "ShieldShatter", "ArmorChip", "Death", "SpawnFinale" })
            {
                var p = Registry<FxPreset>.Get(id);
                Assert.That(p, Is.Not.Null, id);
                foreach (var l in p.Layers.Where(l => l.style is "Glow" or "Flash" && l.count.Eval(1) <= 1.5f))
                {
                    Assert.That(l.size.y, Is.LessThanOrEqualTo(1.3f), $"{id}：闪光 {l.size.y} m 太大");
                    Assert.That(l.color, Is.Not.EqualTo(FxColor.White), $"{id}：闪光不用纯白");
                }
            }
        }
    }
}
