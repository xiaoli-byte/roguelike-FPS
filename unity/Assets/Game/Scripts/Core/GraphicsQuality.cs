using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 「画质」同时带上 Unity 的渲染档：低 → Mobile（0.8 倍渲染分辨率、单级硬阴影、Forward、无 SSAO / MSAA），中 / 高 → PC。
    /// 只切 QualitySettings 的档位，不改 URP 资产本身；目标档不存在（移动平台排除了 PC 档）就不切。
    /// 跟着 <see cref="ArtQuality.Changed"/> 走，所以暂停菜单、样板场景的 G 热键切的都是同一套。只在 Play 时生效：
    /// 编辑器里的毛发对比截图（FurReview）照样只看毛发；退出 Play 时还原进 Play 前的档，免得 ProjectSettings 的当前档被改脏。
    /// </summary>
    public static class GraphicsQuality
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot()
        {
            ArtQuality.Changed -= Apply;
            ArtQuality.Changed += Apply;
#if UNITY_EDITOR
            int editorLevel = QualitySettings.GetQualityLevel();
            void Restore(UnityEditor.PlayModeStateChange s)
            {
                if (s != UnityEditor.PlayModeStateChange.EnteredEditMode) return;
                UnityEditor.EditorApplication.playModeStateChanged -= Restore;
                ArtQuality.Changed -= Apply;
                if (QualitySettings.GetQualityLevel() != editorLevel) QualitySettings.SetQualityLevel(editorLevel, true);
            }
            UnityEditor.EditorApplication.playModeStateChanged += Restore;
#endif
            Apply(ArtQuality.Level);
        }

        static void Apply(ArtQualityLevel level)
        {
            if (!Application.isPlaying) return;
            int target = System.Array.IndexOf(QualitySettings.names, level == ArtQualityLevel.Low ? "Mobile" : "PC");
            if (target >= 0 && target != QualitySettings.GetQualityLevel()) QualitySettings.SetQualityLevel(target, true);
        }
    }
}
