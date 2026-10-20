using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game
{
    /// <summary>持续效果怎么结束的</summary>
    public enum SkillEnd
    {
        /// <summary>时间到 / 技能自己判定做完了：可以放「结束」效果（收尾冲击波、音效）</summary>
        Natural,
        /// <summary>被打断（阵亡、换关、换英雄、开新局）：只撤销，不放收尾效果</summary>
        Interrupted,
        /// <summary>开始时就失败（OnBegin 返回 false / 抛异常）：撤销已经加上的东西，技能不扣充能</summary>
        Aborted,
    }

    /// <summary>
    /// 效果会话（Three.js skills/common.ts 的 EffectSession）：记下所有撤销动作（属性加成、修饰器、事件订阅、生成的物体），结束时逆序执行。
    /// 撤销动作抛异常只报错，不影响其余撤销。不在会话中时 Track 立即执行撤销（不会漏掉）。技能、被动都可以用。
    /// </summary>
    public sealed class SkillSession
    {
        readonly List<Action> undo = new();
        readonly Action<SkillEnd> onEnd;

        public bool Active { get; private set; }

        /// <summary>onEnd：每次结束（无论原因）在撤销之后调用，用来复位技能内部状态</summary>
        public SkillSession(Action<SkillEnd> onEnd = null) => this.onEnd = onEnd;

        /// <summary>开始（已经在进行的先按 Interrupted 结束）</summary>
        public void Begin()
        {
            End(SkillEnd.Interrupted);
            Active = true;
        }

        public void Track(IDisposable d)
        {
            if (d != null) Track(d.Dispose);
        }

        public void Track(Action undoAction)
        {
            if (undoAction == null) return;
            if (!Active)
            {
                Run(undoAction);
                return;
            }
            undo.Add(undoAction);
        }

        /// <summary>逆序执行全部撤销；不在会话中时无效果</summary>
        public void End(SkillEnd reason = SkillEnd.Natural)
        {
            if (!Active) return;
            Active = false;
            for (int i = undo.Count - 1; i >= 0; i--) Run(undo[i]);
            undo.Clear();
            if (onEnd != null) Run(() => onEnd(reason));
        }

        static void Run(Action a)
        {
            try
            {
                a();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }
    }

    /// <summary>
    /// 持续型技能：duration 秒内生效，期间不能重复释放（<see cref="Skill.Busy"/>），所有加成都登记进撤销栈，结束 / 被打断时逐条干净撤销。
    /// 子类实现 <see cref="OnBegin"/>（加成、特效；返回 false = 放不出来，已登记的撤销立即执行、不扣充能）、
    /// <see cref="OnTick"/>（每帧，在玩家移动之后）、<see cref="OnEnd"/>（收尾；reason 区分自然结束 / 被打断）。
    /// duration ≤ 0 = 不限时，由子类自己 <see cref="End"/>（例如九团火灵都发射完了）。
    /// 撤销栈的便捷方法：<see cref="AddStat"/>（属性来源 skill:&lt;id&gt;）、<see cref="AddMotor"/>、<see cref="AddOutgoing"/>、<see cref="AddIncoming"/>、<see cref="Own"/>、<see cref="Track(Action)"/>。
    /// 阵亡时自动按 Interrupted 结束；换关 / 开新局由 HeroSkills 调 Reset 结束。
    /// </summary>
    public abstract class TimedSkill : Skill
    {
        /// <summary>持续秒数（≤ 0 = 不限时，子类自己结束）</summary>
        public float duration;

        readonly SkillSession session;

        protected TimedSkill() => session = new SkillSession(OnSessionEnd);

        /// <summary>本次已经持续了多久</summary>
        public float Elapsed { get; private set; }
        public float Remaining => session.Active && duration > 0 ? Mathf.Max(0, duration - Elapsed) : 0;
        public bool Active => session.Active;
        public override bool Busy => session.Active;

        /// <summary>属性加成的来源名（StatSheet.Add / Remove）</summary>
        protected string StatSource => "skill:" + Id;

        public sealed override bool Activate()
        {
            if (session.Active || !CanActivate()) return false;
            session.Begin();
            Elapsed = 0;
            bool ok;
            try
            {
                ok = OnBegin();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                ok = false;
            }
            if (!ok) session.End(SkillEnd.Aborted);
            return ok;
        }

        public sealed override void Tick(float dt)
        {
            if (!session.Active) return;
            if (owner == null || !owner.Vitals || owner.Vitals.Dead)
            {
                End(SkillEnd.Interrupted);
                return;
            }
            Elapsed += dt;
            try
            {
                OnTick(dt);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                End(SkillEnd.Interrupted);
                return;
            }
            if (session.Active && duration > 0 && Elapsed >= duration) End(SkillEnd.Natural);
        }

        public sealed override void Reset() => End(SkillEnd.Interrupted);

        /// <summary>结束持续效果：逆序撤销全部登记，然后 OnEnd(reason)</summary>
        public void End(SkillEnd reason = SkillEnd.Natural) => session.End(reason);

        /// <summary>放之前的检查（缺省：活着）</summary>
        protected virtual bool CanActivate() => owner != null && owner.Vitals && !owner.Vitals.Dead;

        protected abstract bool OnBegin();
        protected virtual void OnTick(float dt) { }
        protected virtual void OnEnd(SkillEnd reason) { }

        void OnSessionEnd(SkillEnd reason) => OnEnd(reason);

        // ───────────── 撤销栈 ─────────────

        protected void Track(IDisposable d) => session.Track(d);
        protected void Track(Action undo) => session.Track(undo);

        /// <summary>属性加成（来源 skill:&lt;id&gt;），结束时整源移除</summary>
        protected void AddStat(Stat stat, float value)
        {
            var stats = owner != null ? owner.Stats : null;
            if (stats == null) return;
            string src = StatSource;
            stats.Add(src, stat, value);
            Track(() => stats.Remove(src));
        }

        /// <summary>运动修饰器（加速、减重力、锁输入）</summary>
        protected void AddMotor(IMotorModifier mod, int priority = 0)
        {
            if (owner != null && owner.Motor) Track(owner.Motor.AddModifier(mod, priority));
        }

        /// <summary>输出修饰器（增伤）</summary>
        protected void AddOutgoing(Outgoing fn, int priority = ModifierPriority.Multiplier) => Track(Combat.Outgoing.Add(fn, priority));

        /// <summary>受伤修饰器（减伤）</summary>
        protected void AddIncoming(Incoming fn, int priority = ModifierPriority.Multiplier) => Track(PlayerVitals.Incoming.Add(fn, priority));

        /// <summary>技能生成的物体：结束时销毁（已经交给投射物等别的系统的，先 SetParent 出去或 Disown）</summary>
        protected T Own<T>(T obj) where T : Object
        {
            if (obj) Track(() => Destroy(obj));
            return obj;
        }

        static void Destroy(Object obj)
        {
            if (!obj) return;
            if (obj is Component c) Object.Destroy(c.gameObject);
            else Object.Destroy(obj);
        }
    }
}
