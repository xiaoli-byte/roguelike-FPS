using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 出生显形的收尾一下（FX2，Three.js Fx.ts spawnEffect 的 finale）：白热闪光、一圈水平外扩的光粒、几颗升起的符文、贴地小环。
    /// 法阵贴花、螺旋上升的光点、溶解显形由 <see cref="SpawnMaterialize"/> 驱动，这里只是显形完成那一刻。
    /// 规模 s = 身体直径（1 ≈ 普通人形），颜色 = 敌人定义色。
    /// </summary>
    [Defs]
    public sealed class SpawnFinalePreset : FxPreset
    {
        public override string Id => "SpawnFinale";

        public SpawnFinalePreset()
        {
            DefaultColor = Fx.EnemyColor;
            ScaleMin = 0.5f;
            ScaleMax = 6f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1f, 1f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.14f, 0.14f), color = FxColor.Hot, mix = 0.3f,
                },
                new FxLayer
                {
                    style = "GlowFall", count = FxScale.Lin(12, 6, 30), maxCount = 30, shape = FxShape.Disc, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(3, 5.5f), speedScale = FxScale.Pow(0.5f), up = 0.5f, upJitter = 1, size = new Vector2(0.08f, 0.13f), life = new Vector2(0.3f, 0.5f),
                },
                new FxLayer
                {
                    style = "Glyph", count = FxScale.Lin(2, 1, 6), shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f),
                    speed = new Vector2(0.3f, 0.9f), up = 0.8f, size = new Vector2(0.14f, 0.22f), life = new Vector2(0.5f, 0.8f), color = FxColor.Hot, mix = 0.3f,
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(1.2f, 0.8f), duration = 0.35f, heightFactor = 2.5f, band = false };
        }
    }
}
