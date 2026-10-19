using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>游戏状态（docs/unity-parity.md 4.7）：底层状态 + 叠在上面的模态栈，栈顶就是当前状态</summary>
    public enum GameState
    {
        /// <summary>刚启动，还没进菜单或关卡</summary>
        Boot,
        /// <summary>主菜单 / 选英雄（U5 / U6）</summary>
        Menu,
        /// <summary>关卡里正常游玩</summary>
        Playing,
        /// <summary>暂停菜单（模态栈）</summary>
        Paused,
        /// <summary>模态界面：秘卷三选一、商店…（模态栈）</summary>
        Modal,
        /// <summary>换场景（L1 的淡入淡出 + 异步加载）</summary>
        Transition,
        /// <summary>结算：本关完成 / 整局结束</summary>
        Summary,
    }

    /// <summary>
    /// 状态机：一个底层状态（<see cref="SetBase"/>：Boot / Menu / Playing / Transition / Summary）+ 模态栈（<see cref="Push"/> / <see cref="Pop"/>）。
    /// 每个栈项有一个 owner（谁打开的谁关），默认同时向 <see cref="TimeScaleArbiter"/> 申请停住时间（暂停用 Pause 优先级，其余用 Modal 优先级），
    /// 弹出时撤销——所以「秘卷三选一叠在暂停菜单上，选完之后时间仍然停着」是自然成立的。
    /// 当前状态变化时发 <see cref="GameEvents.StateChanged"/>。光标 / 玩家输入由 <see cref="GameSession"/> 跟着状态走。
    /// </summary>
    public static class GameStateMachine
    {
        sealed class Entry
        {
            public object owner;
            public GameState state;
            public TimeScaleArbiter.Handle time;
        }

        static GameState baseState = GameState.Boot;
        static readonly List<Entry> stack = new();

        /// <summary>当前状态：模态栈顶，栈空时是底层状态</summary>
        public static GameState Current => stack.Count > 0 ? stack[stack.Count - 1].state : baseState;
        /// <summary>底层状态（不含模态）</summary>
        public static GameState Base => baseState;
        /// <summary>模态栈深度</summary>
        public static int Depth => stack.Count;
        /// <summary>有模态（暂停 / 模态界面 / 结算面板）挡在游戏上面</summary>
        public static bool Blocked => stack.Count > 0;
        /// <summary>正在正常游玩（底层是 Playing 且没有模态）</summary>
        public static bool IsPlaying => stack.Count == 0 && baseState == GameState.Playing;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            baseState = GameState.Boot;
            stack.Clear();
        }

        /// <summary>切底层状态</summary>
        public static void SetBase(GameState state)
        {
            var prev = Current;
            baseState = state;
            Notify(prev);
        }

        /// <summary>
        /// 压一个模态（owner 已经在栈里时先把它旧的那一项拿掉，再压到栈顶）。
        /// freezeTime：同时停住时间（Paused 用暂停优先级，其余用模态优先级）
        /// </summary>
        public static void Push(object owner, GameState state = GameState.Modal, bool freezeTime = true)
        {
            var prev = Current;
            Remove(owner);
            var e = new Entry { owner = owner, state = state };
            stack.Add(e);
            if (freezeTime)
                e.time = TimeScaleArbiter.Request(owner, 0, state == GameState.Paused ? TimeScaleArbiter.Priority.Pause : TimeScaleArbiter.Priority.Modal);
            Notify(prev);
        }

        /// <summary>弹出 owner 的模态（不必在栈顶）；没有则返回 false</summary>
        public static bool Pop(object owner)
        {
            var prev = Current;
            if (!Remove(owner)) return false;
            Notify(prev);
            return true;
        }

        /// <summary>owner 的模态在不在栈里</summary>
        public static bool Contains(object owner)
        {
            foreach (var e in stack)
                if (ReferenceEquals(e.owner, owner)) return true;
            return false;
        }

        /// <summary>清空模态栈（撤销它们的时间请求），底层回到 Boot。重开 / 换关时调用</summary>
        public static void Clear()
        {
            var prev = Current;
            foreach (var e in stack) e.time?.Dispose();
            stack.Clear();
            baseState = GameState.Boot;
            Notify(prev);
        }

        static bool Remove(object owner)
        {
            for (int i = stack.Count - 1; i >= 0; i--)
            {
                if (!ReferenceEquals(stack[i].owner, owner)) continue;
                stack[i].time?.Dispose();
                stack.RemoveAt(i);
                return true;
            }
            return false;
        }

        static void Notify(GameState prev)
        {
            var now = Current;
            if (now != prev) GameEvents.RaiseStateChanged(now);
        }
    }
}
