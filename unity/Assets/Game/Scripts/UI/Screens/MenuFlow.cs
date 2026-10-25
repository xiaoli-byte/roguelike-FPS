using System;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 局外流转（U4 / U5 / U6）：主菜单场景 ↔ 一局（Core + 关卡）之间的切换都走这里，界面按钮只调它。
    ///   · <see cref="StartRun"/>：选英雄「出征」——新开一局（正式局；调试档开着时记调试档），黑幕淡入后整场景切到 Core，
    ///     Core 的 <see cref="SceneFlow"/> 接着叠加加载第一关。
    ///   · <see cref="Abandon"/>：暂停里「放弃本局」——按失败结算（<see cref="MetaSave.BankRun"/>，已结算过的不再结），收起暂停（不恢复时间），弹结算界面。
    ///   · <see cref="ToMenu"/>：回主菜单——没结算过的局先按失败结算（Three.js 的「返回主菜单不结算」会白丢本局魂晶，这里不跟），整场景切到 MainMenu。
    ///     主菜单场景还没生成（没跑 bridge.sh menu）时退回「新开一局」，不会卡死。
    ///   · <see cref="Retry"/>：结算「再来一局」——同一位英雄新开一局（常驻 Core 时不换场景）。
    ///   · 中途续玩（I5，<see cref="RunSuspend"/>）：<see cref="ResumeRun"/> 主菜单「继续征程」读续玩档从那一关开头接着打；
    ///     <see cref="Suspend"/> 暂停里「返回主菜单」不结算、续玩档留着；有续玩档时 <see cref="StartRun(string)"/> 先弹确认框，确认后旧局按放弃结算。
    /// 启动（打包后）：构建设置第 0 个是 Core；Core 第一次加载、还没有局时改去主菜单（<see cref="Boot"/>）。编辑器里直接开 Core / 关卡照旧进调试局。
    /// </summary>
    public static class MenuFlow
    {
        public const string MenuScenePath = "Assets/Scenes/MainMenu.unity", MenuSceneName = "MainMenu";
        /// <summary>整局结算界面的路由 id（U5 的 SummaryScreen）</summary>
        public const string SummaryScreenId = "summary";
        const float FadeOut = 0.35f;
        /// <summary>命令行带这个参数时打包版启动直接进 Core（跳过主菜单，自动化用）</summary>
        public const string SkipMenuArg = "-skipmenu";

        static readonly object holdOwner = new();
        static TimeScaleArbiter.Handle hold;
        static bool busy;

        /// <summary>结算中（自己结算的局不让 RunEnd 再弹一次结算界面）</summary>
        public static bool Banking { get; private set; }

        /// <summary>正在切场景</summary>
        public static bool Busy => busy;

        /// <summary>主菜单场景能加载（在构建设置里，或编辑器里磁盘上有）</summary>
        public static bool MenuAvailable => SceneFlow.CanLoad(MenuScenePath);

        /// <summary>当前是主菜单场景</summary>
        public static bool InMenu => SceneManager.GetActiveScene().path == MenuScenePath || SceneManager.GetActiveScene().name == MenuSceneName;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            hold = null;
            busy = false;
            Banking = false;
        }

        // ───────────── 开局 ─────────────

        /// <summary>
        /// 出征：新开一局（选中的英雄），切到 Core 场景。场景不在时返回 false。
        /// 有未完成的征程（续玩档，I5）时先弹确认框（不可撤销：旧局按放弃结算），确认后才结算旧局、开新局；这次调用返回 false
        /// </summary>
        public static bool StartRun(string heroId) => StartRun(heroId, false);

        /// <summary>同上；forfeitSuspended = 已经确认过放弃未完成的征程（确认框的回调、测试）</summary>
        public static bool StartRun(string heroId, bool forfeitSuspended)
        {
            if (busy) return false;
            if (!SceneFlow.CanLoad(SceneFlow.CorePath))
            {
                Debug.LogError($"[MenuFlow] 加载不了 {SceneFlow.CorePath}（先跑 bridge.sh core）");
                GameUI.Toast("Core 场景还没生成", UITheme.Bad);
                return false;
            }
            if (string.IsNullOrEmpty(heroId) || HeroLibrary.Get(heroId) == null) heroId = HeroLibrary.DefaultHero;
            RunState.Current = null;
            // 主菜单开的局是正式局（记正式档）；调试档开关 / -devprofile 开着时记调试档，菜单显示的也是调试档，两边一致
            bool dev = SaveService.DevActive;
            var suspended = RunSuspend.Peek(dev);
            if (suspended != null)
            {
                if (!forfeitSuspended)
                {
                    string hero = heroId;
                    ConfirmScreen.Ask(new ConfirmRequest
                    {
                        title = "开始新征程",
                        message = $"开始新征程会放弃当前的征程（第 {suspended.run.stageCode} 关），确定吗？",
                        detail = "放弃的征程按败北结算：已收集的魂晶照常入账，此操作不能撤销。",
                        confirmText = "放弃并出征",
                        cancelText = "取消",
                        onConfirm = () => StartRun(hero, true),
                    });
                    return false;
                }
                RunSuspend.Forfeit(dev);
            }
            RunState.Begin(heroId, Environment.TickCount, RunPlan.First, dev);
            Remember(heroId);
            Go(SceneFlow.CorePath);
            return true;
        }

        /// <summary>主菜单当前档里未完成的征程（续玩档；没有 / 坏了为 null，坏档顺带丢弃并记下提示）</summary>
        public static SuspendedRun Suspended => RunSuspend.Peek(SaveService.DevActive);

        /// <summary>
        /// 继续征程（I5）：读续玩档设成当前局，切到 Core，SceneFlow 从那一关开头接着走（不发 RunStarted：不是新开一局）。
        /// 没有档 / 坏档 / 关卡场景加载不了时提示并返回 false
        /// </summary>
        public static bool ResumeRun()
        {
            if (busy) return false;
            if (!SceneFlow.CanLoad(SceneFlow.CorePath))
            {
                Debug.LogError($"[MenuFlow] 加载不了 {SceneFlow.CorePath}（先跑 bridge.sh core）");
                GameUI.Toast("Core 场景还没生成", UITheme.Bad);
                return false;
            }
            var s = Suspended;
            if (s == null)
            {
                GameUI.Toast(RunSuspend.TakeProblem() ?? "没有可以继续的征程", UITheme.Bad);
                return false;
            }
            if (!SceneFlow.CanLoad(s.Stage))
            {
                Debug.LogError($"[MenuFlow] 续玩档的关卡 {s.Stage?.Label} 场景加载不了（{s.Stage?.scene}）");
                GameUI.Toast($"{s.Stage?.Label} 的关卡场景加载不了", UITheme.Bad);
                return false;
            }
            RunState.Current = s.run;
            Remember(s.run.heroId);
            Go(SceneFlow.CorePath);
            return true;
        }

        /// <summary>
        /// 暂离（暂停菜单「返回主菜单」，I5）：不结算，续玩档留着，下次主菜单「继续征程」从本关开头接着打（本关里的进度不保留）。
        /// 这一局没有续玩档（调试局、已经结算过）时退回 <see cref="ToMenu"/>（结算）
        /// </summary>
        public static void Suspend()
        {
            if (busy) return;
            if (!RunSuspend.CanSuspend(RunState.Current) || !MenuAvailable)
            {
                ToMenu();
                return;
            }
            Go(MenuScenePath, clearRun: true);
        }

        /// <summary>结算「再来一局」：同英雄新开一局（常驻 Core 里直接换关，旧式关卡重载场景）</summary>
        public static void Retry()
        {
            var hero = RunState.Current?.heroId;
            UIRouter.CloseAll();
            var flow = SceneFlow.Instance;
            if (flow)
            {
                flow.NewRun();
                return;
            }
            if (!string.IsNullOrEmpty(hero) && SceneFlow.CanLoad(SceneFlow.CorePath))
            {
                StartRun(hero);
                return;
            }
            GameSession.Instance?.Restart();
        }

        // ───────────── 结束 ─────────────

        /// <summary>
        /// 放弃本局：按失败结算（已经结算过的局照当前状态出结算），收起暂停但不恢复时间，弹结算界面。
        /// 结算界面没登记（U5 之前）时直接回主菜单。返回结算（没有局时 null）
        /// </summary>
        public static RunSummary Abandon()
        {
            var run = RunState.Current;
            if (run == null) return null;
            var summary = Bank(run, false) ?? RunSummary.From(run, false);
            PauseMenu.Hide();
            UIRouter.Close(SettingsScreen.ScreenId);
            if (UIRouter.Get(SummaryScreenId) != null) UIRouter.Open(SummaryScreenId, summary);
            else ToMenu(false);
            return summary;
        }

        /// <summary>回主菜单（bank = 没结算过的局先按失败结算）。主菜单场景不在时新开一局</summary>
        public static void ToMenu(bool bank = true)
        {
            if (busy) return;
            if (bank && RunState.Current != null) Bank(RunState.Current, false);
            if (!MenuAvailable)
            {
                Debug.LogWarning($"[MenuFlow] 没有主菜单场景 {MenuScenePath}（先跑 bridge.sh menu）：新开一局代替");
                GameUI.Toast("主菜单场景还没生成，新开一局", UITheme.Bad);
                UIRouter.CloseAll();
                if (SceneFlow.Instance) SceneFlow.Instance.NewRun();
                else GameSession.Instance?.Restart();
                return;
            }
            Go(MenuScenePath, clearRun: true);
        }

        /// <summary>结算一局（不弹 RunEnd 的结算界面：调用方自己处理）；出错打日志返回 null</summary>
        public static RunSummary Bank(RunState run, bool victory)
        {
            Banking = true;
            try { return MetaSave.BankRun(run, victory); }
            catch (Exception e)
            {
                Debug.LogException(e);
                return null;
            }
            finally
            {
                Banking = false;
            }
        }

        // ───────────── 切场景 ─────────────

        /// <summary>停住时间 → 收起全部界面 → 黑幕淡入 → 整场景切换（新场景自己淡出黑幕）</summary>
        static async void Go(string path, bool clearRun = false)
        {
            if (busy) return;
            busy = true;
            try
            {
                hold?.Dispose();
                hold = TimeScaleArbiter.Request(holdOwner, 0, TimeScaleArbiter.Priority.Transition);
                // 先收暂停（不走「继续游戏」：不恢复时间、不锁鼠标），再收其余界面
                PauseMenu.Hide();
                UIRouter.CloseAll();
                GameUI.ClearMessages();
                await GameUI.Fade(1, FadeOut);
                if (clearRun) RunState.Current = null;
                GameStateMachine.Clear();
                var op = LoadSingle(path);
                if (op == null)
                {
                    Debug.LogError($"[MenuFlow] 加载不了场景 {path}");
                    _ = GameUI.Fade(0, 0.3f);
                    return;
                }
                while (!op.isDone) await Awaitable.NextFrameAsync();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                _ = GameUI.Fade(0, 0.3f);
            }
            finally
            {
                hold?.Dispose();
                hold = null;
                busy = false;
            }
        }

        static AsyncOperation LoadSingle(string path)
        {
            if (SceneUtility.GetBuildIndexByScenePath(path) >= 0) return SceneManager.LoadSceneAsync(path, LoadSceneMode.Single);
#if UNITY_EDITOR
            if (System.IO.File.Exists(path))
                return UnityEditor.SceneManagement.EditorSceneManager.LoadSceneAsyncInPlayMode(path, new LoadSceneParameters(LoadSceneMode.Single));
#endif
            return null;
        }

        // ───────────── 上次的英雄 ─────────────

        const string LastHeroKey = "spiritfire.menu.lastHero";

        /// <summary>上次出征的英雄（主菜单祭台上站的、选英雄默认选中的）</summary>
        public static string LastHero
        {
            get
            {
                var id = PlayerPrefs.GetString(LastHeroKey, HeroLibrary.DefaultHero);
                return HeroLibrary.Get(id) != null ? id : HeroLibrary.DefaultHero;
            }
        }

        static void Remember(string heroId)
        {
            PlayerPrefs.SetString(LastHeroKey, heroId);
            PlayerPrefs.Save();
        }

        // ───────────── 启动 ─────────────

        /// <summary>
        /// 打包版启动：第一个场景是 Core、还没有局（不是从主菜单「出征」进来的）、主菜单在构建设置里 → 停掉 Core 的流转，改去主菜单。
        /// AfterSceneLoad 在各物体 Awake 之后、Start 之前：SceneFlow 被停用后不会开始加载第一关。编辑器里不拦（直接开 Core / 关卡 = 调试）
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (Application.isEditor || RunState.Current != null) return;
            if (Array.IndexOf(Environment.GetCommandLineArgs(), SkipMenuArg) >= 0) return;
            var active = SceneManager.GetActiveScene();
            if (active.path != SceneFlow.CorePath && active.name != SceneFlow.CoreName) return;
            if (SceneUtility.GetBuildIndexByScenePath(MenuScenePath) < 0) return;
            var flow = SceneFlow.Instance;
            if (flow) flow.enabled = false;
            _ = GameUI.Fade(1, 0);
            SceneManager.LoadScene(MenuScenePath, LoadSceneMode.Single);
        }
    }
}
