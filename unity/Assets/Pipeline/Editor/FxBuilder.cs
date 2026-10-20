using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 特效资产生成器（docs/unity-parity.md F1 / F2）：按代码里的定义生成全部特效资产，重跑结果一致（贴图逐字节相同、材质 / 预制体原地覆盖，GUID 不变）。
    ///   1. 程序贴图 → Assets/Art/Fx/T_FxAtlas.png（粒子贴图集 4×2）、T_Fx_Glow / BeamFade / Band / Line.png（<see cref="FxTextures"/>）
    ///   2. 材质 → Assets/Game/Resources/Fx/Materials/M_Fx_*.mat（<see cref="FxMaterials.Setup"/>，运行时从 Resources 取，不再 Shader.Find）
    ///   3. 粒子风格预制体 → Assets/Game/Resources/Fx/Presets/&lt;Id&gt;.prefab（Registry&lt;FxPreset&gt; 里带 Particle 的每一条，<see cref="FxSetup.Configure"/>）；
    ///      已经没有对应预设的旧预制体删掉
    ///   4. 着色器变体集 → Assets/Game/Resources/Fx/FxShaderVariants.shadervariants（上面材质的变体 × 雾 / SSAO 组合，运行时 WarmUp）
    /// 入口：菜单 Spiritfire/Fx/Build Fx Assets；bridge.sh fx；-batchmode -executeMethod Spiritfire.Art.Editor.FxBuilder.BatchBuild。
    /// 返回错误数（找不到着色器等），错误写 Console（[FxBuilder] 开头）。
    /// </summary>
    public static class FxBuilder
    {
        public const string TextureDir = "Assets/Art/Fx";
        public const string ResourcesDir = "Assets/Game/Resources/Fx";
        public const string MaterialDir = ResourcesDir + "/Materials";
        public const string PresetDir = ResourcesDir + "/Presets";
        public const string VariantsPath = ResourcesDir + "/FxShaderVariants.shadervariants";

        [MenuItem("Spiritfire/Fx/Build Fx Assets", priority = 100)]
        static void Menu()
        {
            int errors = BuildAll();
            EditorUtility.DisplayDialog("FxBuilder", errors == 0 ? "特效资产已生成（详情见 Console）" : $"生成完成，但有 {errors} 个错误（见 Console）", "好");
        }

        public static void BatchBuild()
        {
            int errors = BuildAll();
            EditorApplication.Exit(errors > 0 ? 1 : 0);
        }

        /// <summary>生成全部特效资产；返回错误数</summary>
        public static int BuildAll()
        {
            int errors = 0;
            var log = new List<string>();
            Folder(TextureDir);
            Folder(MaterialDir);
            Folder(PresetDir);

            var textures = BuildTextures(log);
            var materials = BuildMaterials(textures, log, ref errors);
            BuildPresetPrefabs(materials, log, ref errors);
            AssetDatabase.SaveAssets();
            BuildVariants(materials.Values, log);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            foreach (var l in log) Debug.Log("[FxBuilder] " + l);
            Debug.Log(errors == 0 ? "[FxBuilder] 完成" : $"[FxBuilder] 完成，有 {errors} 个错误");
            return errors;
        }

        static void Folder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string parent = Path.GetDirectoryName(path)!.Replace('\\', '/');
            Folder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }

        // ───────────── 1. 贴图 ─────────────

        static Dictionary<string, Texture2D> BuildTextures(List<string> log)
        {
            var result = new Dictionary<string, Texture2D>();
            int written = 0;
            foreach (var name in FxTextures.All)
            {
                var tex = FxTextures.Create(name);
                byte[] png = tex.EncodeToPNG();
                bool atlas = name == FxTextures.Atlas;
                UnityEngine.Object.DestroyImmediate(tex);
                string path = $"{TextureDir}/{name}.png";
                // 内容没变就不写（不碰时间戳，不触发重新导入）
                if (!File.Exists(path) || !File.ReadAllBytes(path).SequenceEqual(png))
                {
                    File.WriteAllBytes(path, png);
                    written++;
                    AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                }
                if (AssetImporter.GetAtPath(path) is TextureImporter ti && ConfigureImporter(ti, atlas)) ti.SaveAndReimport();
                result[name] = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            }
            log.Add($"贴图 {FxTextures.All.Length} 张（改写 {written} 张）→ {TextureDir}");
            return result;
        }

        /// <summary>导入设置：线性（RGB 存亮度、A 存形状）、带 mip、夹边、压缩；返回是否有改动</summary>
        static bool ConfigureImporter(TextureImporter ti, bool atlas)
        {
            bool changed = false;
            void Set<T>(T current, T want, Action<T> apply)
            {
                if (EqualityComparer<T>.Default.Equals(current, want)) return;
                apply(want);
                changed = true;
            }
            Set(ti.textureType, TextureImporterType.Default, v => ti.textureType = v);
            Set(ti.sRGBTexture, false, v => ti.sRGBTexture = v);
            Set(ti.alphaSource, TextureImporterAlphaSource.FromInput, v => ti.alphaSource = v);
            Set(ti.alphaIsTransparency, true, v => ti.alphaIsTransparency = v);
            Set(ti.mipmapEnabled, true, v => ti.mipmapEnabled = v);
            Set(ti.wrapMode, TextureWrapMode.Clamp, v => ti.wrapMode = v);
            Set(ti.filterMode, atlas ? FilterMode.Trilinear : FilterMode.Bilinear, v => ti.filterMode = v);
            Set(ti.maxTextureSize, 1024, v => ti.maxTextureSize = v);
            Set(ti.textureCompression, TextureImporterCompression.Compressed, v => ti.textureCompression = v);
            Set(ti.npotScale, TextureImporterNPOTScale.None, v => ti.npotScale = v);
            Set(ti.isReadable, false, v => ti.isReadable = v);
            return changed;
        }

        // ───────────── 2. 材质 ─────────────

        static Dictionary<FxMaterialKind, Material> BuildMaterials(Dictionary<string, Texture2D> textures, List<string> log, ref int errors)
        {
            var result = new Dictionary<FxMaterialKind, Material>();
            foreach (FxMaterialKind kind in Enum.GetValues(typeof(FxMaterialKind)))
            {
                var shader = Shader.Find(FxMaterials.ShaderName(kind));
                if (!shader)
                {
                    Debug.LogError($"[FxBuilder] 找不到着色器 {FxMaterials.ShaderName(kind)}（{kind}）");
                    errors++;
                    continue;
                }
                string tn = FxMaterials.TextureName(kind);
                Texture2D tex = null;
                if (tn != null && (!textures.TryGetValue(tn, out tex) || !tex))
                {
                    Debug.LogError($"[FxBuilder] 贴图 {tn} 没有生成（{kind}）");
                    errors++;
                }
                result[kind] = SaveMaterial($"{MaterialDir}/{FxMaterials.AssetName(kind)}.mat", shader, m => FxMaterials.Setup(m, kind, tex));
            }
            log.Add($"材质 {result.Count} 个 → {MaterialDir}");
            return result;
        }

        /// <summary>建 / 更新一个材质资产（已存在就原地改，GUID 不变）</summary>
        internal static Material SaveMaterial(string path, Shader shader, Action<Material> setup)
        {
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            bool fresh = !m;
            if (fresh) m = new Material(shader);
            else if (m.shader != shader) m.shader = shader;
            setup(m);
            m.enableInstancing = false;
            if (fresh) AssetDatabase.CreateAsset(m, path);
            else EditorUtility.SetDirty(m);
            return m;
        }

        // ───────────── 3. 粒子风格预制体 ─────────────

        static void BuildPresetPrefabs(Dictionary<FxMaterialKind, Material> materials, List<string> log, ref int errors)
        {
            materials.TryGetValue(FxMaterialKind.ParticleAdd, out var add);
            materials.TryGetValue(FxMaterialKind.ParticleAlpha, out var alpha);
            var keep = new HashSet<string>();
            int n = 0;
            foreach (var p in Registry<FxPreset>.All)
            {
                if (p.Particle == null) continue;
                var mat = p.Particle.blend == FxBlend.Additive ? add : alpha;
                if (!mat)
                {
                    Debug.LogError($"[FxBuilder] {p.Id}：粒子材质没有生成");
                    errors++;
                    continue;
                }
                string path = $"{PresetDir}/{p.Id}.prefab";
                var go = new GameObject(p.Id);
                try
                {
                    var ps = go.AddComponent<ParticleSystem>();
                    FxSetup.Configure(ps, p.Particle, mat);
                    PrefabUtility.SaveAsPrefabAsset(go, path, out bool ok);
                    if (!ok)
                    {
                        Debug.LogError($"[FxBuilder] 保存预制体失败：{path}");
                        errors++;
                    }
                    else n++;
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(go);
                }
                keep.Add(path);
            }
            // 预设删掉了，对应的旧预制体也删掉
            foreach (var guid in AssetDatabase.FindAssets("t:Prefab", new[] { PresetDir }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (keep.Contains(path)) continue;
                AssetDatabase.DeleteAsset(path);
                log.Add($"删除过期的风格预制体 {path}");
            }
            log.Add($"粒子风格预制体 {n} 个 → {PresetDir}");
        }

        // ───────────── 4. 着色器变体集 ─────────────

        /// <summary>雾和 SSAO 是全局 multi_compile 关键字：运行时开哪个取决于场景，所以每种组合都收进去</summary>
        static readonly string[][] GlobalCombos =
        {
            Array.Empty<string>(),
            new[] { "FOG_LINEAR" }, new[] { "FOG_EXP" }, new[] { "FOG_EXP2" },
            new[] { "_SCREEN_SPACE_OCCLUSION" },
            new[] { "FOG_LINEAR", "_SCREEN_SPACE_OCCLUSION" }, new[] { "FOG_EXP2", "_SCREEN_SPACE_OCCLUSION" },
        };

        static void BuildVariants(IEnumerable<Material> materials, List<string> log)
        {
            var svc = AssetDatabase.LoadAssetAtPath<ShaderVariantCollection>(VariantsPath);
            bool fresh = !svc;
            if (fresh) svc = new ShaderVariantCollection();
            else svc.Clear();
            int n = 0;
            foreach (var m in materials.Concat(ExtraVariantMaterials()))
            {
                if (!m || !m.shader) continue;
                var local = m.shaderKeywords;
                foreach (var pass in PassTypes(m))
                foreach (var combo in GlobalCombos)
                {
                    try
                    {
                        if (svc.Add(new ShaderVariantCollection.ShaderVariant(m.shader, pass, local.Concat(combo).ToArray()))) n++;
                    }
                    catch (ArgumentException)
                    {
                        // 这个着色器没有这组关键字（例如没有雾变体）：跳过
                    }
                }
            }
            if (fresh) AssetDatabase.CreateAsset(svc, VariantsPath);
            else EditorUtility.SetDirty(svc);
            log.Add($"着色器变体 {n} 个 → {VariantsPath}");
        }

        /// <summary>材质主通道的 PassType：URP 的 Unlit / Particles 主通道没有 LightMode 标签（SRPDefaultUnlit），贴花通道有</summary>
        static IEnumerable<PassType> PassTypes(Material m)
        {
            bool tagged = false;
            var lightMode = new ShaderTagId("LightMode");
            for (int i = 0; i < m.shader.passCount; i++)
            {
                string mode = m.shader.FindPassTagValue(i, lightMode).name;
                // 只看会真正画出来的通道（DepthOnly / Picking 之类的辅助通道不预热）
                if (mode is "DecalScreenSpaceProjector" or "DecalProjectorForwardEmissive" or "UniversalForward" or "UniversalForwardOnly") tagged = true;
            }
            yield return PassType.ScriptableRenderPipelineDefaultUnlit;
            if (tagged) yield return PassType.ScriptableRenderPipeline;
        }

        /// <summary>F2 起贴花材质等也收进变体集</summary>
        static IEnumerable<Material> ExtraVariantMaterials()
        {
            yield break;
        }
    }
}
