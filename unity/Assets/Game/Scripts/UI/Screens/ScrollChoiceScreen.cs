using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>打开秘卷三选一的参数（<see cref="ScrollChoice.Show"/> 转发过来）</summary>
    public sealed class ScrollChoiceArgs
    {
        public List<ScrollDef> choices;
        /// <summary>本局持有（卡面的已有层数、新得 / 升层）；null = 当作都没有</summary>
        public ScrollInventory inventory;
        public Action<ScrollDef> onPick;
    }

    /// <summary>
    /// 秘卷三选一（S7；Three.js src/ui/ScrollChoice.ts + css/overlays.css 的「挂轴」）：
    ///   三张挂轴依次落下、展开（0.12 s 错开）；装裱绫绢的颜色 = 稀有度，上面铺点阵纹；宣纸上：竖排稀有度印、「新得 / 升层」戳、名字、
    ///   按下一层的数值写的说明、传说卷的红色代价行、属性预览（当前 → 下一层）、层数菱形（已有实心、下一层呼吸）、标签（英雄专属朱字）。
    ///   传说卷鎏金边框 + 外发光 + 流光，史诗卷淡紫外发光。
    /// 选择：点击 / 1 2 3 / 手柄（左右移焦点、A 确认）。刚弹出 0.25 s 内忽略（正在连点开火时误选），<see cref="ScrollChoice.Pick"/> 不受限。
    /// 选中后：回调同步执行（层数立即生效）、界面立即关闭（时间恢复），卡面留在叠层上做 0.36 s 的选中 / 落选动画再收走。
    /// 挡游戏：Modal + 停时间；返回键不关（必须选一张）。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class ScrollChoiceScreen : UIScreen
    {
        public const string ScreenId = "scroll-choice";
        const float Guard = 0.25f, Stagger = 0.12f, DropTime = 0.5f, UnrollDelay = 0.18f, UnrollTime = 0.75f, UnrollMax = 620f, LeaveTime = 0.36f;

        /// <summary>选择回调执行中（秘卷获得事件的订阅方用它区分「三选一选的」和别的来源）</summary>
        public static bool InPick { get; private set; }

        public override string Id => ScreenId;

        sealed class Card
        {
            public ScrollDef def;
            public Button button;
            public VisualElement body, roll, shimmer, glow;
            public readonly List<VisualElement> nextPips = new();
        }

        readonly List<Card> cards = new();
        VisualElement backdrop, inner, cardsRow, head;
        Label sub;
        ScrollChoiceArgs args;
        float openedAt, leaveAt = -1;
        bool picked;
        int generation;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => InPick = false;

        /// <summary>当前的选项（测试用）</summary>
        public IReadOnlyList<ScrollDef> Choices => args?.choices;

        public override VisualElement DefaultFocus => cards.Count > 0 ? cards[0].button : null;

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "scroll-choice" };
            ScreenKit.Style(root, ScreenKit.ScrollStyle);
            root.AddToClassList("sf-choice");
            backdrop = ScreenKit.El("sf-choice__backdrop", root);
            var vignette = ScreenKit.El("sf-choice__vignette", backdrop);
            UITheme.Paint(vignette, HudArt.Vignette, new Color(0.01f, 0.008f, 0.012f, 0.9f));
            inner = ScreenKit.El("sf-choice__inner", root);
            head = ScreenKit.El("sf-choice__head", inner);
            ScreenKit.Text("sf-choice__title", head, "择一秘卷", UIFontRole.Title);
            sub = ScreenKit.Text("sf-choice__sub", head, "");
            cardsRow = ScreenKit.El("sf-choice__cards", inner);
            return root;
        }

        public override void OnOpen(object arg)
        {
            generation++;
            args = arg as ScrollChoiceArgs ?? new ScrollChoiceArgs { choices = new List<ScrollDef>() };
            args.choices ??= new List<ScrollDef>();
            if (args.choices.Count > 3) args.choices = args.choices.GetRange(0, 3);
            picked = false;
            leaveAt = -1;
            openedAt = Time.unscaledTime;
            Root.pickingMode = PickingMode.Position;
            Root.RemoveFromClassList("sf-choice--leaving");
            Root.style.opacity = 1;
            int n = args.choices.Count;
            var keys = new List<string>();
            for (int i = 0; i < n; i++) keys.Add((i + 1).ToString());
            sub.text = $"点击卡片，或按 {string.Join(" / ", keys)} 选择　·　手柄 ◀ ▶ 选择、A 确认";
            cardsRow.Clear();
            cards.Clear();
            for (int i = 0; i < n; i++) cards.Add(BuildCard(args.choices[i], i));
            GameUI.ClearMessages();
            UIFonts.Warmup("择一秘卷新得升层层数唯一专属代价当前下一层", UIFontRole.Body);
            Tick(0);
        }

        public override void OnClose()
        {
            // 选中后界面已关（时间恢复），卡面挪到叠层上把选中 / 落选动画做完再收走；不是选中关掉的（换场景）直接收
            if (!picked || UIRoot.Instance == null)
            {
                Root?.RemoveFromHierarchy();
                return;
            }
            Root.pickingMode = PickingMode.Ignore;
            UIRoot.Instance.Layer(UILayer.Overlay).Add(Root);
            Root.style.display = DisplayStyle.Flex;
            Root.AddToClassList("sf-choice--leaving");
            leaveAt = Time.unscaledTime;
            int gen = generation;
            foreach (var c in cards) c.button.pickingMode = PickingMode.Ignore;
            Root.schedule.Execute(() => LeaveStep(gen)).Every(16)
                .Until(() => gen != generation || Root.parent == null || !UIRoot.Instance || Root.parent == UIRoot.Instance.Layer(UILayer.Modal));
        }

        void LeaveStep(int gen)
        {
            if (gen != generation || Root.parent == null) return;
            float k = (Time.unscaledTime - leaveAt) / LeaveTime;
            Root.style.opacity = 1 - ScreenKit.EaseOut(k);
            backdrop.style.opacity = 1 - Mathf.Clamp01(k * 2);
            if (k >= 1)
            {
                Root.RemoveFromHierarchy();
                Root.style.opacity = 1;
                backdrop.style.opacity = 1;
            }
        }

        /// <summary>返回键不关：必须选一张</summary>
        public override bool OnBack() => true;

        public override void Tick(float dt)
        {
            float now = Time.unscaledTime;
            float t = now - openedAt;
            backdrop.style.opacity = Mathf.Clamp01(t / 0.3f);
            head.style.opacity = ScreenKit.EaseOut(t / 0.4f);
            head.style.translate = new Translate(0, -12 * (1 - ScreenKit.EaseOut(t / 0.4f)));
            for (int i = 0; i < cards.Count; i++)
            {
                var c = cards[i];
                float local = t - i * Stagger;
                float drop = ScreenKit.EaseOut(local / DropTime);
                c.body.style.opacity = drop;
                c.body.style.translate = new Translate(0, -40 * (1 - drop));
                float unroll = ScreenKit.EaseOut((local - UnrollDelay) / UnrollTime);
                c.roll.style.maxHeight = unroll >= 1 ? new StyleLength(StyleKeyword.None) : new StyleLength(UnrollMax * unroll);
                // 下一层的菱形呼吸、传说流光
                float pulse = 0.55f + 0.45f * Mathf.Sin(now * 7f);
                foreach (var p in c.nextPips) p.style.opacity = pulse;
                if (c.shimmer != null)
                {
                    float s = Mathf.Repeat(now / 3.2f, 1f);
                    c.shimmer.style.left = Length.Percent(Mathf.Lerp(-60, 140, s));
                }
                if (c.glow != null) c.glow.style.opacity = 0.75f + 0.25f * Mathf.Sin(now * 2.2f);
            }
            if (picked || t < Guard) return;
            if (GameInput.Pressed(UIAction.Choice1)) Choose(0, false);
            else if (GameInput.Pressed(UIAction.Choice2)) Choose(1, false);
            else if (GameInput.Pressed(UIAction.Choice3)) Choose(2, false);
        }

        /// <summary>选第 index 张（force = 测试 / 转发，不受误触保护限制）。返回是否选成</summary>
        public bool Choose(int index, bool force)
        {
            if (picked || args == null || index < 0 || index >= cards.Count) return false;
            if (!force && Time.unscaledTime - openedAt < Guard) return false;
            picked = true;
            for (int i = 0; i < cards.Count; i++)
                cards[i].button.AddToClassList(i == index ? "sf-scroll--chosen" : "sf-scroll--rejected");
            var def = args.choices[index];
            var cb = args.onPick;
            args.onPick = null;
            UISound.Play(UISound.ConfirmId);
            GameAudio.Play("scroll_get");
            InPick = true;
            try { cb?.Invoke(def); }
            catch (Exception e) { Debug.LogException(e); }
            finally { InPick = false; }
            Close();
            return true;
        }

        // ───────────── 卡面 ─────────────

        Card BuildCard(ScrollDef def, int i)
        {
            int cur = args.inventory != null ? Mathf.Max(0, args.inventory.Stacks(def.id)) : 0;
            int max = Mathf.Max(1, def.maxStacks);
            int next = Mathf.Min(max, cur + 1);
            var rc = Rarity.Color(def.rarity);
            var c = new Card { def = def };
            int index = i;
            var btn = ScreenKit.Card($"sf-scroll sf-scroll--r{Rarity.Clamp(def.rarity)}", cardsRow, () => Choose(index, false));
            btn.name = "scroll-card-" + (i + 1);
            c.button = btn;
            var body = ScreenKit.El("sf-scroll__body", btn);
            c.body = body;
            body.style.opacity = 0;

            if (def.rarity >= Rarity.Epic)
            {
                c.glow = ScreenKit.El("sf-scroll__glow", body);
                UITheme.Paint(c.glow, HudArt.Glow, ScreenKit.A(rc, def.rarity >= Rarity.Legendary ? 0.55f : 0.32f));
            }
            // 挂绳
            var cord = ScreenKit.El("sf-scroll__cord", body);
            ScreenKit.El("sf-scroll__cordl", cord);
            ScreenKit.El("sf-scroll__cordr", cord);
            Rod(body);

            var roll = ScreenKit.El("sf-scroll__roll", body);
            roll.style.maxHeight = 0;
            c.roll = roll;
            var silk = ScreenKit.El("sf-scroll__silk", roll);
            silk.style.backgroundColor = Color.Lerp(new Color(0.1f, 0.078f, 0.063f), rc, 0.58f);
            var dots = ScreenKit.El("sf-scroll__dots", silk);
            ScreenKit.PaintDots(dots, new Color(1, 1, 1, def.rarity >= Rarity.Legendary ? 0.16f : 0.1f), 10);
            if (def.rarity >= Rarity.Legendary)
            {
                ScreenKit.Border(silk, UITheme.GoldHi);
                var clip = ScreenKit.El("sf-scroll__shimmerclip", silk);
                c.shimmer = ScreenKit.El("sf-scroll__shimmer", clip);
                UITheme.Paint(c.shimmer, UITheme.FadeBoth, new Color(1f, 0.96f, 0.82f, 0.42f));
            }

            var paper = ScreenKit.El("sf-scroll__paper", silk);
            ScreenKit.El("sf-scroll__frame", paper);
            var seal = ScreenKit.Text("sf-scroll__rarity", paper, Vertical(Rarity.Name(def.rarity)), UIFontRole.Title);
            seal.style.backgroundColor = Color.Lerp(rc, new Color(0.23f, 0.05f, 0.03f), 0.28f);
            ScreenKit.Text("sf-scroll__state", paper, cur > 0 ? "升层" : "新得");
            ScreenKit.Text("sf-scroll__name", paper, def.name, UIFontRole.Title);
            var rule = ScreenKit.El("sf-scroll__rule", paper);
            UITheme.Paint(rule, UITheme.FadeBoth, Color.Lerp(rc, new Color(0.23f, 0.13f, 0.06f), 0.4f));

            SplitDownside(def, next, out var upside, out var downside);
            ScreenKit.Text("sf-scroll__desc", paper, upside, rich: true);
            if (!string.IsNullOrEmpty(downside))
            {
                var down = ScreenKit.El("sf-scroll__downside", paper);
                ScreenKit.Text("sf-scroll__downlabel", down, "代价");
                ScreenKit.Text("sf-scroll__downtext", down, downside);
            }
            Preview(def, cur, next, paper);

            var stacks = ScreenKit.El("sf-scroll__stacks", paper);
            if (max > 1)
            {
                var pips = ScreenKit.El("sf-scroll__pips", stacks);
                for (int k = 0; k < max; k++)
                {
                    var pip = ScreenKit.El("sf-scroll__pip", pips);
                    if (k < cur) pip.AddToClassList("sf-scroll__pip--owned");
                    else if (k < next)
                    {
                        pip.AddToClassList("sf-scroll__pip--next");
                        pip.style.backgroundColor = Color.Lerp(rc, new Color(0.23f, 0.13f, 0.06f), 0.4f);
                        c.nextPips.Add(pip);
                    }
                }
                ScreenKit.Text("sf-scroll__count", stacks, cur >= max ? $"层数 {cur} / {max}（已满）" : $"层数 {cur} → {next} / {max}", UIFontRole.Number);
            }
            else ScreenKit.Text("sf-scroll__count", stacks, cur > 0 ? "唯一 · 已持有" : "唯一");

            var tags = ScreenKit.El("sf-scroll__tags", paper);
            if (!string.IsNullOrEmpty(def.heroOnly))
            {
                var hero = HeroLibrary.Get(def.heroOnly);
                ScreenKit.Text("sf-scroll__tag sf-scroll__tag--hero", tags, $"{(hero != null ? hero.name : def.heroOnly)}专属");
            }
            if (def.tags != null)
                foreach (var t in def.tags)
                    if (!string.IsNullOrEmpty(t))
                        ScreenKit.Text(t == LegendScroll.RiskTag ? "sf-scroll__tag sf-scroll__tag--risk" : "sf-scroll__tag", tags, t);
            if (tags.childCount == 0) tags.RemoveFromHierarchy();

            Rod(body);
            var key = ScreenKit.Text("sf-scroll__key", body, (i + 1).ToString(), UIFontRole.Number);
            key.AddToClassList(UITheme.Key);
            if (def.rarity >= Rarity.Legendary) btn.AddToClassList("sf-scroll--legend");
            return c;
        }

        static void Rod(VisualElement parent)
        {
            var rod = ScreenKit.El("sf-scroll__rod", parent);
            ScreenKit.El("sf-scroll__knob sf-scroll__knob--l", rod);
            ScreenKit.El("sf-scroll__knob sf-scroll__knob--r", rod);
        }

        /// <summary>竖排：每个字一行（稀有度印）</summary>
        static string Vertical(string s) => string.Join("\n", s.ToCharArray());

        static readonly Regex DownsideTag = new("<color=#" + LegendScroll.DownsideHex + ">(.*?)</color>", RegexOptions.Singleline | RegexOptions.IgnoreCase);

        /// <summary>说明拆成收益和代价：传说卷用 upside / downside 字段；别的卷从描述里摘出红色代价行（去掉「代价：」前缀，卡面另起一行朱字）</summary>
        public static void SplitDownside(ScrollDef def, int stacks, out string upside, out string downside)
        {
            downside = null;
            if (def is LegendScroll { HighRisk: true } ls)
            {
                upside = Fill(def, ls.upside, stacks);
                downside = Fill(def, ls.downside, stacks);
                return;
            }
            upside = def.Describe(stacks);
            var m = DownsideTag.Match(upside);
            if (!m.Success) return;
            downside = m.Groups[1].Value;
            if (downside.StartsWith(LegendScroll.DownsidePrefix, StringComparison.Ordinal)) downside = downside.Substring(LegendScroll.DownsidePrefix.Length);
            upside = DownsideTag.Replace(upside, "").Trim();
        }

        /// <summary>按层数解析一段模板（和 <see cref="ScrollDef.Describe"/> 同一套占位）</summary>
        static string Fill(ScrollDef def, string template, int stacks)
        {
            if (string.IsNullOrEmpty(template)) return "";
            var saved = def.description;
            try
            {
                def.description = template;
                return def.Describe(stacks);
            }
            finally
            {
                def.description = saved;
            }
        }

        /// <summary>属性预览：这一卷在当前层数 → 下一层登记的属性（最多 3 行；纯行为的卷没有就不显示）</summary>
        static void Preview(ScrollDef def, int cur, int next, VisualElement paper)
        {
            if (next <= cur) return;
            IReadOnlyList<(Stat stat, float value)> a, b;
            try
            {
                a = cur > 0 ? def.PreviewStats(cur) : Array.Empty<(Stat, float)>();
                b = def.PreviewStats(next);
            }
            catch (Exception)
            {
                return;
            }
            if (b == null || b.Count == 0) return;
            var box = ScreenKit.El("sf-scroll__preview", paper);
            int shown = 0;
            foreach (var (stat, value) in b)
            {
                if (shown >= 3) break;
                float before = 0;
                if (a != null)
                    foreach (var (s, v) in a)
                        if (s == stat) before += v;
                if (Mathf.Approximately(before, value)) continue;
                var row = ScreenKit.El("sf-scroll__prow", box);
                ScreenKit.Text("sf-scroll__pname", row, StatInfo.Of(stat).name);
                var vals = ScreenKit.El("sf-scroll__pvals", row);
                if (cur > 0)
                {
                    ScreenKit.Text("sf-scroll__pold", vals, StatInfo.Format(stat, before), UIFontRole.Number);
                    ScreenKit.Text("sf-scroll__parrow", vals, "→");
                }
                var nv = ScreenKit.Text("sf-scroll__pnew", vals, StatInfo.Format(stat, value), UIFontRole.Number);
                nv.EnableInClassList("sf-scroll__pnew--bad", !StatInfo.IsGood(stat, value - before));
                shown++;
            }
            if (shown == 0) box.RemoveFromHierarchy();
        }
    }
}
