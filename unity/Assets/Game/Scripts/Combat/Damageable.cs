using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 可受伤的单位（敌人、训练木桩）：护盾 / 护甲 / 生命三层，按 <see cref="DamageCalc.LayerMultiplier"/> 的元素倍率依次吃伤害。
    /// 敌人各自的特殊减伤（镇墓兽正面格挡、邪飞天琵琶护体…）登记到 <see cref="Incoming"/>，返回乘数（0.1 = 只吃一成），
    /// 乘积低于 0.5 记为「格挡」。
    /// </summary>
    public sealed class Damageable : MonoBehaviour
    {
        public float maxHealth = 100, maxArmor, maxShield;
        /// <summary>显示名（头顶血条、精英名）</summary>
        public string displayName;
        /// <summary>级别：精英 / 首领吃「精英伤害 / 首领伤害」加成，眩晕等有各自的抗性</summary>
        public Rank rank;
        /// <summary>不给击杀奖励、不计入场地击杀（蜃景分身等召唤物）</summary>
        public bool noReward;
        [NonSerialized] public float health, armor, shield;
        /// <summary>无法被选中（遁地、出生、死亡中）：子弹穿过、显示「免疫」</summary>
        [NonSerialized] public bool untargetable;
        /// <summary>最近一次给它挂元素的出手者（持续伤害 / 反应伤害的 instigator 沿用它：灵宠挂的火烧死人不算玩家击杀标记）</summary>
        [NonSerialized] public UnityEngine.Object lastElementBy;
        /// <summary>承伤倍率（邪飞天光环 ×0.75、祝福 ×0.5 等相乘）</summary>
        [NonSerialized] public float damageTakenMult = 1f;
        /// <summary>元素状态的承伤倍率（蚀化 ×1.2），由 EnemyStatus 每帧写入；和光环那一份分开，免得互相覆盖</summary>
        [NonSerialized] public float statusTakenMult = 1f;
        /// <summary>
        /// 生命层下限（0 = 没有）：经伤害管线最多把生命打到这个值（首领的阶段门槛，见 <see cref="BossBrain"/>）。
        /// 单次基础伤害不低于最大生命的（处决、调试 / 测试的一刀）不受限制；<see cref="Kill"/> 也不受限制
        /// </summary>
        [NonSerialized] public float healthFloor;

        /// <summary>承伤修饰器（正面格挡、护体…）：返回倍率，全部相乘；乘积 &lt; 0.5 记为格挡</summary>
        public readonly ModifierList<Incoming> Incoming = new();

        /// <summary>精英（兼容旧字段：读写都映射到 <see cref="rank"/>）</summary>
        public bool elite
        {
            get => rank == Rank.Elite;
            set => rank = value ? Rank.Elite : rank == Rank.Elite ? Rank.Normal : rank;
        }

        public bool IsBoss => rank == Rank.Boss;

        Func<DamageInfo, float> legacyModifier;
        IDisposable legacyHandle;

        /// <summary>旧接口：单个承伤修饰（赋值即替换上一个），现在转登记到 <see cref="Incoming"/></summary>
        public Func<DamageInfo, float> incomingModifier
        {
            get => legacyModifier;
            set
            {
                legacyHandle?.Dispose();
                legacyHandle = null;
                legacyModifier = value;
                if (value != null) legacyHandle = Incoming.Add((in IncomingHit h) => value(h.info));
            }
        }

        public bool Dead { get; private set; }
        public float Fraction => maxHealth > 0 ? health / maxHealth : 0;

        public event Action<DamageInfo, DamageResult> Damaged;
        public event Action<DamageInfo> Died;

        void Awake() => ResetVitals();

        public void ResetVitals()
        {
            health = maxHealth;
            armor = maxArmor;
            shield = maxShield;
            Dead = false;
        }

        struct IncomingCall : IModifierCall<Incoming>
        {
            public IncomingHit h;
            public float raw;

            public float Invoke(Incoming fn, float current)
            {
                h.amount = raw * current;
                return fn(in h);
            }
        }

        /// <summary>
        /// 已算好倍率（暴击、加成）后的伤害按层结算；返回实际造成的伤害。
        /// 每一层：剩余伤害 × 该层倍率，吃不完的按倍率折回原始量继续往下（同 Three.js applyLayers）；bypassShield 跳过护盾层。
        /// </summary>
        public DamageResult ApplyLayers(DamageInfo info, float amount, bool crit)
        {
            var r = new DamageResult { crit = crit, layer = DamageLayer.Health, firstLayer = DamageLayer.Health };
            if (Dead) return r;
            if (untargetable)
            {
                r.immune = true;
                return r;
            }
            float mod = 1f;
            if (Incoming.Count > 0)
            {
                var call = new IncomingCall
                {
                    raw = amount,
                    h = new IncomingHit
                    {
                        amount = amount, element = info.element, target = this, info = info, crit = crit, source = info.instigator, from = info.point,
                    },
                };
                mod = Incoming.Apply(1f, ref call);
            }
            if (mod < 0.5f) r.blocked = true;
            float left = amount * mod * damageTakenMult * statusTakenMult;

            bool skipShield = info.bypassShield;
            r.firstLayer = shield > 0 && !skipShield ? DamageLayer.Shield : armor > 0 ? DamageLayer.Armor : DamageLayer.Health;
            bool hadShield = shield > 0, hadArmor = armor > 0;
            if (!skipShield) left = Eat(ref shield, left, DamageCalc.LayerMultiplier(info.element, DamageLayer.Shield), ref r.shield, ref r, DamageLayer.Shield);
            left = Eat(ref armor, left, DamageCalc.LayerMultiplier(info.element, DamageLayer.Armor), ref r.armor, ref r, DamageLayer.Armor);
            float healthMult = DamageCalc.LayerMultiplier(info.element, DamageLayer.Health);
            float floor = healthFloor > 0 && info.amount < maxHealth ? Mathf.Min(healthFloor, health) : 0;
            float above = health - floor;
            float overflow = Eat(ref above, left, healthMult, ref r.health, ref r, DamageLayer.Health);
            health = floor + above;
            r.total = r.shield + r.armor + r.health;
            // 溢出（击杀时的过量伤害）只在真打穿生命层时算；被生命下限挡下的部分不是伤害，不进伤害数字
            r.effective = r.total + (overflow > 0 && r.health > 0 && floor <= 0 ? overflow * healthMult : 0);
            r.shieldBroken = hadShield && !skipShield && shield <= 0;
            r.armorBroken = hadArmor && armor <= 0;
            if (health <= 0 && !Dead)
            {
                Dead = true;
                r.killed = true;
            }
            // 监听者（受击动画、琵琶）抛异常也要照常发死亡事件，不留「血空了却没死」的敌人
            try
            {
                Damaged?.Invoke(info, r);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            if (r.killed)
                try
                {
                    Died?.Invoke(info);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            return r;
        }

        static float Eat(ref float pool, float raw, float mult, ref float dealt, ref DamageResult r, DamageLayer layer)
        {
            if (raw <= 0 || pool <= 0) return raw;
            float dmg = raw * mult;
            if (dmg <= pool)
            {
                pool -= dmg;
                dealt += dmg;
                r.layer = layer;
                return 0;
            }
            dealt += pool;
            float usedRaw = pool / mult;
            pool = 0;
            r.layer = layer;
            return raw - usedRaw;
        }

        public void Heal(float amount) => health = Mathf.Min(maxHealth, health + amount);

        float timedShield, timedShieldUntil;

        /// <summary>限时护盾（邪飞天的和弦）：叠在护盾层上，到期时把没打掉的部分收回</summary>
        public void AddTimedShield(float amount, float duration)
        {
            if (Dead) return;
            ExpireTimedShield();
            timedShield = amount;
            timedShieldUntil = Time.time + duration;
            shield += amount;
        }

        public bool HasTimedShield => timedShield > 0 && shield > 0;

        void ExpireTimedShield()
        {
            if (timedShield <= 0) return;
            shield = Mathf.Max(0, shield - Mathf.Min(timedShield, shield));
            timedShield = 0;
        }

        void Update()
        {
            if (timedShield > 0 && (Time.time >= timedShieldUntil || shield <= 0)) ExpireTimedShield();
        }

        public void Kill(DamageInfo info)
        {
            if (Dead) return;
            health = 0;
            Dead = true;
            Died?.Invoke(info);
        }
    }
}
