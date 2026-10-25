using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 第一人称武器 Prefab 的零件与挂点（W3，docs/unity-parity.md 3.3「零件语义与挂点」）。<see cref="ArtPrefabBuilder.BuildPrefab"/> 对带
    /// weapon 段的 sidecar（art/pipeline/unity_export.py 写，骨骼已在导出时改成语义名）调用：
    ///   · 挂点：sight / leftGrip / load / finish / eject 建成零件骨骼下的空节点（位置是枪模空间，按绑定姿势换成父骨骼的局部坐标；
    ///     朝向与枪模根一致，eject 的 +Z 指向抛出方向）；muzzle 就是改名后的枪口骨骼；
    ///   · <see cref="WeaponSockets"/> 组件记下全部零件和挂点，运行时不用按名字找；
    ///   · 程序化零件（Three.js PROCEDURAL_PARTS：美术管线导出时排除的中空瞄具、弩弦、弩箭）按玩法表的尺寸烘成网格：
    ///     红点 / 筒式瞄具（<see cref="WeaponSight"/> 的零件表，根节点 <see cref="WeaponSightBuilder.BakedName"/>，零件名同占位网格，
    ///     运行时 <see cref="SightPart"/> 只按稀有度重涂）、连弩的两半弓弦（上弦姿势）与弩箭（<see cref="CrossbowString"/> 运行时接着摆）。
    ///     网格是共享的单位方块 / 开口圆筒资产，材质是 StylizedLit（名字以 <see cref="WeaponTint.ProceduralMaterialPrefix"/> 开头，元素着色不碰），
    ///     放在 Assets/Art/Weapons/_Procedural/。掉在地上的枪用同一个 Prefab，所以地上的弩也有弦有箭、步枪也有红点。
    /// </summary>
    public static class WeaponPrefabParts
    {
        public const string ProcDir = "Assets/Art/Weapons/_Procedural";
        const string Prefix = WeaponTint.ProceduralMaterialPrefix;

        static Mesh box, tube;
        static readonly Dictionary<string, Material> mats = new();

        /// <summary>给正在生成的 Prefab 根（root，模型层级在 model 下）补零件与挂点；返回警告（缺骨骼等）</summary>
        public static List<string> Build(ArtSidecar sc, GameObject root, GameObject model)
        {
            var warnings = new List<string>();
            var w = sc.Weapon;
            if (w == null) return warnings;
            box = tube = null;
            mats.Clear();

            var sockets = root.AddComponent<WeaponSockets>();
            sockets.weaponId = (string)w["id"];
            var names = new List<string>();
            var bones = new List<Transform>();
            foreach (var p in (w["parts"] as JObject)?.Properties() ?? Enumerable.Empty<JProperty>())
            {
                var bone = WeaponSockets.FindDeep(model.transform, (string)p.Value);
                if (!bone)
                {
                    warnings.Add($"零件 {p.Name} 的骨骼 {(string)p.Value} 不在模型里");
                    continue;
                }
                names.Add(p.Name);
                bones.Add(bone);
            }
            sockets.partNames = names.ToArray();
            sockets.parts = bones.ToArray();

            foreach (var p in (w["sockets"] as JObject)?.Properties() ?? Enumerable.Empty<JProperty>())
            {
                var spec = (JObject)p.Value;
                Transform t;
                if (spec["bone"] != null)
                {
                    t = WeaponSockets.FindDeep(model.transform, (string)spec["bone"]);
                    if (!t) warnings.Add($"挂点 {p.Name} 的骨骼 {(string)spec["bone"]} 不在模型里");
                }
                else
                {
                    string parentName = (string)spec["parent"] ?? "j_r";
                    var parent = WeaponSockets.FindDeep(model.transform, parentName);
                    if (!parent)
                    {
                        warnings.Add($"挂点 {p.Name} 的父零件 {parentName} 不在模型里，挂到模型根");
                        parent = model.transform;
                    }
                    t = new GameObject(p.Name).transform;
                    t.SetParent(parent, false);
                    var pos = V(spec["pos"]);
                    var rot = root.transform.rotation;
                    if (spec["dir"] is JArray d && V(d).sqrMagnitude > 1e-6f)
                        rot = root.transform.rotation * Quaternion.LookRotation(V(d).normalized, Vector3.up);
                    t.SetPositionAndRotation(root.transform.TransformPoint(pos), rot);
                }
                switch (p.Name)
                {
                    case WeaponSockets.Muzzle: sockets.muzzle = t; break;
                    case WeaponSockets.Sight: sockets.sight = t; break;
                    case WeaponSockets.LeftGrip: sockets.leftGrip = t; break;
                    case WeaponSockets.Load: sockets.load = t; break;
                    case WeaponSockets.Finish: sockets.finish = t; break;
                    case WeaponSockets.Eject: sockets.eject = t; break;
                }
            }

            var sight = WeaponSight.For(sockets.weaponId);
            if (sight != null && sight.parts.Length > 0) BakeSight(root, model, sight, sockets);
            if (sockets.weaponId == "crossbow") BakeCrossbow(root, model, sockets);
            return warnings;
        }

        static Vector3 V(JToken t)
        {
            var a = t as JArray;
            return a == null || a.Count < 3 ? Vector3.zero : new Vector3((float)a[0], (float)a[1], (float)a[2]);
        }

        // ───────────── 程序化零件 ─────────────

        /// <summary>红点 / 筒式瞄具：零件按 <see cref="WeaponSight"/> 的枪模坐标摆，挂在 sight 分组骨骼下（没有就挂枪模根）</summary>
        static void BakeSight(GameObject root, GameObject model, WeaponSight sight, WeaponSockets sockets)
        {
            var parent = sockets.Part("sightGroup");
            if (!parent) parent = model.transform;
            var group = Group(root, parent, WeaponSightBuilder.BakedName, Vector3.zero);
            var frame = Material($"{Prefix}Frame_{sockets.weaponId}", sight.frameColor, Color.black);
            for (int i = 0; i < sight.parts.Length; i++)
            {
                var p = sight.parts[i];
                var m = p.paint switch
                {
                    SightPaint.Reticle => Material($"{Prefix}Reticle", Color.black, WeaponSight.ReticleColor),
                    SightPaint.Rarity => Material($"{Prefix}Rarity", Color.white * 0.6f, Color.white),
                    _ => frame,
                };
                Piece(root, group, $"{p.paint} {p.shape} {i}", p.shape == SightShape.Tube ? Tube() : Box(), m, p.center, p.size, Quaternion.identity);
            }
        }

        /// <summary>连弩：两半弓弦（上弦姿势，从弓梢连到扳机处的弦扣）与弩箭（箭杆、箭头、箭羽），挂在 bolt 骨骼下</summary>
        static void BakeCrossbow(GameObject root, GameObject model, WeaponSockets sockets)
        {
            var str = Material($"{Prefix}String", CrossbowString.StringColor, Color.black);
            foreach (float side in new[] { -1f, 1f })
            {
                CrossbowString.Half(side, 1, out var center, out var rot, out float len);
                // 挂在枪模根下：CrossbowString 运行时按枪模根的局部坐标摆弦
                Piece(root, root.transform, side > 0 ? "string_r" : "string_l", Box(), str, center,
                    new Vector3(CrossbowString.Thickness, CrossbowString.Thickness, Mathf.Max(1e-4f, len)), rot);
            }
            var boltBone = sockets.Part("bolt");
            var bolt = Group(root, boltBone ? boltBone : model.transform, CrossbowString.BoltPartsName, CrossbowString.BoltPos);
            Piece(root, bolt, "shaft", Box(), Material($"{Prefix}Shaft", CrossbowString.ShaftColor, Color.black),
                CrossbowString.BoltPos, new Vector3(0.008f, 0.008f, 0.26f), Quaternion.identity);
            Piece(root, bolt, "head", Box(), Material($"{Prefix}Glow", Color.white * 0.6f, Color.white),
                CrossbowString.BoltPos + new Vector3(0, 0, -0.14f), new Vector3(0.014f, 0.014f, 0.03f), Quaternion.identity);
            Piece(root, bolt, "fletch", Box(), Material($"{Prefix}Rarity", Color.white * 0.6f, Color.white),
                CrossbowString.BoltPos + new Vector3(0, 0, 0.115f), new Vector3(0.022f, 0.003f, 0.03f), Quaternion.identity);
        }

        /// <summary>空节点：位置 modelPos（枪模空间），朝向与枪模根一致</summary>
        static Transform Group(GameObject root, Transform parent, string name, Vector3 modelPos)
        {
            var t = new GameObject(name).transform;
            t.SetParent(parent, false);
            t.SetPositionAndRotation(root.transform.TransformPoint(modelPos), root.transform.rotation);
            t.localScale = Vector3.one;
            return t;
        }

        /// <summary>一个零件：中心 modelPos、朝向 modelRot（枪模空间），尺寸 = 单位网格的缩放；不投影</summary>
        static void Piece(GameObject root, Transform parent, string name, Mesh mesh, Material mat, Vector3 modelPos, Vector3 size, Quaternion modelRot)
        {
            var go = new GameObject(name);
            var t = go.transform;
            t.SetParent(parent, false);
            t.SetPositionAndRotation(root.transform.TransformPoint(modelPos), root.transform.rotation * modelRot);
            // 父骨骼可能带缩放：尺寸按世界尺度给（Prefab 根缩放为 1）
            var ps = parent.lossyScale;
            t.localScale = new Vector3(size.x / Mathf.Max(1e-6f, ps.x), size.y / Mathf.Max(1e-6f, ps.y), size.z / Mathf.Max(1e-6f, ps.z));
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.BlendProbes;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
        }

        static Mesh Box() => box ? box : box = MeshAsset("SM_WeaponProc_Box", WeaponSightBuilder.NewBoxMesh);
        static Mesh Tube() => tube ? tube : tube = MeshAsset("SM_WeaponProc_Tube", WeaponSightBuilder.NewTubeMesh);

        /// <summary>共享网格资产：没有就建；已有就原地覆盖数据（GUID 不变，Prefab 引用不断）</summary>
        static Mesh MeshAsset(string name, System.Func<Mesh> make)
        {
            MixamoLibrary.EnsureFolder(ProcDir);
            string path = $"{ProcDir}/{name}.asset";
            var fresh = make();
            fresh.name = name;
            var existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (!existing)
            {
                AssetDatabase.CreateAsset(fresh, path);
                return fresh;
            }
            existing.Clear();
            existing.SetVertices(fresh.vertices);
            existing.SetNormals(fresh.normals);
            existing.SetTriangles(fresh.triangles, 0);
            existing.RecalculateBounds();
            Object.DestroyImmediate(fresh);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        /// <summary>StylizedLit 材质（枪械风格预设）；emission 非黑时打开自发光（无贴图 = 纯色发光）</summary>
        static Material Material(string name, Color baseColor, Color emission)
        {
            if (mats.TryGetValue(name, out var cached) && cached) return cached;
            MixamoLibrary.EnsureFolder(ProcDir);
            string path = $"{ProcDir}/{name}.mat";
            var shader = Shader.Find(ArtPrefabBuilder.ShaderName);
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (!mat)
            {
                mat = new Material(shader) { name = name };
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = shader;
            mat.shaderKeywords = new string[0];
            var p = ArtPrefabBuilder.StylePreset.For("weapons");
            baseColor.a = 1;
            mat.SetColor("_BaseColor", baseColor);
            mat.SetColor("_Tint", Color.white);
            mat.SetFloat("_Metallic", 0.3f);
            mat.SetFloat("_Roughness", 0.55f);
            mat.SetFloat("_OcclusionStrength", 0f);
            mat.SetTexture("_EmissionMap", null);
            emission.a = 1;
            mat.SetColor("_EmissionColor", emission);
            if (emission.maxColorComponent > 0) mat.EnableKeyword("_EMISSION");
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
            mat.SetFloat("_Fur", 0f);
            // 开口镜筒的网格自带内外两层壁（法线相反），背面剔除即可，不能双面（两层壁会打架）
            mat.SetFloat("_Cull", (float)CullMode.Back);
            mat.SetFloat("_SrcBlend", (float)BlendMode.One);
            mat.SetFloat("_DstBlend", (float)BlendMode.Zero);
            mat.SetFloat("_ZWrite", 1f);
            mat.SetOverrideTag("RenderType", "Opaque");
            mat.renderQueue = -1;
            EditorUtility.SetDirty(mat);
            mats[name] = mat;
            return mat;
        }
    }
}
