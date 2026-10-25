using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃刀光（WC7，<see cref="BladeTrail"/> 按 id 取）：紫色带身 + 白热刃口 + 一道加色光边，寿命 0.16 s（同 Three.js SwingTrail）；挥得快就更亮。
    /// 规模 s：普通两段 1、第三段（伸刃）1.6、人刀合一再 ×1.25。
    /// 判定帧在刀尖的屏幕位置往前 1.6 m 处（贴脸淡出之外）顺着挥动方向甩出一小撮碎刃火星：拉丝光点 + 一颗白热闪光。
    /// </summary>
    [Defs]
    public sealed class BladeTrailPreset : FxTrailPreset
    {
        public const string PresetId = "BladeTrail";

        public override string Id => PresetId;

        public BladeTrailPreset()
        {
            DefaultColor = BladeMeshes.Purple;
            ScaleMin = 0.5f;
            ScaleMax = 3f;
            Trail = new FxTrailSpec
            {
                life = 0.16f, headTime = 0.04f, maxSamples = 64, fringe = 0.1f, bodyAlpha = 0.72f, hotMix = 0.3f, headHotMix = 0.45f,
                bodyIntensity = 1.25f, fringeIntensity = 2f, slowSpeed = 2.5f, fastSpeed = 18f, minBrightness = 0.25f,
            };
            Layers = new[]
            {
                // 碎刃火星：沿挥动方向的窄锥，轻重力
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(2, 3, 9), shape = FxShape.Cone, coneAngle = 28,
                    speed = new Vector2(3.5f, 7.5f), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.03f, 0.045f), life = new Vector2(0.08f, 0.18f),
                    color = FxColor.Alternate, every = 2, mix = 0.6f,
                },
                // 刃口闪光
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.22f, 0.22f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.06f, 0.08f), color = FxColor.Hot, mix = 0.5f,
                },
            };
        }
    }
}
