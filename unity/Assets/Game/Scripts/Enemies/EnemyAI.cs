using System;
using System.Collections.Generic;
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
    /// 嘲讽（灵宠讙）：<see cref="Taunt"/> 期间 <see cref="Target"/> 换成诱饵，瞄准、走位、近战都对着它；打到诱饵无效，玩家不吃这只敌人的伤害。
    /// </summary>
    [RequireComponent(typeof(EnemyBody), typeof(NavMeshAgent))]
    public abstract class EnemyAI : MonoBehaviour
    {
        public string enemyId;
        public float moveSpeed = 4f, damage = 10f;
        /// <summary>强度倍率（= 局难度，同 TS 的 level，可以是小数；下限 0.5）</summary>
        public float level = 1;
        public bool elite;
        [Tooltip("击退抗性 0–1")] public float knockbackResist;

        /// <summary>辅助类敌人（邪飞天）给的加成，每帧由光环写入，默认 1</summary>
        [NonSerialized] public float auraSpeed = 1, auraAttackRate = 1, auraDamage = 1;
        public event Action<EnemyAI> Removed;

        protected EnemyBody body;
        protected Damageable hp;
        /// <summary>场上所有敌人（反应、弹射、追踪找目标用）；死亡 / 销毁时移出</summary>
        public static readonly List<EnemyAI> All = new();
        public Damageable Health => hp;
        EnemyStatus status;
        bool wasStunned;
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
        Transform taunt, playerLook;
        float tauntUntil, tauntEye;
        static float blockTextAt;
        bool manual;
        Vector3 manualVelocity;
        float manualGravity;

        public float DamageMult => (1 + (level - 1) * 0.55f) * (elite ? 1.25f : 1f) * auraDamage;
        public float Damage => damage * DamageMult;
        public bool Dead => hp && hp.Dead;
        public string State => state;
        /// <summary>被嘲讽中（目标是灵宠诱饵）</summary>
        public bool Taunted => taunt && Time.time < tauntUntil;
        /// <summary>当前目标：被嘲讽时是诱饵，否则是玩家</summary>
        protected Transform Target => Taunted ? taunt : player;
        protected Vector3 PlayerPos => Target ? Target.position : transform.position;
        protected Vector3 PlayerEye => Taunted ? taunt.position + Vector3.up * tauntEye : player ? player.position + Vector3.up * 1.62f : transform.position;
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
            All.Add(this);
        }

        void OnDestroy() => All.Remove(this);

        /// <summary>生成器调用：强度倍率（局难度）与精英决定生命，出生无敌 0.7 s</summary>
        public virtual void Spawn(float lvl, bool isElite)
        {
            level = Mathf.Max(0.5f, lvl);
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
            GameAudio.PlayAt("enemy_spawn", transform.position, 0.5f);
        }

        protected virtual void Start()
        {
            vitals = PlayerVitals.Instance;
            player = vitals ? vitals.transform : null;
            playerLook = vitals ? vitals.GetComponent<PlayerMotor>().eye : null;
            if (body.Rig && playerLook) body.Rig.lookTarget = playerLook;
            cooldown = UnityEngine.Random.Range(0.4f, 1.6f);
        }

        void OnDied(DamageInfo info)
        {
            All.Remove(this);
            AttackTokens.Release(this);
            if (agent && agent.enabled) agent.enabled = false;
            Removed?.Invoke(this);
            enabled = false;
        }

        protected virtual void Update()
        {
            if (Dead || !player) return;
            // 引用判空：诱饵被销毁（换宠 / 解除结契）也要把视线还给玩家
            if (!ReferenceEquals(taunt, null) && !Taunted) EndTaunt();
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
            StepPush(dt);
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
            // 眩晕（雷殛叠满、封脉）：AI 停摆，打断正在做的动作；醒来从初始状态重新开始
            if (!status) status = GetComponent<EnemyStatus>();
            if (body.Rig) body.Rig.daze = (status && status.Stunned) || DazeOverlay ? 1f : 0f;
            if (status && status.Stunned)
            {
                if (!wasStunned)
                {
                    wasStunned = true;
                    if (manual) EndManualMotion();
                    Stop();
                    AttackTokens.Release(this);
                    OnStunned();
                    Play("Hit", 0.05f);
                }
                return;
            }
            if (wasStunned)
            {
                wasStunned = false;
                PlayLocomotion();
                SetState(InitialState);
            }
            Think(dt);
        }

        /// <summary>子类自己的晕眩状态（镇墓兽撞墙撞晕）：打开 CreatureRig 的晕眩叠加</summary>
        protected virtual bool DazeOverlay => false;

        protected bool Stunned
        {
            get
            {
                if (!status) status = GetComponent<EnemyStatus>();
                return status && status.Stunned;
            }
        }

        /// <summary>被眩晕的那一刻：子类在这里收拾自己的中间状态（钻了一半的沙、悬空的冲锋…）</summary>
        protected virtual void OnStunned() { }

        /// <summary>移速倍率：光环 × 元素减速（蚀化、封脉）</summary>
        protected float SpeedMult => auraSpeed * (status ? status.SlowMult : 1f);
        /// <summary>步态对位移的调制（蜃楼蟾只在腾空段前进）；1 = 匀速</summary>
        protected virtual float GaitMult => 1f;

        /// <summary>体型（名册 scale × 精英 1.25）：Three.js 版按 sizeScale 放大的判定距离 / 半径都乘它</summary>
        protected float Size => transform.localScale.x;

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
            if (!anim || !anim.isActiveAndEnabled) return;
            SetActScale(1);
            anim.CrossFadeInFixedTime(animState, fade);
        }

        /// <summary>
        /// 播一个招式片段并拉伸到 seconds 正好播完：前摇被光环加速、或片段录制时长与玩法计时不一致时，
        /// 动作链的下一段（出招）才和玩法的出招时刻对得上，不会提前出手或停在最后一帧干等
        /// </summary>
        protected void PlayTimed(string animState, float seconds, float fade = 0.08f)
        {
            if (!anim || !anim.isActiveAndEnabled) return;
            float len = ClipLength(animState);
            SetActScale(len > 0 && seconds > 0.05f ? Mathf.Clamp(len / seconds, 0.4f, 2.5f) : 1);
            anim.CrossFadeInFixedTime(animState, fade);
        }

        static readonly int ActScaleId = Animator.StringToHash("ActScale");
        static readonly Dictionary<RuntimeAnimatorController, Dictionary<string, float>> clipLengths = new();
        int hasActScale = -1;

        void SetActScale(float k)
        {
            if (hasActScale < 0)
            {
                hasActScale = 0;
                foreach (var p in anim.parameters) if (p.nameHash == ActScaleId) hasActScale = 1;
            }
            if (hasActScale == 1) anim.SetFloat(ActScaleId, k);
        }

        /// <summary>状态对应片段的时长（烘焙片段名 = &lt;资产&gt;_&lt;状态&gt;）；找不到返回 0</summary>
        float ClipLength(string animState)
        {
            var ctrl = anim.runtimeAnimatorController;
            if (!ctrl) return 0;
            if (!clipLengths.TryGetValue(ctrl, out var map))
            {
                map = new Dictionary<string, float>();
                foreach (var c in ctrl.animationClips)
                {
                    if (!c) continue;
                    int i = c.name.LastIndexOf('_');
                    if (i >= 0) map[c.name[(i + 1)..]] = c.length;
                }
                clipLengths[ctrl] = map;
            }
            return map.TryGetValue(animState, out var len) ? len : 0;
        }

        protected void PlayLocomotion() => Play("Locomotion", 0.15f);

        /// <summary>敌人身上出声（音效 id 见 GameAudio；有敌方音色时自动换）</summary>
        protected void Sfx(string id, float volume = 1, float pitch = 1) => GameAudio.PlayAt(id, transform.position + Vector3.up * 0.6f * Size, volume, pitch);

        /// <summary>弱点发光壳的亮度目标（0..1，见 EnemyBody.glow）：各敌人按状态每帧写</summary>
        protected float Glow { set => body.glow = value; }

        /// <summary>发光壳的亮度换算（Three.js 各敌人 glowShell.opacity 的公式）</summary>
        protected void GlowStyle(float baseline, float breath, float rate, float gain, bool squared = true)
        {
            body.glowBase = baseline;
            body.glowBreath = breath;
            body.glowRate = rate;
            body.glowGain = gain;
            body.glowSquared = squared;
        }

        // ───────────── 移动 ─────────────
        protected void MoveTo(Vector3 dest, float speed)
        {
            if (manual || !agent.isOnNavMesh) return;
            agent.isStopped = false;
            agent.speed = speed * SpeedMult * GaitMult;
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

        /// <summary>
        /// 边横移边对着玩家：只有前进步态的片段，正对玩家横着走就是「太空步」。横移时身体朝移动方向偏过去
        /// （最多 travel × 90°，按横移占比），头由 CreatureRig 的看向继续盯着玩家；前进 / 后退时照样正对玩家（后撤不背身）
        /// </summary>
        protected void FaceAimTravel(float rateDeg, float dt, float travel = 0.5f)
        {
            var toP = PlayerPos - transform.position;
            toP.y = 0;
            if (toP.sqrMagnitude < 1e-4f) return;
            toP.Normalize();
            var dir = toP;
            var v = manual ? manualVelocity : agent.desiredVelocity;
            v.y = 0;
            if (v.sqrMagnitude > 0.04f)
            {
                var vd = v.normalized;
                float lateral = Mathf.Abs(Vector3.Dot(vd, new Vector3(-toP.z, 0, toP.x)));
                float fwd = Vector3.Dot(vd, toP);
                // 横移成分越大偏得越多；带后退成分时偏转渐弱（不把屁股对着玩家）
                float k = travel * lateral * Mathf.Clamp01(1 + fwd * 1.5f);
                dir = Vector3.Slerp(toP, vd, k);
            }
            transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(dir), rateDeg * dt);
        }

        protected void FaceMovement(float rateDeg, float dt)
        {
            var v = manual ? manualVelocity : agent.velocity;
            v.y = 0;
            if (v.sqrMagnitude > 0.25f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(v), rateDeg * dt);
        }

        Vector3 push;

        /// <summary>
        /// 击退（Three.js EnemyBase.knockback）：水平冲量 × (1 − 击退抗性) 叠到一个推力上，沿导航网格推开、按 8/s 衰减。
        /// 跳跃 / 冲锋这类脚本位移期间不推（不打断招式的轨迹）
        /// </summary>
        public void Knockback(Vector3 impulse)
        {
            if (Dead) return;
            float k = 1 - knockbackResist;
            if (k <= 0) return;
            impulse.y = 0;
            push += impulse * k;
            if (push.sqrMagnitude > 81) push = push.normalized * 9;
        }

        void StepPush(float dt)
        {
            if (push.sqrMagnitude < 0.0004f) return;
            if (!manual && agent.isOnNavMesh) agent.Move(push * dt);
            push *= Mathf.Exp(-8f * dt);
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

        // ───────────── 嘲讽 ─────────────
        /// <summary>嘲讽：seconds 秒内瞄准、走位、近战都对着 decoy（eyeHeight = 瞄准点离地高度）；重复嘲讽取更晚的结束时间</summary>
        public void Taunt(Transform decoy, float seconds, float eyeHeight = 0.5f)
        {
            if (Dead || !decoy || seconds <= 0) return;
            tauntUntil = taunt == decoy ? Mathf.Max(tauntUntil, Time.time + seconds) : Time.time + seconds;
            taunt = decoy;
            tauntEye = eyeHeight;
            if (body.Rig) body.Rig.lookTarget = decoy;
        }

        void EndTaunt()
        {
            taunt = null;
            if (body.Rig && playerLook) body.Rig.lookTarget = playerLook;
        }

        /// <summary>对当前目标造成伤害：被嘲讽时打在灵体诱饵上，无效（偶尔冒「格挡」）</summary>
        protected bool HitTarget(float dmg, Vector3 from)
        {
            if (Taunted)
            {
                DecoyBlocked(taunt);
                return false;
            }
            return Combat.DamagePlayer(dmg, from) > 0;
        }

        /// <summary>诱饵挡下一击：全场共用节流，免得一群怪同时刷屏</summary>
        public static void DecoyBlocked(Transform decoy)
        {
            if (!decoy || Time.time < blockTextAt) return;
            blockTextAt = Time.time + 0.45f;
            Hud.Instance?.FloatText(decoy.position + Vector3.up * 0.9f + UnityEngine.Random.insideUnitSphere * 0.25f, "格挡", new Color(0.82f, 0.86f, 0.95f), 0.9f);
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
            bool hit = HitTarget(dmg, transform.position + Vector3.up);
            if (hit) GameAudio.PlayAt("enemy_melee", transform.position);
            return hit;
        }

        /// <summary>环形 / 圆形范围伤害（落地旋斩、踩地）</summary>
        protected bool Burst(Vector3 center, float radius, float dmg)
        {
            if (!player) return false;
            var to = PlayerPos - center;
            float dy = to.y;
            to.y = 0;
            if (to.magnitude > radius + 0.35f || Mathf.Abs(dy) > 2.2f) return false;
            return HitTarget(dmg, center);
        }

        /// <summary>预测玩家位置：lead 秒后（只取水平速度）</summary>
        protected Vector3 PredictPlayer(float lead)
        {
            if (Taunted) return PlayerPos;
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
    /// 灵体诱饵（被嘲讽的敌人对着它打）：敌人弹丸穿过它的胶囊（脚底 → height，半径 radius）时被吸收，不会再飞向玩家
    /// </summary>
    public static class Decoys
    {
        public struct Entry
        {
            public Transform t;
            public float radius, height, until;
        }

        static readonly List<Entry> all = new();

        /// <summary>登记 / 续期一个诱饵，until 为 Time.time 的到期时刻</summary>
        public static void Set(Transform t, float radius, float height, float until)
        {
            for (int i = 0; i < all.Count; i++)
                if (all[i].t == t)
                {
                    all[i] = new Entry { t = t, radius = radius, height = height, until = Mathf.Max(until, all[i].until) };
                    return;
                }
            all.Add(new Entry { t = t, radius = radius, height = height, until = until });
        }

        public static void Remove(Transform t) => all.RemoveAll(e => !e.t || e.t == t);

        /// <summary>当前有效的诱饵（顺手清掉过期 / 已销毁的）</summary>
        public static List<Entry> Active()
        {
            if (all.Count > 0) all.RemoveAll(e => !e.t || Time.time >= e.until);
            return all;
        }
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
