using Spiritfire.Art;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一关的会话：关卡标题、阵亡后 R 重来、Esc / P 暂停（弹出 <see cref="PauseMenu"/>，含画质设置）、模态界面、本关结算、失焦暂停。
    /// 局的数据（灵石、击杀、用时…）在 <see cref="RunState"/>。状态走 <see cref="GameStateMachine"/>（暂停 / 模态 / 结算是模态栈上的项，
    /// 时间由 <see cref="TimeScaleArbiter"/> 统一结算），光标和玩家输入跟着「有没有模态挡着」走。
    ///
    /// 两种用法：
    ///   · 常驻（L1）：挂在 Core 场景的 Game Systems 上，同物体有 <see cref="SceneFlow"/>。每进一关 SceneFlow 组装新玩家后调 <see cref="BeginStage"/>，
    ///     离关前调 <see cref="EndStage"/>。结算面板上 F（交互 / 确认）进下一关，R 重来本关（回到进关时的快照）；
    ///     阵亡 = 本局结束（<see cref="MetaSave.BankRun"/> 结算一次），之后 R 重来本关（练习，不再结算）、F 重新开局。终章通关同样结算（胜利）。
    ///   · 旧式：玩家和会话烘在关卡场景里（测试场）。Awake 按场景路径查 <see cref="RunPlan"/>、建调试局；R 新开一局、同步重载场景。
    /// </summary>
    public sealed class GameSession : MonoBehaviour
    {
        public static GameSession Instance { get; private set; }

        [Tooltip("RunPlan 里查不到本关时用的关卡标题（测试场、展示场景）")]
        public string stageTitle = "1-1 · 古道穿越戈壁";
        public PlayerVitals player;
        public PlayerMotor motor;
        public Hud hud;
        [Tooltip("编辑器里也在失焦时自动暂停（打包版总是暂停；编辑器里点 Inspector 也算失焦，默认关）")]
        public bool pauseOnFocusLossInEditor;
        /// <summary>本关击杀数（整局的在 RunState.kills）</summary>
        public int Kills { get; private set; }
        /// <summary>本关的规划（不在 RunPlan 里的场景为 null）</summary>
        public StageSpec Stage { get; private set; }
        /// <summary>「1-1 · 古道穿越戈壁」</summary>
        public string StageTitle => Stage != null ? Stage.Label : stageTitle;
        /// <summary>由 Core 场景的 <see cref="SceneFlow"/> 驱动（同物体上有它）</summary>
        public bool Managed => flow;

        /// <summary>模态栈上的项：暂停菜单 / 旧的 SetModal（秘卷三选一、本关结算）</summary>
        readonly object pauseKey = new(), modalKey = new();
        TimeScaleArbiter.Handle deathSlowMo;
        SceneFlow flow;
        PlayerVitals subscribed;
        bool complete, blocked;
        float startTime, completedAt;

        void Awake()
        {
            Instance = this;
            flow = GetComponent<SceneFlow>();
            // 新场景（旧式）/ 新的 Core（常驻）：清掉上一次残留的时间请求和模态
            TimeScaleArbiter.Clear();
            GameStateMachine.Clear();
            // 物理必须自动模拟：否则布娃娃不动、移动中的敌人碰撞体留在原地（射线打不到它现在的位置）
            if (Physics.simulationMode != SimulationMode.FixedUpdate) Physics.simulationMode = SimulationMode.FixedUpdate;
            startTime = Time.time;
            if (Managed) return;
            Stage = RunPlan.ForScene(gameObject.scene.path);
            var hero = player ? player.GetComponent<HeroSkills>() : null;
            var run = RunState.Ensure(Stage, hero ? hero.heroId : null);
            run.EnterStage(Stage);
            GameStateMachine.SetBase(GameState.Playing);
        }

        void OnEnable()
        {
            Combat.EnemyKilled += OnKilled;
            GameEvents.EnemyDamaged += OnDamaged;
            GameEvents.StateChanged += OnStateChanged;
        }

        void OnDisable()
        {
            Combat.EnemyKilled -= OnKilled;
            GameEvents.EnemyDamaged -= OnDamaged;
            GameEvents.StateChanged -= OnStateChanged;
        }

        void Start()
        {
            if (Managed) return;
            SubscribePlayer(player);
            Announce(false);
        }

        void OnDestroy()
        {
            SubscribePlayer(null);
            deathSlowMo?.Dispose();
            if (Instance == this) Instance = null;
        }

        void SubscribePlayer(PlayerVitals p)
        {
            if (subscribed) subscribed.Died -= OnDied;
            subscribed = p;
            if (subscribed) subscribed.Died += OnDied;
        }

        // ───────────── 常驻会话：关卡开始 / 结束（SceneFlow 调）─────────────

        /// <summary>
        /// 新的一关开始（玩家已组装好、跨关状态已恢复）：重置本关计数，接上新玩家，显示关卡名（chapterCard = 换章时的章节卡），
        /// 切回游玩状态，发 <see cref="GameEvents.StageLoaded"/>。title = 不在 RunPlan 里的关卡的标题（null = 不改）
        /// </summary>
        public void BeginStage(StageSpec stage, string title, PlayerVitals vitals, PlayerMotor playerMotor, bool chapterCard)
        {
            player = vitals;
            motor = playerMotor;
            SubscribePlayer(vitals);
            Stage = stage;
            if (!string.IsNullOrEmpty(title)) stageTitle = title;
            complete = false;
            Kills = 0;
            startTime = Time.time;
            deathSlowMo?.Dispose();
            deathSlowMo = null;
            GameStateMachine.SetBase(GameState.Playing);
            ApplyControl(true);
            GameAudio.SetMusic(stage != null && !string.IsNullOrEmpty(stage.music) ? stage.music : "calm");
            Announce(chapterCard);
        }

        /// <summary>离开本关（换关 / 重来之前）：断开玩家、收起暂停 / 结算 / 提示、清空模态栈</summary>
        public void EndStage()
        {
            SubscribePlayer(null);
            deathSlowMo?.Dispose();
            deathSlowMo = null;
            if (Paused) PauseMenu.Hide();
            UIRouter.Close(StageCardScreen.ScreenId);
            GameStateMachine.Clear();
            complete = false;
            GameUI.ClearMessages();
            GameUI.SetCenterText(null);
            GameUI.SetPrompt(null);
            GameUI.SetBoss(null);
            GameUI.SetObjective(null);
            player = null;
            motor = null;
        }

        /// <summary>右上角关卡名 + 横幅（换章时是章节卡：「第一章 · 赤沙古道」+ 关卡名）+ StageLoaded</summary>
        void Announce(bool chapterCard)
        {
            GameUI.SetStage(StageTitle);
            if (chapterCard && Stage != null)
                GameUI.Banner($"{ChapterName(Stage.chapter)} · {Stage.chapterName}", Stage.Label, 3.6f);
            else GameUI.Banner(StageTitle.Replace(" · ", "\n"), null, 3f);
            if (Stage != null) GameEvents.RaiseStageLoaded(Stage);
        }

        /// <summary>「第一章」…「第十章」</summary>
        public static string ChapterName(int chapter)
        {
            const string digits = "零一二三四五六七八九十";
            return chapter is > 0 and <= 10 ? $"第{digits[chapter]}章" : $"第 {chapter} 章";
        }

        // ───────────── 事件 ─────────────

        void OnKilled(Damageable d, DamageInfo info)
        {
            if (d.noReward) return;
            Kills++;
            if (RunState.Current != null) RunState.Current.kills++;
        }

        void OnDamaged(in HitEvent e)
        {
            if (RunState.Current != null) RunState.Current.damageDealt += e.result.total;
        }

        /// <summary>
        /// 阵亡 = 这一局结束：结算（<see cref="MetaSave.BankRun"/>：魂晶入账、记生涯、写盘、发 RunEnded；同一局只结一次）。
        /// 常驻会话：R 重来本关（练习：回到进关快照，这一局已经结算过，不会再结一次），F 重新开局；旧式：R 新开一局
        /// </summary>
        void OnDied()
        {
            GameAudio.Play("defeat");
            GameAudio.SetMusic("none");
            deathSlowMo?.Dispose();
            deathSlowMo = TimeScaleArbiter.Request(this, 0.3f, TimeScaleArbiter.Priority.DeathSlowMo);
            completedAt = Time.unscaledTime;
            var summary = Bank(false);
            string essence = summary != null ? $"本局结束 · 魂晶 +{summary.essenceEarned}" : "本局已结算";
            GameUI.SetCenterText(Managed
                ? $"阵 亡\n<size=34>{essence}</size>\n<size=28>按 R 重来本关（练习，不再结算）　　F 重新开局</size>"
                : $"阵 亡\n<size=34>{essence} · 按 R 重新开始</size>");
            Cursor.lockState = CursorLockMode.None;
        }

        /// <summary>一局结束的结算；结算出错不影响阵亡 / 通关流程</summary>
        static RunSummary Bank(bool victory)
        {
            try { return MetaSave.BankRun(RunState.Current, victory); }
            catch (System.Exception e)
            {
                Debug.LogException(e);
                return null;
            }
        }

        void Update()
        {
            // 换关途中（旧玩家已拆、新玩家还没装好）什么都不做
            if (Managed && (flow.Busy || !player)) return;
            // 复活（测试 / 以后的复活道具）：撤掉阵亡慢动作
            if (deathSlowMo != null && player && !player.Dead)
            {
                deathSlowMo.Dispose();
                deathSlowMo = null;
            }
            // 阵亡 / 结算画面上：R 重来（R 即换弹键，手柄 X）；F / 确认：结算后进下一关、阵亡后重新开局（常驻会话）
            if (complete || (player && player.Dead))
            {
                // 整局结算界面（U5 的 SummaryScreen，RunEnd 弹出）开着时由它接管输入：确认 / 返回不再落到这里
                if (UIRouter.Blocking) return;
                if (Managed && Time.unscaledTime - completedAt > 0.5f &&
                    (GameInput.Pressed(GameAction.Interact) || GameInput.Pressed(UIAction.Submit)))
                {
                    if (complete) Continue();
                    else flow.NewRun();
                    return;
                }
                if (GameInput.Pressed(GameAction.Reload)) Restart();
                return;
            }
            if (GameStateMachine.IsPlaying && RunState.Current != null) RunState.Current.time += Time.deltaTime;
            // 模态界面（秘卷三选一…）在最上面时 Esc 不响应；暂停菜单在最上面时 Esc 继续
            var top = GameStateMachine.Current;
            if (top != GameState.Playing && top != GameState.Paused) return;
            if (GameInput.Pressed(GameAction.Pause)) SetPaused(!Paused);
        }

        /// <summary>失焦（切出游戏窗口）自动暂停：正常游玩时才暂停；冒烟测试在后台跑时不暂停</summary>
        void OnApplicationFocus(bool focus)
        {
            if (focus || (Application.isEditor && !pauseOnFocusLossInEditor)) return;
            if (complete || !player || player.Dead || !GameStateMachine.IsPlaying || WeaponController.TestMode) return;
            if (Managed && flow.Busy) return;
            SetPaused(true);
        }

        public bool Paused => GameStateMachine.Contains(pauseKey);

        /// <summary>Esc 暂停 / 继续（冒烟测试也直接调它）</summary>
        public void SetPaused(bool p)
        {
            if (p) GameStateMachine.Push(pauseKey, GameState.Paused);
            else GameStateMachine.Pop(pauseKey);
            ApplyControl(true);
            // 暂停菜单（含画质设置）里点「继续游戏」或面板外的空白处，也回到这里继续
            if (p) PauseMenu.Show(() => SetPaused(false));
            else PauseMenu.Hide();
        }

        /// <summary>模态界面（秘卷三选一…）：停时间、放开鼠标、屏蔽玩家输入；Esc 暂停在模态期间不响应</summary>
        public void SetModal(bool on) => SetModal(on, GameState.Modal);

        void SetModal(bool on, GameState state)
        {
            if (on) GameStateMachine.Push(modalKey, state);
            else GameStateMachine.Pop(modalKey);
            ApplyControl(true);
        }

        void OnStateChanged(GameState s) => ApplyControl(false);

        /// <summary>有模态挡着：放开鼠标、关玩家输入；没有：锁鼠标、开输入（阵亡时不开）。force = false 时只在「挡 / 不挡」变化时改</summary>
        void ApplyControl(bool force)
        {
            bool now = GameStateMachine.Blocked;
            if (!force && now == blocked) return;
            blocked = now;
            if (motor) motor.inputEnabled = !now && !(player && player.Dead);
            Cursor.lockState = now ? CursorLockMode.None : CursorLockMode.Locked;
        }

        /// <summary>
        /// 关卡完成（出口 / 调试跳关）：停时间、显示本关结算（用时 / 击杀 / 灵石 / 秘卷）。
        /// 常驻会话：F 进下一关（下一关场景还没建时再走一遍本关，带着本局进度），R 重来本关；旧式：按 R 重开
        /// </summary>
        public void CompleteStage(string next = null)
        {
            if (complete) return;
            complete = true;
            completedAt = Time.unscaledTime;
            GameAudio.Play("victory");
            GameAudio.SetMusic("calm");
            float t = Time.time - startTime;
            int scrolls = 0;
            if (LootDirector.Instance)
                foreach (var v in LootDirector.Instance.scrolls.All.Values) scrolls += v;
            var run = RunState.Current;
            if (run != null) run.stagesCleared++;
            if (Stage != null) GameEvents.RaiseStageCleared(Stage);
            // 最后一关（终章首领）通关 = 这一局胜利结束：结算
            bool final = Stage != null && RunPlan.IsFinal(Stage);
            var summary = final ? Bank(true) : null;
            SetModal(true, GameState.Summary);
            GameUI.ClearMessages();
            GameUI.SetPrompt(null);
            var nextStage = RunPlan.Next(Stage);
            // 常驻会话、不是最后一关：弹关间结算卡（I1，StageCardScreen；最后一关由 RunEnd 弹整局结算）。界面没登记时退回下面的中央文字
            if (Managed && !final && UIRouter.Get(StageCardScreen.ScreenId) != null)
            {
                var entry = flow.EntrySnapshot;
                int entryScrolls = 0;
                if (entry?.scrolls != null)
                    foreach (var v in entry.scrolls.Values) entryScrolls += v;
                var card = new StageCardInfo
                {
                    stage = Stage, next = nextStage, title = StageTitle, time = t, kills = Kills,
                    coins = run?.coins ?? 0, coinsDelta = (run?.coins ?? 0) - (entry?.coins ?? run?.coins ?? 0),
                    scrolls = scrolls, scrollsGained = Mathf.Max(0, scrolls - entryScrolls),
                    nextReady = nextStage != null && SceneFlow.CanLoad(nextStage),
                };
                GameUI.SetCenterText(null);
                if (UIRouter.Open(StageCardScreen.ScreenId, card)) return;
            }
            string nextText = nextStage != null ? nextStage.Label : next;
            string tail;
            if (Managed)
            {
                if (final) tail = $"全部关卡完成{(summary != null ? $" · 魂晶 +{summary.essenceEarned}" : "")} · 按 F 重新开局";
                else if (nextStage != null && SceneFlow.CanLoad(nextStage)) tail = $"按 F 进入下一关 · {nextText}　　R 重来本关";
                else tail = $"下一关 {nextText ?? "（未规划）"} 制作中 · 按 F 再走一遍本关（带着本局进度）　　R 重来本关";
            }
            else
                tail = final ? "全部关卡完成 · 按 R 重新开始"
                    : string.IsNullOrEmpty(nextText) ? "按 R 重新开始" : $"下一关 {nextText} 制作中 · 按 R 重新开始";
            GameUI.SetCenterText($"<color=#ffd98a>{StageTitle} · 完成</color>\n" +
                                 $"<size=34><color=#ffffff>用时 {(int)t / 60}:{(int)t % 60:00}　击杀 {Kills}　灵石 {run?.coins ?? 0}　秘卷 {scrolls} 卷</color></size>\n" +
                                 $"<size=28><color=#e8e0d0>{tail}</color></size>");
        }

        public bool Completed => complete;

        /// <summary>结算面板上「继续」（F / 确认）：进下一关；最后一关之后新开一局。只有常驻会话有</summary>
        public void Continue()
        {
            if (!complete || !Managed || flow.Busy) return;
            if (Stage != null && RunPlan.IsFinal(Stage)) flow.NewRun();
            else flow.Advance();
        }

        /// <summary>
        /// 重来：常驻会话 = 重来本关（RunState 回到进关时的快照，异步重载关卡、重新组装玩家）；
        /// 旧式 = 新开一局（灵石、击杀清零），同步重新加载场景
        /// </summary>
        public void Restart()
        {
            if (Managed)
            {
                flow.RestartStage();
                return;
            }
            deathSlowMo = null;
            TimeScaleArbiter.Clear();
            GameStateMachine.Clear();
            RunState.Current = null;
            SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
        }
    }
}
