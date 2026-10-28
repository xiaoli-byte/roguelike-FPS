using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领 / 怪物专属特效的粒子风格和预设（特效打磨 C 路，组文件）：
    ///   风格 Spray（普通混合的拉丝水花 / 沙流：亮沙、冰雪上也看得出，加法拉丝在那上面会洗成一片白）；
    ///   预设 BossSplash（破水水冠）、BossSandBlast（破沙）、BossSlam（砸地：贴地尘浪、碎石、裂痕，不盖住身体）、BossMoltenBurst（熔铜四溅）、
    ///   BossSunFlare（日轮炸亮）、BossFeather（羽刃落地）、BossFoxfire（狐火炸开）、BossFaceShatter（傩面碎裂）、BossPunch（重拳冲击）。
    /// 规模 s：水冠 / 破沙 / 砸地 / 熔铜 = 半径（米），其余 = 大小。入口在 <see cref="Fx"/> 的 Fx.Boss.cs。
    /// 风格按 docs/art/fx-style.md：大形靠 B 路的卡通序列帧（ToonBurst 爆闪星、ToonPop / ToonRing 粗冲击环、ToonSmoke 实心祥云团、ToonDust 贴地尘团、
    /// ToonFlame 卡通火苗、ToonCrown 熔溅冠），小粒子只做点缀（数量少、个头大）；烟尘按章节底色（沙寺暖砂、霜山冷白、熔火紫褐），不用灰雾。
    /// 时间结构：亮芯第一帧到峰值（蓄在招式前摇里），爆 0.1–0.2 s，余韵 0.5 s 内退场。
    /// </summary>
    [Defs(-98)]
    public sealed class FxBossStyles : IDefSource<FxPreset>
    {
        /// <summary>章节底色的烟尘：沙寺暖砂、霜山冷白、熔火紫褐</summary>
        static readonly Color SandDust = Hex.Rgb(0xdcb880), SnowMist = Hex.Rgb(0xd6e6f4), LavaSmoke = Hex.Rgb(0x4e3442);

        static FxLayer Burst(float size, float life, Color tint, float mix = 0.35f) => new()
        {
            style = "ToonBurst", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.15f,
            size = new Vector2(size, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life, life), color = FxColor.Fixed, fixedColor = tint, mix = mix,
        };

        static FxLayer GroundRing(float size, float life, Color tint) => new()
        {
            style = "ToonRing", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.06f,
            size = new Vector2(size, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life, life), color = FxColor.Fixed, fixedColor = tint, mix = 0,
        };

        static FxLayer Clouds(float count, float max, float size, float life, Color tint, float spread = 0.5f, float up = 0.8f) => new()
        {
            style = "ToonSmoke", count = FxScale.Lin(count, count * 0.4f, max), maxCount = Mathf.RoundToInt(max), shape = FxShape.UpperSphere,
            spread = FxScale.Lin(0, spread), spreadY = 0.35f, speed = new Vector2(0.6f, 1.6f), speedScale = FxScale.Pow(0.5f), up = up,
            size = new Vector2(size * 0.85f, size * 1.15f), sizeScale = FxScale.Pow(0.6f), life = new Vector2(life * 0.85f, life), color = FxColor.Fixed, fixedColor = tint,
            mix = 0.05f, shade = new Vector2(0.92f, 1.05f),
        };

        public IEnumerable<FxPreset> Create()
        {
            // 拉丝水花 / 沙流：沿速度拉长、普通混合、受重力落下
            yield return new FxStylePreset("Spray",
                new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Streak, render = FxRender.Stretched, gravity = 11, drag = 0.6f, grow = 0.85f, fade = FxFade.Hold,
                    alpha = 0.9f, stretchVelocity = 0.035f, stretchLength = 1.2f, maxParticles = 700,
                },
                new FxLayer
                {
                    count = FxScale.Lin(0, 10), shape = FxShape.MostlyUp, speed = new Vector2(4, 9), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.06f, 0.1f),
                    life = new Vector2(0.5f, 0.9f),
                },
                new Color(0.85f, 0.96f, 1f));

            // 破水：白沫爆闪 + 几道粗水线 + 大水珠 + 冷白的白沫团 + 水面一道粗白环
            yield return new BossFxPreset("BossSplash", new Color(0.78f, 0.94f, 0.98f), 0.4f, 12f)
            {
                layers = new[]
                {
                    Burst(1.6f, 0.12f, Color.white, 0.6f),
                    new FxLayer
                    {
                        style = "Spray", count = FxScale.Lin(8, 5, 28), maxCount = 28, shape = FxShape.Cone, coneAngle = 32, spread = FxScale.Lin(0, 0.45f), spreadY = 0.2f,
                        speed = new Vector2(7, 14), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.14f, 0.22f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.6f, 0.95f), color = FxColor.Hot, mix = 0.35f,
                    },
                    new FxLayer
                    {
                        style = "Drop", count = FxScale.Lin(6, 4, 22), maxCount = 22, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.5f), spreadY = 0.2f,
                        speed = new Vector2(3, 8), speedScale = FxScale.Pow(0.5f), up = 3f, size = new Vector2(0.2f, 0.34f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.6f, 0.95f), color = FxColor.Tint,
                    },
                    Clouds(2.5f, 7, 1.2f, 0.75f, SnowMist),
                    GroundRing(1.5f, 0.45f, Color.white),
                },
            };

            // 破沙：暖砂的粗沙流 + 少量大颗沙粒 + 暖砂祥云团 + 几块碎石
            yield return new BossFxPreset("BossSandBlast", SandDust, 0.4f, 12f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Spray", count = FxScale.Lin(7, 5, 24), maxCount = 24, shape = FxShape.Cone, coneAngle = 38, spread = FxScale.Lin(0, 0.45f), spreadY = 0.2f,
                        speed = new Vector2(6, 12), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.12f, 0.2f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.55f, 0.9f), color = FxColor.Tint, shade = new Vector2(0.85f, 1.05f),
                    },
                    new FxLayer
                    {
                        style = "Grit", count = FxScale.Lin(6, 4, 20), maxCount = 20, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.5f),
                        speed = new Vector2(3, 8), speedScale = FxScale.Pow(0.5f), up = 2.5f, size = new Vector2(0.08f, 0.13f), life = new Vector2(0.6f, 0.9f),
                        color = FxColor.Tint, shade = new Vector2(0.8f, 1.05f),
                    },
                    Clouds(2.5f, 8, 1.3f, 0.8f, SandDust),
                    new FxLayer
                    {
                        style = "Chunk", count = FxScale.Lin(3, 2, 8), maxCount = 8, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.14f, 0.22f), life = new Vector2(0.6f, 0.9f),
                        color = FxColor.Fixed, fixedColor = Hex.Rgb(0x7a5a3a), mix = 0.2f,
                    },
                },
            };

            // 砸地：一记小爆闪星（贴地，不盖身体）、一圈贴地尘团 + 粗冲击环、几块大碎石、几道火星；裂痕贴花、按距离震屏
            yield return new BossFxPreset("BossSlam", new Color(0.55f, 0.45f, 0.38f), 0.5f, 12f)
            {
                layers = new[]
                {
                    Burst(1.0f, 0.1f, Hex.Rgb(0xffd8a0), 0.3f),
                    new FxLayer
                    {
                        style = "ToonDust", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.05f,
                        size = new Vector2(1.6f, 1.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.7f, 0.7f), color = FxColor.Tint,
                    },
                    GroundRing(2.2f, 0.35f, Hex.Rgb(0xffd8a0)),
                    new FxLayer
                    {
                        style = "Chunk", count = FxScale.Lin(4, 2.5f, 14), maxCount = 14, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(4, 9), speedScale = FxScale.Pow(0.5f), up = 3f, size = new Vector2(0.18f, 0.32f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.6f, 0.95f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0x3a2a34), mix = 0.15f,
                    },
                    new FxLayer
                    {
                        style = "Streak", count = FxScale.Lin(4, 2, 12), maxCount = 12, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.2f),
                        speed = new Vector2(8, 14), speedScale = FxScale.Pow(0.5f), up = 2f, upJitter = 1.5f, size = new Vector2(0.06f, 0.06f),
                        life = new Vector2(0.2f, 0.4f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xffb050), mix = 0,
                    },
                },
                decal = new FxDecalSpec { kind = FxDecalKind.Crack, size = FxScale.Lin(0, 2.4f), heightFactor = 0.8f, heat = 0.9f, life = 8f },
                shake = new FxShakeSpec { strength = new FxScale(0.3f, 0.08f, 1, 0, 1f), range = FxScale.Lin(14, 5), duration = FxScale.Const(0.4f), durationPerK = 0.3f },
            };

            // 熔铜四溅：一顶熔溅冠 + 少量大熔滴 + 几颗炭渣 + 紫褐烟团；暖光小一点
            yield return new BossFxPreset("BossMoltenBurst", InfernoPalette.Molten, 0.4f, 10f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "ToonCrown", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(1.5f, 1.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.4f, 0.4f), color = FxColor.Tint,
                    },
                    new FxLayer
                    {
                        style = "Molten", count = FxScale.Lin(6, 4, 24), maxCount = 24, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.35f), spreadY = 0.3f,
                        speed = new Vector2(4, 9), speedScale = FxScale.Pow(0.5f), up = 3f, size = new Vector2(0.2f, 0.34f), sizeScale = FxScale.Pow(0.4f),
                        life = new Vector2(0.55f, 0.95f), color = FxColor.RandomMix, fixedColor = InfernoPalette.MoltenHot,
                    },
                    new FxLayer
                    {
                        style = "Cinder", count = FxScale.Lin(3, 2, 10), maxCount = 10, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.12f, 0.2f), life = new Vector2(0.6f, 1.0f),
                        color = FxColor.Tint,
                    },
                    Clouds(1.5f, 5, 1.1f, 0.9f, LavaSmoke, 0.4f, 1.2f),
                },
                light = new FxLightSpec { intensity = FxScale.Lin(1.5f, 0.8f, 4), range = FxScale.Lin(4, 2, 12), life = 0.25f, color = FxColor.Hot, mix = 0.2f, lift = 0.6f },
            };

            // 日轮炸亮：一记金色爆闪星 + 一道朝镜头的粗冲击环 + 几道金拉丝 + 往上飘的金屑；灯光克制
            yield return new BossFxPreset("BossSunFlare", Hex.Rgb(0xffd27a), 0.3f, 10f)
            {
                layers = new[]
                {
                    Burst(2.6f, 0.16f, Hex.Rgb(0xffd27a), 0.4f),
                    new FxLayer
                    {
                        style = "ToonPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(1.6f, 1.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.28f, 0.28f), color = FxColor.Tint,
                    },
                    new FxLayer
                    {
                        style = "StreakLight", count = FxScale.Lin(6, 3, 16), maxCount = 16, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(9, 16), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.09f, 0.09f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.2f, 0.4f), color = FxColor.Tint,
                    },
                    new FxLayer
                    {
                        style = "Mote", count = FxScale.Lin(5, 3, 14), maxCount = 14, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.6f),
                        speed = new Vector2(1, 3), size = new Vector2(0.16f, 0.24f), life = new Vector2(0.5f, 0.8f), color = FxColor.Tint,
                    },
                },
                light = new FxLightSpec { intensity = FxScale.Lin(2.5f, 1f, 6), range = FxScale.Lin(8, 3, 30), life = 0.3f, color = FxColor.Tint, lift = 0f },
            };

            // 羽刃落地：一记冰晶星芒 + 几块大冰碴 + 两三片雪 + 一小团冷白雪雾
            yield return new BossFxPreset("BossFeather", FrostPalette.Ice, 0.3f, 4f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "IceStar", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.25f,
                        size = new Vector2(1.2f, 1.2f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.16f, 0.16f), color = FxColor.Hot, mix = 0.4f,
                    },
                    new FxLayer
                    {
                        style = "ShardIce", count = FxScale.Lin(3, 2, 9), maxCount = 9, shape = FxShape.MostlyUp,
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.12f, 0.2f), life = new Vector2(0.45f, 0.75f),
                        color = FxColor.Fixed, fixedColor = FrostPalette.Shard, mix = 0.2f,
                    },
                    new FxLayer
                    {
                        style = "Snow", count = FxScale.Lin(2, 1.5f, 6), maxCount = 6, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f),
                        speed = new Vector2(0.8f, 2f), up = 1f, size = new Vector2(0.14f, 0.2f), life = new Vector2(0.7f, 1.1f), color = FxColor.Fixed,
                        fixedColor = FrostPalette.Snow, mix = 0,
                    },
                    Clouds(1f, 2, 0.7f, 0.6f, SnowMist, 0.3f, 0.5f),
                },
            };

            // 狐火炸开：一记青白爆闪星 + 两三团卡通青火往上窜 + 几颗磷火
            yield return new BossFxPreset("BossFoxfire", Hex.Rgb(0x7fd8ff), 0.3f, 4f)
            {
                layers = new[]
                {
                    Burst(1.0f, 0.12f, Hex.Rgb(0x9fe4ff), 0.3f),
                    new FxLayer
                    {
                        style = "ToonFlame", count = FxScale.Lin(2, 1, 4), maxCount = 4, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.25f),
                        speed = new Vector2(0.4f, 1.2f), up = 1f, size = new Vector2(0.5f, 0.75f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.35f, 0.5f),
                        color = FxColor.Tint,
                    },
                    new FxLayer
                    {
                        style = "Mote", count = FxScale.Lin(3, 2, 8), maxCount = 8, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(1, 3), size = new Vector2(0.12f, 0.18f), life = new Vector2(0.45f, 0.7f), color = FxColor.Tint,
                    },
                },
                light = new FxLightSpec { intensity = FxScale.Const(1.8f), range = FxScale.Lin(3, 2, 7), life = 0.2f, color = FxColor.Tint, lift = 0f },
            };

            // 傩面碎裂：一记描金爆闪星 + 朱漆木片翻滚着崩飞 + 一道粗冲击环 + 一团紫褐烟
            yield return new BossFxPreset("BossFaceShatter", Hex.Rgb(0xd8402a), 0.3f, 3f)
            {
                layers = new[]
                {
                    Burst(0.9f, 0.12f, Hex.Rgb(0xffd27a), 0.2f),
                    new FxLayer
                    {
                        style = "Plate", count = FxScale.Lin(5, 3, 12), maxCount = 12, shape = FxShape.Hemisphere, normalBias = 0.6f,
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.14f, 0.24f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.7f, 1.0f), color = FxColor.Alternate, every = 4, mix = 0.15f,
                    },
                    new FxLayer
                    {
                        style = "ToonPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(0.9f, 0.9f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.2f, 0.2f), color = FxColor.Fixed,
                        fixedColor = Hex.Rgb(0xffb050), mix = 0,
                    },
                    Clouds(1f, 2, 0.6f, 0.6f, LavaSmoke, 0.2f, 0.6f),
                },
            };

            // 重拳冲击：拳面前一记爆闪星 + 一道朝镜头的粗冲击环 + 往前喷的几道火星 + 一团紫褐烟
            yield return new BossFxPreset("BossPunch", Hex.Rgb(0xffb060), 0.3f, 4f)
            {
                layers = new[]
                {
                    Burst(1.0f, 0.1f, Hex.Rgb(0xffc888), 0.35f),
                    new FxLayer
                    {
                        style = "ToonPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(1.3f, 1.3f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.22f, 0.22f), color = FxColor.Tint,
                    },
                    new FxLayer
                    {
                        style = "StreakLight", count = FxScale.Lin(4, 2, 10), maxCount = 10, shape = FxShape.Cone, coneAngle = 40,
                        speed = new Vector2(8, 14), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.07f, 0.07f), life = new Vector2(0.15f, 0.28f),
                        color = FxColor.Hot, mix = 0.3f,
                    },
                    Clouds(1f, 3, 0.7f, 0.5f, LavaSmoke, 0.3f, 0.4f),
                },
                light = new FxLightSpec { intensity = FxScale.Const(2.2f), range = FxScale.Lin(3, 2, 7), life = 0.15f, color = FxColor.Hot, mix = 0.3f, lift = 0f },
            };
        }
    }

    /// <summary>首领 / 怪物专属预设（组文件里用的通用实现：字段直接写层、灯、环、贴花、震屏）</summary>
    public sealed class BossFxPreset : FxPreset
    {
        readonly string id;

        public override string Id => id;

        public BossFxPreset(string id, Color color, float scaleMin, float scaleMax)
        {
            this.id = id;
            DefaultColor = color;
            ScaleMin = scaleMin;
            ScaleMax = scaleMax;
        }

        public FxLayer[] layers
        {
            set => Layers = value;
        }

        public FxLightSpec light
        {
            set => Light = value;
        }

        public FxRingSpec ring
        {
            set => Ring = value;
        }

        public FxDecalSpec decal
        {
            set => Decal = value;
        }

        public FxShakeSpec shake
        {
            set => Shake = value;
        }
    }
}
