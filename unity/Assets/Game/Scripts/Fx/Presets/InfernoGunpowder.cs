using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火药爆（FX4；Three.js InfernoBlastFx.gunpowderBlast：明代火器——炮仗傀儡的一窝蜂火箭、地老鼠、神火飞鸦）：
    ///   和普通爆炸拉开：火团更橙更「脏」、一大蓬金色火星往上喷、红纸屑漫天飘落、浓黑的火药烟；贴地金环、焦痕、闪光灯、震屏。
    ///   离地近时 <see cref="Fx.Gunpowder"/> 再加一圈火舌火柱（FlameTongues.Pillar）。规模 s = 半径（0.6–6 m）；颜色 = 火光色。
    /// </summary>
    [Defs]
    public sealed class InfernoGunpowderPreset : FxPreset
    {
        public override string Id => "InfernoGunpowder";

        public InfernoGunpowderPreset()
        {
            DefaultColor = InfernoPalette.Fire;
            ScaleMin = 0.6f;
            ScaleMax = 6f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.28f, 0.28f),
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.2f, 1.2f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.08f, 0.08f), color = FxColor.Fixed, fixedColor = InfernoPalette.White, mix = 0,
                },
                // 橙色火团（实心）+ 加法火团
                new FxLayer
                {
                    style = "Blaze", count = FxScale.Lin(6, 2.5f, 20), maxCount = 20, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.25f),
                    speed = new Vector2(1f, 2.8f), speedScale = FxScale.Lin(0, 1), up = 1.2f,
                    size = new Vector2(0.4f, 0.7f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.3f, 0.5f), color = FxColor.RandomMix, fixedColor = Hex.Rgb(0xff6a1a),
                },
                new FxLayer
                {
                    style = "Fireball", count = FxScale.Lin(10, 5, 48), maxCount = 48, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(1.2f, 3.2f), speedScale = FxScale.Lin(0, 1), up = 1.4f,
                    size = new Vector2(0.3f, 0.6f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.28f, 0.55f), color = FxColor.RandomMix, fixedColor = InfernoPalette.Hot,
                    alpha = 0.6f,
                },
                // 金色火星：一大蓬往上喷（火药的「噼啪」）
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(26, 10, 110), maxCount = 110, shape = FxShape.MostlyUp,
                    speed = new Vector2(7, 20), speedScale = new FxScale(0.7f, 0.12f, 1, 0, 1.8f), up = 3,
                    size = new Vector2(0.045f, 0.045f), life = new Vector2(0.35f, 1.0f), color = FxColor.Fixed, fixedColor = InfernoPalette.Gold, mix = 0.15f,
                },
                new FxLayer
                {
                    style = "Ember", count = FxScale.Lin(10, 4, 36), maxCount = 36, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), spreadY = 0.75f,
                    speed = new Vector2(2, 6), up = 1.5f, size = new Vector2(0.06f, 0.12f), life = new Vector2(0.9f, 1.8f), color = FxColor.Fixed, fixedColor = InfernoPalette.Gold, mix = 0.3f,
                },
                // 红纸屑：抛上去、飘飘悠悠落下
                new FxLayer
                {
                    style = "Paper", count = FxScale.Lin(14, 6, 60), maxCount = 60, shape = FxShape.MostlyUp,
                    speed = new Vector2(3, 7.5f), speedScale = FxScale.Pow(0.5f), up = 3.5f,
                    size = new Vector2(0.08f, 0.15f), sizeScale = FxScale.Pow(0.3f), life = new Vector2(1.2f, 2.2f),
                    color = FxColor.Fixed, fixedColor = InfernoPalette.Paper, mix = 0, shade = new Vector2(0.75f, 1.15f),
                },
                // 浓黑火药烟
                new FxLayer
                {
                    style = "Soot", count = FxScale.Lin(5, 2, 18), maxCount = 18, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.35f),
                    speed = new Vector2(0.4f, 1.2f), speedScale = FxScale.Lin(0, 1), up = 1f,
                    size = new Vector2(0.45f, 0.75f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(1.2f, 2.2f),
                    color = FxColor.Fixed, fixedColor = InfernoPalette.Soot, mix = 0.1f, shade = new Vector2(0.8f, 1.3f), delay = 0.04f,
                },
                new FxLayer
                {
                    style = "Cinder", count = FxScale.Lin(4, 1.5f, 14), maxCount = 14, shape = FxShape.UpperSphere,
                    speed = new Vector2(4, 9), up = 2.5f, size = new Vector2(0.06f, 0.12f), life = new Vector2(0.7f, 1.2f),
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1.1f), duration = 0.35f, heightFactor = 1.2f, band = false };
            Decal = new FxDecalSpec { kind = FxDecalKind.Scorch, size = FxScale.Lin(0, 1.6f), heightFactor = 1.2f, heat = 1f, life = 8f };
            Light = new FxLightSpec
            {
                intensity = FxScale.Lin(3, 1.4f, 14), range = FxScale.Lin(4, 4.5f, 32), life = 0.34f, color = FxColor.Hot, mix = 0.2f, lift = 0.4f,
            };
            Shake = new FxShakeSpec
            {
                strength = new FxScale(0.15f, 0.1f, 1, 0, 0.8f), range = FxScale.Lin(10, 4), duration = new FxScale(0.2f, 0.03f, 1, 0, 0.35f), durationPerK = 0.2f,
            };
        }
    }
}
