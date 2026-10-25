using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// FX3（冰霜）/ FX4（火狱）追加的粒子风格（组文件，同 <see cref="FxStyles"/>：每种风格一个共享 Shuriken 发射器）。
    ///   冰霜：星芒 IceStar、闪粒 Twinkle、雪花 Snow、冰块 IceChunk、冷雾 FrostMist；
    ///   火狱：纸屑 Paper、炭渣 Cinder、熔滴 Molten、链环 Link、黑烟 Soot、热浪火团 FlameBurst。
    /// 重力 m/s²（向下为正）、阻尼 1/s、grow = 寿命结束时的大小倍率。
    /// </summary>
    [Defs(-99)]
    public sealed class FxElementStyles : IDefSource<FxPreset>
    {
        static FxLayer Default(Vector2 size, Vector2 life, Vector2 speed) => new()
        {
            count = FxScale.Lin(0, 8), shape = FxShape.Sphere, speed = speed, speedScale = FxScale.Pow(0.5f), size = size, sizeScale = FxScale.Pow(0.5f), life = life,
        };

        public IEnumerable<FxPreset> Create()
        {
            // ───────────── 冰霜（FX3） ─────────────

            // 冰晶星芒：六芒的一闪（放大淡出），霜晶 / 碎冰 / 冰光的「叮」
            yield return new FxStylePreset("IceStar",
                new FxParticle { texture = FxTexture.IceStar, gravity = 0, drag = 0, grow = 1.5f, fade = FxFade.Quadratic, maxParticles = 160 },
                new FxLayer { count = FxScale.Const(1), density = false, shape = FxShape.Point, size = new Vector2(0.9f, 0.9f), life = new Vector2(0.16f, 0.16f) },
                FrostPalette.IceHot);
            // 闪粒：一闪一闪的小星芒，慢慢飘（冻雾、霜甲、冰面上的反光）
            yield return new FxStylePreset("Twinkle",
                new FxParticle { texture = FxTexture.IceStar, gravity = -0.25f, drag = 2.5f, grow = 0.4f, fade = FxFade.Flicker, maxParticles = 500 },
                Default(new Vector2(0.08f, 0.16f), new Vector2(0.5f, 1.1f), new Vector2(0.2f, 0.8f)), FrostPalette.IceHot);
            // 雪花：慢慢飘落、打转（普通混合，冰雪上也看得出形状）
            yield return new FxStylePreset("Snow",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Snowflake, gravity = 0.7f, drag = 2.4f, grow = 0.85f, fade = FxFade.Hold, alpha = 0.95f, spin = 120,
                    maxParticles = 600,
                },
                Default(new Vector2(0.06f, 0.12f), new Vector2(0.9f, 1.6f), new Vector2(0.5f, 2f)), FrostPalette.Snow);
            // 冰块：六棱柱的大块碎冰，翻滚着落地弹跳（普通混合，不发光）
            yield return new FxStylePreset("IceChunk",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Crystal, gravity = 17, drag = 0.5f, grow = 0.85f, fade = FxFade.Hold, alpha = 0.97f, bounce = true,
                    spin = 480, maxParticles = 400,
                },
                Default(new Vector2(0.12f, 0.24f), new Vector2(0.6f, 1.0f), new Vector2(3, 7)), FrostPalette.Ice);
            // 冷雾：贴地缓慢翻滚的白雾团（寿命长、几乎不动；冻雾、冰爆的余雾）
            yield return new FxStylePreset("FrostMist",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Smoke, gravity = -0.05f, drag = 1.8f, grow = 1.5f, fade = FxFade.Linger, alpha = 0.5f, spin = 20,
                    maxParticles = 300, sortOrder = -1,
                },
                Default(new Vector2(0.8f, 1.4f), new Vector2(1.6f, 2.6f), new Vector2(0.1f, 0.5f)), FrostPalette.Mist);

            // ───────────── 火狱（FX4） ─────────────

            // 红纸屑：飘飘悠悠往下落、翻转（火药爆）
            yield return new FxStylePreset("Paper",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Paper, gravity = 2.6f, drag = 2.2f, grow = 0.9f, fade = FxFade.Hold, alpha = 0.98f, spin = 420,
                    maxParticles = 500,
                },
                Default(new Vector2(0.08f, 0.15f), new Vector2(1.0f, 1.8f), new Vector2(2, 6)), InfernoPalette.Paper);
            // 炭渣 / 熔渣：发红的小块，带重力弹跳，一闪一闪地冷却
            yield return new FxStylePreset("Cinder",
                new FxParticle
                {
                    texture = FxTexture.Cinder, gravity = 13, drag = 0.9f, grow = 0.6f, fade = FxFade.Flicker, bounce = true, spin = 300, maxParticles = 600,
                },
                Default(new Vector2(0.06f, 0.13f), new Vector2(0.6f, 1.2f), new Vector2(2.5f, 6)), InfernoPalette.Ember);
            // 熔滴：亮橙的液团，抛出去落地（熔铜流、熔铁飞溅）
            yield return new FxStylePreset("Molten",
                new FxParticle
                {
                    texture = FxTexture.Blob, gravity = 15, drag = 0.4f, grow = 0.55f, fade = FxFade.Hold, bounce = true, randomRotation = false, maxParticles = 700,
                },
                Default(new Vector2(0.08f, 0.16f), new Vector2(0.4f, 0.8f), new Vector2(2, 5)), InfernoPalette.Molten);
            // 链环：冷铁环，翻滚着落地弹跳（断链）
            yield return new FxStylePreset("Link",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Link, gravity = 20, drag = 0.5f, grow = 0.95f, fade = FxFade.Hold, bounce = true, spin = 640, maxParticles = 300,
                },
                Default(new Vector2(0.1f, 0.14f), new Vector2(0.8f, 1.3f), new Vector2(2.5f, 6)), InfernoPalette.Iron);
            // 黑烟：比 Smoke 更浓、更黑，往上滚（火药、熔炉）
            yield return new FxStylePreset("Soot",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Smoke, gravity = -1.4f, drag = 2f, grow = 2.6f, fade = FxFade.Smoke, alpha = 0.62f, spin = 30, maxParticles = 400,
                },
                Default(new Vector2(0.5f, 0.9f), new Vector2(1.2f, 2.2f), new Vector2(0.5f, 1.4f)), InfernoPalette.Soot);
            // 火舌团（加法）：往上窜的大火舌，缩小淡出（火药爆的火柱底、地火的火苗）
            yield return new FxStylePreset("FlameBurst",
                new FxParticle
                {
                    texture = FxTexture.Flame, gravity = -7f, drag = 2.2f, grow = 0.5f, fade = FxFade.Smoke, alpha = 0.95f, randomRotation = false, maxParticles = 400,
                },
                Default(new Vector2(0.4f, 0.7f), new Vector2(0.3f, 0.5f), new Vector2(0.5f, 1.5f)), InfernoPalette.Fire);
        }
    }

    /// <summary>冰霜特效色板（同 Three.js FrostPackFx / FrostSkirmishFx 的 FROST）</summary>
    public static class FrostPalette
    {
        public static readonly Color Ice = Hex.Rgb(0x9fe0ff), IceDeep = Hex.Rgb(0x4fa8d8), IceHot = Hex.Rgb(0xe8fbff);
        public static readonly Color Snow = Hex.Rgb(0xeef7ff), Mist = Hex.Rgb(0xcfe6fb), Frost = Hex.Rgb(0xbfeaff), Shard = Hex.Rgb(0xdff4ff);
    }

    /// <summary>火狱特效色板（同 Three.js InfernoBlastFx / InfernoTankFx / InfernoSupportFx 的 INFERNO）</summary>
    public static class InfernoPalette
    {
        public static readonly Color Fire = Hex.Rgb(0xff8a2a), Hot = Hex.Rgb(0xffd27a), White = Hex.Rgb(0xfff4d0), Ember = Hex.Rgb(0xff7a2a);
        public static readonly Color Gold = Hex.Rgb(0xffc850), Paper = Hex.Rgb(0xd8241c), Soot = Hex.Rgb(0x2a1a14), Iron = Hex.Rgb(0x3a3430);
        public static readonly Color Molten = Hex.Rgb(0xff8a24), MoltenHot = Hex.Rgb(0xffd27a), Basalt = Hex.Rgb(0x2b2421), Slag = Hex.Rgb(0x3a2a22);
    }
}
