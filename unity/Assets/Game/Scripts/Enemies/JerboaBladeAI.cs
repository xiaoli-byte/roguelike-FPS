using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 跳鼠刀兵（Three.js 版 src/enemies/types/JerboaBlade.ts）：成群的侧翼骚扰者。
    ///   逼近：12 m 外直扑；12 m 内左右折线（0.45–0.85 s 换向）；冷却中在 3.8–6.5 m 的距离带上绕圈，不贴脸
    ///   扑斩：4–9 m、看得见、拿到近战名额 → 蹲伏 0.4 s（落点预警）→ 真跳向预判落点（提前 35%）→ 落地 360° 旋斩 2 m（伤害 ×1.3）
    ///         → 硬直 0.5 s（反击窗口）→ 离得近就向后跳开
    ///   贴脸：1.5 m 内交叉斩，前摇 0.3 s（举刀蓄势、半速贴近）→ 出刀 0.14 s（X 字刀光、略向前冲）→ 收招 0.38 s → 向后跳开
    ///   精英：扑斩落空（旋斩没打到人）且玩家还在 2.5–9 m、看得见时，不硬直，立刻再蹲 0.24 s 扑一次（每轮一次，同 Three.js retried）
    ///   命中反馈：旋斩打中玩家震屏 0.22（同 TS）；起跳扬沙
    ///   出手条件（同 TS）：和玩家高差 1.6 m 内；扑斩还要求直线上没有遮挡（不往墙里扑）
    ///   被打断（眩晕 / 玩家阵亡）：冷却重摇 0.6–1.2 s（同 TS cancelAttack）
    /// </summary>
    public sealed class JerboaBladeAI : EnemyAI
    {
        const float LeapMin = 4, LeapMax = 9, LeapWindup = 0.4f, Gravity = 26, LeapShort = 0.9f, LeapLead = 0.35f;
        const float SpinRange = 2f, SpinTime = 0.28f, SpinMult = 1.3f, SlashRange = 1.5f, SlashWindup = 0.3f;
        const float RecoverAfterSpin = 0.5f, HopBackTime = 0.42f, HopBackSpeed = 7.5f;

        float windTime, recoverTime, leapTime, zigzagTimer, strafeSign = 1;
        Vector3 leapTarget;
        bool leapHit, retried;

        /// <summary>累计：扑斩几次、扑中几次、精英落空重扑几次（测试用）</summary>
        public int Leaps { get; private set; }
        public int LeapHits { get; private set; }
        public int Releaps { get; private set; }

        static readonly Color Warn = new(1f, 0.55f, 0.2f);

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.12f, 0.06f, 3f, 0.7f);
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            // 铜铃亮度：蓄势 / 扑跳 / 出刀时全亮，旋斩后半亮，收招 / 后跳熄下去
            Glow = state switch
            {
                "crouch" or "leap" or "slashWindup" => 1f,
                "spin" => 0.6f,
                "slash" => 0.5f,
                "recover" or "hopBack" => 0.1f,
                _ => 0.15f + 0.1f * Mathf.Sin(age * 3),
            };
            switch (state)
            {
                case "chase":
                {
                    bool reach = Mathf.Abs(PlayerPos.y - transform.position.y) <= 1.6f;
                    if (cooldown <= 0 && sees && reach)
                    {
                        if (d <= SlashRange + 0.3f && RequestAttack(AttackTokens.Kind.Melee, 1.2f))
                        {
                            windTime = Windup(SlashWindup, 0.22f);
                            Sfx("enemy_alert", 0.35f, 1.9f + Random.value * 0.2f);
                            Stop();
                            PlayTimed("slashWindup", windTime, 0.05f);
                            SetState("slashWindup");
                            break;
                        }
                        if (d >= LeapMin && d <= LeapMax && PathClear() && RequestAttack(AttackTokens.Kind.Melee, 2.2f))
                        {
                            retried = false;
                            BeginCrouch(LeapWindup);
                            break;
                        }
                    }
                    zigzagTimer -= dt;
                    if (zigzagTimer <= 0)
                    {
                        zigzagTimer = Random.Range(0.45f, 0.85f);
                        strafeSign = -strafeSign;
                    }
                    if (d > 12 || !sees)
                    {
                        MoveTo(PlayerPos, moveSpeed);
                        FaceMovement(720, dt);
                    }
                    else if (cooldown > 0.25f)
                    {
                        KeepRange(3.8f, 6.5f, moveSpeed, strafeSign);
                        FaceTravel(dt);
                    }
                    else
                    {
                        var to = (PlayerPos - transform.position).normalized;
                        var side = new Vector3(-to.z, 0, to.x) * strafeSign;
                        float fwd = d > LeapMin - 0.5f ? 1f : 0.2f;
                        MoveTo(transform.position + (to * fwd + side * (d > 2 ? 0.85f : 0.4f)) * 4f, moveSpeed);
                        FaceTravel(dt);
                    }
                    break;
                }
                case "crouch":
                    Stop();
                    FacePlayer(460, dt);
                    if (stateTime >= windTime) LaunchLeap();
                    break;
                case "leap":
                    FaceTowards(leapTarget, 720, dt);
                    if ((ManualGrounded && stateTime > 0.1f) || stateTime >= leapTime + 0.35f || (HitWall && stateTime > 0.15f)) Spin();
                    break;
                case "spin":
                    Stop();
                    if (stateTime >= SpinTime)
                    {
                        if (elite && !leapHit && !retried && d >= 2.5f && d <= LeapMax && sees && RequestAttack(AttackTokens.Kind.Melee, 2.2f))
                        {
                            // 精英落空：不硬直，立刻再扑一次
                            retried = true;
                            Releaps++;
                            BeginCrouch(LeapWindup * 0.6f);
                            break;
                        }
                        recoverTime = RecoverAfterSpin;
                        SetState("recover");
                    }
                    break;
                case "slashWindup":
                    FacePlayer(460, dt);
                    if (d > 1f) MoveTo(PlayerPos, moveSpeed * 0.5f);
                    else Stop();
                    if (stateTime >= windTime)
                    {
                        Play("slash", 0.03f);
                        Melee(SlashRange, Damage, 0.2f);
                        CrossSlashFx();
                        SetState("slash");
                    }
                    break;
                case "slash":
                    // 出刀时顺势向前一冲（同 Three.js：1.5 m/s）
                    MoveTo(transform.position + transform.forward * 2f, 1.5f);
                    if (stateTime >= 0.14f)
                    {
                        Stop();
                        recoverTime = 0.38f;
                        SetState("recover");
                    }
                    break;
                case "recover":
                    Stop();
                    FacePlayer(230, dt);
                    if (stateTime >= recoverTime / Mathf.Sqrt(auraAttackRate))
                    {
                        ReleaseAttack();
                        RollCooldown(1.4f, 2.6f);
                        if (d < 3.5f)
                        {
                            // 打了就跑：向后（略斜）跳开
                            var away = (transform.position - PlayerPos);
                            away.y = 0;
                            away = away.normalized;
                            var dir = (away + new Vector3(-away.z, 0, away.x) * strafeSign * 0.5f).normalized;
                            BeginManualMotion(dir * HopBackSpeed + Vector3.up * 5.2f, Gravity);
                            Play("hopBack", 0.05f);
                            Sfx("jump", 0.35f, 1.6f);
                            SetState("hopBack");
                        }
                        else
                        {
                            PlayLocomotion();
                            SetState("chase");
                        }
                    }
                    break;
                case "hopBack":
                    FacePlayer(340, dt);
                    if (stateTime >= HopBackTime || (ManualGrounded && stateTime > 0.15f))
                    {
                        EndManualMotion();
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

        /// <summary>扑斩的直线上没有遮挡（同 TS directPathClear：腰高处一条射线）</summary>
        bool PathClear() => !Combat.Blocked(transform.position + Vector3.up * 0.5f, PlayerPos + Vector3.up * 0.5f, null);

        protected override void CancelAttack()
        {
            Glow = 0;
            if (state is not "chase" and not IdleState and not "hopBack") RollCooldown(0.6f, 1.2f);
        }

        void FaceTravel(float dt)
        {
            if (agent.velocity.magnitude > 2 && DistToPlayer > 2.4f) FaceMovement(570, dt);
            else FacePlayer(570, dt);
        }

        void BeginCrouch(float time)
        {
            windTime = Windup(time, 0.26f);
            Stop();
            PlayTimed("crouch", windTime, 0.06f);
            Sfx("enemy_charge", 0.45f, 1.9f + Random.value * 0.2f);
            SetState("crouch");
            // 预警：预判落点
            leapTarget = PredictLanding(out _);
            Telegraph.Circle(leapTarget, SpinRange, windTime + 0.5f, Warn);
        }

        Vector3 PredictLanding(out float dist)
        {
            var to = PlayerPos - transform.position;
            to.y = 0;
            float est = 0.32f + to.magnitude * 0.035f;
            var target = PredictPlayer(est * LeapLead);
            var dir = target - transform.position;
            dir.y = 0;
            float len = Mathf.Max(0.01f, dir.magnitude);
            dist = Mathf.Clamp(len - LeapShort, 1.5f, LeapMax);
            return transform.position + dir / len * dist;
        }

        /// <summary>真跳跃：按落点距离定飞行时间，竖直初速让它在 leapTime 后回到起跳高度</summary>
        void LaunchLeap()
        {
            leapTarget = PredictLanding(out float dist);
            leapTime = 0.32f + dist * 0.035f;
            var dir = leapTarget - transform.position;
            dir.y = 0;
            dir.Normalize();
            transform.rotation = Quaternion.LookRotation(dir);
            leapHit = false;
            HitWall = false;
            BeginManualMotion(dir * (dist / leapTime) + Vector3.up * (Gravity * leapTime * 0.5f), Gravity);
            Play("leap", 0.04f);
            SetState("leap");
            Leaps++;
            Sfx("dash", 0.5f, 1.5f);
            // 起跳蹬起的沙
            Fx.Burst(transform.position + Vector3.up * 0.05f, DesertKit.Dust, 6, 1.6f, 0.35f, 0.12f * Size, 1f);
        }

        /// <summary>X 字刀光：两道斜劈交叉（同 Three.js crossSlashFx）</summary>
        void CrossSlashFx()
        {
            float k = Size;
            var c = transform.position + Vector3.up * 0.55f * k;
            foreach (int s in new[] { 1, -1 })
                SlashArc.Spawn(c, transform.eulerAngles.y, 1.1f * k, 1.7f, s, s * 0.75f, 0.3f * k, 0.2f, new Color(1f, 0.77f, 0.42f), true);
        }

        void Spin()
        {
            EndManualMotion();
            Play("spin", 0.04f);
            Sfx("land", 0.5f, 1.4f);
            leapHit = Burst(transform.position, SpinRange, Damage * SpinMult);
            SetState("spin");
            if (leapHit)
            {
                LeapHits++;
                CameraShake.Add(0.22f, 0.15f);
            }
            // 落地旋斩：一圈刀光 + 地面扬尘环（伤害范围不随体型放大，同 Three.js；刀光随体型）
            float k = Size;
            SlashArc.Spawn(transform.position + Vector3.up * 0.42f * k, transform.eulerAngles.y, SpinRange * 0.85f * k, Mathf.PI * 1.9f, 1, 0, 0.5f * k, 0.26f, new Color(1f, 0.71f, 0.29f), true);
            Telegraph.Wave(transform.position, SpinRange * k, 9f, new Color(0.85f, 0.69f, 0.47f));
            ShotFx.Instance?.Impact(transform.position, Vector3.up, false, 2.4f);
        }
    }
}
