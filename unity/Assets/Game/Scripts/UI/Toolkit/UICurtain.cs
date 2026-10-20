using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 全屏黑幕（Three.js src/ui/Fade.ts）：最上层，盖住 HUD、界面和提示。用不缩放时间、smoothstep 缓动；
    /// 新的淡入淡出立刻结束上一个（上一个的 await 马上返回），从当前不透明度接着过渡；
    /// 到达终点后再等一帧才返回，保证最终画面已经上屏（例如黑幕盖住后再加载关卡）。
    /// </summary>
    public sealed class UICurtain
    {
        readonly VisualElement el;
        float value;
        int token;

        public UICurtain(VisualElement parent)
        {
            el = new VisualElement { name = "curtain", pickingMode = PickingMode.Ignore };
            el.AddToClassList("sf-curtain");
            parent.Add(el);
            Set(0);
        }

        /// <summary>当前不透明度（0 透明 → 1 全黑）</summary>
        public float Value => value;

        /// <summary>立刻设成某个不透明度（打断进行中的过渡）</summary>
        public void Set(float alpha)
        {
            token++;
            Apply(Mathf.Clamp01(alpha));
        }

        /// <summary>淡到 to，用时 seconds（不缩放时间）；可 await</summary>
        public async Awaitable FadeTo(float to, float seconds)
        {
            int my = ++token;
            float goal = Mathf.Clamp01(float.IsNaN(to) ? 0 : to);
            float from = value, dur = Mathf.Max(0, float.IsNaN(seconds) ? 0 : seconds), t = 0;
            el.BringToFront();
            while (t < dur)
            {
                float k = t / dur;
                Apply(from + (goal - from) * k * k * (3 - 2 * k));
                await Awaitable.NextFrameAsync();
                if (my != token || el.panel == null) return;
                t += Time.unscaledDeltaTime;
            }
            Apply(goal);
            await Awaitable.NextFrameAsync();
        }

        void Apply(float a)
        {
            value = a;
            el.style.opacity = a;
            el.style.display = a <= 0.001f ? DisplayStyle.None : DisplayStyle.Flex;
        }
    }
}
