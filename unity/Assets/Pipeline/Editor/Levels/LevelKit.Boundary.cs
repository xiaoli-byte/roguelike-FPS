using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Spiritfire.Game;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 边界与天气（L3，docs/unity-parity.md D14）：游玩区遮罩 → 有符号距离场贴图 + 软边界（推回、白化）+ 远处兜底碰撞环 + 界外导航网格不可走；
    // 天气导演与区域风暴。视觉边界仍由地形给（沙丘、崖），不再立空气墙。
    public static partial class LevelKit
    {
        /// <summary>软边界的构建参数：运行时调参（<see cref="SoftBoundaryTuning"/>）+ 烘焙精度 + 兜底墙高度</summary>
        public struct BoundarySpec
        {
            public SoftBoundaryTuning tuning;
            /// <summary>距离场纹素间距（米）；等值线按它的一半取</summary>
            public float cell;
            /// <summary>遮罩 ≥ threshold 算界内（与 LevelSpec.playableThreshold 一致）</summary>
            public float threshold;
            /// <summary>界外「不可走」导航体块的格子（米）</summary>
            public float navCell;
            /// <summary>兜底碰撞环的上下沿（世界 y）</summary>
            public float wallBottom, wallTop;
            /// <summary>章节主题 key（Desert / Frost / Inferno）：白化用哪套天气</summary>
            public string theme;

            public static BoundarySpec Default => new()
            {
                tuning = SoftBoundaryTuning.Default, cell = 2f, threshold = 0.2f, navCell = 4f, wallBottom = -30f, wallTop = 80f, theme = "Desert",
            };

            /// <summary>交给 L5 防越界检查的越界距离（落到兜底环外才算出去）</summary>
            public readonly float EscapeMargin => tuning.EscapeMargin;
        }

        /// <summary>
        /// 软边界（替代以前沿等值线立的一圈空气墙）：
        ///   1. 对「游玩区遮罩」取 threshold 等值线（marching squares，半格精度），烘成有符号距离场（米，区内为负）存成可读的 RFloat 贴图 Boundary_&lt;name&gt;_SDF.asset；
        ///   2. 放 <see cref="BoundaryZone"/>：运行时按距离场推回玩家、给天气导演白化、拴回离开导航网格的敌人；
        ///   3. 离等值线 tuning.failsafe 米处立一圈兜底碰撞（Ignore Raycast 层：子弹、视线穿过；只防技能位移 / 击飞把人送出图）；
        ///   4. 离等值线 navInset 米以外铺 NavMeshModifierVolume（Not Walkable）：之后烘的导航网格不出界，敌人寻路不会追进风沙里。
        /// 要在 BakeNavMesh 之前调。旧的空气墙网格资产 Boundary_&lt;name&gt;.asset 顺手删掉。
        /// </summary>
        public static BoundaryZone Boundary(string dir, string name, Transform parent, Func<Vector2, float> inside, Rect area) =>
            Boundary(dir, name, parent, inside, area, BoundarySpec.Default);

        public static BoundaryZone Boundary(string dir, string name, Transform parent, Func<Vector2, float> inside, Rect area, BoundarySpec spec)
        {
            if (!(spec.cell > 0)) spec = BoundarySpec.Default;
            var t = spec.tuning;
            AssetDatabase.DeleteAsset($"{dir}/Boundary_{name}.asset");

            // 1. 距离场
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var (data, w, h, segs) = BakeSignedDistance(inside, area, spec.threshold, spec.cell);
            var tex = new Texture2D(w, h, TextureFormat.RFloat, false, true)
            {
                name = $"Boundary_{name}_SDF", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear,
            };
            tex.SetPixelData(data, 0);
            tex.Apply(false, false); // 保持可读：运行时 BoundaryField 读回内存
            SaveAsset(tex, $"{dir}/Boundary_{name}_SDF.asset");

            var root = new GameObject("Boundary");
            root.transform.SetParent(parent, false);
            var zone = root.AddComponent<BoundaryZone>();
            zone.sdf = tex;
            zone.origin = area.min;
            zone.cell = spec.cell;
            zone.tuning = t;
            zone.theme = string.IsNullOrEmpty(spec.theme) ? "Desert" : spec.theme;

            // 2. 兜底碰撞环
            float failsafe = t.failsafe;
            var ring = Contour((x, z) => failsafe - data[z * w + x], w - 1, h - 1, area.min, spec.cell);
            var wall = WallMesh(ring, spec.wallBottom, spec.wallTop, $"Boundary_{name}_Failsafe");
            SaveAsset(wall, $"{dir}/Boundary_{name}_Failsafe.asset");
            var fs = new GameObject("Failsafe Ring") { layer = 2 };
            fs.transform.SetParent(root.transform, false);
            fs.isStatic = true;
            fs.AddComponent<MeshCollider>().sharedMesh = wall;

            // 3. 界外不可走
            int blocks = NavBlockers(root.transform, data, w, h, area.min, spec.cell, t.navInset, spec.navCell);

            float len = segs.Sum(s => Vector2.Distance(s.a, s.b)), ringLen = ring.Sum(s => Vector2.Distance(s.a, s.b));
            Debug.Log($"[Level] 软边界：等值线 {segs.Count} 段约 {len:F0} m；距离场 {w} × {h}（{spec.cell} m）；兜底环离线 {t.failsafe} m、约 {ringLen:F0} m；" +
                      $"界外不可走体块 {blocks} 个；推回 ({t.pushBase} + {t.pushGain} × 风力) m/s，走路顶到 +{t.HoldDepth(7.5f):F1} m；{sw.Elapsed.TotalSeconds:F1} s");
            return zone;
        }

        /// <summary>
        /// 有符号距离场：节点 (i, j) = area.min + (i, j) × cell，值 = 到等值线的距离（米），界内为负。
        /// 等值线在半格的细网格上取（marching squares），每个节点到最近线段的精确距离用分桶加速。返回数据（行优先，宽 w 高 h）与等值线线段
        /// </summary>
        public static (float[] data, int w, int h, List<(Vector2 a, Vector2 b)> segs) BakeSignedDistance(Func<Vector2, float> inside, Rect area, float threshold, float cell)
        {
            int nx = Mathf.Max(1, Mathf.CeilToInt(area.width / cell)), nz = Mathf.Max(1, Mathf.CeilToInt(area.height / cell));
            int fx = nx * 2, fz = nz * 2;
            float fc = cell * 0.5f;
            var fine = new float[(fz + 1) * (fx + 1)];
            Parallel.For(0, fz + 1, z =>
            {
                for (int x = 0; x <= fx; x++) fine[z * (fx + 1) + x] = inside(new Vector2(area.xMin + x * fc, area.yMin + z * fc)) - threshold;
            });
            var segs = Contour((x, z) => fine[z * (fx + 1) + x], fx, fz, area.min, fc);

            int w = nx + 1, h = nz + 1;
            var data = new float[w * h];
            // 线段分桶（8 m）：节点由近到远一圈圈找，找到的最近距离小于下一圈的最小可能距离就停
            const float bucket = 8f;
            int bx = Mathf.CeilToInt((nx * cell) / bucket) + 1, bz = Mathf.CeilToInt((nz * cell) / bucket) + 1;
            var buckets = new List<int>[bx * bz];
            for (int k = 0; k < segs.Count; k++)
            {
                var (a, b) = segs[k];
                int x0 = Mathf.Clamp((int)((Mathf.Min(a.x, b.x) - area.xMin) / bucket), 0, bx - 1), x1 = Mathf.Clamp((int)((Mathf.Max(a.x, b.x) - area.xMin) / bucket), 0, bx - 1);
                int z0 = Mathf.Clamp((int)((Mathf.Min(a.y, b.y) - area.yMin) / bucket), 0, bz - 1), z1 = Mathf.Clamp((int)((Mathf.Max(a.y, b.y) - area.yMin) / bucket), 0, bz - 1);
                for (int z = z0; z <= z1; z++)
                for (int x = x0; x <= x1; x++)
                    (buckets[z * bx + x] ??= new List<int>()).Add(k);
            }
            int maxRing = Mathf.Max(bx, bz);
            Parallel.For(0, h, j =>
            {
                for (int i = 0; i < w; i++)
                {
                    var p = new Vector2(area.xMin + i * cell, area.yMin + j * cell);
                    bool inner = fine[(j * 2) * (fx + 1) + i * 2] >= 0;
                    float best = float.MaxValue;
                    int cx = Mathf.Clamp((int)((p.x - area.xMin) / bucket), 0, bx - 1), cz = Mathf.Clamp((int)((p.y - area.yMin) / bucket), 0, bz - 1);
                    for (int r = 0; r <= maxRing; r++)
                    {
                        for (int z = cz - r; z <= cz + r; z++)
                        {
                            if (z < 0 || z >= bz) continue;
                            for (int x = cx - r; x <= cx + r; x++)
                            {
                                if (x < 0 || x >= bx || (Mathf.Abs(x - cx) != r && Mathf.Abs(z - cz) != r)) continue;
                                var list = buckets[z * bx + x];
                                if (list == null) continue;
                                foreach (var k in list) best = Mathf.Min(best, SegmentDistance(p, segs[k].a, segs[k].b));
                            }
                        }
                        if (best <= r * bucket) break;
                    }
                    if (best == float.MaxValue) best = 1000f; // 范围里没有边界：全在界内或全在界外
                    data[j * w + i] = inner ? -best : best;
                }
            });
            return (data, w, h, segs);
        }

        static float SegmentDistance(Vector2 p, Vector2 a, Vector2 b)
        {
            var ab = b - a;
            float l2 = ab.sqrMagnitude;
            float t = l2 > 1e-8f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / l2) : 0;
            return Vector2.Distance(p, a + ab * t);
        }

        /// <summary>marching squares：value(x, z) &gt; 0 的一侧算「里面」（nx × nz 格，节点 = origin + (x, z) × cell），返回 value = 0 的等值线线段</summary>
        static List<(Vector2 a, Vector2 b)> Contour(Func<int, int, float> value, int nx, int nz, Vector2 origin, float cell)
        {
            float V(int x, int z) => value(x, z);
            Vector2 P(int x, int z) => new(origin.x + x * cell, origin.y + z * cell);
            Vector2 Cross(Vector2 a, Vector2 b, float va, float vb) => Vector2.Lerp(a, b, va / (va - vb));
            var segs = new List<(Vector2 a, Vector2 b)>();
            var pts = new List<Vector2>(4);
            for (int z = 0; z < nz; z++)
            for (int x = 0; x < nx; x++)
            {
                float v00 = V(x, z), v10 = V(x + 1, z), v11 = V(x + 1, z + 1), v01 = V(x, z + 1);
                pts.Clear();
                if ((v00 > 0) != (v10 > 0)) pts.Add(Cross(P(x, z), P(x + 1, z), v00, v10));
                if ((v10 > 0) != (v11 > 0)) pts.Add(Cross(P(x + 1, z), P(x + 1, z + 1), v10, v11));
                if ((v11 > 0) != (v01 > 0)) pts.Add(Cross(P(x + 1, z + 1), P(x, z + 1), v11, v01));
                if ((v01 > 0) != (v00 > 0)) pts.Add(Cross(P(x, z + 1), P(x, z), v01, v00));
                for (int i = 0; i + 1 < pts.Count; i += 2) segs.Add((pts[i], pts[i + 1]));
            }
            return segs;
        }

        /// <summary>沿线段立竖直的双面墙（bottom → top）</summary>
        static Mesh WallMesh(List<(Vector2 a, Vector2 b)> segs, float bottom, float top, string name)
        {
            var verts = new List<Vector3>(segs.Count * 4);
            var tris = new List<int>(segs.Count * 12);
            foreach (var (a, b) in segs)
            {
                int i0 = verts.Count;
                verts.Add(new Vector3(a.x, bottom, a.y));
                verts.Add(new Vector3(b.x, bottom, b.y));
                verts.Add(new Vector3(b.x, top, b.y));
                verts.Add(new Vector3(a.x, top, a.y));
                tris.AddRange(new[] { i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3, i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2 });
            }
            var mesh = new Mesh { name = name, indexFormat = verts.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// 界外「不可走」：navCell 米的格子，格子整个在 navInset 之外（格心距离 &gt; navInset + 半对角）就标记；按行取连续段、上下相同的段合并成矩形，
        /// 每个矩形一个 NavMeshModifierVolume（Not Walkable，高 1000 m）。返回体块数
        /// </summary>
        static int NavBlockers(Transform root, float[] sdf, int w, int h, Vector2 origin, float cell, float navInset, float navCell)
        {
            var field = new BoundaryField(sdf, w, h, origin, cell);
            var area = field.Area;
            int nx = Mathf.CeilToInt(area.width / navCell), nz = Mathf.CeilToInt(area.height / navCell);
            float margin = navInset + navCell * 0.7072f;
            var blocked = new bool[nx * nz];
            for (int z = 0; z < nz; z++)
            for (int x = 0; x < nx; x++)
                blocked[z * nx + x] = field.Sample(area.xMin + (x + 0.5f) * navCell, area.yMin + (z + 0.5f) * navCell) > margin;

            var parent = new GameObject("Nav Blockers (Not Walkable)").transform;
            parent.SetParent(root, false);
            int notWalkable = NavMesh.GetAreaFromName("Not Walkable");
            if (notWalkable < 0) notWalkable = 1;
            // 行内连续段 → 与上一行相同的段向下延长
            var open = new Dictionary<(int x0, int x1), int>(); // 段 → 起始行
            int count = 0;
            void Emit(int x0, int x1, int z0, int z1)
            {
                var go = new GameObject($"Not Walkable {count:000}");
                go.transform.SetParent(parent, false);
                go.transform.position = new Vector3(area.xMin + (x0 + x1) * 0.5f * navCell, 0, area.yMin + (z0 + z1) * 0.5f * navCell);
                go.isStatic = true;
                var v = go.AddComponent<NavMeshModifierVolume>();
                v.center = Vector3.zero;
                v.size = new Vector3((x1 - x0) * navCell, 1000f, (z1 - z0) * navCell);
                v.area = notWalkable;
                count++;
            }
            for (int z = 0; z <= nz; z++)
            {
                var runs = new HashSet<(int, int)>();
                if (z < nz)
                    for (int x = 0; x < nx;)
                    {
                        if (!blocked[z * nx + x]) { x++; continue; }
                        int s = x;
                        while (x < nx && blocked[z * nx + x]) x++;
                        runs.Add((s, x));
                    }
                foreach (var key in open.Keys.ToList())
                    if (!runs.Contains(key))
                    {
                        Emit(key.x0, key.x1, open[key], z);
                        open.Remove(key);
                    }
                foreach (var r in runs)
                    if (!open.ContainsKey(r))
                        open[r] = z;
            }
            return count;
        }

        // ───────────── 天气 ─────────────

        /// <summary>
        /// 天气导演（<see cref="WeatherDirector"/>）：基础雾 / 主光取刚由 BuildLighting 设好的 RenderSettings（= 主题），盛行风 windDir（风吹去的方向），
        /// 区域风暴按需传（1-1 ④ 的沙暴）。不放的话软边界开场时也会补一个只管白化的导演。
        /// </summary>
        public static WeatherDirector Weather(Transform parent, ShowcaseTheme theme, Vector2 windDir, float baseWind = 0.25f, params WeatherDirector.Region[] regions)
        {
            var go = new GameObject("Weather");
            go.transform.SetParent(parent, false);
            var d = go.AddComponent<WeatherDirector>();
            d.theme = theme != null ? theme.key : "Desert";
            d.baseFogColor = RenderSettings.fogColor;
            d.baseFogStart = RenderSettings.fogStartDistance;
            d.baseFogEnd = RenderSettings.fogEndDistance;
            d.sun = RenderSettings.sun;
            d.windDir = windDir.sqrMagnitude > 1e-6f ? windDir.normalized : Vector2.right;
            d.baseWind = Mathf.Clamp01(baseWind);
            d.regions = regions ?? Array.Empty<WeatherDirector.Region>();
            foreach (var r in d.regions)
                Debug.Log($"[Level] 区域天气「{r.name}」：{r.profile}，圆心 {r.center}，半径 {r.radius} m（淡出 {r.fade} m），平静 {r.calm} / 预警 {r.warn} / 风暴 {r.storm} / 消退 {r.abate} s");
            return d;
        }
    }
}
