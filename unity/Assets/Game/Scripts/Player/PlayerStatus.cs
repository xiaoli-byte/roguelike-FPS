using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩家身上的减益宿主（和敌人的 <see cref="EnemyStatus"/> 共用 <see cref="IStatusEffect"/> 注册表，只接受 Hosts 含 Player 的状态）：
    ///   寒意 <see cref="ChillStatus"/>：移速降低，取最强的一条，上限 70%（写进 PlayerMotor.walkSpeed，由 PlayerVitals 统一换算）
    ///   日晒灼烧 <see cref="SunburnStatus"/>：暴露叠层、离开消退、按层数跳火伤（旱魃）
    ///   点燃 <see cref="IgniteStatus"/>：每 0.5 s 一跳火伤，重复点燃只刷新时长、取较大跳伤（毕方）
    /// 跳伤一律经 <see cref="Combat.DamagePlayer"/>（冲刺无敌帧、减伤、受伤修饰器照常）。阵亡时清空，复活时由 PlayerVitals 清空。
    /// PlayerVitals 在 Awake 里确保它挂在玩家身上（旧场景不用重建）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PlayerStatus : MonoBehaviour, IStatusHost
    {
        public static PlayerStatus Instance { get; private set; }

        static readonly int SlotCount = Enum.GetValues(typeof(StatusId)).Length;

        StatusInstance[] slots;
        PlayerVitals vitals;

        /// <summary>移速倍率（寒意等，取所有状态里最小的）：PlayerVitals 乘到 walkSpeed 上</summary>
        public float SpeedMult { get; private set; } = 1f;

        /// <summary>挂上 / 刷新一个状态（状态, 当前层数）</summary>
        public event Action<StatusId, int> Applied;

        StatusHosts IStatusHost.Kind => StatusHosts.Player;

        /// <summary>此刻身上的减益</summary>
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

        public bool Has(StatusId id) => slots != null && (int)id < slots.Length && slots[(int)id] is { Active: true };

        public bool TryGet(StatusId id, out StatusView view)
        {
            var inst = slots != null && (int)id < slots.Length ? slots[(int)id] : null;
            if (inst != null && inst.Active) return inst.TryGet(out view);
            view = new StatusView { id = id };
            return false;
        }

        /// <summary>某个状态的运行时实例（没挂过为 null）：ChillInstance / SunburnInstance / IgniteInstance</summary>
        public T Get<T>(StatusId id) where T : StatusInstance => slots != null && (int)id < slots.Length ? slots[(int)id] as T : null;

        // ───────────── 施加 ─────────────

        /// <summary>施加一个玩家状态（阵亡时忽略；不能挂在玩家身上的状态忽略）。返回是否挂上</summary>
        public bool Apply(StatusId id, in StatusApply a)
        {
            if (!vitals || vitals.Dead) return false;
            var inst = Slot(id);
            if (inst == null || !inst.Apply(a)) return false;
            RefreshSpeed();
            return true;
        }

        /// <summary>寒意：移速降低 slow（0.35 = −35%，&gt; 1 按百分数），持续 seconds 秒；取最强的一条，上限 70%</summary>
        public static bool Chill(float slow, float seconds)
        {
            var s = Instance;
            return s && s.Apply(StatusId.Chill, new StatusApply(slow, seconds));
        }

        /// <summary>点燃：seconds 秒内每 0.5 s 一跳 tickDamage 火伤；已在燃烧时只刷新时长并取较大跳伤</summary>
        public static bool Ignite(float seconds, float tickDamage)
        {
            var s = Instance;
            return s && s.Apply(StatusId.Ignite, new StatusApply(tickDamage, seconds));
        }

        /// <summary>
        /// 日晒：这一段暴露了 seconds 秒（首领每次判定到玩家在日光下就调用，传判定间隔）。gain = 叠层速度（踩浅水 &lt; 1）；
        /// damagePerStack &gt; 0 时改写每层每跳的伤害（按首领难度）；sun = 日光来自哪里（受击方向）。
        /// </summary>
        public static bool SunExposure(float seconds, float gain = 1f, float damagePerStack = 0, Vector3? sun = null)
        {
            var s = Instance;
            if (!s || !(seconds > 0) || !(gain > 0)) return false;
            if (!s.Apply(StatusId.Sunburn, new StatusApply(seconds * gain))) return false;
            var inst = s.Get<SunburnInstance>(StatusId.Sunburn);
            if (inst != null)
            {
                if (damagePerStack > 0) inst.damagePerStack = damagePerStack;
                if (sun.HasValue) inst.sun = sun;
            }
            return true;
        }

        /// <summary>清掉全部减益（复活、换关）</summary>
        public void ClearAll()
        {
            if (slots != null)
                foreach (var s in slots)
                    s?.Clear();
            RefreshSpeed();
        }

        // ───────────── 宿主 ─────────────

        StatusInstance Slot(StatusId id)
        {
            slots ??= new StatusInstance[SlotCount];
            int i = (int)id;
            if (i < 0 || i >= slots.Length) return null;
            if (slots[i] != null) return slots[i];
            var def = StatusRegistry.Get(id);
            if (def == null || (def.Hosts & StatusHosts.Player) == 0) return null;
            return slots[i] = def.Create(this);
        }

        /// <summary>状态实例挂上 / 刷新时回报（监听者抛异常只报错）</summary>
        public void Notify(StatusId id, int stacks)
        {
            try
            {
                Applied?.Invoke(id, stacks);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>减益跳伤：经 Combat.DamagePlayer（无敌帧期间落空）；from 缺省为玩家自己的位置</summary>
        internal void Hurt(float amount, Element e, Vector3? from)
        {
            if (!(amount > 0) || !vitals || vitals.Dead) return;
            Combat.DamagePlayer(amount, from ?? transform.position, e);
        }

        void RefreshSpeed()
        {
            float speed = 1f;
            if (slots != null)
                foreach (var s in slots)
                    if (s != null && s.Active)
                        speed = Mathf.Min(speed, s.SpeedMult);
            speed = Mathf.Clamp01(speed);
            if (Mathf.Abs(speed - SpeedMult) < 1e-4f) return;
            SpeedMult = speed;
            if (vitals) vitals.RefreshMotorSpeed();
        }

        void Awake()
        {
            Instance = this;
            vitals = GetComponent<PlayerVitals>();
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        void Update()
        {
            if (slots == null || !vitals) return;
            if (vitals.Dead)
            {
                if (Mask != StatusMask.None) ClearAll();
                return;
            }
            float dt = Time.deltaTime;
            foreach (var s in slots)
            {
                if (s == null || !s.Active) continue;
                s.Tick(dt);
                if (vitals.Dead) break;
            }
            RefreshSpeed();
        }
    }
}
