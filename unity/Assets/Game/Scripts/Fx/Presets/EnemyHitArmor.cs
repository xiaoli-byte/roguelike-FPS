using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 打在护甲上（FX1「破层」读得清）：像打铁——金白闪光、一把会弹跳的拉丝火花、两三片小甲屑，没有能量溅射。
    /// 颜色 = 元素色或护甲金（Three.js LAYER_COLORS.armor）。规模同 <see cref="EnemyHitPreset"/>。
    /// </summary>
    [Defs]
    public sealed class EnemyHitArmorPreset : FxPreset
    {
        public override string Id => "EnemyHitArmor";

        public EnemyHitArmorPreset()
        {
            DefaultColor = Fx.ArmorColor;
            ScaleMin = 0.3f;
            ScaleMax = 5f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.26f, 0.26f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.06f, 0.06f), color = FxColor.Hot, mix = 0.4f,
                },
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(4, 4), shape = FxShape.Sphere,
                    speed = new Vector2(5, 12), speedScale = FxScale.Lin(0, 1), up = 1, size = new Vector2(0.03f, 0.035f), life = new Vector2(0.12f, 0.3f),
                    color = FxColor.Alternate, every = 2, mix = 0.55f,
                },
                new FxLayer
                {
                    style = "Plate", count = FxScale.Lin(1, 1, 4), shape = FxShape.Sphere,
                    speed = new Vector2(2, 4.5f), up = 2, size = new Vector2(0.05f, 0.09f), life = new Vector2(0.5f, 0.8f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0xb88a40), mix = 0.35f, shade = new Vector2(0.75f, 1.15f),
                },
                new FxLayer
                {
                    style = "GlowHeavy", count = FxScale.Lin(1, 2), shape = FxShape.Sphere,
                    speed = new Vector2(1.5f, 4f), up = 1.5f, size = new Vector2(0.05f, 0.08f), life = new Vector2(0.3f, 0.55f),
                    color = FxColor.Hot, mix = 0.3f,
                },
            };
        }
    }
}
