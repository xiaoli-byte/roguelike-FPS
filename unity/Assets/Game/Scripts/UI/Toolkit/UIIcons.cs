using System;
using System.IO;
using Unity.VectorGraphics;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>图标（Three.js src/ui/icons.ts 的 9 个内联 SVG）</summary>
    public enum UIIcon
    {
        /// <summary>方孔铜钱（灵石）</summary>
        Coin,
        /// <summary>魂晶</summary>
        Essence,
        /// <summary>双刃（剩余敌人）</summary>
        Blades,
        /// <summary>祥云纹（装饰，横幅两侧）</summary>
        Cloud,
        /// <summary>锁</summary>
        Lock,
        /// <summary>沙漏（用时）</summary>
        Hourglass,
        /// <summary>骷髅（击杀）</summary>
        Skull,
        /// <summary>火花（总伤害）</summary>
        Spark,
        /// <summary>门（清关）</summary>
        Gate,
    }

    /// <summary>
    /// 界面图标：Three.js icons.ts 的 SVG 原样移植，运行时用 Unity 6 内置的 VectorGraphics 模块（SVGParser → VectorUtils.BuildVectorImage）
    /// 解析成 <see cref="VectorImage"/>，第一次用时生成并缓存。选这条路而不是导入成资产：worktree 里不能生成 .asset，
    /// 图标又少又小，现解析几毫秒；矢量图任意缩放不糊，和 UI Toolkit 的 background-image 直接对接。
    /// 移植时的改动：currentColor 换成白色（颜色由 -unity-background-image-tint-color 染，见 theme.uss 的 .sf-icon--*），
    /// rgba() 拆成十六进制 + opacity，路径里省略的命令补全（隐式 L / 连续 C），根元素上继承的 fill / stroke 写到每条路径上，
    /// 骷髅的眼窝用 evenodd 挖空。解析失败返回 null，只警告一次。
    /// </summary>
    public static class UIIcons
    {
        const string Head = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\">";

        static readonly string[] svg =
        {
            // Coin
            Head +
            "<circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#ffffff\"/>" +
            "<circle cx=\"12\" cy=\"12\" r=\"7.8\" fill=\"none\" stroke=\"#281806\" stroke-opacity=\"0.45\" stroke-width=\"1.1\"/>" +
            "<rect x=\"8.9\" y=\"8.9\" width=\"6.2\" height=\"6.2\" fill=\"#180e04\" fill-opacity=\"0.9\" stroke=\"#fff0c8\" stroke-opacity=\"0.35\" stroke-width=\"0.6\"/></svg>",
            // Essence
            Head +
            "<path d=\"M12 1.5 L18.5 9 L12 22.5 L5.5 9 Z\" fill=\"#ffffff\"/>" +
            "<path d=\"M12 1.5 L9.2 9 L12 22.5 L14.8 9 Z M5.5 9 H18.5\" fill=\"none\" stroke=\"#0a0a1e\" stroke-opacity=\"0.45\" stroke-width=\"0.9\"/>" +
            "<path d=\"M12 3.6 L13.4 8.6\" fill=\"none\" stroke=\"#ffffff\" stroke-opacity=\"0.7\" stroke-width=\"1\" stroke-linecap=\"round\"/></svg>",
            // Blades
            Head +
            "<path d=\"M4 3.5 L15 14.5 M20 3.5 L9 14.5\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"2\" stroke-linecap=\"round\"/>" +
            "<path d=\"M12.5 17 L17 12.5 M11.5 17 L7 12.5\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>" +
            "<path d=\"M16.5 17.5 L20 21 M7.5 17.5 L4 21\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>",
            // Cloud（100 × 40）
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"40\" viewBox=\"0 0 100 40\">" +
            "<path d=\"M8 32 C2 32 2 22 10 22 C10 12 24 10 28 18 C32 6 52 6 54 18 C60 10 74 12 72 22 C82 20 90 28 84 32 Z\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" +
            "<path d=\"M28 18 c2 6 10 6 10 0 c0 -4 -6 -4 -6 0 M54 18 c0 7 10 8 10 2 c0 -4 -6 -4 -5 0 M10 22 c3 4 8 3 8 -1\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
            // Lock
            Head +
            "<rect x=\"5\" y=\"10.5\" width=\"14\" height=\"10\" rx=\"1.5\" ry=\"1.5\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"2\"/>" +
            "<path d=\"M8 10.5 V7.5 A4 4 0 0 1 16 7.5 V10.5\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"2\"/></svg>",
            // Hourglass
            Head +
            "<path d=\"M6 3 H18 M6 21 H18 M7 3 C7 8 17 9 17 12 C17 15 7 16 7 21 M17 3 C17 8 7 9 7 12 C7 15 17 16 17 21\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg>",
            // Skull
            Head +
            "<path fill-rule=\"evenodd\" fill=\"#ffffff\" d=\"M12 2.5 c-4.7 0 -8 3.2 -8 7.6 c0 2.6 1.2 4.4 2.8 5.5 V19 h2.4 v-2 h1.6 v2 h2.4 v-2 h1.6 v2 h2.4 v-3.4 " +
            "c1.6 -1.1 2.8 -2.9 2.8 -5.5 c0 -4.4 -3.3 -7.6 -8 -7.6 Z M8.8 12.8 a1.9 1.9 0 1 1 0 -3.8 a1.9 1.9 0 0 1 0 3.8 Z M15.2 12.8 a1.9 1.9 0 1 1 0 -3.8 a1.9 1.9 0 0 1 0 3.8 Z\"/></svg>",
            // Spark
            Head +
            "<path fill=\"#ffffff\" d=\"M12 1.5 c0.6 4.6 2.4 7.4 6.6 8.4 c-4.2 1 -6 3.8 -6.6 8.4 c-0.6 -4.6 -2.4 -7.4 -6.6 -8.4 c4.2 -1 6 -3.8 6.6 -8.4 Z\"/>" +
            "<path fill=\"#ffffff\" fill-opacity=\"0.7\" d=\"M19 15.5 c0.3 2 1.1 3.2 3 3.6 c-1.9 0.4 -2.7 1.6 -3 3.6 c-0.3 -2 -1.1 -3.2 -3 -3.6 c1.9 -0.4 2.7 -1.6 3 -3.6 Z\"/></svg>",
            // Gate
            Head +
            "<path d=\"M3 6 H21 M5 3.5 H19 M6 6 V21 M18 6 V21 M9.5 6 V21 M14.5 6 V21\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg>",
        };

        static readonly VectorImage[] cache = new VectorImage[svg.Length];
        static readonly bool[] failed = new bool[svg.Length];

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            for (int i = 0; i < cache.Length; i++)
            {
                if (cache[i]) UnityEngine.Object.Destroy(cache[i]);
                cache[i] = null;
                failed[i] = false;
            }
        }

        /// <summary>图标个数</summary>
        public static int Count => svg.Length;

        /// <summary>SVG 源码（调试 / 编辑器检查用）</summary>
        public static string Source(UIIcon icon) => svg[(int)icon];

        /// <summary>图标的矢量图（白色，按需染色）；解析失败为 null</summary>
        public static VectorImage Get(UIIcon icon)
        {
            int i = (int)icon;
            if (i < 0 || i >= svg.Length) return null;
            if (cache[i] || failed[i]) return cache[i];
            try
            {
                cache[i] = Build(svg[i]);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[UI] 图标 {icon} 解析失败：{e.Message}");
            }
            if (!cache[i])
            {
                failed[i] = true;
                return null;
            }
            cache[i].name = "UI Icon " + icon;
            cache[i].hideFlags = HideFlags.HideAndDontSave;
            return cache[i];
        }

        /// <summary>SVG 文本 → VectorImage：优先内置的抗锯齿构建，拿不到再退回三角化</summary>
        public static VectorImage Build(string source)
        {
            var info = SVGParser.ImportSVG(new StringReader(source), ViewportOptions.PreserveViewport);
            VectorImage image = null;
            try { image = VectorUtils.BuildVectorImage(info); }
            catch (Exception) { image = null; }
            if (image) return image;
            var opts = new VectorUtils.TessellationOptions { StepDistance = 0.5f, MaxCordDeviation = 0.05f, MaxTanAngleDeviation = 0.1f, SamplingStepSize = 0.01f };
            var geoms = VectorUtils.TessellateScene(info.Scene, opts, info.NodeOpacity);
            return VectorUtils.BuildVectorImage(geoms);
        }

        /// <summary>
        /// 一个图标元素：类 sf-icon + sf-icon--&lt;名字小写&gt;（theme.uss 里定尺寸和颜色），再加上 extraClasses。
        /// 解析失败时元素照样返回（空白，不影响排版）
        /// </summary>
        public static VisualElement Make(UIIcon icon, params string[] extraClasses)
        {
            var e = new VisualElement { name = "icon-" + icon.ToString().ToLowerInvariant(), pickingMode = PickingMode.Ignore };
            e.AddToClassList(UITheme.Icon);
            e.AddToClassList(UITheme.Icon + "--" + icon.ToString().ToLowerInvariant());
            if (extraClasses != null)
                foreach (var c in extraClasses)
                    if (!string.IsNullOrEmpty(c)) e.AddToClassList(c);
            var img = Get(icon);
            if (img) e.style.backgroundImage = new StyleBackground(img);
            return e;
        }
    }
}
