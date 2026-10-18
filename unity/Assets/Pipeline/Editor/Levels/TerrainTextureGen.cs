using System.IO;
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
        const int N = 512;

        public enum Kind { Sand, Gravel, Packed, Rock, Snow, Ice, FrozenSoil, DarkRock }

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

        static float Smooth(float e0, float e1, float x)
        {
            float k = Mathf.Clamp01((x - e0) / (e1 - e0));
            return k * k * (3 - 2 * k);
        }

        // ───────────── 各层 ─────────────
        public static Color[] Generate(Kind kind, Palette p, int seed)
        {
            var px = new Color[N * N];
            for (int y = 0; y < N; y++)
            for (int x = 0; x < N; x++)
            {
                float u = x / (float)N, v = y / (float)N;
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
                    case Kind.Rock:
                    case Kind.DarkRock:
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
                        h = 0.4f + blot * 0.35f;
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
                    default: // FrozenSoil
                    {
                        float blot = Fbm(u, v, 4, seed);
                        var vo = Voronoi(u, v, 16, seed);
                        float pebble = 1 - Smooth(0.2f, 0.32f, vo.x);
                        c = Color.Lerp(p.a, p.b, Smooth(0.3f, 0.7f, blot));
                        c = Color.Lerp(c, p.dark, pebble * 0.5f);
                        h = 0.3f + pebble * 0.4f;
                        break;
                    }
                }
                c.a = Mathf.Clamp01(h);
                px[y * N + x] = c;
            }
            return px;
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

        static Texture2D Write(string path, Color[] px, bool linear)
        {
            Directory.CreateDirectory(Dir);
            var tex = new Texture2D(N, N, TextureFormat.RGBA32, true);
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

        /// <summary>生成（覆盖）一层贴图与它的 TerrainLayer；tileSize = 一张贴图覆盖的米数</summary>
        public static TerrainLayer Layer(string name, Kind kind, Palette p, float tileSize, int seed)
        {
            var tex = Write($"{Dir}/T_Terrain_{name}.png", Generate(kind, p, seed), false);
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

        /// <summary>第二章冰瀑峡谷的四层：雪、冰、冻土碎石、暗色岩</summary>
        public static TerrainLayer[] Frost() => new[]
        {
            Layer("FrostSnow", Kind.Snow, new Palette { a = C(0.80f, 0.85f, 0.92f), b = C(0.92f, 0.95f, 0.99f), accent = C(0.7f, 0.78f, 0.9f), dark = C(0.55f, 0.6f, 0.7f) }, 10f, 51),
            Layer("FrostIce", Kind.Ice, new Palette { a = C(0.48f, 0.66f, 0.80f), b = C(0.62f, 0.80f, 0.90f), accent = C(0.86f, 0.94f, 1f), dark = C(0.3f, 0.4f, 0.55f) }, 12f, 57),
            Layer("FrostSoil", Kind.FrozenSoil, new Palette { a = C(0.42f, 0.44f, 0.48f), b = C(0.52f, 0.54f, 0.58f), accent = C(0.6f, 0.62f, 0.68f), dark = C(0.25f, 0.26f, 0.3f) }, 6f, 61),
            Layer("FrostRock", Kind.DarkRock, new Palette { a = C(0.34f, 0.37f, 0.44f), b = C(0.46f, 0.50f, 0.58f), accent = C(0.7f, 0.78f, 0.86f), dark = C(0.2f, 0.22f, 0.28f) }, 9f, 67),
        };
    }
}
