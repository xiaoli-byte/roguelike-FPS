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
    /// 改参数只改这里（运行时 <see cref="UIRoot"/> 用资产的副本，缩放参数再按这里写一遍，资产旧了也不影响）。
    /// 缩放：四层都「按参考分辨率 1920×1080 缩放，<see cref="MatchMode"/> = Expand」——缩放倍率 = min(宽 / 1920, 高 / 1080)，
    /// 面板的逻辑尺寸在任何分辨率下都不小于 1920×1080（16:9 的 1280×720 / 1366×768 / 1600×900 / 2560×1440 都正好是 1920×1080，
    /// 16:10、窗口化的怪尺寸在宽或高一边多出来）。USS 按 1920×1080 写的排版因此在哪个分辨率下都一样，不会被挤得断行、溢出。
    /// 相当于每个分辨率自动取 match（宽、高里更紧的那一边），比固定 match 稳：固定按高度匹配时 16:10 的逻辑宽度只有 1728，会挤。
    /// （以前照搬 Three.js computeUiScale 用「固定像素 × 缩放」，小屏幕只缩差值的 45%：1477×791 下逻辑尺寸只剩 1680×900，菜单文字被挤成两行。）
    /// </summary>
    public static class UILayers
    {
        public const int Count = 4;
        /// <summary>设计分辨率：USS 里的像素值都按 1920×1080 写（与 Three.js 的 CSS 设计像素一致）</summary>
        public static readonly Vector2Int ReferenceResolution = new(1920, 1080);
        /// <summary>按参考分辨率缩放时的匹配方式：Expand = 逻辑尺寸两边都不小于参考分辨率（缩放取宽高比例里小的那个）</summary>
        public const PanelScreenMatchMode MatchMode = PanelScreenMatchMode.Expand;
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
            ApplyScaling(ps);
            ps.sortingOrder = SortingOrder(layer);
            ps.targetDisplay = 0;
            ps.clearColor = false;
            ps.clearDepthStencil = false;
        }

        /// <summary>缩放参数：按参考分辨率缩放 + Expand（match 只在 MatchWidthOrHeight 下起作用，留 1 = 按高度，换回那种模式时的默认）</summary>
        public static void ApplyScaling(PanelSettings ps)
        {
            ps.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            ps.referenceResolution = ReferenceResolution;
            ps.screenMatchMode = MatchMode;
            ps.match = 1f;
            ps.scale = 1f;
        }

        /// <summary>
        /// 面板在 width×height 屏幕上的缩放倍率（= PanelSettings 按 Expand 算出来的：min(宽 / 1920, 高 / 1080)）；
        /// 屏幕像素 ÷ 它 = 面板逻辑尺寸（设计像素）。四层一样，layer 参数留着兼容
        /// </summary>
        public static float Scale(UILayer layer, int width, int height)
        {
            float s = Mathf.Min(width / (float)ReferenceResolution.x, height / (float)ReferenceResolution.y);
            return float.IsNaN(s) || float.IsInfinity(s) || s <= 0 ? 1 : s;
        }
    }
}
