using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// U7：把运行时要用的行旅图写进关卡（<see cref="LevelValidator.Run"/> 截完俯视图后调，任何 [LevelBuilder] 关卡都自动有）：
    ///   · 俯视图：_Review 里 2048 px 的审核 PNG（不入库）缩到长边 <see cref="Pixels"/>、透明处铺墨底，存成 Assets/Levels/&lt;场景名&gt;/LevelMap_&lt;id&gt;.jpg（入库；
    ///     .gitignore 只忽略 Levels 下的 png）；内容没变就不重写。导入设置：UI 用的非 2 次幂贴图、钳边、带 mip、高质量压缩；
    ///   · 元数据：关卡场景根上名为「Level Meta」的 <see cref="LevelMeta"/>（关卡 id、名字、贴图、世界 XZ 映射、地点表——场地 / 藏宝 / 补给营 / 出口 / 首领 / 灵火坛，
    ///     守军场地并进它守的藏宝点 / 灵火坛不单列），写完存场景。
    /// </summary>
    public static class LevelMetaWriter
    {
        /// <summary>运行时俯视图长边像素（全图界面约 1500 × 860 设计像素）与 JPG 质量</summary>
        public const int Pixels = 1536, Quality = 85;
        /// <summary>透明处的底色（= 全图界面的墨底）</summary>
        static readonly Color Backdrop = new(0.051f, 0.047f, 0.063f, 1f);

        /// <summary>写行旅图贴图 + 场景里的 LevelMeta，并存场景；结果记进报告</summary>
        public static void Write(LevelSpec spec, Rect area, string reviewPng, LevelKit.Report rep)
        {
            var entry = LevelBuilders.Find(spec.id);
            var scene = entry != null ? SceneManager.GetSceneByPath(entry.ScenePath) : default;
            if (!scene.IsValid() || !scene.isLoaded) scene = SceneManager.GetActiveScene();
            if (string.IsNullOrEmpty(scene.path))
            {
                rep.Warn("行旅图元数据没写：关卡场景还没存盘");
                return;
            }
            string dir = $"Assets/Levels/{Path.GetFileNameWithoutExtension(scene.path)}";
            Directory.CreateDirectory(dir);
            string path = $"{dir}/LevelMap_{spec.id.Replace('/', '_')}.jpg";
            var size = WriteImage(reviewPng, path, out bool changed);
            if (changed || AssetImporter.GetAtPath(path) == null) AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            Configure(path);
            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (!tex) rep.Warn($"行旅图贴图导入失败：{path}");

            var meta = Object.FindObjectsByType<LevelMeta>(FindObjectsInactive.Include).FirstOrDefault(m => m.gameObject.scene == scene);
            if (!meta)
            {
                var go = new GameObject(LevelMeta.ObjectName);
                SceneManager.MoveGameObjectToScene(go, scene);
                meta = go.AddComponent<LevelMeta>();
            }
            meta.levelId = spec.id;
            meta.title = spec.title ?? "";
            meta.map = tex;
            meta.mapArea = area;
            meta.pois = LevelMeta.Collect(scene).ToArray();
            EditorUtility.SetDirty(meta);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            var counts = meta.pois.GroupBy(p => p.kind).OrderBy(g => g.Key).Select(g => $"{LevelMeta.KindName(g.Key)} {g.Count()}");
            rep.Line($"✓ 行旅图：{path}（{size.x}×{size.y}{(changed ? "" : "，内容没变")}），地点 {meta.pois.Length} 处（{string.Join("、", counts)}），写进场景「{LevelMeta.ObjectName}」");
        }

        /// <summary>审核 PNG → 缩小、铺底的 JPG；返回尺寸。字节没变就不写（changed = false）</summary>
        static Vector2Int WriteImage(string png, string jpg, out bool changed)
        {
            changed = false;
            var src = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            Texture2D dst = null;
            try
            {
                if (!src.LoadImage(File.ReadAllBytes(png), false)) throw new IOException($"读不了 {png}");
                src.filterMode = FilterMode.Bilinear;
                src.wrapMode = TextureWrapMode.Clamp;
                int sw = src.width, sh = src.height;
                float k = Mathf.Min(1f, Pixels / (float)Mathf.Max(sw, sh));
                int w = Mathf.Max(16, Mathf.RoundToInt(sw * k)), h = Mathf.Max(16, Mathf.RoundToInt(sh * k));
                dst = new Texture2D(w, h, TextureFormat.RGB24, false, true);
                var px = new Color32[w * h];
                // 每个输出像素取 2×2 个双线性样本（缩小时不起锯齿），按 alpha 铺到墨底上
                for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    Color acc = default;
                    for (int sy = 0; sy < 2; sy++)
                    for (int sx = 0; sx < 2; sx++)
                    {
                        var c = src.GetPixelBilinear((x + 0.25f + 0.5f * sx) / w, (y + 0.25f + 0.5f * sy) / h);
                        acc += Color.Lerp(Backdrop, new Color(c.r, c.g, c.b, 1), c.a);
                    }
                    acc *= 0.25f;
                    px[y * w + x] = new Color32((byte)(Mathf.Clamp01(acc.r) * 255 + 0.5f), (byte)(Mathf.Clamp01(acc.g) * 255 + 0.5f), (byte)(Mathf.Clamp01(acc.b) * 255 + 0.5f), 255);
                }
                dst.SetPixels32(px);
                dst.Apply(false);
                var bytes = dst.EncodeToJPG(Quality);
                if (!File.Exists(jpg) || !File.ReadAllBytes(jpg).SequenceEqual(bytes))
                {
                    File.WriteAllBytes(jpg, bytes);
                    changed = true;
                }
                return new Vector2Int(w, h);
            }
            finally
            {
                Object.DestroyImmediate(src);
                if (dst) Object.DestroyImmediate(dst);
            }
        }

        /// <summary>导入设置：UI 贴图（不缩成 2 次幂、钳边、带 mip、高质量压缩、不可读）；有变化才重导</summary>
        static void Configure(string path)
        {
            if (!(AssetImporter.GetAtPath(path) is TextureImporter ti)) return;
            bool dirty = false;
            void Set<T>(T now, T want, System.Action<T> apply)
            {
                if (EqualityComparer<T>.Default.Equals(now, want)) return;
                apply(want);
                dirty = true;
            }
            Set(ti.textureType, TextureImporterType.Default, v => ti.textureType = v);
            Set(ti.sRGBTexture, true, v => ti.sRGBTexture = v);
            Set(ti.mipmapEnabled, true, v => ti.mipmapEnabled = v);
            Set(ti.wrapMode, TextureWrapMode.Clamp, v => ti.wrapMode = v);
            Set(ti.npotScale, TextureImporterNPOTScale.None, v => ti.npotScale = v);
            Set(ti.maxTextureSize, 2048, v => ti.maxTextureSize = v);
            Set(ti.textureCompression, TextureImporterCompression.CompressedHQ, v => ti.textureCompression = v);
            Set(ti.alphaSource, TextureImporterAlphaSource.None, v => ti.alphaSource = v);
            Set(ti.isReadable, false, v => ti.isReadable = v);
            if (dirty) ti.SaveAndReimport();
        }
    }
}
