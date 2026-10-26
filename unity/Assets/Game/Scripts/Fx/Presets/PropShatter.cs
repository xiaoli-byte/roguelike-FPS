using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 场景件碎裂（L6 <see cref="Destructible"/> / <see cref="BreakableSpan"/>：木箱、陶瓮、石碑、朽桥板）：一记暗闪、
    /// 本色碎块翻滚落地弹跳、一把本色碎片（木片 / 陶片）、细砂粒、一团本色尘土。不发光、不带火星（和死亡迸散、炸岩区分开）。
    /// 规模 s = 件的大小（米，0.3–4：陶瓮 ≈ 0.6，木箱 ≈ 1，桥板一段 ≈ 1.5）；颜色 = 材质色（木 / 陶 / 石，见 Destructible.KindColor）。
    /// 冰件走 FrostShatter、金属件走 ArmorChip，不用这个。
    /// </summary>
    [Defs]
    public sealed class PropShatterPreset : FxPreset
    {
        public override string Id => "PropShatter";

        public PropShatterPreset()
        {
            DefaultColor = Hex.Rgb(0x8a6440);
            ScaleMin = 0.3f;
            ScaleMax = 4f;
            Layers = new[]
            {
                // 碎块：本色、深浅不一，带重力翻滚、落地弹跳
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(7, 7, 34), maxCount = 34, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.35f),
                    speed = new Vector2(2.2f, 6f), speedScale = FxScale.Pow(0.5f), up = 2.6f, upJitter = 1.2f,
                    size = new Vector2(0.1f, 0.24f), sizeScale = FxScale.Pow(0.6f), life = new Vector2(0.9f, 1.5f), color = FxColor.Tint, shade = new Vector2(0.55f, 1.1f),
                },
                // 片状碎片（木片 / 陶片）：翻得更快、飞得更远
                new FxLayer
                {
                    style = "Plate", count = FxScale.Lin(5, 5, 22), maxCount = 22, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(3f, 7.5f), speedScale = FxScale.Pow(0.5f), up = 2.2f, size = new Vector2(0.08f, 0.18f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.8f, 1.3f), color = FxColor.Tint, shade = new Vector2(0.7f, 1.2f),
                },
                // 细砂粒
                new FxLayer
                {
                    style = "Grit", count = FxScale.Lin(8, 6, 30), maxCount = 30, shape = FxShape.MostlyUp,
                    speed = new Vector2(2f, 5.5f), speedScale = FxScale.Pow(0.5f), up = 1.4f, size = new Vector2(0.03f, 0.06f), life = new Vector2(0.4f, 0.8f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0xb89a72), mix = 0.5f,
                },
                // 本色尘土
                new FxLayer
                {
                    style = "Dust", count = new FxScale(2, 2.5f, 1, 0, 10), maxCount = 10, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), spreadY = 0.6f,
                    speed = new Vector2(0.5f, 1.6f), up = 0.5f, size = new Vector2(0.35f, 0.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.7f, 1.2f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0x9c8f7c), mix = 0.35f,
                },
                // 碎裂一瞬的暗闪（不发白：只是让「碎了」这一帧读得出来）
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.16f, 0.16f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xe8d8b8), mix = 0.2f, alpha = 0.55f,
                },
            };
        }
    }
}
