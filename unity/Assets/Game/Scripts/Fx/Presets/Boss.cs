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
    /// </summary>
    [Defs(-98)]
    public sealed class FxBossStyles : IDefSource<FxPreset>
    {
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

            yield return new BossFxPreset("BossSplash", new Color(0.78f, 0.94f, 0.98f), 0.4f, 12f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.2f,
                        size = new Vector2(1.1f, 1.1f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.12f, 0.12f), color = FxColor.White,
                    },
                    // 冲天的水线
                    new FxLayer
                    {
                        style = "Spray", count = FxScale.Lin(18, 12, 70), maxCount = 70, shape = FxShape.Cone, coneAngle = 32, spread = FxScale.Lin(0, 0.45f), spreadY = 0.2f,
                        speed = new Vector2(7, 15), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.08f, 0.14f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.7f, 1.2f), color = FxColor.Hot, mix = 0.35f,
                    },
                    // 大水珠
                    new FxLayer
                    {
                        style = "Drop", count = FxScale.Lin(12, 8, 50), maxCount = 50, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.5f), spreadY = 0.2f,
                        speed = new Vector2(3, 8), speedScale = FxScale.Pow(0.5f), up = 3f, size = new Vector2(0.12f, 0.24f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.8f, 1.3f), color = FxColor.Tint,
                    },
                    // 白沫水雾
                    new FxLayer
                    {
                        style = "Powder", count = FxScale.Lin(5, 4, 18), maxCount = 18, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.6f), spreadY = 0.4f,
                        speed = new Vector2(1, 3.5f), speedScale = FxScale.Pow(0.5f), up = 1.2f, size = new Vector2(0.7f, 1.2f), sizeScale = FxScale.Pow(0.6f),
                        life = new Vector2(1.0f, 1.8f), color = FxColor.Fixed, fixedColor = Color.white, mix = 0.25f, alpha = 0.85f,
                    },
                    // 水面一圈白沫
                    new FxLayer
                    {
                        style = "RingFlat", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.05f,
                        size = new Vector2(1.6f, 1.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.55f, 0.55f), color = FxColor.White,
                    },
                },
            };

            yield return new BossFxPreset("BossSandBlast", new Color(0.86f, 0.68f, 0.42f), 0.4f, 12f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Spray", count = FxScale.Lin(14, 10, 60), maxCount = 60, shape = FxShape.Cone, coneAngle = 38, spread = FxScale.Lin(0, 0.45f), spreadY = 0.2f,
                        speed = new Vector2(6, 13), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.07f, 0.12f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.7f, 1.2f), color = FxColor.Tint, shade = new Vector2(0.8f, 1.1f),
                    },
                    new FxLayer
                    {
                        style = "Grit", count = FxScale.Lin(20, 14, 80), maxCount = 80, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.5f),
                        speed = new Vector2(3, 9), speedScale = FxScale.Pow(0.5f), up = 2.5f, size = new Vector2(0.04f, 0.08f), life = new Vector2(0.7f, 1.2f),
                        color = FxColor.Tint, shade = new Vector2(0.75f, 1.1f),
                    },
                    new FxLayer
                    {
                        style = "Dust", count = FxScale.Lin(6, 5, 22), maxCount = 22, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.7f), spreadY = 0.35f,
                        speed = new Vector2(1.5f, 4f), speedScale = FxScale.Pow(0.5f), up = 1f, size = new Vector2(0.9f, 1.6f), sizeScale = FxScale.Pow(0.6f),
                        life = new Vector2(1.1f, 2.0f), color = FxColor.Tint, shade = new Vector2(0.85f, 1.05f), alpha = 0.9f,
                    },
                    new FxLayer
                    {
                        style = "Chunk", count = FxScale.Lin(4, 3, 14), maxCount = 14, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.08f, 0.16f), life = new Vector2(0.7f, 1.1f),
                        color = FxColor.Fixed, fixedColor = Hex.Rgb(0x6b5134), mix = 0.2f,
                    },
                },
            };

            // 砸地：贴地翻滚的尘浪 + 碎石 + 少量火花，闪光很小、贴在地上，不盖住落地的身体
            yield return new BossFxPreset("BossSlam", new Color(0.55f, 0.45f, 0.38f), 0.5f, 12f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.1f,
                        size = new Vector2(0.9f, 0.9f), sizeScale = FxScale.Lin(0, 0.5f), life = new Vector2(0.08f, 0.08f), color = FxColor.Hot, mix = 0.4f,
                    },
                    new FxLayer
                    {
                        style = "Dust", count = FxScale.Lin(10, 6, 40), maxCount = 40, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.35f), spreadY = 0.1f,
                        speed = new Vector2(5, 11), speedScale = FxScale.Pow(0.5f), up = 0.4f, upJitter = 0.3f, size = new Vector2(0.8f, 1.5f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.8f, 1.4f), color = FxColor.Tint, shade = new Vector2(0.8f, 1.05f), alpha = 0.95f,
                    },
                    new FxLayer
                    {
                        style = "Chunk", count = FxScale.Lin(8, 5, 30), maxCount = 30, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(4, 10), speedScale = FxScale.Pow(0.5f), up = 3f, size = new Vector2(0.1f, 0.24f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.8f, 1.3f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0x2e2420), mix = 0.15f,
                    },
                    new FxLayer
                    {
                        style = "Streak", count = FxScale.Lin(6, 4, 22), maxCount = 22, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.2f),
                        speed = new Vector2(8, 15), speedScale = FxScale.Pow(0.5f), up = 2f, upJitter = 1.5f, size = new Vector2(0.045f, 0.045f),
                        life = new Vector2(0.25f, 0.5f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xffc070), mix = 0,
                    },
                    new FxLayer
                    {
                        style = "RingFlat", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.06f,
                        size = new Vector2(1.4f, 1.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.45f, 0.45f), color = FxColor.Fixed,
                        fixedColor = Hex.Rgb(0xffd8a0), mix = 0,
                    },
                },
                decal = new FxDecalSpec { kind = FxDecalKind.Crack, size = FxScale.Lin(0, 2.4f), heightFactor = 0.8f, heat = 0.9f, life = 14f },
                shake = new FxShakeSpec { strength = new FxScale(0.3f, 0.08f, 1, 0, 1f), range = FxScale.Lin(14, 5), duration = FxScale.Const(0.4f), durationPerK = 0.3f },
            };

            // 熔铜四溅：一大蓬熔滴抛起落地 + 炭渣 + 火星拉丝 + 一团黑烟；暖光小一点
            yield return new BossFxPreset("BossMoltenBurst", InfernoPalette.Molten, 0.4f, 10f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Molten", count = FxScale.Lin(14, 10, 70), maxCount = 70, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.35f), spreadY = 0.3f,
                        speed = new Vector2(4, 10), speedScale = FxScale.Pow(0.5f), up = 3f, size = new Vector2(0.1f, 0.24f), sizeScale = FxScale.Pow(0.4f),
                        life = new Vector2(0.6f, 1.2f), color = FxColor.RandomMix, fixedColor = InfernoPalette.MoltenHot,
                    },
                    new FxLayer
                    {
                        style = "Cinder", count = FxScale.Lin(8, 5, 30), maxCount = 30, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(3, 8), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.07f, 0.14f), life = new Vector2(0.8f, 1.5f),
                        color = FxColor.Tint,
                    },
                    new FxLayer
                    {
                        style = "StreakLight", count = FxScale.Lin(8, 5, 26), maxCount = 26, shape = FxShape.MostlyUp,
                        speed = new Vector2(7, 14), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.04f, 0.04f), life = new Vector2(0.2f, 0.45f),
                        color = FxColor.Hot, mix = 0.45f,
                    },
                    new FxLayer
                    {
                        style = "Soot", count = FxScale.Lin(2, 1.5f, 8), maxCount = 8, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), offset = 0.3f,
                        speed = new Vector2(0.4f, 1.2f), up = 1.2f, size = new Vector2(0.8f, 1.3f), sizeScale = FxScale.Pow(0.6f), life = new Vector2(1.2f, 2.0f),
                        color = FxColor.Fixed, fixedColor = InfernoPalette.Soot, mix = 0, alpha = 0.75f,
                    },
                },
                light = new FxLightSpec { intensity = FxScale.Lin(2, 1.2f, 7), range = FxScale.Lin(4, 2, 14), life = 0.3f, color = FxColor.Hot, mix = 0.2f, lift = 0.6f },
            };

            // 日轮炸亮：十字星芒 + 一圈金色拉丝 + 往上飘的金屑
            yield return new BossFxPreset("BossSunFlare", Hex.Rgb(0xffd27a), 0.3f, 10f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Flare", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(3.2f, 3.2f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.28f, 0.28f), color = FxColor.Hot, mix = 0.5f,
                    },
                    new FxLayer
                    {
                        style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(2.4f, 2.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.2f, 0.2f), color = FxColor.Hot, mix = 0.4f,
                    },
                    new FxLayer
                    {
                        style = "StreakLight", count = FxScale.Lin(14, 6, 40), maxCount = 40, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(9, 18), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.06f, 0.06f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.25f, 0.5f), color = FxColor.Hot, mix = 0.3f,
                    },
                    new FxLayer
                    {
                        style = "Mote", count = FxScale.Lin(10, 6, 30), maxCount = 30, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.6f),
                        speed = new Vector2(1, 3), size = new Vector2(0.1f, 0.18f), life = new Vector2(0.7f, 1.2f), color = FxColor.Tint,
                    },
                },
                light = new FxLightSpec { intensity = FxScale.Lin(4, 2, 12), range = FxScale.Lin(10, 4, 40), life = 0.35f, color = FxColor.Hot, mix = 0.3f, lift = 0f },
            };

            // 羽刃落地：冰碴、冰晶星芒、几片雪、一小团粉雾
            yield return new BossFxPreset("BossFeather", FrostPalette.Ice, 0.3f, 4f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "IceStar", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.25f,
                        size = new Vector2(1.1f, 1.1f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.18f, 0.18f), color = FxColor.Hot, mix = 0.5f,
                    },
                    new FxLayer
                    {
                        style = "ShardIce", count = FxScale.Lin(6, 4, 18), maxCount = 18, shape = FxShape.MostlyUp,
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.06f, 0.13f), life = new Vector2(0.5f, 0.9f),
                        color = FxColor.Fixed, fixedColor = FrostPalette.Shard, mix = 0.2f,
                    },
                    new FxLayer
                    {
                        style = "Snow", count = FxScale.Lin(4, 3, 12), maxCount = 12, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f),
                        speed = new Vector2(0.8f, 2f), up = 1f, size = new Vector2(0.08f, 0.14f), life = new Vector2(0.9f, 1.5f), color = FxColor.Fixed,
                        fixedColor = FrostPalette.Snow, mix = 0,
                    },
                    new FxLayer
                    {
                        style = "Powder", count = FxScale.Lin(2, 1.5f, 6), maxCount = 6, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(0.5f, 1.5f), up = 0.6f, size = new Vector2(0.6f, 0.9f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.7f, 1.1f),
                        color = FxColor.Fixed, fixedColor = Color.white, mix = 0.2f, alpha = 0.8f,
                    },
                },
            };

            // 狐火炸开：青白鬼火一团、几缕往上飘的磷火、细拉丝
            yield return new BossFxPreset("BossFoxfire", Hex.Rgb(0x7fd8ff), 0.3f, 4f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(1.2f, 1.2f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.16f, 0.16f), color = FxColor.Hot, mix = 0.5f,
                    },
                    new FxLayer
                    {
                        style = "Flame", count = FxScale.Lin(5, 4, 14), maxCount = 14, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.35f),
                        speed = new Vector2(0.5f, 1.8f), up = 1f, size = new Vector2(0.25f, 0.45f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.4f, 0.7f),
                        color = FxColor.Alternate, every = 3, mix = 0.5f,
                    },
                    new FxLayer
                    {
                        style = "Mote", count = FxScale.Lin(6, 4, 16), maxCount = 16, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                        speed = new Vector2(1, 3), size = new Vector2(0.08f, 0.14f), life = new Vector2(0.6f, 1f), color = FxColor.Tint,
                    },
                    new FxLayer
                    {
                        style = "StreakLight", count = FxScale.Lin(5, 3, 12), maxCount = 12, shape = FxShape.Sphere,
                        speed = new Vector2(5, 9), size = new Vector2(0.035f, 0.035f), life = new Vector2(0.15f, 0.3f), color = FxColor.Hot, mix = 0.4f,
                    },
                },
                light = new FxLightSpec { intensity = FxScale.Const(2.5f), range = FxScale.Lin(3, 2, 8), life = 0.25f, color = FxColor.Tint, lift = 0f },
            };

            // 傩面碎裂：红漆木片翻滚着崩飞、描金碎屑闪一下、一圈火星、一小团黑烟
            yield return new BossFxPreset("BossFaceShatter", Hex.Rgb(0xd8402a), 0.3f, 3f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(0.6f, 0.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.18f, 0.18f), color = FxColor.Fixed,
                        fixedColor = Hex.Rgb(0xffd27a), mix = 0,
                    },
                    new FxLayer
                    {
                        style = "Plate", count = FxScale.Lin(8, 6, 22), maxCount = 22, shape = FxShape.Hemisphere, normalBias = 0.6f,
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.09f, 0.18f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.8f, 1.3f), color = FxColor.Alternate, every = 4, mix = 0.15f,
                    },
                    new FxLayer
                    {
                        style = "Star", count = FxScale.Lin(4, 3, 10), maxCount = 10, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.2f),
                        speed = new Vector2(1.5f, 3.5f), size = new Vector2(0.1f, 0.16f), life = new Vector2(0.3f, 0.5f), color = FxColor.Fixed,
                        fixedColor = Hex.Rgb(0xffd27a), mix = 0,
                    },
                    new FxLayer
                    {
                        style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(0.7f, 0.7f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.22f, 0.22f), color = FxColor.Fixed,
                        fixedColor = Hex.Rgb(0xffb050), mix = 0,
                    },
                    new FxLayer
                    {
                        style = "Soot", count = FxScale.Lin(1, 1, 4), maxCount = 4, shape = FxShape.UpperSphere, offset = 0.1f,
                        speed = new Vector2(0.3f, 0.8f), up = 0.6f, size = new Vector2(0.4f, 0.6f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.8f, 1.2f),
                        color = FxColor.Fixed, fixedColor = InfernoPalette.Soot, mix = 0, alpha = 0.6f,
                    },
                },
            };

            // 重拳冲击：拳面前方一记白热冲击球 + 一圈往前喷的气浪 + 碎石火星
            yield return new BossFxPreset("BossPunch", Hex.Rgb(0xffb060), 0.3f, 4f)
            {
                layers = new[]
                {
                    new FxLayer
                    {
                        style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(0.7f, 0.7f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.16f, 0.16f), color = FxColor.Hot, mix = 0.5f,
                    },
                    new FxLayer
                    {
                        style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                        size = new Vector2(1.1f, 1.1f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.2f, 0.2f), color = FxColor.Hot, mix = 0.3f,
                    },
                    new FxLayer
                    {
                        style = "StreakLight", count = FxScale.Lin(8, 5, 22), maxCount = 22, shape = FxShape.Cone, coneAngle = 40,
                        speed = new Vector2(8, 15), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.05f, 0.05f), life = new Vector2(0.15f, 0.3f),
                        color = FxColor.Hot, mix = 0.4f,
                    },
                    new FxLayer
                    {
                        style = "Dust", count = FxScale.Lin(4, 3, 12), maxCount = 12, shape = FxShape.Cone, coneAngle = 55,
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.4f, 0.7f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.4f, 0.7f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0x6a5a50), mix = 0.1f, alpha = 0.8f,
                    },
                    new FxLayer
                    {
                        style = "Cinder", count = FxScale.Lin(4, 3, 12), maxCount = 12, shape = FxShape.Cone, coneAngle = 45,
                        speed = new Vector2(4, 9), size = new Vector2(0.06f, 0.11f), life = new Vector2(0.5f, 0.9f), color = FxColor.Tint,
                    },
                },
                light = new FxLightSpec { intensity = FxScale.Const(3f), range = FxScale.Lin(3, 2, 8), life = 0.18f, color = FxColor.Hot, mix = 0.3f, lift = 0f },
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
