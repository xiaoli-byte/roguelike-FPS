using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 灵宠模型导入（docs/pet-system.md 第 7 节）：Assets/Art/Pets/&lt;ID&gt;/ 下放 &lt;ID&gt;.fbx 与 Textures/&lt;ID&gt;_BaseColor.png（可选 _Normal.png），
    /// 由 art/pipeline/blender/bl_pet_export.py 导出（静态网格、脚底在原点、朝 +Z、真实尺寸）。这里：
    ///   贴图导入（底色 sRGB、法线按法线贴图）→ 模型导入（不要动画 / 相机 / 灯光 / 材质）→ 材质 &lt;ID&gt;.mat（Spiritfire/StylizedLit，角色风格参数）
    ///   → 预制体 Assets/Game/Resources/Pets/&lt;ID&gt;.prefab（模型 + 材质，无碰撞体），运行时 Resources.Load("Pets/&lt;ID&gt;")。
    /// 幂等：设置没变就不重新导入，材质与预制体每次覆盖。菜单 Spiritfire/Pets/Import Pet Models，或 Bridge 命令 pets。
    /// </summary>
    public static class PetArtImport
    {
        public const string Root = "Assets/Art/Pets";
        public const string PrefabDir = "Assets/Game/Resources/Pets";

        [MenuItem("Spiritfire/Pets/Import Pet Models")]
        static void Menu()
        {
            int errors = ImportAll();
            Debug.Log(errors == 0 ? "[pets] 灵宠模型导入完成" : $"[pets] 灵宠模型导入完成，{errors} 个问题（见上面的日志）");
        }

        /// <summary>导入全部灵宠模型；返回问题数</summary>
        public static int ImportAll()
        {
            if (!AssetDatabase.IsValidFolder(Root))
            {
                Debug.Log($"[pets] 没有 {Root}，跳过（模型缺失时游戏里用程序化占位体）");
                return 0;
            }
            int errors = 0, built = 0;
            foreach (var dir in Directory.GetDirectories(Root))
            {
                var id = Path.GetFileName(dir);
                var folder = $"{Root}/{id}";
                var fbx = $"{folder}/{id}.fbx";
                if (!File.Exists(fbx))
                {
                    Debug.LogWarning($"[pets] {id}：缺 {fbx}");
                    errors++;
                    continue;
                }
                var bcPath = $"{folder}/Textures/{id}_BaseColor.png";
                var nPath = $"{folder}/Textures/{id}_Normal.png";
                var bc = ConfigureTexture(bcPath, false);
                var n = ConfigureTexture(nPath, true);
                if (!bc)
                {
                    Debug.LogWarning($"[pets] {id}：缺底色贴图 {bcPath}");
                    errors++;
                }
                ConfigureModel(fbx);
                var mat = BuildMaterial(folder, id, bc, n);
                if (BuildPrefab(id, fbx, mat)) built++;
                else errors++;
            }
            AssetDatabase.SaveAssets();
            Debug.Log($"[pets] 生成 {built} 个灵宠预制体 → {PrefabDir}");
            return errors;
        }

        static Texture2D ConfigureTexture(string path, bool normal)
        {
            if (!File.Exists(path)) return null;
            if (AssetImporter.GetAtPath(path) is not TextureImporter ti)
            {
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                ti = AssetImporter.GetAtPath(path) as TextureImporter;
                if (!ti) return null;
            }
            var type = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
            bool changed = ti.textureType != type || ti.sRGBTexture != !normal || !ti.mipmapEnabled || ti.maxTextureSize != 2048 ||
                           ti.textureCompression != TextureImporterCompression.CompressedHQ || ti.alphaSource != TextureImporterAlphaSource.None;
            if (changed)
            {
                ti.textureType = type;
                ti.sRGBTexture = !normal;
                ti.mipmapEnabled = true;
                ti.streamingMipmaps = true;
                ti.anisoLevel = 4;
                ti.maxTextureSize = 2048;
                ti.textureCompression = TextureImporterCompression.CompressedHQ;
                ti.alphaSource = TextureImporterAlphaSource.None;
                ti.SaveAndReimport();
            }
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        static void ConfigureModel(string path)
        {
            if (AssetImporter.GetAtPath(path) is not ModelImporter mi) return;
            bool changed = mi.globalScale != 1f || !mi.useFileScale || !mi.bakeAxisConversion || mi.materialImportMode != ModelImporterMaterialImportMode.None ||
                           mi.importAnimation || mi.animationType != ModelImporterAnimationType.None || mi.importCameras || mi.importLights ||
                           mi.importBlendShapes || mi.isReadable || mi.importNormals != ModelImporterNormals.Import ||
                           mi.importTangents != ModelImporterTangents.CalculateMikk;
            if (!changed) return;
            mi.globalScale = 1f;
            mi.useFileScale = true;
            mi.bakeAxisConversion = true;
            mi.materialImportMode = ModelImporterMaterialImportMode.None;
            mi.importAnimation = false;
            mi.animationType = ModelImporterAnimationType.None;
            mi.importCameras = false;
            mi.importLights = false;
            mi.importVisibility = false;
            mi.importBlendShapes = false;
            mi.importConstraints = false;
            mi.isReadable = false;
            mi.meshCompression = ModelImporterMeshCompression.Off;
            mi.importNormals = ModelImporterNormals.Import;
            mi.importTangents = ModelImporterTangents.CalculateMikk;
            mi.SaveAndReimport();
        }

        /// <summary>与 <see cref="ArtPrefabBuilder.BuildMaterial"/> 同一套属性：底色 / 法线 + 角色类风格参数</summary>
        static Material BuildMaterial(string folder, string id, Texture2D baseColor, Texture2D normal)
        {
            var path = $"{folder}/{id}.mat";
            var shader = Shader.Find(ArtPrefabBuilder.ShaderName) ?? Shader.Find("Universal Render Pipeline/Lit");
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (!mat)
            {
                mat = new Material(shader) { name = id };
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = shader;
            mat.shaderKeywords = new string[0];
            mat.SetTexture("_BaseMap", baseColor);
            mat.SetColor("_BaseColor", Color.white);
            if (mat.HasProperty("_Tint")) mat.SetColor("_Tint", Color.white);
            mat.SetTexture("_BumpMap", normal);
            if (mat.HasProperty("_BumpScale")) mat.SetFloat("_BumpScale", 1f);
            if (normal) mat.EnableKeyword("_NORMALMAP");
            if (mat.HasProperty("_ORMMap")) mat.SetTexture("_ORMMap", null);
            mat.SetFloat("_Metallic", 0f);
            if (mat.HasProperty("_Roughness")) mat.SetFloat("_Roughness", 0.85f);
            if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 0.15f);
            if (mat.HasProperty("_OcclusionStrength")) mat.SetFloat("_OcclusionStrength", 0f);
            if (mat.HasProperty("_EmissionColor")) mat.SetColor("_EmissionColor", Color.black);
            mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.EmissiveIsBlack;
            if (mat.HasProperty("_RampThreshold"))
            {
                var p = ArtPrefabBuilder.StylePreset.For("characters");
                mat.SetColor("_ShadowTint", p.shadowTint);
                mat.SetFloat("_RampThreshold", p.rampThreshold);
                mat.SetFloat("_RampSoftness", p.rampSoftness);
                mat.SetFloat("_ShadowLift", p.shadowLift);
                mat.SetFloat("_AmbientStrength", p.ambient);
                mat.SetFloat("_SpecStrength", p.spec);
                mat.SetFloat("_SpecSize", p.specSize);
                mat.SetColor("_RimColor", p.rimColor);
                mat.SetFloat("_RimPower", p.rimPower);
                mat.SetFloat("_RimStrength", p.rimStrength);
                mat.SetFloat("_FlashAmount", 0f);
            }
            if (mat.HasProperty("_Cull")) mat.SetFloat("_Cull", (float)CullMode.Back);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        static bool BuildPrefab(string id, string fbxPath, Material mat)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(fbxPath);
            if (!model)
            {
                Debug.LogWarning($"[pets] {id}：FBX 没能载入 {fbxPath}");
                return false;
            }
            EnsureFolder(PrefabDir);
            var mesh = (GameObject)PrefabUtility.InstantiatePrefab(model);
            PrefabUtility.UnpackPrefabInstance(mesh, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
            // 模型根节点上带着 FBX 的轴向换算和导出时的 180° 转身，不能清零：外面再包一层干净的根
            var inst = new GameObject(id);
            mesh.transform.SetParent(inst.transform, false);
            foreach (var c in inst.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(c);
            foreach (var a in inst.GetComponentsInChildren<Animator>(true)) Object.DestroyImmediate(a);
            var bounds = new Bounds();
            bool first = true;
            foreach (var r in inst.GetComponentsInChildren<Renderer>(true))
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++) mats[i] = mat;
                r.sharedMaterials = mats.Length > 0 ? mats : new[] { mat };
                r.shadowCastingMode = ShadowCastingMode.On;
                if (first) { bounds = r.bounds; first = false; }
                else bounds.Encapsulate(r.bounds);
            }
            // 约定：脚底在 y = 0、朝 +Z、真实尺寸（导出脚本保证）；偏差大时提醒
            if (!first && Mathf.Abs(bounds.min.y) > 0.05f)
                Debug.LogWarning($"[pets] {id}：脚底不在原点（min.y = {bounds.min.y:F2}），检查 bl_pet_export.py 的落地");
            var info = inst.AddComponent<ArtAssetInfo>();
            info.assetId = id;
            info.assetClass = "pet";
            info.category = "pets";
            info.rigType = "none";
            info.bindSource = "pet";
            info.designBounds = bounds;
            var path = $"{PrefabDir}/{id}.prefab";
            PrefabUtility.SaveAsPrefabAsset(inst, path);
            Object.DestroyImmediate(inst);
            Debug.Log($"[pets] {id} → {path}（高 {bounds.size.y:F2} m，长 {bounds.size.z:F2} m）");
            return true;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path)!.Replace('\\', '/');
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }
    }
}
