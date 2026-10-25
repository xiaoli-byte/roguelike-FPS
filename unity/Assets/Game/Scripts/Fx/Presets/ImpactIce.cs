using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 弹着点 · 冰 / 雪（FX1 按材质区分）：冰碴（白蓝的尖碎片，翻滚着落地）+ 一蓬白色粉雾 + 亮晶晶的碎光，火花只有几道冷白的。
    /// 规模 s = size（0.2–4）。弹孔贴花是 HoleIce（崩白 + 星状白裂纹，不发热）。
    /// </summary>
    [Defs]
    public sealed class ImpactIcePreset : FxPreset
    {
        public override string Id => "ImpactIce";

        public ImpactIcePreset()
        {
            var ice = Hex.Rgb(0xdff4ff);
            DefaultColor = Fx.ImpactColor;
            ScaleMin = 0.2f;
            ScaleMax = 4f;
            Layers = new[]
            {
                // 冷白闪光
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.05f,
                    size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.08f, 0.08f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xd8f4ff), mix = 0.15f,
                },
                new FxLayer
                {
                    style = "Flare", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.08f,
                    size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.07f, 0.07f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xbfeaff), mix = 0,
                },
                // 冰碴
                new FxLayer
                {
                    style = "ShardIce", count = FxScale.Lin(5, 4, 24), maxCount = 24, shape = FxShape.Hemisphere, normalBias = 1f, offset = 0.04f,
                    speed = new Vector2(2.5f, 7f), speedScale = FxScale.Pow(0.5f), up = 1.2f, size = new Vector2(0.06f, 0.13f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.5f, 0.9f), color = FxColor.Fixed, fixedColor = ice, mix = 0, shade = new Vector2(0.85f, 1.1f),
                },
                // 白色粉雾
                new FxLayer
                {
                    style = "Powder", count = new FxScale(1, 1.5f, 1, 0, 4), shape = FxShape.Cone, coneAngle = 40, offset = 0.05f,
                    speed = new Vector2(0.6f, 1.6f), up = 0.2f, size = new Vector2(0.22f, 0.36f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.5f, 0.85f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xeef8ff), mix = 0,
                },
                // 碎光：带重力的小亮点
                new FxLayer
                {
                    style = "GlowHeavy", count = FxScale.Lin(3, 2, 10), shape = FxShape.Hemisphere, normalBias = 0.8f, offset = 0.04f,
                    speed = new Vector2(1.5f, 4.5f), up = 1, size = new Vector2(0.04f, 0.07f), life = new Vector2(0.35f, 0.6f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0xbfeaff), mix = 0,
                },
                // 几道冷白火花
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(2, 1), shape = FxShape.Hemisphere, normalBias = 0.7f, offset = 0.03f,
                    speed = new Vector2(4, 9), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.03f, 0.03f), life = new Vector2(0.1f, 0.2f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0xe8f8ff), mix = 0.2f,
                },
            };
        }
    }
}
