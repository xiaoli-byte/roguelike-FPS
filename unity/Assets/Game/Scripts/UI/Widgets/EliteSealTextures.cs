using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英头顶印章的程序贴图（第二批收尾 D 路，2026-10-31；进 Play 后第一次用到时生成一次、全场共用，不进图集）。
    /// 和脚下金环同一套「明度 + 覆盖」画法（<see cref="EliteSigilTextures"/>）：RGB 白 = 可着色的鎏金、黑 = 墨，A = 覆盖；界面着色（tint）上金色，墨还是墨。
    ///   · <see cref="Frame"/>：鎏金印章的框——圆形墨底，贴着外缘一道金带（外亮内暗一档的手绘倒角）+ 四颗菱形钉（金环同款的钉，落在斜角上），
    ///     底下一枚朝下的金尖（「就是这只」：把印章钉在它头顶），整个外轮廓一道墨边，亮天、亮沙上也托得住；
    ///   · <see cref="Core"/>：没有词缀的精英印章里那颗四芒金星（菱形钉放大，和金环的钉同一个形状语言）。
    /// 有词缀时印章里套的是金环同款的词缀纹样（<see cref="EliteSigilTextures.Sigil"/>），颜色也同（词缀色）。
    /// 印章在屏幕上只有 30–35 像素：粗线大形、四颗钉，不画细刻度；带 mipmap，缩小不闪。
    /// </summary>
    public static class EliteSealTextures
    {
        /// <summary>框的贴图尺寸（宽 × 高，高里多出来的是底下的金尖）</summary>
        public const int W = 96, H = 112;
        /// <summary>圆心离顶边的距离 = 半宽；圆半径 = 半宽（贴图单位：1 = 半宽）</summary>
        public const float TipDepth = (H - W * 0.5f) / (W * 0.5f);
        /// <summary>内圈墨底的半径（贴图单位）：词缀纹样放在这一圈里（金带收窄、贴着外缘，纹样尽量大）</summary>
        public const float Inner = 0.84f;

        static Texture2D frame, core;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            frame = null;
            core = null;
        }

        public static Texture2D Frame => frame ? frame : frame = Build("Elite Seal Frame", W, H, FramePixel);
        public static Texture2D Core => core ? core : core = Build("Elite Seal Core", 64, 64, CorePixel);

        // ───────────── 合成（2×2 超采样）─────────────

        static Texture2D Build(string name, int w, int h, System.Func<Vector2, Color> pixel)
        {
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, true) { name = name, wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Trilinear, anisoLevel = 2 };
            var px = new Color32[w * h];
            float half = w * 0.5f;
            for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                float a = 0, l = 0;
                for (int sy = 0; sy < 2; sy++)
                for (int sx = 0; sx < 2; sx++)
                {
                    // 贴图单位：x 以中线为 0、半宽为 1；y 以圆心为 0、往上为正（圆心离顶边半宽）
                    var p = new Vector2((x + 0.25f + sx * 0.5f - half) / half, (y + 0.25f + sy * 0.5f - (h - half)) / half);
                    var c = pixel(p);
                    l += c.r * c.a;
                    a += c.a;
                }
                float lum = a > 1e-4f ? l / a : 0;
                px[y * w + x] = new Color(lum, lum, lum, a / 4f);
            }
            tex.SetPixels32(px);
            tex.Apply(true, true);
            tex.hideFlags = HideFlags.DontSave;
            return tex;
        }

        static float Cover(float sd, float aa) => Mathf.Clamp01(0.5f - sd / aa);

        static Color Over(Color under, float lum, float alpha)
        {
            float a = alpha + under.a * (1 - alpha);
            if (a < 1e-5f) return default;
            float l = (lum * alpha + under.r * under.a * (1 - alpha)) / a;
            return new Color(l, l, l, a);
        }

        /// <summary>朝下的金尖（三角形）的有向距离：底边在 y = -0.78、半宽 hw，尖在 y = tip</summary>
        static float SdTip(Vector2 p, float hw, float tip)
        {
            const float top = -0.78f;
            float t = Mathf.Clamp01((top - p.y) / (top - tip));
            float w = hw * (1 - t);
            float side = (Mathf.Abs(p.x) - w) * 0.9f;
            return Mathf.Max(side, Mathf.Max(p.y - top, tip - p.y));
        }

        /// <summary>菱形（沿径向 / 切向的 L1）</summary>
        static float SdDiamond(Vector2 d, Vector2 radial, float ru, float rv)
        {
            var tang = new Vector2(-radial.y, radial.x);
            float u = Mathf.Abs(Vector2.Dot(d, radial)), v = Mathf.Abs(Vector2.Dot(d, tang));
            return (u / ru + v / rv - 1f) * Mathf.Min(ru, rv) * 0.7f;
        }

        static Color FramePixel(Vector2 p)
        {
            const float aa = 2.4f / (W * 0.5f);
            float r = p.magnitude;
            float tipY = -TipDepth + 0.04f;
            // 墨：整个外轮廓（圆 + 金尖）外扩一道墨边，圆里是墨底
            float sdOuter = Mathf.Min(r - 0.985f, SdTip(p, 0.4f, tipY));
            var c = Over(default, 0f, Cover(sdOuter, aa) * 0.93f);
            // 金尖（墨边里收一圈）
            c = Over(c, 0.92f, Cover(SdTip(p, 0.3f, tipY + 0.1f), aa));
            // 贴着外缘的金带 0.84–0.96：外半亮、内半暗一档（内圈留给词缀纹样）
            float band = Mathf.Abs(r - 0.9f) - 0.06f;
            c = Over(c, r >= 0.9f ? 1f : 0.76f, Cover(band, aa));
            // 四颗菱形钉（斜角上，压在金带上，墨边托底）
            for (int k = 0; k < 4; k++)
            {
                float ak = Mathf.PI * 0.25f + k * Mathf.PI * 0.5f;
                var radial = new Vector2(Mathf.Cos(ak), Mathf.Sin(ak));
                var d = p - radial * 0.9f;
                float sd = SdDiamond(d, radial, 0.17f, 0.12f);
                c = Over(c, 0f, Cover(sd - 0.04f, aa) * 0.9f);
                c = Over(c, 1f, Cover(sd, aa));
            }
            return c;
        }

        /// <summary>四芒金星：竖长横短（像金环上的菱形钉立起来），中心一点墨，墨边托底</summary>
        static Color CorePixel(Vector2 p)
        {
            const float aa = 2.4f / 32f;
            // Build 里 y 以「离顶边半宽」为原点：64×64 时就是正中心
            float star = Mathf.Min(SdDiamond(p, Vector2.up, 0.95f, 0.34f), SdDiamond(p, Vector2.right, 0.62f, 0.34f));
            var c = Over(default, 0f, Cover(star - 0.07f, aa) * 0.92f);
            c = Over(c, p.y > 0 ? 1f : 0.8f, Cover(star, aa));
            c = Over(c, 0f, Cover(p.magnitude - 0.1f, aa) * 0.9f);
            return c;
        }
    }
}
