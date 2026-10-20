using System.Globalization;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// HUD 部件共用的工具（样式本体在 Resources/UI/hud.uss）：
    ///   元素工厂（一律不接指针；Label 去掉默认主题的 unity-label 类，边距只听 hud.uss 的）、
    ///   字体（内联 SDF 字体：资产还没生成时 USS 的 resource() 找不到，内联的总是对的）、
    ///   程序贴图（USS 没有渐变：暗角、条形明暗、柔光、单侧渐隐，白色 + alpha，靠 tint 上色）、
    ///   数字格式、颜色常量（Three.js css/hud.css、combat.css 的值）。
    /// </summary>
    public static class HudArt
    {
        /// <summary>HUD 样式表（Resources 路径）</summary>
        public const string HudStyle = "UI/hud";

        // ── 颜色（hud.css / combat.css）──
        public static readonly Color Reticle = new(1f, 0.976f, 0.933f, 0.95f);
        public static readonly Color ReticleTarget = Hex.Rgb(0xff5a3c);
        public static readonly Color ShieldBlue = Hex.Rgb(0x63c9ff);
        public static readonly Color ArmorGold = Hex.Rgb(0xffd23f);
        public static readonly Color ArmorHi = Hex.Rgb(0xffe08a);
        public static readonly Color Trail = Hex.Rgb(0xf1d2a6);
        public static readonly Color CoinText = Hex.Rgb(0xf4d58a);
        public static readonly Color EssenceText = Hex.Rgb(0xcfeaff);
        public static readonly Color EnemyText = Hex.Rgb(0xf0b8a8);
        public static readonly Color StunBadge = Hex.Rgb(0xf3e9a6);
        public static readonly Color Primed = Hex.Rgb(0xc89bff);

        // ───────────── 元素工厂 ─────────────

        /// <summary>一个不接指针的元素：classes 用空格分隔</summary>
        public static VisualElement El(string classes = null, VisualElement parent = null, string name = null)
        {
            var e = new VisualElement { pickingMode = PickingMode.Ignore };
            if (name != null) e.name = name;
            AddClasses(e, classes);
            parent?.Add(e);
            return e;
        }

        /// <summary>一个不接指针的 Label（去掉默认主题的 unity-label / unity-text-element 类）；role = 内联字体</summary>
        public static Label Text(string classes, VisualElement parent = null, string text = null, UIFontRole role = UIFontRole.Body, bool rich = false)
        {
            var l = new Label(text ?? "") { pickingMode = PickingMode.Ignore, enableRichText = rich };
            l.RemoveFromClassList(Label.ussClassName);
            l.RemoveFromClassList(TextElement.ussClassName);
            AddClasses(l, classes);
            if (role != UIFontRole.Body) Font(l, role);
            parent?.Add(l);
            return l;
        }

        /// <summary>铺满父元素的填充层（轴心在左端中点，按 X 缩放表示比例）；color 有值时铺条形明暗贴图并上色</summary>
        public static VisualElement Fill(VisualElement parent, string classes = null, Color? color = null)
        {
            var e = El("sf-fill " + (classes ?? ""), parent);
            e.style.transformOrigin = new TransformOrigin(Length.Percent(0), Length.Percent(50), 0);
            if (color is Color c) PaintBar(e, c);
            return e;
        }

        /// <summary>设轴心（百分比）</summary>
        public static void Origin(VisualElement e, float xPercent, float yPercent) =>
            e.style.transformOrigin = new TransformOrigin(Length.Percent(xPercent), Length.Percent(yPercent), 0);

        public static void AddClasses(VisualElement e, string classes)
        {
            if (string.IsNullOrEmpty(classes)) return;
            foreach (var c in classes.Split(' '))
                if (c.Length > 0) e.AddToClassList(c);
        }

        /// <summary>内联字体（标题 / 数字）：打包的 SDF 字体资产还没生成时也对</summary>
        public static void Font(VisualElement e, UIFontRole role)
        {
            var fa = UIFonts.Get(role);
            if (fa) e.style.unityFontDefinition = FontDefinition.FromSDFFont(fa);
            e.AddToClassList(role == UIFontRole.Title ? UITheme.TitleFont : role == UIFontRole.Number ? UITheme.NumberFont : UITheme.BodyText);
        }

        /// <summary>只在值变了时写文字（避免每帧标脏排版）</summary>
        public static void SetText(TextElement t, string s)
        {
            if (t.text != s) t.text = s;
        }

        /// <summary>只在值变了时写显隐</summary>
        public static void Show(VisualElement e, bool on)
        {
            var d = on ? DisplayStyle.Flex : DisplayStyle.None;
            if (e.style.display != d) e.style.display = d;
        }

        public static void Toggle(VisualElement e, string cls, bool on)
        {
            if (e.ClassListContains(cls) != on) e.EnableInClassList(cls, on);
        }

        /// <summary>按 X 缩放的填充条（轴心在左端，hud.uss 的 .sf-fill 设好了）</summary>
        public static void SetFill(VisualElement e, float f) => e.style.scale = new Scale(new Vector3(Mathf.Clamp01(float.IsNaN(f) ? 0 : f), 1, 1));

        public static void Opacity(VisualElement e, float a) => e.style.opacity = Mathf.Clamp01(a);

        /// <summary>1,280 这样的千分位整数（同 Three.js formatNum）</summary>
        public static string FormatNum(int n) => n.ToString("N0", CultureInfo.InvariantCulture);

        /// <summary>冷却秒数：≥ 1 秒取整（向上），&lt; 1 秒一位小数；不在冷却为空</summary>
        public static string CooldownText(float left)
        {
            if (!(left > 0)) return "";
            return left >= 1 ? Mathf.CeilToInt(left).ToString(CultureInfo.InvariantCulture) : (Mathf.Ceil(left * 10) / 10).ToString("0.0", CultureInfo.InvariantCulture);
        }

        static readonly System.Collections.Generic.Dictionary<Spiritfire.Art.GameAction, (string label, float at)> keyCache = new();

        /// <summary>按键提示文字（键鼠方案的第一个绑定，「F」「Q」…）：每个动作 2 秒查一次（改键后跟上，不每帧分配）</summary>
        public static string Key(Spiritfire.Art.GameAction a)
        {
            float now = Time.unscaledTime;
            if (keyCache.TryGetValue(a, out var e) && now - e.at < 2f && now >= e.at) return e.label;
            string s;
            try { s = Spiritfire.Art.GameInput.BindingLabel(a); }
            catch (System.Exception) { s = a.ToString(); }
            if (string.IsNullOrEmpty(s)) s = a.ToString();
            if (s.Length == 1) s = s.ToUpperInvariant();
            keyCache[a] = (s, now);
            return s;
        }

        /// <summary>元素单字（火 / 雷 / 蚀）</summary>
        public static string ElementGlyph(Element e) => e switch
        {
            Element.Fire => "火",
            Element.Shock => "雷",
            Element.Corrode => "蚀",
            _ => "",
        };

        public static Color WithAlpha(Color c, float a) => new(c.r, c.g, c.b, a);

        /// <summary>指数阻尼（同 Three.js damp）</summary>
        public static float Damp(float a, float b, float lambda, float dt) => Mathf.Lerp(b, a, Mathf.Exp(-lambda * Mathf.Max(0, dt)));

        // ───────────── 程序贴图（白 + alpha）─────────────

        static Texture2D vignette, barShade, glow, fadeLeft, stripes;

        /// <summary>
        /// 屏幕暗角：中心透明、往四边渐浓（椭圆，铺满全屏拉伸）。值近似 Three.js 的 radial-gradient(ellipse, transparent 40%, … 100%)：
        /// 0.4 半径内透明，到边缘 1
        /// </summary>
        public static Texture2D Vignette => vignette ? vignette : vignette = Radial("HUD Vignette", 128, 128, d => Mathf.SmoothStep(0, 1, Mathf.InverseLerp(0.42f, 1.02f, d)));

        /// <summary>柔光圆：中心实、边缘透明</summary>
        public static Texture2D Glow => glow ? glow : glow = Radial("HUD Glow", 64, 64, d => 1 - Mathf.SmoothStep(0, 1, d));

        /// <summary>条形明暗（竖向）：顶上 35% 高光、往下渐暗到 0.5（tint 上色后 = 高光色 → 本色 → 暗色）</summary>
        public static Texture2D BarShade
        {
            get
            {
                if (barShade) return barShade;
                const int h = 16;
                var tex = New("HUD BarShade", 1, h);
                var px = new Color32[h];
                for (int y = 0; y < h; y++)
                {
                    float t = 1 - (y + 0.5f) / h; // 0 = 顶（贴图 y 向上）
                    float v = t < 0.35f ? Mathf.Lerp(1f, 0.86f, t / 0.35f) : Mathf.Lerp(0.86f, 0.5f, (t - 0.35f) / 0.65f);
                    byte b = (byte)(v * 255);
                    px[y] = new Color32(b, b, b, 255);
                }
                tex.SetPixels32(px);
                tex.Apply(false, true);
                return barShade = tex;
            }
        }

        /// <summary>右实左透（武器槽 / 信息角底：linear-gradient(270deg, 墨 .8, 墨 .5 70%, 透明)）</summary>
        public static Texture2D FadeLeft
        {
            get
            {
                if (fadeLeft) return fadeLeft;
                const int w = 128;
                var tex = New("HUD FadeLeft", w, 1);
                var px = new Color32[w];
                for (int x = 0; x < w; x++)
                {
                    float t = 1 - (x + 0.5f) / w; // 0 = 右端
                    float a = t < 0.7f ? Mathf.Lerp(1f, 0.62f, t / 0.7f) : Mathf.Lerp(0.62f, 0, (t - 0.7f) / 0.3f);
                    px[x] = new Color32(255, 255, 255, (byte)(a * 255));
                }
                tex.SetPixels32(px);
                tex.Apply(false, true);
                return fadeLeft = tex;
            }
        }

        /// <summary>斜纹（护盾碎裂的裂纹闪光：repeating-linear-gradient(118deg, 白 1.5px, 透明 13px)）</summary>
        public static Texture2D Stripes
        {
            get
            {
                if (stripes) return stripes;
                const int w = 64, h = 16;
                var tex = New("HUD Stripes", w, h);
                tex.wrapMode = TextureWrapMode.Repeat;
                var px = new Color32[w * h];
                for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    float u = (x + y * 0.55f) % 13f;
                    float a = u < 1.5f ? 0.95f : 0.25f * (1 - (float)x / w);
                    px[y * w + x] = new Color32(255, 255, 255, (byte)(a * 255));
                }
                tex.SetPixels32(px);
                tex.Apply(false, true);
                return stripes = tex;
            }
        }

        static Texture2D New(string name, int w, int h) =>
            new(w, h, TextureFormat.RGBA32, false) { name = name, wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };

        static Texture2D Radial(string name, int w, int h, System.Func<float, float> alpha)
        {
            var tex = New(name, w, h);
            var px = new Color32[w * h];
            for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                float dx = (x + 0.5f) / w * 2 - 1, dy = (y + 0.5f) / h * 2 - 1;
                float d = Mathf.Sqrt(dx * dx + dy * dy);
                px[y * w + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(alpha(d)) * 255));
            }
            tex.SetPixels32(px);
            tex.Apply(false, true);
            return tex;
        }

        /// <summary>给元素铺一张程序贴图并上色（拉伸铺满）</summary>
        public static void Paint(VisualElement e, Texture2D tex, Color tint) => UITheme.Paint(e, tex, tint);

        /// <summary>条形填充：明暗贴图 × 颜色</summary>
        public static void PaintBar(VisualElement e, Color c) => UITheme.Paint(e, BarShade, c);

        /// <summary>只改 tint（颜色变了才写）</summary>
        public static void Tint(VisualElement e, Color c)
        {
            if (e.style.unityBackgroundImageTintColor.value != c) e.style.unityBackgroundImageTintColor = c;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            foreach (var t in new[] { vignette, barShade, glow, fadeLeft, stripes })
                if (t) Object.Destroy(t);
            vignette = barShade = glow = fadeLeft = stripes = null;
            keyCache.Clear();
        }
    }

    /// <summary>
    /// 圆环（Painter2D）：技能冷却环、换弹环、蓄力环、灵技环。从 12 点钟方向顺时针画 progress（0..1），底下可选一圈淡轨道。
    /// 值没变不重画（<see cref="Progress"/> 量化到 1/400）。
    /// </summary>
    public sealed class RingElement : VisualElement
    {
        float progress = 1, width = 3;
        Color color = Color.white, track = new(1, 1, 1, 0.08f);
        bool round = true;

        public RingElement(float lineWidth = 3)
        {
            pickingMode = PickingMode.Ignore;
            width = lineWidth;
            generateVisualContent += Draw;
        }

        public float Progress
        {
            get => progress;
            set
            {
                float q = Mathf.Round(Mathf.Clamp01(float.IsNaN(value) ? 0 : value) * 400) / 400;
                if (Mathf.Approximately(q, progress)) return;
                progress = q;
                MarkDirtyRepaint();
            }
        }

        public Color Color
        {
            get => color;
            set
            {
                if (color == value) return;
                color = value;
                MarkDirtyRepaint();
            }
        }

        public Color Track
        {
            get => track;
            set
            {
                if (track == value) return;
                track = value;
                MarkDirtyRepaint();
            }
        }

        public float LineWidth
        {
            get => width;
            set
            {
                if (Mathf.Approximately(width, value)) return;
                width = value;
                MarkDirtyRepaint();
            }
        }

        public bool RoundCap
        {
            get => round;
            set
            {
                round = value;
                MarkDirtyRepaint();
            }
        }

        void Draw(MeshGenerationContext mgc)
        {
            var r = contentRect;
            float rad = Mathf.Min(r.width, r.height) * 0.5f - width * 0.5f;
            if (rad <= 0.5f) return;
            var c = r.center;
            var p = mgc.painter2D;
            p.lineWidth = width;
            if (track.a > 0.001f)
            {
                p.lineCap = LineCap.Butt;
                p.strokeColor = track;
                p.BeginPath();
                p.Arc(c, rad, Angle.Degrees(0), Angle.Degrees(180));
                p.Arc(c, rad, Angle.Degrees(180), Angle.Degrees(360));
                p.Stroke();
            }
            if (progress <= 0.0025f || color.a <= 0.001f) return;
            p.lineCap = round && progress < 0.999f ? LineCap.Round : LineCap.Butt;
            p.strokeColor = color;
            p.BeginPath();
            float end = -90 + 360 * Mathf.Min(progress, 0.9999f);
            if (progress >= 0.999f)
            {
                p.Arc(c, rad, Angle.Degrees(-90), Angle.Degrees(90));
                p.Arc(c, rad, Angle.Degrees(90), Angle.Degrees(270));
            }
            else p.Arc(c, rad, Angle.Degrees(-90), Angle.Degrees(end));
            p.Stroke();
        }
    }

    /// <summary>
    /// 一段弧（Painter2D）：受击方向弧、近战括号。中心角 center（度，0 = 正右、-90 = 正上，顺时针为正）、半宽 halfSpan；
    /// fade = 两端渐隐所占的比例（0..1：分段画、alpha 往两端递减，代替 Three.js 的 mask-image 渐隐）。
    /// </summary>
    public sealed class ArcElement : VisualElement
    {
        float center = -90, halfSpan = 24, fade = 0.7f, width = 6, radiusInset;
        Color color = Color.red;
        const int Segments = 14;

        public ArcElement()
        {
            pickingMode = PickingMode.Ignore;
            generateVisualContent += Draw;
        }

        /// <summary>设参数（变了才重画）</summary>
        public void Set(float centerDeg, float halfSpanDeg, float fadeFraction, float lineWidth, Color c, float inset = 0)
        {
            if (Mathf.Approximately(center, centerDeg) && Mathf.Approximately(halfSpan, halfSpanDeg) && Mathf.Approximately(fade, fadeFraction)
                && Mathf.Approximately(width, lineWidth) && color == c && Mathf.Approximately(radiusInset, inset)) return;
            center = centerDeg;
            halfSpan = halfSpanDeg;
            fade = Mathf.Clamp01(fadeFraction);
            width = lineWidth;
            color = c;
            radiusInset = inset;
            MarkDirtyRepaint();
        }

        public Color Color
        {
            get => color;
            set
            {
                if (color == value) return;
                color = value;
                MarkDirtyRepaint();
            }
        }

        void Draw(MeshGenerationContext mgc)
        {
            var r = contentRect;
            float rad = Mathf.Min(r.width, r.height) * 0.5f - width * 0.5f - radiusInset;
            if (rad <= 0.5f || color.a <= 0.001f) return;
            var c = r.center;
            var p = mgc.painter2D;
            p.lineWidth = width;
            p.lineCap = LineCap.Butt;
            if (fade <= 0.001f)
            {
                p.strokeColor = color;
                p.BeginPath();
                p.Arc(c, rad, Angle.Degrees(center - halfSpan), Angle.Degrees(center + halfSpan));
                p.Stroke();
                return;
            }
            // 分段：中间 (1 - fade) 实，两端线性淡到 0
            float a0 = center - halfSpan, step = halfSpan * 2 / Segments;
            for (int i = 0; i < Segments; i++)
            {
                float mid = a0 + (i + 0.5f) * step;
                float k = Mathf.Abs(mid - center) / halfSpan; // 0 = 中心，1 = 端点
                float solid = 1 - fade;
                float alpha = k <= solid ? 1 : 1 - (k - solid) / Mathf.Max(0.001f, fade);
                if (alpha <= 0.01f) continue;
                p.strokeColor = new Color(color.r, color.g, color.b, color.a * alpha);
                p.BeginPath();
                p.Arc(c, rad, Angle.Degrees(a0 + i * step), Angle.Degrees(a0 + (i + 1) * step + 0.4f));
                p.Stroke();
            }
        }
    }
}
