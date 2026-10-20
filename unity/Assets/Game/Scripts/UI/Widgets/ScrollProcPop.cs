using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷触发弹字（S7；Three.js HUD 的 scroll proc 提示）：秘卷效果触发一次（<see cref="GameEvents.ScrollProc"/>，<see cref="ScrollScope.Proc"/> 发）
    /// 就在准星右上方弹一行「◆ 卷名」，菱形和字按稀有度上色——叠起来的秘卷「看得见」（docs/unity-parity.md 1.2 手感优先）。
    ///   · 同一卷 0.6 s 内再触发：合并成 ×N 并重新弹一下（连发武器每发都触发的卷不刷屏）；
    ///   · 最多 4 行，满了先收走最老的；每行 0.12 s 弹出（1.3 → 1 倍）→ 停 0.7 s → 0.35 s 上飘淡出；
    ///   · 用不缩放时间：顿帧、慢动作时照常淡出。不认识的 id 不弹。
    /// </summary>
    [HudWidget("scroll-proc", Order = 45)]
    public sealed class ScrollProcPop : HudWidget
    {
        public const int MaxRows = 4;
        const float MergeWindow = 0.6f, PopTime = 0.12f, Hold = 0.7f, FadeTime = 0.35f, RowHeight = 26f;

        sealed class Row
        {
            public string id;
            public VisualElement el;
            public Label count;
            public int n;
            public float born, last;
        }

        readonly List<Row> rows = new();
        readonly Stack<Row> pool = new();
        VisualElement list;

        public override string StyleSheet => ScreenKit.ScrollStyle;

        /// <summary>显示中的行数（测试用）</summary>
        public int Count => rows.Count;

        /// <summary>显示中的卷 id（测试用）</summary>
        public IEnumerable<string> Ids
        {
            get
            {
                foreach (var r in rows) yield return r.id;
            }
        }

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-procs");
            list = HudArt.El("sf-procs__list", root);
            return root;
        }

        protected override void OnAttach() => GameEvents.ScrollProc += OnProc;

        protected override void OnDetach() => GameEvents.ScrollProc -= OnProc;

        public override void ResetState()
        {
            foreach (var r in rows) Recycle(r);
            rows.Clear();
        }

        void OnProc(string id) => Push(id);

        /// <summary>弹一行（测试 / 调试也可以直接调）</summary>
        public void Push(string id)
        {
            var def = ScrollLibrary.Get(id);
            if (def == null || list == null) return;
            float now = Time.unscaledTime;
            foreach (var r in rows)
            {
                if (r.id != id || now - r.last > MergeWindow) continue;
                r.n++;
                r.last = now;
                r.born = now;
                r.count.text = "×" + r.n;
                r.count.style.display = DisplayStyle.Flex;
                // 合并的那行挪到最新
                rows.Remove(r);
                rows.Add(r);
                r.el.BringToFront();
                return;
            }
            while (rows.Count >= MaxRows)
            {
                Recycle(rows[0]);
                rows.RemoveAt(0);
            }
            var row = pool.Count > 0 ? pool.Pop() : Make();
            var color = Rarity.Color(def.rarity);
            row.id = id;
            row.n = 1;
            row.born = row.last = now;
            row.el.Q("mark").style.backgroundColor = color;
            var name = row.el.Q<Label>("name");
            name.text = def.name;
            name.style.color = Color.Lerp(color, Color.white, 0.35f);
            row.count.style.display = DisplayStyle.None;
            row.count.style.color = color;
            row.el.style.display = DisplayStyle.Flex;
            list.Add(row.el);
            rows.Add(row);
        }

        Row Make()
        {
            var el = HudArt.El("sf-proc");
            HudArt.Paint(el, UITheme.FadeRight, new Color(0.02f, 0.016f, 0.02f, 0.55f));
            HudArt.El("sf-proc__mark", el, "mark");
            var name = HudArt.Text("sf-proc__name", el, "", UIFontRole.Title);
            name.name = "name";
            var count = HudArt.Text("sf-proc__count", el, "", UIFontRole.Number);
            return new Row { el = el, count = count };
        }

        void Recycle(Row r)
        {
            r.el.RemoveFromHierarchy();
            pool.Push(r);
        }

        public override void Tick(in HudFrame f)
        {
            if (rows.Count == 0) return;
            float now = f.unscaledTime;
            for (int i = rows.Count - 1; i >= 0; i--)
            {
                var r = rows[i];
                float t = now - r.born;
                if (t >= PopTime + Hold + FadeTime)
                {
                    Recycle(r);
                    rows.RemoveAt(i);
                    continue;
                }
                float pop = Mathf.Clamp01(t / PopTime);
                float s = Mathf.Lerp(1.3f, 1f, ScreenKit.EaseOut(pop));
                float fade = Mathf.Clamp01((t - PopTime - Hold) / FadeTime);
                r.el.style.scale = new Scale(new Vector3(s, s, 1));
                r.el.style.opacity = (1 - fade) * Mathf.Clamp01(pop * 2.5f);
                r.el.style.translate = new Translate(0, -RowHeight * 0.6f * fade);
            }
        }
    }
}
