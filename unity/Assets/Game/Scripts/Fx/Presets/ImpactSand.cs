using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 弹着点 · 沙 / 松土 / 灰烬（FX1 按材质区分）：沙打不出火花——一束沿法线喷起的沙粒 + 一蓬沙雾，命中闪光又小又暖。
    /// 规模 s = size（0.2–4），同 <see cref="ImpactPreset"/>。弹孔贴花是 HoleSand（软凹 + 翻起的亮沙边）。
    /// </summary>
    [Defs]
    public sealed class ImpactSandPreset : FxPreset
    {
        public override string Id => "ImpactSand";

        public ImpactSandPreset()
        {
            var sand = Hex.Rgb(0xd8b880);
            DefaultColor = Fx.ImpactColor;
            ScaleMin = 0.2f;
            ScaleMax = 4f;
            Layers = new[]
            {
                // 小而暖的命中闪光
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.05f,
                    size = new Vector2(0.4f, 0.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.07f, 0.07f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xffe2b0), mix = 0.2f,
                },
                // 喷起的沙粒：沿法线的窄锥，落地弹一下
                new FxLayer
                {
                    style = "Grit", count = FxScale.Lin(7, 5, 30), maxCount = 30, shape = FxShape.Cone, coneAngle = 28, offset = 0.03f,
                    speed = new Vector2(2.5f, 6.5f), speedScale = FxScale.Pow(0.5f), up = 0.6f, size = new Vector2(0.05f, 0.09f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.45f, 0.8f), color = FxColor.Fixed, fixedColor = sand, mix = 0, shade = new Vector2(0.6f, 1f),
                },
                // 沙雾：比石面的灰尘大一圈、颜色更黄
                new FxLayer
                {
                    style = "Dust", count = new FxScale(1, 2, 1, 0, 5), shape = FxShape.Cone, coneAngle = 35, offset = 0.05f,
                    speed = new Vector2(0.8f, 2.2f), up = 0.3f, size = new Vector2(0.4f, 0.6f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.5f, 0.9f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xb08a5a), mix = 0, shade = new Vector2(0.8f, 1f),
                },
                // 一两点火星（打到沙里的碎石）
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(1, 1), shape = FxShape.Hemisphere, normalBias = 0.8f, offset = 0.03f,
                    speed = new Vector2(4, 9), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.03f, 0.03f), life = new Vector2(0.1f, 0.22f),
                    color = FxColor.Hot, mix = 0.4f,
                },
            };
        }
    }
}
