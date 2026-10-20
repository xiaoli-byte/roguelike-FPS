using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 整局结算（U5；Three.js src/ui/SummaryScreen.ts + css/overlays.css .gf-summary）：
    ///   大字「胜利 / 败北」（逐字落墨）+ 题记、英雄徽记与止步关卡、六格数值（用时 / 清关 / 击杀 / 总伤害 / 灵石 / 获得魂晶，错开滚动计数）、
    ///   魂晶来源（局内收集 + 通关奖励）、秘卷 chips（稀有度色、×层数）、武器 chips；按钮「再来一局 · 英雄名」/「主菜单」。
    /// 参数是 <see cref="RunSummary"/>（<see cref="RunEnd"/> / <see cref="MenuFlow.Abandon"/> 传进来）。
    /// 挡游戏：Summary + 停时间；返回键不关（二选一）。
    /// </summary>
    [UIScreen(MenuFlow.SummaryScreenId)]
    public sealed class SummaryScreen : UIScreen
    {
        const float CountTime = 0.9f, CountDelay = 0.35f, CountStagger = 0.09f;

        public override string Id => MenuFlow.SummaryScreenId;
        public override GameState? BlockState => GameState.Summary;

        sealed class Counter
        {
            public Label label;
            public VisualElement cell;
            public float value;
            public System.Func<float, string> format;
            public int index;
        }

        readonly List<Counter> counters = new();
        readonly List<Label> titleChars = new();
        VisualElement root, glow, panel, stats, scrollChips, weaponChips, crest, heroRow;
        Label epitaph, heroName, reach, essenceNote;
        Button retryBtn, menuBtn;
        RunSummary summary;
        float openedAt;

        public override VisualElement DefaultFocus => retryBtn;

        /// <summary>当前显示的结算（测试用）</summary>
        public RunSummary Summary => summary;

        /// <summary>计数滚动都到终值了（测试用）</summary>
        public bool Settled => Time.unscaledTime - openedAt >= CountDelay + CountStagger * counters.Count + CountTime;

        protected override VisualElement Build()
        {
            root = new VisualElement { name = "summary" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, ScreenKit.MenuStyle);
            root.AddToClassList("sf-summary");
            ScreenKit.El("sf-summary__bg", root);
            glow = ScreenKit.El("sf-summary__glow", root);
            UITheme.Paint(glow, UITheme.RadialSoft, UITheme.Gold);

            panel = ScreenKit.El("sf-summary__panel", root);
            var title = ScreenKit.El("sf-summary__title", panel);
            for (int i = 0; i < 2; i++)
            {
                var ch = ScreenKit.Text("sf-summary__char", title, "", UIFontRole.Title);
                titleChars.Add(ch);
            }
            epitaph = ScreenKit.Text("sf-summary__epitaph", panel, "");

            heroRow = ScreenKit.El("sf-summary__hero", panel);
            crest = ScreenKit.Crest(null, heroRow);
            var hi = ScreenKit.El("sf-summary__heroinfo", heroRow);
            heroName = ScreenKit.Text("sf-summary__heroname", hi, "", UIFontRole.Title);
            reach = ScreenKit.Text("sf-summary__reach", hi, "");

            stats = ScreenKit.El("sf-summary__stats", panel);
            essenceNote = ScreenKit.Text("sf-summary__essence", panel, "");

            var lists = ScreenKit.El("sf-summary__lists", panel);
            var sc = ScreenKit.El("sf-summary__list", lists);
            ScreenKit.Text("sf-summary__listtitle", sc, "秘卷", UIFontRole.Title);
            scrollChips = ScreenKit.El("sf-chips", sc);
            var wc = ScreenKit.El("sf-summary__list", lists);
            ScreenKit.Text("sf-summary__listtitle", wc, "武器", UIFontRole.Title);
            weaponChips = ScreenKit.El("sf-chips", wc);

            var foot = ScreenKit.El("sf-summary__foot", panel);
            retryBtn = ScreenKit.Btn("再来一局", "sf-btn--primary sf-btn--wide sf-sound-confirm", foot, Retry);
            retryBtn.name = "summary-retry";
            menuBtn = ScreenKit.Btn("主菜单", "sf-btn--ghost sf-btn--wide", foot, ToMenu);
            menuBtn.name = "summary-menu";
            return root;
        }

        /// <summary>「再来一局」：同英雄新开一局</summary>
        public void Retry() => MenuFlow.Retry();

        /// <summary>「主菜单」（这一局已经结算过，不再结）</summary>
        public void ToMenu() => MenuFlow.ToMenu(false);

        /// <summary>返回键不关</summary>
        public override bool OnBack() => true;

        public override void OnOpen(object arg)
        {
            summary = arg as RunSummary ?? RunEnd.Last ?? new RunSummary();
            openedAt = Time.unscaledTime;
            var s = summary;
            var hero = HeroLibrary.Get(s.heroId);
            root.EnableInClassList("sf-summary--victory", s.victory);
            root.EnableInClassList("sf-summary--defeat", !s.victory);
            glow.style.unityBackgroundImageTintColor = s.victory ? ScreenKit.A(UITheme.Gold, 0.32f) : ScreenKit.A(UITheme.Cinnabar, 0.36f);
            string word = s.victory ? "胜利" : "败北";
            for (int i = 0; i < titleChars.Count; i++) titleChars[i].text = i < word.Length ? word[i].ToString() : "";
            epitaph.text = s.victory ? "三章尽破，烈焰长明" : "魂火未熄，再入轮回";

            ScreenKit.SetCrest(crest, hero);
            heroName.text = hero != null ? $"{hero.name} · {hero.title}" : "无名侠客";
            reach.text = Reach(s);
            retryBtn.text = hero != null ? $"再来一局 · {hero.name}" : "再来一局";

            stats.Clear();
            counters.Clear();
            Add(UIIcon.Hourglass, null, "用时", s.time, ScreenKit.Clock);
            Add(UIIcon.Gate, null, "清关", s.stagesCleared, v => $"{Mathf.RoundToInt(v)} 关");
            Add(UIIcon.Skull, null, "击杀", s.kills, ScreenKit.Num);
            Add(UIIcon.Spark, null, "总伤害", s.damageDealt, ScreenKit.Num);
            Add(UIIcon.Coin, "sf-icon--coin", "灵石", s.coins, ScreenKit.Num);
            var ess = Add(UIIcon.Essence, "sf-icon--essence", "获得魂晶", s.essenceEarned, v => "+" + ScreenKit.Num(v));
            ess.cell.AddToClassList("sf-summary__stat--essence");
            essenceNote.text = s.victoryBonus > 0
                ? $"局内收集 {ScreenKit.Num(s.essenceCollected)} + 通关奖励 {ScreenKit.Num(s.victoryBonus)}，已存入魂晶{(s.dev ? "（调试档）" : "")}"
                : $"局内收集的魂晶已存入{(s.dev ? "（调试档）" : "")}，回主菜单可在「天赋」里花掉";

            scrollChips.Clear();
            var list = new List<(ScrollDef def, int stacks)>();
            if (s.scrolls != null)
                foreach (var e in s.scrolls)
                    if (ScrollLibrary.Get(e.id) is { } d)
                        list.Add((d, e.stacks));
            list.Sort((a, b) => b.def.rarity.CompareTo(a.def.rarity));
            if (list.Count == 0) ScreenKit.Text("sf-empty", scrollChips, "本局未获得秘卷");
            foreach (var (d, n) in list)
            {
                var chip = ScreenKit.El("sf-chip " + UITheme.RarityClass(d.rarity), scrollChips);
                ScreenKit.Text("sf-chip__name", chip, d.name);
                if (n > 1) ScreenKit.Text("sf-chip__count", chip, "×" + n, UIFontRole.Number);
            }
            weaponChips.Clear();
            if (s.weapons == null || s.weapons.Count == 0) ScreenKit.Text("sf-empty", weaponChips, "—");
            else
                foreach (var id in s.weapons)
                {
                    var def = WeaponLibrary.Get(id);
                    var chip = ScreenKit.El("sf-chip sf-chip--weapon", weaponChips);
                    ScreenKit.Text("sf-chip__name", chip, def != null ? def.name : id);
                }
            Tick(0);
            UISound.Play(UISound.ConfirmId);
        }

        Counter Add(UIIcon icon, string iconClass, string label, float value, System.Func<float, string> format)
        {
            var cell = ScreenKit.El("sf-summary__stat", stats);
            ScreenKit.Icon(icon, iconClass, cell);
            ScreenKit.Text("sf-summary__slabel", cell, label);
            var v = ScreenKit.Text("sf-summary__sval", cell, format(0), UIFontRole.Number);
            var c = new Counter { label = v, cell = cell, value = value, format = format, index = counters.Count };
            counters.Add(c);
            return c;
        }

        /// <summary>止步处：「止步于 第一章 · 第 2 关」/ 首领关 / 胜利「已击败全部首领」</summary>
        public static string Reach(RunSummary s)
        {
            if (s.victory) return "已击败全部首领";
            var spec = RunPlan.Get(s.stageCode);
            string stageNo = spec != null && spec.IsBoss ? "首领关" : $"第 {s.stage + 1} 关";
            string where = $"第{ScreenKit.Cn(Mathf.Max(1, s.chapter))}章 · {stageNo}";
            return $"止步于 {where}{(spec != null ? $"（{spec.title}）" : "")}";
        }

        public override void Tick(float dt)
        {
            float t = Time.unscaledTime - openedAt;
            // 大字逐字落墨：放大 1.25 → 1、淡入、下落
            for (int i = 0; i < titleChars.Count; i++)
            {
                float k = ScreenKit.EaseOut((t - 0.05f - i * 0.16f) / 0.8f);
                var ch = titleChars[i];
                ch.style.opacity = k;
                float s = Mathf.Lerp(1.25f, 1f, k);
                ch.style.scale = new Scale(new Vector3(s, s, 1));
                ch.style.translate = new Translate(0, -18 * (1 - k));
            }
            epitaph.style.opacity = ScreenKit.EaseOut((t - 0.45f) / 0.8f);
            float hk = ScreenKit.EaseOut((t - 0.25f) / 0.6f);
            heroRow.style.opacity = hk;
            panel.style.opacity = Mathf.Clamp01(t / 0.25f);
            foreach (var c in counters)
            {
                float start = CountDelay + c.index * CountStagger;
                float k = ScreenKit.EaseOut((t - start) / CountTime);
                float o = ScreenKit.EaseOut((t - start + 0.25f) / 0.5f);
                c.cell.style.opacity = o;
                c.cell.style.translate = new Translate(0, 10 * (1 - o));
                c.label.text = c.format(c.value * k);
            }
        }
    }
}
