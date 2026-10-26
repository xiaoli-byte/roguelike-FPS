using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 暴击星芒（特效打磨 A 路，<see cref="Fx.CritHit"/> 放在身体轮廓外侧播）：金色四角星芒 + 白热小芯 + 一圈小金环 + 两颗往外蹦的小金星。
    /// 规模 s 只缩尺寸（连续暴击时 1 → 0.78），数量不变。星芒 0.8 m 但放在轮廓外，闪光芯只有 0.26 m（旧版星芒 1 m、闪光 0.82 m 罩在命中点）：重音靠形状和金色，不靠一大片亮。
    /// </summary>
    [Defs]
    public sealed class CritFlarePreset : FxPreset
    {
        public override string Id => "CritFlare";

        public CritFlarePreset()
        {
            var gold = Hex.Rgb(0xffd24a);
            DefaultColor = gold;
            ScaleMin = 0.3f;
            ScaleMax = 3f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Flare", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.8f, 0.8f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.13f, 0.13f), color = FxColor.Fixed, fixedColor = gold, mix = 0,
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.26f, 0.26f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.06f, 0.06f), color = FxColor.White,
                },
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.2f, 0.2f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.13f, 0.13f), color = FxColor.Fixed, fixedColor = gold, mix = 0,
                },
                new FxLayer
                {
                    style = "Star", count = FxScale.Const(2), density = false, shape = FxShape.Sphere,
                    speed = new Vector2(1.8f, 2.8f), up = 1f, size = new Vector2(0.09f, 0.12f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.26f, 0.36f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0xffe27a), mix = 0,
                },
            };
        }
    }

    /// <summary>暴击星芒到上限之后的替身：一颗往外蹦的小金星（不再叠星芒，敌人轮廓不被罩住）</summary>
    [Defs]
    public sealed class CritPipPreset : FxPreset
    {
        public override string Id => "CritPip";

        public CritPipPreset()
        {
            DefaultColor = Hex.Rgb(0xffe27a);
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Star", count = FxScale.Const(1), density = false, shape = FxShape.Sphere,
                    speed = new Vector2(1.5f, 2.4f), up = 1.2f, size = new Vector2(0.08f, 0.1f), life = new Vector2(0.24f, 0.3f), color = FxColor.Fixed,
                    fixedColor = Hex.Rgb(0xffe27a), mix = 0,
                },
            };
        }
    }

    /// <summary>暴击重音的金环（一段连射里第一个暴击才有）：放大淡出，比星芒大一圈但只是细环，不遮身体</summary>
    [Defs]
    public sealed class CritRingPreset : FxPreset
    {
        public override string Id => "CritRing";

        public CritRingPreset()
        {
            DefaultColor = Hex.Rgb(0xffd24a);
            Layers = new[]
            {
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.38f, 0.38f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.2f, 0.2f), color = FxColor.Tint,
                },
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Const(6), density = false, shape = FxShape.Sphere,
                    speed = new Vector2(6, 9), size = new Vector2(0.035f, 0.035f), life = new Vector2(0.08f, 0.13f), color = FxColor.Hot, mix = 0.4f,
                },
            };
        }
    }

    /// <summary>
    /// 弱点命中的额外一响（叠在层火花上，法线 = 朝镜头）：一圈橙红的「叮」环、朝镜头迸出的白热拉丝、几颗橙色火花、一团小白芯。
    /// 颜色固定橙红系（和暴击的金分开：弱点 + 暴击两个都出，读得出是两件事）。
    /// </summary>
    [Defs]
    public sealed class EnemyHitWeakPreset : FxPreset
    {
        public override string Id => "EnemyHitWeak";

        public EnemyHitWeakPreset()
        {
            var ember = Hex.Rgb(0xff6a2a);
            DefaultColor = ember;
            ScaleMin = 0.3f;
            ScaleMax = 4f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "RingPop", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.12f,
                    size = new Vector2(0.24f, 0.24f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.14f, 0.14f), color = FxColor.Fixed, fixedColor = ember, mix = 0,
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.1f,
                    size = new Vector2(0.22f, 0.22f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.05f, 0.05f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xfff0d0), mix = 0,
                },
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(3, 3, 10), shape = FxShape.Cone, coneAngle = 60, offset = 0.05f,
                    speed = new Vector2(7, 13), size = new Vector2(0.035f, 0.035f), life = new Vector2(0.08f, 0.15f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0xffd9a0), mix = 0,
                },
                new FxLayer
                {
                    style = "Spark", count = FxScale.Lin(1, 2), shape = FxShape.Cone, coneAngle = 70, offset = 0.05f,
                    speed = new Vector2(2, 4.5f), up = 1, size = new Vector2(0.06f, 0.1f), life = new Vector2(0.2f, 0.32f), color = FxColor.Fixed, fixedColor = ember, mix = 0,
                },
            };
        }
    }
}
