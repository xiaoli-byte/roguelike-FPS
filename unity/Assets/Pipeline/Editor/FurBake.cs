using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// sidecar 的 fur 配置（registry.toml 的 [assets.&lt;ID&gt;.fur]，unity_export.py 原样带过来），缺省值按 kind 与身高给。
    /// 坐标（exclude 的 center）沿用 creature_rigs 的骨架坐标：缩放落地后的米制，front = -Y，生物的左 = +X，up = +Z。
    /// </summary>
    public sealed class FurSettings
    {
        public string kind;           // fur / feather
        public float length;          // 壳层最长处的毛长（米，遮罩 = 1 处）
        public float density;         // 每米发丝格数（绑定空间）
        public float thickness;       // 发丝半径（格）
        public float stretch;         // 发丝沿毛向拉长（< 1 越小越长）
        public float facing;          // 正对镜头的面只留长发丝的程度（0..1）
        public float comb, droop;     // 壳层顺毛梳 / 重力下垂
        public float flowDroop;       // 毛向本身往下偏多少（顺骨骼方向 + 重力）
        public int shells;            // 画质「高」的壳层数
        public bool fins;             // 轮廓发丝面片（画质「中」以上）
        public float detail, sheen, fuzz; // 画质「中」以上的着色细节强度
        public (Regex re, float mult)[] bones;
        public (Vector3 center, float radius)[] exclude; // 骨架坐标
        public (Vector3 min, Vector3 max)[] excludeBoxes; // 骨架坐标的长方体（鹿角、长角这类细长的部件）

        public bool IsFeather => kind == "feather";

        public static FurSettings From(ArtSidecar sc)
        {
            if (sc?.Fur is not JObject f) return null;
            float height = sc.DesignBounds?.size.y ?? 1f;
            bool feather = (string)f["kind"] == "feather";
            var s = new FurSettings
            {
                kind = feather ? "feather" : "fur",
                length = (float?)f["length"] ?? height * (feather ? 0.012f : 0.02f),
                thickness = (float?)f["thickness"] ?? (feather ? 0.3f : 0.27f),
                stretch = (float?)f["stretch"] ?? (feather ? 0.3f : 0.4f),
                facing = (float?)f["facing"] ?? 0.3f,
                comb = (float?)f["comb"] ?? (feather ? 1.2f : 0.8f),
                droop = (float?)f["droop"] ?? (feather ? 0.15f : 0.35f),
                flowDroop = (float?)f["flow_droop"] ?? 0.35f,
                shells = (int?)f["shells"] ?? (feather ? 10 : 16),
                fins = (bool?)f["fins"] ?? true,
                detail = (float?)f["detail"] ?? (feather ? 0.35f : 0.6f),
                sheen = (float?)f["sheen"] ?? (feather ? 0.3f : 0.18f),
                fuzz = (float?)f["fuzz"] ?? (feather ? 0.2f : 0.3f),
            };
            // 发丝格子约为毛长的 0.35 倍：毛越长、发丝越粗越稀，大怪不会被画成一层细绒
            s.density = (float?)f["density"] ?? 1f / (0.35f * Mathf.Max(0.002f, s.length));
            s.bones = (f["bones"] as JObject)?.Properties()
                .Select(p => (new Regex("^" + Regex.Escape(p.Name).Replace("\\*", ".*") + "$", RegexOptions.IgnoreCase), (float)p.Value))
                .ToArray() ?? new (Regex, float)[0];
            var ex = (f["exclude"] as JArray)?.OfType<JObject>().ToList() ?? new List<JObject>();
            s.exclude = ex.Where(e => e["center"] != null)
                .Select(e =>
                {
                    var c = e["center"]!.ToObject<float[]>();
                    return (new Vector3(c[0], c[1], c[2]), (float)e["radius"]);
                }).ToArray();
            s.excludeBoxes = ex.Where(e => e["min"] != null && e["max"] != null)
                .Select(e =>
                {
                    var a = e["min"]!.ToObject<float[]>();
                    var b = e["max"]!.ToObject<float[]>();
                    return (new Vector3(a[0], a[1], a[2]), new Vector3(b[0], b[1], b[2]));
                }).ToArray();
            return s;
        }

        public float BoneMultiplier(string bone)
        {
            float m = 1f;
            foreach (var (re, mult) in bones)
                if (re.IsMatch(bone)) m = mult; // 后写的覆盖先写的
            return m;
        }

        /// <summary>骨架坐标（Blender：front = -Y，左 = +X，up = +Z）→ 模型根空间（Unity：front = +Z，左 = -X，up = +Y）</summary>
        public static Vector3 RigToModel(Vector3 p) => new(-p.x, p.z, -p.y);
    }

    /// <summary>
    /// 导入时把毛向与毛发遮罩烘进蒙皮网格（ArtImportPostprocessor.OnPostprocessModel 调用，sidecar 没有 fur 配置的不动）：
    ///   UV2.xyz = 绑定姿势下的位置（模型根空间）：着色器的发丝图案贴在皮肤上，动画时不游走；各级 LOD 同一空间，交叉淡化时图案对得上。
    ///   UV3 = (毛向在切线 T 上的分量, 在副切线 B 上的分量, 遮罩, 0)：切线随蒙皮转动，毛向自然跟着骨骼走。
    ///   UV4.xyz = 绑定空间的毛向：发丝图案沿它拉长成顺毛的短线（只在绑定空间里算，不随动画变）。
    /// 毛向 = 顶点的蒙皮权重加权各骨骼方向：躯干、颈、头这一组（hips / spine / chest / neck / head / body）反过来，毛往后、往下顺；
    /// 四肢、尾巴、耳朵、翅膀沿骨骼方向顺到末端；再往下偏一点（重力），投影到切平面。
    /// 遮罩 = 权重加权的每骨倍数（fur.bones，通配符；0 = 不长毛，如爪、蹄、喙）× 排除球（fur.exclude，眼睛等）的软边。
    /// </summary>
    public static class FurBake
    {
        /// <summary>烘焙算法版本：改了毛向 / 遮罩 / fins 的算法就加一，有毛发的资产在下次 Sync 时重新导入</summary>
        public const int Version = 4;
        public const string FinsSuffix = "_FurFins";

        static readonly Regex Axial = new(@"^(root|hips|pelvis|spine_?\d?|chest|waist|torso|body|abdomen(_?\d+)?|neck(_?\d+)?|head)$",
            RegexOptions.IgnoreCase);

        public static int Apply(GameObject model, FurSettings cfg, string assetId, AssetImportContext ctx)
        {
            int baked = 0;
            SkinnedMeshRenderer finSource = null;
            List<Vector4> finFur = null;
            foreach (var smr in model.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mesh = smr.sharedMesh;
                if (!mesh || smr.name.Contains("GlowShell") || smr.name.EndsWith(FinsSuffix) || smr.bones.Length == 0) continue;
                var fur = Bake(model.transform, smr, mesh, cfg);
                baked++;
                // fins 按 LOD1 的边生成（边数约为 LOD0 的 40%，每片更长、发丝更多，轮廓照样连续）；没有 LOD1 就用 LOD0
                if (smr.name.EndsWith("_LOD1") || (finSource == null && smr.name.EndsWith("_LOD0")))
                {
                    finSource = smr;
                    finFur = fur;
                }
            }
            if (cfg.fins && finSource != null) BuildFins(finSource, finFur, cfg, assetId, ctx);
            if (baked == 0) Debug.LogWarning($"[Art] {assetId}: 有 fur 配置，但没有找到蒙皮网格");
            else Debug.Log($"[fur] {assetId}: {string.Join("；", Log)}");
            Log.Clear();
            return baked;
        }

        static readonly List<string> Log = new();

        /// <summary>绑定姿势烘焙的版本：改了 <see cref="ApplyRestPose"/> 就加一，没有毛发的角色在下次 Sync 时重新导入</summary>
        public const int RestPoseVersion = 1;

        /// <summary>
        /// 没有 fur 配置的角色也烘 UV2.xyz = 绑定姿势下的位置（模型根空间，和 <see cref="Apply"/> 写的同一套）：
        /// 状态皮（SF_FxStatusSkin）的冰晶切面 / 蚀斑按它算，贴在皮肤上——不被网格 uv 的图集岛缝切出直边，动画、转身时也不游走。
        /// 只写 UV2，UV3 / UV4 留空（StylizedLit 的毛发段只在有毛发的材质上开）。
        /// </summary>
        public static int ApplyRestPose(GameObject model)
        {
            int baked = 0;
            foreach (var smr in model.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mesh = smr.sharedMesh;
                if (!mesh || smr.name.Contains("GlowShell") || smr.bones.Length == 0) continue;
                var toModel = model.transform.worldToLocalMatrix * smr.transform.localToWorldMatrix;
                var verts = mesh.vertices;
                var bind = new List<Vector3>(verts.Length);
                foreach (var p in verts) bind.Add(toModel.MultiplyPoint3x4(p));
                mesh.SetUVs(2, bind);
                baked++;
            }
            return baked;
        }

        static List<Vector4> Bake(Transform model, SkinnedMeshRenderer smr, Mesh mesh, FurSettings cfg)
        {
            var bones = smr.bones;
            int nb = bones.Length;
            var toModel = model.worldToLocalMatrix * smr.transform.localToWorldMatrix;
            var head = new Vector3[nb];
            for (int j = 0; j < nb; j++) head[j] = bones[j] ? model.InverseTransformPoint(bones[j].position) : Vector3.zero;

            // 骨骼方向：有子骨骼的用「头 → 子骨骼头的平均」；叶子骨骼用骨骼自身的局部轴——哪根轴由有子骨骼的骨骼统计出来
            //（Blender 导出 primary_bone_axis = Y，但 Unity 的轴向转换可能翻转它，所以不写死）
            var index = new Dictionary<Transform, int>();
            for (int j = 0; j < nb; j++) if (bones[j]) index[bones[j]] = j;
            var dir = new Vector3[nb];
            var leaf = new bool[nb];
            var axes = new[] { Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back };
            var axisScore = new float[6];
            for (int j = 0; j < nb; j++)
            {
                if (!bones[j]) { leaf[j] = true; continue; }
                var kids = bones[j].Cast<Transform>().Where(index.ContainsKey).ToList();
                if (kids.Count == 0) { leaf[j] = true; continue; }
                var tail = kids.Aggregate(Vector3.zero, (a, k) => a + head[index[k]]) / kids.Count;
                var d = tail - head[j];
                if (d.sqrMagnitude < 1e-10f) { leaf[j] = true; continue; }
                dir[j] = d.normalized;
                for (int a = 0; a < 6; a++)
                    axisScore[a] += Vector3.Dot(model.InverseTransformDirection(bones[j].TransformDirection(axes[a])).normalized, dir[j]);
            }
            var boneAxis = axes[System.Array.IndexOf(axisScore, axisScore.Max())];
            for (int j = 0; j < nb; j++)
                if (leaf[j] && bones[j])
                    dir[j] = model.InverseTransformDirection(bones[j].TransformDirection(boneAxis)).normalized;
            var flowDir = new Vector3[nb];
            var mult = new float[nb];
            for (int j = 0; j < nb; j++)
            {
                string n = bones[j] ? bones[j].name : "";
                flowDir[j] = Axial.IsMatch(n) ? -dir[j] : dir[j];
                mult[j] = cfg.BoneMultiplier(n);
            }
            var exclude = cfg.exclude.Select(e => (FurSettings.RigToModel(e.center), e.radius)).ToArray();
            // 长方体：两个角换到模型空间后重新取最小 / 最大（轴向换算带符号翻转，但仍是轴对齐的）
            var boxes = cfg.excludeBoxes.Select(e =>
            {
                var a = FurSettings.RigToModel(e.min);
                var b = FurSettings.RigToModel(e.max);
                return new Bounds((a + b) * 0.5f, new Vector3(Mathf.Abs(a.x - b.x), Mathf.Abs(a.y - b.y), Mathf.Abs(a.z - b.z)));
            }).ToArray();

            var verts = mesh.vertices;
            var normals = mesh.normals;
            if (mesh.tangents.Length != verts.Length) mesh.RecalculateTangents();
            var tangents = mesh.tangents;
            var weights = mesh.boneWeights;
            int nv = verts.Length;
            var bind = new List<Vector3>(nv);
            var fur = new List<Vector4>(nv);
            var flowBind = new List<Vector3>(nv);
            float maskSum = 0f, tbSum = 0f;
            int bare = 0;
            for (int v = 0; v < nv; v++)
            {
                var p = toModel.MultiplyPoint3x4(verts[v]);
                var n = toModel.MultiplyVector(normals[v]).normalized;
                var t4 = tangents[v];
                var t = toModel.MultiplyVector(new Vector3(t4.x, t4.y, t4.z)).normalized;
                var b = Vector3.Cross(n, t) * (t4.w < 0 ? -1f : 1f);

                var w = weights[v];
                Vector3 f = Vector3.zero;
                float m = 0f, wsum = 0f;
                void Acc(int bi, float wt)
                {
                    if (wt <= 0f || bi < 0 || bi >= nb) return;
                    f += flowDir[bi] * wt;
                    m += mult[bi] * wt;
                    wsum += wt;
                }
                Acc(w.boneIndex0, w.weight0); Acc(w.boneIndex1, w.weight1); Acc(w.boneIndex2, w.weight2); Acc(w.boneIndex3, w.weight3);
                m = wsum > 0f ? m / wsum : 1f;
                foreach (var (c, r) in exclude)
                    m *= Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(r * 0.6f, r, Vector3.Distance(p, c)));
                // 长方体外 2 厘米内渐变
                foreach (var bx in boxes)
                    m *= Mathf.SmoothStep(0f, 1f, Mathf.Sqrt(bx.SqrDistance(p)) / 0.02f);

                f = f.normalized + Vector3.down * cfg.flowDroop;
                f -= n * Vector3.Dot(f, n);
                if (f.sqrMagnitude < 1e-8f)
                {
                    f = Vector3.down - n * Vector3.Dot(Vector3.down, n);
                    if (f.sqrMagnitude < 1e-8f) f = t;
                }
                f.Normalize();
                bind.Add(p);
                flowBind.Add(f);
                float ft = Vector3.Dot(f, t), fb = Vector3.Dot(f, b);
                fur.Add(new Vector4(ft, fb, Mathf.Clamp01(m), 0f));
                maskSum += Mathf.Clamp01(m);
                tbSum += Mathf.Sqrt(ft * ft + fb * fb);
                if (m < 0.1f) bare++;
            }
            mesh.SetUVs(2, bind);
            mesh.SetUVs(3, fur);
            mesh.SetUVs(4, flowBind);
            // 核对用：遮罩均值、无毛顶点比例、毛向在切平面里的长度（应接近 1）、叶子骨骼用的局部轴、头骨在模型空间的位置（对照骨架坐标）
            int hi = System.Array.FindIndex(bones, x => x && x.name == "head");
            Log.Add($"{smr.name} {nv} 顶点，遮罩均值 {maskSum / nv:F2}，无毛 {bare * 100f / nv:F0}%，|毛向TB| {tbSum / nv:F2}，叶骨轴 {boneAxis}" +
                    (hi >= 0 ? $"，head {head[hi]:F3}" : ""));
            return fur;
        }

        /// <summary>
        /// 轮廓发丝面片（Lengyel 2001 的 fins）：网格的每条边（按位置焊接后去重，遮罩均值 ≥ 0.12）竖一片四边形，
        /// 根在边上、梢由着色器沿法线推出。四个顶点沿用边两端顶点的蒙皮权重、法线、切线、贴图 UV 与毛发数据，
        /// 所以面片跟着骨骼动；面片法线存成在端点 (T, B, N) 上的分量（UV2），着色器里用蒙皮后的切线框架还原，按它与视线的
        /// 夹角只在轮廓附近显示。UV1 = (沿边的位置（米，每条边随机起点）, 0 根 / 1 梢)。生成的网格挂在 &lt;ID&gt;_FurFins 上，
        /// 作为模型资产的子资产保存；Prefab 把它放进 LOD0 组，FurShells 按画质开关。
        /// </summary>
        static void BuildFins(SkinnedMeshRenderer src, List<Vector4> fur, FurSettings cfg, string assetId, AssetImportContext ctx)
        {
            var mesh = src.sharedMesh;
            var verts = mesh.vertices;
            var normals = mesh.normals;
            var tangents = mesh.tangents;
            var uvs = mesh.uv;
            var weights = mesh.boneWeights;
            var tris = mesh.triangles;
            var canon = new int[verts.Length];
            var seen = new Dictionary<Vector3Int, int>();
            for (int v = 0; v < verts.Length; v++)
            {
                var k = Vector3Int.RoundToInt(verts[v] * 1e4f);
                if (!seen.TryGetValue(k, out canon[v])) seen[k] = canon[v] = v;
            }
            var edges = new Dictionary<(int, int), (int a, int b)>();
            for (int i = 0; i < tris.Length; i += 3)
                for (int e = 0; e < 3; e++)
                {
                    int a = tris[i + e], b = tris[i + (e + 1) % 3];
                    int ca = canon[a], cb = canon[b];
                    if (ca == cb) continue;
                    var key = ca < cb ? (ca, cb) : (cb, ca);
                    if (!edges.ContainsKey(key)) edges[key] = (a, b);
                }
            var pos = new List<Vector3>(); var nrm = new List<Vector3>(); var tan = new List<Vector4>();
            var uv0 = new List<Vector2>(); var uv1 = new List<Vector2>(); var uv2 = new List<Vector4>(); var uv3 = new List<Vector4>();
            var bw = new List<BoneWeight>(); var idx = new List<int>();
            foreach (var kv in edges)
            {
                var (a, b) = kv.Value;
                // 两端都要有毛：一端落在眼睛 / 鹿角排除区里的边不竖面片（否则半片发丝会盖到眼睛上）
                if (Mathf.Min(fur[a].z, fur[b].z) < 0.25f) continue;
                var pa = verts[a];
                var pb = verts[b];
                float len = (pb - pa).magnitude;
                if (len < 1e-5f) continue;
                var fn = Vector3.Cross(pb - pa, (normals[a] + normals[b]).normalized).normalized;
                // 每条边一个随机起点（米）：相邻面片的发丝不会排成一样的图案
                float u0 = Mathf.Repeat(Mathf.Sin(kv.Key.Item1 * 12.9898f + kv.Key.Item2 * 78.233f) * 43758.5453f, 1f) * 8f;
                int baseIndex = pos.Count;
                foreach (var (v, u) in new[] { (a, u0), (b, u0 + len) })
                    for (int tip = 0; tip < 2; tip++)
                    {
                        var t4 = tangents[v];
                        var t = new Vector3(t4.x, t4.y, t4.z);
                        var n = normals[v];
                        var bt = Vector3.Cross(n, t) * (t4.w < 0 ? -1f : 1f);
                        pos.Add(verts[v]); nrm.Add(n); tan.Add(t4); uv0.Add(uvs[v]);
                        uv1.Add(new Vector2(u, tip));
                        uv2.Add(new Vector4(Vector3.Dot(fn, t), Vector3.Dot(fn, bt), Vector3.Dot(fn, n), 0f));
                        uv3.Add(fur[v]); bw.Add(weights[v]);
                    }
                // 顶点顺序：a 根、a 梢、b 根、b 梢
                idx.AddRange(new[] { baseIndex, baseIndex + 2, baseIndex + 3, baseIndex, baseIndex + 3, baseIndex + 1 });
            }
            if (pos.Count == 0) return;
            var fins = new Mesh { name = assetId + FinsSuffix };
            if (pos.Count > 65000) fins.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            fins.SetVertices(pos); fins.SetNormals(nrm); fins.SetTangents(tan);
            fins.SetUVs(0, uv0); fins.SetUVs(1, uv1); fins.SetUVs(2, uv2); fins.SetUVs(3, uv3);
            fins.boneWeights = bw.ToArray();
            fins.bindposes = mesh.bindposes;
            fins.SetTriangles(idx, 0);
            var bounds = mesh.bounds;
            bounds.Expand(cfg.length * 4f);
            fins.bounds = bounds;
            ctx.AddObjectToAsset(fins.name, fins);

            var go = new GameObject(assetId + FinsSuffix);
            go.transform.SetParent(src.transform.parent, false);
            go.transform.SetLocalPositionAndRotation(src.transform.localPosition, src.transform.localRotation);
            go.transform.localScale = src.transform.localScale;
            var r = go.AddComponent<SkinnedMeshRenderer>();
            r.sharedMesh = fins;
            r.bones = src.bones;
            r.rootBone = src.rootBone;
            var lb = src.localBounds;
            lb.Expand(cfg.length * 4f);
            r.localBounds = lb;
            Log.Add($"fins：{edges.Count} 条边中 {idx.Count / 6} 片（取自 {src.name}）");
        }
    }
}
