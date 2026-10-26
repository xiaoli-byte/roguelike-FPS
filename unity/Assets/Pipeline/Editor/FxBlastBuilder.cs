using System.Collections.Generic;
using System.IO;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 特效打磨 B 路的资产（FxBuilder.BuildAll 顺带调用，bridge.sh fx）：
    ///   1. 序列帧图集 Assets/Art/Fx/T_Fx_Blast.png 的导入设置（数据贴图：线性、带 mip、高质量压缩、上限 2048、夹边）；
    ///      图集本身由 scripts/unity/fx_blast_atlas.py 生成入库（这里不重画）；
    ///   2. 材质 Resources/Fx/Materials/&lt;FxToon.Defs 的名字&gt;.mat（卡通火 / 火舌 / 烟 / 发光，护盾球壳，状态皮），原地覆盖、GUID 不变。
    /// 返回生成的材质（FxBuilder 用来建粒子风格预制体、收进着色器变体集）。
    /// </summary>
    public static class FxBlastBuilder
    {
        public static readonly Dictionary<string, Material> Built = new();

        public static List<Material> Build(List<string> log, ref int errors)
        {
            Built.Clear();
            var tex = ImportAtlas(log, ref errors);
            var list = new List<Material>();
            foreach (var def in FxToon.Defs)
            {
                var shader = Shader.Find(def.shader);
                if (!shader)
                {
                    Debug.LogError($"[FxBuilder] 找不到着色器 {def.shader}（{def.name}）");
                    errors++;
                    continue;
                }
                var mat = FxBuilder.SaveMaterial($"{FxBuilder.MaterialDir}/{def.name}.mat", shader, m =>
                {
                    def.setup?.Invoke(m);
                    if (def.atlas && tex) m.SetTexture("_BaseMap", tex);
                });
                Built[def.name] = mat;
                list.Add(mat);
            }
            log.Add($"B 路卡通特效材质 {list.Count} 个 → {FxBuilder.MaterialDir}（图集 {(tex ? FxToon.AtlasPath : "缺失")}）");
            return list;
        }

        /// <summary>粒子风格用的材质（序列帧粒子按 flipbook.material 取）</summary>
        public static Material For(FxParticle p)
        {
            if (p?.flipbook?.material == null) return null;
            if (Built.TryGetValue(p.flipbook.material, out var m) && m) return m;
            return AssetDatabase.LoadAssetAtPath<Material>($"{FxBuilder.MaterialDir}/{p.flipbook.material}.mat");
        }

        static Texture2D ImportAtlas(List<string> log, ref int errors)
        {
            string path = FxToon.AtlasPath;
            if (!File.Exists(path))
            {
                Debug.LogError($"[FxBuilder] 序列帧图集 {path} 不存在（先跑 python scripts/unity/fx_blast_atlas.py）");
                errors++;
                return null;
            }
            if (AssetImporter.GetAtPath(path) is not TextureImporter ti)
            {
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                ti = AssetImporter.GetAtPath(path) as TextureImporter;
            }
            if (ti)
            {
                bool dirty = ti.textureType != TextureImporterType.Default || ti.sRGBTexture || !ti.mipmapEnabled || ti.wrapMode != TextureWrapMode.Clamp
                             || ti.filterMode != FilterMode.Trilinear || ti.maxTextureSize != 2048 || ti.textureCompression != TextureImporterCompression.CompressedHQ
                             || ti.alphaSource != TextureImporterAlphaSource.FromInput || ti.alphaIsTransparency || ti.npotScale != TextureImporterNPOTScale.None
                             || ti.isReadable;
                if (dirty)
                {
                    ti.textureType = TextureImporterType.Default;
                    ti.sRGBTexture = false;
                    ti.mipmapEnabled = true;
                    ti.wrapMode = TextureWrapMode.Clamp;
                    ti.filterMode = FilterMode.Trilinear;
                    ti.maxTextureSize = 2048;
                    ti.textureCompression = TextureImporterCompression.CompressedHQ;
                    ti.alphaSource = TextureImporterAlphaSource.FromInput;
                    ti.alphaIsTransparency = false;
                    ti.npotScale = TextureImporterNPOTScale.None;
                    ti.isReadable = false;
                    ti.SaveAndReimport();
                    log.Add($"改导入设置 {path}");
                }
            }
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }
    }
}
