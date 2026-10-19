using System;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩家生命与护盾（Three.js 版 PlayerController.takeDamage / 护盾回复）：
    ///   受击 → 冲刺无敌帧 / invulnerableUntil 内免疫 → × (1 − 减伤，上限 80%) → 受伤修饰器（<see cref="Incoming"/>）
    ///   → 护盾先吃，溢出扣生命 → 发 <see cref="GameEvents.PlayerHit"/>（在死亡判定之前：监听者可以把生命还回去免死）→ 死亡判定；
    ///   护盾被打空时响一声并轻震屏（0.25 / 0.2 s）；不受伤 shieldRegenDelay（3 s）后以 shieldRegenRate（30/s）回盾；
    ///   生命按 HpRegen（每秒）持续回复（不发 PlayerHealed，同 Three.js）；生命归零死亡。
    /// 属性来自 <see cref="StatSheet"/>（英雄基础值 + 卷轴），变化时上限同步、当前值按比例保持。
    /// 减益（寒意、日晒、点燃）在 <see cref="PlayerStatus"/>：走路速度 = 移速属性 × 减益的移速倍率（不改属性表）。
    /// PlayerMotor 在 Art.Runtime 程序集里，它的起跳 / 落地 / 冲刺由这里转发进 <see cref="GameEvents"/>。
    /// </summary>
    [RequireComponent(typeof(PlayerMotor))]
    public sealed class PlayerVitals : MonoBehaviour
    {
        public static PlayerVitals Instance { get; private set; }

        /// <summary>
        /// 受伤修饰器：返回倍率（1 = 不变，0 = 这一下不扣）。按优先级求值：<see cref="ModifierPriority.Multiplier"/>（0）的倍率先乘，
        /// <see cref="ModifierPriority.FinalAmount"/>（100）的看到的是接近最终的伤害（绝处逢生：致命伤返回 0 免死）。乘到 0 即停。
        /// </summary>
        public static readonly ModifierList<Incoming> Incoming = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Incoming.Clear();

        public StatSheet stats;
        [NonSerialized] public float health, shield;
        /// <summary>这个时刻之前不受伤（复活保护、调试无敌、免死后的保护）</summary>
        [NonSerialized] public float invulnerableUntil = -1;
        public float MaxHealth => stats.Get(Stat.MaxHp);
        public float MaxShield => stats.Get(Stat.MaxShield);
        public bool Dead { get; private set; }
        /// <summary>最近一次受伤的时间（HUD 受击闪红）</summary>
        public float LastHitTime { get; private set; } = -10;
        /// <summary>现在免疫伤害（冲刺无敌帧或 invulnerableUntil）</summary>
        public bool Invulnerable => (motor && motor.Invulnerable) || Time.time < invulnerableUntil;

        public event Action ShieldBroken;
        public event Action Died;

        PlayerMotor motor;
        PlayerStatus status;
        float lastDamage = -10;
        float lastMaxHp, lastMaxShield;

        /// <summary>玩家的减益（寒意、日晒、点燃）</summary>
        public PlayerStatus Status => status;

        void Awake()
        {
            Instance = this;
            motor = GetComponent<PlayerMotor>();
            // 旧场景（编辑期烘好的玩家）没有减益组件：运行时补上
            status = GetComponent<PlayerStatus>();
            if (!status) status = gameObject.AddComponent<PlayerStatus>();
            stats ??= StatSheet.Default();
            Combat.playerStats = stats;
            health = lastMaxHp = MaxHealth;
            shield = lastMaxShield = MaxShield;
            stats.Changed += OnStatsChanged;
            ApplyMotorStats();
            // 身体动作的声音（同 Three.js PlayerController：起跳、落地按下落速度、冲刺、脚步按跑速），并转发到事件总线
            if (motor)
            {
                motor.Jumped += air =>
                {
                    GameAudio.Play("jump", air ? 0.8f : 0.7f, air ? 1.2f : 0.95f + UnityEngine.Random.value * 0.1f);
                    GameEvents.RaisePlayerJumped(air);
                };
                motor.Landed += fall =>
                {
                    GameAudio.Play("land", Mathf.Clamp(0.25f + fall / 16f, 0.25f, 1f), Mathf.Clamp(1.15f - fall / 60f, 0.8f, 1.15f));
                    GameEvents.RaisePlayerLanded(fall);
                };
                motor.Dashed += () =>
                {
                    GameAudio.Play("dash", 0.8f, 0.95f + UnityEngine.Random.value * 0.1f);
                    GameEvents.RaisePlayerDashed(motor.DashDirection);
                };
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

        /// <summary>走路速度 = 移速属性 × 减益的移速倍率（寒意）。减益变化时由 PlayerStatus 调用</summary>
        internal void RefreshMotorSpeed()
        {
            if (motor && stats != null) motor.walkSpeed = stats.Get(Stat.MoveSpeed) * (status ? status.SpeedMult : 1f);
        }

        void ApplyMotorStats()
        {
            RefreshMotorSpeed();
            motor.dashCooldown = stats.Get(Stat.DashCooldown);
            motor.dashCharges = Mathf.Max(1, Mathf.RoundToInt(stats.Get(Stat.DashCharges)));
            // 额外跳跃（二段跳）：以前 airJumps 没有任何地方赋值，秘卷给的 ExtraJumps 在这里生效
            motor.airJumps = Mathf.Max(0, Mathf.RoundToInt(stats.Get(Stat.ExtraJumps)));
        }

        struct IncomingCall : IModifierCall<Incoming>
        {
            public IncomingHit h;

            public float Invoke(Incoming fn, float current)
            {
                h.amount = current;
                return fn(in h);
            }
        }

        /// <summary>返回实际扣除的量（护盾 + 生命，减伤与修饰器之后）；element / source 只用于事件与修饰器</summary>
        public float TakeDamage(float amount, Vector3 from, Element element = Element.None, UnityEngine.Object source = null)
        {
            if (Dead || amount <= 0 || motor.Invulnerable || Time.time < invulnerableUntil) return 0;
            amount *= 1 - Mathf.Clamp(stats.Get(Stat.DamageReduction), 0, 0.8f);
            if (Incoming.Count > 0)
            {
                var call = new IncomingCall
                {
                    h = new IncomingHit
                    {
                        amount = amount, element = element, source = source, from = from,
                        info = new DamageInfo { amount = amount, element = element, source = DamageSource.Enemy, point = from, instigator = source },
                    },
                };
                amount = Incoming.Apply(amount, ref call, stopAtZero: true);
                if (!(amount > 0)) return 0;
            }
            lastDamage = LastHitTime = Time.time;
            float toShield = Mathf.Min(shield, amount);
            bool hadShield = shield > 0;
            shield -= toShield;
            float toHealth = amount - toShield;
            // 生命最多扣到 0（死亡判定前的监听者把这一击还回去时，还的是实际扣掉的量）
            float toHp = Mathf.Min(Mathf.Max(0, health), toHealth);
            health -= toHp;
            regenerating = false;
            // 必须在死亡判定之前派发：监听者可以在这里恢复生命以阻止死亡
            var hit = new PlayerHitEvent { amount = amount, toShield = toShield, toHp = toHp, element = element, source = source, from = from };
            GameEvents.RaisePlayerHit(in hit);
            // 受伤声：0.22 s 内只响一次，掉到生命时略尖
            if (Time.time - lastHurtSound >= 0.22f)
            {
                lastHurtSound = Time.time;
                GameAudio.Play("player_hurt", Mathf.Clamp(0.45f + amount / 40f, 0.45f, 1f), toHealth > 0 ? 1f : 1.15f);
            }
            if (hadShield && shield <= 0)
            {
                try
                {
                    ShieldBroken?.Invoke();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
                GameEvents.RaisePlayerShieldBroken();
                GameAudio.Play("shield_break", 0.9f);
                CameraShake.Add(0.25f, 0.2f);
            }
            // 读的是监听者处理之后的生命：被 PlayerHit 监听者救回来的不会死
            if (health <= 0 && !Dead)
            {
                health = 0;
                Dead = true;
                motor.inputEnabled = false;
                try
                {
                    Died?.Invoke();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
                GameEvents.RaisePlayerDied();
            }
            return amount;
        }

        /// <summary>回复生命：返回实际回复量（满血 / 死亡时为 0）</summary>
        public float Heal(float amount)
        {
            if (Dead) return 0;
            float before = health;
            health = Mathf.Min(MaxHealth, health + amount);
            float actual = health - before;
            if (actual > 0) GameEvents.RaisePlayerHealed(actual);
            return actual;
        }

        /// <summary>补充护盾：返回实际补充量</summary>
        public float AddShield(float amount)
        {
            if (Dead) return 0;
            float before = shield;
            shield = Mathf.Min(MaxShield, shield + amount);
            return shield - before;
        }

        public void Revive()
        {
            Dead = false;
            health = MaxHealth;
            shield = MaxShield;
            motor.inputEnabled = true;
            if (status) status.ClearAll();
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
            // 生命恢复（每秒 HpRegen；没有来源时为 0）
            float regen = stats.Get(Stat.HpRegen);
            if (regen > 0 && health < MaxHealth) health = Mathf.Min(MaxHealth, health + regen * Time.deltaTime);
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
