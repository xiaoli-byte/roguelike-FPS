using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>卡通爆炸的元素色阶（docs/art/fx-style.md §2.1）：<see cref="Fx.Explosion(Vector3, float, Color)"/> 按调用方的颜色认出来（<see cref="Fx.BlastThemeOf"/>）</summary>
    public enum BlastTheme
    {
        /// <summary>火 · 灵火（以及无元素、沙、熔岩这些暖色）：原来那套爆炸</summary>
        Fire,
        /// <summary>雷：白芯、蓝白主色、靛紫暗边，加折线电弧</summary>
        Shock,
        /// <summary>蚀：黄绿芯、鲜绿主色、墨绿暗边 / 烟，加黏团</summary>
        Corrode,
        /// <summary>圣 / 金（焚雷、鎏金、精英）：暖白芯、金主色、赭金烟，加小金星</summary>
        Gold,
        /// <summary>灵紫（归墟、碎刃）：淡紫芯、深紫暗边</summary>
        Spirit,
        /// <summary>冰：不进火团，分流到冷的冰爆 <see cref="Fx.FrostNova(Vector3, float, Color)"/></summary>
        Ice,
    }

    /// <summary>各元素的亮芯 / 烟色（火团的明暗阶在 SF_FxToon 里按色相换，这里管粒子层的颜色）</summary>
    public static class BlastPalette
    {
        /// <summary>亮芯：火团在「亮芯 ↔ 主色」之间随机取色的那一端、爆闪星的颜色（都留足饱和度：着色器按色相认元素，太淡会被当成火）</summary>
        public static Color Core(BlastTheme t) => t switch
        {
            BlastTheme.Shock => new Color(0.62f, 0.9f, 1f),
            BlastTheme.Corrode => new Color(0.78f, 1f, 0.36f),
            BlastTheme.Gold => new Color(1f, 0.93f, 0.62f),
            BlastTheme.Spirit => new Color(0.82f, 0.62f, 1f),
            _ => ExplosionKit.HotYellow,
        };

        /// <summary>烟（实心卡通烟团的底色，暗面在着色器里再压冷一档）：靛灰 / 墨绿灰 / 赭金 / 紫灰</summary>
        public static Color Smoke(BlastTheme t) => t switch
        {
            BlastTheme.Shock => new Color(0.36f, 0.35f, 0.58f),
            BlastTheme.Corrode => new Color(0.32f, 0.44f, 0.27f),
            BlastTheme.Gold => new Color(0.8f, 0.64f, 0.38f),
            BlastTheme.Spirit => new Color(0.4f, 0.3f, 0.5f),
            _ => ExplosionKit.SmokeBase,
        };

        /// <summary>预设 id 的后缀（火没有后缀，沿用 ExplosionSmall / Explosion / ExplosionLarge）</summary>
        public static string Suffix(BlastTheme t) => t is BlastTheme.Fire or BlastTheme.Ice ? "" : "." + t;
    }

    /// <summary>
    /// 元素爆炸（特效打磨收尾一轮）：B 路的卡通爆炸只有火的色阶，雷 / 蚀 / 紫的颜色传进去会混成带赭红描边的泥色火团。
    /// 这里按三档火爆炸（<see cref="ExplosionSmallPreset"/> / <see cref="ExplosionPreset"/> / <see cref="ExplosionLargePreset"/>）一层层改出每个元素的一套：
    ///   火团、爆闪星的亮芯换成元素的亮芯（火团的明暗阶 SF_FxToon 按色相换）；烟换成元素的暗边色（靛灰 / 墨绿灰 / 赭金 / 紫灰）；
    ///   火星余烬换成元素自己的小件——雷：电弧碎纹（另有 <see cref="Fx"/> 劈出的几道折线电弧），爆闪星换成雷裂光；蚀：黏团和蚀液滴；金：小金星；紫：往上飘的灵光；
    ///   炭渣只有火有；焦痕：火 / 金余热照旧，雷、紫只留一点余热，蚀换成蚀液溅痕。数量、大小、时间结构和火爆炸一致（同样的预算）。
    /// id = 火的 id + 「.Shock / .Corrode / .Gold / .Spirit」，入口 <see cref="Fx.Explosion(Vector3, float, Color)"/>（按颜色认元素）。
    /// </summary>
    [Defs]
    public sealed class ExplosionThemes : IDefSource<FxPreset>
    {
        public IEnumerable<FxPreset> Create()
        {
            foreach (var t in new[] { BlastTheme.Shock, BlastTheme.Corrode, BlastTheme.Gold, BlastTheme.Spirit })
            {
                yield return new ThemedExplosionPreset(new ExplosionSmallPreset(), t);
                yield return new ThemedExplosionPreset(new ExplosionPreset(), t);
                yield return new ThemedExplosionPreset(new ExplosionLargePreset(), t);
            }
        }
    }

    /// <summary>一档火爆炸改出来的元素版（见 <see cref="ExplosionThemes"/>）</summary>
    public sealed class ThemedExplosionPreset : FxPreset
    {
        readonly string id;

        public override string Id => id;
        public BlastTheme Theme { get; }

        public ThemedExplosionPreset(FxPreset fire, BlastTheme theme)
        {
            Theme = theme;
            id = fire.Id + BlastPalette.Suffix(theme);
            DefaultColor = theme switch
            {
                BlastTheme.Shock => Fx.ElementColor(Element.Shock),
                BlastTheme.Corrode => Fx.ElementColor(Element.Corrode),
                BlastTheme.Gold => CombatTuning.ReactionColors[(int)Reaction.Thunderfire],
                BlastTheme.Spirit => Fx.AbyssColor,
                _ => fire.DefaultColor,
            };
            ScaleMin = fire.ScaleMin;
            ScaleMax = fire.ScaleMax;
            Light = fire.Light;
            Ring = fire.Ring;
            Shake = fire.Shake;
            if (fire.Decal != null)
                Decal = new FxDecalSpec
                {
                    kind = theme == BlastTheme.Corrode ? FxDecalKind.Splat : fire.Decal.kind,
                    size = fire.Decal.size, heightFactor = fire.Decal.heightFactor, life = fire.Decal.life,
                    heat = theme switch
                    {
                        BlastTheme.Gold => fire.Decal.heat * 0.8f,
                        BlastTheme.Shock => 0.3f,
                        BlastTheme.Spirit => 0.15f,
                        _ => fire.Decal.heat,
                    },
                };
            var list = new List<FxLayer>();
            foreach (var L in fire.Layers)
            {
                var x = Remap(L, theme);
                if (x != null) list.Add(x);
            }
            Layers = list.ToArray();
        }

        static FxLayer Remap(FxLayer L, BlastTheme t)
        {
            var x = Copy(L);
            switch (L.style)
            {
                case "ToonBurst":
                    x.fixedColor = BlastPalette.Core(t);
                    if (t == BlastTheme.Shock)
                    {
                        // 雷：爆闪星换成放射的雷裂光（折线），停留长一点
                        x.style = "ToonCrack";
                        x.size *= 1.2f;
                        x.life *= 1.5f;
                    }
                    return x;
                case "ToonFire":
                case "ToonFireRise":
                    x.fixedColor = BlastPalette.Core(t);
                    return x;
                case "ToonSmoke":
                    x.color = FxColor.Fixed;
                    x.fixedColor = BlastPalette.Smoke(t);
                    x.mix = 0.06f;
                    if (t is BlastTheme.Shock or BlastTheme.Spirit)
                    {
                        // 雷、紫炸开几乎不留烟：烟少六成、小两成
                        x.count = Scaled(L.count, 0.4f);
                        x.maxCount = Mathf.Max(1, Mathf.CeilToInt(L.maxCount * 0.4f));
                        x.size *= 0.8f;
                    }
                    else if (t == BlastTheme.Corrode)
                    {
                        // 蚀的墨绿烟小一成（暗色团块大了压画面）
                        x.size *= 0.9f;
                    }
                    return x;
                case "Streak":
                    // 雷的火花轻、不往下坠
                    if (t == BlastTheme.Shock) x.style = "StreakLight";
                    return x;
                case "Cinder":
                    // 炭渣只有火有
                    return null;
                case "Ember":
                    return Signature(L, t);
                default:
                    return x;
            }
        }

        /// <summary>火星余烬换成元素自己的小件（数量跟着原来的余烬层走）</summary>
        static FxLayer Signature(FxLayer ember, BlastTheme t)
        {
            switch (t)
            {
                case BlastTheme.Shock:
                    // 电弧碎纹：一小段折线一闪一闪，贴着爆心噼啪
                    return new FxLayer
                    {
                        style = "Crackle", count = Scaled(ember.count, 0.5f), maxCount = Mathf.Max(3, ember.maxCount / 2), shape = FxShape.Sphere,
                        spread = FxScale.Lin(0, 0.45f), spreadMin = 0.3f, speed = new Vector2(0.5f, 2f), up = 0.4f,
                        size = new Vector2(0.4f, 0.7f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.12f, 0.26f), color = FxColor.Hot, mix = 0.3f, delay = 0.03f,
                    };
                case BlastTheme.Corrode:
                    // 黏团：几团大的蚀液往外甩、落地
                    return new FxLayer
                    {
                        style = "Drop", count = Scaled(ember.count, 0.6f), maxCount = Mathf.Max(3, Mathf.CeilToInt(ember.maxCount * 0.6f)), shape = FxShape.MostlyUp,
                        spread = FxScale.Lin(0, 0.25f), speed = new Vector2(3f, 7f), speedScale = FxScale.Pow(0.5f), up = 3f,
                        size = new Vector2(0.18f, 0.34f), sizeScale = FxScale.Pow(0.5f), life = new Vector2(0.5f, 0.8f), color = FxColor.Fixed,
                        fixedColor = new Color(0.55f, 0.9f, 0.2f), mix = 0.3f, shade = new Vector2(0.85f, 1.05f),
                    };
                case BlastTheme.Gold:
                    // 小金星：几颗卡通五角星往上蹦
                    return new FxLayer
                    {
                        style = "Star", count = Scaled(ember.count, 0.5f), maxCount = Mathf.Max(3, ember.maxCount / 2), shape = FxShape.UpperSphere,
                        spread = FxScale.Lin(0, 0.35f), speed = new Vector2(1.5f, 4f), up = 1.5f,
                        size = new Vector2(0.16f, 0.26f), sizeScale = FxScale.Pow(0.4f), life = new Vector2(0.4f, 0.7f), color = FxColor.Fixed,
                        fixedColor = new Color(1f, 0.86f, 0.42f), mix = 0.15f, delay = 0.05f,
                    };
                default:
                    // 紫：往上飘的灵光
                    var x = Copy(ember);
                    x.style = "Mote";
                    x.color = FxColor.Hot;
                    x.mix = 0.3f;
                    x.count = Scaled(ember.count, 0.7f);
                    return x;
            }
        }

        static FxScale Scaled(FxScale s, float k)
        {
            if (!s.set) return FxScale.Const(k);
            return new FxScale(s.c * k, s.k * k, s.p, s.min, float.IsPositiveInfinity(s.max) ? s.max : s.max * k);
        }

        static FxLayer Copy(FxLayer L) => new()
        {
            style = L.style, count = L.count, maxCount = L.maxCount, density = L.density, shape = L.shape, coneAngle = L.coneAngle, normalBias = L.normalBias,
            speed = L.speed, speedScale = L.speedScale, up = L.up, upJitter = L.upJitter, size = L.size, sizeScale = L.sizeScale, life = L.life,
            offset = L.offset, spread = L.spread, spreadY = L.spreadY, spreadMin = L.spreadMin, color = L.color, fixedColor = L.fixedColor, mix = L.mix,
            every = L.every, shade = L.shade, alpha = L.alpha, delay = L.delay,
        };
    }
}
