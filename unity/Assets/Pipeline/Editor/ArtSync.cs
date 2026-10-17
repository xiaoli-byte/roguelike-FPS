using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 管线在 Unity 里的入口。
    ///   菜单 Spiritfire ▸ Art ▸ Sync All：刷新导入 → 重建 AC_Humanoid → 生成材质与 Prefab → 自动 QA
    ///   批处理：Unity -batchmode -projectPath unity -executeMethod Spiritfire.Art.Editor.ArtSync.BatchSync -quit
    ///           （QA 有错误时退出码 1）
    /// </summary>
    public static class ArtSync
    {
        [MenuItem("Spiritfire/Art/Sync All", priority = 0)]
        public static void SyncAll() => Sync(out _);

        [MenuItem("Spiritfire/Art/Validate", priority = 1)]
        public static void ValidateOnly() => ArtValidator.ValidateAll(ArtSidecar.All());

        public static List<ArtValidator.Result> Sync(out int errors)
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            ShowcaseSceneBuilder.EnsureLayer(ShowcaseSceneBuilder.FirstPersonLayer, 6);
            ShowcaseSceneBuilder.EnsureLayer(ShowcaseSceneBuilder.CharacterLayer, 7);
            ReimportStale();
            var controller = MixamoLibrary.BuildController();
            var sidecars = ArtSidecar.All();
            AssetDatabase.StartAssetEditing();
            var materials = new Dictionary<ArtSidecar, Dictionary<string, Material>>();
            try
            {
                foreach (var sc in sidecars)
                    materials[sc] = sc.Materials.OfType<JObject>()
                        .Select(m => ArtPrefabBuilder.BuildMaterial(sc, m))
                        .ToDictionary(m => m.name, m => m);
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }
            AssetDatabase.SaveAssets();
            // 原生骨架敌人的程序动画片段（scripts/unity/bake-native-anims.mjs 的采样数据）
            var native = NativeClipBuilder.BuildAll(sidecars);
            AssetDatabase.SaveAssets();
            int i = 0;
            foreach (var sc in sidecars)
            {
                EditorUtility.DisplayProgressBar("Spiritfire Art Sync", sc.Id, (float)i++ / sidecars.Count);
                ArtPrefabBuilder.BuildPrefab(sc, materials[sc], controller, native.GetValueOrDefault(sc.Id));
            }
            EditorUtility.ClearProgressBar();
            AssetDatabase.SaveAssets();
            var results = ArtValidator.ValidateAll(sidecars);
            errors = results.Sum(r => r.errors.Count);
            return results;
        }

        /// <summary>sidecar 比模型新（重新导出过）或导入规则版本变了，就强制重新导入模型与贴图。</summary>
        static void ReimportStale()
        {
            foreach (var sc in ArtSidecar.All())
            {
                var mi = AssetImporter.GetAtPath(sc.FbxPath);
                if (!mi) continue;
                string stamp = $"{(string)sc.raw["source"]?["sha256"]}:{(string)sc.raw["exported"]}:{ArtImportPostprocessor.Version}:{sc.EffectiveRigType}";
                if (mi.userData == stamp) continue;
                mi.userData = stamp;
                foreach (var tex in AssetDatabase.FindAssets("t:Texture2D", new[] { sc.Dir + "/Textures" }))
                    AssetDatabase.ImportAsset(AssetDatabase.GUIDToAssetPath(tex), ImportAssetOptions.ForceUpdate);
                mi.SaveAndReimport();
            }
        }

        public static void BatchSync()
        {
            Sync(out int errors);
            EditorApplication.Exit(errors > 0 ? 1 : 0);
        }
    }
}
