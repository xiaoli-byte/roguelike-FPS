using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 特效程序贴图（D21：贴图先程序生成，以后再换手绘）。同一套函数两处用：
    ///   FxBuilder 生成后写成 Assets/Art/Fx/*.png（材质引用的是这些文件）；
    ///   运行时材质缺失（还没跑过 FxBuilder）时现场生成兜底。
    /// 全部确定性（哈希噪声，不用随机数）：重跑生成器结果逐字节相同，不会让 png 在 git 里变脏。
    /// RGB 存亮度（白 = 完全由粒子顶点色 / 材质色决定），A 存形状。按线性空间导入（不做 sRGB 转换）。
    /// </summary>
    public static class FxTextures
    {
        /// <summary>粒子贴图集：4 × 2 格，每格 256 px，格序见 <see cref="FxTexture"/></summary>
        public const string Atlas = "T_FxAtlas";
        /// <summary>朝向相机的光晕片（径向衰减）</summary>
        public const string Glow = "T_Fx_Glow";
        /// <summary>光柱：横向中间亮、纵向自下而上淡出</summary>
        public const string BeamFade = "T_Fx_BeamFade";
        /// <summary>竖直光墙（冲击环的光带）：只做纵向淡出，底边最亮</summary>
        public const string Band = "T_Fx_Band";
        /// <summary>线状特效（曳光、光束、闪电）的横截面：中间白热、两边柔和衰减</summary>
        public const string Line = "T_Fx_Line";

        public const int AtlasColumns = 4, AtlasRows = 2, AtlasCell = 256;

        public static readonly string[] All = { Atlas, Glow, BeamFade, Band, Line };

        /// <summary>按名字生成贴图（可读、带 mip、线性空间）；名字不认识返回 null</summary>
        public static Texture2D Create(string name)
        {
            return name switch
            {
                Atlas => MakeAtlas(),
                Glow => Make(64, 64, TextureWrapMode.Clamp, GlowPixel),
                BeamFade => Make(32, 64, TextureWrapMode.Clamp, BeamFadePixel),
                Band => Make(8, 64, TextureWrapMode.Clamp, BandPixel),
                Line => Make(8, 64, TextureWrapMode.Clamp, LinePixel),
                _ => null,
            };
        }

        delegate Color PixelFn(float u, float v);

        static Texture2D Make(int w, int h, TextureWrapMode wrap, PixelFn fn)
        {
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, true, true) { wrapMode = wrap, filterMode = FilterMode.Bilinear };
            var px = new Color32[w * h];
            for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                px[y * w + x] = fn((x + 0.5f) / w, (y + 0.5f) / h);
            tex.SetPixels32(px);
            tex.Apply(true);
            return tex;
        }

        // ───────────── 贴图集 ─────────────

        static Texture2D MakeAtlas()
        {
            const int n = AtlasCell;
            int w = n * AtlasColumns, h = n * AtlasRows;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, true, true) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var px = new Color32[w * h];
            for (int cell = 0; cell < AtlasColumns * AtlasRows; cell++)
            {
                // Shuriken 的帧 0 在左上角：第 0 行是贴图的上半部分（像素 y 大的那一半）
                int cx = cell % AtlasColumns, cy = AtlasRows - 1 - cell / AtlasColumns;
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    // 格内坐标 [-1, 1]，y 朝上；四周留 8% 透明边，防止低 mip 串格
                    float px01 = (x + 0.5f) / n * 2 - 1, py01 = (y + 0.5f) / n * 2 - 1;
                    var c = Cell((FxTexture)cell, px01 / 0.92f, py01 / 0.92f);
                    px[(cy * n + y) * w + cx * n + x] = c;
                }
            }
            tex.SetPixels32(px);
            tex.Apply(true);
            return tex;
        }

        /// <summary>一格的像素：p 为格内坐标（[-1, 1]，y 朝上，超出 1 的部分必须透明）</summary>
        static Color Cell(FxTexture kind, float x, float y)
        {
            float d2 = x * x + y * y, d = Mathf.Sqrt(d2);
            if (d >= 1.0f && kind != FxTexture.Flare) return new Color(1, 1, 1, 0);
            switch (kind)
            {
                case FxTexture.Glow:
                {
                    // 柔光：平方衰减；中心再叠一点更陡的核心（加法混合下读作白热）
                    float f = Mathf.Clamp01(1 - d2);
                    return new Color(1, 1, 1, Mathf.Clamp01(f * f * 0.85f + Mathf.Pow(f, 10) * 0.15f));
                }
                case FxTexture.Spark:
                {
                    float f = Mathf.Clamp01(1 - d2);
                    return new Color(1, 1, 1, Mathf.Clamp01(f * f * f * 0.7f + Smooth(0.22f, 0f, d2)));
                }
                case FxTexture.Streak:
                {
                    // 圆对称的窄高斯：拉伸广告牌按速度拉长就是一道拉丝，不依赖贴图朝向
                    float core = Mathf.Exp(-d2 * 9f);
                    return new Color(1, 1, 1, Mathf.Clamp01(core * 1.1f) * Smooth(1f, 0.85f, d));
                }
                case FxTexture.Smoke:
                {
                    // 烟团：边缘被噪声啃得不规则，团内有起伏，上亮下暗
                    float n = Fbm(x * 2.3f + 11.7f, y * 2.3f + 3.1f, 7);
                    float edge = 0.78f + 0.2f * (n - 0.5f) * 2;
                    float a = Smooth(edge, 0.05f, d) * (0.72f + 0.28f * Fbm(x * 4.1f, y * 4.1f, 13)) * 0.95f;
                    float lum = 0.78f + 0.22f * (y * 0.5f + 0.5f);
                    return new Color(lum, lum, lum, Mathf.Clamp01(a));
                }
                case FxTexture.Ring:
                {
                    float r = (d - 0.8f) / 0.07f;
                    return new Color(1, 1, 1, Mathf.Exp(-r * r));
                }
                case FxTexture.Chunk:
                {
                    // 碎屑：硬边菱形（边缘带一点噪声缺口），上亮下暗
                    float m = Mathf.Abs(x) + Mathf.Abs(y * 1.15f);
                    float edge = 0.8f + 0.12f * (Fbm(x * 3f + 5f, y * 3f + 9f, 3) - 0.5f);
                    float a = Mathf.Clamp01((edge - m) / 0.04f);
                    float lum = (0.55f + 0.6f * (y * 0.5f + 0.5f)) / 1.15f;
                    return new Color(lum, lum, lum, a);
                }
                case FxTexture.Flare:
                {
                    // 四角星芒：两道互相垂直的细长光条 + 白热核心，整体随半径收掉
                    if (d >= 1) return new Color(1, 1, 1, 0);
                    float ax = Mathf.Abs(x), ay = Mathf.Abs(y);
                    float rays = Mathf.Max(Mathf.Exp(-ax * 16f) * Mathf.Exp(-ay * 2.2f), Mathf.Exp(-ay * 16f) * Mathf.Exp(-ax * 2.2f));
                    float core = Mathf.Exp(-d2 * 28f);
                    return new Color(1, 1, 1, Mathf.Clamp01((rays + core) * Smooth(1f, 0.6f, d)));
                }
                case FxTexture.Dust:
                {
                    float n = Fbm(x * 1.8f + 2.3f, y * 1.8f + 17.9f, 21);
                    float a = Mathf.Pow(Smooth(1f, 0f, d), 1.5f) * (0.55f + 0.45f * n) * 0.85f;
                    float lum = 0.85f + 0.15f * (y * 0.5f + 0.5f);
                    return new Color(lum, lum, lum, Mathf.Clamp01(a));
                }
            }
            return new Color(1, 1, 1, 0);
        }

        // ───────────── 单张贴图 ─────────────

        static Color GlowPixel(float u, float v)
        {
            float d = new Vector2(u * 2 - 1, v * 2 - 1).magnitude;
            return new Color(1, 1, 1, Mathf.Pow(Mathf.Clamp01(1 - d), 2.2f));
        }

        static Color BeamFadePixel(float u, float v)
        {
            float x = Mathf.Abs(u * 2 - 1);
            float a = Mathf.Pow(1 - x, 2.2f) * Mathf.Pow(1 - v, 1.4f) * Mathf.SmoothStep(0, 1, v * 12);
            return new Color(1, 1, 1, a);
        }

        static Color BandPixel(float u, float v)
        {
            // 底边一道亮线 + 向上 (1 − v)^1.7 淡出（Three.js BAND_FRAG）
            float a = Mathf.Pow(1 - v, 1.7f);
            float lum = Mathf.Lerp(0.75f, 1f, Smooth(0.12f, 0f, v));
            return new Color(lum, lum, lum, a);
        }

        static Color LinePixel(float u, float v)
        {
            // 横截面（v 方向）：高斯光晕 + 更窄的白热核心
            float x = v * 2 - 1;
            float halo = Mathf.Exp(-x * x * 4.5f);
            float core = Mathf.Exp(-x * x * 40f);
            return new Color(1, 1, 1, Mathf.Clamp01(halo * 0.6f + core * 0.55f));
        }

        // ───────────── 噪声 ─────────────

        static float Smooth(float e0, float e1, float x)
        {
            float t = Mathf.Clamp01((x - e0) / (e1 - e0));
            return t * t * (3 - 2 * t);
        }

        static float Hash(int x, int y, int seed)
        {
            unchecked
            {
                uint h = (uint)(x * 374761393 + y * 668265263 + seed * 362437);
                h = (h ^ (h >> 13)) * 1274126177u;
                h ^= h >> 16;
                return (h & 0xFFFFFF) / 16777215f;
            }
        }

        static float ValueNoise(float x, float y, int seed)
        {
            int xi = Mathf.FloorToInt(x), yi = Mathf.FloorToInt(y);
            float fx = x - xi, fy = y - yi;
            fx = fx * fx * (3 - 2 * fx);
            fy = fy * fy * (3 - 2 * fy);
            float a = Hash(xi, yi, seed), b = Hash(xi + 1, yi, seed);
            float c = Hash(xi, yi + 1, seed), d = Hash(xi + 1, yi + 1, seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
        }

        /// <summary>4 层分形值噪声，结果约在 [0, 1]</summary>
        static float Fbm(float x, float y, int seed)
        {
            float sum = 0, amp = 0.5f, norm = 0;
            for (int i = 0; i < 4; i++)
            {
                sum += amp * ValueNoise(x, y, seed + i * 31);
                norm += amp;
                x = x * 2.03f + 1.7f;
                y = y * 2.03f - 0.9f;
                amp *= 0.5f;
            }
            return sum / norm;
        }
    }
}
