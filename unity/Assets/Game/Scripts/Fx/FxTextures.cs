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
        /// <summary>粒子贴图集：4 × 8 格（1024 × 2048），每格 256 px，格序见 <see cref="FxTexture"/></summary>
        public const string Atlas = "T_FxAtlas";
        /// <summary>
        /// 贴花图集（弹孔 / 焦痕 / 溅痕）：4 × 2 格，每格 256 px，格序见 <see cref="FxDecalKind"/>。
        /// 三个通道是三张遮罩：R = 压暗（焦黑、坑底），G = 余热（发光的位置），B = 提亮（冰裂纹、金属擦痕、沙坑翻起的边），A = 1
        /// </summary>
        public const string DecalAtlas = "T_Fx_DecalAtlas";
        /// <summary>第一人称枪口火焰：左格 = 正面星芒，右格 = 侧面火舌（根部在格子左边，沿 +u 伸出）</summary>
        public const string Muzzle = "T_Fx_Muzzle";
        /// <summary>朝向相机的光晕片（径向衰减）</summary>
        public const string Glow = "T_Fx_Glow";
        /// <summary>光柱：横向中间亮、纵向自下而上淡出</summary>
        public const string BeamFade = "T_Fx_BeamFade";
        /// <summary>竖直光墙（冲击环的光带）：只做纵向淡出，底边最亮</summary>
        public const string Band = "T_Fx_Band";
        /// <summary>线状特效（曳光、光束、闪电）的横截面：中间白热、两边柔和衰减</summary>
        public const string Line = "T_Fx_Line";

        public const int AtlasColumns = 4, AtlasRows = 8, AtlasCell = 256;
        public const int DecalColumns = 4, DecalRows = 2;

        public static readonly string[] All = { Atlas, Glow, BeamFade, Band, Line, DecalAtlas, Muzzle };

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
                DecalAtlas => MakeDecalAtlas(),
                Muzzle => Make(256, 128, TextureWrapMode.Clamp, MuzzlePixel),
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
                case FxTexture.Shard:
                {
                    // 尖三角：三条边的有向距离取最小（里面为正），v2→v0 那条边最亮（断口反光）
                    var q = new Vector2(x, y);
                    float e0 = EdgeDist(q, ShardA, ShardB), e1 = EdgeDist(q, ShardB, ShardC), e2 = EdgeDist(q, ShardC, ShardA);
                    float inside = Mathf.Min(e0, Mathf.Min(e1, e2));
                    float a = Mathf.Clamp01(inside / 0.025f + 0.5f);
                    float lum = Mathf.Min(1, 0.55f + 0.45f * Mathf.Exp(-e2 * e2 / 0.012f) + 0.15f * Mathf.Exp(-inside * 9f));
                    return new Color(lum, lum, lum, a);
                }
                case FxTexture.Hex:
                {
                    // 平顶六边形：亮边 + 很淡的芯
                    float ax = Mathf.Abs(x), ay = Mathf.Abs(y);
                    float h = Mathf.Max(ax * 0.866f + ay * 0.5f, ay);
                    float r = (h - 0.74f) / 0.07f;
                    float rim = Mathf.Exp(-r * r);
                    float fill = h < 0.74f ? 0.16f + 0.1f * h : 0;
                    return new Color(1, 1, 1, Mathf.Clamp01(rim + fill) * Smooth(0.86f, 0.8f, h));
                }
                case FxTexture.Star:
                {
                    // 胖乎乎的卡通五角星：半径在尖角（1）和凹处（0）之间按三角波插值，尖角朝上
                    float ang = Mathf.Atan2(x, y);
                    float k = ang / (Mathf.PI * 2) * 5f;
                    k -= Mathf.Floor(k);
                    float t = Mathf.Abs(k * 2 - 1);
                    float R = 0.42f + 0.52f * t;
                    float a = Mathf.Clamp01((R - d) / 0.03f + 0.5f);
                    float lum = Mathf.Min(1, 1f - 0.2f * d + 0.1f * Mathf.Exp(-d2 * 20f));
                    return new Color(lum, lum, lum, a);
                }
                case FxTexture.Drop:
                {
                    // 水滴：下面一个圆，往上收成尖；左上一点高光
                    const float cy = -0.3f, cr = 0.52f, tip = 0.88f;
                    float inside;
                    if (y <= cy) inside = cr - Mathf.Sqrt(x * x + (y - cy) * (y - cy));
                    else
                    {
                        float k = Mathf.Clamp01((y - cy) / (tip - cy));
                        float w = cr * Mathf.Pow(1 - k, 1.25f);
                        inside = Mathf.Min(w - Mathf.Abs(x), tip - y);
                    }
                    float a = Mathf.Clamp01(inside / 0.03f + 0.5f);
                    float hx = x + 0.18f, hy = y + 0.12f;
                    float hl = Mathf.Exp(-(hx * hx + hy * hy) * 30f);
                    float lum = Mathf.Min(1, 0.62f + 0.25f * Smooth(0.2f, -0.4f, x) + 0.45f * hl);
                    return new Color(lum, lum, lum, a);
                }
                case FxTexture.Flame:
                {
                    // 火舌：底部圆、往上收尖并左右摆，边缘被噪声啃过；下半部的芯更亮
                    float k = Mathf.Clamp01((y + 0.85f) / 1.75f);
                    float sway = 0.12f * Mathf.Sin(k * 5.2f) * k;
                    float w = 0.5f * Mathf.Pow(1 - k, 0.75f) * (0.6f + 0.4f * Mathf.Sin(Mathf.Min(1, k * 3.2f) * 1.5708f));
                    float n = Fbm(x * 3.1f + 4.2f, y * 2.2f - 1.3f, 41) - 0.5f;
                    float edge = w + n * 0.14f * (0.4f + k) - Mathf.Abs(x - sway);
                    float a = Mathf.Clamp01(edge / 0.06f + 0.5f) * Smooth(-0.95f, -0.8f, y);
                    float core = Mathf.Clamp01(edge / Mathf.Max(0.05f, w * 0.6f)) * (1 - k);
                    float lum = 0.55f + 0.45f * core;
                    return new Color(lum, lum, lum, Mathf.Clamp01(a * (0.75f + 0.25f * core)));
                }
                case FxTexture.Crackle:
                {
                    // 电弧碎纹：横穿格子的一段折线，细芯 + 光晕
                    float best = 9;
                    var p = new Vector2(x, y);
                    for (int i = 0; i < CrackPts.Length - 1; i++) best = Mathf.Min(best, SegDist(p, CrackPts[i], CrackPts[i + 1]));
                    float core = Mathf.Exp(-best * best / 0.0012f);
                    float halo = Mathf.Exp(-best * best / 0.02f) * 0.35f;
                    return new Color(1, 1, 1, Mathf.Clamp01(core + halo) * Smooth(0.98f, 0.8f, Mathf.Abs(x)));
                }
                case FxTexture.Plate:
                {
                    // 甲片：切掉一个角的长方形，上边一道高光、一颗铆钉
                    float ex = 0.62f - Mathf.Abs(x), ey = 0.42f - Mathf.Abs(y);
                    float chamfer = (0.9f - (x + y)) * 0.7071f;
                    float inside = Mathf.Min(Mathf.Min(ex, ey), chamfer);
                    float a = Mathf.Clamp01(inside / 0.025f + 0.5f);
                    float top = y > 0 ? Mathf.Exp(-ey * ey / 0.004f) : 0;
                    float rx = x + 0.38f, ry = y + 0.15f;
                    float rivet = Mathf.Exp(-(rx * rx + ry * ry) * 160f);
                    float lum = Mathf.Min(1, 0.5f + 0.25f * (y * 0.5f + 0.5f) + 0.35f * top + 0.5f * rivet);
                    return new Color(lum, lum, lum, a);
                }
                case FxTexture.Glyph:
                {
                    // 符文：方折笔画（缺口方框 + 一横一竖 + 小勾）
                    float best = 9;
                    var p = new Vector2(x, y);
                    for (int i = 0; i < GlyphSegs.Length; i += 2) best = Mathf.Min(best, SegDist(p, GlyphSegs[i], GlyphSegs[i + 1]));
                    float core = Smooth(0.075f, 0.045f, best);
                    float halo = Mathf.Exp(-best * best / 0.03f) * 0.3f;
                    return new Color(1, 1, 1, Mathf.Clamp01(core + halo));
                }
                case FxTexture.IceStar:
                {
                    // 冰晶星芒：三道贯穿的长光芒（0° / 60° / 120°，六个尖）+ 错开 30° 的三道短光芒，越往外越细；白热核心 + 一圈柔光
                    float rays = 0;
                    for (int k = 0; k < 6; k++)
                    {
                        float a0 = k * Mathf.PI / 6f;
                        float ca = Mathf.Cos(a0), sa = Mathf.Sin(a0);
                        float along = Mathf.Abs(ca * x + sa * y), perp = Mathf.Abs(-sa * x + ca * y);
                        float len = k % 2 == 0 ? 1f : 0.48f;
                        float u = Mathf.Clamp01(along / len);
                        float w = 0.012f + 0.03f * (1 - u);
                        rays = Mathf.Max(rays, Mathf.Exp(-perp * perp / (w * w)) * Mathf.Pow(1 - u, 1.6f) * (k % 2 == 0 ? 1f : 0.7f));
                    }
                    float core = Mathf.Exp(-d2 * 38f) + 0.3f * Mathf.Exp(-d2 * 7f);
                    return new Color(1, 1, 1, Mathf.Clamp01((rays + core) * Smooth(1f, 0.82f, d)));
                }
                case FxTexture.Snowflake:
                {
                    // 雪花：极坐标折到 0°–30° 的半个扇区（六臂、左右对称），主臂沿 +x；臂上三对 60° 的分叉，中心一块六边形
                    float ang = Mathf.Atan2(y, x);
                    const float sector = Mathf.PI / 3f;
                    float a = Mathf.Abs(Mathf.Repeat(ang + sector * 0.5f, sector) - sector * 0.5f);
                    var q = new Vector2(d * Mathf.Cos(a), d * Mathf.Sin(a));
                    var b60 = new Vector2(0.5f, 0.866f);
                    float best = SegDist(q, Vector2.zero, new Vector2(0.86f, 0));
                    best = Mathf.Min(best, SegDist(q, new Vector2(0.34f, 0), new Vector2(0.34f, 0) + b60 * 0.24f));
                    best = Mathf.Min(best, SegDist(q, new Vector2(0.58f, 0), new Vector2(0.58f, 0) + b60 * 0.17f));
                    best = Mathf.Min(best, SegDist(q, new Vector2(0.75f, 0), new Vector2(0.75f, 0) + b60 * 0.09f));
                    float stroke = Smooth(0.05f, 0.028f, best);
                    float hex = Mathf.Max(Mathf.Abs(x) * 0.866f + Mathf.Abs(y) * 0.5f, Mathf.Abs(y));
                    float plate = Smooth(0.17f, 0.14f, hex) * 0.85f;
                    float glow = Mathf.Exp(-best * best / 0.006f) * 0.25f;
                    float lum = Mathf.Min(1, 0.85f + 0.15f * Mathf.Exp(-d2 * 12f));
                    return new Color(lum, lum, lum, Mathf.Clamp01(Mathf.Max(stroke, plate) + glow) * Smooth(1f, 0.9f, d));
                }
                case FxTexture.Crystal:
                {
                    // 冰块：竖长的六棱柱剪影（上下收尖），中线左边是背光面、右边是受光面，中线一道亮棱，外轮廓一圈亮边
                    var q = new Vector2(x, y);
                    float inside = 9;
                    for (int i = 0; i < CrystalPts.Length; i++) inside = Mathf.Min(inside, EdgeDist(q, CrystalPts[i], CrystalPts[(i + 1) % CrystalPts.Length]));
                    float a = Mathf.Clamp01(inside / 0.025f + 0.5f);
                    float ridge = Mathf.Exp(-x * x / 0.002f) * Smooth(0.95f, 0.5f, Mathf.Abs(y));
                    float rim = Mathf.Exp(-inside * inside / 0.0015f);
                    float face = x > 0 ? 0.92f - 0.2f * (y * 0.5f + 0.5f) : 0.55f + 0.15f * (y * 0.5f + 0.5f);
                    float lum = Mathf.Min(1, face + 0.35f * ridge + 0.3f * rim);
                    return new Color(lum, lum, lum, a * 0.96f);
                }
                case FxTexture.Paper:
                {
                    // 纸屑：略微扭过去的长方形（0.62 × 0.4 的半宽），右上角卷起一个暗三角，下长边稍亮
                    float rx = x * 0.97f + y * 0.24f, ry = -x * 0.24f + y * 0.97f;
                    float ex = 0.62f - Mathf.Abs(rx), ey = 0.4f - Mathf.Abs(ry);
                    float curlLine = (rx + ry - 0.62f) * 0.7071f;
                    float inside = Mathf.Min(ex, ey);
                    float a = Mathf.Clamp01(inside / 0.02f + 0.5f);
                    float curl = Smooth(-0.02f, 0.06f, curlLine);
                    float lum = (0.8f + 0.2f * (ry * 0.5f + 0.5f)) * (1 - 0.45f * curl) + (ry < 0 ? 0.15f * Mathf.Exp(-ey * ey / 0.002f) : 0f);
                    lum = Mathf.Min(1, lum * (0.9f + 0.1f * Fbm(x * 9f, y * 9f, 47)));
                    return new Color(lum, lum, lum, a);
                }
                case FxTexture.Cinder:
                {
                    // 炭渣：噪声啃过的不规则块；外壳暗（0.3），裂缝 / 芯亮（1）——加法混合下读作一颗发红的炭火
                    float ang = Mathf.Atan2(y, x);
                    float edge = 0.62f + 0.12f * Mathf.Sin(ang * 5f + 0.8f) + 0.14f * (Fbm(x * 3.3f + 2f, y * 3.3f - 5f, 53) - 0.5f) * 2f;
                    float a = Mathf.Clamp01((edge - d) / 0.04f + 0.5f);
                    float n = Fbm(x * 5.5f + 7f, y * 5.5f + 1f, 59);
                    float crack = 1 - Smooth(0.0f, 0.08f, Mathf.Abs(n - 0.5f));
                    float core = Smooth(0.45f, 0f, d);
                    float lum = Mathf.Clamp01(0.3f + 0.7f * Mathf.Max(crack * Smooth(edge, edge * 0.5f, d), core * 0.8f));
                    return new Color(lum, lum, lum, a);
                }
                case FxTexture.Link:
                {
                    // 链环：椭圆环（中线半轴 0.4 × 0.78，环宽约 0.17），左上受光
                    float ex = x / 0.4f, ey = y / 0.78f;
                    float r = Mathf.Sqrt(ex * ex + ey * ey);
                    float ring = Mathf.Abs(r - 1f) * 0.42f;
                    float a = Mathf.Clamp01((0.085f - ring) / 0.02f + 0.5f);
                    float lum = Mathf.Clamp01(0.45f + 0.35f * Mathf.Clamp01((-x + y) * 0.7f + 0.5f) + 0.35f * Mathf.Exp(-ring * ring / 0.0006f));
                    return new Color(lum, lum, lum, a);
                }
                case FxTexture.Blob:
                {
                    // 液团：圆（半径 0.78），边缘稍暗、中间亮，左上一颗高光
                    float a = Mathf.Clamp01((0.78f - d) / 0.03f + 0.5f);
                    float hx = x + 0.28f, hy = y - 0.3f;
                    float spec = Mathf.Exp(-(hx * hx + hy * hy) * 26f);
                    float lum = Mathf.Clamp01(0.62f + 0.38f * Smooth(0.78f, 0.1f, d) + 0.6f * spec);
                    return new Color(lum, lum, lum, a);
                }
            }
            return new Color(1, 1, 1, 0);
        }

        /// <summary>冰块（六棱柱剪影）的顶点，逆时针</summary>
        static readonly Vector2[] CrystalPts =
        {
            new(0f, -0.95f), new(0.34f, -0.62f), new(0.34f, 0.58f), new(0f, 0.95f), new(-0.34f, 0.58f), new(-0.34f, -0.62f),
        };

        static readonly Vector2 ShardA = new(-0.55f, -0.78f), ShardB = new(0.62f, -0.42f), ShardC = new(-0.08f, 0.92f);

        static readonly Vector2[] CrackPts =
        {
            new(-0.92f, 0.08f), new(-0.55f, 0.32f), new(-0.18f, -0.22f), new(0.12f, 0.18f), new(0.46f, -0.28f), new(0.92f, -0.02f),
        };

        /// <summary>符文笔画（每两个点一段）</summary>
        static readonly Vector2[] GlyphSegs =
        {
            new(-0.6f, 0.62f), new(0.25f, 0.62f), new(0.6f, 0.62f), new(0.6f, -0.62f), new(0.6f, -0.62f), new(-0.6f, -0.62f), new(-0.6f, -0.62f), new(-0.6f, 0.2f),
            new(-0.3f, 0.08f), new(0.32f, 0.08f), new(0f, 0.38f), new(0f, -0.36f), new(0f, -0.36f), new(0.24f, -0.2f),
        };

        /// <summary>q 到有向边 a→b 的距离（逆时针三角形里面为正）</summary>
        static float EdgeDist(Vector2 q, Vector2 a, Vector2 b)
        {
            var e = b - a;
            var n = new Vector2(-e.y, e.x).normalized;
            return Vector2.Dot(q - a, n);
        }

        static float SegDist(Vector2 p, Vector2 a, Vector2 b)
        {
            var ab = b - a;
            float t = Mathf.Clamp01(Vector2.Dot(p - a, ab) / Mathf.Max(1e-6f, ab.sqrMagnitude));
            return (p - (a + ab * t)).magnitude;
        }

        // ───────────── 贴花图集 ─────────────

        static Texture2D MakeDecalAtlas()
        {
            const int n = AtlasCell;
            int w = n * DecalColumns, h = n * DecalRows;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, true, true) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var px = new Color32[w * h];
            for (int cell = 0; cell < DecalColumns * DecalRows; cell++)
            {
                // 第 0 行在贴图上半部分（同粒子图集；着色器按同样的行序取格）
                int cx = cell % DecalColumns, cy = DecalRows - 1 - cell / DecalColumns;
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float px01 = (x + 0.5f) / n * 2 - 1, py01 = (y + 0.5f) / n * 2 - 1;
                    px[(cy * n + y) * w + cx * n + x] = DecalCell((FxDecalKind)cell, px01 / 0.94f, py01 / 0.94f);
                }
            }
            tex.SetPixels32(px);
            tex.Apply(true);
            return tex;
        }

        /// <summary>贴花一格：R 压暗、G 余热、B 提亮（0..1），格外为 0</summary>
        static Color DecalCell(FxDecalKind kind, float x, float y)
        {
            float d = Mathf.Sqrt(x * x + y * y);
            if (d >= 1f) return new Color(0, 0, 0, 1);
            float ang = Mathf.Atan2(y, x);
            var p = new Vector2(x, y);
            float dark = 0, heat = 0, light = 0;
            switch (kind)
            {
                case FxDecalKind.HoleStone:
                {
                    // 弹坑：黑芯、不规则的焦边、几道放射裂纹、坑沿一圈崩开的亮碴
                    float rough = 0.5f + 0.1f * Mathf.Sin(ang * 7 + 1.3f) + 0.08f * (Fbm(x * 4, y * 4, 5) - 0.5f);
                    dark = Mathf.Max(Smooth(0.24f, 0.14f, d), Smooth(rough, 0.18f, d) * 0.62f);
                    float rays = Mathf.Pow(Mathf.Abs(Mathf.Sin(ang * 3.5f + 0.7f * Mathf.Sin(ang * 2))), 40f) * Smooth(0.78f, 0.25f, d);
                    dark = Mathf.Max(dark, rays * 0.7f);
                    heat = Smooth(0.42f, 0.06f, d);
                    float rim = (d - 0.27f) / 0.05f;
                    light = Mathf.Exp(-rim * rim) * 0.35f * (0.6f + 0.4f * Fbm(x * 9, y * 9, 7));
                    break;
                }
                case FxDecalKind.HoleSand:
                {
                    // 沙坑：软的浅凹，中间略暗，坑沿翻起一圈亮沙
                    dark = Smooth(0.62f, 0.05f, d) * 0.42f;
                    float rim = (d - 0.62f) / 0.12f;
                    light = Mathf.Exp(-rim * rim) * 0.45f * (0.7f + 0.3f * Fbm(x * 6, y * 6, 9));
                    heat = Smooth(0.28f, 0f, d) * 0.35f;
                    break;
                }
                case FxDecalKind.HoleIce:
                {
                    // 冰：小黑点 + 一圈崩白 + 星状白裂纹（主裂纹带分叉）
                    dark = Smooth(0.13f, 0.06f, d) * 0.7f;
                    float spall = (d - 0.3f) / 0.09f;
                    light = Mathf.Exp(-spall * spall) * 0.75f * Smooth(0.5f, 0.2f, d);
                    float cracks = 0;
                    for (int i = 0; i < 7; i++)
                    {
                        float a0 = i * 0.8976f + 0.35f * Mathf.Sin(i * 2.7f);
                        float len = 0.55f + 0.35f * Hash(i, 3, 11);
                        var dir = new Vector2(Mathf.Cos(a0), Mathf.Sin(a0));
                        float seg = SegDist(p, dir * 0.1f, dir * len);
                        cracks = Mathf.Max(cracks, Mathf.Exp(-seg * seg / 0.0004f) * Smooth(len, len * 0.5f, d));
                        var br = new Vector2(Mathf.Cos(a0 + 0.6f), Mathf.Sin(a0 + 0.6f));
                        float seg2 = SegDist(p, dir * (len * 0.5f), dir * (len * 0.5f) + br * 0.25f);
                        cracks = Mathf.Max(cracks, Mathf.Exp(-seg2 * seg2 / 0.0003f) * 0.8f);
                    }
                    light = Mathf.Max(light, cracks * 0.9f);
                    break;
                }
                case FxDecalKind.HoleMetal:
                {
                    // 金属：浅坑压暗，一圈亮擦痕，中心烧红
                    dark = Smooth(0.26f, 0.12f, d) * 0.55f;
                    float rim = (d - 0.29f) / 0.06f;
                    light = Mathf.Exp(-rim * rim) * 0.65f + Smooth(0.6f, 0.3f, d) * 0.12f * Fbm(x * 12, y * 3, 13);
                    heat = Smooth(0.36f, 0.04f, d);
                    break;
                }
                case FxDecalKind.Scorch:
                {
                    // 焦痕：噪声啃出来的大片焦黑，中间更黑；中部零星火星还在发光
                    float n = Fbm(x * 2.2f + 3.1f, y * 2.2f - 7.7f, 17);
                    float edge = 0.78f + 0.22f * (n - 0.5f) * 2;
                    dark = Smooth(edge, edge - 0.35f, d) * (0.55f + 0.45f * Smooth(0.7f, 0f, d)) * (0.85f + 0.15f * Fbm(x * 8, y * 8, 19));
                    float spark = Fbm(x * 7.3f, y * 7.3f, 23);
                    heat = Smooth(0.58f, 0.75f, spark) * Smooth(0.75f, 0.2f, d) + Smooth(0.35f, 0f, d) * 0.5f;
                    break;
                }
                case FxDecalKind.Splat:
                {
                    // 溅痕（蚀液）：一大滩 + 周围几滴；G 是发光的液面
                    float n = Fbm(x * 2.6f, y * 2.6f, 29);
                    float body = Smooth(0.62f + 0.18f * (n - 0.5f), 0.4f, d);
                    float drops = 0;
                    for (int i = 0; i < 6; i++)
                    {
                        float a0 = i * 1.047f + Hash(i, 1, 31) * 0.8f;
                        float r0 = 0.7f + 0.2f * Hash(i, 2, 31);
                        var c = new Vector2(Mathf.Cos(a0), Mathf.Sin(a0)) * r0;
                        drops = Mathf.Max(drops, Smooth(0.09f + 0.05f * Hash(i, 3, 31), 0.04f, (p - c).magnitude));
                    }
                    float liquid = Mathf.Max(body, drops);
                    dark = liquid * 0.45f;
                    heat = liquid * (0.55f + 0.45f * n);
                    break;
                }
                case FxDecalKind.Crack:
                {
                    // 地裂：几条主裂缝（带一道弯），缝里发红
                    float cr = 0;
                    for (int i = 0; i < 5; i++)
                    {
                        float a0 = i * 1.2566f + 0.4f * Hash(i, 5, 37);
                        var dir = new Vector2(Mathf.Cos(a0), Mathf.Sin(a0));
                        var bend = new Vector2(-dir.y, dir.x) * (0.15f * (Hash(i, 6, 37) - 0.5f));
                        float s = Mathf.Min(SegDist(p, Vector2.zero, dir * 0.5f + bend), SegDist(p, dir * 0.5f + bend, dir * 0.92f - bend));
                        cr = Mathf.Max(cr, Mathf.Exp(-s * s / 0.0009f) * Smooth(0.95f, 0.6f, d));
                    }
                    dark = Mathf.Max(cr, Smooth(0.3f, 0f, d) * 0.5f);
                    heat = cr * 0.8f;
                    break;
                }
                case FxDecalKind.Frost:
                {
                    // 霜斑：噪声脊线组成的羽状白霜，边缘渐隐
                    float n = Fbm(x * 3.5f, y * 3.5f, 43);
                    float ridge = 1 - Mathf.Abs(n * 2 - 1);
                    light = Mathf.Pow(ridge, 4f) * Smooth(0.95f, 0.4f, d) * 0.85f + Smooth(0.5f, 0f, d) * 0.25f;
                    break;
                }
            }
            return new Color(Mathf.Clamp01(dark), Mathf.Clamp01(heat), Mathf.Clamp01(light), 1);
        }

        // ───────────── 枪口火焰 ─────────────

        static Color MuzzlePixel(float u, float v)
        {
            // 左格：正面星芒（8 道长短交替的尖刺 + 白热芯）；右格：侧面火舌（根部在格子左边，往 +u 伸出，边缘锯齿）
            if (u < 0.5f)
            {
                float x = u * 4 - 1, y = v * 2 - 1;
                float d = Mathf.Sqrt(x * x + y * y);
                float ang = Mathf.Atan2(y, x);
                float spikes = Mathf.Pow(Mathf.Abs(Mathf.Cos(ang * 4)), 18f) * (0.65f + 0.35f * Mathf.Abs(Mathf.Cos(ang * 2)));
                float rays = spikes * Smooth(1f, 0.1f, d);
                float core = Mathf.Exp(-d * d * 14f);
                float a = Mathf.Clamp01(rays + core) * Smooth(1f, 0.92f, d);
                float lum = 0.7f + 0.3f * core;
                return new Color(lum, lum, lum, a);
            }
            else
            {
                float x = (u - 0.5f) * 2, y = v * 2 - 1;
                // 根部圆钝、往外收成尖，边缘带两三道小锯齿
                float w = 0.52f * Mathf.Pow(Mathf.Max(0, 1 - x), 1.15f) * Mathf.Sqrt(Mathf.Clamp01(x * 7f)) + 0.035f * Mathf.Sin(x * 38f) * (1 - x);
                float edge = w - Mathf.Abs(y);
                float a = Mathf.Clamp01(edge / 0.05f + 0.5f) * Smooth(1f, 0.9f, x);
                float core = Mathf.Clamp01(edge / Mathf.Max(0.04f, w * 0.5f)) * (1 - x);
                float lum = 0.6f + 0.4f * core;
                return new Color(lum, lum, lum, Mathf.Clamp01(a * (0.7f + 0.3f * core)));
            }
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
