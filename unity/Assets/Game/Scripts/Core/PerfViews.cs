using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一个固定机位：站点（地面）、看向哪里、是不是战斗机位 / 主线机位链上的一段</summary>
    public struct PerfView
    {
        public string name;
        public Vector3 stand, look;
        public bool combat, chain;

        public Vector3 Eye => stand + Vector3.up * PlayerFactory.EyeHeight;
    }

    /// <summary>
    /// 固定机位（I4，docs/performance-unity.md「协议」）：全由关卡数据推出来，关卡布局不变机位就不变。运行时的性能套件（playtest perf，PerfSuite）
    /// 和 L5 的 PerfBudgetCheck 用同一份规则：
    ///   出生 = PlayerSpawn 的位置和朝向；
    ///   中段远眺 = 离俯视图中心最近的地点（有别的地点时不用战斗场地），往出生点一侧退 8 m，看离它最远的地点；
    ///   战斗 = 离出生点最近的必清场地（首领关：首领场），往出生点一侧退 10 m 看中心。藏宝点不算地点（支路、常在角落）；
    ///   主线 = 出生点 + 必经地点按最近邻串成一条线，相邻两点一个机位（站前一点、看后一点），最多 <see cref="MaxChain"/> 个，挨得太近（&lt; 5 m）的跳过。
    /// </summary>
    public static class PerfViews
    {
        public const string Spawn = "出生", Vista = "中段远眺", Fight = "战斗";
        public const int MaxChain = 8;

        /// <param name="chain">带上主线机位链</param>
        public static List<PerfView> Compute(Vector3 spawnPos, Quaternion spawnRot, IReadOnlyList<LevelPoi> allPois, Rect mapArea, bool chain = false)
        {
            var views = Core(spawnPos, spawnRot, allPois, mapArea);
            if (chain) views.AddRange(Chain(spawnPos, allPois));
            return views;
        }

        /// <summary>主线机位链：出生点 + 必经地点按最近邻串起来，相邻两点一个机位</summary>
        public static List<PerfView> Chain(Vector3 spawnPos, IReadOnlyList<LevelPoi> allPois)
        {
            var left = allPois == null ? new List<LevelPoi>() : allPois.Where(p => !p.optional && p.kind != MapPoiKind.Cache).ToList();
            var line = new List<(string name, Vector3 pos)> { ("出生点", spawnPos) };
            while (left.Count > 0)
            {
                var last = line[^1].pos;
                int k = 0;
                for (int i = 1; i < left.Count; i++)
                    if ((left[i].position - last).sqrMagnitude < (left[k].position - last).sqrMagnitude) k = i;
                line.Add((left[k].name, left[k].position));
                left.RemoveAt(k);
            }
            var views = new List<PerfView>();
            for (int i = 0; i + 1 < line.Count && views.Count < MaxChain; i++)
            {
                var stand = line[i].pos;
                var look = line[i + 1].pos + Vector3.up * 1.2f;
                if ((look - stand - Vector3.up * PlayerFactory.EyeHeight).sqrMagnitude < 25) continue;
                views.Add(new PerfView { name = $"主线 {views.Count + 1}（{line[i].name} → {line[i + 1].name}）", stand = stand, look = look, chain = true });
            }
            return views;
        }

        /// <summary>站点贴到地面：先找 NavMesh 上 6 m 内最近的点（不会落到屋顶上），没有就往下打射线</summary>
        public static Vector3 Ground(Vector3 p)
        {
            if (UnityEngine.AI.NavMesh.SamplePosition(p, out var hit, 6f, UnityEngine.AI.NavMesh.AllAreas)) return hit.position;
            return Physics.Raycast(p + Vector3.up * 3, Vector3.down, out var h, 40, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point : p;
        }

        static List<PerfView> Core(Vector3 spawnPos, Quaternion spawnRot, IReadOnlyList<LevelPoi> allPois, Rect mapArea)
        {
            var fwd = Flat(spawnRot * Vector3.forward);
            fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
            var views = new List<PerfView> { new() { name = Spawn, stand = spawnPos, look = spawnPos + fwd * 50 + Vector3.up * PlayerFactory.EyeHeight } };
            var pois = allPois == null ? new List<LevelPoi>() : allPois.Where(p => p.kind != MapPoiKind.Cache).ToList();
            if (pois.Count == 0) return views;

            var sites = pois.Where(p => p.kind == MapPoiKind.Site && !p.optional).OrderBy(p => Flat(p.position - spawnPos).sqrMagnitude).ToList();
            var arena = sites.Count > 0 ? sites[0] : pois.FirstOrDefault(p => p.kind == MapPoiKind.Boss);
            if (arena.name == null) arena = pois.OrderBy(p => Flat(p.position - spawnPos).sqrMagnitude).First();

            var midPool = pois.Count > 1 ? pois.Where(p => p.name != arena.name || p.position != arena.position).ToList() : pois;
            var center = mapArea.width > 0 && mapArea.height > 0 ? new Vector3(mapArea.center.x, 0, mapArea.center.y) : spawnPos;
            var mid = midPool.OrderBy(p => Flat(p.position - center).sqrMagnitude).ThenBy(p => p.name, StringComparer.Ordinal).First();
            var far = pois.OrderByDescending(p => Flat(p.position - mid.position).sqrMagnitude).ThenBy(p => p.name, StringComparer.Ordinal).First();
            views.Add(new PerfView { name = Vista, stand = mid.position + Back(spawnPos, mid.position, fwd) * 8f, look = far.position + Vector3.up * PlayerFactory.EyeHeight });
            views.Add(new PerfView { name = Fight, stand = arena.position + Back(spawnPos, arena.position, fwd) * 10f, look = arena.position + Vector3.up * 1f, combat = true });
            return views;
        }

        static Vector3 Back(Vector3 spawn, Vector3 at, Vector3 fwd)
        {
            var b = Flat(spawn - at);
            return b.sqrMagnitude > 1 ? b.normalized : -fwd;
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);

        // ───────────── 估算（L5 构建时用；运行时套件也算一遍对照）─────────────

        /// <summary>一个机位的估算：主相机（FOV 70°、16:9、远裁 1500 m）视锥 + 按层剔除距离里的渲染器；投影体 = 阴影距离内投影的渲染器</summary>
        public struct Estimate
        {
            public int renderers, draws, casters, casterDraws;
            public long triangles;
            public override string ToString() => $"渲染器 {renderers}、三角面 {triangles / 1000f:F0}k、绘制 {draws}（+ 投影 {casterDraws}，投影体 {casters}）";
        }

        public const float Fov = 70f, Aspect = 16f / 9f, Far = 1500f;

        /// <summary>
        /// 估算一个机位（不含遮挡、地形、粒子、天空 / 后处理）。layer 取 <see cref="CullLayers.Classify"/> 会给的层（构建时还都在 Default），
        /// 距离按 <paramref name="p"/> 这一档的剔除距离；渲染器是第一人称 / 角色层、关着、forceRenderingOff 的不算。
        /// </summary>
        public static Estimate Measure(PerfView v, IReadOnlyList<Renderer> renderers, QualityProfile p, float fogEnd, float shadowDistance)
        {
            var eye = v.Eye;
            var dir = v.look - eye;
            if (dir.sqrMagnitude < 1e-4f) dir = Vector3.forward;
            var view = Matrix4x4.TRS(eye, Quaternion.LookRotation(dir), Vector3.one).inverse;
            view.m20 = -view.m20; view.m21 = -view.m21; view.m22 = -view.m22; view.m23 = -view.m23; // 相机看 −Z
            var planes = GeometryUtility.CalculateFrustumPlanes(Matrix4x4.Perspective(Fov, Aspect, 0.05f, Far) * view);
            var (detail, scatter) = CullLayers.Distances(p, fogEnd);
            var e = new Estimate();
            foreach (var r in renderers)
            {
                if (!r || !r.enabled || r.forceRenderingOff || !r.gameObject.activeInHierarchy) continue;
                int layer = r.gameObject.layer;
                if (layer == Layers.FirstPerson || layer == Layers.Character) continue;
                if (r is not MeshRenderer && r is not SkinnedMeshRenderer) continue;
                var mesh = MeshOf(r);
                if (!mesh) continue;
                var b = r.bounds;
                float dist = Vector3.Distance(eye, b.center);
                int cls = r is MeshRenderer ? CullLayers.Classify(r) : -1;
                float cull = cls == CullLayers.Detail ? detail : cls == CullLayers.Scatter ? scatter : 0;
                if (cull > 0 && dist > cull) continue;
                int draws = Mathf.Max(1, Mathf.Min(mesh.subMeshCount, r.sharedMaterials.Length));
                // 运行时静态合批后 sharedMesh 是整批的合并网格：只数这个渲染器自己那几段子网格
                long tris = r.isPartOfStaticBatch && r is MeshRenderer mr ? Triangles(mesh, mr.subMeshStartIndex, r.sharedMaterials.Length) : Triangles(mesh);
                if (r.shadowCastingMode != UnityEngine.Rendering.ShadowCastingMode.Off && Mathf.Sqrt(b.SqrDistance(eye)) <= shadowDistance)
                {
                    e.casters++;
                    e.casterDraws += draws;
                }
                if (!GeometryUtility.TestPlanesAABB(planes, b)) continue;
                e.renderers++;
                e.draws += draws;
                e.triangles += tris;
            }
            return e;
        }

        /// <summary>渲染器的网格（MeshRenderer 没有 MeshFilter 的——文字网格之类——是 null）</summary>
        public static Mesh MeshOf(Renderer r) => r switch
        {
            SkinnedMeshRenderer s => s.sharedMesh,
            MeshRenderer => r.TryGetComponent<MeshFilter>(out var f) ? f.sharedMesh : null,
            _ => null,
        };

        /// <summary>网格里 [start, start + count) 这几段子网格的三角面</summary>
        public static long Triangles(Mesh m, int start, int count)
        {
            long n = 0;
            for (int s = Mathf.Max(0, start); s < Mathf.Min(m.subMeshCount, start + count); s++)
                if (m.GetTopology(s) == MeshTopology.Triangles) n += m.GetIndexCount(s) / 3;
            return n;
        }

        public static long Triangles(Mesh m)
        {
            long n = 0;
            for (int s = 0; s < m.subMeshCount; s++)
                if (m.GetTopology(s) == MeshTopology.Triangles) n += m.GetIndexCount(s) / 3;
            return n;
        }
    }
}
