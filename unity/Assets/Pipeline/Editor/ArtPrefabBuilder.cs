using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 由 sidecar 生成材质与 Prefab。两者都是生成物：每次 Sync 覆盖，风格参数改 <see cref="StylePreset"/>，不手调材质。
    /// Prefab 结构：根（ArtAssetInfo、LODGroup、碰撞体）→ 模型层级（Animator、各级 LOD 渲染器、骨骼）。
    /// </summary>
    public static class ArtPrefabBuilder
    {
        public const string ShaderName = "Spiritfire/StylizedLit";
        const float ReferenceFov = 70f; // LOD 距离换算屏幕高度时的参考竖直视角

        /// <summary>按类别的风格化光照参数：角色边缘光更强、场景件暗部更暖、枪械高光更亮。</summary>
        public readonly struct StylePreset
        {
            public readonly Color shadowTint, rimColor;
            public readonly float rampThreshold, rampSoftness, shadowLift, ambient, spec, specSize, rimPower, rimStrength;

            public StylePreset(Color shadowTint, float rampThreshold, float rampSoftness, float shadowLift, float ambient,
                float spec, float specSize, Color rimColor, float rimPower, float rimStrength)
            {
                this.shadowTint = shadowTint; this.rampThreshold = rampThreshold; this.rampSoftness = rampSoftness;
                this.shadowLift = shadowLift; this.ambient = ambient; this.spec = spec; this.specSize = specSize;
                this.rimColor = rimColor; this.rimPower = rimPower; this.rimStrength = rimStrength;
            }

            public static StylePreset For(string category) => category switch
            {
                "characters" => new StylePreset(new Color(0.58f, 0.6f, 0.86f), 0.05f, 0.16f, 0.2f, 1.0f, 0.45f, 0.12f,
                    new Color(1f, 0.92f, 0.78f), 3.2f, 0.45f),
                "weapons" or "attachments" => new StylePreset(new Color(0.6f, 0.62f, 0.82f), 0.0f, 0.2f, 0.18f, 1.0f, 0.85f, 0.16f,
                    new Color(1f, 0.95f, 0.85f), 3.5f, 0.3f),
                _ => new StylePreset(new Color(0.66f, 0.62f, 0.82f), 0.02f, 0.22f, 0.2f, 1.0f, 0.25f, 0.1f,
                    new Color(1f, 0.9f, 0.75f), 4f, 0.18f),
            };
        }

        static Shader shader;
        static Shader Shader => shader ? shader : shader = UnityEngine.Shader.Find(ShaderName);

        static Texture2D LoadTex(ArtSidecar sc, JObject textures, string role)
        {
            string rel = (string)textures?[role];
            return string.IsNullOrEmpty(rel) ? null : AssetDatabase.LoadAssetAtPath<Texture2D>($"{sc.Dir}/{rel}");
        }

        static Color Linear(JToken arr, Color fallback)
        {
            if (arr is not JArray a || a.Count < 3) return fallback;
            // glTF 的因子是线性值；Unity 材质颜色按 gamma 存储，写入前转换
            var c = new Color((float)a[0], (float)a[1], (float)a[2], a.Count > 3 ? (float)a[3] : 1f);
            return c.gamma;
        }

        public static bool IsGlow(string materialName) => materialName.Contains("_Glow");

        public static Material BuildMaterial(ArtSidecar sc, JObject m)
        {
            string name = (string)m["name"];
            string path = sc.MaterialAssetPath(name);
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (!mat)
            {
                mat = new Material(Shader) { name = name };
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = Shader;
            mat.shaderKeywords = new string[0];
            var tex = (JObject)m["textures"];
            var p = StylePreset.For(sc.Category);

            mat.SetTexture("_BaseMap", LoadTex(sc, tex, "BC"));
            mat.SetColor("_BaseColor", Linear(m["baseColor"], Color.white));
            mat.SetColor("_Tint", Color.white);

            var n = LoadTex(sc, tex, "N");
            mat.SetTexture("_BumpMap", n);
            mat.SetFloat("_BumpScale", 1f);
            if (n) mat.EnableKeyword("_NORMALMAP");

            var orm = LoadTex(sc, tex, "ORM");
            mat.SetTexture("_ORMMap", orm);
            if (orm) mat.EnableKeyword("_ORMMAP");
            mat.SetFloat("_Metallic", (float?)m["metallic"] ?? 0f);
            mat.SetFloat("_Roughness", (float?)m["roughness"] ?? 1f);
            mat.SetFloat("_OcclusionStrength", (bool?)m["hasOcclusion"] == true ? 1f : 0f);

            var e = LoadTex(sc, tex, "E");
            var emissive = Linear(m["emissive"], Color.black);
            mat.SetTexture("_EmissionMap", e);
            mat.SetColor("_EmissionColor", e ? emissive * 1.6f : Color.black);
            if (e && emissive.maxColorComponent > 0) mat.EnableKeyword("_EMISSION");
            mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.EmissiveIsBlack;

            mat.SetColor("_ShadowTint", p.shadowTint);
            mat.SetFloat("_RampThreshold", p.rampThreshold);
            mat.SetFloat("_RampSoftness", p.rampSoftness);
            mat.SetFloat("_ShadowLift", p.shadowLift);
            mat.SetFloat("_AmbientStrength", p.ambient);
            mat.SetFloat("_SpecStrength", p.spec);
            mat.SetFloat("_SpecSize", p.specSize);
            mat.SetColor("_RimColor", p.rimColor);
            mat.SetFloat("_RimPower", p.rimPower);
            mat.SetFloat("_RimStrength", p.rimStrength);
            mat.SetFloat("_FlashAmount", 0f);

            mat.SetFloat("_Cull", (bool?)m["doubleSided"] == true ? (float)CullMode.Off : (float)CullMode.Back);
            string alphaMode = (string)m["alphaMode"] ?? "OPAQUE";
            if (IsGlow(name))
            {
                // 发光壳：叠加混合、不写深度、不投影（对应 Three.js 版的加法发光件）
                mat.EnableKeyword("_ADDITIVE");
                mat.SetFloat("_SrcBlend", (float)BlendMode.One);
                mat.SetFloat("_DstBlend", (float)BlendMode.One);
                mat.SetFloat("_ZWrite", 0f);
                mat.SetOverrideTag("RenderType", "Transparent");
                mat.renderQueue = (int)RenderQueue.Transparent;
                if (!e) mat.SetColor("_BaseColor", Color.white);
                mat.SetShaderPassEnabled("ShadowCaster", false);
                mat.SetShaderPassEnabled("DepthOnly", false);
                mat.SetShaderPassEnabled("DepthNormals", false);
            }
            else
            {
                mat.SetFloat("_SrcBlend", (float)BlendMode.One);
                mat.SetFloat("_DstBlend", (float)BlendMode.Zero);
                mat.SetFloat("_ZWrite", 1f);
                mat.SetOverrideTag("RenderType", alphaMode == "MASK" ? "TransparentCutout" : "Opaque");
                if (alphaMode == "MASK")
                {
                    mat.EnableKeyword("_ALPHATEST_ON");
                    mat.SetFloat("_Cutoff", (float?)m["alphaCutoff"] ?? 0.5f);
                    mat.renderQueue = (int)RenderQueue.AlphaTest;
                }
                else mat.renderQueue = -1;
                mat.SetShaderPassEnabled("ShadowCaster", true);
                mat.SetShaderPassEnabled("DepthOnly", true);
                mat.SetShaderPassEnabled("DepthNormals", true);
            }
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>LOD 切换距离（米）→ LODGroup 的屏幕相对高度。</summary>
        static float ScreenHeight(float size, float distance) =>
            Mathf.Clamp01(size / (2f * Mathf.Max(0.01f, distance) * Mathf.Tan(ReferenceFov * 0.5f * Mathf.Deg2Rad)));

        public static GameObject BuildPrefab(ArtSidecar sc, Dictionary<string, Material> mats, RuntimeAnimatorController humanoidController,
            RuntimeAnimatorController nativeController = null)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(sc.FbxPath);
            if (!model)
            {
                Debug.LogError($"[Art] {sc.Id}: 找不到模型 {sc.FbxPath}");
                return null;
            }

            var root = new GameObject(sc.Id);
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(model, root.transform);
            PrefabUtility.UnpackPrefabInstance(inst, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
            inst.name = "Model";
            foreach (var lg in inst.GetComponentsInChildren<LODGroup>(true)) Object.DestroyImmediate(lg);

            // 材质：按 sidecar 记录的每个网格的材质槽名分配
            var lodRenderers = new SortedDictionary<int, List<Renderer>>();
            foreach (var r in inst.GetComponentsInChildren<Renderer>(true))
            {
                var info = sc.MeshInfo(r.name);
                if (info == null)
                {
                    Debug.LogWarning($"[Art] {sc.Id}: 渲染器 {r.name} 不在 sidecar 的网格列表里");
                    continue;
                }
                var names = ((JArray)info["materials"]).Select(t => (string)t).ToArray();
                r.sharedMaterials = names.Select(n => n != null && mats.TryGetValue(n, out var mm) ? mm : null).ToArray();
                bool glow = names.Any(n => n != null && IsGlow(n));
                r.shadowCastingMode = glow ? ShadowCastingMode.Off : ShadowCastingMode.On;
                if (r is SkinnedMeshRenderer smr)
                {
                    smr.updateWhenOffscreen = false;
                    smr.skinnedMotionVectors = true;
                }
                int? lod = (int?)info["lod"];
                if (lod.HasValue && !glow)
                {
                    if (!lodRenderers.TryGetValue(lod.Value, out var list)) lodRenderers[lod.Value] = list = new List<Renderer>();
                    list.Add(r);
                }
            }

            var bounds = sc.DesignBounds ?? new Bounds(Vector3.up, Vector3.one * 2);
            float size = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);
            if (lodRenderers.Count > 1)
            {
                var dist = sc.LodDistance;
                var lods = new List<LOD>();
                var keys = lodRenderers.Keys.ToList();
                for (int i = 0; i < keys.Count; i++)
                {
                    float next = i + 1 < keys.Count
                        ? (keys[i + 1] < dist.Length ? dist[keys[i + 1]] : dist[^1] * 2f)
                        : (dist.Length > 0 ? dist[^1] : 30f) * (sc.IsStaticScenery ? 6f : 2.5f);
                    float h = ScreenHeight(size, next);
                    if (lods.Count > 0) h = Mathf.Min(h, lods[^1].screenRelativeTransitionHeight - 0.001f);
                    lods.Add(new LOD(Mathf.Max(h, 0.0005f), lodRenderers[keys[i]].ToArray()));
                }
                var group = root.AddComponent<LODGroup>();
                group.SetLODs(lods.ToArray());
                group.fadeMode = LODFadeMode.CrossFade;
                group.animateCrossFading = true;
                group.RecalculateBounds();
            }

            // 动画
            var animator = inst.GetComponent<Animator>();
            if (animator)
            {
                animator.applyRootMotion = false;
                animator.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
                // 优先用从 Three.js 版采样来的专属动作；人形资产没有采样时用通用的 Mixamo 状态机；都没有就程序待机
                if (nativeController) animator.runtimeAnimatorController = nativeController;
                else if (sc.IsHumanoid) animator.runtimeAnimatorController = humanoidController;
                else if (sc.IsCharacter) inst.AddComponent<ProceduralIdle>();
                // 挂点：采样动作里有曲线的非骨骼节点（琵琶、龟甲、镜子、持枪点），挂件由玩法 / 展示场景挂到它下面
                foreach (var s in NativeClipBuilder.Sockets(sc))
                {
                    var socket = new GameObject(s.name).transform;
                    socket.SetParent(animator.transform, false);
                    socket.SetLocalPositionAndRotation(s.pos, s.rot);
                    socket.localScale = Vector3.one * s.scale;
                }
                // 运行时动画层（脚步 IK、看向、受击、弹簧骨）与死亡布娃娃
                if (sc.IsCharacter) CreatureRigBuilder.Setup(root, animator, sc);
            }

            // 碰撞体：角色用胶囊（玩法判定也基于胶囊），场景件用最低一级 LOD 的网格
            if (sc.IsCharacter)
            {
                var cap = root.AddComponent<CapsuleCollider>();
                cap.height = bounds.size.y;
                cap.radius = Mathf.Clamp(Mathf.Min(bounds.size.x, bounds.size.z) * 0.5f, 0.15f, bounds.size.y * 0.5f);
                cap.center = new Vector3(0, bounds.center.y, 0);
            }
            else if (sc.IsStaticScenery && lodRenderers.Count > 0)
            {
                var low = lodRenderers[lodRenderers.Keys.Last()].OfType<MeshRenderer>().FirstOrDefault();
                var mf = low ? low.GetComponent<MeshFilter>() : null;
                if (mf && mf.sharedMesh)
                {
                    var mc = low.gameObject.AddComponent<MeshCollider>();
                    mc.sharedMesh = mf.sharedMesh;
                }
                foreach (var t in root.GetComponentsInChildren<Transform>(true))
                    GameObjectUtility.SetStaticEditorFlags(t.gameObject,
                        StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic |
                        StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic);
            }

            var infoComp = root.AddComponent<ArtAssetInfo>();
            infoComp.assetId = sc.Id;
            infoComp.assetClass = sc.Class;
            infoComp.category = sc.Category;
            infoComp.rigType = sc.EffectiveRigType;
            infoComp.bindSource = sc.BindSource;
            infoComp.bindId = sc.BindId;
            infoComp.bindAttachment = sc.BindAttachment;
            infoComp.lodDistance = sc.LodDistance;
            infoComp.moveSpeed = NativeClipBuilder.MoveSpeed(sc);
            infoComp.designBounds = bounds;
            infoComp.sourceGlb = (string)sc.raw["source"]?["glb"];
            infoComp.sourceSha256 = (string)sc.raw["source"]?["sha256"];
            infoComp.license = (string)sc.raw["source"]?["license"];

            MixamoLibrary.EnsureFolder(System.IO.Path.GetDirectoryName(sc.PrefabPath)!.Replace('\\', '/'));
            var prefab = PrefabUtility.SaveAsPrefabAsset(root, sc.PrefabPath);
            Object.DestroyImmediate(root);
            return prefab;
        }
    }
}
