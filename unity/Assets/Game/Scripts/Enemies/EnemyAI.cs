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
    ///   等级：生命 × 等级（取整，同 TS Math.round），伤害 × (1 + (等级 − 1) × 0.55)；精英生命 × 2.6、伤害 × 1.25。等级 = 局难度（浮点）。
    /// 出生 0.7 s 内不可选中（地面预警在生成器那边先播 0.8 s）。
    /// 嘲讽（灵宠讙）：<see cref="Taunt"/> 期间 <see cref="Target"/> 换成诱饵，瞄准、走位、近战都对着它；打到诱饵无效，玩家不吃这只敌人的伤害。
    /// 打断（Three.js StandardEnemy.cancelAttack）：眩晕、死亡、玩家阵亡、坠落回收时统一走 <see cref="InterruptAttack"/>——归还出手名额，
    ///   再调子类的 <see cref="CancelAttack"/> 收起预警物、恢复移动参数。
    /// 玩家阵亡：停下、熄灭前摇发光、进入 idle（空中的落地后再交还导航）；玩家复活后从初始状态重新开始。
    /// 加成：辅助怪给的光环 / 赐福登记在 <see cref="Buffs"/>（多通道，见 <see cref="EnemyBuffs"/>），每帧结算到 aura* 与承伤倍率。
    /// 坠落回收：掉到最后站过的导航网格点以下 12 m（同 TS 掉出世界保护），或离开导航网格超过 2.5 s（不在跳跃 / 冲锋这类脚本位移里），
    ///   就传回最近的导航网格点；掉出世界又找不到网格的，静默处决（不给奖励，场地照常推进）。
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

        /// <summary>辅助类敌人（邪飞天…）给的加成合计（<see cref="Buffs"/> 结算后写入），默认 1</summary>
        [NonSerialized] public float auraSpeed = 1, auraAttackRate = 1, auraDamage = 1;
        public event Action<EnemyAI> Removed;

        protected EnemyBody body;
        protected Damageable hp;
        /// <summary>场上所有活着的敌人（= <see cref="EnemyRegistry.Live"/> 同一张表；旧代码照常遍历）。新代码用 EnemyRegistry 的查询</summary>
        public static List<EnemyAI> All => EnemyRegistry.LiveList;
        public Damageable Health => hp;
        public EnemyBody Body => body;
        EnemyStatus status;
        bool wasStunned;
        protected NavMeshAgent agent;
        protected Transform player;
        protected PlayerVitals vitals;
        protected Animator anim;
        protected string state = "spawn";
        protected float stateTime, cooldown, age;
        protected bool sees;

        float seeTimer, repathTimer;
        /// <summary>身上的加成登记（光环、赐福、霜甲…）：来源按通道合并，限时、来源失效即撤</summary>
        public readonly EnemyBuffs Buffs = new();
        /// <summary>被邪飞天赐福中</summary>
        public bool Blessed => Buffs.Has(EnemyBuffs.ApsaraBless);
        /// <summary>玩家阵亡时的待机状态名</summary>
        public const string IdleState = "idle";
        Vector3 lastDest;
        Transform taunt, playerLook;
        float tauntUntil, tauntEye;
        static float blockTextAt;
        bool manual;
        /// <summary>脚本位移这一程（速度、重力、可选的里程上限 / 防冲下台沿）</summary>
        ScriptedMotion motion;

        public float DamageMult => (1 + (level - 1) * 0.55f) * (elite ? 1.25f : 1f) * auraDamage;
        public float Damage => damage * DamageMult;
        public bool Dead => hp && hp.Dead;
        public string State => state;
        /// <summary>词缀招式接管期间，基础 AI 不再同时出手；由词缀控制器设置与解除。</summary>
        public bool AffixAttackBusy { get; internal set; }
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
            Buffs.Changed += ApplyBuffs;
            lastOnMesh = transform.position;
            EnemyRegistry.Register(this);
        }

        void OnDestroy() => EnemyRegistry.Unregister(this);

        /// <summary>
        /// 生成器调用：强度倍率（局难度，浮点；非法时 1）与精英决定生命（三层都 × 难度 × 精英 2.6，取整），出生无敌 0.7 s。
        /// 级别：生成器先按定义写好 <see cref="Damageable.rank"/>（首领），这里精英把普通升成精英；首领免疫击退。
        /// </summary>
        public virtual void Spawn(float lvl, bool isElite)
        {
            level = Mathf.Max(0.5f, float.IsFinite(lvl) && lvl > 0 ? lvl : 1f);
            elite = isElite;
            float mult = level * (elite ? 2.6f : 1f);
            hp.maxHealth = RoundHp(hp.maxHealth * mult);
            hp.maxArmor = RoundHp(hp.maxArmor * mult);
            hp.maxShield = RoundHp(hp.maxShield * mult);
            if (elite && hp.rank == Rank.Normal) hp.rank = Rank.Elite;
            hp.ResetVitals();
            if (elite)
            {
                transform.localScale *= 1.25f;
                knockbackResist = Mathf.Min(1, knockbackResist + 0.3f);
            }
            if (hp.IsBoss) knockbackResist = 1;
            hp.untargetable = true;
            lastOnMesh = transform.position;
            hasOnMesh = false;
            offMeshTime = 0;
            SetState("spawn");
            GameAudio.PlayAt("enemy_spawn", transform.position, 0.5f);
            GameEvents.RaiseEnemySpawned(this);
        }

        /// <summary>生命取整（同 TS Math.round：.5 进位）</summary>
        public static float RoundHp(float v) => float.IsFinite(v) ? Mathf.Floor(v + 0.5f) : 0;

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
            stunTaken?.Dispose();
            stunTaken = null;
            hitStaggerLeft = hitchLeft = 0;
            EnemyRegistry.Unregister(this);
            InterruptAttack();
            Buffs.Clear();
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
            if (launched) LastLaunchPeak = Mathf.Max(LastLaunchPeak, transform.position.y - launchY);
            // 被掀上半空（LaunchUp）：落地交还导航（被别的脚本位移接管 / 被托回时直接收尾）
            if (launched && (!manual || ManualGrounded))
            {
                launched = false;
                EndManualMotion();
            }
            StepPush(dt);
            Buffs.Tick(Time.time);
            if (StepFallRecovery(dt)) return;
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
                    // 被掀飞的照样飞完再落地（裂地重击先击飞后眩晕）；其余脚本位移就地收住
                    if (manual && !launched) EndManualMotion();
                    Stop();
                    InterruptAttack();
                    OnStunned();
                    Play("Hit", 0.05f);
                }
                // 同 TS：眩晕中前摇发光熄灭
                body.SetGlow(0, 0);
                return;
            }
            if (wasStunned)
            {
                wasStunned = false;
                stunTaken?.Dispose();
                stunTaken = null;
                PlayLocomotion();
                SetState(InitialState);
            }
            // 受击四层（第四章）：硬直中停摆；轻怪挨一枪顿一下。前三章的敌人从不进这两个分支
            if (hitStaggerLeft > 0)
            {
                hitStaggerLeft -= dt;
                body.SetGlow(0, 0);
                if (hitStaggerLeft <= 0)
                {
                    hitStaggerLeft = 0;
                    try
                    {
                        OnHitStaggerEnd();
                    }
                    catch (Exception e)
                    {
                        Debug.LogException(e);
                    }
                }
                return;
            }
            if (hitchLeft > 0)
            {
                hitchLeft -= dt;
                return;
            }
            // 玩家阵亡：待机（同 TS StandardEnemy.think 的 !player.alive 分支）；复活后从初始状态重新开始。首领登场演出期间同样待机（登场中的首领除外）
            if ((vitals && vitals.Dead) || BossIntroDirector.HoldsEnemy(this))
            {
                StepIdle();
                return;
            }
            if (state == IdleState)
            {
                PlayLocomotion();
                SetState(InitialState);
            }
            if (AffixAttackBusy)
            {
                Stop();
                return;
            }
            Think(dt);
        }

        /// <summary>
        /// 打断正在做的招式（眩晕、死亡、玩家阵亡、坠落回收、清场，外部的打断效果也可以调）：归还出手名额，再调子类的 <see cref="CancelAttack"/>。
        /// 不改状态：调用方决定回到哪个状态。
        /// </summary>
        public void InterruptAttack()
        {
            ReleaseAttack();
            try
            {
                CancelAttack();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 受击四层（第四章，combat 1.1；HitReaction）─────────────

        float hitStaggerLeft, hitchLeft;
        IDisposable stunTaken;

        /// <summary>硬直 / 眩晕 / 顿一下开始（敌人, 哪一层, 秒数）：特效、音效、试玩套件听它</summary>
        public event Action<EnemyAI, HitLayer, float> HitLayerEntered;
        /// <summary>硬直剩余秒数（不在硬直为 0）</summary>
        public float HitStaggerLeft => hitStaggerLeft;
        /// <summary>正在硬直（受击四层的硬直，不是元素眩晕）</summary>
        public bool HitStaggered => hitStaggerLeft > 0;
        /// <summary>霸体：此刻硬直打不断（招式标了霸体、大招）。缺省 false；子类按当前招式覆写</summary>
        public virtual bool SuperArmor => false;

        /// <summary>
        /// 硬直（韧性破、回劈、机关）：统一入口。死了 / 出生中 / 霸体时返回 false；否则交给 <see cref="OnHitStagger"/>（缺省：打断招式、撤预警、停下、播 Hit，
        /// 停摆 seconds 秒，到点 <see cref="OnHitStaggerEnd"/>），成功时发 <see cref="HitLayerEntered"/>。from = 打来的方向上的一点（表现用）
        /// </summary>
        public bool HitStagger(float seconds, Vector3 from, HitCause cause = HitCause.Poise)
        {
            if (Dead || state == "spawn" || !(seconds > 0) || !float.IsFinite(seconds) || SuperArmor) return false;
            bool ok;
            try
            {
                ok = OnHitStagger(seconds, from, cause);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                ok = false;
            }
            if (ok) RaiseHitLayer(HitLayer.Stagger, seconds);
            return ok;
        }

        /// <summary>
        /// 眩晕（反制、破防、封脉）：统一入口。死了 / 出生中返回 false；否则交给 <see cref="OnHitStun"/>（缺省：元素眩晕——头顶晕圈、AI 停摆、精英 ×0.75；
        /// 期间受伤 × <see cref="HitReaction.StunTakenMult"/>），成功时发 <see cref="HitLayerEntered"/>
        /// </summary>
        public bool HitStun(float seconds, HitCause cause, string why = null)
        {
            if (Dead || state == "spawn" || !(seconds > 0) || !float.IsFinite(seconds)) return false;
            bool ok;
            try
            {
                ok = OnHitStun(seconds, cause, why);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                ok = false;
            }
            if (ok) RaiseHitLayer(HitLayer.Stun, seconds);
            return ok;
        }

        /// <summary>顿一下（轻怪每挨一枪）：AI 停 seconds 秒、不打断招式（已经在顿的取较长）</summary>
        public void Hitch(float seconds)
        {
            if (Dead || state == "spawn" || !(seconds > 0) || !float.IsFinite(seconds)) return;
            bool was = hitchLeft > 0;
            hitchLeft = Mathf.Max(hitchLeft, seconds);
            if (!was) RaiseHitLayer(HitLayer.Flinch, seconds);
        }

        /// <summary>硬直的表现与状态（子类覆写表现；返回 false = 不进）。缺省：脚本位移就地收住、停下、打断招式、播 Hit、停摆 seconds 秒</summary>
        protected virtual bool OnHitStagger(float seconds, Vector3 from, HitCause cause)
        {
            if (manual && !launched) EndManualMotion();
            Stop();
            InterruptAttack();
            hitStaggerLeft = Mathf.Max(hitStaggerLeft, seconds);
            Play("Hit", 0.05f);
            return true;
        }

        /// <summary>硬直结束：缺省回到初始状态</summary>
        protected virtual void OnHitStaggerEnd()
        {
            PlayLocomotion();
            SetState(InitialState);
        }

        /// <summary>眩晕的表现与状态（子类覆写表现；返回 false = 没晕上）。缺省：元素眩晕 + 受伤 +25%（醒来时撤掉）</summary>
        protected virtual bool OnHitStun(float seconds, HitCause cause, string why)
        {
            if (!EnemyStatus.Stun(hp, seconds)) return false;
            stunTaken ??= hp.Incoming.Add((in IncomingHit h) => HitReaction.StunTakenMult);
            return true;
        }

        void RaiseHitLayer(HitLayer layer, float seconds)
        {
            if (HitLayerEntered == null) return;
            try
            {
                HitLayerEntered(this, layer, seconds);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>
        /// 招式被打断（同 Three.js StandardEnemy.cancelAttack）：收起预警物、撤掉临时的减伤 / 移动参数。
        /// 基类在眩晕、死亡、玩家阵亡、坠落回收时调用（名额已经归还）；死亡时身体可能还在空中，不要在这里交还导航。
        /// </summary>
        protected virtual void CancelAttack() { }

        /// <summary>玩家阵亡时的待机：打断招式、停下、熄灭前摇发光；空中的（跳跃 / 冲锋）水平速度清零，落地后交还导航</summary>
        void StepIdle()
        {
            if (state != IdleState)
            {
                InterruptAttack();
                if (manual) motion.velocity.x = motion.velocity.z = 0;
                PlayLocomotion();
                SetState(IdleState);
            }
            if (manual && ManualGrounded) EndManualMotion();
            Stop();
            body.SetGlow(0, 0);
        }

        // ───────────── 坠落回收 ─────────────
        /// <summary>掉到最后站过的导航网格点以下多深算掉出世界（同 TS floorY − 12）</summary>
        public const float FallDepth = 12f;
        /// <summary>
        /// 被掀飞（<see cref="LaunchUp"/>）的这一趟按多深算掉出世界：从悬空的甲板 / 桥上被打下去要落 20 m 左右才到熔岩 / 下一层
        /// （第三章 v2 S3：3-2 悬炉锻台离熔岩井 19.5 m），按 12 m 算会在半空被传回台上
        /// </summary>
        public const float LaunchFallDepth = 40f;
        /// <summary>脚本位移（跳、冲锋、被掀飞）找脚下地面的射线有多长（米）：短了会在高台外的半空「落地」被吸回台上</summary>
        public const float ManualGroundProbe = 60f;
        /// <summary>不在脚本位移里却离开导航网格多久就拉回（秒）</summary>
        public const float OffMeshGrace = 2.5f;

        Vector3 lastOnMesh;
        bool hasOnMesh;
        float offMeshTime;

        /// <summary>走导航网格（飞行基类 E3 覆盖成 false：不做离网回收）</summary>
        protected virtual bool UsesNavMesh => true;

        /// <summary>最后站过的导航网格点（离网之前的位置；软边界的拴绳在界内找不到落点时退回这里）。出生后还没上过网格时返回 false</summary>
        public bool TryLastOnMesh(out Vector3 p)
        {
            p = lastOnMesh;
            return hasOnMesh;
        }

        /// <summary>坠落 / 离网检查；返回 true 表示这一帧被传送或处决了（本帧不再思考）</summary>
        bool StepFallRecovery(float dt)
        {
            if (!UsesNavMesh || !agent || !agent.enabled) return false;
            var p = transform.position;
            bool finite = float.IsFinite(p.x) && float.IsFinite(p.y) && float.IsFinite(p.z);
            if (finite && !manual && agent.isOnNavMesh)
            {
                lastOnMesh = p;
                hasOnMesh = true;
                offMeshTime = 0;
                return false;
            }
            bool fell = !finite || p.y < lastOnMesh.y - (launched ? LaunchFallDepth : FallDepth);
            // 只是落到了更低的地面上（跳下高台、冲下陡坡）：脚下 3 m 内就有导航网格，参考点跟着下来，不算掉出世界
            if (fell && finite && NavMesh.SamplePosition(p, out var below, 3f, NavMesh.AllAreas))
            {
                lastOnMesh = below.position;
                hasOnMesh = true;
                fell = false;
            }
            if (!fell)
            {
                offMeshTime = manual ? 0 : offMeshTime + dt;
                if (offMeshTime < OffMeshGrace) return false;
                offMeshTime = 0;
            }
            return Recover(fell);
        }

        /// <summary>
        /// 传回最近的导航网格点：离网的先在当前位置附近 6 m 找；掉出世界的在最后站过的点附近 4 m 找（再试正上方那一层）。
        /// 掉出世界又找不到网格的静默处决（不给奖励）；只是离网而找不到的不处理，过一会儿再试
        /// </summary>
        bool Recover(bool fell)
        {
            var p = transform.position;
            bool finite = float.IsFinite(p.x) && float.IsFinite(p.y) && float.IsFinite(p.z);
            NavMeshHit hit = default;
            bool found = (finite && !fell && NavMesh.SamplePosition(p, out hit, 6f, NavMesh.AllAreas))
                         || ((fell || hasOnMesh) && NavMesh.SamplePosition(lastOnMesh, out hit, 4f, NavMesh.AllAreas))
                         || (finite && fell && NavMesh.SamplePosition(new Vector3(p.x, lastOnMesh.y, p.z), out hit, 6f, NavMesh.AllAreas));
            if (!found)
            {
                if (!fell) return false;
                Debug.LogWarning($"[Enemy] {name} 掉出世界且附近没有导航网格：静默处决");
                hp.noReward = true;
                Combat.Execute(hp, true);
                return true;
            }
            // 掉出世界本不该发生（冲锋、跳跃有台沿 / 落点保护）：留一行位置，查是从哪儿掉下去的
            if (fell) Debug.LogWarning($"[Enemy] {name} 掉出世界（{(finite ? $"({p.x:F1}, {p.y:F1}, {p.z:F1})" : "位置非法")}，最后站过的网格点 ({lastOnMesh.x:F1}, {lastOnMesh.y:F1}, {lastOnMesh.z:F1})，状态 {state}）：传回 ({hit.position.x:F1}, {hit.position.y:F1}, {hit.position.z:F1})");
            InterruptAttack();
            manual = false;
            motion.velocity = Vector3.zero;
            push = Vector3.zero;
            agent.updatePosition = true;
            transform.position = hit.position;
            agent.Warp(hit.position);
            lastOnMesh = transform.position;
            hasOnMesh = true;
            var loco = GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
            if (state != "spawn")
            {
                PlayLocomotion();
                SetState(InitialState);
            }
            return true;
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
        /// 加成合计写回（<see cref="Buffs"/> 变化时）：伤害 / 攻速 / 移速进 aura*，承伤进 <see cref="Damageable.damageTakenMult"/>。
        /// 邪飞天的光环（16 m，多只不叠加）与赐福（10 s）由她自己登记，数值见 <see cref="ApsaraAI.AuraMods"/> / <see cref="ApsaraAI.BlessMods"/>
        /// </summary>
        void ApplyBuffs(BuffMods t)
        {
            auraDamage = t.damage;
            auraAttackRate = t.rate;
            auraSpeed = t.speed;
            if (hp) hp.damageTakenMult = t.taken;
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

        /// <summary>弱点发光壳的亮度目标（0..1，发光通道 0，见 <see cref="EnemyBody.glow"/>）：各敌人按状态每帧写</summary>
        protected float Glow { set => body.SetGlow(0, value); }

        /// <summary>某个发光通道的亮度目标（0 = 主前摇；1、2 给子类区分不同招式，同 TS glowTarget[ch]）</summary>
        protected void SetGlow(int channel, float value) => body.SetGlow(channel, value);

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
            var v = manual ? motion.velocity : agent.desiredVelocity;
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
            var v = manual ? motion.velocity : agent.velocity;
            v.y = 0;
            if (v.sqrMagnitude > 0.25f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(v), rateDeg * dt);
        }

        Vector3 push;

        /// <summary>还没推完的水平击退速度（m/s，按 8/s 衰减；<see cref="LaunchUp"/> 时整段交给脚本位移）——熔岩推下台沿按落点重算推力时读</summary>
        public Vector3 PendingPush => push;

        /// <summary>击退冲量（水平，m/s）超过这么多才算失控（同 TS EnemyBase.knockback：impulse.lengthSq() &gt; 4）</summary>
        public const float ControlLossImpulse = 2f;
        /// <summary>失控时长（秒，再 × (1 − 击退抗性)；同 TS 0.25 × k）</summary>
        public const float ControlLossTime = 0.25f;
        float controlLossUntil = float.NegativeInfinity;

        /// <summary>
        /// 正被击退（失控滑行中；同 TS EnemyBase.knockedBack = controlLoss &gt; 0）：熔岩据此判「被打进去」（<see cref="LavaField"/>）。
        /// 只有 <see cref="Knockback"/> 给的够大的冲量算；导航自己走、传送（Warp）、落地吸附、坠落回收都不算
        /// </summary>
        public bool KnockedBack => !Dead && Time.time < controlLossUntil;

        /// <summary>一次击退冲量造成的失控秒数（只看水平分量）：冲量 ≤ <see cref="ControlLossImpulse"/> 或被抗性全挡时为 0</summary>
        public static float ControlLoss(Vector3 impulse, float resist)
        {
            float k = 1 - resist;
            impulse.y = 0;
            return k > 0 && impulse.sqrMagnitude > ControlLossImpulse * ControlLossImpulse ? ControlLossTime * k : 0;
        }

        /// <summary>
        /// 击退（Three.js EnemyBase.knockback）：水平冲量 × (1 − 击退抗性) 叠到一个推力上，沿导航网格推开、按 8/s 衰减；
        /// 冲量够大时失控 <see cref="ControlLoss"/> 秒（<see cref="KnockedBack"/>）。跳跃 / 冲锋这类脚本位移期间不推（不打断招式的轨迹）
        /// </summary>
        public void Knockback(Vector3 impulse)
        {
            if (Dead) return;
            float k = 1 - knockbackResist;
            if (k <= 0) return;
            impulse.y = 0;
            push += impulse * k;
            if (push.sqrMagnitude > 81) push = push.normalized * 9;
            float loss = ControlLoss(impulse, knockbackResist);
            if (loss > 0) controlLossUntil = Mathf.Max(controlLossUntil, Time.time + loss);
        }

        void StepPush(float dt)
        {
            if (push.sqrMagnitude < 0.0004f) return;
            if (!manual && agent.isOnNavMesh) agent.Move(push * dt);
            push *= Mathf.Exp(-8f * dt);
        }

        /// <summary>被掀飞时的重力（同 Three.js EnemyBase 的 GRAVITY）</summary>
        public const float LaunchGravity = 26f;
        bool launched;

        /// <summary>正被 <see cref="LaunchUp"/> 掀在半空（落地前）</summary>
        public bool LaunchedUp => launched;

        float launchY;

        /// <summary>最近一次被 <see cref="LaunchUp"/> 掀起的时刻（Time.time；没被掀过为 −1）、竖直初速、这一趟离起飞点的最高高度——冒烟测试与调试读取，不靠逐帧采样</summary>
        public float LastLaunchTime { get; private set; } = -1;
        public float LastLaunchSpeed { get; private set; }
        public float LastLaunchPeak { get; private set; }
        /// <summary>最近一次 <see cref="LaunchUp"/> 没掀起来的原因（dead / manual / spawn / no-navmesh / agent / velocity / resist）；掀起来了为 null</summary>
        public string LastLaunchRefusal { get; private set; }

        /// <summary>
        /// 击飞上抛（Three.js EnemyBase.knockback 的竖直分量；裂地重击、磐石壁垒、厚皮的冲击波用）：上抛速度 × (1 − 击退抗性)，
        /// 连同还没推完的水平击退（<see cref="Knockback"/> 先调）一起交给脚本位移，重力 26，落地交还导航。
        /// 首领（抗性 1）、不走导航网格的（飞行）、出生中、已经在跳跃 / 冲锋这类脚本位移里的不受影响。返回是否掀起来了
        /// </summary>
        public bool LaunchUp(float velocity)
        {
            float vy = velocity * (1 - knockbackResist);
            LastLaunchRefusal = Dead ? "dead"
                : manual ? "manual"
                : state == "spawn" ? "spawn"
                : !UsesNavMesh ? "no-navmesh"
                : !agent || !agent.enabled ? "agent"
                : !(velocity > 0) ? "velocity"
                : vy < 0.5f ? "resist"
                : null;
            if (LastLaunchRefusal != null) return false;
            var v = push;
            v.y = vy;
            push = Vector3.zero;
            BeginManualMotion(v, LaunchGravity);
            launched = true;
            launchY = transform.position.y;
            LastLaunchTime = Time.time;
            LastLaunchSpeed = vy;
            LastLaunchPeak = 0;
            return true;
        }

        /// <summary>离开导航网格的位移（跳跃、冲锋、遁地）：给初速度与重力，脚本按物理推进；落地 / 结束时交还 agent</summary>
        protected void BeginManualMotion(Vector3 velocity, float gravity) => BeginManualMotion(new ScriptedMotion(velocity, gravity));

        /// <summary>
        /// 同上，带可选的护栏（首领冲锋用）：水平里程上限（预警线多长就冲多远）、防冲下台沿（<see cref="ScriptedMotion.ledgeDrop"/>）。
        /// 碰到台沿停下水平速度、<see cref="HitLedge"/> 置位（同撞墙的 <see cref="HitWall"/>），里程用完 <see cref="ManualRunSpent"/>
        /// </summary>
        protected void BeginManualMotion(ScriptedMotion m)
        {
            launched = false;
            manual = true;
            motion = m;
            motion.hitWall = motion.hitLedge = false;
            HitLedge = false;
            if (agent.isOnNavMesh) agent.isStopped = true;
            agent.updatePosition = false;
        }

        protected void SetManualVelocity(Vector3 v) => motion.velocity = v;
        protected Vector3 ManualVelocity => motion.velocity;
        protected bool ManualGrounded { get; private set; }
        /// <summary>这一程的水平里程上限用完了（没设上限时永远 false）</summary>
        protected bool ManualRunSpent => manual && motion.RunSpent;

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
            transform.position = motion.Step(transform.position, dt);
            ManualGrounded = motion.grounded;
            // 撞墙 / 台沿：同一程里记着，直到下一程开始（子类也会自己清 / 置 HitWall）
            if (motion.hitWall) HitWall = true;
            if (motion.hitLedge) HitLedge = true;
            motion.hitWall = motion.hitLedge = false;
        }

        protected bool HitWall { get; set; }
        /// <summary>这一程脚本位移在台沿前刹住了（开了 <see cref="ScriptedMotion.ledgeDrop"/> 才会置位）</summary>
        protected bool HitLedge { get; private set; }

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
            return Combat.DamagePlayer(dmg, from, Element.None, this) > 0;
        }

        /// <summary>诱饵挡下一击：全场共用节流，免得一群怪同时刷屏</summary>
        public static void DecoyBlocked(Transform decoy)
        {
            if (!decoy || Time.time < blockTextAt) return;
            blockTextAt = Time.time + 0.45f;
            GameUI.FloatText(decoy.position + Vector3.up * 0.9f + UnityEngine.Random.insideUnitSphere * 0.25f, "格挡", new Color(0.82f, 0.86f, 0.95f), 0.9f);
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
    /// 一程脚本位移（跳、冲锋、被掀飞；<see cref="EnemyAI"/> 每帧调 <see cref="Step"/>）：速度 + 重力推进，水平方向被墙挡住就停下水平速度，
    /// 落到脚下 <see cref="EnemyAI.ManualGroundProbe"/> 米内的地面上。只有数据和物理 / 导航查询，不碰组件——EditMode 测试按任意 dt 直接驱动。
    /// 两道可选护栏（首领冲锋用，不开时和原来逐帧一致）：
    ///   · 水平里程上限 <see cref="runLeft"/>：预警线多长就冲多远，大帧时间下最后一步也不冲过头；
    ///   · 防冲下台沿 <see cref="ledgeDrop"/>：这一步的整段位移每 <see cref="LedgeProbeStep"/> 米探一点（不是只看步末——帧时间 0.1–0.33 s 时
    ///     一步有 2–8 m，只看步末会整个越过台沿），某一点脚下 ledgeDrop 米内没有地面、或 <see cref="LedgeNavReach"/> 米内没有导航网格，
    ///     就停在台沿前 <see cref="LedgeLead"/> 米、停下水平速度、<see cref="hitLedge"/> 置位。
    /// </summary>
    public struct ScriptedMotion
    {
        /// <summary>
        /// 台沿扫描：探点间距、停在台沿前多远（身体中心）、一步能踩上去多高（再高的是墙，归撞墙管）、
        /// 导航网格要在多近（= <see cref="EnemyAI"/> 交还导航时的吸附半径：停在这里交得回导航，不会离网）
        /// </summary>
        public const float LedgeProbeStep = 0.5f, LedgeLead = 0.6f, LedgeRise = 1.2f, LedgeNavReach = 4f;
        /// <summary>首领冲锋的台沿落差（米）：浅渠（0.6 m）、坡道照冲，2 m 以上的台沿、断崖、深坑刹住</summary>
        public const float BossLedgeDrop = 2f;

        public Vector3 velocity;
        public float gravity;
        /// <summary>剩余水平里程（米）；∞ = 不限</summary>
        public float runLeft;
        /// <summary>防冲下台沿：前一个探点到下一个探点地面落差超过它（米）就算台沿；0 = 不查</summary>
        public float ledgeDrop;
        /// <summary>撞墙 / 在台沿前刹住（置位后一直留着，由调用方清）、上一步落在地上</summary>
        public bool hitWall, hitLedge, grounded;

        public ScriptedMotion(Vector3 velocity, float gravity, float maxRun = float.PositiveInfinity, float ledgeDrop = 0)
        {
            this.velocity = velocity;
            this.gravity = gravity;
            runLeft = maxRun > 0 ? maxRun : 0;
            this.ledgeDrop = Mathf.Max(0, ledgeDrop);
            hitWall = hitLedge = grounded = false;
        }

        /// <summary>水平里程上限用完了（没设上限时永远 false）</summary>
        public bool RunSpent => runLeft <= 1e-3f;

        /// <summary>推进 dt 秒，返回新位置</summary>
        public Vector3 Step(Vector3 p, float dt)
        {
            velocity.y -= gravity * dt;
            var step = velocity * dt;
            // 撞墙：水平方向被建筑 / 地形挡住就停下水平速度
            var flat = new Vector3(step.x, 0, step.z);
            if (flat.sqrMagnitude > 1e-6f && Physics.Raycast(p + Vector3.up * 0.5f, flat.normalized, out var wall, flat.magnitude + 0.4f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                && wall.normal.y < 0.5f)
            {
                velocity.x = velocity.z = 0;
                step.x = step.z = 0;
                hitWall = true;
            }
            // 护栏：里程上限、台沿——都按这一步的整段位移算
            float run = Mathf.Sqrt(step.x * step.x + step.z * step.z);
            if (run > 1e-6f && (ledgeDrop > 0 || runLeft < run))
            {
                var dir = new Vector3(step.x / run, 0, step.z / run);
                float allowed = Mathf.Min(run, runLeft);
                if (ledgeDrop > 0 && allowed > 0)
                {
                    float free = LedgeFree(p, dir, allowed, ledgeDrop);
                    if (free < allowed)
                    {
                        allowed = free;
                        hitLedge = true;
                    }
                }
                if (allowed < run)
                {
                    step.x = dir.x * allowed;
                    step.z = dir.z * allowed;
                    velocity.x = velocity.z = 0;
                }
                run = allowed;
            }
            if (!float.IsPositiveInfinity(runLeft)) runLeft = Mathf.Max(0, runLeft - run);
            float fromY = p.y;
            p += step;
            // 找脚下地面：射线从新位置上方 3 m 往下打——但这一步往下沉了 2.5 m 以上时（重力 30、一帧 0.33 s 就沉 3.3 m），
            // 新位置上方 3 m 已经埋在地面下面，地形打不到、整个穿过去（11-07 boss-warlord 突刺「掉下平台」的根因）。
            // 起点不低于上一步脚下 + 0.5 m：这一步竖直扫过的整段都查到。正常帧（一步沉不到 2.5 m）起点和原来一样
            float originY = Mathf.Max(p.y + 3f, fromY + 0.5f);
            float ground = Physics.Raycast(new Vector3(p.x, originY, p.z), Vector3.down, out var below, EnemyAI.ManualGroundProbe + (originY - p.y - 3f),
                Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? below.point.y : p.y;
            grounded = p.y <= ground + 0.02f && velocity.y <= 0;
            if (p.y < ground)
            {
                p.y = ground;
                if (velocity.y < 0) velocity.y = 0;
            }
            return p;
        }

        /// <summary>
        /// 从 from（脚下）沿水平方向 dir 最多走 distance 米，台沿之前能走多远：每 <see cref="LedgeProbeStep"/> 米探一点、找到台沿后二分到 6 cm，
        /// 身体中心停在台沿前 lead 米（台沿就在 distance 外 lead 米以内时也提前停）。一路都安全时原样返回 distance
        /// </summary>
        public static float LedgeFree(Vector3 from, Vector3 dir, float distance, float maxDrop, float lead = LedgeLead)
        {
            if (!(distance > 0)) return 0;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-8f) return distance;
            dir.Normalize();
            float reach = distance + Mathf.Max(0, lead), refY = from.y, safe = 0;
            int n = Mathf.CeilToInt(reach / LedgeProbeStep);
            for (int i = 1; i <= n; i++)
            {
                float at = Mathf.Min(i * LedgeProbeStep, reach);
                if (LedgeGround(from + dir * at, refY, maxDrop, out float y))
                {
                    refY = y;
                    safe = at;
                    continue;
                }
                // 台沿在 (safe, at] 之间
                float lo = safe, hi = at, loY = refY;
                for (int k = 0; k < 3; k++)
                {
                    float mid = (lo + hi) * 0.5f;
                    if (LedgeGround(from + dir * mid, loY, maxDrop, out float ym))
                    {
                        lo = mid;
                        loY = ym;
                    }
                    else hi = mid;
                }
                return Mathf.Clamp(lo - lead, 0, distance);
            }
            return distance;
        }

        /// <summary>q 处（水平位置）有没有可站的地面：比 refY 高不过 <see cref="LedgeRise"/>、低不过 maxDrop，且 <see cref="LedgeNavReach"/> 米内有导航网格；y = 地面高度</summary>
        public static bool LedgeGround(Vector3 q, float refY, float maxDrop, out float y)
        {
            y = refY;
            var top = new Vector3(q.x, refY + LedgeRise, q.z);
            if (!Physics.Raycast(top, Vector3.down, out var hit, LedgeRise + maxDrop, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return false;
            if (!NavMesh.SamplePosition(hit.point, out _, LedgeNavReach, NavMesh.AllAreas)) return false;
            y = hit.point.y;
            return true;
        }
    }
}
