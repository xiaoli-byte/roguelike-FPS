using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 卡通序列帧粒子风格（特效打磨 B 路，组文件）：贴图都是 T_Fx_Blast（<see cref="FxToon"/>），着色器 SF_FxToon 按粒子年龄硬边啃掉、按热度分色阶。
    ///   ToonFire / ToonFireRise：翻滚的火团（16 帧），后者往上窜得更猛（爆炸二段、蘑菇柱）；
    ///   ToonSmoke：实心卡通烟团（16 帧），往上翻；ToonFlame：一条火苗窜起、尖端断开（16 帧，竖直不转）；
    ///   ToonRing：贴地外扩的冲击环（水平）；ToonPop：朝镜头的冲击环（「啪」）；ToonBurst：漫画爆闪星；
    ///   ToonDust：贴地一圈尘团；ToonSeal：封脉的收紧刻符环（水平、缩小）；ToonCrack：焚雷裂光；ToonCrown：熔溅冠（竖直）。
    /// 数量上限都不高：每颗都很大，靠形状而不是数量。
    /// </summary>
    [Defs(-90)]
    public sealed class FxBlastStyles : IDefSource<FxPreset>
    {
        static FxLayer One(float size, float life) => new()
        {
            count = FxScale.Const(1), density = false, shape = FxShape.Point, size = new Vector2(size, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life, life),
        };

        public IEnumerable<FxPreset> Create()
        {
            yield return new FxStylePreset("ToonFire",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Fire, FxToon.FireFirst), gravity = -2.2f, drag = 3.4f, grow = 1.45f, fade = FxFade.Hold, maxParticles = 220, sortOrder = 2,
                },
                One(1f, 0.6f), Fx.ExplosionColor);
            yield return new FxStylePreset("ToonFireRise",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Fire, FxToon.FireFirst), gravity = -5.5f, drag = 2.2f, grow = 1.6f, fade = FxFade.Hold, maxParticles = 160, sortOrder = 2,
                },
                One(1f, 0.7f), Fx.ExplosionColor);
            yield return new FxStylePreset("ToonSmoke",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Smoke, FxToon.SmokeFirst), gravity = -2.4f, drag = 2.4f, grow = 1.9f, fade = FxFade.Hold, maxParticles = 220, sortOrder = 1,
                },
                One(1f, 1.3f), Hex.Rgb(0xb0906c));
            yield return new FxStylePreset("ToonFlame",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Flame, FxToon.FlameFirst), gravity = -1.2f, drag = 2.5f, grow = 1.1f, fade = FxFade.Hold, randomRotation = false,
                    maxParticles = 360, sortOrder = 2,
                },
                One(0.6f, 0.6f), Fx.ElementColor(Element.Fire));
            yield return new FxStylePreset("ToonRing",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Glow, FxToon.RingFrame, 1), render = FxRender.Horizontal, gravity = 0, drag = 0, grow = 3.4f, fade = FxFade.Hold,
                    maxParticles = 80, sortOrder = 3,
                },
                One(1f, 0.3f), Fx.ExplosionColor);
            yield return new FxStylePreset("ToonPop",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Glow, FxToon.RingFrame, 1), gravity = 0, drag = 0, grow = 2.8f, fade = FxFade.Hold, maxParticles = 80, sortOrder = 3,
                },
                One(1f, 0.25f), Color.white);
            yield return new FxStylePreset("ToonBurst",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Glow, FxToon.BurstFrame, 1), gravity = 0, drag = 0, grow = 1.5f, fade = FxFade.Hold, maxParticles = 80, sortOrder = 3,
                },
                One(1f, 0.12f), Color.white);
            yield return new FxStylePreset("ToonDust",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Smoke, FxToon.DustRingFrame, 1), render = FxRender.Horizontal, gravity = 0, drag = 0, grow = 2.3f, fade = FxFade.Hold,
                    maxParticles = 40, sortOrder = 1,
                },
                One(1f, 0.8f), Hex.Rgb(0xcfae82));
            yield return new FxStylePreset("ToonSeal",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Glow, FxToon.SealFrame, 1), render = FxRender.Horizontal, gravity = 0, drag = 0, grow = 0.45f, fade = FxFade.Hold,
                    maxParticles = 40, sortOrder = 3,
                },
                One(1f, 0.45f), CombatTuning.ReactionColors[(int)Reaction.Veinseal]);
            yield return new FxStylePreset("ToonCrack",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Glow, FxToon.CracksFrame, 1), gravity = 0, drag = 0, grow = 1.35f, fade = FxFade.Hold, maxParticles = 40, sortOrder = 3,
                },
                One(1f, 0.2f), CombatTuning.ReactionColors[(int)Reaction.Thunderfire]);
            yield return new FxStylePreset("ToonCrown",
                new FxParticle
                {
                    flipbook = FxToon.Seq(FxToon.Flame, FxToon.CrownFrame, 1), gravity = 0, drag = 0, grow = 1.5f, fade = FxFade.Hold, randomRotation = false,
                    maxParticles = 40, sortOrder = 2,
                },
                One(1f, 0.45f), CombatTuning.ReactionColors[(int)Reaction.Meltdown]);
        }
    }
}
