using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// Unity 侧自动 QA（✘ 错误阻塞 / ⚠ 警告记录），检查管线转换后在引擎里是否仍与设计一致：
    /// 尺寸与朝向（导入包围盒 vs 设计包围盒，人形左手在 −X、脚尖朝 +Z）、各级 LOD 面数预算、
    /// 人形 Avatar 有效、材质 / 贴图齐全且导入类型正确。报告写到 Assets/Art/_Review/validation.json。
    /// </summary>
    public static class ArtValidator
    {
        public const string ReportPath = "Assets/Art/_Review/validation.json";

        public sealed class Result
        {
            public string id;
            public List<string> errors = new();
            public List<string> warnings = new();
            public Dictionary<string, object> metrics = new();
        }

        public static List<Result> ValidateAll(IEnumerable<ArtSidecar> sidecars)
        {
            var results = sidecars.Select(Validate).ToList();
            Directory.CreateDirectory(Path.GetDirectoryName(ReportPath)!);
            File.WriteAllText(ReportPath, JsonConvert.SerializeObject(results, Formatting.Indented));
            int e = results.Sum(r => r.errors.Count), w = results.Sum(r => r.warnings.Count);
            foreach (var r in results.Where(r => r.errors.Count + r.warnings.Count > 0))
            {
                string msg = $"[Art QA] {r.id}\n" + string.Join("\n", r.errors.Select(x => "  ✘ " + x).Concat(r.warnings.Select(x => "  ⚠ " + x)));
                if (r.errors.Count > 0) Debug.LogError(msg); else Debug.LogWarning(msg);
            }
            Debug.Log($"[Art QA] {results.Count} 个资产：{results.Count(r => r.errors.Count == 0)} 通过，错误 {e}，警告 {w}。报告 {ReportPath}");
            return results;
        }

        static int Tris(Mesh m)
        {
            int n = 0;
            for (int i = 0; i < m.subMeshCount; i++) n += (int)m.GetIndexCount(i) / 3;
            return n;
        }

        /// <summary>
        /// 渲染器在根空间里的实际包围盒。蒙皮网格的导入包围盒会按骨骼外扩，不能用来比尺寸：
        /// 按绑定姿势烘焙出顶点再算。
        /// </summary>
        static Bounds MeasuredBounds(Renderer r, Transform root)
        {
            Vector3[] verts;
            Matrix4x4 toRoot;
            if (r is SkinnedMeshRenderer smr)
            {
                var baked = new Mesh();
                smr.BakeMesh(baked, true);
                verts = baked.vertices;
                Object.DestroyImmediate(baked);
                toRoot = root.worldToLocalMatrix * Matrix4x4.TRS(smr.transform.position, smr.transform.rotation, Vector3.one);
            }
            else
            {
                verts = r.GetComponent<MeshFilter>().sharedMesh.vertices;
                toRoot = root.worldToLocalMatrix * r.transform.localToWorldMatrix;
            }
            var b = new Bounds(toRoot.MultiplyPoint3x4(verts[0]), Vector3.zero);
            foreach (var v in verts) b.Encapsulate(toRoot.MultiplyPoint3x4(v));
            return b;
        }

        static void ValidateWeapon(ArtSidecar sc, GameObject inst, Result res)
        {
            var sockets = inst.GetComponent<WeaponSockets>();
            if (!sockets)
            {
                res.errors.Add("武器 Prefab 没有 WeaponSockets（零件 / 挂点没生成）");
                return;
            }
            var parts = sc.Weapon["parts"] as Newtonsoft.Json.Linq.JObject;
            foreach (var p in parts?.Properties() ?? Enumerable.Empty<Newtonsoft.Json.Linq.JProperty>())
                if (!sockets.Part(p.Name)) res.errors.Add($"语义零件 {p.Name}（骨骼 {(string)p.Value}）不在 Prefab 里");
            var design = sc.DesignBounds;
            var slack = design.HasValue ? new Bounds(design.Value.center, design.Value.size + Vector3.one * 0.12f) : (Bounds?)null;
            int found = 0;
            foreach (var name in WeaponSockets.SocketNames)
            {
                var t = sockets.Socket(name);
                if (!t)
                {
                    res.errors.Add($"缺挂点 {name}");
                    continue;
                }
                found++;
                var local = inst.transform.InverseTransformPoint(t.position);
                // 瞄准点在视线上，偏右开镜的枪（榴弹、机炮……）会在枪身左边一点；其余挂点都应贴着枪身
                if (slack.HasValue && name != WeaponSockets.Sight && !slack.Value.Contains(local))
                    res.warnings.Add($"挂点 {name} {local} 离枪身太远（设计包围盒外 6 cm 以上）");
            }
            res.metrics["sockets"] = found;
            res.metrics["parts"] = sockets.partNames;
        }

        public static Result Validate(ArtSidecar sc)
        {
            var res = new Result { id = sc.Id };
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(sc.FbxPath);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(sc.PrefabPath);
            if (!model) { res.errors.Add($"模型未导入：{sc.FbxPath}"); return res; }
            if (!prefab) { res.errors.Add($"Prefab 未生成：{sc.PrefabPath}"); return res; }

            // 贴图
            foreach (var m in sc.Materials)
            foreach (var kv in (Newtonsoft.Json.Linq.JObject)m["textures"])
            {
                string path = $"{sc.Dir}/{(string)kv.Value}";
                var ti = AssetImporter.GetAtPath(path) as TextureImporter;
                if (!ti) { res.errors.Add($"贴图缺失：{path}"); continue; }
                if (kv.Key == "N" && ti.textureType != TextureImporterType.NormalMap) res.errors.Add($"{path} 不是法线贴图类型");
                if (kv.Key == "ORM" && ti.sRGBTexture) res.errors.Add($"{path} 应为线性（关闭 sRGB）");
                var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
                if (tex && Mathf.Max(tex.width, tex.height) > sc.BudgetTexture)
                    res.warnings.Add($"{Path.GetFileName(path)} {tex.width}² 超过规格 {sc.BudgetTexture}²");
            }

            // 面数（Unity 三角化后的实际面数）：只记录、不设预算——2026-10-25 起不减面，面数就是来源网格自己的
            var lodTris = new SortedDictionary<int, int>();
            foreach (var info in sc.Meshes)
            {
                int? lod = (int?)info["lod"];
                if (lod == null) continue;
                var t = model.GetComponentsInChildren<Transform>(true).FirstOrDefault(x => x.name == (string)info["name"]);
                // Unity 的「缺失组件」是假 null，不能用 ?. / ??
                Mesh mesh = null;
                if (t && t.TryGetComponent<SkinnedMeshRenderer>(out var smr)) mesh = smr.sharedMesh;
                else if (t && t.TryGetComponent<MeshFilter>(out var mf)) mesh = mf.sharedMesh;
                if (!mesh) { res.errors.Add($"导入后缺少网格 {(string)info["name"]}"); continue; }
                lodTris[lod.Value] = Tris(mesh);
            }
            res.metrics["lodTris"] = lodTris.Values.ToArray();
            var keys = lodTris.Keys.ToList();
            for (int i = 1; i < keys.Count; i++)
                if (lodTris[keys[i]] > lodTris[keys[i - 1]]) res.errors.Add($"LOD{keys[i]} 面数没有逐级递减");

            // 材质
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            try
            {
                foreach (var r in inst.GetComponentsInChildren<Renderer>(true))
                {
                    if (r.sharedMaterials.Any(m => !m)) res.errors.Add($"{r.name} 有空材质槽");
                    else if (r.sharedMaterials.Any(m => m.shader.name != ArtPrefabBuilder.ShaderName &&
                                                        m.shader.name != ArtPrefabBuilder.FurFinShaderName))
                        res.errors.Add($"{r.name} 没有使用 {ArtPrefabBuilder.ShaderName}");
                }

                // 尺寸：导入后 LOD0 的包围盒 vs 设计包围盒（人形 T-pose 后手臂外展，只比高度）
                var design = sc.DesignBounds;
                var lod0 = inst.GetComponentsInChildren<Renderer>(true)
                    .Where(r => (int?)sc.MeshInfo(r.name)?["lod"] == 0).ToList();
                if (design.HasValue && lod0.Count > 0)
                {
                    var b = MeasuredBounds(lod0[0], inst.transform);
                    foreach (var r in lod0.Skip(1)) b.Encapsulate(MeasuredBounds(r, inst.transform));
                    var d = design.Value;
                    res.metrics["importedSize"] = new[] { b.size.x, b.size.y, b.size.z };
                    res.metrics["designSize"] = new[] { d.size.x, d.size.y, d.size.z };
                    float dh = Mathf.Abs(b.size.y - d.size.y) / Mathf.Max(0.01f, d.size.y);
                    if (dh > 0.05f) res.errors.Add($"高度 {b.size.y:F2} m 与设计 {d.size.y:F2} m 相差 {dh:P0}（单位或轴向错误？）");
                    if (!sc.IsHumanoid)
                        for (int a = 0; a < 3; a += 2)
                        {
                            float tol = Mathf.Max(0.05f * d.size[a], 0.03f);
                            if (Mathf.Abs(b.size[a] - d.size[a]) > tol)
                                res.warnings.Add($"{"XYZ"[a]} 向尺寸 {b.size[a]:F2} m 与设计 {d.size[a]:F2} m 不一致");
                            if (Mathf.Abs(b.center[a] - d.center[a]) > tol)
                                res.errors.Add($"{"XYZ"[a]} 向中心 {b.center[a]:F2} 与设计 {d.center[a]:F2} 不一致（左右 / 前后翻转？）");
                        }
                }

                // 第一人称武器（W3）：语义零件骨骼都在、六个挂点齐全且在设计包围盒附近
                if (sc.Weapon != null) ValidateWeapon(sc, inst, res);

                // 人形：Avatar 有效；左手在 −X、脚尖在脚跟前方（朝 +Z）；T-pose 下上臂水平
                if (sc.IsHumanoid)
                {
                    var animator = inst.GetComponentInChildren<Animator>();
                    var avatar = animator ? animator.avatar : null;
                    if (!avatar || !avatar.isValid || !avatar.isHuman) res.errors.Add("人形 Avatar 无效");
                    else
                    {
                        var lh = animator.GetBoneTransform(HumanBodyBones.LeftHand);
                        var rh = animator.GetBoneTransform(HumanBodyBones.RightHand);
                        if (lh && rh && lh.position.x >= rh.position.x) res.errors.Add("左手不在 −X 一侧（左右翻转）");
                        var foot = animator.GetBoneTransform(HumanBodyBones.LeftFoot);
                        var toe = animator.GetBoneTransform(HumanBodyBones.LeftToes);
                        if (foot && toe && toe.position.z <= foot.position.z) res.errors.Add("脚尖不朝 +Z（角色朝向错误）");
                        var ua = animator.GetBoneTransform(HumanBodyBones.LeftUpperArm);
                        var la = animator.GetBoneTransform(HumanBodyBones.LeftLowerArm);
                        if (ua && la)
                        {
                            var dir = (la.position - ua.position).normalized;
                            float drop = Mathf.Asin(Mathf.Clamp(-dir.y, -1, 1)) * Mathf.Rad2Deg;
                            res.metrics["upperArmDropDeg"] = drop;
                            if (Mathf.Abs(drop) > 8f) res.warnings.Add($"上臂与水平面夹角 {drop:F1}°，不是 T-pose，重定向动画手臂会偏");
                        }
                        res.metrics["humanBones"] = avatar.humanDescription.human.Length;
                    }
                    if (animator && !animator.runtimeAnimatorController) res.warnings.Add("没有 Animator 控制器");
                }
            }
            finally
            {
                Object.DestroyImmediate(inst);
            }
            return res;
        }
    }
}
