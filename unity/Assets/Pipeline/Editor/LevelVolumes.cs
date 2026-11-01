using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// bridge.sh volumes：不重建关卡，只按 <see cref="ShowcaseTheme"/> 重写各关 / 展示场景 / 测试场里的 VP_&lt;章&gt;.asset（<see cref="ShowcaseSceneBuilder.FillVolume"/>）。
    /// 认四章主题的 key（Desert / Frost / Inferno / Plateau），别的 VP 不碰。建关时 BuildLighting 写的是同一份值，所以重建关卡结果一样。
    /// 第二批 E 路（单遍后处理）引入：改了主题的后处理之后跑一次，各关的 Volume 就跟上，不用重建 12 关。
    /// </summary>
    public static class LevelVolumes
    {
        static readonly string[] Roots = { "Assets/Levels", "Assets/Showcase" };

        /// <summary>前三章（单遍后处理重新拟合过的）+ 第四章（单遍下直接按观感调的 VP_Plateau，F 路）</summary>
        static readonly ShowcaseTheme[] Themes = { ShowcaseTheme.Desert, ShowcaseTheme.Frost, ShowcaseTheme.Inferno, ShowcaseTheme.Plateau };

        public static int RewriteAll()
        {
            int errors = 0, n = 0;
            foreach (var guid in AssetDatabase.FindAssets("t:VolumeProfile", Roots))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(path);
                if (!profile || !profile.name.StartsWith("VP_")) continue;
                var theme = Themes.FirstOrDefault(t => profile.name == $"VP_{t.key}");
                if (theme == null) continue;
                ShowcaseSceneBuilder.FillVolume(profile, theme);
                ShowcaseSceneBuilder.PersistVolumeComponents(profile);
                int saved = AssetDatabase.LoadAllAssetsAtPath(path).OfType<VolumeComponent>().Count();
                if (saved != profile.components.Count)
                {
                    Debug.LogError($"[LevelVolumes] {path}：{profile.components.Count} 个组件，资产里只有 {saved} 个");
                    errors++;
                }
                Debug.Log($"[LevelVolumes] {path} ← {theme.key}");
                n++;
            }
            AssetDatabase.SaveAssets();
            Debug.Log($"[LevelVolumes] 重写 {n} 个 VP_*.asset");
            return errors;
        }
    }
}
