using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 弹着点 · 金属（FX1 按材质区分）：打铁就是一大把明亮的拉丝火花（大多从反射方向喷出、落地弹跳）+ 白热闪光 + 几颗滚落的火星，没有尘土。
    /// 规模 s = size（0.2–4）。弹孔贴花是 HoleMetal（亮擦痕 + 烧红的坑，1 s 内冷却）。
    /// </summary>
    [Defs]
    public sealed class ImpactMetalPreset : FxPreset
    {
        public override string Id => "ImpactMetal";

        public ImpactMetalPreset()
        {
            var spark = Hex.Rgb(0xffc060);
            DefaultColor = Fx.ImpactColor;
            ScaleMin = 0.2f;
            ScaleMax = 4f;
            Layers = new[]
            {
                // 白热闪光（比石面亮一档）
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.05f,
                    size = new Vector2(0.65f, 0.65f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.07f, 0.07f), color = FxColor.White,
                },
                new FxLayer
                {
                    style = "Flare", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.08f,
                    size = new Vector2(0.7f, 0.7f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.07f, 0.07f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xfff0c0), mix = 0,
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.03f,
                    size = new Vector2(0.26f, 0.26f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.12f, 0.12f), color = FxColor.Fixed, fixedColor = spark, mix = 0.2f,
                },
                // 一大把拉丝火花：反射方向（法线一侧、偏 0.5），一半白热
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(10, 7, 44), maxCount = 44, shape = FxShape.Hemisphere, normalBias = 0.5f, offset = 0.03f,
                    speed = new Vector2(6, 16), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.04f, 0.05f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.15f, 0.45f), color = FxColor.Fixed, fixedColor = spark, mix = 0.25f,
                },
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(3, 3, 18), maxCount = 18, shape = FxShape.Hemisphere, normalBias = 0.6f, offset = 0.03f,
                    speed = new Vector2(8, 18), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.025f, 0.03f), life = new Vector2(0.1f, 0.3f), color = FxColor.White,
                },
                // 滚落的火星
                new FxLayer
                {
                    style = "GlowHeavy", count = FxScale.Lin(2, 2, 10), shape = FxShape.Hemisphere, normalBias = 0.9f, offset = 0.04f,
                    speed = new Vector2(1.5f, 4f), up = 1, size = new Vector2(0.05f, 0.08f), life = new Vector2(0.5f, 0.9f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0xff9a40), mix = 0,
                },
            };
        }
    }
}
