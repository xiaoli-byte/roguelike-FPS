using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 死亡迸散（FX2，Three.js Fx.ts deathEffect 移植）：白热闪光 + 主色闪光球、敌人色碎块（深浅不一，带重力翻滚）、发光碎屑、火花、
    /// 一小团烟、几颗慢慢升起的魂火、贴地小环；Unity 追加一圈放大淡出的主色环。尸体之后由 <see cref="DeathDissolve"/> 溶解消失。
    /// 规模 s = 身体直径（0.5–6），颜色 = 敌人定义色。烟比 Three.js 少一半（不糊屏）。
    /// </summary>
    [Defs]
    public sealed class DeathPreset : FxPreset
    {
        public override string Id => "Death";

        public DeathPreset()
        {
            DefaultColor = Fx.EnemyColor;
            ScaleMin = 0.5f;
            ScaleMax = 6f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.5f, 1.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.14f, 0.14f), color = FxColor.Hot, mix = 0.5f,
                },
                new FxLayer
                {
                    style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.4f, 0.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.2f, 0.2f),
                },
                // 碎块
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(9, 6, 50), maxCount = 50, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.25f),
                    speed = new Vector2(2.5f, 7.5f), speedScale = new FxScale(0.8f, 0.15f), up = 3.5f, upJitter = 1.5f,
                    size = new Vector2(0.07f, 0.17f), sizeScale = FxScale.Pow(0.6f), life = new Vector2(0.9f, 1.6f), shade = new Vector2(0.45f, 1f),
                },
                // 发光碎屑
                new FxLayer
                {
                    style = "GlowFall", count = FxScale.Lin(12, 6, 50), maxCount = 50, shape = FxShape.Sphere,
                    speed = new Vector2(1.5f, 5.5f), up = 1.5f, size = new Vector2(0.07f, 0.14f), life = new Vector2(0.35f, 0.8f),
                    color = FxColor.Alternate, every = 2, mix = 0.5f,
                },
                // 火花
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(8, 4, 40), maxCount = 40, shape = FxShape.Sphere,
                    speed = new Vector2(6, 13), up = 2, size = new Vector2(0.03f, 0.03f), life = new Vector2(0.2f, 0.5f),
                },
                // 一小团烟（深灰掺 30% 主色）
                new FxLayer
                {
                    style = "Smoke", count = FxScale.Lin(2, 1, 8), maxCount = 8, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.3f), spreadY = 0.67f,
                    speed = new Vector2(0.5f, 1.6f), up = 0.6f, size = new Vector2(0.5f, 0.85f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.9f, 1.5f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0x2b2623), mix = 0.3f,
                },
                // 魂火：几颗慢慢升起的光点
                new FxLayer
                {
                    style = "Mote", count = new FxScale(1.4f, 0.6f, 1, 2, 4), density = false, shape = FxShape.Point, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(0, 0.4f), up = 0.95f, upJitter = 0.45f, size = new Vector2(0.12f, 0.2f), life = new Vector2(0.9f, 1.4f),
                    color = FxColor.Hot, mix = 0.5f,
                },
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.6f, 0.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.24f, 0.24f), color = FxColor.Hot, mix = 0.3f,
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1.2f), duration = 0.38f, heightFactor = 1.5f, band = false };
        }
    }
}
