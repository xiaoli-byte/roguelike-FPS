using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一次待执行的反应 / 崩解（<see cref="ReactionScheduler"/> 入队时填好，<see cref="ReactionSystem"/> 执行时交给处理器，执行完归还对象池）。
    /// 处理器只读「入队」段，写「执行」段（hits / stunned 会进 <see cref="ReactionEvent"/>）。不要在执行结束后继续持有。
    /// </summary>
    public sealed class ReactionJob
    {
        // ── 入队 ──
        /// <summary>哪个处理器：四种反应之一，或崩解</summary>
        public DetonateOutcome kind;
        public Damageable enemy;
        /// <summary>入队时的反应中心（敌人执行时已死 / 没了就用它）</summary>
        public Vector3 point;
        /// <summary>反应：附着强度 Pin；崩解（雷殛）：重新弹射用的雷殛强度（反应口径）</summary>
        public float pin;
        /// <summary>威力倍率（附着的 reactionScale / 强制反应的 scale）</summary>
        public float scale = 1;
        /// <summary>引爆倍率（并入同一次引爆时取较高者）</summary>
        public float mult = 1;
        /// <summary>反应：直接指定的 B（强制反应 fixedBase）；崩解：入队时算好的崩解伤害</summary>
        public float? fixedBase;
        /// <summary>归墟消耗灼烧的结清值</summary>
        public float cash;
        /// <summary>入队时的关卡强度 S（执行时敌人没了用它）</summary>
        public float strength = 1;
        /// <summary>执行时刻</summary>
        public float at;
        public int depth, weaponUid;
        /// <summary>入队的帧号（引爆合并只认本帧 / 上一帧入队的条目）</summary>
        public int frame;
        /// <summary>入队于击杀那一击（中心伤害与控制跳过，范围部分照常）</summary>
        public bool killed;
        public ReactionOrigin origin;
        /// <summary>强制反应的来源标签（透传到事件）</summary>
        public DamageTag tag;
        /// <summary>崩解的状态</summary>
        public StatusId collapse;

        // ── 执行 ──
        /// <summary>执行时的中心：敌人活着取它当前的身体中心，否则取 <see cref="point"/></summary>
        public Vector3 center;
        /// <summary>威力 B（反应）</summary>
        public float B;
        /// <summary>中心敌人活着且不是击杀那一击：中心伤害与控制照常</summary>
        public bool centerAlive;
        /// <summary>受到这次反应伤害的敌人数</summary>
        public int hits;
        /// <summary>封脉把中心敌人眩晕了</summary>
        public bool stunned;

        public Reaction Reaction => (Reaction)(int)kind;

        public void Reset()
        {
            kind = DetonateOutcome.Thunderfire;
            enemy = null;
            point = center = Vector3.zero;
            pin = cash = at = B = 0;
            scale = mult = strength = 1;
            fixedBase = null;
            depth = weaponUid = 0;
            frame = -1;
            killed = centerAlive = stunned = false;
            hits = 0;
            origin = ReactionOrigin.Status;
            tag = DamageTag.None;
            collapse = StatusId.Burn;
        }
    }

    /// <summary>
    /// 一种反应（或崩解）的效果：注册表 <see cref="Registry{T}"/>（类上标 <see cref="DefsAttribute"/>）自动发现，
    /// 一种一个文件（Combat/Reactions/&lt;Id&gt;Handler.cs）。<see cref="ReactionSystem"/> 在 Update 里按 <see cref="Kind"/> 分派。
    /// Execute 在伤害管线之外调用：可以直接造成伤害（<see cref="ReactionSystem.Hit"/>）、爆炸、扩散元素。
    /// </summary>
    public interface IReactionHandler : IDef
    {
        /// <summary>处理哪一种：四种反应按 <see cref="Reaction"/> 编号，崩解为 <see cref="DetonateOutcome.Collapse"/></summary>
        DetonateOutcome Kind { get; }

        /// <summary>
        /// 执行一次。反应：job.center / B / centerAlive 已填好，处理器累加 job.hits、写 job.stunned，浮字与事件由 ReactionSystem 统一发。
        /// 崩解：处理器自己判断敌人是否还活着、自己出浮字（崩解不派发 <see cref="GameEvents.Reacted"/>）。
        /// </summary>
        void Execute(ReactionJob job);

        /// <summary>每帧推进（熔池跳伤等持续效果）</summary>
        void Tick(float dt);

        /// <summary>换场景 / 反应系统重建：清掉持续效果</summary>
        void Clear();
    }

    /// <summary>处理器基类：Tick / Clear 默认什么都不做</summary>
    public abstract class ReactionHandler : IReactionHandler
    {
        public abstract string Id { get; }
        public abstract DetonateOutcome Kind { get; }
        public abstract void Execute(ReactionJob job);
        public virtual void Tick(float dt) { }
        public virtual void Clear() { }
    }

    /// <summary>按 <see cref="DetonateOutcome"/> 取处理器（从 Registry 建一张定长表缓存；进入 Play 时清空重建）</summary>
    public static class ReactionHandlers
    {
        static IReactionHandler[] table;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => table = null;

        /// <summary>五个槽位（四种反应 + 崩解）；没有处理器的槽位为 null</summary>
        public static IReactionHandler[] Table
        {
            get
            {
                if (table != null) return table;
                var t = new IReactionHandler[(int)DetonateOutcome.Collapse + 1];
                foreach (var h in Registry<IReactionHandler>.All)
                {
                    int i = (int)h.Kind;
                    if (i < 0 || i >= t.Length) continue;
                    if (t[i] != null) Debug.LogError($"[Reaction] {h.Kind} 有两个处理器：{t[i].GetType().Name} 与 {h.GetType().Name}，用前一个");
                    else t[i] = h;
                }
                table = t;
                return t;
            }
        }

        public static IReactionHandler Get(DetonateOutcome kind)
        {
            var t = Table;
            int i = (int)kind;
            return i >= 0 && i < t.Length ? t[i] : null;
        }

        /// <summary>清掉所有处理器的持续效果（表还没建过就什么都不做，不为此去扫描程序集）</summary>
        public static void ClearAll()
        {
            if (table == null) return;
            foreach (var h in table)
                try { h?.Clear(); }
                catch (Exception e) { Debug.LogException(e); }
        }
    }
}
