using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 破甲（FX1，Three.js 只有声音）：一圈金色甲片从身体表面崩飞、翻滚落地弹跳，一大把会弹跳的金属火花、滚落的火星、金环、金白闪光与灯、轻震屏。
    /// 规模 s = 身体半径（0.3–3 m）。颜色默认护甲金。
    /// </summary>
    [Defs]
    public sealed class ArmorChipPreset : FxPreset
    {
        public override string Id => "ArmorChip";

        public ArmorChipPreset()
        {
            DefaultColor = Fx.ArmorColor;
            ScaleMin = 0.3f;
            ScaleMax = 3f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.2f, 1.2f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.1f, 0.1f), color = FxColor.Hot, mix = 0.6f,
                },
                // 甲片
                new FxLayer
                {
                    style = "Plate", count = FxScale.Lin(9, 6, 26), maxCount = 26, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.9f), spreadMin = 0.7f,
                    speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 3, size = new Vector2(0.1f, 0.22f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.9f, 1.4f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xb88a40), mix = 0.4f, shade = new Vector2(0.6f, 1.15f),
                },
                // 金属火花
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(12, 6, 32), maxCount = 32, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.6f),
                    speed = new Vector2(6, 14), up = 1.5f, size = new Vector2(0.035f, 0.045f), life = new Vector2(0.2f, 0.5f),
                    color = FxColor.Alternate, every = 2, mix = 0.55f,
                },
                new FxLayer
                {
                    style = "GlowHeavy", count = FxScale.Lin(4, 3, 14), shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.6f),
                    speed = new Vector2(2, 5), up = 2, size = new Vector2(0.06f, 0.1f), life = new Vector2(0.5f, 0.9f), color = FxColor.Hot, mix = 0.3f,
                },
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.9f, 0.9f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.22f, 0.22f), color = FxColor.Hot, mix = 0.25f,
                },
            };
            Light = new FxLightSpec { intensity = FxScale.Const(5), range = FxScale.Lin(4, 2), life = 0.22f, color = FxColor.Hot, mix = 0.3f, lift = 0.2f };
            Shake = new FxShakeSpec { strength = FxScale.Const(0.1f), range = FxScale.Const(14), duration = FxScale.Const(0.15f), durationPerK = 0.08f };
        }
    }
}
