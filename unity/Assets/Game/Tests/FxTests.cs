using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 战斗特效（FX1 / FX2）的纯数据契约：元素色与 Three.js 一致、地形层名 → 地表、每个组合预设的层都发进登记过的粒子风格、
    /// 图集格号不越界、FxBudget 的砍量规则。Play 模式里的观感由 playtest fx 截图验收。
    /// </summary>
    public sealed class FxTests
    {
        static Color Rgb(int hex) => Hex.Rgb(hex);

        [Test]
        public void ElementColorsMatchThreeJs()
        {
            Assert.That(Fx.ElementColor(Element.Fire), Is.EqualTo(Rgb(0xff6a1f)));
            Assert.That(Fx.ElementColor(Element.Shock), Is.EqualTo(Rgb(0x6fd8ff)));
            Assert.That(Fx.ElementColor(Element.Corrode), Is.EqualTo(Rgb(0x9dff4a)));
            Assert.That(Fx.ElementColor(Element.None), Is.EqualTo(Rgb(0xfff1d6)));
            Assert.That(Fx.ShotColor(Element.None), Is.EqualTo(Rgb(0xffd9a0)));
            Assert.That(Fx.LayerColor(DamageLayer.Shield), Is.EqualTo(Rgb(0x7cc8ff)));
            Assert.That(Fx.LayerColor(DamageLayer.Armor), Is.EqualTo(Rgb(0xffd060)));
        }

        [TestCase("TL_DesertSand", SurfaceKind.Sand)]
        [TestCase("TL_DesertPacked", SurfaceKind.Sand)]
        [TestCase("TL_DesertGravel", SurfaceKind.Stone)]
        [TestCase("TL_DesertRock", SurfaceKind.Stone)]
        [TestCase("TL_FrostIce", SurfaceKind.Ice)]
        [TestCase("TL_FrostSnow", SurfaceKind.Ice)]
        [TestCase("TL_FrostSoil", SurfaceKind.Sand)]
        [TestCase("TL_InfernoAsh", SurfaceKind.Sand)]
        [TestCase("TL_InfernoBasalt", SurfaceKind.Stone)]
        [TestCase("SM_Env_DesertSandstone", SurfaceKind.Stone)]
        [TestCase("SM_Prop_Anvil", SurfaceKind.Metal)]
        public void LayerNamesMapToSurfaces(string name, SurfaceKind want) => Assert.That(Surfaces.LayerKind(name), Is.EqualTo(want));

        [Test]
        public void ImpactPresetPerSurface()
        {
            foreach (SurfaceKind k in System.Enum.GetValues(typeof(SurfaceKind)))
                Assert.That(Registry<FxPreset>.Get(Fx.ImpactId(k)), Is.Not.Null, $"{k} 没有弹着点预设 {Fx.ImpactId(k)}");
        }

        [Test]
        public void EveryLayerEmitsIntoARegisteredStyle()
        {
            var all = Registry<FxPreset>.All;
            foreach (var p in all)
            {
                foreach (var L in p.Layers)
                {
                    var style = L.style ?? p.Id;
                    var s = Registry<FxPreset>.Get(style);
                    Assert.That(s?.Particle, Is.Not.Null, $"预设 {p.Id} 的层发进了不存在的粒子风格「{style}」");
                }
                if (p.Includes != null)
                    foreach (var id in p.Includes)
                        Assert.That(Registry<FxPreset>.Get(id), Is.Not.Null, $"预设 {p.Id} 包含了不存在的预设「{id}」");
                if (p.Particle != null)
                    Assert.That((int)p.Particle.texture, Is.LessThan(FxTextures.AtlasColumns * FxTextures.AtlasRows), $"{p.Id} 的贴图格越界");
            }
            foreach (var id in new[] { "Explosion", "EnemyHit", "EnemyHitCrit", "EnemyHitShield", "EnemyHitArmor", "ShieldShatter", "ArmorChip", "Death", "SpawnFinale", "Abyss" })
                Assert.That(Registry<FxPreset>.Get(id), Is.Not.Null, $"缺预设 {id}");
        }

        [Test]
        public void DecalKindsFitTheAtlas()
        {
            int cells = FxTextures.DecalColumns * FxTextures.DecalRows;
            foreach (FxDecalKind k in System.Enum.GetValues(typeof(FxDecalKind))) Assert.That((int)k, Is.LessThan(cells));
            Assert.That(FxMaterials.IsDecal(FxMaterialKind.DecalSprite) && FxMaterials.IsDecal(FxMaterialKind.DecalVortex));
            Assert.That(FxMaterials.ShaderName(FxMaterialKind.DecalPool), Is.EqualTo(FxMaterials.ShaderDecal));
            Assert.That(FxMaterials.TextureName(FxMaterialKind.DecalSprite), Is.EqualTo(FxTextures.DecalAtlas));
        }

        [Test]
        public void BudgetCutsOnlyNearTheCap()
        {
            const int cap = 1000;
            Assert.That(FxBudget.Scale(10, false, 0, cap), Is.EqualTo(10), "远低于上限时全放行");
            Assert.That(FxBudget.Scale(10, false, 750, cap), Is.EqualTo(10), "75% 以内全放行");
            Assert.That(FxBudget.Scale(10, false, 875, cap), Is.EqualTo(5), "剩一半空间砍一半");
            Assert.That(FxBudget.Scale(10, false, cap, cap), Is.EqualTo(0), "满了砍光");
            Assert.That(FxBudget.Scale(1, true, cap, cap), Is.EqualTo(1), "单颗闪光核心总是放行");
        }
    }
}
