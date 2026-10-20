using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃的网格与贴图生成（同 Three.js BladeModel.ts 的几何部分）。运行时与编辑器烘焙（P/Editor/BladeMeshBaker）共用这一份：
    /// 烘焙器把结果存成资产 + Prefab（Art/Weapons/SK_Weapon_DemonBlade、Art/Prefabs/Weapons/SK_Weapon_DemonBlade.prefab）；
    /// 资产还没烘时 <see cref="BladeAssets"/> 在运行时现场生成同样的东西（刀柄贴图退回程序色）。
    ///   · 碎片：128 片 Voronoi 单元各建成带倒角的厚片（顶面扇形、亮倒角环、暗侧壁）+ 一片贴在中面的发光「芯」（片缝里透出的紫光，跟着碎片走），
    ///     合成一个蒙皮网格：第 i 片的顶点只绑骨骼 i，bindpose = 平移(−片心)，所以骨骼的位置 / 朝向 / 缩放就是这片碎刃的变换
    ///     （等价 TS ShardBuffer 的每片变换；手里的刀和世界里的刃群用同一网格，碎片离刀后外形不变）。
    ///   · 着色：片面底色、亮度分层、刃口白热紫光、缝光不再用顶点色，改成一张小渐变贴图（u = 刀背 → 刃口，v = 部位）+ 同布局的自发光贴图，
    ///     材质就是项目的 Spiritfire/StylizedLit（不用自写着色器）。每片的色相 / 亮度抖动量化成 4 套（贴图横向 4 格）。
    ///   · 刀根（鬼面厚板）与刀柄（铜环、护手、柄头箍、缠柄、柄尾）：贴图集坐标与 TS HILT_ATLAS / demon_blade_textures.py 的 RECTS 一致；
    ///     睁眼贴图在闭眼右边 256 px，刀根材质把 _BaseMap_ST 的 u 偏移 0.25 就切到睁眼（<see cref="AwakeOffset"/>）。
    /// 坐标照搬 TS（刀身局部：+Y 刀尖、+X 刃口、Z 厚度），三角形顶点顺序也照搬，见 <see cref="BladeShape"/> 的手性说明。
    /// </summary>
    public static class BladeMeshes
    {
        /// <summary>右手握持点在刀身局部坐标中的 y（靠近护手）</summary>
        public const float GripY = -0.085f;
        /// <summary>刀柄各段：柄尾 3.7 cm、缠柄 23 cm、柄头箍 1 cm、护手 1.8 cm，刀根套 1.4 cm 包在刀身起点</summary>
        const float PommelY0 = -0.2955f, GripY0 = -0.2585f, FuchiY0 = -0.0276f, GuardY0 = -0.0176f, HabakiY1 = 0.014f;

        const float Atlas = 1024;
        static readonly Rect RootRect = new(0, 0, 256, 576), GripRect = new(0, 576, 1024, 144), PommelRect = new(0, 720, 128, 160), GuardRect = new(128, 720, 512, 96);
        /// <summary>睁眼刀根在贴图集里相对闭眼的横向偏移（256 / 1024）</summary>
        public const float AwakeOffset = 0.25f;
        /// <summary>刀根鬼面的眼睛（刀根贴图坐标：横向 u、长度 v）</summary>
        public const float EyeU = 0.41f, EyeV = 0.244f;

        public static readonly Color Purple = Hex.Rgb(0x9a5cff);
        public static readonly Color EdgeGlow = Hex.Rgb(0xeadcff);
        public static readonly Color SeamGlow = Hex.Rgb(0x8a4cff);
        public static readonly Color ShardSpark = Hex.Rgb(0xd8c2ff);

        // ───────────── 渐变贴图布局 ─────────────

        /// <summary>每片的色相 / 亮度抖动量化成的套数（贴图横向等分）</summary>
        public const int RampTiles = 4;
        const int TileW = 32, RampH = 64;
        /// <summary>v 方向的部位：顶面中心 / 顶面 / 倒角内圈 / 倒角外圈 / 侧壁 / 发光芯</summary>
        const float VCenter = 0.05f, VTop = 0.15f, VBevelIn = 0.35f, VBevelOut = 0.45f, VSide = 0.625f, VCore = 0.875f;
        /// <summary>自发光贴图存的是实际值 ÷ 这个数（8 位贴图装不下 &gt; 1 的刃口白光）；材质的 _EmissionColor 乘回来</summary>
        public const float EmissionScale = 2f;
        /// <summary>4 套抖动：(亮度, 偏紫程度)，对应 TS 每片 jitter 0.93–1.07、hue 0–0.16 的四个象限</summary>
        static readonly Vector2[] Tiles = { new(0.965f, 0.04f), new(1.035f, 0.04f), new(0.965f, 0.12f), new(1.035f, 0.12f) };

        static Vector2 RampUv(int tile, double across, float v) => new((tile + 0.04f + 0.92f * (float)Clamp01(across)) / RampTiles, v);

        static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

        static Vector2 RectUv(Rect r, double s, double t) => new((float)((r.x + s * r.width) / Atlas), (float)(1 - (r.y + t * r.height) / Atlas));

        // ───────────── 碎片 ─────────────

        /// <summary>多边形内缩 d（逆时针；斜接，限制尖角处的位移）</summary>
        static double[] Inset(double[] p, double d)
        {
            int n = p.Length / 2;
            var output = new double[p.Length];
            for (int i = 0; i < n; i++)
            {
                int pi = (i + n - 1) % n, ni = (i + 1) % n;
                double ax = p[2 * i] - p[2 * pi], ay = p[2 * i + 1] - p[2 * pi + 1];
                double bx = p[2 * ni] - p[2 * i], by = p[2 * ni + 1] - p[2 * i + 1];
                double la = Math.Sqrt(ax * ax + ay * ay), lb = Math.Sqrt(bx * bx + by * by);
                if (la == 0) la = 1;
                if (lb == 0) lb = 1;
                ax /= la;
                ay /= la;
                bx /= lb;
                by /= lb;
                // 逆时针的内法线 = 左法线 (−dy, dx)
                double nx = -ay - by, ny = ax + bx;
                double nl = Math.Sqrt(nx * nx + ny * ny);
                if (nl == 0) nl = 1;
                double cosHalf = Math.Max(0.35, nx / nl * -ay + ny / nl * ax);
                double k = d / cosHalf;
                output[2 * i] = p[2 * i] + nx / nl * k;
                output[2 * i + 1] = p[2 * i + 1] + ny / nl * k;
            }
            return output;
        }

        /// <summary>质心到各边所在直线的最小距离（近似内切半径）</summary>
        static double Inradius(double[] p, double cx, double cy)
        {
            double m = double.PositiveInfinity;
            int n = p.Length / 2;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                double ex = p[2 * j] - p[2 * i], ey = p[2 * j + 1] - p[2 * i + 1];
                double l = Math.Sqrt(ex * ex + ey * ey);
                if (l < 1e-9) continue;
                m = Math.Min(m, Math.Abs((cx - p[2 * i]) * ey - (cy - p[2 * i + 1]) * ex) / l);
            }
            return double.IsInfinity(m) ? 0 : m;
        }

        /// <summary>
        /// 第 i 片属于哪一套抖动（同 TS bladeShardGeometry 的 Park–Miller 序列，种子 7：每片先取 jitter 再取 hue）
        /// </summary>
        public static int[] ShardTiles()
        {
            var tiles = new int[BladeShape.ShardCount];
            long seed = 7;
            double Rnd()
            {
                seed = seed * 16807 % 2147483647;
                return seed / 2147483647.0;
            }
            for (int i = 0; i < tiles.Length; i++)
            {
                double jitter = 0.93 + Rnd() * 0.14;
                double hue = Rnd() * 0.16;
                tiles[i] = (jitter > 1 ? 1 : 0) + (hue > 0.08 ? 2 : 0);
            }
            return tiles;
        }

        /// <summary>
        /// 128 片碎刃的蒙皮网格（顶点在刀身局部坐标；第 i 片绑骨骼 i，bindpose = 平移(−片心)）。
        /// 骨骼 i 放在片心、单位缩放、无旋转时就是整把刀；缩放 0 = 这片不显示。
        /// </summary>
        public static Mesh BuildShards()
        {
            var cells = BladeShape.Cells;
            var tiles = ShardTiles();
            var pos = new List<Vector3>(24000);
            var uv = new List<Vector2>(24000);
            var weights = new List<BoneWeight>(24000);
            var binds = new Matrix4x4[cells.Count];
            foreach (var cell in cells)
            {
                int bone = cell.index, tile = tiles[cell.index];
                binds[bone] = Matrix4x4.Translate(new Vector3((float)-cell.cx, (float)-cell.cy, 0));
                double size = Math.Sqrt(Math.Abs(cell.area));
                // 内缩量按内切半径限制：贴边的细长小片不会内缩过头而翻面
                double ir = Inradius(cell.poly, cell.cx, cell.cy);
                var outer = Inset(cell.poly, Math.Min(0.00075, ir * 0.2));
                var inner = Inset(outer, Math.Min(0.0022, Math.Min(size * 0.12, ir * 0.35)));
                int n = outer.Length / 2;
                double Tz(double x, double y) => BladeShape.ThicknessAt(x, y) / 2;
                double Bevel(double x, double y) => Math.Min(0.0013, BladeShape.ThicknessAt(x, y) * 0.32);
                void Push(double x, double y, double z, float v)
                {
                    pos.Add(new Vector3((float)x, (float)y, (float)z));
                    uv.Add(RampUv(tile, BladeShape.AcrossOf(x, y), v));
                    weights.Add(new BoneWeight { boneIndex0 = bone, weight0 = 1 });
                }
                foreach (int side in new[] { 1, -1 })
                {
                    // 顶面（扇形，以片心为中心）
                    double czc = Tz(cell.cx, cell.cy) * side;
                    for (int i = 0; i < n; i++)
                    {
                        int j = (i + 1) % n;
                        int i0 = side > 0 ? i : j, j0 = side > 0 ? j : i;
                        Push(cell.cx, cell.cy, czc, VCenter);
                        Push(inner[2 * i0], inner[2 * i0 + 1], Tz(inner[2 * i0], inner[2 * i0 + 1]) * side, VTop);
                        Push(inner[2 * j0], inner[2 * j0 + 1], Tz(inner[2 * j0], inner[2 * j0 + 1]) * side, VTop);
                    }
                    // 倒角环（亮边）
                    for (int i = 0; i < n; i++)
                    {
                        int j = (i + 1) % n;
                        int i0 = side > 0 ? i : j, j0 = side > 0 ? j : i;
                        double ix0 = inner[2 * i0], iy0 = inner[2 * i0 + 1], ix1 = inner[2 * j0], iy1 = inner[2 * j0 + 1];
                        double ox0 = outer[2 * i0], oy0 = outer[2 * i0 + 1], ox1 = outer[2 * j0], oy1 = outer[2 * j0 + 1];
                        double zi0 = Tz(ix0, iy0) * side, zi1 = Tz(ix1, iy1) * side;
                        double zo0 = (Tz(ox0, oy0) - Bevel(ox0, oy0)) * side, zo1 = (Tz(ox1, oy1) - Bevel(ox1, oy1)) * side;
                        Push(ix0, iy0, zi0, VBevelIn);
                        Push(ox0, oy0, zo0, VBevelOut);
                        Push(ox1, oy1, zo1, VBevelOut);
                        Push(ix0, iy0, zi0, VBevelIn);
                        Push(ox1, oy1, zo1, VBevelOut);
                        Push(ix1, iy1, zi1, VBevelIn);
                    }
                }
                // 侧壁（暗，带缝光）
                for (int i = 0; i < n; i++)
                {
                    int j = (i + 1) % n;
                    double x0 = outer[2 * i], y0 = outer[2 * i + 1], x1 = outer[2 * j], y1 = outer[2 * j + 1];
                    double z0 = Tz(x0, y0) - Bevel(x0, y0), z1 = Tz(x1, y1) - Bevel(x1, y1);
                    Push(x0, y0, -z0, VSide);
                    Push(x1, y1, -z1, VSide);
                    Push(x1, y1, z1, VSide);
                    Push(x0, y0, -z0, VSide);
                    Push(x1, y1, z1, VSide);
                    Push(x0, y0, z0, VSide);
                }
                // 发光芯：原多边形（不内缩）贴在中面，两面各一层——片缝里透出的紫光（TS 的刀芯），跟着碎片一起离刀
                var p = cell.poly;
                int m = p.Length / 2;
                foreach (int side in new[] { 1, -1 })
                    for (int i = 0; i < m; i++)
                    {
                        int j = (i + 1) % m;
                        int i0 = side > 0 ? i : j, j0 = side > 0 ? j : i;
                        double z = 0.0001 * side;
                        Push(cell.cx, cell.cy, z, VCore);
                        Push(p[2 * i0], p[2 * i0 + 1], z, VCore);
                        Push(p[2 * j0], p[2 * j0 + 1], z, VCore);
                    }
            }
            var mesh = new Mesh { name = "SM_DemonBlade_Shards" };
            if (pos.Count > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(pos);
            mesh.SetUVs(0, uv);
            var idx = new int[pos.Count];
            for (int i = 0; i < idx.Length; i++) idx[i] = i;
            mesh.SetTriangles(idx, 0);
            mesh.boneWeights = weights.ToArray();
            mesh.bindposes = binds;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        // ───────────── 刀根 / 刀柄 ─────────────

        sealed class MeshData
        {
            public readonly List<Vector3> pos = new();
            public readonly List<Vector2> uv = new();

            public void Tri(Vector3 a, Vector2 ua, Vector3 b, Vector2 ub, Vector3 c, Vector2 uc)
            {
                pos.Add(a);
                pos.Add(b);
                pos.Add(c);
                uv.Add(ua);
                uv.Add(ub);
                uv.Add(uc);
            }

            public Mesh Finish(string name)
            {
                var mesh = new Mesh { name = name };
                mesh.SetVertices(pos);
                mesh.SetUVs(0, uv);
                var idx = new int[pos.Count];
                for (int i = 0; i < idx.Length; i++) idx[i] = i;
                mesh.SetTriangles(idx, 0);
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                return mesh;
            }
        }

        /// <summary>简单多边形（逆时针）的耳切三角化：返回顶点下标三元组（同 THREE.ShapeUtils.triangulateShape 的用途）</summary>
        public static List<int> Triangulate(IReadOnlyList<double> p)
        {
            int n = p.Count / 2;
            var result = new List<int>((n - 2) * 3);
            var idx = new List<int>(n);
            for (int i = 0; i < n; i++) idx.Add(i);
            bool ccw = BladeShape.PolyArea(p) >= 0;
            double X(int i) => p[2 * i];
            double Y(int i) => p[2 * i + 1];
            double Cross(int a, int b, int c) => (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a));
            bool Inside(int a, int b, int c, int q)
            {
                double c1 = Cross(a, b, q), c2 = Cross(b, c, q), c3 = Cross(c, a, q);
                return ccw ? c1 >= 0 && c2 >= 0 && c3 >= 0 : c1 <= 0 && c2 <= 0 && c3 <= 0;
            }
            for (int guard = 0; idx.Count > 3 && guard < n * n; guard++)
            {
                bool clipped = false;
                for (int k = 0; k < idx.Count; k++)
                {
                    int a = idx[(k + idx.Count - 1) % idx.Count], b = idx[k], c = idx[(k + 1) % idx.Count];
                    double cr = Cross(a, b, c);
                    if (ccw ? cr <= 1e-14 : cr >= -1e-14) continue;
                    bool ear = true;
                    foreach (int q in idx)
                    {
                        if (q == a || q == b || q == c) continue;
                        if (Inside(a, b, c, q))
                        {
                            ear = false;
                            break;
                        }
                    }
                    if (!ear) continue;
                    result.Add(a);
                    result.Add(b);
                    result.Add(c);
                    idx.RemoveAt(k);
                    clipped = true;
                    break;
                }
                // 剩下的是退化 / 共线点：按扇形收尾，不死循环
                if (!clipped) break;
            }
            for (int k = 1; k + 1 < idx.Count; k++)
            {
                result.Add(idx[0]);
                result.Add(idx[k]);
                result.Add(idx[k + 1]);
            }
            return result;
        }

        /// <summary>刀根厚板：两面鬼面贴图（u = 横向、v = 长度），侧壁取刀根贴图的暗处</summary>
        public static Mesh BuildRoot()
        {
            var p = BladeShape.RootPolygon();
            var tris = Triangulate(p);
            var d = new MeshData();
            Vector3 P(int k, int side)
            {
                double x = p[2 * k], y = p[2 * k + 1];
                return new Vector3((float)x, (float)y, (float)((BladeShape.ThicknessAt(x, y) / 2 + 0.0004) * side));
            }
            Vector2 U(int k)
            {
                double x = p[2 * k], y = p[2 * k + 1];
                return RectUv(RootRect, BladeShape.AcrossOf(x, y), Math.Min(1, y / BladeShape.RootTexLen));
            }
            for (int t = 0; t < tris.Count; t += 3)
            {
                int a = tris[t], b = tris[t + 1], c = tris[t + 2];
                // 正面（+Z）要逆时针
                if ((p[2 * b] - p[2 * a]) * (p[2 * c + 1] - p[2 * a + 1]) - (p[2 * b + 1] - p[2 * a + 1]) * (p[2 * c] - p[2 * a]) < 0) (b, c) = (c, b);
                d.Tri(P(a, 1), U(a), P(b, 1), U(b), P(c, 1), U(c));
                d.Tri(P(a, -1), U(a), P(c, -1), U(c), P(b, -1), U(b));
            }
            var dark = RectUv(RootRect, 0.08, 0.5);
            int n = p.Length / 2;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                double ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
                float za = (float)(BladeShape.ThicknessAt(ax, ay) / 2 + 0.0004), zb = (float)(BladeShape.ThicknessAt(bx, by) / 2 + 0.0004);
                var a0 = new Vector3((float)ax, (float)ay, -za);
                var a1 = new Vector3((float)ax, (float)ay, za);
                var b0 = new Vector3((float)bx, (float)by, -zb);
                var b1 = new Vector3((float)bx, (float)by, zb);
                d.Tri(a0, dark, b0, dark, b1, dark);
                d.Tri(a0, dark, b1, dark, a1, dark);
            }
            return d.Finish("SM_DemonBlade_Root");
        }

        /// <summary>
        /// 沿 Y 拉伸的凸截面柱体（截面在 XZ 平面）。capUv(x, z) 给端面贴图坐标；sideUv(周长比例, 高度比例) 给侧面贴图坐标
        /// </summary>
        static void Prism(MeshData d, List<Vector2> outline, float y0, float y1, Func<float, float, Vector2> capUv, Func<float, float, Vector2> sideUv)
        {
            int n = outline.Count;
            float perim = 0;
            var acc = new List<float> { 0 };
            for (int i = 0; i < n; i++)
            {
                perim += Vector2.Distance(outline[i], outline[(i + 1) % n]);
                acc.Add(perim);
            }
            for (int i = 0; i < n; i++)
            {
                Vector2 a = outline[i], b = outline[(i + 1) % n];
                float s0 = acc[i] / perim, s1 = acc[i + 1] / perim;
                d.Tri(new Vector3(a.x, y0, a.y), sideUv(s0, 0), new Vector3(b.x, y0, b.y), sideUv(s1, 0), new Vector3(b.x, y1, b.y), sideUv(s1, 1));
                d.Tri(new Vector3(a.x, y0, a.y), sideUv(s0, 0), new Vector3(b.x, y1, b.y), sideUv(s1, 1), new Vector3(a.x, y1, a.y), sideUv(s0, 1));
            }
            for (int i = 1; i < n - 1; i++)
            {
                Vector2 p0 = outline[0], p1 = outline[i], p2 = outline[i + 1];
                // 截面在 (x, z) 中为顺时针：顶面 (p0, p1, p2) 法线朝 +Y，底面反过来
                d.Tri(new Vector3(p0.x, y1, p0.y), capUv(p0.x, p0.y), new Vector3(p1.x, y1, p1.y), capUv(p1.x, p1.y), new Vector3(p2.x, y1, p2.y), capUv(p2.x, p2.y));
                d.Tri(new Vector3(p0.x, y0, p0.y), capUv(p0.x, p0.y), new Vector3(p2.x, y0, p2.y), capUv(p2.x, p2.y), new Vector3(p1.x, y0, p1.y), capUv(p1.x, p1.y));
            }
        }

        /// <summary>两端截面不同的柱体侧面（缠柄），端面被柄尾 / 柄头箍盖住，不生成</summary>
        static void PrismTaper(MeshData d, List<Vector2> a, List<Vector2> b, float y0, float y1, Func<float, float, Vector2> sideUv)
        {
            int n = a.Count;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                float s0 = (float)i / n, s1 = (float)(i + 1) / n;
                d.Tri(new Vector3(a[i].x, y0, a[i].y), sideUv(s0, 0), new Vector3(a[j].x, y0, a[j].y), sideUv(s1, 0), new Vector3(b[j].x, y1, b[j].y), sideUv(s1, 1));
                d.Tri(new Vector3(a[i].x, y0, a[i].y), sideUv(s0, 0), new Vector3(b[j].x, y1, b[j].y), sideUv(s1, 1), new Vector3(b[i].x, y1, b[i].y), sideUv(s0, 1));
            }
        }

        /// <summary>倒角矩形截面（x 半宽、z 半深、倒角 c、中心 cx）</summary>
        static List<Vector2> ChamferRect(float hx, float hz, float c, float cx = 0)
        {
            var l = new List<Vector2>
            {
                new(cx - hx + c, -hz), new(cx + hx - c, -hz), new(cx + hx, -hz + c), new(cx + hx, hz - c),
                new(cx + hx - c, hz), new(cx - hx + c, hz), new(cx - hx, hz - c), new(cx - hx, -hz + c),
            };
            l.Reverse();
            return l;
        }

        static List<Vector2> Ellipse(float rx, float rz, int n, float cx = 0)
        {
            var l = new List<Vector2>(n);
            for (int i = 0; i < n; i++)
            {
                float a = -(float)i / n * Mathf.PI * 2 + Mathf.PI / n;
                l.Add(new Vector2(cx + Mathf.Cos(a) * rx, Mathf.Sin(a) * rz));
            }
            return l;
        }

        static Vector2 RectUvF(Rect r, float s, float t) => RectUv(r, s, t);

        /// <summary>铜环、护手、柄头箍、缠柄、柄尾（一个网格，刀身局部坐标）</summary>
        public static Mesh BuildHilt()
        {
            var d = new MeshData();
            // 刀柄轴线 ≈ 刀身局部 x = 0（设计图里刀柄与刀根中线基本对齐）
            const float cx = 0.004f;
            Vector2 Side(float s, float h) => RectUvF(GuardRect, 0.12f + s * 0.76f, 0.2f + h * 0.6f);
            // 刀根套（包住刀身起点的一圈暗色金属）
            float hw = (float)(BladeShape.BladeWidth(0) / 2 + 0.0025), hc = (float)(BladeShape.SpineX(0) + BladeShape.BladeWidth(0) / 2);
            Prism(d, ChamferRect(hw, 0.0052f, 0.0015f, hc), 0, HabakiY1, (x, z) => RectUvF(GuardRect, 0.3f + x * 2, 0.5f + z * 6), Side);
            // 护手：大号倒角方板（约为刀宽的 1.8 倍），正面贴设计图的护手
            Prism(d, ChamferRect(0.047f, 0.019f, 0.007f, cx), GuardY0, 0,
                (x, z) => RectUvF(GuardRect, 0.5f + (x - cx) / 0.1f, 0.45f + z / 0.05f), (s, h) => RectUvF(GuardRect, s * 2 % 1, 0.15f + h * 0.7f));
            // 柄头箍
            Prism(d, ChamferRect(0.0205f, 0.0168f, 0.004f, cx), FuchiY0, GuardY0, (x, z) => RectUvF(GuardRect, 0.3f + x * 2, 0.5f + z * 6), Side);
            // 缠柄：十棱，长度方向 = 贴图横向，周向镜像两次；柄尾一端略粗
            PrismTaper(d, Ellipse(0.0215f, 0.0172f, 10, cx), Ellipse(0.0185f, 0.0152f, 10, cx), GripY0, FuchiY0,
                (s, h) => RectUvF(GripRect, 0.02f + h * 0.96f, Mathf.Abs(s * 2 % 2 - 1)));
            // 柄尾
            Prism(d, ChamferRect(0.0228f, 0.0185f, 0.004f, cx), PommelY0, GripY0,
                (x, z) => RectUvF(PommelRect, 0.5f + (x - cx) / 0.05f, 0.5f + z / 0.04f), (s, h) => RectUvF(PommelRect, s * 4 % 1, 1 - h));
            return d.Finish("SM_DemonBlade_Hilt");
        }

        /// <summary>鬼眼在刀身局部坐标中的位置（刀根贴图 (EyeU, EyeV) 处）</summary>
        public static Vector3 EyeLocal
        {
            get
            {
                double y = EyeV * BladeShape.RootTexLen;
                return new Vector3((float)(BladeShape.SpineX(y) + EyeU * BladeShape.BladeWidth(y)), (float)y, 0);
            }
        }

        /// <summary>刀尖（刀身局部）</summary>
        public static Vector3 TipLocal => new((float)BladeShape.SpineX(BladeShape.BladeLen), (float)BladeShape.BladeLen, 0);

        // ───────────── 贴图 ─────────────

        static Color Lin(int hex) => Hex.Rgb(hex).linear;

        /// <summary>片面底色（线性空间）：刀背蓝紫 → 片身淡紫银 → 刃口近白，再按 hue 偏向淡紫（同 TS shardColor）</summary>
        static Color ShardColor(float a, float jitter, float hue)
        {
            Color c = a < 0.55f
                ? Color.Lerp(Lin(0x6268d4), Lin(0xaaaaf0), a / 0.55f)
                : Color.Lerp(Lin(0xaaaaf0), Lin(0xeeeaff), (a - 0.55f) / 0.45f);
            c = Color.Lerp(c, Lin(0xc4a2ff), hue);
            return c * jitter;
        }

        /// <summary>部位 v → (亮度, 缝光)：分段线性，各部位的取值点见 VCenter… 常量（同 TS push 的 light / edgeBoost）</summary>
        static void PartAt(float v, out float light, out float seam)
        {
            float[] kv = { VCenter, VTop, VBevelIn, VBevelOut, VSide };
            float[] kl = { 1.06f, 1f, 1.2f, 1.28f, 0.62f };
            float[] ks = { 0, 0, 0, 0.25f, 0.8f };
            if (v <= kv[0])
            {
                light = kl[0];
                seam = ks[0];
                return;
            }
            for (int i = 1; i < kv.Length; i++)
                if (v <= kv[i])
                {
                    float t = (v - kv[i - 1]) / (kv[i] - kv[i - 1]);
                    light = Mathf.Lerp(kl[i - 1], kl[i], t);
                    seam = Mathf.Lerp(ks[i - 1], ks[i], t);
                    return;
                }
            light = kl[kl.Length - 1];
            seam = ks[ks.Length - 1];
        }

        /// <summary>
        /// 碎片渐变贴图（128 × 64，sRGB）：albedo = 片面底色 × 部位亮度；emission = 刃口白紫光（u &gt; 0.62 起）× 1.3 + 缝光 × 0.45 + 底色微光，
        /// 再 ÷ <see cref="EmissionScale"/>。v &gt; 0.75 是发光芯（暗紫底、亮紫自发光）。不要 mipmap、钳边、双线性。
        /// </summary>
        public static void BuildRamps(out Texture2D albedo, out Texture2D emission)
        {
            int w = TileW * RampTiles;
            albedo = new Texture2D(w, RampH, TextureFormat.RGBA32, false, false) { name = "T_DemonBlade_ShardRamp_D", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            emission = new Texture2D(w, RampH, TextureFormat.RGBA32, false, false) { name = "T_DemonBlade_ShardRamp_E", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var ca = new Color[w * RampH];
            var ce = new Color[w * RampH];
            Color edge = EdgeGlow.linear, seamC = SeamGlow.linear, baseE = Lin(0x1c0c44);
            Color coreA = Lin(0x2a1260), coreE = Lin(0x7436ff) * 1.15f;
            for (int y = 0; y < RampH; y++)
            {
                float v = (y + 0.5f) / RampH;
                PartAt(v, out float light, out float seam);
                for (int x = 0; x < w; x++)
                {
                    int tile = x / TileW;
                    float local = (x % TileW + 0.5f) / TileW;
                    float a = Mathf.Clamp01((local - 0.04f) / 0.92f);
                    Color al, em;
                    if (v > 0.75f)
                    {
                        al = coreA;
                        em = coreE;
                    }
                    else
                    {
                        var t = Tiles[tile];
                        al = ShardColor(a, t.x * light, t.y);
                        float e = Mathf.Min(1, Mathf.Pow(Mathf.Max(0, (a - 0.62f) / 0.38f), 1.5f));
                        em = edge * (e * 1.3f) + seamC * (seam * 0.45f) + baseE;
                    }
                    ca[y * w + x] = Clamp(al).gamma;
                    ce[y * w + x] = Clamp(em * (1 / EmissionScale)).gamma;
                }
            }
            albedo.SetPixels(ca);
            emission.SetPixels(ce);
            albedo.Apply(false, false);
            emission.Apply(false, false);
        }

        static Color Clamp(Color c) => new(Mathf.Clamp01(c.r), Mathf.Clamp01(c.g), Mathf.Clamp01(c.b), 1);

        /// <summary>
        /// 刀柄贴图集的程序兜底（设计图裁出的 T_DemonBlade_Hilt_D / _E 还没导入时）：深枪灰底 + 青蓝卷纹的大致位置。
        /// 布局同 demon_blade_textures.py 的 RECTS（1024² 缩成 256²）
        /// </summary>
        public static void BuildFallbackHilt(out Texture2D albedo, out Texture2D emission)
        {
            const int s = 256;
            albedo = new Texture2D(s, s, TextureFormat.RGBA32, true, false) { name = "T_DemonBlade_Hilt_D (fallback)" };
            emission = new Texture2D(s, s, TextureFormat.RGBA32, true, false) { name = "T_DemonBlade_Hilt_E (fallback)" };
            var ca = new Color[s * s];
            var ce = new Color[s * s];
            Color metal = Hex.Rgb(0x2b2d36), wrap = Hex.Rgb(0x15141a), guard = Hex.Rgb(0x1d1e24), cyan = Hex.Rgb(0x52d8ff), violet = Hex.Rgb(0xc478ff);
            for (int y = 0; y < s; y++)
                for (int x = 0; x < s; x++)
                {
                    // 贴图坐标（左上原点，1024 像素制）
                    float px = (x + 0.5f) * 4, py = (s - 1 - y + 0.5f) * 4;
                    Color a = metal, e = Color.black;
                    if (py < 576 && px < 512)
                    {
                        // 刀根：中线一道卷纹 + 眼睛
                        float u = (px % 256) / 256f, v = py / 576f;
                        float swirl = Mathf.Abs(Mathf.Sin(v * 22f + u * 9f)) < 0.12f && u > 0.2f && u < 0.8f ? 1 : 0;
                        float eye = Mathf.Exp(-(Mathf.Pow((u - EyeU) / 0.06f, 2) + Mathf.Pow((v - EyeV) / 0.04f, 2)));
                        bool awake = px >= 256;
                        e = cyan * swirl * 0.8f + (awake ? violet : cyan) * eye * (awake ? 1.2f : 0.5f);
                        a = metal + e * 0.3f;
                    }
                    else if (py >= 576 && py < 720) a = (Mathf.FloorToInt(px / 24) + Mathf.FloorToInt(py / 24)) % 2 == 0 ? wrap : wrap * 1.5f;
                    else if (py >= 720 && px >= 128 && px < 640) a = guard;
                    a.a = 1;
                    e.a = 1;
                    ca[y * s + x] = a;
                    ce[y * s + x] = e;
                }
            albedo.SetPixels(ca);
            emission.SetPixels(ce);
            albedo.Apply(true, false);
            emission.Apply(true, false);
        }

        // ───────────── 材质 ─────────────

        /// <summary>项目的风格化 Lit（碎片、刀柄共用）</summary>
        public const string ShaderName = "Spiritfire/StylizedLit";

        static readonly int BaseMapId = Shader.PropertyToID("_BaseMap");
        static readonly int EmissionMapId = Shader.PropertyToID("_EmissionMap");
        public static readonly int EmissionColorId = Shader.PropertyToID("_EmissionColor");
        public static readonly int BaseMapStId = Shader.PropertyToID("_BaseMap_ST");

        /// <summary>碎片材质：渐变贴图 + 自发光（×<see cref="EmissionScale"/>）；略金属、低粗糙（同 TS roughness 0.42 / metalness 0.18），紫色边缘光</summary>
        public static void SetupShardMaterial(Material m, Texture albedo, Texture emission)
        {
            m.SetTexture(BaseMapId, albedo);
            m.SetTexture(EmissionMapId, emission);
            m.SetColor(EmissionColorId, ShardEmission);
            m.EnableKeyword("_EMISSION");
            m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
            SetFloat(m, "_Metallic", 0.18f);
            SetFloat(m, "_Roughness", 0.42f);
            SetFloat(m, "_SpecStrength", 0.9f);
            SetFloat(m, "_RimStrength", 0.55f);
            if (m.HasProperty("_RimColor")) m.SetColor("_RimColor", Hex.Rgb(0xc9a8ff));
            if (m.HasProperty("_ShadowTint")) m.SetColor("_ShadowTint", Hex.Rgb(0x8a86d8));
        }

        /// <summary>碎片材质的基础自发光倍率（世界刃群再乘 <see cref="BladeShards.WorldGlow"/>）</summary>
        public static Color ShardEmission => new(EmissionScale, EmissionScale, EmissionScale, 1);

        /// <summary>刀柄 / 刀根材质：设计图贴图集 + 发光卷纹（同 TS emissiveIntensity 1.1–1.25）</summary>
        public static void SetupHiltMaterial(Material m, Texture albedo, Texture emission)
        {
            m.SetTexture(BaseMapId, albedo);
            m.SetTexture(EmissionMapId, emission);
            m.SetColor(EmissionColorId, new Color(1.2f, 1.2f, 1.2f, 1));
            m.EnableKeyword("_EMISSION");
            m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
            SetFloat(m, "_Metallic", 0.4f);
            SetFloat(m, "_Roughness", 0.55f);
        }

        static void SetFloat(Material m, string name, float v)
        {
            if (m.HasProperty(name)) m.SetFloat(name, v);
        }
    }
}
