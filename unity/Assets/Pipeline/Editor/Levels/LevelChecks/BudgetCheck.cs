using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 面数 / 绘制批次预算（粗估，真实帧数据看运行时的 PerfOverlay）：
    ///   全场景：所有启用的渲染器按 LOD0 合计三角面；
    ///   机位：主线每个路点眼高看向下一个路点（加上声明的机位），视锥剔除 + 按屏占比选 LOD，合计三角面与绘制调用（渲染器 × 子网格）。
    ///   不含：地形（按 pixelError 动态细分）、阴影投射、遮挡剔除、静态合批 / SRP Batcher 的合并——所以绘制调用是上限，
    ///   另报「按材质合并后的下限」作参考。第一人称层（枪、手）不计。超出 LevelSpec.budget 不合格。
    /// </summary>
    public sealed class BudgetCheck : ILevelCheck
    {
        public string Id => "budget";
        public string Title => "面数 / 批次预算（粗估）";
        public int Order => 130;

        sealed class Item
        {
            public Renderer r;
            public int tris, draws;
            public LODGroup lod;
            public int lodIndex = -1;
            public string group;
        }

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var items = Collect(out int particles, out int terrains);
            var budget = ctx.spec.budget;
            long sceneTris = items.Where(i => i.lodIndex <= 0).Sum(i => (long)i.tris);
            int sceneDraws = items.Where(i => i.lodIndex <= 0).Sum(i => i.draws);
            int lodGroups = items.Where(i => i.lod).Select(i => i.lod).Distinct().Count();
            rep.Line($"全场景（LOD0）：{items.Count(i => i.lodIndex <= 0)} 个渲染器，{sceneTris:N0} 面，{sceneDraws} 次绘制；LOD 组 {lodGroups} 个，粒子系统 {particles} 个，地形 {terrains} 块（不计）");
            if (budget.sceneTriangles > 0 && sceneTris > budget.sceneTriangles) rep.Fail($"全场景 LOD0 {sceneTris:N0} 面，超出预算 {budget.sceneTriangles:N0}");

            // 关卡场景里没有相机（L1 起玩家在 Core 场景）：用 PlayerFactory 的主相机参数（FOV 70°、远裁 1500 m）
            var cam = Camera.main ? Camera.main : Object.FindAnyObjectByType<Camera>();
            float fov = cam ? cam.fieldOfView : 70f, far = cam ? cam.farClipPlane : 1500f;
            var views = new List<View>(ctx.spec.views);
            var route = ctx.spec.route;
            float eye = ctx.Scale.eye;
            for (int i = 0; i < route.Count; i++)
            {
                var from = route[i].pos + Vector3.up * eye;
                var to = i + 1 < route.Count ? route[i + 1].pos : route.Count > 1 ? route[i - 1].pos : route[i].pos + Vector3.forward * 10;
                to.y = from.y;
                if ((to - from).sqrMagnitude < 1) to = from + Vector3.forward * 10;
                views.Add(new View { name = route[i].name, eye = from, target = to });
            }
            if (views.Count == 0)
            {
                rep.Line("没有主线路点和声明的机位，只报全场景合计");
                return;
            }
            (View view, long tris, int draws, int minDraws, Dictionary<string, long> byGroup) worst = default;
            long worstDraws = -1;
            foreach (var v in views)
            {
                var (tris, draws, minDraws, byGroup) = Estimate(items, v, fov, far);
                if (tris > worst.tris || (tris == worst.tris && draws > worstDraws)) worst = (v, tris, draws, minDraws, byGroup);
                worstDraws = Mathf.Max((int)worstDraws, draws);
            }
            int maxDraws = (int)worstDraws;
            rep.Line($"机位 {views.Count} 个（FOV {fov:F0}°，远裁 {far:F0} m）：最重的画面是「{worst.view.name}」{worst.tris:N0} 面、{worst.draws} 次绘制（按材质合并后下限 {worst.minDraws}）；绘制次数最多 {maxDraws}");
            var top = worst.byGroup?.OrderByDescending(kv => kv.Value).Take(5).Select(kv => $"{kv.Key} {kv.Value:N0}").ToList();
            if (top != null && top.Count > 0) rep.Line($"    面数大头：{string.Join(" · ", top)}");
            if (budget.viewTriangles > 0 && worst.tris > budget.viewTriangles) rep.Fail($"机位「{worst.view.name}」{worst.tris:N0} 面，超出预算 {budget.viewTriangles:N0}");
            else rep.Line($"✓ 机位面数 ≤ {budget.viewTriangles:N0}");
            if (budget.viewDrawCalls > 0 && maxDraws > budget.viewDrawCalls) rep.Fail($"机位绘制次数 {maxDraws}，超出预算 {budget.viewDrawCalls}");
            else rep.Line($"✓ 机位绘制次数 ≤ {budget.viewDrawCalls}");
        }

        static List<Item> Collect(out int particles, out int terrains)
        {
            int fpLayer = Layers.FirstPerson;
            var lodOf = new Dictionary<Renderer, (LODGroup g, int i)>();
            foreach (var g in Object.FindObjectsByType<LODGroup>())
            {
                if (!g.enabled) continue;
                var lods = g.GetLODs();
                for (int i = 0; i < lods.Length; i++)
                    foreach (var r in lods[i].renderers)
                        if (r && !lodOf.ContainsKey(r)) lodOf[r] = (g, i);
            }
            var items = new List<Item>();
            particles = 0;
            terrains = Terrain.activeTerrains.Length;
            foreach (var r in Object.FindObjectsByType<Renderer>())
            {
                if (!r.enabled || !r.gameObject.activeInHierarchy || r.gameObject.layer == fpLayer || r.forceRenderingOff) continue;
                int tris = 0, draws;
                switch (r)
                {
                    case MeshRenderer mr:
                        var mf = mr.GetComponent<MeshFilter>();
                        var mesh = mf ? mf.sharedMesh : null;
                        if (!mesh) continue;
                        tris = Triangles(mesh);
                        draws = Mathf.Max(1, Mathf.Min(mesh.subMeshCount, r.sharedMaterials.Length));
                        break;
                    case SkinnedMeshRenderer smr:
                        if (!smr.sharedMesh) continue;
                        tris = Triangles(smr.sharedMesh);
                        draws = Mathf.Max(1, Mathf.Min(smr.sharedMesh.subMeshCount, r.sharedMaterials.Length));
                        break;
                    case ParticleSystemRenderer:
                        particles++;
                        draws = 1;
                        break;
                    default:
                        draws = 1;
                        break;
                }
                var item = new Item { r = r, tris = tris, draws = draws, group = GroupName(r.transform) };
                if (lodOf.TryGetValue(r, out var l)) { item.lod = l.g; item.lodIndex = l.i; }
                items.Add(item);
            }
            return items;
        }

        static int Triangles(Mesh m)
        {
            long n = 0;
            for (int s = 0; s < m.subMeshCount; s++)
                if (m.GetTopology(s) == MeshTopology.Triangles) n += m.GetIndexCount(s) / 3;
            return (int)n;
        }

        /// <summary>按「最外层的 Prefab 实例名」归组（去掉 (1) 这类编号），报告面数大头用</summary>
        static string GroupName(Transform t)
        {
            var root = UnityEditor.PrefabUtility.GetOutermostPrefabInstanceRoot(t.gameObject);
            string n = root ? root.name : t.name;
            int k = n.IndexOf(" (", System.StringComparison.Ordinal);
            return k > 0 ? n.Substring(0, k) : n;
        }

        static (long tris, int draws, int minDraws, Dictionary<string, long> byGroup) Estimate(List<Item> items, View v, float fov, float far)
        {
            var dir = v.target - v.eye;
            if (dir.sqrMagnitude < 1e-4f) dir = Vector3.forward;
            var view = Matrix4x4.TRS(v.eye, Quaternion.LookRotation(dir), Vector3.one).inverse;
            view.m20 = -view.m20; view.m21 = -view.m21; view.m22 = -view.m22; view.m23 = -view.m23; // 相机看 −Z
            var proj = Matrix4x4.Perspective(fov, 16f / 9f, 0.1f, far);
            var planes = GeometryUtility.CalculateFrustumPlanes(proj * view);
            float halfTan = Mathf.Tan(fov * 0.5f * Mathf.Deg2Rad);
            float bias = QualitySettings.lodBias;
            var chosen = new Dictionary<LODGroup, int>();
            long tris = 0;
            int draws = 0;
            var mats = new HashSet<Material>();
            int dynamicDraws = 0;
            var byGroup = new Dictionary<string, long>();
            foreach (var it in items)
            {
                if (!GeometryUtility.TestPlanesAABB(planes, it.r.bounds)) continue;
                if (it.lod)
                {
                    if (!chosen.TryGetValue(it.lod, out int pick))
                    {
                        pick = PickLod(it.lod, v.eye, halfTan, bias);
                        chosen[it.lod] = pick;
                    }
                    if (pick != it.lodIndex) continue;
                }
                tris += it.tris;
                draws += it.draws;
                byGroup[it.group] = (byGroup.TryGetValue(it.group, out var g) ? g : 0) + it.tris;
                if (it.r.gameObject.isStatic)
                    foreach (var m in it.r.sharedMaterials)
                        if (m) mats.Add(m);
                        else dynamicDraws++;
                else dynamicDraws += it.draws;
            }
            return (tris, draws, mats.Count + dynamicDraws, byGroup);
        }

        /// <summary>按屏占比选 LOD（同 Unity：相对高度 = size × 最大缩放 / (2 × 距离 × tan(fov/2))，再乘 lodBias）；比最后一级还小 = 剔除（−1）</summary>
        static int PickLod(LODGroup g, Vector3 eye, float halfTan, float bias)
        {
            var lods = g.GetLODs();
            var t = g.transform;
            var s = t.lossyScale;
            float size = g.size * Mathf.Max(Mathf.Abs(s.x), Mathf.Max(Mathf.Abs(s.y), Mathf.Abs(s.z)));
            float dist = Mathf.Max(0.01f, Vector3.Distance(eye, t.TransformPoint(g.localReferencePoint)));
            float rel = size / (2 * dist * halfTan) * bias;
            for (int i = 0; i < lods.Length; i++)
                if (rel >= lods[i].screenRelativeTransitionHeight) return i;
            return -1;
        }
    }
}
