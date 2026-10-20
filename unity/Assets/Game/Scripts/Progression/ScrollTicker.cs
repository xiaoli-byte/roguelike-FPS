using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷的时钟与常驻任务（Three.js 版 ctx.time.now + ctx.tasks 里秘卷用的那部分）：
    ///   · 时钟 <see cref="Now"/>：Play 模式下就是 Time.time（游戏时间：暂停、三选一等模态把时间停掉时不走）；
    ///     Play 之外（EditMode 测试、编辑器工具）是手动时钟，只由 <see cref="Step"/> 推进。
    ///   · 任务：逐帧（<see cref="EveryFrame"/>）、每隔 N 秒（<see cref="Every"/>）、延时一次（<see cref="After"/>）。
    ///     跨关保留（同 TS「常驻任务」），返回句柄 Dispose 即取消；<see cref="ScrollScope"/> 卸载时统一取消。
    ///   · 驱动：Play 模式下第一次登记任务时自动建一个 DontDestroyOnLoad 的驱动物体，每帧 Step(Time.deltaTime)（同一帧只走一次）；
    ///     测试里直接调 <see cref="Step"/>。
    /// 写时复制：任务里增删任务不影响本次遍历；某个任务抛异常只报一次错，其余照常。
    /// </summary>
    public static class ScrollTicker
    {
        sealed class Entry : IDisposable
        {
            public Action<float> perFrame;
            public Action action;
            public float interval, next;
            public bool once, dead, reported;

            public void Dispose()
            {
                if (dead) return;
                dead = true;
                Detach(this);
            }
        }

        static Entry[] entries = Array.Empty<Entry>();
        static float manualNow;
        static int lastFrame = -1;
        static ScrollTickerRunner runner;

        /// <summary>秘卷时钟（秒）：Play 模式 = Time.time，否则 = 手动时钟</summary>
        public static float Now => Application.isPlaying ? Time.time : manualNow;

        /// <summary>当前登记着的任务数（测试：卸载后应回到原数）</summary>
        public static int TaskCount => entries.Length;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            foreach (var e in entries) e.dead = true;
            entries = Array.Empty<Entry>();
            manualNow = 0;
            lastFrame = -1;
            runner = null;
        }

        /// <summary>测试用：清掉全部任务、手动时钟归零</summary>
        public static void ResetForTests() => ResetStatics();

        /// <summary>每帧调用 fn(dt)（dt = 游戏时间步长，模态期间为 0 帧不调用）</summary>
        public static IDisposable EveryFrame(Action<float> fn)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            return Attach(new Entry { perFrame = fn });
        }

        /// <summary>每隔 interval 秒调用一次（第一次在 interval 秒之后）</summary>
        public static IDisposable Every(float interval, Action fn)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            interval = Mathf.Max(0.01f, interval);
            return Attach(new Entry { action = fn, interval = interval, next = Now + interval });
        }

        /// <summary>delay 秒后调用一次（之前 Dispose 则取消）</summary>
        public static IDisposable After(float delay, Action fn)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            return Attach(new Entry { action = fn, once = true, next = Now + Mathf.Max(0, delay) });
        }

        /// <summary>
        /// 推进 dt 秒：Play 之外先把手动时钟加上 dt；然后跑一遍到点的任务。
        /// 每隔类任务一次最多补跑 4 次（掉帧时不雪崩），之后从现在重新计时。
        /// </summary>
        public static void Step(float dt)
        {
            if (!Application.isPlaying) manualNow += Mathf.Max(0, dt);
            float now = Now;
            var list = entries;
            for (int i = 0; i < list.Length; i++)
            {
                var e = list[i];
                if (e.dead) continue;
                try
                {
                    if (e.perFrame != null)
                    {
                        if (dt > 0) e.perFrame(dt);
                        continue;
                    }
                    if (now < e.next) continue;
                    if (e.once)
                    {
                        e.Dispose();
                        e.action();
                        continue;
                    }
                    int guard = 0;
                    while (!e.dead && now >= e.next && guard++ < 4)
                    {
                        e.next += e.interval;
                        e.action();
                    }
                    if (now >= e.next) e.next = now + e.interval;
                }
                catch (Exception ex)
                {
                    if (e.reported) continue;
                    e.reported = true;
                    Debug.LogException(ex);
                }
            }
        }

        /// <summary>驱动物体每帧调用：同一帧只走一次</summary>
        internal static void StepFrame()
        {
            if (lastFrame == Time.frameCount) return;
            lastFrame = Time.frameCount;
            Step(Time.deltaTime);
        }

        static IDisposable Attach(Entry e)
        {
            var a = entries;
            var n = new Entry[a.Length + 1];
            Array.Copy(a, n, a.Length);
            n[a.Length] = e;
            entries = n;
            EnsureRunner();
            return e;
        }

        static void Detach(Entry e)
        {
            var a = entries;
            int i = Array.IndexOf(a, e);
            if (i < 0) return;
            var n = new Entry[a.Length - 1];
            Array.Copy(a, 0, n, 0, i);
            Array.Copy(a, i + 1, n, i, a.Length - i - 1);
            entries = n;
        }

        static void EnsureRunner()
        {
            if (!Application.isPlaying || runner) return;
            var go = new GameObject("Scroll Ticker");
            UnityEngine.Object.DontDestroyOnLoad(go);
            runner = go.AddComponent<ScrollTickerRunner>();
        }
    }

    /// <summary><see cref="ScrollTicker"/> 的驱动（自动生成，DontDestroyOnLoad）</summary>
    [AddComponentMenu("")]
    public sealed class ScrollTickerRunner : MonoBehaviour
    {
        void Update() => ScrollTicker.StepFrame();
    }
}
