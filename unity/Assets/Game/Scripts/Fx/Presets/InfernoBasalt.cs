using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎岩甲 / 渣墙崩碎（FX4；Three.js InfernoTankFx.basaltShards）：黑玄武岩碎块翻滚落地、碎块缝里还红着的炭渣、几颗熔滴、一团灰。
    /// 规模 s = 大小（0.3–3）；颜色 = 岩色（缺省玄武岩）。入口：<see cref="Fx.Basalt"/>。
    /// </summary>
    [Defs]
    public sealed class InfernoBasaltPreset : FxPreset
    {
        public override string Id => "InfernoBasalt";

        public InfernoBasaltPreset()
        {
            DefaultColor = InfernoPalette.Basalt;
            ScaleMin = 0.3f;
            ScaleMax = 3f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(6, 6, 26), maxCount = 26, shape = FxShape.MostlyUp,
                    speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2.5f, size = new Vector2(0.1f, 0.22f), sizeScale = FxScale.Pow(0.6f),
                    life = new Vector2(0.8f, 1.3f), color = FxColor.Tint, shade = new Vector2(0.7f, 1.3f),
                },
                new FxLayer
                {
                    style = "Cinder", count = FxScale.Lin(4, 4, 18), maxCount = 18, shape = FxShape.MostlyUp,
                    speed = new Vector2(2.5f, 6), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.06f, 0.12f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.6f, 1.1f), color = FxColor.Fixed, fixedColor = InfernoPalette.Ember, mix = 0,
                },
                new FxLayer
                {
                    style = "Molten", count = FxScale.Lin(2, 2, 8), shape = FxShape.MostlyUp,
                    speed = new Vector2(2, 4.5f), up = 1.5f, size = new Vector2(0.06f, 0.1f), life = new Vector2(0.4f, 0.7f), color = FxColor.Fixed, fixedColor = InfernoPalette.Molten, mix = 0,
                },
                new FxLayer
                {
                    style = "Dust", count = FxScale.Lin(1, 1.5f, 5), shape = FxShape.UpperSphere,
                    speed = new Vector2(0.5f, 1.4f), up = 0.6f, size = new Vector2(0.3f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.6f, 1.0f),
                    color = FxColor.Fixed, fixedColor = InfernoPalette.Slag, mix = 0,
                },
            };
        }
    }
}
