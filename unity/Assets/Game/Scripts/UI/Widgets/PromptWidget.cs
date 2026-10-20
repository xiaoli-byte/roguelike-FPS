using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 交互提示卡（Three.js src/ui/Notify.ts PromptCard + css/hud.css .gf-prompt；数据 = <see cref="InteractPrompt"/>）：
    ///   底部技能栏上方居中：左边朱砂键帽（交互键 / 自定按键）、右边 标题（标题字体，提示色，缺省鎏金）、副标题、多行说明（含 ▲ 的绿、含 ▼ 的红）、
    ///   价格（铜钱 + 数字；灵石不够标红并写「灵石不足」，每帧按当前灵石刷新）；
    ///   说明超过 3 行（武器对比）时改到准星右侧竖直居中，不挡准星和底部 HUD。
    /// 出现：0.18 s 淡入 + 上移 10；收起：0.2 s 淡出后隐藏。不缩放时间。
    /// </summary>
    [HudWidget("prompt", Order = 60)]
    public sealed class PromptWidget : HudWidget
    {
        const int DetailLines = 3;
        const float InTime = 0.2f, OutTime = 0.2f;

        VisualElement wrap, card, linesEl, costEl;
        Label key, title, sub, costNum, costShort;
        readonly List<Label> lineLabels = new();
        InteractPrompt? current;
        float changedAt = -10;
        bool open, animating, detail, shortV;

        /// <summary>当前显示的提示（测试用；收起后为 null）</summary>
        public InteractPrompt? Current => open ? current : null;

        protected override VisualElement Build()
        {
            // 外层负责摆位（底部居中 / 详细模式在准星右侧竖直居中），卡片本身的 translate 留给出入场动画
            wrap = HudArt.El("sf-prompt-wrap");
            card = HudArt.El("sf-prompt", wrap);
            key = HudArt.Text("sf-prompt__key", card, "F", UIFontRole.Number);
            var body = HudArt.El("sf-prompt__body", card);
            title = HudArt.Text("sf-prompt__title", body, "", UIFontRole.Title);
            sub = HudArt.Text("sf-prompt__sub", body);
            linesEl = HudArt.El("sf-prompt__lines", body);
            costEl = HudArt.El("sf-prompt__cost", body);
            costEl.Add(UIIcons.Make(UIIcon.Coin, "sf-icon--coin", "sf-prompt__coin"));
            costNum = HudArt.Text("sf-prompt__costnum", costEl, "", UIFontRole.Number);
            costShort = HudArt.Text("sf-prompt__short", costEl, "灵石不足");
            HudArt.Show(sub, false);
            HudArt.Show(linesEl, false);
            HudArt.Show(costEl, false);
            card.style.display = DisplayStyle.None;
            card.style.opacity = 0;
            return wrap;
        }

        /// <summary>设提示（null = 收起）</summary>
        public void Set(InteractPrompt? p)
        {
            if (p == null)
            {
                if (!open) return;
                open = false;
                changedAt = Time.unscaledTime;
                animating = true;
                return;
            }
            Sync(p.Value);
            current = p;
            if (!open)
            {
                open = true;
                changedAt = Time.unscaledTime;
                animating = true;
                card.style.display = DisplayStyle.Flex;
            }
        }

        void Sync(InteractPrompt p)
        {
            HudArt.SetText(title, p.title ?? "");
            title.style.color = p.color.a > 0 ? new Color(p.color.r, p.color.g, p.color.b, 1) : UITheme.GoldHi;
            card.style.borderLeftColor = p.color.a > 0 ? new Color(p.color.r, p.color.g, p.color.b, 1) : UITheme.GoldHi;
            HudArt.SetText(sub, p.subtitle ?? "");
            HudArt.Show(sub, !string.IsNullOrEmpty(p.subtitle));
            HudArt.SetText(key, string.IsNullOrEmpty(p.action) ? HudArt.Key(GameAction.Interact) : p.action);

            HudArt.Show(costEl, p.cost > 0);
            if (p.cost > 0) HudArt.SetText(costNum, HudArt.FormatNum(p.cost));
            shortV = !p.canAfford;
            ApplyShort(p.cost > 0 && shortV);

            int n = 0;
            if (p.lines != null)
                foreach (var line in p.lines)
                {
                    if (string.IsNullOrEmpty(line)) continue;
                    if (n >= lineLabels.Count) lineLabels.Add(HudArt.Text("sf-prompt__line", linesEl));
                    var l = lineLabels[n++];
                    HudArt.SetText(l, line);
                    HudArt.Show(l, true);
                    HudArt.Toggle(l, "is-up", line.IndexOf('▲') >= 0 || line.IndexOf('↑') >= 0);
                    HudArt.Toggle(l, "is-down", line.IndexOf('▼') >= 0 || line.IndexOf('↓') >= 0);
                }
            for (int i = n; i < lineLabels.Count; i++) HudArt.Show(lineLabels[i], false);
            HudArt.Show(linesEl, n > 0);
            bool d = n > DetailLines;
            if (d != detail)
            {
                detail = d;
                HudArt.Toggle(wrap, "is-detail", d);
            }
        }

        void ApplyShort(bool s)
        {
            HudArt.Toggle(costEl, "is-short", s);
            HudArt.Show(costShort, s);
        }

        public override void ResetState()
        {
            open = false;
            animating = false;
            current = null;
            card.style.display = DisplayStyle.None;
            card.style.opacity = 0;
        }

        public override void Tick(in HudFrame f)
        {
            // 每帧按当前灵石刷新「不足」
            if (open && current is InteractPrompt p && p.cost > 0)
            {
                bool s = (RunState.Current?.coins ?? 0) < p.cost;
                if (s != shortV)
                {
                    shortV = s;
                    ApplyShort(s);
                }
            }
            if (!animating) return;
            float k = (f.unscaledTime - changedAt) / (open ? InTime : OutTime);
            if (k < 0) k = 0;
            if (k >= 1)
            {
                animating = false;
                card.style.opacity = open ? 1 : 0;
                card.style.translate = StyleKeyword.Null;
                if (!open)
                {
                    card.style.display = DisplayStyle.None;
                    current = null;
                }
                return;
            }
            float e = 1 - (1 - k) * (1 - k) * (1 - k);
            card.style.opacity = open ? e : 1 - e;
            float off = open ? 10 * (1 - e) : 10 * e;
            card.style.translate = detail ? new Translate(off, 0) : new Translate(0, off);
        }
    }
}
