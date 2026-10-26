using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 暴击命中点的那一团（特效打磨 A 路改）：金色火花、暖白拉丝、碎块、一圈水平金拉丝、一颗小白芯。
    /// 星芒不在这里：由 <see cref="Fx.CritHit"/> 另播 CritFlare，放在身体轮廓外侧（旧版星芒 1 m + 闪光 0.82 m 罩在命中点，暴击连射时敌人整个被罩亮）。
    /// 也不再包含普通命中（层火花由 <see cref="Fx.EnemyHitOn"/> 先出）；规模 1 ≈ 一发步枪。
    /// </summary>
    [Defs]
    public sealed class EnemyHitCritPreset : FxPreset
    {
        public override string Id => "EnemyHitCrit";

        public EnemyHitCritPreset()
        {
            var gold = Hex.Rgb(0xffd24a);
            DefaultColor = Fx.HitColor;
            ScaleMin = 0.3f;
            ScaleMax = 5f;
            Layers = new[]
            {
                // 小白芯（只亮 0.05 s，直径 0.26 m：一眨眼的「咔」，不罩身体）
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.26f, 0.26f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.05f, 0.05f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xfff4d8), mix = 0,
                },
                // 金色火花（带重力）
                new FxLayer
                {
                    style = "Spark", count = FxScale.Lin(3, 2), shape = FxShape.Sphere,
                    speed = new Vector2(2f, 5f), speedScale = FxScale.Pow(0.5f), up = 1.5f, size = new Vector2(0.06f, 0.1f), life = new Vector2(0.22f, 0.4f),
                    color = FxColor.Fixed, fixedColor = gold, mix = 0.25f,
                },
                // 暖白拉丝（快）
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(4, 2), shape = FxShape.Sphere, speed = new Vector2(6, 12), speedScale = FxScale.Pow(0.5f),
                    size = new Vector2(0.03f, 0.03f), life = new Vector2(0.08f, 0.18f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xfff1d6), mix = 0,
                },
                // 碎块（敌人色压暗）
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(1, 1), shape = FxShape.Sphere,
                    speed = new Vector2(2, 5), up = 2, size = new Vector2(0.04f, 0.08f), life = new Vector2(0.4f, 0.8f), shade = new Vector2(0.7f, 0.7f),
                },
                // 一圈水平金拉丝（暴击的招牌）
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Const(6), density = false, shape = FxShape.Disc,
                    speed = new Vector2(7, 10), up = 0.6f, upJitter = 2, size = new Vector2(0.04f, 0.04f), life = new Vector2(0.09f, 0.14f),
                    color = FxColor.Fixed, fixedColor = gold, mix = 0,
                },
            };
        }
    }
}
