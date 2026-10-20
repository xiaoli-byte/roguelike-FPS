using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 按时刻排队的一次性任务（纯逻辑，EditMode 可测）：<see cref="Run"/> 按 (时刻, 登记顺序) 依次执行到点的任务；
    /// 任务里新登记的、时刻已到的同一次 Run 里接着执行（连环爆：前一只炸完马上安排下一只）。单个任务抛异常只报错，不影响其余。
    /// </summary>
    public sealed class DelayQueue
    {
        struct Item
        {
            public float at;
            public long seq;
            public Action fn;
        }

        readonly List<Item> items = new();
        long seq;

        /// <summary>一次 Run 最多执行多少个（防止任务互相在「现在」登记造成死循环）</summary>
        public const int MaxPerRun = 4096;

        public int Count => items.Count;

        public void Add(float at, Action fn)
        {
            if (fn == null) return;
            items.Add(new Item { at = float.IsFinite(at) ? at : 0, seq = seq++, fn = fn });
        }

        /// <summary>执行所有 at ≤ now 的任务（先早后晚，同一时刻按登记顺序），返回执行个数</summary>
        public int Run(float now)
        {
            int ran = 0;
            while (ran < MaxPerRun)
            {
                int best = -1;
                for (int i = 0; i < items.Count; i++)
                {
                    var it = items[i];
                    if (it.at > now) continue;
                    if (best < 0 || it.at < items[best].at || (it.at == items[best].at && it.seq < items[best].seq)) best = i;
                }
                if (best < 0) break;
                var fn = items[best].fn;
                items.RemoveAt(best);
                ran++;
                try
                {
                    fn();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            return ran;
        }

        public void Clear() => items.Clear();
    }

    /// <summary>
    /// 危险物的时钟与延时任务（Three.js ctx.tasks.delay 的危险物用法：连环爆的结算延后、逐只引爆）：
    ///   Play 模式下时钟 = Time.time（游戏时间：暂停、顿帧时不走），第一次登记任务时在当前场景里建一个驱动物体，每帧执行到点的任务；
    ///   驱动物体随场景卸载销毁时清空队列（换关不把上一关的连锁带过去）。
    ///   Play 之外（EditMode 测试）是手动时钟，只由 <see cref="Step"/> 推进。
    /// </summary>
    public static class HazardClock
    {
        static readonly DelayQueue queue = new();
        static float manualNow;
        static HazardClockRunner runner;

        /// <summary>危险物时钟（秒）</summary>
        public static float Now => Application.isPlaying ? Time.time : manualNow;

        /// <summary>排队中的任务数</summary>
        public static int Pending => queue.Count;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            queue.Clear();
            manualNow = 0;
            runner = null;
        }

        /// <summary>测试用：清掉全部任务、手动时钟归零</summary>
        public static void ResetForTests() => ResetStatics();

        /// <summary>seconds 秒后执行一次 fn</summary>
        public static void Delay(float seconds, Action fn)
        {
            if (fn == null) return;
            queue.Add(Now + Mathf.Max(0, float.IsFinite(seconds) ? seconds : 0), fn);
            EnsureRunner();
        }

        /// <summary>推进：Play 之外先把手动时钟加上 dt；然后执行到点的任务</summary>
        public static void Step(float dt)
        {
            if (!Application.isPlaying) manualNow += Mathf.Max(0, dt);
            queue.Run(Now);
        }

        /// <summary>丢掉全部排队的任务</summary>
        public static void Clear() => queue.Clear();

        internal static void RunnerGone(HazardClockRunner r)
        {
            if (runner != r) return;
            runner = null;
            queue.Clear();
        }

        static void EnsureRunner()
        {
            if (!Application.isPlaying || runner) return;
            runner = new GameObject("Hazard Clock").AddComponent<HazardClockRunner>();
        }
    }

    /// <summary><see cref="HazardClock"/> 的驱动（自动生成，跟着场景走）</summary>
    [AddComponentMenu("")]
    public sealed class HazardClockRunner : MonoBehaviour
    {
        void Update() => HazardClock.Step(Time.deltaTime);

        void OnDestroy() => HazardClock.RunnerGone(this);
    }
}
