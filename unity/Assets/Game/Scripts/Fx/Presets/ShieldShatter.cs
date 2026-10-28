using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 破盾（FX1，Three.js 只有声音；B 路打磨）：整个护盾球壳碎开由 <see cref="ShieldBubble"/> 画（每格飞出），这里是它的伴随——
    /// 几片从壳面崩开的六边形格、蓝色碎片翻滚四散、电火花、「啪」的卡通冲击环（朝镜头）+ 贴地冲击环、蓝白闪光与灯、轻震屏。
    /// 规模 s = 身体半径（0.3–3 m）。颜色默认护盾蓝（调用方可以给元素色）。
    /// </summary>
    [Defs]
    public sealed class ShieldShatterPreset : FxPreset
    {
        public override string Id => "ShieldShatter";

        /// <summary>碎片 / 护盾格用的饱和深蓝（加法叠起来才不会变成一团白）</summary>
        static readonly Color Deep = Hex.Rgb(0x2f8cff);

        public ShieldShatterPreset()
        {
            DefaultColor = Fx.ShieldColor;
            ScaleMin = 0.3f;
            ScaleMax = 3f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.8f, 0.8f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.1f, 0.1f), color = FxColor.Hot, mix = 0.3f,
                },
                new FxLayer
                {
                    style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.4f, 0.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.2f, 0.2f), color = FxColor.Hot, mix = 0.1f,
                },
                // 护盾格：几片从球壳面上崩开（整壳碎开归 ShieldBubble）
                new FxLayer
                {
                    style = "Hex", count = FxScale.Lin(4, 3, 12), maxCount = 12, shape = FxShape.Sphere, spread = FxScale.Lin(0, 1.35f), spreadMin = 0.9f,
                    speed = new Vector2(1, 2.5f), size = new Vector2(0.3f, 0.45f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.35f, 0.5f),
                    color = FxColor.Fixed, fixedColor = Deep, mix = 0.3f, shade = new Vector2(0.8f, 1.15f),
                },
                // 碎片
                new FxLayer
                {
                    style = "Shard", count = FxScale.Lin(16, 10, 48), maxCount = 48, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.9f), spreadMin = 0.6f,
                    speed = new Vector2(3.5f, 8.5f), speedScale = FxScale.Pow(0.5f), up = 2, size = new Vector2(0.1f, 0.2f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.7f, 1.1f), color = FxColor.Fixed, fixedColor = Deep, mix = 0.25f, shade = new Vector2(0.75f, 1.2f),
                },
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(10, 4, 24), shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.6f),
                    speed = new Vector2(6, 12), size = new Vector2(0.04f, 0.04f), life = new Vector2(0.15f, 0.3f), color = FxColor.Hot, mix = 0.5f,
                },
                new FxLayer
                {
                    style = "ToonPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.3f, 1.3f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.24f, 0.24f), color = FxColor.Hot, mix = 0.25f,
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0.6f, 1.6f), duration = 0.38f, heightFactor = 3f, band = true };
            Light = new FxLightSpec { intensity = FxScale.Const(3.5f), range = FxScale.Lin(4, 2), life = 0.25f, color = FxColor.Hot, mix = 0.2f, lift = 0.2f };
            Shake = new FxShakeSpec { strength = FxScale.Const(0.12f), range = FxScale.Const(14), duration = FxScale.Const(0.16f), durationPerK = 0.08f };
        }
    }
}
