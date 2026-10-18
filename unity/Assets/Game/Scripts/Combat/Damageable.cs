using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 可受伤的单位（敌人、训练木桩）：护盾 / 护甲 / 生命三层，按 <see cref="DamageTable"/> 的元素倍率依次吃伤害。
    /// 敌人各自的特殊减伤（镇墓兽正面格挡、邪飞天琵琶护体…）通过 <see cref="incomingModifier"/> 挂进来，
    /// 返回乘数（0.1 = 只吃一成）。
    /// </summary>
    public sealed class Damageable : MonoBehaviour
    {
        public float maxHealth = 100, maxArmor, maxShield;
        /// <summary>显示名（头顶血条、精英名）</summary>
        public string displayName;
        public bool elite;
        /// <summary>不给击杀奖励、不计入场地击杀（蜃景分身等召唤物）</summary>
        public bool noReward;
        [NonSerialized] public float health, armor, shield;
        /// <summary>无法被选中（遁地、出生、死亡中）：子弹穿过、显示「免疫」</summary>
        [NonSerialized] public bool untargetable;
        /// <summary>承伤倍率（邪飞天光环 ×0.75、祝福 ×0.5 等相乘）</summary>
        [NonSerialized] public float damageTakenMult = 1f;
        /// <summary>元素状态的承伤倍率（蚀化 ×1.2），由 EnemyStatus 每帧写入；和光环那一份分开，免得互相覆盖</summary>
        [NonSerialized] public float statusTakenMult = 1f;
        public Func<DamageInfo, float> incomingModifier;

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

        /// <summary>已算好倍率（暴击、加成）后的伤害按层结算；返回实际造成的伤害</summary>
        public DamageResult ApplyLayers(DamageInfo info, float amount, bool crit)
        {
            var r = new DamageResult { crit = crit, layer = DamageLayer.Health };
            if (Dead) return r;
            if (untargetable)
            {
                r.immune = true;
                return r;
            }
            float mod = incomingModifier != null ? incomingModifier(info) : 1f;
            if (mod < 0.5f) r.blocked = true;
            float left = amount * mod * damageTakenMult * statusTakenMult;

            // 每一层：剩余伤害 × 该层元素倍率，吃不完的按倍率折回原始量继续往下
            left = Eat(ref shield, left, DamageTable.LayerMult(info.element, DamageLayer.Shield), ref r.shield, ref r, DamageLayer.Shield);
            left = Eat(ref armor, left, DamageTable.LayerMult(info.element, DamageLayer.Armor), ref r.armor, ref r, DamageLayer.Armor);
            Eat(ref health, left, DamageTable.LayerMult(info.element, DamageLayer.Health), ref r.health, ref r, DamageLayer.Health);
            r.total = r.shield + r.armor + r.health;
            if (health <= 0 && !Dead)
            {
                Dead = true;
                r.killed = true;
            }
            Damaged?.Invoke(info, r);
            if (r.killed) Died?.Invoke(info);
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
