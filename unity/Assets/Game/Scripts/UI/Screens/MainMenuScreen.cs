using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 主菜单（U5；Three.js src/ui/MainMenu.ts + css/menu.css）：叠在主菜单场景的 3D 远景上（<see cref="MenuDirector"/>：沙漠城门、篝火、
    /// 远处的巨像，祭台上站着上次出征的英雄），不再用 Three.js 的 CSS 假远景。
    ///   左：导航（开始游戏 / 天赋 / 设置 / 操作说明 / 退出），悬停或手柄焦点时朱砂笔触从左扫开；
    ///   右：书法标题「灵火破晓」逐字落墨 + 「烈焰为弹 · 破此轮回」+ 朱印「不熄」盖下；左上魂晶余额，底部生涯统计（出征 / 通关 / 最远 / 最多清关 / 累计斩敌）。
    /// 其余页（选英雄、天赋、设置、操作说明）叠在上面，主菜单本体淡出；回来时淡入、刷新余额与统计、镜头回远景。
    /// 不挡游戏、不停时间（场景要动）；返回键在主菜单上什么都不做。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class MainMenuScreen : UIScreen
    {
        public const string ScreenId = "main-menu";
        public const string HeroSelectId = "hero-select";

        public override string Id => ScreenId;
        public override GameState? BlockState => null;
        public override bool FreezeTime => false;

        readonly List<Label> chars = new();
        readonly List<Button> navItems = new();
        VisualElement home, brand, seal, stats;
        Label sub, essence;
        Button startBtn;
        float openedAt;
        bool covered;

        public override VisualElement DefaultFocus => startBtn;

        /// <summary>被别的页盖住（选英雄、天赋…）</summary>
        public bool Covered => covered;

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "main-menu" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, ScreenKit.MenuStyle);
            root.AddToClassList("sf-menu");
            root.pickingMode = PickingMode.Ignore;

            home = ScreenKit.El("sf-menu__home", root);
            var shadeL = ScreenKit.El("sf-menu__shade sf-menu__shade--l", home);
            UITheme.Paint(shadeL, UITheme.FadeRight, new Color(0.02f, 0.016f, 0.024f, 0.92f));
            var shadeR = ScreenKit.El("sf-menu__shade sf-menu__shade--r", home);
            UITheme.Paint(shadeR, UITheme.FadeRight, new Color(0.02f, 0.016f, 0.024f, 0.8f));
            var shadeB = ScreenKit.El("sf-menu__shade sf-menu__shade--b", home);
            shadeB.style.backgroundColor = new Color(0.02f, 0.016f, 0.024f, 0.55f);

            var top = ScreenKit.El("sf-menu__top", home);
            var wallet = ScreenKit.El("sf-wallet sf-wallet--menu", top);
            ScreenKit.Icon(UIIcon.Essence, "sf-icon--essence", wallet);
            ScreenKit.Text("sf-wallet__label", wallet, "魂晶");
            essence = ScreenKit.Text("sf-wallet__num", wallet, "0", UIFontRole.Number);
            ScreenKit.Text("sf-menu__latin", top, "SPIRITFIRE · DAWN", UIFontRole.Number);

            var nav = ScreenKit.El("sf-menu__nav", home);
            startBtn = NavItem(nav, "开始游戏", "选择英雄，踏入第一章", StartGame, true);
            NavItem(nav, "天赋", "用魂晶强化之后的每一局", () => UIRouter.Open(TalentScreen.ScreenId));
            NavItem(nav, "设置", "画面、声音、按键与手柄", () => UIRouter.Open(SettingsScreen.ScreenId));
            NavItem(nav, "操作说明", "按键一览", () => UIRouter.Open(ControlsScreen.ScreenId));
            NavItem(nav, "退出游戏", "下次再会", Quit);

            brand = ScreenKit.El("sf-menu__brand", home);
            var title = ScreenKit.El("sf-menu__title", brand);
            foreach (var ch in "灵火破晓") chars.Add(ScreenKit.Text("sf-menu__char", title, ch.ToString(), UIFontRole.Title));
            seal = ScreenKit.El("sf-seal sf-menu__seal", title);
            ScreenKit.Text("sf-menu__sealchar", seal, "不\n熄", UIFontRole.Title);
            sub = ScreenKit.Text("sf-menu__sub", brand, "烈焰为弹 · 破此轮回");

            stats = ScreenKit.El("sf-menu__stats", home);
            return root;
        }

        Button NavItem(VisualElement parent, string label, string hint, System.Action onClick, bool primary = false)
        {
            var b = ScreenKit.Card(primary ? "sf-nav sf-nav--primary" : "sf-nav", parent, onClick);
            b.name = "nav-" + label;
            var brush = ScreenKit.El("sf-nav__brush", b);
            UITheme.Paint(brush, UITheme.FadeRight, new Color(0.79f, 0.22f, 0.16f, 0.95f));
            ScreenKit.El("sf-nav__mark", b);
            var col = ScreenKit.El("sf-nav__text", b);
            ScreenKit.Text("sf-nav__label", col, label, UIFontRole.Title);
            ScreenKit.Text("sf-nav__hint", col, hint);
            navItems.Add(b);
            return b;
        }

        /// <summary>「开始游戏」：选英雄页（没有选英雄页时直接用上次的英雄出征）</summary>
        public void StartGame()
        {
            if (UIRouter.Get(HeroSelectId) != null) UIRouter.Open(HeroSelectId);
            else MenuFlow.StartRun(MenuFlow.LastHero);
        }

        static void Quit()
        {
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#else
            Application.Quit();
#endif
        }

        public override void OnOpen(object arg)
        {
            openedAt = Time.unscaledTime;
            SetCovered(false);
            Refresh();
            UIRouter.Opened -= OnOpened;
            UIRouter.Opened += OnOpened;
            UIRouter.Closed -= OnClosed;
            UIRouter.Closed += OnClosed;
            GameEvents.MetaChanged -= OnMeta;
            GameEvents.MetaChanged += OnMeta;
            UIFonts.Warmup("灵火破晓不熄烈焰为弹破此轮回开始游戏天赋设置操作说明退出", UIFontRole.Title);
            Tick(0);
        }

        public override void OnClose()
        {
            UIRouter.Opened -= OnOpened;
            UIRouter.Closed -= OnClosed;
            GameEvents.MetaChanged -= OnMeta;
        }

        /// <summary>主菜单上返回键不关</summary>
        public override bool OnBack() => true;

        void OnMeta(MetaSave _) => Refresh();

        void OnOpened(IScreen s)
        {
            if (s != this && IsOpen) SetCovered(true);
        }

        void OnClosed(IScreen s)
        {
            if (s != this && UIRouter.Top == this) SetCovered(false);
        }

        void SetCovered(bool on)
        {
            covered = on;
            home.EnableInClassList("sf-menu__home--covered", on);
            home.pickingMode = PickingMode.Ignore;
            foreach (var b in navItems) b.pickingMode = on ? PickingMode.Ignore : PickingMode.Position;
            if (on) return;
            Refresh();
            // 镜头回远景、祭台上换回上次出征的英雄
            if (MenuDirector.Instance) MenuDirector.Instance.Home();
        }

        /// <summary>刷新魂晶余额与生涯统计</summary>
        public void Refresh()
        {
            essence.text = ScreenKit.Num(MetaSave.Current.Essence);
            stats.Clear();
            var c = CareerStats.Current;
            if (c == null || c.Runs <= 0)
            {
                ScreenKit.Text("sf-menu__stat sf-menu__stat--first", stats, RunPlan.IsDemo
                    ? $"尚无出征记录。试玩版共 {RunPlan.Playable.Count} 关，到 {RunPlan.Final.Label} 为止。"
                    : $"尚无出征记录。三章 {RunPlan.Stages.Count} 关，击败三位首领即可通关。");
                return;
            }
            var items = new (string k, string v)[]
            {
                ("出征", $"{ScreenKit.Num(c.Runs)} 次"),
                ("通关", $"{ScreenKit.Num(c.Wins)} 次"),
                ("最远", c.BestChapter > 0 ? $"第{ScreenKit.Cn(c.BestChapter)}章" : "—"),
                ("最多清关", $"{ScreenKit.Num(c.BestStages)} 关"),
                ("累计斩敌", ScreenKit.Num(c.TotalKills)),
            };
            for (int i = 0; i < items.Length; i++)
            {
                if (i > 0) ScreenKit.El("sf-menu__dot", stats);
                var el = ScreenKit.El("sf-menu__stat", stats);
                ScreenKit.Text("sf-menu__statk", el, items[i].k);
                ScreenKit.Text("sf-menu__statv", el, items[i].v, UIFontRole.Number);
            }
        }

        public override void Tick(float dt)
        {
            float t = Time.unscaledTime - openedAt;
            // 标题逐字落墨（放大、模糊感用缩放 + 淡入代替）
            for (int i = 0; i < chars.Count; i++)
            {
                float k = ScreenKit.EaseOut((t - 0.1f - i * 0.12f) / 1.1f);
                var ch = chars[i];
                ch.style.opacity = k;
                float s = Mathf.Lerp(1.35f, 1f, k);
                ch.style.scale = new Scale(new Vector3(s, s, 1));
                ch.style.translate = new Translate(0, -14 * (1 - k));
            }
            float sk = ScreenKit.EaseOut((t - 0.8f) / 0.9f);
            sub.style.opacity = sk;
            sub.style.translate = new Translate(0, 10 * (1 - sk));
            float st = Mathf.Clamp01((t - 1.05f) / 0.45f);
            seal.style.opacity = st > 0 ? 1 : 0;
            float ss = st > 0 ? Mathf.Lerp(1.9f, 1f, ScreenKit.EaseBack(st, 2.2f)) : 1.9f;
            seal.style.scale = new Scale(new Vector3(ss, ss, 1));
            for (int i = 0; i < navItems.Count; i++)
            {
                float k = ScreenKit.EaseOut((t - 0.12f - i * 0.08f) / 0.5f);
                navItems[i].style.opacity = k;
                navItems[i].style.translate = new Translate(-26 * (1 - k), 0);
            }
            stats.style.opacity = ScreenKit.EaseOut((t - 1.1f) / 0.8f);
        }
    }
}
