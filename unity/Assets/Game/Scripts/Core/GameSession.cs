using Spiritfire.Art;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一关的会话：关卡标题（按场景路径查 <see cref="RunPlan"/>）、阵亡后 R 重开、Esc / P 暂停（弹出 <see cref="PauseMenu"/>，含画质设置）、
    /// 模态界面、本关结算、失焦暂停。局的数据（灵石、击杀、用时…）在 <see cref="RunState"/>；直接打开关卡场景时这里建一个调试局。
    /// 状态走 <see cref="GameStateMachine"/>（暂停 / 模态 / 结算是模态栈上的项，时间由 <see cref="TimeScaleArbiter"/> 统一结算），
    /// 光标和玩家输入跟着「有没有模态挡着」走。场景流转（下一关、Core 场景）是 L1 的事，现在通关后仍是「下一关制作中，按 R 重开」。
    /// </summary>
    public sealed class GameSession : MonoBehaviour
    {
        public static GameSession Instance { get; private set; }

        [Tooltip("RunPlan 里查不到本场景时用的关卡标题（测试场、展示场景）")]
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

        /// <summary>模态栈上的项：暂停菜单 / 旧的 SetModal（秘卷三选一、本关结算）</summary>
        readonly object pauseKey = new(), modalKey = new();
        TimeScaleArbiter.Handle deathSlowMo;
        bool complete, blocked;
        float startTime;

        void Awake()
        {
            Instance = this;
            // 这个场景就是整局（L1 之前）：进场景时清掉上一次残留的时间请求和模态
            TimeScaleArbiter.Clear();
            GameStateMachine.Clear();
            // 物理必须自动模拟：否则布娃娃不动、移动中的敌人碰撞体留在原地（射线打不到它现在的位置）
            if (Physics.simulationMode != SimulationMode.FixedUpdate) Physics.simulationMode = SimulationMode.FixedUpdate;
            startTime = Time.time;
            Stage = RunPlan.ForScene(gameObject.scene.path);
            var hero = player ? player.GetComponent<HeroSkills>() : null;
            var run = RunState.Ensure(Stage, hero ? hero.heroId : null);
            run.EnterStage(Stage);
            GameStateMachine.SetBase(GameState.Playing);
        }

        void Start()
        {
            GameUI.SetStage(StageTitle);
            GameUI.Banner(StageTitle.Replace(" · ", "\n"), null, 3f);
            if (player) player.Died += OnDied;
            Combat.EnemyKilled += OnKilled;
            GameEvents.EnemyDamaged += OnDamaged;
            GameEvents.StateChanged += OnStateChanged;
            if (Stage != null) GameEvents.RaiseStageLoaded(Stage);
        }

        void OnDestroy()
        {
            Combat.EnemyKilled -= OnKilled;
            GameEvents.EnemyDamaged -= OnDamaged;
            GameEvents.StateChanged -= OnStateChanged;
            if (player) player.Died -= OnDied;
            deathSlowMo?.Dispose();
            if (Instance == this) Instance = null;
        }

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

        void OnDied()
        {
            GameAudio.Play("defeat");
            GameAudio.SetMusic("none");
            deathSlowMo?.Dispose();
            deathSlowMo = TimeScaleArbiter.Request(this, 0.3f, TimeScaleArbiter.Priority.DeathSlowMo);
            GameUI.SetCenterText("阵 亡\n<size=34>按 R 重新开始</size>");
            Cursor.lockState = CursorLockMode.None;
        }

        void Update()
        {
            // 复活（测试 / 以后的复活道具）：撤掉阵亡慢动作
            if (deathSlowMo != null && player && !player.Dead)
            {
                deathSlowMo.Dispose();
                deathSlowMo = null;
            }
            // 阵亡 / 结算画面上「按 R 重新开始」：R 即换弹键（手柄 X）
            if (complete || (player && player.Dead))
            {
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
            if (complete || (player && player.Dead) || !GameStateMachine.IsPlaying || WeaponController.TestMode) return;
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

        /// <summary>关卡完成（出口 / 调试跳关）：停时间、显示本关结算（用时 / 击杀 / 灵石 / 秘卷）。下一关还没做，先按 R 重开</summary>
        public void CompleteStage(string next = null)
        {
            if (complete) return;
            complete = true;
            GameAudio.Play("victory");
            GameAudio.SetMusic("calm");
            float t = Time.time - startTime;
            int scrolls = 0;
            if (LootDirector.Instance)
                foreach (var v in LootDirector.Instance.scrolls.All.Values) scrolls += v;
            var run = RunState.Current;
            if (run != null) run.stagesCleared++;
            if (Stage != null) GameEvents.RaiseStageCleared(Stage);
            SetModal(true, GameState.Summary);
            GameUI.ClearMessages();
            GameUI.SetPrompt(null);
            var nextStage = RunPlan.Next(Stage);
            string nextText = nextStage != null ? nextStage.Label : next;
            string tail = Stage != null && RunPlan.IsFinal(Stage) ? "全部关卡完成 · 按 R 重新开始"
                : string.IsNullOrEmpty(nextText) ? "按 R 重新开始" : $"下一关 {nextText} 制作中 · 按 R 重新开始";
            GameUI.SetCenterText($"<color=#ffd98a>{StageTitle} · 完成</color>\n" +
                                 $"<size=34><color=#ffffff>用时 {(int)t / 60}:{(int)t % 60:00}　击杀 {Kills}　灵石 {run?.coins ?? 0}　秘卷 {scrolls} 卷</color></size>\n" +
                                 $"<size=28><color=#e8e0d0>{tail}</color></size>");
        }

        public bool Completed => complete;

        /// <summary>重开本关：新开一局（灵石、击杀清零），重新加载场景</summary>
        public void Restart()
        {
            deathSlowMo = null;
            TimeScaleArbiter.Clear();
            GameStateMachine.Clear();
            RunState.Current = null;
            SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
        }
    }
}
