using System;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人身上的状态宿主（Three.js 版 src/combat/Status.ts 的 StatusSystem，按敌人拆开）：
    /// 每种状态的数值与推进逻辑在 Combat/Status/&lt;Id&gt;Status.cs（<see cref="IStatusEffect"/> 注册表，玩家减益共用同一张表），
    /// 这里只负责：第一次附着时挂到敌人身上、按 Three.js 的顺序每帧推进、汇总移速 / 承伤倍率、发事件、光晕、死亡清理。
    ///   灼烧：每层独立计时 4 s，最多 3 层，每 0.5 s 跳 Σ层强度 × 0.16（<see cref="BurnStatus"/>）
    ///   雷殛：标记 3 s，直接命中附着时向 8 m 内 3 个敌人弹射 强度 × 0.5；叠 3 层眩晕 0.8 s；带标记受雷伤 ×1.15（<see cref="ShockStatus"/>）
    ///   蚀化：5 s，每 0.5 s 跳 强度 × 0.08；期间承伤 ×1.2、移速 ×0.8（<see cref="CorrodeStatus"/>）
    ///   眩晕：精英 ×0.75，首领 ×0.35 且 ≤ 0.35 s、之后 6.1 s 免疫，<see cref="IStunPolicy"/> 霸体时忽略（<see cref="StunStatus"/>）
    ///   减速：最多 4 条，取最强的一条（<see cref="SlowStatus"/>）
    /// 强度 = 附着那一下的实际伤害（上限为敌人最大生命的一半），已除掉每一跳会乘回的元素 / 精英 / 首领加成（DamageCalc.StatusPowerFromDealt）。
    /// 持续伤害走 Combat.DamageEnemy（source Status，带 Dot 标签，不暴击、不再附着）；不可选中期间照常计时，只是这一跳打不到、也不出声。
    /// 元素相遇的反应判定在 <see cref="ReactionSystem"/>（附着之前判定）。不可选中的敌人不会被施加任何状态。
    /// 每次挂上状态发 <see cref="Applied"/> 与 <see cref="GameEvents.StatusApplied"/>；死亡瞬间身上的状态记在 <see cref="DiedWith"/>。
    /// </summary>
    public sealed class EnemyStatus : MonoBehaviour, IStatusHost
    {
        // 旧常量（转发到各状态的定义，数值不变）
        public const float BurnDuration = BurnStatus.Duration, BurnTick = BurnStatus.TickInterval, BurnRatio = BurnStatus.Ratio;
        public const int BurnMaxStacks = BurnStatus.MaxStacks;
        public const float ShockDuration = ShockStatus.Duration, ShockChainRange = ShockStatus.ChainRange, ShockChainRatio = ShockStatus.ChainRatio,
            ShockStun = ShockStatus.StunSeconds, ShockMarkBonus = ShockStatus.MarkBonus;
        public const int ShockChainTargets = ShockStatus.ChainTargets, ShockStunStacks = ShockStatus.StunStacks;
        public const float CorrodeDuration = CorrodeStatus.Duration, CorrodeTick = CorrodeStatus.TickInterval, CorrodeRatio = CorrodeStatus.Ratio,
            CorrodeTaken = CorrodeStatus.Taken, CorrodeSlow = CorrodeStatus.SpeedFactor;
        /// <summary>状态强度上限：敌人最大生命 × 0.5（同 Three.js STATUS_POWER_CAP）</summary>
        public const float PowerCap = 0.5f;

        static readonly int SlotCount = Enum.GetValues(typeof(StatusId)).Length;
        static bool warnedMissing;

        StatusInstance[] slots;
        Damageable hp;

        public Damageable Health => hp;
        StatusHosts IStatusHost.Kind => StatusHosts.Enemy;

        public bool Burning => IsActive(StatusId.Burn);
        public int BurnStacks => slots?[(int)StatusId.Burn] is BurnInstance b ? b.Stacks : 0;
        public bool Shocked => IsActive(StatusId.Shock);
        public int ShockStacks => slots?[(int)StatusId.Shock] is ShockInstance s ? s.Stacks : 0;
        public float ShockPower => slots?[(int)StatusId.Shock] is ShockInstance s ? s.Power : 0;
        public bool Corroded => IsActive(StatusId.Corrode);
        public bool Stunned => IsActive(StatusId.Stun);
        /// <summary>移速倍率（蚀化 ×0.8、减速取最强的一条，两者取小），AI 移动时乘上</summary>
        public float SlowMult { get; private set; } = 1f;

        /// <summary>挂上一个状态（状态, 当前层数）</summary>
        public event Action<StatusId, int> Applied;
        /// <summary>最近一次挂上的状态与时间（没有过为 null / −1）</summary>
        public StatusId? LastApplied { get; private set; }
        public float LastAppliedAt { get; private set; } = -1;
        /// <summary>死亡瞬间身上的状态（击杀时效果用：之后状态会被清空）</summary>
        public StatusMask DiedWith { get; private set; }

        /// <summary>此刻身上的状态</summary>
        public StatusMask Mask
        {
            get
            {
                var m = StatusMask.None;
                if (slots == null) return m;
                for (int i = 0; i < slots.Length; i++)
                    if (slots[i] != null && slots[i].Active) m |= (StatusMask)(1 << i);
                return m;
            }
        }

        bool IsActive(StatusId id) => slots != null && slots[(int)id] is { Active: true };

        public static EnemyStatus Of(Damageable d) => d ? d.GetComponent<EnemyStatus>() : null;

        /// <summary>元素 → 它附着的状态（None 没有）</summary>
        public static StatusId? StatusOf(Element e) => e switch
        {
            Element.Fire => StatusId.Burn,
            Element.Shock => StatusId.Shock,
            Element.Corrode => StatusId.Corrode,
            _ => null,
        };

        /// <summary>持续伤害的状态 → 每一跳结算用的元素（决定吃哪一类元素加成）；不是元素状态为 None</summary>
        public static Element ElementOf(StatusId id) => id switch
        {
            StatusId.Burn => Element.Fire,
            StatusId.Shock => Element.Shock,
            StatusId.Corrode => Element.Corrode,
            _ => Element.None,
        };

        /// <summary>敌人死亡瞬间身上的状态（从没挂过状态的为 None）</summary>
        public static StatusMask DeathStatuses(Damageable d)
        {
            var s = Of(d);
            return s ? s.DiedWith : StatusMask.None;
        }

        public static bool TryGet(Damageable d, StatusId id, out StatusView view)
        {
            var s = Of(d);
            if (s) return s.TryGet(id, out view);
            view = new StatusView { id = id };
            return false;
        }

        /// <summary>读某个状态：身上没有返回 false</summary>
        public bool TryGet(StatusId id, out StatusView view)
        {
            var inst = slots != null && (int)id < slots.Length ? slots[(int)id] : null;
            if (inst != null && inst.Active) return inst.TryGet(out view);
            view = new StatusView { id = id };
            return false;
        }

        /// <summary>某个状态的运行时实例（没挂过为 null）：BurnInstance / ShockInstance…</summary>
        public T Instance<T>(StatusId id) where T : StatusInstance => slots != null && (int)id < slots.Length ? slots[(int)id] as T : null;

        public static bool IsBurning(Damageable d)
        {
            var s = Of(d);
            return s && s.Burning;
        }

        public static bool Has(Damageable d, Element e)
        {
            var s = Of(d);
            if (!s) return false;
            return e switch
            {
                Element.Fire => s.Burning,
                Element.Shock => s.Shocked,
                Element.Corrode => s.Corroded,
                _ => false,
            };
        }

        /// <summary>此刻免疫眩晕（<see cref="IStunPolicy"/>，或首领还在上次眩晕后的免疫期里）</summary>
        public static bool StunImmune(Damageable d)
        {
            if (!d || StunStatus.Immune(d)) return true;
            if (d.rank != Rank.Boss) return false;
            var s = Of(d);
            var stun = s ? s.Instance<StunInstance>(StatusId.Stun) : null;
            return stun != null && stun.ImmuneRemaining > 0;
        }

        // ───────────── 施加 ─────────────

        /// <summary>
        /// 附着元素状态。killed = 这一击已经打死了它：只做雷殛弹射（深度 0），不再挂状态。
        /// 调用前由 <see cref="ReactionSystem.TryReact"/> 判定反应（反应不消耗两两状态，所以照常附着）。
        /// power = 状态强度（不含元素 / 精英 / 首领加成，每一跳结算时再乘）。返回是否挂上（击杀那一击的雷殛弹射也算）。
        /// </summary>
        public static bool Apply(Damageable d, Element e, float power, int depth, bool killed)
        {
            if (!d || e == Element.None || !(power > 0) || d.untargetable) return false;
            power = Mathf.Min(power, d.maxHealth * PowerCap);
            if (killed || d.Dead)
            {
                if (e != Element.Shock || depth != 0) return false;
                ShockStatus.ChainFrom(d, power, depth);
                return true;
            }
            var id = StatusOf(e);
            return id.HasValue && Apply(d, id.Value, new StatusApply(power, 0, depth));
        }

        /// <summary>
        /// 施加任意状态（带时长等选项，见 <see cref="StatusApply"/>）：死亡 / 不可选中的敌人忽略；眩晕在霸体时连组件都不挂。
        /// 元素状态不经过这里判定反应——要判定反应走 <see cref="Combat.ApplyElement"/>。返回是否挂上。
        /// </summary>
        public static bool Apply(Damageable d, StatusId id, in StatusApply a)
        {
            if (!d || d.Dead || d.untargetable) return false;
            if (id == StatusId.Stun && StunStatus.Immune(d)) return false;
            var s = Ensure(d);
            var inst = s.Slot(id);
            if (inst == null || !inst.Apply(a)) return false;
            s.enabled = true;
            return true;
        }

        /// <summary>眩晕（精英 ×0.75、首领 ×0.35 且 ≤ 0.35 s 后 6.1 s 免疫、霸体忽略）：返回是否眩晕上了</summary>
        public static bool Stun(Damageable d, float seconds) => seconds > 0 && Apply(d, StatusId.Stun, new StatusApply(0, seconds));

        /// <summary>减速 strength（0.3 = −30%，上限 90%）seconds 秒</summary>
        public static void Slow(Damageable d, float strength, float seconds)
        {
            if (strength > 0) Apply(d, StatusId.Slow, new StatusApply(strength, seconds));
        }

        // ───────────── 反应支持（归墟消耗、崩解查询） ─────────────

        /// <summary>归墟消耗灼烧：清空并返回剩余伤害的结清值（与强度同口径、不含属性倍率，按跳伤计时对齐）</summary>
        public float ConsumeBurn() => Instance<BurnInstance>(StatusId.Burn)?.Consume() ?? 0;

        /// <summary>归墟消耗雷殛：直接移除（雷殛没有结清值）</summary>
        public void ConsumeShock() => Instance<ShockInstance>(StatusId.Shock)?.Clear();

        /// <summary>
        /// 持续伤害剩下的跳伤还会造成的总量（不改状态；崩解用）：按共享的跳伤计时对齐——剩余 r 秒、下一跳在 t 秒后时还剩 ⌊(r − t) / 间隔⌋ + 1 跳，
        /// 再乘每一跳会吃到的属性倍率（元素 / 精英 / 首领，<see cref="DamageCalc.DotStatMultiplier(Damageable, Element)"/>）。
        /// 崩解伤害带反应标签、只再乘「反应伤害」，所以这里先把属性倍率乘进去。只有灼烧、蚀化有跳伤，其余返回 0。同 Three.js dotRemaining。
        /// </summary>
        public float RemainingDot(StatusId id)
        {
            float raw = RemainingDotRaw(id);
            return raw > 0 ? raw * DamageCalc.DotStatMultiplier(hp, ElementOf(id)) : 0;
        }

        /// <summary>剩余跳伤总量（与强度同口径，不含属性倍率、未计分层与修饰器）</summary>
        public float RemainingDotRaw(StatusId id)
        {
            var inst = slots != null && (int)id < slots.Length ? slots[(int)id] : null;
            return inst != null && inst.Active ? inst.RemainingDotRaw : 0;
        }

        /// <summary>某个敌人身上持续伤害的剩余总量（含属性倍率，见 <see cref="RemainingDot(StatusId)"/>）；没有状态为 0</summary>
        public static float RemainingDot(Damageable d, StatusId id)
        {
            var s = Of(d);
            return s ? s.RemainingDot(id) : 0;
        }

        /// <summary>雷殛弹射（兼容旧接口）：见 <see cref="ShockStatus.ChainFrom"/></summary>
        public static void ChainFrom(Damageable source, float power, int depth) => ShockStatus.ChainFrom(source, power, depth);

        // ───────────── 宿主 ─────────────

        static EnemyStatus Ensure(Damageable d)
        {
            var s = d.GetComponent<EnemyStatus>();
            return s ? s : d.gameObject.AddComponent<EnemyStatus>();
        }

        /// <summary>取（没有就按注册表新建）某个状态的实例；注册表里没有、或不能挂在敌人身上时为 null</summary>
        StatusInstance Slot(StatusId id)
        {
            slots ??= new StatusInstance[SlotCount];
            int i = (int)id;
            if (i < 0 || i >= slots.Length) return null;
            if (slots[i] != null) return slots[i];
            var def = StatusRegistry.Get(id);
            if (def == null || (def.Hosts & StatusHosts.Enemy) == 0)
            {
                if (!warnedMissing)
                {
                    warnedMissing = true;
                    Debug.LogWarning($"[Status] 没有可以挂在敌人身上的 {id} 定义");
                }
                return null;
            }
            return slots[i] = def.Create(this);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => warnedMissing = false;

        /// <summary>状态实例挂上 / 刷新时回报：记最近附着、发事件（监听者抛异常只报错）</summary>
        public void Notify(StatusId id, int stacks)
        {
            LastApplied = id;
            LastAppliedAt = Time.time;
            try
            {
                Applied?.Invoke(id, stacks);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            GameEvents.RaiseStatusApplied(hp, id, stacks);
        }

        internal Vector3 Center
        {
            get
            {
                var col = GetComponent<Collider>();
                return col && col.enabled ? col.bounds.center : transform.position + Vector3.up;
            }
        }

        /// <summary>
        /// 一跳持续伤害：走 Combat.DamageEnemy（source Status、Dot 标签、深度 1）。不可选中时这一跳打不到，也不出声、不弹「免疫」；
        /// 不到 0.01 的跳伤忽略（同 Three.js）。跳伤声全局节流（<see cref="StatusAudio"/>）。
        /// </summary>
        internal void Dot(float amount, Element e)
        {
            if (!(amount > 0.01f) || !hp || hp.Dead || hp.untargetable) return;
            var c = Center;
            var info = DamageInfo.Simple(amount, DamageSource.Status, c, Vector3.up);
            info.element = e;
            info.depth = 1;
            info.tags = DamageTag.Dot;
            info.noCrit = true;
            Combat.DamageEnemy(hp, info);
            StatusAudio.DotTick(e, transform.position + Vector3.up);
        }

        /// <summary>
        /// 旧的状态光晕面片：FX2 起状态外观由 <see cref="StatusFx"/> 接管（身体着色 + 骨骼上的火舌 / 电弧 / 蚀液…，FxDirector 在 StatusApplied 时挂上），
        /// 这里不再生成面片（glow 保持 null，各状态的 UpdateVisual 本来就判空）
        /// </summary>
        internal void Glow(ref Transform glow, Color c, Vector3 offset)
        {
        }

        void Awake()
        {
            hp = GetComponent<Damageable>();
            if (hp) hp.Died += OnOwnerDied;
        }

        void OnDestroy()
        {
            if (hp) hp.Died -= OnOwnerDied;
        }

        // 死亡事件在状态清空（下一次 Update）之前：记下这一刻身上有什么
        void OnOwnerDied(DamageInfo info) => DiedWith = Mask;

        /// <summary>
        /// 推进顺序同 Three.js StatusSystem.update：先推进减速、写入移速 / 承伤倍率（本帧的跳伤也吃到蚀化易伤），
        /// 再按 灼烧 → 雷殛 → 蚀化 → 眩晕 推进；跳伤打死了就停（死亡清理在下一帧）。
        /// </summary>
        void Update()
        {
            if (!hp || hp.Dead)
            {
                if (slots != null)
                    foreach (var s in slots)
                        s?.Clear();
                SlowMult = 1f;
                if (hp) hp.statusTakenMult = 1f;
                UpdateVisuals();
                enabled = false;
                return;
            }
            if (slots == null) return;
            float dt = Time.deltaTime;
            var slow = slots[(int)StatusId.Slow];
            if (slow != null && slow.Active) slow.Tick(dt);
            float speed = 1f, taken = 1f;
            foreach (var s in slots)
            {
                if (s == null || !s.Active) continue;
                speed = Mathf.Min(speed, s.SpeedMult);
                taken *= s.TakenMult;
            }
            SlowMult = speed;
            hp.statusTakenMult = taken;
            for (int i = 0; i < slots.Length; i++)
            {
                var s = slots[i];
                if (s == null || s == slow || !s.Active) continue;
                s.Tick(dt);
                if (hp.Dead) break;
            }
            UpdateVisuals();
        }

        void UpdateVisuals()
        {
            if (slots == null) return;
            float pulse = Mathf.Sin(Time.time * 13) * 0.15f;
            foreach (var s in slots) s?.UpdateVisual(pulse);
        }
    }
}
