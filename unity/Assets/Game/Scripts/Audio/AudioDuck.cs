using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 压低（F5；Three.js AudioSystem 的 duck）：跟着 <see cref="GameEvents.StateChanged"/> 切混音快照——
    ///   暂停 / 模态（秘卷三选一、商店…）→ Paused：World 总线（音效 + 音乐 + 环境）压到 0.45，并低通到 6 kHz（世界发闷，按钮音不受影响）；
    ///   结算 → Summary：压到 0.8；其余（游玩、菜单、过场）→ Gameplay。
    /// Three.js 只压音乐；这里压整条 World 总线：暂停时风声 / 正在响的爆炸尾音也跟着退后，界面音单独在 UI 总线上保持原样。
    /// 过渡 0.3 s（同 Three.js 时间常数 0.25 s 的观感），混音台用不缩放时间，暂停时照样过渡。
    /// </summary>
    public static class AudioDuck
    {
        public const float PausedDuck = 0.45f, SummaryDuck = 0.8f, TransitionSeconds = 0.3f;

        /// <summary>当前快照名</summary>
        public static string Current { get; private set; } = AudioMix.SnapshotGameplay;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Current = AudioMix.SnapshotGameplay;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot()
        {
            GameEvents.StateChanged -= OnState;
            GameEvents.StateChanged += OnState;
            SceneManager.sceneLoaded -= OnLoaded;
            SceneManager.sceneLoaded += OnLoaded;
            Apply(SnapshotFor(GameStateMachine.Current), 0);
        }

        static void OnState(GameState s) => Apply(SnapshotFor(s), TransitionSeconds);

        static void OnLoaded(Scene s, LoadSceneMode m) => Apply(SnapshotFor(GameStateMachine.Current), 0);

        /// <summary>状态 → World 总线的线性音量（同 Three.js：暂停 / 模态 0.45，结算 0.8）</summary>
        public static float DuckFor(GameState s) => s switch
        {
            GameState.Paused or GameState.Modal => PausedDuck,
            GameState.Summary => SummaryDuck,
            _ => 1f,
        };

        /// <summary>状态 → 快照名</summary>
        public static string SnapshotFor(GameState s) => s switch
        {
            GameState.Paused or GameState.Modal => AudioMix.SnapshotPaused,
            GameState.Summary => AudioMix.SnapshotSummary,
            _ => AudioMix.SnapshotGameplay,
        };

        /// <summary>切到某个快照（seconds = 过渡时间）</summary>
        public static void Apply(string snapshot, float seconds)
        {
            Current = snapshot;
            if (!Application.isPlaying) return;
            var m = AudioMix.Mixer;
            var snap = m ? m.FindSnapshot(snapshot) : null;
            if (snap) snap.TransitionTo(Mathf.Max(0, seconds));
        }
    }
}
