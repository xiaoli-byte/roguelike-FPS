using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>特效打磨 B 路的入口（爆炸分档、元素反应、护盾球壳）：Fx 的分部文件，避免和其它路在 Fx.cs 里撞车</summary>
    public static partial class Fx
    {
        /// <summary>爆炸分档的半径界线：小 &lt; 1.6 m（弹丸），中 1.6–4 m（榴弹 / 火药 / 反应），大 ≥ 4 m（首领技能、精英自爆）</summary>
        public const float ExplosionSmallBelow = 1.6f, ExplosionLargeFrom = 4f;

        /// <summary>按半径选爆炸档的预设 id</summary>
        public static string ExplosionId(float radius) =>
            !(radius >= ExplosionSmallBelow) ? "ExplosionSmall" : radius >= ExplosionLargeFrom ? "ExplosionLarge" : "Explosion";

        /// <summary>按半径和元素选爆炸预设 id（火 = 原来那三档；雷 / 蚀 / 金 / 紫 = 加后缀的元素版，Presets/ExplosionElements.cs）</summary>
        public static string ExplosionId(float radius, BlastTheme theme) => ExplosionId(radius) + BlastPalette.Suffix(theme);

        /// <summary>
        /// 调用方的爆炸颜色 → 元素（fx-style §2.1）。先认标准色（元素色表、冰霜色板、反应色、雷 / 光束 / 护盾的蓝），其余按色相：
        /// 暖色（红 / 橙 / 黄，以及不饱和的白、沙、灰）= 火；40–62° 的饱和金黄 = 金；绿 60–165° = 蚀；青蓝 165–248° 里饱和的是雷、淡的是冰；紫 248–330° = 灵紫
        /// </summary>
        public static BlastTheme BlastThemeOf(Color c)
        {
            if (Near(c, ElementColor(Element.Shock)) || Near(c, LightningColor) || Near(c, BeamColor) || Near(c, ShieldColor)) return BlastTheme.Shock;
            if (Near(c, ElementColor(Element.Corrode))) return BlastTheme.Corrode;
            if (Near(c, ElementColor(Element.Fire)) || Near(c, ExplosionColor) || Near(c, NoneColor)) return BlastTheme.Fire;
            if (Near(c, FrostPalette.Ice) || Near(c, FrostPalette.IceDeep) || Near(c, FrostPalette.IceHot) || Near(c, FrostPalette.Snow) || Near(c, FrostPalette.Mist)
                || Near(c, FrostPalette.Frost) || Near(c, FrostPalette.Shard))
                return BlastTheme.Ice;
            if (Near(c, CombatTuning.ReactionColors[(int)Game.Reaction.Thunderfire])) return BlastTheme.Gold;
            if (Near(c, AbyssColor)) return BlastTheme.Spirit;
            Color.RGBToHSV(c, out float h, out float s, out float v);
            float deg = h * 360f;
            if (s < 0.12f || v < 0.08f) return BlastTheme.Fire;
            if (deg >= 60f && deg < 165f) return BlastTheme.Corrode;
            if (deg >= 165f && deg < 248f) return s < 0.45f ? BlastTheme.Ice : BlastTheme.Shock;
            if (deg >= 248f && deg < 330f) return BlastTheme.Spirit;
            if (deg >= 40f && deg < 60f && s >= 0.45f) return BlastTheme.Gold;
            return BlastTheme.Fire;
        }

        static bool Near(Color a, Color b) => Mathf.Abs(a.r - b.r) + Mathf.Abs(a.g - b.g) + Mathf.Abs(a.b - b.b) < 0.02f;

        /// <summary>
        /// 按元素分流的爆炸（<see cref="Explosion(Vector3, float, Color)"/> 的实现）：火照旧；雷 / 蚀 / 金 / 紫走元素版的卡通爆炸，雷再劈几道折线电弧；
        /// 冰不进火团，走冷的冰爆 <see cref="FrostNova(Vector3, float, Color)"/>
        /// </summary>
        public static FxHandle ExplosionThemed(Vector3 center, float radius, Color color)
        {
            var theme = BlastThemeOf(color);
            if (theme == BlastTheme.Ice) return FrostNova(center, Mathf.Clamp(Finite(radius) ? radius : 1f, 0.6f, 8f), color);
            var h = Play(ExplosionId(radius, theme), center, Vector3.up, color, radius);
            if (theme == BlastTheme.Shock && h.Alive) ShockArcs(center, radius, color);
            return h;
        }

        /// <summary>
        /// 雷爆的折线电弧（fx-style §三「雷」：折线锯齿、粗细有对比、闪烁短促）：从爆心往外劈 2–5 道、伸出火团之外（1.1–1.45 r），
        /// 0.16 s 后再劈一轮短一点的（火团正大的时候还在噼啪）；贴着走的电弧，不闪灯，数量乘画质密度
        /// </summary>
        static void ShockArcs(Vector3 center, float radius, Color color)
        {
            if (!Finite(center) || !(radius > 0)) return;
            float r = Mathf.Clamp(radius, 0.4f, 8f);
            int n = Mathf.Clamp(Mathf.RoundToInt((2f + r * 0.5f) * Density), 2, 5);
            var hot = Color.Lerp(color, Color.white, 0.35f);
            ArcRound(center, r, n, hot, 1.1f, 1.45f, 0.08f);
            var rt = FxRuntime.Ensure();
            if (rt) rt.StartCoroutine(ArcsLater(center, r, Mathf.Max(2, n - 1), hot, 0.16f));
        }

        static System.Collections.IEnumerator ArcsLater(Vector3 center, float r, int n, Color hot, float delay)
        {
            yield return new WaitForSeconds(delay);
            ArcRound(center, r, n, hot, 0.85f, 1.15f, 0.06f);
        }

        static readonly Vector3[] arcPts = new Vector3[4];

        static void ArcRound(Vector3 center, float r, int n, Color hot, float lenMin, float lenMax, float width)
        {
            float a0 = Random.value * Mathf.PI * 2;
            for (int i = 0; i < n; i++)
            {
                float a = a0 + i * Mathf.PI * 2 / n + Random.Range(-0.4f, 0.4f);
                var dir = new Vector3(Mathf.Cos(a), Random.Range(-0.1f, 0.7f), Mathf.Sin(a)).normalized;
                float len = r * Random.Range(lenMin, lenMax);
                var side = Vector3.Cross(dir, Vector3.up).normalized;
                // 两个拐点：一左一右，折线锯齿
                arcPts[0] = center + dir * (r * 0.15f);
                arcPts[1] = center + dir * (len * 0.4f) + side * (len * Random.Range(0.1f, 0.22f));
                arcPts[2] = center + dir * (len * 0.7f) - side * (len * Random.Range(0.08f, 0.2f)) + Vector3.up * (len * Random.Range(-0.05f, 0.15f));
                arcPts[3] = center + dir * len;
                Spiritfire.Game.Lightning.Chain(arcPts, 4, hot, width);
            }
        }

        /// <summary>
        /// 元素反应「打出了组合技」的那一下（闪光 → 冲击波 → 余韵，Presets/Reactions.cs）：熔金 / 焚雷 / 封脉；归墟走 <see cref="Abyss"/>。
        /// center = 反应中心（中心敌人身体中心），scale = 规模（1 = 一个人形身位）
        /// </summary>
        public static FxHandle Reaction(Reaction r, Vector3 center, float scale = 1)
        {
            string id = r switch
            {
                Game.Reaction.Meltdown => "RxMeltdown",
                Game.Reaction.Thunderfire => "RxThunderfire",
                Game.Reaction.Veinseal => "RxVeinseal",
                _ => null,
            };
            if (id == null) return FxHandle.None;
            var p = Registry<FxPreset>.Get(id);
            return p == null ? FxHandle.None : Play(p, center, Vector3.up, CombatTuning.ReactionColors[(int)r], scale);
        }

        /// <summary>崩解：元素色光点往里一吸、再「啪」地炸开（Presets/Reactions.cs RxCollapse）</summary>
        public static FxHandle Collapse(Vector3 center, Color color, float scale = 1) => Play("RxCollapse", center, Vector3.up, color, scale);
    }
}
