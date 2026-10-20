using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一卷秘卷某个层数的「安装」（Three.js 版 src/progression/scrolls/ScrollKit.ts 的 ScrollScope）。
    /// <see cref="ScrollDef.Install"/> 里通过它登记一切效果，卸载（<see cref="Dispose"/>）时统一撤销，不留残余：
    ///   属性      <see cref="Stat"/>：来源 scroll:&lt;id&gt;，立即生效；
    ///   事件      <see cref="Hook"/> / OnXxx（ScrollScope.Events.cs，订阅 <see cref="GameEvents"/>）：卸载时退订；
    ///   修饰器    <see cref="AddOutgoing"/>（Combat.Outgoing）/ <see cref="AddIncoming"/>（PlayerVitals.Incoming）/
    ///             <see cref="AddEnemyIncoming"/>（某个敌人的 Damageable.Incoming，敌人死亡时自动撤）：返回句柄，可以提前 Dispose；
    ///   任务      <see cref="Task"/> / <see cref="Every"/> / <see cref="After"/>（<see cref="ScrollTicker"/>）；
    ///   限时增益  <see cref="Buff"/> / <see cref="BattleBuff"/>（独立来源 scroll:&lt;id&gt;#buffN，刷新时长不叠数值）；
    ///   条件属性  <see cref="Toggle"/>（scroll:&lt;id&gt;#toggleN，条件为真时生效）；
    ///   内置冷却  <see cref="Ready"/> / <see cref="ReadyFor"/>；
    ///   触发弹字  <see cref="Proc"/>（发 <see cref="GameEvents.ScrollProc"/>）；
    ///   状态      <see cref="Var{T}"/>（本次安装）/ <see cref="Keep{T}"/>（跨叠层保留，整卷移除时清掉）。
    /// 叠层 = 旧作用域卸载 + 按新层数重装，整个过程包在 <see cref="StatSheet.BeginBatch"/> 里（<see cref="ScrollInventory"/>）：
    /// 属性先撤后加只发一次 Changed，PlayerVitals 只按净增量补当前生命 / 护盾（同 TS「卸载后重装，批处理，不重复送上限」）。
    /// 卸载之后到达的回调（同一次派发里的快照）一律被拦下：事件不调、修饰器按 ×1、任务不跑。
    /// <see cref="DryRun"/> 作用域只记属性总量，不碰任何全局状态（三选一卡面的下一层预览：<see cref="ScrollDef.PreviewStats"/>）。
    /// </summary>
    public sealed partial class ScrollScope : IDisposable
    {
        public readonly ScrollDef def;
        public readonly int stacks;
        /// <summary>玩家属性表（测试里可以是一张单独的表；null = 不改属性）</summary>
        public readonly StatSheet stats;
        /// <summary>玩家（测试 / 编辑器里可能为 null）</summary>
        public readonly PlayerVitals player;
        /// <summary>所属的秘卷持有表（<see cref="Keep{T}"/> 存在这里；单独构造的作用域为 null）</summary>
        public readonly ScrollInventory inventory;
        /// <summary>预览用：只记属性总量，不登记任何事件 / 修饰器 / 任务，也不改属性表</summary>
        public readonly bool DryRun;

        readonly List<(Stat stat, float value)> totals = new();
        readonly List<Action> undo = new();
        readonly List<Tracked> tracked = new();
        readonly List<string> subSources = new();
        readonly List<TimedBuff> buffs = new();
        readonly List<StatToggle> toggles = new();
        Dictionary<string, float> cooldowns;
        Dictionary<(UnityEngine.Object target, string key), float> targetCooldowns;
        Dictionary<string, object> vars;
        bool stateTicker;
        float lastProc = float.NegativeInfinity;

        public bool Disposed { get; private set; }
        public string Id => def.id;
        /// <summary>属性来源 id（同 TS：scroll:&lt;id&gt;）</summary>
        public string Source => SourceOf(def.id);
        public static string SourceOf(string scrollId) => "scroll:" + scrollId;

        /// <summary>某个属性来源是否属于这卷秘卷（主来源或它的限时增益 / 条件属性子来源）</summary>
        public static bool IsSourceOf(string source, string scrollId)
        {
            if (source == null || scrollId == null) return false;
            var main = SourceOf(scrollId);
            return source == main || source.StartsWith(main + "#", StringComparison.Ordinal);
        }

        /// <summary>秘卷时钟（<see cref="ScrollTicker.Now"/>）</summary>
        public float Now => ScrollTicker.Now;

        /// <summary>玩家活着（没有玩家时按活着算：测试里的作用域照常跑条件属性）</summary>
        public bool Alive => !player || !player.Dead;

        /// <summary>玩家的武器（没有玩家时为 null）</summary>
        public WeaponController Weapons => player ? player.GetComponent<WeaponController>() : null;

        public ScrollScope(ScrollDef def, int stacks, StatSheet stats, PlayerVitals player = null, ScrollInventory inventory = null, bool dryRun = false)
        {
            this.def = def ?? throw new ArgumentNullException(nameof(def));
            this.stacks = Mathf.Max(1, stacks);
            this.stats = dryRun ? null : stats;
            this.player = player;
            this.inventory = inventory;
            DryRun = dryRun;
        }

        // ───────────── 属性 ─────────────

        /// <summary>登记属性加成（同一属性多次登记累加），立即生效，卸载时撤掉。在 Install 里调用时处于批处理中，只在装完时发一次 Changed</summary>
        public void Stat(Stat stat, float value)
        {
            if (Disposed || value == 0 || float.IsNaN(value)) return;
            bool merged = false;
            for (int i = 0; i < totals.Count; i++)
                if (totals[i].stat == stat)
                {
                    totals[i] = (stat, totals[i].value + value);
                    merged = true;
                    break;
                }
            if (!merged) totals.Add((stat, value));
            stats?.Add(Source, stat, value);
        }

        /// <summary>本次安装登记的某属性总量（不含限时增益 / 条件属性）</summary>
        public float StatTotal(Stat stat)
        {
            foreach (var (s, v) in totals)
                if (s == stat) return v;
            return 0;
        }

        /// <summary>本次安装登记的全部属性总量（按登记顺序）</summary>
        public IReadOnlyList<(Stat stat, float value)> StatTotals => totals;

        // ───────────── 卸载 / 订阅 ─────────────

        /// <summary>卸载时执行（倒序）</summary>
        public void OnUninstall(Action action)
        {
            if (action == null) return;
            if (Disposed)
            {
                Run(action);
                return;
            }
            undo.Add(action);
        }

        /// <summary>立刻订阅，卸载时退订（任意 C# 事件：s.Hook(() =&gt; X.E += h, () =&gt; X.E -= h)）</summary>
        public void Hook(Action subscribe, Action unsubscribe)
        {
            if (Disposed || DryRun) return;
            subscribe?.Invoke();
            OnUninstall(unsubscribe);
        }

        /// <summary>把任意句柄交给作用域：卸载时 Dispose；提前 Dispose 也行（会从作用域里摘掉）</summary>
        public IDisposable Track(IDisposable handle, Action onDisposed = null)
        {
            if (handle == null) return Tracked.Noop;
            if (Disposed)
            {
                handle.Dispose();
                return Tracked.Noop;
            }
            var t = new Tracked(this, handle, onDisposed);
            tracked.Add(t);
            return t;
        }

        // ───────────── 修饰器 ─────────────

        /// <summary>输出修饰器（<see cref="Combat.Outgoing"/>，在暴击掷骰之后求值）：返回倍率</summary>
        public IDisposable AddOutgoing(Outgoing fn, int priority = ModifierPriority.Multiplier)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            if (Disposed || DryRun) return Tracked.Noop;
            return Track(Combat.Outgoing.Add((in HitContext c) => Disposed ? 1f : fn(in c), priority));
        }

        /// <summary>
        /// 玩家受伤修饰器（<see cref="PlayerVitals.Incoming"/>）：返回倍率。不看伤害量的固定倍率用 Multiplier（缺省），
        /// 看接近最终伤害的（免死、封顶）用 <see cref="ModifierPriority.FinalAmount"/>（同 TS 按参数个数排序的用意）
        /// </summary>
        public IDisposable AddIncoming(Incoming fn, int priority = ModifierPriority.Multiplier)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            if (Disposed || DryRun) return Tracked.Noop;
            return Track(PlayerVitals.Incoming.Add((in IncomingHit h) => Disposed ? 1f : fn(in h), priority));
        }

        /// <summary>某个敌人的承伤修饰器（<see cref="Damageable.Incoming"/>：易伤印记等）。敌人死亡、作用域卸载或句柄 Dispose 时撤掉</summary>
        public IDisposable AddEnemyIncoming(Damageable target, Incoming fn, int priority = ModifierPriority.Multiplier)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            if (Disposed || DryRun || !target || target.Dead) return Tracked.Noop;
            var inner = target.Incoming.Add((in IncomingHit h) => Disposed ? 1f : fn(in h), priority);
            IDisposable handle = null;
            Action<DamageInfo> died = _ => handle?.Dispose();
            target.Died += died;
            handle = Track(inner, () =>
            {
                if (target) target.Died -= died;
            });
            return handle;
        }

        // ───────────── 任务 ─────────────

        /// <summary>常驻逐帧任务（跨关保留，卸载时取消）</summary>
        public IDisposable Task(Action<float> fn)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            if (Disposed || DryRun) return Tracked.Noop;
            return Track(ScrollTicker.EveryFrame(dt =>
            {
                if (!Disposed) fn(dt);
            }));
        }

        /// <summary>常驻定时任务：每隔 interval 秒一次</summary>
        public IDisposable Every(float interval, Action fn)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            if (Disposed || DryRun) return Tracked.Noop;
            return Track(ScrollTicker.Every(interval, () =>
            {
                if (!Disposed) fn();
            }));
        }

        /// <summary>delay 秒后执行一次（卸载则取消）</summary>
        public IDisposable After(float delay, Action fn)
        {
            if (fn == null) throw new ArgumentNullException(nameof(fn));
            if (Disposed || DryRun) return Tracked.Noop;
            IDisposable handle = null;
            handle = Track(ScrollTicker.After(delay, () =>
            {
                handle?.Dispose(); // 到点即从作用域里摘掉，反复延时不会越积越多
                if (!Disposed) fn();
            }));
            return handle;
        }

        // ───────────── 限时增益 / 条件属性 ─────────────

        /// <summary>限时增益（独立来源 scroll:&lt;id&gt;#buffN）：Trigger 刷新持续时间，不叠加数值</summary>
        public TimedBuff Buff(params (Stat stat, float value)[] mods)
        {
            var b = new TimedBuff(this, $"{Source}#buff{buffs.Count}", mods);
            if (Disposed || DryRun) return b;
            buffs.Add(b);
            subSources.Add(b.source);
            EnsureStateTicker();
            return b;
        }

        /// <summary>战斗增益：同 <see cref="Buff"/>，换关、阵亡时立刻结束（同 TS defsTactics 的 battleBuff）</summary>
        public TimedBuff BattleBuff(params (Stat stat, float value)[] mods)
        {
            var b = Buff(mods);
            OnStageLoaded(_ => b.End());
            OnPlayerDied(b.End);
            return b;
        }

        /// <summary>条件属性（scroll:&lt;id&gt;#toggleN）：玩家活着且 predicate 为真时生效，每帧检查</summary>
        public void Toggle((Stat stat, float value)[] mods, Func<bool> predicate)
        {
            if (predicate == null) throw new ArgumentNullException(nameof(predicate));
            if (Disposed || DryRun) return;
            var t = new StatToggle(this, $"{Source}#toggle{toggles.Count}", mods, predicate);
            toggles.Add(t);
            subSources.Add(t.source);
            EnsureStateTicker();
        }

        void EnsureStateTicker()
        {
            if (stateTicker) return;
            stateTicker = true;
            Task(_ =>
            {
                foreach (var b in buffs) b.Tick();
                foreach (var t in toggles) t.Tick();
            });
        }

        // ───────────── 内置冷却 ─────────────

        /// <summary>内置冷却：key 在 seconds 秒内只返回一次 true（同 TS ready）</summary>
        public bool Ready(string key, float seconds)
        {
            cooldowns ??= new Dictionary<string, float>();
            float now = Now;
            if (cooldowns.TryGetValue(key ?? "", out var next) && now < next) return false;
            cooldowns[key ?? ""] = now + seconds;
            return true;
        }

        /// <summary>某个冷却还剩多少秒（没在冷却为 0）</summary>
        public float CooldownLeft(string key) =>
            cooldowns != null && cooldowns.TryGetValue(key ?? "", out var next) ? Mathf.Max(0, next - Now) : 0;

        /// <summary>清掉某个冷却（下次 Ready 立即为 true）</summary>
        public void ResetCooldown(string key) => cooldowns?.Remove(key ?? "");

        /// <summary>按目标的内置冷却（同 TS defsReaction 的 icd(enemy, …)）：同一个目标 + key 在 seconds 秒内只返回一次 true</summary>
        public bool ReadyFor(UnityEngine.Object target, string key, float seconds)
        {
            if (!target) return false;
            targetCooldowns ??= new Dictionary<(UnityEngine.Object, string), float>();
            float now = Now;
            var k = (target, key ?? "");
            if (targetCooldowns.TryGetValue(k, out var next) && now < next) return false;
            if (targetCooldowns.Count > 256) PruneTargetCooldowns(now);
            targetCooldowns[k] = now + seconds;
            return true;
        }

        void PruneTargetCooldowns(float now)
        {
            var dead = new List<(UnityEngine.Object, string)>();
            foreach (var kv in targetCooldowns)
                if (kv.Value <= now || !kv.Key.Item1) dead.Add(kv.Key);
            foreach (var k in dead) targetCooldowns.Remove(k);
        }

        // ───────────── 触发 / 状态 ─────────────

        /// <summary>
        /// 触发了一次：发 <see cref="GameEvents.ScrollProc"/>（HUD 在准星旁弹字 / 闪图标）。
        /// minGap 秒内重复触发只发一次，免得霰弹一枪弹十个字；返回这次有没有发
        /// </summary>
        public bool Proc(float minGap = 0.1f)
        {
            if (Disposed || DryRun) return false;
            float now = Now;
            if (now - lastProc < minGap) return false;
            lastProc = now;
            GameEvents.RaiseScrollProc(def.id);
            return true;
        }

        /// <summary>本次安装的一个状态槽（叠层重装后重新开始，同 TS setup 闭包里的 let）：同一个 key 拿到同一个盒子</summary>
        public Box<T> Var<T>(string key, T initial = default)
        {
            vars ??= new Dictionary<string, object>();
            return GetBox(vars, key, initial);
        }

        /// <summary>跨叠层保留的状态槽（每关一次的标记、累计计数）：存在持有表里，整卷移除 / 新开一局时清掉。没有持有表时同 <see cref="Var{T}"/></summary>
        public Box<T> Keep<T>(string key, T initial = default) =>
            inventory != null ? GetBox(inventory.Memory(def.id), key, initial) : Var(key, initial);

        static Box<T> GetBox<T>(Dictionary<string, object> store, string key, T initial)
        {
            key ??= "";
            if (store.TryGetValue(key, out var o) && o is Box<T> b) return b;
            b = new Box<T> { value = initial };
            store[key] = b;
            return b;
        }

        // ───────────── 卸载 ─────────────

        /// <summary>
        /// 卸载：倒序执行卸载回调 → 撤掉全部句柄（修饰器、任务）→ 结束限时增益 / 条件属性 → 撤掉主来源和全部子来源的属性。
        /// 包在属性表的批处理里：叠层时与重装合并成一次 Changed
        /// </summary>
        public void Dispose()
        {
            if (Disposed) return;
            Disposed = true;
            stats?.BeginBatch();
            try
            {
                for (int i = undo.Count - 1; i >= 0; i--) Run(undo[i]);
                undo.Clear();
                for (int i = tracked.Count - 1; i >= 0; i--)
                {
                    if (i >= tracked.Count) continue;
                    var t = tracked[i];
                    try { t.Dispose(); }
                    catch (Exception e) { Debug.LogException(e); }
                }
                tracked.Clear();
                foreach (var b in buffs) b.End();
                foreach (var t in toggles) t.End();
                if (stats != null)
                {
                    stats.Remove(Source);
                    foreach (var s in subSources) stats.Remove(s);
                }
            }
            finally
            {
                stats?.EndBatch();
            }
        }

        static void Run(Action a)
        {
            try { a(); }
            catch (Exception e) { Debug.LogException(e); }
        }

        // ───────────── 内部类型 ─────────────

        /// <summary>作用域管着的一个句柄：Dispose 时从作用域里摘掉，再撤掉里面的句柄</summary>
        sealed class Tracked : IDisposable
        {
            public static readonly IDisposable Noop = new NoopHandle();

            ScrollScope owner;
            IDisposable inner;
            Action onDisposed;

            public Tracked(ScrollScope owner, IDisposable inner, Action onDisposed)
            {
                this.owner = owner;
                this.inner = inner;
                this.onDisposed = onDisposed;
            }

            public void Dispose()
            {
                var i = inner;
                if (i == null) return;
                inner = null;
                owner?.tracked.Remove(this);
                owner = null;
                var cb = onDisposed;
                onDisposed = null;
                try { i.Dispose(); }
                finally { cb?.Invoke(); }
            }

            sealed class NoopHandle : IDisposable
            {
                public void Dispose() { }
            }
        }

        /// <summary>条件属性：每帧按条件开关</summary>
        sealed class StatToggle
        {
            readonly ScrollScope scope;
            public readonly string source;
            readonly (Stat stat, float value)[] mods;
            readonly Func<bool> predicate;
            bool on;

            public StatToggle(ScrollScope scope, string source, (Stat, float)[] mods, Func<bool> predicate)
            {
                this.scope = scope;
                this.source = source;
                this.mods = mods ?? Array.Empty<(Stat, float)>();
                this.predicate = predicate;
            }

            public void Tick()
            {
                bool want = scope.Alive && predicate();
                if (want == on) return;
                on = want;
                var s = scope.stats;
                if (s == null) return;
                if (want)
                {
                    s.BeginBatch();
                    foreach (var (k, v) in mods) s.Add(source, k, v);
                    s.EndBatch();
                }
                else s.Remove(source);
            }

            public void End()
            {
                if (on) scope.stats?.Remove(source);
                on = false;
            }
        }
    }

    /// <summary>一个可变的状态槽（<see cref="ScrollScope.Var{T}"/> / <see cref="ScrollScope.Keep{T}"/>）：直接读写 value，不装箱</summary>
    public sealed class Box<T>
    {
        public T value;
    }

    /// <summary>
    /// 限时增益（同 TS TimedBuff）：独立的属性来源，<see cref="Trigger"/> 触发或刷新持续时间（取更晚的到期时刻，不叠加数值），
    /// 到期由作用域的状态任务结束；作用域卸载时一并结束。
    /// </summary>
    public sealed class TimedBuff
    {
        readonly ScrollScope scope;
        public readonly string source;
        readonly (Stat stat, float value)[] mods;
        float until = -1;
        bool active;

        internal TimedBuff(ScrollScope scope, string source, (Stat, float)[] mods)
        {
            this.scope = scope;
            this.source = source;
            this.mods = mods ?? Array.Empty<(Stat, float)>();
        }

        public bool IsActive => active;
        /// <summary>剩余秒数（未生效为 0）</summary>
        public float Remaining => active ? Mathf.Max(0, until - ScrollTicker.Now) : 0;

        /// <summary>触发 / 刷新持续时间</summary>
        public void Trigger(float duration)
        {
            if (scope.Disposed || scope.DryRun) return;
            until = Mathf.Max(until, ScrollTicker.Now + duration);
            if (active) return;
            active = true;
            var s = scope.stats;
            if (s == null) return;
            s.BeginBatch();
            foreach (var (k, v) in mods) s.Add(source, k, v);
            s.EndBatch();
        }

        internal void Tick()
        {
            if (active && ScrollTicker.Now >= until) End();
        }

        /// <summary>立刻结束</summary>
        public void End()
        {
            if (!active) return;
            active = false;
            until = -1;
            scope.stats?.Remove(source);
        }
    }
}
