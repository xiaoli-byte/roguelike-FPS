using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎冰（FX3；Three.js iceShatter / iceShards 的「大块冰屑 + 细霜 + 冷雾」）：冷白闪光 + 一记冰晶星芒、六棱柱冰块翻滚落地、
    /// 细碎冰碴、一蓬白粉雾、几颗飘着闪的冰粒、带重力的冷光碎点、淡淡的「啪」环；冷色小闪光灯。
    /// 规模 s = 大小（0.3–4，冰羽 / 冰块 ≈ 0.5–1，巨蟹碎壳 ≈ 1.5）；颜色 = 冰色（冰碴、闪光按 30% 混进来：坦克的冰偏白、紫冰偏紫）。
    /// 入口：<see cref="Fx.FrostShatter"/>（<see cref="FrostKit.Shatter"/> 走这里）。
    /// </summary>
    [Defs]
    public sealed class FrostShatterPreset : FxPreset
    {
        public override string Id => "FrostShatter";

        public FrostShatterPreset()
        {
            DefaultColor = FrostPalette.Ice;
            ScaleMin = 0.3f;
            ScaleMax = 4f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.7f, 0.7f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.09f, 0.09f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xe0f6ff), mix = 0.2f,
                },
                new FxLayer
                {
                    style = "IceStar", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.95f, 0.95f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.15f, 0.15f), color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.15f,
                },
                // 六棱柱冰块
                new FxLayer
                {
                    style = "IceChunk", count = FxScale.Lin(4, 3f, 16), maxCount = 16, shape = FxShape.MostlyUp,
                    speed = new Vector2(2.4f, 5.6f), speedScale = FxScale.Pow(0.5f), up = 1.6f, size = new Vector2(0.15f, 0.3f), sizeScale = FxScale.Pow(0.6f),
                    life = new Vector2(0.65f, 1.05f), color = FxColor.Fixed, fixedColor = FrostPalette.Shard, mix = 0.3f, shade = new Vector2(0.85f, 1.08f),
                },
                // 发光的冰片（加法：亮的冰面 / 雪地上也读得出「碎了」）
                new FxLayer
                {
                    style = "Shard", count = FxScale.Lin(3, 3, 14), maxCount = 14, shape = FxShape.Sphere,
                    speed = new Vector2(2.5f, 6f), speedScale = FxScale.Pow(0.5f), up = 1.4f, size = new Vector2(0.1f, 0.18f), sizeScale = FxScale.Pow(0.6f),
                    life = new Vector2(0.45f, 0.8f), color = FxColor.Fixed, fixedColor = FrostPalette.Ice, mix = 0.35f,
                },
                // 细碎冰碴
                new FxLayer
                {
                    style = "ShardIce", count = FxScale.Lin(6, 6, 30), maxCount = 30, shape = FxShape.Sphere,
                    speed = new Vector2(3f, 7f), speedScale = FxScale.Pow(0.5f), up = 1.2f, size = new Vector2(0.05f, 0.1f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.5f, 0.85f), color = FxColor.Fixed, fixedColor = FrostPalette.Shard, mix = 0.3f, shade = new Vector2(0.85f, 1.1f),
                },
                // 白粉雾
                new FxLayer
                {
                    style = "Powder", count = new FxScale(2, 2, 1, 0, 9), maxCount = 9, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.2f),
                    speed = new Vector2(0.5f, 1.4f), size = new Vector2(0.28f, 0.48f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.6f, 1.0f), color = FxColor.Fixed, fixedColor = FrostPalette.Snow, mix = 0.1f,
                },
                // 飘着闪的冰粒
                new FxLayer
                {
                    style = "Twinkle", count = FxScale.Lin(4, 3, 14), maxCount = 14, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.25f),
                    speed = new Vector2(0.6f, 2.4f), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.08f, 0.15f),
                    life = new Vector2(0.45f, 0.9f), color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.2f,
                },
                // 带重力的冷光碎点
                new FxLayer
                {
                    style = "GlowHeavy", count = FxScale.Lin(3, 2, 10), maxCount = 10, shape = FxShape.MostlyUp,
                    speed = new Vector2(1.5f, 4.5f), speedScale = FxScale.Pow(0.5f), up = 1, size = new Vector2(0.04f, 0.07f),
                    life = new Vector2(0.35f, 0.6f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xbfeaff), mix = 0.25f,
                },
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.45f, 0.45f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.18f, 0.18f), color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.3f, alpha = 0.7f,
                },
            };
            Light = new FxLightSpec
            {
                intensity = FxScale.Lin(1.5f, 1.2f, 6), range = FxScale.Lin(2.5f, 2.5f, 10), life = 0.16f, color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.3f, lift = 0.2f,
            };
        }
    }
}
