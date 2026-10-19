using System;
using System.Collections.Generic;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 状态种类（Three.js StatusId + 玩家减益）：敌人身上的三种元素状态 + 眩晕、减速；玩家身上的寒意、日晒灼烧、点燃。
    /// 只往末尾追加（<see cref="StatusMask"/> 按序号取位）。
    /// </summary>
    public enum StatusId { Burn, Shock, Corrode, Stun, Slow, Chill, Sunburn, Ignite }

    /// <summary>状态集合（死亡瞬间身上有什么：<see cref="EnemyStatus.DiedWith"/>）：第 n 位 = StatusId n</summary>
    [Flags]
    public enum StatusMask
    {
        None = 0, Burn = 1 << 0, Shock = 1 << 1, Corrode = 1 << 2, Stun = 1 << 3, Slow = 1 << 4,
        Chill = 1 << 5, Sunburn = 1 << 6, Ignite = 1 << 7,
    }

    /// <summary>某个状态此刻的读数（EnemyStatus.TryGet）</summary>
    public struct StatusView
    {
        public StatusId id;
        /// <summary>层数（灼烧 / 雷殛 / 减速条数；蚀化、眩晕为 1）</summary>
        public int stacks;
        /// <summary>剩余秒数（多层时取最长的一层）</summary>
        public float remaining;
        /// <summary>强度：灼烧为各层之和、雷殛 / 蚀化为当前强度、减速为最强那条的比例；眩晕为 0</summary>
        public float power;
    }

    /// <summary>状态能挂在谁身上</summary>
    [Flags]
    public enum StatusHosts { None = 0, Enemy = 1 << 0, Player = 1 << 1 }

    /// <summary>
    /// 施加一次状态的参数（<see cref="EnemyStatus.Apply(Damageable, StatusId, in StatusApply)"/>、<see cref="PlayerStatus.Apply"/>）：
    /// power 的含义随状态而定——灼烧 / 雷殛 / 蚀化是状态强度（不含元素 / 精英 / 首领加成，内部钳到最大生命 × 0.5），
    /// 减速 / 寒意是比例（0.3 = −30%，&gt; 1 按百分数解释），眩晕不看；点燃是每跳伤害，日晒是这次暴露的秒数（已乘增益）。
    /// duration ≤ 0 用该状态的默认时长。
    /// </summary>
    public struct StatusApply
    {
        public float power;
        public float duration;
        /// <summary>衍生深度：雷殛只有 0（直接命中）才向外弹射</summary>
        public int depth;

        public StatusApply(float power, float duration = 0, int depth = 0)
        {
            this.power = power;
            this.duration = duration;
            this.depth = depth;
        }
    }

    /// <summary>
    /// 状态定义（注册表条目，docs/unity-parity.md 4.3）：一种状态一个文件 Combat/Status/&lt;Id&gt;.cs，带 [Defs] 自动登记，
    /// 敌人（<see cref="EnemyStatus"/>）和玩家共用这一张表（<see cref="StatusRegistry"/>）。
    /// 定义是无状态的享元：数值常量、显示信息，以及 <see cref="Create"/>——第一次挂到某个单位身上时生成一份运行时实例，由宿主每帧推进。
    /// </summary>
    public interface IStatusEffect : IDef
    {
        StatusId Status { get; }
        /// <summary>中文名（图标提示、调试）</summary>
        string Name { get; }
        Color Color { get; }
        /// <summary>能挂在谁身上（宿主拒绝不属于自己的状态）</summary>
        StatusHosts Hosts { get; }
        /// <summary>附着它的元素（灼烧 ← 火…）；眩晕 / 减速为 None</summary>
        Element Element { get; }
        /// <summary>为宿主新建一份运行时实例（host 的具体类型由定义自己约定：敌人状态要 EnemyStatus）</summary>
        StatusInstance Create(IStatusHost host);
    }

    /// <summary>状态宿主（敌人的 <see cref="EnemyStatus"/>…）：实例挂上 / 刷新时回报给它（事件、最近附着记录）</summary>
    public interface IStatusHost
    {
        StatusHosts Kind { get; }
        void Notify(StatusId id, int stacks);
    }

    /// <summary>
    /// 挂在某个单位身上的一份状态：运行时数据 + 施加 / 推进逻辑。宿主每帧调 <see cref="Tick"/>（只在 <see cref="Active"/> 时），
    /// 汇总 <see cref="SpeedMult"/>（取最小）与 <see cref="TakenMult"/>（相乘）写给移动 / 承伤。
    /// </summary>
    public abstract class StatusInstance
    {
        public abstract StatusId Id { get; }
        public abstract bool Active { get; }
        /// <summary>施加一次：返回是否挂上</summary>
        public abstract bool Apply(in StatusApply a);
        public abstract void Tick(float dt);
        public abstract bool TryGet(out StatusView view);
        /// <summary>清空（死亡、被消耗）</summary>
        public abstract void Clear();
        /// <summary>移速倍率（宿主取所有状态里最小的）</summary>
        public virtual float SpeedMult => 1f;
        /// <summary>承伤倍率（宿主把所有状态的相乘）</summary>
        public virtual float TakenMult => 1f;
        /// <summary>剩下的跳伤总量（与 power 同口径，不含属性倍率；没有跳伤的状态为 0）</summary>
        public virtual float RemainingDotRaw => 0;
        /// <summary>外观（光晕）：宿主每帧调用，pulse 为共用的脉动量</summary>
        public virtual void UpdateVisual(float pulse) { }
    }

    /// <summary>状态注册表：按 <see cref="StatusId"/> 取定义（底层是 <see cref="Registry{T}"/>，进入 Play 时随之清空）</summary>
    public static class StatusRegistry
    {
        static IStatusEffect[] byId;

        public static IReadOnlyList<IStatusEffect> All => Registry<IStatusEffect>.All;

        /// <summary>某个状态的定义；没有登记返回 null</summary>
        public static IStatusEffect Get(StatusId id)
        {
            var map = byId;
            if (map == null)
            {
                var all = Registry<IStatusEffect>.All;
                int n = 0;
                foreach (var d in all) n = Mathf.Max(n, (int)d.Status + 1);
                map = new IStatusEffect[n];
                foreach (var d in all)
                {
                    if (map[(int)d.Status] != null)
                        throw new InvalidOperationException($"[Status] {d.Status} 登记了两次：{map[(int)d.Status].Id} 与 {d.Id}");
                    map[(int)d.Status] = d;
                }
                byId = map;
                DefsScanner.OnReset(() => byId = null);
            }
            int i = (int)id;
            return i >= 0 && i < map.Length ? map[i] : null;
        }
    }

    /// <summary>跳伤计时（同 Three.js Status.ts）：同步递减的计时器之间的浮点误差容差、按共享计时器对齐的剩余跳数</summary>
    public static class StatusTiming
    {
        /// <summary>计时比较的容差：最后一跳与到期同帧时仍算这一跳</summary>
        public const float TickEps = 1e-4f;

        /// <summary>剩余 remaining 秒、下一跳在 next 秒后、间隔 interval 时还剩几跳（remaining &lt; next 时为 0）</summary>
        public static int TicksLeft(float remaining, float next, float interval)
        {
            if (!(remaining + TickEps >= next) || !(interval > 0)) return 0;
            return Mathf.FloorToInt((remaining + TickEps - next) / interval) + 1;
        }
    }

    /// <summary>
    /// 状态音效节流（同 Three.js StatusSystem）：灼烧 / 蚀化跳伤声全局每种 0.22 s 一声、雷殛弹射声 0.06 s 一声，
    /// 一群敌人同时烧着也不会刷屏。
    /// </summary>
    public static class StatusAudio
    {
        const float TickGap = 0.22f, ZapGap = 0.06f;
        static float burnAt = -1, corrodeAt = -1, zapAt = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => burnAt = corrodeAt = zapAt = -1;

        static bool Ready(ref float last, float gap)
        {
            float now = Time.time;
            if (last >= 0 && now - last < gap && now >= last) return false;
            last = now;
            return true;
        }

        /// <summary>持续伤害跳了一下（火 → burn_tick，其余 → corrode_tick）</summary>
        public static void DotTick(Element e, Vector3 at)
        {
            if (e == Element.Fire)
            {
                if (Ready(ref burnAt, TickGap)) GameAudio.PlayAt("burn_tick", at, 0.28f, 0.9f + Random.value * 0.2f);
            }
            else if (Ready(ref corrodeAt, TickGap)) GameAudio.PlayAt("corrode_tick", at, 0.28f, 0.9f + Random.value * 0.2f);
        }

        /// <summary>雷殛弹射打中了至少一个目标</summary>
        public static void Zap(Vector3 at)
        {
            if (Ready(ref zapAt, ZapGap)) GameAudio.PlayAt("shock_zap", at, 0.65f, 0.9f + Random.value * 0.25f);
        }
    }

    /// <summary>
    /// 挂在敌人身上的状态实例：宿主是 <see cref="EnemyStatus"/>。宿主为空（EditMode 测试直接 new）时只推进数据，不发事件、不出特效、不造成伤害。
    /// </summary>
    public abstract class EnemyStatusInstance : StatusInstance
    {
        protected readonly EnemyStatus host;

        protected EnemyStatusInstance(EnemyStatus host) => this.host = host;

        protected Damageable Hp => host ? host.Health : null;

        protected void Notify(int stacks)
        {
            if (host) host.Notify(Id, stacks);
        }

        /// <summary>状态强度钳到 [0, 最大生命 × 0.5]（同 Three.js STATUS_POWER_CAP）</summary>
        protected float Cap(float power)
        {
            float p = float.IsNaN(power) ? 0 : Mathf.Max(0, power);
            var hp = Hp;
            return hp ? Mathf.Min(p, hp.maxHealth * EnemyStatus.PowerCap) : p;
        }

        /// <summary>造成一跳持续伤害（宿主为空时什么都不做）</summary>
        protected void Dot(float amount, Element e)
        {
            if (host) host.Dot(amount, e);
        }

        protected void Glow(ref Transform glow, Color c, Vector3 offset)
        {
            if (host) host.Glow(ref glow, c, offset);
        }
    }

    /// <summary>
    /// 挂在玩家身上的状态实例：宿主是 <see cref="PlayerStatus"/>。宿主为空（EditMode 测试直接 new）时只推进数据，不发事件、不造成伤害。
    /// </summary>
    public abstract class PlayerStatusInstance : StatusInstance
    {
        protected readonly PlayerStatus host;

        protected PlayerStatusInstance(PlayerStatus host) => this.host = host;

        protected void Notify(int stacks)
        {
            if (host) host.Notify(Id, stacks);
        }

        /// <summary>对玩家造成一跳伤害（经 Combat.DamagePlayer：无敌帧、减伤、受伤修饰器照常）；宿主为空时什么都不做</summary>
        protected void Hurt(float amount, Element e, Vector3? from = null)
        {
            if (host) host.Hurt(amount, e, from);
        }
    }
}
