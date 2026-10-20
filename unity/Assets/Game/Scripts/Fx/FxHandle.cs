using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 特效对象池里的一格（一次 Fx 调用、一条光束、一道闪电、一盏闪光灯…）。
    /// 每次被新特效占用世代号 +1，旧句柄随之失效：槽位被复用、已经播完、换关清场之后再调用旧句柄都是空操作。
    /// </summary>
    internal interface IFxSlot
    {
        int Generation { get; }
        bool IsActive { get; }
        /// <summary>提前结束：停止后续发射，已有的部分约 0.1 s 内淡出</summary>
        void CancelFx();
        /// <summary>改两端点（光束、闪电、曳光）；其它特效忽略</summary>
        void RetargetFx(Vector3 from, Vector3 to);
        /// <summary>挪位置（持续发射的特效、闪光灯）；其它特效忽略</summary>
        void MoveFx(Vector3 position);
    }

    /// <summary>纯 C# 槽位的公共实现（MonoBehaviour 槽位直接实现 <see cref="IFxSlot"/>）</summary>
    internal abstract class FxSlot : IFxSlot
    {
        internal int gen;
        internal bool active;

        public int Generation => gen;
        public bool IsActive => active;

        /// <summary>占用槽位：世代号 +1，之前发出去的句柄全部失效</summary>
        internal void Claim()
        {
            gen++;
            active = true;
        }

        public abstract void CancelFx();
        public virtual void RetargetFx(Vector3 from, Vector3 to) { }
        public virtual void MoveFx(Vector3 position) { }
    }

    /// <summary>
    /// 特效句柄（值类型，零分配）：<see cref="Fx"/> 的每个入口都返回一个。
    /// 用来提前取消（攻击被打断、技能结束）、改光束两端点、挪持续特效；不需要时直接丢掉即可，特效播完自己回收。
    /// </summary>
    public readonly struct FxHandle
    {
        readonly IFxSlot slot;
        readonly int gen;

        internal FxHandle(IFxSlot slot)
        {
            this.slot = slot;
            gen = slot?.Generation ?? 0;
        }

        /// <summary>什么都没生成（参数非法、编辑器非 Play、特效被画质关掉）时返回的句柄</summary>
        public static FxHandle None => default;

        /// <summary>这一次生成的特效还在播（槽位没被复用、没播完、没被取消）</summary>
        public bool Alive => slot != null && slot.Generation == gen && slot.IsActive;

        /// <summary>提前结束：停止后续发射，已经飞出去的粒子 / 光 / 线约 0.1 s 内淡出。重复调用、迟到调用都安全</summary>
        public void Cancel()
        {
            if (Alive) slot.CancelFx();
        }

        /// <summary>改两端点（光束、闪电、曳光每帧跟随枪口 / 目标）</summary>
        public void Retarget(Vector3 from, Vector3 to)
        {
            if (Alive) slot.RetargetFx(from, to);
        }

        /// <summary>挪到新位置（闪光灯、持续发射的特效跟随目标）</summary>
        public void MoveTo(Vector3 position)
        {
            if (Alive) slot.MoveFx(position);
        }
    }
}
