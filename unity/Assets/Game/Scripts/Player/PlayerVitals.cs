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
            // 身体动作的声音（同 Three.js PlayerController：起跳、落地按下落速度、冲刺、脚步按跑速）
            if (motor)
            {
                motor.Jumped += air => GameAudio.Play("jump", air ? 0.8f : 0.7f, air ? 1.2f : 0.95f + UnityEngine.Random.value * 0.1f);
                motor.Landed += fall => GameAudio.Play("land", Mathf.Clamp(0.25f + fall / 16f, 0.25f, 1f), Mathf.Clamp(1.15f - fall / 60f, 0.8f, 1.15f));
                motor.Dashed += () => GameAudio.Play("dash", 0.8f, 0.95f + UnityEngine.Random.value * 0.1f);
                motor.Footstep += run => GameAudio.Play("footstep", 0.35f + 0.25f * Mathf.Clamp(run, 0.4f, 1.3f), 0.9f + UnityEngine.Random.value * 0.2f);
            }
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
            // 受伤声：0.22 s 内只响一次，掉到生命时略尖
            if (Time.time - lastHurtSound >= 0.22f)
            {
                lastHurtSound = Time.time;
                GameAudio.Play("player_hurt", Mathf.Clamp(0.45f + amount / 40f, 0.45f, 1f), toHealth > 0 ? 1f : 1.15f);
            }
            regenerating = false;
            if (hadShield && shield <= 0)
            {
                ShieldBroken?.Invoke();
                GameAudio.Play("shield_break", 0.9f);
            }
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

        float lastHurtSound = -1, heartbeat;
        bool regenerating;

        void Update()
        {
            if (Dead) return;
            if (shield < MaxShield && Time.time - lastDamage >= stats.Get(Stat.ShieldRegenDelay))
            {
                // 开始回盾时响一声（同 Three.js shield_recharge）
                if (!regenerating)
                {
                    regenerating = true;
                    GameAudio.Play("shield_recharge", 0.6f);
                }
                shield = Mathf.Min(MaxShield, shield + stats.Get(Stat.ShieldRegenRate) * Time.deltaTime);
            }
            else if (shield >= MaxShield) regenerating = false;
            // 低血量心跳：三成以下，血越少越急
            float ratio = health / Mathf.Max(1, MaxHealth);
            if (ratio < 0.3f)
            {
                heartbeat -= Time.deltaTime;
                if (heartbeat <= 0)
                {
                    float t = ratio / 0.3f;
                    GameAudio.Play("low_hp", Mathf.Lerp(1f, 0.55f, t));
                    heartbeat = Mathf.Lerp(0.55f, 1f, t);
                }
            }
            else heartbeat = 0;
        }
    }
}
