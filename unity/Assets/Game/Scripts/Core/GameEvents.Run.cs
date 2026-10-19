using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>GameEvents 的局 / 关卡 / 状态部分（W0-5）：分文件写，各单元并行追加事件时不在同一处冲突</summary>
    public static partial class GameEvents
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetRunStatics()
        {
            stateChanged.Clear();
            runStarted.Clear();
            stageLoaded.Clear();
            stageCleared.Clear();
        }

        static readonly EventChannel<Action<GameState>> stateChanged = new();
        static readonly EventChannel<Action<RunState>> runStarted = new();
        static readonly EventChannel<Action<StageSpec>> stageLoaded = new();
        static readonly EventChannel<Action<StageSpec>> stageCleared = new();

        /// <summary>当前游戏状态变了（模态栈顶或底层状态，见 <see cref="GameStateMachine"/>）</summary>
        public static event Action<GameState> StateChanged { add => stateChanged.Add(value); remove => stateChanged.Remove(value); }
        /// <summary>开了一局（新局或调试局）</summary>
        public static event Action<RunState> RunStarted { add => runStarted.Add(value); remove => runStarted.Remove(value); }
        /// <summary>关卡就绪（玩家已经在场景里，GameSession.Start）</summary>
        public static event Action<StageSpec> StageLoaded { add => stageLoaded.Add(value); remove => stageLoaded.Remove(value); }
        /// <summary>本关完成（进入出口 / 首领倒下，结算面板弹出之前）</summary>
        public static event Action<StageSpec> StageCleared { add => stageCleared.Add(value); remove => stageCleared.Remove(value); }

        public static void RaiseStateChanged(GameState s) => stateChanged.Raise(s);
        public static void RaiseRunStarted(RunState s) => runStarted.Raise(s);
        public static void RaiseStageLoaded(StageSpec s) => stageLoaded.Raise(s);
        public static void RaiseStageCleared(StageSpec s) => stageCleared.Raise(s);
    }
}
