using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>天气粒子（跟着相机的发射器）：风沙拉丝 / 雪片 / 灰烬</summary>
    public enum WeatherParticles
    {
        None,
        Sand,
        Snow,
        Ash,
    }

    /// <summary>
    /// 一种天气的目标值（docs/unity-parity.md L3）：<see cref="WeatherDirector"/> 按强度 0..1 把场景的基础值（关卡构建时的雾、主光）插值过去。
    ///   雾：颜色、起止距离是绝对值（沙暴把雾的终点拉到 32 m）；主光：亮度倍率 × 色偏；
    ///   后处理：一个运行时 Volume（ColorAdjustments 的曝光 / 对比 / 饱和 / 滤色），权重 = 强度；
    ///   风：0..1 写进全局 _WindDir.w 与 WindZone；粒子：种类 + 强度 1 时每秒发射数；远幕：盖住天空与远景剪影的程度；
    ///   能见度：远程锁定距离上限（敌人 AI 读 <see cref="WeatherDirector.LockOnRange"/>），∞ = 不限。
    /// </summary>
    [Serializable]
    public sealed class WeatherProfile
    {
        public string id, title;

        [Header("雾")]
        public Color fogColor = new(0.88f, 0.76f, 0.6f);
        public float fogStart = 40, fogEnd = 260;

        [Header("主光")]
        public float sunMult = 1;
        public Color sunTint = Color.white;

        [Header("后处理（ColorAdjustments，强度 1 时的值）")]
        public float postExposure, contrast, saturation;
        public Color colorFilter = Color.white;

        [Header("风、粒子、远幕、声音")]
        [Range(0, 1)] public float wind;
        public WeatherParticles particles;
        /// <summary>强度 1 时每秒发射多少颗（再乘画质密度）</summary>
        public float particleRate;
        public Color particleColor = Color.white;
        /// <summary>粒子顺风速度（m/s）</summary>
        public float particleSpeed = 12;
        /// <summary>远幕不透明度：1 = 雾终点之外（天空、远景剪影）全部变成雾色</summary>
        [Range(0, 1)] public float dome;
        /// <summary>风声 0..1</summary>
        [Range(0, 1)] public float windSound;

        /// <summary>远程锁定距离上限（米）；∞ = 不限</summary>
        [Header("能见度")]
        public float visibility = float.PositiveInfinity;

        public WeatherProfile Clone() => (WeatherProfile)MemberwiseClone();
    }

    /// <summary>
    /// 天气预设（代码即数据，D16）。id 供关卡构建器 / 区域天气引用：
    ///   sandstorm 1-1 ④ 驼队营地的周期沙暴（能见度 25 m）· haze 戈壁薄尘 · whiteout-desert / whiteout-frost / whiteout-inferno 软边界的白化（风沙 / 风雪 / 烟尘）·
    ///   blizzard 第二章、第四章的风雪 · ashfall 第三章的落灰。
    /// </summary>
    public static class WeatherProfiles
    {
        public const string Sandstorm = "sandstorm", Haze = "haze", Blizzard = "blizzard", Ashfall = "ashfall";
        public const string WhiteoutDesert = "whiteout-desert", WhiteoutFrost = "whiteout-frost", WhiteoutInferno = "whiteout-inferno";

        static Dictionary<string, WeatherProfile> map;

        static Dictionary<string, WeatherProfile> Map => map ??= Build();

        public static IEnumerable<WeatherProfile> All => Map.Values;

        /// <summary>按 id 取预设（返回同一个实例，别改；要改先 Clone）；没有返回 null</summary>
        public static WeatherProfile Get(string id) => id != null && Map.TryGetValue(id, out var p) ? p : null;

        /// <summary>软边界白化用哪套：按章节主题（ShowcaseTheme.key：Desert / Frost / Inferno）</summary>
        public static string WhiteoutFor(string theme) => theme switch
        {
            "Frost" => WhiteoutFrost,
            "Inferno" => WhiteoutInferno,
            _ => WhiteoutDesert,
        };

        static Dictionary<string, WeatherProfile> Build()
        {
            var list = new[]
            {
                // 1-1 ④：可见度降到 25 m，远程失去锁定，近战借沙暴逼近（unity-maps-v1 1-1）。土黄、压暗、去饱和
                new WeatherProfile
                {
                    id = Sandstorm, title = "沙暴",
                    fogColor = new Color(0.74f, 0.57f, 0.37f), fogStart = 2, fogEnd = 32,
                    sunMult = 0.45f, sunTint = new Color(1f, 0.8f, 0.58f),
                    postExposure = 0.05f, contrast = -12, saturation = -22, colorFilter = new Color(1f, 0.9f, 0.76f),
                    wind = 1, particles = WeatherParticles.Sand, particleRate = 900, particleColor = new Color(0.82f, 0.66f, 0.45f, 0.55f), particleSpeed = 16,
                    dome = 1, windSound = 1, visibility = 25,
                },
                new WeatherProfile
                {
                    id = Haze, title = "薄尘",
                    fogColor = new Color(0.86f, 0.74f, 0.58f), fogStart = 25, fogEnd = 160,
                    sunMult = 0.85f, sunTint = new Color(1f, 0.93f, 0.82f),
                    contrast = -4, saturation = -6, colorFilter = new Color(1f, 0.96f, 0.9f),
                    wind = 0.45f, particles = WeatherParticles.Sand, particleRate = 120, particleColor = new Color(0.85f, 0.72f, 0.52f, 0.3f), particleSpeed = 8,
                    dome = 0.3f, windSound = 0.3f,
                },
                // 软边界：越往外越白，雾收到 22 m 以内，风声、拉丝满格（Three.js walker.wind → 白雾）
                new WeatherProfile
                {
                    id = WhiteoutDesert, title = "风沙（软边界）",
                    fogColor = new Color(0.93f, 0.84f, 0.7f), fogStart = 0, fogEnd = 22,
                    sunMult = 0.7f, sunTint = new Color(1f, 0.93f, 0.82f),
                    postExposure = 0.6f, contrast = -25, saturation = -35, colorFilter = new Color(1f, 0.96f, 0.9f),
                    wind = 1, particles = WeatherParticles.Sand, particleRate = 700, particleColor = new Color(0.92f, 0.82f, 0.66f, 0.5f), particleSpeed = 18,
                    dome = 1, windSound = 0.85f,
                },
                new WeatherProfile
                {
                    id = WhiteoutFrost, title = "风雪（软边界）",
                    fogColor = new Color(0.9f, 0.94f, 1f), fogStart = 0, fogEnd = 20,
                    sunMult = 0.75f, sunTint = new Color(0.92f, 0.96f, 1f),
                    postExposure = 0.7f, contrast = -28, saturation = -40, colorFilter = new Color(0.95f, 0.98f, 1f),
                    wind = 1, particles = WeatherParticles.Snow, particleRate = 900, particleColor = new Color(1f, 1f, 1f, 0.8f), particleSpeed = 14,
                    dome = 1, windSound = 0.9f,
                },
                new WeatherProfile
                {
                    id = WhiteoutInferno, title = "烟尘（软边界）",
                    fogColor = new Color(0.32f, 0.2f, 0.17f), fogStart = 0, fogEnd = 24,
                    sunMult = 0.6f, sunTint = new Color(1f, 0.7f, 0.55f),
                    postExposure = -0.2f, contrast = -15, saturation = -25, colorFilter = new Color(1f, 0.82f, 0.72f),
                    wind = 0.8f, particles = WeatherParticles.Ash, particleRate = 600, particleColor = new Color(0.35f, 0.3f, 0.28f, 0.6f), particleSpeed = 9,
                    dome = 1, windSound = 0.7f,
                },
                new WeatherProfile
                {
                    id = Blizzard, title = "风雪",
                    fogColor = new Color(0.82f, 0.88f, 0.96f), fogStart = 4, fogEnd = 55,
                    sunMult = 0.55f, sunTint = new Color(0.9f, 0.95f, 1f),
                    postExposure = 0.15f, contrast = -14, saturation = -25, colorFilter = new Color(0.94f, 0.98f, 1f),
                    wind = 0.9f, particles = WeatherParticles.Snow, particleRate = 800, particleColor = new Color(1f, 1f, 1f, 0.75f), particleSpeed = 11,
                    dome = 0.9f, windSound = 0.8f, visibility = 40,
                },
                new WeatherProfile
                {
                    id = Ashfall, title = "落灰",
                    fogColor = new Color(0.3f, 0.17f, 0.15f), fogStart = 12, fogEnd = 120,
                    sunMult = 0.8f, sunTint = new Color(1f, 0.75f, 0.6f),
                    contrast = -6, saturation = -10, colorFilter = new Color(1f, 0.88f, 0.8f),
                    wind = 0.3f, particles = WeatherParticles.Ash, particleRate = 160, particleColor = new Color(0.42f, 0.36f, 0.33f, 0.5f), particleSpeed = 2.5f,
                    dome = 0.3f, windSound = 0.2f,
                },
            };
            var d = new Dictionary<string, WeatherProfile>(StringComparer.OrdinalIgnoreCase);
            foreach (var p in list) d[p.id] = p;
            return d;
        }
    }

    /// <summary>天气的可插值部分（雾、主光倍率、风、远幕、风声）：基础值 → 逐层 Lerp 到各个天气的目标</summary>
    public struct WeatherState
    {
        public Color fogColor;
        public float fogStart, fogEnd;
        public float sunMult;
        public Color sunTint;
        public float wind, dome, sound;

        public static WeatherState Lerp(in WeatherState a, WeatherProfile p, float t)
        {
            if (p == null || !(t > 0)) return a;
            t = Mathf.Clamp01(t);
            return new WeatherState
            {
                fogColor = Color.Lerp(a.fogColor, p.fogColor, t),
                fogStart = Mathf.Lerp(a.fogStart, p.fogStart, t),
                fogEnd = Mathf.Lerp(a.fogEnd, p.fogEnd, t),
                sunMult = Mathf.Lerp(a.sunMult, a.sunMult * p.sunMult, t),
                sunTint = Color.Lerp(a.sunTint, a.sunTint * p.sunTint, t),
                wind = Mathf.Lerp(a.wind, Mathf.Max(a.wind, p.wind), t),
                dome = Mathf.Lerp(a.dome, Mathf.Max(a.dome, p.dome), t),
                sound = Mathf.Lerp(a.sound, Mathf.Max(a.sound, p.windSound), t),
            };
        }
    }
}
