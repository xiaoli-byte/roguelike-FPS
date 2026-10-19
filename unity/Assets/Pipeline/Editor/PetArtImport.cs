using System.Collections.Generic;
using System.IO;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 灵宠预制体 Assets/Game/Resources/Pets/&lt;ID&gt;.prefab（运行时 Resources.Load("Pets/&lt;ID&gt;")，docs/pet-system.md 第 7 节），两条来源：
    ///
    /// 第二版（优先）：灵宠和敌人走同一条正式管线，Sync 生成角色预制体 Assets/Art/Prefabs/Characters/&lt;ID&gt;.prefab
    ///   （Animator + AC_&lt;ID&gt;、CreatureRig、CreatureLocomotion、布娃娃、胶囊）。这里只建一个干净的根节点，下面挂它的**嵌套预制体实例**
    ///   （不解包、不加任何覆盖）：控制器每次 Sync 都会删掉重建（新 GUID），嵌套实例跟着角色预制体走，RelinkControllers 修好的引用直接生效，
    ///   以后再 Sync 不用重跑这里（只有新出现一只灵宠时要跑：Sync 末尾会自动调 <see cref="SyncRigged"/>）。
    ///   布娃娃 / 碰撞体不在预制体里删（嵌套实例上的「删组件」覆盖按文件内 ID 记，角色预制体重建后可能对不上），由 PetVisuals.Strip 在运行时按依赖顺序删掉。
    ///
    /// 第一版（回退，没有角色预制体的灵宠）：Assets/Art/Pets/&lt;ID&gt;/ 下放 &lt;ID&gt;.fbx 与 Textures/&lt;ID&gt;_BaseColor.png（可选 _Normal.png），
    ///   由 art/pipeline/blender/bl_pet_export.py 导出（静态网格、脚底在原点、朝 +Z、真实尺寸）：
    ///   贴图导入（底色 sRGB、法线按法线贴图）→ 模型导入（不要动画 / 相机 / 灯光 / 材质）→ 材质 &lt;ID&gt;.mat（Spiritfire/StylizedLit，角色风格参数）
    ///   → 预制体（模型 + 材质，无碰撞体）。
    /// 发光件（精卫的火石、应龙的宝珠，PetDef.partId）：单独建模的挂件，Sync 生成 Assets/Art/Prefabs/Attachments/&lt;ID&gt;.prefab；
    ///   这里同样包一层嵌套实例 → Resources/Pets/Parts/&lt;ID&gt;.prefab，运行时 PetVisuals 挂到骨骼挂点上。没有就静默跳过。
    /// 幂等：设置没变就不重新导入，材质与预制体每次覆盖。菜单 Spiritfire/Pets/Import Pet Models，或 Bridge 命令 pets。
    /// </summary>
    public static class PetArtImport
    {
        public const string Root = "Assets/Art/Pets";
        public const string PrefabDir = "Assets/Game/Resources/Pets";
        public const string CharacterDir = "Assets/Art/Prefabs/Characters";
        public const string AttachmentDir = "Assets/Art/Prefabs/Attachments";
        public const string PartDir = PrefabDir + "/Parts";

        static string CharacterPrefab(string id) => $"{CharacterDir}/{id}.prefab";
        static string AttachmentPrefab(string id) => $"{AttachmentDir}/{id}.prefab";

        /// <summary>发光件 ID：PetLibrary 里的 partId + 挂件目录里的 SM_PetPart_*</summary>
        static SortedSet<string> PartIds()
        {
            var ids = new SortedSet<string>();
            foreach (var d in PetLibrary.All)
                if (!string.IsNullOrEmpty(d.partId)) ids.Add(d.partId);
            if (AssetDatabase.IsValidFolder(AttachmentDir))
                foreach (var f in Directory.GetFiles(AttachmentDir, "SM_PetPart_*.prefab")) ids.Add(Path.GetFileNameWithoutExtension(f));
            return ids;
        }

        /// <summary>发光件嵌套预制体；挂件预制体还没有的静默跳过。返回生成数</summary>
        static int BuildParts()
        {
            int built = 0;
            foreach (var id in PartIds())
                if (File.Exists(AttachmentPrefab(id)) && BuildNested(id, AttachmentPrefab(id), PartDir)) built++;
            return built;
        }

        [MenuItem("Spiritfire/Pets/Import Pet Models")]
        static void Menu()
        {
            int errors = ImportAll();
            Debug.Log(errors == 0 ? "[pets] 灵宠模型导入完成" : $"[pets] 灵宠模型导入完成，{errors} 个问题（见上面的日志）");
        }

        /// <summary>灵宠 ID：PetLibrary 的八只 + 角色目录里的 SK_Pet_* + Assets/Art/Pets 下的目录</summary>
        static SortedSet<string> AllIds()
        {
            var ids = new SortedSet<string>();
            foreach (var d in PetLibrary.All) ids.Add(d.assetId);
            if (AssetDatabase.IsValidFolder(CharacterDir))
                foreach (var f in Directory.GetFiles(CharacterDir, "SK_Pet_*.prefab")) ids.Add(Path.GetFileNameWithoutExtension(f));
            if (AssetDatabase.IsValidFolder(Root))
                foreach (var dir in Directory.GetDirectories(Root)) ids.Add(Path.GetFileName(dir));
            return ids;
        }

        /// <summary>
        /// ArtSync 末尾调用：有角色预制体的灵宠、有挂件预制体的发光件重建嵌套预制体（新出现的因此不用再手动跑 pets）；不碰第一版静态模型。
        /// 问题只记警告，不计入 Sync 的错误数。返回生成数
        /// </summary>
        public static int SyncRigged()
        {
            int built = 0;
            foreach (var id in AllIds())
                if (File.Exists(CharacterPrefab(id)) && BuildRigged(id)) built++;
            int parts = BuildParts();
            if (built + parts > 0)
            {
                AssetDatabase.SaveAssets();
                Debug.Log($"[pets] 骨骼动画灵宠 {built} 只、发光件 {parts} 个 → {PrefabDir}");
            }
            return built;
        }

        /// <summary>导入全部灵宠模型；返回问题数</summary>
        public static int ImportAll()
        {
            int errors = 0, built = 0, rigged = 0;
            foreach (var id in AllIds())
            {
                // 第二版：角色预制体（骨骼 + 动作）
                if (File.Exists(CharacterPrefab(id)))
                {
                    if (BuildRigged(id)) rigged++;
                    else errors++;
                    continue;
                }
                var folder = $"{Root}/{id}";
                if (!AssetDatabase.IsValidFolder(folder))
                {
                    Debug.Log($"[pets] {id}：没有角色预制体也没有静态模型，跳过（游戏里用程序化占位体）");
                    continue;
                }
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
            int parts = BuildParts();
            AssetDatabase.SaveAssets();
            Debug.Log($"[pets] 生成 {rigged + built} 个灵宠预制体（骨骼动画 {rigged}、静态网格 {built}）、发光件 {parts} 个 → {PrefabDir}");
            return errors;
        }

        /// <summary>
        /// 第二版：干净的根节点（单位变换、无组件）+ 角色预制体的嵌套实例（不解包、无覆盖）。
        /// 角色预制体还没接上控制器时照样生成（嵌套实例以后自动跟上），只提醒先跑 Sync
        /// </summary>
        static bool BuildRigged(string id)
        {
            var path = CharacterPrefab(id);
            var src = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (!src)
            {
                Debug.LogWarning($"[pets] {id}：角色预制体没能载入 {path}");
                return false;
            }
            var anim = src.GetComponentInChildren<Animator>(true);
            if (!anim || !anim.runtimeAnimatorController)
                Debug.LogWarning($"[pets] {id}：角色预制体的 Animator 没有控制器（native-anim.json 还没烘焙，或要先跑 sync）；游戏里会当静态模型处理");
            if (!BuildNested(id, path, PrefabDir)) return false;
            Debug.Log($"[pets] {id} → {PrefabDir}/{id}.prefab（{(anim && anim.runtimeAnimatorController ? $"控制器 {anim.runtimeAnimatorController.name}" : "无控制器")}）");
            return true;
        }

        /// <summary>outDir/&lt;id&gt;.prefab = 干净的根节点（单位变换、无组件）+ srcPath 的嵌套实例（不解包、无覆盖）</summary>
        static bool BuildNested(string id, string srcPath, string outDir)
        {
            var src = AssetDatabase.LoadAssetAtPath<GameObject>(srcPath);
            if (!src)
            {
                Debug.LogWarning($"[pets] {id}：没能载入 {srcPath}");
                return false;
            }
            EnsureFolder(outDir);
            var root = new GameObject(id);
            try
            {
                var inst = (GameObject)PrefabUtility.InstantiatePrefab(src, root.transform);
                if (!inst)
                {
                    Debug.LogWarning($"[pets] {id}：实例化 {srcPath} 失败");
                    return false;
                }
                var outPath = $"{outDir}/{id}.prefab";
                var saved = PrefabUtility.SaveAsPrefabAsset(root, outPath, out bool ok);
                if (!ok || !saved)
                {
                    Debug.LogWarning($"[pets] {id}：保存 {outPath} 失败");
                    return false;
                }
                return true;
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
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
