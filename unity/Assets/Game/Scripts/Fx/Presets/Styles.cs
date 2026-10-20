using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 粒子风格（组文件：每种风格一个共享 Shuriken 发射器；Three.js src/fx/Particles.ts 的 STYLE_* 与 Sparks.ts 的拉丝火花）。
    /// 组合特效（Impact / EnemyHit / Explosion…）的层按 id 发进这些风格；Fx.Play(风格名) 也能直接用（带一层默认的小爆发）。
    /// 重力 m/s²（向下为正）、阻尼 1/s、grow = 寿命结束时的大小倍率，均照 Three.js 的数值。
    /// </summary>
    [Defs(-100)]
    public sealed class FxStyles : IDefSource<FxPreset>
    {
        static FxLayer Default(Vector2 size, Vector2 life, Vector2 speed) => new()
        {
            count = FxScale.Lin(0, 8), shape = FxShape.Sphere, speed = speed, speedScale = FxScale.Pow(0.5f), size = size, sizeScale = FxScale.Pow(0.5f), life = life,
        };

        public IEnumerable<FxPreset> Create()
        {
            // ── 发光（加法）──
            yield return new FxStylePreset("Glow",
                new FxParticle { texture = FxTexture.Glow, gravity = 0, drag = 2.5f, grow = 0.25f, maxParticles = 1500 },
                Default(new Vector2(0.1f, 0.2f), new Vector2(0.3f, 0.6f), new Vector2(1, 4)));
            yield return new FxStylePreset("GlowFall",
                new FxParticle { texture = FxTexture.Glow, gravity = 6, drag = 1.5f, grow = 0.4f, maxParticles = 800 },
                Default(new Vector2(0.08f, 0.16f), new Vector2(0.4f, 0.7f), new Vector2(2, 5)));
            yield return new FxStylePreset("GlowHeavy",
                new FxParticle { texture = FxTexture.Glow, gravity = 14, drag = 1.2f, grow = 0.35f, bounce = true, maxParticles = 600 },
                Default(new Vector2(0.06f, 0.12f), new Vector2(0.4f, 0.8f), new Vector2(3, 7)));
            yield return new FxStylePreset("GlowRise",
                new FxParticle { texture = FxTexture.Glow, gravity = -2, drag = 2f, grow = 0.6f, maxParticles = 800 },
                Default(new Vector2(0.1f, 0.2f), new Vector2(0.5f, 0.9f), new Vector2(0.5f, 2)));
            // 闪光球：放大淡出（Three.js Flash.ts 的菲涅尔球用两颗放大的柔光代替）
            yield return new FxStylePreset("Flash",
                new FxParticle { texture = FxTexture.Glow, gravity = 0, drag = 0, grow = 3.6f, fade = FxFade.Quadratic, maxParticles = 96 },
                new FxLayer { count = FxScale.Const(1), density = false, shape = FxShape.Point, size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.3f, 0.3f) });
            // 暴击星芒
            yield return new FxStylePreset("Flare",
                new FxParticle { texture = FxTexture.Flare, gravity = 0, drag = 0, grow = 1.4f, fade = FxFade.Quadratic, maxParticles = 96 },
                new FxLayer { count = FxScale.Const(1), density = false, shape = FxShape.Point, size = new Vector2(1, 1), life = new Vector2(0.12f, 0.12f) });
            yield return new FxStylePreset("Fireball",
                new FxParticle { texture = FxTexture.Glow, gravity = -2.5f, drag = 3.2f, grow = 1.6f, alpha = 0.7f, maxParticles = 600 },
                Default(new Vector2(0.3f, 0.6f), new Vector2(0.3f, 0.6f), new Vector2(1, 3)));

            // ── 火花 / 光点（加法）──
            yield return new FxStylePreset("Spark",
                new FxParticle { texture = FxTexture.Spark, gravity = 14, drag = 1.2f, grow = 0.3f, bounce = true, maxParticles = 800 },
                Default(new Vector2(0.06f, 0.11f), new Vector2(0.2f, 0.4f), new Vector2(1.5f, 4.5f)));
            // 拉丝火花：沿速度拉长（长度 = 宽 + 速度 × 0.02 s），受重力、会在地面弹跳（Three.js Sparks.ts）
            yield return new FxStylePreset("Streak",
                new FxParticle
                {
                    texture = FxTexture.Streak, render = FxRender.Stretched, gravity = 16, drag = 1.1f, grow = 0.5f, fade = FxFade.Streak, bounce = true,
                    stretchVelocity = 0.02f, stretchLength = 1f, maxParticles = 1400,
                },
                Default(new Vector2(0.035f, 0.035f), new Vector2(0.15f, 0.35f), new Vector2(5, 12)));
            // 轻拉丝：重力小（闪电电火花、暴击星芒、光束末端）
            yield return new FxStylePreset("StreakLight",
                new FxParticle
                {
                    texture = FxTexture.Streak, render = FxRender.Stretched, gravity = 5, drag = 1.1f, grow = 0.5f, fade = FxFade.Streak,
                    stretchVelocity = 0.02f, stretchLength = 1f, maxParticles = 1000,
                },
                Default(new Vector2(0.035f, 0.035f), new Vector2(0.12f, 0.28f), new Vector2(4, 9)));
            yield return new FxStylePreset("Ember",
                new FxParticle { texture = FxTexture.Spark, gravity = -1.2f, drag = 1.6f, grow = 0.2f, fade = FxFade.Flicker, maxParticles = 600 },
                Default(new Vector2(0.06f, 0.12f), new Vector2(0.9f, 1.7f), new Vector2(2, 6)));
            yield return new FxStylePreset("Mote",
                new FxParticle { texture = FxTexture.Spark, gravity = -3.5f, drag = 1.4f, grow = 0.15f, fade = FxFade.Flicker, maxParticles = 600 },
                Default(new Vector2(0.07f, 0.14f), new Vector2(0.45f, 0.85f), new Vector2(0.5f, 2)));

            // ── 烟尘碎屑（普通透明）──
            yield return new FxStylePreset("Smoke",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Smoke, gravity = -0.9f, drag = 2.2f, grow = 2.2f, fade = FxFade.Smoke, alpha = 0.5f, maxParticles = 500,
                },
                Default(new Vector2(0.4f, 0.7f), new Vector2(1.1f, 2.1f), new Vector2(0.4f, 1.1f)), Hex.Rgb(0x2b2623));
            yield return new FxStylePreset("Dust",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Dust, gravity = 0.6f, drag = 4f, grow = 2.2f, fade = FxFade.Smoke, alpha = 0.45f, maxParticles = 600,
                },
                Default(new Vector2(0.2f, 0.35f), new Vector2(0.45f, 0.8f), new Vector2(0.6f, 1.8f)), Hex.Rgb(0x8c8274));
            yield return new FxStylePreset("Chunk",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Chunk, gravity = 22, drag = 0.6f, grow = 0.7f, fade = FxFade.Hold, bounce = true, spin = 540, maxParticles = 500,
                },
                Default(new Vector2(0.04f, 0.09f), new Vector2(0.5f, 0.9f), new Vector2(2.5f, 6)), Hex.Rgb(0x3b322b));
        }
    }
}
