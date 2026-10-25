using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玄冰巨蟹（Three.js 版 src/enemies/types/FrostCrab.ts）：第二章坦克，约 3 m 宽、3.3 m 高，血厚甲厚、不吃击退。
    ///   钳墙推进：巨钳始终对着玩家（每秒约 1.1 rad 转身），身子却横着走——一阵往左一阵往右（1.6–2.8 s 换向，撞墙提前换）地斜着逼近
    ///     （侧移为主、带 45% 前进；贴近后只横移、太近略后退）；正面（cos ≥ 0.25）来的伤害 ×0.15，走 E2 命中区的朝向门（<see cref="GuardFor"/>），
    ///     打在钳上迸冰屑脆响。看不到玩家时走导航绕过来。
    ///   夹击：4 m 内、正对（cos &gt; 0.75）时巨钳张开抬起 0.6 s（近战名额；身前 4.4 m、半角 53° 的扇形预警，前 50% 还在对准，最后 30% 快闪），
    ///     然后猛地夹下：×1.6 并把人甩向巨钳那一侧（11 + 往前 3 + 上抛 6）；收钳 0.7 s 不格挡（输出窗口）。冷却 3.5–4.5 s。精英夹完立刻补一记横扫。
    ///   横扫：玩家在侧面 / 身后（cos &lt; 0.6）5.5 m 内时小钳往外一扬 0.5 s（1.4–6.5 m 环形预警），然后推出贴地扩散的冰屑冲击环
    ///     （<see cref="GroundWave"/>：1.4 → 6.5 m、18 m/s，跳起 0.6 m 以上能躲）×0.75 + 往外推 7、上抛 4。冷却 4–5 s。
    ///   断钳：血量低于 35% 时巨钳碎裂（冰屑和蟹壳四溅，claw_R 骨缩没）：不再夹击，正面只剩 ×0.5，移速 ×1.35、转身 ×1.4、横扫冷却减半、
    ///     任何方向都能横扫。碎钳演出 0.9 s 不格挡。
    /// 弱点：背后发光的鳃缝（vent 骨 + 模型空间 (0, 1.0, −0.95)）。
    /// 状态：advance → grabWindup → grab → grabRecover → advance；advance → sweepWindup → sweep → advance；（低于 35%）→ shellBreak → advance
    /// </summary>
    public sealed class FrostCrabAI : EnemyAI
    {
        public const float GuardFactor = 0.15f, BrokenGuard = 0.5f, GuardCos = 0.25f, TurnRate = 1.1f, ForwardShare = 0.45f;
        public const float GrabRange = 4f, GrabReach = 4.4f, GrabCos = 0.6f, GrabWindup = 0.6f, GrabWindupMin = 0.45f, GrabMult = 1.6f, GrabFling = 11, GrabRecover = 0.7f;
        public const float SweepRange = 5.5f, SweepWindup = 0.5f, SweepWindupMin = 0.35f, SweepInner = 1.4f, SweepRadius = 6.5f, SweepSpeed = 18;
        public const float SweepMult = 0.75f, SweepKnock = 7, SweepKnockUp = 4, SweepJumpClear = 0.6f;
        public const float BreakAt = 0.35f, BreakSpeed = 1.35f, BreakTurn = 1.4f, BreakTime = 0.9f, WeakRadius = 0.36f, StepShakeRange = 18;
        /// <summary>侧移换向的间隔（秒，同 TS SIDE_SWITCH）；撞墙提前换向要离上次换向至少过了一阵（计时 &lt; SideSwitchMin − 0.6）</summary>
        public const float SideSwitchMin = 1.6f, SideSwitchMax = 2.8f;
        static readonly Vector3 VentPoint = new(0, 1.0f, -0.95f);

        float windTime = GrabWindup, grabCd, sweepCd, sideTimer, sideSign = 1, blockFxAt, blindTime;
        bool alerted, chainSweep, broken, struck;
        GuardProfile guard = GuardProfile.Open;
        readonly WarnScope warn = new("frost_crab");
        TelegraphHandle sector;
        Transform claw;

        /// <summary>巨钳已碎（血量低于 35%）</summary>
        public bool Broken => broken;
        /// <summary>最近一次夹击是否夹中了玩家</summary>
        public bool Struck => struck;
        public GuardProfile Guard => guard;

        protected override string InitialState => "advance";

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.15f, 0.08f, 2.2f, 0.75f);
            grabCd = Random.Range(1f, 2f);
            sweepCd = Random.Range(1.5f, 3f);
            sideSign = Random.value < 0.5f ? -1 : 1;
            var vent = FrostKit.FindBone(transform, "vent");
            if (vent) body.SetWeakPoint(vent, FrostKit.ModelPointOnBone(transform, vent, VentPoint), WeakRadius);
            claw = FrostKit.FindBone(transform, "claw_R");
            var bz = body.Zone("body");
            if (bz) bz.Damaged += OnBodyZoneHit;
            ApplyGuard();
        }

        /// <summary>
        /// 某个状态下的格挡（纯计算，测试用）：推进、两种前摇、横扫时钳墙挡正面（×0.15，断钳后 ×0.5；cos 0.25）；
        /// 夹下、收钳、碎钳演出、被眩晕时不挡
        /// </summary>
        public static GuardProfile GuardFor(string state, bool stunned, bool broken)
        {
            if (stunned) return GuardProfile.Open;
            return state is "advance" or "grabWindup" or "sweepWindup" or "sweep" or IdleState
                ? new GuardProfile(broken ? BrokenGuard : GuardFactor, ZoneFacing.Front, GuardCos)
                : GuardProfile.Open;
        }

        /// <summary>贴近距离（TS 2.6 × 体型 × 0.8）：比它远就斜着逼近，比它的 0.8 倍还近就略后退，中间只横移</summary>
        public static float NearDistance(float size) => 2.6f * size * 0.8f;

        /// <summary>侧移推进里「往前」的分量（纯计算，测试用；同 TS scuttle 的 fwd）：远处 0.45、贴近带内 0、太近 −0.25</summary>
        public static float ScuttleForward(float d, float size)
        {
            float near = NearDistance(size);
            return d > near ? ForwardShare : d < near * 0.8f ? -0.25f : 0f;
        }

        /// <summary>
        /// 看得到玩家时横着走、逼近玩家的速度（米/秒）：方向 = 侧向 ± 0.45 × 前方（归一化），前进分量只有 0.45 / √(1 + 0.45²) ≈ 41%。
        /// 移速 2.4 时约 0.98 m/s——14 m 外要 ≈ 10 s 才进夹击距离（同 TS 的「钳墙慢慢压上来」；冒烟套件按它决定站多远）
        /// </summary>
        public static float ClosingSpeed(float speed) => speed * ForwardShare / Mathf.Sqrt(1f + ForwardShare * ForwardShare);

        /// <summary>
        /// 该不该换侧移方向（纯计算，测试用）：计时到点，或前方导航网格到头（撞墙）且离上次换向至少过了一阵（计时 &lt; SideSwitchMin − 0.6）。
        /// 撞墙但刚换过向时不换、计时照走——TS 版每帧撞墙都重抽计时，贴着墙时计时永远到不了，巨蟹会一直顶在墙 / 台沿上不换向
        /// </summary>
        public static bool ShouldSwitchSide(float timer, bool wall) => timer <= 0 || (wall && timer < SideSwitchMin - 0.6f);

        /// <summary>夹中时把玩家甩出去的冲量：甩向巨钳那一侧（生物右侧）11 + 往前 3 + 上抛 6</summary>
        public static Vector3 FlingImpulse(Transform crab) => crab.right * GrabFling + crab.forward * 3f + Vector3.up * 6f;

        /// <summary>横扫冲击环（纯参数，测试用）：1.4 → 6.5 m、18 m/s，环带 ±0.4 m，玩家脚底相对波心 −0.6..0.6 m（跳起躲开），往外推 7、上抛 4</summary>
        public static GroundWave.Spec SweepWave(Vector3 center, float damage, EnemyAI owner) =>
            new(center, SweepRadius, SweepSpeed, damage)
            {
                startRadius = SweepInner, width = 0.8f, minRise = -0.6f, maxRise = SweepJumpClear, needGrounded = false,
                knockback = SweepKnock, knockUp = SweepKnockUp, color = FrostKit.TankIce, owner = owner,
            };

        void ApplyGuard()
        {
            var g = Dead ? GuardProfile.Open : GuardFor(state, Stunned, broken);
            if (g.Equals(guard) && state != "spawn") return;
            guard = g;
            FrostKit.ApplyGuard(body, g);
        }

        void OnBodyZoneHit(HitZone z, DamageInfo info, DamageResult r)
        {
            if (guard.facing != ZoneFacing.Front || info.source == DamageSource.Status || !z.FacingPasses(info.direction)) return;
            if (Time.time - blockFxAt < 0.07f) return;
            blockFxAt = Time.time;
            var p = Local(0.45f + (Random.value - 0.5f) * 0.8f, 0.7f + Random.value, 1.3f);
            // FX3：钳墙格挡——冰碴 + 一记冷星芒
            FrostKit.Shatter(p, 0.35f * Size, FrostKit.TankIce, 6, 5f);
            Fx.FrostGlint(p, 0.5f * Size, FrostKit.TankIce);
            GameAudio.PlayAt("shield_break", p, 0.35f, 2f);
        }

        protected override void Update()
        {
            base.Update();
            if (!Dead) ApplyGuard();
        }

        void LateUpdate()
        {
            // 断钳：巨钳骨（连同钳指）缩没——片段只有姿势，网格隐藏要玩法做（动画写完骨骼之后再缩）
            if (broken && claw) claw.localScale = Vector3.one * 0.001f;
        }

        /// <summary>移速倍率：断钳后 ×1.35</summary>
        float Speed => moveSpeed * (broken ? BreakSpeed : 1f);

        Vector3 Local(float x, float y, float z) => transform.position + (transform.right * x + Vector3.up * y + transform.forward * z) * Size;

        float FacingDot()
        {
            var to = PlayerPos - transform.position;
            to.y = 0;
            return to.sqrMagnitude < 1e-6f ? 1 : Vector3.Dot(transform.forward, to.normalized);
        }

        bool VerticalReach(float maxDy) => Mathf.Abs(PlayerPos.y - transform.position.y) <= maxDy;

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            grabCd -= dt * auraAttackRate;
            sweepCd -= dt * auraAttackRate * (broken ? 2 : 1);
            blindTime = sees ? 0 : blindTime + dt;
            if (!alerted && sees && d < 28)
            {
                alerted = true;
                GameAudio.PlayAt("enemy_alert", Local(0, 1.2f, 0.8f), 0.8f, 0.45f);
            }
            if (!broken && hp.Fraction < BreakAt && state != "shellBreak")
            {
                BreakClaw();
                return;
            }
            switch (state)
            {
                case "advance":
                {
                    Glow = 0;
                    SetGlow(1, (broken ? 0.6f : 0.3f) + 0.15f * Mathf.Sin(age * 2.2f));
                    FacePlayer(TurnRate * (broken ? BreakTurn : 1f) * Mathf.Rad2Deg, dt);
                    float fd = FacingDot();
                    if (!broken && grabCd <= 0 && d <= GrabRange && fd > 0.75f && VerticalReach(1.8f) && RequestAttack(AttackTokens.Kind.Melee, 2f))
                    {
                        BeginGrab();
                        break;
                    }
                    bool flank = fd < 0.6f || broken;
                    if (sweepCd <= 0 && d <= SweepRange && flank && VerticalReach(1.5f) && RequestAttack(AttackTokens.Kind.Melee, 1.5f))
                    {
                        BeginSweep();
                        break;
                    }
                    Scuttle(dt, d);
                    break;
                }
                case "grabWindup":
                {
                    Stop();
                    float t = Mathf.Clamp01(stateTime / windTime);
                    // 前 50% 还能对准玩家，之后锁定（后撤 / 侧移可躲）
                    if (t < 0.5f) FacePlayer(1.6f * Mathf.Rad2Deg, dt);
                    Glow = 0.4f + 0.6f * t;
                    sector.MoveTo(transform.position);
                    sector.SetYaw(transform.eulerAngles.y);
                    if (t > 0.7f) sector.SetColor(Color.Lerp(FrostKit.WarnTank, Color.white, 0.5f + 0.5f * Mathf.Sin(stateTime * 40)));
                    if (stateTime >= windTime) Grab();
                    break;
                }
                case "grab":
                    Stop();
                    if (stateTime >= 0.2f)
                    {
                        Act("grabRecover", GrabRecover, 0.1f);
                        SetState("grabRecover");
                    }
                    break;
                case "grabRecover":
                    Stop();
                    Glow = 0;
                    if (stateTime >= GrabRecover)
                    {
                        if (chainSweep)
                        {
                            chainSweep = false;
                            BeginSweep();
                        }
                        else ToAdvance();
                    }
                    break;
                case "sweepWindup":
                    Stop();
                    Glow = 0.3f + 0.5f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime) Sweep();
                    break;
                case "sweep":
                    Stop();
                    if (stateTime >= 0.45f) ToAdvance();
                    break;
                case "shellBreak":
                    Stop();
                    SetGlow(1, 1);
                    if (stateTime >= BreakTime) ToAdvance();
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

        /// <summary>
        /// 横着走：身体（巨钳）对着玩家，移动方向以身体侧向为主、带一点前进，一阵往左一阵往右；贴近后只横移（钳墙堵脸）、太近略后退；
        /// 前面的导航网格到头（撞墙）就换方向（<see cref="ShouldSwitchSide"/>）。换向计时同 TS 在看不到玩家时也照走
        /// </summary>
        void Scuttle(float dt, float d)
        {
            bool blind = !sees || blindTime > 0.5f;
            float fwd = ScuttleForward(d, Size);
            var move = (transform.right * sideSign + transform.forward * fwd).normalized;
            sideTimer -= dt;
            bool wall = !blind && FrostKit.NavBlocked(agent, move, 1.2f);
            if (ShouldSwitchSide(sideTimer, wall))
            {
                sideSign = -sideSign;
                sideTimer = Random.Range(SideSwitchMin, SideSwitchMax);
                move = (transform.right * sideSign + transform.forward * fwd).normalized;
            }
            if (blind)
            {
                // 看不到玩家：走导航绕过来
                if (d > NearDistance(Size)) MoveTo(PlayerPos, Speed);
                else Stop();
                return;
            }
            MoveTo(transform.position + move * 2.5f, Speed);
        }

        // ───────────── 夹击 ─────────────

        void BeginGrab()
        {
            windTime = Windup(GrabWindup, GrabWindupMin / GrabWindup);
            struck = false;
            Stop();
            warn.Cancel();
            // 实色电光蓝（浅色冰面上叠加的浅青预警会被地面吃掉）
            sector = warn.Sector(transform.position, transform.eulerAngles.y, Mathf.Acos(GrabCos) * Mathf.Rad2Deg, GrabReach, windTime, FrostKit.WarnTank);
            Act("grabWindup", windTime, 0.08f);
            SetState("grabWindup");
            GameAudio.PlayAt("telegraph", Local(0.6f, 1.4f, 1.2f), 0.9f, 0.6f);
        }

        void Grab()
        {
            warn.Clear();
            Act("grab", 0, 0.04f);
            SetState("grab");
            var p = Local(0.55f, 1f, 2f);
            GameAudio.PlayAt("boss_slam", p, 0.8f, 1.2f);
            FrostKit.Shatter(p, Size * 0.8f, 10, 5f);
            FrostKit.Quake(transform.position, 0.4f, StepShakeRange, 0.25f);
            if (DistToPlayer <= GrabReach + 0.35f && FacingDot() > GrabCos && VerticalReach(2.2f) && HitTarget(Damage * GrabMult, p))
            {
                struck = true;
                var pv = PlayerVitals.Instance;
                if (pv && !pv.Dead) pv.GetComponent<Spiritfire.Art.PlayerMotor>()?.AddImpulse(FlingImpulse(transform));
                CameraShake.Add(0.9f, 0.35f);
            }
            grabCd = Random.Range(3.5f, 4.5f);
            chainSweep = elite;
        }

        // ───────────── 横扫 ─────────────

        void BeginSweep()
        {
            windTime = Windup(SweepWindup, SweepWindupMin / SweepWindup);
            Stop();
            warn.Cancel();
            warn.Annulus(transform.position, SweepInner, SweepRadius, windTime, FrostKit.WarnTank);
            Act("sweepWindup", windTime, 0.08f);
            SetState("sweepWindup");
            GameAudio.PlayAt("telegraph", Local(-0.6f, 1f, 1f), 0.8f, 1.1f);
        }

        void Sweep()
        {
            warn.Clear();
            Act("sweep", 0, 0.04f);
            SetState("sweep");
            float gy = FrostKit.GroundAt(transform.position, transform.position.y, 0.5f, 3f);
            var ground = new Vector3(transform.position.x, float.IsFinite(gy) ? gy : transform.position.y, transform.position.z);
            GameAudio.PlayAt("enemy_melee", ground, 1f, 0.5f);
            FrostKit.Quake(transform.position, 0.35f, StepShakeRange, 0.25f);
            GroundWave.Spawn(SweepWave(ground, Damage * SweepMult, this));
            // FX3：横扫在内圈翻起一圈雪雾 / 冰碴 + 霜斑（不立冰刺：伤害是往外推的地波，别让人以为冰刺那圈才疼）
            Fx.Play("FrostRingBurst", ground, Vector3.up, FrostKit.TankIce, SweepInner * 1.3f);
            sweepCd = Random.Range(4f, 5f);
        }

        // ───────────── 断钳 ─────────────

        /// <summary>巨钳碎裂：冰屑和蟹壳四溅、巨钳整只崩掉；之后不再夹击，正面只剩一半减伤，走得更快、横扫更勤</summary>
        void BreakClaw()
        {
            broken = true;
            warn.Cancel();
            ReleaseAttack();
            Stop();
            Act("shellBreak", BreakTime, 0.06f);
            SetState("shellBreak");
            var p = claw ? claw.position : Local(0.65f, 1.05f, 0.9f);
            FrostKit.Shatter(p, 1.4f * Size, FrostKit.TankIce, 30, 9f);
            Fx.Play("ArmorChip", p, Vector3.up, FrostKit.Shell, 0.8f * Size);
            FrostKit.Vapour(p, Size, 8, FrostKit.Aqua);
            GameAudio.PlayAt("shield_break", p, 1f, 0.55f);
            GameAudio.PlayAt("boss_roar", transform.position, 0.7f, 1.3f);
            FrostKit.Quake(transform.position, 0.7f, 26f, 0.45f);
        }

        protected override void CancelAttack()
        {
            warn.Cancel();
            if (Dead || state is "advance" or IdleState or "shellBreak" or "spawn") return;
            PlayLocomotion();
            SetState("advance");
            grabCd = Mathf.Max(grabCd, 1.5f);
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
