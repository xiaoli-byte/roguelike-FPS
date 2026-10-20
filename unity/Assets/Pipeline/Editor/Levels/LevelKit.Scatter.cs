using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 散布：碎石、骆驼刺、冰棱、余烬石、巨砾这类按规则撒在地形上的件。归 L4。
    //   小件（无碰撞）→ Terrain 细节：每条规则一个 DetailPrototype（网格 + GPU instancing），按格子写个数，远处整片剔除；
    //   大件（巨砾、树、掩体石，带碰撞）→ 抖动网格取点摆 Prefab。
    //   两者共用一套规则：坡度、高度、离路远近、密度图 / 地表倾向、成团噪声。随机量全取格子哈希，重建结果不变。
    public static partial class LevelKit
    {
        /// <summary>散布件（烘好的网格、开 instancing 的材质、细节原型 Prefab）都放这里，各关共用、原地更新（GUID 不变）</summary>
        public const string ScatterDir = TerrainTextureGen.Dir + "/Scatter";

        /// <summary>美术资产缺席时的程序化占位网格：换正式资产只改规则的 prefab 字段</summary>
        public enum Placeholder { Pebbles, Boulder, Shrub, IceShards, EmberRock, SnowRock }

        /// <summary>散布点上下文：规则据此给密度</summary>
        public struct ScatterPoint
        {
            public Vector2 p;
            /// <summary>世界 y、坡度（度）、凹度（米，正 = 凹）</summary>
            public float y, slope, concavity;
            /// <summary>到路的距离（米；没给路时 ∞）</summary>
            public float roadDist;
            /// <summary>该点的地貌样本：分层倾向 sand / packed / fluid / shore / rock / hole</summary>
            public Sample s;
        }

        /// <summary>一条散布规则（名字全局唯一：散布件按名字落盘、在各关之间共用）</summary>
        public sealed class ScatterRule
        {
            public string name;
            /// <summary>资产 ID（Assets/Art/Prefabs 下的 Prefab）；找不到时用 placeholder</summary>
            public string prefab;
            public Placeholder placeholder;
            /// <summary>细节网格取哪一级 LOD（远看的小件用 LOD1 省面）</summary>
            public int lod;
            /// <summary>满密度时每 100 m² 几个</summary>
            public float perHundredSqm = 2;
            /// <summary>缩放范围（相对资产原尺寸）</summary>
            public Vector2 scale = new(0.8f, 1.25f);
            /// <summary>大件：目标高度范围（米，&gt; 0 时按设计包围盒换算缩放，替代 scale）</summary>
            public Vector2 targetHeight;
            /// <summary>允许坡度（度），两端各 4° 软边</summary>
            public Vector2 slope = new(0, 25);
            /// <summary>允许高度（世界 y），两端各 1 m 软边</summary>
            public Vector2 height = new(-10000, 10000);
            /// <summary>离路至少多远（米，路面 + 车辙外沿），0 = 不管</summary>
            public float roadClear;
            /// <summary>密度图 / 地表倾向规则（0–1，乘上去）；null = 1</summary>
            public Func<ScatterPoint, float> where;
            /// <summary>成团程度 0–1：低频噪声把散布聚成一片片，不是均匀撒胡椒面；clumpScale = 团的尺度（米）</summary>
            public float clump = 0.5f, clumpScale = 18;
            /// <summary>贴地程度 0–1（1 = 完全顺着地面法线）</summary>
            public float alignToGround = 0.7f;
            public bool castShadows;
            public int seed = 1;
        }

        static float Band(float v, float lo, float hi, float soft) => Landform.Smooth(lo - soft, lo, v) * (1 - Landform.Smooth(hi, hi + soft, v));

        /// <summary>规则在某点的密度（0–1）</summary>
        public static float ScatterDensity(ScatterRule r, in ScatterPoint pt)
        {
            if (pt.s.hole > 0.5f) return 0;
            float d = Band(pt.slope, r.slope.x, r.slope.y, 4) * Band(pt.y, r.height.x, r.height.y, 1);
            if (d <= 0) return 0;
            if (r.roadClear > 0) d *= Landform.Smooth(r.roadClear, r.roadClear + 2, pt.roadDist);
            if (d > 0 && r.where != null) d *= Mathf.Clamp01(r.where(pt));
            if (d > 0 && r.clump > 0)
                d *= Mathf.Lerp(1, Landform.Smooth(0.3f, 0.75f, Landform.Fbm(pt.p, r.clumpScale, 2, r.seed + 17) * 0.5f + 0.5f), r.clump);
            return d;
        }

        /// <summary>世界 XZ 处的散布上下文（高度、坡度、凹度取整张高度场，样本重新求值）</summary>
        public static ScatterPoint ScatterAt(TerrainSet set, Vector2 p, Func<Vector2, float> roadDistance = null)
        {
            var local = p - set.spec.origin;
            var idx = set.hf.Index(local);
            return new ScatterPoint
            {
                p = p,
                y = set.hf.Sample(local) - set.spec.baseHeight,
                slope = set.hf.Slope(idx.x, idx.y),
                concavity = set.hf.Concavity(idx.x, idx.y, Mathf.Max(1, Mathf.RoundToInt(set.spec.curvatureRadius / set.hf.Cell.x))),
                roadDist = roadDistance?.Invoke(p) ?? float.MaxValue,
                s = set.spec.eval(p),
            };
        }

        // ───────────── 小件：Terrain 细节 + GPU instancing ─────────────

        /// <summary>
        /// 细节散布：每条规则一个 DetailPrototype（网格 + GPU instancing），每块地形按约 cell 米一格求密度，期望个数的小数部分用格子哈希抛硬币——
        /// 结果确定、与线程无关，跨地块接缝连续。细节没有碰撞（玩家、子弹都穿过），远于 viewDistance（≤ 250 m）不画。
        /// 返回每条规则的总个数。美术之后可以直接用 Terrain 的细节笔刷增删。
        /// </summary>
        public static Dictionary<string, int> ScatterDetails(TerrainSet set, IReadOnlyList<ScatterRule> rules, Func<Vector2, float> roadDistance = null,
            float cell = 1f, float viewDistance = 160f)
        {
            var counts = rules.ToDictionary(r => r.name, _ => 0);
            var protos = rules.Select(DetailPrototypeFor).ToArray();
            var ts = set.TileSize;
            int n = Mathf.Clamp(Mathf.RoundToInt(Mathf.Max(ts.x, ts.y) / cell / 32f) * 32, 32, 4064);
            foreach (var t in set.tiles)
            {
                var td = t.terrainData;
                td.detailPrototypes = protos;
                td.SetDetailResolution(n, 32);
                td.SetDetailScatterMode(DetailScatterMode.InstanceCountMode);
                int maxPer = Mathf.Max(1, td.maxDetailScatterPerRes);
                var o = new Vector2(t.transform.position.x, t.transform.position.z);
                float cx = td.size.x / n, cz = td.size.z / n, area = cx * cz;
                // 全局格号：哈希跨地块连续
                int bx = Mathf.RoundToInt((o.x - set.spec.origin.x) / cx), bz = Mathf.RoundToInt((o.y - set.spec.origin.y) / cz);
                var layers = new int[rules.Count][,];
                for (int r = 0; r < rules.Count; r++) layers[r] = new int[n, n];
                Parallel.For(0, n, z =>
                {
                    for (int x = 0; x < n; x++)
                    {
                        var pt = ScatterAt(set, o + new Vector2((x + 0.5f) * cx, (z + 0.5f) * cz), roadDistance);
                        for (int r = 0; r < rules.Count; r++)
                        {
                            var rule = rules[r];
                            float expect = ScatterDensity(rule, pt) * rule.perHundredSqm * 0.01f * area;
                            if (expect <= 0) continue;
                            int k = Mathf.FloorToInt(expect);
                            if (Landform.Hash(bx + x, bz + z, rule.seed * 7919 + r) < expect - k) k++;
                            layers[r][z, x] = Mathf.Min(k, maxPer);
                        }
                    }
                });
                for (int r = 0; r < rules.Count; r++)
                {
                    td.SetDetailLayer(0, 0, r, layers[r]);
                    int sum = 0;
                    foreach (int v in layers[r]) sum += v;
                    counts[rules[r].name] += sum;
                }
                t.detailObjectDistance = Mathf.Min(250, viewDistance);
                t.detailObjectDensity = 1;
                t.drawTreesAndFoliage = true;
                EditorUtility.SetDirty(td);
            }
            AssetDatabase.SaveAssets();
            foreach (var kv in counts) Debug.Log($"[Level] 散布 {kv.Key}：{kv.Value} 个（{set.spec.name}）");
            return counts;
        }

        static DetailPrototype DetailPrototypeFor(ScatterRule r)
        {
            var proto = new DetailPrototype
            {
                usePrototypeMesh = true,
                prototype = ScatterPrefab(r),
                useInstancing = true,
                renderMode = DetailRenderMode.VertexLit,
                minWidth = r.scale.x, maxWidth = r.scale.y, minHeight = r.scale.x, maxHeight = r.scale.y,
                noiseSpread = 0.35f,
                noiseSeed = r.seed,
                alignToGround = Mathf.Clamp01(r.alignToGround),
                positionJitter = 1,
                useDensityScaling = true,
                healthyColor = Color.white,
                dryColor = Color.white,
            };
            if (!proto.Validate(out string err)) Debug.LogWarning($"[Level] 散布 {r.name} 的细节原型无效：{err}");
            return proto;
        }

        static readonly Dictionary<string, GameObject> scatterPrefabs = new();

        /// <summary>
        /// 规则的散布件 Prefab（细节原型要求根上直接挂 MeshFilter + MeshRenderer）：有美术资产就把指定 LOD 的网格烘进根空间、
        /// 材质复制一份开 GPU instancing（不改美术的原材质）；没有就生成占位网格。都写在 <see cref="ScatterDir"/>，原地更新，GUID 不变。
        /// </summary>
        public static GameObject ScatterPrefab(ScatterRule r)
        {
            if (scatterPrefabs.TryGetValue(r.name, out var cached) && cached) return cached;
            Directory.CreateDirectory(ScatterDir);
            var src = string.IsNullOrEmpty(r.prefab) ? null : ShowcaseSceneBuilder.Prefab(r.prefab);
            Mesh mesh;
            Material mat;
            if (src && BakePrefabMesh(src, r.lod, out mesh, out var srcMat))
                mat = new Material(srcMat) { enableInstancing = true };
            else
            {
                if (!string.IsNullOrEmpty(r.prefab)) Debug.LogWarning($"[Level] 散布 {r.name}：缺少 {r.prefab}，先用占位网格（{r.placeholder}）");
                mesh = PlaceholderMesh(r.placeholder, r.seed);
                mat = PlaceholderMaterial(r.placeholder);
            }
            mesh.name = $"SC_{r.name}";
            mat.name = $"M_SC_{r.name}";
            mesh = Upsert(mesh, $"{ScatterDir}/SC_{r.name}_Mesh.asset");
            mat = Upsert(mat, $"{ScatterDir}/M_SC_{r.name}.mat");
            var go = new GameObject($"SC_{r.name}");
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = r.castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, $"{ScatterDir}/SC_{r.name}.prefab");
            Object.DestroyImmediate(go);
            scatterPrefabs[r.name] = prefab;
            return prefab;
        }

        /// <summary>写共享资产：路径上已有同类资产就把内容拷进去（GUID 不变，已建好的关卡不丢引用），没有就新建</summary>
        static T Upsert<T>(T obj, string path) where T : Object
        {
            var existing = AssetDatabase.LoadAssetAtPath<T>(path);
            if (existing)
            {
                EditorUtility.CopySerialized(obj, existing);
                Object.DestroyImmediate(obj);
                EditorUtility.SetDirty(existing);
                return existing;
            }
            AssetDatabase.CreateAsset(obj, path);
            return obj;
        }

        /// <summary>把 Prefab 某级 LOD 的所有网格合并、变换到根空间（导入时的轴向旋转一并烘进去），材质取第一个</summary>
        static bool BakePrefabMesh(GameObject prefab, int lod, out Mesh mesh, out Material material)
        {
            mesh = null;
            material = null;
            Renderer[] renderers = null;
            var group = prefab.GetComponent<LODGroup>();
            if (group)
            {
                var lods = group.GetLODs();
                if (lods.Length > 0) renderers = lods[Mathf.Clamp(lod, 0, lods.Length - 1)].renderers;
            }
            renderers ??= prefab.GetComponentsInChildren<MeshRenderer>(true);
            var parts = renderers.OfType<MeshRenderer>().Where(x => x && x.GetComponent<MeshFilter>() && x.GetComponent<MeshFilter>().sharedMesh).ToArray();
            if (parts.Length == 0) return false;
            var toRoot = prefab.transform.worldToLocalMatrix;
            var combine = new List<CombineInstance>();
            int verts = 0;
            foreach (var part in parts)
            {
                var m = part.GetComponent<MeshFilter>().sharedMesh;
                verts += m.vertexCount;
                for (int sub = 0; sub < m.subMeshCount; sub++)
                    combine.Add(new CombineInstance { mesh = m, subMeshIndex = sub, transform = toRoot * part.transform.localToWorldMatrix });
            }
            mesh = new Mesh { indexFormat = verts > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.CombineMeshes(combine.ToArray(), true, true);
            mesh.RecalculateBounds();
            var first = parts[0].sharedMaterial;
            if (parts.Any(x => x.sharedMaterials.Length > 1 || x.sharedMaterial != first))
                Debug.LogWarning($"[Level] 散布件 {prefab.name}：LOD{lod} 有多个材质，合并后只用第一个（{(first ? first.name : "无")}）");
            material = first;
            return first;
        }

        // ───────────── 大件：带碰撞的 Prefab ─────────────

        /// <summary>
        /// 大件散布（巨砾、树、掩体石，带碰撞）：area 里按 spacing 米的抖动网格取候选点（点距 ≥ 0.3 × spacing），按规则密度抛硬币，
        /// 摆 Prefab（缺资产时摆占位体 + 网格碰撞）。贴地按 alignToGround 顺法线，往地下埋 sink × 缩放。返回摆下的物体。
        /// </summary>
        public static List<GameObject> ScatterProps(TerrainSet set, Transform parent, ScatterRule r, Rect area, float spacing,
            Func<Vector2, float> roadDistance = null, float sink = 0.15f)
        {
            var root = new GameObject($"Scatter {r.name}").transform;
            root.SetParent(parent, false);
            var placed = new List<GameObject>();
            var prefab = string.IsNullOrEmpty(r.prefab) ? null : ShowcaseSceneBuilder.Prefab(r.prefab);
            if (!prefab)
            {
                if (!string.IsNullOrEmpty(r.prefab)) Debug.LogWarning($"[Level] 散布 {r.name}：缺少 {r.prefab}，摆占位体（{r.placeholder}）");
                prefab = PropPlaceholderPrefab(r);
            }
            float designH = r.targetHeight.y > 0 ? Mathf.Max(0.1f, ShowcaseSceneBuilder.DesignBounds(r.prefab).size.y) : 1;
            float pChance = Mathf.Clamp01(r.perHundredSqm * 0.01f * spacing * spacing);
            int gx0 = Mathf.FloorToInt(area.xMin / spacing), gz0 = Mathf.FloorToInt(area.yMin / spacing);
            int gx1 = Mathf.CeilToInt(area.xMax / spacing), gz1 = Mathf.CeilToInt(area.yMax / spacing);
            for (int gz = gz0; gz < gz1; gz++)
            for (int gx = gx0; gx < gx1; gx++)
            {
                var p = new Vector2((gx + 0.15f + 0.7f * Landform.Hash(gx, gz, r.seed)) * spacing, (gz + 0.15f + 0.7f * Landform.Hash(gx, gz, r.seed + 1)) * spacing);
                if (!area.Contains(p)) continue;
                var pt = ScatterAt(set, p, roadDistance);
                if (Landform.Hash(gx, gz, r.seed + 2) >= ScatterDensity(r, pt) * pChance) continue;
                float k = Landform.Hash(gx, gz, r.seed + 4);
                float sc = r.targetHeight.y > 0 ? Mathf.Lerp(r.targetHeight.x, r.targetHeight.y, k) / designH : Mathf.Lerp(r.scale.x, r.scale.y, k);
                var up = Vector3.Slerp(Vector3.up, set.Normal(p.x, p.y), r.alignToGround);
                var rot = Quaternion.FromToRotation(Vector3.up, up) * Quaternion.Euler(0, Landform.Hash(gx, gz, r.seed + 3) * 360, 0);
                var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab, root);
                go.transform.SetPositionAndRotation(set.OnGround(p.x, p.y, -sink * sc), rot);
                go.transform.localScale = Vector3.one * sc;
                go.isStatic = true;
                placed.Add(go);
            }
            Debug.Log($"[Level] 散布 {r.name}：{placed.Count} 个大件");
            return placed;
        }

        static GameObject PropPlaceholderPrefab(ScatterRule r)
        {
            var baseGo = ScatterPrefab(r);
            var mesh = baseGo.GetComponent<MeshFilter>().sharedMesh;
            var go = new GameObject($"SC_{r.name}_Prop");
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = baseGo.GetComponent<MeshRenderer>().sharedMaterial;
            mr.shadowCastingMode = ShadowCastingMode.On;
            go.AddComponent<MeshCollider>().sharedMesh = mesh;
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, $"{ScatterDir}/SC_{r.name}_Prop.prefab");
            Object.DestroyImmediate(go);
            return prefab;
        }

        // ───────────── 各章默认规则 ─────────────

        /// <summary>各章默认的散布规则（地图在此基础上改密度、加密度图）。名字全局唯一，散布件按名字共用</summary>
        public static class ScatterPresets
        {
            static float S(float e0, float e1, float x) => Landform.Smooth(e0, e1, x);

            public static ScatterRule[] Details(string chapterKey) => chapterKey switch
            {
                "Frost" => FrostDetails(),
                "Inferno" => InfernoDetails(),
                _ => DesertDetails(),
            };

            /// <summary>戈壁：黑戈壁砾石（砾石面、平地）、骆驼刺（沙地、低洼处多）、红柳（稀疏的高灌丛，丘间洼地成丛）</summary>
            public static ScatterRule[] DesertDetails() => new[]
            {
                new ScatterRule
                {
                    name = "DesertTamarisk", prefab = "SM_Env_DesertTamarisk", placeholder = Placeholder.Shrub, lod = 1,
                    perHundredSqm = 0.22f, scale = new(0.75f, 1.2f), slope = new(0, 14), roadClear = 5, clump = 0.8f, clumpScale = 30, seed = 15,
                    castShadows = true, alignToGround = 0.1f,
                    where = pt => S(0.3f, 0.7f, pt.s.sand) * S(0, 0.5f, pt.concavity + 0.15f) * (1 - pt.s.rock) * (1 - pt.s.fluid),
                },
                new ScatterRule
                {
                    name = "DesertPebbles", prefab = "SM_Tripo_DesertGravelScatter", placeholder = Placeholder.Pebbles, lod = 1,
                    perHundredSqm = 3.5f, scale = new(0.6f, 1.3f), slope = new(0, 18), roadClear = 3.5f, clump = 0.6f, seed = 11,
                    where = pt => (1 - 0.85f * S(0.3f, 0.75f, pt.s.sand)) * (1 - pt.s.rock),
                },
                new ScatterRule
                {
                    name = "DesertCamelthorn", prefab = "SM_Tripo_DesertCamelthorn", placeholder = Placeholder.Shrub, lod = 1,
                    perHundredSqm = 1.2f, scale = new(0.7f, 1.3f), slope = new(0, 16), roadClear = 4, clump = 0.7f, seed = 13, castShadows = true,
                    alignToGround = 0.3f,
                    where = pt => S(0.2f, 0.6f, pt.s.sand) * (0.55f + 0.45f * S(0, 0.4f, pt.concavity)) * (1 - pt.s.rock) * (1 - pt.s.fluid),
                },
            };

            /// <summary>冰原：冰棱（岸边、凹处的坡脚）、冻石（碎石坡多、平地零星）</summary>
            public static ScatterRule[] FrostDetails() => new[]
            {
                new ScatterRule
                {
                    name = "FrostIceShards", placeholder = Placeholder.IceShards,
                    perHundredSqm = 2.5f, scale = new(0.7f, 1.6f), slope = new(0, 32), roadClear = 3, clump = 0.6f, seed = 21, castShadows = true,
                    alignToGround = 0.4f,
                    where = pt => Mathf.Max(pt.s.shore, S(0.2f, 0.8f, pt.concavity) * 0.6f) * (1 - pt.s.fluid),
                },
                new ScatterRule
                {
                    name = "FrostRocks", placeholder = Placeholder.SnowRock,
                    perHundredSqm = 1.8f, scale = new(0.6f, 1.4f), slope = new(0, 34), roadClear = 2.5f, clump = 0.5f, seed = 23,
                    where = pt => (1 - pt.s.fluid) * (0.35f + 0.65f * S(14, 28, pt.slope)),
                },
            };

            /// <summary>火狱：余烬石（熔岩岸、结壳上，发光）、火山渣（灰地、缓坡）</summary>
            public static ScatterRule[] InfernoDetails() => new[]
            {
                new ScatterRule
                {
                    name = "InfernoEmberRocks", placeholder = Placeholder.EmberRock,
                    perHundredSqm = 3f, scale = new(0.6f, 1.5f), slope = new(0, 30), roadClear = 2.5f, clump = 0.55f, seed = 31, castShadows = true,
                    where = pt => Mathf.Max(pt.s.shore, pt.s.fluid * 0.25f),
                },
                new ScatterRule
                {
                    name = "InfernoCinders", placeholder = Placeholder.Pebbles,
                    perHundredSqm = 2.5f, scale = new(0.7f, 1.4f), slope = new(0, 26), roadClear = 3, clump = 0.5f, seed = 33,
                    where = pt => (1 - pt.s.fluid) * (1 - pt.s.shore) * (0.4f + 0.6f * pt.s.sand),
                },
            };

            /// <summary>大件（带碰撞）默认：戈壁巨砾、昆仑雪松、火狱玄武岩块</summary>
            public static ScatterRule Boulders(string chapterKey) => chapterKey switch
            {
                "Frost" => new ScatterRule
                {
                    name = "FrostPines", prefab = "SM_Env_FrostPine", placeholder = Placeholder.Boulder,
                    perHundredSqm = 0.5f, scale = new(0.8f, 1.25f), slope = new(0, 28), roadClear = 6, alignToGround = 0, clump = 0.7f, seed = 41,
                    where = pt => (1 - pt.s.fluid) * (1 - pt.s.shore),
                },
                "Inferno" => new ScatterRule
                {
                    name = "InfernoBasaltBlocks", prefab = "SM_Env_InfernoBasalt", placeholder = Placeholder.Boulder,
                    perHundredSqm = 0.35f, targetHeight = new(1.4f, 3f), slope = new(0, 30), roadClear = 6, alignToGround = 0.4f, clump = 0.6f, seed = 43,
                    where = pt => (1 - pt.s.fluid) * (1 - pt.s.shore * 0.7f),
                },
                _ => new ScatterRule
                {
                    name = "DesertBoulders", prefab = "SM_Env_DesertSandstone", placeholder = Placeholder.Boulder,
                    perHundredSqm = 0.3f, targetHeight = new(1.3f, 2.6f), slope = new(0, 30), roadClear = 6, alignToGround = 0.5f, clump = 0.6f, seed = 45,
                    where = pt => Mathf.Max(S(0.05f, 0.4f, pt.concavity), 0.3f) * (1 - 0.6f * pt.s.sand) * (1 - pt.s.fluid),
                },
            };
        }

        // ───────────── 占位网格 ─────────────

        /// <summary>
        /// 占位网格（米，原点在底面中心）：低多边形、平面着色，尺度与正式散布件相当。余烬石的一部分面 UV 指向发光图的白半边（_EmissionMap），
        /// 读起来是「暗石头上几块透红」，不是一整颗灯泡。
        /// </summary>
        static Mesh PlaceholderMesh(Placeholder kind, int seed)
        {
            var b = new FacetBuilder(seed * 31 + (int)kind * 977);
            switch (kind)
            {
                case Placeholder.Pebbles:
                    for (int i = 0; i < 6; i++)
                    {
                        float r = b.Range(0.07f, 0.2f), a = b.Range(0, Mathf.PI * 2), d = b.Range(0, 0.55f);
                        b.Rock(new Vector3(Mathf.Cos(a) * d, r * 0.2f, Mathf.Sin(a) * d), new Vector3(r, r * 0.55f, r * 0.85f), b.Range(0, 360), 0);
                    }
                    break;
                case Placeholder.SnowRock:
                    b.Rock(new Vector3(0, 0.12f, 0), new Vector3(0.45f, 0.3f, 0.38f), b.Range(0, 360), 0);
                    for (int i = 0; i < 3; i++)
                    {
                        float r = b.Range(0.08f, 0.16f), a = b.Range(0, Mathf.PI * 2);
                        b.Rock(new Vector3(Mathf.Cos(a) * 0.5f, r * 0.2f, Mathf.Sin(a) * 0.5f), new Vector3(r, r * 0.6f, r * 0.8f), b.Range(0, 360), 0);
                    }
                    break;
                case Placeholder.Boulder:
                    b.Rock(new Vector3(0, 0.45f, 0), new Vector3(1.0f, 0.75f, 0.85f), b.Range(0, 360), 0);
                    b.Rock(new Vector3(0.75f, 0.15f, 0.3f), new Vector3(0.35f, 0.3f, 0.3f), b.Range(0, 360), 0);
                    break;
                case Placeholder.EmberRock:
                    b.Rock(new Vector3(0, 0.12f, 0), new Vector3(0.35f, 0.26f, 0.3f), b.Range(0, 360), 0.3f);
                    for (int i = 0; i < 2; i++)
                    {
                        float a = b.Range(0, Mathf.PI * 2);
                        b.Rock(new Vector3(Mathf.Cos(a) * 0.42f, 0.03f, Mathf.Sin(a) * 0.42f), Vector3.one * b.Range(0.06f, 0.1f), b.Range(0, 360), 0.5f);
                    }
                    break;
                case Placeholder.IceShards:
                    for (int i = 0; i < 5; i++)
                    {
                        float a = b.Range(0, Mathf.PI * 2), d = i == 0 ? 0 : b.Range(0.12f, 0.35f);
                        var basePos = new Vector3(Mathf.Cos(a) * d, -0.05f, Mathf.Sin(a) * d);
                        var tilt = Quaternion.Euler(b.Range(-30, 30), b.Range(0, 360), b.Range(-30, 30));
                        b.Prism(basePos, tilt, b.Range(0.05f, 0.12f), i == 0 ? 1.0f : b.Range(0.35f, 0.75f));
                    }
                    break;
                default: // Shrub：一丛向外张开的细刺（骆驼刺的占位）
                    for (int i = 0; i < 9; i++)
                    {
                        var tilt = Quaternion.Euler(b.Range(20, 65), i * 40 + b.Range(-12, 12), 0);
                        b.Spike(Vector3.zero, tilt, 0.03f, b.Range(0.45f, 0.75f));
                    }
                    break;
            }
            return b.ToMesh();
        }

        static Material PlaceholderMaterial(Placeholder kind)
        {
            var m = new Material(Shader.Find("Spiritfire/StylizedLit")) { enableInstancing = true };
            var (color, rough, rim) = kind switch
            {
                Placeholder.Pebbles => (new Color(0.33f, 0.28f, 0.25f), 0.9f, 0.1f),
                Placeholder.SnowRock => (new Color(0.42f, 0.45f, 0.52f), 0.85f, 0.15f),
                Placeholder.Boulder => (new Color(0.55f, 0.42f, 0.32f), 0.92f, 0.12f),
                Placeholder.EmberRock => (new Color(0.12f, 0.09f, 0.1f), 0.8f, 0.1f),
                Placeholder.IceShards => (new Color(0.7f, 0.86f, 0.96f), 0.25f, 0.6f),
                _ => (new Color(0.48f, 0.42f, 0.26f), 0.95f, 0.1f),
            };
            m.SetColor("_BaseColor", color);
            m.SetFloat("_Metallic", 0);
            m.SetFloat("_Roughness", rough);
            m.SetFloat("_RimStrength", rim);
            if (kind == Placeholder.EmberRock)
            {
                m.EnableKeyword("_EMISSION");
                m.SetTexture("_EmissionMap", GlowTexture());
                m.SetColor("_EmissionColor", new Color(1f, 0.38f, 0.1f) * 2.4f);
            }
            return m;
        }

        /// <summary>发光图：左半黑、右半白（点采样），占位网格的面按 UV 选亮不亮</summary>
        static Texture2D GlowTexture()
        {
            string path = $"{ScatterDir}/T_SC_Glow.png";
            if (!File.Exists(path))
            {
                var tex = new Texture2D(4, 1, TextureFormat.RGBA32, false);
                tex.SetPixels(new[] { Color.black, Color.black, Color.white, Color.white });
                File.WriteAllBytes(path, tex.EncodeToPNG());
                Object.DestroyImmediate(tex);
                AssetDatabase.ImportAsset(path);
                var ti = (TextureImporter)AssetImporter.GetAtPath(path);
                ti.filterMode = FilterMode.Point;
                ti.wrapMode = TextureWrapMode.Clamp;
                ti.mipmapEnabled = false;
                ti.textureCompression = TextureImporterCompression.Uncompressed;
                ti.SaveAndReimport();
            }
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        /// <summary>平面着色网格拼装：每个面三个独立顶点、面法线朝外</summary>
        sealed class FacetBuilder
        {
            readonly List<Vector3> v = new(), n = new();
            readonly List<Vector2> uv = new();
            readonly System.Random rng;

            public FacetBuilder(int seed) => rng = new System.Random(seed);

            public float Range(float a, float b) => a + (float)rng.NextDouble() * (b - a);

            void Tri(Vector3 a, Vector3 b, Vector3 c, Vector3 center, float u)
            {
                var nn = Vector3.Cross(b - a, c - a);
                if (Vector3.Dot(nn, (a + b + c) / 3 - center) < 0) (b, c) = (c, b);
                nn = Vector3.Cross(b - a, c - a).normalized;
                v.Add(a);
                v.Add(b);
                v.Add(c);
                for (int i = 0; i < 3; i++)
                {
                    n.Add(nn);
                    uv.Add(new Vector2(u, 0.5f));
                }
            }

            /// <summary>石块：细分一次的二十面体，顶点随机起伏后按 radii 压扁；glow = 发光面的比例</summary>
            public void Rock(Vector3 center, Vector3 radii, float yaw, float glow)
            {
                var (verts, faces) = Icosphere();
                var rot = Quaternion.Euler(0, yaw, 0);
                var p = new Vector3[verts.Count];
                for (int i = 0; i < verts.Count; i++)
                {
                    var q = verts[i] * Range(0.82f, 1.12f);
                    p[i] = center + rot * Vector3.Scale(q, radii);
                }
                foreach (var (a, b, c) in faces)
                    Tri(p[a], p[b], p[c], center, (float)rng.NextDouble() < glow ? 0.75f : 0.25f);
            }

            /// <summary>冰棱：六棱柱（底在 basePos，沿 tilt 的 +Y 伸出 length），顶端收成尖</summary>
            public void Prism(Vector3 basePos, Quaternion tilt, float radius, float length)
            {
                const int sides = 6;
                var center = basePos + tilt * Vector3.up * (length * 0.45f);
                var tip = basePos + tilt * Vector3.up * length;
                var ring0 = new Vector3[sides];
                var ring1 = new Vector3[sides];
                for (int i = 0; i < sides; i++)
                {
                    float a = i * Mathf.PI * 2 / sides;
                    var off = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * radius;
                    ring0[i] = basePos + tilt * off;
                    ring1[i] = basePos + tilt * (off * 0.8f + Vector3.up * length * 0.78f);
                }
                for (int i = 0; i < sides; i++)
                {
                    int j = (i + 1) % sides;
                    Tri(ring0[i], ring0[j], ring1[j], center, 0.25f);
                    Tri(ring0[i], ring1[j], ring1[i], center, 0.25f);
                    Tri(ring1[i], ring1[j], tip, center, 0.25f);
                }
            }

            /// <summary>细刺：四棱锥（灌丛的一根枝）</summary>
            public void Spike(Vector3 basePos, Quaternion tilt, float radius, float length)
            {
                var tip = basePos + tilt * Vector3.up * length;
                var center = basePos + tilt * Vector3.up * (length * 0.3f);
                var ring = new Vector3[4];
                for (int i = 0; i < 4; i++)
                {
                    float a = i * Mathf.PI / 2;
                    ring[i] = basePos + tilt * new Vector3(Mathf.Cos(a) * radius, 0, Mathf.Sin(a) * radius);
                }
                for (int i = 0; i < 4; i++) Tri(ring[i], ring[(i + 1) % 4], tip, center, 0.25f);
            }

            public Mesh ToMesh()
            {
                var m = new Mesh { indexFormat = v.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                m.SetVertices(v);
                m.SetNormals(n);
                m.SetUVs(0, uv);
                m.SetTriangles(Enumerable.Range(0, v.Count).ToArray(), 0);
                m.RecalculateBounds();
                m.RecalculateTangents();
                return m;
            }

            static (List<Vector3> verts, List<(int, int, int)> faces) icoCache;

            /// <summary>单位二十面体细分一次（42 顶点、80 面）</summary>
            static (List<Vector3>, List<(int, int, int)>) Icosphere()
            {
                if (icoCache.verts != null) return icoCache;
                float t = (1 + Mathf.Sqrt(5)) / 2;
                var verts = new List<Vector3>
                {
                    new(-1, t, 0), new(1, t, 0), new(-1, -t, 0), new(1, -t, 0), new(0, -1, t), new(0, 1, t),
                    new(0, -1, -t), new(0, 1, -t), new(t, 0, -1), new(t, 0, 1), new(-t, 0, -1), new(-t, 0, 1),
                };
                for (int i = 0; i < verts.Count; i++) verts[i] = verts[i].normalized;
                var faces = new List<(int, int, int)>
                {
                    (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
                    (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
                };
                var mid = new Dictionary<long, int>();
                int Mid(int a, int b)
                {
                    long key = a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
                    if (mid.TryGetValue(key, out int i)) return i;
                    verts.Add(((verts[a] + verts[b]) * 0.5f).normalized);
                    mid[key] = verts.Count - 1;
                    return verts.Count - 1;
                }
                var sub = new List<(int, int, int)>();
                foreach (var (a, b, c) in faces)
                {
                    int ab = Mid(a, b), bc = Mid(b, c), ca = Mid(c, a);
                    sub.Add((a, ab, ca));
                    sub.Add((b, bc, ab));
                    sub.Add((c, ca, bc));
                    sub.Add((ab, bc, ca));
                }
                icoCache = (verts, sub);
                return icoCache;
            }
        }
    }
}
