using System;
using System.IO;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 地形：地貌函数 → Unity Terrain（高度图、分层图、风格化地形材质）。归 L4。
    public static partial class LevelKit
    {
        /// <summary>地貌求值结果：高度（米）+ 分层规则要用的各个分量（都由同一个纯函数给出，高度图与分层图严格对齐）</summary>
        public struct Sample
        {
            public float h;
            /// <summary>各层的原始倾向 0–1（分层规则在 <see cref="Splat"/> 里合成）</summary>
            public float sand, packed, gravelBias;
            /// <summary>强制岩石（雅丹、台地侧壁之外的岩体，如远景岩丘）</summary>
            public float rock;
        }

        public sealed class TerrainSpec
        {
            public string dir, name;
            public Vector2 size;
            /// <summary>地形左下角的世界 XZ（关卡坐标 = 世界坐标）</summary>
            public Vector2 origin;
            /// <summary>高度场里的 0 对应世界 y = -baseHeight（让挖下去的河床、盆地也在 0 以上）</summary>
            public float baseHeight, heightRange = 48;
            public int heightRes = 1025, splatRes = 1024;
            public TerrainLayer[] layers;
            public Func<Vector2, Sample> eval;
            public Color shadowTint = new(0.7f, 0.64f, 0.82f);
        }

        public static Terrain BuildTerrain(TerrainSpec s, Transform parent, out HeightField hf)
        {
            int res = s.heightRes;
            hf = new HeightField(s.size, res);
            var samples = new Sample[res, res];
            var field = hf;
            Parallel.For(0, res, z =>
            {
                for (int x = 0; x < res; x++)
                {
                    var smp = s.eval(field.Pos(x, z) + s.origin);
                    samples[z, x] = smp;
                    field.h[z, x] = smp.h;
                }
            });

            var heights = new float[res, res];
            for (int z = 0; z < res; z++)
            for (int x = 0; x < res; x++)
                heights[z, x] = Mathf.Clamp01(hf.h[z, x] / s.heightRange);

            // 先建资产再写数据：分层图纹理是 TerrainData 的子资产，在资产创建之前写进去的像素不会落盘
            Directory.CreateDirectory(s.dir);
            string tdPath = $"{s.dir}/TD_{s.name}.asset";
            AssetDatabase.DeleteAsset(tdPath);
            var td = new TerrainData();
            AssetDatabase.CreateAsset(td, tdPath);
            td.heightmapResolution = res;
            td.size = new Vector3(s.size.x, s.heightRange, s.size.y);
            td.SetHeights(0, 0, heights);
            td.terrainLayers = s.layers;
            td.alphamapResolution = s.splatRes;
            td.baseMapResolution = 1024;

            // 分层图：每个分层像素取最近的高度采样的分量，坡度用高度场差分
            int n = s.splatRes;
            var alpha = new float[n, n, s.layers.Length];
            Parallel.For(0, n, z =>
            {
                for (int x = 0; x < n; x++)
                {
                    int hx = Mathf.Clamp(Mathf.RoundToInt((x + 0.5f) / n * (res - 1)), 0, res - 1);
                    int hz = Mathf.Clamp(Mathf.RoundToInt((z + 0.5f) / n * (res - 1)), 0, res - 1);
                    var w = Splat(samples[hz, hx], field.Slope(hx, hz));
                    for (int l = 0; l < s.layers.Length && l < 4; l++) alpha[z, x, l] = w[l];
                }
            });
            td.SetAlphamaps(0, 0, alpha);
            EditorUtility.SetDirty(td);
            AssetDatabase.SaveAssets();

            var material = TerrainMaterial(s.dir, s.name, s.shadowTint, td, s.layers);
            var go = Terrain.CreateTerrainGameObject(td);
            go.name = $"Terrain_{s.name}";
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(s.origin.x, -s.baseHeight, s.origin.y);
            go.isStatic = true;
            var t = go.GetComponent<Terrain>();
            t.materialTemplate = material;
            t.drawInstanced = false;       // 风格化地形着色器直接读顶点法线
            t.basemapDistance = 2000;      // 始终走本着色器，不切到远处的 basemap
            t.heightmapPixelError = 3;
            t.shadowCastingMode = ShadowCastingMode.On;
            t.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return t;
        }

        /// <summary>
        /// 分层规则（0 沙 / 1 黑戈壁砾石 / 2 夯土·干河床 / 3 赭红层理岩），按优先级逐层「占掉剩余份额」：
        /// 陡坡与岩体 → 岩；路、河床、台顶 → 夯土；沙丘、沙坡、盆地 → 沙；剩下的是砾石戈壁。
        /// </summary>
        static Vector4 Splat(Sample s, float slope)
        {
            // 陡坡变岩石，但沙丘（沙的倾向强）再陡也还是沙——沙丘背风坡本来就在 30° 上下
            float rock = Mathf.Max(Landform.Smooth(30, 42, slope) * (1 - Landform.Smooth(0.35f, 0.7f, s.sand)), s.rock);
            float left = 1 - rock;
            float packed = Mathf.Clamp01(s.packed) * left;
            left -= packed;
            // 沙丘背风坡（30° 上下）仍是沙，不被坡度规则吃成岩石：沙的倾向强时把岩石份额让回来
            float sand = Mathf.Clamp01(s.sand) * left;
            left -= sand;
            float gravel = left;
            return new Vector4(sand, gravel, packed, rock);
        }

        /// <summary>地形材质：显式绑定 TerrainData 的分层图（alphamap 纹理）与各层贴图、平铺尺寸</summary>
        static Material TerrainMaterial(string dir, string name, Color shadowTint, TerrainData td, TerrainLayer[] layers)
        {
            var m = new Material(Shader.Find("Spiritfire/StylizedTerrain")) { name = $"M_Terrain_{name}" };
            m.SetTexture("_ControlMap", td.alphamapTextures[0]);
            var tile = Vector4.one * 8;
            for (int i = 0; i < 4 && i < layers.Length; i++)
            {
                m.SetTexture($"_Layer{i}", layers[i].diffuseTexture);
                tile[i] = layers[i].tileSize.x;
            }
            m.SetVector("_LayerTile", tile);
            m.SetTexture("_MacroTex", TerrainTextureGen.Macro(5));
            m.SetFloat("_MacroScale", 70);
            m.SetFloat("_MacroStrength", 0.2f);
            m.SetFloat("_RockScale", 8);
            m.SetColor("_ShadowTint", shadowTint);
            SaveAsset(m, $"{dir}/M_Terrain_{name}.mat");
            return m;
        }
    }
}
