using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 爆炸三档（特效打磨 B 路：原来是一团单帧火团 + 粒子，改成卡通序列帧）。<see cref="Fx.Explosion(Vector3, float, Color)"/> 按半径选档
    /// （<see cref="Fx.ExplosionId"/>）：小 &lt; 1.6 m（弹丸）、中 1.6–4 m（榴弹 / 火药 / 反应）、大 ≥ 4 m（首领技能、精英自爆）。规模 s = 半径。
    /// 每档都是同一套「卡通爆炸」语言，按档加量：
    ///   一瞬：白色闪光 + 漫画爆闪星（ToonBurst）；
    ///   火团：一颗大的主火团 + 一圈向外滚的小火团（ToonFire 序列帧：团块翻滚、热度从白热冷却成暗红再变成烟，从边缘硬边啃掉）；中 / 大档再有往上窜的二段火团（ToonFireRise）；
    ///   烟柱：火团之后升起的实心卡通烟团（ToonSmoke，色块分明，不是灰雾）；
    ///   冲击：贴地外扩的卡通冲击环（ToonRing）+ 原有的贴地环；大档再加一道慢的宽环、一圈贴地尘团（ToonDust）；
    ///   碎屑：拉丝火花、碎石、余烬（大档加炭火渣）。
    /// 焦痕贴花（余热归 A 路）、闪光灯、按距离震屏保持原来的规格。
    /// </summary>
    static class ExplosionKit
    {
        public static readonly Color HotYellow = Hex.Rgb(0xffe38a);
        /// <summary>烟 / 碎石 / 尘圈写沙寺的颜色（暖沙、赭褐，不用灰），按章节换调子走 <see cref="FxColor.Ground"/>（<see cref="FxTone"/>）</summary>
        public static readonly Color SmokeBase = Hex.Rgb(0xc4a27a);
        public static readonly Color Rock = Hex.Rgb(0x6e4c34);
        public static readonly Color Dust = Hex.Rgb(0xcfae82);

        public static FxLayer Flash(float size, float life) => new()
        {
            style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
            size = new Vector2(size, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life, life), color = FxColor.Hot, mix = 0.45f,
        };

        public static FxLayer Burst(float size, float life) => new()
        {
            style = "ToonBurst", count = FxScale.Const(1), density = false, shape = FxShape.Point,
            size = new Vector2(size, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life, life), color = FxColor.Fixed, fixedColor = HotYellow, mix = 0.35f,
        };

        /// <summary>主火团：抬高到 0.3 个尺寸（不埋进地里，贴地爆炸也是一整团）</summary>
        public static FxLayer Core(int count, float size, float life, float up) => new()
        {
            style = "ToonFire", count = FxScale.Const(count), density = false, shape = FxShape.Cone, coneAngle = 30,
            spread = FxScale.Lin(0, size * 0.28f), spreadMin = 0.8f,
            speed = new Vector2(0, 0.4f), up = up, size = new Vector2(size * 0.92f, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life * 0.9f, life),
            color = FxColor.RandomMix, fixedColor = HotYellow, mix = 0,
        };

        public static FxLayer Ring(float size, float life, float delay = 0) => new()
        {
            style = "ToonRing", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.1f,
            size = new Vector2(size, size), sizeScale = FxScale.Lin(0, 1), life = new Vector2(life, life), color = FxColor.Hot, mix = 0.25f, delay = delay,
        };

        public static FxLightSpec Light(float c, float k, float max, float life) => new()
        {
            // 克制的光：闪光灯只交代「这里炸了」，不把亮沙地照成一片白（风格审查：强度 × 0.65）
            intensity = FxScale.Lin(c * 0.65f, k * 0.65f, max * 0.65f), range = FxScale.Lin(4, 5, 40), life = life, color = FxColor.Hot, mix = 0.25f, lift = 0.4f,
        };

        public static FxShakeSpec Shake() => new()
        {
            strength = new FxScale(0.15f, 0.1f, 1, 0, 0.85f), range = FxScale.Lin(10, 4), duration = new FxScale(0.22f, 0.03f, 1, 0, 0.37f), durationPerK = 0.2f,
        };

        public static FxDecalSpec Scorch() => new() { kind = FxDecalKind.Scorch, size = FxScale.Lin(0, 2.6f), heightFactor = 0.9f, heat = 1f, life = FxDecals.ScorchLife };
    }

    /// <summary>小档（&lt; 1.6 m：弹丸、小炮弹）：一颗主火团 + 三颗小团、一圈快环、两团小烟、少量火花碎石</summary>
    [Defs]
    public sealed class ExplosionSmallPreset : FxPreset
    {
        public override string Id => "ExplosionSmall";

        public ExplosionSmallPreset()
        {
            DefaultColor = Fx.ExplosionColor;
            ScaleMin = 0.3f;
            ScaleMax = 12f;
            Layers = new[]
            {
                ExplosionKit.Flash(0.9f, 0.07f),
                ExplosionKit.Burst(2.8f, 0.1f),
                ExplosionKit.Core(1, 2.2f, 0.45f, 0.5f),
                new FxLayer
                {
                    style = "ToonFire", count = FxScale.Const(3), shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(1.2f, 2.4f), speedScale = FxScale.Pow(0.5f), up = 0.6f, size = new Vector2(0.9f, 1.2f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.3f, 0.42f), color = FxColor.RandomMix, fixedColor = ExplosionKit.HotYellow,
                },
                ExplosionKit.Ring(1.4f, 0.22f),
                new FxLayer
                {
                    style = "ToonSmoke", count = FxScale.Const(2), shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.25f), delay = 0.12f,
                    speed = new Vector2(0.3f, 0.8f), speedScale = FxScale.Pow(0.5f), up = 0.6f, size = new Vector2(1f, 1.3f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.6f, 0.85f), color = FxColor.Ground, fixedColor = ExplosionKit.SmokeBase, mix = 0.1f, shade = new Vector2(0.9f, 1.1f),
                },
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(8, 4, 20), maxCount = 20, shape = FxShape.MostlyUp,
                    speed = new Vector2(7, 16), speedScale = new FxScale(0.7f, 0.12f, 1, 0, 1.6f), up = 2,
                    size = new Vector2(0.045f, 0.045f), life = new Vector2(0.25f, 0.6f), color = FxColor.Alternate, every = 3, mix = 0.6f,
                },
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(3, 1.5f, 8), maxCount = 8, shape = FxShape.UpperSphere,
                    speed = new Vector2(4, 9), up = 2.5f, size = new Vector2(0.06f, 0.13f), life = new Vector2(0.6f, 1f), color = FxColor.Ground, fixedColor = ExplosionKit.Rock, mix = 0,
                },
                new FxLayer
                {
                    style = "Ember", count = FxScale.Lin(3, 2, 10), maxCount = 10, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f),
                    speed = new Vector2(1.5f, 4.5f), up = 1, size = new Vector2(0.05f, 0.1f), life = new Vector2(0.6f, 1.2f),
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1.4f), duration = 0.32f, heightFactor = 0.9f, band = false };
            Decal = ExplosionKit.Scorch();
            Light = ExplosionKit.Light(2.5f, 1.5f, 8, 0.3f);
            Shake = ExplosionKit.Shake();
        }
    }

    /// <summary>中档（1.6–4 m：榴弹、火药、焚雷）：主火团 + 一圈外滚火团 + 往上窜的二段、烟柱、冲击环、火花碎石余烬。预设 id 沿用「Explosion」</summary>
    [Defs]
    public sealed class ExplosionPreset : FxPreset
    {
        public override string Id => "Explosion";

        public ExplosionPreset()
        {
            DefaultColor = Fx.ExplosionColor;
            ScaleMin = 0.4f;
            ScaleMax = 12f;
            Layers = new[]
            {
                ExplosionKit.Flash(0.75f, 0.08f),
                ExplosionKit.Burst(2.2f, 0.13f),
                ExplosionKit.Core(1, 1.8f, 0.62f, 0.7f),
                new FxLayer
                {
                    style = "ToonFire", count = FxScale.Lin(3, 0.6f, 6), maxCount = 6, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.32f), spreadY = 1.3f,
                    speed = new Vector2(1.4f, 3.2f), speedScale = FxScale.Pow(0.5f), up = 0.9f, size = new Vector2(0.85f, 1.15f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.42f, 0.66f), color = FxColor.RandomMix, fixedColor = ExplosionKit.HotYellow,
                },
                // 二段：往上窜的火团（蘑菇柱的「杆」）
                new FxLayer
                {
                    style = "ToonFireRise", count = FxScale.Lin(1.5f, 0.4f, 4), maxCount = 4, shape = FxShape.Cone, coneAngle = 25, spread = FxScale.Lin(0, 0.15f), delay = 0.07f,
                    speed = new Vector2(1.5f, 2.8f), speedScale = FxScale.Pow(0.5f), up = 1.2f, size = new Vector2(0.6f, 0.8f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.5f, 0.7f), color = FxColor.RandomMix, fixedColor = ExplosionKit.HotYellow,
                },
                ExplosionKit.Ring(1.1f, 0.32f),
                new FxLayer
                {
                    // 烟：少几团、每团大一点（几团叠在一起时描边不会读成一片鹅卵石）
                    style = "ToonSmoke", count = FxScale.Lin(1.5f, 0.5f, 4), maxCount = 4, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.38f), delay = 0.18f,
                    speed = new Vector2(0.5f, 1.3f), speedScale = FxScale.Pow(0.5f), up = 1.4f, size = new Vector2(0.78f, 1f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.75f, 1.05f), color = FxColor.Ground, fixedColor = ExplosionKit.SmokeBase, mix = 0.1f, shade = new Vector2(0.85f, 1.12f),
                },
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(18, 6, 60), maxCount = 60, shape = FxShape.MostlyUp,
                    speed = new Vector2(8, 22), speedScale = new FxScale(0.7f, 0.12f, 1, 0, 1.9f), up = 2,
                    size = new Vector2(0.05f, 0.05f), life = new Vector2(0.3f, 0.85f), color = FxColor.Alternate, every = 3, mix = 0.6f,
                },
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(5, 1.5f, 16), maxCount = 16, shape = FxShape.UpperSphere,
                    speed = new Vector2(5, 13), up = 3, size = new Vector2(0.08f, 0.18f), life = new Vector2(0.8f, 1.4f), color = FxColor.Ground, fixedColor = ExplosionKit.Rock, mix = 0,
                },
                new FxLayer
                {
                    style = "Ember", count = FxScale.Lin(6, 2.5f, 24), maxCount = 24, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), spreadY = 0.75f,
                    speed = new Vector2(2, 6), up = 1, size = new Vector2(0.06f, 0.12f), life = new Vector2(0.9f, 1.6f),
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1.5f), duration = 0.42f, heightFactor = 0.9f, band = false };
            Decal = ExplosionKit.Scorch();
            Light = ExplosionKit.Light(3, 1.5f, 16, 0.38f);
            Shake = ExplosionKit.Shake();
        }
    }

    /// <summary>大档（≥ 4 m：首领技能、精英自爆）：双主火团 + 大圈外滚火团 + 更高的二段火柱、粗烟柱、快慢两道冲击环 + 贴地尘圈、大量碎屑炭渣</summary>
    [Defs]
    public sealed class ExplosionLargePreset : FxPreset
    {
        public override string Id => "ExplosionLarge";

        public ExplosionLargePreset()
        {
            DefaultColor = Fx.ExplosionColor;
            ScaleMin = 1f;
            ScaleMax = 14f;
            Layers = new[]
            {
                ExplosionKit.Flash(0.7f, 0.1f),
                ExplosionKit.Burst(1.7f, 0.16f),
                ExplosionKit.Core(2, 1.6f, 0.78f, 2f),
                new FxLayer
                {
                    style = "ToonFire", count = FxScale.Lin(4, 0.5f, 8), maxCount = 8, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), spreadY = 1.4f,
                    speed = new Vector2(1.6f, 3.4f), speedScale = FxScale.Pow(0.5f), up = 1.2f, size = new Vector2(0.65f, 0.9f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.55f, 0.85f), color = FxColor.RandomMix, fixedColor = ExplosionKit.HotYellow,
                },
                // 外圈一圈贴地滚出去的火团（大爆炸的「裙边」）
                new FxLayer
                {
                    style = "ToonFire", count = FxScale.Const(6), shape = FxShape.Disc, spread = FxScale.Lin(0, 0.25f), delay = 0.04f,
                    speed = new Vector2(2.2f, 3.4f), speedScale = FxScale.Pow(0.5f), up = 0.4f, size = new Vector2(0.45f, 0.6f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.45f, 0.65f), color = FxColor.RandomMix, fixedColor = ExplosionKit.HotYellow,
                },
                new FxLayer
                {
                    style = "ToonFireRise", count = FxScale.Lin(2, 0.3f, 5), maxCount = 5, shape = FxShape.Cone, coneAngle = 22, spread = FxScale.Lin(0, 0.15f), delay = 0.09f,
                    speed = new Vector2(1.8f, 3.4f), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.48f, 0.65f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.6f, 0.9f), color = FxColor.RandomMix, fixedColor = ExplosionKit.HotYellow,
                },
                ExplosionKit.Ring(0.85f, 0.3f),
                ExplosionKit.Ring(1.25f, 0.55f, 0.06f),
                new FxLayer
                {
                    style = "ToonDust", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.05f, delay = 0.03f,
                    size = new Vector2(1.05f, 1.05f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.9f, 0.9f), color = FxColor.Ground, fixedColor = ExplosionKit.Dust, mix = 0.08f,
                },
                new FxLayer
                {
                    style = "ToonSmoke", count = FxScale.Lin(2, 0.35f, 5), maxCount = 5, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), delay = 0.22f,
                    speed = new Vector2(0.6f, 1.6f), speedScale = FxScale.Pow(0.5f), up = 2.4f, size = new Vector2(0.62f, 0.85f), sizeScale = FxScale.Lin(0, 1),
                    life = new Vector2(0.9f, 1.3f), color = FxColor.Ground, fixedColor = ExplosionKit.SmokeBase, mix = 0.1f, shade = new Vector2(0.85f, 1.12f),
                },
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(30, 4, 70), maxCount = 70, shape = FxShape.MostlyUp,
                    speed = new Vector2(10, 26), speedScale = new FxScale(0.7f, 0.12f, 1, 0, 1.9f), up = 3,
                    size = new Vector2(0.06f, 0.06f), life = new Vector2(0.35f, 1f), color = FxColor.Alternate, every = 3, mix = 0.6f,
                },
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(10, 1.2f, 22), maxCount = 22, shape = FxShape.UpperSphere,
                    speed = new Vector2(7, 16), up = 4, size = new Vector2(0.12f, 0.28f), life = new Vector2(1f, 1.6f), color = FxColor.Ground, fixedColor = ExplosionKit.Rock, mix = 0,
                },
                new FxLayer
                {
                    style = "Cinder", count = FxScale.Lin(6, 0.8f, 14), maxCount = 14, shape = FxShape.UpperSphere,
                    speed = new Vector2(5, 12), up = 4, size = new Vector2(0.12f, 0.22f), life = new Vector2(0.9f, 1.5f), color = FxColor.Hot, mix = 0.2f,
                },
                new FxLayer
                {
                    style = "Ember", count = FxScale.Lin(12, 2, 30), maxCount = 30, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), spreadY = 0.75f,
                    speed = new Vector2(2, 7), up = 1.5f, size = new Vector2(0.08f, 0.15f), life = new Vector2(1f, 1.9f),
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1.5f), duration = 0.5f, heightFactor = 0.9f, band = false };
            Decal = ExplosionKit.Scorch();
            Light = ExplosionKit.Light(4, 1.5f, 18, 0.45f);
            Shake = ExplosionKit.Shake();
        }
    }
}
