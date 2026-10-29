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
    
        // ───────────── 收尾一轮：元素爆炸 / 冰爆 / 着色器 ─────────────

        [Test]
        public void ExplosionColorsMapToTheirElement()
        {
            Assert.That(Fx.BlastThemeOf(Fx.ExplosionColor), Is.EqualTo(BlastTheme.Fire));
            Assert.That(Fx.BlastThemeOf(Fx.ElementColor(Element.Fire)), Is.EqualTo(BlastTheme.Fire));
            Assert.That(Fx.BlastThemeOf(Fx.ElementColor(Element.None)), Is.EqualTo(BlastTheme.Fire), "无元素的暖白是火");
            Assert.That(Fx.BlastThemeOf(Hex.Rgb(0xd9b27a)), Is.EqualTo(BlastTheme.Fire), "沙色是火（土爆）");
            Assert.That(Fx.BlastThemeOf(Hex.Rgb(0xff6a1a)), Is.EqualTo(BlastTheme.Fire), "熔岩色是火");
            Assert.That(Fx.BlastThemeOf(Fx.ElementColor(Element.Shock)), Is.EqualTo(BlastTheme.Shock));
            Assert.That(Fx.BlastThemeOf(Fx.LightningColor), Is.EqualTo(BlastTheme.Shock));
            Assert.That(Fx.BlastThemeOf(Fx.ElementColor(Element.Corrode)), Is.EqualTo(BlastTheme.Corrode));
            Assert.That(Fx.BlastThemeOf(CombatTuning.ReactionColors[(int)Reaction.Thunderfire]), Is.EqualTo(BlastTheme.Gold), "焚雷的金");
            Assert.That(Fx.BlastThemeOf(Fx.AbyssColor), Is.EqualTo(BlastTheme.Spirit));
            Assert.That(Fx.BlastThemeOf(Hex.Rgb(0x9a5cff)), Is.EqualTo(BlastTheme.Spirit), "碎刃的紫");
            Assert.That(Fx.BlastThemeOf(FrostPalette.Ice), Is.EqualTo(BlastTheme.Ice));
            Assert.That(Fx.BlastThemeOf(FrostPalette.IceDeep), Is.EqualTo(BlastTheme.Ice));
            Assert.That(Fx.BlastThemeOf(Hex.Rgb(0xd8f6ff)), Is.EqualTo(BlastTheme.Ice), "淡冰蓝是冰");
        }

        [Test]
        public void ElementExplosionsHaveTheirOwnPaletteAndNoFireBits()
        {
            foreach (var t in new[] { BlastTheme.Shock, BlastTheme.Corrode, BlastTheme.Gold, BlastTheme.Spirit })
                foreach (var r in new[] { 1f, 3f, 6f })
                {
                    string id = Fx.ExplosionId(r, t);
                    var p = Registry<FxPreset>.Get(id);
                    Assert.That(p, Is.Not.Null, id);
                    Assert.That(p.Layers.Any(l => l.style == "Cinder"), Is.False, $"{id}：炭渣只有火有");
                    Assert.That(p.Layers.Any(l => l.style == "Ember"), Is.False, $"{id}：火星换成元素自己的小件");
                    foreach (var l in p.Layers.Where(l => l.style is "ToonFire" or "ToonFireRise" or "ToonBurst"))
                        Assert.That(l.fixedColor, Is.EqualTo(BlastPalette.Core(t)), $"{id} · {l.style}：亮芯是元素的亮芯，不是火的黄");
                    foreach (var l in p.Layers.Where(l => l.style == "ToonSmoke"))
                        Assert.That(l.fixedColor, Is.EqualTo(BlastPalette.Smoke(t)), $"{id}：烟是元素的暗边色");
                }
            Assert.That(Registry<FxPreset>.Get(Fx.ExplosionId(3f, BlastTheme.Shock)).Layers.Any(l => l.style is "Crackle" or "ToonCrack"), Is.True, "雷爆有折线电弧");
            Assert.That(Registry<FxPreset>.Get(Fx.ExplosionId(3f, BlastTheme.Corrode)).Layers.Any(l => l.style == "Drop"), Is.True, "蚀爆有黏团");
            Assert.That(Fx.ExplosionId(3f, BlastTheme.Fire), Is.EqualTo(Fx.ExplosionId(3f)), "火沿用原来的 id");
        }

        [Test]
        public void FrostNovaIsCrystalsNotWhitePowder()
        {
            var p = Registry<FxPreset>.Get("FrostNova");
            Assert.That(p, Is.Not.Null);
            foreach (var bad in new[] { "Powder", "FrostMist", "Flash", "Glow", "StreakLight", "Snow", "Twinkle" })
                Assert.That(p.Layers.Any(l => l.style == bad), Is.False, $"冰爆不该再有 {bad}（白粉雾 / 柔光 / 细碎闪粒）");
            Assert.That(p.Ring, Is.Null, "冰爆不再立白色冷环 + 光墙（改成卡通粗环）");
            Assert.That(p.Layers.Any(l => l.style == "ToonRing"), Is.True, "卡通粗环");
            Assert.That(p.Layers.Any(l => l.style == "ToonDust"), Is.True, "冰蓝实心底");
            // 0.6 s 内交代完
            foreach (var l in p.Layers)
                Assert.That(l.delay + l.life.y, Is.LessThanOrEqualTo(0.65f), $"冰爆 · {l.style} 拖到 {l.delay + l.life.y:F2} s");
            Assert.That(FrostBurst.BuildCrystal(0).vertexCount, Is.GreaterThan(0));
        }

        [Test]
        public void FxShadersCompileWithoutErrors()
        {
            foreach (var name in new[] { FxToon.ShaderToon, FxToon.ShaderCrystal, FxToon.ShaderStatusSkin, "Spiritfire/FxSurge" })
            {
                var sh = Shader.Find(name);
                Assert.That(sh, Is.Not.Null, name);
                Assert.That(UnityEditor.ShaderUtil.ShaderHasError(sh), Is.False, $"{name} 编译出错");
            }
        }
    }
}
