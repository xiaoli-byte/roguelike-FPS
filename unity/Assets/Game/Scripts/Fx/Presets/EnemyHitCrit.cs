using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 暴击命中（Three.js Fx.ts enemyHit 的 crit 分支）：先发一份普通命中（Fx.EnemyHit 以规模 ×1.7 调用，速度 / 闪光随之放大），
    /// 再加：更多溅射与碎块、暖白火花、金色星芒 + 白热核心、一圈水平拉丝。
    /// </summary>
    [Defs]
    public sealed class EnemyHitCritPreset : FxPreset
    {
        public override string Id => "EnemyHitCrit";

        public EnemyHitCritPreset()
        {
            var gold = Hex.Rgb(0xffd24a);
            DefaultColor = Fx.HitColor;
            ScaleMin = 0.5f;
            ScaleMax = 8f;
            Includes = new[] { "EnemyHit" };
            Layers = new[]
            {
                // 补足数量（普通 4 → 暴击 9 颗溅射、2 → 5 块碎块、4 → 10 道火花）
                new FxLayer
                {
                    style = "Spark", count = FxScale.Const(3), shape = FxShape.Sphere,
                    speed = new Vector2(1.5f, 4.5f), speedScale = FxScale.Lin(0, 1), up = 1.5f, size = new Vector2(0.06f, 0.11f), life = new Vector2(0.2f, 0.4f),
                },
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Const(2), shape = FxShape.Sphere,
                    speed = new Vector2(2, 5), up = 2, size = new Vector2(0.04f, 0.08f), life = new Vector2(0.4f, 0.8f), shade = new Vector2(0.7f, 0.7f),
                },
                new FxLayer
                {
                    style = "Streak", count = FxScale.Const(4), shape = FxShape.Sphere, speed = new Vector2(5, 11), speedScale = FxScale.Lin(0, 1),
                    size = new Vector2(0.03f, 0.03f), life = new Vector2(0.08f, 0.2f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xfff1d6), mix = 0,
                },
                // 金色星芒 + 白热核心
                new FxLayer
                {
                    style = "Flare", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1f, 1f), sizeScale = FxScale.Lin(0, 1 / 1.7f), life = new Vector2(0.12f, 0.12f), color = FxColor.Fixed, fixedColor = gold, mix = 0,
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.45f, 0.45f), sizeScale = FxScale.Lin(0, 1 / 1.7f), life = new Vector2(0.06f, 0.06f), color = FxColor.White,
                },
                // 一圈水平拉丝
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Const(8), density = false, shape = FxShape.Disc,
                    speed = new Vector2(9, 13), up = 1, upJitter = 3, size = new Vector2(0.045f, 0.045f), life = new Vector2(0.1f, 0.16f),
                    color = FxColor.Fixed, fixedColor = gold, mix = 0,
                },
                // Unity 追加（读得清）：一圈放大淡出的金环 + 两颗往外蹦的小金星
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.42f, 0.42f), sizeScale = FxScale.Lin(0, 1 / 1.7f), life = new Vector2(0.16f, 0.16f), color = FxColor.Fixed, fixedColor = gold, mix = 0,
                },
                new FxLayer
                {
                    style = "Star", count = FxScale.Const(2), density = false, shape = FxShape.Sphere,
                    speed = new Vector2(2.2f, 3.6f), up = 1.2f, size = new Vector2(0.13f, 0.18f), life = new Vector2(0.3f, 0.42f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0xffe27a), mix = 0,
                },
            };
        }
    }
}
