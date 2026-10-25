using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰爆（FX3：冰河豚鼓气自爆、冰柱砸地这类「冷的爆炸」）：<see cref="ExplosionPreset"/> 的火团、黑烟换成冷色——
    ///   冷白闪光球 + 大号冰晶星芒、一蓬往外翻的白粉雾、贴地翻滚不散的冷雾、六棱柱冰块与冰碴迸出、冷白拉丝、飘落的雪花和闪粒；
    ///   离地近时贴地冷环（带光墙）+ 流动霜纹贴花（<see cref="Fx.FrostNova"/> 铺，10 s）；冷色闪光灯；按距离震屏（比火药爆炸轻一点）。
    /// 规模 s = 半径（1–8 m）；颜色 = 冰色（闪光、拉丝混进来）。入口：<see cref="Fx.FrostNova"/>。
    /// </summary>
    [Defs]
    public sealed class FrostNovaPreset : FxPreset
    {
        public override string Id => "FrostNova";

        public FrostNovaPreset()
        {
            DefaultColor = FrostPalette.Ice;
            ScaleMin = 0.6f;
            ScaleMax = 8f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.3f, 0.3f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xbfeaff), mix = 0.4f,
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.2f, 1.2f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.08f, 0.08f), color = FxColor.White,
                },
                new FxLayer
                {
                    style = "IceStar", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.5f, 1.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.22f, 0.22f), color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.1f,
                },
                // 往外翻的白粉雾（爆炸的「肉」）
                new FxLayer
                {
                    style = "Powder", count = FxScale.Lin(8, 3, 26), maxCount = 26, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(1.2f, 3.0f), speedScale = FxScale.Lin(0, 1), up = 0.6f,
                    size = new Vector2(0.38f, 0.7f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.5f, 0.9f), color = FxColor.Fixed, fixedColor = FrostPalette.Snow, mix = 0.15f,
                },
                // 贴地翻滚不散的冷雾
                new FxLayer
                {
                    style = "FrostMist", count = FxScale.Lin(5, 1.5f, 14), maxCount = 14, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.6f), spreadMin = 0.15f,
                    offset = -0.3f, speed = new Vector2(0.5f, 1.3f), speedScale = FxScale.Pow(0.5f), up = 0.1f, size = new Vector2(0.7f, 1.1f), sizeScale = FxScale.Pow(0.6f),
                    life = new Vector2(1.6f, 2.6f), color = FxColor.Fixed, fixedColor = FrostPalette.Mist, mix = 0.15f, delay = 0.05f,
                },
                // 冰块
                new FxLayer
                {
                    style = "IceChunk", count = FxScale.Lin(6, 3, 24), maxCount = 24, shape = FxShape.MostlyUp,
                    speed = new Vector2(4, 10), speedScale = FxScale.Pow(0.5f), up = 2.5f, size = new Vector2(0.14f, 0.3f), sizeScale = FxScale.Pow(0.4f),
                    life = new Vector2(0.8f, 1.3f), color = FxColor.Fixed, fixedColor = FrostPalette.Shard, mix = 0.25f, shade = new Vector2(0.85f, 1.08f),
                },
                // 发光的冰片
                new FxLayer
                {
                    style = "Shard", count = FxScale.Lin(6, 3, 22), maxCount = 22, shape = FxShape.MostlyUp,
                    speed = new Vector2(4, 10), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.12f, 0.22f), sizeScale = FxScale.Pow(0.4f),
                    life = new Vector2(0.6f, 1.0f), color = FxColor.Fixed, fixedColor = FrostPalette.Ice, mix = 0.35f,
                },
                // 冰碴
                new FxLayer
                {
                    style = "ShardIce", count = FxScale.Lin(14, 6, 50), maxCount = 50, shape = FxShape.Sphere,
                    speed = new Vector2(6, 14), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.05f, 0.12f), sizeScale = FxScale.Pow(0.4f),
                    life = new Vector2(0.6f, 1.0f), color = FxColor.Fixed, fixedColor = FrostPalette.Shard, mix = 0.25f, shade = new Vector2(0.85f, 1.1f),
                },
                // 冷白拉丝
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(10, 4, 30), maxCount = 30, shape = FxShape.MostlyUp,
                    speed = new Vector2(8, 16), speedScale = new FxScale(0.8f, 0.08f, 1, 0, 1.5f), size = new Vector2(0.045f, 0.045f),
                    life = new Vector2(0.18f, 0.4f), color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.3f,
                },
                // 飘落的雪花 + 闪粒
                new FxLayer
                {
                    style = "Snow", count = FxScale.Lin(6, 3, 22), maxCount = 22, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.6f),
                    speed = new Vector2(0.6f, 2.2f), up = 1.2f, size = new Vector2(0.07f, 0.13f), life = new Vector2(1.2f, 2.0f),
                    color = FxColor.Fixed, fixedColor = FrostPalette.Snow, mix = 0, delay = 0.08f,
                },
                new FxLayer
                {
                    style = "Twinkle", count = FxScale.Lin(8, 3, 24), maxCount = 24, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.6f),
                    speed = new Vector2(0.4f, 1.6f), size = new Vector2(0.09f, 0.16f), life = new Vector2(0.6f, 1.2f),
                    color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.2f, delay = 0.1f,
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1.15f), duration = 0.45f, heightFactor = 1.2f, band = true };
            Light = new FxLightSpec
            {
                intensity = FxScale.Lin(3, 1.2f, 12), range = FxScale.Lin(4, 4, 30), life = 0.32f, color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.25f, lift = 0.4f,
            };
            Shake = new FxShakeSpec
            {
                strength = new FxScale(0.12f, 0.08f, 1, 0, 0.6f), range = FxScale.Lin(10, 4), duration = new FxScale(0.2f, 0.03f, 1, 0, 0.32f), durationPerK = 0.15f,
            };
        }
    }
}
