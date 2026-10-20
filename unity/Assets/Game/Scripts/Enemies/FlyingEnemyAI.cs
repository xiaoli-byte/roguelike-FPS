using Spiritfire.Art;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 飞行敌人基类（docs/unity-parity.md 3.7 / E3；Three.js 版 EnemyBase 的 flying 分支 + 三青鸟 / 毕方 / 神火飞鸦共用的起落）：
    ///   不用导航：生成器照常挂的 NavMeshAgent 在 Awake 里停用（EnemyAI 的 MoveTo / Stop / 离网回收对飞行单位都不生效），位置由这里积分。
    ///   高度：目标高度缺省 = 地形 / 建筑顶面 + <see cref="cruiseHeight"/>（脚下和前方 0.6 s 处取高的，飞到柱子前就抬头）；
    ///         子类每帧可以 <see cref="SetAltitude"/>（离地）/ <see cref="SetTargetY"/>（绝对）改；
    ///         竖直速度 = clamp((目标 − y) × 3, ±移速 × <see cref="climbMult"/>)，按 6/s 追（同 TS）。
    ///   水平：子类在 Think 里给期望速度（<see cref="FlyTo"/> / <see cref="FlyToward"/> / <see cref="KeepRangeAir"/>），每帧清零（不给就悬停），
    ///         按 <see cref="accel"/> 追；击退后 0.25 s 只剩 15% 操控（同 TS controlLoss）。
    ///   避障：沿速度方向 SphereCast（0.6 s 路程 + 身体半径）碰到墙就沿墙面滑开、正对时挑一边绕，并临时爬升 2.5 m（1.2 s，同 TS 撞墙 climb）；
    ///         实际位移用胶囊扫掠 + 贴面滑动（最多 3 次），起点嵌在东西里时先推出来——不穿墙、不钻地。
    ///   起落：<see cref="BeginLanding(in PerchSpot)"/>（先在落点上方 2.5 m 飞过去，到了再往下落；水平 0.4 m、高差 0.12 m 内站定，
    ///         <see cref="landTimeout"/> 秒落不下放弃）→ <see cref="Flight.Landed"/>（钉在落脚点，不吃击退）→
    ///         <see cref="TakeOff"/>（升到落点上方 <see cref="takeoffHeight"/> 或 <see cref="takeoffTime"/> 秒后算飞起）。落脚点经 <see cref="PerchPoint"/> 认领，起飞 / 死亡时放弃。
    ///   出生：<see cref="SpawnInAir"/> 在半空出生（出生显形的 0.7 s 停在出生高度）；地面出生的按 <see cref="spawnLift"/> 抬到半空（TS 三青鸟 / 飞鸦），
    ///         <see cref="SpawnLanded"/> 的站在原地（毕方）。
    ///   击退：伤害事件里的击退直接加到速度上（× (1 − 抗性)，同 TS knockback），站着的不动。
    ///   回收：位置非法 → 静默处决；脚下 80 m 内都没有地面超过 2.5 s，或掉到最后的安全高度以下 12 m → 传回最后一个脚下有地面的空中位置。
    ///   死亡：有布娃娃的交给布娃娃；没有的（占位体）带着当时的速度掉到地上。
    /// 寻视线用 <see cref="SeekSight"/>（<see cref="Sight"/> 的空中模式），落脚点用 <see cref="FindPerch"/>（<see cref="PerchPoint.Find"/>）。
    /// </summary>
    public abstract class FlyingEnemyAI : EnemyAI
    {
        /// <summary>飞行阶段</summary>
        public enum Flight { Airborne, Landing, Landed, TakingOff }

        [Header("飞行")]
        [Tooltip("巡航离地高度（米，地形 / 建筑顶面以上；TS hoverHeight 3.2）")]
        public float cruiseHeight = 3.2f;
        [Tooltip("水平加速度（米/秒²；TS 缺省 28，三青鸟 9、飞鸦 10）")]
        public float accel = 28f;
        [Tooltip("竖直速度上限 = 移速 × 它（TS 1.5）")]
        public float climbMult = 1.5f;
        [Tooltip("地面出生时脚底至少抬到离地多高（米，乘体型；0 = 不抬。TS 三青鸟 2.0、飞鸦 2.5）")]
        public float spawnLift;
        [Tooltip("起飞：升到落点上方多高算飞起（米）")]
        public float takeoffHeight = 3f;
        [Tooltip("起飞最长用时（秒，TS 三青鸟 0.5）")]
        public float takeoffTime = 0.5f;
        [Tooltip("降落超时（秒，TS 7）：飞不到落脚点就放弃，回到空中")]
        public float landTimeout = 7f;

        /// <summary>扫掠留的缝（米）</summary>
        public const float Skin = 0.03f;
        /// <summary>撞墙 / 前方有障碍时临时爬升多少、持续多久（同 TS 三青鸟 climb）</summary>
        public const float AvoidClimb = 2.5f, AvoidClimbTime = 1.2f;
        /// <summary>脚下没有地面多久就传回（秒）</summary>
        public const float LostGrace = 2.5f;
        /// <summary>没有布娃娃时尸体下坠的重力</summary>
        public const float CorpseGravity = 20f;

        /// <summary>世界速度（米/秒）</summary>
        protected Vector3 velocity;
        /// <summary>横移方向（±1）：1.5–3.2 s 换一次，撞墙时提前换（同 TS strafeSign）</summary>
        protected float strafeSign = 1;

        Vector3 desired;
        float frameTargetY = float.NaN, spawnHoldY = float.NaN;
        bool frameAbsolute, hasGround, hasGoodAir, bumped;
        float climbUntil, controlLoss, phaseTime, probeTimer, lostTime, strafeTimer, avoidUntil;
        float groundBelow, groundAhead;
        int avoidSide = 1;
        Flight flight;
        Vector3 spot, lastGoodAir;
        CapsuleCollider capsule;
        readonly SightSeeker seeker = new();
        static readonly Collider[] overlapBuf = new Collider[8];

        public Flight FlightPhase => flight;
        public bool Landed => flight == Flight.Landed;
        public Vector3 Velocity => velocity;
        /// <summary>降落 / 站着的落脚点</summary>
        public Vector3 LandingSpot => spot;
        /// <summary>离脚下地面多高（没有地面时为正无穷）</summary>
        public float AltitudeAboveGround => hasGround ? transform.position.y - groundBelow : float.PositiveInfinity;
        /// <summary>脚下的地面高度（没有地面时 = 当前高度）</summary>
        protected float GroundHeight => hasGround ? groundBelow : transform.position.y;
        /// <summary>高度参考：脚下和前方取高的（飞过柱子 / 台子时提前抬）</summary>
        protected float GroundRef => hasGround ? Mathf.Max(groundBelow, groundAhead) : transform.position.y;
        /// <summary>上一帧的位移撞到了墙（横向法线）</summary>
        protected bool Bumped => bumped;
        /// <summary>寻视线的计时与站位</summary>
        protected SightSeeker Seeker => seeker;
        /// <summary>出生时站在地上（毕方：一出生就去找高处）；默认在空中</summary>
        protected virtual bool SpawnLanded => false;
        protected override bool UsesNavMesh => false;

        protected override void Awake()
        {
            base.Awake();
            // 生成器按地面单位挂了 NavMeshAgent（EnemyAI 要求）：飞行单位不用，停掉免得它把身体拉回网格
            if (agent) agent.enabled = false;
            capsule = GetComponent<CapsuleCollider>();
            hp.Damaged += OnFlyerDamaged;
            hp.Died += OnFlyerDied;
            strafeSign = Random.value < 0.5f ? -1 : 1;
            strafeTimer = Random.Range(1f, 2.6f);
        }

        /// <summary>生成：清速度；站地的贴到脚下地面，其余按 <see cref="spawnLift"/> 抬到半空（头顶被挡就不抬）</summary>
        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            velocity = Vector3.zero;
            seeker.Reset();
            PerchPoint.Release(this);
            spawnHoldY = float.NaN;
            var p = transform.position;
            bool ground = GroundAt(p, p.y, out float gy);
            if (SpawnLanded)
            {
                if (ground) p.y = gy;
                transform.position = p;
                spot = p;
                flight = Flight.Landed;
            }
            else
            {
                float want = (ground ? gy : p.y) + spawnLift * Size;
                if (spawnLift > 0 && p.y < want && !Overlaps(new Vector3(p.x, want, p.z))) p.y = want;
                transform.position = p;
                flight = Flight.Airborne;
            }
            phaseTime = 0;
            probeTimer = 0;
            Probe(0);
            RememberAir();
        }

        /// <summary>空中出生：把刚生成的飞行敌人放到 at（被东西占着就留在原地），速度清零；出生显形期间停在这个高度</summary>
        public void PlaceInAir(Vector3 at)
        {
            if (!IsFinite(at)) return;
            if (!Overlaps(at)) transform.position = at;
            velocity = Vector3.zero;
            flight = Flight.Airborne;
            phaseTime = 0;
            spawnHoldY = transform.position.y;
            PerchPoint.Release(this);
            probeTimer = 0;
            Probe(0);
            RememberAir();
            var loco = GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }

        /// <summary>
        /// 在半空生成一只敌人（走 <see cref="EnemyRoster.Spawn(string, Vector3, Quaternion, float, bool, SpawnOptions)"/>，它会先贴到导航网格上），
        /// 是飞行敌人就放回 at 的高度；地面敌人原样返回。名册里没有返回 null
        /// </summary>
        public static EnemyAI SpawnInAir(string id, Vector3 at, Quaternion rotation, float difficulty, bool elite, SpawnOptions options = null)
        {
            var ai = EnemyRoster.Spawn(id, at, rotation, difficulty, elite, options);
            if (ai is FlyingEnemyAI f) f.PlaceInAir(at);
            return ai;
        }

        protected override void Update()
        {
            // Think 里给的期望速度 / 目标高度只管这一帧
            desired = Vector3.zero;
            frameTargetY = float.NaN;
            frameAbsolute = false;
            base.Update();
            if (Dead || !player) return;
            StepFlight(Time.deltaTime);
        }

        // ───────────── 子类接口 ─────────────

        /// <summary>朝 dir（水平）以 speed 飞（乘光环 / 减速）</summary>
        protected void FlyToward(Vector3 dir, float speed)
        {
            dir.y = 0;
            float len = dir.magnitude;
            desired = len > 1e-4f ? dir / len * (speed * SpeedMult) : Vector3.zero;
        }

        /// <summary>直线飞向目标（只管水平，高度由目标高度追）；水平 arrive 以内返回 true 并悬停</summary>
        protected bool FlyTo(Vector3 target, float speed, float arrive)
        {
            var to = target - transform.position;
            to.y = 0;
            if (to.sqrMagnitude <= arrive * arrive)
            {
                desired = Vector3.zero;
                return true;
            }
            FlyToward(to, speed);
            return false;
        }

        /// <summary>原地悬停（这一帧不给水平速度）</summary>
        protected void Hover() => desired = Vector3.zero;

        /// <summary>这一帧的目标高度 = 地面参考 + h；followPlayer 时不低于玩家脚底 + 0.8h（TS 三青鸟 / 飞鸦随玩家所在高度抬升）</summary>
        protected void SetAltitude(float h, bool followPlayer = false)
        {
            float y = GroundRef + h;
            if (followPlayer) y = Mathf.Max(y, PlayerPos.y + h * 0.8f);
            frameTargetY = y;
            frameAbsolute = false;
        }

        /// <summary>这一帧的目标高度（绝对 y；不叠撞墙爬升）：俯冲、贴地掠过用</summary>
        protected void SetTargetY(float y)
        {
            frameTargetY = y;
            frameAbsolute = true;
        }

        /// <summary>
        /// 远程保持距离（TS keepRange 的飞行分支）：太远直线逼近到 max − 1.5，太近后撤带横移，带内绕玩家横移（× strafeScale）
        /// </summary>
        protected void KeepRangeAir(float min, float max, float speed, float strafeScale = 0.55f)
        {
            var to = PlayerPos - transform.position;
            to.y = 0;
            float d = to.magnitude;
            if (d > max)
            {
                FlyTo(PlayerPos, speed, Mathf.Max(1f, max - 1.5f));
                return;
            }
            float s = strafeSign;
            if (d < min) FlyToward(new Vector3(-to.x - to.z * 0.45f * s, 0, -to.z + to.x * 0.45f * s), speed);
            else FlyToward(new Vector3(-to.z * s, 0, to.x * s), speed * strafeScale);
        }

        /// <summary>
        /// 看不到玩家时换到看得见的悬停点（TS seekSight，飞行单位：站位 = 玩家周围 [minRange, maxRange] 的地面点上方 hoverHeight）。
        /// 返回 true 表示这一帧在寻位（已经给了速度和高度）；找不到站位时朝玩家逼近到 min(minRange, 4)
        /// </summary>
        protected bool SeekSight(float minRange, float maxRange, float speed, float hoverHeight)
        {
            var q = new SightQuery(PlayerPos, PlayerEye, transform.position, minRange, maxRange, hoverHeight, SightMode.Air)
            {
                clearance = CastRadius + 0.2f,
            };
            if (!seeker.Tick(sees, Time.deltaTime, q)) return false;
            if (seeker.HasSpot)
            {
                SetTargetY(seeker.Spot.y);
                if (FlyTo(seeker.Spot, speed, seeker.arrive)) seeker.Reached();
            }
            else FlyTo(PlayerPos, speed, Mathf.Min(minRange, 4f));
            return true;
        }

        /// <summary>落脚点查询的常用参数：围着当前目标（玩家 / 嘲讽诱饵），从自己出发，跳过现在站着的点，认领者是自己</summary>
        protected PerchQuery PerchAroundTarget(float minRange, float maxRange, float minRise, float maxRise) =>
            new(PlayerPos, PlayerEye, transform.position, minRange, maxRange, minRise, maxRise, this)
            {
                current = flight == Flight.Landed ? spot : new Vector3(float.NaN, float.NaN, float.NaN),
                clearance = Mathf.Max(0.3f, CastRadius),
                pathLift = 0.9f * Size,
            };

        /// <summary>找落脚点（<see cref="PerchPoint.Find"/>）</summary>
        protected PerchKind FindPerch(in PerchQuery q, out PerchSpot s) => PerchPoint.Find(q, out s);

        /// <summary>开始降落到 s（认领它）。别人已经认领了 / 位置非法返回 false</summary>
        protected bool BeginLanding(in PerchSpot s)
        {
            if (!IsFinite(s.position) || PerchPoint.IsClaimed(s.position, this)) return false;
            PerchPoint.Claim(this, s);
            spot = s.position;
            flight = Flight.Landing;
            phaseTime = 0;
            return true;
        }

        /// <summary>降落到地面上的某一点</summary>
        protected bool BeginLanding(Vector3 at) => BeginLanding(new PerchSpot { position = at, kind = PerchKind.Ground });

        /// <summary>起飞（站着 / 降落中都可以）：放弃认领，升到落点上方 takeoffHeight</summary>
        protected void TakeOff()
        {
            if (flight == Flight.Airborne) return;
            if (flight != Flight.Landed && flight != Flight.Landing) spot = transform.position;
            flight = Flight.TakingOff;
            phaseTime = 0;
            PerchPoint.Release(this);
            velocity.y = Mathf.Max(velocity.y, 1.5f);
        }

        /// <summary>放弃降落，回到空中</summary>
        protected void CancelLanding()
        {
            if (flight != Flight.Landing) return;
            flight = Flight.Airborne;
            phaseTime = 0;
            PerchPoint.Release(this);
        }

        /// <summary>水平速度方向（低于 0.5 m/s 不转）</summary>
        protected void FaceVelocity(float rateDeg, float dt)
        {
            var v = new Vector3(velocity.x, 0, velocity.z);
            if (v.sqrMagnitude > 0.25f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(v), rateDeg * dt);
        }

        /// <summary>空中击退：加到速度上（× (1 − 抗性)）；冲量平方 &gt; 4 时 0.25 × k 秒内只剩 15% 操控。站着的不动</summary>
        public void AirKnockback(Vector3 impulse)
        {
            if (Dead || flight == Flight.Landed || !IsFinite(impulse)) return;
            float k = 1 - knockbackResist;
            if (k <= 0) return;
            velocity += impulse * k;
            if (impulse.sqrMagnitude > 4f) controlLoss = Mathf.Max(controlLoss, 0.25f * k);
        }

        /// <summary>站定的那一刻（降落完成）</summary>
        protected virtual void OnLanded() { }
        /// <summary>降落超时放弃（已回到空中）</summary>
        protected virtual void OnLandingFailed() { }
        /// <summary>起飞完成（回到 Airborne）</summary>
        protected virtual void OnTookOff() { }

        // ───────────── 飞行积分 ─────────────

        void StepFlight(float dt)
        {
            if (dt <= 0) return;
            var p = transform.position;
            if (!IsFinite(p))
            {
                Debug.LogWarning($"[Enemy] {name} 飞行位置非法：静默处决");
                hp.noReward = true;
                Combat.Execute(hp, true);
                return;
            }
            phaseTime += dt;
            if (controlLoss > 0) controlLoss -= dt;
            strafeTimer -= dt;
            if (strafeTimer <= 0 || (bumped && strafeTimer < 1.3f))
            {
                strafeSign = -strafeSign;
                strafeTimer = Random.Range(1.5f, 3.2f);
            }
            Probe(dt);
            if (state != "spawn") spawnHoldY = float.NaN;

            if (flight == Flight.Landed)
            {
                Hold();
                return;
            }
            float ty;
            if (Stunned)
            {
                // 眩晕：原地悬停（降落 / 起飞暂停）
                desired = Vector3.zero;
                ty = p.y;
            }
            else if (flight == Flight.Landing)
            {
                ty = LandingStep(p);
                if (flight == Flight.Landed)
                {
                    Hold();
                    return;
                }
            }
            else if (flight == Flight.TakingOff)
            {
                ty = spot.y + takeoffHeight;
                if (phaseTime >= takeoffTime || p.y >= ty - 0.3f)
                {
                    flight = Flight.Airborne;
                    phaseTime = 0;
                    OnTookOff();
                }
            }
            else
            {
                ty = float.IsFinite(spawnHoldY) ? spawnHoldY
                    : float.IsFinite(frameTargetY) ? frameTargetY
                    : hasGround ? GroundRef + cruiseHeight : p.y;
                if (!frameAbsolute && Time.time < climbUntil) ty += AvoidClimb;
            }
            Integrate(dt, ty);
            RecoverIfLost(dt);
        }

        /// <summary>降落（TS 三青鸟 toPerch）：远时在落点上方 2.5–6 m 飞过去，1.2 m 内往下落，近了减速；站定 / 超时</summary>
        float LandingStep(Vector3 p)
        {
            var to = spot - p;
            to.y = 0;
            float dxz = to.magnitude;
            float ty = dxz > 1.2f ? Mathf.Max(spot.y + 2.5f, Mathf.Min(p.y, spot.y + 6f)) : spot.y;
            float sp = dxz > 4f ? moveSpeed * SpeedMult : Mathf.Max(1.2f, dxz * 1.5f);
            desired = dxz > 0.15f ? to / dxz * sp : Vector3.zero;
            if (dxz <= 0.4f && Mathf.Abs(p.y - spot.y) < 0.12f)
            {
                flight = Flight.Landed;
                phaseTime = 0;
                velocity = Vector3.zero;
                transform.position = spot;
                OnLanded();
            }
            else if (phaseTime > landTimeout)
            {
                flight = Flight.Airborne;
                phaseTime = 0;
                PerchPoint.Release(this);
                OnLandingFailed();
            }
            return ty;
        }

        /// <summary>钉在落脚点；被外力搬走超过 1.5 m（关卡回收、传送）就落在新位置脚下的地面上</summary>
        void Hold()
        {
            var p = transform.position;
            if ((p - spot).sqrMagnitude > 1.5f * 1.5f)
            {
                spot = hasGround ? new Vector3(p.x, groundBelow, p.z) : p;
                PerchPoint.Release(this);
            }
            transform.position = spot;
            velocity = Vector3.zero;
        }

        void Integrate(float dt, float ty)
        {
            float control = controlLoss > 0 ? 0.15f : 1f;
            var hv = new Vector3(velocity.x, 0, velocity.z);
            var dv = desired - hv;
            float step = accel * control * dt;
            hv = dv.sqrMagnitude <= step * step ? desired : hv + dv.normalized * step;
            hv = Avoid(hv);
            float vmax = Mathf.Max(1f, moveSpeed * climbMult);
            float vy = Mathf.Clamp((ty - transform.position.y) * 3f, -vmax, vmax);
            velocity = new Vector3(hv.x, velocity.y + (vy - velocity.y) * Mathf.Clamp01(6f * dt), hv.z);
            bumped = false;
            transform.position = Sweep(transform.position, velocity * dt);
        }

        /// <summary>
        /// 前方障碍：沿速度方向 SphereCast，挡着的是坡 / 台面就只抬头；是墙就去掉朝墙的分量（越近去得越多），
        /// 切向速度不到一半时朝一侧绕（选期望方向偏向的那侧，1 s 内不换边），同时临时爬升
        /// </summary>
        Vector3 Avoid(Vector3 hv)
        {
            float speed = hv.magnitude;
            if (speed < 0.3f) return hv;
            var dir = hv / speed;
            float r = CastRadius;
            float look = speed * 0.6f + r + 0.5f;
            if (!Physics.SphereCast(BodyCenter(transform.position), r, dir, out var hit, look, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return hv;
            climbUntil = Time.time + AvoidClimbTime;
            var n = hit.normal;
            if (n.y > 0.7f) return hv;
            n.y = 0;
            if (n.sqrMagnitude < 1e-4f) return hv;
            n.Normalize();
            float close = 1f - Mathf.Clamp01(hit.distance / look);
            float into = -Vector3.Dot(hv, n);
            if (into > 0) hv += n * (into * Mathf.Lerp(0.5f, 1f, close));
            var side = Vector3.Cross(Vector3.up, n);
            if (Time.time >= avoidUntil)
            {
                float pref = Vector3.Dot(desired.sqrMagnitude > 1e-4f ? desired : hv, side);
                avoidSide = Mathf.Abs(pref) > 1e-3f ? (pref > 0 ? 1 : -1) : (Random.value < 0.5f ? -1 : 1);
            }
            avoidUntil = Time.time + 1f;
            var tangent = side * avoidSide;
            float t = Vector3.Dot(hv, tangent);
            if (t < speed * 0.5f) hv += tangent * ((speed * 0.5f - t) * Mathf.Lerp(0.4f, 1f, close));
            return Vector3.ClampMagnitude(hv, Mathf.Max(speed, desired.magnitude));
        }

        /// <summary>胶囊扫掠 + 贴面滑动（最多 3 次）：碰到就停在面前 Skin 处，剩下的位移投影到面上继续；速度去掉朝面里的分量</summary>
        Vector3 Sweep(Vector3 pos, Vector3 delta)
        {
            pos = Depenetrate(pos);
            float r = CastRadius;
            for (int i = 0; i < 3; i++)
            {
                float dist = delta.magnitude;
                if (dist < 1e-5f) break;
                var dir = delta / dist;
                CapsuleAt(pos, out var a, out var b);
                if (!Physics.CapsuleCast(a, b, r, dir, out var hit, dist + Skin, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                {
                    pos += delta;
                    break;
                }
                float move = Mathf.Max(0, hit.distance - Skin);
                pos += dir * move;
                var n = hit.normal;
                if (Mathf.Abs(n.y) < 0.5f) bumped = true;
                delta = Vector3.ProjectOnPlane(dir * (dist - move), n);
                float vn = Vector3.Dot(velocity, n);
                if (vn < 0) velocity -= n * vn;
            }
            // 兜底：脚底陷进地面（地形碰撞体不参与推出）就抬回地面上
            float h = Mathf.Max(0.5f, BodyHeight);
            if (Physics.Raycast(pos + Vector3.up * h, Vector3.down, out var g, h + 0.05f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && g.point.y > pos.y)
            {
                pos.y = g.point.y + Skin;
                if (velocity.y < 0) velocity.y = 0;
            }
            return pos;
        }

        /// <summary>起点就嵌在东西里（出生、被推进墙角）：沿穿透方向推出来（地形碰撞体跳过，交给落地兜底）</summary>
        Vector3 Depenetrate(Vector3 pos)
        {
            if (!capsule || !capsule.enabled) return pos;
            CapsuleAt(pos, out var a, out var b);
            int n = Physics.OverlapCapsuleNonAlloc(a, b, CastRadius, overlapBuf, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            var rot = transform.rotation;
            for (int i = 0; i < n; i++)
            {
                var c = overlapBuf[i];
                overlapBuf[i] = null;
                if (!c || c is TerrainCollider) continue;
                if (Physics.ComputePenetration(capsule, pos, rot, c, c.transform.position, c.transform.rotation, out var dir, out float dist) && dist > 0)
                    pos += dir * (dist + Skin);
            }
            return pos;
        }

        /// <summary>扫掠用的半径：角色胶囊半径 × 体型 × 0.85（同 TS moveBody 的 radius × 0.85）</summary>
        protected float CastRadius => capsule ? Mathf.Max(0.08f, capsule.radius * Mathf.Abs(transform.lossyScale.x) * 0.85f) : 0.3f;

        float BodyHeight => capsule ? capsule.height * Mathf.Abs(transform.lossyScale.y) : 1f;

        /// <summary>身体中心（角色胶囊中心）</summary>
        protected Vector3 BodyCenter(Vector3 feet) => feet + Vector3.up * (capsule ? capsule.center.y * Mathf.Abs(transform.lossyScale.y) : 0.5f);

        /// <summary>扫掠胶囊的两个球心：底端贴脚底</summary>
        void CapsuleAt(Vector3 feet, out Vector3 a, out Vector3 b)
        {
            float r = CastRadius, h = Mathf.Max(BodyHeight, r * 2f);
            a = feet + Vector3.up * r;
            b = feet + Vector3.up * (h - r);
        }

        /// <summary>at 处放不下身体（与地形 / 建筑重叠）</summary>
        protected bool Overlaps(Vector3 at)
        {
            CapsuleAt(at, out var a, out var b);
            return Physics.CheckCapsule(a, b, CastRadius, Layers.WorldMask, QueryTriggerInteraction.Ignore);
        }

        /// <summary>每 0.1 s 探一次脚下和前方 0.6 s 处的地面</summary>
        void Probe(float dt)
        {
            probeTimer -= dt;
            if (probeTimer > 0) return;
            probeTimer = 0.1f;
            var p = transform.position;
            hasGround = GroundAt(p, p.y, out groundBelow);
            var ahead = p + new Vector3(velocity.x, 0, velocity.z) * 0.6f;
            groundAhead = GroundAt(ahead, p.y, out float ga) ? ga : groundBelow;
            if (hasGround)
            {
                lostTime = 0;
                if (flight != Flight.Landed && !Overlaps(p)) RememberAir();
            }
        }

        /// <summary>xz 处的地面：从 fromY 上方 1.5 m 往下 80 m 打射线（地形 / 建筑；角色不算）</summary>
        protected static bool GroundAt(Vector3 xz, float fromY, out float y)
        {
            if (Physics.Raycast(new Vector3(xz.x, fromY + 1.5f, xz.z), Vector3.down, out var hit, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                y = hit.point.y;
                return true;
            }
            y = fromY;
            return false;
        }

        void RememberAir()
        {
            lastGoodAir = transform.position;
            hasGoodAir = true;
        }

        /// <summary>脚下一直没有地面、或掉到最后安全高度以下 12 m：传回最后一个有地面的空中位置</summary>
        void RecoverIfLost(float dt)
        {
            var p = transform.position;
            bool fell = hasGoodAir && p.y < lastGoodAir.y - FallDepth;
            if (!hasGround) lostTime += dt;
            if (!fell && lostTime < LostGrace) return;
            lostTime = 0;
            if (!hasGoodAir) return;
            InterruptAttack();
            transform.position = lastGoodAir;
            velocity = Vector3.zero;
            if (flight != Flight.Airborne)
            {
                flight = Flight.Airborne;
                PerchPoint.Release(this);
            }
            probeTimer = 0;
            var loco = GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }

        // ───────────── 受击 / 死亡 ─────────────

        void OnFlyerDamaged(DamageInfo info, DamageResult r)
        {
            if (r.killed || info.knockback <= 0 || info.direction.sqrMagnitude < 1e-4f) return;
            AirKnockback(info.direction.normalized * info.knockback);
        }

        void OnFlyerDied(DamageInfo info)
        {
            PerchPoint.Release(this);
            var ragdoll = GetComponent<CreatureRagdoll>();
            if (ragdoll && ragdoll.Active) return;
            if (flight == Flight.Landed) return;
            var fall = gameObject.AddComponent<FlyerCorpseFall>();
            fall.Begin(velocity + (info.direction.sqrMagnitude > 1e-4f ? info.direction.normalized * 2f : Vector3.zero));
        }

        static bool IsFinite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }

    /// <summary>没有布娃娃的飞行敌人（占位体）死后：带着速度受重力掉到地上（水平速度按 2/s 衰减），落地后停下</summary>
    [AddComponentMenu("")]
    public sealed class FlyerCorpseFall : MonoBehaviour
    {
        Vector3 v;

        public bool Grounded { get; private set; }

        public void Begin(Vector3 velocity)
        {
            v = velocity;
            v.y = Mathf.Max(v.y, 0.5f);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            v.y -= FlyingEnemyAI.CorpseGravity * dt;
            float f = Mathf.Exp(-2f * dt);
            v.x *= f;
            v.z *= f;
            var p = transform.position + v * dt;
            if (Physics.Raycast(new Vector3(p.x, transform.position.y + 0.5f, p.z), Vector3.down, out var hit, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                && p.y <= hit.point.y)
            {
                p.y = hit.point.y;
                Grounded = true;
                enabled = false;
            }
            transform.position = p;
        }
    }
}
