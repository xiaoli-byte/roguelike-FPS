using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 断链（FX4；Three.js InfernoRangedFx.dropChain 的崩断一瞬）：勾魂索被打断——一串铁环崩飞翻滚落地、断口一蓬金属火花、两三颗烧红的铁渣、白热一闪。
    /// 散落在地上慢慢冷却的那截链子由 <see cref="FxChain.Drop"/> 画。规模 s = 大小（0.3–2）；颜色 = 断口火花色（烧红 → 橙，冷链 → 暖白）。
    /// </summary>
    [Defs]
    public sealed class InfernoChainBreakPreset : FxPreset
    {
        public override string Id => "InfernoChainBreak";

        public InfernoChainBreakPreset()
        {
            DefaultColor = InfernoPalette.Hot;
            ScaleMin = 0.3f;
            ScaleMax = 2f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.6f, 0.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.07f, 0.07f), color = FxColor.White,
                },
                new FxLayer
                {
                    style = "Link", count = FxScale.Lin(4, 4, 12), maxCount = 12, shape = FxShape.Sphere,
                    speed = new Vector2(2.5f, 6f), speedScale = FxScale.Pow(0.5f), up = 2.5f, size = new Vector2(0.1f, 0.15f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.9f, 1.4f), color = FxColor.Fixed, fixedColor = InfernoPalette.Iron, mix = 0, shade = new Vector2(0.8f, 1.2f),
                },
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(10, 6, 30), maxCount = 30, shape = FxShape.Sphere,
                    speed = new Vector2(6, 14), speedScale = FxScale.Pow(0.5f), up = 1.5f, size = new Vector2(0.035f, 0.035f), life = new Vector2(0.2f, 0.45f),
                    color = FxColor.Alternate, every = 3, mix = 0.5f,
                },
                new FxLayer
                {
                    style = "Cinder", count = FxScale.Lin(2, 2, 6), shape = FxShape.MostlyUp,
                    speed = new Vector2(2, 4.5f), up = 1.5f, size = new Vector2(0.05f, 0.08f), life = new Vector2(0.6f, 1f), color = FxColor.Fixed, fixedColor = InfernoPalette.Ember, mix = 0,
                },
            };
            Light = new FxLightSpec { intensity = FxScale.Const(3), range = FxScale.Const(4), life = 0.12f, color = FxColor.Hot, mix = 0.4f, lift = 0.1f };
        }
    }
}
