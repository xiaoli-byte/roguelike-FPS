using System.Collections.Generic;
using Spiritfire.Game;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 熔岩（L7，docs/unity-parity.md 4.9）：按关卡数据摆熔岩（LavaVolume + Spiritfire/Lava 熔岩面 + NavMesh Lava 区），
    // 烘熔岩生物（LavaSwimmer 代理类型）的导航网格，验收熔岩的导航标记。
    //
    // 用法（各图的 Level_x_y.Build 里）：
    //   1. 地形先挖好湖床 / 渠 / 井（HeightField.LavaLake、CaveBowl、地形洞……，熔岩面以下至少 0.5 m，L4 的地貌已经这样做）；
    //   2. PlaceLava(dir, new LavaSpec { … }, parent)：一片熔岩一次，湖可以画得比岸线大一圈（岸上的地面靠高度排除），渠用转过的长盒；
    //      熔岩井、洞下的熔岩（下面没有地形）开 catchFloor；
    //   3. LevelKit.BakeNavMesh(…) 之后再 BakeLavaNavMesh(…)（Lava 区由 PlaceLava 放的 NavMeshModifierVolume 标，两张网格都认）；
    //   4. 验收里 ValidateLava(rep)。
    // 运行时什么都不用摆：第一片 LavaVolume 启用时自己建 LavaField。
    public static partial class LevelKit
    {
        /// <summary>一片熔岩的布局数据</summary>
        public sealed class LavaSpec
        {
            public string name = "Lava";
            /// <summary>形状中心（世界 XZ）；y = 基准熔岩面（低位）</summary>
            public Vector3 center;
            public LavaShape shape = LavaShape.Box;
            /// <summary>盒：局部 X 宽 × 局部 Z 长（米）；圆：x = 半径</summary>
            public Vector2 size = new(10, 10);
            /// <summary>朝向（度）：盒的局部 +Z 朝这个方向（渠沿长边流）</summary>
            public float yaw;
            /// <summary>熔岩面以下多深仍算熔岩（湖床、渠底在这个深度以内）</summary>
            public float depth = 3f;
            /// <summary>岸边硬壳按场景深度算（湖、渠：下面有床）；平地上的熔岩条带 false（只按形状边缘）</summary>
            public bool depthShore = true;
            /// <summary>熔岩面下 <see cref="CatchFloorDepth"/> 米放一块接人的碰撞板：熔岩井、洞下的熔岩下面没有地形时，掉进去的玩家落在熔岩里</summary>
            public bool catchFloor;
            /// <summary>流动（形状局部 XZ，米 / 秒）：渠 (0, 0.4) 左右</summary>
            public Vector2 flow;
            /// <summary>自动涨落（3-3 熔铜渠：<see cref="LavaTide.Channel"/>）</summary>
            public LavaTide tide;
        }

        /// <summary>接人板在熔岩面下多深（米）：眼睛仍在熔岩面上方 1 m，看得见自己陷在熔岩里</summary>
        public const float CatchFloorDepth = 0.6f;
        /// <summary>熔岩材质（全场共用一份；Spiritfire/Lava）</summary>
        public const string LavaMaterialPath = PlaceholderDir + "/M_Lava.mat";
        static Material lavaMat;

        /// <summary>熔岩材质：已有就用（可以手调），没有按着色器默认值建一份</summary>
        public static Material LavaMaterial()
        {
            if (lavaMat) return lavaMat;
            lavaMat = AssetDatabase.LoadAssetAtPath<Material>(LavaMaterialPath);
            if (lavaMat && lavaMat.shader && lavaMat.shader.name == LavaVolume.ShaderName) return lavaMat;
            var sh = Shader.Find(LavaVolume.ShaderName);
            if (!sh)
            {
                Debug.LogError($"[Level] 找不到着色器 {LavaVolume.ShaderName}（Assets/Art/Shaders/SF_Lava.shader 编译失败？）：熔岩只有判定、不画");
                return lavaMat = null;
            }
            lavaMat = new Material(sh) { name = "M_Lava" };
            SaveAsset(lavaMat, LavaMaterialPath);
            return lavaMat;
        }

        /// <summary>NavMesh 的 Lava 区域号；工程里没有（NavMeshAreas.asset 没加载到）时 −1</summary>
        public static int LavaNavArea => NavMesh.GetAreaFromName(LavaField.AreaName);

        /// <summary>LavaSwimmer 代理类型的 id（编辑器里现查，不用运行时的缓存）</summary>
        public static int? LavaSwimmerAgentType()
        {
            int n = NavMesh.GetSettingsCount();
            for (int i = 0; i < n; i++)
            {
                int id = NavMesh.GetSettingsByIndex(i).agentTypeID;
                if (NavMesh.GetSettingsNameFromID(id) == LavaField.SwimmerAgentName) return id;
            }
            return null;
        }

        /// <summary>
        /// 摆一片熔岩：根物体（位置 = 形状中心、y = 基准熔岩面，打 Lava 标签）挂 <see cref="LavaVolume"/>；子物体 Surface 是熔岩面网格
        /// （存成 {dir}/Lava/Mesh_Lava_*.asset，Spiritfire/Lava 材质，不投影）；子物体 Nav Lava 是 NavMeshModifierVolume——
        /// 基准熔岩面 + standRise 以下、depth 以内的地面标成 Lava 区（圆形用几条内接的横条拼）；按需加接人板。
        /// 熔岩面不挡人：玩家、敌人都能走进去（由 LavaField 下沉托回 / 烧死 / 拉回）
        /// </summary>
        public static LavaVolume PlaceLava(string dir, LavaSpec s, Transform parent)
        {
            var go = new GameObject($"Lava · {s.name}");
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(s.center, Quaternion.Euler(0, s.yaw, 0));
            EnsureTag(LavaField.AreaName);
            go.tag = LavaField.AreaName;
            var size = new Vector2(Mathf.Max(0.1f, s.size.x), Mathf.Max(0.1f, s.size.y));
            float depth = Mathf.Max(0.1f, s.depth);
            var vol = go.AddComponent<LavaVolume>();
            vol.shape = s.shape;
            vol.size = size;
            vol.depth = depth;
            vol.depthShore = s.depthShore;
            vol.flow = s.flow;
            vol.tide = s.tide;

            // 熔岩面
            var mat = LavaMaterial();
            if (mat)
            {
                var surf = new GameObject("Surface");
                surf.transform.SetParent(go.transform, false);
                surf.transform.localPosition = new Vector3(0, LavaTuning.SurfaceLift, 0);
                var mesh = LavaVolume.BuildMesh(s.shape, size, s.depthShore, s.flow);
                mesh.name = $"Mesh_Lava_{SafeName(s.name)}";
                SaveAsset(mesh, $"{dir}/Lava/{mesh.name}.asset");
                surf.AddComponent<MeshFilter>().sharedMesh = mesh;
                var r = surf.AddComponent<MeshRenderer>();
                r.sharedMaterial = mat;
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = true;
                r.lightProbeUsage = LightProbeUsage.Off;
                r.reflectionProbeUsage = ReflectionProbeUsage.Off;
                vol.surface = r;
            }

            // 导航：基准熔岩面以下标成 Lava 区（高代价：地面敌人绕开；击退仍能把它们推进去）
            int area = LavaNavArea;
            if (area < 0)
                Debug.LogWarning($"[Level] NavMesh 没有「{LavaField.AreaName}」区域（ProjectSettings/NavMeshAreas.asset 改了要重启编辑器）：{s.name} 的熔岩在导航上按普通地面算");
            else
            {
                float top = LavaTuning.StandRise, bottom = -depth - 0.25f;
                foreach (var (center, extent) in NavSlabs(s.shape, size))
                {
                    var slab = new GameObject("Nav Lava");
                    slab.transform.SetParent(go.transform, false);
                    slab.transform.localPosition = new Vector3(center.x, 0, center.y);
                    var mod = slab.AddComponent<NavMeshModifierVolume>();
                    mod.area = area;
                    mod.center = new Vector3(0, (top + bottom) * 0.5f, 0);
                    mod.size = new Vector3(extent.x, top - bottom, extent.y);
                }
            }

            // 接人板（熔岩井）：只有碰撞，导航烘焙时也在 Lava 区里
            if (s.catchFloor)
            {
                var floor = new GameObject("Catch Floor");
                floor.transform.SetParent(go.transform, false);
                const float thick = 0.5f;
                floor.transform.localPosition = new Vector3(0, -CatchFloorDepth - thick * 0.5f, 0);
                var box = floor.AddComponent<BoxCollider>();
                var ext = s.shape == LavaShape.Disc ? new Vector2(size.x * 2, size.x * 2) : size;
                box.size = new Vector3(ext.x, thick, ext.y);
                floor.isStatic = true;
            }
            return vol;
        }

        /// <summary>导航标记的盒（局部中心、XZ 尺寸）：盒形一块；圆形用 8 条横条拼，每条宽取条带中线处的弦长（圆外只多出很小的角）</summary>
        static IEnumerable<(Vector2 center, Vector2 extent)> NavSlabs(LavaShape shape, Vector2 size)
        {
            if (shape != LavaShape.Disc)
            {
                yield return (Vector2.zero, size);
                yield break;
            }
            float r = size.x;
            const int n = 8;
            for (int j = 0; j < n; j++)
            {
                float z0 = -r + 2 * r * j / n, z1 = -r + 2 * r * (j + 1) / n, zm = (z0 + z1) * 0.5f;
                float half = Mathf.Sqrt(Mathf.Max(0, r * r - zm * zm));
                if (half < 0.1f) continue;
                yield return (new Vector2(0, zm), new Vector2(half * 2, z1 - z0));
            }
        }

        static string SafeName(string s)
        {
            if (string.IsNullOrEmpty(s)) return "Lava";
            var chars = s.ToCharArray();
            for (int i = 0; i < chars.Length; i++)
                if (!char.IsLetterOrDigit(chars[i]) && chars[i] != '_' && chars[i] != '-') chars[i] = '_';
            return new string(chars);
        }

        /// <summary>
        /// 熔岩生物（火鼍，EN3b）的导航网格：LavaSwimmer 代理类型（半径 0.9 m），只收集场上熔岩的范围（外扩 4 m，熔岩面下 depth + 2 m 到上 3 m），
        /// 默认区域 Walkable，熔岩由 PlaceLava 放的 NavMeshModifierVolume 标成 Lava——火鼍的 agent 只开 Lava 区（<see cref="LavaField.MakeSwimmer"/>），
        /// 所以只在熔岩里游，岸就是它的边界。存成 {dir}/NavMesh_{name}_LavaSwimmer.asset，挂在一个 NavMeshSurface 上随场景加载。
        /// <para>
        /// 干地：墩顶、堤面、湖岸对只走 Lava 区的火鼍没用，烘进去反而和人形网格叠在一起，让不带过滤的导航查询落错网格
        /// （验收 / 站位的查询都带人形过滤 <see cref="LavaField.WalkerFilter"/>，这里是第二道）。Unity 对「封顶」的处理随场景不同
        /// （Not Walkable 修改体积按代理的站立空间判；压低范围顶会连熔岩面高度的平地一起丢），所以几种封法都烘一遍，
        /// 挑「熔岩覆盖不比不封顶少、留在网格上的干地探针最少」的那种（见 <see cref="SwimmerCandidates"/>），结果写一行到 Console。
        /// </para>
        /// 数据用 NavMeshBuilder 直接烘（<see cref="BuildSwimmerData"/>；NavMeshSurface.BuildNavMesh 在 3-4 上烘出过整张空网格）。
        /// 场上没有熔岩 / 工程里没有 LavaSwimmer 代理类型时跳过，返回 null。要在 <see cref="BakeNavMesh"/> 之后调用（干地探针取自人形网格）
        /// </summary>
        public static NavMeshSurface BakeLavaNavMesh(string dir, string name, Transform parent)
        {
            var vols = Object.FindObjectsByType<LavaVolume>(FindObjectsSortMode.None);
            if (vols.Length == 0) return null;
            var type = LavaSwimmerAgentType();
            if (!type.HasValue)
            {
                Debug.LogWarning($"[Level] 没有 NavMesh 代理类型「{LavaField.SwimmerAgentName}」（ProjectSettings/NavMeshAreas.asset 改了要重启编辑器）：不烘熔岩生物的导航网格");
                return null;
            }
            Bounds full = default;
            bool first = true;
            float lavaTop = float.MinValue;
            foreach (var v in vols)
            {
                var b = v.Body;
                var rect = b.WorldRect;
                float lo = b.level - b.depth - 2f, hi = b.level + 3f + Mathf.Max(0, v.tide.enabled ? v.tide.height : 0);
                lavaTop = Mathf.Max(lavaTop, b.level + LavaTuning.StandRise);
                var vb = new Bounds(new Vector3(rect.center.x, (lo + hi) * 0.5f, rect.center.y), new Vector3(rect.width, hi - lo, rect.height));
                if (first) full = vb;
                else full.Encapsulate(vb);
                first = false;
            }
            full.Expand(new Vector3(8, 0, 8));

            var go = new GameObject("NavMesh (LavaSwimmer)");
            go.transform.SetParent(parent, false);
            var nav = go.AddComponent<NavMeshSurface>();
            nav.agentTypeID = type.Value;
            nav.collectObjects = CollectObjects.Volume;
            nav.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            int fp = LayerMask.NameToLayer(ShowcaseSceneBuilder.FirstPersonLayer), ch = LayerMask.NameToLayer(ShowcaseSceneBuilder.CharacterLayer);
            nav.layerMask = ~((fp >= 0 ? 1 << fp : 0) | (ch >= 0 ? 1 << ch : 0));
            nav.defaultArea = 0;

            var dry = DryProbes(full, lavaTop);
            void Bake(SwimmerBake c)
            {
                go.transform.position = c.bounds.center;
                nav.center = Vector3.zero;
                nav.size = c.bounds.size;
                var data = BuildSwimmerData(type.Value, c.bounds, nav.layerMask, c.capFrom);
                if (!data) return;
                data.name = go.name;
                nav.RemoveData();
                nav.navMeshData = data;
                if (nav.isActiveAndEnabled) nav.AddData();
            }
            (int lava, int dry) Score() => (SwimmerCovered(vols, type.Value), SwimmerOnDry(dry, type.Value));

            var cands = SwimmerCandidates(full, lavaTop, NavMesh.GetSettingsByID(type.Value).agentHeight);
            var best = cands[0];
            Bake(best);
            var bestScore = Score();
            var log = new List<string> { $"{best.label} {bestScore.lava}/{vols.Length}·{bestScore.dry}" };
            for (int i = 1; i < cands.Count; i++)
            {
                Bake(cands[i]);
                var sc = Score();
                log.Add($"{cands[i].label} {sc.lava}/{vols.Length}·{sc.dry}");
                if (sc.lava >= bestScore.lava && (sc.lava > bestScore.lava || sc.dry < bestScore.dry))
                {
                    best = cands[i];
                    bestScore = sc;
                }
            }
            if (best.label != cands[cands.Count - 1].label) Bake(best);
            string summary = $"[Level] {name} 火鼍网格：用「{best.label}」——熔岩 {bestScore.lava}/{vols.Length} 片采得到，干地探针 {bestScore.dry}/{dry.Count} 处还在网格上" +
                             $"（各种封法 熔岩·干地：{string.Join("；", log)}）";
            if (bestScore.lava < vols.Length || bestScore.dry > 0) Debug.LogWarning(summary);
            else Debug.Log(summary);
            if (nav.navMeshData) SaveAsset(nav.navMeshData, $"{dir}/NavMesh_{name}_LavaSwimmer.asset");
            return nav;
        }

        /// <summary>一种火鼍网格的烘法：范围 + 从哪个高度起整层 Not Walkable（NaN = 不封）</summary>
        readonly struct SwimmerBake
        {
            public readonly string label;
            public readonly Bounds bounds;
            public readonly float capFrom;

            public SwimmerBake(string label, Bounds bounds, float capFrom)
            {
                this.label = label;
                this.bounds = bounds;
                this.capFrom = capFrom;
            }
        }

        /// <summary>
        /// 候选烘法，第一种是不封顶（基准：熔岩覆盖不能比它少）；另外三种：站立空间封顶（Lava 区顶 + 身高 + 0.1 m 起 Not Walkable）、
        /// 脚下封顶（Lava 区顶 + 0.2 m 起）、压低范围顶（范围顶 = Lava 区顶 + 0.05 m）
        /// </summary>
        static List<SwimmerBake> SwimmerCandidates(Bounds full, float lavaTop, float agentH)
        {
            var wet = new Bounds();
            wet.SetMinMax(full.min, new Vector3(full.max.x, lavaTop + 0.05f, full.max.z));
            return new List<SwimmerBake>
            {
                new("不封顶", full, float.NaN),
                new("站立空间封顶", full, lavaTop + agentH + 0.1f),
                new("脚下封顶", full, lavaTop + 0.2f),
                new("压低范围顶", wet, float.NaN),
            };
        }

        /// <summary>
        /// 熔岩生物网格的数据：范围 world（世界坐标、不转）里的物理碰撞体（defaultArea Walkable）+ 场上作用于这个代理的 NavMeshModifierVolume
        /// （PlaceLava 放的 Lava 区；同 NavMeshSurface.AppendModifierVolumes）+ 可选的封顶（capFrom 起到范围顶上 2 m 整层 Not Walkable），按代理类型自己的设置烘
        /// </summary>
        static NavMeshData BuildSwimmerData(int agentType, Bounds world, int layerMask, float capFrom)
        {
            var settings = NavMesh.GetSettingsByID(agentType);
            var sources = new List<NavMeshBuildSource>();
            UnityEngine.AI.NavMeshBuilder.CollectSources(world, layerMask, NavMeshCollectGeometry.PhysicsColliders, 0, new List<NavMeshBuildMarkup>(), sources);
            foreach (var m in NavMeshModifierVolume.activeModifiers)
            {
                if (!m || (layerMask & (1 << m.gameObject.layer)) == 0 || !m.AffectsAgentType(agentType)) continue;
                var scale = m.transform.lossyScale;
                sources.Add(new NavMeshBuildSource
                {
                    shape = NavMeshBuildSourceShape.ModifierBox,
                    transform = Matrix4x4.TRS(m.transform.TransformPoint(m.center), m.transform.rotation, Vector3.one),
                    size = new Vector3(m.size.x * Mathf.Abs(scale.x), m.size.y * Mathf.Abs(scale.y), m.size.z * Mathf.Abs(scale.z)),
                    area = m.area,
                });
            }
            int notWalkable = NavMesh.GetAreaFromName("Not Walkable");
            if (!float.IsNaN(capFrom) && notWalkable >= 0)
            {
                float top = world.max.y + 2f;
                sources.Add(new NavMeshBuildSource
                {
                    shape = NavMeshBuildSourceShape.ModifierBox,
                    transform = Matrix4x4.TRS(new Vector3(world.center.x, (capFrom + top) * 0.5f, world.center.z), Quaternion.identity, Vector3.one),
                    size = new Vector3(world.size.x + 4f, top - capFrom, world.size.z + 4f),
                    area = notWalkable,
                });
            }
            return UnityEngine.AI.NavMeshBuilder.BuildNavMeshData(settings, sources, new Bounds(Vector3.zero, world.size), world.center, Quaternion.identity);
        }

        /// <summary>干地探针：人形网格（这时场上只有它）在火鼍网格范围里、比 Lava 区顶高 0.4 m 以上的非熔岩三角形中心，均匀抽最多 400 个</summary>
        static List<Vector3> DryProbes(Bounds full, float lavaTop)
        {
            var tri = NavMesh.CalculateTriangulation();
            int lava = LavaNavArea;
            var all = new List<Vector3>();
            for (int t = 0; t + 2 < tri.indices.Length; t += 3)
            {
                if (tri.areas[t / 3] == lava) continue;
                var c = (tri.vertices[tri.indices[t]] + tri.vertices[tri.indices[t + 1]] + tri.vertices[tri.indices[t + 2]]) / 3f;
                if (c.y < lavaTop + 0.4f || c.y > full.max.y) continue;
                if (c.x < full.min.x || c.x > full.max.x || c.z < full.min.z || c.z > full.max.z) continue;
                all.Add(c);
            }
            if (all.Count <= 400) return all;
            var pick = new List<Vector3>(400);
            for (int i = 0; i < 400; i++) pick.Add(all[(int)((long)i * all.Count / 400)]);
            return pick;
        }

        /// <summary>干地探针里有几处 0.6 m 内（高差 0.5 m 内）踩得到火鼍网格（任何区域）</summary>
        static int SwimmerOnDry(List<Vector3> probes, int swimmerType)
        {
            var filter = new NavMeshQueryFilter { agentTypeID = swimmerType, areaMask = NavMesh.AllAreas };
            int n = 0;
            foreach (var p in probes)
                if (NavMesh.SamplePosition(p, out var hit, 0.6f, filter) && Mathf.Abs(hit.position.y - p.y) < 0.5f) n++;
            return n;
        }

        /// <summary>熔岩生物网格（只走 Lava 区）在几片熔岩的中心附近采得到（同 <see cref="ValidateLava"/> 的判法）</summary>
        static int SwimmerCovered(LavaVolume[] vols, int swimmerType)
        {
            int area = LavaNavArea;
            if (area < 0) return vols.Length;
            var filter = new NavMeshQueryFilter { agentTypeID = swimmerType, areaMask = 1 << area };
            int ok = 0;
            foreach (var v in vols)
            {
                var b = v.Body;
                if (NavMesh.SamplePosition(new Vector3(b.center.x, b.level, b.center.z), out _, Mathf.Max(3f, Mathf.Min(b.HalfExtents.x, b.HalfExtents.y)), filter)) ok++;
            }
            return ok;
        }

        /// <summary>
        /// 熔岩验收：每片熔岩有熔岩面、Lava 标签；形状中心（基准熔岩面）附近的人形导航网格是 Lava 区（工程里有这个区时）；
        /// 有 LavaSwimmer 代理类型时，熔岩生物的导航网格覆盖到它（只走 Lava 区能采到点）。场上没有熔岩时什么都不写
        /// </summary>
        public static void ValidateLava(Report rep)
        {
            var vols = Object.FindObjectsByType<LavaVolume>(FindObjectsSortMode.None);
            if (vols.Length == 0) return;
            rep.Line("— 熔岩（L7）—");
            int area = LavaNavArea;
            var swim = LavaSwimmerAgentType();
            if (area < 0) rep.Warn($"NavMesh 没有「{LavaField.AreaName}」区域：重启编辑器让 ProjectSettings/NavMeshAreas.asset 生效后重建本关");
            if (!swim.HasValue) rep.Warn($"NavMesh 没有代理类型「{LavaField.SwimmerAgentName}」：重启编辑器后重建本关");
            foreach (var v in vols)
            {
                var b = v.Body;
                string what = $"{v.name}（{(v.shape == LavaShape.Disc ? $"圆 r {v.size.x:0.#}" : $"{v.size.x:0.#} × {v.size.y:0.#}")} m，熔岩面 y {b.level:F2}）";
                var problems = new List<string>();
                if (!v.surface || !v.surface.sharedMaterial) problems.Add("没有熔岩面");
                if (!v.CompareTag(LavaField.AreaName)) problems.Add("没有 Lava 标签");
                if (area >= 0)
                {
                    var c = new Vector3(b.center.x, b.level, b.center.z);
                    if (!NavMesh.SamplePosition(c, out var hit, 2f, 1 << area)) problems.Add("中心附近的导航网格不是 Lava 区（湖心是岛时可以忽略）");
                    else if (Mathf.Abs(hit.position.y - b.level) > b.depth + 0.5f) problems.Add($"Lava 区在 y {hit.position.y:F1}，离熔岩面太远");
                }
                if (swim.HasValue && area >= 0)
                {
                    var filter = new NavMeshQueryFilter { agentTypeID = swim.Value, areaMask = 1 << area };
                    if (!NavMesh.SamplePosition(new Vector3(b.center.x, b.level, b.center.z), out _, Mathf.Max(3f, Mathf.Min(b.HalfExtents.x, b.HalfExtents.y)), filter))
                        problems.Add("熔岩生物的导航网格采不到（窄于 1.8 m 的渠游不进去，或没调 BakeLavaNavMesh）");
                }
                if (problems.Count == 0) rep.Line($"✓ {what}");
                else rep.Warn($"{what}：{string.Join("；", problems)}");
            }
        }
    }
}
