using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 特效资产生成器（docs/unity-parity.md F1 / F2）：按代码里的定义生成全部特效资产，重跑结果一致（贴图逐字节相同、材质 / 预制体原地覆盖，GUID 不变）。
    ///   1. 程序贴图 → Assets/Art/Fx/T_FxAtlas.png（粒子贴图集 4×4）、T_Fx_Glow / BeamFade / Band / Line.png、
    ///      T_Fx_DecalAtlas.png（FX1 弹孔 / 焦痕 / 溅痕贴花图集 4×2）、T_Fx_Muzzle.png（第一人称枪口火焰）（<see cref="FxTextures"/>）
    ///   2. 材质 → Assets/Game/Resources/Fx/Materials/M_Fx_*.mat（<see cref="FxMaterials.Setup"/>，运行时从 Resources 取，不再 Shader.Find）；
    ///      含 FX1 / FX2 的贴花材质 M_Fx_Decal*（Assets/Art/Shaders/SF_FxDecal.shader，开 GPU Instancing：每个投影器的参数走 _NormalToWorld）
    ///   3. 粒子风格预制体 → Assets/Game/Resources/Fx/Presets/&lt;Id&gt;.prefab（Registry&lt;FxPreset&gt; 里带 Particle 的每一条，<see cref="FxSetup.Configure"/>）；
    ///      已经没有对应预设的旧预制体删掉
    ///   4. 预警贴花材质 → M_Fx_Telegraph.mat（Assets/Art/Shaders/SF_Telegraph.shader，F2）
    ///   5. URP 贴花渲染特性 → Assets/Settings 下每个 UniversalRendererData（PC / Mobile）各加一个 DecalRendererFeature（Screen Space 技术），
    ///      已有就只校正设置；和编辑器里点「Add Renderer Feature」一样登记进 m_RendererFeatures / m_RendererFeatureMap
    ///   6. 着色器变体集 → Assets/Game/Resources/Fx/FxShaderVariants.shadervariants（上面材质的变体 × 雾 / SSAO 组合，运行时 WarmUp）
    ///   7. FX3 / FX4 角色遮罩的导入设置 → Resources/Fx/GlowMasks（emission_mask.py 生成的 _E）、Resources/Fx/RegionMasks（RegionMaskPostprocessor 烘的分区）：
    ///      线性、带 mip、不压成低质量格式（遮罩是数据不是颜色）
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
        public const string TelegraphMaterialPath = MaterialDir + "/M_Fx_Telegraph.mat";
        public const string SettingsDir = "Assets/Settings";

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
            var telegraph = BuildTelegraphMaterial(log, ref errors);
            EnsureDecalFeatures(log, ref errors);
            ConfigureMaskTextures(log);
            AssetDatabase.SaveAssets();
            BuildVariants(telegraph ? materials.Values.Append(telegraph) : materials.Values, log);
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
                bool atlas = name == FxTextures.Atlas || name == FxTextures.DecalAtlas;
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
            // 粒子图集 FX3 起是 1024 × 2048：上限 1024 会被压成一半
            Set(ti.maxTextureSize, atlas ? 2048 : 1024, v => ti.maxTextureSize = v);
            Set(ti.textureCompression, TextureImporterCompression.Compressed, v => ti.textureCompression = v);
            Set(ti.npotScale, TextureImporterNPOTScale.None, v => ti.npotScale = v);
            Set(ti.isReadable, false, v => ti.isReadable = v);
            return changed;
        }

        /// <summary>角色遮罩贴图（_E 发光遮罩、分区遮罩）的导入设置：线性、mip、高质量压缩、重复寻址；返回改了几张</summary>
        public static int ConfigureMaskTextures(List<string> log = null)
        {
            int n = 0, changed = 0;
            foreach (var dir in new[] { ResourcesDir + "/GlowMasks", ResourcesDir + "/RegionMasks" })
            {
                if (!AssetDatabase.IsValidFolder(dir)) continue;
                foreach (var guid in AssetDatabase.FindAssets("t:Texture2D", new[] { dir }))
                {
                    string path = AssetDatabase.GUIDToAssetPath(guid);
                    if (AssetImporter.GetAtPath(path) is not TextureImporter ti) continue;
                    n++;
                    bool dirty = ti.sRGBTexture || !ti.mipmapEnabled || ti.textureCompression != TextureImporterCompression.CompressedHQ
                                 || ti.alphaSource != TextureImporterAlphaSource.None || ti.maxTextureSize != 1024 || ti.isReadable;
                    if (!dirty) continue;
                    ti.textureType = TextureImporterType.Default;
                    ti.sRGBTexture = false;
                    ti.mipmapEnabled = true;
                    ti.alphaSource = TextureImporterAlphaSource.None;
                    ti.textureCompression = TextureImporterCompression.CompressedHQ;
                    ti.maxTextureSize = 1024;
                    ti.wrapMode = TextureWrapMode.Repeat;
                    ti.filterMode = FilterMode.Bilinear;
                    ti.isReadable = false;
                    ti.SaveAndReimport();
                    changed++;
                }
            }
            log?.Add($"角色遮罩贴图 {n} 张（改导入设置 {changed} 张）→ {ResourcesDir}/GlowMasks、RegionMasks");
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
                var mat = SaveMaterial($"{MaterialDir}/{FxMaterials.AssetName(kind)}.mat", shader, m => FxMaterials.Setup(m, kind, tex));
                // 贴花：同一种贴花共用一份材质，靠 GPU Instancing 合批（SaveMaterial 默认关掉了）
                if (FxMaterials.IsDecal(kind) && !mat.enableInstancing)
                {
                    mat.enableInstancing = true;
                    EditorUtility.SetDirty(mat);
                }
                result[kind] = mat;
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

        /// <summary>其它单元的特效材质以后也收进来（FX2 的熔池贴花等）</summary>
        static IEnumerable<Material> ExtraVariantMaterials()
        {
            yield break;
        }

        // ───────────── F2：预警贴花材质 ─────────────

        static Material BuildTelegraphMaterial(List<string> log, ref int errors)
        {
            var shader = Shader.Find(Telegraph.ShaderName);
            if (!shader)
            {
                Debug.LogError($"[FxBuilder] 找不到着色器 {Telegraph.ShaderName}（Assets/Art/Shaders/SF_Telegraph.shader 编译失败？）");
                errors++;
                return null;
            }
            if (!shader.isSupported) Debug.LogWarning($"[FxBuilder] {Telegraph.ShaderName} 在当前图形 API 上不受支持（看 Console 里的着色器报错）");
            var m = SaveMaterial(TelegraphMaterialPath, shader, mat =>
            {
                mat.SetColor("_Color", new Color(1f, 0.19f, 0.19f, 1f));
                mat.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                mat.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                mat.SetFloat("_DrawOrder", 0);
                // 贴花通道按不透明队列过滤：2000 + 绘制顺序
                mat.renderQueue = 2010;
            });
            log.Add($"预警贴花材质 → {TelegraphMaterialPath}");
            return m;
        }

        // ───────────── F2：URP 贴花渲染特性 ─────────────

        /// <summary>
        /// 给 Assets/Settings 下每个 UniversalRendererData 加上 DecalRendererFeature（已有就只校正设置）。
        /// Screen Space 技术：在不透明物体之后按深度图投射，不需要 DBuffer 预通道，Forward / Forward+ / 移动端都能用；
        /// 不开贴花图层（不需要渲染图层贴图），最远绘制 250 m。
        /// </summary>
        static void EnsureDecalFeatures(List<string> log, ref int errors)
        {
            int added = 0, total = 0;
            foreach (var guid in AssetDatabase.FindAssets("t:UniversalRendererData", new[] { SettingsDir }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var data = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(path);
                if (!data) continue;
                total++;
                var feature = data.rendererFeatures.OfType<DecalRendererFeature>().FirstOrDefault();
                if (!feature)
                {
                    feature = ScriptableObject.CreateInstance<DecalRendererFeature>();
                    feature.name = "Decal";
                    AssetDatabase.AddObjectToAsset(feature, data);
                    AssetDatabase.TryGetGUIDAndLocalFileIdentifier(feature, out _, out long localId);
                    // 同 URP ScriptableRendererDataEditor.AddComponent：特性列表与本地 id 映射一起加
                    var so = new SerializedObject(data);
                    var list = so.FindProperty("m_RendererFeatures");
                    var map = so.FindProperty("m_RendererFeatureMap");
                    if (list == null || map == null)
                    {
                        Debug.LogError($"[FxBuilder] {path}：找不到 m_RendererFeatures / m_RendererFeatureMap（URP 版本变了？）");
                        errors++;
                        continue;
                    }
                    list.arraySize++;
                    list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = feature;
                    map.arraySize++;
                    map.GetArrayElementAtIndex(map.arraySize - 1).longValue = localId;
                    so.ApplyModifiedPropertiesWithoutUndo();
                    added++;
                }
                var fso = new SerializedObject(feature);
                bool ok = SetEnum(fso, "m_Settings.technique", "ScreenSpace")
                          & SetFloat(fso, "m_Settings.maxDrawDistance", 250f)
                          & SetBool(fso, "m_Settings.decalLayers", false)
                          & SetEnum(fso, "m_Settings.screenSpaceSettings.normalBlend", "Low");
                if (!ok)
                {
                    Debug.LogError($"[FxBuilder] {path}：DecalRendererFeature 的设置字段找不到（URP 版本变了？），贴花技术可能不是 Screen Space");
                    errors++;
                }
                fso.ApplyModifiedPropertiesWithoutUndo();
                feature.SetActive(true);
                data.SetDirty();
                EditorUtility.SetDirty(feature);
                EditorUtility.SetDirty(data);
            }
            if (total == 0)
            {
                Debug.LogError($"[FxBuilder] {SettingsDir} 下没有 UniversalRendererData");
                errors++;
            }
            log.Add($"贴花渲染特性：{total} 个渲染器（新加 {added} 个，Screen Space）");
        }

        static bool SetEnum(SerializedObject so, string path, string name)
        {
            var p = so.FindProperty(path);
            if (p == null || p.propertyType != SerializedPropertyType.Enum) return false;
            int i = Array.IndexOf(p.enumNames, name);
            if (i < 0) return false;
            p.enumValueIndex = i;
            return true;
        }

        static bool SetFloat(SerializedObject so, string path, float v)
        {
            var p = so.FindProperty(path);
            if (p == null) return false;
            p.floatValue = v;
            return true;
        }

        static bool SetBool(SerializedObject so, string path, bool v)
        {
            var p = so.FindProperty(path);
            if (p == null) return false;
            p.boolValue = v;
            return true;
        }
    }
}
