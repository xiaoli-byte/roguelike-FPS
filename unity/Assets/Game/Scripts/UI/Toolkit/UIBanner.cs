using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 大横幅（Three.js src/ui/Notify.ts 的 Banner + base.css .gf-banner）：屏幕 17% 高处居中，
    /// 标题用标题字体（霞鹜文楷子集）鎏金色、两侧祥云、下面一道两端渐隐的金线、再下面副标题；底下垫一层淡墨径向衬底（沙漠 / 雪地亮天空下也清楚）。
    /// 动画（不缩放时间）：标题 0.9 s 字距收拢 + 淡入；金线 0.15 s 后 0.8 s 展开；祥云和副标题 0.25 s 后 0.7 s 上浮淡入；收起 0.5 s 上移淡出。
    /// 同一标题还在显示（例如关卡导演与首领先后为同一首领发横幅）：只换副标题、延长时间，不重播动画。
    /// </summary>
    public sealed class UIBanner
    {
        const float TitleIn = 0.9f, RuleDelay = 0.15f, RuleIn = 0.8f, RiseDelay = 0.25f, RiseIn = 0.7f, OutTime = 0.5f, MinSeconds = 0.6f;
        /// <summary>标题字距（设计像素）：入场从 40 收到 20（Three.js 0.6em → 0.3em，66 px 字）</summary>
        const float SpacingFrom = 40f, SpacingTo = 20f;

        readonly VisualElement root, rule, cloudL, cloudR;
        readonly Label title, sub;
        float shownAt, until, hideAt = -1;
        bool visible;

        public UIBanner(VisualElement parent)
        {
            root = new VisualElement { name = "banner", pickingMode = PickingMode.Ignore };
            root.AddToClassList("sf-banner");
            var backdrop = new VisualElement { name = "backdrop", pickingMode = PickingMode.Ignore };
            backdrop.AddToClassList("sf-banner__backdrop");
            UITheme.Paint(backdrop, UITheme.RadialSoft, UITheme.Ink0);
            root.Add(backdrop);

            var row = new VisualElement { pickingMode = PickingMode.Ignore };
            row.AddToClassList("sf-banner__row");
            cloudL = UIIcons.Make(UIIcon.Cloud, "sf-banner__cloud");
            row.Add(cloudL);
            title = new Label { pickingMode = PickingMode.Ignore };
            title.AddToClassList("sf-banner__title");
            title.AddToClassList(UITheme.TitleFont);
            if (UIFonts.Title) title.style.unityFontDefinition = FontDefinition.FromSDFFont(UIFonts.Title);
            row.Add(title);
            cloudR = UIIcons.Make(UIIcon.Cloud, "sf-banner__cloud", "sf-banner__cloud--r");
            row.Add(cloudR);
            root.Add(row);

            rule = new VisualElement { pickingMode = PickingMode.Ignore };
            rule.AddToClassList("sf-banner__rule");
            UITheme.Paint(rule, UITheme.FadeBoth, UITheme.Gold);
            root.Add(rule);

            sub = new Label { pickingMode = PickingMode.Ignore };
            sub.AddToClassList("sf-banner__sub");
            root.Add(sub);
            root.style.display = DisplayStyle.None;
            parent.Add(root);
        }

        /// <summary>根元素（截图判断用）</summary>
        public VisualElement Root => root;
        /// <summary>正在显示（含收起动画）</summary>
        public bool Visible => visible;
        public string Title => visible ? title.text : null;
        public string Subtitle => visible ? sub.text : null;

        /// <summary>显示横幅；title 和 sub 都空则忽略</summary>
        public void Show(string titleText, string subText = null, float seconds = 2.6f)
        {
            if (string.IsNullOrEmpty(titleText) && string.IsNullOrEmpty(subText)) return;
            float now = Time.unscaledTime;
            seconds = Mathf.Max(MinSeconds, float.IsNaN(seconds) ? 2.6f : seconds);
            if (visible && hideAt < 0 && !string.IsNullOrEmpty(titleText) && titleText == title.text)
            {
                if (!string.IsNullOrEmpty(subText))
                {
                    sub.text = subText;
                    sub.style.display = DisplayStyle.Flex;
                }
                until = now + seconds;
                return;
            }
            title.text = titleText ?? "";
            sub.text = subText ?? "";
            sub.style.display = string.IsNullOrEmpty(subText) ? DisplayStyle.None : DisplayStyle.Flex;
            root.style.display = DisplayStyle.Flex;
            visible = true;
            shownAt = now;
            until = now + seconds;
            hideAt = -1;
            Apply(now);
        }

        /// <summary>收起（immediate = 不播淡出）</summary>
        public void Hide(bool immediate = false)
        {
            if (!visible) return;
            if (immediate)
            {
                visible = false;
                hideAt = -1;
                root.style.display = DisplayStyle.None;
                return;
            }
            if (hideAt < 0) hideAt = Time.unscaledTime;
        }

        public void Tick(float now)
        {
            if (!visible) return;
            if (hideAt < 0 && now >= until) hideAt = now;
            Apply(now);
        }

        static float EaseOut(float k) => 1 - (1 - k) * (1 - k) * (1 - k);

        void Apply(float now)
        {
            float t = now - shownAt;
            float kt = EaseOut(Mathf.Clamp01(t / TitleIn));
            title.style.opacity = Mathf.Lerp(0.3f, 1f, kt);
            title.style.letterSpacing = Mathf.Lerp(SpacingFrom, SpacingTo, kt);
            title.style.paddingLeft = Mathf.Lerp(SpacingFrom, SpacingTo, kt); // 字距只加在字后面：左边补同样的空，标题保持居中
            float kr = EaseOut(Mathf.Clamp01((t - RuleDelay) / RuleIn));
            rule.style.opacity = kr;
            rule.style.scale = new Scale(new Vector2(Mathf.Max(0.0001f, kr), 1));
            float ks = EaseOut(Mathf.Clamp01((t - RiseDelay) / RiseIn));
            foreach (var e in new[] { cloudL, cloudR, (VisualElement)sub })
            {
                e.style.opacity = ks;
                e.style.translate = new Translate(0, 10f * (1 - ks));
            }
            if (hideAt >= 0)
            {
                float ko = Mathf.Clamp01((now - hideAt) / OutTime);
                root.style.opacity = 1 - ko;
                root.style.translate = new Translate(0, -8f * ko);
                if (ko >= 1)
                {
                    visible = false;
                    hideAt = -1;
                    root.style.display = DisplayStyle.None;
                }
            }
            else
            {
                root.style.opacity = 1;
                root.style.translate = new Translate(0, 0);
            }
        }
    }
}
