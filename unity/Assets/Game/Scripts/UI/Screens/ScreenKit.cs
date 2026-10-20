using System;
using System.Collections.Generic;
using System.Globalization;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem.Controls;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 界面共用的小工具（G/UI/Screens 下的各个 <see cref="UIScreen"/> 用）：
    ///   元素工厂（文字不接指针，点击都落到按钮上；按钮 = UI Toolkit 的 Button，路由的确认 / 鼠标点击 / 按钮音都直接生效）、
    ///   样式表加载（Resources/UI/screens|menu|scrolls.uss，挂在界面根元素上；theme.uss 的 --变量 从层根继承下来）、
    ///   滚动区跟随焦点、动作表被关掉时也能读的按键（Tab 背包开着时 Gameplay 表是关的）、数字 / 时间 / 中文数字格式、英雄徽记。
    /// 动画一律用不缩放时间（界面打开时时间是停的）。
    /// </summary>
    public static class ScreenKit
    {
        /// <summary>样式表（Resources 路径，不带扩展名）</summary>
        public const string ScreensStyle = "UI/screens", MenuStyle = "UI/menu", ScrollStyle = "UI/scrolls";

        static readonly Dictionary<string, StyleSheet> sheets = new();
        static readonly HashSet<string> missing = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            sheets.Clear();
            missing.Clear();
        }

        /// <summary>给元素挂一张样式表（同一张只挂一次；找不到只警告一次）</summary>
        public static void Style(VisualElement e, string path)
        {
            if (e == null || string.IsNullOrEmpty(path)) return;
            if (!sheets.TryGetValue(path, out var s) || !s)
            {
                s = Resources.Load<StyleSheet>(path);
                if (!s)
                {
                    if (missing.Add(path)) Debug.LogWarning($"[UI] 找不到样式表 Resources/{path}.uss");
                    return;
                }
                sheets[path] = s;
            }
            if (!e.styleSheets.Contains(s)) e.styleSheets.Add(s);
        }

        // ───────────── 元素工厂 ─────────────

        /// <summary>容器（不接指针；需要接指针的自己改 pickingMode）</summary>
        public static VisualElement El(string classes, VisualElement parent = null, string name = null)
        {
            var e = new VisualElement { pickingMode = PickingMode.Ignore };
            if (name != null) e.name = name;
            HudArt.AddClasses(e, classes);
            parent?.Add(e);
            return e;
        }

        /// <summary>文字（不接指针；去掉默认主题的 unity-label 边距）。role = 标题 / 数字字体；rich = 富文本（代价行的红字）</summary>
        public static Label Text(string classes, VisualElement parent, string text, UIFontRole role = UIFontRole.Body, bool rich = false)
        {
            var l = HudArt.Text(classes, parent, text, role, rich);
            return l;
        }

        /// <summary>主题按钮（.sf-btn + classes）：鼠标点击、手柄 A / 回车（路由发确认事件）都走 onClick</summary>
        public static Button Btn(string text, string classes, VisualElement parent, Action onClick)
        {
            var b = new Button(onClick) { text = text ?? "" };
            b.AddToClassList(UITheme.Button);
            HudArt.AddClasses(b, classes);
            parent?.Add(b);
            return b;
        }

        /// <summary>自绘按钮（卡片、名录条目、导航项）：去掉默认主题的按钮样式，内容自己往里加（文字用 <see cref="Text"/>，不接指针）</summary>
        public static Button Card(string classes, VisualElement parent, Action onClick)
        {
            var b = new Button(onClick) { text = "" };
            b.RemoveFromClassList(Button.ussClassName);
            b.RemoveFromClassList(TextElement.ussClassName);
            HudArt.AddClasses(b, classes);
            parent?.Add(b);
            return b;
        }

        /// <summary>图标（白色矢量，theme.uss 的 .sf-icon--* 上色）</summary>
        public static VisualElement Icon(UIIcon icon, string classes, VisualElement parent)
        {
            var e = UIIcons.Make(icon, classes?.Split(' '));
            parent?.Add(e);
            return e;
        }

        /// <summary>竖向滚动区（不显示横向滚动条；焦点移进看不见的地方时自动滚过去，手柄翻长列表用）</summary>
        public static ScrollView Scroll(string classes, VisualElement parent)
        {
            var sv = new ScrollView(ScrollViewMode.Vertical)
            {
                horizontalScrollerVisibility = ScrollerVisibility.Hidden,
                verticalScrollerVisibility = ScrollerVisibility.Auto,
            };
            HudArt.AddClasses(sv, classes);
            sv.RegisterCallback<FocusInEvent>(e =>
            {
                if (e.target is VisualElement v && v != sv && sv.contentContainer.Contains(v)) sv.ScrollTo(v);
            });
            parent?.Add(sv);
            return sv;
        }

        /// <summary>清空子元素</summary>
        public static void Clear(VisualElement e) => e?.Clear();

        /// <summary>显示 / 隐藏（display）</summary>
        public static void Show(VisualElement e, bool on) => HudArt.Show(e, on);

        // ───────────── 输入 ─────────────

        /// <summary>
        /// 某个玩法动作这一帧有没有按下——动作表被路由关掉（挡游戏的界面开着）时照样能读：直接看它绑定的控件（改过的键也认）。
        /// Tab 背包、暂停里再按一次 Tab / Esc 关掉用
        /// </summary>
        public static bool PressedRaw(GameAction a)
        {
            var action = GameInput.Get(a);
            if (action.enabled) return action.WasPressedThisFrame();
            try
            {
                foreach (var c in action.controls)
                    if (c is ButtonControl b && b.wasPressedThisFrame)
                        return true;
            }
            catch (Exception)
            {
                // 绑定还没解析（第一次用）：当没按
            }
            return false;
        }

        /// <summary>键位提示：键鼠「Tab」、手柄「Back」…（scheme 缺省键鼠）</summary>
        public static string KeyLabel(GameAction a, string scheme = GameInput.KeyboardMouseScheme)
        {
            string s;
            try { s = GameInput.BindingLabel(a, scheme); }
            catch (Exception) { s = a.ToString(); }
            if (string.IsNullOrEmpty(s)) s = a.ToString();
            return s.Length == 1 ? s.ToUpperInvariant() : s;
        }

        // ───────────── 格式 ─────────────

        /// <summary>千分位整数</summary>
        public static string Num(float v) => Mathf.RoundToInt(v).ToString("N0", CultureInfo.InvariantCulture);

        /// <summary>用时：m:ss（≥ 1 小时 h:mm:ss）</summary>
        public static string Clock(float seconds)
        {
            int s = Mathf.Max(0, Mathf.FloorToInt(seconds));
            return s >= 3600 ? $"{s / 3600}:{s / 60 % 60:00}:{s % 60:00}" : $"{s / 60}:{s % 60:00}";
        }

        /// <summary>保留一位小数并去掉多余的 0</summary>
        public static string Num1(float v) => (Mathf.Round(v * 10) / 10).ToString("0.#", CultureInfo.InvariantCulture);

        /// <summary>中文数字（1–99）：「一」「十二」「二十」</summary>
        public static string Cn(int n)
        {
            const string d = "零一二三四五六七八九";
            if (n < 0 || n > 99) return n.ToString(CultureInfo.InvariantCulture);
            if (n < 10) return d[n].ToString();
            int t = n / 10, o = n % 10;
            return (t == 1 ? "" : d[t].ToString()) + "十" + (o == 0 ? "" : d[o].ToString());
        }

        // ───────────── 英雄 ─────────────

        /// <summary>英雄单字徽记（燎 / 鼯 / 磐；没有英雄时「侠」）</summary>
        public static string HeroGlyph(HeroDef h) => h == null ? "侠" : !string.IsNullOrEmpty(h.name) ? h.name.Substring(0, 1) : "侠";

        /// <summary>英雄主题色（没有英雄时鎏金）</summary>
        public static Color HeroColor(HeroDef h) => h != null ? h.color : UITheme.Gold;

        /// <summary>圆形徽记：英雄色描边 + 暗底 + 单字（暂停、结算、名录用）</summary>
        public static VisualElement Crest(HeroDef h, VisualElement parent, string classes = null)
        {
            var c = El("sf-crest " + (classes ?? ""), parent);
            var glyph = Text("sf-crest__glyph", c, HeroGlyph(h), UIFontRole.Title);
            SetCrest(c, h);
            glyph.name = "glyph";
            return c;
        }

        /// <summary>改徽记的英雄</summary>
        public static void SetCrest(VisualElement crest, HeroDef h)
        {
            if (crest == null) return;
            var col = HeroColor(h);
            crest.style.borderTopColor = crest.style.borderBottomColor = crest.style.borderLeftColor = crest.style.borderRightColor = col;
            crest.style.backgroundColor = Color.Lerp(new Color(0.04f, 0.03f, 0.05f), col, 0.32f);
            if (crest.Q<Label>("glyph") is { } g) g.text = HeroGlyph(h);
        }

        /// <summary>当前局的英雄（没有局时 null）</summary>
        public static HeroDef RunHero => RunState.Current != null ? HeroLibrary.Get(RunState.Current.heroId) : null;

        // ───────────── 动画 ─────────────

        /// <summary>三次缓出</summary>
        public static float EaseOut(float k)
        {
            k = Mathf.Clamp01(k);
            float u = 1 - k;
            return 1 - u * u * u;
        }

        /// <summary>带回弹的缓出（印章落下）</summary>
        public static float EaseBack(float k, float overshoot = 1.7f)
        {
            k = Mathf.Clamp01(k) - 1;
            return 1 + k * k * ((overshoot + 1) * k + overshoot);
        }

        /// <summary>颜色换 alpha</summary>
        public static Color A(Color c, float a) => new(c.r, c.g, c.b, a);

        /// <summary>四边边框同色</summary>
        public static void Border(VisualElement e, Color c)
        {
            e.style.borderTopColor = e.style.borderBottomColor = e.style.borderLeftColor = e.style.borderRightColor = c;
        }

        /// <summary>
        /// 平铺的小圆点纹（秘卷绫绢的「点阵」、天赋行的底纹）：白点 + 透明底，用 -unity-background-image-tint-color 上色。
        /// 16 × 16 一格，两个错开的点（菱形排布）
        /// </summary>
        public static Texture2D Dots
        {
            get
            {
                if (dots) return dots;
                const int n = 16;
                var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { name = "UI Dots", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Bilinear, hideFlags = HideFlags.HideAndDontSave };
                var px = new Color32[n * n];
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float a = Dot(x, y, 4, 4) + Dot(x, y, 12, 12);
                    px[y * n + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(a) * 255));
                }
                tex.SetPixels32(px);
                tex.Apply(false, true);
                return dots = tex;
            }
        }

        static Texture2D dots;

        static float Dot(int x, int y, float cx, float cy)
        {
            float dx = x + 0.5f - cx, dy = y + 0.5f - cy;
            return Mathf.Clamp01(1.9f - Mathf.Sqrt(dx * dx + dy * dy));
        }

        /// <summary>铺点阵（平铺，tile = 一格的像素）</summary>
        public static void PaintDots(VisualElement e, Color tint, float tile = 12)
        {
            e.style.backgroundImage = new StyleBackground(Dots);
            e.style.unityBackgroundImageTintColor = tint;
            e.style.backgroundRepeat = new BackgroundRepeat(Repeat.Repeat, Repeat.Repeat);
            e.style.backgroundSize = new BackgroundSize(new Length(tile), new Length(tile));
        }
    }
}
