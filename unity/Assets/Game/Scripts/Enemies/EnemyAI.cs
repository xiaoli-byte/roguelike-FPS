using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人行为的基类（Three.js 版 EnemyBase + StandardEnemy 的思路，换成 Unity 的 NavMesh 与动画状态机）：
    ///   移动：NavMeshAgent 寻路（只管位置），朝向由各敌人自己控制（面向玩家 / 面向移动方向）；
    ///         CreatureLocomotion 从根节点的实际运动推导动画速度，这里不用手喂步态。
    ///   跳跃 / 冲锋这类离开导航网格的位移：<see cref="BeginManualMotion"/> 接管位置，落地后 <see cref="EndManualMotion"/> 交还 agent。
    ///   感知：到玩家眼睛的视线（缓存 0.25 s）、水平距离。
    ///   状态：字符串状态 + 计时；动作动画直接按状态名 CrossFade（烘焙的动作链用 next 自动接续）。
    ///   等级：生命 × 等级，伤害 × (1 + (等级 − 1) × 0.55)；精英生命 × 2.6、伤害 × 1.25。
    /// 出生 0.7 s 内不可选中（地面预警在生成器那边先播 0.8 s）。
    /// </summary>
    [RequireComponent(typeof(EnemyBody), typeof(NavMeshAgent))]
    public abstract class EnemyAI : MonoBehaviour
    {
        public string enemyId;
        public float moveSpeed = 4f, damage = 10f;
        public int level = 1;
        public bool elite;
        [Tooltip("击退抗性 0–1")] public float knockbackResist;

        /// <summary>辅助类敌人（邪飞天）给的加成，每帧由光环写入，默认 1</summary>
        [NonSerialized] public float auraSpeed = 1, auraAttackRate = 1, auraDamage = 1;
        public event Action<EnemyAI> Removed;

        protected EnemyBody body;
        protected Damageable hp;
        protected NavMeshAgent agent;
        protected Transform player;
        protected PlayerVitals vitals;
        protected Animator anim;
        protected string state = "spawn";
        protected float stateTime, cooldown, age;
        protected bool sees;

        float seeTimer, repathTimer, buffTimer;
        /// <summary>邪飞天的赐福：谁给的、到期时间</summary>
        [NonSerialized] public ApsaraAI blessedBy;
        [NonSerialized] public float blessedUntil;
        public bool Blessed => blessedBy && !blessedBy.Dead && !blessedBy.Silenced && Time.time < blessedUntil;
        Vector3 lastDest;
        bool manual;
        Vector3 manualVelocity;
        float manualGravity;

        public float DamageMult => (1 + (level - 1) * 0.55f) * (elite ? 1.25f : 1f) * auraDamage;
        public float Damage => damage * DamageMult;
        public bool Dead => hp && hp.Dead;
        public string State => state;
        protected Vector3 PlayerPos => player ? player.position : transform.position;
        protected Vector3 PlayerEye => player ? player.position + Vector3.up * 1.62f : transform.position;
        protected float DistToPlayer
        {
            get
            {
                var d = PlayerPos - transform.position;
                d.y = 0;
                return d.magnitude;
            }
        }

        protected virtual void Awake()
        {
            body = GetComponent<EnemyBody>();
            hp = GetComponent<Damageable>();
            agent = GetComponent<NavMeshAgent>();
            anim = body.Animator;
            agent.updateRotation = false;
            agent.angularSpeed = 0;
            agent.acceleration = 40;
            agent.autoBraking = true;
            agent.stoppingDistance = 0.3f;
            hp.Died += OnDied;
        }

        /// <summary>生成器调用：等级与精英决定生命，出生无敌 0.7 s</summary>
        public virtual void Spawn(int lvl, bool isElite)
        {
            level = lvl;
            elite = isElite;
            float mult = level * (elite ? 2.6f : 1f);
            hp.maxHealth *= mult;
            hp.maxArmor *= mult;
            hp.maxShield *= mult;
            hp.elite = elite;
            hp.ResetVitals();
            if (elite)
            {
                transform.localScale *= 1.25f;
                knockbackResist = Mathf.Min(1, knockbackResist + 0.3f);
            }
            hp.untargetable = true;
            SetState("spawn");
        }

        protected virtual void Start()
        {
            vitals = PlayerVitals.Instance;
            player = vitals ? vitals.transform : null;
            if (body.Rig && vitals) body.Rig.lookTarget = vitals.GetComponent<PlayerMotor>().eye;
            cooldown = UnityEngine.Random.Range(0.4f, 1.6f);
        }

        void OnDied(DamageInfo info)
        {
            AttackTokens.Release(this);
            if (agent && agent.enabled) agent.enabled = false;
            Removed?.Invoke(this);
            enabled = false;
        }

        protected virtual void Update()
        {
            if (Dead || !player) return;
            float dt = Time.deltaTime;
            age += dt;
            stateTime += dt;
            cooldown -= dt * auraAttackRate;
            seeTimer -= dt;
            if (seeTimer <= 0)
            {
                seeTimer = UnityEngine.Random.Range(0.2f, 0.3f);
                sees = !Combat.Blocked(transform.position + Vector3.up * Mathf.Max(0.6f, hp.GetComponent<Collider>() ? hp.GetComponent<Collider>().bounds.extents.y : 0.8f), PlayerEye, null);
            }
            if (manual) StepManual(dt);
            buffTimer -= dt;
            if (buffTimer <= 0)
            {
                buffTimer = 0.25f;
                RefreshBuffs();
            }
            if (state == "spawn")
            {
                if (stateTime >= 0.7f)
                {
                    hp.untargetable = false;
                    SetState(InitialState);
                }
                return;
            }
            Think(dt);
        }

        /// <summary>
        /// 邪飞天加成：16 m 内有一只没被沉默的邪飞天就吃光环（多只不叠加）；赐福另算、相乘。
        /// 光环：伤害 / 攻速 ×1.35、移速 ×1.2、承伤 ×0.75；赐福：伤害 ×1.6、攻速 ×1.5、移速 ×1.15、承伤 ×0.5
        /// </summary>
        void RefreshBuffs()
        {
            bool aura = false;
            foreach (var a in ApsaraAI.Active)
                if (a && a != this && !a.Dead && !a.Silenced && (a.transform.position - transform.position).sqrMagnitude < ApsaraAI.AuraRange * ApsaraAI.AuraRange)
                {
                    aura = true;
                    break;
                }
            bool blessed = Blessed;
            auraDamage = (aura ? 1.35f : 1f) * (blessed ? 1.6f : 1f);
            auraAttackRate = (aura ? 1.35f : 1f) * (blessed ? 1.5f : 1f);
            auraSpeed = (aura ? 1.2f : 1f) * (blessed ? 1.15f : 1f);
            hp.damageTakenMult = (aura ? 0.75f : 1f) * (blessed ? 0.5f : 1f);
        }

        protected virtual string InitialState => "chase";
        protected abstract void Think(float dt);

        protected void SetState(string s)
        {
            state = s;
            stateTime = 0;
        }

        protected void Play(string animState, float fade = 0.08f)
        {
            if (anim && anim.isActiveAndEnabled) anim.CrossFadeInFixedTime(animState, fade);
        }

        protected void PlayLocomotion() => Play("Locomotion", 0.15f);

        // ───────────── 移动 ─────────────
        protected void MoveTo(Vector3 dest, float speed)
        {
            if (manual || !agent.isOnNavMesh) return;
            agent.isStopped = false;
            agent.speed = speed * auraSpeed;
            repathTimer -= Time.deltaTime;
            if (repathTimer <= 0 || (dest - lastDest).sqrMagnitude > 1f)
            {
                repathTimer = 0.25f;
                lastDest = dest;
                if (NavMesh.SamplePosition(dest, out var hit, 3f, NavMesh.AllAreas)) agent.SetDestination(hit.position);
            }
        }

        protected void Stop()
        {
            if (manual || !agent.isOnNavMesh) return;
            agent.isStopped = true;
            agent.velocity = Vector3.zero;
        }

        /// <summary>保持在 [min, max] 距离带：太近后撤、太远逼近、带内绕玩家侧移（sign 决定方向）</summary>
        protected void KeepRange(float min, float max, float speed, float strafeSign)
        {
            var to = PlayerPos - transform.position;
            to.y = 0;
            float d = to.magnitude;
            var dir = d > 0.01f ? to / d : transform.forward;
            var side = new Vector3(-dir.z, 0, dir.x) * strafeSign;
            Vector3 dest;
            if (d < min) dest = transform.position - dir * (min - d + 2f) + side * 2f;
            else if (d > max) dest = PlayerPos - dir * ((min + max) * 0.5f);
            else dest = transform.position + side * 4f + dir * 0.5f;
            MoveTo(dest, speed);
        }

        protected void FaceTowards(Vector3 p, float rateDeg, float dt)
        {
            var d = p - transform.position;
            d.y = 0;
            if (d.sqrMagnitude < 1e-4f) return;
            transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(d), rateDeg * dt);
        }

        protected void FacePlayer(float rateDeg, float dt) => FaceTowards(PlayerPos, rateDeg, dt);

        protected void FaceMovement(float rateDeg, float dt)
        {
            var v = manual ? manualVelocity : agent.velocity;
            v.y = 0;
            if (v.sqrMagnitude > 0.25f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(v), rateDeg * dt);
        }

        /// <summary>离开导航网格的位移（跳跃、冲锋、遁地）：给初速度与重力，脚本按物理推进；落地 / 结束时交还 agent</summary>
        protected void BeginManualMotion(Vector3 velocity, float gravity)
        {
            manual = true;
            manualVelocity = velocity;
            manualGravity = gravity;
            if (agent.isOnNavMesh) agent.isStopped = true;
            agent.updatePosition = false;
        }

        protected void SetManualVelocity(Vector3 v) => manualVelocity = v;
        protected Vector3 ManualVelocity => manualVelocity;
        protected bool ManualGrounded { get; private set; }

        protected void EndManualMotion()
        {
            if (!manual) return;
            manual = false;
            if (NavMesh.SamplePosition(transform.position, out var hit, 4f, NavMesh.AllAreas)) transform.position = hit.position;
            agent.Warp(transform.position);
            agent.updatePosition = true;
        }

        void StepManual(float dt)
        {
            manualVelocity.y -= manualGravity * dt;
            var p = transform.position;
            var step = manualVelocity * dt;
            // 撞墙：水平方向被建筑 / 地形挡住就停下水平速度
            var flat = new Vector3(step.x, 0, step.z);
            if (flat.sqrMagnitude > 1e-6f && Physics.Raycast(p + Vector3.up * 0.5f, flat.normalized, out var wall, flat.magnitude + 0.4f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                && wall.normal.y < 0.5f)
            {
                manualVelocity.x = manualVelocity.z = 0;
                step.x = step.z = 0;
                HitWall = true;
            }
            p += step;
            float ground = GroundY(p);
            ManualGrounded = p.y <= ground + 0.02f && manualVelocity.y <= 0;
            if (p.y < ground)
            {
                p.y = ground;
                if (manualVelocity.y < 0) manualVelocity.y = 0;
            }
            transform.position = p;
        }

        protected bool HitWall { get; set; }

        protected static float GroundY(Vector3 p)
        {
            return Physics.Raycast(p + Vector3.up * 3f, Vector3.down, out var hit, 20f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : p.y;
        }

        // ───────────── 攻击 ─────────────
        /// <summary>即时扇形近战判定：水平距离 ≤ range、在正面 arcCos 之内、高度差合理</summary>
        protected bool Melee(float range, float dmg, float arcCos)
        {
            if (!player) return false;
            var to = PlayerPos - transform.position;
            float dy = to.y;
            to.y = 0;
            if (to.magnitude > range + 0.35f || Mathf.Abs(dy) > 2.2f) return false;
            if (to.sqrMagnitude > 0.01f && Vector3.Dot(transform.forward, to.normalized) < arcCos) return false;
            return Combat.DamagePlayer(dmg, transform.position + Vector3.up) > 0;
        }

        /// <summary>环形 / 圆形范围伤害（落地旋斩、踩地）</summary>
        protected bool Burst(Vector3 center, float radius, float dmg)
        {
            if (!player) return false;
            var to = PlayerPos - center;
            float dy = to.y;
            to.y = 0;
            if (to.magnitude > radius + 0.35f || Mathf.Abs(dy) > 2.2f) return false;
            return Combat.DamagePlayer(dmg, center) > 0;
        }

        /// <summary>预测玩家位置：lead 秒后（只取水平速度）</summary>
        protected Vector3 PredictPlayer(float lead)
        {
            var motor = player ? player.GetComponent<PlayerMotor>() : null;
            var v = motor ? motor.Velocity : Vector3.zero;
            v.y = 0;
            return PlayerPos + v * lead;
        }

        protected bool RequestAttack(AttackTokens.Kind kind, float hold) => AttackTokens.Request(kind, this, hold);
        protected void ReleaseAttack() => AttackTokens.Release(this);

        protected void RollCooldown(float min, float max) => cooldown = UnityEngine.Random.Range(min, max);

        /// <summary>前摇时长：攻速加成只缩短一部分前摇（保持可读的预警）</summary>
        protected float Windup(float time, float minFraction) => time * Mathf.Max(minFraction, 1f / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)));
    }

    /// <summary>
    /// 出手名额（Three.js 版 AttackTokens）：同一时刻最多 4 个近战 / 2 个远程 / 1 个重击在出手，两次发放之间有最小间隔，
    /// 避免一群怪同一帧一起扑上来——玩家能读出谁要打、什么时候躲。
    /// </summary>
    public static class AttackTokens
    {
        public enum Kind { Melee, Ranged, Heavy }

        static readonly int[] Max = { 4, 2, 1 };
        static readonly float[] Gap = { 0.12f, 0.32f, 0.7f };
        static readonly float[] lastGrant = { -10, -10, -10 };
        static readonly System.Collections.Generic.Dictionary<EnemyAI, (Kind kind, float until)> holders = new();

        public static bool Request(Kind kind, EnemyAI who, float hold)
        {
            float now = Time.time;
            int k = (int)kind;
            if (holders.ContainsKey(who)) return true;
            if (now - lastGrant[k] < Gap[k]) return false;
            int n = 0;
            var expired = new System.Collections.Generic.List<EnemyAI>();
            foreach (var (e, v) in holders)
            {
                if (!e || e.Dead || now > v.until) { expired.Add(e); continue; }
                if (v.kind == kind) n++;
            }
            foreach (var e in expired) holders.Remove(e);
            if (n >= Max[k]) return false;
            holders[who] = (kind, now + hold);
            lastGrant[k] = now;
            return true;
        }

        public static void Release(EnemyAI who) => holders.Remove(who);
    }
}
