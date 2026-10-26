using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 归墟爆开（FX2，三相齐聚的终点反应；B 路打磨成最重的一下组合技）：收束时 <see cref="Fx.AbyssWindup"/> 把三色光点卷进中心，这里是炸开那一下——
    /// 紫色闪光球 + 白热核心 + 紫色爆闪星、火 / 雷 / 蚀三色光粒水平甩出一圈、紫色电火花、「啪」的卡通紫环（朝镜头）+ 外扩的卡通冲击环、
    /// 贴地冲击环带光墙、紫灯、震屏 0.3（同 Three.js）；余韵是慢慢升起的紫色光点和三色余烬。
    /// 三道天雷、余波伤害由 AbyssHandler 自己做。规模 s = 余波半径（≈ 3 m）。
    /// </summary>
    [Defs]
    public sealed class AbyssPreset : FxPreset
    {
        public override string Id => "Abyss";

        public AbyssPreset()
        {
            DefaultColor = Fx.AbyssColor;
            ScaleMin = 1f;
            ScaleMax = 8f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.45f, 0.45f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.32f, 0.32f),
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.7f, 0.7f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.1f, 0.1f), color = FxColor.White,
                },
                Tri(Element.Fire), Tri(Element.Shock), Tri(Element.Corrode),
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(10, 2, 24), shape = FxShape.Sphere,
                    speed = new Vector2(8, 14), size = new Vector2(0.045f, 0.045f), life = new Vector2(0.15f, 0.3f), color = FxColor.Hot, mix = 0.4f,
                },
                new FxLayer
                {
                    style = "ToonBurst", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.95f, 0.95f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.16f, 0.16f), color = FxColor.Tint,
                },
                new FxLayer
                {
                    style = "ToonPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.6f, 0.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.28f, 0.28f), color = FxColor.Hot, mix = 0.25f,
                },
                new FxLayer
                {
                    style = "ToonRing", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = -0.6f,
                    size = new Vector2(0.62f, 0.62f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.4f, 0.4f), color = FxColor.Hot, mix = 0.2f,
                },
                // 余韵：升起的紫色光点 + 三色余烬
                new FxLayer
                {
                    style = "Mote", count = FxScale.Const(12), shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f), delay = 0.15f,
                    speed = new Vector2(0.2f, 0.9f), up = 0.7f, size = new Vector2(0.12f, 0.2f), life = new Vector2(0.9f, 1.5f), color = FxColor.Hot, mix = 0.3f,
                },
                Ember(Element.Fire), Ember(Element.Shock), Ember(Element.Corrode),
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1), duration = 0.5f, heightFactor = 1.2f, band = true };
            Light = new FxLightSpec { intensity = FxScale.Const(8), range = FxScale.Lin(4, 2), life = 0.35f, color = FxColor.Hot, mix = 0.2f, lift = 0.4f };
            Shake = new FxShakeSpec { strength = FxScale.Const(0.3f), range = FxScale.Const(40), duration = FxScale.Const(0.25f), durationPerK = 0 };
        }

        static FxLayer Ember(Element e) => new()
        {
            style = "Ember", count = FxScale.Const(5), shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.25f), delay = 0.12f,
            speed = new Vector2(1, 3), up = 1, size = new Vector2(0.07f, 0.12f), life = new Vector2(0.8f, 1.4f), color = FxColor.Fixed, fixedColor = Fx.ElementColor(e), mix = 0,
        };

        /// <summary>一种元素色的光粒：水平甩出一圈（略带上下抖动）</summary>
        static FxLayer Tri(Element e) => new()
        {
            style = "Glow", count = FxScale.Const(9), shape = FxShape.Disc, speed = new Vector2(5, 9), upJitter = 2,
            size = new Vector2(0.14f, 0.22f), life = new Vector2(0.4f, 0.65f), color = FxColor.Fixed, fixedColor = Fx.ElementColor(e), mix = 0,
        };
    }
}
