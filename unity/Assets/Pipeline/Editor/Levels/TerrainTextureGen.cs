using System.IO;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 程序化生成手绘风格的地表贴图（可无缝平铺，RGB = 固有色，A = 高度，供 StylizedTerrain 的高度混合）与 TerrainLayer。
    /// 都是大色块 + 少量中尺度笔触（沙纹、砾石、龟裂、层理），不做写实的微细节——与角色 / 场景件的手绘画风一致。
    /// 美术之后可以直接替换 PNG（保持 A 通道是高度），TerrainLayer 引用不变。
    /// </summary>
    public static class TerrainTextureGen
    {
        public const string Dir = "Assets/Levels/Terrain";
        /// <summary>默认边长（像素）；崖面岩层覆盖的米数大，用 1024（见 <see cref="Frost"/>）</summary>
        const int N = 512;

        public enum Kind { Sand, Gravel, Packed, Rock, Snow, Ice, FrozenSoil, DarkRock, Ash, CooledLava, EmberCrust, Basalt }

        public sealed class Palette
        {
            public Color a, b, accent, dark;
        }

        // ───────────── 周期噪声（严格无缝）─────────────
        static float Hash(int x, int y, int seed)
        {
            unchecked
            {
                uint h = (uint)(x * 374761393 + y * 668265263 + seed * 2147483647);
                h = (h ^ (h >> 13)) * 1274126177u;
                return ((h ^ (h >> 16)) & 0xffffff) / 16777215f;
            }
        }

        /// <summary>周期为 period 格的值噪声（双三次平滑），u、v ∈ [0,1) 时在边界处无缝</summary>
        static float Value(float u, float v, int period, int seed)
        {
            float x = u * period, y = v * period;
            int x0 = Mathf.FloorToInt(x), y0 = Mathf.FloorToInt(y);
            float fx = x - x0, fy = y - y0;
            fx = fx * fx * (3 - 2 * fx);
            fy = fy * fy * (3 - 2 * fy);
            int Wrap(int i) => ((i % period) + period) % period;
            float h00 = Hash(Wrap(x0), Wrap(y0), seed), h10 = Hash(Wrap(x0 + 1), Wrap(y0), seed);
            float h01 = Hash(Wrap(x0), Wrap(y0 + 1), seed), h11 = Hash(Wrap(x0 + 1), Wrap(y0 + 1), seed);
            return Mathf.Lerp(Mathf.Lerp(h00, h10, fx), Mathf.Lerp(h01, h11, fx), fy);
        }

        static float Fbm(float u, float v, int period, int seed, int octaves = 4)
        {
            float sum = 0, amp = 0.5f, norm = 0;
            for (int o = 0; o < octaves; o++)
            {
                sum += Value(u, v, period << o, seed + o * 17) * amp;
                norm += amp;
                amp *= 0.5f;
            }
            return sum / norm;
        }

        /// <summary>周期 Voronoi：返回 (到最近点的距离, 最近与次近的差 = 裂缝)，cells = 每边格子数</summary>
        static Vector2 Voronoi(float u, float v, int cells, int seed) => Voronoi(u, v, cells, seed, out _);

        /// <summary>同上，另外给出最近点所在（周期折回后的）格子编号 = wy * cells + wx，用来给整颗石子 / 整块裂片取同一个随机值</summary>
        static Vector2 Voronoi(float u, float v, int cells, int seed, out int id)
        {
            id = 0;
            float x = u * cells, y = v * cells;
            int cx = Mathf.FloorToInt(x), cy = Mathf.FloorToInt(y);
            float d1 = 9, d2 = 9;
            for (int j = -1; j <= 1; j++)
            for (int i = -1; i <= 1; i++)
            {
                int gx = cx + i, gy = cy + j;
                int wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
                float px = gx + Hash(wx, wy, seed), py = gy + Hash(wx, wy, seed + 91);
                float d = Mathf.Sqrt((px - x) * (px - x) + (py - y) * (py - y));
                if (d < d1) { d2 = d1; d1 = d; id = wy * cells + wx; } else if (d < d2) d2 = d;
            }
            return new Vector2(d1, d2 - d1);
        }

        /// <summary>
        /// 各向异性的周期 Voronoi：u 向 cu 格、v 向 cv 格（cu &gt; cv 时块高于宽）。距离以 u 向格宽为单位；
        /// 返回 (到最近点的距离, 最近与次近的差 = 块缝)，id = 最近点所在（折回后的）格子 wy * cu + wx，
        /// local = 当前点相对最近点的偏移（同一单位，y 向上），用来在块内画明暗梯度
        /// </summary>
        static Vector2 Voronoi(float u, float v, int cu, int cv, int seed, out int id, out Vector2 local)
        {
            id = 0;
            local = Vector2.zero;
            float asp = cu / (float)cv;
            float x = u * cu, y = v * cv;
            int cx = Mathf.FloorToInt(x), cy = Mathf.FloorToInt(y);
            float d1 = 9, d2 = 9;
            for (int j = -1; j <= 1; j++)
            for (int i = -1; i <= 1; i++)
            {
                int gx = cx + i, gy = cy + j;
                int wx = ((gx % cu) + cu) % cu, wy = ((gy % cv) + cv) % cv;
                float dx = gx + Hash(wx, wy, seed) - x, dy = (gy + Hash(wx, wy, seed + 91) - y) * asp;
                float d = Mathf.Sqrt(dx * dx + dy * dy);
                if (d < d1)
                {
                    d2 = d1;
                    d1 = d;
                    id = wy * cu + wx;
                    local = new Vector2(-dx, -dy);
                }
                else if (d < d2) d2 = d;
            }
            return new Vector2(d1, d2 - d1);
        }

        static float Smooth(float e0, float e1, float x)
        {
            float k = Mathf.Clamp01((x - e0) / (e1 - e0));
            return k * k * (3 - 2 * k);
        }

        // ───────────── 各层 ─────────────
        public static Color[] Generate(Kind kind, Palette p, int seed, int n = N)
        {
            var px = new Color[n * n];
            // 逐行并行（各像素互不依赖、噪声函数无状态），结果与串行逐位相同
            Parallel.For(0, n, y =>
            {
                for (int x = 0; x < n; x++)
                    px[y * n + x] = Pixel(kind, p, seed, x / (float)n, y / (float)n);
            });
            return px;
        }

        static Color Pixel(Kind kind, Palette p, int seed, float u, float v)
        {
            {
                Color c;
                float h;
                switch (kind)
                {
                    case Kind.Sand:
                    {
                        // 柔和的大色斑 + 轻微扭曲的风纹：风纹大体平行（同一主风向），只在亮脊上提一点亮，不做大理石般的高反差花纹
                        float blot = Fbm(u, v, 2, seed);
                        float warp = Fbm(u, v, 3, seed + 5) * 1.6f;
                        float ripple = Mathf.Sin((v * 9 + warp) * Mathf.PI * 2) * 0.5f + 0.5f;
                        c = Color.Lerp(p.a, p.b, Smooth(0.2f, 0.8f, blot));
                        c = Color.Lerp(c, p.accent, Smooth(0.8f, 0.97f, ripple) * 0.14f);
                        h = 0.35f + ripple * 0.25f + (blot - 0.5f) * 0.2f;
                        break;
                    }
                    case Kind.Gravel:
                    {
                        // 黑戈壁（荒漠砾幕）：大小不一的圆卵石密密地撒在一层发暗的土上，再叠一层细砾；
                        // 每颗石子整颗同一色调（取最近点所在格子，不跨格跳色），石与土只差一档明度——
                        // 近看是一颗颗石子，远看是均匀的暗褐颗粒，不是豹纹斑点，也不是铺地砖
                        float ground = Fbm(u, v, 4, seed);
                        var soil = Color.Lerp(Color.Lerp(p.a, p.dark, 0.35f), p.b, Smooth(0.3f, 0.75f, ground) * 0.6f);
                        float sparse = Smooth(0.55f, 0.78f, Fbm(u, v, 3, seed + 21));
                        c = soil;
                        h = 0.25f + ground * 0.1f;
                        // 两层卵石：大一点的稀、小一点的密；石子半径按格子随机，带中心受光
                        for (int layer = 0; layer < 2; layer++)
                        {
                            int cells = layer == 0 ? 40 : 76;
                            var vo = Voronoi(u, v, cells, seed + layer * 57, out int id);
                            int ix = id % cells, iy = id / cells;
                            float keep = Hash(ix, iy, seed + 40 + layer);
                            if (keep < (layer == 0 ? 0.25f + sparse * 0.35f : 0.1f + sparse * 0.3f)) continue;
                            float size = (layer == 0 ? 0.3f : 0.26f) + Hash(ix, iy, seed + 3 + layer) * 0.16f;
                            float stone = 1 - Smooth(size - 0.08f, size, vo.x);
                            if (stone <= 0) continue;
                            float tone = Hash(ix, iy, seed + 9 + layer);
                            float lit = 1 - Smooth(0f, size, vo.x);
                            var stoneCol = Color.Lerp(p.dark, p.accent, 0.25f + tone * 0.45f + lit * 0.25f);
                            c = Color.Lerp(c, stoneCol, stone);
                            h = Mathf.Lerp(h, 0.5f + lit * 0.35f, stone);
                        }
                        break;
                    }
                    case Kind.Packed:
                    {
                        // 夯实土 / 车道：细碎的浅龟裂只在一片片区域出现（干透的地方），其余是平的土面带少量碎石；裂缝细、反差低
                        float blot = Fbm(u, v, 4, seed);
                        var vo = Voronoi(u, v, 13, seed);
                        float patch = Smooth(0.45f, 0.65f, Fbm(u, v, 3, seed + 13));
                        float crack = (1 - Smooth(0.0f, 0.035f, vo.y)) * patch;
                        c = Color.Lerp(p.a, p.b, Smooth(0.25f, 0.75f, blot));
                        c = Color.Lerp(c, p.dark, crack * 0.45f);
                        var grit = Voronoi(u, v, 48, seed + 31);
                        float pebble = (1 - Smooth(0.12f, 0.2f, grit.x)) * Smooth(0.6f, 0.8f, Hash(Mathf.FloorToInt(u * 48), Mathf.FloorToInt(v * 48), seed + 5));
                        c = Color.Lerp(c, p.accent, pebble * 0.35f);
                        h = 0.45f - crack * 0.25f + blot * 0.1f + pebble * 0.2f;
                        break;
                    }
                    case Kind.DarkRock:
                    {
                        // 冰原崖面（第 4 层，三平面投影后 v = 高度）：成块的冻裂岩体，不画层理——
                        // 层理条纹沿高度周期重复，绕着整圈崖面连成一道道水平线，远看像看台墙 / 分层蛋糕。
                        // 一块块棱角岩面（各向异性 Voronoi，6 × 4 格，块略高于宽 = 以竖向节理为主），块缘先做域扭曲（不是直线）；
                        // 每块一个明暗 + 随机朝向的明暗梯度（像朝向各异的岩面），再叠小一号的块调明暗（多尺度，不显格子）；
                        // 块缝细而暗、沿缝长断续出现（不是封闭的砌石缝）；块上缘受光挂霜，下缘一线压暗。
                        float wu = u + (Fbm(u, v, 3, seed + 1) - 0.5f) * 0.08f + (Fbm(u, v, 12, seed + 3) - 0.5f) * 0.015f;
                        float wv = v + (Fbm(u, v, 3, seed + 2) - 0.5f) * 0.08f + (Fbm(u, v, 12, seed + 4) - 0.5f) * 0.015f;
                        var vo = Voronoi(wu, wv, 6, 4, seed, out int id, out var lp);
                        float tone = Hash(id % 6, id / 6, seed + 5);
                        float ang = Hash(id % 6, id / 6, seed + 6) * Mathf.PI * 2;
                        float tilt = Mathf.Cos(ang) * lp.x + Mathf.Sin(ang) * lp.y;
                        var vb = Voronoi(wu, wv, 13, 9, seed + 11, out int idb, out _);
                        // 小块的明暗在块缘附近淡回中间值：只做大块里的深浅起伏，不出一圈圈硬边的碎玻璃
                        float toneB = Mathf.Lerp(0.5f, Hash(idb % 13, idb / 13, seed + 12), Smooth(0, 0.15f, vb.y));
                        float face = 0.5f + (tone - 0.5f) * 0.45f + tilt * 0.25f + (toneB - 0.5f) * 0.22f;
                        float fine = Fbm(u, v, 24, seed + 7), mott = Fbm(u, v, 8, seed + 8);
                        c = Color.Lerp(p.a, p.b, Smooth(0.05f, 0.95f, face * 0.7f + fine * 0.1f + mott * 0.2f));
                        float brk = Smooth(0.35f, 0.55f, Fbm(u, v, 6, seed + 20));
                        float crack = (1 - Smooth(0, 0.05f, vo.y)) * brk;
                        float under = (1 - Smooth(0, 0.2f, vo.y)) * Smooth(0, -0.4f, lp.y) * brk;
                        float top = (1 - Smooth(0.02f, 0.18f, vo.y)) * Smooth(0.05f, 0.4f, lp.y) * brk;
                        float sub = (1 - Smooth(0, 0.035f, vb.y)) * Smooth(0.55f, 0.7f, Fbm(u, v, 12, seed + 21)) * (1 - crack);
                        float frost = Smooth(0.4f, 0.7f, Fbm(u, v, 14, seed + 13));
                        c = Color.Lerp(c, p.dark, under * 0.3f);
                        c = Color.Lerp(c, p.accent, top * (0.22f + frost * 0.33f));
                        c = Color.Lerp(c, p.dark, crack * 0.7f);
                        c = Color.Lerp(c, p.dark, sub * 0.22f);
                        h = 0.45f + (face - 0.5f) * 0.3f + fine * 0.08f - crack * 0.3f - sub * 0.1f + top * 0.08f;
                        break;
                    }
                    case Kind.Rock:
                    {
                        // 层理岩：v 方向的水平条带（三平面投影后 = 沿高度的层理），条带宽度不均，带少量风蚀凹槽
                        float warp = Fbm(u, v, 3, seed) * 0.15f;
                        float band = Value(0, v * 1f + warp, 9, seed + 2);
                        float band2 = Value(0, v * 1f + warp, 23, seed + 4);
                        c = Color.Lerp(p.a, p.b, Smooth(0.25f, 0.75f, band));
                        c = Color.Lerp(c, p.accent, Smooth(0.7f, 0.9f, band2) * 0.4f);
                        float groove = Smooth(0.55f, 0.75f, Fbm(u * 1f, v, 6, seed + 8));
                        c = Color.Lerp(c, p.dark, groove * 0.35f);
                        h = 0.5f + (band - 0.5f) * 0.4f - groove * 0.3f;
                        break;
                    }
                    case Kind.Snow:
                    {
                        float blot = Fbm(u, v, 3, seed);
                        float drift = Fbm(u, v, 6, seed + 7);
                        c = Color.Lerp(p.a, p.b, Smooth(0.3f, 0.75f, blot));
                        c = Color.Lerp(c, p.accent, Smooth(0.65f, 0.85f, drift) * 0.3f);
                        // 雪是盖在冻土碎石上的一层：高度整体高于冻土（含石块顶），高度混合时雪先填石缝、再盖住石头，只露石尖
                        h = 0.45f + blot * 0.3f + drift * 0.1f;
                        break;
                    }
                    case Kind.Ice:
                    {
                        var vo = Voronoi(u, v, 5, seed);
                        float crack = 1 - Smooth(0.0f, 0.025f, vo.y);
                        float depth = Fbm(u, v, 3, seed);
                        c = Color.Lerp(p.a, p.b, Smooth(0.3f, 0.7f, depth));
                        c = Color.Lerp(c, p.accent, crack * 0.6f);
                        h = 0.3f - crack * 0.2f;
                        break;
                    }
                    // 第三章四层（2026-11-04 美术清理，docs/art/review/ch3-v2/art-pass/）：只留大块色面和宽阔的柔和渐变，不出高频噪点。
                    // 以前：火山灰撒满 60 格的黑色火山渣点（远看一地小黑点）、冷却熔岩的绳纹 + 冷缩细缝、结壳 9 格细碎明暗、
                    // 崖面 14 列柱状节理（0.5 m 一根竖条，满崖都是，像拉伸的三向投影条纹 / 波纹板）
                    case Kind.Ash:
                    {
                        // 踩实的路面 / 落灰面（第 0 层，路、台顶、软覆盖）：铜灰色，比玄武岩地面亮一档——路线一眼读得出。
                        // 两三块大色斑 + 少量更亮的踩实面，没有颗粒、没有细纹
                        float blot = Fbm(u, v, 2, seed, 3);
                        float soft = Fbm(u, v, 3, seed + 5, 2);
                        c = Color.Lerp(p.a, p.b, Smooth(0.25f, 0.75f, blot));
                        c = Color.Lerp(c, p.accent, Smooth(0.58f, 0.85f, soft) * 0.3f);
                        c = Color.Lerp(c, p.dark, Smooth(0.6f, 0.85f, 1 - soft) * 0.12f);
                        h = 0.42f + blot * 0.2f + soft * 0.05f;
                        break;
                    }
                    case Kind.CooledLava:
                    {
                        // 玄武岩地面（第 1 层，底面）：大块平涂的冷熔岩板（一张 3 × 3 块），每块一个明暗 + 一道朝向各异的宽渐变（手绘的「几大块」），
                        // 板缝很宽、反差很低，只是两块之间的一道软暗线
                        float wu = u + (Fbm(u, v, 2, seed + 1, 2) - 0.5f) * 0.12f, wv = v + (Fbm(u, v, 2, seed + 2, 2) - 0.5f) * 0.12f;
                        var vo = Voronoi(wu, wv, 3, 3, seed + 5, out int id, out var lp);
                        float tone = Hash(id % 3, id / 3, seed + 7);
                        float ang = Hash(id % 3, id / 3, seed + 8) * Mathf.PI * 2;
                        float tilt = Mathf.Cos(ang) * lp.x + Mathf.Sin(ang) * lp.y;
                        float blot = Fbm(u, v, 2, seed, 3);
                        float k = 0.5f + (tone - 0.5f) * 0.45f + tilt * 0.3f + (blot - 0.5f) * 0.3f;
                        c = Color.Lerp(p.a, p.b, Smooth(0.1f, 0.9f, k));
                        float seam = 1 - Smooth(0.0f, 0.1f, vo.y);
                        c = Color.Lerp(c, p.dark, seam * 0.3f);
                        h = 0.45f + (k - 0.5f) * 0.2f - seam * 0.12f;
                        break;
                    }
                    case Kind.EmberCrust:
                    {
                        // 结壳熔岩（第 2 层，熔岩岸带）：一张 4 × 4 块大块暗色硬壳；壳缝只有一部分透出铜橙（低频噪声挑出一两片「热区」，
                        // 其余的缝是暗缝）——暗壳加少量亮缝，不是满地一张发光的网（composition.md 第 6 节：饱和度和面积成反比）
                        const int cells = 4;
                        var vo = Voronoi(u, v, cells, seed, out int id);
                        int ix = id % cells, iy = id / cells;
                        float crack = 1 - Smooth(0.0f, 0.1f + Hash(ix, iy, seed + 2) * 0.06f, vo.y);
                        float hot = (1 - Smooth(0.0f, 0.035f, vo.y)) * Smooth(0.45f, 0.62f, Fbm(u, v, 2, seed + 9, 2));
                        float blot = Fbm(u, v, 2, seed + 4, 2);
                        c = Color.Lerp(p.a, p.b, Smooth(0.2f, 0.8f, Hash(ix, iy, seed + 7) * 0.6f + blot * 0.4f));
                        c = Color.Lerp(c, p.dark, crack * 0.6f);
                        c = Color.Lerp(c, p.accent, hot * 0.5f);
                        h = 0.6f + blot * 0.1f - crack * 0.5f;
                        break;
                    }
                    case Kind.Basalt:
                    {
                        // 崖面（第 4 层，三平面投影后 v = 高度）：大切面块面——一张 3 × 2 块朝向各异的平整岩面（一块约 6 × 9 m，略高于宽），
                        // 每块一个明暗 + 一道宽的手绘明暗梯度（像朝向不同的切面），第二级小块只做块内的深浅起伏；块上沿一线受光、块缝一线压暗
                        float wu = u + (Fbm(u, v, 2, seed + 1, 2) - 0.5f) * 0.1f, wv = v + (Fbm(u, v, 2, seed + 2, 2) - 0.5f) * 0.1f;
                        var vo = Voronoi(wu, wv, 3, 2, seed, out int id, out var lp);
                        float tone = Hash(id % 3, id / 3, seed + 5);
                        float ang = Hash(id % 3, id / 3, seed + 6) * Mathf.PI * 2;
                        float tilt = Mathf.Cos(ang) * lp.x + Mathf.Sin(ang) * lp.y;
                        var vb = Voronoi(wu, wv, 9, 7, seed + 11, out int idb, out _);
                        float toneB = Mathf.Lerp(0.5f, Hash(idb % 9, idb / 9, seed + 12), Smooth(0, 0.12f, vb.y));
                        float face = 0.5f + (tone - 0.5f) * 0.5f + tilt * 0.45f + (toneB - 0.5f) * 0.16f;
                        c = Color.Lerp(p.a, p.b, Smooth(0.08f, 0.92f, face));
                        float seam = 1 - Smooth(0, 0.05f, vo.y);
                        float top = (1 - Smooth(0.02f, 0.14f, vo.y)) * Smooth(0.05f, 0.35f, lp.y);
                        float under = (1 - Smooth(0, 0.18f, vo.y)) * Smooth(0, -0.35f, lp.y);
                        c = Color.Lerp(c, p.dark, under * 0.25f);
                        c = Color.Lerp(c, p.accent, top * 0.35f);
                        c = Color.Lerp(c, p.dark, seam * 0.3f);
                        h = 0.5f + (face - 0.5f) * 0.3f - seam * 0.3f + top * 0.08f;
                        break;
                    }
                    default: // FrozenSoil
                    {
                        // 冻土碎石：冻硬的土面上撒不规则的小石块 / 冻土块。以前每个 Voronoi 格都有一颗同样大的深色圆点（规则、高反差，像豹纹），
                        // 而且圆点的高度比雪还高，高度混合时总是从雪里顶出来。现在：
                        // 石块是格子内缩出来的多边形（块缝距离，不是到格点的圆），域扭曲后不规则；大小不一、只留一部分格子、稀密成片；
                        // 石与土只差一档明度，上沿受光、下沿一线暗；土面上一点白霜。
                        // 高度：土面 0.18–0.28、石顶最高约 0.48，都低于雪（0.5–0.8）——雪的份额过半就盖住，三成左右时雪填在石缝里
                        float blot = Fbm(u, v, 4, seed);
                        float patch = Smooth(0.4f, 0.7f, Fbm(u, v, 3, seed + 21));
                        c = Color.Lerp(p.a, p.b, Smooth(0.3f, 0.7f, blot));
                        h = 0.18f + blot * 0.1f;
                        float wu = u + (Fbm(u, v, 8, seed + 1) - 0.5f) * 0.035f, wv = v + (Fbm(u, v, 8, seed + 2) - 0.5f) * 0.035f;
                        for (int layer = 0; layer < 2; layer++)
                        {
                            int cells = layer == 0 ? 18 : 34;
                            var vo = Voronoi(wu, wv, cells, cells, seed + layer * 57, out int id, out var lp);
                            int ix = id % cells, iy = id / cells;
                            if (Hash(ix, iy, seed + 40 + layer) >= (layer == 0 ? 0.3f : 0.22f) + patch * 0.35f) continue;
                            float size = 0.18f + Hash(ix, iy, seed + 3 + layer) * 0.22f;
                            float stone = Smooth(size, size + 0.06f, vo.y);
                            if (stone <= 0) continue;
                            float tone = Hash(ix, iy, seed + 9 + layer);
                            float lit = Mathf.Clamp01(0.5f + lp.y * 0.8f - lp.x * 0.4f);
                            var sc = Color.Lerp(Color.Lerp(p.a, p.b, 0.35f + tone * 0.5f), p.accent, lit * 0.35f);
                            sc = Color.Lerp(sc, p.dark, (1 - lit) * 0.25f);
                            c = Color.Lerp(c, sc, stone);
                            h = Mathf.Max(h, (0.32f + lit * 0.12f + tone * 0.04f) * stone);
                        }
                        float frost = h < 0.3f ? Smooth(0.62f, 0.78f, Fbm(u, v, 24, seed + 31)) : 0;
                        c = Color.Lerp(c, p.accent, frost * 0.5f);
                        break;
                    }
                }
                c.a = Mathf.Clamp01(h);
                return c;
            }
        }

        /// <summary>宏观色斑（低频，世界空间采样）</summary>
        public static Texture2D Macro(int seed)
        {
            string path = $"{Dir}/T_Terrain_Macro.png";
            var px = new Color[N * N];
            for (int y = 0; y < N; y++)
            for (int x = 0; x < N; x++)
            {
                float f = Fbm(x / (float)N, y / (float)N, 2, seed, 5);
                px[y * N + x] = new Color(f, f, f, 1);
            }
            return Write(path, px, true);
        }

        /// <summary>
        /// 扭曲噪声（R、G 两路互不相关的中频噪声，世界空间采样）：冰原地形材质拿它扭曲崖面岩层的 UV，打散平铺的格子感。
        /// 单独一张，不往 T_Terrain_Macro 的 G、B 里塞（那张三章共用，压缩时会牵动 R，戈壁 / 火狱的色斑就变了）
        /// </summary>
        public static Texture2D Warp(int seed)
        {
            string path = $"{Dir}/T_Terrain_Warp.png";
            var px = new Color[N * N];
            Parallel.For(0, N, y =>
            {
                for (int x = 0; x < N; x++)
                {
                    float u = x / (float)N, v = y / (float)N;
                    px[y * N + x] = new Color(Fbm(u, v, 4, seed, 4), Fbm(u, v, 4, seed + 100, 4), 0.5f, 1);
                }
            });
            return Write(path, px, true);
        }

        static Texture2D Write(string path, Color[] px, bool linear)
        {
            Directory.CreateDirectory(Dir);
            int n = Mathf.RoundToInt(Mathf.Sqrt(px.Length));
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true);
            tex.SetPixels(px);
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path);
            var ti = (TextureImporter)AssetImporter.GetAtPath(path);
            ti.sRGBTexture = !linear;
            ti.alphaSource = TextureImporterAlphaSource.FromInput;
            ti.wrapMode = TextureWrapMode.Repeat;
            ti.anisoLevel = 8;
            ti.textureCompression = TextureImporterCompression.CompressedHQ;
            ti.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        /// <summary>生成（覆盖）一层贴图与它的 TerrainLayer；tileSize = 一张贴图覆盖的米数，size = 贴图边长（像素）</summary>
        public static TerrainLayer Layer(string name, Kind kind, Palette p, float tileSize, int seed, int size = N)
        {
            var tex = Write($"{Dir}/T_Terrain_{name}.png", Generate(kind, p, seed, size), false);
            string path = $"{Dir}/TL_{name}.terrainlayer";
            var layer = AssetDatabase.LoadAssetAtPath<TerrainLayer>(path);
            if (!layer)
            {
                layer = new TerrainLayer();
                AssetDatabase.CreateAsset(layer, path);
            }
            layer.diffuseTexture = tex;
            layer.tileSize = new Vector2(tileSize, tileSize);
            layer.tileOffset = Vector2.zero;
            EditorUtility.SetDirty(layer);
            return layer;
        }

        static Color C(float r, float g, float b) => new(r, g, b, 1);

        /// <summary>第一章戈壁的四层：沙、黑戈壁砾石、夯土 / 干河床、赭红层理岩</summary>
        public static TerrainLayer[] Desert() => new[]
        {
            Layer("DesertSand", Kind.Sand, new Palette { a = C(0.82f, 0.62f, 0.41f), b = C(0.87f, 0.68f, 0.46f), accent = C(0.95f, 0.80f, 0.58f), dark = C(0.6f, 0.43f, 0.3f) }, 9f, 11),
            Layer("DesertGravel", Kind.Gravel, new Palette { a = C(0.55f, 0.43f, 0.32f), b = C(0.62f, 0.49f, 0.36f), accent = C(0.47f, 0.38f, 0.31f), dark = C(0.29f, 0.24f, 0.21f) }, 4f, 23),
            Layer("DesertPacked", Kind.Packed, new Palette { a = C(0.66f, 0.50f, 0.37f), b = C(0.74f, 0.58f, 0.43f), accent = C(0.8f, 0.66f, 0.5f), dark = C(0.36f, 0.25f, 0.2f) }, 7f, 37),
            Layer("DesertRock", Kind.Rock, new Palette { a = C(0.64f, 0.36f, 0.24f), b = C(0.79f, 0.52f, 0.34f), accent = C(0.88f, 0.70f, 0.48f), dark = C(0.42f, 0.22f, 0.16f) }, 8f, 41),
        };

        // 三章的层序一致（LevelKit.Splat 的规则按这个序号写）：0 软覆盖（沙 / 雪 / 灰）· 1 底面（砾石 / 冻土 / 冷熔岩）·
        // 2 路面或流体边（夯土 / 冰 / 结壳熔岩）· 3 岩（三平面投影：层理岩 / 冻裂岩块 / 柱状玄武岩）

        /// <summary>第二章冰原的四层：雪、冻土碎石、冰、冻裂岩块</summary>
        public static TerrainLayer[] Frost() => new[]
        {
            Layer("FrostSnow", Kind.Snow, new Palette { a = C(0.80f, 0.85f, 0.92f), b = C(0.92f, 0.95f, 0.99f), accent = C(0.7f, 0.78f, 0.9f), dark = C(0.55f, 0.6f, 0.7f) }, 10f, 51),
            Layer("FrostSoil", Kind.FrozenSoil, new Palette { a = C(0.42f, 0.44f, 0.48f), b = C(0.52f, 0.54f, 0.58f), accent = C(0.6f, 0.62f, 0.68f), dark = C(0.25f, 0.26f, 0.3f) }, 6f, 61),
            Layer("FrostIce", Kind.Ice, new Palette { a = C(0.48f, 0.66f, 0.80f), b = C(0.62f, 0.80f, 0.90f), accent = C(0.86f, 0.94f, 1f), dark = C(0.3f, 0.4f, 0.55f) }, 12f, 57),
            // 崖面岩块：一张覆盖 16 m（崖高几十米，8 m 一张时平铺的格子一眼可见），1024 像素保住近看的精度；侧面的投影尺寸见 Ground.Frost.rockScale
            Layer("FrostRock", Kind.DarkRock, new Palette { a = C(0.34f, 0.37f, 0.44f), b = C(0.46f, 0.50f, 0.58f), accent = C(0.7f, 0.78f, 0.86f), dark = C(0.2f, 0.22f, 0.28f) }, 16f, 67, 1024),
        };

        /// <summary>
        /// 第三章火狱的四层：踩实的铜灰路面 / 落灰、玄武岩地面（大块冷熔岩板）、结壳熔岩（缝里透铜橙）、大切面玄武岩崖。
        /// 色彩脚本（2026-11-04 美术清理）：岩和地是低饱和偏冷的暗紫灰（崖更偏靛、地面偏灰紫），路面是亮一档的铜灰，熔岩橙只在岸带的壳缝里——
        /// 三块主色 暗紫玄武岩 / 铜褐 / 熔岩橙，与 art/README.md、fx-style §2.2 的熔火方向一致。贴图覆盖的米数放大（9 / 7 / 6 / 7 → 14 / 16 / 9 / 18 m），色块跟着变大
        /// </summary>
        public static TerrainLayer[] Inferno() => new[]
        {
            Layer("InfernoAsh", Kind.Ash, new Palette { a = C(0.40f, 0.30f, 0.24f), b = C(0.46f, 0.35f, 0.27f), accent = C(0.52f, 0.40f, 0.30f), dark = C(0.30f, 0.23f, 0.21f) }, 14f, 71),
            Layer("InfernoCooledLava", Kind.CooledLava, new Palette { a = C(0.19f, 0.17f, 0.215f), b = C(0.25f, 0.22f, 0.27f), accent = C(0.31f, 0.27f, 0.33f), dark = C(0.13f, 0.11f, 0.15f) }, 16f, 73),
            Layer("InfernoEmberCrust", Kind.EmberCrust, new Palette { a = C(0.15f, 0.12f, 0.155f), b = C(0.21f, 0.17f, 0.21f), accent = C(0.85f, 0.42f, 0.16f), dark = C(0.30f, 0.13f, 0.1f) }, 9f, 79),
            Layer("InfernoBasalt", Kind.Basalt, new Palette { a = C(0.15f, 0.14f, 0.19f), b = C(0.24f, 0.22f, 0.29f), accent = C(0.33f, 0.30f, 0.38f), dark = C(0.09f, 0.08f, 0.12f) }, 18f, 83, 1024),
        };

        /// <summary>按章节键（ShowcaseTheme.key：Desert / Frost / Inferno）取四层</summary>
        public static TerrainLayer[] ForChapter(string key) => key switch
        {
            "Frost" => Frost(),
            "Inferno" => Inferno(),
            _ => Desert(),
        };
    }
}
