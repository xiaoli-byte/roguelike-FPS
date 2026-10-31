using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>精英金环里的词缀纹样（形状语言见 docs/art/vfx/elite-affixes.md）</summary>
    public enum EliteSigil
    {
        /// <summary>没有词缀：内圈不画</summary>
        None,
        /// <summary>迅捷：三道卷云钩（流线 / 风），快速旋转</summary>
        Swift,
        /// <summary>坚盾：六角龟甲框 + 六颗角钉（方 / 稳），几乎不转，亮度跟护盾</summary>
        Shielded,
        /// <summary>爆裂：长短相间的十六芒火药星（尖角放射），原地跳动</summary>
        Volatile,
        /// <summary>狂暴：十二颗向内的锯齿獠牙（锯 / 咬），狂暴后高速旋转、心跳般收放</summary>
        Frenzied,
    }

    /// <summary>
    /// 精英金环与词缀纹样的程序贴图（Q 路，2026-10-31；进 Play 时生成一次、全场共用，不进 FxTextures 图集，不动现有图集格子）。
    /// 每张都是「明度 + 覆盖」：RGB 白 = 可着色的纹样、黑 = 墨色勾边 / 墨底，A = 覆盖。材质是普通透明混合（<see cref="FxMaterials.MakeAlpha"/>），
    /// 着色走 _BaseColor（HDR）：墨边乘什么色都还是墨，所以亮沙、雪地上靠墨边托出纹样，熔岩暗地上靠亮纹样本身（fx-style §2.3：墨 / 朱 / 鎏金）。
    /// 纹样是中尺度的粗线大形：缩到 25% 还认得出「金环 + 哪种词缀」，没有细密刻花和小字。
    /// </summary>
    public static class EliteSigilTextures
    {
        public const int Size = 192;

        /// <summary>
        /// 预热：进 Play 时（<see cref="EliteAffixes.Install"/>）就把五张都生成好——第一只精英出生那一帧不再卡几十毫秒（2×2 超采样逐像素算有向距离）
        /// </summary>
        public static void WarmUp()
        {
            _ = Ring;
            foreach (EliteSigil s in System.Enum.GetValues(typeof(EliteSigil))) _ = Sigil(s);
        }

        static Texture2D ring;
        static readonly Texture2D[] sigils = new Texture2D[5];

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            ring = null;
            for (int i = 0; i < sigils.Length; i++) sigils[i] = null;
        }

        /// <summary>
        /// 金环：外缘一道粗金带（外亮内略暗的两阶手绘倒角）+ 八颗菱形钉，内侧一道细金线 + 八道刻度，金带与细线之间铺半透明墨底，所有金线都带墨边
        /// </summary>
        public static Texture2D Ring => ring ? ring : ring = Build("Elite Gold Ring", RingPixel);

        /// <summary>某种词缀的纹样（None 返回 null）</summary>
        public static Texture2D Sigil(EliteSigil s)
        {
            if (s == EliteSigil.None) return null;
            int i = (int)s;
            if (sigils[i]) return sigils[i];
            System.Func<Vector2, Color> f = s switch
            {
                EliteSigil.Swift => SwiftPixel,
                EliteSigil.Shielded => ShieldPixel,
                EliteSigil.Volatile => VolatilePixel,
                _ => FrenzyPixel,
            };
            return sigils[i] = Build("Elite Sigil " + s, f);
        }

        // ───────────── 合成 ─────────────

        static Texture2D Build(string name, System.Func<Vector2, Color> pixel)
        {
            var tex = new Texture2D(Size, Size, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, name = name, filterMode = FilterMode.Trilinear, anisoLevel = 4 };
            var px = new Color32[Size * Size];
            // 2×2 超采样抗锯齿
            for (int y = 0; y < Size; y++)
            for (int x = 0; x < Size; x++)
            {
                Color acc = default;
                for (int sy = 0; sy < 2; sy++)
                for (int sx = 0; sx < 2; sx++)
                {
                    var p = new Vector2((x + 0.25f + sx * 0.5f) / Size * 2f - 1f, (y + 0.25f + sy * 0.5f) / Size * 2f - 1f);
                    var c = pixel(p);
                    acc.r += c.r * c.a;
                    acc.g += c.g * c.a;
                    acc.b += c.b * c.a;
                    acc.a += c.a;
                }
                float a = acc.a / 4f;
                float l = acc.a > 1e-4f ? acc.r / acc.a : 0;
                px[y * Size + x] = new Color(l, l, l, a);
            }
            tex.SetPixels32(px);
            tex.Apply(true, true);
            tex.hideFlags = HideFlags.DontSave;
            return tex;
        }

        /// <summary>图层叠加：先画墨边（形状外扩 ink 宽），再画纹样（明度 lum）</summary>
        static Color Layer(Color under, float sd, float lum, float ink = 0.035f, float inkAlpha = 0.92f)
        {
            float aa = 2.2f / Size;
            float cInk = Mathf.Clamp01(0.5f - (sd - ink) / aa);
            float cFill = Mathf.Clamp01(0.5f - sd / aa);
            var c = Over(under, new Color(0, 0, 0, cInk * inkAlpha));
            return Over(c, new Color(lum, lum, lum, cFill));
        }

        static Color Over(Color under, Color top)
        {
            float a = top.a + under.a * (1 - top.a);
            if (a < 1e-5f) return default;
            float l = (top.r * top.a + under.r * under.a * (1 - top.a)) / a;
            return new Color(l, l, l, a);
        }

        static float Ang(Vector2 p) => Mathf.Atan2(p.y, p.x);

        /// <summary>角度差（弧度，0..π）</summary>
        static float AngDist(float a, float b) => Mathf.Abs(Mathf.DeltaAngle(a * Mathf.Rad2Deg, b * Mathf.Rad2Deg)) * Mathf.Deg2Rad;

        /// <summary>两阶手绘倒角：外半亮、内半暗一档</summary>
        static float Bevel(float r, float mid, float hi = 1f, float lo = 0.78f) => r >= mid ? hi : lo;

        // ───────────── 金环 ─────────────

        static Color RingPixel(Vector2 p)
        {
            float r = p.magnitude, a = Ang(p);
            var c = default(Color);
            // 墨底（半透明，托住整圈）
            float sdBack = Mathf.Max(0.70f - r, r - 0.975f);
            c = Over(c, new Color(0, 0, 0, Mathf.Clamp01(0.5f - sdBack / (2.2f / Size)) * 0.5f));
            // 内侧细金线 r 0.76
            c = Layer(c, Mathf.Abs(r - 0.76f) - 0.016f, 0.72f, 0.026f);
            // 八道刻度（细线到金带）
            for (int k = 0; k < 8; k++)
            {
                float ak = k * Mathf.PI / 4f;
                float t = AngDist(a, ak) * r;
                float sd = Mathf.Max(t - 0.014f, Mathf.Max(0.775f - r, r - 0.84f));
                c = Layer(c, sd, 0.7f, 0.022f);
            }
            // 外缘粗金带 r 0.84–0.95
            c = Layer(c, Mathf.Abs(r - 0.895f) - 0.055f, Bevel(r, 0.9f), 0.03f);
            // 八颗菱形钉（压在金带上，错开刻度半格）
            for (int k = 0; k < 8; k++)
            {
                float ak = k * Mathf.PI / 4f + Mathf.PI / 8f;
                var cpos = new Vector2(Mathf.Cos(ak), Mathf.Sin(ak)) * 0.895f;
                var d = p - cpos;
                // 菱形：沿径向和切向的 L1
                var radial = cpos.normalized;
                var tang = new Vector2(-radial.y, radial.x);
                float u = Mathf.Abs(Vector2.Dot(d, radial)), v = Mathf.Abs(Vector2.Dot(d, tang));
                float sd = (u / 0.085f + v / 0.07f - 1f) * 0.06f;
                c = Layer(c, sd, 1f, 0.025f);
            }
            return c;
        }

        // ───────────── 词缀纹样（都画在 r ≤ 1 里，环带大致在 0.55–1）─────────────

        /// <summary>迅捷：三道卷云钩——圆头带卷心、尾巴沿圆周拖出 110° 渐细（逆时针甩出去的风），内侧一道细线</summary>
        static Color SwiftPixel(Vector2 p)
        {
            float r = p.magnitude, a = Ang(p);
            var c = default(Color);
            c = Layer(c, Mathf.Abs(r - 0.6f) - 0.012f, 0.65f, 0.02f);
            float best = 1f;
            for (int k = 0; k < 3; k++)
            {
                float a0 = k * Mathf.PI * 2f / 3f;
                float da = Mathf.Repeat(a - a0, Mathf.PI * 2f);
                const float span = 110f * Mathf.Deg2Rad;
                if (da <= span)
                {
                    float s = da / span;
                    float rc = 0.80f + 0.12f * s, w = 0.12f * Mathf.Pow(1f - s, 0.85f) + 0.012f;
                    best = Mathf.Min(best, Mathf.Abs(r - rc) - w);
                }
                // 圆头（在尾巴起点往回一点）
                float ah = a0 - 0.06f;
                var head = new Vector2(Mathf.Cos(ah), Mathf.Sin(ah)) * 0.80f;
                float dh = (p - head).magnitude - 0.135f;
                best = Mathf.Min(best, dh);
            }
            c = Layer(c, best, 0.95f);
            // 卷心：圆头里挖一个墨点
            for (int k = 0; k < 3; k++)
            {
                float ah = k * Mathf.PI * 2f / 3f - 0.1f;
                var eye = new Vector2(Mathf.Cos(ah), Mathf.Sin(ah)) * 0.79f;
                float d = (p - eye).magnitude - 0.045f;
                c = Over(c, new Color(0, 0, 0, Mathf.Clamp01(0.5f - d / (2.2f / Size)) * 0.95f));
            }
            return c;
        }

        static float SdHex(Vector2 p, float r)
        {
            // 平顶六边形的有向距离（iq）
            var k = new Vector3(-0.866025404f, 0.5f, 0.577350269f);
            p = new Vector2(Mathf.Abs(p.x), Mathf.Abs(p.y));
            float d = Mathf.Min(Vector2.Dot(new Vector2(k.x, k.y), p), 0f);
            p -= 2f * d * new Vector2(k.x, k.y);
            p -= new Vector2(Mathf.Clamp(p.x, -k.z * r, k.z * r), r);
            return p.magnitude * Mathf.Sign(p.y);
        }

        /// <summary>坚盾：粗六角龟甲框 + 六颗角钉（实心小六角）+ 内侧一道细六角</summary>
        static Color ShieldPixel(Vector2 p)
        {
            var c = default(Color);
            c = Layer(c, Mathf.Abs(SdHex(p, 0.54f)) - 0.014f, 0.65f, 0.02f);
            float hex = SdHex(p, 0.72f);
            c = Layer(c, Mathf.Abs(hex) - 0.07f, Bevel(hex + 0.72f, 0.72f), 0.032f);
            for (int k = 0; k < 6; k++)
            {
                // 平顶六边形的顶点在 0°、60°…；外接圆半径 = 内切 / cos30°
                float ak = k * Mathf.PI / 3f;
                var v = new Vector2(Mathf.Cos(ak), Mathf.Sin(ak)) * (0.72f / 0.866f);
                c = Layer(c, SdHex(p - v, 0.1f), 1f, 0.028f);
            }
            return c;
        }

        /// <summary>爆裂：r 0.62 一道实心底环 + 八长八短的尖芒（长到 0.98、短到 0.8），中心一点火药芯</summary>
        static Color VolatilePixel(Vector2 p)
        {
            float r = p.magnitude, a = Ang(p);
            var c = default(Color);
            float best = 1f;
            for (int k = 0; k < 16; k++)
            {
                float ak = k * Mathf.PI / 8f;
                bool longSpike = (k & 1) == 0;
                float tip = longSpike ? 0.98f : 0.8f, baseR = 0.6f, halfBase = longSpike ? 0.15f : 0.11f;
                var dir = new Vector2(Mathf.Cos(ak), Mathf.Sin(ak));
                var tan = new Vector2(-dir.y, dir.x);
                float u = Vector2.Dot(p, dir), v = Mathf.Abs(Vector2.Dot(p, tan));
                if (u < baseR - 0.05f || u > tip + 0.05f) continue;
                // 三角形：底宽 halfBase、到尖收成 0
                float w = halfBase * Mathf.Clamp01((tip - u) / (tip - baseR));
                float sd = Mathf.Max(v - w, Mathf.Max(baseR - u, u - tip)) * 0.85f;
                best = Mathf.Min(best, sd);
            }
            best = Mathf.Min(best, Mathf.Abs(r - 0.62f) - 0.05f);
            c = Layer(c, best, Bevel(r, 0.7f));
            c = Layer(c, r - 0.13f, 1f, 0.03f);
            _ = a;
            return c;
        }

        /// <summary>狂暴：r 0.88–0.98 一道实心外环，向内长出十二颗斜锯齿獠牙（一边沿径向、一边斜坡，像咬合的锯口）</summary>
        static Color FrenzyPixel(Vector2 p)
        {
            float r = p.magnitude, a = Ang(p);
            var c = default(Color);
            const int teeth = 12;
            float seg = Mathf.PI * 2f / teeth;
            float s = Mathf.Repeat(a, seg) / seg;
            // 齿根在外环内沿（0.88），齿尖最深到 0.56：s = 0 处最深、往后斜回外环
            float inner = 0.88f - 0.32f * Mathf.Pow(1f - s, 1.4f);
            float sdTooth = Mathf.Max(inner - r, r - 0.9f);
            // 径向那条边做成锐利的竖边：s 接近 1 时（下一颗齿的竖边前）留一道缝
            float gap = (1f - s) * seg * r;
            sdTooth = Mathf.Max(sdTooth, 0.012f - gap);
            float sdBand = Mathf.Abs(r - 0.93f) - 0.05f;
            c = Layer(c, Mathf.Min(sdTooth, sdBand), Bevel(r, 0.86f));
            return c;
        }
    }
}
