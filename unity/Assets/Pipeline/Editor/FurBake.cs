using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
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
        public float detail, sheen, fuzz; // 画质「中」以上的着色细节强度
        public (Regex re, float mult)[] bones;
        public (Vector3 center, float radius)[] exclude; // 骨架坐标

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
                facing = (float?)f["facing"] ?? 0.6f,
                comb = (float?)f["comb"] ?? (feather ? 1.2f : 0.8f),
                droop = (float?)f["droop"] ?? (feather ? 0.15f : 0.35f),
                flowDroop = (float?)f["flow_droop"] ?? 0.35f,
                shells = (int?)f["shells"] ?? (feather ? 6 : 10),
                detail = (float?)f["detail"] ?? (feather ? 0.35f : 0.6f),
                sheen = (float?)f["sheen"] ?? (feather ? 0.3f : 0.18f),
                fuzz = (float?)f["fuzz"] ?? (feather ? 0.25f : 0.45f),
            };
            // 发丝格子约为毛长的 0.5 倍：毛越长、发丝越粗越稀，大怪不会被画成一层细绒
            s.density = (float?)f["density"] ?? 1f / (0.5f * Mathf.Max(0.002f, s.length));
            s.bones = (f["bones"] as JObject)?.Properties()
                .Select(p => (new Regex("^" + Regex.Escape(p.Name).Replace("\\*", ".*") + "$", RegexOptions.IgnoreCase), (float)p.Value))
                .ToArray() ?? new (Regex, float)[0];
            s.exclude = (f["exclude"] as JArray)?.OfType<JObject>()
                .Select(e =>
                {
                    var c = e["center"]!.ToObject<float[]>();
                    return (new Vector3(c[0], c[1], c[2]), (float)e["radius"]);
                }).ToArray() ?? new (Vector3, float)[0];
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
        /// <summary>烘焙算法版本：改了毛向 / 遮罩的算法就加一，有毛发的资产在下次 Sync 时重新导入</summary>
        public const int Version = 2;

        static readonly Regex Axial = new(@"^(root|hips|pelvis|spine_?\d?|chest|waist|torso|body|abdomen(_?\d+)?|neck(_?\d+)?|head)$",
            RegexOptions.IgnoreCase);

        public static int Apply(GameObject model, FurSettings cfg, string assetId)
        {
            int baked = 0;
            foreach (var smr in model.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mesh = smr.sharedMesh;
                if (!mesh || smr.name.Contains("GlowShell") || smr.bones.Length == 0) continue;
                Bake(model.transform, smr, mesh, cfg);
                baked++;
            }
            if (baked == 0) Debug.LogWarning($"[Art] {assetId}: 有 fur 配置，但没有找到蒙皮网格");
            else Debug.Log($"[fur] {assetId}: {string.Join("；", Log)}");
            Log.Clear();
            return baked;
        }

        static readonly List<string> Log = new();

        static void Bake(Transform model, SkinnedMeshRenderer smr, Mesh mesh, FurSettings cfg)
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
        }
    }
}
