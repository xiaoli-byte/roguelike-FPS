using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// Assets/Art 下模型与贴图的导入规则（每次导入都按 sidecar 重新套用，编辑器里改的导入设置会被覆盖）：
    /// - 模型：1 单位 = 1 米、烘焙轴向转换（朝 +Z、Y 上）、不导入材质与动画、导入法线与切线；
    ///   人形资产按 sidecar 的骨骼映射建 Humanoid Avatar（Blender 导出时已摆成 T-pose），其他骨骼资产建 Generic Avatar。
    /// - 贴图：按后缀区分色彩空间——_BC / _E 为 sRGB，_N 为法线，_ORM 为线性。
    /// - Mixamo 动画（Assets/Art/Animations/Mixamo）交给 <see cref="MixamoLibrary"/>。
    /// </summary>
    public sealed class ArtImportPostprocessor : AssetPostprocessor
    {
        public const int Version = 5;
        public override uint GetVersion() => Version;

        // 灵宠模型（Assets/Art/Pets）不走 sidecar，导入设置由 PetArtImport 管
        static bool InArt(string path) => path.StartsWith(ArtSidecar.ArtRoot + "/") && !path.StartsWith(PetArtImport.Root + "/");

        void OnPreprocessTexture()
        {
            if (!InArt(assetPath) || !assetPath.Contains("/Textures/")) return;
            var ti = (TextureImporter)assetImporter;
            string n = Path.GetFileNameWithoutExtension(assetPath);
            ti.mipmapEnabled = true;
            ti.streamingMipmaps = true;
            ti.anisoLevel = 4;
            ti.maxTextureSize = 2048;
            ti.textureCompression = TextureImporterCompression.CompressedHQ;
            ti.alphaSource = TextureImporterAlphaSource.None;
            if (n.EndsWith("_N"))
            {
                ti.textureType = TextureImporterType.NormalMap;
            }
            else
            {
                ti.textureType = TextureImporterType.Default;
                ti.sRGBTexture = !n.EndsWith("_ORM");
            }
            // 有 Alpha 遮罩的材质（alphaMode = MASK）需要 BC 的 Alpha
            if (n.EndsWith("_BC") && NeedsAlpha(assetPath)) ti.alphaSource = TextureImporterAlphaSource.FromInput;
        }

        static bool NeedsAlpha(string texPath)
        {
            string assetDir = Path.GetDirectoryName(Path.GetDirectoryName(texPath))!;
            var sc = ArtSidecar.Load(Path.Combine(assetDir, Path.GetFileName(assetDir) + ArtSidecar.Suffix));
            return sc != null && sc.Materials.Any(m => (string)m["alphaMode"] != "OPAQUE");
        }

        void OnPreprocessModel()
        {
            if (!InArt(assetPath)) return;
            var mi = (ModelImporter)assetImporter;
            if (assetPath.StartsWith(MixamoLibrary.Folder + "/"))
            {
                MixamoLibrary.Preprocess(mi);
                return;
            }
            var sc = ArtSidecar.ForModel(assetPath);
            if (sc == null)
            {
                Debug.LogWarning($"[Art] {assetPath} 没有对应的 {ArtSidecar.Suffix}，按 Unity 默认设置导入");
                return;
            }

            mi.globalScale = 1f;
            mi.useFileScale = true;
            mi.bakeAxisConversion = true;
            mi.materialImportMode = ModelImporterMaterialImportMode.None;
            mi.importAnimation = false;
            mi.importCameras = false;
            mi.importLights = false;
            mi.importVisibility = false;
            mi.importBlendShapes = false;
            mi.importConstraints = false;
            mi.isReadable = false;
            mi.meshCompression = ModelImporterMeshCompression.Off;
            mi.optimizeMeshPolygons = true;
            mi.optimizeMeshVertices = true;
            mi.importNormals = ModelImporterNormals.Import;
            mi.importTangents = ModelImporterTangents.Import;
            mi.sortHierarchyByName = false;
            mi.generateSecondaryUV = false;

            switch (sc.EffectiveRigType)
            {
                case "humanoid":
                    mi.animationType = ModelImporterAnimationType.Human;
                    mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                    mi.optimizeGameObjects = false;
                    mi.humanDescription = BuildHumanDescription(sc, mi.humanDescription);
                    break;
                case "generic":
                    mi.animationType = ModelImporterAnimationType.Generic;
                    mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                    mi.optimizeGameObjects = false;
                    break;
                default:
                    mi.animationType = ModelImporterAnimationType.None;
                    // 2026-10-25 起只有一级 LOD：静态件的 FBX 只剩一个顶层网格，不保留层级时 Unity 把它并进模型根节点，
                    // <ID>_LOD0 这个渲染器名字就没了（sidecar 对不上材质、QA 报缺网格）
                    mi.preserveHierarchy = true;
                    break;
            }
        }

        /// <summary>有 fur 配置的角色：把毛向与毛发遮罩烘进蒙皮网格的 UV2 / UV3（<see cref="FurBake"/>）</summary>
        void OnPostprocessModel(GameObject g)
        {
            if (!InArt(assetPath) || assetPath.StartsWith(MixamoLibrary.Folder + "/")) return;
            var sc = ArtSidecar.ForModel(assetPath);
            var fur = FurSettings.From(sc);
            if (fur != null) FurBake.Apply(g, fur, sc.Id, context);
        }

        void OnPreprocessAnimation()
        {
            if (assetPath.StartsWith(MixamoLibrary.Folder + "/")) MixamoLibrary.PreprocessClips((ModelImporter)assetImporter);
        }

        static HumanDescription BuildHumanDescription(ArtSidecar sc, HumanDescription hd)
        {
            var valid = HumanTrait.BoneName.ToHashSet();
            var map = sc.HumanMap;
            foreach (var bad in map.Keys.Where(k => !valid.Contains(k)))
                Debug.LogError($"[Art] {sc.Id}: 人形骨骼名 {bad} 不是 Unity 的 HumanTrait.BoneName");
            hd.human = map.Where(kv => valid.Contains(kv.Key))
                .Select(kv => new HumanBone { humanName = kv.Key, boneName = kv.Value, limit = new HumanLimit { useDefaultValues = true } })
                .ToArray();
            hd.upperArmTwist = 0.5f;
            hd.lowerArmTwist = 0.5f;
            hd.upperLegTwist = 0.5f;
            hd.lowerLegTwist = 0.5f;
            hd.armStretch = 0.05f;
            hd.legStretch = 0.05f;
            hd.feetSpacing = 0f;
            hd.hasTranslationDoF = false;
            return hd;
        }
    }
}
