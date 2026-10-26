using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// UI 排版体检（冒烟测试用；ui-res 套件）：扫一层面板里看得见的文字，找出
    ///   断行——按当前内容宽度量出来比文字里的换行符多出行来，而内容框差不多就是单行宽（内容宽 + 2 ≥ 单行宽：排版取整造成的「操作说⏎明」）；
    ///     成段的说明（white-space: normal、单行本来就放不下）自动换行不算；不换行（nowrap）的标签不会断行，看溢出；
    ///   溢出——露在外面的文字伸出屏幕，或横向伸出最近的裁剪祖先（overflow: hidden）/ 最近的「框」（自己或祖先里第一个有底色 / 底图 / 描边的元素：按钮、卡片、面板）；
    ///   重叠——两段不相干的文字（互不为祖先、都够不透明）露在裁剪框里的字面框交叠（滚动区里滚出视口的行不算）。
    /// 行数按 <see cref="TextElement.MeasureTextSize"/> 在元素当前内容宽度下量（和排版用的是同一个量法）；字面框按对齐方式摆在内容框里。
    /// 读不到实际渲染的行数：项目用的高级文字生成器（ATG）下 TextHandle.textInfo 会报错，GetLineNumber 走选区接口也报错，所以不读。
    /// </summary>
    public static class UiLayoutProbe
    {
        public sealed class Issue
        {
            public string kind, text, where;
            public override string ToString() => $"{kind}「{text}」{where}";
        }

        sealed class Item
        {
            public TextElement el;
            public string text;
            public Rect box;
            public bool opaque;
        }

        /// <summary>累计扫过的文字个数（套件报数用）</summary>
        public static int Scanned;

        /// <summary>扫 root 下看得见的文字，返回问题清单（同一元素同一种问题只记一次）</summary>
        public static List<Issue> Inspect(VisualElement root, Rect screen)
        {
            var issues = new List<Issue>();
            if (root == null || root.panel == null) return issues;
            var items = new List<Item>();
            root.Query<TextElement>().ForEach(te =>
            {
                if (!Visible(te, out float opacity)) return;
                string text = te.text;
                if (string.IsNullOrWhiteSpace(text)) return;
                var cr = te.contentRect;
                if (cr.width < 1 || float.IsNaN(cr.width)) return;
                Scanned++;
                var one = te.MeasureTextSize(text, 0, VisualElement.MeasureMode.Undefined, 0, VisualElement.MeasureMode.Undefined);
                if (!(one.y > 0.5f)) return;
                int expected = text.Count(c => c == '\n') + 1;
                var ws = te.resolvedStyle.whiteSpace;
                bool wraps = ws == WhiteSpace.Normal || ws == WhiteSpace.PreWrap;
                int lines = expected;
                Vector2 at = one;
                if (wraps)
                {
                    at = te.MeasureTextSize(text, cr.width, VisualElement.MeasureMode.Exactly, 0, VisualElement.MeasureMode.Undefined);
                    float lineH = one.y / Mathf.Max(1, expected);
                    lines = Mathf.Max(1, Mathf.RoundToInt(at.y / Mathf.Max(1, lineH)));
                    if (lines > expected && cr.width + 2 >= one.x)
                        issues.Add(new Issue { kind = "断行", text = Short(text), where = $"{lines} 行 {Where(te)}（内容宽 {cr.width:F1}，单行要 {one.x:F1}）" });
                }
                // 字面框：宽 = 单行宽（不换行时可能比内容框宽）或换行后的内容宽，按对齐摆
                float w = wraps && lines > 1 ? cr.width : one.x;
                float h = wraps ? at.y : one.y;
                var wb = te.worldBound;
                var origin = te.LocalToWorld(cr.position);
                var align = te.resolvedStyle.unityTextAlign;
                float x = origin.x, y = origin.y;
                float scaleX = cr.width > 0 ? wb.width / Mathf.Max(1, te.layout.width) : 1;
                float ww = w * scaleX, hh = h * scaleX, cw = cr.width * scaleX, ch = cr.height * scaleX;
                int col = (int)align % 3, row = (int)align / 3;
                if (col == 1) x += (cw - ww) * 0.5f;
                else if (col == 2) x += cw - ww;
                if (row == 1) y += (ch - hh) * 0.5f;
                else if (row == 2) y += ch - hh;
                var box = new Rect(x, y, ww, hh);
                // 露在外面的部分：字面框和每一层裁剪祖先求交（滚动区里滚出视口的行 = 空，出屏 / 重叠都不算它）
                var shown = box;
                var clip = Clip(te);
                for (var p = clip; p != null && shown.width > 0; p = Clip(p))
                {
                    var b = p.worldBound;
                    // 只按竖直方向裁：横向伸出裁剪框本身就是要报的溢出
                    shown = Intersect(shown, new Rect(shown.xMin, b.yMin, shown.width, b.height));
                }
                bool onScreen = shown.width > 1 && shown.height > 1;
                // 溢出：伸出屏幕 / 横向伸出最近的裁剪祖先 / 横向伸出最近的框
                const float Slack = 2f;
                if (onScreen && (shown.xMin < screen.xMin - Slack || shown.xMax > screen.xMax + Slack || shown.yMin < screen.yMin - Slack || shown.yMax > screen.yMax + Slack))
                    issues.Add(new Issue { kind = "出屏", text = Short(text), where = $"{Where(te)}（字面 {Fmt(shown)}，屏幕 {Fmt(screen)}）" });
                else if (clip != null && (box.xMin < clip.worldBound.xMin - Slack || box.xMax > clip.worldBound.xMax + Slack))
                    issues.Add(new Issue { kind = "溢出", text = Short(text), where = $"{Where(te)}（字面 {Fmt(box)}，裁剪框 {Fmt(clip.worldBound)} {Name(clip)}）" });
                else if (Frame(te) is { } frame && (box.xMin < frame.worldBound.xMin - Slack || box.xMax > frame.worldBound.xMax + Slack))
                    issues.Add(new Issue { kind = "溢出", text = Short(text), where = $"{Where(te)}（字面 {Fmt(box)}，框 {Fmt(frame.worldBound)} {Name(frame)}）" });
                if (onScreen)
                {
                    // 重叠按横竖都裁过的框比
                    var vis = shown;
                    for (var p = clip; p != null && vis.width > 0; p = Clip(p)) vis = Intersect(vis, p.worldBound);
                    if (vis.width > 1 && vis.height > 1)
                        items.Add(new Item { el = te, text = text, box = vis, opaque = opacity > 0.5f && te.resolvedStyle.color.a > 0.5f });
                }
            });
            // 重叠：两两比较（互不为祖先、都够不透明），交叠面积超过小的那个的 25%
            for (int i = 0; i < items.Count; i++)
            {
                var a = items[i];
                if (!a.opaque) continue;
                for (int j = i + 1; j < items.Count; j++)
                {
                    var b = items[j];
                    if (!b.opaque || Related(a.el, b.el)) continue;
                    var r = Intersect(a.box, b.box);
                    if (r.width <= 1 || r.height <= 1) continue;
                    float small = Mathf.Min(a.box.width * a.box.height, b.box.width * b.box.height);
                    if (r.width * r.height < small * 0.25f) continue;
                    issues.Add(new Issue { kind = "重叠", text = Short(a.text), where = $"和「{Short(b.text)}」{Where(a.el)} ⟷ {Where(b.el)}" });
                }
            }
            return issues;
        }

        /// <summary>几层面板一起扫（屏幕框取各层根的 worldBound）</summary>
        public static List<Issue> InspectLayers(params UILayer[] layers)
        {
            var all = new List<Issue>();
            var ui = UIRoot.Instance;
            if (!ui) return all;
            foreach (var l in layers)
            {
                var root = ui.Layer(l);
                if (root == null) continue;
                var top = root.panel?.visualTree;
                var screen = top != null ? top.worldBound : root.worldBound;
                foreach (var i in Inspect(root, screen))
                {
                    i.where = $"[{UILayers.Name(l)}] " + i.where;
                    all.Add(i);
                }
            }
            return all;
        }

        /// <summary>看得见：自己和祖先都没有 display: none / visibility: hidden，累计不透明度 &gt; 0.05，有尺寸</summary>
        static bool Visible(VisualElement e, out float opacity)
        {
            opacity = 1;
            if (e.worldBound.width < 0.5f || e.worldBound.height < 0.5f) return false;
            for (var p = e; p != null; p = p.hierarchy.parent)
            {
                var s = p.resolvedStyle;
                if (s.display == DisplayStyle.None || s.visibility == Visibility.Hidden) return false;
                opacity *= s.opacity;
            }
            return opacity > 0.05f;
        }

        static readonly System.Reflection.MethodInfo shouldClip =
            typeof(VisualElement).GetMethod("ShouldClip", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public, null, Type.EmptyTypes, null);

        /// <summary>裁剪子元素（overflow: hidden）：内部的 ShouldClip（反射），拿不到时看内联样式</summary>
        static bool Clips(VisualElement p)
        {
            if (shouldClip != null)
                try { return (bool)shouldClip.Invoke(p, null); }
                catch (Exception) { /* 退回内联样式 */ }
            return p.style.overflow.keyword == StyleKeyword.Undefined && p.style.overflow.value == Overflow.Hidden;
        }

        /// <summary>自己或祖先里第一个画得出边界的元素（底色不透明度 &gt; 0.05、有底图或描边），铺满整层的不算</summary>
        static VisualElement Frame(VisualElement e)
        {
            var layer = e.panel?.visualTree?.worldBound ?? Rect.zero;
            for (var p = e; p != null; p = p.hierarchy.parent)
            {
                var wb = p.worldBound;
                if (wb.width < 1 || (wb.width >= layer.width - 1 && wb.height >= layer.height - 1)) continue;
                var s = p.resolvedStyle;
                bool border = s.borderLeftWidth > 0.5f && s.borderLeftColor.a > 0.05f || s.borderRightWidth > 0.5f && s.borderRightColor.a > 0.05f;
                var bg = s.backgroundImage;
                bool image = bg.texture != null || bg.sprite != null || bg.vectorImage != null || bg.renderTexture != null;
                if (s.backgroundColor.a > 0.05f || image || border) return p;
            }
            return null;
        }

        static VisualElement Clip(VisualElement e)
        {
            for (var p = e.hierarchy.parent; p != null; p = p.hierarchy.parent)
                if (p.worldBound.width > 1 && Clips(p))
                    return p;
            return null;
        }

        static bool Related(VisualElement a, VisualElement b)
        {
            for (var p = a; p != null; p = p.hierarchy.parent) if (p == b) return true;
            for (var p = b; p != null; p = p.hierarchy.parent) if (p == a) return true;
            return false;
        }

        static Rect Intersect(Rect a, Rect b)
        {
            float x0 = Mathf.Max(a.xMin, b.xMin), y0 = Mathf.Max(a.yMin, b.yMin), x1 = Mathf.Min(a.xMax, b.xMax), y1 = Mathf.Min(a.yMax, b.yMax);
            return x1 > x0 && y1 > y0 ? Rect.MinMaxRect(x0, y0, x1, y1) : Rect.zero;
        }

        static string Short(string s)
        {
            s = s.Replace('\n', '⏎');
            return s.Length > 18 ? s.Substring(0, 17) + "…" : s;
        }

        static string Fmt(Rect r) => $"{r.xMin:F0},{r.yMin:F0}–{r.xMax:F0},{r.yMax:F0}";

        static string Name(VisualElement e)
        {
            var sb = new StringBuilder(e.GetType().Name);
            if (!string.IsNullOrEmpty(e.name)) sb.Append('#').Append(e.name);
            foreach (var c in e.GetClasses())
                if (!c.StartsWith("unity-", StringComparison.Ordinal))
                    sb.Append('.').Append(c);
            return sb.ToString();
        }

        /// <summary>元素路径：自己 + 最多三层带类名的祖先</summary>
        static string Where(VisualElement e)
        {
            var parts = new List<string> { Name(e) };
            int n = 0;
            for (var p = e.hierarchy.parent; p != null && n < 3; p = p.hierarchy.parent)
            {
                bool named = !string.IsNullOrEmpty(p.name) || p.GetClasses().Any(c => !c.StartsWith("unity-", StringComparison.Ordinal));
                if (!named) continue;
                parts.Add(Name(p));
                n++;
            }
            parts.Reverse();
            return string.Join(" > ", parts);
        }
    }

    /// <summary>
    /// 编辑器 Game 视图的渲染分辨率（冒烟测试切分辨率用；只在编辑器里有效）：
    /// <see cref="Set"/> 走公开的 PlayModeWindow.SetCustomRenderingResolution（固定分辨率，窗口比它小时缩着显示、照样按全分辨率渲染）；
    /// <see cref="Save"/> / <see cref="Restore"/> 用反射记下 / 还原 Game 视图原来选的尺寸项（自由比例之类），并删掉自己加的自定义尺寸。
    /// </summary>
    public static class GameViewResolution
    {
        public const string Prefix = "ui-res ";

        public static bool Supported =>
#if UNITY_EDITOR
            true;
#else
            false;
#endif

        /// <summary>切到 w×h（编辑器外什么都不做，返回 false）</summary>
        public static bool Set(int w, int h)
        {
#if UNITY_EDITOR
            try
            {
                UnityEditor.PlayModeWindow.SetCustomRenderingResolution((uint)w, (uint)h, $"{Prefix}{w}x{h}");
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[ui-res] 切分辨率 {w}×{h} 失败：{e.Message}");
                return false;
            }
#else
            return false;
#endif
        }

        /// <summary>等 Screen 变成 w×h（最多 seconds 秒，不缩放时间）</summary>
        public static IEnumerator WaitFor(int w, int h, float seconds = 3f)
        {
            float t0 = Time.realtimeSinceStartup;
            while ((Screen.width != w || Screen.height != h) && Time.realtimeSinceStartup - t0 < seconds) yield return null;
            // 面板按新尺寸重排、相机按新比例画：再多等几帧
            for (int i = 0; i < 4; i++) yield return null;
        }

        /// <summary>记下 Game 视图现在选的尺寸项（失败返回 null）</summary>
        public static object Save()
        {
#if UNITY_EDITOR
            try
            {
                var view = GameView(out var type);
                var prop = type?.GetProperty("selectedSizeIndex", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public);
                if (view != null && prop != null) return (int)prop.GetValue(view);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[ui-res] 记不下 Game 视图尺寸：{e.Message}");
            }
#endif
            return null;
        }

        /// <summary>还原 <see cref="Save"/> 记下的尺寸项（没记下时按 fallback 尺寸设固定分辨率），再删掉本套件加的自定义尺寸；返回一行说明</summary>
        public static string Restore(object saved, Vector2Int fallback)
        {
#if UNITY_EDITOR
            string how;
            try
            {
                var view = GameView(out var type);
                const System.Reflection.BindingFlags F = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public;
                if (saved is int index && view != null)
                {
                    var cb = type.GetMethod("SizeSelectionCallback", F);
                    if (cb != null) cb.Invoke(view, new object[] { index, null });
                    else type.GetProperty("selectedSizeIndex", F)?.SetValue(view, index);
                    how = $"还原 Game 视图尺寸项 #{index}";
                }
                else
                {
                    Set(fallback.x, fallback.y);
                    how = $"没记下原尺寸项，设回固定 {fallback.x}×{fallback.y}";
                }
            }
            catch (Exception e)
            {
                Set(fallback.x, fallback.y);
                how = $"还原尺寸项失败（{e.Message}），设回固定 {fallback.x}×{fallback.y}";
            }
            return how + "，" + RemoveCustomSizes();
#else
            return "（不在编辑器里）";
#endif
        }

#if UNITY_EDITOR
        static UnityEngine.Object GameView(out Type type)
        {
            type = typeof(UnityEditor.EditorWindow).Assembly.GetType("UnityEditor.GameView");
            if (type == null) return null;
            var all = Resources.FindObjectsOfTypeAll(type);
            return all.Length > 0 ? all[0] : null;
        }

        /// <summary>删掉名字以 <see cref="Prefix"/> 开头的自定义尺寸（GameViewSizes 内部 API，失败就留着）</summary>
        static string RemoveCustomSizes()
        {
            try
            {
                const System.Reflection.BindingFlags F = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public;
                var asm = typeof(UnityEditor.EditorWindow).Assembly;
                var sizesType = asm.GetType("UnityEditor.GameViewSizes");
                var single = sizesType?.BaseType;
                var instance = single?.GetProperty("instance", F)?.GetValue(null);
                var group = sizesType?.GetProperty("currentGroup", F)?.GetValue(instance);
                if (group == null) return "自定义尺寸没清（拿不到 GameViewSizes）";
                var gt = group.GetType();
                var count = gt.GetMethod("GetTotalCount", F);
                var get = gt.GetMethod("GetGameViewSize", F);
                var remove = gt.GetMethod("RemoveCustomSize", F);
                var builtin = gt.GetMethod("GetBuiltinCount", F);
                if (count == null || get == null || remove == null || builtin == null) return "自定义尺寸没清（GameViewSizeGroup 接口不对）";
                int removed = 0, nBuiltin = (int)builtin.Invoke(group, null);
                for (int i = (int)count.Invoke(group, null) - 1; i >= nBuiltin; i--)
                {
                    var size = get.Invoke(group, new object[] { i });
                    var text = size?.GetType().GetProperty("baseText", F)?.GetValue(size) as string;
                    if (text == null || !text.StartsWith(Prefix, StringComparison.Ordinal)) continue;
                    remove.Invoke(group, new object[] { i });
                    removed++;
                }
                sizesType.GetMethod("SaveToHDD", F)?.Invoke(instance, null);
                return $"删掉自定义尺寸 {removed} 个";
            }
            catch (Exception e)
            {
                return $"自定义尺寸没清（{e.GetType().Name}: {e.Message}）";
            }
        }
#endif
    }
}
