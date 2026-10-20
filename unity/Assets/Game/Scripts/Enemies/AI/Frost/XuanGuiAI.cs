using System.Collections.Generic;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰甲旋龟（Three.js 版 src/enemies/types/XuanGui.ts）：第二章坦克，约 2.6 m 高、5.3 m 长，血厚甲厚、不吃击退。
    ///   冰壳推进：每秒约 1.2 rad 转身慢慢爬近；正面（cos ≥ 0.3）来的伤害 ×0.15——走 E2 命中区的朝向门（<see cref="GuardFor"/>），
    ///     挡下时冰壳上迸冰屑脆响。绕到身后打蛇尾（弱点：蛇头）。
    ///   冰喙猛啄：贴脸 3.4 m 内、正对（cos &gt; 0.7）时缩颈 0.45 s，猛啄 ×1.0 + 击退 8（命中 3.9 m + 玩家半径、cos &gt; 0.5）。
    ///   蛇尾反咬：玩家在身后（cos &lt; −0.35）4.2 m 内时，蛇尾扬起 0.4 s，往后一口 ×0.7 + 击退 6（冷却 1.8–2.6 s）。
    ///   缩壳旋转：8–25 m、看得见、冷却好时（开场 1–1.8 s 就转一次）缩壳 0.8 s（重击名额；脚下一圈 + 朝前 12 m 的预警，前 60% 还在对准），
    ///     然后整只换成旋壳（SM_EnemyPart_XuanGuiShell，挂点 socket_shell；没有挂件时照常播 spin 片段）像锯片一样贴地滑向玩家：
    ///     6 m/s 起每秒 +22 加速到 12.5（精英 ×1.15），弱追踪 0.35 rad/s；撞墙 / 导航网格边缘按法线反弹，最多 2 次（精英 3 次），再撞就停；
    ///     每滑 1.3 m 留一块 3 s 的滑冰带（<see cref="IceFloor"/>，打滑由 L8 冰面接）；撞到玩家 ×1.25 + 击飞 11（同一次旋转 0.8 s 内不重复）；
    ///     旋转中全方位 ×0.4（弱点也是）；最长 3.6 s。
    ///   过热翻倒：旋转结束侧翻在地、壳顶散热孔正对玩家，喷青紫霜气 2.4 s，不格挡、弱点移到散热孔——最好的输出窗口；之后 0.6 s 翻回来。
    ///   近身也转：在 8 m 内被啄满 2 次或贴身累计 4 s、旋转冷却好时，喷鼻息后退 0.9 s（2.6 m/s，退到 6 m 或撞墙就开转），再照常缩壳旋转。
    /// 弱点：平时是身后的蛇头（snake 骨 + 模型空间 (0, 1.52, −1.6)），过热时是壳顶散热孔（body 骨 + (0, 1.63, 0.25)）。
    /// 状态：advance → peckWindup → peck；advance → biteWindup → bite；advance →（backoff →）retract → spin → overheat → rightself → advance
    /// </summary>
    public sealed class XuanGuiAI : EnemyAI
    {
        public const float GuardFactor = 0.15f, GuardCos = 0.3f, SpinArmor = 0.4f, TurnRate = 1.2f;
        public const float PeckRange = 3.4f, PeckReach = 3.9f, PeckWindup = 0.45f, PeckWindupMin = 0.3f, PeckMult = 1f, PeckKnock = 8;
        public const float BiteRange = 4.2f, BiteReach = 4.7f, BiteBehind = -0.35f, BiteWindup = 0.4f, BiteWindupMin = 0.3f, BiteMult = 0.7f;
        public const float SpinMin = 8, SpinMax = 25, SpinWindup = 0.8f, SpinWindupMin = 0.55f;
        public const int ClosePecks = 2, SpinBounces = 2;
        public const float CloseTime = 4, BackoffTime = 0.9f, BackoffSpeed = 2.6f, BackoffRange = 6;
        public const float SpinStart = 6, SpinSpeed = 12.5f, SpinRamp = 22, SpinHoming = 0.35f, SpinMaxTime = 3.6f, SpinMult = 1.25f, SpinKnock = 11, SpinHitGap = 0.8f;
        public const float SpinRate = 14, IceStep = 1.3f, IceRadius = 0.75f, IceTime = 3f, OverheatTime = 2.4f, RightselfTime = 0.6f;
        public const float WeakRadius = 0.32f, StepShakeRange = 20;
        static readonly Vector3 SnakePoint = new(0, 1.52f, -1.6f), VentPoint = new(0, 1.63f, 0.25f);

        float windTime = SpinWindup, spinCd, biteCd = 1, spinYaw, spinDist, iceAt, lastBounce = -1, lastSpinHit = -99, blockFxAt, closeTime, blindTime;
        int bounces, closePecks;
        bool alerted, struck;
        GuardProfile guard = GuardProfile.Open;
        readonly WarnScope warn = new("xuangui.spin");
        TelegraphHandle ring, lane;
        Transform snakeBone, bodyBone, shellSocket;
        Vector3 snakeOffset, ventOffset;
        Renderer[] shellRenderers = System.Array.Empty<Renderer>(), bodyRenderers = System.Array.Empty<Renderer>();
        bool shellOut;
        Quaternion shellRest = Quaternion.identity;

        /// <summary>最近一次啄 / 咬 / 撞是否打中了玩家（测试与调试用）</summary>
        public bool Struck => struck;
        /// <summary>这次旋转撞墙反弹的次数</summary>
        public int Bounces => bounces;
        /// <summary>缩壳旋转中</summary>
        public bool Spinning => state == "spin";
        /// <summary>过热翻倒（散热孔是弱点）</summary>
        public bool Overheated => state == "overheat";
        /// <summary>当前的格挡配置</summary>
        public GuardProfile Guard => guard;
        /// <summary>挂了美术旋壳（缩壳时整只换成它）</summary>
        public bool HasShellPart => shellRenderers.Length > 0;

        protected override string InitialState => "advance";

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.15f, 0.06f, 2.5f, 0.8f);
            spinCd = Random.Range(1f, 1.8f);
            snakeBone = FrostKit.FindBone(transform, "snake");
            bodyBone = FrostKit.FindBone(transform, "body");
            if (snakeBone)
            {
                snakeOffset = FrostKit.ModelPointOnBone(transform, snakeBone, SnakePoint);
                body.SetWeakPoint(snakeBone, snakeOffset, WeakRadius);
            }
            if (bodyBone) ventOffset = FrostKit.ModelPointOnBone(transform, bodyBone, VentPoint);
            // 旋壳挂件（EnemyRoster 在 Awake 之前挂好）：平时藏起来，缩壳时整只换成它
            shellSocket = FrostKit.FindBone(transform, "socket_shell");
            if (shellSocket)
            {
                shellRest = shellSocket.localRotation;
                shellRenderers = shellSocket.GetComponentsInChildren<Renderer>(true);
                var all = new List<Renderer>();
                foreach (var r in GetComponentsInChildren<Renderer>(true))
                    if (!r.transform.IsChildOf(shellSocket))
                        all.Add(r);
                bodyRenderers = all.ToArray();
                foreach (var r in shellRenderers) r.enabled = false;
            }
            var bz = body.Zone("body");
            if (bz) bz.Damaged += OnBodyZoneHit;
            ApplyGuard();
        }

        /// <summary>
        /// 某个状态下的格挡（纯计算，测试用）：推进、各种前摇、后退时冰壳挡正面（×0.15，cos 0.3）；旋转中全方位 ×0.4（弱点也是）；
        /// 过热、翻身、被眩晕时不挡
        /// </summary>
        public static GuardProfile GuardFor(string state, bool stunned)
        {
            if (state == "spin") return new GuardProfile(SpinArmor, ZoneFacing.Any, GuardCos, SpinArmor);
            if (stunned) return GuardProfile.Open;
            return state is "advance" or "peckWindup" or "peck" or "biteWindup" or "bite" or "retract" or "backoff" or IdleState
                ? new GuardProfile(GuardFactor, ZoneFacing.Front, GuardCos)
                : GuardProfile.Open;
        }

        void ApplyGuard()
        {
            var g = Dead ? GuardProfile.Open : GuardFor(state, Stunned);
            if (g.Equals(guard) && state != "spawn") return;
            guard = g;
            FrostKit.ApplyGuard(body, g);
        }

        /// <summary>冰壳挡下一击：壳上迸冰屑、脆响（节流 0.07 s）</summary>
        void OnBodyZoneHit(HitZone z, DamageInfo info, DamageResult r)
        {
            if (guard.facing != ZoneFacing.Front || info.source == DamageSource.Status || !z.FacingPasses(info.direction)) return;
            if (Time.time - blockFxAt < 0.07f) return;
            blockFxAt = Time.time;
            var p = transform.position + transform.forward * 1.3f * Size + Vector3.up * (0.6f + Random.value * 0.9f) * Size + transform.right * (Random.value - 0.5f) * 1.2f * Size;
            Fx.Burst(p, FrostKit.TankIce, 6, 5f, 0.3f, 0.07f * Size, 8f);
            GameAudio.PlayAt("shield_break", p, 0.35f, 2.4f);
        }

        protected override void Update()
        {
            base.Update();
            if (!Dead) ApplyGuard();
            if (shellOut && shellSocket) shellSocket.Rotate(Vector3.up, SpinRate * Mathf.Rad2Deg * Time.deltaTime, Space.Self);
        }

        float YawToPlayer()
        {
            var to = PlayerPos - transform.position;
            return FrostKit.Yaw(to);
        }

        float FacingDot()
        {
            var to = PlayerPos - transform.position;
            to.y = 0;
            return to.sqrMagnitude < 1e-6f ? 1 : Vector3.Dot(transform.forward, to.normalized);
        }

        bool VerticalReach(float maxDy) => Mathf.Abs(PlayerPos.y - transform.position.y) <= maxDy;

        void TurnToYaw(float yawDeg, float radPerSec, float dt) =>
            transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.Euler(0, yawDeg, 0), radPerSec * Mathf.Rad2Deg * dt);

        Vector3 Local(float x, float y, float z) => transform.position + (transform.right * x + Vector3.up * y + transform.forward * z) * Size;

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            spinCd -= dt * auraAttackRate;
            biteCd -= dt * auraAttackRate;
            blindTime = sees ? 0 : blindTime + dt;
            if (!alerted && sees && d < 28)
            {
                alerted = true;
                GameAudio.PlayAt("enemy_alert", body.WeakPoint ? body.WeakPoint.position : transform.position, 0.8f, 0.55f);
            }
            switch (state)
            {
                case "advance":
                {
                    Glow = 0.25f + 0.1f * Mathf.Sin(age * 2.5f);
                    SetGlow(1, 0);
                    TurnToYaw(YawToPlayer(), TurnRate, dt);
                    float fd = FacingDot();
                    if (d < SpinMin) closeTime += dt;
                    else closeTime = Mathf.Max(0, closeTime - dt);
                    if (biteCd <= 0 && d <= BiteRange && fd < BiteBehind && VerticalReach(2f) && RequestAttack(AttackTokens.Kind.Melee, 1.2f))
                    {
                        BeginBite();
                        break;
                    }
                    // 近身旋转：玩家贴着不走 → 后退拉开，再缩壳旋转
                    if (spinCd <= 0 && d < SpinMin && sees && VerticalReach(1.5f) && (closePecks >= ClosePecks || closeTime >= CloseTime)
                        && RequestAttack(AttackTokens.Kind.Heavy, BackoffTime + SpinWindup + SpinMaxTime + 0.5f))
                    {
                        BeginBackoff();
                        break;
                    }
                    if (cooldown <= 0 && d <= PeckRange && fd > 0.7f && VerticalReach(1.8f) && RequestAttack(AttackTokens.Kind.Melee, 1.2f))
                    {
                        BeginPeck();
                        break;
                    }
                    if (spinCd <= 0 && d >= SpinMin && d <= SpinMax && sees && VerticalReach(1.5f)
                        && RequestAttack(AttackTokens.Kind.Heavy, SpinWindup + SpinMaxTime + 0.5f))
                    {
                        BeginSpin();
                        break;
                    }
                    float stop = 2.6f * Size * 0.7f;
                    if (d > stop) MoveTo(PlayerPos, moveSpeed);
                    else Stop();
                    break;
                }
                case "peckWindup":
                    Stop();
                    FacePlayer(2.2f * Mathf.Rad2Deg, dt);
                    Glow = 0.4f + 0.6f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime) Peck();
                    break;
                case "peck":
                    Stop();
                    if (stateTime >= 0.45f) ToAdvance();
                    break;
                case "biteWindup":
                    Stop();
                    Glow = 0.5f + 0.5f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime) Bite();
                    break;
                case "bite":
                    Stop();
                    if (stateTime >= 0.4f) ToAdvance();
                    break;
                case "backoff":
                {
                    // 正面对着玩家往后退（冰壳照挡）；退够距离或撞墙就开始缩壳
                    float yaw = YawToPlayer();
                    TurnToYaw(yaw, 2f, dt);
                    var back = -FrostKit.YawDir(yaw);
                    Stop();
                    bool blocked = FrostKit.NavStep(agent, back * (BackoffSpeed * SpeedMult * dt), out _);
                    if (Mathf.Floor(stateTime / 0.3f) != Mathf.Floor((stateTime - dt) / 0.3f))
                        FrostKit.Vapour(Local(0, 1f, 1.7f), Size * 0.5f, 3, FrostKit.TankIce);
                    if (stateTime >= BackoffTime || d >= BackoffRange || (stateTime > 0.15f && blocked)) BeginSpin();
                    break;
                }
                case "retract":
                {
                    Stop();
                    float t = Mathf.Clamp01(stateTime / windTime);
                    // 前 60% 还能对准玩家，之后锁定方向（侧移可躲）
                    if (t < 0.6f) TurnToYaw(YawToPlayer(), 1.6f, dt);
                    SetGlow(1, t);
                    Glow = 0.4f + 0.6f * t;
                    UpdateWarnings();
                    if (Mathf.Floor(stateTime / 0.12f) != Mathf.Floor((stateTime - dt) / 0.12f))
                    {
                        float a = stateTime * 9;
                        Fx.Burst(Local(Mathf.Sin(a) * 1.2f, 0.5f, Mathf.Cos(a) * 1.25f), FrostKit.Spike, 3, 3f, 0.35f, 0.08f * Size, 2f);
                    }
                    if (stateTime >= windTime) StartSpin();
                    break;
                }
                case "spin":
                    SpinStep(dt);
                    break;
                case "overheat":
                    Stop();
                    SetGlow(1, 0.85f + 0.15f * Mathf.Sin(age * 9));
                    Glow = 1f;
                    // 散热孔喷青紫霜气
                    if (Mathf.Floor(stateTime / 0.16f) != Mathf.Floor((stateTime - dt) / 0.16f) && body.WeakPoint)
                        FrostKit.Vapour(body.WeakPoint.position, Size, 4, FrostKit.Violet);
                    if (stateTime >= OverheatTime)
                    {
                        Act("rightself", RightselfTime, 0.1f);
                        SetState("rightself");
                        GameAudio.PlayAt("land", transform.position, 0.8f, 0.5f);
                    }
                    break;
                case "rightself":
                    Stop();
                    SetGlow(1, Mathf.Max(0, 1 - stateTime / RightselfTime));
                    if (stateTime >= RightselfTime)
                    {
                        RestoreSnakeWeakPoint();
                        Fx.Burst(transform.position + Vector3.up * 0.1f, FrostKit.Snow, 12, 3f, 0.6f, 0.2f * Size, 6f);
                        FrostKit.Quake(transform.position, 0.3f, StepShakeRange, 0.25f);
                        ToAdvance();
                        spinCd = Random.Range(6f, 8f);
                    }
                    break;
                default:
                    ToAdvance();
                    break;
            }
        }

        void ToAdvance()
        {
            ReleaseAttack();
            PlayLocomotion();
            SetState("advance");
        }

        // ───────────── 冰喙猛啄 ─────────────

        void BeginPeck()
        {
            windTime = Windup(PeckWindup, PeckWindupMin / PeckWindup);
            struck = false;
            Stop();
            Act("peckWindup", windTime, 0.08f);
            SetState("peckWindup");
            GameAudio.PlayAt("telegraph", Local(0, 1f, 1.6f), 0.6f, 0.8f);
        }

        void Peck()
        {
            Act("peck", 0, 0.04f);
            SetState("peck");
            var p = Local(0, 0.9f, 2.1f);
            GameAudio.PlayAt("enemy_melee", p, 0.9f, 0.6f);
            Fx.Burst(p, FrostKit.TankIce, 6, 4f, 0.3f, 0.08f * Size, 6f);
            if (DistToPlayer <= PeckReach + 0.35f && FacingDot() > 0.5f && VerticalReach(2f) && HitTarget(Damage * PeckMult, p))
            {
                struck = true;
                Push(transform.forward * PeckKnock + Vector3.up * 4f);
                CameraShake.Add(0.5f, 0.25f);
            }
            closePecks++;
            RollCooldown(1.6f, 2.4f);
        }


        void Push(Vector3 impulse)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || pv.Invulnerable || Taunted) return;
            pv.GetComponent<Spiritfire.Art.PlayerMotor>()?.AddImpulse(impulse);
        }

        // ───────────── 蛇尾反咬 ─────────────

        void BeginBite()
        {
            windTime = Windup(BiteWindup, BiteWindupMin / BiteWindup);
            struck = false;
            Stop();
            Act("biteWindup", windTime, 0.08f);
            SetState("biteWindup");
            var head = body.WeakPoint ? body.WeakPoint.position : Local(0, 1.5f, -1.6f);
            GameAudio.PlayAt("telegraph", head, 0.6f, 1.6f);
            FrostKit.Vapour(head, Size * 0.6f, 3, FrostKit.Cyan);
        }

        void Bite()
        {
            Act("bite", 0, 0.04f);
            SetState("bite");
            var head = body.WeakPoint ? body.WeakPoint.position : Local(0, 1.5f, -1.6f);
            GameAudio.PlayAt("enemy_melee", head, 0.8f, 1.4f);
            if (DistToPlayer <= BiteReach + 0.35f && FacingDot() < BiteBehind + 0.15f && VerticalReach(2.4f) && HitTarget(Damage * BiteMult, head))
            {
                struck = true;
                var away = PlayerPos - transform.position;
                away.y = 0;
                Push((away.sqrMagnitude > 1e-4f ? away.normalized : -transform.forward) * 6f + Vector3.up * 3f);
                Fx.Burst(PlayerEye, FrostKit.Violet, 8, 3f, 0.4f, 0.1f, 2f);
            }
            biteCd = Random.Range(1.8f, 2.6f);
        }

        // ───────────── 缩壳旋转 ─────────────

        /// <summary>近身旋转的第一步：低吼一声、喷鼻息，往后退开（名额已在 advance 里拿到）</summary>
        void BeginBackoff()
        {
            Act("backoff", BackoffTime, 0.1f);
            SetState("backoff");
            var p = Local(0, 1f, 1.7f);
            GameAudio.PlayAt("enemy_alert", p, 0.7f, 0.45f);
            FrostKit.Vapour(p, Size * 0.6f, 5, FrostKit.TankIce);
        }

        void BeginSpin()
        {
            windTime = Windup(SpinWindup, SpinWindupMin / SpinWindup);
            Stop();
            warn.Cancel();
            ring = warn.Annulus(transform.position, 1.05f * Size, 1.3f * Size, windTime, FrostKit.WarnTank);
            var from = transform.position + transform.forward * 1.3f * Size;
            lane = warn.Lane(from, from + transform.forward * 12f, 0.9f * Size, windTime, FrostKit.WarnTank);
            Act("retract", windTime, 0.08f);
            SetState("retract");
            GameAudio.PlayAt("telegraph", transform.position, 0.9f, 0.55f);
            GameAudio.PlayAt("enemy_charge", transform.position, 0.6f, 1.3f);
        }

        /// <summary>预警：脚下一圈（旋壳的大小）+ 朝当前方向一条直线（只预告起步方向，反弹要自己看）</summary>
        void UpdateWarnings()
        {
            ring.MoveTo(transform.position);
            var from = transform.position + transform.forward * 1.3f * Size;
            lane.SetLine(from, from + transform.forward * 12f, 0.9f * Size);
        }

        void StartSpin()
        {
            warn.Clear();
            spinYaw = transform.eulerAngles.y;
            spinDist = iceAt = 0;
            bounces = 0;
            lastBounce = -1;
            lastSpinHit = -99;
            closePecks = 0;
            closeTime = 0;
            struck = false;
            Stop();
            Act("spin", 0, 0.06f);
            SetState("spin");
            ApplyGuard();
            SwapToShell(true);
            Sfx("enemy_charge", 1f, 0.7f);
            FrostKit.Quake(transform.position, 0.3f, StepShakeRange, 0.25f);
        }

        /// <summary>身体 ↔ 旋壳：换的一瞬间用一团冰雾盖住（没有旋壳挂件时只出特效，身体照常播 spin）</summary>
        void SwapToShell(bool on)
        {
            if (shellRenderers.Length > 0 && shellOut != on)
            {
                foreach (var r in shellRenderers) if (r) r.enabled = on;
                foreach (var r in bodyRenderers) if (r) r.enabled = !on;
                if (!on && shellSocket) shellSocket.localRotation = shellRest;
            }
            shellOut = on && shellRenderers.Length > 0;
            var c = transform.position + Vector3.up * 0.8f * Size;
            FrostKit.Shatter(c, Size, 10, 4f);
            FrostKit.Vapour(c, Size, 6, FrostKit.TankIce);
        }

        /// <summary>旋壳速度：6 m/s 起每秒 +22，封顶 12.5（精英 ×1.15）</summary>
        public static float SpinSpeedAt(float t, bool elite) => Mathf.Min(SpinSpeed * (elite ? 1.15f : 1f), SpinStart + t * SpinRamp);

        /// <summary>第几次撞墙停下：超过 2 次（精英 3 次）反弹</summary>
        public static bool SpinStopsAt(int bounce, bool elite) => bounce > SpinBounces + (elite ? 1 : 0);

        /// <summary>旋转一帧：弱追踪、加速；撞墙按法线反弹（第 3 次撞墙停下）；撞到玩家重伤击飞；身后留滑冰带</summary>
        void SpinStep(float dt)
        {
            SetGlow(1, 1);
            Glow = 1;
            float to = YawToPlayer();
            spinYaw = Mathf.MoveTowardsAngle(spinYaw, to, SpinHoming * Mathf.Rad2Deg * dt);
            float sp = SpinSpeedAt(stateTime, elite) * SpeedMult;
            var dir = FrostKit.YawDir(spinYaw);
            var before = transform.position;
            bool navWall = FrostKit.NavStep(agent, dir * (sp * dt), out var navNormal, 0.1f);
            // 碰撞体墙（导航网格只按代理半径收边，壳比代理宽）：身体中心高度往前探壳半径
            float rad = 1.0f * Size;
            bool physWall = Physics.Raycast(transform.position + Vector3.up * 0.6f * Size, dir, out var wall, rad + sp * dt + 0.1f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                            && wall.normal.y < 0.5f;
            transform.rotation = Quaternion.Euler(0, spinYaw, 0);
            var moved = transform.position - before;
            moved.y = 0;
            spinDist += moved.magnitude;
            while (spinDist - iceAt >= IceStep)
            {
                iceAt += IceStep;
                float gy = FrostKit.GroundAt(transform.position, transform.position.y, 0.5f, 3f);
                IceFloor.Drop(new Vector3(transform.position.x, float.IsFinite(gy) ? gy : transform.position.y, transform.position.z), IceRadius * Size, IceTime);
            }
            // 撞到玩家
            if (player && !Taunted && Time.time - lastSpinHit >= SpinHitGap)
            {
                var v = PlayerPos - transform.position;
                float dy = v.y;
                v.y = 0;
                if (v.magnitude <= rad + 0.35f + 0.25f && dy > -1 && dy < 1.5f * Size)
                {
                    lastSpinHit = Time.time;
                    if (HitTarget(Damage * SpinMult, transform.position))
                    {
                        struck = true;
                        var away = v.sqrMagnitude > 1e-4f ? v.normalized : dir;
                        var k = (dir * 0.6f + away * 0.8f).normalized * SpinKnock;
                        Push(new Vector3(k.x, 5f, k.z));
                        CameraShake.Add(0.8f, 0.3f);
                        GameAudio.PlayAt("boss_slam", PlayerPos, 0.7f, 1.5f);
                        FrostKit.Shatter(PlayerPos + Vector3.up, 1f, 10, 6f);
                    }
                }
            }
            // 撞墙反弹
            if ((navWall || physWall) && stateTime > 0.12f && stateTime - lastBounce > 0.15f)
            {
                lastBounce = stateTime;
                bounces++;
                var p = Local(0, 0.6f, 1.2f);
                FrostKit.Shatter(p, Size, 14, 7f);
                GameAudio.PlayAt("boss_slam", p, 0.8f, 1.1f);
                FrostKit.Quake(transform.position, 0.45f, StepShakeRange, 0.25f);
                if (SpinStopsAt(bounces, elite))
                {
                    EndSpin();
                    return;
                }
                var n = physWall ? wall.normal : navNormal;
                spinYaw = FrostKit.Yaw(FrostKit.Reflect(dir, n));
                transform.rotation = Quaternion.Euler(0, spinYaw, 0);
            }
            if (stateTime >= SpinMaxTime) EndSpin();
        }

        /// <summary>
        /// 旋转结束：换回身体，侧翻在地、壳顶散热孔对着玩家（翻倒片段往生物右侧翻：让右侧正对玩家），弱点移到散热孔
        /// </summary>
        void EndSpin()
        {
            ReleaseAttack();
            Stop();
            SwapToShell(false);
            transform.rotation = Quaternion.Euler(0, YawToPlayer() - 90f, 0);
            if (bodyBone) body.SetWeakPoint(bodyBone, ventOffset, WeakRadius);
            float gy = FrostKit.GroundAt(transform.position, transform.position.y, 0.5f, 3f);
            var ground = new Vector3(transform.position.x, float.IsFinite(gy) ? gy : transform.position.y, transform.position.z);
            Fx.Ring(ground + Vector3.up * 0.05f, 1.8f * Size, FrostKit.TankIce, 0.5f);
            GameAudio.PlayAt("shield_break", transform.position, 0.8f, 0.6f);
            FrostKit.Quake(transform.position, 0.5f, StepShakeRange, 0.35f);
            Act("overheat", 0, 0.08f);
            SetState("overheat");
            ApplyGuard();
        }

        void RestoreSnakeWeakPoint()
        {
            if (snakeBone) body.SetWeakPoint(snakeBone, snakeOffset, WeakRadius);
        }

        /// <summary>
        /// 打断（眩晕、死亡、玩家阵亡、坠落回收）：撤回预警；旋转中的换回身体；过热 / 翻身中的弱点挪回蛇头——
        /// Unity 的基类在眩晕醒来后从初始状态（advance）重新开始，不像 TS 那样接着翻倒，所以这里一并收尾
        /// </summary>
        protected override void CancelAttack()
        {
            warn.Cancel();
            SetGlow(1, 0);
            if (state is "spin" or "overheat" or "rightself")
            {
                SwapToShell(false);
                RestoreSnakeWeakPoint();
                spinCd = Random.Range(6f, 8f);
            }
            if (Dead || state is "advance" or IdleState or "spawn") return;
            PlayLocomotion();
            SetState("advance");
            spinCd = Mathf.Max(spinCd, 2f);
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
