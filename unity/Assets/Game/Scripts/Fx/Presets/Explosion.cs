using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 爆炸（Three.js Fx.ts explosion，3.13「炸起来不爽」的头号缺口）。规模 s = 半径 r（0.4–12 m）：
    ///   闪光球（主色放大淡出 + 亮黄核心）+ 白色闪光、火团（亮黄 ↔ 主色）、火花（大多朝上）、余烬、烟（深灰掺主色）、碎石；
    ///   中心离地 &lt; 0.9r 时贴地冲击环（1.5r）；闪光灯（强度 / 范围随 r）；按距离震屏（平方衰减：贴脸有力、远处只轻颤）。
    /// 焦痕贴花留给 FX1。
    /// </summary>
    [Defs]
    public sealed class ExplosionPreset : FxPreset
    {
        public override string Id => "Explosion";

        public ExplosionPreset()
        {
            var hotYellow = Hex.Rgb(0xffe38a);
            DefaultColor = Fx.ExplosionColor;
            ScaleMin = 0.4f;
            ScaleMax = 12f;
            Layers = new[]
            {
                // 闪光球：主色从 0.25r 放大到约 0.9r（半径），亮黄核心 0.15r → 0.5r；再一颗白色大闪光
                new FxLayer
                {
                    style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.3f, 0.3f),
                },
                new FxLayer
                {
                    style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.3f, 0.3f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.15f, 0.15f), color = FxColor.Fixed, fixedColor = hotYellow, mix = 0,
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.8f, 1.8f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.1f, 0.1f), color = FxColor.White,
                },
                // 火团
                new FxLayer
                {
                    style = "Fireball", count = FxScale.Lin(12, 6, 60), maxCount = 60, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(1.2f, 3.2f), speedScale = FxScale.Lin(0, 1), up = 1.2f,
                    size = new Vector2(0.35f, 0.65f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.3f, 0.6f), color = FxColor.RandomMix, fixedColor = hotYellow,
                },
                // 火花（大多朝上）
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(22, 8, 90), maxCount = 90, shape = FxShape.MostlyUp,
                    speed = new Vector2(8, 22), speedScale = new FxScale(0.7f, 0.12f, 1, 0, 1.9f), up = 2,
                    size = new Vector2(0.05f, 0.05f), life = new Vector2(0.3f, 0.9f), color = FxColor.Alternate, every = 3, mix = 0.6f,
                },
                // 余烬
                new FxLayer
                {
                    style = "Ember", count = FxScale.Lin(8, 3, 30), maxCount = 30, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), spreadY = 0.75f,
                    speed = new Vector2(2, 6), up = 1, size = new Vector2(0.06f, 0.12f), life = new Vector2(0.9f, 1.7f),
                },
                // 烟
                new FxLayer
                {
                    style = "Smoke", count = FxScale.Lin(7, 2.5f, 26), maxCount = 26, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.35f),
                    speed = new Vector2(0.4f, 1.1f), speedScale = FxScale.Lin(0, 1), up = 0.8f,
                    size = new Vector2(0.4f, 0.7f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(1.1f, 2.1f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0x2b2623), mix = 0.18f, shade = new Vector2(0.7f, 1.25f),
                },
                // 碎石
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(5, 1.5f, 22), maxCount = 22, shape = FxShape.UpperSphere,
                    speed = new Vector2(5, 13), up = 3, size = new Vector2(0.07f, 0.17f), life = new Vector2(0.8f, 1.4f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0x3b322b), mix = 0,
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1.5f), duration = 0.42f, heightFactor = 0.9f, band = false };
            Light = new FxLightSpec
            {
                intensity = FxScale.Lin(3, 1.5f, 16), range = FxScale.Lin(4, 5, 40), life = 0.38f, color = FxColor.Hot, mix = 0.25f, lift = 0.4f,
            };
            Shake = new FxShakeSpec
            {
                strength = new FxScale(0.15f, 0.1f, 1, 0, 0.85f), range = FxScale.Lin(10, 4), duration = new FxScale(0.22f, 0.03f, 1, 0, 0.37f), durationPerK = 0.2f,
            };
        }
    }
}
