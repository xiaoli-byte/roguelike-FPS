using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 暂停菜单（U4；Three.js src/ui/PauseMenu.ts + css/overlays.css .gf-pause）：
    ///   左列：继续 / 设置 / 放弃本局 / 返回主菜单——后两个要二次确认（第一次按变成「再按一次确认」，2.6 s 内再按才生效）；
    ///   右列：本局概况（英雄徽记、关卡、用时 / 击杀 / 灵石 / 魂晶）、已获得秘卷（小签）、精简属性网格。
    /// 关闭 = 继续游戏：Esc / 手柄 B（路由的返回）、Esc / P / 手柄 Start（暂停键）、「继续」按钮，都回调 GameSession 给的 onResume。
    /// 「设置」把 <see cref="SettingsScreen"/> 叠在上面，返回回到这里。挡游戏：Paused + 停时间。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class PauseScreen : UIScreen
    {
        public const string ScreenId = "pause";
        const float ArmSeconds = 2.6f;

        public override string Id => ScreenId;
        public override GameState? BlockState => GameState.Paused;

        Action onResume;
        Button resumeBtn, abandonBtn, menuBtn;
        VisualElement frame, crest, scrolls, stats;
        Label stageLabel, heroName, timeVal, killsVal, coinsVal, essenceVal, scrollCount;
        string armed;
        float armedAt, openedAt;
        int openedFrame;

        public override VisualElement DefaultFocus => resumeBtn;

        /// <summary>待确认的按钮（abandon / menu；没有为 null，测试用）</summary>
        public string Armed => armed;

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "pause" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            root.AddToClassList("sf-pause");
            var backdrop = ScreenKit.El("sf-backdrop sf-pause__backdrop", root);
            UITheme.Paint(ScreenKit.El("sf-fill-abs", backdrop), HudArt.Vignette, new Color(0.02f, 0.016f, 0.03f, 0.85f));

            frame = ScreenKit.El("sf-frame sf-pause__main", root);
            var head = ScreenKit.El("sf-pause__head", frame);
            var title = ScreenKit.El("sf-pause__titlerow", head);
            ScreenKit.Text("sf-pause__title", title, "暂停", UIFontRole.Title);
            ScreenKit.Text("sf-seal sf-pause__seal", title, "止", UIFontRole.Title);
            stageLabel = ScreenKit.Text("sf-pause__stage", head, "", UIFontRole.Title);

            var cols = ScreenKit.El("sf-pause__cols", frame);
            var nav = ScreenKit.El("sf-pause__nav", cols);
            resumeBtn = ScreenKit.Btn("继续", "sf-btn--primary sf-btn--block sf-sound-confirm", nav, Resume);
            ScreenKit.Btn("设置", "sf-btn--block", nav, () =>
            {
                Disarm();
                UIRouter.Open(SettingsScreen.ScreenId);
            });
            abandonBtn = ScreenKit.Btn("放弃本局", "sf-btn--block sf-btn--danger", nav, () => Press("abandon"));
            menuBtn = ScreenKit.Btn("返回主菜单", "sf-btn--block sf-btn--ghost", nav, () => Press("menu"));
            ScreenKit.Text("sf-pause__hint", nav, "放弃本局：结算已获得的魂晶并显示结算。\n返回主菜单：同样结算，直接回到主菜单。");

            var info = ScreenKit.El("sf-pause__info", cols);
            var hero = ScreenKit.El("sf-pause__hero", info);
            crest = ScreenKit.Crest(null, hero);
            var hn = ScreenKit.El("sf-pause__heroinfo", hero);
            heroName = ScreenKit.Text("sf-pause__heroname", hn, "", UIFontRole.Title);
            var facts = ScreenKit.El("sf-facts", hn);
            timeVal = Fact(facts, UIIcon.Hourglass, "用时", null);
            killsVal = Fact(facts, UIIcon.Skull, "击杀", null);
            coinsVal = Fact(facts, UIIcon.Coin, "灵石", "sf-icon--coin");
            essenceVal = Fact(facts, UIIcon.Essence, "魂晶", "sf-icon--essence");

            var sh = ScreenKit.El("sf-section", info);
            ScreenKit.Text("sf-section__title", sh, "秘卷", UIFontRole.Title);
            scrollCount = ScreenKit.Text("sf-section__count", sh, "", UIFontRole.Number);
            var sv = ScreenKit.Scroll("sf-pause__scrolls", info);
            scrolls = ScreenKit.El("sf-chips", sv);
            var st = ScreenKit.El("sf-section", info);
            ScreenKit.Text("sf-section__title", st, "属性", UIFontRole.Title);
            stats = ScreenKit.El("sf-statgrid", info);
            return root;
        }

        static Label Fact(VisualElement parent, UIIcon icon, string label, string iconClass)
        {
            var el = ScreenKit.El("sf-fact", parent);
            ScreenKit.Icon(icon, iconClass, el);
            ScreenKit.Text("sf-fact__label", el, label);
            return ScreenKit.Text("sf-fact__val", el, "", UIFontRole.Number);
        }

        public override void OnOpen(object arg)
        {
            if (arg is Action a) onResume = a;
            openedAt = Time.unscaledTime;
            openedFrame = Time.frameCount;
            Disarm();
            Refresh();
            GameUI.ClearMessages();
        }

        public override void OnClose()
        {
            Disarm();
            var cb = onResume;
            onResume = null;
            if (PauseMenu.Hiding || cb == null) return;
            try { cb(); }
            catch (Exception e) { Debug.LogException(e); }
        }

        /// <summary>「继续」：关掉自己（OnClose 回调 onResume）</summary>
        public void Resume() => Close();

        public override void Tick(float dt)
        {
            float now = Time.unscaledTime;
            float k = ScreenKit.EaseOut((now - openedAt) / 0.3f);
            frame.style.opacity = k;
            frame.style.translate = new Translate(0, 14 * (1 - k));
            if (armed != null && now - armedAt > ArmSeconds) Disarm();
            // 暂停键（Esc / P / 手柄 Start）再按一次 = 继续；Gameplay 表关着，直接读按键
            if (Time.frameCount != openedFrame && ScreenKit.PressedRaw(GameAction.Pause)) Resume();
        }

        /// <summary>刷新右列（打开时调；时间是停的，开着期间不变）</summary>
        public void Refresh()
        {
            var run = RunState.Current;
            var hero = ScreenKit.RunHero;
            ScreenKit.SetCrest(crest, hero);
            heroName.text = hero != null ? $"{hero.name} · {hero.title}" : "无名侠客";
            var session = GameSession.Instance;
            stageLabel.text = run?.Stage?.Label ?? (session ? session.StageTitle : "");
            timeVal.text = ScreenKit.Clock(run?.time ?? 0);
            killsVal.text = ScreenKit.Num(run?.kills ?? 0);
            coinsVal.text = ScreenKit.Num(run?.coins ?? 0);
            essenceVal.text = ScreenKit.Num(run?.essence ?? 0);
            int n = ScrollList.Render(scrolls, ScrollList.Inventory, false);
            scrollCount.text = n > 0 ? n.ToString() : "";
            var pv = PlayerVitals.Instance;
            StatGrid.Render(stats, pv ? pv.stats : null, StatGrid.PauseStats, false, true);
        }

        /// <summary>二次确认：第一次按进入待确认（按钮字变成「再按一次确认」）返回 false，确认期内再按返回 true</summary>
        bool Arm(string key)
        {
            if (armed == key)
            {
                Disarm();
                return true;
            }
            Disarm();
            armed = key;
            armedAt = Time.unscaledTime;
            var b = key == "abandon" ? abandonBtn : menuBtn;
            b.text = "再按一次确认";
            b.AddToClassList("sf-btn--armed");
            UISound.Play(UISound.DenyId);
            return false;
        }

        void Disarm()
        {
            armed = null;
            if (abandonBtn == null) return;
            abandonBtn.text = "放弃本局";
            menuBtn.text = "返回主菜单";
            abandonBtn.RemoveFromClassList("sf-btn--armed");
            menuBtn.RemoveFromClassList("sf-btn--armed");
        }

        /// <summary>按一次「放弃本局」/「返回主菜单」（key = abandon / menu）：按钮和测试都走这里（含二次确认）</summary>
        public void Press(string key)
        {
            if (!Arm(key)) return;
            if (key == "abandon") MenuFlow.Abandon();
            else if (key == "menu") MenuFlow.ToMenu();
        }
    }
}
