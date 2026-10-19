using System;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>美术画质档（与网页版设置里的「画质」同名同档）：只管吃性能的美术效果，目前是毛发。</summary>
    public enum ArtQualityLevel { Low = 0, Medium = 1, High = 2 }

    /// <summary>
    /// 美术画质：低 = 不加毛发；中 = 风格化着色里的毛发细节（顺毛向的发丝明暗、各向异性光泽、剪影绒边）
    /// + 轮廓发丝面片（fins：只在轮廓附近显示，其余面片在顶点着色器里收掉，开销很小）；
    /// 高 = 再给近处（LOD0）的毛 / 羽叠 16 层壳（<see cref="FurShells"/>，每层多一次蒙皮网格绘制）。
    /// 存在 PlayerPrefs；没存过时按 Unity 画质档推断（Mobile → 低，其余 → 高）。改档时广播 <see cref="Changed"/>，
    /// 着色器的全局开关 _SFFurDetail 同步设置。
    /// </summary>
    public static class ArtQuality
    {
        const string PrefKey = "spiritfire.artQuality";
        static readonly int FurDetailId = Shader.PropertyToID("_SFFurDetail");
        static bool ready;
        static ArtQualityLevel level;

        public static event Action<ArtQualityLevel> Changed;

        public static ArtQualityLevel Level
        {
            get { Init(); return level; }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot()
        {
            ready = false;
            Init();
        }

        static void Init()
        {
            if (ready) return;
            ready = true;
            level = PlayerPrefs.HasKey(PrefKey) ? (ArtQualityLevel)Mathf.Clamp(PlayerPrefs.GetInt(PrefKey), 0, 2) : Default();
            ApplyGlobals();
        }

        static ArtQualityLevel Default()
        {
            var names = QualitySettings.names;
            int i = QualitySettings.GetQualityLevel();
            return i >= 0 && i < names.Length && names[i] == "Mobile" ? ArtQualityLevel.Low : ArtQualityLevel.High;
        }

        /// <param name="save">false：只在本次运行生效（截图、对比工具用），不写 PlayerPrefs</param>
        public static void Set(ArtQualityLevel value, bool save = true)
        {
            Init();
            level = value;
            if (save) PlayerPrefs.SetInt(PrefKey, (int)value);
            ApplyGlobals();
            Changed?.Invoke(value);
        }

        /// <summary>循环切换（调试热键用）：低 → 中 → 高 → 低</summary>
        public static ArtQualityLevel Cycle()
        {
            Set((ArtQualityLevel)(((int)Level + 1) % 3));
            return level;
        }

        static void ApplyGlobals() => Shader.SetGlobalFloat(FurDetailId, level >= ArtQualityLevel.Medium ? 1f : 0f);

        /// <summary>当前档下一个资产的毛发壳层数（<paramref name="high"/> = 它在「高」档的层数）</summary>
        public static int FurShells(int high) => Level == ArtQualityLevel.High ? high : 0;

        /// <summary>轮廓发丝面片（fins）：画质「中」以上</summary>
        public static bool FurFins => Level >= ArtQualityLevel.Medium;

        public static string Label(ArtQualityLevel l) => l switch
        {
            ArtQualityLevel.Low => "低",
            ArtQualityLevel.Medium => "中",
            _ => "高",
        };
    }
}
