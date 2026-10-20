using System;
using System.Runtime.CompilerServices;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>状态机发给表现层的通知（音效、事件、HUD 刷新都由宿主映射）</summary>
    public enum WeaponNote
    {
        /// <summary>弹药 / 槽位变了（HUD 刷新）</summary>
        Changed,
        /// <summary>获得一把枪（拾取 / 宝箱，切过去之前）</summary>
        Acquired,
        /// <summary>切到 w（other = 切之前手上的枪）</summary>
        Switched,
        ReloadStarted,
        /// <summary>逐发装填压进一发</summary>
        ShellInserted,
        /// <summary>换弹完成（整匣到时，或逐发装满 / 备弹耗尽）</summary>
        Reloaded,
        /// <summary>逐发装填已压进一发以上时被打断（开火、切枪）：算一次部分换弹，同 TS cancelReload 发 reloaded，但不放完成音</summary>
        ReloadPartial,
        /// <summary>逐发装填结束后上膛（泵动动作，<see cref="WeaponTiming.ShellRack"/> 秒不能开火）</summary>
        Racked,
        /// <summary>弹匣和备弹都空了还扣扳机</summary>
        DryFire,
        /// <summary>应急补给：当前武器备弹 + 1 匣</summary>
        Resupplied,
        /// <summary>进行中的动作被停下（切枪、死亡、换关）：光束熄灭、连射计数清零</summary>
        Stopped,
    }

    /// <summary>状态机的表现层（<see cref="WeaponController"/>；测试里是假宿主）：弹道、反馈、音效、事件</summary>
    public interface IWeaponEffects
    {
        /// <summary>一次射击（弹药、元素轮转已经处理好；element = 本发元素）。mods.deferred = 齐射开始：不发弹道、不给反馈</summary>
        void Shoot(WeaponInstance w, in ShotMods mods, Element element);
        void VolleyProjectile(WeaponInstance w, int index, int count, bool feedback);
        void Cue(WeaponInstance w, FireCue cue);
        void Notify(WeaponNote note, WeaponInstance w, WeaponInstance other);
    }

    /// <summary>每帧输入（控制器从 GameInput / TestMode 读好、判断过输入权）</summary>
    public struct WeaponFrame
    {
        public float dt;
        public bool alive;
        /// <summary>有输入权（鼠标锁定、没在菜单；TestMode 恒真）</summary>
        public bool canAct;
        public bool fireDown, firePressed, reloadPressed;
        /// <summary>冲刺中：不开火（Unity 原有手感）</summary>
        public bool blocked;
        public bool infinite;
        /// <summary>当前武器被 <see cref="IWeaponTakeover"/> 接管：只走切枪 / 冷却计时，不开火、不换弹</summary>
        public bool takeover;
        public bool testAuto;
    }

    /// <summary>每把枪的运行时状态（按实例弱引用挂着，切走再切回还在；同 TS WeaponRuntime 的一部分）</summary>
    public sealed class WeaponRuntime
    {
        public IFireMode mode;
        /// <summary>切走时剩余冷却折算成的绝对时间：切回来 cooldown = readyAt − now（切枪不能刷掉冷却）</summary>
        public float readyAt = -99;
        /// <summary>这把枪打过的发数（传说「第 N 发」用）</summary>
        public int shots;
    }

    /// <summary>
    /// 武器状态机（同 TS WeaponSystem.update 的非表现部分）：两个槽、切枪（先收后出，0.35 s）、每把枪的 readyAt、开火缓冲、
    /// 开火模式（<see cref="IFireMode"/>）、换弹（整匣 / 逐发 + 0.3 s 上膛）、打空自动换弹与空仓、无限弹药、应急补给、按比例补备弹、换关清理。
    /// 不碰 Unity 场景：时间由 clock 给、数值由 resolve 给、弹道与反馈交给 <see cref="IWeaponEffects"/>，EditMode 可以直接驱动。
    /// 每帧顺序（同 TS）：计时 → 缓冲 → 换弹（或被开火打断）→ 开火模式 → 冷却钳 0 → 空匣处理 → 应急补给。
    /// </summary>
    public sealed class WeaponStateMachine : IFireHost
    {
        readonly WeaponInstance[] slots;
        readonly IWeaponEffects fx;
        readonly Func<float> clock;
        readonly Func<WeaponInstance, ResolvedWeapon> resolve;
        readonly ConditionalWeakTable<WeaponInstance, WeaponRuntime> runtimes = new();

        /// <summary>开火缓冲与「按住只算一次」</summary>
        public readonly TriggerState trigger = new();
        /// <summary>被接管的武器（碎刃）：不换弹、不算缺弹（应急补给）</summary>
        public Func<WeaponInstance, bool> isTakeover;
        /// <summary>场上还有活着的敌人（应急补给只在战斗中给）；null = 当作有</summary>
        public Func<bool> enemiesAlive;

        public int ActiveSlot { get; private set; }
        public WeaponInstance Active => ActiveSlot >= 0 && ActiveSlot < slots.Length ? slots[ActiveSlot] : null;
        public float Cooldown { get; set; }
        public float SwitchTimer { get; private set; }
        /// <summary>切枪收枪阶段要显示的旧枪（掏枪完毕后清空）</summary>
        public WeaponInstance Holster { get; private set; }
        public bool Reloading { get; private set; }
        public bool ShellReload { get; private set; }
        public int ShellsInserted { get; private set; }
        /// <summary>最近一帧是否无限弹药</summary>
        public bool Infinite { get; private set; }

        float reloadElapsed, reloadTotal = 1, shellTimer, shellFirst, shellStep;
        int shellsNeeded = 1;
        WeaponInstance reloadWeapon;
        float autoReload, dryTimer, starved;
        bool wasAlive = true;

        public WeaponStateMachine(WeaponInstance[] slots, IWeaponEffects fx, Func<float> clock, Func<WeaponInstance, ResolvedWeapon> resolve)
        {
            this.slots = slots;
            this.fx = fx;
            this.clock = clock;
            this.resolve = resolve ?? (w => WeaponStatsResolver.Resolve(w, null));
        }

        public WeaponRuntime Runtime(WeaponInstance w)
        {
            if (w == null) return null;
            if (!runtimes.TryGetValue(w, out var rt))
            {
                rt = new WeaponRuntime { mode = FireModes.Create(w.def) };
                runtimes.Add(w, rt);
            }
            return rt;
        }

        /// <summary>当前武器的开火模式</summary>
        public IFireMode Mode => Runtime(Active)?.mode;
        /// <summary>点射 / 齐射进行中</summary>
        public bool Busy => Mode?.Busy ?? false;
        /// <summary>当前移速惩罚（米 / 秒）</summary>
        public float MoveSlow => Mode?.MoveSlow ?? 0;
        /// <summary>空仓音冷却中（第一人称空仓抖动用）</summary>
        public bool DryRecently => dryTimer > 0;

        /// <summary>换弹进度 0..1（逐发装填按已压入的发数 + 当前这发的进度，同 TS reloadProgress）</summary>
        public float ReloadProgress
        {
            get
            {
                if (!Reloading) return 0;
                if (ShellReload) return Mathf.Clamp01((ShellsInserted + ShellProgress) / Mathf.Max(1, shellsNeeded));
                return Mathf.Clamp01(reloadElapsed / reloadTotal);
            }
        }

        /// <summary>逐发装填当前这一发的进度 0..1（第一发含准备动作）</summary>
        public float ShellProgress
        {
            get
            {
                if (!Reloading || !ShellReload) return 0;
                float step = ShellsInserted == 0 ? shellFirst : shellStep;
                return 1 - Mathf.Clamp01(shellTimer / Mathf.Max(0.01f, step));
            }
        }

        public static bool IsShell(WeaponDef d) => d != null && d.reload == ReloadStyle.Shell && d.shellTime > 0;

        bool TakenOver(WeaponInstance w) => w != null && isTakeover != null && isTakeover(w);

        // ───────────── IFireHost ─────────────

        public bool HasAmmo => Infinite || (Active != null && Active.mag > 0);

        public void ConsumeTrigger() => trigger.Consume();

        public void Shoot(in ShotMods mods)
        {
            var w = Active;
            if (w == null) return;
            if (!Infinite) w.mag = Mathf.Max(0, w.mag - 1);
            Runtime(w).shots++;
            // 元素轮转（三才转轮）：本发取弹巢当前位置，随后推进一格；换弹归零
            var el = w.element;
            var cycle = w.def.cycle;
            if (cycle != null && cycle.Length > 0)
            {
                el = cycle[w.cycleIndex % cycle.Length];
                w.cycleIndex++;
            }
            // 改造前：任何一发打出后都要松开扳机，半自动才会再响应「按住」
            trigger.held = true;
            fx.Shoot(w, in mods, el);
        }

        public void VolleyProjectile(int index, int count, bool feedback)
        {
            var w = Active;
            if (w != null) fx.VolleyProjectile(w, index, count, feedback);
        }

        public void Cue(FireCue cue) => fx.Cue(Active, cue);

        // ───────────── 每帧 ─────────────

        public void Tick(in WeaponFrame f)
        {
            float dt = f.dt;
            Infinite = f.infinite;
            if (!f.alive && wasAlive) StopActions(false);
            wasAlive = f.alive;
            if (SwitchTimer > 0) SwitchTimer = Mathf.Max(0, SwitchTimer - dt);
            if (SwitchTimer <= 0) Holster = null;
            if (dryTimer > 0) dryTimer -= dt;
            Cooldown -= dt;
            trigger.Update(f.firePressed, f.fireDown, dt);

            var w = Active;
            if (w == null)
            {
                if (Cooldown < 0) Cooldown = 0;
                return;
            }
            var R = resolve(w);
            var mode = Runtime(w).mode;
            if (f.takeover)
            {
                if (Reloading) CancelReload(false);
                if (Cooldown < 0) Cooldown = 0;
                autoReload = 0;
                starved = 0;
                return;
            }

            // 换弹。无限弹药期间弹匣不消耗：进行中的换弹直接中断（不上膛），忽略 R 与自动换弹，保证马上能开火
            if (Infinite)
            {
                if (Reloading) CancelReload(false);
            }
            else if (f.reloadPressed) StartReload();
            if (Reloading)
            {
                if (ShellReload && trigger.Buffered && w.mag > 0)
                {
                    // 逐发装填中开火：打断，上膛后打出这一枪（缓冲至少留到上膛结束）
                    CancelReload();
                    trigger.buffer = Mathf.Max(trigger.buffer, Cooldown + WeaponTiming.RackBufferPad);
                }
                else UpdateReload(dt, w, R);
            }

            var input = new FireInput
            {
                dt = dt, down = f.fireDown, pulled = trigger.Pulled(f.fireDown),
                ready = SwitchTimer <= 0 && !Reloading && f.alive, blocked = f.blocked, inputOk = f.canAct,
                rate = R.fireRate, rateMult = R.fireRateMult, testAuto = f.testAuto,
            };
            mode.Tick(in input, this);
            if (Cooldown < 0) Cooldown = 0;

            HandleEmpty(in f, w, mode);
            CheckStarvation(in f, w, R);
            w.spin = mode.Spin;
            w.charge = mode.Charge;
        }

        /// <summary>
        /// 打空：按着扳机（或开火缓冲里）就立即换弹（改造前的手感）；没有备弹时空仓音（按下，或持续开火类按住；0.3 s 一次）。
        /// 没按扳机时打空 0.25 s 后自动换弹（同 TS）。点射 / 齐射没打完不换。
        /// </summary>
        void HandleEmpty(in WeaponFrame f, WeaponInstance w, IFireMode mode)
        {
            bool empty = !Infinite && w.mag <= 0;
            if (!empty || Reloading || SwitchTimer > 0)
            {
                autoReload = 0;
                return;
            }
            bool canReload = w.reserve > 0;
            if (f.canAct && (trigger.Buffered || f.fireDown))
            {
                if (canReload)
                {
                    if (!mode.Busy)
                    {
                        trigger.buffer = 0;
                        StartReload();
                        return;
                    }
                }
                else if (trigger.Buffered || FireModes.IsHold(mode))
                {
                    trigger.buffer = 0;
                    if (dryTimer <= 0)
                    {
                        dryTimer = WeaponTiming.DryInterval;
                        fx.Notify(WeaponNote.DryFire, w, null);
                    }
                }
            }
            if (canReload && !mode.Busy && f.alive)
            {
                autoReload += f.dt;
                if (autoReload >= WeaponTiming.AutoReloadDelay) StartReload();
            }
        }

        /// <summary>
        /// 防卡关（同 TS checkStarvation）：所有武器弹匣与备弹全空持续 2.5 s、且场上有活着的敌人时，给当前武器补一个弹匣的备弹。
        /// 被接管的武器（碎刃）不耗弹，永不算空
        /// </summary>
        void CheckStarvation(in WeaponFrame f, WeaponInstance w, ResolvedWeapon R)
        {
            if (Infinite || !f.alive)
            {
                starved = 0;
                return;
            }
            bool allEmpty = true;
            foreach (var s in slots)
                if (s != null && (s.mag > 0 || s.reserve > 0 || TakenOver(s)))
                {
                    allEmpty = false;
                    break;
                }
            if (!allEmpty || (enemiesAlive != null && !enemiesAlive()))
            {
                starved = 0;
                return;
            }
            starved += f.dt;
            if (starved < WeaponTiming.StarveTime) return;
            starved = 0;
            w.reserve = Mathf.Min(R.reserveCap, w.reserve + R.magCap);
            fx.Notify(WeaponNote.Resupplied, w, null);
        }

        // ───────────── 换弹 ─────────────

        /// <summary>开始换弹；切枪中、点射 / 齐射中、无限弹药、被接管、弹匣已满或没有备弹时不换。返回是否开始</summary>
        public bool StartReload()
        {
            var w = Active;
            if (w == null || Reloading || SwitchTimer > 0 || Infinite || TakenOver(w)) return false;
            var rt = Runtime(w);
            if (rt.mode.Busy) return false;
            var R = resolve(w);
            if (w.mag >= R.magCap || w.reserve <= 0) return false;
            rt.mode.Cancel();
            autoReload = 0;
            Reloading = true;
            reloadWeapon = w;
            if (IsShell(w.def))
            {
                ShellReload = true;
                // 准备动作 + 第一发（同 TS）；之后每 shellTime 一发
                shellStep = Mathf.Max(0.05f, R.shellTime);
                shellFirst = R.reloadStart + R.shellTime;
                shellTimer = shellFirst;
                ShellsInserted = 0;
                shellsNeeded = Mathf.Max(1, Mathf.Min(R.magCap - w.mag, w.reserve));
            }
            else
            {
                ShellReload = false;
                reloadElapsed = 0;
                reloadTotal = Mathf.Max(WeaponTiming.MinReload, R.reloadTime);
            }
            fx.Notify(WeaponNote.ReloadStarted, w, null);
            return true;
        }

        void UpdateReload(float dt, WeaponInstance w, ResolvedWeapon R)
        {
            if (ShellReload)
            {
                shellTimer -= dt;
                int guard = 0;
                while (Reloading && shellTimer <= 0 && guard++ < 4)
                {
                    if (w.mag < R.magCap && w.reserve > 0)
                    {
                        w.mag++;
                        w.reserve--;
                        ShellsInserted++;
                        fx.Notify(WeaponNote.ShellInserted, w, null);
                    }
                    if (w.mag >= R.magCap || w.reserve <= 0) FinishReload(w, true);
                    else shellTimer += shellStep;
                }
                return;
            }
            reloadElapsed += dt;
            if (reloadElapsed < reloadTotal) return;
            int take = Mathf.Min(Mathf.Max(0, R.magCap - w.mag), Mathf.Max(0, w.reserve));
            w.mag += take;
            w.reserve -= take;
            FinishReload(w, false);
        }

        void FinishReload(WeaponInstance w, bool rack)
        {
            Reloading = false;
            ShellReload = false;
            reloadWeapon = null;
            // 元素轮转：每次换弹从第一种元素重新开始
            w.cycleIndex = 0;
            if (rack) Rack(w);
            fx.Notify(WeaponNote.Reloaded, w, null);
        }

        void Rack(WeaponInstance w)
        {
            Cooldown = Mathf.Max(Cooldown, WeaponTiming.ShellRack);
            fx.Notify(WeaponNote.Racked, w, null);
        }

        /// <summary>
        /// 中断换弹；逐发装填已压进的弹保留，算一次（部分）换弹完成。
        /// rack = false 时跳过上膛（无限弹药开始时：弹匣不消耗，没有「装一发打一发」可钻）
        /// </summary>
        public void CancelReload(bool rack = true)
        {
            if (!Reloading) return;
            var w = reloadWeapon ?? Active;
            bool partial = ShellReload && ShellsInserted > 0;
            Reloading = false;
            ShellReload = false;
            reloadWeapon = null;
            if (!partial || w == null) return;
            if (rack) Rack(w);
            fx.Notify(WeaponNote.ReloadPartial, w, null);
        }

        // ───────────── 切枪 ─────────────

        /// <summary>
        /// 切到指定槽（同 TS switchTo）：齐射剩余弹体打完 → 停下进行中的动作 → 旧枪剩余冷却存进它的 readyAt、新枪按自己的 readyAt 恢复冷却 →
        /// 先收旧枪再掏新枪。force = 即使是当前槽也重新掏枪。返回是否切了
        /// </summary>
        public bool SwitchTo(int slot, bool force = false)
        {
            if (slot < 0 || slot >= slots.Length) return false;
            var target = slots[slot];
            if (target == null || (slot == ActiveSlot && !force)) return false;
            var prev = Active;
            StopActions(true);
            if (prev != target)
            {
                float now = clock();
                if (prev != null) Runtime(prev).readyAt = now + Mathf.Max(0, Cooldown);
                Cooldown = Mathf.Max(0, Runtime(target).readyAt - now);
            }
            Holster = prev != null && prev != target ? prev : null;
            ActiveSlot = slot;
            SwitchTimer = WeaponTiming.SwitchTime;
            fx.Notify(WeaponNote.Switched, target, prev);
            return true;
        }

        /// <summary>切到另一个槽（X / 滚轮 / 手柄上）；收枪还没过半时忽略（滚轮防抖，同 TS）</summary>
        public bool Swap()
        {
            if (SwitchTimer >= WeaponTiming.SwitchTime * 0.5f) return false;
            int other = 1 - ActiveSlot;
            return SwitchTo(other >= 0 && other < slots.Length && slots[other] != null ? other : ActiveSlot);
        }

        /// <summary>
        /// 拾取 / 宝箱给的枪（同 TS give）：有空槽放空槽并切过去；否则替换当前槽（齐射打完、动作停下、旧枪冷却存档，新枪直接抬起）。
        /// 返回被替换下来的枪（放进空槽时为 null）
        /// </summary>
        public WeaponInstance Give(WeaponInstance w)
        {
            if (w == null) return null;
            fx.Notify(WeaponNote.Acquired, w, null);
            int empty = -1;
            for (int i = 0; i < slots.Length; i++)
                if (slots[i] == null)
                {
                    empty = i;
                    break;
                }
            if (empty >= 0)
            {
                slots[empty] = w;
                SwitchTo(empty, true);
                return null;
            }
            var old = Active;
            StopActions(true);
            float now = clock();
            if (old != null) Runtime(old).readyAt = now + Mathf.Max(0, Cooldown);
            slots[ActiveSlot] = w;
            Holster = null;
            SwitchTimer = WeaponTiming.SwitchTime;
            Cooldown = Mathf.Max(0, Runtime(w).readyAt - now);
            fx.Notify(WeaponNote.Switched, w, old);
            return old;
        }

        /// <summary>停下当前武器进行中的动作（切枪、拾取替换、死亡、换关）：flush = 齐射剩余弹体立即打完；换弹中断（逐发已压入的算部分完成）</summary>
        public void StopActions(bool flush)
        {
            var w = Active;
            var mode = Runtime(w)?.mode;
            mode?.Stop(this, flush);
            if (Reloading) CancelReload();
            trigger.buffer = 0;
            autoReload = 0;
            if (w != null && mode != null)
            {
                w.spin = mode.Spin;
                w.charge = mode.Charge;
            }
            fx.Notify(WeaponNote.Stopped, w, null);
        }

        // ───────────── 换关 / 弹药 / 跨关 ─────────────

        /// <summary>
        /// 换关 / 开局（同 TS clear）：进行中的换弹直接完成（换关有黑场，不用在新关开头重按 R），不发事件；停下一切动作、清冷却与计时
        /// </summary>
        public void ClearForStage()
        {
            var w = Active;
            if (Reloading && w != null)
            {
                var R = resolve(w);
                int take = Mathf.Min(Mathf.Max(0, R.magCap - w.mag), Mathf.Max(0, w.reserve));
                w.mag += take;
                w.reserve -= take;
                w.cycleIndex = 0;
            }
            Reloading = false;
            ShellReload = false;
            reloadWeapon = null;
            StopActions(false);
            Cooldown = 0;
            starved = 0;
            dryTimer = 0;
            fx.Notify(WeaponNote.Changed, w, null);
        }

        /// <summary>
        /// 按备弹上限的比例补备弹（同 TS addAmmoFraction）：已满的跳过，否则至少补 1 发。换关 0.35、弹药掉落、商店都走它。返回是否补了
        /// </summary>
        public bool AddAmmoFraction(float frac)
        {
            if (!(frac > 0)) return false;
            bool any = false;
            foreach (var w in slots)
            {
                if (w == null) continue;
                int cap = resolve(w).reserveCap;
                if (w.reserve >= cap) continue;
                w.reserve = Mathf.Min(cap, w.reserve + Mathf.Max(1, Mathf.CeilToInt(cap * frac)));
                any = true;
            }
            return any;
        }

        /// <summary>跨关恢复 / 外部改了槽位之后：清掉全部进行中的状态（不发任何事件），active 无效时回到 0 号槽</summary>
        public void Reset(int active)
        {
            foreach (var w in slots)
                if (w != null) Runtime(w).mode.Stop(this, false);
            Reloading = false;
            ShellReload = false;
            ShellsInserted = 0;
            reloadWeapon = null;
            ActiveSlot = active >= 0 && active < slots.Length && slots[active] != null ? active : 0;
            SwitchTimer = 0;
            Holster = null;
            Cooldown = 0;
            trigger.Reset();
            autoReload = 0;
            starved = 0;
            dryTimer = 0;
        }
    }
}
