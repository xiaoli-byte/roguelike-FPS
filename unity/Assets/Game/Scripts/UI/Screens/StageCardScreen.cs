using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>关间结算卡的内容（<see cref="GameSession.CompleteStage"/> 填）</summary>
    public sealed class StageCardInfo
    {
        /// <summary>刚打完的这一关 / 下一关（<see cref="RunPlan.Next"/>；没有为 null）</summary>
        public StageSpec stage, next;
        /// <summary>不在 RunPlan 里的关卡的标题（测试场）</summary>
        public string title;
        /// <summary>本关用时（秒，游戏时间）</summary>
        public float time;
        /// <summary>本关击杀、本关灵石净变化（= 现在 − 进关时，含花掉的）、现有灵石、秘卷总层数、本关新得的秘卷层数</summary>
        public int kills, coinsDelta, coins, scrolls, scrollsGained;
        /// <summary>下一关的场景能加载（否则「继续」= 带着进度再走一遍本关）</summary>
        public bool nextReady;

        public string StageLabel => stage != null ? stage.Label : title ?? "本关";
    }

    /// <summary>
    /// 关间结算卡（I1；docs/unity-parity.md 第 5 节 I1「关间结算卡」）：出口进门后、下一关加载之前弹出，停住时间。
    ///   上：章名 · 关卡名 ·「完成」；中：本关四格（用时 / 击杀 / 灵石净变化与现有 / 秘卷层数与本关新得）；
    ///   下：下一关预告——关卡名、难度（与本关的差）、清关奖励、标签（首领关 / 有补给营 / 新章节）；
    ///   按钮：「继续」（F / 回车 / 手柄 A）进下一关，「重来本关」（R）回到进关快照。返回键不关（二选一）。
    /// 下一关场景还没生成时「继续」写成「再走一遍本关」（SceneFlow 带着本局进度重走本关）。
    /// 最后一关（<see cref="RunPlan.IsFinal"/>）不弹这张卡：那里是整局结算（<see cref="SummaryScreen"/>）。
    /// 换关开始（StageLoaded / 关掉）时自己收起。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class StageCardScreen : UIScreen
    {
        public const string ScreenId = "stage-card";
        /// <summary>弹出后多久才认按键（防止进门那一下 F 连按直接跳过）</summary>
        const float InputDelay = 0.5f;
        const string Style = "UI/stagecard";

        public override string Id => ScreenId;
        public override GameState? BlockState => GameState.Summary;

        VisualElement root, panel, glow, stats, tags;
        Label chapter, title, nextLabel, nextTitle, hint;
        Button continueBtn, restartBtn;
        StageCardInfo info;
        float openedAt;
        bool acted;

        /// <summary>当前显示的内容（测试用）</summary>
        public StageCardInfo Info => info;
        /// <summary>弹出以来按过「继续 / 重来」（测试用）</summary>
        public bool Acted => acted;
        /// <summary>预告里的标签文字（测试用）</summary>
        public string TagText { get; private set; } = "";

        public override VisualElement DefaultFocus => continueBtn;

        protected override VisualElement Build()
        {
            root = new VisualElement { name = "stage-card" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, ScreenKit.MenuStyle);
            ScreenKit.Style(root, Style);
            root.AddToClassList("sf-stagecard");
            ScreenKit.El("sf-stagecard__bg", root);
            glow = ScreenKit.El("sf-stagecard__glow", root);
            UITheme.Paint(glow, UITheme.RadialSoft, UITheme.Gold);

            panel = ScreenKit.El("sf-stagecard__panel", root);
            chapter = ScreenKit.Text("sf-stagecard__chapter", panel, "");
            title = ScreenKit.Text("sf-stagecard__title", panel, "", UIFontRole.Title);
            ScreenKit.Text("sf-stagecard__done", panel, "完 成", UIFontRole.Title);
            stats = ScreenKit.El("sf-stagecard__stats", panel);

            var next = ScreenKit.El("sf-stagecard__next", panel);
            nextLabel = ScreenKit.Text("sf-stagecard__nextlabel", next, "下一关");
            nextTitle = ScreenKit.Text("sf-stagecard__nexttitle", next, "", UIFontRole.Title);
            tags = ScreenKit.El("sf-stagecard__tags", next);

            var foot = ScreenKit.El("sf-stagecard__foot", panel);
            continueBtn = ScreenKit.Btn("继续", "sf-btn--primary sf-btn--wide sf-sound-confirm", foot, Continue);
            continueBtn.name = "stagecard-continue";
            restartBtn = ScreenKit.Btn("重来本关", "sf-btn--ghost sf-btn--wide", foot, Restart);
            restartBtn.name = "stagecard-restart";
            hint = ScreenKit.Text("sf-stagecard__hint", panel, "");
            return root;
        }

        public override bool OnBack() => true;

        public override void OnOpen(object arg)
        {
            info = arg as StageCardInfo ?? new StageCardInfo();
            openedAt = Time.unscaledTime;
            acted = false;
            GameEvents.StageLoaded -= OnStageLoaded;
            GameEvents.StageLoaded += OnStageLoaded;
            var s = info.stage;
            var n = info.next;
            chapter.text = s != null ? $"{GameSession.ChapterName(s.chapter)} · {s.chapterName}" : "";
            title.text = info.StageLabel;

            stats.Clear();
            Stat(UIIcon.Hourglass, null, "用时", ScreenKit.Clock(info.time), null);
            Stat(UIIcon.Skull, null, "击杀", ScreenKit.Num(info.kills), null);
            Stat(UIIcon.Coin, "sf-icon--coin", "灵石", (info.coinsDelta >= 0 ? "+" : "−") + ScreenKit.Num(Mathf.Abs(info.coinsDelta)), $"现有 {ScreenKit.Num(info.coins)}");
            Stat(UIIcon.Spark, null, "秘卷", $"{info.scrolls} 层", info.scrollsGained > 0 ? $"本关 +{info.scrollsGained}" : "本关未得");

            tags.Clear();
            var tagList = new System.Collections.Generic.List<string>();
            void Tag(string text, string cls)
            {
                var chip = ScreenKit.El("sf-chip " + (cls ?? ""), tags);
                ScreenKit.Text("sf-chip__name", chip, text);
                tagList.Add(text);
            }
            root.EnableInClassList("sf-stagecard--boss", n != null && n.IsBoss);
            if (n != null)
            {
                nextLabel.text = "下 一 关";
                nextTitle.text = info.nextReady ? n.Label : $"{n.Label}（制作中）";
                if (s != null && n.chapter != s.chapter) Tag($"新章节 · {GameSession.ChapterName(n.chapter)} {n.chapterName}", "sf-stagecard__tag--chapter");
                float dd = s != null ? n.difficulty - s.difficulty : 0;
                Tag(s != null ? $"难度 {n.difficulty:0.00}（{(dd >= 0 ? "+" : "−")}{Mathf.Abs(dd):0.00}）" : $"难度 {n.difficulty:0.00}", null);
                if (n.IsBoss) Tag("首领关", "sf-stagecard__tag--boss");
                if (n.supplyCamp) Tag(n.IsBoss ? "门外有补给营" : "关内有补给营", "sf-stagecard__tag--camp");
                if (!string.IsNullOrEmpty(n.clearReward)) Tag($"清关奖励 · {Chest.Label(n.clearReward)}", null);
                continueBtn.text = info.nextReady ? "继续" : "再走一遍本关";
            }
            else
            {
                nextLabel.text = "";
                nextTitle.text = "（没有下一关）";
                continueBtn.text = "再走一遍本关";
            }
            TagText = string.Join(" / ", tagList);
            hint.text = $"{ScreenKit.KeyLabel(GameAction.Interact)} / 回车 继续　　{ScreenKit.KeyLabel(GameAction.Reload)} 重来本关";
            Tick(0);
            UISound.Play(UISound.ConfirmId);
        }

        public override void OnClose() => GameEvents.StageLoaded -= OnStageLoaded;

        void OnStageLoaded(StageSpec _) => Close();

        void Stat(UIIcon icon, string iconClass, string label, string value, string sub)
        {
            var cell = ScreenKit.El("sf-stagecard__stat", stats);
            ScreenKit.Icon(icon, iconClass, cell);
            ScreenKit.Text("sf-stagecard__slabel", cell, label);
            ScreenKit.Text("sf-stagecard__sval", cell, value, UIFontRole.Number);
            if (!string.IsNullOrEmpty(sub)) ScreenKit.Text("sf-stagecard__ssub", cell, sub);
        }

        /// <summary>「继续」：进下一关（GameSession.Continue → SceneFlow.Advance）</summary>
        public void Continue()
        {
            if (acted) return;
            acted = true;
            Close();
            GameSession.Instance?.Continue();
        }

        /// <summary>「重来本关」：回到进关快照重打</summary>
        public void Restart()
        {
            if (acted) return;
            acted = true;
            Close();
            GameSession.Instance?.Restart();
        }

        public override void Tick(float dt)
        {
            float t = Time.unscaledTime - openedAt;
            panel.style.opacity = ScreenKit.EaseOut(t / 0.3f);
            panel.style.translate = new Translate(0, 14 * (1 - ScreenKit.EaseOut(t / 0.4f)));
            if (t < InputDelay || acted) return;
            // 动作表被路由关掉（挡游戏的界面开着）时照样认 F / R（改过的键也认）
            if (ScreenKit.PressedRaw(GameAction.Interact)) Continue();
            else if (ScreenKit.PressedRaw(GameAction.Reload)) Restart();
        }
    }
}
