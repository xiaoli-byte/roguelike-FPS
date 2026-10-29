using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰爆（FX3：冰河豚鼓气自爆、鲲 → 鹏化形、鲲 · 吐冰的冰块落地、MatriarchNova 这类「冷的爆炸」）。
    /// 收尾一轮按 docs/art/fx-style.md 重做（原来是一团柔边白粉雾 + 白冷环 + 白光墙，亮沙上一大片白，读不出冰晶）：
    ///   主形是 <see cref="FrostBurst"/> 的低多边形冰晶（亮面白 / 冰蓝 / 蓝灰三阶，从爆心长出来再崩开）——这里只是陪衬的粒子：
    ///   亮芯：一记硬边的冰晶星芒（第一帧峰值、0.1 s）；
    ///   冲击：卡通粗环（冰蓝，不发白）+ 底下垫一圈实心的冰蓝团块（ToonDust：亮地面上也托得住环）；
    ///   余韵：两三团实心的冷白雾团（ToonSmoke，暗面蓝灰，不是柔边粉雾）+ 几片中尺度的冰碴，0.6 s 内退场。
    /// 冷色闪光灯收一档（不把亮沙 / 雪照成一片白），按距离震屏。不再有白粉雾、贴地冷雾、白拉丝、雪花闪粒、竖直光墙。
    /// 规模 s = 半径（0.6–8 m）；颜色固定是冰的色阶（元素色全局固定，调用方传的冰色只用来调闪光灯）。入口：<see cref="Fx.FrostNova"/>。
    /// </summary>
    [Defs]
    public sealed class FrostNovaPreset : FxPreset
    {
        public override string Id => "FrostNova";

        /// <summary>冰爆的三阶：环 / 底 / 雾（亮芯是星芒的冰白）</summary>
        public static readonly Color RingIce = new(0.5f, 0.8f, 1f), BaseIce = new(0.4f, 0.62f, 0.88f), MistIce = new(0.74f, 0.86f, 0.96f), ChipIce = new(0.66f, 0.86f, 1f);

        public FrostNovaPreset()
        {
            DefaultColor = FrostPalette.Ice;
            ScaleMin = 0.6f;
            ScaleMax = 8f;
            Layers = new[]
            {
                // 亮芯：硬边冰晶星芒（小、硬、一眨眼）
                new FxLayer
                {
                    style = "IceStar", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.95f, 0.95f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.1f, 0.1f), color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0,
                },
                // 冲击：冰蓝卡通粗环 + 冰蓝实心底
                new FxLayer
                {
                    style = "ToonRing", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.1f,
                    size = new Vector2(1.05f, 1.05f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.3f, 0.3f), color = FxColor.Fixed, fixedColor = RingIce, mix = 0,
                },
                new FxLayer
                {
                    style = "ToonDust", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.05f, delay = 0.02f,
                    size = new Vector2(0.95f, 0.95f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.48f, 0.48f), color = FxColor.Fixed, fixedColor = BaseIce, mix = 0,
                },
                // 余韵：两三团实心冷白雾团（暗面蓝灰）
                new FxLayer
                {
                    style = "ToonSmoke", count = FxScale.Lin(1.5f, 0.35f, 4), maxCount = 4, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.35f), delay = 0.12f,
                    speed = new Vector2(0.4f, 1f), speedScale = FxScale.Pow(0.5f), up = 0.8f, size = new Vector2(0.38f, 0.52f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.36f, 0.48f), color = FxColor.Fixed, fixedColor = MistIce, mix = 0, shade = new Vector2(0.94f, 1.04f),
                },
                // 几片中尺度的冰碴（不发光，普通混合）
                new FxLayer
                {
                    style = "ShardIce", count = FxScale.Lin(4, 1.2f, 12), maxCount = 12, shape = FxShape.MostlyUp, delay = 0.08f,
                    speed = new Vector2(5, 10), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.09f, 0.16f), sizeScale = FxScale.Pow(0.4f),
                    life = new Vector2(0.4f, 0.55f), color = FxColor.Fixed, fixedColor = ChipIce, mix = 0, shade = new Vector2(0.8f, 1.05f),
                },
            };
            Light = new FxLightSpec
            {
                intensity = FxScale.Lin(1.2f, 0.5f, 5), range = FxScale.Lin(4, 3f, 22), life = 0.22f, color = FxColor.Fixed, fixedColor = FrostPalette.IceHot, mix = 0.25f, lift = 0.4f,
            };
            Shake = new FxShakeSpec
            {
                strength = new FxScale(0.12f, 0.08f, 1, 0, 0.6f), range = FxScale.Lin(10, 4), duration = new FxScale(0.2f, 0.03f, 1, 0, 0.32f), durationPerK = 0.15f,
            };
        }
    }
}
