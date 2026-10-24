using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 演出的屏幕层（UI Toolkit 的 Overlay 层：HUD 之上、暂停 / 界面之下，不接输入）：上下黑边、电影式名字卡、「按住 F 跳过」提示。
    /// 样式全部内联（不加 USS 文件）。动画都按不缩放时间（慢动作时字照常淡入淡出），由 <see cref="BossIntroDirector"/> 每帧 <see cref="Tick"/>。
    ///   黑边：<see cref="Bars"/> 0 → 1 = 上下各 <see cref="BarPercent"/>% 屏高（≈ 2.39 : 1），0.5 s 缓入缓出；
    ///   名字卡：左下、黑边之上——场地小字 / 首领名（标题字体，鎏金，字距从 34 收到 12、从左滑入）/ 一道金线 / 称号；
    ///   跳过提示：右下黑边里，按住时下面的细条填满。
    /// </summary>
    public sealed class CinematicOverlay
    {
        public const float BarPercent = 11f, BarTime = 0.5f;
        const float TitleIn = 0.7f, SubDelay = 0.3f, SubIn = 0.6f, OutTime = 0.45f;

        readonly VisualElement root, top, bottom, scrim, caption, rule, hint, hintTrack, hintFill;
        readonly Label epithet, title, sub, hintLabel;
        float bars, barsTarget, captionAt = -1, captionUntil, captionOutAt = -1;

        /// <summary>黑边当前值（0–1）与目标</summary>
        public float Bars => bars;
        public float BarsTarget
        {
            get => barsTarget;
            set => barsTarget = Mathf.Clamp01(value);
        }

        /// <summary>名字卡正在显示（含淡出）</summary>
        public bool CaptionVisible => captionAt >= 0;
        public string CaptionTitle => CaptionVisible ? title.text : null;
        public bool HintVisible => hint.style.display == DisplayStyle.Flex;

        CinematicOverlay(VisualElement parent)
        {
            root = new VisualElement { name = "cinematic", pickingMode = PickingMode.Ignore };
            Fill(root);
            top = Bar(true);
            bottom = Bar(false);
            root.Add(top);
            root.Add(bottom);

            // 名字卡底下一团淡墨（径向，边缘透明）：亮背景（1-4 的沙山、雪地）上鎏金字和小字也读得清，暗背景上几乎看不出
            scrim = new VisualElement { name = "cinematic-caption-scrim", pickingMode = PickingMode.Ignore };
            scrim.style.position = Position.Absolute;
            scrim.style.left = Length.Percent(-8);
            scrim.style.bottom = Length.Percent(BarPercent - 2);
            scrim.style.width = Length.Percent(58);
            scrim.style.height = Length.Percent(40);
            UITheme.Paint(scrim, UITheme.RadialSoft, Color.black);
            scrim.style.display = DisplayStyle.None;
            root.Add(scrim);

            caption = new VisualElement { name = "cinematic-caption", pickingMode = PickingMode.Ignore };
            caption.style.position = Position.Absolute;
            caption.style.left = Length.Percent(7);
            caption.style.bottom = Length.Percent(BarPercent + 4);
            caption.style.alignItems = Align.FlexStart;
            epithet = Text(22, UITheme.Paper, 6);
            title = Text(92, UITheme.GoldHi, 12);
            title.AddToClassList(UITheme.TitleFont);
            if (UIFonts.Title) title.style.unityFontDefinition = FontDefinition.FromSDFFont(UIFonts.Title);
            title.style.textShadow = new TextShadow { offset = new Vector2(0, 4), blurRadius = 14, color = new Color(0, 0, 0, 0.8f) };
            rule = new VisualElement { pickingMode = PickingMode.Ignore };
            rule.style.width = 520;
            rule.style.height = 2;
            rule.style.marginTop = 6;
            rule.style.marginBottom = 10;
            UITheme.Paint(rule, UITheme.FadeRight, UITheme.Gold);
            sub = Text(28, UITheme.Paper, 8);
            caption.Add(epithet);
            caption.Add(title);
            caption.Add(rule);
            caption.Add(sub);
            caption.style.display = DisplayStyle.None;
            root.Add(caption);

            hint = new VisualElement { name = "cinematic-skip", pickingMode = PickingMode.Ignore };
            hint.style.position = Position.Absolute;
            hint.style.right = Length.Percent(3.5f);
            hint.style.bottom = Length.Percent(BarPercent * 0.3f);
            hint.style.alignItems = Align.FlexEnd;
            hintLabel = Text(20, UITheme.Paper2, 3);
            hintTrack = new VisualElement { pickingMode = PickingMode.Ignore };
            hintTrack.style.width = 150;
            hintTrack.style.height = 3;
            hintTrack.style.marginTop = 6;
            hintTrack.style.backgroundColor = new Color(1, 1, 1, 0.18f);
            hintFill = new VisualElement { pickingMode = PickingMode.Ignore };
            hintFill.style.height = Length.Percent(100);
            hintFill.style.width = Length.Percent(0);
            hintFill.style.backgroundColor = UITheme.GoldHi;
            hintTrack.Add(hintFill);
            hint.Add(hintLabel);
            hint.Add(hintTrack);
            hint.style.display = DisplayStyle.None;
            root.Add(hint);

            parent.Add(root);
            Apply();
        }

        /// <summary>挂到 UI 根的 Overlay 层（没有 UI 根——编辑模式 / 退出中——返回 null）</summary>
        public static CinematicOverlay Create()
        {
            var ui = UIRoot.Ensure();
            if (!ui) return null;
            var layer = ui.Layer(UILayer.Overlay);
            return layer != null ? new CinematicOverlay(layer) : null;
        }

        static void Fill(VisualElement e)
        {
            e.style.position = Position.Absolute;
            e.style.left = 0;
            e.style.right = 0;
            e.style.top = 0;
            e.style.bottom = 0;
        }

        static VisualElement Bar(bool atTop)
        {
            var b = new VisualElement { name = atTop ? "letterbox-top" : "letterbox-bottom", pickingMode = PickingMode.Ignore };
            b.style.position = Position.Absolute;
            b.style.left = 0;
            b.style.right = 0;
            if (atTop) b.style.top = 0;
            else b.style.bottom = 0;
            b.style.height = Length.Percent(0);
            b.style.backgroundColor = Color.black;
            return b;
        }

        static Label Text(float size, Color color, float spacing)
        {
            var l = new Label { pickingMode = PickingMode.Ignore };
            l.style.fontSize = size;
            l.style.color = color;
            l.style.letterSpacing = spacing;
            l.style.unityTextAlign = TextAnchor.MiddleLeft;
            l.style.marginLeft = 0;
            l.style.marginRight = 0;
            l.style.paddingLeft = 0;
            l.style.paddingRight = 0;
            l.style.textShadow = new TextShadow { offset = new Vector2(0, 2), blurRadius = 6, color = new Color(0, 0, 0, 0.85f) };
            return l;
        }

        /// <summary>显示名字卡 seconds 秒（之后自动淡出）</summary>
        public void ShowCaption(string titleText, string subText, string epithetText, float seconds)
        {
            if (string.IsNullOrEmpty(titleText)) return;
            UIFonts.Warmup(titleText, UIFontRole.Title);
            title.text = titleText;
            sub.text = subText ?? "";
            epithet.text = epithetText ?? "";
            sub.style.display = string.IsNullOrEmpty(subText) ? DisplayStyle.None : DisplayStyle.Flex;
            epithet.style.display = string.IsNullOrEmpty(epithetText) ? DisplayStyle.None : DisplayStyle.Flex;
            caption.style.display = DisplayStyle.Flex;
            scrim.style.display = DisplayStyle.Flex;
            captionAt = Time.unscaledTime;
            captionUntil = captionAt + Mathf.Max(0.8f, seconds);
            captionOutAt = -1;
            Apply();
        }

        /// <summary>收起名字卡（淡出）</summary>
        public void HideCaption()
        {
            if (captionAt < 0 || captionOutAt >= 0) return;
            captionOutAt = Time.unscaledTime;
        }

        /// <summary>跳过提示：visible、按住进度 0–1、文字</summary>
        public void SetHint(bool visible, float progress, string text)
        {
            hint.style.display = visible ? DisplayStyle.Flex : DisplayStyle.None;
            if (!visible) return;
            if (hintLabel.text != text) hintLabel.text = text;
            hintFill.style.width = Length.Percent(Mathf.Clamp01(progress) * 100f);
        }

        public void Tick(float unscaledDt)
        {
            // 同层的全屏闪光（UIFlash）每次播放都会 BringToFront：黑边 / 名字卡要压在它上面，黑边不被染色
            var parent = root.parent;
            if (parent != null && parent.IndexOf(root) != parent.childCount - 1) root.BringToFront();
            bars = Mathf.MoveTowards(bars, barsTarget, Mathf.Max(0, unscaledDt) / BarTime);
            Apply();
        }

        void Apply()
        {
            float b = IntroMath.Ease(IntroEase.InOut, bars) * BarPercent;
            top.style.height = Length.Percent(b);
            bottom.style.height = Length.Percent(b);
            if (captionAt < 0) return;
            float now = Time.unscaledTime;
            if (captionOutAt < 0 && now >= captionUntil) captionOutAt = now;
            float t = now - captionAt;
            float kt = IntroMath.Ease(IntroEase.Out, Mathf.Clamp01(t / TitleIn));
            title.style.opacity = kt;
            title.style.letterSpacing = Mathf.Lerp(34f, 12f, kt);
            title.style.translate = new Translate(-36f * (1 - kt), 0);
            float ks = IntroMath.Ease(IntroEase.Out, Mathf.Clamp01((t - SubDelay) / SubIn));
            sub.style.opacity = ks;
            epithet.style.opacity = ks * 0.9f;
            rule.style.opacity = ks;
            rule.style.scale = new Scale(new Vector2(Mathf.Max(0.0001f, ks), 1));
            sub.style.translate = new Translate(0, 8f * (1 - ks));
            float ko = captionOutAt >= 0 ? Mathf.Clamp01((now - captionOutAt) / OutTime) : 0;
            caption.style.opacity = 1 - ko;
            scrim.style.opacity = Mathf.Min(kt, 1 - ko);
            if (ko >= 1)
            {
                captionAt = -1;
                captionOutAt = -1;
                caption.style.display = DisplayStyle.None;
                scrim.style.display = DisplayStyle.None;
            }
        }

        /// <summary>从界面上拿掉（演出结束、被打断）</summary>
        public void Dispose() => root.RemoveFromHierarchy();
    }
}
