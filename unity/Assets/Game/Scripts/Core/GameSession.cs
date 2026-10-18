using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一局的会话状态（切片版）：关卡标题、阵亡后 R 重开、Esc 暂停（释放鼠标、时间停止，再点画面继续）、模态界面。
    /// 之后接关卡流程（1-1 → 1-2 …）、局外进度时从这里扩展。
    /// </summary>
    public sealed class GameSession : MonoBehaviour
    {
        public static GameSession Instance { get; private set; }

        public string stageTitle = "1-1 · 古道穿越戈壁";
        public PlayerVitals player;
        public PlayerMotor motor;
        public Hud hud;
        public int Kills { get; private set; }

        bool paused, modal, complete;
        float startTime;

        void Awake()
        {
            Instance = this;
            Time.timeScale = 1;
            // 物理必须自动模拟：否则布娃娃不动、移动中的敌人碰撞体留在原地（射线打不到它现在的位置）
            if (Physics.simulationMode != SimulationMode.FixedUpdate) Physics.simulationMode = SimulationMode.FixedUpdate;
            startTime = Time.time;
        }

        void Start()
        {
            hud?.SetStage(stageTitle);
            hud?.Banner(stageTitle.Replace(" · ", "\n"), 3f);
            if (player) player.Died += OnDied;
            Combat.EnemyKilled += OnKilled;
        }

        void OnDestroy()
        {
            Combat.EnemyKilled -= OnKilled;
            if (Instance == this) Instance = null;
        }

        void OnKilled(Damageable d, DamageInfo info)
        {
            if (d.noReward) return;
            Kills++;
        }

        void OnDied()
        {
            Time.timeScale = 0.3f;
            hud?.ShowDeath("阵 亡\n<size=34>按 R 重新开始</size>");
            Cursor.lockState = CursorLockMode.None;
        }

        void Update()
        {
            var kb = Keyboard.current;
            if (kb == null) return;
            if (complete)
            {
                if (kb.rKey.wasPressedThisFrame) Restart();
                return;
            }
            if (player && player.Dead)
            {
                Time.timeScale = Mathf.MoveTowards(Time.timeScale, 0.3f, Time.unscaledDeltaTime);
                if (kb.rKey.wasPressedThisFrame) Restart();
                return;
            }
            if (modal) return;
            if (kb.escapeKey.wasPressedThisFrame) SetPaused(!paused);
            if (paused && Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame) SetPaused(false);
        }

        void SetPaused(bool p)
        {
            paused = p;
            Time.timeScale = p ? 0 : 1;
            if (motor) motor.inputEnabled = !p;
            Cursor.lockState = p ? CursorLockMode.None : CursorLockMode.Locked;
            hud?.ShowDeath(p ? "暂 停\n<size=34>点击画面继续</size>" : "");
        }

        /// <summary>模态界面（秘卷三选一…）：停时间、放开鼠标、屏蔽玩家输入；Esc 暂停在模态期间不响应</summary>
        public void SetModal(bool on)
        {
            modal = on;
            Time.timeScale = on ? 0 : 1;
            if (motor) motor.inputEnabled = !on && !(player && player.Dead);
            Cursor.lockState = on ? CursorLockMode.None : CursorLockMode.Locked;
        }

        /// <summary>关卡完成：停时间、显示本关结算（用时 / 击杀 / 灵石 / 秘卷）。下一关还没做，先按 R 重开</summary>
        public void CompleteStage(string next)
        {
            if (complete) return;
            complete = true;
            float t = Time.time - startTime;
            int scrolls = 0;
            if (LootDirector.Instance)
                foreach (var v in LootDirector.Instance.scrolls.All.Values) scrolls += v;
            SetModal(true);
            hud?.ClearMessages();
            hud?.SetPrompt(null);
            hud?.ShowDeath($"<color=#ffd98a>{stageTitle} · 完成</color>\n" +
                           $"<size=34><color=#ffffff>用时 {(int)t / 60}:{(int)t % 60:00}　击杀 {Kills}　灵石 {(hud ? hud.coins : 0)}　秘卷 {scrolls} 卷</color></size>\n" +
                           $"<size=28><color=#e8e0d0>下一关 {next} 制作中 · 按 R 重新开始</color></size>");
        }

        public bool Completed => complete;

        public void Restart()
        {
            Time.timeScale = 1;
            SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
        }
    }
}
