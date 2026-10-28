using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 环境氛围的粒子风格（特效打磨 D 路；组文件，同 <see cref="FxStyles"/>：每种风格一个共享 Shuriken 发射器，存活数算进 <see cref="FxBudget"/>）。
    /// 按 docs/art/fx-style.md：氛围粒子数量少、形状大一点、动得慢，颜色跟章节底色，每种只有亮芯 / 主色两三个色阶。
    ///   Env 前缀，和战斗特效分开各占一份上限——常驻氛围不挤掉打斗时的火花：
    ///   浮尘 EnvMote（阳光里的亮尘）、沙帘 EnvSand（贴地掠过的沙丝）、沙粒 EnvGrain（流沙表面往里流的沙线）、
    ///   飘雪 EnvSnow、冰晶 EnvGlint（空气里 / 冰面上一闪一闪的冰晶）、水雾 EnvMist（冰窟水面的寒气、瀑底水雾）、
    ///   余烬 EnvEmber（火狱里慢慢上升的火星）、落灰 EnvAsh、香烟 EnvSmoke（香炉的细烟）、火星 EnvSpark（火盆、熔瀑底、熔岩冒泡溅起的小火星）。
    /// </summary>
    [Defs(-98)]
    public sealed class FxEnvStyles : IDefSource<FxPreset>
    {
        static FxLayer Default(Vector2 size, Vector2 life, Vector2 speed) => new()
        {
            count = FxScale.Lin(0, 6), shape = FxShape.Sphere, speed = speed, speedScale = FxScale.Pow(0.5f), size = size, sizeScale = FxScale.Pow(0.5f), life = life,
        };

        // 章节底色（docs/art/fx-style.md 2.2）：沙寺的尘是暖沙色、不用灰；霜山的雪雾冷白、不纯白；熔火的余烬铜橙、烟和灰偏紫褐
        public static readonly Color Mote = new(1f, 0.84f, 0.58f, 0.6f), Sand = new(0.93f, 0.76f, 0.5f, 0.8f), Snow = new(0.9f, 0.95f, 1f, 0.85f);
        public static readonly Color Glint = new(0.86f, 0.96f, 1f, 1f), Mist = new(0.84f, 0.92f, 1f, 0.3f), Ember = new(0.96f, 0.5f, 0.18f, 1f);
        public static readonly Color Ash = new(0.34f, 0.25f, 0.29f, 0.75f), Smoke = new(0.78f, 0.7f, 0.64f, 0.35f), Spark = new(1f, 0.66f, 0.26f, 1f);
        /// <summary>熔火的烟：紫褐（不用纯灰黑）</summary>
        public static readonly Color InfernoSmoke = new(0.24f, 0.14f, 0.18f, 0.5f);
        /// <summary>沙寺的尘雾：暖沙色</summary>
        public static readonly Color SandVeil = new(0.92f, 0.76f, 0.5f, 0.35f);

        public IEnumerable<FxPreset> Create()
        {
            // 浮尘：很小的暖色亮点，慢慢飘、一闪一闪（加法，小、淡，不挡视线）
            yield return new FxStylePreset("EnvMote",
                new FxParticle { texture = FxTexture.Glow, gravity = 0, drag = 0.6f, grow = 0.8f, fade = FxFade.Flicker, alpha = 0.7f, maxParticles = 360 },
                Default(new Vector2(0.03f, 0.06f), new Vector2(2.5f, 4f), new Vector2(0.05f, 0.2f)), Mote);
            // 沙帘：贴地掠过的沙丝（普通混合、沿速度拉长）
            yield return new FxStylePreset("EnvSand",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Streak, render = FxRender.Stretched, gravity = 0.4f, drag = 0.2f, grow = 1.4f, fade = FxFade.Smoke,
                    alpha = 0.8f, stretchVelocity = 0.16f, stretchLength = 1.4f, maxParticles = 600,
                },
                Default(new Vector2(0.08f, 0.16f), new Vector2(1.4f, 2.2f), new Vector2(8, 13)), Sand);
            // 沙粒线：流沙表面沿螺旋往里流的细沙（普通混合、拉长）
            yield return new FxStylePreset("EnvGrain",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Streak, render = FxRender.Stretched, gravity = 0, drag = 0, grow = 0.8f, fade = FxFade.Smoke,
                    alpha = 0.7f, stretchVelocity = 0.35f, stretchLength = 1f, maxParticles = 360,
                },
                Default(new Vector2(0.05f, 0.08f), new Vector2(0.7f, 1.1f), new Vector2(1.5f, 2.5f)), new Color(0.62f, 0.46f, 0.3f, 0.8f));
            // 飘雪：慢慢落、打转（普通混合）
            yield return new FxStylePreset("EnvSnow",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Snowflake, gravity = 0, drag = 0, grow = 1f, fade = FxFade.Hold, alpha = 0.9f, spin = 90,
                    maxParticles = 700,
                },
                Default(new Vector2(0.05f, 0.1f), new Vector2(5f, 7f), new Vector2(0.5f, 1f)), Snow);
            // 冰晶：一闪一闪的小星芒（空气里的钻石尘、冰面反光点）
            yield return new FxStylePreset("EnvGlint",
                new FxParticle { texture = FxTexture.IceStar, gravity = 0, drag = 1.5f, grow = 0.6f, fade = FxFade.Flicker, maxParticles = 240, randomRotation = false },
                Default(new Vector2(0.06f, 0.12f), new Vector2(0.8f, 1.6f), new Vector2(0.02f, 0.1f)), Glint);
            // 水雾：大而淡的雾团，慢慢升、散开（冰窟水面寒气、瀑底水雾）
            yield return new FxStylePreset("EnvMist",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Smoke, gravity = -0.12f, drag = 0.8f, grow = 2.2f, fade = FxFade.Linger, alpha = 0.35f, spin = 15,
                    maxParticles = 220, sortOrder = -1,
                },
                Default(new Vector2(1.2f, 2.2f), new Vector2(3f, 5f), new Vector2(0.1f, 0.4f)), Mist);
            // 余烬：慢慢上升、左右飘的小火星（加法，一闪一闪地冷却）
            yield return new FxStylePreset("EnvEmber",
                new FxParticle { texture = FxTexture.Spark, gravity = -0.35f, drag = 0.5f, grow = 0.5f, fade = FxFade.Flicker, maxParticles = 500 },
                Default(new Vector2(0.04f, 0.08f), new Vector2(2.5f, 4.5f), new Vector2(0.3f, 1f)), Ember);
            // 落灰：暗灰的灰片，飘飘悠悠往下落、翻转（普通混合）
            yield return new FxStylePreset("EnvAsh",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Paper, gravity = 0.25f, drag = 1.6f, grow = 0.9f, fade = FxFade.Hold, alpha = 0.75f, spin = 160,
                    maxParticles = 300,
                },
                Default(new Vector2(0.04f, 0.08f), new Vector2(4f, 6f), new Vector2(0.2f, 0.6f)), Ash);
            // 香烟：细长、慢升、越升越散（普通混合）
            yield return new FxStylePreset("EnvSmoke",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Smoke, gravity = -0.45f, drag = 1.2f, grow = 3.2f, fade = FxFade.Smoke, alpha = 0.32f, spin = 25,
                    maxParticles = 160,
                },
                Default(new Vector2(0.12f, 0.2f), new Vector2(2.5f, 3.5f), new Vector2(0.1f, 0.3f)), Smoke);
            // 火星：火盆 / 熔瀑底 / 熔岩冒泡溅起的小火星，往上蹦一下再落（加法、拉长）
            yield return new FxStylePreset("EnvSpark",
                new FxParticle
                {
                    texture = FxTexture.Streak, render = FxRender.Stretched, gravity = 5f, drag = 0.9f, grow = 0.5f, fade = FxFade.Streak,
                    stretchVelocity = 0.03f, stretchLength = 1f, maxParticles = 400,
                },
                Default(new Vector2(0.035f, 0.05f), new Vector2(0.4f, 0.8f), new Vector2(2, 5)), Spark);
        }
    }
}
