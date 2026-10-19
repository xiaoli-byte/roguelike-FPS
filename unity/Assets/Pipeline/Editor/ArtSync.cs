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
            errors = RelinkControllers();
            // 灵宠：有角色预制体（SK_Pet_*）/ 发光件挂件（SM_PetPart_*）的重建 Resources/Pets 嵌套预制体（新出现的不用再手动跑 pets）；不计入错误数
            try { PetArtImport.SyncRigged(); }
            catch (System.Exception e) { Debug.LogWarning($"[pets] 灵宠预制体没能更新：{e.Message}"); }
            var results = ArtValidator.ValidateAll(sidecars);
            errors += results.Sum(r => r.errors.Count);
            return results;
        }

        /// <summary>
        /// 原生动画控制器每次 Sync 都会删掉重建：磁盘上 Prefab 的引用（GUID + 文件内 ID）是对的，但编辑器内存里的 Prefab
        /// 可能还指着被替换掉的旧控制器对象——运行时 Animator 的控制器是空的，敌人只剩绑定姿势（2026-10-18 一次 Sync 后
        /// 1-1 六种敌人全部没有动画）。这里强制重新导入角色 Prefab，再逐个核对：文件里引用了控制器、加载出来却是空的就报错。
        /// </summary>
        static int RelinkControllers()
        {
            var paths = AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/Art/Prefabs/Characters" }).Select(AssetDatabase.GUIDToAssetPath).ToList();
            foreach (var p in paths) AssetDatabase.ImportAsset(p, ImportAssetOptions.ForceUpdate);
            int broken = 0;
            foreach (var p in paths)
            {
                var go = AssetDatabase.LoadAssetAtPath<GameObject>(p);
                var anim = go ? go.GetComponentInChildren<Animator>(true) : null;
                if (!anim || anim.runtimeAnimatorController) continue;
                if (!System.IO.File.ReadAllText(p).Contains("m_Controller: {fileID: 9100000")) continue;
                Debug.LogError($"[Sync] {go.name} 的动画控制器引用没有接上（重新导入后仍为空）");
                broken++;
            }
            return broken;
        }

        /// <summary>sidecar 比模型新（重新导出过）或导入规则版本变了，就强制重新导入模型与贴图。</summary>
        static void ReimportStale()
        {
            foreach (var sc in ArtSidecar.All())
            {
                var mi = AssetImporter.GetAtPath(sc.FbxPath);
                if (!mi) continue;
                string stamp = $"{(string)sc.raw["source"]?["sha256"]}:{(string)sc.raw["exported"]}:{ArtImportPostprocessor.Version}:{sc.EffectiveRigType}";
                // 毛发配置变了也要重新导入（FurBake 在导入时烘 UV2 / UV3）；没有毛发的资产戳记保持原样，不会全体重导
                if (sc.Fur != null) stamp += $":fur{FurStamp(sc.Fur)}";
                if (mi.userData == stamp) continue;
                mi.userData = stamp;
                foreach (var tex in AssetDatabase.FindAssets("t:Texture2D", new[] { sc.Dir + "/Textures" }))
                    AssetDatabase.ImportAsset(AssetDatabase.GUIDToAssetPath(tex), ImportAssetOptions.ForceUpdate);
                mi.SaveAndReimport();
            }
        }

        static string FurStamp(Newtonsoft.Json.Linq.JObject fur)
        {
            using var md5 = System.Security.Cryptography.MD5.Create();
            var bytes = md5.ComputeHash(System.Text.Encoding.UTF8.GetBytes(fur.ToString(Newtonsoft.Json.Formatting.None) + FurBake.Version));
            return System.BitConverter.ToString(bytes, 0, 6).Replace("-", "");
        }

        public static void BatchSync()
        {
            Sync(out int errors);
            EditorApplication.Exit(errors > 0 ? 1 : 0);
        }
    }
}
