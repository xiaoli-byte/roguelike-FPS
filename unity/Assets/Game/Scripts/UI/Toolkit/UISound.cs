using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 按钮音（GameAudio 的 ui_click / ui_hover / ui_confirm / ui_deny，Three.js 烘焙来的同一组）。
    /// <see cref="UIRoot"/> 在每层根元素上挂一次 <see cref="Attach"/>，之后任何界面里的按钮都自动出声，不用逐个绑：
    ///   鼠标点击（ClickEvent）→ 点击音；指针移入按钮 → 悬停音（节流 40 ms）；
    ///   手柄 / 键盘确认由 <see cref="UIRouter"/> 激活按钮时调 <see cref="Click"/>，焦点移动调 <see cref="Hover"/>。
    /// 按钮上加类 sf-sound-confirm / sf-sound-deny 换音，sf-silent 不出声；禁用的按钮点了出 ui_deny。
    /// 「按钮」= Button、Toggle 或带 sf-btn 类的元素（自绘按钮）。
    /// </summary>
    public static class UISound
    {
        public const string ClickId = "ui_click", HoverId = "ui_hover", ConfirmId = "ui_confirm", DenyId = "ui_deny";
        /// <summary>界面音量（GameAudio 再乘 SFX 音量）</summary>
        public static float Volume = 1f;
        static float lastHover = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => lastHover = -1;

        public static void Play(string id)
        {
            if (Volume > 0) GameAudio.Play(id, Volume);
        }

        /// <summary>按钮被激活：按它的类挑音（确认 / 拒绝 / 点击 / 静音）</summary>
        public static void Click(VisualElement button)
        {
            if (button == null || button.ClassListContains(UITheme.Silent)) return;
            if (!button.enabledInHierarchy) Play(DenyId);
            else if (button.ClassListContains(UITheme.SoundConfirm)) Play(ConfirmId);
            else if (button.ClassListContains(UITheme.SoundDeny)) Play(DenyId);
            else Play(ClickId);
        }

        /// <summary>悬停 / 焦点移到按钮上（节流，防止扫过一排按钮时连响）</summary>
        public static void Hover(VisualElement button)
        {
            if (button == null || button.ClassListContains(UITheme.Silent)) return;
            float now = Time.unscaledTime;
            if (now - lastHover < 0.04f) return;
            lastHover = now;
            Play(HoverId);
        }

        /// <summary>按钮：Button / Toggle / 带 sf-btn 类</summary>
        public static bool IsButton(VisualElement e) => e is Button || e is Toggle || (e != null && e.ClassListContains(UITheme.Button));

        /// <summary>往上找最近的按钮（点在按钮里的文字 / 图标上也算点按钮）</summary>
        public static VisualElement ButtonOf(VisualElement e)
        {
            for (var p = e; p != null; p = p.parent)
                if (IsButton(p)) return p;
            return null;
        }

        /// <summary>
        /// 在一层的根元素上挂全局回调。点击在冒泡阶段（按钮自己 StopPropagation 的就不响）；
        /// 指针进入不冒泡、只下沉，所以挂下沉阶段，并且只认「进入的就是按钮本身」——按钮里的文字 / 图标之间移动不算
        /// </summary>
        public static void Attach(VisualElement root)
        {
            root.RegisterCallback<ClickEvent>(e => Click(ButtonOf(e.target as VisualElement)));
            root.RegisterCallback<PointerEnterEvent>(e =>
            {
                if (e.target is VisualElement v && IsButton(v) && v.enabledInHierarchy) Hover(v);
            }, TrickleDown.TrickleDown);
        }
    }
}
