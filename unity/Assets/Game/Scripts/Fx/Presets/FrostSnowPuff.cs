using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 扬雪（FX3：起跳、落地、刹车、出水时脚下踢起的雪）：贴地往外翻的白粉雾 + 几片雪花 + 两三颗冰碴。
    /// 规模 s = 体型（0.3–3）。入口：<see cref="FrostKit.SnowPuff"/>。
    /// </summary>
    [Defs]
    public sealed class FrostSnowPuffPreset : FxPreset
    {
        public override string Id => "FrostSnowPuff";

        public FrostSnowPuffPreset()
        {
            DefaultColor = FrostPalette.Snow;
            ScaleMin = 0.3f;
            ScaleMax = 3f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Powder", count = FxScale.Lin(2, 2, 7), maxCount = 7, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.25f),
                    speed = new Vector2(0.8f, 1.8f), speedScale = FxScale.Pow(0.5f), up = 0.5f, size = new Vector2(0.22f, 0.38f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.45f, 0.75f), color = FxColor.Tint,
                },
                new FxLayer
                {
                    style = "Snow", count = FxScale.Lin(2, 2, 7), shape = FxShape.UpperSphere,
                    speed = new Vector2(0.8f, 2.0f), up = 1.4f, size = new Vector2(0.05f, 0.09f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.6f, 1.0f),
                    color = FxColor.Fixed, fixedColor = FrostPalette.Snow, mix = 0,
                },
                new FxLayer
                {
                    style = "ShardIce", count = FxScale.Lin(1, 1.5f, 5), shape = FxShape.UpperSphere,
                    speed = new Vector2(1.5f, 3.2f), up = 1.2f, size = new Vector2(0.03f, 0.06f), life = new Vector2(0.4f, 0.7f),
                    color = FxColor.Fixed, fixedColor = FrostPalette.Shard, mix = 0,
                },
            };
        }
    }
}
