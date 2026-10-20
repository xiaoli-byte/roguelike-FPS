using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.TextCore.Text;
using UnityEngine.UIElements;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// UI Toolkit 基座的资产生成（docs/unity-parity.md U1；bash scripts/unity/bridge.sh ui，或菜单 Spiritfire/UI/Build UI Assets）。
    /// 输入是入库的文本 / 字体文件，输出的 .asset 由这里生成，不手写：
    ///   1. 字体导入设置：Resources/UI/Fonts 下的子集（scripts/unity/subset_fonts.py 生成）一律动态 + 打包字体数据；
    ///      正文 Font 的回退引用余量文件（uGUI / TextMesh 用 <see cref="UIFonts.Legacy"/> 时也不缺字）。
    ///   2. SDF 字体资产 Resources/UI/Fonts/SDF/{Body, BodyExt…, Title, Number}.asset：动态填充、多图集，参数和行高取 <see cref="UIFonts.SpecOf"/>，
    ///      回退链 标题 / 数字 → 正文 → 余量（<see cref="UIFonts.Link"/>）。图集贴图和材质作为子资产存进同一个文件；生成时清空动态数据，
    ///      退出 Play 时也清一次（Play 里现生成的字形不写回仓库）。
    ///   3. Resources/UI/Panels/PanelText.asset（全局回退 = 正文 → 余量、打包时清动态数据；默认字体在 6.5 已过时，正文由 UIRoot 内联在各层根上）。
    ///   4. Resources/UI/Panels/{Hud, Overlay, Modal, Toast}.asset：<see cref="UILayers.Configure"/>（主题 DefaultTheme.tss = Unity 默认控件样式）。
    ///   5. 检查：theme.uss / DefaultTheme.tss 能载入、9 个图标能解析、三套字体里有常用字。
    /// 已有资产原地更新（GUID 不变）；字体资产只有源字体或 SDF 参数变了才重建。返回问题数（bridge 回应 qa-errors）。
    /// </summary>
    [InitializeOnLoad]
    public static class UIBuilder
    {
        const string Root = "Assets/Game/Resources/UI";
        const string FontsDir = Root + "/Fonts", SdfDir = Root + "/Fonts/SDF", PanelsDir = Root + "/Panels";
        const string ThemeTss = Root + "/DefaultTheme.tss", ThemeUss = Root + "/theme.uss";
        /// <summary>各字体至少要有的字（抽查子集）</summary>
        const string SampleCjk = "灵火破晓古道穿越戈壁区域肃清出口已开启秘卷灵石魂晶旱魃鲲鹏麒麟", SampleNum = "0123456789+-%×/:.";

        static UIBuilder() => EditorApplication.playModeStateChanged += OnPlayModeChanged;

        [MenuItem("Spiritfire/UI/Build UI Assets", priority = 90)]
        static void Menu()
        {
            int n = Build();
            EditorUtility.DisplayDialog("UI Assets", n == 0 ? "UI 资产已生成，检查全部通过" : $"UI 资产已生成，有 {n} 个问题，见 Console", "OK");
        }

        /// <summary>生成 / 更新全部 UI 资产，返回问题数</summary>
        public static int Build()
        {
            int errors = 0;
            MixamoLibrary.EnsureFolder(SdfDir);
            MixamoLibrary.EnsureFolder(PanelsDir);
            AssetDatabase.ImportAsset(ThemeTss, ImportAssetOptions.ForceSynchronousImport);
            AssetDatabase.ImportAsset(ThemeUss, ImportAssetOptions.ForceSynchronousImport);

            // ── 1. 字体导入设置 ──
            string bodyPath = FontFile(UIFonts.BodyFile), titlePath = FontFile(UIFonts.TitleFile), numberPath = FontFile(UIFonts.NumberFile);
            var extPaths = Directory.Exists(FontsDir)
                ? Directory.GetFiles(FontsDir).Select(p => p.Replace('\\', '/'))
                    .Where(p => Path.GetFileName(p).StartsWith(UIFonts.BodyExtPrefix) && (p.EndsWith(".otf") || p.EndsWith(".ttf"))).OrderBy(p => p, System.StringComparer.Ordinal).ToList()
                : new List<string>();
            if (bodyPath == null)
            {
                Debug.LogError($"[UI] {FontsDir} 里没有 {UIFonts.BodyFile}.otf/.ttf：先跑 python scripts/unity/subset_fonts.py");
                return 1;
            }
            foreach (var p in extPaths) ConfigureImporter(p, null, null);
            var extFonts = extPaths.Select(p => AssetDatabase.LoadAssetAtPath<Font>(p)).Where(f => f).ToArray();
            ConfigureImporter(bodyPath, extFonts, new[] { "Noto Sans SC", "Noto Sans SC Ext" });
            var bodyFont = AssetDatabase.LoadAssetAtPath<Font>(bodyPath);
            var withBody = new[] { bodyFont }.Concat(extFonts).ToArray();
            if (titlePath != null) ConfigureImporter(titlePath, withBody, new[] { "WenKai SF", "Noto Sans SC", "Noto Sans SC Ext" });
            if (numberPath != null) ConfigureImporter(numberPath, withBody, new[] { "Barlow Condensed", "Noto Sans SC", "Noto Sans SC Ext" });
            if (titlePath == null) { Debug.LogError($"[UI] 缺标题字体 {UIFonts.TitleFile}"); errors++; }
            if (numberPath == null) { Debug.LogError($"[UI] 缺数字字体 {UIFonts.NumberFile}"); errors++; }

            // ── 2. SDF 字体资产 ──
            var body = MakeFontAsset(bodyFont, UIFontRole.Body, UIFonts.BodyAsset);
            var ext = new List<FontAsset>();
            for (int i = 0; i < extFonts.Length; i++) ext.Add(MakeFontAsset(extFonts[i], UIFontRole.Body, UIFonts.BodyExtAsset + (i == 0 ? "" : (i + 1).ToString())));
            // 余量变少了（切的份数减少）：删掉多出来的旧资产
            for (int i = extFonts.Length; i < 16; i++)
            {
                string stale = $"{SdfDir}/{UIFonts.BodyExtAsset}{(i == 0 ? "" : (i + 1).ToString())}.asset";
                if (File.Exists(stale)) AssetDatabase.DeleteAsset(stale);
            }
            var title = titlePath != null ? MakeFontAsset(AssetDatabase.LoadAssetAtPath<Font>(titlePath), UIFontRole.Title, UIFonts.TitleAsset) : null;
            var number = numberPath != null ? MakeFontAsset(AssetDatabase.LoadAssetAtPath<Font>(numberPath), UIFontRole.Number, UIFonts.NumberAsset) : null;
            UIFonts.Link(body, ext, title, number);
            foreach (var fa in new[] { body, title, number }.Concat(ext))
                if (fa) EditorUtility.SetDirty(fa);

            // ── 3. 面板文本设置 ──
            // 默认字体（TextSettings.defaultFontAsset）在 6.5 已过时：各层根元素上内联正文字体，这里只给全局回退链（正文 → 余量）
            var text = LoadOrCreate<PanelTextSettings>($"{PanelsDir}/PanelText.asset");
            var globalFallback = new List<FontAsset>();
            if (body) globalFallback.Add(body);
            globalFallback.AddRange(ext.Where(f => f));
            text.fallbackFontAssets = globalFallback;
            text.clearDynamicDataOnBuild = true;
            EditorUtility.SetDirty(text);

            // ── 4. 分层面板 ──
            var theme = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(ThemeTss);
            if (!theme) { Debug.LogError($"[UI] 载入不了 {ThemeTss}"); errors++; }
            for (int i = 0; i < UILayers.Count; i++)
            {
                var layer = (UILayer)i;
                var ps = LoadOrCreate<PanelSettings>($"{PanelsDir}/{UILayers.Name(layer)}.asset");
                UILayers.Configure(ps, layer, theme, text);
                EditorUtility.SetDirty(ps);
            }
            AssetDatabase.SaveAssets();

            // ── 5. 检查 ──
            if (!AssetDatabase.LoadAssetAtPath<StyleSheet>(ThemeUss)) { Debug.LogError($"[UI] 载入不了 {ThemeUss}（USS 语法错误？见 Console）"); errors++; }
            int icons = 0;
            for (int i = 0; i < UIIcons.Count; i++)
            {
                VectorImage img = null;
                try { img = UIIcons.Build(UIIcons.Source((UIIcon)i)); }
                catch (System.Exception e) { Debug.LogError($"[UI] 图标 {(UIIcon)i} 解析异常：{e.Message}"); }
                if (img && img.width > 0) icons++;
                else { Debug.LogError($"[UI] 图标 {(UIIcon)i} 解析失败"); errors++; }
                if (img) Object.DestroyImmediate(img);
            }
            errors += CheckFont(bodyFont, SampleCjk + SampleNum);
            if (titlePath != null) errors += CheckFont(AssetDatabase.LoadAssetAtPath<Font>(titlePath), SampleCjk);
            if (numberPath != null) errors += CheckFont(AssetDatabase.LoadAssetAtPath<Font>(numberPath), SampleNum);
            Debug.Log($"[UI] 字体资产 {1 + ext.Count + (title ? 1 : 0) + (number ? 1 : 0)} 个（正文余量 {ext.Count} 份）、面板 {UILayers.Count} 层、图标 {icons}/{UIIcons.Count}；问题 {errors} 个");
            return errors;
        }

        static string FontFile(string stem)
        {
            foreach (var ext in new[] { ".otf", ".ttf" })
            {
                string p = $"{FontsDir}/{stem}{ext}";
                if (File.Exists(p)) return p;
            }
            return null;
        }

        /// <summary>动态字体、打包字体数据、回退引用（uGUI / TextMesh 缺字时按 fontNames 在引用的字体和系统字体里找）</summary>
        static void ConfigureImporter(string path, Font[] fallbacks, string[] names)
        {
            if (!(AssetImporter.GetAtPath(path) is TrueTypeFontImporter imp)) return;
            bool changed = imp.fontTextureCase != FontTextureCase.Dynamic || !imp.includeFontData;
            imp.fontTextureCase = FontTextureCase.Dynamic;
            imp.includeFontData = true;
            if (fallbacks != null)
            {
                var refs = fallbacks.Where(f => f).ToArray();
                if (imp.fontReferences == null || !imp.fontReferences.SequenceEqual(refs))
                {
                    imp.fontReferences = refs;
                    changed = true;
                }
            }
            if (names != null && (imp.fontNames == null || !imp.fontNames.SequenceEqual(names)))
            {
                imp.fontNames = names;
                changed = true;
            }
            if (changed) imp.SaveAndReimport();
        }

        /// <summary>按角色建 / 取 SDF 字体资产：源字体和参数都没变就原地保留（清空动态数据、重设行高），否则删掉重建</summary>
        static FontAsset MakeFontAsset(Font font, UIFontRole role, string assetName)
        {
            if (!font) return null;
            string path = $"{SdfDir}/{assetName}.asset";
            var spec = UIFonts.SpecOf(role);
            var fa = AssetDatabase.LoadAssetAtPath<FontAsset>(path);
            if (fa && (fa.sourceFontFile != font || fa.atlasWidth != spec.atlasSize || fa.atlasPadding != spec.padding
                       || Mathf.RoundToInt(fa.faceInfo.pointSize) != spec.samplingPointSize || fa.atlasPopulationMode != AtlasPopulationMode.Dynamic))
            {
                AssetDatabase.DeleteAsset(path);
                fa = null;
            }
            if (!fa)
            {
                fa = UIFonts.Create(font, role);
                if (!fa)
                {
                    Debug.LogError($"[UI] 从 {font.name} 建 SDF 字体失败");
                    return null;
                }
                fa.name = assetName;
                AssetDatabase.CreateAsset(fa, path);
            }
            fa.ClearFontAssetData(true);
            UIFonts.ApplyLineHeight(fa, spec.lineHeight);
            AddSubAssets(fa);
            EditorUtility.SetDirty(fa);
            return fa;
        }

        /// <summary>图集贴图和材质要作为子资产存进字体资产，否则重开工程就丢（同 VolumeProfile 的教训）</summary>
        static void AddSubAssets(FontAsset fa)
        {
            var textures = fa.atlasTextures;
            if (textures != null)
                for (int i = 0; i < textures.Length; i++)
                {
                    var tex = textures[i];
                    if (!tex || AssetDatabase.Contains(tex)) continue;
                    tex.name = fa.name + " Atlas" + (i == 0 ? "" : " " + i);
                    AssetDatabase.AddObjectToAsset(tex, fa);
                }
            var mat = fa.material;
            if (mat && !AssetDatabase.Contains(mat))
            {
                mat.name = fa.name + " Material";
                AssetDatabase.AddObjectToAsset(mat, fa);
            }
        }

        static T LoadOrCreate<T>(string path) where T : ScriptableObject
        {
            var a = AssetDatabase.LoadAssetAtPath<T>(path);
            if (a) return a;
            a = ScriptableObject.CreateInstance<T>();
            a.name = Path.GetFileNameWithoutExtension(path);
            AssetDatabase.CreateAsset(a, path);
            return a;
        }

        static int CheckFont(Font font, string sample)
        {
            if (!font) return 1;
            var missing = sample.Where(c => !font.HasCharacter(c)).Distinct().ToArray();
            if (missing.Length == 0) return 0;
            Debug.LogError($"[UI] {font.name} 缺字：{new string(missing)}（重跑 scripts/unity/subset_fonts.py）");
            return 1;
        }

        /// <summary>退出 Play：把 Play 里动态生成进 SDF 字体资产的字形清掉（不让图集数据写回仓库）</summary>
        static void OnPlayModeChanged(PlayModeStateChange change)
        {
            if (change != PlayModeStateChange.EnteredEditMode || !AssetDatabase.IsValidFolder(SdfDir)) return;
            foreach (var guid in AssetDatabase.FindAssets("t:FontAsset", new[] { SdfDir }))
            {
                var fa = AssetDatabase.LoadAssetAtPath<FontAsset>(AssetDatabase.GUIDToAssetPath(guid));
                // 清空后图集尺寸是 0：比 1 大说明 Play 里生成过字形
                if (!fa || fa.atlasPopulationMode != AtlasPopulationMode.Dynamic || (fa.atlasTextureCount <= 1 && (!fa.atlasTexture || fa.atlasTexture.width <= 1))) continue;
                fa.ClearFontAssetData(true);
                UIFonts.ApplyLineHeight(fa, UIFonts.SpecOf(RoleOf(fa.name)).lineHeight);
                EditorUtility.SetDirty(fa);
                AssetDatabase.SaveAssetIfDirty(fa);
            }
        }

        static UIFontRole RoleOf(string assetName) => assetName == UIFonts.TitleAsset ? UIFontRole.Title : assetName == UIFonts.NumberAsset ? UIFontRole.Number : UIFontRole.Body;
    }
}
