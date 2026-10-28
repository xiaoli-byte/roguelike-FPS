using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 打在护盾上（FX1「破层」读得清）：能量体，没有碎肉——几片放大淡出的六边形护盾格、一圈「啪」的蓝环、蓝白闪光、轻拉丝电火花。
    /// 颜色 = 元素色或护盾蓝（Three.js LAYER_COLORS.shield）。规模同 <see cref="EnemyHitPreset"/>。
    /// </summary>
    [Defs]
    public sealed class EnemyHitShieldPreset : FxPreset
    {
        public override string Id => "EnemyHitShield";

        public EnemyHitShieldPreset()
        {
            DefaultColor = Fx.ShieldColor;
            ScaleMin = 0.3f;
            ScaleMax = 5f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.28f, 0.28f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.07f, 0.07f), color = FxColor.Hot, mix = 0.35f,
                },
                new FxLayer
                {
                    style = "Hex", count = FxScale.Lin(2, 1, 5), shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.08f),
                    speed = new Vector2(0.4f, 1.4f), size = new Vector2(0.22f, 0.32f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.22f, 0.32f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0x2f8cff), mix = 0.35f,
                },
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.28f, 0.28f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.18f, 0.18f), color = FxColor.Hot, mix = 0.3f,
                },
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(2, 3), shape = FxShape.Sphere,
                    speed = new Vector2(4, 9), speedScale = FxScale.Lin(0, 1), size = new Vector2(0.03f, 0.03f), life = new Vector2(0.08f, 0.18f),
                    color = FxColor.Alternate, every = 2, mix = 0.5f,
                },
            };
        }
    }
}
