using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 地形高度场（米，世界坐标 x 东、z 北），按「地貌函数」叠加生成，再写进 Unity TerrainData。
    /// 地貌函数都是世界坐标的纯函数：同一份关卡规格总能生成同一张地形，改参数重新生成即可；美术之后在 Terrain 上直接雕刻。
    /// </summary>
    public sealed class HeightField
    {
        public readonly int res;
        public readonly Vector2 size;
        public readonly float[,] h; // [z, x]

        public HeightField(Vector2 size, int res)
        {
            this.size = size;
            this.res = res;
            h = new float[res, res];
        }

        public Vector2 Pos(int x, int z) => new(x / (float)(res - 1) * size.x, z / (float)(res - 1) * size.y);

        public void Each(Func<Vector2, float, float> f)
        {
            for (int z = 0; z < res; z++)
            for (int x = 0; x < res; x++)
                h[z, x] = f(Pos(x, z), h[z, x]);
        }

        public float Sample(Vector2 p)
        {
            float fx = Mathf.Clamp(p.x / size.x * (res - 1), 0, res - 1.001f), fz = Mathf.Clamp(p.y / size.y * (res - 1), 0, res - 1.001f);
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
                for (int z = 0; z < res; z++)
                for (int x = 0; x < res; x++)
                {
                    float m = mask(Pos(x, z));
                    if (m <= 0) continue;
                    float sum = 0;
                    int n = 0;
                    for (int dz = -radius; dz <= radius; dz++)
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        int xx = Mathf.Clamp(x + dx, 0, res - 1), zz = Mathf.Clamp(z + dz, 0, res - 1);
                        sum += src[zz, xx];
                        n++;
                    }
                    h[z, x] = Mathf.Lerp(src[z, x], sum / n, m);
                }
            }
        }

        public float Slope(int x, int z)
        {
            float cell = size.x / (res - 1);
            float dx = h[z, Mathf.Min(x + 1, res - 1)] - h[z, Mathf.Max(x - 1, 0)];
            float dz = h[Mathf.Min(z + 1, res - 1), x] - h[Mathf.Max(z - 1, 0), x];
            return Mathf.Atan(Mathf.Sqrt(dx * dx + dz * dz) / (2 * cell)) * Mathf.Rad2Deg;
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
    }
}
