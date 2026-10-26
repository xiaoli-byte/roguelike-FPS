using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 提示队列（Three.js src/ui/Notify.ts 的 Toasts）：屏幕左侧 38% 高处往下叠，最多 4 条，满了先快速收走最老的；
    /// 和最新一条文字相同就合并计数「×N」、弹一下、刷新计时。颜色是左边竖线 / 菱形 / 计数的强调色（缺省鎏金），正文统一纸色。
    /// 计时和动画都用不缩放时间：暂停 / 慢动作中照常出现和消失。进场 0.34 s 从左滑入，离场 0.36 s（被挤掉 0.16 s）。
    /// </summary>
    public sealed class UIToasts
    {
        public const int Max = 4;
        public const float DefaultSeconds = 2.8f;
        const float EnterTime = 0.34f, LeaveTime = 0.36f, LeaveFast = 0.16f, PulseTime = 0.18f;

        sealed class Item
        {
            public VisualElement el;
            public Label text, count;
            public string message;
            public int n;
            public float born, until, leaveStart, pulseStart = -1, seconds;
            public bool leaving, fast;
        }

        readonly VisualElement root;
        readonly List<Item> items = new();
        readonly List<Item> leaving = new();
        float shown = 1, lastTick = -1;

        public UIToasts(VisualElement parent)
        {
            root = new VisualElement { name = "toasts", pickingMode = PickingMode.Ignore };
            root.AddToClassList("sf-toasts");
            parent.Add(root);
        }

        /// <summary>显示中的条数（不含正在离场的）</summary>
        public int Count => items.Count;

        /// <summary>显示中的文字（从老到新；测试用）</summary>
        public IEnumerable<string> Texts
        {
            get
            {
                foreach (var it in items) yield return it.n > 1 ? $"{it.message} ×{it.n}" : it.message;
            }
        }

        /// <summary>推一条提示：color = 强调色（缺省鎏金），seconds = 显示时长</summary>
        public void Push(string text, Color? color = null, float seconds = DefaultSeconds)
        {
            if (string.IsNullOrEmpty(text)) return;
            float now = Time.unscaledTime;
            seconds = seconds > 0 ? seconds : DefaultSeconds;
            var last = items.Count > 0 ? items[items.Count - 1] : null;
            if (last != null && last.message == text)
            {
                last.n++;
                last.count.text = "×" + last.n;
                last.count.style.display = DisplayStyle.Flex;
                last.pulseStart = now;
                last.seconds = Mathf.Max(last.seconds, seconds);
                last.until = now + last.seconds;
                return;
            }
            while (items.Count >= Max) Dismiss(items[0], true, now);

            var c = color ?? UITheme.GoldHi;
            var el = new VisualElement { name = "toast", pickingMode = PickingMode.Ignore };
            el.AddToClassList("sf-toast");
            UITheme.Paint(el, UITheme.FadeRight, UITheme.Ink0);
            el.style.borderLeftColor = c;
            var mark = new VisualElement { pickingMode = PickingMode.Ignore };
            mark.AddToClassList("sf-toast__mark");
            mark.style.backgroundColor = c;
            el.Add(mark);
            var label = new FitLabel(text) { pickingMode = PickingMode.Ignore };
            label.AddToClassList("sf-toast__text");
            el.Add(label);
            var cnt = new Label { pickingMode = PickingMode.Ignore };
            cnt.AddToClassList("sf-toast__count");
            cnt.AddToClassList(UITheme.NumberFont);
            cnt.style.color = c;
            cnt.style.display = DisplayStyle.None;
            el.Add(cnt);
            el.style.opacity = 0;
            root.Add(el);
            items.Add(new Item { el = el, text = label, count = cnt, message = text, n = 1, born = now, seconds = seconds, until = now + seconds });
        }

        /// <summary>全部快速收走（弹模态界面、结算前）</summary>
        public void Clear()
        {
            float now = Time.unscaledTime;
            while (items.Count > 0) Dismiss(items[0], true, now);
        }

        void Dismiss(Item it, bool fast, float now)
        {
            if (it.leaving) return;
            it.leaving = true;
            it.fast = fast;
            it.leaveStart = now;
            items.Remove(it);
            leaving.Add(it);
        }

        /// <summary>每帧（UIRoot，不缩放时间）</summary>
        public void Tick(float now)
        {
            // 电影模式（GameUI.HudHidden：首领登场演出）整层淡出、结束后淡回，同 HUD 层（出 0.15 s、进 0.45 s）；计时照走
            float target = GameUI.HudHidden ? 0 : 1, dt = lastTick < 0 ? 0 : Mathf.Max(0, now - lastTick);
            lastTick = now;
            if (shown != target)
            {
                shown = Mathf.MoveTowards(shown, target, dt / (target > shown ? 0.45f : 0.15f));
                root.style.opacity = shown;
            }
            for (int i = items.Count - 1; i >= 0; i--)
                if (now >= items[i].until) Dismiss(items[i], false, now);
            foreach (var it in items)
            {
                float k = Mathf.Clamp01((now - it.born) / EnterTime);
                float e = 1 - (1 - k) * (1 - k) * (1 - k);
                it.el.style.opacity = e;
                float pulse = it.pulseStart >= 0 ? Mathf.Clamp01((now - it.pulseStart) / PulseTime) : 1;
                float s = pulse < 1 ? Mathf.Lerp(1.06f, 1f, 1 - (1 - pulse) * (1 - pulse)) : 1f;
                it.el.style.translate = new Translate(-24f * (1 - e), 0);
                it.el.style.scale = new Scale(new Vector2(s, s));
            }
            for (int i = leaving.Count - 1; i >= 0; i--)
            {
                var it = leaving[i];
                float k = Mathf.Clamp01((now - it.leaveStart) / (it.fast ? LeaveFast : LeaveTime));
                if (k >= 1)
                {
                    it.el.RemoveFromHierarchy();
                    leaving.RemoveAt(i);
                    continue;
                }
                it.el.style.opacity = Mathf.Min(it.el.resolvedStyle.opacity, 1 - k);
                it.el.style.translate = new Translate(-16f * k, 0);
            }
        }
    }
}
