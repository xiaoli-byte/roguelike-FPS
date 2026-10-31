using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>四种死法（combat 1.1）：普通 / 弱点击杀 / 爆炸击杀；带电是另记的一面（倒下时放电，<see cref="PlateauEnemyAI.DiedCharged"/>）</summary>
    public enum PlateauDeath { Normal, Weak, Blast }

    /// <summary>
    /// 第四章雷魅的底座（网页 src/world/plateau/play/foe.ts 的 Unity 版；设计单 docs/art/vfx/foes-ch4.md 0.3）：
    ///   · 招式时间轴：<see cref="Begin"/> 开一招（<see cref="PlateauMoveRunner"/>，状态名 = 招式 id，片段按招式总长拉伸），
    ///     时间点（warn / glint / hit / release / land / 自定义）跟动画事件走、时间兜底，交给 <see cref="OnMoveEvent"/>；
    ///     每帧 <see cref="MoveTick"/>，结束 / 被打断回 <see cref="Fight"/>。glint 统一在发光骨骼上闪白星。
    ///   · 兽群：出生入群（<see cref="PlateauPack"/>），没发现玩家时在领地里踱步回血（roam），看见了 / 挨打了整群警觉（<see cref="Notice"/>）；
    ///     玩家跑出领地 90 m 外脱战回家。出手令牌：群内（扑击 2、天狗扑咬 1、远程 2、雷吠 1）+ 全局 <see cref="AttackTokens"/>。
    ///   · 受击四层：韧性、硬直、眩晕走 F 路的统一入口（EnemyDef.poise → Poise 组件 → <see cref="EnemyAI.HitStagger"/>），这里只覆写表现：
    ///     霸体招 <see cref="SuperArmor"/>；硬直播 <c>stagger</c> 片段；眩晕循环 <c>stun</c> 片段 + 头上一圈紫白火花。
    ///   · 带电（F 路 <see cref="Charge"/>）：带电时身上噼啪（贴着身体的短雷刃）；死时 Charge 自动把电传给同伴。
    ///   · 静电护盾（连鼓灵给的）：<see cref="ShieldLayers"/> 每层完全挡一次伤害（持续伤害不算）；加速走 <see cref="EnemyBuffs"/>（<see cref="HasteChannel"/>）。
    ///   · 四种死法：普通（布娃娃）/ 弱点（白闪 + 头一甩）/ 爆炸（掀起、打转）/ 带电（放电），<see cref="OnDeath"/> 给子类加自己的（帝江炸、连鼓灵散架）。
    ///   · 飞行的（蛮蛮、连鼓灵）：<see cref="Flies"/> = true 时停用导航，位置由子类按运动学推（<see cref="FlyTowards"/>）。
    /// 子类不要另写 OnDestroy（会盖掉 EnemyAI 的反登记），静态事件在 <see cref="Subscribe"/> 里成对订阅。
    /// </summary>
    public abstract class PlateauEnemyAI : InfernoEnemyAI
    {
        /// <summary>连鼓灵红鼓的加速通道（同伴移速 / 出手速度 +40%）</summary>
        public const string HasteChannel = "plateau.haste";
        /// <summary>玩家跑出领地多远脱战（米）</summary>
        public const float LeashRange = 90f;

        /// <summary>测试 / 演示时强制的雷暴强度（null = 读 <see cref="PlateauStorm.Level"/>）</summary>
        public static float? StormOverride;
        public static float StormLevel => StormOverride ?? PlateauStorm.Level;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => StormOverride = null;

        // ───────────── 规格（子类 Awake 里、base.Awake 之前设，设计尺寸）─────────────
        /// <summary>前摇发光 / 白星的骨骼（雷纹、雷球、掌印、独眼、雷冠）与光晕大小（米）</summary>
        protected string glowBoneName;
        protected float glowSize = 0.8f;
        /// <summary>发现玩家的视距</summary>
        protected float sight = 30f;
        /// <summary>身体中心离地（设计尺寸，反应爆点、雷弧落点、噼啪的中心）</summary>
        protected float centerY = 0.6f;
        /// <summary>不走导航（蛮蛮、连鼓灵）</summary>
        protected virtual bool Flies => false;

        public readonly PlateauMoveRunner Move = new();
        public PlateauPack Pack { get; private set; }
        public bool Alerted { get; private set; }
        /// <summary>静电护盾层数（连鼓灵给，最多 3）</summary>
        public int ShieldLayers { get; private set; }
        public PlateauDeath LastDeath { get; private set; }
        public bool DiedCharged { get; private set; }
        /// <summary>护盾挡下过几次（测试用）</summary>
        public int ShieldBlocks { get; private set; }
        public bool Charged => hp && !hp.Dead && Charge.IsCharged(hp);
        public Vector3 Center => transform.position + Vector3.up * centerY * Size;
        public Transform GlowBone => glowBone;
        /// <summary>最近一次的时间点与时刻（试玩套件 / 节拍条读）</summary>
        public string LastEvent { get; private set; }
        public float LastEventAt { get; private set; } = -1;
        /// <summary>每个时间点（敌人, 时间点名）：试玩套件、节拍条听它</summary>
        public event Action<PlateauEnemyAI, string> MoveEvent;

        protected Vector3 home;
        protected readonly List<TelegraphHandle> warns = new();
        readonly List<string> fired = new();
        Transform glowBone, glowSprite;
        Renderer glowR;
        float crackleT, stunFxT, roamT;
        bool chargedLast;
        IDisposable shieldMod;

        protected override string InitialState => Alerted ? "chase" : "roam";
        public override bool SuperArmor => Move.Busy && Move.Def.armored;
        protected override bool UsesNavMesh => !Flies;
        protected float HasteMult => Mathf.Max(1f, auraAttackRate);
        public static readonly Color GlowColor = Hex.Rgb(0xff6ae0);

        protected override void Awake()
        {
            base.Awake();
            if (Flies && agent) agent.enabled = false;
            if (body.Rig) body.Rig.AnimEvent += OnRigEvent;
            hp.Died += OnPlateauDied;
            hp.Damaged += OnPlateauDamaged;
            shieldMod = hp.Incoming.Add(ShieldIncoming);
            GlowStyle(0.06f, 0.03f, 2.6f, 0.9f);
        }

        /// <summary>子类要订阅的静态事件放这里（OnEnable / OnDisable 成对）</summary>
        protected virtual void Subscribe(bool on) { }

        void OnEnable() => Subscribe(true);
        void OnDisable() => Subscribe(false);

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            home = transform.position;
            Pack = PlateauPack.Join(this);
            if (Pack.alerted) Alerted = true;
            OnJoined();
        }

        protected override void Start()
        {
            base.Start();
            if (!string.IsNullOrEmpty(glowBoneName)) glowBone = InfernoKit.FindBone(transform, glowBoneName);
            if (glowBone)
            {
                glowSprite = FxMaterials.GlowSprite(glowBone, 1f, GlowColor);
                glowR = glowSprite.GetComponent<Renderer>();
                glowR.enabled = false;
            }
        }

        /// <summary>入群之后（哨兵、成对、洞口）</summary>
        protected virtual void OnJoined() { }

        // ───────────── 每帧 ─────────────

        protected override void Update()
        {
            base.Update();
            if (Dead) return;
            float dt = Time.deltaTime;
            if (Stunned)
            {
                ActLoop("stun");
                stunFxT -= dt;
                if (stunFxT <= 0)
                {
                    stunFxT = 0.22f;
                    var head = Center + Vector3.up * centerY * Size * 0.9f;
                    float a = Time.time * 7f;
                    Fx.PlateauSparks(head + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * 0.35f * Size, 2, 1.5f, 0.06f);
                }
            }
            // 带电：贴着身体的短雷刃噼啪
            bool ch = Charged;
            chargedLast = ch;
            if (ch)
            {
                crackleT -= dt;
                if (crackleT <= 0)
                {
                    crackleT = Random.Range(0.12f, 0.27f);
                    Fx.PlateauCrackle(Center, 0.5f * Size);
                }
            }
        }

        /// <summary>动画之后：发光骨骼的光晕（子类覆写时先调 base）</summary>
        protected virtual void LateUpdate()
        {
            if (!glowSprite) return;
            float g = Dead ? 0 : body.GlowLevel(0);
            glowR.enabled = g > 0.03f;
            if (!glowR.enabled) return;
            float parent = Mathf.Max(1e-3f, Mathf.Abs(glowBone.lossyScale.x));
            glowSprite.localScale = Vector3.one * glowSize * Size * (0.25f + 0.75f * g) / parent;
            FxMaterials.Tint(glowR, new Color(GlowColor.r, GlowColor.g, GlowColor.b, 0.3f + 0.6f * g));
        }

        protected sealed override void Think(float dt)
        {
            if (!Alerted)
            {
                Roam(dt);
                return;
            }
            if (Move.Busy)
            {
                Move.speed = HasteMult;
                string id = Move.Id;
                Move.Tick(dt, fired);
                Dispatch(id);
                if (Move.Busy && Move.Id == id) MoveTick(dt, Move.Stage, Move.StageK);
                else if (!Move.Busy && state == id) EndMove(id);
                if (Move.Busy) UpdateMoveGlow();
                return;
            }
            Glow = 0.08f;
            // 脱战：玩家跑出领地
            if (Leashes && Vector3.Distance(PlateauPack.Flat(PlayerPos), PlateauPack.Flat(home)) > LeashRange && DistToPlayer > 60f)
            {
                Alerted = false;
                if (Pack != null) Pack.alerted = false;
                SetState("roam");
                return;
            }
            Fight(dt, DistToPlayer);
        }

        /// <summary>会不会脱战（穷奇游猎自己管）</summary>
        protected virtual bool Leashes => true;

        void Dispatch(string id)
        {
            for (int i = 0; i < fired.Count; i++)
            {
                var e = fired[i];
                LastEvent = e;
                LastEventAt = Time.time;
                if (e == "glint") Glint();
                try
                {
                    if (e != "end") OnMoveEvent(id, e);
                    MoveEvent?.Invoke(this, e);
                }
                catch (Exception ex)
                {
                    Debug.LogException(ex);
                }
                if (!Move.Busy || Move.Id != id) break;
            }
        }

        /// <summary>前摇发光：前摇里从暗到亮、出手满亮、收招暗下（子类可另写）</summary>
        protected virtual void UpdateMoveGlow()
        {
            var st = Move.Stage;
            Glow = st == MoveStage.Windup ? Move.StageK : st == MoveStage.Active ? 1f : 0.1f;
        }

        void OnRigEvent(string evt) => Move.OnAnimEvent(evt);

        // ───────────── 招式 ─────────────

        /// <summary>开一招：状态名 = 招式 id，片段按招式总长（÷ 出手速度）拉伸；warn 在这一帧就出</summary>
        protected void Begin(PlateauMove m)
        {
            if (m == null || Dead) return;
            if (Move.Busy) InterruptAttack();
            Move.Start(m);
            Move.speed = HasteMult;
            SetState(m.id);
            warns.Clear();
            ActTimed(m.id, m.Total / Move.speed, 0.1f);
            OnMoveBegin(m);
            Move.Tick(0, fired);
            Dispatch(m.id);
        }

        /// <summary>出手段提前收（踩踏撞到东西、滑翔落地）：片段跳到收招段</summary>
        protected void FinishActive()
        {
            if (!Move.Busy || Move.Stage != MoveStage.Active) return;
            Move.FinishActive();
            if (HasAnim(Move.Id) && anim && anim.isActiveAndEnabled) anim.CrossFadeInFixedTime(Move.Id, 0.1f, 0, Move.RecoverClipTime);
        }

        void EndMove(string id)
        {
            Pack?.Give(this);
            ReleaseAttack();
            warns.Clear();
            SetState(InitialState);
            Loco();
            try
            {
                OnMoveEnd(id);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>招式被打断（硬直、眩晕、死亡、玩家阵亡）：撤回还没填满的预警、还令牌</summary>
        protected override void CancelAttack()
        {
            if (Move.Busy)
            {
                string id = Move.Id;
                Move.Cancel();
                try
                {
                    OnInterrupt(id);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            foreach (var w in warns)
                if (w.Alive && w.Pending)
                    w.Cancel();
            warns.Clear();
            Pack?.Give(this);
        }

        /// <summary>画一个预警并登记（被打断时撤回还没填满的）</summary>
        protected TelegraphHandle Warn(TelegraphHandle h)
        {
            if (h.Alive) warns.Add(h);
            return h;
        }

        /// <summary>拿令牌：群内的 + 全局的</summary>
        protected bool TakeToken(PlateauPack.Token kind, AttackTokens.Kind global, float hold)
        {
            if (Pack != null && !Pack.Take(this, kind)) return false;
            if (RequestAttack(global, hold)) return true;
            Pack?.Give(this);
            return false;
        }

        protected bool HoldingToken(PlateauPack.Token kind) => Pack != null && Pack.Holding(this, kind);

        void Glint()
        {
            var at = glowBone ? glowBone.position : Center + Vector3.up * centerY * Size;
            Fx.PlateauGlint(at, 1.1f * Size);
        }

        // ───────────── 子类钩子 ─────────────

        /// <summary>警觉之后、没在出招：选招、走位</summary>
        protected abstract void Fight(float dt, float dist);
        /// <summary>招式开始（warn 之前）：摆条件、记落点</summary>
        protected virtual void OnMoveBegin(PlateauMove m) { }
        /// <summary>招式的时间点（warn / glint / hit / release / land / 自定义；end 不发）</summary>
        protected virtual void OnMoveEvent(string id, string evt) { }
        /// <summary>招式进行中每帧（stage 段、k 段内进度）</summary>
        protected virtual void MoveTick(float dt, MoveStage stage, float k) { }
        /// <summary>招式正常收完</summary>
        protected virtual void OnMoveEnd(string id) { }
        /// <summary>招式被打断</summary>
        protected virtual void OnInterrupt(string id) { }
        /// <summary>发现玩家的那一刻（自己发现的 self = true；被同伴叫醒的 false）</summary>
        protected virtual void OnNotice(bool self) { }
        /// <summary>死了（死法已定、布娃娃已起）</summary>
        protected virtual void OnDeath(DamageInfo info, PlateauDeath kind) { }

        // ───────────── 兽群 / 警觉 ─────────────

        /// <summary>警觉（自己看见 / 挨打 = 叫醒整群；被同伴叫醒的不再往外传）</summary>
        public void Notice(bool propagate = true)
        {
            if (Dead) return;
            bool was = Alerted;
            Alerted = true;
            if (!was)
            {
                if (state == "roam") SetState("chase");
                try
                {
                    OnNotice(propagate);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            if (propagate) Pack?.Alert();
        }

        /// <summary>没发现玩家：领地里踱步、回血；看见了就整群醒</summary>
        protected virtual void Roam(float dt)
        {
            Glow = 0.05f;
            float back = Vector3.Distance(PlateauPack.Flat(home), PlateauPack.Flat(transform.position));
            roamT -= dt;
            if (!Flies)
            {
                if (back > 6f) MoveTo(home, moveSpeed * 0.6f);
                else if (roamT <= 0)
                {
                    roamT = Random.Range(3f, 6f);
                    var r = Random.insideUnitCircle * 3f;
                    MoveTo(home + new Vector3(r.x, 0, r.y), moveSpeed * 0.35f);
                }
                FaceMovement(240f, dt);
            }
            if (hp.health < hp.maxHealth) hp.Heal(hp.maxHealth * 0.3f * dt);
            if (vitals && !vitals.Dead && DistToPlayer < Sight && sees) Notice(true);
        }

        protected virtual float Sight => sight;

        void OnPlateauDamaged(DamageInfo info, DamageResult r)
        {
            if (!Dead && (r.total > 0 || r.blocked)) Notice(true);
        }

        // ───────────── 护盾 / 加速（连鼓灵）─────────────

        /// <summary>加一层静电护盾（最多 3 层）；返回是否加上</summary>
        public bool AddShield()
        {
            if (Dead || ShieldLayers >= 3) return false;
            ShieldLayers++;
            ShieldBubble.Hit(hp, Center, PlateauPalette.Shield);
            return true;
        }

        /// <summary>加速 seconds 秒（移速、出手速度 +40%）</summary>
        public void Haste(float seconds, object source)
        {
            if (Dead) return;
            Buffs.SetUntil(HasteChannel, source, new BuffMods(1, 1.4f, 1.4f, 1), Time.time + seconds);
        }

        public bool Hasted => Buffs.Has(HasteChannel);

        float ShieldIncoming(in IncomingHit h)
        {
            if (ShieldLayers <= 0 || Dead) return 1;
            var info = h.info;
            if (IsDot(info)) return 1;
            ShieldLayers--;
            ShieldBlocks++;
            if (ShieldLayers <= 0) ShieldBubble.Shatter(hp, info.point);
            else ShieldBubble.Hit(hp, info.point, PlateauPalette.Shield);
            return 0;
        }

        // ───────────── 受击表现（F 路入口的覆写）─────────────

        protected override bool OnHitStagger(float seconds, Vector3 from, HitCause cause)
        {
            if (!base.OnHitStagger(seconds, from, cause)) return false;
            if (HasAnim("stagger")) PlayTimed("stagger", Mathf.Max(0.3f, seconds + 0.3f), 0.06f);
            return true;
        }

        // ───────────── 死亡 ─────────────

        void OnPlateauDied(DamageInfo info)
        {
            LastDeath = IsBlast(info) ? PlateauDeath.Blast : info.weakpoint ? PlateauDeath.Weak : PlateauDeath.Normal;
            DiedCharged = chargedLast;
            if (glowR) glowR.enabled = false;
            Pack?.Leave(this);
            var dir = info.direction.sqrMagnitude > 1e-4f ? info.direction.normalized : -transform.forward;
            var flat = new Vector3(dir.x, 0, dir.z);
            flat = flat.sqrMagnitude > 1e-4f ? flat.normalized : -transform.forward;
            var ragdoll = GetComponent<CreatureRagdoll>();
            float heavy = Mathf.Clamp(hp.maxHealth / 400f, 1f, 3f) * Mathf.Max(1f, Size);
            if (LastDeath == PlateauDeath.Weak)
            {
                // 弱点击杀：弱点处一团白闪，头 / 弱点骨额外一甩，倒得更快
                var at = glowBone ? glowBone.position : Center + Vector3.up * centerY * Size;
                Fx.Play("ToonBurst", at, Vector3.up, Color.white, 0.8f * Size);
                Fx.Flash(at, Color.white, 6, 5, 0.1f);
                if (ragdoll && ragdoll.Active)
                    foreach (var p in ragdoll.parts)
                        if (p.body && (p.body.name.Contains("head") || p.body.name.Contains("neck")))
                            p.body.AddForce(flat * 4f + Vector3.up * 1.5f, ForceMode.VelocityChange);
            }
            else if (LastDeath == PlateauDeath.Blast && ragdoll && ragdoll.Active)
            {
                // 爆炸击杀：被掀起、在空中打转（大块头掀得低）
                var spin = Random.onUnitSphere * 7f;
                foreach (var p in ragdoll.parts)
                {
                    if (!p.body) continue;
                    p.body.AddForce(flat * 5f / heavy + Vector3.up * 5.5f / heavy, ForceMode.VelocityChange);
                    p.body.angularVelocity += spin / heavy;
                }
            }
            if (DiedCharged)
            {
                // 带电死亡：身上一圈紫红噼啪（传电由 Charge 自动做）
                Fx.PlateauArcRing(transform.position + Vector3.up * 0.2f, 0.4f * Size, 6, 0.9f * Size, 0.18f, 0.04f);
                Fx.PlateauSparks(Center, 10, 4f);
            }
            try
            {
                OnDeath(info, LastDeath);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 运动 / 判定小工具 ─────────────

        /// <summary>
        /// 飞行（运动学，不走导航）：水平以 speed 追 target 的 XZ，竖直追 target.y（每秒 climb 倍差值）；
        /// 前方 1.2 m 有东西挡着就往上抬。返回这一帧走过的水平距离
        /// </summary>
        protected float FlyTowards(Vector3 target, float speed, float dt, float climb = 2.5f)
        {
            var p = transform.position;
            var to = target - p;
            var flat = new Vector3(to.x, 0, to.z);
            float d = flat.magnitude;
            float step = Mathf.Min(d, speed * SpeedMult * dt);
            var move = d > 1e-4f ? flat / d * step : Vector3.zero;
            if (step > 1e-4f && Physics.SphereCast(p + Vector3.up * 0.3f, 0.35f * Size, move / step, out _, step + 1.2f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                target.y = Mathf.Max(target.y, p.y + 2f);
                move *= 0.3f;
            }
            p += move;
            p.y += (target.y - p.y) * Mathf.Min(1f, dt * climb);
            float g = GroundY(p);
            if (p.y < g + 0.2f) p.y = g + 0.2f;
            transform.position = p;
            return move.magnitude;
        }

        /// <summary>局部顿帧（释放帧：只顿自己的 Animator 0.04–0.08 s；精英的 Animator.speed 归 EliteStrike 管，这里不碰）</summary>
        protected void ImpactHold(float seconds)
        {
            if (elite || !anim || !anim.isActiveAndEnabled) return;
            anim.speed = 0.05f;
            PlateauFxSeq.After(seconds, () =>
            {
                if (anim) anim.speed = 1f;
            });
        }

        /// <summary>身子下的地面高度（往下 20 m 找，没找到就是原高度）</summary>
        protected static float Ground(Vector3 p) => GroundY(p);

        /// <summary>
        /// 在骨骼原点挂一个球形命中区（设计半径 radius，随体型放大）。shootable：角色层、子弹打得到（雷石、鼓面、翼根）；
        /// 否则是忽略射线层的触发器，只用来按命中点分区（蓑毛、头）
        /// </summary>
        protected HitZone BoneZone(string boneName, float radius, string id, bool weak, bool shootable, int priority = 0, Transform parentOverride = null)
        {
            var parent = parentOverride ? parentOverride : Bone(boneName) ?? transform;
            var go = new GameObject("Zone_" + id);
            go.layer = shootable ? Layers.Character : Layers.IgnoreRaycast;
            go.transform.SetParent(parent, false);
            var sphere = go.AddComponent<SphereCollider>();
            sphere.isTrigger = !shootable;
            sphere.radius = radius * Mathf.Abs(transform.lossyScale.x) / Mathf.Max(1e-3f, Mathf.Abs(parent.lossyScale.x));
            var rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
            return HitZone.Create(sphere, hp, body, id, 1f, weak, priority);
        }

        /// <summary>这一下落在哪一区（没有区为 null）</summary>
        protected HitZone ZoneOf(in DamageInfo info) => body.ZoneAt(info);

        /// <summary>持续伤害（灼烧 / 蚀化跳伤，不含反应）</summary>
        protected static bool IsDot(in DamageInfo info) => info.source == DamageSource.Status && !info.reaction && (info.tags & DamageTag.Reaction) == 0;

        /// <summary>爆炸 / 反应</summary>
        protected static bool IsBlast(in DamageInfo info) => info.source == DamageSource.Explosion || info.reaction || (info.tags & (DamageTag.Reaction | DamageTag.Explosion)) != 0;

        /// <summary>按难度 / 精英缩放的阈值（设计数值是 1 级普通体的血量口径）：× 当前最大生命 / 定义生命</summary>
        protected float HpScale(float defHp) => Mathf.Max(0.25f, hp.maxHealth / Mathf.Max(1f, defHp));

        /// <summary>自伤（反制：雷球在脸上炸开、手里的石头炸了）：环境伤害</summary>
        protected void SelfDamage(float amount, Vector3 at)
        {
            if (Dead || !(amount > 0)) return;
            var info = DamageInfo.Simple(amount, DamageSource.Environment, at, Vector3.up);
            info.noCrit = true;
            Combat.DamageEnemy(hp, info);
        }

        /// <summary>按名字找骨骼</summary>
        protected Transform Bone(string name) => InfernoKit.FindBone(transform, name);

        /// <summary>骨骼的世界位置（找不到用身体中心）</summary>
        protected Vector3 BonePos(Transform b) => b ? b.position : Center;

        /// <summary>打玩家（带元素、× 伤害倍率；被嘲讽时打在诱饵上）并推开</summary>
        protected bool Strike(float dmg, Vector3 from, Element element, Vector3 push)
        {
            bool hit = HitPlayer(dmg * DamageMult, from, element);
            if (hit && push.sqrMagnitude > 0.01f) PushPlayer(push);
            return hit;
        }

        /// <summary>玩家在地上（跳起来能躲的招用）</summary>
        protected bool PlayerGrounded => !motor || motor.Grounded;

        /// <summary>玩家冲刺无敌中</summary>
        protected bool PlayerInvulnerable => vitals && vitals.Invulnerable;

        /// <summary>这只怪偏离玩家视线的水平角（度；0 = 正看着它）</summary>
        protected float AngleFromPlayerView()
        {
            var cam = motor ? motor.eye : null;
            if (!cam || !player) return 0;
            var f = cam.forward;
            f.y = 0;
            var d = transform.position - player.position;
            d.y = 0;
            if (f.sqrMagnitude < 1e-4f || d.sqrMagnitude < 1e-4f) return 0;
            return Vector3.Angle(f, d);
        }
    }
}
