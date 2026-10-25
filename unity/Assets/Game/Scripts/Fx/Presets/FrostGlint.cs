using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 星芒（FX3 一次性的「叮」：霜晶亮起、冰羽出手、冰光聚满、打在冰甲上）：一记放大淡出的六芒冰晶星芒 + 冷白小光核 + 周围四五颗闪粒。
    /// 持续挂在骨骼上的十字星光点（Three.js createFrostGlow，角尖 / 喷气孔蓄力）见 <see cref="Spiritfire.Game.FrostGlint"/>。
    /// 规模 s = 大小（0.2–3）；颜色 = 星芒色（缺省冰白）。入口：<see cref="Fx.FrostGlint"/>。
    /// </summary>
    [Defs]
    public sealed class FrostGlintPreset : FxPreset
    {
        public override string Id => "FrostGlint";

        public FrostGlintPreset()
        {
            DefaultColor = FrostPalette.IceHot;
            ScaleMin = 0.2f;
            ScaleMax = 3f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "IceStar", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1f, 1f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.2f, 0.2f),
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.35f, 0.35f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.12f, 0.12f), color = FxColor.Hot, mix = 0.5f,
                },
                new FxLayer
                {
                    style = "Twinkle", count = FxScale.Lin(3, 1.5f, 8), shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(0.3f, 1.2f), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.06f, 0.11f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.35f, 0.7f), color = FxColor.Hot, mix = 0.3f,
                },
            };
        }
    }
}
