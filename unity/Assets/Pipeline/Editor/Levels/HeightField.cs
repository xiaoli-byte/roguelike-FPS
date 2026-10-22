using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 地形高度场（米，世界坐标 x 东、z 北），按「地貌函数」叠加生成，再写进 Unity TerrainData。
    /// 地貌函数都是世界坐标的纯函数：同一份关卡规格总能生成同一张地形，改参数重新生成即可；美术之后在 Terrain 上直接雕刻。
    /// 网格可以是长方形（多块地形拼起来时 resX ≠ resZ）；单块地形时 resX = resZ = res。
    /// </summary>
    public sealed class HeightField
    {
        /// <summary>X 向采样数（方格时也是 Z 向，沿用单块地形的老字段名）</summary>
        public readonly int res;
        public readonly int resX, resZ;
        public readonly Vector2 size;
        public readonly float[,] h; // [z, x]

        public HeightField(Vector2 size, int res) : this(size, res, res) { }

        public HeightField(Vector2 size, int resX, int resZ)
        {
            this.size = size;
            this.resX = resX;
            this.resZ = resZ;
            res = resX;
            h = new float[resZ, resX];
        }

        /// <summary>格距（米）</summary>
        public Vector2 Cell => new(size.x / (resX - 1), size.y / (resZ - 1));

        public Vector2 Pos(int x, int z) => new(x / (float)(resX - 1) * size.x, z / (float)(resZ - 1) * size.y);

        /// <summary>局部坐标（米，相对高度场左下角）→ 最近的格点下标</summary>
        public Vector2Int Index(Vector2 p) => new(
            Mathf.Clamp(Mathf.RoundToInt(p.x / size.x * (resX - 1)), 0, resX - 1),
            Mathf.Clamp(Mathf.RoundToInt(p.y / size.y * (resZ - 1)), 0, resZ - 1));

        public void Each(Func<Vector2, float, float> f)
        {
            for (int z = 0; z < resZ; z++)
            for (int x = 0; x < resX; x++)
                h[z, x] = f(Pos(x, z), h[z, x]);
        }

        public float Sample(Vector2 p)
        {
            float fx = Mathf.Clamp(p.x / size.x * (resX - 1), 0, resX - 1.001f), fz = Mathf.Clamp(p.y / size.y * (resZ - 1), 0, resZ - 1.001f);
            int x0 = (int)fx, z0 = (int)fz;
            float tx = fx - x0, tz = fz - z0;
            return Mathf.Lerp(Mathf.Lerp(h[z0, x0], h[z0, x0 + 1], tx), Mathf.Lerp(h[z0 + 1, x0], h[z0 + 1, x0 + 1], tx), tz);
        }

        /// <summary>局部盒式平滑（只在 mask(p) &gt; 0 处，按 mask 混合），用于压平路面、软化生成接缝</summary>
        public void Smooth(int radius, Func<Vector2, float> mask, int passes = 1)
        {
            for (int pass = 0; pass < passes; pass++)
            {
                var src = (float[,])h.Clone();
                for (int z = 0; z < resZ; z++)
                for (int x = 0; x < resX; x++)
                {
                    float m = mask(Pos(x, z));
                    if (m <= 0) continue;
                    float sum = 0;
                    int n = 0;
                    for (int dz = -radius; dz <= radius; dz++)
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        int xx = Mathf.Clamp(x + dx, 0, resX - 1), zz = Mathf.Clamp(z + dz, 0, resZ - 1);
                        sum += src[zz, xx];
                        n++;
                    }
                    h[z, x] = Mathf.Lerp(src[z, x], sum / n, m);
                }
            }
        }

        /// <summary>
        /// 坡度（度），中心差分。两个方向都按 X 向格距算——1-1 一直用这个口径（它的格子不是正方形），保持不变才能原样重建；
        /// 新地图用正方形格子（地块边长相等），这里就是精确值。
        /// </summary>
        public float Slope(int x, int z)
        {
            float cell = size.x / (resX - 1);
            float dx = h[z, Mathf.Min(x + 1, resX - 1)] - h[z, Mathf.Max(x - 1, 0)];
            float dz = h[Mathf.Min(z + 1, resZ - 1), x] - h[Mathf.Max(z - 1, 0), x];
            return Mathf.Atan(Mathf.Sqrt(dx * dx + dz * dz) / (2 * cell)) * Mathf.Rad2Deg;
        }

        /// <summary>
        /// 凹度（米）：上下左右 k 格处的平均高度减去本点高度。正 = 凹（谷底、坡脚，积雪 / 积灰 / 积沙），负 = 凸（脊、台沿，风刮露岩）。
        /// </summary>
        public float Concavity(int x, int z, int k)
        {
            float s = h[z, Mathf.Min(x + k, resX - 1)] + h[z, Mathf.Max(x - k, 0)] + h[Mathf.Min(z + k, resZ - 1), x] + h[Mathf.Max(z - k, 0), x];
            return s * 0.25f - h[z, x];
        }

        public (float min, float max) Range()
        {
            float lo = float.MaxValue, hi = float.MinValue;
            foreach (float v in h)
            {
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            return (lo, hi);
        }
    }

    /// <summary>地貌函数库：返回某点的高度贡献或遮罩（0–1）</summary>
    public static class Landform
    {
        public static float Smooth(float e0, float e1, float x)
        {
            float k = Mathf.Clamp01((x - e0) / (e1 - e0));
            return k * k * (3 - 2 * k);
        }

        public static float Fbm(Vector2 p, float scale, int octaves = 4, float seed = 0)
        {
            float sum = 0, amp = 0.5f, norm = 0, f = 1 / scale;
            for (int o = 0; o < octaves; o++)
            {
                sum += (Mathf.PerlinNoise(p.x * f + seed * 13.1f + o * 31.7f, p.y * f + seed * 7.3f + o * 17.9f) - 0.5f) * 2 * amp;
                norm += amp;
                amp *= 0.5f;
                f *= 2.03f;
            }
            return sum / norm;
        }

        /// <summary>
        /// 横向沙丘（迎风坡缓、背风坡陡）：沿风向的锯齿剖面 + 垂直方向的噪声让沙脊断成一段段新月形。
        /// wind = 风吹去的方向；wavelength 丘距；windward = 迎风坡占一个波长的比例。返回 0–amp。
        /// 背风坡要停在沙的休止角（约 32°）附近：amp / ((1 - windward) × wavelength) ≲ 0.62。
        /// </summary>
        public static float Dunes(Vector2 p, Vector2 wind, float wavelength, float amp, float seed, float windward = 0.78f)
        {
            wind.Normalize();
            var side = new Vector2(-wind.y, wind.x);
            float along = Vector2.Dot(p, wind), across = Vector2.Dot(p, side);
            // 沙脊不是直线：用低频噪声扭曲相位
            float warp = Fbm(new Vector2(across, along * 0.3f), wavelength * 2.5f, 3, seed) * wavelength * 0.6f;
            float phase = Mathf.Repeat((along + warp) / wavelength, 1f);
            float prof = phase < windward ? Smooth(0, 1, phase / windward) : Smooth(0, 1, (1 - phase) / (1 - windward));
            // 沙脊高度沿脊线起伏、断续 → 新月形丘
            float crest = 0.45f + 0.55f * Smooth(-0.2f, 0.6f, Fbm(new Vector2(across, along), wavelength * 1.3f, 3, seed + 3));
            return prof * crest * amp;
        }

        /// <summary>
        /// 雅丹 / 台地：沿 angle（度，0 = 沿 +X）拉长的超椭圆足迹，顶面平、侧壁陡（edge 米宽的过渡），边缘被风蚀成不规则。
        /// 返回 0–height。
        /// </summary>
        public static float Mesa(Vector2 p, Vector2 center, float halfLen, float halfWid, float angle, float height, float edge, float seed)
        {
            float a = angle * Mathf.Deg2Rad;
            var d = p - center;
            float lx = d.x * Mathf.Cos(a) + d.y * Mathf.Sin(a), lz = -d.x * Mathf.Sin(a) + d.y * Mathf.Cos(a);
            float wobble = 1 + Fbm(p, 9f, 3, seed) * 0.22f;
            float r = Mathf.Pow(Mathf.Pow(Mathf.Abs(lx) / (halfLen * wobble), 4) + Mathf.Pow(Mathf.Abs(lz) / (halfWid * wobble), 4), 0.25f);
            float edgeR = edge / Mathf.Min(halfLen, halfWid);
            // 剖面：顶边锐利（风蚀崖的硬边）、坡脚拖出碎屑裙——不是 S 形的圆包
            float body = 1 - Mathf.Pow(Smooth(1 - edgeR, 1, r), 0.55f);
            // 顶面略带起伏，侧壁有风蚀凹槽（沿长轴方向的条纹）
            float top = 1 + Fbm(p, 6f, 2, seed + 5) * 0.06f;
            float flute = 1 - 0.08f * Mathf.Abs(Mathf.Sin(lz * 1.7f + Fbm(p, 4f, 2, seed) * 2)) * Smooth(0.6f, 1, r);
            return body * height * top * flute;
        }

        /// <summary>点到折线的距离与沿线参数（0–1）</summary>
        public static (float dist, float t) Polyline(Vector2 p, IReadOnlyList<Vector2> pts)
        {
            float best = float.MaxValue, bestT = 0, acc = 0, total = 0;
            for (int i = 0; i + 1 < pts.Count; i++) total += Vector2.Distance(pts[i], pts[i + 1]);
            for (int i = 0; i + 1 < pts.Count; i++)
            {
                var a = pts[i];
                var b = pts[i + 1];
                var ab = b - a;
                float len = ab.magnitude;
                float t = len > 1e-4f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / (len * len)) : 0;
                float d = Vector2.Distance(p, a + ab * t);
                if (d < best) { best = d; bestT = (acc + t * len) / Mathf.Max(1e-4f, total); }
                acc += len;
            }
            return (best, bestT);
        }

        /// <summary>Catmull-Rom 平滑折线（每段 subdiv 个点），让古道 / 河床是曲线而不是折角</summary>
        public static List<Vector2> Spline(IReadOnlyList<Vector2> ctrl, int subdiv = 8)
        {
            var o = new List<Vector2>();
            for (int i = 0; i + 1 < ctrl.Count; i++)
            {
                var p0 = ctrl[Mathf.Max(0, i - 1)];
                var p1 = ctrl[i];
                var p2 = ctrl[i + 1];
                var p3 = ctrl[Mathf.Min(ctrl.Count - 1, i + 2)];
                for (int s = 0; s < subdiv; s++)
                {
                    float t = s / (float)subdiv, t2 = t * t, t3 = t2 * t;
                    o.Add(0.5f * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
                }
            }
            o.Add(ctrl[^1]);
            return o;
        }

        /// <summary>沟槽（干河床）：宽 width 的平底，depth 深，bank 米宽的陡坎；返回负值（下挖）</summary>
        public static float Channel(Vector2 p, IReadOnlyList<Vector2> path, float width, float depth, float bank)
        {
            var (d, _) = Polyline(p, path);
            return -depth * (1 - Smooth(width * 0.5f, width * 0.5f + bank, d));
        }

        /// <summary>
        /// 台地（如烽燧台）：旋转矩形顶面 height 高，侧壁 edge 宽；ramps：坡道（从地面端点到台顶端点，宽 w），
        /// 返回该点应有的高度（取台地与坡道的较大值，坡道两侧也有短坡）。
        /// </summary>
        public static float Plateau(Vector2 p, Vector2 center, Vector2 half, float angle, float height, float edge,
            (Vector2 foot, Vector2 top, float width)[] ramps)
        {
            float a = angle * Mathf.Deg2Rad;
            var d = p - center;
            float lx = d.x * Mathf.Cos(a) + d.y * Mathf.Sin(a), lz = -d.x * Mathf.Sin(a) + d.y * Mathf.Cos(a);
            float ox = Mathf.Max(0, Mathf.Abs(lx) - half.x), oz = Mathf.Max(0, Mathf.Abs(lz) - half.y);
            float outside = Mathf.Sqrt(ox * ox + oz * oz);
            float v = height * (1 - Smooth(0, edge, outside));
            foreach (var (foot, top, w) in ramps)
            {
                var ab = top - foot;
                float len = ab.magnitude;
                float t = Mathf.Clamp01(Vector2.Dot(p - foot, ab) / (len * len));
                float dist = Vector2.Distance(p, foot + ab * t);
                float rampH = height * t * (1 - Smooth(w * 0.5f, w * 0.5f + edge * 0.6f, dist));
                v = Mathf.Max(v, rampH);
            }
            return v;
        }

        /// <summary>
        /// 直坡道（沙坡、土坡）：返回 (沿坡参数 t 0–1, 横向遮罩 0–1)。目标高度由调用方按 t 在两端高度间插值，
        /// 用 max(当前, lerp(当前, 目标, 遮罩)) 叠上去——坡道只填高、不挖低。
        /// </summary>
        public static (float t, float mask) Ramp(Vector2 p, Vector2 foot, Vector2 top, float width, float edge)
        {
            var ab = top - foot;
            float len = ab.magnitude;
            float t = Vector2.Dot(p - foot, ab) / (len * len);
            float tc = Mathf.Clamp01(t);
            float dist = Vector2.Distance(p, foot + ab * tc);
            // 坡顶再往前延伸一点（压进台面），坡脚之外淡出
            float along = 1 - Smooth(1f, 1f + edge / len, t);
            float before = Smooth(-edge / len, 0, t);
            return (tc, (1 - Smooth(width * 0.5f, width * 0.5f + edge, dist)) * along * before);
        }

        /// <summary>圆形 / 椭圆盆地（下沉 depth，rim 米宽的缓坡）；返回负值</summary>
        public static float Basin(Vector2 p, Vector2 center, Vector2 radius, float depth, float rim)
        {
            var d = p - center;
            float r = Mathf.Sqrt(d.x * d.x / (radius.x * radius.x) + d.y * d.y / (radius.y * radius.y));
            float edgeR = rim / Mathf.Min(radius.x, radius.y);
            return -depth * (1 - Smooth(1 - edgeR, 1, r));
        }

        /// <summary>圆盘遮罩：中心 1，半径外 0（feather 米宽过渡）</summary>
        public static float Disc(Vector2 p, Vector2 c, float r, float feather) => 1 - Smooth(r, r + feather, Vector2.Distance(p, c));

        // ═════════════ 通用工具 ═════════════

        /// <summary>整数格子的确定性哈希 → 0–1（雅丹、散布这类「每格一个随机值」，与遍历顺序、线程无关）</summary>
        public static float Hash(int x, int y, int seed)
        {
            unchecked
            {
                uint h = (uint)(x * 374761393 + y * 668265263 + seed * 1442695041);
                h = (h ^ (h >> 13)) * 1274126177u;
                return ((h ^ (h >> 16)) & 0xffffff) / 16777215f;
            }
        }

        /// <summary>山脊噪声 0–1：噪声翻折后平方，尖脊、宽谷（远山轮廓、熔岩绳纹）</summary>
        public static float Ridged(Vector2 p, float scale, int octaves = 4, float seed = 0)
        {
            float sum = 0, amp = 0.5f, norm = 0, f = 1 / scale;
            for (int o = 0; o < octaves; o++)
            {
                float n = 1 - Mathf.Abs(Mathf.PerlinNoise(p.x * f + seed * 11.3f + o * 23.1f, p.y * f + seed * 5.7f + o * 41.3f) * 2 - 1);
                sum += n * n * amp;
                norm += amp;
                amp *= 0.5f;
                f *= 2.03f;
            }
            return sum / norm;
        }

        /// <summary>绕一圈无缝的一维噪声（约 −1…1）：在圆上取二维噪声，freq ≈ 一圈里的起伏个数（远景环的山脊线）</summary>
        public static float Loop(float angle, float freq, int octaves, float seed) =>
            Fbm(new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * (freq / (2 * Mathf.PI)), 1, octaves, seed);

        /// <summary>同 <see cref="Loop"/>，山脊型（0–1）</summary>
        public static float LoopRidged(float angle, float freq, int octaves, float seed) =>
            Ridged(new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * (freq / (2 * Mathf.PI)), 1, octaves, seed);

        /// <summary>
        /// 阶地化：连续高度 v（米）→ 每 step 米一级的台面，riser = 陡坎在一级里占的比例（0–1，越小越陡）。
        /// 台面绝对平；Terrace(v + step) = Terrace(v) + step，所以可以叠螺旋相位（<see cref="SpiralCrater"/>）。
        /// </summary>
        public static float Terrace(float v, float step, float riser)
        {
            float q = v / step, k = Mathf.Floor(q);
            return (k + Smooth(1 - riser, 1, q - k)) * step;
        }

        /// <summary>点到折线的最近点：返回距离，另给沿线参数 t（0–1，按弧长）、最近点与该处切向</summary>
        public static float PolylineClosest(Vector2 p, IReadOnlyList<Vector2> pts, out float t, out Vector2 closest, out Vector2 tangent)
        {
            float best = float.MaxValue, acc = 0, total = 0, bestAcc = 0;
            closest = pts[0];
            tangent = pts.Count > 1 ? (pts[1] - pts[0]).normalized : Vector2.right;
            for (int i = 0; i + 1 < pts.Count; i++) total += Vector2.Distance(pts[i], pts[i + 1]);
            for (int i = 0; i + 1 < pts.Count; i++)
            {
                var a = pts[i];
                var ab = pts[i + 1] - a;
                float len = ab.magnitude;
                float s = len > 1e-4f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / (len * len)) : 0;
                var q = a + ab * s;
                float d = Vector2.Distance(p, q);
                if (d < best)
                {
                    best = d;
                    closest = q;
                    bestAcc = acc + s * len;
                    if (len > 1e-4f) tangent = ab / len;
                }
                acc += len;
            }
            t = bestAcc / Mathf.Max(1e-4f, total);
            return best;
        }

        // ═════════════ 雅丹场（1-2 雅丹迷城）═════════════

        /// <summary>雅丹场参数：沿风向拉长、顶平侧陡的岩脊成排成列，脊间是干河道</summary>
        public struct YardangSpec
        {
            /// <summary>风吹去的方向（岩脊长轴）</summary>
            public Vector2 wind;
            /// <summary>横向脊距（米，脊中心到脊中心）≈ 走廊宽 + 脊宽</summary>
            public float spacing;
            /// <summary>平均全长 / 全宽 / 高（米）；每条脊各自上下浮动约 30%</summary>
            public float length, width, height;
            /// <summary>侧壁过渡宽（米）：height / edge 决定侧壁坡度，12 m 高配 3 m ≈ 75°</summary>
            public float edge;
            /// <summary>0–1：每格出一条脊的概率（高 = 脊首尾相接成长岩墙，只留窄缺口）</summary>
            public float density;
            /// <summary>走廊的横向摆动（米）：干河道不是直的</summary>
            public float meander;
            public int seed;
        }

        /// <summary>
        /// 雅丹场：按风向对齐的格子里各放一条岩脊——迎风端钝圆、最高，背风端收尖、尾部稍矮（鲸背）；相邻列纵向错开，不成棋盘。
        /// 脊与脊重叠处取较高者；密度高时连成长岩墙，墙间留出 2–3 条平行的干河道与横向缺口（1-2 的开放化改写）。
        /// 返回 0–height；body = 岩体遮罩（0–1，侧壁到顶），top = 平顶遮罩。分层：侧壁岩、顶面砾石 / 夯土、走廊沙。
        /// </summary>
        public static float Yardangs(Vector2 p, in YardangSpec y, out float body, out float top)
        {
            var w = y.wind.normalized;
            var side = new Vector2(-w.y, w.x);
            float along = Vector2.Dot(p, w), across = Vector2.Dot(p, side);
            across += Fbm(new Vector2(along, y.seed * 7.7f), y.length * 1.6f, 2, y.seed + 2) * y.meander;
            float cellL = y.length * 1.45f, cellW = y.spacing;
            // 只与位置有关的扰动先算好（各候选格子共用）：足迹边缘的风蚀缺口、顶面起伏、侧壁凹槽相位
            float wobble = Fbm(p, 9f, 3, y.seed + 3) * 0.25f;
            // 顶面只留很轻的起伏（±0.6%，14 m 尺度）：12–25 m 高的岩墙上，3% 的噪声已经把台面揉成 5–10° 的缓坡
            float topN = 1 + Fbm(p, 14f, 2, y.seed + 5) * 0.012f;
            float fluteN = Fbm(p, 4f, 2, y.seed + 6) * 2;
            int cj = Mathf.FloorToInt(across / cellW);
            float best = 0, bestBody = 0;
            for (int dj = -1; dj <= 1; dj++)
            {
                int j = cj + dj;
                float a = along - Hash(j, 7, y.seed) * cellL; // 每列纵向错开
                int ci = Mathf.FloorToInt(a / cellL);
                for (int di = -1; di <= 1; di++)
                {
                    int i = ci + di;
                    if (Hash(i, j, y.seed) > y.density) continue;
                    float len = 0.5f * y.length * (0.65f + 0.7f * Hash(i, j, y.seed + 1));
                    float wid = 0.5f * y.width * (0.7f + 0.6f * Hash(i, j, y.seed + 2));
                    float hgt = y.height * (0.6f + 0.6f * Hash(i, j, y.seed + 3));
                    // 中心在格内抖动，但整条脊不出本格（候选只查相邻格）
                    float cx = (i + 0.5f) * cellL + (Hash(i, j, y.seed + 4) - 0.5f) * Mathf.Max(0, cellL - 2 * len) * 0.8f;
                    float cz = (j + 0.5f) * cellW + (Hash(i, j, y.seed + 5) - 0.5f) * Mathf.Max(0, cellW - 2 * wid) * 0.6f;
                    float u = (a - cx) / len, v = across - cz;
                    // 半宽沿长轴的变化：迎风头（u < 0）超椭圆钝圆，背风尾收尖
                    float hw = u < 0
                        ? wid * Mathf.Pow(Mathf.Max(0, 1 - Mathf.Pow(Mathf.Min(1, -u), 4)), 0.25f)
                        : wid * Mathf.Pow(Mathf.Max(0, 1 - Mathf.Min(1, u)), 0.6f);
                    float outside = Mathf.Max(Mathf.Abs(v) - hw, (Mathf.Abs(u) - 1) * len) + wobble * wid;
                    // 剖面同 Mesa：顶沿锐利、坡脚拖出碎屑裙
                    float k = 1 - Mathf.Pow(Smooth(-y.edge, 0.3f * y.edge, outside), 0.55f);
                    if (k <= 0) continue;
                    // 背风尾：只在后 60% 收低 30%（台面大半是平的，尾端才像鲸背那样落下去）
                    float tail = 1 - 0.3f * Smooth(0.4f, 1f, u);
                    float flute = 1 - 0.07f * Mathf.Abs(Mathf.Sin(v * 1.6f + fluteN)) * Smooth(-0.7f * y.edge, 0, outside);
                    float val = k * hgt * tail * topN * flute;
                    if (val > best)
                    {
                        best = val;
                        bestBody = k;
                    }
                }
            }
            body = bestBody;
            top = Smooth(0.9f, 0.97f, bestBody);
            return best;
        }

        // ═════════════ 城墙压沙（1-3 沉沙古城）═════════════

        /// <summary>墙体芯（夯土城墙、挡土墙在地形里的部分）：沿折线、半厚 halfThick、高 height、侧壁 edge 米宽；返回 0–height</summary>
        public static float WallBody(Vector2 p, IReadOnlyList<Vector2> wall, float halfThick, float height, float edge)
        {
            var (d, _) = Polyline(p, wall);
            return height * (1 - Smooth(halfThick, halfThick + edge, d));
        }

        /// <summary>
        /// 墙边积沙：风把沙推到墙的迎风面，堆成一道能走上墙头的沙坡（坡长 reach，坡脚缓、近墙陡）；背风面只有一道矮而短的沙尾（leeReach）。
        /// crest(t) = 沿墙 t（0–1）处迎风面<b>贴着墙面</b>的积沙顶高（米）——可以从「只埋墙脚」渐变到「埋到垛口」（1-3 西北段）。
        /// reach / leeReach 从墙面（中线外 halfThick）量起：墙面处就是 crest，不会在墙厚里先掉一截。
        /// 墙厚 halfThick 内两面平滑过渡（墙模型盖住）。返回积沙高度（≥ 0）；windward = 迎风面遮罩。
        /// 墙模型摆在原地面上，积沙自然埋住墙脚，同一批城墙资产就有了「半埋」的新形态。
        /// </summary>
        public static float SandDrift(Vector2 p, IReadOnlyList<Vector2> wall, Vector2 wind, Func<float, float> crest, float reach, float leeReach,
            float halfThick, int seed, out float windward)
        {
            float d = PolylineClosest(p, wall, out float t, out var closest, out var tangent);
            var n = new Vector2(-tangent.y, tangent.x);
            // 有符号横距：正 = 迎风面（该面的外法线迎着风）
            float s = Vector2.Dot(p - closest, n) * (Vector2.Dot(n, wind) < 0 ? 1 : -1);
            // 积沙顶高沿墙只做小幅起伏（±4%）：沙坡能不能走上墙头取决于它，不能被噪声随机削掉
            float c = Mathf.Max(0, crest(t)) * (1 + Fbm(p, 14, 2, seed) * 0.08f);
            float face = Mathf.Max(0, d - halfThick);
            float up = c * Mathf.Pow(1 - Mathf.Clamp01(face / reach), 1.6f);
            float lee = 0.4f * c * Mathf.Pow(1 - Mathf.Clamp01(face / leeReach), 2f);
            windward = Smooth(-halfThick, halfThick, s);
            float ripple = 1 + Fbm(p, 5, 2, seed + 3) * 0.04f;
            return Mathf.Lerp(lee, up, windward) * ripple;
        }

        // ═════════════ 洞穴碗（1-3 下行坑、2-4 营地；旧版 1-4 穴顶场也用过）═════════════

        /// <summary>
        /// 洞穴碗：椭圆碗底（radius，边缘被噪声啃得不规则）压低 depth；碗壁 wall 米宽内陡升回地面（中段可达 60° 以上，是崖不是坡）；
        /// 壁顶外再起一圈口沿（rimHeight 高，向外 rimWidth 米落回）——「四周沙丘环绕成碗状」。返回相对四周地面的高度。
        /// 下到碗底的路用 PathSpline 坡道（只填）从口沿绕下去；穴顶、裂缝光是模型。
        /// </summary>
        public static float CaveBowl(Vector2 p, Vector2 center, Vector2 radius, float depth, float wall, float rimHeight, float rimWidth, int seed,
            out float floor, out float wallMask)
        {
            var d = p - center;
            float r = Mathf.Sqrt(d.x * d.x / (radius.x * radius.x) + d.y * d.y / (radius.y * radius.y));
            float rm = Mathf.Min(radius.x, radius.y);
            float x = (r - 1 - Fbm(p, rm * 0.6f, 3, seed) * 0.08f) * rm; // 离碗底边缘的米数（近似，碗内为负）
            float k = Smooth(0, 1, Mathf.Clamp01(x / wall));
            float bowl = -depth * (1 - Mathf.Pow(k, 0.65f));
            float rim = rimHeight * Smooth(wall * 0.5f, wall, x) * (1 - Smooth(wall, wall + rimWidth, x))
                        * (0.7f + 0.3f * (Fbm(p, 20, 2, seed + 1) * 0.5f + 0.5f));
            floor = 1 - Smooth(0, 3, x);
            wallMask = Smooth(0.5f, 3, x) * (1 - Smooth(wall * 0.8f, wall * 1.1f, x));
            return bowl + rim;
        }

        /// <summary>月牙遮罩（月牙泉泉床）：半径 r 的圆减去朝 facing（度）偏移 offset 的较小圆，feather 米宽过渡</summary>
        public static float Crescent(Vector2 p, Vector2 c, float r, float offset, float facing, float feather)
        {
            float a = facing * Mathf.Deg2Rad;
            var dir = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
            float outer = 1 - Smooth(r - feather, r, Vector2.Distance(p, c));
            float inner = 1 - Smooth(r * 0.86f - feather, r * 0.86f, Vector2.Distance(p, c + dir * offset));
            return Mathf.Clamp01(outer - inner);
        }

        // ═════════════ V 形谷 + 阶地（2-1 冰瀑栈道）═════════════

        public struct ValleySpec
        {
            /// <summary>谷底（冰河）半宽</summary>
            public float floorHalfWidth;
            /// <summary>阶地宽（米，20–40）：左岸 / 右岸（右岸 0 = 同左岸）——两岸不等宽，读起来不是镜像</summary>
            public float benchWidth, benchWidthRight;
            /// <summary>每级抬高（陡坎高）与陡坎水平宽（米，越小越陡：9 m 配 5 m ≈ 70°）</summary>
            public float stepHeight, riser;
            /// <summary>每岸阶地级数</summary>
            public int benches;
            /// <summary>最外一级之上的绝壁：高、水平宽（边界：翻不过去，也不立空气墙）</summary>
            public float wallHeight, wallWidth;
            /// <summary>阶地边缘沿谷向的摆动（米）</summary>
            public float wobble;
            public int seed;
        }

        /// <summary>
        /// V 形谷 + 阶地：谷轴 axis（带纵断面 = 谷底高度，冰瀑峡谷一路爬升）两侧依次是平的谷底、一级级阶地（先陡坎后台面）、最外的绝壁。
        /// 返回相对谷底纵断面的高度（调用方再加 axis.HeightAt(t)）；floor / cliff / bench 是分层遮罩（冰河、岩、雪）。
        /// 每级台面 20–40 m 宽，每场战斗至少两条接近路线：级间的坡道 / 栈道用 PathSpline（只填）补，见画廊 2-1 样例。
        /// </summary>
        public static float TerracedValley(Vector2 p, PathSpline axis, in ValleySpec v, out float t, out float floor, out float cliff, out float bench)
        {
            float sd = axis.Signed(p, out t);
            float bw = sd < 0 && v.benchWidthRight > 0 ? v.benchWidthRight : v.benchWidth;
            float x = Mathf.Abs(sd) - v.floorHalfWidth + Fbm(p, 40, 2, v.seed) * v.wobble;
            float period = v.riser + bw;
            float h;
            cliff = 0;
            if (x <= 0) h = 0;
            else if (x < v.benches * period)
            {
                float q = x / period, k = Mathf.Floor(q), f = (q - k) * period;
                h = v.stepHeight * (k + Smooth(0, v.riser, f));
                cliff = 1 - Smooth(v.riser, v.riser + 1.5f, f);
            }
            else
            {
                float xw = x - v.benches * period;
                h = v.benches * v.stepHeight + v.wallHeight * Smooth(0, v.wallWidth, xw);
                cliff = Smooth(0, 2f, xw) * (1 - Smooth(v.wallWidth, v.wallWidth + 4, xw));
            }
            floor = 1 - Smooth(-1.5f, 0.5f, x);
            bench = Mathf.Clamp01(1 - cliff - floor);
            return h;
        }

        // ═════════════ 平湖（2-3 瑶池冰湖）═════════════

        /// <summary>
        /// 平湖：椭圆湖岸叠角向噪声（irregular = 半径起伏比例），湖内返回 0、岸带 shore 米内平滑升到 1。
        /// 用法：h = Lerp(湖面高, h, k)——湖内绝对平（冰面、水面、熔岩面）。lake = 湖面遮罩，shoreMask = 岸带遮罩。
        /// </summary>
        public static float LakeShore(Vector2 p, Vector2 center, Vector2 radius, float shore, float irregular, int seed, out float lake, out float shoreMask) =>
            LakeShore(p, center, radius, shore, irregular, seed, out lake, out shoreMask, out _);

        /// <summary>同上，另给离湖岸的米数 edgeDist（湖内为负，岸带 0 … shore，陆上 &gt; shore）</summary>
        public static float LakeShore(Vector2 p, Vector2 center, Vector2 radius, float shore, float irregular, int seed, out float lake, out float shoreMask,
            out float edgeDist)
        {
            var d = p - center;
            float r = Mathf.Sqrt(d.x * d.x / (radius.x * radius.x) + d.y * d.y / (radius.y * radius.y));
            float ang = Mathf.Atan2(d.y, d.x);
            float edge = 1 + irregular * Loop(ang, 5, 3, seed);
            float x = (r - edge) * Mathf.Min(radius.x, radius.y); // 离湖岸的米数（湖内为负）
            edgeDist = x;
            lake = 1 - Smooth(-0.6f, 0.2f, x);
            shoreMask = Smooth(-1.5f, 0.5f, x) * (1 - Smooth(shore * 0.6f, shore * 1.4f, x));
            return Smooth(0, shore, x);
        }

        // ═════════════ 阶梯坡 + 挡土墙（2-2 昆仑天阙）═════════════

        public struct SteppedSlopeSpec
        {
            /// <summary>第一道挡土墙墙脚的中点（世界 XZ）</summary>
            public Vector2 origin;
            /// <summary>上坡方向（度，0 = +X，90 = +Z）</summary>
            public float angle;
            /// <summary>每级台面进深、每级抬高（= 挡土墙高）、挡土墙水平宽（越小越陡：3.5 m 高配 1 m ≈ 75°）</summary>
            public float shelfDepth, stepHeight, wallRun;
            public int steps;
            /// <summary>台面横向弯曲幅度（米）：墙线顺着山势弯，不是尺子画的直线</summary>
            public float bend;
            /// <summary>坡道车道（横向位置、半宽，米）：车道里是连续缓坡，不切台阶——不靠跳也能一路上去</summary>
            public (float across, float halfWidth)[] ramps;
            public int seed;
        }

        static float BendOffset(in SteppedSlopeSpec s, float across) =>
            s.bend == 0 ? 0 : Fbm(new Vector2(across, s.seed * 5.3f), 70, 2, s.seed) * s.bend;

        /// <summary>
        /// 阶梯坡：沿 angle 上坡，每 (shelfDepth + wallRun) 米一级——先一道近乎直立的挡土墙，再一片平台面；坡道车道里是连续缓坡。
        /// 返回相对 origin 地面的高度（坡脚之下 0，坡顶之上持平 steps × stepHeight）；across = 横向坐标（调用方据此限定台阶坡范围、接两侧山体）；
        /// wall / shelf / ramp 是分层与摆件遮罩。挡土墙模型沿 <see cref="SteppedSlopeWalls"/> 的墙线摆。
        /// </summary>
        public static float SteppedSlope(Vector2 p, in SteppedSlopeSpec s, out float across, out float wall, out float shelf, out float ramp)
        {
            float a = s.angle * Mathf.Deg2Rad;
            var dir = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
            var d = p - s.origin;
            across = Vector2.Dot(d, new Vector2(-dir.y, dir.x));
            float x = Vector2.Dot(d, dir) + BendOffset(s, across);
            float period = s.shelfDepth + s.wallRun, run = s.steps * period, total = s.steps * s.stepHeight;
            float hStep;
            wall = 0;
            if (x <= 0) hStep = 0;
            else if (x >= run) hStep = total;
            else
            {
                float q = x / period, k = Mathf.Floor(q), f = (q - k) * period;
                hStep = s.stepHeight * (k + Smooth(0, s.wallRun, f));
                wall = 1 - Smooth(s.wallRun, s.wallRun + 0.8f, f);
            }
            ramp = 0;
            if (s.ramps != null)
                foreach (var (ac, hw) in s.ramps)
                    ramp = Mathf.Max(ramp, 1 - Smooth(hw, hw + 3f, Mathf.Abs(across - ac)));
            float hRamp = Mathf.Clamp01(x / run) * total;
            wall *= 1 - ramp;
            shelf = x > 0 && x < run ? (1 - wall) * (1 - ramp) : 0;
            return Mathf.Lerp(hStep, hRamp, ramp);
        }

        /// <summary>
        /// 挡土墙墙线：第 k 道墙（墙脚高 k × stepHeight、墙顶高 (k+1) × stepHeight，相对 origin 地面）在横向 [−halfWidth, halfWidth] 内的折线，
        /// 坡道车道处断开。摆墙模型 / 白盒时沿线分段。
        /// </summary>
        public static List<(int k, List<Vector2> line)> SteppedSlopeWalls(in SteppedSlopeSpec s, float halfWidth, float sampleStep = 2f)
        {
            var o = new List<(int, List<Vector2>)>();
            float a = s.angle * Mathf.Deg2Rad;
            var dir = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
            var side = new Vector2(-dir.y, dir.x);
            float period = s.shelfDepth + s.wallRun;
            for (int k = 0; k < s.steps; k++)
            {
                List<Vector2> cur = null;
                for (float ac = -halfWidth; ac <= halfWidth + 1e-3f; ac += sampleStep)
                {
                    bool inRamp = false;
                    if (s.ramps != null)
                        foreach (var (rc, hw) in s.ramps)
                            if (Mathf.Abs(ac - rc) < hw + 1.5f) inRamp = true;
                    if (inRamp)
                    {
                        if (cur != null && cur.Count > 1) o.Add((k, cur));
                        cur = null;
                        continue;
                    }
                    float x = k * period + s.wallRun * 0.5f - BendOffset(s, ac);
                    cur ??= new List<Vector2>();
                    cur.Add(s.origin + dir * x + side * ac);
                }
                if (cur != null && cur.Count > 1) o.Add((k, cur));
            }
            return o;
        }

        // ═════════════ 火山口 + 螺旋岩台（3-2 铸神井）═════════════

        public struct CraterSpec
        {
            public Vector2 center;
            /// <summary>坑底半径、坑口半径、坑深（米；坑深取 step 的整数倍，入口才与口沿齐平）</summary>
            public float floorRadius, rimRadius, depth;
            /// <summary>每圈下降（= 每级岩台高）、陡坎水平宽（米）</summary>
            public float step, riser;
            /// <summary>螺旋头数：1 = 一条岩台从坑口绕到坑底；2 = 两条交错（更短、更多交叉视线）</summary>
            public int starts;
            /// <summary>岩台入口方向（度，0 = +X）：坑口在这里与岩台齐平，口沿外凸在这里断开</summary>
            public float entryAngle;
            /// <summary>口沿外凸（火山口唇）的高与外坡宽</summary>
            public float rimHeight, rimWidth;
            public int seed;
        }

        /// <summary>
        /// 火山口 + 螺旋岩台（露天矿式）：坑壁是一级级陡坎 + 岩台，岩台高度随方位角连续下降，每绕一圈正好降一级——
        /// 于是一条（或 starts 条）连续的螺旋坡道从坑口入口一直绕到坑底，坡度 ≈ step / (2πr)，只有几度；陡坎不可攀。
        /// 返回相对坑外地面的高度（坑底 = −depth）；ledge / cliff / floor 遮罩。坑底中心的熔岩井用 Sample.hole 挖（地形洞）。
        /// </summary>
        public static float SpiralCrater(Vector2 p, in CraterSpec c, out float ledge, out float cliff, out float floor)
        {
            var d = p - c.center;
            float rr = d.magnitude + Fbm(p, 25, 2, c.seed) * 1.2f;
            float span = Mathf.Max(1, c.rimRadius - c.floorRadius);
            float y = Mathf.Clamp01((rr - c.floorRadius) / span) * c.depth;
            int starts = Mathf.Max(1, c.starts);
            float ang = Mathf.Atan2(d.y, d.x) - c.entryAngle * Mathf.Deg2Rad;
            float phi = Mathf.Repeat(ang / (2 * Mathf.PI), 1f) * starts;
            float period = c.step * span / c.depth;
            float rf = Mathf.Clamp(c.riser / period, 0.05f, 0.9f);
            float yh = y + c.step * phi;
            float terr = Mathf.Clamp(Terrace(yh, c.step, rf) - c.step * phi, 0, c.depth);
            // 坑口：一道 riser 宽的陡坎接回地面；入口处最上一级岩台本来就与口沿齐平
            float inner = Mathf.Lerp(terr, c.depth, Smooth(c.rimRadius - c.riser, c.rimRadius, rr)) - c.depth;
            // 口沿外凸，入口两侧各约 6 m 内断开（不然一出岩台就是一道坎）
            float seg = 360f / starts;
            float a0 = Mathf.Repeat(ang * Mathf.Rad2Deg, seg);
            float toEntry = Mathf.Min(a0, seg - a0) * Mathf.Deg2Rad * c.rimRadius;
            float lip = c.rimHeight * Smooth(c.rimRadius - 1, c.rimRadius + 2, rr) * (1 - Smooth(c.rimRadius + 2, c.rimRadius + c.rimWidth, rr))
                        * Smooth(5, 11, toEntry);
            bool pit = rr < c.rimRadius - c.riser * 0.5f;
            floor = pit ? 1 - Smooth(0, 0.4f, terr) : 0;
            float riserBand = Smooth(1 - rf - 0.04f, 1 - rf + 0.02f, Mathf.Repeat(yh / c.step, 1f));
            cliff = pit ? riserBand * (1 - floor) : 0;
            ledge = pit ? (1 - riserBand) * (1 - floor) : 0;
            return inner + lip;
        }

        /// <summary>螺旋岩台的中线（世界 XZ 折线，从入口往下绕到坑底），验收坡度、摆路标用；heights = 相对坑外地面的高度</summary>
        public static List<Vector2> SpiralLedgePath(in CraterSpec c, out List<float> heights, float stepDeg = 3f)
        {
            var o = new List<Vector2>();
            heights = new List<float>();
            int starts = Mathf.Max(1, c.starts);
            float span = Mathf.Max(1, c.rimRadius - c.floorRadius);
            float period = c.step * span / c.depth;
            float rf = Mathf.Clamp(c.riser / period, 0.05f, 0.9f);
            // 从入口出发（展开的相位 φ 一直增长）：岩台面高 = depth − step·φ（相对坑底），岩台在锥面上占 y ∈ [y0, y1]——
            // 入口处岩台宽 0、贴着口沿，往前逐渐离开口沿、展到整宽；y0 落到坑底以下时岩台并入坑底
            for (float deg = 0; ; deg += stepDeg)
            {
                float phi = deg / 360f * starts;
                float y0 = c.depth - c.step * phi;
                if (y0 < 0) break;
                float y1 = Mathf.Min(c.depth, y0 + (1 - rf) * c.step);
                float r = c.floorRadius + (y0 + y1) * 0.5f / c.depth * span;
                float a = (c.entryAngle + deg) * Mathf.Deg2Rad;
                o.Add(c.center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * r);
                heights.Add(-c.step * phi);
            }
            return o;
        }

        // ═════════════ 熔岩湖 + 堤道（3-1 熔湖堤道）═════════════

        public sealed class LavaLakeSpec
        {
            public Vector2 center, radius;
            /// <summary>熔岩面高度（与调用方的地面同一基准）；湖床在它下面 bedDepth 米，地形不露出熔岩面</summary>
            public float level, bedDepth = 1.5f;
            /// <summary>岸带宽、湖岸不规则度</summary>
            public float shore = 10, irregular = 0.18f;
            /// <summary>玄武岩岛：中心、半径、岛顶高出熔岩面多少</summary>
            public (Vector2 c, float r, float h)[] islands = Array.Empty<(Vector2, float, float)>();
            /// <summary>堤道：没给纵断面的一律 level + causewayHeight；给了的（WithHeights / Level）按纵断面</summary>
            public PathSpline[] causeways = Array.Empty<PathSpline>();
            public float causewayHalfWidth = 3.5f, causewayHeight = 1.4f, causewayEdge = 1.8f;
            /// <summary>堤道上岛 / 上岸的引坡坡度（度）：岛顶、岸上都比堤面高，堤道按这个坡度爬上去，不在岛沿、岸边留一道坎</summary>
            public float causewayRampGrade = 9f;
            public int seed;
        }

        /// <summary>岛的最大外沿（米，离岛心）：岛沿 r + 1.5 再加边缘抖动的上限（0.18 r）——堤道的上岛引坡从这里开始，保证压在岛沿之上</summary>
        static float IslandReach(float r) => r + 1.5f + 0.18f * r;

        /// <summary>
        /// 熔岩湖 + 岛 + 堤道：湖内压到 level − bedDepth（熔岩面是 L7 LavaField 的平面），岸带渐变回 ground；
        /// 岛是顶平侧陡的玄武岩墩，堤道是侧壁陡、顶面平的路堤（只填不挖），一个湖可以有多条堤道、互相在岛上交汇。
        /// 堤面本身只高出熔岩 causewayHeight，岛顶、岸上更高：端点落在岛上的堤道，在岛的最大外沿以内与岛顶齐平、往外按 causewayRampGrade
        /// 落回堤面；进岸带后同样按坡度爬到原地面——沿堤道走不会撞上岛沿、岸边的陡坎。
        /// 外圈火山口壁用 <see cref="CaveBowl"/> 叠。返回高度；lava / shore / causeway / island 遮罩。
        /// </summary>
        public static float LavaLake(Vector2 p, float ground, LavaLakeSpec s, out float lava, out float shore, out float causeway, out float island)
        {
            float k = LakeShore(p, s.center, s.radius, s.shore, s.irregular, s.seed, out lava, out shore, out float edgeDist);
            float h = Mathf.Lerp(s.level - s.bedDepth, ground, k);
            island = 0;
            foreach (var (c, r, ih) in s.islands)
            {
                float dist = Vector2.Distance(p, c);
                if (dist > r + 6) continue;
                float m = 1 - Smooth(r - 2.5f, r + 1.5f, dist + Fbm(p, 7, 2, s.seed + 9) * r * 0.18f);
                if (m <= 0) continue;
                float top = s.level + ih * (1 + Fbm(p, 5, 2, s.seed + 4) * 0.05f);
                h = Mathf.Max(h, Mathf.Lerp(h, top, Mathf.Pow(m, 0.6f)));
                island = Mathf.Max(island, m);
            }
            causeway = 0;
            float grade = Mathf.Tan(Mathf.Clamp(s.causewayRampGrade, 1, 30) * Mathf.Deg2Rad);
            foreach (var cw in s.causeways)
            {
                var (d, t) = cw.Nearest(p, s.causewayHalfWidth + s.causewayEdge);
                float m = 1 - Smooth(s.causewayHalfWidth, s.causewayHalfWidth + s.causewayEdge, d);
                if (m <= 0) continue;
                float top = cw.HasProfile ? cw.HeightAt(t) : s.level + s.causewayHeight;
                // 上岸：岸带里（离陆地 shore − edgeDist 米）按坡度爬到原地面
                top = Mathf.Max(top, ground - grade * Mathf.Max(0, s.shore - edgeDist));
                // 上岛：只对端点落在岛上的堤道（路过的岛不让堤道拱起来）
                foreach (var (c, r, ih) in s.islands)
                {
                    float reach = IslandReach(r);
                    if (Vector2.Distance(cw.points[0], c) > reach && Vector2.Distance(cw.points[^1], c) > reach) continue;
                    top = Mathf.Max(top, s.level + ih - grade * Mathf.Max(0, Vector2.Distance(p, c) - reach));
                }
                h = Mathf.Max(h, Mathf.Lerp(h, top, m));
                causeway = Mathf.Max(causeway, m);
            }
            lava *= 1 - Mathf.Max(island, causeway);
            return h;
        }
    }

    /// <summary>
    /// 样条路径：古道、栈道、坡道、堤道、谷轴。控制点 Catmull-Rom 平滑成折线，另带一条纵断面（每米一个高度）。
    /// 纵断面两种来源：<see cref="FollowGround"/>（沿线取原地面再滑动平均——1-1 古道的做法，过河床是一段缓坡浅滩）、
    /// <see cref="WithHeights"/>（每个控制点给绝对高度，按弧长线性插值，可限坡——栈道、坡道、堤道）。
    /// <see cref="Flatten"/> 把地形压到纵断面：路宽内贴合、路肩内渐变回原地形；可以只填（坡道、堤道）或只挖（路堑）。
    /// 1-1 自己的古道代码（Level_1_1.RoadProfile）是这里的前身，行为相同；1-1 不改，保证原样重建。
    /// </summary>
    public sealed class PathSpline
    {
        public enum Mode { Both, FillOnly, CutOnly }

        public readonly List<Vector2> points;
        public readonly float length;
        readonly float[] cum;
        readonly int[] ctrlAt;
        readonly Vector2 min, max;
        float[] profile;

        /// <param name="ctrl">控制点（世界 XZ），至少 2 个</param>
        /// <param name="subdiv">每段细分点数；≤ 1 = 不平滑，直接用折线</param>
        public PathSpline(IReadOnlyList<Vector2> ctrl, int subdiv = 8)
        {
            if (ctrl == null || ctrl.Count < 2) throw new ArgumentException("PathSpline 至少要 2 个控制点");
            bool smooth = subdiv > 1;
            points = smooth ? Landform.Spline(ctrl, subdiv) : new List<Vector2>(ctrl);
            ctrlAt = new int[ctrl.Count];
            for (int i = 0; i < ctrl.Count; i++) ctrlAt[i] = smooth ? Mathf.Min(i * subdiv, points.Count - 1) : i;
            cum = new float[points.Count];
            for (int i = 1; i < points.Count; i++) cum[i] = cum[i - 1] + Vector2.Distance(points[i - 1], points[i]);
            length = Mathf.Max(1e-3f, cum[^1]);
            min = max = points[0];
            foreach (var q in points)
            {
                min = Vector2.Min(min, q);
                max = Vector2.Max(max, q);
            }
        }

        public bool HasProfile => profile != null;

        int Seg(float s)
        {
            int lo = 0, hi = points.Count - 2;
            while (lo < hi)
            {
                int mid = (lo + hi + 1) >> 1;
                if (cum[mid] <= s) lo = mid;
                else hi = mid - 1;
            }
            return lo;
        }

        /// <summary>沿线参数 t（0–1，按弧长）处的点</summary>
        public Vector2 At(float t)
        {
            float s = Mathf.Clamp01(t) * length;
            int i = Seg(s);
            float l = cum[i + 1] - cum[i];
            return Vector2.Lerp(points[i], points[i + 1], l > 1e-5f ? (s - cum[i]) / l : 0);
        }

        /// <summary>沿线参数 t 处的行进方向（单位向量）</summary>
        public Vector2 TangentAt(float t)
        {
            int i = Seg(Mathf.Clamp01(t) * length);
            return (points[i + 1] - points[i]).normalized;
        }

        /// <summary>最近点：距离与沿线参数 t。reach &gt; 0 时，离包围盒超过 reach 直接返回 (∞, 0)——整张地图逐点求值时省掉远处的计算</summary>
        public (float dist, float t) Nearest(Vector2 p, float reach = 0)
        {
            float d = Closest(p, reach, out float t, out _);
            return (d, t);
        }

        /// <summary>有符号横距：沿行进方向左正右负（谷轴两岸、墙的两面）；t 同 <see cref="Nearest"/></summary>
        public float Signed(Vector2 p, out float t, float reach = 0)
        {
            float d = Closest(p, reach, out t, out float side);
            return side >= 0 ? d : -d;
        }

        float Closest(Vector2 p, float reach, out float t, out float side)
        {
            t = 0;
            side = 1;
            if (reach > 0 && (p.x < min.x - reach || p.y < min.y - reach || p.x > max.x + reach || p.y > max.y + reach)) return float.MaxValue;
            float best = float.MaxValue, bestS = 0;
            for (int i = 0; i + 1 < points.Count; i++)
            {
                var a = points[i];
                var ab = points[i + 1] - a;
                float l2 = ab.sqrMagnitude;
                var ap = p - a;
                float u = l2 > 1e-8f ? Mathf.Clamp01(Vector2.Dot(ap, ab) / l2) : 0;
                float d = (ap - ab * u).magnitude;
                if (d < best)
                {
                    best = d;
                    bestS = cum[i] + u * (cum[i + 1] - cum[i]);
                    side = ab.x * ap.y - ab.y * ap.x;
                }
            }
            t = bestS / length;
            return best;
        }

        /// <summary>纵断面 = 沿线每米的原地面高度，±window 米滑动平均（1-1 古道的做法）；maxGrade &gt; 0 时再限坡（度）</summary>
        public PathSpline FollowGround(Func<Vector2, float> ground, int window = 8, float maxGrade = 0)
        {
            int n = Mathf.CeilToInt(length) + 1;
            var raw = new float[n];
            for (int k = 0; k < n; k++) raw[k] = ground(At(k / (float)(n - 1)));
            profile = Average(raw, window);
            if (maxGrade > 0) LimitGrade(maxGrade);
            return this;
        }

        /// <summary>
        /// 纵断面 = 控制点绝对高度（个数 = 控制点数），按弧长线性插值；smooth &gt; 0 时 ±smooth 米滑动平均去掉折点，
        /// maxGrade &gt; 0 时限坡（度，从起点往后削：太陡的那段会晚一点到达关键点高度，验收用 <see cref="MaxGrade"/> 查）。
        /// </summary>
        public PathSpline WithHeights(float[] heights, int smooth = 0, float maxGrade = 0)
        {
            if (heights == null || heights.Length != ctrlAt.Length)
                throw new ArgumentException($"PathSpline.WithHeights：要 {ctrlAt.Length} 个高度（每个控制点一个）");
            int n = Mathf.CeilToInt(length) + 1;
            var raw = new float[n];
            int c = 0;
            for (int k = 0; k < n; k++)
            {
                float s = k / (float)(n - 1) * length;
                while (c + 2 < ctrlAt.Length && cum[ctrlAt[c + 1]] < s) c++;
                float s0 = cum[ctrlAt[c]], s1 = cum[ctrlAt[c + 1]];
                raw[k] = Mathf.Lerp(heights[c], heights[c + 1], s1 > s0 ? Mathf.Clamp01((s - s0) / (s1 - s0)) : 1);
            }
            profile = smooth > 0 ? Average(raw, smooth) : raw;
            if (maxGrade > 0) LimitGrade(maxGrade);
            return this;
        }

        /// <summary>整条路同一个高度（堤道、环台步道）</summary>
        public PathSpline Level(float height)
        {
            profile = new[] { height, height };
            return this;
        }

        static float[] Average(float[] raw, int window)
        {
            int n = raw.Length;
            var o = new float[n];
            for (int k = 0; k < n; k++)
            {
                float s = 0;
                int c = 0;
                for (int j = Mathf.Max(0, k - window); j <= Mathf.Min(n - 1, k + window); j++)
                {
                    s += raw[j];
                    c++;
                }
                o[k] = s / c;
            }
            return o;
        }

        void LimitGrade(float deg)
        {
            float dmax = Mathf.Tan(deg * Mathf.Deg2Rad) * length / Mathf.Max(1, profile.Length - 1);
            for (int k = 1; k < profile.Length; k++) profile[k] = Mathf.Clamp(profile[k], profile[k - 1] - dmax, profile[k - 1] + dmax);
        }

        /// <summary>纵断面高度（t 0–1；没有纵断面时 0）</summary>
        public float HeightAt(float t)
        {
            if (profile == null) return 0;
            float f = Mathf.Clamp01(t) * (profile.Length - 1);
            int i = Mathf.Clamp((int)f, 0, profile.Length - 2);
            return Mathf.Lerp(profile[i], profile[i + 1], f - i);
        }

        /// <summary>路面遮罩：路宽内 1，路肩 shoulder 米内降到 0</summary>
        public float Mask(Vector2 p, float halfWidth, float shoulder)
        {
            var (d, _) = Nearest(p, halfWidth + shoulder);
            return 1 - Landform.Smooth(halfWidth, halfWidth + shoulder, d);
        }

        /// <summary>把高度 h 压到纵断面：路宽内贴合，路肩内渐变回 h；mode = 都做 / 只填（坡道、堤道不挖原地形）/ 只挖（路堑）。mask = 路面遮罩</summary>
        public float Flatten(Vector2 p, float h, float halfWidth, float shoulder, Mode mode, out float mask)
        {
            var (d, t) = Nearest(p, halfWidth + shoulder);
            mask = 1 - Landform.Smooth(halfWidth, halfWidth + shoulder, d);
            if (mask <= 0) return h;
            float v = Mathf.Lerp(h, HeightAt(t), mask);
            return mode switch { Mode.FillOnly => Mathf.Max(h, v), Mode.CutOnly => Mathf.Min(h, v), _ => v };
        }

        /// <summary>纵断面上最陡的一米（度）：验收坡道能不能走（玩家 / NavMesh ≤ 24° 稳妥）</summary>
        public float MaxGrade()
        {
            if (profile == null || profile.Length < 2) return 0;
            float step = length / (profile.Length - 1), worst = 0;
            for (int k = 0; k + 1 < profile.Length; k++) worst = Mathf.Max(worst, Mathf.Abs(profile[k + 1] - profile[k]));
            return Mathf.Atan(worst / Mathf.Max(1e-4f, step)) * Mathf.Rad2Deg;
        }
    }
}
