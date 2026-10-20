using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 界面主题在代码这一侧的部分（样式本体在 Resources/UI/theme.uss）：
    ///   调色板（与 theme.uss 的 --变量 同值，代码里拼颜色时用）、常用类名、USS 做不了的程序贴图（横向渐隐、径向暗角）。
    /// 东方奇幻：墨黑底、朱砂与鎏金点缀、细描边（同 Three.js src/ui/css/base.css 的设计令牌）。
    /// </summary>
    public static class UITheme
    {
        // ── 调色板（base.css 设计令牌）──
        public static readonly Color Ink0 = Hex.Rgb(0x07060a), Ink1 = Hex.Rgb(0x0f0d12), Ink2 = Hex.Rgb(0x18151c), Ink3 = Hex.Rgb(0x251f29);
        public static readonly Color Paper = Hex.Rgb(0xefe4cc), Paper2 = Hex.Rgb(0xc8b999), Paper3 = Hex.Rgb(0x8a7f6d);
        public static readonly Color Cinnabar = Hex.Rgb(0xc9372a), CinnabarHi = Hex.Rgb(0xff5a3c), CinnabarLo = Hex.Rgb(0x6b1b13);
        public static readonly Color Gold = Hex.Rgb(0xd4a955), GoldHi = Hex.Rgb(0xf4d893), GoldLo = Hex.Rgb(0x6f5626);
        public static readonly Color Jade = Hex.Rgb(0x52b6ec), JadeHi = Hex.Rgb(0xb8eaff);
        public static readonly Color Hp = Hex.Rgb(0xd33a2c), HpHi = Hex.Rgb(0xff7a5a), Armor = Hex.Rgb(0xe0b23c), Good = Hex.Rgb(0x86dc8f), Bad = Hex.Rgb(0xff6a4d);
        public static readonly Color Coin = Hex.Rgb(0xe8b64a), Essence = Hex.Rgb(0x9fd6ff);

        /// <summary>稀有度颜色（= <see cref="Rarity.Colors"/>；USS 里是 .sf-rarity-0 … 4）</summary>
        public static Color RarityColor(int rarity) => Rarity.Color(rarity);

        /// <summary>元素颜色（= <see cref="DamageTable.ElementColor"/>；USS 里是 .sf-el-fire / -shock / -corrode）</summary>
        public static Color ElementColor(Element e) => DamageTable.ElementColor(e);

        // ── 类名（theme.uss）──
        public const string Layer = "sf-layer", Screen = "sf-screen", Backdrop = "sf-backdrop";
        public const string TitleFont = "sf-title", NumberFont = "sf-num", BodyText = "sf-body";
        public const string Button = "sf-btn", ButtonPrimary = "sf-btn--primary", ButtonGhost = "sf-btn--ghost", ButtonDanger = "sf-btn--danger";
        public const string Frame = "sf-frame", PanelTitle = "sf-panel__title", Key = "sf-key", Seal = "sf-seal", Chip = "sf-chip", Icon = "sf-icon";
        /// <summary>按钮音：缺省点击 ui_click；加 sf-sound-confirm / sf-sound-deny 换音，sf-silent 不出声</summary>
        public const string SoundConfirm = "sf-sound-confirm", SoundDeny = "sf-sound-deny", Silent = "sf-silent";

        public static string RarityClass(int rarity) => "sf-rarity-" + Rarity.Clamp(rarity);

        public static string ElementClass(Element e) => e switch
        {
            Element.Fire => "sf-el-fire",
            Element.Shock => "sf-el-shock",
            Element.Corrode => "sf-el-corrode",
            _ => "sf-el-none",
        };

        /// <summary>富文本用的 #RRGGBB</summary>
        public static string Html(Color c) => "#" + ColorUtility.ToHtmlStringRGB(c);

        // ── 程序贴图（白色 + alpha，用 -unity-background-image-tint-color / 代码里的 tint 上色）──
        static Texture2D fadeRight, fadeBoth, vignette;

        /// <summary>左实右透（toast 底：Three.js 的 linear-gradient(90deg, 墨 .88, 墨 .55 80%, 透明)）</summary>
        public static Texture2D FadeRight => fadeRight ? fadeRight : fadeRight = Gradient("UI FadeRight", x => x < 0.8f ? Mathf.Lerp(0.88f, 0.55f, x / 0.8f) : Mathf.Lerp(0.55f, 0, (x - 0.8f) / 0.2f));

        /// <summary>两端透明、中间实（横幅分割线）</summary>
        public static Texture2D FadeBoth => fadeBoth ? fadeBoth : fadeBoth = Gradient("UI FadeBoth", x => Mathf.SmoothStep(0, 1, 1 - Mathf.Abs(x * 2 - 1)));

        /// <summary>径向：中心实、边缘透明（横幅底下的淡墨衬底：radial-gradient(closest-side, 墨 .62, 墨 .38 60%, 透明)）</summary>
        public static Texture2D RadialSoft
        {
            get
            {
                if (vignette) return vignette;
                const int w = 128, h = 64;
                var tex = new Texture2D(w, h, TextureFormat.RGBA32, false) { name = "UI RadialSoft", wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
                var px = new Color32[w * h];
                for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    float dx = (x + 0.5f) / w * 2 - 1, dy = (y + 0.5f) / h * 2 - 1;
                    float d = Mathf.Sqrt(dx * dx + dy * dy);
                    float a = d < 0.6f ? Mathf.Lerp(0.62f, 0.38f, d / 0.6f) : Mathf.Lerp(0.38f, 0, Mathf.Clamp01((d - 0.6f) / 0.4f));
                    px[y * w + x] = new Color32(255, 255, 255, (byte)(a * 255));
                }
                tex.SetPixels32(px);
                tex.Apply(false, true);
                return vignette = tex;
            }
        }

        static Texture2D Gradient(string name, System.Func<float, float> alpha)
        {
            const int w = 128;
            var tex = new Texture2D(w, 1, TextureFormat.RGBA32, false) { name = name, wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
            var px = new Color32[w];
            for (int x = 0; x < w; x++) px[x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(alpha((x + 0.5f) / w)) * 255));
            tex.SetPixels32(px);
            tex.Apply(false, true);
            return tex;
        }

        /// <summary>给元素铺一张程序贴图并上色（拉伸铺满）</summary>
        public static void Paint(VisualElement e, Texture2D tex, Color tint)
        {
            e.style.backgroundImage = new StyleBackground(tex);
            e.style.unityBackgroundImageTintColor = tint;
            e.style.backgroundSize = new StyleBackgroundSize(new BackgroundSize(Length.Percent(100), Length.Percent(100)));
        }
    }
}
