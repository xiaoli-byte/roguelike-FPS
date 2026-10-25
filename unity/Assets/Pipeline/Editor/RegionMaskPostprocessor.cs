using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 分区遮罩（docs/unity-parity.md FX4）：火鼍的 8 块岩甲、傩巫的面具。Three.js 版在运行时按网格顶点算一条属性
    /// （Tuo.platePaint 的 plateId：绑定姿势下 |x| ∈ [0.06, 0.62]、y ≥ 1.0、z 落在哪一排；InfernoSupportFx.applyNuoMask 的 aMask：mask 骨的蒙皮权重），
    /// 再在本体着色器里按它换色 / 发光。Unity 版在模型导入之后把这份「每个顶点属于哪一区」烘进一张 UV 空间的遮罩贴图
    /// （Resources/Fx/RegionMasks/&lt;贴图名&gt;_RM.png，线性 RGBA），SF_StylizedLit 的分区段按它着色，RegionMask 组件每帧写各区的状态：
    ///   火鼍：R / G / B / A = 前 → 后四排岩甲（软边），左右两列由着色器按身体左右（世界空间）分开；
    ///   傩巫：R = 面具（mask 骨权重）；面具中心另存一份 &lt;贴图名&gt;_RM.json（模型空间），碎面裂纹从这里放射。
    /// 什么时候烘：这两个模型（重新）导入之后（OnPostprocessAllAssets：不加模型导入回调，不会让全部模型重新导入）；编辑器加载时遮罩缺失或算法版本变了也补烘一次；
    /// 菜单 Spiritfire/Fx/Bake Region Masks 手动重烘。Play 模式里不烘（等退出后的下一次刷新）。
    /// </summary>
    public sealed class RegionMaskPostprocessor : AssetPostprocessor
    {
        /// <summary>算法版本：改了分区规则就加一，下次编辑器加载时自动重烘（写在遮罩贴图导入器的 userData 里）</summary>
        public const int Version = 1;
        public const string OutDir = "Assets/Game/Resources/Fx/RegionMasks";
        const int Size = 1024, Dilate = 6;

        sealed class Spec
        {
            public string model, texture;
            /// <summary>每个顶点的分区值（RGBA）：model = 模型空间绑定位置（Unity 坐标），bones = 这个顶点的 (骨骼名, 权重)</summary>
            public Func<Vector3, IReadOnlyList<(string bone, float w)>, Vector4> region;
            /// <summary>额外算一个「R ≥ 0.5 的顶点平均位置」存进 json（面具中心）</summary>
            public bool center;
        }

        static readonly Spec[] Specs =
        {
            new()
            {
                model = "Assets/Art/Characters/SK_Enemy_Tuo/SK_Enemy_Tuo.fbx", texture = "T_Enemy_Tuo",
                region = (p, _) => TuoPlates(p),
            },
            new()
            {
                model = "Assets/Art/Characters/SK_Enemy_Nuo/SK_Enemy_Nuo.fbx", texture = "T_Enemy_Nuo", center = true,
                region = (_, bones) =>
                {
                    float w = 0;
                    foreach (var (bone, bw) in bones)
                        if (bone == "mask") w += bw;
                    return new Vector4(Mathf.Clamp01(w), 0, 0, 0);
                },
            },
        };

        /// <summary>火鼍岩甲四排（Three.js PLATE_BANDS，网格 z 区间，前 → 后）、甲区横向 |x| ∈ [0.06, 0.62]、高于 1.0 m</summary>
        static readonly Vector2[] Bands = { new(0.85f, 1.35f), new(0.35f, 0.85f), new(-0.15f, 0.35f), new(-0.65f, -0.15f) };

        static Vector4 TuoPlates(Vector3 p)
        {
            float ax = Mathf.Abs(p.x);
            float m = Smooth(0.98f, 1.04f, p.y) * Smooth(0.04f, 0.08f, ax) * (1 - Smooth(0.6f, 0.66f, ax));
            var v = Vector4.zero;
            for (int b = 0; b < 4; b++)
            {
                var z = Bands[b];
                // 排与排之间留一道 4 cm 的缝（软边），不让相邻两排同时亮
                v[b] = m * Smooth(z.x - 0.02f, z.x + 0.02f, p.z) * (1 - Smooth(z.y - 0.02f, z.y + 0.02f, p.z));
            }
            return v;
        }

        static float Smooth(float e0, float e1, float x)
        {
            float t = Mathf.Clamp01((x - e0) / (e1 - e0));
            return t * t * (3 - 2 * t);
        }

        // ───────────── 什么时候烘 ─────────────

        static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
        {
            foreach (var path in imported)
                foreach (var s in Specs)
                    if (string.Equals(path, s.model, StringComparison.OrdinalIgnoreCase))
                    {
                        var spec = s;
                        EditorApplication.delayCall += () => BakeSafe(spec, "模型重新导入");
                    }
        }

        [InitializeOnLoadMethod]
        static void OnLoad() => EditorApplication.delayCall += BakeMissing;

        static void BakeMissing()
        {
            foreach (var s in Specs)
            {
                string png = $"{OutDir}/{s.texture}_RM.png";
                var ti = AssetImporter.GetAtPath(png) as TextureImporter;
                if (ti && ti.userData == Stamp) continue;
                BakeSafe(s, ti ? "算法版本变了" : "遮罩缺失");
            }
        }

        static string Stamp => $"regionmask:{Version}";

        [MenuItem("Spiritfire/Fx/Bake Region Masks", priority = 101)]
        static void Menu() => BakeAll();

        /// <summary>全部重烘（菜单、bridge.sh fx 调）；返回烘好的张数</summary>
        public static int BakeAll(System.Collections.Generic.List<string> log = null)
        {
            int n = 0;
            foreach (var s in Specs)
                if (BakeSafe(s, "手动") != null)
                    n++;
            log?.Add($"分区遮罩 {n}/{Specs.Length} 张 → {OutDir}");
            return n;
        }

        static string BakeSafe(Spec s, string why)
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                // Play 模式里不碰资产：退出后下一次加载再补
                return null;
            }
            try
            {
                return Bake(s, why);
            }
            catch (Exception e)
            {
                Debug.LogError($"[RegionMask] {s.texture} 烘焙失败：{e}");
                return null;
            }
        }

        // ───────────── 烘焙 ─────────────

        /// <summary>烘一张分区遮罩；返回写出的贴图路径（模型不在时返回 null）</summary>
        static string Bake(Spec s, string why)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(s.model);
            if (!model)
            {
                Debug.LogWarning($"[RegionMask] 找不到模型 {s.model}");
                return null;
            }
            var smr = model.GetComponentsInChildren<SkinnedMeshRenderer>(true).FirstOrDefault(r => r.sharedMesh && !r.name.Contains("GlowShell"));
            if (!smr)
            {
                Debug.LogWarning($"[RegionMask] {s.model} 没有蒙皮网格");
                return null;
            }
            var mesh = smr.sharedMesh;
            var toModel = model.transform.worldToLocalMatrix * smr.transform.localToWorldMatrix;
            var verts = new List<Vector3>();
            var uvs = new List<Vector2>();
            var tris = new List<int>();
            ReadMesh(mesh, verts, uvs, tris);
            var weights = mesh.boneWeights;
            var bones = smr.bones;
            int nv = verts.Count;
            if (uvs.Count != nv || nv == 0) throw new Exception($"网格数据不完整（顶点 {nv}，UV {uvs.Count}）");
            var region = new Vector4[nv];
            var model3 = new Vector3[nv];
            var bw = new List<(string, float)>(4);
            Vector3 sum = Vector3.zero;
            int cnt = 0;
            for (int v = 0; v < nv; v++)
            {
                var p = toModel.MultiplyPoint3x4(verts[v]);
                model3[v] = p;
                bw.Clear();
                if (weights.Length == nv)
                {
                    var w = weights[v];
                    Add(bw, bones, w.boneIndex0, w.weight0);
                    Add(bw, bones, w.boneIndex1, w.weight1);
                    Add(bw, bones, w.boneIndex2, w.weight2);
                    Add(bw, bones, w.boneIndex3, w.weight3);
                }
                region[v] = s.region(p, bw);
                if (s.center && region[v].x >= 0.5f)
                {
                    sum += p;
                    cnt++;
                }
            }
            var tex = Rasterize(uvs, tris, region);
            Directory.CreateDirectory(OutDir);
            string png = $"{OutDir}/{s.texture}_RM.png";
            File.WriteAllBytes(png, tex.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(tex);
            if (s.center)
            {
                var c = cnt > 0 ? sum / cnt : Vector3.zero;
                File.WriteAllText($"{OutDir}/{s.texture}_RM.json", JsonUtility.ToJson(new RegionMaskInfo { center = c, verts = cnt }, true));
                AssetDatabase.ImportAsset($"{OutDir}/{s.texture}_RM.json", ImportAssetOptions.ForceSynchronousImport);
            }
            AssetDatabase.ImportAsset(png, ImportAssetOptions.ForceSynchronousImport);
            if (AssetImporter.GetAtPath(png) is TextureImporter ti)
            {
                ti.textureType = TextureImporterType.Default;
                ti.sRGBTexture = false;
                ti.mipmapEnabled = true;
                ti.alphaSource = TextureImporterAlphaSource.FromInput;
                ti.alphaIsTransparency = false;
                ti.textureCompression = TextureImporterCompression.CompressedHQ;
                ti.maxTextureSize = Size;
                ti.wrapMode = TextureWrapMode.Repeat;
                ti.isReadable = false;
                ti.userData = Stamp;
                ti.SaveAndReimport();
            }
            Debug.Log($"[RegionMask] {s.texture}_RM（{why}）：{nv} 顶点 / {tris.Count / 3} 三角形" + (s.center ? $"，面具顶点 {cnt}" : ""));
            return png;
        }

        static void Add(List<(string, float)> list, Transform[] bones, int index, float w)
        {
            if (w <= 0 || index < 0 || index >= bones.Length || !bones[index]) return;
            list.Add((bones[index].name, w));
        }

        /// <summary>读网格的顶点 / UV / 三角形：可读就直接读；导入设置关了读写时走 MeshData（编辑器里非只读网格也能读）</summary>
        static void ReadMesh(Mesh mesh, List<Vector3> verts, List<Vector2> uvs, List<int> tris)
        {
            if (mesh.isReadable)
            {
                mesh.GetVertices(verts);
                mesh.GetUVs(0, uvs);
                mesh.GetTriangles(tris, 0);
                for (int sm = 1; sm < mesh.subMeshCount; sm++)
                {
                    var more = new List<int>();
                    mesh.GetTriangles(more, sm);
                    tris.AddRange(more);
                }
                return;
            }
            using var data = Mesh.AcquireReadOnlyMeshData(mesh);
            var d = data[0];
            var va = new Unity.Collections.NativeArray<Vector3>(d.vertexCount, Unity.Collections.Allocator.Temp);
            var ua = new Unity.Collections.NativeArray<Vector2>(d.vertexCount, Unity.Collections.Allocator.Temp);
            d.GetVertices(va);
            d.GetUVs(0, ua);
            verts.AddRange(va);
            uvs.AddRange(ua);
            va.Dispose();
            ua.Dispose();
            for (int sm = 0; sm < d.subMeshCount; sm++)
            {
                var ia = new Unity.Collections.NativeArray<int>(d.GetSubMesh(sm).indexCount, Unity.Collections.Allocator.Temp);
                d.GetIndices(ia, sm);
                tris.AddRange(ia);
                ia.Dispose();
            }
        }

        /// <summary>UV 空间光栅化（贴图 v 朝上，与 Unity 采样一致），每个纹素取三角形顶点分区值的重心插值；再往 UV 岛外扩几个纹素</summary>
        static Texture2D Rasterize(List<Vector2> uvs, List<int> tris, Vector4[] region)
        {
            var px = new Vector4[Size * Size];
            var cov = new bool[Size * Size];
            for (int t = 0; t + 2 < tris.Count; t += 3)
            {
                int i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
                Vector2 a = uvs[i0] * Size - Vector2.one * 0.5f, b = uvs[i1] * Size - Vector2.one * 0.5f, c = uvs[i2] * Size - Vector2.one * 0.5f;
                int x0 = Mathf.Max(0, Mathf.FloorToInt(Mathf.Min(a.x, Mathf.Min(b.x, c.x))));
                int x1 = Mathf.Min(Size - 1, Mathf.CeilToInt(Mathf.Max(a.x, Mathf.Max(b.x, c.x))));
                int y0 = Mathf.Max(0, Mathf.FloorToInt(Mathf.Min(a.y, Mathf.Min(b.y, c.y))));
                int y1 = Mathf.Min(Size - 1, Mathf.CeilToInt(Mathf.Max(a.y, Mathf.Max(b.y, c.y))));
                float den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
                if (Mathf.Abs(den) < 1e-12f) continue;
                for (int y = y0; y <= y1; y++)
                for (int x = x0; x <= x1; x++)
                {
                    float w0 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den;
                    float w1 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den;
                    float w2 = 1 - w0 - w1;
                    if (w0 < -1e-4f || w1 < -1e-4f || w2 < -1e-4f) continue;
                    int i = y * Size + x;
                    px[i] = region[i0] * w0 + region[i1] * w1 + region[i2] * w2;
                    cov[i] = true;
                }
            }
            for (int step = 0; step < Dilate; step++)
            {
                var grow = new List<(int, Vector4)>();
                for (int y = 0; y < Size; y++)
                for (int x = 0; x < Size; x++)
                {
                    int i = y * Size + x;
                    if (cov[i]) continue;
                    Vector4 best = Vector4.zero;
                    bool any = false;
                    if (x > 0 && cov[i - 1]) { best = Vector4.Max(best, px[i - 1]); any = true; }
                    if (x < Size - 1 && cov[i + 1]) { best = Vector4.Max(best, px[i + 1]); any = true; }
                    if (y > 0 && cov[i - Size]) { best = Vector4.Max(best, px[i - Size]); any = true; }
                    if (y < Size - 1 && cov[i + Size]) { best = Vector4.Max(best, px[i + Size]); any = true; }
                    if (any) grow.Add((i, best));
                }
                foreach (var (i, v) in grow)
                {
                    px[i] = v;
                    cov[i] = true;
                }
            }
            var tex = new Texture2D(Size, Size, TextureFormat.RGBA32, false, true);
            var cols = new Color32[Size * Size];
            for (int i = 0; i < cols.Length; i++)
            {
                var v = px[i];
                cols[i] = new Color32((byte)(Mathf.Clamp01(v.x) * 255 + 0.5f), (byte)(Mathf.Clamp01(v.y) * 255 + 0.5f), (byte)(Mathf.Clamp01(v.z) * 255 + 0.5f),
                    (byte)(Mathf.Clamp01(v.w) * 255 + 0.5f));
            }
            tex.SetPixels32(cols);
            tex.Apply(false);
            return tex;
        }
    }
}
