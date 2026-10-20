using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 屏幕中央的大字（阵亡 / 本关完成，<see cref="GameUI.SetCenterText"/>）：叠层（和横幅、闪光同层，HUD 之上、界面之下），标题字体 72、朱红描边，
    /// 支持富文本（第二、三行用 &lt;size=34&gt; 之类缩小）；底下垫一层淡墨衬底。出现时 0.35 s 放大淡入。U5 的结算界面接手之前用它。
    /// </summary>
    [HudWidget("center-text", Order = 80, Layer = UILayer.Overlay)]
    public sealed class CenterTextWidget : HudWidget
    {
        const float InTime = 0.35f;

        Label label;
        VisualElement backdrop;
        float shownAt = -10;
        bool animating;

        /// <summary>当前文字（测试用；收起为空）</summary>
        public string Text => label != null && Visible ? label.text : "";

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-center");
            backdrop = HudArt.El("sf-center__backdrop", root);
            HudArt.Paint(backdrop, UITheme.RadialSoft, UITheme.Ink0);
            label = HudArt.Text("sf-center__text", root, "", UIFontRole.Title, rich: true);
            root.style.display = DisplayStyle.None;
            return root;
        }

        public void Set(string richText)
        {
            bool on = !string.IsNullOrEmpty(richText);
            if (on && label.text != richText)
            {
                label.text = richText;
                shownAt = Time.unscaledTime;
                animating = true;
            }
            if (!on) label.text = "";
            Visible = on;
        }

        public override void Tick(in HudFrame f)
        {
            if (!animating) return;
            float k = (f.unscaledTime - shownAt) / InTime;
            if (k >= 1 || k < 0)
            {
                animating = false;
                label.style.opacity = StyleKeyword.Null;
                label.style.scale = StyleKeyword.Null;
                return;
            }
            float e = 1 - (1 - k) * (1 - k) * (1 - k);
            label.style.opacity = e;
            label.style.scale = new Scale(Vector3.one * Mathf.Lerp(1.12f, 1f, e));
        }
    }
}
