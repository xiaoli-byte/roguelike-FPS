using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 马面狱卒（Three.js 版 src/enemies/types/Mamian.ts）：第三章远程钩拉怪。左小臂套着沉重的黑铁腕铐，铐上的锁芯是弱点；
    /// 勾魂索是从腕铐里放出来的程序化铁链（LineRenderer + 钩头），手从不握链。平时在 10–20 m 外踱步，看不见就找视线。
    ///   勾魂索（有视线、5–21 m、冷却 7.5–8.5 s、拿到重击名额）：左臂高举甩圈 0.9 s（链节从腕铐往外逐节烧红、锁芯越来越亮）→
    ///         掷出钩子（20 m/s、射程 22 m、看得见的钩头飞行）。横移躲钩、断开视线或冲刺都能躲；落空就收链（reel：烘焙的 throw 接的是 drag，没钩中要自己切）。
    ///   拖拽（Tether）：钩中 ×1 伤害，往它身前拖 1.2 s（最远 8 m，停在身前 2.4 m）——用玩家运动器的软突进（<see cref="Spiritfire.Art.PlayerMotor.Lunge"/>：
    ///         仍可侧移、起跳），整条链发红。拖拽中射中链子中段（腕铐和玩家脚边各留一段不算）把链打断：马面踉跄 0.8 s、链要等下一轮冷却；
    ///         跳起或冲刺也能挣脱。路线上有熔岩就停在岸边 1.2 m（不把人拖进熔岩，身前就是熔岩时只扯一下）；链被墙挡住、玩家被传送走也脱钩。
    ///   锁链横扫：玩家在 4 m 内（包括刚被拖过来）：0.5 s 预警圈 → 链贴地抡一圈 ×1.6，把人甩开；起跳或退出 4.4 m 能躲。
    ///   缴械：锁芯累计吃到最大生命 30%：锁芯炸开、铁链掉在地上，改用双拳（移速 ×1.2、2.1 m 重拳 ×1.5，0.5–0.9 s 一拳）；弱点换成马头。
    /// 状态：move → spin → throw →（钩中）drag →（4 m 内）sweepWind → sweep → recover → move；（落空）reel → recover；
    ///       move →（4 m 内）sweepWind → sweep → recover；（锁芯碎）→ staggered → brawl → punchWind → punch → brawl。
    /// </summary>
    public sealed class MamianAI : InfernoEnemyAI
    {
        /// <summary>保持距离</summary>
        public const float RangeMin = 10, RangeMax = 20;
        /// <summary>勾魂索：甩圈前摇、冷却、钩速、射程、判定半径、出手距离带</summary>
        public const float SpinTime = 0.9f, HookCdMin = 7.5f, HookCdMax = 8.5f, HookSpeed = 20, HookRange = 22, HookRadius = 0.35f, ThrowMin = 5, ThrowMax = 21;
        /// <summary>拖拽：时长、最远距离、速度、停在身前多远、熔岩岸边留多远、收链、收势、踉跄</summary>
        public const float DragTime = 1.2f, DragDist = 8, DragSpeed = 7.4f, DragStop = 2.4f, LavaMargin = 1.2f, ReelTime = 0.45f, RecoverTime = 0.55f, StaggerTime = 0.8f;
        /// <summary>锁链横扫：触发距离、半径、预警、出手、倍率、冷却</summary>
        public const float SweepTrigger = 4, SweepRadius = 4.4f, SweepWind = 0.5f, SweepTime = 0.35f, SweepMult = 1.6f;
        /// <summary>缴械：锁芯累计伤害比例；之后的重拳</summary>
        public const float LockBreak = 0.3f, BrawlSpeed = 1.4f, PunchRange = 2.1f, PunchWind = 0.32f, PunchRecover = 0.38f, PunchMult = 1.5f;
        /// <summary>链子被射中的判定半径；链根（腕铐）和玩家脚边各留多少不算</summary>
        public const float ChainHitR = 0.24f, ChainSkipRoot = 1.0f, ChainSkipTip = 0.6f;

        /// <summary>美术网格实测：左腕锁芯、链根、马头（缴械后的弱点）</summary>
        static readonly Vector3 LockPoint = new(0.515f, 1.165f, 0.03f), ChainRootPoint = new(0.52f, 1.06f, 0.05f), HeadPoint = new(0, 1.82f, 0.06f);

        /// <summary>钩头位置</summary>
        public Vector3 HookPos { get; private set; }
        /// <summary>拖拽为什么结束（测试 / 冒烟）：done / cut / escape / lava / blocked / teleport / cancel</summary>
        public string DragEnd { get; private set; } = "";
        /// <summary>拖拽规划的长度</summary>
        public float DragLen { get; private set; }
        public bool ChainCut { get; private set; }
        /// <summary>锁芯累计伤害、已缴械</summary>
        public float LockDamage { get; private set; }
        public bool Disarmed { get; private set; }

        Vector3 hookVel, dragStart, dragDir, lastPlayer;
        float hookOut, spinPhase, spinTime = SpinTime, sweepCd, sweepYaw, chainHeat, strafe = 1, strafeTimer;
        bool pendingDisarm, sweepHit, punchHit;
        Transform chainRoot;
        LineRenderer chain;
        Renderer hook;
        TelegraphHandle sweepWarn;
        WeaponController weapons;
        readonly SightSeeker seeker = new();
        readonly Vector3[] pts = new Vector3[9];

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.15f, 0.05f, 4f, 0.85f, false);
            // 弱点 = 左腕铁铐上的锁芯（甩链时最亮）
            InfernoKit.PlaceWeak(body, "forearm_L", LockPoint, 0.1f);
            chainRoot = InfernoKit.Anchor(transform, "forearm_L", ChainRootPoint, "ChainRoot");
            BuildChain();
            hp.Damaged += OnMamianHurt;
            hp.Died += OnMamianDied;
        }

        protected override void Start()
        {
            base.Start();
            cooldown = Rand(2.0f, 3.5f);
            weapons = vitals ? vitals.GetComponentInChildren<WeaponController>() : null;
        }

        void OnEnable() => GameEvents.WeaponFired += OnWeaponFired;
        void OnDisable() => GameEvents.WeaponFired -= OnWeaponFired;

        protected override string InitialState => "move";

        void BuildChain()
        {
            var go = new GameObject("Chain");
            go.transform.SetParent(transform, false);
            chain = go.AddComponent<LineRenderer>();
            chain.useWorldSpace = true;
            chain.sharedMaterial = FxMaterials.Line;
            chain.positionCount = pts.Length;
            chain.widthMultiplier = 0.06f * Size;
            chain.numCapVertices = 2;
            chain.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            chain.enabled = false;
            hook = InfernoKit.Primitive(PrimitiveType.Cube, "Hook", transform, Vector3.zero, new Vector3(0.12f, 0.22f, 0.08f), InfernoKit.ChainIron);
            hook.transform.SetParent(go.transform, true);
            hook.enabled = false;
        }

        Vector3 Root => chainRoot ? chainRoot.position : Local(ChainRootPoint.x, ChainRootPoint.y, ChainRootPoint.z);

        /// <summary>精英体型更大，触发距离也略大</summary>
        float Reach => elite ? 1.15f : 1f;
        /// <summary>按体型换算的停步距离 / 横扫半径（TS × sizeScale / 1.2）</summary>
        float SizeK => Size / 1.2f;

        void OnMamianHurt(DamageInfo info, DamageResult r)
        {
            if (Disarmed || r.total <= 0 || !info.weakpoint) return;
            LockDamage += r.total;
            if (LockDamage >= LockBreak * hp.maxHealth) pendingDisarm = true;
        }

        protected override void Think(float dt)
        {
            if (sweepCd > 0) sweepCd -= dt;
            if (pendingDisarm && !Disarmed)
            {
                Disarm();
                return;
            }
            float d = DistToPlayer;
            switch (state)
            {
                case "chase":
                case "move":
                    Move(dt, d);
                    break;
                case "spin":
                {
                    Stop();
                    FacePlayer(4 * Mathf.Rad2Deg, dt);
                    float t = Mathf.Clamp01(stateTime / spinTime);
                    Glow = 0.35f + 0.65f * t;
                    spinPhase += dt * (9 + 12 * t);
                    if (stateTime >= spinTime) ThrowHook();
                    break;
                }
                case "throw":
                    Stop();
                    FacePlayer(1.5f * Mathf.Rad2Deg, dt);
                    FlyHook(dt);
                    break;
                case "drag":
                    Stop();
                    FacePlayer(6 * Mathf.Rad2Deg, dt);
                    Glow = 1;
                    UpdateDrag();
                    break;
                case "reel":
                {
                    Stop();
                    FacePlayer(3 * Mathf.Rad2Deg, dt);
                    float k = Mathf.Clamp01(dt / Mathf.Max(1e-3f, ReelTime - stateTime + dt));
                    HookPos = Vector3.Lerp(HookPos, Root, k);
                    if (stateTime >= ReelTime)
                    {
                        hookOut = 0;
                        ToRecover();
                    }
                    break;
                }
                case "staggered":
                    Stop();
                    Glow = 0;
                    if (stateTime >= StaggerTime * (Disarmed ? 1.25f : 1))
                    {
                        if (Disarmed) ToBrawl();
                        else ToRecover();
                    }
                    break;
                case "recover":
                    Stop();
                    FacePlayer(3 * Mathf.Rad2Deg, dt);
                    Glow = 0.2f;
                    if (stateTime >= RecoverTime / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)))
                    {
                        ReleaseAttack();
                        Loco();
                        SetState("move");
                    }
                    break;
                case "sweepWind":
                    Stop();
                    FacePlayer(3 * Mathf.Rad2Deg, dt);
                    spinPhase += dt * 14;
                    if (stateTime >= SweepWind)
                    {
                        sweepHit = false;
                        sweepYaw = Facing;
                        Act("sweep", 0.04f);
                        SetState("sweep");
                        Sfx("blade_swing", 1f, 0.55f);
                    }
                    break;
                case "sweep":
                {
                    Stop();
                    // 抡一圈：身体跟着链子转一整圈
                    float u = Mathf.Clamp01(stateTime / SweepTime);
                    Facing = sweepYaw + u * Mathf.PI * 2;
                    if (!sweepHit) SweepStrike();
                    if (u >= 1)
                    {
                        Facing = sweepYaw;
                        sweepCd = Rand(3f, 4f);
                        ToRecover();
                    }
                    break;
                }
                case "brawl":
                    Brawl(dt, d);
                    break;
                case "punchWind":
                {
                    FacePlayer(6 * Mathf.Rad2Deg, dt);
                    // 前冲半步
                    if (stateTime > PunchWind * 0.5f) MoveTo(transform.position + transform.forward * 1.5f, 3f);
                    if (stateTime >= Windup(PunchWind, 0.22f))
                    {
                        Act("punch", 0.04f);
                        SetState("punch");
                        punchHit = Melee(PunchRange * Reach + 0.3f, Damage * PunchMult, 0.4f);
                        if (punchHit)
                        {
                            var f = transform.forward * 4;
                            PushPlayer(new Vector3(f.x, 1.5f, f.z));
                            CameraShake.Add(0.2f, 0.15f);
                        }
                    }
                    break;
                }
                case "punch":
                    Stop();
                    if (stateTime >= PunchRecover / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)))
                    {
                        ReleaseAttack();
                        RollCooldown(0.5f, 0.9f);
                        ToBrawl();
                    }
                    break;
                default:
                    if (Disarmed) ToBrawl();
                    else
                    {
                        Loco();
                        SetState("move");
                    }
                    break;
            }
        }

        void LateUpdate()
        {
            if (!Dead) UpdateChain();
        }

        void ToRecover()
        {
            Act("recover");
            SetState("recover");
        }

        void ToBrawl()
        {
            Act("brawl", 0.15f);
            SetState("brawl");
        }

        void Move(float dt, float d)
        {
            Glow = 0.15f;
            if (Disarmed)
            {
                ToBrawl();
                return;
            }
            if (sweepCd <= 0 && d < SweepTrigger * Reach && VerticalReach(1.5f) && RequestAttack(AttackTokens.Kind.Melee, SweepWind + SweepTime + 0.4f))
            {
                BeginSweep();
                return;
            }
            // 看不见：找一个看得见玩家的站位（地面寻视线）
            var q = new SightQuery(PlayerPos, PlayerEye, transform.position, RangeMin - 3, RangeMax, 1.9f * Size, SightMode.Ground);
            if (seeker.Tick(sees, dt, q))
            {
                if (seeker.HasSpot)
                {
                    MoveTo(seeker.Spot, moveSpeed);
                    if (seeker.Arrived(transform.position)) seeker.Reached();
                }
                else MoveTo(PlayerPos, moveSpeed);
                FaceMovement(5 * Mathf.Rad2Deg, dt);
                return;
            }
            // 带内绕着玩家踱步（2–4 s 换一次方向）
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Rand(2f, 4f);
                strafe = -strafe;
            }
            KeepRange(RangeMin, RangeMax, moveSpeed, strafe * 0.45f);
            if (agent.desiredVelocity.sqrMagnitude > 0.25f && d > RangeMax + 2) FaceMovement(4 * Mathf.Rad2Deg, dt);
            else FaceAimTravel(3 * Mathf.Rad2Deg, dt);
            if (cooldown <= 0 && sees && d >= ThrowMin && d <= ThrowMax && VerticalReach(5))
            {
                if (RequestAttack(AttackTokens.Kind.Heavy, SpinTime + 3.2f)) BeginSpin();
                else cooldown = Rand(0.4f, 0.9f);
            }
        }

        // ───────────── 勾魂索 ─────────────

        void BeginSpin()
        {
            spinTime = Windup(SpinTime, 0.6f);
            spinPhase = 0;
            Stop();
            HookPos = Root;
            ActTimed("spin", spinTime, 0.1f);
            SetState("spin");
            Sfx("telegraph", 0.8f, 0.75f);
            Sfx("enemy_charge", 0.7f, 0.7f);
        }

        /// <summary>甩圈时钩头的位置：腕铐上方一圈（半径 1 m × 体型，越转越快）</summary>
        Vector3 SpinHookPoint()
        {
            var r = Root;
            float k = SizeK * 1.2f;
            return r + new Vector3(Mathf.Cos(spinPhase), 0.35f, Mathf.Sin(spinPhase)) * k;
        }

        /// <summary>掷出：从甩圈的位置朝玩家胸口（带 1/4 提前量、略低 0.15 m）飞出</summary>
        void ThrowHook()
        {
            HookPos = SpinHookPoint();
            var chest = TargetChest;
            float tt = Vector3.Distance(HookPos, chest) / HookSpeed;
            chest += PlayerVelocity * (tt * 0.25f);
            chest.y -= 0.15f;
            var dir = chest - HookPos;
            hookVel = (dir.sqrMagnitude > 1e-6f ? dir.normalized : transform.forward) * HookSpeed;
            hookOut = 0;
            // 掷出就进入冷却（钩中 / 落空都一样，约 8 s 一轮）
            RollCooldown(HookCdMin, HookCdMax);
            Act("throw", 0.05f);
            SetState("throw");
            Sfx("skill_throw", 0.9f, 0.75f);
        }

        /// <summary>钩头飞行：先撞墙就落空；碰到玩家（冲刺中不算）就钩住</summary>
        void FlyHook(float dt)
        {
            float step = HookSpeed * dt;
            var a = HookPos;
            var dir = hookVel.normalized;
            bool wall = Physics.Raycast(a, dir, out var hit, step, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            var b = a + dir * (wall ? hit.distance : step);
            if (!Taunted && vitals && !vitals.Dead && motor && !motor.Dashing && InfernoKit.SegmentHitsCapsule(a, b, PlayerPos, HookRadius * (elite ? 1.15f : 1f)))
            {
                HookPos = b;
                StartDrag();
                return;
            }
            HookPos = b;
            hookOut += step;
            if (wall || hookOut >= HookRange)
            {
                if (wall)
                {
                    Fx.Burst(b, InfernoKit.Spark, 10, 3.5f, 0.3f, 0.05f, 6);
                    GameAudio.PlayAt("hit_armor", b, 0.6f, 0.7f);
                }
                Reel();
            }
        }

        /// <summary>落空 / 松开：收链（throw 片段接的是 drag，没钩中要自己切到 reel）</summary>
        void Reel()
        {
            Act("reel", 0.06f);
            SetState("reel");
            Sfx("blade_recall", 0.6f, 0.7f);
        }

        /// <summary>
        /// 拖拽长度（纯函数，测试用）：朝 jailer 身前 stop 米处，最远 8 m；路线上有熔岩就二分查找到熔岩前，再退 1.2 m（岸边留空）。
        /// lavaBlocked = 被熔岩截短了
        /// </summary>
        public static float DragLength(Vector3 player, Vector3 jailer, float stop, ILavaQuery lava, out Vector3 dir, out bool lavaBlocked)
        {
            var to = jailer - player;
            to.y = 0;
            float dist = to.magnitude;
            dir = dist > 1e-3f ? to / dist : Vector3.forward;
            lavaBlocked = false;
            float len = Mathf.Min(DragDist, Mathf.Max(0, dist - stop));
            if (lava == null || lava is NoLava || len <= 0) return len;
            if (!InfernoKit.CrossesLava(lava, player, player + dir * len, 0.3f)) return len;
            float lo = 0, hi = len;
            for (int i = 0; i < 12; i++)
            {
                float mid = (lo + hi) * 0.5f;
                if (InfernoKit.CrossesLava(lava, player, player + dir * mid, 0.3f)) hi = mid;
                else lo = mid;
            }
            lavaBlocked = true;
            return Mathf.Max(0, lo - LavaMargin);
        }

        /// <summary>钩中：伤害一次，规划拖拽（朝马面身前 2.4 m 处，最远 8 m，熔岩前停下）；能拖的距离太短就只扯一下</summary>
        void StartDrag()
        {
            HitPlayer(Damage, HookPos, Element.None);
            Fx.Burst(HookPos, InfernoKit.Ember, 12, 3, 0.4f, 0.08f, 2);
            GameAudio.PlayAt("hit_armor", HookPos, 0.9f, 0.6f);
            float stop = DragStop * SizeK;
            var ppos = player.position;
            DragLen = DragLength(ppos, transform.position, stop, InfernoKit.Lava, out dragDir, out bool lavaCut);
            dragStart = ppos;
            DragEnd = "";
            ChainCut = false;
            lastPlayer = ppos;
            Act("drag", 0.05f);
            SetState("drag");
            Sfx("enemy_charge", 0.9f, 0.55f);
            var flat = transform.position - ppos;
            flat.y = 0;
            if (DragLen < 0.6f)
            {
                // 扯不动（身前就是熔岩 / 已经很近）：只扯一下
                EndDrag(lavaCut && flat.magnitude > stop + 0.5f ? "lava" : "done");
                return;
            }
            // 软突进：沿拖拽方向的速度下限 7.4 m/s，仍可侧移 / 起跳；结束时沿方向的速度收回到 1 m/s
            motor.Lunge(dragDir, DragSpeed, DragLen / DragSpeed + 0.15f, 0, 1f);
        }

        /// <summary>拖拽中：拖满距离 / 1.2 s、链被射断、玩家跳起或冲刺、链被墙挡住、前方就是熔岩、玩家被传送走时结束</summary>
        void UpdateDrag()
        {
            if (!vitals || vitals.Dead || !motor)
            {
                EndDrag("done");
                return;
            }
            if (ChainCut)
            {
                EndDrag("cut");
                return;
            }
            if (motor.Dashing || (!motor.Grounded && motor.Velocity.y > 1.5f))
            {
                EndDrag("escape");
                return;
            }
            var ppos = player.position;
            if ((ppos - lastPlayer).magnitude > 3)
            {
                EndDrag("teleport");
                return;
            }
            lastPlayer = ppos;
            HookPos = InfernoKit.PlayerChest(ppos) + Vector3.down * 0.25f;
            if (!Combat.LineClear(Root, HookPos))
            {
                EndDrag("blocked");
                return;
            }
            float moved = Vector3.Dot(ppos - dragStart, dragDir);
            if (moved >= DragLen - 0.08f || stateTime >= DragTime)
            {
                EndDrag("done");
                return;
            }
            if (InfernoKit.CrossesLava(ppos, ppos + dragDir * 0.9f, 0.3f))
            {
                EndDrag("lava");
                return;
            }
            // 软突进被墙挡住提前结束了：再续上（剩下的距离）
            if (!motor.Lunging) motor.Lunge(dragDir, DragSpeed, Mathf.Max(0.05f, (DragLen - moved) / DragSpeed), 0, 1f);
        }

        void EndDrag(string reason)
        {
            DragEnd = reason;
            if (motor && reason != "escape") motor.CancelLunge();
            if (reason == "cut")
            {
                // 链子被打断：断链落地，马面踉跄
                DropChain(Root, HookPos, 2.5f);
                GameAudio.PlayAt("pipa_snap", HookPos, 1f, 0.6f);
                Fx.Burst(HookPos, InfernoKit.Spark, 16, 5, 0.4f, 0.06f, 6);
                hookOut = 0;
                ReleaseAttack();
                RollCooldown(HookCdMin, HookCdMax);
                Act("staggered", 0.05f);
                SetState("staggered");
                return;
            }
            RollCooldown(HookCdMin, HookCdMax);
            ReleaseAttack();
            // 刚被拖过来、就在 4 m 内：马上接锁链横扫
            if (!Disarmed && reason == "done" && DistToPlayer < SweepTrigger * Reach && RequestAttack(AttackTokens.Kind.Melee, SweepWind + SweepTime + 0.4f))
            {
                hookOut = 0;
                BeginSweep();
                return;
            }
            Reel();
        }

        /// <summary>
        /// 一枪打没打中链子中段（纯几何，测试用）：视线 eye + dir × [0, range] 与链段（链根后 skipRoot、钩头前 skipTip）的最近距离 ≤ radius。
        /// 返回命中点沿视线的距离（&lt; 0 = 没打中；链太短、贴脸 0.3 m 内也不算）
        /// </summary>
        public static float ChainShotAlong(Vector3 eye, Vector3 dir, float range, Vector3 root, Vector3 tip, float radius, float skipRoot, float skipTip)
        {
            float len = Vector3.Distance(root, tip);
            if (len <= skipRoot + skipTip + 0.2f) return -1;
            var r0 = Vector3.Lerp(root, tip, skipRoot / len);
            var r1 = Vector3.Lerp(root, tip, 1 - skipTip / len);
            var far = eye + dir.normalized * range;
            float d2 = InfernoKit.SegmentSegmentSq(eye, far, r0, r1, out float s, out _);
            if (d2 > radius * radius) return -1;
            float along = s * range;
            return along < 0.3f ? -1 : along;
        }

        /// <summary>玩家开枪：拖拽中瞄准线打到链子中段就把链子打断（这一枪先打在别的东西上 / 其实打在马面身上的不算）</summary>
        void OnWeaponFired(WeaponInstance w)
        {
            if (Dead || state != "drag" || ChainCut) return;
            var aim = weapons ? weapons.Aim : motor ? motor.eye : null;
            if (!aim) return;
            var eye = aim.position;
            var dir = aim.forward;
            float along = ChainShotAlong(eye, dir, 80, Root, HookPos, ChainHitR * SizeK, ChainSkipRoot, ChainSkipTip);
            if (along < 0) return;
            // 视线上更近处有墙 / 别的东西，或者链子几乎顺着视线、这一枪其实打在马面身上（链上那一点没比马面近 1.5 m 以上）
            if (Physics.Raycast(eye, dir, out var hit, along + 1.5f, Layers.ShotMask, QueryTriggerInteraction.Ignore))
            {
                if (hit.distance < along - 0.15f) return;
                var hb = hit.collider.GetComponent<Hitbox>();
                var owner = hb ? hb.owner : hit.collider.GetComponentInParent<Damageable>();
                if (owner == hp) return;
            }
            ChainCut = true;
        }

        // ───────────── 锁链横扫 ─────────────

        void BeginSweep()
        {
            Stop();
            sweepHit = false;
            HookPos = Root;
            float r = SweepRadius * SizeK;
            sweepWarn.FadeOut();
            sweepWarn = Telegraph.Circle(transform.position, r, SweepWind, InfernoKit.AimGold);
            ActTimed("sweepWind", SweepWind, 0.06f);
            SetState("sweepWind");
            Sfx("telegraph", 0.8f, 0.9f);
        }

        /// <summary>横扫判定（出手第一帧）：4.4 m 内、没跳起来（脚离地 &lt; 0.9 m）的玩家被抡中、甩开</summary>
        void SweepStrike()
        {
            sweepHit = true;
            sweepWarn = default;
            float r = SweepRadius * SizeK;
            Fx.Ring(transform.position + Vector3.up * 0.1f, r, InfernoKit.Ember, 0.35f);
            if (!vitals || vitals.Dead) return;
            var to = PlayerPos - transform.position;
            float feet = to.y;
            to.y = 0;
            float d = to.magnitude;
            if (d > r + InfernoKit.PlayerRadius * 0.5f || feet > 0.9f || feet < -1.2f) return;
            if (!HitPlayer(Damage * SweepMult, transform.position, Element.None)) return;
            var away = d > 1e-3f ? to / d : transform.forward;
            PushPlayer(new Vector3(away.x * 7, 2.5f, away.z * 7));
            CameraShake.Add(0.3f, 0.2f);
        }

        // ───────────── 缴械后的肉搏 ─────────────

        void Brawl(float dt, float d)
        {
            Glow = 0.1f;
            if (d <= PunchRange * Reach && VerticalReach(1.4f))
            {
                Stop();
                FacePlayer(8 * Mathf.Rad2Deg, dt);
                if (cooldown <= 0 && FacingDot > 0.7f)
                {
                    if (RequestAttack(AttackTokens.Kind.Melee, PunchWind + PunchRecover + 0.2f))
                    {
                        punchHit = false;
                        ActTimed("punchWind", Windup(PunchWind, 0.22f), 0.05f);
                        SetState("punchWind");
                        Sfx("enemy_charge", 0.6f, 1.3f);
                    }
                    else cooldown = 0.3f;
                }
            }
            else
            {
                ActLoop("brawl", 0.15f);
                var to = PlayerPos - transform.position;
                to.y = 0;
                MoveTo(PlayerPos - (to.sqrMagnitude > 0.01f ? to.normalized : Vector3.zero) * PunchRange * 0.85f * Reach, moveSpeed * BrawlSpeed);
                FaceMovement(8 * Mathf.Rad2Deg, dt);
            }
        }

        /// <summary>缴械：锁芯炸开，铁链掉在地上；之后改用双拳，弱点换成马头</summary>
        void Disarm()
        {
            pendingDisarm = false;
            Disarmed = true;
            sweepWarn.FadeOut();
            sweepWarn = default;
            if (motor && state == "drag") motor.CancelLunge();
            ReleaseAttack();
            var p = body.WeakPoint ? body.WeakPoint.position : Root;
            Fx.Burst(p, InfernoKit.Hot, 24, 5, 0.5f, 0.1f, 2);
            Fx.Burst(p, InfernoKit.White, 10, 3, 0.3f, 0.14f, 0);
            CameraShake.Add(0.2f, 0.2f);
            GameAudio.PlayAt("shield_break", p, 1f, 0.8f);
            GameAudio.PlayAt("pipa_snap", p, 0.9f, 0.5f);
            // 铁链从腕铐上掉下来
            var f = InfernoKit.YawDir(Facing + 1.2f);
            DropChain(Root, new Vector3(Root.x + f.x * 1.5f, transform.position.y, Root.z + f.z * 1.5f), 4f);
            hookOut = 0;
            InfernoKit.PlaceWeak(body, "head", HeadPoint, 0.17f);
            moveSpeed *= 1.2f;
            cooldown = 0.6f;
            Act("staggered", 0.05f);
            SetState("staggered");
        }

        protected override void CancelAttack()
        {
            sweepWarn.FadeOut();
            sweepWarn = default;
            if (state == "drag")
            {
                DragEnd = "cancel";
                if (motor) motor.CancelLunge();
            }
            if (!Dead && state is "spin" or "throw" or "drag" or "reel" or "sweepWind" or "sweep" or "punchWind" or "punch")
            {
                hookOut = 0;
                SetState(Disarmed ? "brawl" : "move");
                RollCooldown(1.5f, 2.5f);
            }
        }

        void OnMamianDied(DamageInfo info)
        {
            sweepWarn.FadeOut();
            if (chain && chain.enabled) DropChain(Root, HookPos, 2.5f);
            if (chain) chain.enabled = false;
            if (hook) hook.enabled = false;
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            var c = transform.position + Vector3.up * 1.3f * Size;
            Fx.Burst(c, InfernoKit.Ember, 16, 3.5f, 0.7f, 0.1f, -1);
            Fx.Burst(c, InfernoKit.Smoke, 8, 1.2f, 1.0f, 0.35f, -0.6f);
        }

        // ───────────── 铁链外观 ─────────────

        /// <summary>链根 → 钩头的折线（中段下垂 sag 米 × 体型，短链垂得少）</summary>
        void ChainPoints(Vector3 root, Vector3 tip, float sag)
        {
            float s = sag * Size * Mathf.Min(1, Vector3.Distance(root, tip) / 4);
            for (int i = 0; i < pts.Length; i++)
            {
                float u = i / (float)(pts.Length - 1);
                var p = Vector3.Lerp(root, tip, u);
                p.y -= s * Mathf.Sin(Mathf.PI * u);
                pts[i] = p;
            }
        }

        void UpdateChain()
        {
            if (!chain) return;
            bool show = !Disarmed && state is "spin" or "throw" or "drag" or "reel" or "sweepWind" or "sweep";
            chain.enabled = show;
            if (hook) hook.enabled = show;
            if (!show) return;
            var root = Root;
            float heat;
            if (state is "spin" or "sweepWind")
            {
                float t = state == "spin" ? Mathf.Clamp01(stateTime / spinTime) : Mathf.Clamp01(stateTime / SweepWind);
                if (state == "spin") HookPos = SpinHookPoint();
                else HookPos = new Vector3(root.x + Mathf.Cos(spinPhase) * 1.1f * Size, transform.position.y + 0.6f * Size, root.z + Mathf.Sin(spinPhase) * 1.1f * Size);
                ChainPoints(root, HookPos, -0.12f);
                heat = t;
            }
            else if (state == "sweep")
            {
                float r = SweepRadius * SizeK;
                var a = InfernoKit.YawDir(Facing + Mathf.PI / 2);
                HookPos = transform.position + a * r + Vector3.up * 0.55f * Size;
                ChainPoints(root, HookPos, 0);
                heat = 1;
            }
            else
            {
                float taut = state == "drag" ? 1 : state == "throw" ? 0.6f : 0.2f;
                ChainPoints(root, HookPos, 0.35f * (1 - taut));
                heat = state == "drag" ? 0.75f + 0.25f * Mathf.Sin(age * 30) : 0.35f;
            }
            chainHeat = heat;
            chain.positionCount = pts.Length;
            chain.SetPositions(pts);
            var hot = Color.Lerp(InfernoKit.ChainIron, InfernoKit.ChainHot, Mathf.Clamp01(heat));
            chain.startColor = Color.Lerp(InfernoKit.ChainIron, InfernoKit.ChainHot, Mathf.Clamp01(heat * 1.3f));
            chain.endColor = hot;
            if (hook)
            {
                hook.transform.position = HookPos;
                var dir = HookPos - pts[pts.Length - 2];
                if (dir.sqrMagnitude > 1e-6f) hook.transform.rotation = Quaternion.LookRotation(dir) * Quaternion.Euler(90, 0, 0);
                FxMaterials.Tint(hook, Color.Lerp(InfernoKit.ChainIron, InfernoKit.ChainHot, state == "drag" ? 1 : chainHeat * 0.6f));
            }
        }

        /// <summary>断链 / 缴械掉下来的铁链：贴着地面躺 life 秒后淡掉</summary>
        static void DropChain(Vector3 root, Vector3 tip, float life)
        {
            var go = new GameObject("Dropped Chain");
            var lr = go.AddComponent<LineRenderer>();
            lr.useWorldSpace = true;
            lr.sharedMaterial = FxMaterials.Line;
            lr.widthMultiplier = 0.07f;
            lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            const int n = 7;
            lr.positionCount = n;
            for (int i = 0; i < n; i++)
            {
                var p = Vector3.Lerp(root, tip, i / (float)(n - 1)) + new Vector3(Random.value - 0.5f, 0, Random.value - 0.5f) * 0.25f;
                float g = InfernoKit.GroundAt(p, p.y + 0.5f, 6f);
                if (float.IsFinite(g)) p.y = g + 0.04f;
                lr.SetPosition(i, p);
            }
            lr.startColor = lr.endColor = InfernoKit.ChainIron;
            Destroy(go, Mathf.Max(0.5f, life));
        }
    }
}
