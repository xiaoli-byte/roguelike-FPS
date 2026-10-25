using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 打中敌人（Three.js Fx.ts enemyHit 的普通命中部分）。规模 s：普通 1，暴击由 <see cref="EnemyHitCritPreset"/> 以 1.7 包含本预设
    /// （速度、闪光按 s 放大，数量略增）。
    ///   闪光（白热）、能量溅射（带重力的发光粒）、敌人色碎块、火花。
    /// </summary>
    [Defs]
    public sealed class EnemyHitPreset : FxPreset
    {
        public override string Id => "EnemyHit";

        public EnemyHitPreset()
        {
            DefaultColor = Fx.HitColor;
            ScaleMin = 0.3f;
            ScaleMax = 5f;
            Layers = new[]
            {
                // 闪光
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.48f, 0.48f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.08f, 0.1f), color = FxColor.Hot, mix = 0.55f,
                },
                // 能量溅射
                new FxLayer
                {
                    style = "Spark", count = FxScale.Lin(1, 3), shape = FxShape.Sphere,
                    speed = new Vector2(1.5f, 4.5f), speedScale = FxScale.Lin(0, 1), up = 1.5f,
                    size = new Vector2(0.08f, 0.14f), life = new Vector2(0.2f, 0.4f),
                },
                // 碎块（敌人色压暗）
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(1, 1), shape = FxShape.Sphere,
                    speed = new Vector2(2, 5), up = 2, size = new Vector2(0.04f, 0.08f), life = new Vector2(0.4f, 0.8f), shade = new Vector2(0.7f, 0.7f),
                },
                // 火花
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(1, 3), shape = FxShape.Sphere,
                    speed = new Vector2(5, 11), speedScale = FxScale.Lin(0, 1), size = new Vector2(0.04f, 0.04f), life = new Vector2(0.08f, 0.2f),
                },
            };
        }
    }
}
