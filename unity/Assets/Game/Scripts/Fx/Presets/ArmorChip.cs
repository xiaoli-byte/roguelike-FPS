using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 破甲（FX1，Three.js 只有声音；B 路打磨成「更有分量」）：金白闪光 + 金色爆闪星（「铛」的一下）、
    /// 一圈金色甲片从身体表面崩飞、几块大甲片重重地翻滚落地弹跳、一大把粗拉丝的金属火花、发红的熔渣碎屑、滚落的火星、朝镜头的金色冲击环 + 贴地小环、灯、震屏。
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
                    size = new Vector2(1.4f, 1.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.1f, 0.1f), color = FxColor.Hot, mix = 0.6f,
                },
                new FxLayer
                {
                    style = "ToonBurst", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.9f, 1.9f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.12f, 0.12f), color = FxColor.Hot, mix = 0.3f,
                },
                // 甲片：一圈从身体表面崩飞
                new FxLayer
                {
                    style = "Plate", count = FxScale.Lin(10, 7, 30), maxCount = 30, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.9f), spreadMin = 0.7f,
                    speed = new Vector2(3, 7.5f), speedScale = FxScale.Pow(0.5f), up = 3.5f, size = new Vector2(0.13f, 0.26f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(1.1f, 1.8f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xb88a40), mix = 0.4f, shade = new Vector2(0.6f, 1.15f),
                },
                // 大甲片：几块重的，飞得低、落得快
                new FxLayer
                {
                    style = "Plate", count = FxScale.Lin(2, 1.5f, 6), maxCount = 6, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.8f), spreadMin = 0.6f,
                    speed = new Vector2(1.8f, 3.6f), speedScale = FxScale.Pow(0.5f), up = 4f, size = new Vector2(0.32f, 0.46f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(1.5f, 2.1f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0x9a7234), mix = 0.45f, shade = new Vector2(0.75f, 1.1f),
                },
                // 金属火花：粗、多、带重力弹跳
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(20, 9, 48), maxCount = 48, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.6f),
                    speed = new Vector2(8, 18), up = 2f, size = new Vector2(0.05f, 0.065f), life = new Vector2(0.3f, 0.7f),
                    color = FxColor.Alternate, every = 2, mix = 0.6f,
                },
                // 熔渣：发红的金属碎屑
                new FxLayer
                {
                    style = "Cinder", count = FxScale.Lin(5, 3, 14), maxCount = 14, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.6f),
                    speed = new Vector2(3, 7), up = 3, size = new Vector2(0.07f, 0.13f), life = new Vector2(0.8f, 1.3f), color = FxColor.Hot, mix = 0.25f,
                },
                new FxLayer
                {
                    style = "GlowHeavy", count = FxScale.Lin(5, 3, 16), shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.6f),
                    speed = new Vector2(2, 5), up = 2, size = new Vector2(0.07f, 0.12f), life = new Vector2(0.6f, 1f), color = FxColor.Hot, mix = 0.3f,
                },
                new FxLayer
                {
                    style = "ToonPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.15f, 1.15f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.22f, 0.22f), color = FxColor.Hot, mix = 0.25f,
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0.5f, 1.3f), duration = 0.34f, heightFactor = 3f, band = false };
            Light = new FxLightSpec { intensity = FxScale.Const(6), range = FxScale.Lin(4, 2), life = 0.24f, color = FxColor.Hot, mix = 0.3f, lift = 0.2f };
            Shake = new FxShakeSpec { strength = FxScale.Const(0.16f), range = FxScale.Const(14), duration = FxScale.Const(0.18f), durationPerK = 0.1f };
        }
    }
}
