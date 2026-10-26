using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 死亡迸散（FX2，Three.js Fx.ts deathEffect 移植）：白热闪光 + 主色闪光球、敌人色碎块（深浅不一，带重力翻滚）、发光碎屑、火花、
    /// 一小团烟、几颗慢慢升起的魂火、贴地小环；Unity 追加一圈放大淡出的主色环。尸体之后由 <see cref="DeathDissolve"/> 溶解消失。
    /// 规模 s = 身体直径（0.5–6），颜色 = 敌人定义色。烟比 Three.js 少一半（不糊屏）。B 路：「啪」的环换成卡通环 + 一下小爆闪星；
    /// 元素击杀再叠一层元素色迸散（<see cref="DeathElementPreset"/>：火 / 雷 / 蚀各一种，DeathDissolve 按击杀那一下的元素播）。
    /// </summary>
    [Defs]
    public sealed class DeathPreset : FxPreset
    {
        public override string Id => "Death";

        public DeathPreset()
        {
            DefaultColor = Fx.EnemyColor;
            ScaleMin = 0.5f;
            ScaleMax = 6f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Glow", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.5f, 1.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.14f, 0.14f), color = FxColor.Hot, mix = 0.5f,
                },
                new FxLayer
                {
                    style = "Flash", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.4f, 0.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.2f, 0.2f),
                },
                // 碎块
                new FxLayer
                {
                    style = "Chunk", count = FxScale.Lin(9, 6, 50), maxCount = 50, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.25f),
                    speed = new Vector2(2.5f, 7.5f), speedScale = new FxScale(0.8f, 0.15f), up = 3.5f, upJitter = 1.5f,
                    size = new Vector2(0.07f, 0.17f), sizeScale = FxScale.Pow(0.6f), life = new Vector2(0.9f, 1.6f), shade = new Vector2(0.45f, 1f),
                },
                // 发光碎屑
                new FxLayer
                {
                    style = "GlowFall", count = FxScale.Lin(12, 6, 50), maxCount = 50, shape = FxShape.Sphere,
                    speed = new Vector2(1.5f, 5.5f), up = 1.5f, size = new Vector2(0.07f, 0.14f), life = new Vector2(0.35f, 0.8f),
                    color = FxColor.Alternate, every = 2, mix = 0.5f,
                },
                // 火花
                new FxLayer
                {
                    style = "Streak", count = FxScale.Lin(8, 4, 40), maxCount = 40, shape = FxShape.Sphere,
                    speed = new Vector2(6, 13), up = 2, size = new Vector2(0.03f, 0.03f), life = new Vector2(0.2f, 0.5f),
                },
                // 一小团烟（深灰掺 30% 主色）
                new FxLayer
                {
                    style = "Smoke", count = FxScale.Lin(2, 1, 8), maxCount = 8, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.3f), spreadY = 0.67f,
                    speed = new Vector2(0.5f, 1.6f), up = 0.6f, size = new Vector2(0.5f, 0.85f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.9f, 1.5f),
                    color = FxColor.Fixed, fixedColor = Hex.Rgb(0x2b2623), mix = 0.3f,
                },
                // 魂火：几颗慢慢升起的光点
                new FxLayer
                {
                    style = "Mote", count = new FxScale(1.4f, 0.6f, 1, 2, 4), density = false, shape = FxShape.Point, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(0, 0.4f), up = 0.95f, upJitter = 0.45f, size = new Vector2(0.12f, 0.2f), life = new Vector2(0.9f, 1.4f),
                    color = FxColor.Hot, mix = 0.5f,
                },
                new FxLayer
                {
                    style = "ToonPop", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(0.75f, 0.75f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.24f, 0.24f), color = FxColor.Hot, mix = 0.3f,
                },
                new FxLayer
                {
                    style = "ToonBurst", count = FxScale.Const(1), density = false, shape = FxShape.Point,
                    size = new Vector2(1.1f, 1.1f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.1f, 0.1f), color = FxColor.Hot, mix = 0.45f,
                },
            };
            Ring = new FxRingSpec { radius = FxScale.Lin(0, 1.2f), duration = 0.38f, heightFactor = 1.5f, band = false };
        }
    }

    /// <summary>
    /// 元素击杀的迸散（B 路：「迸散碎片带元素色」）：元素色的发光碎片四散、拉丝火花、元素色卡通环；再按元素加一样：
    /// 火 = 几簇卡通火苗窜起 + 余烬，雷 = 贴身噼啪的电弧碎纹，蚀 = 四溅的蚀液滴。规模 s = 身体直径。
    /// </summary>
    public sealed class DeathElementPreset : FxPreset
    {
        readonly string id;
        public override string Id => id;

        DeathElementPreset(string id, Element e, FxLayer extra)
        {
            this.id = id;
            DefaultColor = Fx.ElementColor(e);
            ScaleMin = 0.5f;
            ScaleMax = 6f;
            Layers = new[]
            {
                new FxLayer
                {
                    style = "Shard", count = FxScale.Lin(8, 4, 24), maxCount = 24, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2.5f, size = new Vector2(0.1f, 0.18f), sizeScale = FxScale.Pow(0.5f),
                    life = new Vector2(0.6f, 1f), color = FxColor.Alternate, every = 3, mix = 0.45f,
                },
                new FxLayer
                {
                    style = "StreakLight", count = FxScale.Lin(8, 4, 20), maxCount = 20, shape = FxShape.Sphere,
                    speed = new Vector2(6, 12), size = new Vector2(0.04f, 0.04f), life = new Vector2(0.15f, 0.3f), color = FxColor.Hot, mix = 0.35f,
                },
                new FxLayer
                {
                    style = "ToonPop", count = FxScale.Const(1), density = false, shape = FxShape.Point, delay = 0.03f,
                    size = new Vector2(1f, 1f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.24f, 0.24f), color = FxColor.Hot, mix = 0.2f,
                },
                extra,
            };
        }

        public static string IdOf(Element e) => e switch
        {
            Element.Fire => "DeathFire",
            Element.Shock => "DeathShock",
            Element.Corrode => "DeathCorrode",
            _ => null,
        };

        [Defs]
        sealed class Source : IDefSource<FxPreset>
        {
            public System.Collections.Generic.IEnumerable<FxPreset> Create()
            {
                yield return new DeathElementPreset("DeathFire", Element.Fire, new FxLayer
                {
                    style = "ToonFlame", count = FxScale.Lin(3, 1, 7), maxCount = 7, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.3f),
                    speed = new Vector2(0.3f, 1f), up = 1.2f, size = new Vector2(0.45f, 0.7f), sizeScale = FxScale.Pow(0.6f), life = new Vector2(0.45f, 0.7f),
                    color = FxColor.Hot, mix = 0.15f,
                });
                yield return new DeathElementPreset("DeathShock", Element.Shock, new FxLayer
                {
                    style = "Crackle", count = FxScale.Lin(5, 2, 12), maxCount = 12, shape = FxShape.Sphere, spread = FxScale.Lin(0, 0.35f), spreadMin = 0.4f,
                    speed = new Vector2(0, 0.4f), size = new Vector2(0.4f, 0.7f), life = new Vector2(0.12f, 0.24f), color = FxColor.Hot, mix = 0.4f,
                });
                yield return new DeathElementPreset("DeathCorrode", Element.Corrode, new FxLayer
                {
                    style = "Drop", count = FxScale.Lin(8, 4, 20), maxCount = 20, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.25f),
                    speed = new Vector2(2.5f, 5.5f), up = 2, size = new Vector2(0.1f, 0.17f), life = new Vector2(0.5f, 0.85f), color = FxColor.Tint,
                });
            }
        }
    }
}
