using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 间歇熔泉（第三章 v2 共享改动 S3，docs/level-design/ch3-v2.md 2.7 / 7.2；3-2 ④ 熔泉炉坛、3-4 神道用）：地上一口结着岩壳的喷口，按周期喷熔柱。
    ///   · 一个周期：休止 → 预警 <see cref="warnTime"/>（1.2 s：地上品红圈 <see cref="TelegraphPalette.Danger"/> 填满、喷口鼓泡、壳缝越来越亮、咕嘟声）
    ///     → 喷发 <see cref="eruptTime"/>（1.5 s：熔柱冲起 <see cref="height"/> 米，半径 <see cref="radius"/>）→ 休止，直到下一个周期。
    ///     周期 <see cref="period"/> 秒，相位 <see cref="phase"/>（周期的分数）错开同一组熔泉；第一次预警在启用后 phase × period 秒。
    ///   · 喷发时熔柱里的东西每次喷发只挨一次：玩家扣最大生命 <see cref="playerDamage"/>（火、环境伤害）+ 往上掀起（<see cref="playerLaunch"/> m/s，带一点离开喷口的水平速度）；
    ///     地面敌人（非首领）扣最大生命 <see cref="enemyDamage"/> + 掀起（<see cref="EnemyAI.LaunchUp"/>，<see cref="enemyLaunch"/> m/s）并往外推——
    ///     掀起来的敌人落进熔岩算被打进去（<see cref="LavaField"/>：落地前一直算击退），所以熔泉也是玩家的武器；飞行敌人只扣血。
    ///   · 岩壳：<see cref="shell"/> 下的碰撞体挂命中盒（不给奖励、不计击杀，血量无限、每下回满）；玩家的子弹 / 近战 / 技能 / 爆炸在一个周期里累计打够
    ///     <see cref="shellHp"/> 就「提前引爆」——只预警 <see cref="detonateWarn"/> 秒就喷（也是陷阱：站在旁边的自己也会被掀）。喷完岩壳重新结上。
    ///   · 什么时候按周期喷：<see cref="startActive"/>（开局就喷）或 <see cref="SetCycling"/>；给了 <see cref="activeSite"/> 时只在那个场地交战时喷，肃清后停。
    ///     不按周期的时候喷口只冒点火星；射爆岩壳、<see cref="EruptNow"/>（演出 / 测试）随时可以喷。
    /// 外观（喷口、壳缝、熔柱）由关卡构建器摆好（<c>LevelKit.PlaceLavaGeyser</c>）：<see cref="column"/> 是熔柱（本地 Y 向上，高 1 的网格，运行时按高度缩放），
    /// <see cref="cracks"/> 是壳缝（自发光材质，按状态调亮度）。
    /// 事件：<see cref="Warned"/>、<see cref="Erupted"/>（每次喷发开始）、<see cref="HitPlayer"/>、<see cref="LaunchedEnemy"/>。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LavaGeyser : MonoBehaviour
    {
        public enum State { Idle, Warning, Erupting }

        [Header("节奏")]
        [Tooltip("一个周期（秒）：预警 + 喷发 + 休止")]
        public float period = 8f;
        [Tooltip("相位（周期的分数 0–1）：同一组熔泉错开喷；第一次预警在启用后 phase × period 秒")]
        [Range(0, 1)] public float phase;
        [Tooltip("预警秒数（品红圈 + 鼓泡）、喷发秒数")]
        public float warnTime = 1.2f, eruptTime = 1.5f;
        [Tooltip("开局就按周期喷（关 = 等 activeSite 交战 / SetCycling）")]
        public bool startActive = true;
        [Tooltip("只在这个场地交战时按周期喷（空 = 不看场地）")]
        public EncounterSite activeSite;

        [Header("熔柱")]
        [Tooltip("熔柱半径（米，也是伤害半径与预警圈半径）、高度（米）")]
        public float radius = 2.2f, height = 9f;
        [Tooltip("熔柱（本地 Y 向上、高 1 的网格；运行时按 height 缩放），没有就只有火星")]
        public Transform column;
        [Tooltip("壳缝 / 喷口的发光件（按状态调 _EmissionColor 亮度）")]
        public Renderer[] cracks = Array.Empty<Renderer>();
        public Color crackColor = new(4f, 1.3f, 0.3f);

        [Header("伤害 / 掀起")]
        [Tooltip("玩家：扣最大生命的比例；往上掀起的速度（m/s）")]
        public float playerDamage = 0.1f, playerLaunch = 11f;
        [Tooltip("地面敌人：扣最大生命的比例（精英减半，首领不受影响）；往上掀起的速度、往外推的冲量（m/s）")]
        public float enemyDamage = 0.15f, enemyLaunch = 9f, enemyPush = 5f;

        [Header("岩壳")]
        [Tooltip("岩壳（下面的碰撞体都是靶子；空 = 不能射爆）")]
        public Transform shell;
        [Tooltip("一个周期里玩家累计打够多少伤害就提前引爆（× 本局难度）")]
        public float shellHp = 45f;
        [Tooltip("射爆岩壳后多快喷（秒）")]
        public float detonateWarn = 0.35f;

        static readonly List<LavaGeyser> all = new();
        /// <summary>场上的间歇熔泉（测试用）</summary>
        public static IReadOnlyList<LavaGeyser> All => all;
        static readonly int EmissionId = Shader.PropertyToID("_EmissionColor");

        public State Current { get; private set; }
        /// <summary>正在按周期喷</summary>
        public bool Cycling => cycling;
        /// <summary>喷过几次、射爆过几次、掀起过几只敌人、玩家挨过几次</summary>
        public int Eruptions { get; private set; }
        public int Detonations { get; private set; }
        public int EnemiesLaunched { get; private set; }
        public int PlayerHits { get; private set; }
        /// <summary>这一次是射爆岩壳引起的</summary>
        public bool Detonated { get; private set; }
        /// <summary>这个周期里玩家已经打了岩壳多少</summary>
        public float ShellDamage => shellDamage;
        /// <summary>喷口中心（地面）</summary>
        public Vector3 Base => transform.position;
        public Damageable Health { get; private set; }

        public event Action<LavaGeyser> Warned;
        public event Action<LavaGeyser> Erupted;
        public event Action<LavaGeyser, float> HitPlayer;
        public event Action<LavaGeyser, EnemyAI> LaunchedEnemy;

        bool cycling, forcedCycling, playerHit;
        float stateT, stateLen, nextAt, shellDamage, bubbleAt, idleSparkAt, glow;
        TelegraphHandle tele;
        readonly HashSet<EnemyAI> hitEnemies = new();
        MaterialPropertyBlock block;
        PlayerVitals vitals;
        PlayerMotor motor;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void Awake()
        {
            block = new MaterialPropertyBlock();
            if (column) column.gameObject.SetActive(false);
            if (shell)
            {
                Health = GetComponent<Damageable>();
                if (!Health) Health = gameObject.AddComponent<Damageable>();
                Health.maxHealth = 1e6f;
                Health.displayName = "熔泉岩壳";
                Health.noReward = true;
                Health.ResetVitals();
                Health.Damaged += OnShellDamaged;
                foreach (var c in shell.GetComponentsInChildren<Collider>(true))
                {
                    if (c.isTrigger) continue;
                    var hb = c.GetComponent<Hitbox>();
                    if (!hb) hb = c.gameObject.AddComponent<Hitbox>();
                    if (!hb.owner) hb.owner = Health;
                    hb.blocksSight = true;
                }
            }
            SetGlow(0.25f);
        }

        void OnEnable()
        {
            all.Add(this);
            if (startActive && !activeSite) SetCycling(true);
        }

        void OnDisable()
        {
            all.Remove(this);
            tele.Cancel();
        }

        void OnDestroy()
        {
            if (Health) Health.Damaged -= OnShellDamaged;
        }

        /// <summary>开 / 关按周期喷（开的时候从现在起按相位排第一次预警）</summary>
        public void SetCycling(bool on)
        {
            forcedCycling = on;
            ApplyCycling(on);
        }

        void ApplyCycling(bool on)
        {
            if (on == cycling) return;
            cycling = on;
            if (on) nextAt = Time.time + Mathf.Repeat(phase, 1f) * Mathf.Max(0.5f, period) + 0.3f;
        }

        /// <summary>马上喷一次（演出 / 测试）：预警 warn 秒（≤ 0 = 用 detonateWarn）后喷，不管在不在周期里；正在喷的不打断</summary>
        public void EruptNow(float warn = 0.6f)
        {
            if (Current == State.Erupting) return;
            float w = warn > 0 ? warn : detonateWarn;
            if (Current == State.Warning)
            {
                stateLen = Mathf.Min(stateLen, stateT + w);
                return;
            }
            BeginWarn(w);
        }

        void OnShellDamaged(DamageInfo info, DamageResult r)
        {
            if (Health) Health.ResetVitals();
            if (DamageCalc.IsDot(info) || info.source is DamageSource.Enemy or DamageSource.Environment or DamageSource.Status) return;
            if (Current == State.Erupting) return;
            shellDamage += Mathf.Max(r.total, info.amount);
            float level = RunState.Current != null && RunState.Current.difficulty > 0 ? RunState.Current.difficulty : 1f;
            Fx.Burst(Base + Vector3.up * 0.6f, LavaField.Orange, 3, 2f, 0.35f, 0.08f, -4f);
            if (shellDamage < shellHp * level) return;
            Detonations++;
            Detonated = true;
            GameAudio.PlayAt("shield_break", Base, 0.7f, 0.7f);
            Fx.Burst(Base + Vector3.up * 0.5f, new Color(0.2f, 0.16f, 0.15f), 14, 6f, 0.6f, 0.16f, -12f);
            EruptNow(detonateWarn);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (!(dt > 0)) return;
            if (activeSite && !forcedCycling) ApplyCycling(activeSite.phase == EncounterSite.Phase.Active);
            switch (Current)
            {
                case State.Idle:
                    glow = Mathf.MoveTowards(glow, 0.25f, dt);
                    if (cycling && Time.time >= nextAt) BeginWarn(warnTime);
                    else if (Time.time >= idleSparkAt)
                    {
                        // 不喷的时候冒一点火星（读得出它是活的）
                        idleSparkAt = Time.time + UnityEngine.Random.Range(0.8f, 1.6f);
                        Fx.Burst(Base + Vector3.up * 0.5f, LavaField.Orange, 2, 1.2f, 0.6f, 0.07f, -2f);
                    }
                    break;
                case State.Warning:
                    stateT += dt;
                    float k = Mathf.Clamp01(stateT / Mathf.Max(0.05f, stateLen));
                    glow = Mathf.Lerp(0.4f, 1.6f, k);
                    if (Time.time >= bubbleAt)
                    {
                        // 鼓泡：越到后面越密
                        bubbleAt = Time.time + Mathf.Lerp(0.16f, 0.05f, k);
                        var off = UnityEngine.Random.insideUnitCircle * radius * 0.6f;
                        Fx.Burst(Base + new Vector3(off.x, 0.4f, off.y), Color.Lerp(LavaField.Orange, LavaField.Gold, k), 3, 1.5f + 2f * k, 0.4f, 0.1f, -3f);
                    }
                    if (stateT >= stateLen) BeginErupt();
                    break;
                case State.Erupting:
                    stateT += dt;
                    StepColumn();
                    Affect();
                    glow = 2f;
                    if (stateT >= eruptTime) EndErupt();
                    break;
            }
            SetGlow(glow);
        }

        void BeginWarn(float len)
        {
            Current = State.Warning;
            stateT = 0;
            stateLen = Mathf.Max(0.05f, len);
            bubbleAt = 0;
            tele.Cancel();
            tele = Telegraph.Circle(Base + Vector3.up * 0.05f, radius, stateLen, TelegraphPalette.Danger, TelegraphTone.Danger);
            GameAudio.PlayAt("burn_tick", Base, 0.8f, 0.55f);
            GameAudio.PlayAt("telegraph", Base, 0.5f, 0.8f);
            Raise(Warned);
        }

        void BeginErupt()
        {
            Current = State.Erupting;
            stateT = 0;
            playerHit = false;
            hitEnemies.Clear();
            Eruptions++;
            if (column)
            {
                column.gameObject.SetActive(true);
                column.localScale = new Vector3(1, 0.01f, 1);
            }
            var top = Base + Vector3.up * height;
            Fx.Burst(Base + Vector3.up * 0.5f, LavaField.Orange, 26, 9f, 0.9f, 0.16f, -9f);
            Fx.Burst(top, LavaField.Gold, 18, 5f, 1.1f, 0.12f, -10f);
            Fx.Ring(Base + Vector3.up * 0.05f, radius * 1.15f, LavaField.Orange, 0.45f);
            Fx.Flash(Base + Vector3.up * 2f, LavaField.Orange, 8f, radius * 5f, 0.35f);
            GameAudio.PlayAt("skill_fire", Base, 1f, 0.55f);
            GameAudio.PlayAt("explosion", Base, 0.55f, 0.7f);
            CameraShake.Quake(Base, 0.18f, 18f, 0.35f);
            Raise(Erupted);
        }

        void EndErupt()
        {
            Current = State.Idle;
            if (column) column.gameObject.SetActive(false);
            Fx.Burst(Base + Vector3.up * height * 0.6f, LavaField.Orange, 10, 3f, 0.8f, 0.12f, -12f);
            shellDamage = 0;
            Detonated = false;
            nextAt = Time.time + Mathf.Max(0.5f, period - warnTime - eruptTime);
        }

        /// <summary>熔柱：0.15 s 冲到顶，喷的时候上下颤，最后 0.3 s 落回去</summary>
        void StepColumn()
        {
            if (!column) return;
            float up = Mathf.Clamp01(stateT / 0.15f), down = Mathf.Clamp01((eruptTime - stateT) / 0.3f);
            float h = height * Mathf.Min(up, down) * (1f + 0.06f * Mathf.Sin(stateT * 31f));
            float w = Mathf.Lerp(0.6f, 1f, up) * (1f + 0.05f * Mathf.Sin(stateT * 23f + 1.3f));
            column.localScale = new Vector3(w, Mathf.Max(0.01f, h), w);
            if (UnityEngine.Random.value < 0.35f)
                Fx.Burst(Base + Vector3.up * h, LavaField.Gold, 2, 3f, 0.6f, 0.1f, -10f);
        }

        /// <summary>熔柱里的东西：玩家（每次喷发一次）扣血 + 掀起；地面敌人扣血 + 掀起 + 往外推；飞行敌人只扣血</summary>
        void Affect()
        {
            var b = Base;
            float r = radius + 0.4f, top = b.y + height * Mathf.Clamp01(stateT / 0.15f);
            if (!vitals) vitals = PlayerVitals.Instance;
            if (!playerHit && vitals && !vitals.Dead)
            {
                if (!motor) motor = vitals.GetComponent<PlayerMotor>();
                var p = vitals.transform.position;
                if (Flat(p - b) <= r && p.y >= b.y - 1f && p.y <= top)
                {
                    playerHit = true;
                    PlayerHits++;
                    float dmg = Combat.DamagePlayer(vitals.MaxHealth * playerDamage, b, Element.Fire, this);
                    if (motor)
                    {
                        var away = Flat3(p - b);
                        away = away.sqrMagnitude > 0.01f ? away.normalized : Vector3.zero;
                        motor.Launch(away * 2.5f + Vector3.up * playerLaunch);
                    }
                    Raise(HitPlayer, dmg);
                }
            }
            var live = EnemyRegistry.Live;
            for (int i = live.Count - 1; i >= 0; i--)
            {
                var ai = i < live.Count ? live[i] : null;
                if (!ai || ai.Dead || hitEnemies.Contains(ai)) continue;
                var p = ai.transform.position;
                if (Flat(p - b) > r + 0.3f || p.y < b.y - 1f || p.y > top) continue;
                hitEnemies.Add(ai);
                var d = ai.Health;
                if (!d || d.IsBoss) continue;
                float frac = d.elite ? enemyDamage * 0.5f : enemyDamage;
                var info = DamageInfo.Simple(d.maxHealth * frac, DamageSource.Environment, p + Vector3.up, Vector3.up);
                info.noCrit = true;
                Combat.DamageEnemy(d, info);
                if (ai.Dead || ai is FlyingEnemyAI) continue;
                var away = Flat3(p - b);
                away = away.sqrMagnitude > 0.01f ? away.normalized : Flat3(UnityEngine.Random.onUnitSphere).normalized;
                ai.Knockback(away * enemyPush);
                if (ai.LaunchUp(enemyLaunch))
                {
                    EnemiesLaunched++;
                    LavaField.NoteKnocked(ai);
                    try
                    {
                        LaunchedEnemy?.Invoke(this, ai);
                    }
                    catch (Exception e)
                    {
                        Debug.LogException(e);
                    }
                }
            }
        }

        void SetGlow(float k)
        {
            if (cracks == null || cracks.Length == 0 || block == null) return;
            var c = crackColor * Mathf.Max(0, k);
            foreach (var rd in cracks)
            {
                if (!rd) continue;
                rd.GetPropertyBlock(block);
                block.SetColor(EmissionId, c);
                rd.SetPropertyBlock(block);
            }
        }

        void Raise(Action<LavaGeyser> e)
        {
            if (e == null) return;
            try
            {
                e(this);
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
            }
        }

        void Raise(Action<LavaGeyser, float> e, float v)
        {
            if (e == null) return;
            try
            {
                e(this, v);
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
            }
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;

        static Vector3 Flat3(Vector3 v) => new(v.x, 0, v.z);

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1f, 0.17f, 0.84f, 0.8f);
            Gizmos.DrawWireSphere(transform.position, radius);
            Gizmos.DrawLine(transform.position, transform.position + Vector3.up * height);
        }
    }
}
