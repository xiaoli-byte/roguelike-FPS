using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>修饰器优先级（数值小的先求值）：先乘倍率，最后才看「最终伤害」（免死、封顶类）</summary>
    public static class ModifierPriority
    {
        /// <summary>普通倍率（增伤、减伤）</summary>
        public const int Multiplier = 0;
        /// <summary>看最终数值的修饰器（绝处逢生：致命伤返回 0 免死）：排在所有倍率之后</summary>
        public const int FinalAmount = 100;
    }

    /// <summary>
    /// 怎么调用一个修饰器：由求值方实现成 struct（带上本次的上下文），<see cref="ModifierList{T}.Apply{TCall}"/> 逐个调用。
    /// current = 前面的修饰器乘完之后的当前值。返回倍率。
    /// </summary>
    public interface IModifierCall<in T> where T : Delegate
    {
        float Invoke(T fn, float current);
    }

    /// <summary>
    /// 修饰器列表（伤害乘区、受伤修饰…）：
    ///   · Add 返回句柄，Dispose 即撤销（可重复调用），不用自己记着 Remove；
    ///   · 按优先级升序求值，同优先级按登记顺序；
    ///   · 写时复制：求值期间增删修饰器不影响本次求值（不会抛「集合已修改」）；
    ///   · 异常隔离：某个修饰器抛异常时本次按 ×1 处理并报一次错，不打断伤害结算；
    ///   · 结果夹到有限且 ≥ 0：返回 NaN / 无穷的修饰器忽略，负数按 0。
    /// </summary>
    public sealed class ModifierList<T> where T : Delegate
    {
        sealed class Handle : IDisposable
        {
            public ModifierList<T> owner;
            public T fn;
            public int priority;
            public bool reported;

            public void Dispose()
            {
                var o = owner;
                owner = null;
                o?.Detach(this);
            }
        }

        Handle[] items = Array.Empty<Handle>();

        public int Count => items.Length;

        /// <summary>登记修饰器；返回的句柄 Dispose 即撤销</summary>
        public IDisposable Add(T fn, int priority = ModifierPriority.Multiplier)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            var h = new Handle { owner = this, fn = fn, priority = priority };
            var a = items;
            // 插到第一个优先级更大的前面：同优先级保持登记顺序
            int at = a.Length;
            for (int i = 0; i < a.Length; i++)
                if (a[i].priority > priority)
                {
                    at = i;
                    break;
                }
            var n = new Handle[a.Length + 1];
            Array.Copy(a, 0, n, 0, at);
            n[at] = h;
            Array.Copy(a, at, n, at + 1, a.Length - at);
            items = n;
            return h;
        }

        /// <summary>按委托撤销最早登记的那一条（兼容旧的 List.Remove 用法）；没有返回 false</summary>
        public bool Remove(T fn)
        {
            if (fn == null) return false;
            foreach (var h in items)
                if (h.fn.Equals(fn))
                {
                    h.Dispose();
                    return true;
                }
            return false;
        }

        public void Clear()
        {
            foreach (var h in items) h.owner = null;
            items = Array.Empty<Handle>();
        }

        void Detach(Handle h)
        {
            var a = items;
            int i = Array.IndexOf(a, h);
            if (i < 0) return;
            var n = new Handle[a.Length - 1];
            Array.Copy(a, 0, n, 0, i);
            Array.Copy(a, i + 1, n, i, a.Length - i - 1);
            items = n;
        }

        /// <summary>
        /// 依次求值：value ×= 修饰器返回的倍率。stopAtZero 时乘到 0 就停（后面的修饰器不再调用）。
        /// 返回值有限且 ≥ 0。
        /// </summary>
        public float Apply<TCall>(float value, ref TCall call, bool stopAtZero = false) where TCall : struct, IModifierCall<T>
        {
            var a = items;
            for (int i = 0; i < a.Length; i++)
            {
                var h = a[i];
                float f;
                try
                {
                    f = call.Invoke(h.fn, value);
                }
                catch (Exception e)
                {
                    if (!h.reported)
                    {
                        h.reported = true;
                        Debug.LogException(e);
                    }
                    continue;
                }
                if (float.IsNaN(f) || float.IsInfinity(f)) continue;
                value *= f > 0 ? f : 0;
                if (stopAtZero && value <= 0) return 0;
            }
            if (float.IsNaN(value) || value < 0) return 0;
            return float.IsPositiveInfinity(value) ? float.MaxValue : value;
        }
    }
}
