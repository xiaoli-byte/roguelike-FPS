using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 元素反应的「打出了组合技」瞬间（特效打磨 B 路）：每种反应都是 闪光 → 冲击波 → 余韵 三拍，颜色和形状各认得出：
    ///   熔金：橙白闪光 + 熔溅冠往上溅、熔滴四射 + 蚀绿泡、橙色冲击环，余韵是落地冒烟的熔滴和余烬；
    ///   焚雷：金白大闪 + 放射状的雷裂光 + 爆闪星、蓝白电火花与金色火星一起炸开、金环，余韵是飘着的金色火星；
    ///   封脉：青色闪光 + 两道收紧的刻符印（往里缩，读作「封住」）、电弧碎纹贴身噼啪、升起的符点、青环，余韵是慢慢升起的青色光点；
    ///   崩解：元素色的光点先往里一吸、再「啪」地炸开（爆闪星 + 朝镜头的冲击环 + 拉丝火花），白环收尾；
    ///   归墟：见 <see cref="AbyssPreset"/>（同一套语言，紫色、规模最大）。
    /// 规模 s：熔金 / 焚雷 / 封脉 = 1（中心敌人一个身位），崩解 = 1（身体大小由调用方乘）。入口 <see cref="Fx.Reaction"/>、<see cref="Fx.Collapse"/>。
    /// </summary>
    static class RxKit
    {
        public static FxLayer Flash(float size, float life, FxColor c = FxColor.White, float mix = 0, float delay = 0) => new()
        {
            style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
            size = new Vector2(size, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life, life), color = c, mix = mix, delay = delay,
        };

        public static FxLayer One(string style, float size, float life, float mix = 0.25f, float delay = 0, float offset = 0) => new()
        {
            style = style, count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = offset,
            size = new Vector2(size, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life, life), color = FxColor.Hot, mix = mix, delay = delay,
        };
    }

    [Defs]
    public sealed class RxMeltdownPreset : FxPreset
    {
        public override string Id => "RxMeltdown";

        public RxMeltdownPreset()
        {
            DefaultColor = CombatTuning.ReactionColors[(int)Reaction.Meltdown];
            ScaleMin = 0.4f;
            ScaleMax = 4f;
            var green = Fx.ElementColor(Element.Corrode);
            Layers = new[]
            {
                RxKit.Flash(2.4f, 0.09f),
                RxKit.Flash(1.4f, 0.22f, FxColor.Hot, 0.3f),
                RxKit.One("ToonBurst", 3.2f, 0.15f, 0.3f),
                // 熔团：一团橙色卡通火团（熔金的「肉」）
                new FxLayer
                {
                    style = "ToonFire", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.9f, 1.9f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.42f, 0.42f), color = FxColor.Tint,
                },
                // 熔溅冠：往上溅起的一圈熔滴（侧面剪影）
                new FxLayer
                {
                    style = "ToonCrown", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.3f,
                    size = new Vector2(3.4f, 3.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.5f, 0.5f), color = FxColor.Hot, mix = 0.15f,
                },
                new FxLayer
                {
                    style = "Molten", count = FxScale.Const(22), shape = FxShape.MostlyUp, spread = FxScale.Const(0.3f),
                    speed = new Vector2(3.5f, 8.5f), up = 3.5f, size = new Vector2(0.16f, 0.3f), life = new Vector2(0.6f, 1.1f), color = FxColor.Hot, mix = 0.25f,
                },
                new FxLayer
                {
                    style = "GlowRise", count = FxScale.Const(10), shape = FxShape.Sphere, spread = FxScale.Const(0.5f),
                    speed = new Vector2(0.4f, 1.4f), size = new Vector2(0.12f, 0.22f), life = new Vector2(0.5f, 0.9f), color = FxColor.Fixed, fixedColor = green, mix = 0,
                },
                RxKit.One("ToonRing", 1.6f, 0.36f, 0.2f, 0, -0.6f),
                RxKit.One("ToonPop", 1.5f, 0.22f, 0.3f),
                // 余韵
                new FxLayer
                {
                    style = "Ember", count = FxScale.Const(12), shape = FxShape.UpperSphere, spread = FxScale.Const(0.6f), delay = 0.12f,
                    speed = new Vector2(1, 3), up = 1, size = new Vector2(0.07f, 0.13f), life = new Vector2(0.9f, 1.6f), color = FxColor.Hot, mix = 0.3f,
                },
                new FxLayer
                {
                    style = "ToonSmoke", count = FxScale.Const(2), shape = FxShape.UpperSphere, spread = FxScale.Const(0.4f), delay = 0.25f,
                    speed = new Vector2(0.3f, 0.8f), up = 1f, size = new Vector2(0.9f, 1.2f), life = new Vector2(0.8f, 1.1f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0x7a6e5c), mix = 0.12f,
                },
            };
            Light = new FxLightSpec { intensity = FxScale.Const(9), range = FxScale.Const(9), life = 0.35f, color = FxColor.Hot, mix = 0.3f, lift = 0.4f };
            Shake = new FxShakeSpec { strength = FxScale.Const(0.22f), range = FxScale.Const(22), duration = FxScale.Const(0.2f), durationPerK = 0.1f };
        }
    }

    [Defs]
    public sealed class RxThunderfirePreset : FxPreset
    {
        public override string Id => "RxThunderfire";

        public RxThunderfirePreset()
        {
            DefaultColor = CombatTuning.ReactionColors[(int)Reaction.Thunderfire];
            ScaleMin = 0.4f;
            ScaleMax = 4f;
            var blue = Fx.ElementColor(Element.Shock);
            Layers = new[]
            {
                RxKit.Flash(3.2f, 0.1f),
                RxKit.One("ToonCrack", 3.6f, 0.2f, 0.45f),
                RxKit.One("ToonBurst", 2.8f, 0.15f, 0.4f),
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Const(22), shape = FxShape.Sphere, spread = FxScale.Const(0.3f),
                    speed = new Vector2(9, 18), size = new Vector2(0.05f, 0.05f), life = new Vector2(0.18f, 0.35f), color = FxColor.Fixed, fixedColor = blue, mix = 0.2f,
                },
                new FxLayer
                {
                    style = "Streak", count = FxScale.Const(18), shape = FxShape.MostlyUp, spread = FxScale.Const(0.3f),
                    speed = new Vector2(8, 16), up = 2, size = new Vector2(0.05f, 0.05f), life = new Vector2(0.3f, 0.7f), color = FxColor.Alternate, every = 2, mix = 0.6f,
                },
                RxKit.One("ToonRing", 2f, 0.34f, 0.25f, 0, -0.6f),
                RxKit.One("ToonPop", 1.8f, 0.24f, 0.4f, 0.04f),
                // 余韵：飘着的金色火星 + 零星电弧碎纹
                new FxLayer
                {
                    style = "Ember", count = FxScale.Const(14), shape = FxShape.UpperSphere, spread = FxScale.Const(0.8f), delay = 0.1f,
                    speed = new Vector2(1, 3.5f), up = 1.2f, size = new Vector2(0.07f, 0.13f), life = new Vector2(0.9f, 1.5f), color = FxColor.Hot, mix = 0.35f,
                },
                new FxLayer
                {
                    style = "Crackle", count = FxScale.Const(6), shape = FxShape.Sphere, spread = FxScale.Const(0.9f), spreadMin = 0.4f, delay = 0.14f,
                    speed = new Vector2(0, 0.3f), size = new Vector2(0.35f, 0.55f), life = new Vector2(0.1f, 0.18f), color = FxColor.Fixed, fixedColor = blue, mix = 0,
                },
            };
            Light = new FxLightSpec { intensity = FxScale.Const(11), range = FxScale.Const(11), life = 0.32f, color = FxColor.Hot, mix = 0.45f, lift = 0.4f };
            Shake = new FxShakeSpec { strength = FxScale.Const(0.26f), range = FxScale.Const(26), duration = FxScale.Const(0.22f), durationPerK = 0.1f };
        }
    }

    [Defs]
    public sealed class RxVeinsealPreset : FxPreset
    {
        public override string Id => "RxVeinseal";

        public RxVeinsealPreset()
        {
            DefaultColor = CombatTuning.ReactionColors[(int)Reaction.Veinseal];
            ScaleMin = 0.4f;
            ScaleMax = 4f;
            Layers = new[]
            {
                RxKit.Flash(2.2f, 0.09f),
                RxKit.Flash(1.3f, 0.24f, FxColor.Hot, 0.3f),
                // 两道收紧的刻符印：一道在脚下、一道在腰间，往里缩
                RxKit.One("ToonSeal", 5f, 0.5f, 0f, 0, -0.75f),
                RxKit.One("ToonSeal", 3.6f, 0.45f, 0.1f, 0.07f, 0.1f),
                RxKit.One("ToonPop", 1.4f, 0.22f, 0.35f),
                new FxLayer
                {
                    style = "Crackle", count = FxScale.Const(10), shape = FxShape.Sphere, spread = FxScale.Const(0.6f), spreadMin = 0.5f,
                    speed = new Vector2(0, 0.4f), size = new Vector2(0.4f, 0.65f), life = new Vector2(0.12f, 0.22f), color = FxColor.Hot, mix = 0.4f,
                },
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Const(14), shape = FxShape.Disc, spread = FxScale.Const(0.3f),
                    speed = new Vector2(6, 11), upJitter = 2, size = new Vector2(0.045f, 0.045f), life = new Vector2(0.15f, 0.3f), color = FxColor.Hot, mix = 0.3f,
                },
                // 余韵：升起的符点 + 青色光点
                new FxLayer
                {
                    style = "Glyph", count = FxScale.Const(6), shape = FxShape.UpperSphere, spread = FxScale.Const(0.7f), delay = 0.1f,
                    speed = new Vector2(0.2f, 0.6f), up = 1.1f, size = new Vector2(0.2f, 0.3f), life = new Vector2(0.7f, 1.1f), color = FxColor.Hot, mix = 0.25f,
                },
                new FxLayer
                {
                    style = "Mote", count = FxScale.Const(10), shape = FxShape.Sphere, spread = FxScale.Const(0.8f), delay = 0.15f,
                    speed = new Vector2(0.2f, 0.8f), up = 0.6f, size = new Vector2(0.1f, 0.18f), life = new Vector2(0.8f, 1.4f), color = FxColor.Hot, mix = 0.3f,
                },
            };
            Light = new FxLightSpec { intensity = FxScale.Const(8), range = FxScale.Const(8), life = 0.35f, color = FxColor.Hot, mix = 0.3f, lift = 0.3f };
            Shake = new FxShakeSpec { strength = FxScale.Const(0.18f), range = FxScale.Const(20), duration = FxScale.Const(0.18f), durationPerK = 0.08f };
        }
    }

    [Defs]
    public sealed class RxCollapsePreset : FxPreset
    {
        public override string Id => "RxCollapse";

        public RxCollapsePreset()
        {
            DefaultColor = Color.white;
            ScaleMin = 0.4f;
            ScaleMax = 4f;
            Layers = new[]
            {
                // 先往里一吸：光点从 1.6 m 外收向中心
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(16), shape = FxShape.Sphere, spread = FxScale.Lin(0, 1.6f), spreadMin = 0.85f,
                    speed = new Vector2(-9, -7), size = new Vector2(0.14f, 0.22f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.16f, 0.18f), color = FxColor.Hot, mix = 0.3f,
                },
                // 再「啪」地炸开
                RxKit.Flash(2.2f, 0.09f, FxColor.White, 0, 0.13f),
                RxKit.One("ToonBurst", 2.4f, 0.13f, 0.35f, 0.13f),
                RxKit.One("ToonPop", 1.4f, 0.22f, 0.35f, 0.13f),
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Const(18), shape = FxShape.Sphere, delay = 0.13f,
                    speed = new Vector2(8, 15), size = new Vector2(0.045f, 0.045f), life = new Vector2(0.15f, 0.3f), color = FxColor.Alternate, every = 2, mix = 0.5f,
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(10), shape = FxShape.Sphere, delay = 0.13f,
                    speed = new Vector2(3, 6), size = new Vector2(0.12f, 0.2f), life = new Vector2(0.3f, 0.5f), color = FxColor.Hot, mix = 0.2f,
                },
                new FxLayer
                {
                    style = "ToonRing", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = -0.5f, delay = 0.13f,
                    size = new Vector2(1.4f, 1.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.3f, 0.3f), color = FxColor.White,
                },
            };
            Light = new FxLightSpec { intensity = FxScale.Const(6), range = FxScale.Const(7), life = 0.3f, color = FxColor.Hot, mix = 0.3f, lift = 0.2f };
            Shake = new FxShakeSpec { strength = FxScale.Const(0.12f), range = FxScale.Const(16), duration = FxScale.Const(0.14f), durationPerK = 0.06f };
        }
    }
}
