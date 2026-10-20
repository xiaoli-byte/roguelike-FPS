using System;
using System.Collections;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一局结束 → 结算界面（U5；docs/unity-parity.md 3.11「阵亡流程 / 胜利流程 / 结算界面」）：
    /// 订阅 <see cref="GameEvents.RunEnded"/>（<see cref="MetaSave.BankRun"/> 在魂晶入账、生涯记下、写盘之后发），等一会儿再弹 <see cref="SummaryScreen"/>：
    ///   · 阵亡：GameSession 已经开了 0.3 倍慢动作、显示「阵亡」，这里等 <see cref="DeathDelay"/> 秒（不缩放时间）让倒地演完，再弹结算（结算停住时间）；
    ///   · 胜利（终章首领倒下、本关结算）：等 <see cref="VictoryDelay"/> 秒；
    ///   · 自己结算的（<see cref="MenuFlow"/> 的放弃 / 回主菜单）、换关途中顺带结算的（SceneFlow 新开一局时把没结算的旧局按放弃结）不弹——前者自己弹，后者已经在换关。
    /// 结算界面上「再来一局」= <see cref="MenuFlow.Retry"/>，「主菜单」= <see cref="MenuFlow.ToMenu"/>。
    /// [GameSystem]：自动挂到 Core 的 Game Systems 上（主菜单场景里没有，也不需要）。测试 / 调试用 <see cref="Force"/> 立即结束本局。
    /// </summary>
    [GameSystem(70)]
    public sealed class RunEnd : MonoBehaviour
    {
        /// <summary>阵亡到弹出结算（秒，不缩放时间）</summary>
        public const float DeathDelay = 2.2f;
        /// <summary>胜利到弹出结算</summary>
        public const float VictoryDelay = 1.4f;
        /// <summary>其余（强制结束等）</summary>
        public const float OtherDelay = 0.3f;

        /// <summary>最近一次结束的局（测试用）</summary>
        public static RunSummary Last { get; private set; }

        /// <summary>结算界面弹出了（测试用）</summary>
        public static event Action<RunSummary> Shown;

        /// <summary>
        /// 冒烟测试（WeaponController.TestMode）期间阵亡 / 通关也自动弹结算。缺省关：别的套件里玩家死了会被救起来接着测，
        /// 结算一弹就停住时间、卡住按游戏时间等待的步骤。要测结算的套件打开它，或直接用 <see cref="Force"/>
        /// </summary>
        public static bool ShowDuringTests;

        Coroutine pending;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Last = null;
            Shown = null;
            ShowDuringTests = false;
        }

        void OnEnable()
        {
            GameEvents.RunEnded += OnRunEnded;
            GameEvents.StageLoaded += OnStageLoaded;
        }

        void OnDisable()
        {
            GameEvents.RunEnded -= OnRunEnded;
            GameEvents.StageLoaded -= OnStageLoaded;
            if (pending != null) StopCoroutine(pending);
            pending = null;
        }

        /// <summary>新的一关开始了（阵亡后按 R 重来本关练习、换关）：还没弹的结算不弹了，开着的收起</summary>
        void OnStageLoaded(StageSpec _)
        {
            if (pending != null) StopCoroutine(pending);
            pending = null;
            UIRouter.Close(MenuFlow.SummaryScreenId);
        }

        void OnRunEnded(RunSummary s)
        {
            Last = s;
            if (s == null || MenuFlow.Banking || MenuFlow.Busy) return;
            if (WeaponController.TestMode && !ShowDuringTests) return;
            if (SceneFlow.Instance && SceneFlow.Instance.Busy) return;
            var pv = PlayerVitals.Instance;
            float delay = s.victory ? VictoryDelay : pv && pv.Dead ? DeathDelay : OtherDelay;
            if (pending != null) StopCoroutine(pending);
            pending = StartCoroutine(ShowAfter(s, delay, pv && pv.Dead ? pv : null));
        }

        IEnumerator ShowAfter(RunSummary s, float delay, PlayerVitals died)
        {
            yield return new WaitForSecondsRealtime(delay);
            pending = null;
            // 等的这段时间里换关了 / 回主菜单了 / 阵亡后又被救起来（复活、重来本关）：不弹
            if (MenuFlow.Busy || (SceneFlow.Instance && SceneFlow.Instance.Busy) || RunState.Current == null) yield break;
            if (!ReferenceEquals(died, null) && (!died || !died.Dead)) yield break;
            Show(s);
        }

        /// <summary>弹结算界面（已经开着就换内容）</summary>
        public static void Show(RunSummary s)
        {
            if (s == null) return;
            GameUI.ClearMessages();
            GameUI.SetCenterText(null);
            GameUI.SetPrompt(null);
            if (UIRouter.Open(MenuFlow.SummaryScreenId, s)) Shown?.Invoke(s);
        }

        /// <summary>
        /// 立即结束本局（测试 / 调试）：没结算过的按 victory 结算并立即弹结算；已经结算过的按当前状态出一份结算弹出。没有局返回 null
        /// </summary>
        public static RunSummary Force(bool victory)
        {
            var run = RunState.Current;
            if (run == null) return null;
            var s = MenuFlow.Bank(run, victory) ?? RunSummary.From(run, victory);
            Last = s;
            PauseMenu.Hide();
            Show(s);
            return s;
        }
    }
}
