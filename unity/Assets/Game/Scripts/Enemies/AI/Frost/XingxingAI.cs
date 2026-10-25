using System;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 雪狌狌（Three.js 版 src/enemies/types/Xingxing.ts）：第二章群怪，贴身缠人，而且能追到高处——高台不是绝对安全区。
    ///   追击：远处四足狂奔（步态由 CreatureLocomotion 按速度出），9 m 内看得见时左右折线包抄（0.5–1 s 换一次方向），冷却中在跳砸距离带上打转。
    ///   跳砸：2.5–6.5 m、直线无遮挡，蹲身举拳 0.45 s（近战名额）→ 真跳跃扑向预判落点（预判 0.3、停在玩家身前 0.5 m，落点亮预警圈），
    ///         落地砸出 2.5 m 冰环（随体型、最多 ×1.25）：伤害 ×1.0 + 寒意（移速 −35%，1.5 s）；蹲着喘 0.6 s（输出窗口）。
    ///   抓挠：贴身 2.0 m 内一爪横扫（0.3 s 前摇，×0.6，带刀光弧）。
    ///   攀爬：玩家站在高出 0.7–3.5 m 的台面上时，沿自己 → 玩家的方向找台沿（第一处高出脚下 0.6 m 的地面、和玩家同层、台沿后面站得下）；
    ///         找到就在台下落脚点和台面之间登记一条运行时 NavMeshLink（<see cref="PackCoordinator.ShareClimbLink"/>，同一处台沿全群共用），
    ///         走到台下（或寻路走上这条连线）→ 蹲身 0.3 s（climbPrep）→ 低重力（10）竖直起跳、扒着台沿一把一把翻上去（climb 片段原地，根节点由这里抬），
    ///         翻过台沿后走到台面内侧算爬完；落回台下或 1.8 s 超时放弃。关卡里手摆的上行 NavMeshLink 同样这样爬，下行的就跳下去（hop）。
    ///   抛冰块：够不着（高台超过 3.5 m、没处可爬，或自己在高处玩家在下面 4 m 外）时从地上掰一块冰（0.5 s：前 40% 蹲下掰冰），
    ///         抛物线（重力 22、飞行 0.55 + 0.035 × 距离 s）砸向玩家脚下（预判 0.3），落点亮 1.4 m 预警圈，碎裂 1.4 m 伤害 ×0.75（边缘剩 60%）。
    ///   起哄：一只被打死时，12 m 内的同伴捶胸嚎叫 1 s（群体硬直窗口；<see cref="PackCoordinator.Rally{T}"/>）。
    /// 弱点：罩住整张脸的球（模型空间离地 1.03、略靠前），挂在 head 骨上。冰块是程序化小件，挂在 hand_R 骨上。
    /// 状态：chase → slamWindup → slamAir → recover；chase → swipeWindup → swipe → recover；chase → throwWindup → throwRelease → recover；
    ///       chase → climbPrep → climb → chase；（地面状态）→ rally → chase
    /// </summary>
    public sealed class XingxingAI : EnemyAI, IClimber
    {
        public const float Gravity = 26;
        public const float SlamMin = 2.5f, SlamMax = 6.5f, SlamWindup = 0.45f, SlamWindupMin = 0.3f, SlamRadius = 2.5f, SlamMult = 1f;
        public const float SlamLead = 0.3f, SlamShort = 0.5f, SlamRecover = 0.6f, SlamMaxRise = 1.6f, ChillTime = 1.5f, ChillSlow = 0.35f;
        public const float SwipeRange = 1.7f, SwipeWindup = 0.3f, SwipeWindupMin = 0.22f, SwipeMult = 0.6f;
        public const float ThrowWindup = 0.5f, ThrowWindupMin = 0.38f, RipFrac = 0.4f, ThrowMax = 18;
        public const float ChunkSize = 0.2f, ChunkRadius = 1.4f, ChunkMult = 0.75f, ChunkGravity = 22f, ChunkEdge = 0.6f;
        public const float ClimbMin = 0.7f, ClimbMax = 3.5f, ClimbSearch = 4.5f, ClimbPrep = 0.3f, ClimbGravity = 10f, ClimbTimeout = 1.8f;
        public const float RallyRadius = 12, RallyTime = 1f, Reach = 1.2f, LinkTtl = 6f;
        static readonly Vector3 FaceCenter = new(0, 1.03f, 0.1f);

        float windTime = SlamWindup, recoverTime = 0.5f, slamTime = 0.6f, climbTimer, zigzag, strafeSign = 1;
        bool airborne, climbOk, ripped, onLink;
        Vector3 climbBase, climbTop, hopTarget;
        TelegraphHandle slamWarn;
        Transform hand, chunk;

        /// <summary>最近一次跳砸的计划（测试 / 冒烟用）</summary>
        public SlamPlan LastSlam { get; private set; }
        /// <summary>正在 / 刚刚走的攀爬：台下落脚点、台面点</summary>
        public Vector3 ClimbBase => climbBase;
        public Vector3 ClimbTop => climbTop;
        /// <summary>这次攀爬是从 NavMeshLink 上开始的</summary>
        public bool ClimbFromLink => onLink;

        protected override string InitialState => "chase";

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.18f, 0.06f, 3.1f, 0.7f);
            cooldown = Random.Range(0.5f, 1.6f);
            strafeSign = Random.value < 0.5f ? -1 : 1;
            agent.autoTraverseOffMeshLink = false;
            hp.Died += OnXingxingDied;
            var head = FrostKit.FindBone(transform, "head");
            if (head) body.SetWeakPoint(head, FrostKit.ModelPointOnBone(transform, head, FaceCenter), Registry<EnemyDef>.Get("xingxing")?.weakRadius ?? 0.2f);
            hand = FrostKit.FindBone(transform, "hand_R");
            if (hand)
            {
                // 手里的冰块：掌心前方，掰冰之后才出现
                chunk = new GameObject("Ice Chunk").transform;
                chunk.SetParent(hand, false);
                var fingers = FrostKit.FindBone(transform, "fingers_R");
                chunk.position = fingers ? Vector3.Lerp(hand.position, fingers.position, 0.8f) : hand.position;
                chunk.localScale = Vector3.one * (transform.lossyScale.x / Mathf.Max(1e-4f, hand.lossyScale.x));
                FrostKit.GlowPrimitive(PrimitiveType.Cube, chunk, Vector3.zero, Quaternion.Euler(20, 35, 10), Vector3.one * ChunkSize * 1.4f, FrostKit.Ice, "Chunk");
                chunk.gameObject.SetActive(false);
            }
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            switch (state)
            {
                case "chase":
                    if (HandleLink()) break;
                    Chase(dt, d);
                    break;
                case "slamWindup":
                {
                    // 蹲身、双拳举过头顶，脊背冰晶亮起
                    Stop();
                    FacePlayer(9 * Mathf.Rad2Deg, dt);
                    float t = Mathf.Clamp01(stateTime / windTime);
                    Glow = 0.4f + 0.6f * t;
                    SetGlow(1, t);
                    if (stateTime >= windTime) LaunchSlam();
                    break;
                }
                case "slamAir":
                {
                    SetGlow(1, 1);
                    if (!ManualGrounded) airborne = true;
                    bool landed = airborne && ManualGrounded && stateTime > 0.12f;
                    if (landed || stateTime >= slamTime + 0.5f) SlamImpact();
                    break;
                }
                case "swipeWindup":
                    FacePlayer(10 * Mathf.Rad2Deg, dt);
                    Glow = 0.8f;
                    if (d > 1.1f) MoveTo(PlayerPos, moveSpeed * 0.4f);
                    else Stop();
                    if (stateTime >= windTime)
                    {
                        Stop();
                        Melee(SwipeRange, Damage * SwipeMult, 0.15f);
                        Fx.Slash(transform.position + Vector3.up * 0.75f * Size, transform.eulerAngles.y, 1.1f * Size, 1.9f, 1, 0.35f, 0.32f * Size, 0.22f, Hex.Rgb(0xbfeaff), true);
                        Act("swipe", 0, 0.04f);
                        SetState("swipe");
                    }
                    break;
                case "swipe":
                    FrostKit.NavStep(agent, transform.forward * (1.5f * dt), out _);
                    if (stateTime >= 0.18f) BeginRecover(0.4f);
                    break;
                case "throwWindup":
                {
                    Stop();
                    FacePlayer(8 * Mathf.Rad2Deg, dt);
                    float t = Mathf.Clamp01(stateTime / windTime);
                    Glow = 0.3f + 0.5f * t;
                    // 掰下冰块的一瞬间：脚下扬起一团雪和冰屑
                    if (!ripped && t >= RipFrac)
                    {
                        ripped = true;
                        var at = transform.position + transform.forward * 0.4f * Size + Vector3.up * 0.1f;
                        FrostKit.SnowPuff(at, Size, 8);
                        FrostKit.Shatter(at + Vector3.up * 0.2f, 0.5f, 8, 3f);
                        GameAudio.PlayAt("land", at, 0.45f, 1.8f);
                        if (chunk) chunk.gameObject.SetActive(true);
                    }
                    if (stateTime >= windTime)
                    {
                        ThrowChunk();
                        Act("throwRelease", 0, 0.04f);
                        SetState("throwRelease");
                    }
                    break;
                }
                case "throwRelease":
                    Stop();
                    if (stateTime >= 0.22f) BeginRecover(0.3f);
                    break;
                case "climbPrep":
                    // 台沿下蹲身，抬头看着台沿
                    Stop();
                    FaceTowards(climbTop, 10 * Mathf.Rad2Deg, dt);
                    if (stateTime >= ClimbPrep) LaunchClimb();
                    break;
                case "climb":
                    ClimbStep(dt);
                    break;
                case "hop":
                    if ((ManualGrounded && stateTime > 0.1f) || stateTime > 1.5f) FinishTraverse();
                    break;
                case "rally":
                    // 捶胸嚎叫：原地不动（群体硬直窗口）
                    Stop();
                    Glow = 0.6f;
                    if (stateTime >= RallyTime)
                    {
                        PlayLocomotion();
                        SetState("chase");
                    }
                    break;
                case "recover":
                    Stop();
                    Glow = 0.15f;
                    SetGlow(1, 0);
                    FacePlayer(4 * Mathf.Rad2Deg, dt);
                    if (stateTime >= recoverTime / Mathf.Sqrt(auraAttackRate))
                    {
                        ReleaseAttack();
                        PlayLocomotion();
                        SetState("chase");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("chase");
                    break;
            }
        }

        // ───────────── 追击 ─────────────

        /// <summary>追击：先看能不能出手（抓挠 / 跳砸 / 抛冰块 / 攀爬），否则狂奔、近处折线包抄</summary>
        void Chase(float dt, float d)
        {
            Glow = 0.15f + 0.1f * Mathf.Sin(age * 3.1f);
            SetGlow(1, 0);
            float above = PlayerPos.y - transform.position.y;
            bool reach = Mathf.Abs(above) <= Reach;
            bool grounded = agent.isOnNavMesh;
            if (cooldown <= 0 && sees && reach && grounded)
            {
                if (d <= SwipeRange + 0.3f && RequestAttack(AttackTokens.Kind.Melee, 1f))
                {
                    windTime = Windup(SwipeWindup, SwipeWindupMin / SwipeWindup);
                    Stop();
                    Act("swipeWindup", windTime, 0.06f);
                    SetState("swipeWindup");
                    Sfx("enemy_alert", 0.4f, 1.6f);
                    return;
                }
                if (d >= SlamMin && d <= SlamMax && DirectPathClear() && RequestAttack(AttackTokens.Kind.Melee, 2.2f))
                {
                    windTime = Windup(SlamWindup, SlamWindupMin / SlamWindup);
                    Stop();
                    Act("slamWindup", windTime, 0.08f);
                    SetState("slamWindup");
                    Sfx("enemy_charge", 0.55f, 1.2f);
                    return;
                }
            }
            // 玩家在高处：先找能爬的台沿；爬不上去就抛冰块
            if (above > ClimbMin)
            {
                climbTimer -= dt;
                if (climbTimer <= 0)
                {
                    climbTimer = 0.3f;
                    climbOk = above <= ClimbMax && grounded && FindClimb();
                }
                if (climbOk)
                {
                    var toBase = climbBase - transform.position;
                    toBase.y = 0;
                    float dist = toBase.magnitude;
                    if (dist <= 0.9f)
                    {
                        BeginClimbPrep(false);
                        return;
                    }
                    // 台下落脚点贴着墙，可能在导航网格边缘外：近了就直接贴过去，贴到网格边缘也算到了
                    if (dist <= 1.8f)
                    {
                        Stop();
                        bool blocked = FrostKit.NavStep(agent, toBase / dist * (moveSpeed * SpeedMult * dt), out _);
                        if (blocked && dist <= 1.4f)
                        {
                            BeginClimbPrep(false);
                            return;
                        }
                    }
                    else MoveTo(climbBase, moveSpeed);
                    FaceTowards(climbTop, 10 * Mathf.Rad2Deg, dt);
                    return;
                }
                if (cooldown <= 0 && sees && d <= ThrowMax && grounded && RequestAttack(AttackTokens.Kind.Ranged, ThrowWindup + 0.6f))
                {
                    BeginThrow();
                    return;
                }
            }
            else if (!reach && cooldown <= 0 && sees && d <= ThrowMax && d > 4 && grounded && RequestAttack(AttackTokens.Kind.Ranged, ThrowWindup + 0.6f))
            {
                // 玩家在下面够不着（自己在高台上）也抛冰块
                BeginThrow();
                return;
            }
            if (d > 9 || !sees || !reach)
            {
                MoveTo(PlayerPos, moveSpeed);
                FaceMovement(10 * Mathf.Rad2Deg, dt);
                return;
            }
            // 近处：左右折线包抄（冷却中在跳砸距离带上打转）
            zigzag -= dt;
            if (zigzag <= 0)
            {
                zigzag = Random.Range(0.5f, 1f);
                strafeSign = -strafeSign;
            }
            if (cooldown > 0.3f) KeepRange(SlamMin + 0.5f, SlamMax, moveSpeed * 0.85f, strafeSign);
            else
            {
                var to = PlayerPos - transform.position;
                to.y = 0;
                var dir = to.sqrMagnitude > 1e-4f ? to.normalized : transform.forward;
                var side = new Vector3(-dir.z, 0, dir.x) * (strafeSign * (d > 2.5f ? 0.6f : 0.2f));
                MoveTo(transform.position + (dir + side).normalized * 2f, moveSpeed);
            }
            if (d < 4) FacePlayer(10 * Mathf.Rad2Deg, dt);
            else FaceMovement(10 * Mathf.Rad2Deg, dt);
        }

        /// <summary>到玩家的直线没被挡（膝盖和胸口两处）：跳砸要能直接扑过去</summary>
        bool DirectPathClear()
        {
            var a = transform.position;
            var b = PlayerPos;
            foreach (float h in new[] { 0.6f, 1.2f })
                if (Physics.Linecast(a + Vector3.up * h, b + Vector3.up * h, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                    return false;
            return true;
        }

        void BeginRecover(float time)
        {
            recoverTime = time;
            Stop();
            Act("recover", 0, 0.1f);
            SetState("recover");
        }

        // ───────────── 跳砸 ─────────────

        /// <summary>跳砸的计划：方向、落点、飞行时间、起跳速度（纯计算，测试用）</summary>
        public struct SlamPlan
        {
            public Vector3 dir, landing, velocity;
            public float dist, time, speed;
        }

        /// <summary>
        /// 起跳：按落点距离定飞行时间（TS launchSlam）。预判 0.3 × (0.4 + 0.03 × 距离) s 的玩家移动，停在玩家身前 0.5 m，
        /// 距离夹到 1..7.5 m；飞行时间 0.4 + 0.03 × 距离；竖直初速 = 重力 × 飞行时间 / 2
        /// </summary>
        public static SlamPlan PlanSlam(Vector3 from, Vector3 playerPos, Vector3 playerVelocity)
        {
            var dx = playerPos - from;
            dx.y = 0;
            float est = 0.4f + dx.magnitude * 0.03f;
            playerVelocity.y = 0;
            dx += playerVelocity * (est * SlamLead);
            float len = Mathf.Max(0.01f, dx.magnitude);
            var p = new SlamPlan { dir = dx / len };
            p.dist = Mathf.Clamp(len - SlamShort, 1f, SlamMax + 1f);
            p.time = 0.4f + p.dist * 0.03f;
            p.speed = p.dist / p.time;
            p.velocity = p.dir * p.speed + Vector3.up * (Gravity * p.time * 0.5f);
            p.landing = from + p.dir * p.dist + Vector3.up * 0.02f;
            return p;
        }

        /// <summary>冰环半径（随体型，最多 ×1.25）</summary>
        float RingRadius => SlamRadius * Mathf.Min(1.25f, Size / 1.3f);

        void LaunchSlam()
        {
            var motor = !Taunted && player ? player.GetComponent<Spiritfire.Art.PlayerMotor>() : null;
            var plan = PlanSlam(transform.position, PlayerPos, motor ? motor.Velocity : Vector3.zero);
            LastSlam = plan;
            slamTime = plan.time;
            transform.rotation = Quaternion.LookRotation(plan.dir);
            slamWarn = Telegraph.Circle(plan.landing, RingRadius, plan.time, FrostKit.Warn);
            airborne = false;
            BeginManualMotion(plan.velocity, Gravity);
            Act("slamAir", 0, 0.04f);
            SetState("slamAir");
            Sfx("jump", 0.5f, 1.1f);
            FrostKit.SnowPuff(transform.position, Size, 8);
        }

        /// <summary>落地砸出冰环：伤害 + 寒意</summary>
        void SlamImpact()
        {
            EndManualMotion();
            slamWarn = TelegraphHandle.None;
            float r = RingRadius;
            var c = transform.position;
            bool hit = ZonePlayer(c, r, Damage * SlamMult, SlamMaxRise);
            if (hit) PlayerStatus.Chill(ChillSlow, ChillTime);
            FrostKit.IceRing(c, r);
            CameraShake.Add(hit ? 0.3f : 0.15f, 0.2f);
            GameAudio.PlayAt("boss_slam", c, 0.45f, 1.6f);
            BeginRecover(SlamRecover);
        }

        /// <summary>圆形范围（同 TS zonePlayer）：水平 ≤ 半径 + 0.175 m，玩家脚底相对中心 −0.6..maxRise；被嘲讽时打在诱饵上无效</summary>
        bool ZonePlayer(Vector3 center, float radius, float dmg, float maxRise)
        {
            if (!player) return false;
            var to = PlayerPos - center;
            float dy = to.y;
            to.y = 0;
            if (to.magnitude > radius + 0.175f || dy < -0.6f || dy > maxRise) return false;
            return HitTarget(dmg, center);
        }

        // ───────────── 抛冰块 ─────────────

        void BeginThrow()
        {
            windTime = Windup(ThrowWindup, ThrowWindupMin / ThrowWindup);
            ripped = false;
            Stop();
            Act("throwWindup", windTime, 0.08f);
            SetState("throwWindup");
        }

        /// <summary>冰块的飞行时间：0.55 + 0.035 × 水平距离（秒）</summary>
        public static float ChunkFlightTime(float distance) => 0.55f + distance * 0.035f;

        /// <summary>抛冰块：从手里的冰块位置抛向玩家脚下（预判 0.3），落点有预警圈；落地 / 半路砸到玩家 / 撞墙时碎裂</summary>
        void ThrowChunk()
        {
            var from = chunk && chunk.gameObject.activeInHierarchy ? chunk.position : transform.position + Vector3.up * 1.2f * Size + transform.forward * 0.3f * Size;
            if (chunk) chunk.gameObject.SetActive(false);
            var flat = PlayerPos - from;
            flat.y = 0;
            float T = ChunkFlightTime(flat.magnitude);
            var target = PredictPlayer(T * 0.3f);
            float gy = FrostKit.GroundAt(target, PlayerPos.y + 0.5f, 0f, 20f);
            if (float.IsFinite(gy)) target.y = gy;
            var warn = Telegraph.Circle(target, ChunkRadius, T, FrostKit.Warn);
            float landAt = Time.time + T - 0.05f;
            var vel = EnemyProjectile.Ballistic(from, target, T, ChunkGravity);
            EnemyProjectile.Spawn(new EnemyProjectileSpec(from, vel, Damage * ChunkMult, ChunkSize * Size, T + 0.8f)
            {
                gravity = ChunkGravity, explosionRadius = ChunkRadius, explosionFalloff = ChunkEdge, color = FrostKit.Ice, visual = "chunk",
                scale = 1f, source = this, spirit = Taunted,
                onImpact = (p, _) =>
                {
                    if (Time.time < landAt) warn.Cancel();
                    FrostKit.Shatter(p, 1f, 16, 4.5f);
                    Fx.Ring(p + Vector3.up * 0.05f, ChunkRadius, FrostKit.Mist, 0.35f);
                    GameAudio.PlayAt("land", p, 0.7f, 1.6f);
                },
                onBlocked = p =>
                {
                    warn.Cancel();
                    FrostKit.Shatter(p, 1f, 10, 4f);
                },
            });
            GameAudio.PlayAt("skill_throw", from, 0.55f, 0.9f);
            ReleaseAttack();
            RollCooldown(1.8f, 2.8f);
        }

        // ───────────── 攀爬 ─────────────

        /// <summary>
        /// 沿 self → 玩家的方向找一道可以翻上去的台沿（纯计算，测试用；groundAt(x, z, 探测高度) 返回地面高度，没有为 NaN）：
        /// 每 0.2 m 往下探一次（探测高度 = 玩家脚底 + 0.5），第一处比脚下高 0.6 m 以上的地面就是台沿；
        /// 要求高差 ≤ 3.5 m、和玩家同层（±0.6 m）、台沿后 0.6 m 站得下（±0.3 m）。台下落脚点在台沿前 0.5 m，台面点在台沿后 0.6 m
        /// </summary>
        public static bool FindLedge(Vector3 self, Vector3 playerFeet, Func<float, float, float, float> groundAt, out Vector3 basePoint, out Vector3 topPoint)
        {
            basePoint = topPoint = self;
            var d = playerFeet - self;
            d.y = 0;
            float len = d.magnitude;
            if (len < 0.2f || groundAt == null) return false;
            var u = d / len;
            float probe = playerFeet.y + 0.5f, y0 = self.y;
            float end = Mathf.Min(len + 0.3f, ClimbSearch);
            for (float s = 0.3f; s <= end + 1e-4f; s += 0.2f)
            {
                float gy = groundAt(self.x + u.x * s, self.z + u.z * s, probe);
                if (!(gy > y0 + 0.6f)) continue;
                if (gy - y0 > ClimbMax || Mathf.Abs(gy - playerFeet.y) > 0.6f) return false;
                float ts = s + 0.6f;
                float gy2 = groundAt(self.x + u.x * ts, self.z + u.z * ts, probe);
                if (!(Mathf.Abs(gy2 - gy) < 0.3f)) return false;
                float bs = Mathf.Max(0, s - 0.5f);
                basePoint = new Vector3(self.x + u.x * bs, y0, self.z + u.z * bs);
                topPoint = new Vector3(self.x + u.x * ts, gy, self.z + u.z * ts);
                return true;
            }
            return false;
        }

        static float PhysicsGround(float x, float z, float probe) => FrostKit.GroundAt(new Vector3(x, 0, z), probe, 0f, 20f);

        /// <summary>找台沿；台面上要有导航网格（爬上去之后交还导航），找到就登记共用的攀爬连线</summary>
        bool FindClimb()
        {
            if (!FindLedge(transform.position, PlayerPos, PhysicsGround, out var b, out var t)) return false;
            if (!NavMesh.SamplePosition(t, out var top, 1f, NavMesh.AllAreas) || top.position.y < t.y - 0.4f) return false;
            climbBase = b;
            climbTop = top.position;
            if (NavMesh.SamplePosition(b, out var bottom, 1.2f, NavMesh.AllAreas))
                PackCoordinator.ShareClimbLink(bottom.position, top.position, agent.agentTypeID, 0.8f, LinkTtl);
            return true;
        }

        /// <summary>走到了一条 NavMeshLink 上（运行时登记的攀爬连线，或关卡手摆的）：上行就爬，下行就跳下去</summary>
        bool HandleLink()
        {
            if (!agent.enabled || !agent.isOnOffMeshLink) return false;
            var link = agent.currentOffMeshLinkData;
            float rise = link.endPos.y - link.startPos.y;
            if (rise > ClimbMin)
            {
                climbBase = link.startPos;
                climbTop = link.endPos;
                BeginClimbPrep(true);
                return true;
            }
            // 下行 / 平地连线：小跳过去
            hopTarget = link.endPos;
            var flat = hopTarget - transform.position;
            flat.y = 0;
            float t = Mathf.Clamp(flat.magnitude / Mathf.Max(1f, moveSpeed), 0.25f, 0.8f);
            BeginManualMotion(flat / t + Vector3.up * 2f, Gravity);
            PlayLocomotion();
            SetState("hop");
            return true;
        }

        void BeginClimbPrep(bool fromLink)
        {
            onLink = fromLink;
            Stop();
            Act("climbPrep", ClimbPrep, 0.08f);
            SetState("climbPrep");
        }

        /// <summary>起爬：低重力下的竖直起跳（够到台面以上 0.35 m），水平方向先贴墙</summary>
        void LaunchClimb()
        {
            float h = Mathf.Max(0.5f, climbTop.y - transform.position.y);
            BeginManualMotion(Vector3.up * Mathf.Sqrt(2 * ClimbGravity * (h + 0.35f)), ClimbGravity);
            Act("climb", 0, 0.06f);
            SetState("climb");
            Sfx("jump", 0.4f, 1.3f);
            FrostKit.SnowPuff(transform.position, Size, 5);
        }

        /// <summary>扒着台沿往上翻：台沿以下贴墙（0.8 m/s），翻过台沿后 3.5 m/s 走上台面；爬完 / 掉回台下 / 超时</summary>
        void ClimbStep(float dt)
        {
            var p = transform.position;
            bool above = p.y >= climbTop.y + 0.12f;
            var to = climbTop - p;
            to.y = 0;
            float dist = to.magnitude;
            var dir = dist > 1e-3f ? to / dist : transform.forward;
            float sp = above ? 3.5f : 0.8f;
            SetManualVelocity(new Vector3(dir.x * sp, ManualVelocity.y, dir.z * sp));
            FaceTowards(climbTop, 10 * Mathf.Rad2Deg, dt);
            bool onTop = ManualGrounded && p.y > climbTop.y - 0.25f;
            bool done = onTop && stateTime > 0.25f && dist < 0.45f;
            bool fell = ManualGrounded && p.y < climbTop.y - 0.5f && stateTime > 0.5f;
            if (!done && !fell && stateTime <= ClimbTimeout) return;
            if (done) FrostKit.SnowPuff(p, Size, 6);
            FinishTraverse();
        }

        /// <summary>连线 / 攀爬 / 小跳结束：交还导航，回到追击</summary>
        void FinishTraverse()
        {
            if (agent.enabled && agent.isOnOffMeshLink) agent.CompleteOffMeshLink();
            EndManualMotion();
            onLink = false;
            climbOk = false;
            climbTimer = 0.3f;
            PlayLocomotion();
            SetState("chase");
        }

        // ───────────── 起哄 ─────────────

        /// <summary>同伴被打死：捶胸嚎叫 1 s（只在追击 / 收招时、没被眩晕）</summary>
        public void StartRally()
        {
            if (Dead || Stunned || !(state is "chase" or "recover")) return;
            ReleaseAttack();
            Stop();
            Act("rally", RallyTime, 0.1f);
            SetState("rally");
            Sfx("enemy_alert", 0.5f, 0.8f + Random.value * 0.2f);
        }

        void OnXingxingDied(DamageInfo info)
        {
            if (chunk) chunk.gameObject.SetActive(false);
            if (hp.noReward) return;
            PackCoordinator.Rally<XingxingAI>(this, RallyRadius, x => x.StartRally());
        }

        protected override void CancelAttack()
        {
            SetGlow(1, 0);
            slamWarn.Cancel();
            slamWarn = TelegraphHandle.None;
            if (chunk) chunk.gameObject.SetActive(false);
            if (Dead || state is "chase" or IdleState or "climb" or "hop" or "spawn") return;
            PlayLocomotion();
            SetState("chase");
            RollCooldown(0.6f, 1.2f);
        }

        void Act(string s, float seconds = 0, float fade = 0.08f)
        {
            if (!FrostKit.CanPlay(anim, s, enemyId))
            {
                PlayLocomotion();
                return;
            }
            if (FrostKit.InState(anim, s)) return;
            if (seconds > 0.05f) PlayTimed(s, seconds, fade);
            else Play(s, fade);
        }
    }
}
