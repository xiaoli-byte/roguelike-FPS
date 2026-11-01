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
    // LevelKit · 第四章高原（docs/level-design/maps/4-1.md、docs/unity-ch4-port.md M1）：4-1 / 4-2 / 4-4 共用。
    //   · 噪声与折线：网页 src/world/plateau/terrain.ts 的逐式移植（双精度、JS 的 32 位整数哈希），同一点的高度与网页一致；
    //   · 网格：网页 HeightGrid（grid.ts）的移植，地貌的各道工序（湖、河、路的盖章与平滑）在它上面做，Unity Terrain 从它取样；
    //   · 地表：第四章四层（0 草甸 / 1 土石 / 2 雪与冰川 / 3 岩）与分层规则（权重由地貌函数按网页上色的顺序叠好，规则只归一）；
    //   · 白盒：第四章场景件还没走美术管线，按资产 id 摆，有 Prefab 用 Prefab，没有就拼一个低模白盒（合并网格 + 不可见碰撞体，Placeholder 标签）；
    //   · 经幡：五色小旗沿悬链线排成一张网格（不动；弹簧骨 / 顶点动画随美术管线）；
    //   · 远景：网页 backdrop.ts 的远山环、单座雪峰（贡嘎）、外围地形，Backdrop 着色器（不受光、不受雾，光照与空气透视烘进顶点色）；
    //   · 草：Terrain 细节层（程序化草丛网格 + GPU instancing）。
    public static partial class LevelKit
    {
        // ───────────────────────────── 噪声 ─────────────────────────────

        /// <summary>网页 terrain.ts 的值噪声 / fBm / 山脊噪声，逐式移植（JS 的 Math.imul、无符号右移照搬）</summary>
        public static class PlateauNoise
        {
            static double Hash2(int ix, int iz, int seed)
            {
                unchecked
                {
                    int h = ix * 374761393 + iz * 668265263 + seed * 1442695041;
                    h = (h ^ (int)((uint)h >> 13)) * 1274126177;
                    h ^= (int)((uint)h >> 16);
                    return (uint)h / 4294967296.0;
                }
            }

            public static double VNoise(double x, double z, int seed = 0)
            {
                double fx0 = Math.Floor(x), fz0 = Math.Floor(z);
                int ix = (int)fx0, iz = (int)fz0;
                double fx = x - fx0, fz = z - fz0;
                double ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
                double a = Hash2(ix, iz, seed), b = Hash2(ix + 1, iz, seed);
                double c = Hash2(ix, iz + 1, seed), d = Hash2(ix + 1, iz + 1, seed);
                return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
            }

            public static double Fbm(double x, double z, int oct = 4, int seed = 0)
            {
                double v = 0, amp = 0.5, sum = 0;
                for (int i = 0; i < oct; i++)
                {
                    v += amp * VNoise(x, z, seed + i * 17);
                    sum += amp;
                    x = x * 2.03 + 5.3;
                    z = z * 2.03 - 1.7;
                    amp *= 0.5;
                }
                return v / sum;
            }

            /// <summary>山脊噪声：峰线尖、谷底圆</summary>
            public static double Ridged(double x, double z, int oct = 4, int seed = 0)
            {
                double v = 0, amp = 0.5, sum = 0;
                for (int i = 0; i < oct; i++)
                {
                    double n = 1 - Math.Abs(VNoise(x, z, seed + i * 31) * 2 - 1);
                    v += amp * n * n;
                    sum += amp;
                    x = x * 2.1 + 3.1;
                    z = z * 2.1 + 7.7;
                    amp *= 0.5;
                }
                return v / sum;
            }

            public static double Smooth(double a, double b, double x)
            {
                double t = Math.Min(1, Math.Max(0, (x - a) / (b - a)));
                return t * t * (3 - 2 * t);
            }

            public static double Clamp01(double x) => Math.Min(1, Math.Max(0, x));
        }

        // ───────────────────────────── 折线 ─────────────────────────────

        /// <summary>平滑折线上的一个采样点（网页 PathSample）：位置、高程、弧长、单位切向、到下一点是不是盘山的一折</summary>
        public sealed class PlateauPathSample
        {
            public double x, z, e, s, tx, tz;
            public bool terrace;
        }

        public static class PlateauPath
        {
            static List<(double x, double z)> Chaikin(IReadOnlyList<(double x, double z)> points, int iters)
            {
                var pts = points.ToList();
                for (int k = 0; k < iters; k++)
                {
                    var o = new List<(double, double)> { pts[0] };
                    for (int i = 0; i < pts.Count - 1; i++)
                    {
                        var (ax, az) = pts[i];
                        var (bx, bz) = pts[i + 1];
                        o.Add((ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25));
                        o.Add((ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75));
                    }
                    o.Add(pts[^1]);
                    pts = o;
                }
                return pts;
            }

            static List<PlateauPathSample> Resample(List<(double x, double z)> pts, double step)
            {
                var o = new List<PlateauPathSample>();
                double s = 0, carry = 0;
                for (int i = 0; i < pts.Count - 1; i++)
                {
                    var (ax, az) = pts[i];
                    var (bx, bz) = pts[i + 1];
                    double len = Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
                    if (len < 1e-6) continue;
                    double tx = (bx - ax) / len, tz = (bz - az) / len;
                    double d = carry;
                    while (d < len)
                    {
                        double t = d / len;
                        o.Add(new PlateauPathSample { x = ax + (bx - ax) * t, z = az + (bz - az) * t, s = s + d, tx = tx, tz = tz });
                        d += step;
                    }
                    carry = d - len;
                    s += len;
                }
                var (px, pz) = pts[^2];
                var (qx, qz) = pts[^1];
                double l = Math.Sqrt((qx - px) * (qx - px) + (qz - pz) * (qz - pz));
                if (l <= 0) l = 1;
                o.Add(new PlateauPathSample { x = qx, z = qz, s = s, tx = (qx - px) / l, tz = (qz - pz) / l });
                return o;
            }

            /// <summary>网页 smoothLine：Chaikin 三次 + 等距重采样</summary>
            public static List<PlateauPathSample> SmoothLine(IReadOnlyList<(double x, double z)> points, double step = 1.5) => Resample(Chaikin(points, 3), step);

            /// <summary>网页 smoothRoad：盘山段标记按「离哪段原始折线最近」判定</summary>
            public static List<PlateauPathSample> SmoothRoad(IReadOnlyList<(double x, double z, bool terrace)> nodes, double step = 1.5)
            {
                var o = Resample(Chaikin(nodes.Select(n => (n.x, n.z)).ToList(), 3), step);
                foreach (var p in o)
                {
                    double best = double.MaxValue;
                    bool terrace = false;
                    for (int i = 0; i < nodes.Count - 1; i++)
                    {
                        double d = SegDist(p.x, p.z, nodes[i].x, nodes[i].z, nodes[i + 1].x, nodes[i + 1].z, out _);
                        if (d < best)
                        {
                            best = d;
                            terrace = nodes[i].terrace;
                        }
                    }
                    p.terrace = terrace;
                }
                return o;
            }

            public static double SegDist(double px, double pz, double ax, double az, double bx, double bz, out double t)
            {
                double dx = bx - ax, dz = bz - az;
                double l2 = dx * dx + dz * dz;
                t = l2 > 0 ? PlateauNoise.Clamp01(((px - ax) * dx + (pz - az) * dz) / l2) : 0;
                double cx = ax + dx * t - px, cz = az + dz * t - pz;
                return Math.Sqrt(cx * cx + cz * cz);
            }

            /// <summary>到多边形的有符号距离（区内为负，网页 basinDistance）</summary>
            public static double PolygonDistance(double x, double z, IReadOnlyList<(double x, double z)> poly)
            {
                double d = double.MaxValue;
                bool inside = false;
                for (int i = 0, j = poly.Count - 1; i < poly.Count; j = i++)
                {
                    var (xi, zi) = poly[i];
                    var (xj, zj) = poly[j];
                    d = Math.Min(d, SegDist(x, z, xj, zj, xi, zi, out _));
                    if ((zi > z) != (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
                }
                return inside ? -d : d;
            }
        }

        // ───────────────────────────── 网格 ─────────────────────────────

        /// <summary>
        /// 网页 HeightGrid 的移植：step 米一格的高度场（float，与网页的 Float32Array 一样）+ 每格到可玩区边界的有符号距离。
        /// 坐标是网页坐标（x 向东、z 向南）；Unity 取样时把 z 取反。三角化方向与网页一致，<see cref="HeightAt"/> 与网页逐三角形相同
        /// </summary>
        public class PlateauGrid
        {
            public readonly double minX, minZ, maxX, maxZ, step;
            public readonly int nx, nz;
            public readonly float[] h, basin;

            public PlateauGrid(double minX, double maxX, double minZ, double maxZ, double step)
            {
                this.minX = minX;
                this.maxX = maxX;
                this.minZ = minZ;
                this.maxZ = maxZ;
                this.step = step;
                nx = (int)Math.Round((maxX - minX) / step) + 1;
                nz = (int)Math.Round((maxZ - minZ) / step) + 1;
                h = new float[nx * nz];
                basin = new float[nx * nz];
            }

            public int Idx(int i, int j) => j * nx + i;
            public double X(int i) => minX + i * step;
            public double Z(int j) => minZ + j * step;
            public int I(double x) => (int)Math.Round((x - minX) / step);
            public int J(double z) => (int)Math.Round((z - minZ) / step);
            public bool Inside(int i, int j) => i >= 0 && j >= 0 && i < nx && j < nz;

            public double HeightAt(double x, double z)
            {
                double gx = Math.Min(nx - 1.0001, Math.Max(0, (x - minX) / step));
                double gz = Math.Min(nz - 1.0001, Math.Max(0, (z - minZ) / step));
                int i = (int)gx, j = (int)gz;
                double fx = gx - i, fz = gz - j;
                double ha = h[Idx(i, j)], hb = h[Idx(i + 1, j)], hc = h[Idx(i + 1, j + 1)], hd = h[Idx(i, j + 1)];
                return fx >= fz ? ha + (hb - ha) * fx + (hc - hb) * fz : ha + (hc - hd) * fx + (hd - ha) * fz;
            }

            /// <summary>坡度（弧度），中心差分</summary>
            public double SlopeAt(double x, double z)
            {
                const double e = 0.75;
                double gx = (HeightAt(x + e, z) - HeightAt(x - e, z)) / (2 * e);
                double gz = (HeightAt(x, z + e) - HeightAt(x, z - e)) / (2 * e);
                return Math.Atan(Math.Sqrt(gx * gx + gz * gz));
            }

            /// <summary>一块矩形地基下的最低地形高度（网页 footprintMin；yaw 是网页的偏航）</summary>
            public double FootprintMin(double x, double z, double hx, double hz, double yaw)
            {
                double m = double.MaxValue, c = Math.Cos(yaw), s = Math.Sin(yaw);
                for (double a = -1; a <= 1; a += 0.5)
                for (double b = -1; b <= 1; b += 0.5)
                {
                    double lx = a * hx, lz = b * hz;
                    m = Math.Min(m, HeightAt(x + lx * c + lz * s, z - lx * s + lz * c));
                }
                return m;
            }

            /// <summary>沿线段步进，任何一点被地形挡住就算看不见（出了网格不再检查）</summary>
            public bool LineOfSight(double ax, double ay, double az, double bx, double by, double bz)
            {
                double dist = Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
                int steps = (int)Math.Ceiling(dist);
                for (int s = 1; s < steps; s++)
                {
                    double t = s / (double)steps;
                    double x = ax + (bx - ax) * t, z = az + (bz - az) * t;
                    if (x < minX || x > maxX || z < minZ || z > maxZ) return true;
                    if (HeightAt(x, z) > ay + (by - ay) * t) return false;
                }
                return true;
            }
        }

        // ───────────────────────────── 地表 ─────────────────────────────

        static Color C3(float r, float g, float b) => new(r, g, b, 1);

        /// <summary>
        /// 第四章四层：0 草甸（夏末青绿，带黄斑）· 1 土石（天路、牧道、河床、湖岸、梯田、碎石）· 2 雪与冰川（青白）· 3 岩（灰褐冻裂岩块，三平面投影）。
        /// 权重由地貌函数按网页上色的顺序叠好，放在 Sample 的 gravelBias（草甸）/ packed（土石）/ sand（雪冰）/ rock（岩）里，<see cref="PlateauSplat"/> 只归一
        /// </summary>
        public static TerrainLayer[] PlateauLayers() => new[]
        {
            TerrainTextureGen.Layer("PlateauMeadow", TerrainTextureGen.Kind.Snow,
                new TerrainTextureGen.Palette { a = C3(0.40f, 0.57f, 0.25f), b = C3(0.55f, 0.62f, 0.30f), accent = C3(0.30f, 0.46f, 0.22f), dark = C3(0.22f, 0.33f, 0.17f) }, 9f, 91),
            TerrainTextureGen.Layer("PlateauSoil", TerrainTextureGen.Kind.Packed,
                new TerrainTextureGen.Palette { a = C3(0.55f, 0.46f, 0.34f), b = C3(0.65f, 0.55f, 0.40f), accent = C3(0.68f, 0.63f, 0.54f), dark = C3(0.36f, 0.30f, 0.23f) }, 6f, 93),
            TerrainTextureGen.Layer("PlateauSnow", TerrainTextureGen.Kind.Snow,
                new TerrainTextureGen.Palette { a = C3(0.84f, 0.89f, 0.94f), b = C3(0.96f, 0.97f, 0.99f), accent = C3(0.66f, 0.80f, 0.88f), dark = C3(0.6f, 0.66f, 0.75f) }, 10f, 95),
            TerrainTextureGen.Layer("PlateauRock", TerrainTextureGen.Kind.DarkRock,
                new TerrainTextureGen.Palette { a = C3(0.43f, 0.41f, 0.38f), b = C3(0.58f, 0.56f, 0.52f), accent = C3(0.78f, 0.78f, 0.76f), dark = C3(0.26f, 0.25f, 0.24f) }, 14f, 97, 1024),
        };

        /// <summary>第四章分层规则：四层权重已在样本里（见 <see cref="PlateauLayers"/>），这里只归一</summary>
        public static Vector4 PlateauSplat(in Sample s, in SplatContext c)
        {
            var w = new Vector4(Mathf.Max(0, s.gravelBias), Mathf.Max(0, s.packed), Mathf.Max(0, s.sand), Mathf.Max(0, s.rock));
            float sum = w.x + w.y + w.z + w.w;
            return sum > 1e-4f ? w / sum : new Vector4(1, 0, 0, 0);
        }

        public static readonly Ground PlateauGround = new()
        {
            key = "Plateau", layers = PlateauLayers, rule = PlateauSplat, shadowTint = new Color(0.56f, 0.64f, 0.86f), macroStrength = 0.16f,
            rockScale = 14f, steepTriplanar = true, rockWarp = 0.3f, rockDetile = 0.4f, lightNormalRadius = 3f, lightNormalBlend = 0.7f,
        };

        // ───────────────────────────── 主题 ─────────────────────────────

        /// <summary>
        /// 第四章主题：F 路登记的 <see cref="ShowcaseTheme.Plateau"/>（光照、天空、雾、地表就是下面本地版的值；后处理按单遍调过，bridge.sh volumes 也按它重写）。
        /// 本地版留作对照（网页 backdrop.ts 的高原天：深蓝天顶、浅色地平线，太阳方向照网页 SKY.sunDir 换算，雾很远——贡嘎在 1 km 外也看得见）
        /// </summary>
        public static ShowcaseTheme PlateauTheme => ShowcaseTheme.Plateau ?? localPlateau;

        static readonly ShowcaseTheme localPlateau = new()
        {
            key = "Plateau", title = "第四章 · 雪域天路",
            sunColor = new(1f, 0.96f, 0.88f), sunIntensity = 1.45f, sunEuler = new(48, 51, 0),
            gradientSky = true, skyTop = new(0.16f, 0.39f, 0.78f), skyHorizon = new(0.79f, 0.88f, 0.95f), skyBottom = new(0.62f, 0.7f, 0.74f), skyExposure = 1f,
            ambientSky = new(0.46f, 0.58f, 0.82f), ambientEquator = new(0.62f, 0.68f, 0.72f), ambientGround = new(0.36f, 0.4f, 0.3f),
            fogColor = new(0.79f, 0.88f, 0.95f), fogStart = 160, fogEnd = 1300,
            fireColor = new(0.62f, 0.94f, 1f), fireIntensity = 5f,
            postExposure = -0.15f, contrast = 10, saturation = -4, temperature = -3, bloomTint = new(0.95f, 0.97f, 1f), bloomIntensity = 0.45f,
            groundA = new(0.36f, 0.58f, 0.21f), groundB = new(0.5f, 0.64f, 0.27f), groundShadowTint = new(0.56f, 0.64f, 0.86f),
            groundPattern = ShowcaseTheme.GroundPattern.Drifts,
        };

        // ───────────────────────────── 白盒材质 ─────────────────────────────

        /// <summary>第四章白盒色板（网页 landmarks.ts 的 C 表换成哑光体块色）</summary>
        public static readonly Dictionary<string, Color> PlateauPalette = new()
        {
            ["stone"] = new(0.70f, 0.66f, 0.60f), ["stoneDark"] = new(0.55f, 0.52f, 0.48f), ["pole"] = new(0.52f, 0.36f, 0.23f), ["white"] = new(0.94f, 0.93f, 0.89f),
            ["ochre"] = new(0.59f, 0.21f, 0.15f), ["black"] = new(0.11f, 0.10f, 0.09f), ["wood"] = new(0.64f, 0.47f, 0.31f),
            ["woodPale"] = new(0.86f, 0.76f, 0.62f), ["woodDark"] = new(0.35f, 0.18f, 0.12f), ["gold"] = new(0.91f, 0.71f, 0.24f),
            ["red"] = new(0.72f, 0.20f, 0.17f), ["blue"] = new(0.17f, 0.37f, 0.72f), ["green"] = new(0.18f, 0.56f, 0.30f), ["yellow"] = new(0.89f, 0.72f, 0.19f),
            ["tentBlack"] = new(0.13f, 0.12f, 0.11f), ["tentWhite"] = new(0.95f, 0.94f, 0.90f), ["ice"] = new(0.84f, 0.93f, 0.97f),
            ["iceBlue"] = new(0.55f, 0.78f, 0.88f), ["rock"] = new(0.56f, 0.54f, 0.50f), ["rockDark"] = new(0.44f, 0.42f, 0.39f),
            ["yak"] = new(0.16f, 0.14f, 0.12f), ["yakBrown"] = new(0.30f, 0.21f, 0.15f), ["yakFace"] = new(0.9f, 0.87f, 0.82f), ["tin"] = new(0.37f, 0.49f, 0.60f),
            ["dung"] = new(0.42f, 0.31f, 0.22f), ["straw"] = new(0.85f, 0.71f, 0.35f), ["mani"] = new(0.86f, 0.84f, 0.79f),
            ["drumOrange"] = new(0.78f, 0.39f, 0.16f), ["drumBlue"] = new(0.18f, 0.38f, 0.66f), ["bone"] = new(0.9f, 0.86f, 0.78f),
        };

        public static Material PlateauMat(string dir, string key) =>
            Mat(dir, $"Plateau_{key}", PlateauPalette.TryGetValue(key, out var c) ? c : Color.magenta, key is "ice" or "iceBlue" ? 0.35f : 0.9f);

        // ───────────────────────────── 白盒拼装 ─────────────────────────────

        /// <summary>
        /// 白盒：在物体的局部坐标里（x 右、y 上、z 前，原点 = 地面上的底面中心）拼低模体块，按材质合并成一个网格；
        /// 碰撞体单独列（盒 / 斜坡 / 胶囊），实例化时挂在不可见的子物体上（导航网格烘焙按物理碰撞体，渲染网格不带碰撞）
        /// </summary>
        public sealed class PlateauWhitebox
        {
            readonly string dir;
            readonly Dictionary<Material, (List<Vector3> v, List<Vector3> n, List<int> t)> parts = new();
            public readonly List<(Vector3 center, Vector3 size, Vector3 euler)> boxes = new();
            public readonly List<(Vector3 baseCenter, float radius, float height)> capsules = new();
            System.Random rng = new(1);
            /// <summary>
            /// 网页局部坐标移植用：网页 z 向南，Unity z 向北，整张图按 z 取反换算时，摆放朝向取 180° − 网页偏航，
            /// 局部 x 要取反才和网页是同一个物体（楼梯在哪一侧、门在哪边）。只镜像位置与偏航，体块本身对称，不翻面
            /// </summary>
            public bool mirrorX = true;

            public PlateauWhitebox(string dir) => this.dir = dir;

            Vector3 Mx(Vector3 p) => mirrorX ? new Vector3(-p.x, p.y, p.z) : p;
            float My(float yaw) => mirrorX ? -yaw : yaw;

            public Material M(string key) => PlateauMat(dir, key);
            public void Seed(int s) => rng = new System.Random(s);
            public float Rand() => (float)rng.NextDouble();

            (List<Vector3> v, List<Vector3> n, List<int> t) P(Material m)
            {
                if (!parts.TryGetValue(m, out var p)) parts[m] = p = (new List<Vector3>(), new List<Vector3>(), new List<int>());
                return p;
            }

            void Quad(Material m, Vector3 a, Vector3 b, Vector3 c, Vector3 d)
            {
                var p = P(m);
                var nn = Vector3.Cross(b - a, c - a).normalized;
                int i = p.v.Count;
                p.v.AddRange(new[] { a, b, c, d });
                p.n.AddRange(new[] { nn, nn, nn, nn });
                p.t.AddRange(new[] { i, i + 1, i + 2, i, i + 2, i + 3 });
            }

            void Tri(Material m, Vector3 a, Vector3 b, Vector3 c)
            {
                var p = P(m);
                var nn = Vector3.Cross(b - a, c - a).normalized;
                int i = p.v.Count;
                p.v.AddRange(new[] { a, b, c });
                p.n.AddRange(new[] { nn, nn, nn });
                p.t.AddRange(new[] { i, i + 1, i + 2 });
            }

            /// <summary>方块：底面中心 baseCenter，尺寸 size，绕自身偏航 / 俯仰 / 横滚（度）</summary>
            public void Box(string mat, Vector3 baseCenter, Vector3 size, float yaw = 0, float pitch = 0, float roll = 0) =>
                Frustum(mat, baseCenter, new Vector2(size.x, size.z), new Vector2(size.x, size.z), size.y, yaw, pitch, roll);

            /// <summary>四棱台：底 bottom（宽、深）收到顶 top，高 height</summary>
            public void Frustum(string mat, Vector3 baseCenter, Vector2 bottom, Vector2 top, float height, float yaw = 0, float pitch = 0, float roll = 0)
            {
                var m = M(mat);
                baseCenter = Mx(baseCenter);
                var rot = Quaternion.Euler(pitch, My(yaw), My(roll));
                Vector3 V(float sx, float y, float sz, Vector2 s) => baseCenter + rot * new Vector3(sx * s.x * 0.5f, y, sz * s.y * 0.5f);
                Vector3 b0 = V(-1, 0, -1, bottom), b1 = V(1, 0, -1, bottom), b2 = V(1, 0, 1, bottom), b3 = V(-1, 0, 1, bottom);
                Vector3 t0 = V(-1, height, -1, top), t1 = V(1, height, -1, top), t2 = V(1, height, 1, top), t3 = V(-1, height, 1, top);
                Quad(m, t0, t3, t2, t1);
                Quad(m, b0, b1, b2, b3);
                Quad(m, b0, t0, t1, b1);
                Quad(m, b1, t1, t2, b2);
                Quad(m, b2, t2, t3, b3);
                Quad(m, b3, t3, t0, b0);
            }

            /// <summary>圆台 / 圆柱（带上下盖）</summary>
            public void Cyl(string mat, Vector3 baseCenter, float rBottom, float rTop, float height, int seg = 10) =>
                Lathe(mat, baseCenter, new[] { new Vector2(0, 0), new Vector2(rBottom, 0), new Vector2(rTop, height), new Vector2(0, height) }, seg);

            /// <summary>旋转体：profile = (半径, 高) 自下而上；相邻两点之间一圈四边形（面法线，低模硬边）</summary>
            public void Lathe(string mat, Vector3 baseCenter, IReadOnlyList<Vector2> profile, int seg = 12)
            {
                var m = M(mat);
                baseCenter = Mx(baseCenter);
                for (int k = 0; k + 1 < profile.Count; k++)
                {
                    var p0 = profile[k];
                    var p1 = profile[k + 1];
                    if (p0.x < 1e-4f && p1.x < 1e-4f) continue;
                    for (int s = 0; s < seg; s++)
                    {
                        float a0 = s * Mathf.PI * 2 / seg, a1 = (s + 1) * Mathf.PI * 2 / seg;
                        Vector3 R(Vector2 p, float a) => baseCenter + new Vector3(Mathf.Cos(a) * p.x, p.y, Mathf.Sin(a) * p.x);
                        Vector3 v00 = R(p0, a0), v01 = R(p0, a1), v10 = R(p1, a0), v11 = R(p1, a1);
                        if (p0.x < 1e-4f) Tri(m, v00, v10, v11);
                        else if (p1.x < 1e-4f) Tri(m, v00, v10, v01);
                        else Quad(m, v00, v10, v11, v01);
                    }
                }
            }

            /// <summary>两点之间的细杆（六棱柱）</summary>
            public void Rod(string mat, Vector3 a, Vector3 b, float r, int seg = 6)
            {
                var m = M(mat);
                a = Mx(a);
                b = Mx(b);
                var axis = b - a;
                if (axis.sqrMagnitude < 1e-6f) return;
                var rot = Quaternion.FromToRotation(Vector3.up, axis.normalized);
                for (int s = 0; s < seg; s++)
                {
                    float a0 = s * Mathf.PI * 2 / seg, a1 = (s + 1) * Mathf.PI * 2 / seg;
                    var o0 = rot * new Vector3(Mathf.Cos(a0) * r, 0, Mathf.Sin(a0) * r);
                    var o1 = rot * new Vector3(Mathf.Cos(a1) * r, 0, Mathf.Sin(a1) * r);
                    Quad(m, a + o0, b + o0, b + o1, a + o1);
                }
            }

            /// <summary>石块：随机起伏的二十面体，压扁到 squash，底部埋进地面一点</summary>
            public void Rock(string mat, Vector3 baseCenter, float r, float squash = 0.7f, int seed = 1)
            {
                var m = M(mat);
                baseCenter = Mx(baseCenter);
                var g = new System.Random(seed * 7919 + 13);
                float t = (1 + Mathf.Sqrt(5)) / 2;
                var verts = new[]
                {
                    new Vector3(-1, t, 0), new Vector3(1, t, 0), new Vector3(-1, -t, 0), new Vector3(1, -t, 0), new Vector3(0, -1, t), new Vector3(0, 1, t),
                    new Vector3(0, -1, -t), new Vector3(0, 1, -t), new Vector3(t, 0, -1), new Vector3(t, 0, 1), new Vector3(-t, 0, -1), new Vector3(-t, 0, 1),
                };
                int[] f =
                {
                    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
                    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
                };
                var c = baseCenter + Vector3.up * r * squash * 0.75f;
                var p = verts.Select(v => c + Vector3.Scale(v.normalized * (0.8f + 0.35f * (float)g.NextDouble()), new Vector3(r, r * squash, r))).ToArray();
                for (int i = 0; i < f.Length; i += 3)
                {
                    Vector3 a = p[f[i]], b = p[f[i + 1]], d = p[f[i + 2]];
                    var nn = Vector3.Cross(b - a, d - a);
                    if (Vector3.Dot(nn, (a + b + d) / 3 - c) < 0) (b, d) = (d, b);
                    Tri(m, a, b, d);
                }
            }

            /// <summary>椭球（低模，面法线）：中心 center，三轴半径 radii</summary>
            public void Ellipsoid(string mat, Vector3 center, Vector3 radii, int seg = 10)
            {
                var m = M(mat);
                center = Mx(center);
                int rings = Mathf.Max(3, seg / 2);
                Vector3 Pt(int r, int s)
                {
                    float th = r * Mathf.PI / rings, ph = s * Mathf.PI * 2 / seg;
                    return center + Vector3.Scale(new Vector3(Mathf.Sin(th) * Mathf.Cos(ph), Mathf.Cos(th), Mathf.Sin(th) * Mathf.Sin(ph)), radii);
                }
                for (int r = 0; r < rings; r++)
                for (int s = 0; s < seg; s++)
                {
                    Vector3 a = Pt(r, s), b = Pt(r + 1, s), c = Pt(r + 1, s + 1), d = Pt(r, s + 1);
                    if (r == 0) Tri(m, a, c, b);
                    else if (r == rings - 1) Tri(m, a, d, b);
                    else Quad(m, a, d, c, b);
                }
            }

            /// <summary>棱柱：凸多边形截面 profile（局部 (z, y)）沿局部 x 拉伸 length，中心在 baseCenter（帐篷的截面）</summary>
            public void Prism(string mat, Vector3 baseCenter, IReadOnlyList<Vector2> profile, float length, float yaw = 0)
            {
                var m = M(mat);
                baseCenter = Mx(baseCenter);
                var rot = Quaternion.Euler(0, My(yaw), 0);
                Vector3 V(Vector2 p, float x) => baseCenter + rot * new Vector3(x, p.y, p.x);
                float h = length * 0.5f;
                var c = Vector2.zero;
                foreach (var p in profile) c += p;
                c /= profile.Count;
                var center = baseCenter + rot * new Vector3(0, c.y, c.x);
                void Face(Vector3 a, Vector3 b, Vector3 d)
                {
                    if (Vector3.Dot(Vector3.Cross(b - a, d - a), (a + b + d) / 3 - center) < 0) (b, d) = (d, b);
                    Tri(m, a, b, d);
                }
                for (int i = 0; i < profile.Count; i++)
                {
                    var p0 = profile[i];
                    var p1 = profile[(i + 1) % profile.Count];
                    Face(V(p0, -h), V(p1, -h), V(p1, h));
                    Face(V(p0, -h), V(p1, h), V(p0, h));
                }
                for (int i = 1; i + 1 < profile.Count; i++)
                {
                    Face(V(profile[0], -h), V(profile[i], -h), V(profile[i + 1], -h));
                    Face(V(profile[0], h), V(profile[i], h), V(profile[i + 1], h));
                }
            }

            /// <summary>碰撞盒：底面中心 + 尺寸 + 偏航（局部）</summary>
            public void ColBox(Vector3 baseCenter, Vector3 size, float yaw = 0) => boxes.Add((Mx(baseCenter) + Vector3.up * size.y * 0.5f, size, new Vector3(0, My(yaw), 0)));

            /// <summary>斜坡碰撞盒（楼梯、石阶的走行面）：从 foot（地面）到 top（台面），宽 width、板厚 thick；碰撞盒的上表面就是坡面</summary>
            public void ColRamp(Vector3 foot, Vector3 top, float width, float thick = 0.4f)
            {
                foot = Mx(foot);
                top = Mx(top);
                var d = top - foot;
                var flat = new Vector3(d.x, 0, d.z);
                float yaw = Mathf.Atan2(flat.x, flat.z) * Mathf.Rad2Deg, pitch = -Mathf.Atan2(d.y, flat.magnitude) * Mathf.Rad2Deg;
                var rot = Quaternion.Euler(pitch, yaw, 0);
                var center = (foot + top) * 0.5f - rot * Vector3.up * (thick * 0.5f);
                boxes.Add((center, new Vector3(width, thick, d.magnitude + 0.3f), new Vector3(pitch, yaw, 0)));
            }

            /// <summary>碰撞柱（胶囊）：底面中心、半径、高</summary>
            public void ColCyl(Vector3 baseCenter, float radius, float height) => capsules.Add((Mx(baseCenter), radius, height));

            public int Triangles => parts.Values.Sum(p => p.t.Count / 3);

            /// <summary>合并成网格（每个材质一个子网格）</summary>
            public Mesh ToMesh(string name, out Material[] materials)
            {
                var v = new List<Vector3>();
                var n = new List<Vector3>();
                var subs = new List<int[]>();
                var mats = new List<Material>();
                foreach (var (m, p) in parts)
                {
                    int o = v.Count;
                    v.AddRange(p.v);
                    n.AddRange(p.n);
                    subs.Add(p.t.Select(i => i + o).ToArray());
                    mats.Add(m);
                }
                var mesh = new Mesh { name = name, indexFormat = v.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                mesh.SetVertices(v);
                mesh.SetNormals(n);
                mesh.subMeshCount = subs.Count;
                for (int i = 0; i < subs.Count; i++) mesh.SetTriangles(subs[i], i);
                mesh.RecalculateBounds();
                materials = mats.ToArray();
                return mesh;
            }
        }

        /// <summary>本次构建里已经生成的白盒网格（同 key 的件共用一个网格资产 → 静态合批，资产也少）</summary>
        static readonly Dictionary<string, (Mesh mesh, Material[] mats, List<(Vector3, Vector3, Vector3)> boxes, List<(Vector3, float, float)> caps)> plateauMeshes = new();

        /// <summary>白盒按资产 id 计数（报告用）</summary>
        public static readonly Dictionary<string, int> PlateauPlaceholders = new();

        public static void ResetPlateauCache()
        {
            plateauMeshes.Clear();
            PlateauPlaceholders.Clear();
        }

        /// <summary>
        /// 按资产 id 摆一件第四章场景件：有 Prefab 就摆 Prefab（按设计包围盒缩放到 height，height ≤ 0 不缩放）；
        /// 没有就按 key 取 / 拼白盒（build 在局部坐标里拼），名字「Placeholder · id」、打 Placeholder 标签，碰撞体是名为「id · 碰撞 n」的子物体
        /// （地标视线打到它们算看到）。ground = 底面中心的世界坐标，yaw = Unity 偏航（度）。返回根物体
        /// </summary>
        public static GameObject PlateauPiece(string dir, string id, string key, Transform parent, Vector3 ground, float yaw, float height, Action<PlateauWhitebox> build,
            string label = null)
        {
            if (ShowcaseSceneBuilder.Prefab(id))
            {
                float scale = 1;
                if (height > 0) scale = height / Mathf.Max(0.1f, ShowcaseSceneBuilder.DesignBounds(id).size.y);
                var p = ShowcaseSceneBuilder.Place(id, parent, ground, yaw, scale);
                if (p)
                {
                    p.isStatic = true;
                    if (!string.IsNullOrEmpty(label)) p.name = $"{id} ({label})";
                }
                return p;
            }
            if (!plateauMeshes.TryGetValue(key, out var cached))
            {
                var wb = new PlateauWhitebox(dir);
                build(wb);
                string mdir = $"{dir}/Whitebox";
                Directory.CreateDirectory(mdir);
                var mesh = wb.ToMesh($"WB_{key}", out var mats);
                SaveAsset(mesh, $"{mdir}/WB_{key}.asset");
                cached = (mesh, mats, wb.boxes.ToList(), wb.capsules.ToList());
                plateauMeshes[key] = cached;
            }
            EnsureTag(PlaceholderTag);
            var go = new GameObject(string.IsNullOrEmpty(label) ? $"Placeholder · {id}" : $"Placeholder · {id} ({label})");
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(ground, Quaternion.Euler(0, yaw, 0));
            go.tag = PlaceholderTag;
            go.isStatic = true;
            go.AddComponent<MeshFilter>().sharedMesh = cached.mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterials = cached.mats;
            mr.shadowCastingMode = cached.mesh.bounds.size.y > 1.2f ? ShadowCastingMode.On : ShadowCastingMode.Off;
            int k = 0;
            foreach (var (c, s, e) in cached.boxes)
            {
                var col = new GameObject($"{id} · 碰撞 {++k}") { isStatic = true };
                col.transform.SetParent(go.transform, false);
                col.transform.localPosition = c;
                col.transform.localRotation = Quaternion.Euler(e);
                col.AddComponent<BoxCollider>().size = s;
            }
            foreach (var (b, r, hgt) in cached.caps)
            {
                var col = new GameObject($"{id} · 碰撞 {++k}") { isStatic = true };
                col.transform.SetParent(go.transform, false);
                col.transform.localPosition = b + Vector3.up * hgt * 0.5f;
                var cc = col.AddComponent<CapsuleCollider>();
                cc.radius = r;
                cc.height = Mathf.Max(hgt, r * 2);
            }
            PlateauPlaceholders[id] = PlateauPlaceholders.TryGetValue(id, out int n) ? n + 1 : 1;
            return go;
        }

        // ───────────────────────────── 经幡 ─────────────────────────────

        /// <summary>
        /// 经幡：悬链线上一面面五色小旗（蓝、白、红、绿、黄循环），旗面双面；竖幡（达觉、经幡杆上挂的长条幡）。
        /// 全图合成一个网格（五个子网格 = 五色材质），不带碰撞、不投影
        /// </summary>
        public sealed class PrayerFlags
        {
            static readonly string[] Colors = { "blue", "white", "red", "green", "yellow" };
            readonly List<Vector3>[] v = Colors.Select(_ => new List<Vector3>()).ToArray();
            readonly List<Vector3>[] n = Colors.Select(_ => new List<Vector3>()).ToArray();
            readonly List<int>[] t = Colors.Select(_ => new List<int>()).ToArray();
            int flags, lines;
            public int Count => flags;
            public int Lines => lines;
            /// <summary>旗面飘去的方向：风吹去的方向（世界 XZ）</summary>
            public Vector2 wind = new(1, -0.35f);

            void Add(int c, Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, Vector3 nrm, bool twoSided)
            {
                c = ((c % Colors.Length) + Colors.Length) % Colors.Length;
                int i = v[c].Count;
                v[c].AddRange(new[] { p0, p1, p2, p3 });
                n[c].AddRange(new[] { nrm, nrm, nrm, nrm });
                t[c].AddRange(new[] { i, i + 1, i + 2, i, i + 2, i + 3 });
                if (!twoSided) return;
                i = v[c].Count;
                v[c].AddRange(new[] { p0, p1, p2, p3 });
                n[c].AddRange(new[] { -nrm, -nrm, -nrm, -nrm });
                t[c].AddRange(new[] { i, i + 2, i + 1, i, i + 3, i + 2 });
            }

            void Flag(int color, Vector3 top, Vector3 along, float w, float hgt)
            {
                var side = along.normalized * w;
                var down = Vector3.down * hgt + new Vector3(wind.x, 0, wind.y).normalized * hgt * 0.25f;
                Vector3 a = top - side * 0.5f, b = top + side * 0.5f, d = a + down, e = b + down;
                Add(color, a, b, e, d, Vector3.Cross(b - a, d - a).normalized, true);
                flags++;
            }

            /// <summary>a → b 一条经幡绳（下垂 sag × 长度），旗宽 size、旗距 spacing</summary>
            public void Line(Vector3 a, Vector3 b, float sag = 0.06f, float size = 0.42f, float spacing = 0.52f)
            {
                float len = Vector3.Distance(a, b);
                if (len < 0.5f) return;
                Vector3 P(float u) => Vector3.Lerp(a, b, u) - Vector3.up * (sag * len * 4 * u * (1 - u));
                int count = Mathf.Max(2, Mathf.FloorToInt(len / spacing));
                for (int i = 1; i < count; i++)
                {
                    float u = i / (float)count;
                    var p = P(u);
                    Flag(i, p, P(Mathf.Min(1, u + 0.01f)) - p, size * 0.85f, size);
                }
                const int segs = 8;
                for (int s = 0; s < segs; s++)
                {
                    var p0 = P(s / (float)segs);
                    var p1 = P((s + 1) / (float)segs);
                    var side = Vector3.Cross(p1 - p0, Vector3.up).normalized * 0.02f;
                    Add(1, p0 - side, p1 - side, p1 + side, p0 + side, Vector3.up, true);
                }
                lines++;
            }

            /// <summary>竖幡：杆上 top 往下挂一条长幡（长 length、宽 width），yawDeg = 幡面朝向</summary>
            public void Banner(Vector3 top, float length, float width, int color, float yawDeg)
            {
                var dir = Quaternion.Euler(0, yawDeg, 0) * Vector3.right;
                var down = Vector3.down * length;
                Vector3 a = top, b = top + dir * width, d = a + down, e = b + down + dir * width * 0.4f;
                Add(color, a, b, e, d, Vector3.Cross(b - a, d - a).normalized, true);
                flags++;
            }

            public GameObject Build(string dir, string name, Transform parent)
            {
                var all = new List<Vector3>();
                var nrm = new List<Vector3>();
                var subs = new List<int[]>();
                for (int c = 0; c < Colors.Length; c++)
                {
                    int o = all.Count;
                    all.AddRange(v[c]);
                    nrm.AddRange(n[c]);
                    subs.Add(t[c].Select(i => i + o).ToArray());
                }
                var mesh = new Mesh { name = $"PrayerFlags_{name}", indexFormat = all.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                mesh.SetVertices(all);
                mesh.SetNormals(nrm);
                mesh.subMeshCount = subs.Count;
                for (int i = 0; i < subs.Count; i++) mesh.SetTriangles(subs[i], i);
                mesh.RecalculateBounds();
                SaveAsset(mesh, $"{dir}/PrayerFlags_{name}.asset");
                var go = new GameObject("Prayer Flags · 经幡");
                go.transform.SetParent(parent, false);
                go.isStatic = true;
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterials = Colors.Select(c => PlateauMat(dir, c)).ToArray();
                mr.shadowCastingMode = ShadowCastingMode.Off;
                return go;
            }
        }

        // ───────────────────────────── 远景 ─────────────────────────────

        /// <summary>一座远山（网页 PeakSpec）：位置（Unity XZ）、高、底半径、山脊数、尖锐度、种子、雪线（占高的比例）、绿坡比例</summary>
        public struct PlateauPeak
        {
            public Vector2 at;
            public float height, radius, sharp, seed, snow, green;
            public int ridges;
        }

        static readonly Color PkRock = new(0.435f, 0.416f, 0.4f), PkRockCool = new(0.365f, 0.392f, 0.439f), PkSnow = new(0.965f, 0.976f, 0.992f),
            PkSnowShade = new(0.788f, 0.843f, 0.918f), PkHill = new(0.31f, 0.49f, 0.227f), PkHillFar = new(0.365f, 0.498f, 0.353f);

        /// <summary>网页 colorFor：岩 → 低处绿坡 → 雪线以上积雪</summary>
        static Color PeakColor(float y, float slope, float snowLine, float green, float n)
        {
            var c = Color.Lerp(PkRock, PkRockCool, n);
            float g = (1 - (float)PlateauNoise.Smooth(snowLine * 0.25, snowLine * 0.55, y)) * green;
            c = Color.Lerp(c, n > 0.5f ? PkHill : PkHillFar, g);
            float snow = (float)PlateauNoise.Smooth(snowLine - 20, snowLine + 15, y + (n - 0.5f) * 60) * (1 - (float)PlateauNoise.Smooth(0.95, 1.25, slope) * 0.7f);
            c = Color.Lerp(c, PkSnow, snow);
            if (snow > 0.2f && slope > 0.7f) c = Color.Lerp(c, PkSnowShade, 0.35f);
            return c;
        }

        /// <summary>顶点色的光照与空气透视：朝光面亮、背光面压成冷暗色，按离视点中心的距离往地平线色混（线性色彩空间下转线性）</summary>
        static Color Shade(Color albedo, Vector3 normal, Vector3 toSun, float dist, Color horizon, float hazeStart, float hazeEnd)
        {
            float lambert = Mathf.Clamp01(Vector3.Dot(normal, toSun));
            var lit = albedo * (0.55f + 0.6f * lambert);
            lit = Color.Lerp(lit, new Color(lit.r * 0.85f, lit.g * 0.92f, lit.b * 1.08f), 1 - lambert);
            float haze = (float)PlateauNoise.Smooth(hazeStart, hazeEnd, dist) * 0.7f;
            var c = Color.Lerp(lit, horizon, haze);
            c.a = 1;
            return QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c;
        }

        static GameObject BackdropMeshObject(string dir, string name, Transform parent, List<Vector3> v, List<Color> c, List<int> t)
        {
            var mesh = new Mesh { name = name, indexFormat = v.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(v);
            mesh.SetColors(c);
            mesh.SetTriangles(t, 0);
            mesh.RecalculateBounds();
            SaveAsset(mesh, $"{dir}/{name}.asset");
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.isStatic = true;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = BackdropMaterial(dir, $"M_{name}", Color.white, true);
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
            mr.lightProbeUsage = LightProbeUsage.Off;
            mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return go;
        }

        /// <summary>按三角形算顶点法线，把光照与空气透视烘进顶点色（远景不受光、不受雾）</summary>
        static void ShadeVertices(List<Vector3> v, List<Color> col, List<int> t, Vector2 center, Vector3 toSun, Color horizon, float hazeStart, float hazeEnd)
        {
            var nrm = new Vector3[v.Count];
            for (int i = 0; i < t.Count; i += 3)
            {
                var n = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]);
                if (n.y < 0) n = -n;
                nrm[t[i]] += n;
                nrm[t[i + 1]] += n;
                nrm[t[i + 2]] += n;
            }
            for (int i = 0; i < v.Count; i++)
            {
                var n = nrm[i].sqrMagnitude > 1e-8f ? nrm[i].normalized : Vector3.up;
                float d = Vector2.Distance(new Vector2(v[i].x, v[i].z), center);
                col[i] = Shade(col[i], n, toSun, d, horizon, hazeStart, hazeEnd);
            }
        }

        /// <summary>
        /// 远山：网页 peak()（径向网格，ridges 条主山脊把圆锥切成金字塔）+ ring()（一圈连续的远山，北、东是雪山，南、西是绿丘）。
        /// center = 环心（Unity XZ），baseY = 山脚世界 y；ringR0 / ringR1 = 远山环内外半径（要在相机远裁面 1500 m 以内）；
        /// window(x, z) = 远山环在这里压低多少（0..1，Unity XZ，留出贡嘎的缺口）。网页的方位角按 z 向南算，这里 z 取反
        /// </summary>
        public static GameObject PlateauMountains(string dir, string name, Transform parent, Vector2 center, float baseY, IReadOnlyList<PlateauPeak> peaks,
            float ringR0, float ringR1, Func<float, float, float> window, Vector3 toSun, Color horizon)
        {
            var root = new GameObject("Mountains · 远山");
            root.transform.SetParent(parent, false);
            root.isStatic = true;
            toSun = toSun.normalized;
            int index = 0;
            foreach (var o in peaks)
            {
                const int rings = 34, segs = 72;
                var v = new List<Vector3>();
                var col = new List<Color>();
                var t = new List<int>();
                float HAt(float tt, float a)
                {
                    float ridge = Mathf.Pow(Mathf.Abs(Mathf.Cos(a * o.ridges / 2 + o.seed)), 0.6f);
                    float k = Mathf.Min(1, tt * 4);
                    float prof = Mathf.Pow(Mathf.Max(0, 1 - tt), o.sharp) * (1 - 0.28f * (1 - ridge) * k);
                    float nx = Mathf.Cos(a) * tt * 3 + o.seed, nz = Mathf.Sin(a) * tt * 3 - o.seed;
                    return o.height * prof * (1 + (0.28f * (float)PlateauNoise.Ridged(nx, nz, 4, (int)o.seed) - 0.14f) * k);
                }
                for (int r = 0; r <= rings; r++)
                {
                    float tt = r / (float)rings;
                    for (int s = 0; s < segs; s++)
                    {
                        float a = s / (float)segs * Mathf.PI * 2;
                        float y = HAt(tt, a);
                        v.Add(new Vector3(o.at.x + Mathf.Cos(a) * o.radius * tt, baseY - 60 + y, o.at.y - Mathf.Sin(a) * o.radius * tt));
                        float y2 = HAt(Mathf.Min(1, tt + 1f / rings), a);
                        float slope = Mathf.Atan(Mathf.Abs(y - y2) / (o.radius / rings));
                        col.Add(PeakColor(y, slope, o.height * o.snow, o.green, (float)PlateauNoise.Fbm(Mathf.Cos(a) * 4 * tt + o.seed, Mathf.Sin(a) * 4 * tt, 2, 3)));
                    }
                }
                for (int r = 0; r < rings; r++)
                for (int s = 0; s < segs; s++)
                {
                    int a = r * segs + s, b = r * segs + (s + 1) % segs, cc = (r + 1) * segs + (s + 1) % segs, d = (r + 1) * segs + s;
                    t.AddRange(new[] { a, d, b, b, d, cc });
                }
                ShadeVertices(v, col, t, center, toSun, horizon, 700, 1600);
                BackdropMeshObject(dir, $"{name}_Peak{index++}", root.transform, v, col, t);
            }
            {
                const int segs = 360, rows = 10;
                var v = new List<Vector3>();
                var col = new List<Color>();
                var t = new List<int>();
                float Radius(float tt) => ringR0 + (ringR1 - ringR0) * Mathf.Pow(tt, 1.25f);
                (float y, float snowy) HAt(float a, float tt)
                {
                    float north = Mathf.Max(0, -Mathf.Sin(a)), east = Mathf.Max(0, Mathf.Cos(a));
                    float snowy = Mathf.Min(1, north * 1.2f + east * 0.5f);
                    float R = Radius(tt);
                    float amp = (90 + 260 * snowy) * (1 - 0.8f * window(center.x + Mathf.Cos(a) * R, center.y - Mathf.Sin(a) * R));
                    float n = (float)PlateauNoise.Ridged(Mathf.Cos(a) * 6 + tt * 2, Mathf.Sin(a) * 6 + tt * 2, 5, 21);
                    float swell = Mathf.Sin(tt * Mathf.PI) * 0.6f + tt * 0.5f;
                    return (amp * n * swell + 20 * (float)PlateauNoise.Fbm(a * 9, tt * 5, 3, 22), snowy);
                }
                for (int r = 0; r <= rows; r++)
                {
                    float tt = r / (float)rows;
                    float R = Radius(tt);
                    for (int s = 0; s < segs; s++)
                    {
                        float a = s / (float)segs * Mathf.PI * 2;
                        var (y, snowy) = HAt(a, tt);
                        v.Add(new Vector3(center.x + Mathf.Cos(a) * R, baseY - 50 + y, center.y - Mathf.Sin(a) * R));
                        float slope = Mathf.Abs(y - HAt(a + 0.02f, tt).y) / (R * 0.02f);
                        col.Add(PeakColor(y, Mathf.Atan(slope), snowy > 0.3f ? 210 : 520, 1 - snowy * 0.6f, (float)PlateauNoise.Fbm(a * 7, tt * 3, 2, 23)));
                    }
                }
                for (int r = 0; r < rows; r++)
                for (int s = 0; s < segs; s++)
                {
                    int a = r * segs + s, b = r * segs + (s + 1) % segs, cc = (r + 1) * segs + (s + 1) % segs, d = (r + 1) * segs + s;
                    t.AddRange(new[] { a, b, d, b, cc, d });
                }
                ShadeVertices(v, col, t, center, toSun, horizon, 600, 1500);
                BackdropMeshObject(dir, $"{name}_Ring", root.transform, v, col, t);
            }
            return root;
        }

        /// <summary>
        /// 外围地形（网页 buildFarTerrain）：把地形矩形四周到远山之间接起来——从地形边缘的高度起，往外 260 m 过渡到起伏的远丘；
        /// window 里压低（不挡贡嘎、垭口望贡嘎的方向）。edge(x, z) = 地形边缘（夹到矩形里的点）的世界 y，edgeColor = 那里的地表色。全部 Unity XZ（+z = 北）
        /// </summary>
        public static GameObject PlateauFarTerrain(string dir, string name, Transform parent, Rect terrain, Func<float, float, float> edge, Func<float, float, Color> edgeColor,
            Func<float, float, float> window, Vector3 toSun, Color horizon, float R = 1400, float cell = 14)
        {
            int n = Mathf.RoundToInt(2 * R / cell) + 1;
            var c0 = terrain.center;
            var pos = new Vector3[n * n];
            var inside = new bool[n * n];
            for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++)
            {
                float x = c0.x - R + i * cell, z = c0.y - R + j * cell;
                int k = j * n + i;
                float cx = Mathf.Clamp(x, terrain.xMin, terrain.xMax), cz = Mathf.Clamp(z, terrain.yMin, terrain.yMax);
                float d = Vector2.Distance(new Vector2(x, z), new Vector2(cx, cz));
                float y;
                if (d < 1e-4f)
                {
                    y = edge(x, z) - 6;
                    inside[k] = true;
                }
                else
                {
                    float e = edge(cx, cz);
                    float north = (float)PlateauNoise.Smooth(-100, 700, z), east = (float)PlateauNoise.Smooth(100, 800, x);
                    float amp = (60 + 170 * Mathf.Max(north, east * 0.7f)) * (1 - 0.85f * window(x, z));
                    float hills = 10 + amp * (float)PlateauNoise.Ridged(x * 0.0032, -z * 0.0032, 5, 41) + 25 * (float)PlateauNoise.Fbm(x * 0.01, -z * 0.01, 3, 42);
                    float tt = (float)PlateauNoise.Smooth(0, 260, d);
                    y = e + (hills - e) * tt + ((float)PlateauNoise.Ridged(x * 0.02, -z * 0.02, 3, 43) - 0.4f) * 10 * Mathf.Min(1, d / 80);
                }
                pos[k] = new Vector3(x, y, z);
            }
            var v = new List<Vector3>(pos);
            var col = new List<Color>(n * n);
            for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++)
            {
                int k = j * n + i;
                var p = pos[k];
                float yr = i < n - 1 ? pos[k + 1].y : p.y, yd = j < n - 1 ? pos[k + n].y : p.y;
                float slope = Mathf.Atan(Mathf.Sqrt((yr - p.y) * (yr - p.y) + (yd - p.y) * (yd - p.y)) / cell);
                float north = (float)PlateauNoise.Smooth(-100, 700, p.z);
                float nz = (float)PlateauNoise.Fbm(p.x * 0.004, -p.z * 0.004, 2, 44);
                var c = Color.Lerp(nz > 0.5f ? PkHill : PkHillFar, PkRock, (float)PlateauNoise.Smooth(0.55, 0.85, slope) * 0.85f);
                float line = 52 + 110 * (1 - north) + ((float)PlateauNoise.Fbm(p.x * 0.006, -p.z * 0.006, 3, 45) - 0.5f) * 50;
                float snow = (float)PlateauNoise.Smooth(line - 8, line + 12, p.y) * (1 - (float)PlateauNoise.Smooth(0.9, 1.2, slope) * 0.6f);
                c = Color.Lerp(c, slope > 0.7f ? PkSnowShade : PkSnow, snow);
                float cx = Mathf.Clamp(p.x, terrain.xMin, terrain.xMax), cz = Mathf.Clamp(p.z, terrain.yMin, terrain.yMax);
                float d = Vector2.Distance(new Vector2(p.x, p.z), new Vector2(cx, cz));
                if (d < 90) c = Color.Lerp(c, edgeColor(cx, cz), 1 - (float)PlateauNoise.Smooth(10, 90, d));
                col.Add(c);
            }
            var t = new List<int>();
            for (int j = 0; j < n - 1; j++)
            for (int i = 0; i < n - 1; i++)
            {
                int a = j * n + i, b = a + 1, cc = a + n + 1, d = a + n;
                if (inside[a] && inside[b] && inside[cc] && inside[d]) continue;
                t.AddRange(new[] { a, d, cc, a, cc, b });
            }
            ShadeVertices(v, col, t, c0, toSun.normalized, horizon, 400, 1400);
            return BackdropMeshObject(dir, $"{name}_FarTerrain", parent, v, col, t);
        }

        // ───────────────────────────── 草与灌丛（Terrain 细节）─────────────────────────────

        /// <summary>
        /// 高原草丛的细节原型：blades 片细长叶子从一点往外张开（双面），哑光材质、GPU instancing（网页的草丛同样是 5 片叶的程序化网格）。
        /// 写在 <see cref="ScatterDir"/>，原地更新
        /// </summary>
        public static GameObject PlateauGrassPrefab(string name, Color color, int blades, float height, float width, int seed)
        {
            Directory.CreateDirectory(ScatterDir);
            var g = new System.Random(seed);
            var v = new List<Vector3>();
            var nrm = new List<Vector3>();
            var tri = new List<int>();
            for (int i = 0; i < blades; i++)
            {
                float a = (i + (float)g.NextDouble() * 0.6f) / blades * Mathf.PI * 2;
                float lean = 0.15f + 0.3f * (float)g.NextDouble();
                float hgt = height * (0.6f + 0.4f * (float)g.NextDouble());
                float w = width * (0.8f + 0.5f * (float)g.NextDouble());
                var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var side = Vector3.Cross(dir, Vector3.up) * w;
                var root = dir * 0.06f * (float)g.NextDouble();
                var tip = root + dir * hgt * lean + Vector3.up * hgt;
                int o = v.Count;
                v.AddRange(new[] { root - side, root + side, tip, root - side, root + side, tip });
                nrm.AddRange(new[] { Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up });
                tri.AddRange(new[] { o, o + 2, o + 1, o + 3, o + 4, o + 5 });
            }
            var mesh = new Mesh { name = $"SC_{name}" };
            mesh.SetVertices(v);
            mesh.SetNormals(nrm);
            mesh.SetTriangles(tri, 0);
            mesh.RecalculateBounds();
            mesh = Upsert(mesh, $"{ScatterDir}/SC_{name}_Mesh.asset");
            return DetailPrefab(name, mesh, color, 0.95f);
        }

        /// <summary>野花的细节原型：短茎顶着几朵五瓣平展的小花（低矮、贴地，远看是一片色点；网页的野花同样是小片）</summary>
        public static GameObject PlateauFlowerPrefab(string name, Color color, int seed)
        {
            Directory.CreateDirectory(ScatterDir);
            var g = new System.Random(seed);
            var v = new List<Vector3>();
            var tri = new List<int>();
            for (int f = 0; f < 3; f++)
            {
                float a0 = (float)g.NextDouble() * Mathf.PI * 2, d = f == 0 ? 0 : 0.12f + 0.06f * (float)g.NextDouble();
                var c = new Vector3(Mathf.Cos(a0) * d, 0.16f + 0.08f * (float)g.NextDouble(), Mathf.Sin(a0) * d);
                for (int k = 0; k < 5; k++)
                {
                    float a = a0 + k * Mathf.PI * 2 / 5;
                    var dir = new Vector3(Mathf.Cos(a), 0.25f, Mathf.Sin(a));
                    var side = Vector3.Cross(dir, Vector3.up).normalized * 0.035f;
                    int o = v.Count;
                    v.AddRange(new[] { c, c + dir * 0.09f + side, c + dir * 0.09f - side });
                    tri.AddRange(new[] { o, o + 1, o + 2, o, o + 2, o + 1 });
                }
            }
            var mesh = new Mesh { name = $"SC_{name}" };
            mesh.SetVertices(v);
            mesh.SetNormals(v.Select(_ => Vector3.up).ToList());
            mesh.SetTriangles(tri, 0);
            mesh.RecalculateBounds();
            mesh = Upsert(mesh, $"{ScatterDir}/SC_{name}_Mesh.asset");
            return DetailPrefab(name, mesh, color, 0.8f);
        }

        /// <summary>灌丛（高山杜鹃）的细节原型：几团压扁的低模球，叶绿或花粉</summary>
        public static GameObject PlateauBushPrefab(string name, Color color, int seed)
        {
            Directory.CreateDirectory(ScatterDir);
            var wb = new PlateauWhitebox(ScatterDir) { mirrorX = false };
            var g = new System.Random(seed);
            wb.Ellipsoid("green", new Vector3(0, 0.28f, 0), new Vector3(0.55f, 0.36f, 0.5f), 8);
            for (int i = 0; i < 3; i++)
            {
                float a = i * 2.1f + (float)g.NextDouble(), d = 0.35f + 0.15f * (float)g.NextDouble();
                wb.Ellipsoid("green", new Vector3(Mathf.Cos(a) * d, 0.2f, Mathf.Sin(a) * d), new Vector3(0.36f, 0.26f, 0.34f), 6);
            }
            var mesh = wb.ToMesh($"SC_{name}", out _);
            if (mesh.subMeshCount > 1)
            {
                var all = new List<int>();
                for (int s = 0; s < mesh.subMeshCount; s++) all.AddRange(mesh.GetTriangles(s));
                mesh.subMeshCount = 1;
                mesh.SetTriangles(all, 0);
            }
            mesh = Upsert(mesh, $"{ScatterDir}/SC_{name}_Mesh.asset");
            return DetailPrefab(name, mesh, color, 0.9f);
        }

        static GameObject DetailPrefab(string name, Mesh mesh, Color color, float roughness)
        {
            var mat = new Material(Shader.Find("Spiritfire/StylizedLit")) { name = $"M_SC_{name}", enableInstancing = true };
            mat.SetColor("_BaseColor", color);
            mat.SetFloat("_Metallic", 0);
            mat.SetFloat("_Roughness", roughness);
            mat.SetFloat("_RimStrength", 0.05f);
            mat = Upsert(mat, $"{ScatterDir}/M_SC_{name}.mat");
            var go = new GameObject($"SC_{name}");
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, $"{ScatterDir}/SC_{name}.prefab");
            Object.DestroyImmediate(go);
            return prefab;
        }

        /// <summary>一层细节：原型 Prefab + 每 100 m² 满密度个数 + 密度函数（世界 XZ → 0..1）+ 缩放范围</summary>
        public sealed class PlateauDetailLayer
        {
            public string name;
            public GameObject prefab;
            public float perHundredSqm;
            public Func<Vector2, float> density;
            public Vector2 scale = new(0.8f, 1.2f);
            public float alignToGround = 0.6f;
            public int seed = 1;
        }

        /// <summary>
        /// 细节散布（同 <see cref="ScatterDetails"/> 的做法：每块地形按约 cell 米一格求期望个数，小数部分用格子哈希抛硬币，跨地块连续），
        /// 原型直接给 Prefab（第四章的草丛、杜鹃不是美术资产）。返回每层总数
        /// </summary>
        public static Dictionary<string, int> PlateauDetails(TerrainSet set, IReadOnlyList<PlateauDetailLayer> layers, float cell, float viewDistance)
        {
            var counts = layers.ToDictionary(l => l.name, _ => 0);
            var protos = layers.Select(l =>
            {
                var p = new DetailPrototype
                {
                    usePrototypeMesh = true, prototype = l.prefab, useInstancing = true, renderMode = DetailRenderMode.VertexLit,
                    minWidth = l.scale.x, maxWidth = l.scale.y, minHeight = l.scale.x, maxHeight = l.scale.y, noiseSpread = 0.35f, noiseSeed = l.seed,
                    alignToGround = l.alignToGround, positionJitter = 1, useDensityScaling = true, healthyColor = Color.white, dryColor = Color.white,
                };
                if (!p.Validate(out string err)) Debug.LogWarning($"[Level] 细节 {l.name} 的原型无效：{err}");
                return p;
            }).ToArray();
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
                int bx = Mathf.RoundToInt((o.x - set.spec.origin.x) / cx), bz = Mathf.RoundToInt((o.y - set.spec.origin.y) / cz);
                var grids = new int[layers.Count][,];
                for (int r = 0; r < layers.Count; r++) grids[r] = new int[n, n];
                Parallel.For(0, n, z =>
                {
                    for (int x = 0; x < n; x++)
                    {
                        var p = o + new Vector2((x + 0.5f) * cx, (z + 0.5f) * cz);
                        for (int r = 0; r < layers.Count; r++)
                        {
                            var l = layers[r];
                            float expect = Mathf.Clamp01(l.density(p)) * l.perHundredSqm * 0.01f * area;
                            if (expect <= 0) continue;
                            int k = Mathf.FloorToInt(expect);
                            if (Landform.Hash(bx + x, bz + z, l.seed * 7919 + r) < expect - k) k++;
                            grids[r][z, x] = Mathf.Min(k, maxPer);
                        }
                    }
                });
                for (int r = 0; r < layers.Count; r++)
                {
                    td.SetDetailLayer(0, 0, r, grids[r]);
                    int sum = 0;
                    foreach (int c in grids[r]) sum += c;
                    counts[layers[r].name] += sum;
                }
                t.detailObjectDistance = Mathf.Min(250, viewDistance);
                t.detailObjectDensity = 1;
                t.drawTreesAndFoliage = true;
                EditorUtility.SetDirty(td);
            }
            AssetDatabase.SaveAssets();
            return counts;
        }
    }
}
