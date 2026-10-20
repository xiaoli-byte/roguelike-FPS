using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 全屏闪光（灵宠技能、结契、神兽现世…）：叠层（HUD 之上、界面之下），颜色含 alpha，按剩余时间的平方淡出，用不缩放时间（暂停中也会淡完）。
    /// 新的闪光替换旧的（同旧 Hud.ScreenFlash）。
    /// </summary>
    public sealed class UIFlash
    {
        readonly VisualElement el;
        Color color;
        float start, duration = 1;
        bool active;

        public UIFlash(VisualElement parent)
        {
            el = new VisualElement { name = "flash", pickingMode = PickingMode.Ignore };
            el.AddToClassList("sf-flash");
            el.style.display = DisplayStyle.None;
            parent.Add(el);
        }

        public VisualElement Root => el;
        /// <summary>正在闪</summary>
        public bool Active => active;

        public void Play(Color c, float seconds)
        {
            color = c;
            duration = Mathf.Max(0.05f, seconds);
            start = Time.unscaledTime;
            active = true;
            el.BringToFront();
            el.style.display = DisplayStyle.Flex;
            Tick(start);
        }

        public void Tick(float now)
        {
            if (!active) return;
            float k = 1 - Mathf.Clamp01((now - start) / duration);
            if (k <= 0)
            {
                active = false;
                el.style.display = DisplayStyle.None;
                return;
            }
            el.style.backgroundColor = new Color(color.r, color.g, color.b, color.a * k * k);
        }
    }
}
