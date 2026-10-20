using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// UI Toolkit 的四层面板（docs/unity-parity.md 3.12 / U1）。每层一个 PanelSettings（= 一个面板），按 sortingOrder 叠：
    ///   <see cref="Hud"/> 战斗 HUD、伤害数字、头顶血条（U2 / U3）
    ///   <see cref="Overlay"/> 横幅、全屏闪光、交互提示这类不接输入的叠层
    ///   <see cref="Modal"/> 由 <see cref="UIRouter"/> 管的界面（暂停、设置、三选一、菜单…）
    ///   <see cref="Toast"/> 提示队列，最上面是黑幕（换场景时盖住一切）
    /// 对应 Three.js 的 z-index：HUD 10 &lt; 横幅 20 &lt; 主菜单 30 &lt; toast 31 &lt; 暂停 32 … &lt; 黑幕 50
    /// （差别：toast 在全部界面之上，Three.js 里压在暂停 / 结算下面——toast 靠左，和居中的面板基本不重叠）。
    /// </summary>
    public enum UILayer
    {
        Hud = 0,
        Overlay = 1,
        Modal = 2,
        Toast = 3,
    }

    /// <summary>
    /// 分层面板的配置——编辑器的 UIBuilder 生成 Resources/UI/Panels/&lt;层&gt;.asset 和运行时兜底（资产还没生成时在内存里建）共用这一份，
    /// 改参数只改这里。缩放：资产里是「按屏幕缩放，参考 1920×1080、按高度匹配」（编辑器预览用），
    /// 运行时 <see cref="UIRoot"/> 用资产的副本改成「固定像素 × <see cref="Scale"/>」，照搬 Three.js 的 computeUiScale：
    /// 小屏幕不按比例缩到底（Steam Deck 1280×800 是 0.85 而不是 0.74），字不至于小到看不清。
    /// </summary>
    public static class UILayers
    {
        public const int Count = 4;
        /// <summary>设计分辨率：USS 里的像素值都按 1920×1080 写（与 Three.js 的 CSS 设计像素一致）</summary>
        public static readonly Vector2Int ReferenceResolution = new(1920, 1080);
        /// <summary>Resources 下的路径（不带扩展名）</summary>
        public const string PanelsFolder = "UI/Panels", ThemePath = "UI/DefaultTheme", StylePath = "UI/theme", TextSettingsPath = "UI/Panels/PanelText";

        static readonly string[] names = { "Hud", "Overlay", "Modal", "Toast" };
        static readonly float[] orders = { 0, 100, 200, 300 };

        public static string Name(UILayer layer) => names[(int)layer];
        /// <summary>PanelSettings.sortingOrder：大的画在上面、先收到输入</summary>
        public static float SortingOrder(UILayer layer) => orders[(int)layer];
        /// <summary>Resources.Load 用的路径，如 UI/Panels/Modal</summary>
        public static string ResourcePath(UILayer layer) => PanelsFolder + "/" + names[(int)layer];
        /// <summary>只有界面层接鼠标 / 手柄；其余层所有元素都不挡点击</summary>
        public static bool Interactive(UILayer layer) => layer == UILayer.Modal;

        /// <summary>写入一层的全部设置（编辑器生成资产、运行时兜底都调它）</summary>
        public static void Configure(PanelSettings ps, UILayer layer, ThemeStyleSheet theme, PanelTextSettings text)
        {
            ps.themeStyleSheet = theme;
            ps.textSettings = text;
            ps.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            ps.referenceResolution = ReferenceResolution;
            ps.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            ps.match = 1f;
            ps.sortingOrder = SortingOrder(layer);
            ps.targetDisplay = 0;
            ps.clearColor = false;
            ps.clearDepthStencil = false;
        }

        /// <summary>
        /// 运行时界面缩放（同 Three.js src/ui/dom.ts computeUiScale）：raw = min(宽 / 1920, 高 / 1080)，
        /// 放大照比例，缩小只缩差值的 45%，夹在 0.7–1.75；HUD 层下限 0.78
        /// </summary>
        public static float Scale(UILayer layer, int width, int height)
        {
            float raw = Mathf.Min(width / (float)ReferenceResolution.x, height / (float)ReferenceResolution.y);
            float s = raw >= 1 ? raw : 1 - (1 - raw) * 0.45f;
            if (float.IsNaN(s) || float.IsInfinity(s)) s = 1;
            s = Mathf.Clamp(s, 0.7f, 1.75f);
            return layer == UILayer.Hud ? Mathf.Clamp(s, 0.78f, 1.75f) : s;
        }
    }
}
