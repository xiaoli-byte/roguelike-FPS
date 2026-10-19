using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 时间缩放仲裁（docs/unity-parity.md 4.7）：<b>全项目只有它写 <see cref="Time.timeScale"/></b>。
    /// 想改时间的地方 <see cref="Request"/> 一个请求（拿到句柄，结束时 Dispose）；同时有多个请求时优先级最高的生效，
    /// 同优先级取最后一个；没有请求 = 1。优先级：暂停 &gt; 模态 &gt; 场景过渡 &gt; 阵亡慢动作 &gt; 顿帧。
    /// 请求和撤销都立刻生效（冒烟测试在 SetPaused 之后下一帧就检查 timeScale）。
    /// 请求方是已销毁的 Unity 对象时，下次结算自动丢掉它的请求（换场景时也结算一次），不会把时间卡死。
    /// </summary>
    public static class TimeScaleArbiter
    {
        /// <summary>优先级（数值大的压过小的）</summary>
        public static class Priority
        {
            public const int HitStop = 100, DeathSlowMo = 200, Transition = 300, Modal = 400, Pause = 500;
        }

        /// <summary>一个时间请求：改 <see cref="Scale"/> 立即重新结算，Dispose 撤销</summary>
        public sealed class Handle : IDisposable
        {
            internal object owner;
            internal float scale;
            internal int priority, seq;
            internal bool live;

            public object Owner => owner;
            public int Priority => priority;
            public bool Live => live;

            public float Scale
            {
                get => scale;
                set
                {
                    value = Sanitize(value);
                    if (scale == value) return;
                    scale = value;
                    if (live) Apply();
                }
            }

            public void Dispose()
            {
                if (!live) return;
                live = false;
                active.Remove(this);
                Apply();
            }
        }

        static readonly List<Handle> active = new();
        static int seq;
        static float applied = 1;

        /// <summary>当前结算出的时间缩放（= Time.timeScale，除非有人绕过仲裁直接写）</summary>
        public static float Current => applied;
        /// <summary>生效中的请求数</summary>
        public static int Count => active.Count;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            active.Clear();
            seq = 0;
            applied = 1;
            SceneManager.sceneLoaded -= OnSceneLoaded;
            SceneManager.sceneLoaded += OnSceneLoaded;
        }

        static void OnSceneLoaded(Scene s, LoadSceneMode m) => Apply();

        /// <summary>申请一个时间缩放（0 = 停住）。owner 只用来调试和 <see cref="ReleaseAll"/>；返回的句柄 Dispose 即撤销</summary>
        public static Handle Request(object owner, float scale, int priority)
        {
            var h = new Handle { owner = owner, scale = Sanitize(scale), priority = priority, seq = ++seq, live = true };
            active.Add(h);
            Apply();
            return h;
        }

        /// <summary>撤销 owner 名下的全部请求</summary>
        public static void ReleaseAll(object owner)
        {
            bool any = false;
            for (int i = active.Count - 1; i >= 0; i--)
            {
                if (!ReferenceEquals(active[i].owner, owner)) continue;
                active[i].live = false;
                active.RemoveAt(i);
                any = true;
            }
            if (any) Apply();
        }

        /// <summary>全部撤销，时间回到 1（重开 / 换关时）</summary>
        public static void Clear()
        {
            foreach (var h in active) h.live = false;
            active.Clear();
            Apply();
        }

        /// <summary>有没有人绕过仲裁直接写了 Time.timeScale（调试检查用）</summary>
        public static bool Tampered => !Mathf.Approximately(Time.timeScale, applied);

        static float Sanitize(float s) => float.IsNaN(s) || s < 0 ? 0 : Mathf.Min(s, 100f);

        static void Apply()
        {
            Handle best = null;
            for (int i = active.Count - 1; i >= 0; i--)
            {
                var h = active[i];
                // 请求方已经销毁（换场景、物体被删）却没撤销：丢掉
                if (h.owner is UnityEngine.Object o && !o)
                {
                    h.live = false;
                    active.RemoveAt(i);
                    continue;
                }
                if (best == null || h.priority > best.priority || (h.priority == best.priority && h.seq > best.seq)) best = h;
            }
            applied = best != null ? best.scale : 1f;
            Time.timeScale = applied;
        }
    }
}
