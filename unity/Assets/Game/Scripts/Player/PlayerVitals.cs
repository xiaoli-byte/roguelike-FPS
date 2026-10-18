using System;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩家生命与护盾（Three.js 版 PlayerController.takeDamage / 护盾回复）：
    ///   受击 → 冲刺无敌帧内免疫 → × (1 − 减伤，上限 80%) → 护盾先吃，溢出扣生命 → 重置回盾计时；
    ///   不受伤 shieldRegenDelay（3 s）后以 shieldRegenRate（30/s）回盾；生命归零死亡。
    /// 属性来自 <see cref="StatSheet"/>（英雄基础值 + 卷轴），变化时上限同步、当前值按比例保持。
    /// </summary>
    [RequireComponent(typeof(PlayerMotor))]
    public sealed class PlayerVitals : MonoBehaviour
    {
        public static PlayerVitals Instance { get; private set; }

        public StatSheet stats;
        [NonSerialized] public float health, shield;
        public float MaxHealth => stats.Get(Stat.MaxHp);
        public float MaxShield => stats.Get(Stat.MaxShield);
        public bool Dead { get; private set; }
        /// <summary>最近一次受伤的时间（HUD 受击闪红）</summary>
        public float LastHitTime { get; private set; } = -10;

        public event Action ShieldBroken;
        public event Action Died;

        PlayerMotor motor;
        float lastDamage = -10;
        float lastMaxHp, lastMaxShield;

        void Awake()
        {
            Instance = this;
            motor = GetComponent<PlayerMotor>();
            stats ??= StatSheet.Default();
            Combat.playerStats = stats;
            health = lastMaxHp = MaxHealth;
            shield = lastMaxShield = MaxShield;
            stats.Changed += OnStatsChanged;
            ApplyMotorStats();
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        void OnStatsChanged()
        {
            // 上限变化：当前值按增量同步（加上限时一并加当前值，减上限时截断）
            float hp = MaxHealth, sh = MaxShield;
            health = Mathf.Clamp(health + Mathf.Max(0, hp - lastMaxHp), 0, hp);
            shield = Mathf.Clamp(shield + Mathf.Max(0, sh - lastMaxShield), 0, sh);
            lastMaxHp = hp;
            lastMaxShield = sh;
            ApplyMotorStats();
        }

        void ApplyMotorStats()
        {
            motor.walkSpeed = stats.Get(Stat.MoveSpeed);
            motor.dashCooldown = stats.Get(Stat.DashCooldown);
            motor.dashCharges = Mathf.Max(1, Mathf.RoundToInt(stats.Get(Stat.DashCharges)));
        }

        /// <summary>返回实际扣除的量（护盾 + 生命）</summary>
        public float TakeDamage(float amount, Vector3 from)
        {
            if (Dead || amount <= 0 || motor.Invulnerable) return 0;
            amount *= 1 - Mathf.Clamp(stats.Get(Stat.DamageReduction), 0, 0.8f);
            lastDamage = LastHitTime = Time.time;
            float toShield = Mathf.Min(shield, amount);
            bool hadShield = shield > 0;
            shield -= toShield;
            float toHealth = amount - toShield;
            health -= toHealth;
            if (hadShield && shield <= 0) ShieldBroken?.Invoke();
            if (health <= 0)
            {
                health = 0;
                Dead = true;
                motor.inputEnabled = false;
                Died?.Invoke();
            }
            return amount;
        }

        public void Heal(float amount)
        {
            if (Dead) return;
            health = Mathf.Min(MaxHealth, health + amount);
        }

        public void AddShield(float amount)
        {
            if (Dead) return;
            shield = Mathf.Min(MaxShield, shield + amount);
        }

        public void Revive()
        {
            Dead = false;
            health = MaxHealth;
            shield = MaxShield;
            motor.inputEnabled = true;
        }

        void Update()
        {
            if (Dead) return;
            if (shield < MaxShield && Time.time - lastDamage >= stats.Get(Stat.ShieldRegenDelay))
                shield = Mathf.Min(MaxShield, shield + stats.Get(Stat.ShieldRegenRate) * Time.deltaTime);
        }
    }
}
