using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰环（FX3；Three.js FrostPackFx.spawnIceRing 的粒子部分）：沿半径 ≈ 0.7 的一圈翻起雪雾和雪花、冰碴往外迸、中心一记星芒、
    /// 圈上零星闪粒。冰刺本体（冒出 → 停留 → 沉回）、两道冲击环、流动霜纹贴花由 <see cref="Fx.IceRing"/> 另画。
    /// 规模 s = 半径（1–8 m）；颜色 = 冰色。
    /// </summary>
    [Defs]
    public sealed class FrostRingBurstPreset : FxPreset
    {
        public override string Id => "FrostRingBurst";

        public FrostRingBurstPreset()
        {
            DefaultColor = FrostPalette.Ice;
            ScaleMin = 0.5f;
            ScaleMax = 8f;
            Layers = new[]
            {
                // 圈上的雪雾（出生点在 0.6–0.72 r 的环上，往外翻）
                new FxLayer
                {
                    style = "Powder", count = FxScale.Lin(8, 2, 22), maxCount = 22, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.72f), spreadMin = 0.83f,
                    offset = 0.12f, speed = new Vector2(0.8f, 1.8f), up = 0.5f, size = new Vector2(0.32f, 0.55f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.55f, 0.9f), color = FxColor.Fixed, fixedColor = FrostPalette.Snow, mix = 0.1f,
                },
                new FxLayer
                {
                    style = "Snow", count = FxScale.Lin(6, 2, 18), maxCount = 18, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.7f), spreadMin = 0.8f,
                    offset = 0.2f, speed = new Vector2(0.6f, 1.6f), up = 1.6f, size = new Vector2(0.07f, 0.12f), life = new Vector2(0.9f, 1.5f),
                    color = FxColor.Fixed, fixedColor = FrostPalette.Snow, mix = 0,
                },
                // 冰碴往外迸
                new FxLayer
                {
                    style = "ShardIce", count = FxScale.Lin(10, 3, 30), maxCount = 30, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.5f), spreadMin = 0.6f,
                    offset = 0.1f, speed = new Vector2(3f, 6f), up = 3.2f, size = new Vector2(0.05f, 0.1f), life = new Vector2(0.45f, 0.8f),
                    color = FxColor.Fixed, fixedColor = FrostPalette.Shard, mix = 0.3f,
                },
                new FxLayer
                {
                    style = "Twinkle", count = FxScale.Lin(4, 2, 14), maxCount = 14, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.75f), spreadMin = 0.7f,
                    offset = 0.3f, speed = new Vector2(0.2f, 0.8f), up = 0.6f, size = new Vector2(0.09f, 0.15f), life = new Vector2(0.5f, 1.0f),
                    color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.2f,
                },
                new FxLayer
                {
                    style = "IceStar", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.3f,
                    size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0.5f, 0.25f), life = new Vector2(0.16f, 0.16f), color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.1f,
                },
            };
        }
    }
}
