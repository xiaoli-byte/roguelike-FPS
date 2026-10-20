using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一片碎刃（<see cref="BladeShape.Cells"/> 的一项）：刀身局部坐标里的逆时针凸多边形、面积质心、面积与离刀名次。
    /// 多边形是 [x0, y0, x1, y1, …]，只读——共享缓存，不要改。
    /// </summary>
    public sealed class BladeCell
    {
        public int index;
        public double[] poly;
        public double cx, cy, area;
        /// <summary>离刀顺序：0 = 最靠刀尖，<see cref="BladeShape.ShardCount"/> − 1 = 最靠刀根</summary>
        public int rank;

        /// <summary>顶点数</summary>
        public int Count => poly.Length / 2;
    }

    /// <summary>
    /// 碎刃 v2 的刀身几何（docs/demon-blade-v2.md 第 9 节；Three.js src/weapons/demonBlade/BladeShape.ts 的逐行移植）：
    /// 轮廓、刀根分界与 128 片 Voronoi 碎刃。纯数学（double），不依赖场景，EditMode 可测。
    /// 刀身局部坐标：+Y 从刀身起点（护手铜环上沿）指向刀尖；刀背在 −X，刃口在 +X；Z 为厚度方向。单位米。
    /// 刀根（鬼面那段）不碎，分界线按设计图手绘的紫缝走（art/pipeline/demon_blade_textures.py 打印的分界点）。
    /// 碎刃区域切成 <see cref="ShardCount"/> 个各不相同的凸多边形：各向异性 1.55（沿刀身拉长）、刀根附近密、刀尖附近疏，
    /// Lloyd 松弛 7 轮后互不重叠、拼回整刀。结果确定（mulberry32 固定种子，与 TS 同一随机序列），首次访问时计算并缓存。
    /// Three.js 是右手系、Unity 是左手系：坐标原样照搬，网格三角形的顶点顺序也照搬（两边都按「从 +Z 看逆时针为正面」的数值生成，
    /// 在 Unity 里看等于整体镜像一次，正反面一致），朝向由 <see cref="BladeModel"/> 的 Frame 节点决定。
    /// </summary>
    public static class BladeShape
    {
        public const int ShardCount = 128;
        /// <summary>刀身起点（护手上沿）到刀尖，沿刀柄轴线方向</summary>
        public const double BladeLen = 0.7777;
        /// <summary>刀根贴图 v = 1 对应的刀身长度（贴图取自设计图正侧面 x = 581 → 940 px）</summary>
        public const double RootTexLen = 0.198;
        /// <summary>各向异性：Voronoi 在 y / Aniso 的空间里求，碎片沿刀身拉长</summary>
        public const double Aniso = 1.55;
        /// <summary>Lloyd 松弛轮数：少量松弛只去掉过细的碎片，保留碎玻璃般大小不一的不规则多边形（轮数多了会变成蜂窝）</summary>
        public const int LloydIters = 7;
        const int Neighbors = 18;
        const uint Seed = 0x5eed7;

        /// <summary>
        /// 刀身轮廓：从用户确认的设计图正侧面逐段量得（1 px = 0.55 mm，原点在刀柄轴线与护手上沿的交点）。
        /// [y, 刀背 x, 刃口 x]：刀身先略向刃口一侧下垂，再一路向刀背上挑，宽度约 5.1 cm 保持到 70% 处，之后刃口弧线扫向刀尖，与刀背交于一点。
        /// </summary>
        static readonly double[,] Profile =
        {
            { 0, -0.022, 0.0313 }, { 0.066, -0.0165, 0.0363 }, { 0.1209, -0.0115, 0.0396 }, { 0.1759, -0.0077, 0.0434 },
            { 0.2308, -0.0055, 0.0456 }, { 0.2858, -0.0044, 0.0462 }, { 0.3408, -0.0038, 0.0472 }, { 0.3957, -0.0035, 0.0476 },
            { 0.4507, -0.0044, 0.047 }, { 0.5056, -0.0066, 0.0445 }, { 0.5606, -0.0099, 0.041 }, { 0.6155, -0.0143, 0.0341 },
            { 0.6705, -0.022, 0.022 }, { 0.698, -0.0264, 0.0121 }, { 0.7255, -0.0319, 0.0005 }, { 0.7529, -0.0379, -0.0165 },
            { 0.7777, -0.0434, -0.0434 },
        };

        /// <summary>刀根分界（u = 刀背 0 → 刃口 1，v = y / RootTexLen），按设计图正侧面里暗色刀根与碎片的交界描出</summary>
        static readonly double[,] RootBoundary = { { 0, 0.81 }, { 0.25, 0.76 }, { 0.5, 0.7 }, { 0.75, 0.59 }, { 1, 0.455 } };

        static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

        static double Smooth(double a, double b, double v)
        {
            double t = Clamp01((v - a) / (b - a));
            return t * t * (3 - 2 * t);
        }

        static double Hypot(double x, double y) => Math.Sqrt(x * x + y * y);

        /// <summary>轮廓列 col（1 = 刀背，2 = 刃口）在 y 处的值：Catmull-Rom 插值</summary>
        static double ProfileAt(double y, int col)
        {
            var p = Profile;
            int n = p.GetLength(0);
            if (y <= 0) return p[0, col];
            if (y >= BladeLen) return p[n - 1, col];
            int i = 0;
            while (i < n - 2 && p[i + 1, 0] < y) i++;
            int i0 = Math.Max(0, i - 1), i1 = i, i2 = i + 1, i3 = Math.Min(n - 1, i + 2);
            double t = (y - p[i1, 0]) / (p[i2, 0] - p[i1, 0]);
            double t2 = t * t, t3 = t2 * t;
            double p0 = p[i0, col], p1 = p[i1, col], p2 = p[i2, col], p3 = p[i3, col];
            return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
        }

        public static double SpineX(double y) => ProfileAt(y, 1);

        public static double EdgeX(double y) => y >= BladeLen ? SpineX(y) : Math.Max(SpineX(y), ProfileAt(y, 2));

        public static double BladeWidth(double y) => EdgeX(y) - SpineX(y);

        /// <summary>刀身中线</summary>
        public static double BladeCenterX(double y) => (SpineX(y) + EdgeX(y)) / 2;

        /// <summary>横向坐标：刀背 0 → 刃口 1</summary>
        public static double AcrossOf(double x, double y)
        {
            double w = BladeWidth(y);
            return w > 1e-6 ? Clamp01((x - SpineX(y)) / w) : 0.5;
        }

        /// <summary>厚度：刀背厚、刃口薄，刀尖整体变薄</summary>
        public static double ThicknessAt(double x, double y)
        {
            double a = AcrossOf(x, y);
            double tip = 1 - 0.45 * Smooth(0.8, 1, y / BladeLen);
            return (0.0064 * Math.Pow(1 - a, 0.8) + 0.001) * tip;
        }

        /// <summary>刀根分界在横向 u 处的长度坐标 y</summary>
        public static double RootBoundaryY(double u)
        {
            var b = RootBoundary;
            int n = b.GetLength(0);
            u = Clamp01(u);
            for (int i = 1; i < n; i++)
            {
                if (u <= b[i, 0])
                {
                    double t = (u - b[i - 1, 0]) / (b[i, 0] - b[i - 1, 0]);
                    return (b[i - 1, 1] + (b[i, 1] - b[i - 1, 1]) * t) * RootTexLen;
                }
            }
            return b[n - 1, 1] * RootTexLen;
        }

        static void BoundaryPoint(double u, List<double> output)
        {
            double y = RootBoundaryY(u);
            output.Add(SpineX(y) + u * BladeWidth(y));
            output.Add(y);
        }

        /// <summary>刀根（不碎的鬼面段）轮廓，逆时针</summary>
        public static double[] RootPolygon()
        {
            var p = new List<double>();
            double ySpine = RootBoundaryY(0), yEdge = RootBoundaryY(1);
            // 先沿刃口向上，再沿分界从刃口到刀背，再沿刀背向下
            for (int i = 0; i <= 6; i++)
            {
                double y = yEdge * i / 6;
                p.Add(EdgeX(y));
                p.Add(y);
            }
            for (int i = 1; i < 20; i++) BoundaryPoint(1 - i / 20.0, p);
            for (int i = 0; i <= 8; i++)
            {
                double y = ySpine * (1 - i / 8.0);
                p.Add(SpineX(y));
                p.Add(y);
            }
            return EnsureCcw(p.ToArray());
        }

        /// <summary>碎刃区域轮廓（分界线到刀尖），逆时针</summary>
        public static double[] ShardRegion()
        {
            var p = new List<double>();
            double ySpine = RootBoundaryY(0), yEdge = RootBoundaryY(1);
            // 分界：刀背 → 刃口
            for (int i = 0; i < 20; i++) BoundaryPoint(i / 20.0, p);
            // 刃口：分界 → 刀尖（刀尖附近加密，切先弧线）
            const int nE = 72;
            for (int i = 0; i < nE; i++)
            {
                double t = (double)i / nE;
                double y = yEdge + (BladeLen - yEdge) * (1 - Math.Pow(1 - t, 1.6));
                p.Add(EdgeX(y));
                p.Add(y);
            }
            p.Add(SpineX(BladeLen));
            p.Add(BladeLen);
            // 刀背：刀尖 → 分界
            const int nS = 48;
            for (int i = 1; i < nS; i++)
            {
                double y = BladeLen - (BladeLen - ySpine) * ((double)i / nS);
                p.Add(SpineX(y));
                p.Add(y);
            }
            return EnsureCcw(p.ToArray());
        }

        /// <summary>整把刀身（刀根 + 碎刃区）外轮廓，逆时针</summary>
        public static double[] BladeOutline()
        {
            var p = new List<double>();
            const int n = 90;
            for (int i = 0; i <= n; i++)
            {
                double t = (double)i / n;
                double y = BladeLen * (1 - Math.Pow(1 - t, 1.5));
                p.Add(EdgeX(y));
                p.Add(y);
            }
            for (int i = 1; i < 60; i++)
            {
                double y = BladeLen * (1 - i / 60.0);
                p.Add(SpineX(y));
                p.Add(y);
            }
            p.Add(SpineX(0));
            p.Add(0);
            return EnsureCcw(p.ToArray());
        }

        // ───────────── 多边形工具 ─────────────

        public static double PolyArea(IReadOnlyList<double> p)
        {
            double a = 0;
            int n = p.Count / 2;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
            }
            return a / 2;
        }

        static double[] EnsureCcw(double[] p)
        {
            if (PolyArea(p) >= 0) return p;
            int n = p.Length / 2;
            var r = new double[p.Length];
            for (int i = 0; i < n; i++)
            {
                r[2 * i] = p[2 * (n - 1 - i)];
                r[2 * i + 1] = p[2 * (n - 1 - i) + 1];
            }
            return r;
        }

        public static bool PointInPoly(IReadOnlyList<double> p, double x, double y)
        {
            bool inside = false;
            int n = p.Count / 2;
            for (int i = 0, j = n - 1; i < n; j = i++)
            {
                double xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
                if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
            }
            return inside;
        }

        /// <summary>面积质心（退化时取第一个顶点）</summary>
        public static void PolyCentroid(IReadOnlyList<double> p, out double cx, out double cy)
        {
            double a = 0, sx = 0, sy = 0;
            int n = p.Count / 2;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                double c = p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
                a += c;
                sx += (p[2 * i] + p[2 * j]) * c;
                sy += (p[2 * i + 1] + p[2 * j + 1]) * c;
            }
            if (Math.Abs(a) < 1e-14)
            {
                cx = p[0];
                cy = p[1];
                return;
            }
            cx = sx / (3 * a);
            cy = sy / (3 * a);
        }

        /// <summary>用直线 a·x + b·y ≤ c 裁剪多边形（Sutherland–Hodgman 单边）</summary>
        static List<double> ClipHalf(List<double> p, double a, double b, double c)
        {
            var output = new List<double>(p.Count + 4);
            int n = p.Count / 2;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                double x1 = p[2 * i], y1 = p[2 * i + 1], x2 = p[2 * j], y2 = p[2 * j + 1];
                double d1 = a * x1 + b * y1 - c, d2 = a * x2 + b * y2 - c;
                if (d1 <= 0)
                {
                    output.Add(x1);
                    output.Add(y1);
                }
                if ((d1 <= 0) != (d2 <= 0))
                {
                    double t = d1 / (d1 - d2);
                    output.Add(x1 + (x2 - x1) * t);
                    output.Add(y1 + (y2 - y1) * t);
                }
            }
            return output;
        }

        /// <summary>用凸多边形 clip（逆时针）裁剪任意简单多边形 subject</summary>
        static List<double> ClipByConvex(List<double> subject, List<double> clip)
        {
            var output = subject;
            int n = clip.Count / 2;
            for (int i = 0; i < n && output.Count >= 6; i++)
            {
                int j = (i + 1) % n;
                double x1 = clip[2 * i], y1 = clip[2 * i + 1], x2 = clip[2 * j], y2 = clip[2 * j + 1];
                // 逆时针多边形的内侧在边的左边：外法线 (dy, −dx)
                double a = y2 - y1, b = -(x2 - x1);
                output = ClipHalf(output, a, b, a * x1 + b * y1);
            }
            return output;
        }

        /// <summary>去掉过近或几乎共线的顶点（每次只删一个、删完重新判断，不会把转角两侧的点一起删掉）</summary>
        static List<double> Simplify(List<double> p, double minLen, double cosTol)
        {
            var cur = new List<double>(p);
            for (int guard = 0; guard < 256; guard++)
            {
                int n = cur.Count / 2;
                if (n <= 3) return cur;
                int drop = -1;
                for (int i = 0; i < n && drop < 0; i++)
                {
                    int pi = (i + n - 1) % n, ni = (i + 1) % n;
                    double ax = cur[2 * i] - cur[2 * pi], ay = cur[2 * i + 1] - cur[2 * pi + 1];
                    double bx = cur[2 * ni] - cur[2 * i], by = cur[2 * ni + 1] - cur[2 * i + 1];
                    double la = Hypot(ax, ay), lb = Hypot(bx, by);
                    if (la < minLen || (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) > cosTol)) drop = i;
                }
                if (drop < 0) return cur;
                cur.RemoveRange(2 * drop, 2);
            }
            return cur;
        }

        /// <summary>mulberry32（与 TS 同一序列：Math.imul 即 uint 乘法取低 32 位）</summary>
        sealed class Mulberry32
        {
            uint a;

            public Mulberry32(uint seed) => a = seed;

            public double Next()
            {
                unchecked
                {
                    a += 0x6d2b79f5;
                    uint t = a;
                    t = (t ^ (t >> 15)) * (t | 1);
                    t ^= t + (t ^ (t >> 7)) * (t | 61);
                    return (t ^ (t >> 14)) / 4294967296.0;
                }
            }
        }

        /// <summary>碎片密度：刀根附近密、刀尖附近疏，刃口一侧略疏（参考动画截图）</summary>
        static double Density(double x, double y)
        {
            double y0 = RootBoundary[RootBoundary.GetLength(0) - 1, 1] * RootTexLen;
            double t = Clamp01((y - y0) / (BladeLen - y0));
            return (1.55 - 0.85 * Math.Pow(t, 0.8)) * (1.12 - 0.24 * AcrossOf(x, y));
        }

        static BladeCell[] cached;
        static readonly object gate = new();

        /// <summary>128 片碎刃（确定、缓存；返回的数组与多边形不要修改）</summary>
        public static IReadOnlyList<BladeCell> Cells
        {
            get
            {
                if (cached != null) return cached;
                lock (gate) return cached ??= Compute();
            }
        }

        /// <summary>离刀名次 → 片号</summary>
        public static int[] ByRank()
        {
            var cells = Cells;
            var r = new int[ShardCount];
            for (int i = 0; i < ShardCount; i++) r[cells[i].rank] = i;
            return r;
        }

        /// <summary>重新计算一遍（测试「确定性」用；不动缓存）</summary>
        public static BladeCell[] ComputeFresh() => Compute();

        static BladeCell[] Compute()
        {
            var region = ShardRegion();
            // 各向异性空间
            var sRegion = new List<double>(region.Length);
            for (int i = 0; i < region.Length; i++) sRegion.Add(i % 2 == 1 ? region[i] / Aniso : region[i]);
            double minX = double.PositiveInfinity, maxX = double.NegativeInfinity, minY = double.PositiveInfinity, maxY = double.NegativeInfinity;
            for (int i = 0; i < sRegion.Count; i += 2)
            {
                minX = Math.Min(minX, sRegion[i]);
                maxX = Math.Max(maxX, sRegion[i]);
                minY = Math.Min(minY, sRegion[i + 1]);
                maxY = Math.Max(maxY, sRegion[i + 1]);
            }
            var box = new List<double>
            {
                minX - 0.01, minY - 0.01, maxX + 0.01, minY - 0.01, maxX + 0.01, maxY + 0.01, minX - 0.01, maxY + 0.01,
            };
            var rand = new Mulberry32(Seed);
            double Dens(double sx, double sy) => Density(sx, sy * Aniso);

            // 播种：按密度拒绝采样 + 最小间距
            double area = PolyArea(sRegion);
            var sites = new List<double>(ShardCount * 2);
            double baseR = Math.Sqrt(area / ShardCount) * 0.55;
            for (int tries = 0; sites.Count < ShardCount * 2 && tries < 200000; tries++)
            {
                double x = minX + rand.Next() * (maxX - minX), y = minY + rand.Next() * (maxY - minY);
                if (!PointInPoly(sRegion, x, y)) continue;
                double d = Dens(x, y);
                if (rand.Next() * 1.7 > d) continue;
                double r = baseR / Math.Sqrt(d);
                bool ok = true;
                for (int k = 0; k < sites.Count; k += 2)
                    if (Hypot(sites[k] - x, sites[k + 1] - y) < r)
                    {
                        ok = false;
                        break;
                    }
                if (!ok) continue;
                sites.Add(x);
                sites.Add(y);
            }
            // 间距太严时补足（极少发生）
            while (sites.Count < ShardCount * 2)
            {
                double x = minX + rand.Next() * (maxX - minX), y = minY + rand.Next() * (maxY - minY);
                if (!PointInPoly(sRegion, x, y)) continue;
                sites.Add(x);
                sites.Add(y);
            }

            // 每个站点最近的 Neighbors 个邻居（插入排序选出）
            var near = new int[Neighbors];
            var nearD = new double[Neighbors];
            List<List<double>> CellsOf()
            {
                var output = new List<List<double>>(ShardCount);
                for (int i = 0; i < ShardCount; i++)
                {
                    double sx = sites[2 * i], sy = sites[2 * i + 1];
                    int count = 0;
                    for (int j = 0; j < ShardCount; j++)
                    {
                        if (j == i) continue;
                        double dx = sites[2 * j] - sx, dy = sites[2 * j + 1] - sy;
                        double d = dx * dx + dy * dy;
                        if (count == Neighbors && d >= nearD[Neighbors - 1]) continue;
                        int k = count < Neighbors ? count++ : Neighbors - 1;
                        while (k > 0 && nearD[k - 1] > d)
                        {
                            nearD[k] = nearD[k - 1];
                            near[k] = near[k - 1];
                            k--;
                        }
                        nearD[k] = d;
                        near[k] = j;
                    }
                    var cell = box;
                    for (int k = 0; k < count; k++)
                    {
                        int j = near[k];
                        double ox = sites[2 * j], oy = sites[2 * j + 1];
                        double a = ox - sx, b = oy - sy;
                        double mx = (sx + ox) / 2, my = (sy + oy) / 2;
                        cell = ClipHalf(cell, a, b, a * mx + b * my);
                    }
                    // 完全在区域内的单元不必再裁（大多数）；贴边的用区域裁剪
                    bool inside = true;
                    for (int k = 0; k < cell.Count; k += 2)
                        if (!PointInPoly(sRegion, cell[k], cell[k + 1]))
                        {
                            inside = false;
                            break;
                        }
                    output.Add(inside ? cell : ClipByConvex(sRegion, cell));
                }
                return output;
            }

            for (int it = 0; it < LloydIters; it++)
            {
                var cells = CellsOf();
                for (int i = 0; i < ShardCount; i++)
                {
                    var c = cells[i];
                    if (c.Count < 6) continue;
                    // 按密度加权的质心（以多边形质心为扇心三角化）
                    PolyCentroid(c, out double gx, out double gy);
                    double w = 0, wx = 0, wy = 0;
                    int n = c.Count / 2;
                    for (int k = 0; k < n; k++)
                    {
                        int l = (k + 1) % n;
                        double ax = c[2 * k], ay = c[2 * k + 1], bx = c[2 * l], by = c[2 * l + 1];
                        double ta = Math.Abs((ax - gx) * (by - gy) - (bx - gx) * (ay - gy)) / 2;
                        double tx = (gx + ax + bx) / 3, ty = (gy + ay + by) / 3;
                        double tw = ta * Dens(tx, ty);
                        w += tw;
                        wx += tx * tw;
                        wy += ty * tw;
                    }
                    if (w > 0 && PointInPoly(sRegion, wx / w, wy / w))
                    {
                        sites[2 * i] = wx / w;
                        sites[2 * i + 1] = wy / w;
                    }
                }
            }

            var final = CellsOf();
            double cosTol = Math.Cos(0.8 * Math.PI / 180);
            var result = new BladeCell[ShardCount];
            for (int index = 0; index < ShardCount; index++)
            {
                var c = final[index];
                var back = new List<double>(c.Count);
                for (int i = 0; i < c.Count; i++) back.Add(i % 2 == 1 ? c[i] * Aniso : c[i]);
                // 只去掉重合点与几乎共线的点：删掉短边的端点会切掉一角，在相邻碎片之间留下三角形空洞
                var poly = EnsureCcw(Simplify(back, 0.00015, cosTol).ToArray());
                PolyCentroid(poly, out double cx, out double cy);
                result[index] = new BladeCell { index = index, poly = poly, cx = cx, cy = cy, area = PolyArea(poly) };
            }
            // 离刀顺序：刀尖在前（按质心长度坐标，同高时刃口在前）；同键按片号，结果与排序算法无关
            var order = new int[ShardCount];
            var key = new double[ShardCount];
            for (int i = 0; i < ShardCount; i++)
            {
                order[i] = i;
                key[i] = result[i].cy + 0.15 * AcrossOf(result[i].cx, result[i].cy) * 0.02;
            }
            Array.Sort(order, (a, b) =>
            {
                int c = key[b].CompareTo(key[a]);
                return c != 0 ? c : a.CompareTo(b);
            });
            for (int k = 0; k < ShardCount; k++) result[order[k]].rank = k;
            return result;
        }
    }
}
