using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 霜气（FX3；Three.js frostVapour）：几团慢慢往上飘、散开的冷雾 + 两三颗闪粒。颜色 = 雾色（旋龟的白、紫冰的紫、青光的青按 55% 混进白雾）。
    /// 规模 s = 大小（0.3–3）。入口：<see cref="Fx.FrostVapour"/>（<see cref="FrostKit.Vapour"/> 走这里）。
    /// </summary>
    [Defs]
    public sealed class FrostVapourPreset : FxPreset
    {
        public override string Id => "FrostVapour";

        public FrostVapourPreset()
        {
            DefaultColor = FrostPalette.Mist;
            ScaleMin = 0.3f;
            ScaleMax = 3f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "FrostMist", count = new FxScale(2, 1.2f, 1, 0, 6), maxCount = 6, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.2f),
                    speed = new Vector2(0.3f, 0.9f), up = 0.5f, size = new Vector2(0.32f, 0.5f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.8f, 1.3f), color = FxColor.Fixed, fixedColor = FrostPalette.Mist, mix = 0.55f,
                },
                new FxLayer
                {
                    style = "Powder", count = FxScale.Lin(1, 1, 4), shape = FxShape.UpperSphere,
                    speed = new Vector2(0.4f, 1.0f), up = 0.4f, size = new Vector2(0.22f, 0.34f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.5f, 0.8f), color = FxColor.Fixed, fixedColor = FrostPalette.Snow, mix = 0.4f,
                },
                new FxLayer
                {
                    style = "Twinkle", count = FxScale.Lin(1, 1.5f, 5), shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(0.2f, 0.8f), up = 0.3f, size = new Vector2(0.07f, 0.12f), life = new Vector2(0.5f, 0.9f),
                    color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.35f,
                },
            };
        }
    }
}
