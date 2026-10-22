using System;
using System.Collections.Generic;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 台地（M22 2-2 昆仑天阙起用）：阶梯坡（Landform.SteppedSlope）上的跨墙台阶、找墙线位置、按墙线连排挡土墙段。归 M22，其它地图只追加。
    // SteppedSlope 自带的「坡道车道」是切进每一级台面的沟；这里的台阶是贴着某一道墙、从下一级台面斜着填上去的一段直坡（只填不挖），
    // 每道墙可以各开各的位置——台阶的位置就是路线。
    public static partial class LevelKit
    {
        /// <summary>一段直台阶（只填不挖）：坡脚 foot（地面 footY）→ 坡顶 top（地面 topY），宽 width；剖面同 1-1 / 1-2 的坡道（30% 缓入缓出 + 70% 直坡）</summary>
        public struct TerraceFlight
        {
            public string name;
            public Vector2 foot, top;
            public float footY, topY, width;

            public float Length => Vector2.Distance(foot, top);
            /// <summary>剖面最陡处的坡度（度）：直坡 0.7 + 缓入缓出 0.3 × 1.5 = 1.15 倍平均坡</summary>
            public float MaxGrade => Mathf.Atan(1.15f * Mathf.Abs(topY - footY) / Mathf.Max(0.1f, Length)) * Mathf.Rad2Deg;

            public TerraceFlight(string name, Vector2 foot, Vector2 top, float footY, float topY, float width)
            {
                this.name = name;
                this.foot = foot;
                this.top = top;
                this.footY = footY;
                this.topY = topY;
                this.width = width;
            }
        }

        /// <summary>阶梯坡的上坡方向与横向（SteppedSlope 里 across = 点到 origin 的向量在 side 上的投影）</summary>
        static (Vector2 dir, Vector2 side) SteppedAxes(in SteppedSlopeSpec s)
        {
            float a = s.angle * Mathf.Deg2Rad;
            var dir = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
            return (dir, new Vector2(-dir.y, dir.x));
        }

        /// <summary>
        /// 阶梯坡第 k 道挡土墙在横向 across 处的墙线中点（世界 XZ）：沿上坡方向二分「SteppedSlope = (k + 0.5) × stepHeight」的位置，
        /// 墙线的弯曲（bend）算在里面。只看台阶本身，坡道车道（ramps）不算。
        /// </summary>
        public static Vector2 SteppedWallPoint(in SteppedSlopeSpec s, int k, float across)
        {
            var (dir, side) = SteppedAxes(s);
            var spec = s;
            spec.ramps = null;
            float period = s.shelfDepth + s.wallRun, target = (k + 0.5f) * s.stepHeight, slack = Mathf.Abs(s.bend) * 2 + 2;
            float lo = k * period - slack, hi = k * period + s.wallRun + slack;
            var o = s.origin + side * across;
            for (int i = 0; i < 40; i++)
            {
                float mid = (lo + hi) * 0.5f;
                if (SteppedSlope(o + dir * mid, spec, out _, out _, out _, out _) < target) lo = mid;
                else hi = mid;
            }
            return o + dir * ((lo + hi) * 0.5f);
        }

        /// <summary>
        /// 贴着阶梯坡第 k 道挡土墙的一段直台阶：坡顶压过墙顶 overlap 米（落在上一级台面上），坡脚在下一级台面上、离坡顶 run 米。
        /// baseY = 阶梯坡坡脚地面的世界 y（台阶两端 = baseY + k × 级高 / baseY + (k + 1) × 级高）。
        /// </summary>
        public static TerraceFlight FlightOverWall(string name, in SteppedSlopeSpec s, int k, float across, float baseY, float width, float run, float overlap = 0.4f)
        {
            var (dir, _) = SteppedAxes(s);
            var c = SteppedWallPoint(s, k, across);
            var top = c + dir * (s.wallRun * 0.5f + overlap);
            return new TerraceFlight(name, top - dir * run, top, baseY + k * s.stepHeight, baseY + (k + 1) * s.stepHeight, width);
        }

        /// <summary>把台阶叠到高度 h 上（只填不挖，两侧 edge 米淡出）；mask = 台阶遮罩（分层 / 散布避让用）</summary>
        public static float ApplyFlight(Vector2 p, float h, in TerraceFlight f, float edge, out float mask)
        {
            var (t, m) = Ramp(p, f.foot, f.top, f.width, edge);
            mask = m;
            if (m <= 0) return h;
            float target = Mathf.Lerp(f.footY, f.topY, Smooth(0, 1, t) * 0.3f + t * 0.7f);
            return Mathf.Max(h, Mathf.Lerp(h, target, m));
        }

        /// <summary>一段挡土墙：墙线上的两端（世界 XZ）、朝低处的单位法线、低侧 / 高侧地面（世界 y）</summary>
        public struct TerraceWallRun
        {
            public Vector2 a, b, down;
            public float lowY, highY;

            public float Length => Vector2.Distance(a, b);
            public float Drop => highY - lowY;
        }

        /// <summary>直线 a → b 上每 step 米一个点（两端各缩进 inset 米）：给墩台、台基这种直边当墙线</summary>
        public static List<Vector2> TerraceEdge(Vector2 a, Vector2 b, float step = 1f, float inset = 0.5f)
        {
            var o = new List<Vector2>();
            float len = Vector2.Distance(a, b);
            if (len <= inset * 2) return o;
            var d = (b - a) / len;
            int n = Mathf.Max(1, Mathf.CeilToInt((len - inset * 2) / step));
            for (int i = 0; i <= n; i++) o.Add(a + d * (inset + (len - inset * 2) * i / n));
            return o;
        }

        /// <summary>
        /// 沿一条墙线（折线，点距约 1–2 m）找「真的是墙」的段：每个点两侧各 probe 米处的地面（ground）高差 ≥ minDrop、keep(点) 为真才算；
        /// 连续的点并成一段，两端各缩进 inset 米，再按 maxLen 均分。台阶把墙填平的地方高差小于 minDrop，墙段自动断开，台阶两侧不会被栏板挡住。
        /// </summary>
        public static List<TerraceWallRun> TerraceWallRuns(IReadOnlyList<Vector2> line, Func<Vector2, float> ground, Func<Vector2, bool> keep,
            float minDrop = 1.2f, float maxLen = 7.5f, float probe = 1.6f, float inset = 0.3f)
        {
            var runs = new List<TerraceWallRun>();
            var cur = new List<(Vector2 p, Vector2 down, float lo, float hi)>();
            void Flush()
            {
                if (cur.Count >= 2)
                {
                    var arc = new float[cur.Count];
                    for (int i = 1; i < cur.Count; i++) arc[i] = arc[i - 1] + Vector2.Distance(cur[i - 1].p, cur[i].p);
                    float total = arc[^1] - inset * 2;
                    if (total >= 1f)
                    {
                        int n = Mathf.Max(1, Mathf.CeilToInt(total / maxLen));
                        float seg = total / n;
                        Vector2 At(float s)
                        {
                            for (int i = 1; i < cur.Count; i++)
                                if (arc[i] >= s) return Vector2.Lerp(cur[i - 1].p, cur[i].p, Mathf.InverseLerp(arc[i - 1], arc[i], s));
                            return cur[^1].p;
                        }
                        for (int j = 0; j < n; j++)
                        {
                            float s0 = inset + j * seg, s1 = s0 + seg;
                            float lo = float.MaxValue, hi = float.MinValue;
                            var down = Vector2.zero;
                            for (int i = 0; i < cur.Count; i++)
                            {
                                if (arc[i] < s0 - 1f || arc[i] > s1 + 1f) continue;
                                lo = Mathf.Min(lo, cur[i].lo);
                                hi = Mathf.Max(hi, cur[i].hi);
                                down += cur[i].down;
                            }
                            if (lo > hi) continue;
                            runs.Add(new TerraceWallRun { a = At(s0), b = At(s1), down = down.normalized, lowY = lo, highY = hi });
                        }
                    }
                }
                cur.Clear();
            }
            for (int i = 0; i < line.Count; i++)
            {
                var p = line[i];
                var tan = line[Mathf.Min(i + 1, line.Count - 1)] - line[Mathf.Max(i - 1, 0)];
                if (tan.sqrMagnitude < 1e-6f)
                {
                    Flush();
                    continue;
                }
                tan.Normalize();
                var nrm = new Vector2(-tan.y, tan.x);
                float g1 = ground(p + nrm * probe), g2 = ground(p - nrm * probe);
                if (Mathf.Abs(g1 - g2) >= minDrop && (keep == null || keep(p))) cur.Add((p, g1 < g2 ? nrm : -nrm, Mathf.Min(g1, g2), Mathf.Max(g1, g2)));
                else Flush();
            }
            Flush();
            return runs;
        }

        /// <summary>
        /// 摆一段挡土墙（白玉挡土墙段这类「墙身 + 顶上栏板」的件）：正面（+Z）朝低处，X 拉到段长，Y 按「墙身高 = 高差 + sink」缩放
        /// （bodyFraction = 墙身占整件高度的比例，栏板随之等比），Z 乘 depthScale；轴心从墙线往高处挪 shift 米（正面盖住地形的陡坎）。
        /// 缺 Prefab 时放白盒：厚 1.4 m、高 = 高差 + sink + parapet（占位标签，验收会列出来）。
        /// </summary>
        public static GameObject PlaceTerraceWall(string id, Transform parent, in TerraceWallRun r, float bodyFraction, float depthScale, float shift, float sink,
            float parapet, Material boxMat = null)
        {
            var mid = (r.a + r.b) * 0.5f - r.down * shift;
            float len = r.Length, baseY = r.lowY - sink, body = r.highY - baseY;
            float yaw = Mathf.Atan2(r.down.x, r.down.y) * Mathf.Rad2Deg;
            var basePos = new Vector3(mid.x, baseY, mid.y);
            if (ShowcaseSceneBuilder.Prefab(id))
            {
                var b = ShowcaseSceneBuilder.DesignBounds(id);
                var go = ShowcaseSceneBuilder.Place(id, parent, basePos, yaw);
                if (!go) return null;
                go.transform.localScale = new Vector3(len / Mathf.Max(0.1f, b.size.x), body / Mathf.Max(0.1f, b.size.y * bodyFraction), depthScale);
                go.isStatic = true;
                return go;
            }
            return PlaceOrBox(id, parent, basePos, new Vector3(len, body + parapet, 1.4f), yaw, 1, boxMat);
        }
    }
}
