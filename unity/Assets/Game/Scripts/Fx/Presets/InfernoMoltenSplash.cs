using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔铜 / 熔岩飞溅（FX4；Three.js InfernoTankFx.moltenSplash、熔铜流落点）：亮橙闪一下、一蓬熔滴抛起落地（加法液团，落地弹一下）、
    /// 发红的炭渣、几道火星拉丝、一小团黑烟。规模 s = 大小（0.3–3）；颜色 = 熔液色（缺省熔铜橙）。入口：<see cref="Fx.MoltenSplash"/>。
    /// </summary>
    [Defs]
    public sealed class InfernoMoltenSplashPreset : FxPreset
    {
        public override string Id => "InfernoMoltenSplash";

        public InfernoMoltenSplashPreset()
        {
            DefaultColor = InfernoPalette.Molten;
            ScaleMin = 0.3f;
            ScaleMax = 3f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.1f,
                    size = new Vector2(0.8f, 0.8f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.12f, 0.12f), color = FxColor.Hot, mix = 0.35f,
                },
                new FxLayer
                {
                    style = "Molten", count = FxScale.Lin(6, 6, 28), maxCount = 28, shape = FxShape.MostlyUp,
                    speed = new Vector2(2.5f, 6f), speedScale = FxScale.Pow(0.5f), up = 2.2f, size = new Vector2(0.07f, 0.15f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.45f, 0.85f), color = FxColor.RandomMix, fixedColor = InfernoPalette.MoltenHot,
                },
                new FxLayer
                {
                    style = "Cinder", count = FxScale.Lin(3, 3, 14), maxCount = 14, shape = FxShape.MostlyUp,
                    speed = new Vector2(2, 5), speedScale = FxScale.Pow(0.5f), up = 1.5f, size = new Vector2(0.05f, 0.1f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.6f, 1.1f), color = FxColor.Tint,
                },
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(3, 3, 12), shape = FxShape.MostlyUp,
                    speed = new Vector2(5, 10), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.035f, 0.035f), life = new Vector2(0.15f, 0.35f), color = FxColor.Hot, mix = 0.4f,
                },
                new FxLayer
                {
                    style = "Soot", count = FxScale.Lin(1, 1, 4), shape = FxShape.UpperSphere, offset = 0.2f,
                    speed = new Vector2(0.3f, 0.8f), up = 0.8f, size = new Vector2(0.3f, 0.45f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.8f, 1.4f),
                    color = FxColor.Fixed, fixedColor = InfernoPalette.Soot, mix = 0, alpha = 0.7f,
                },
            };
            Light = new FxLightSpec { intensity = FxScale.Lin(1.5f, 1.5f, 6), range = FxScale.Lin(2, 2.5f, 10), life = 0.2f, color = FxColor.Hot, mix = 0.2f, lift = 0.3f };
        }
    }
}
