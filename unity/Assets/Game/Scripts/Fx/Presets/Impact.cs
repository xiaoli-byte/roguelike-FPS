using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 弹着点（Three.js Fx.ts impact）：打在地形 / 建筑上。规模 s = size（0.2–4）：数量按 s、速度和火花粗细按 √s。
    ///   反射火花：法线一侧半球、朝法线偏 0.7，一半白热；命中闪光：白热大光斑 + 主色小光斑；尘土：沿法线扬起；小碎屑。
    /// 这是石面（默认）的弹着点；沙 / 冰 / 金属见 ImpactSand / ImpactIce / ImpactMetal，按碰撞体判材质走 <see cref="Fx.ImpactHit"/>，弹孔贴花在那里。
    /// </summary>
    [Defs]
    public sealed class ImpactPreset : FxPreset
    {
        public override string Id => "Impact";

        public ImpactPreset()
        {
            DefaultColor = Fx.ImpactColor;
            ScaleMin = 0.2f;
            ScaleMax = 4f;
            Layers = new[]
            {
                // 反射火花
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(5, 4), shape = FxShape.Hemisphere, normalBias = 0.7f, offset = 0.03f,
                    speed = new Vector2(4, 12), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.045f, 0.045f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.12f, 0.34f), color = FxColor.Alternate, every = 2, mix = 0.45f,
                },
                // 命中闪光：白热大光斑 + 主色小光斑（Unity 比 Three.js 大三成：第一人称镜头下读得清）
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.06f,
                    size = new Vector2(0.55f, 0.55f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.08f, 0.08f), color = FxColor.Hot, mix = 0.45f,
                },
                // Unity 追加（卡通、干脆）：一下四角星芒
                new FxLayer
                {
                    style = "Flare", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.08f,
                    size = new Vector2(0.5f, 0.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.06f, 0.06f), color = FxColor.Hot, mix = 0.6f,
                },
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.03f,
                    size = new Vector2(0.22f, 0.22f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.14f, 0.14f),
                },
                // 尘土（普通混合，不发光）
                new FxLayer
                {
                    style = "Dust", count = new FxScale(0, 2, 1, 0, 4), shape = FxShape.Cone, coneAngle = 45, offset = 0.03f,
                    speed = new Vector2(0.6f, 1.8f), up = 0.2f, size = new Vector2(0.18f, 0.3f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.45f, 0.8f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0x8c8274), mix = 0.1f,
                },
                // 小碎屑
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(0, 2), shape = FxShape.Hemisphere, normalBias = 1.2f, offset = 0.03f,
                    speed = new Vector2(2.5f, 6), up = 1, size = new Vector2(0.035f, 0.07f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.5f, 0.9f), color = FxColor.Fixed, fixedColor = Hex.Rgb(0x3b322b), mix = 0,
                },
            };
        }
    }
}
