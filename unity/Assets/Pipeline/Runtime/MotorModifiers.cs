using System;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>运动锁：修饰器可以按位锁住移动输入、跳跃、冲刺、视角（硬直、下沉、过场）</summary>
    [Flags]
    public enum MotorLock
    {
        None = 0,
        Move = 1 << 0,
        Jump = 1 << 1,
        Dash = 1 << 2,
        Look = 1 << 3,
        /// <summary>移动 + 跳跃 + 冲刺（视角照常）</summary>
        Body = Move | Jump | Dash,
        All = Move | Jump | Dash | Look,
    }

    /// <summary>
    /// 本帧的运动参数：PlayerMotor 每帧先填上缺省值与上下文，再交给修饰器栈逐个改写，最后按它积分。
    /// 上下文字段（grounded / velocity / dashing / jumpHeld / jumpPressed / dt）只读，改了也不生效。
    /// </summary>
    public struct MotorFrame
    {
        // ── 上下文（只读）──
        /// <summary>上一帧结束时站在可走的地面上</summary>
        public bool grounded;
        /// <summary>帧初速度</summary>
        public Vector3 velocity;
        public bool dashing, jumpHeld, jumpPressed;
        public float dt;

        // ── 可改写的参数 ──
        /// <summary>走路最高速倍率（相乘：寒意、机炮预热、技能加速）；不影响冲刺</summary>
        public float speedMult;
        /// <summary>重力倍率（滑翔 0.3、砸地加重）</summary>
        public float gravityScale;
        /// <summary>下落速度上限（m/s，正数；缺省 42）</summary>
        public float maxFallSpeed;
        /// <summary>已经比上限下落得更快时怎么收：0 = 直接截断；&gt; 0 = 按这个速率指数趋近（滑翔开伞时平滑刹住）</summary>
        public float fallBrake;
        /// <summary>空中控制加速度（m/s²，缺省 20；滑翔 26）</summary>
        public float airAccel;
        /// <summary>地面牵引（相乘，缺省 1；冰面 0.15 左右）：地面加速度倍率。≤ 0 视为没设（按 1）</summary>
        public float groundAccelMult;
        /// <summary>地面牵引（相乘，缺省 1；冰面 0.1 左右）：地面刹车、超速回落、击退摩擦的倍率——越小冲刺余速滑得越远。≤ 0 视为没设（按 1）</summary>
        public float groundFrictionMult;
        public MotorLock locks;

        /// <summary>缺省参数（不含上下文）</summary>
        public static MotorFrame Neutral(in MotorTuning t) => new()
        {
            speedMult = 1, gravityScale = 1, maxFallSpeed = t.maxFallSpeed, fallBrake = 0, airAccel = t.airAccel,
            groundAccelMult = 1, groundFrictionMult = 1, locks = MotorLock.None,
        };

        public bool Locked(MotorLock l) => (locks & l) != 0;

        /// <summary>修饰器写出 NaN / 负数时兜底：倍率夹到 [0, 10]，重力 ≥ 0，下落上限 &gt; 0</summary>
        public void Sanitize(in MotorTuning t)
        {
            speedMult = float.IsFinite(speedMult) ? Mathf.Clamp(speedMult, 0, 10) : 1;
            gravityScale = float.IsFinite(gravityScale) ? Mathf.Clamp(gravityScale, 0, 10) : 1;
            maxFallSpeed = float.IsFinite(maxFallSpeed) && maxFallSpeed > 0.1f ? maxFallSpeed : t.maxFallSpeed;
            fallBrake = float.IsFinite(fallBrake) ? Mathf.Max(0, fallBrake) : 0;
            airAccel = float.IsFinite(airAccel) ? Mathf.Max(0, airAccel) : t.airAccel;
            groundAccelMult = Traction(groundAccelMult);
            groundFrictionMult = Traction(groundFrictionMult);
        }

        /// <summary>牵引倍率兜底：没设 / 非法 → 1，其余夹到 [0.02, 10]（不让地面完全失去控制）</summary>
        public static float Traction(float m) => float.IsFinite(m) && m > 0 ? Mathf.Clamp(m, 0.02f, 10f) : 1f;
    }

    /// <summary>运动修饰器：每帧改写一次 <see cref="MotorFrame"/>（读上下文决定生不生效，例如滑翔只在下落且按住跳时）</summary>
    public interface IMotorModifier
    {
        void Modify(ref MotorFrame f);
    }

    public delegate void MotorModify(ref MotorFrame f);

    /// <summary>
    /// 运动修饰器栈（Three.js 版散落在 PlayerController 里的 flags.glide、寒意写 moveSpeed、技能直接改速度，这里统一成一个栈）：
    ///   · Add 返回句柄，Dispose 即撤销（可重复调用）；可以带时长，到点自动撤销；
    ///   · 按优先级升序求值，同优先级按登记顺序（倍率相乘与顺序无关；「覆盖」类的修饰器用更大的优先级排在后面）；
    ///   · 写时复制：求值期间增删不影响本次；某个修饰器抛异常时跳过它并只报一次错。
    /// 纯 C#，不依赖组件：EditMode 测试直接 new。
    /// </summary>
    public sealed class MotorModifierStack
    {
        sealed class Entry : IDisposable
        {
            public MotorModifierStack owner;
            public IMotorModifier mod;
            public int priority;
            /// <summary>到这个时刻自动撤销（+∞ = 不限时）</summary>
            public float until;
            public bool reported;

            public void Dispose()
            {
                var o = owner;
                owner = null;
                o?.Detach(this);
            }
        }

        Entry[] items = Array.Empty<Entry>();

        public int Count => items.Length;

        /// <summary>登记修饰器（不限时）；返回的句柄 Dispose 即撤销</summary>
        public IDisposable Add(IMotorModifier mod, int priority = 0) => Add(mod, priority, float.PositiveInfinity);

        /// <summary>登记修饰器，在时刻 until（与 <see cref="Apply"/> 传入的 now 同一时钟）自动撤销</summary>
        public IDisposable Add(IMotorModifier mod, int priority, float until)
        {
            if (mod == null) throw new ArgumentNullException(nameof(mod));
            var e = new Entry { owner = this, mod = mod, priority = priority, until = float.IsNaN(until) ? float.PositiveInfinity : until };
            var a = items;
            int at = a.Length;
            for (int i = 0; i < a.Length; i++)
                if (a[i].priority > priority)
                {
                    at = i;
                    break;
                }
            var n = new Entry[a.Length + 1];
            Array.Copy(a, 0, n, 0, at);
            n[at] = e;
            Array.Copy(a, at, n, at + 1, a.Length - at);
            items = n;
            return e;
        }

        /// <summary>按顺序改写 f；now 用来淘汰到期的修饰器</summary>
        public void Apply(ref MotorFrame f, float now)
        {
            var a = items;
            for (int i = 0; i < a.Length; i++)
            {
                var e = a[i];
                if (e.owner == null) continue;
                if (now >= e.until)
                {
                    e.Dispose();
                    continue;
                }
                try
                {
                    e.mod.Modify(ref f);
                }
                catch (Exception ex)
                {
                    if (!e.reported)
                    {
                        e.reported = true;
                        Debug.LogException(ex);
                    }
                }
            }
        }

        /// <summary>撤销全部（换英雄 / 重开局）</summary>
        public void Clear()
        {
            var a = items;
            items = Array.Empty<Entry>();
            foreach (var e in a) e.owner = null;
        }

        void Detach(Entry e)
        {
            var a = items;
            int idx = Array.IndexOf(a, e);
            if (idx < 0) return;
            var n = new Entry[a.Length - 1];
            Array.Copy(a, 0, n, 0, idx);
            Array.Copy(a, idx + 1, n, idx, a.Length - idx - 1);
            items = n;
        }
    }

    /// <summary>常用修饰器的工厂</summary>
    public static class MotorMods
    {
        sealed class Fn : IMotorModifier
        {
            readonly MotorModify fn;
            public Fn(MotorModify fn) => this.fn = fn ?? throw new ArgumentNullException(nameof(fn));
            public void Modify(ref MotorFrame f) => fn(ref f);
        }

        sealed class SpeedFn : IMotorModifier
        {
            readonly Func<float> mult;
            public SpeedFn(Func<float> mult) => this.mult = mult ?? throw new ArgumentNullException(nameof(mult));

            public void Modify(ref MotorFrame f)
            {
                float m = mult();
                if (float.IsFinite(m)) f.speedMult *= Mathf.Max(0, m);
            }
        }

        /// <summary>任意改写</summary>
        public static IMotorModifier From(MotorModify fn) => new Fn(fn);

        /// <summary>固定的走路速度倍率</summary>
        public static IMotorModifier Speed(float mult) => new Fn((ref MotorFrame f) => f.speedMult *= Mathf.Max(0, mult));

        /// <summary>每帧求值的走路速度倍率（寒意：读 PlayerStatus.SpeedMult；机炮：读预热进度）</summary>
        public static IMotorModifier Speed(Func<float> mult) => new SpeedFn(mult);

        /// <summary>重力倍率</summary>
        public static IMotorModifier Gravity(float scale) => new Fn((ref MotorFrame f) => f.gravityScale *= Mathf.Max(0, scale));

        /// <summary>锁住部分输入</summary>
        public static IMotorModifier Lock(MotorLock locks) => new Fn((ref MotorFrame f) => f.locks |= locks);
    }
}
