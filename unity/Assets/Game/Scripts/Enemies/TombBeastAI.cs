using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三彩镇墓兽（Three.js 版 src/enemies/types/TombBeast.ts）：重装突击手。
    ///   格挡：正面（朝向 ±70° 内）来的伤害只吃一成；弱点是背上的裂缝——逼玩家绕背。转身慢（80°/s）
    ///   冲锋：7–20 m、看得见、几乎正对 → 刨地蓄力 1 s（地面预警线，前 60% 还能微调方向）→ 15 m/s 直冲最多 20 m
    ///         撞到玩家 ×1.4 伤害 + 强力击退；沿途犁出日火裂痕（站上去 ×0.15 / 0.5 s）
    ///         撞墙 → 撞晕 1.8 s（反击窗口）；冲满 → 刹车 0.9 s
    ///   踏地：3.2 m × 体型内（同 TS STOMP_RANGE），蓄力 0.7 s → 身前 1 m 砸地：爆心 1.6 m × 体型 伤害 ×1.0、边缘剩 0.7、掀开 8
    ///         + 9 m 外扩冲击波（16 m/s，贴地才吃，跳起可躲，×0.7，往外推 9 / 上 5，同 TS WAVE_KNOCK）
    ///   狂暴：生命低于 40% → 移速 ×1.25、冲锋冷却减半、一次冲两趟；精英一直冲两趟（同 TS isElite || enraged）
    ///   出手条件（同 TS）：踏地高差 2 m 内、冲锋高差 1.5 m 内；冲锋超时（被卡住没撞墙）也刹车
    ///   碎陶（同 TS）：每掉 12% 生命背上崩落一把三彩陶片；撞墙撞晕时背上喷日火柱；死时整只陶身炸碎、日火冲天、地上留焦痕
    ///   背上的日火（FX4，同 TS buildCrackFire / updateCrackFire）：龟裂里一簇火舌（<see cref="FlameTongue"/>，挂在 crack 骨上），
    ///         随旺度（平时 0.3、狂暴 0.75、蓄力 / 冲锋 / 撞晕时跟着发光通道到 1）蹿高变亮、往上飘火星；冲锋犁出的日火裂痕是 FX4 的日火地火
    ///   精英的出手分量（docs/art/vfx/elites-ch1.md，数值 / 时机不变）：
    ///     冲锋——刨地时压低、低头顶角（<see cref="EliteStrike.Charge"/>），头上一颗金芒、金点往角上收；起冲那一下拉长前冲 + 顿帧 + 金色爆闪 + 加重震屏，
    ///       冲锋中蹄下甩金屑（<see cref="Fx.EliteTrail"/>）；刹车时后坐一下；撞墙整只压扁一下；
    ///     踏地——人立而起（后仰、拉高）蓄力，砸下是释放帧：压扁前冲 + 顿帧 + 地上多一圈金环、崩起石块（<see cref="Fx.EliteSlam"/>）、加重震屏
    /// </summary>
    public sealed class TombBeastAI : EnemyAI
    {
        const float GuardFactor = 0.1f, GuardCos = 0.34f, TurnRate = 80f;
        const float ChargeMin = 7, ChargeMax = 20, ChargeWindup = 1f, ChargeSpeed = 15, ChargeLength = 20, ChargeHalfWidth = 0.9f;
        const float ChargeMult = 1.4f, ChargeKnock = 16, DazedTime = 1.8f, BrakeTime = 0.9f;
        const float TrailStep = 1.4f, TrailRadius = 0.6f, TrailTime = 3f, TrailMult = 0.15f;
        public const float StompRange = 3.2f;
        const float StompWindup = 0.7f, StompCore = 1.6f, WaveRadius = 9, WaveSpeed = 16, WaveMult = 0.7f, RageAt = 0.4f;
        /// <summary>冲击波往外推 / 往上掀（米/秒，同 TS WAVE_KNOCK / 5）、爆心掀开（同 TS blastPlayer knock 8）、碎陶的生命步长</summary>
        public const float WaveKnock = 9f, WaveKnockUp = 5f, CoreKnock = 8f, ShardStep = 0.12f;

        float chargeCd = 2f, windTime, chargeDist, trailAt, blockFxAt, pawFxAt, dazeFxAt, brakeFxAt;
        int shards;
        bool crackGated;

        /// <summary>累计：冲锋几趟、崩落几把陶片（测试用）</summary>
        public int Charges { get; private set; }
        public int ShardsShed => shards;
        Telegraph.LineHandle lane;
        bool enraged, chargeHit, recharge, alerted;
        /// <summary>精英的出手分量层（普通的为 null）</summary>
        EliteStrike strike;

        /// <summary>头角的位置（精英金芒、蓄力金点）</summary>
        Vector3 Horn => transform.position + (transform.forward * 1.25f + Vector3.up * 1.15f) * Size;
        Vector3 chargeDir;

        /// <summary>龟裂里的日火火舌（同 TS CRACK_TONGUES：网格坐标，x = 生物左侧）</summary>
        static readonly (Vector3 at, float size)[] CrackTongues =
        {
            (new(0.0f, 1.68f, 0.38f), 0.34f), (new(0.14f, 1.58f, 0.2f), 0.26f), (new(-0.12f, 1.52f, 0.04f), 0.3f),
            (new(0.1f, 1.44f, -0.14f), 0.24f), (new(-0.06f, 1.38f, -0.3f), 0.27f), (new(0.0f, 1.46f, 0.0f), 0.4f),
        };
        static readonly Color CrackHot = Hex.Rgb(0xfff6d0), CrackMid = Hex.Rgb(0xffb040), CrackTip = Hex.Rgb(0xe0501a);
        readonly System.Collections.Generic.List<(FlameTongue t, float size, float phase)> crackFire = new();
        float pHeat, crackEmberAcc;

        protected override string InitialState => "advance";

        protected override void Awake()
        {
            base.Awake();
            hp.incomingModifier = Guard;
            hp.Died += OnShatter;
            GlowStyle(0, 0, 0, 0.9f, false);
            if (body.Rig) body.Rig.Footfall += OnFootfall;
            BuildCrackFire();
        }

        /// <summary>FX4：龟裂里的日火火舌（绑定姿势下按网格坐标换算到 crack 骨的局部；没有 crack 骨挂在根上）</summary>
        void BuildCrackFire()
        {
            if (!Application.isPlaying || GetComponent<PlaceholderBody>()) return;
            var bone = InfernoKit.FindBone(transform, "crack") ?? transform;
            float k = Mathf.Abs(transform.lossyScale.x);
            foreach (var (at, size) in CrackTongues)
            {
                var t = FlameTongue.Attach(bone, bone.InverseTransformPoint(InfernoKit.ModelToWorld(transform, at)), Vector3.one * size * k, CrackHot, CrackMid, CrackTip);
                if (t) crackFire.Add((t, size, Random.value * 10f));
            }
        }

        /// <summary>背上的日火：火舌随旺度蹿高，火星往上飘（狂怒 / 蓄力 / 撞晕时最旺；同 TS updateCrackFire）</summary>
        void UpdateCrackFire(float dt)
        {
            float heat = Mathf.Max(enraged ? 0.75f : 0.3f, Mathf.Clamp01(body.GlowLevel(0)));
            pHeat = Mathf.Lerp(pHeat, heat, 1 - Mathf.Exp(-6 * dt));
            float k = Mathf.Abs(transform.lossyScale.x);
            foreach (var (t, size, phase) in crackFire)
            {
                if (!t) continue;
                float flick = 1 + 0.15f * Mathf.Sin(age * 12 + phase) + 0.08f * Mathf.Sin(age * 27 + phase * 2);
                float grow = 0.55f + pHeat;
                float b = size * k;
                t.Set(0.5f + 0.5f * pHeat, new Vector3(b * grow * 0.9f, b * grow * flick * 1.3f, b * grow));
            }
            crackEmberAcc += dt * (0.4f + 1.6f * pHeat);
            while (crackEmberAcc > 0.12f)
            {
                crackEmberAcc -= 0.12f;
                var p = InfernoKit.ModelToWorld(transform, new Vector3((Random.value - 0.5f) * 0.6f, 1.45f + Random.value * 0.2f, (Random.value - 0.5f) * 0.8f));
                Fx.Burst(p, Random.value < 0.6f ? DesertKit.Ember : DesertKit.Sunfire, 1, 0.8f, 0.9f, 0.05f * Size, -3f);
            }
        }

        /// <summary>背上的龟裂（弱点）位置；没有弱点球时取身体中上部</summary>
        Vector3 Crack => body.WeakPoint ? body.WeakPoint.position : transform.position + Vector3.up * 1.45f * Size;

        /// <summary>每掉 12% 生命崩落一把陶片（同 TS checkShards）</summary>
        void CheckShards()
        {
            float lost = 1 - hp.Fraction;
            while (shards < Mathf.FloorToInt(lost / ShardStep))
            {
                shards++;
                var p = Crack;
                DesertKit.Shards(p, Size);
                Fx.Burst(p, DesertKit.Sunfire, 8, 3f, 0.4f, 0.14f * Size, -2f);
                GameAudio.PlayAt("shield_break", p, 0.6f, 1.2f);
            }
        }

        /// <summary>死时整只陶身炸碎：三彩碎片四溅、日火冲天、地上留焦痕（静默清场不演）</summary>
        void OnShatter(DamageInfo info)
        {
            foreach (var (t, _, _) in crackFire) if (t) t.Set(0);
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            var c = transform.position + Vector3.up * 1.1f * Size;
            DesertKit.Shards(c, Size * 1.3f, 16);
            Fx.Burst(c, DesertKit.Sunfire, 20, 5f, 0.6f, 0.2f * Size, -3f);
            var ground = DesertKit.OnGround(transform.position);
            DesertKit.FlamePillar(ground, 0.8f * Size, 3.2f * Size);
            DesertKit.Scorch(ground, 1.6f * Size, 10f);
            // 陶身炸碎后地上的残焰（同 TS spawnGroundFlames）
            Fx.GroundFlames(ground, 1f * Size, 6, 2.5f, 0.5f * Size, CrackHot, CrackMid, CrackTip);
            GameAudio.PlayAt("shield_break", c, 1f, 0.7f);
            GameAudio.PlayAt("explosion", c, 0.7f, 0.8f);
            CameraShake.Quake(transform.position, 0.6f, 24f, 0.4f);
        }

        /// <summary>仰头长吼（头顶的位置出声）</summary>
        void Roar(float volume) => GameAudio.PlayAt("boss_roar", transform.position + (Vector3.up * 1.3f + transform.forward * 1.1f) * Size, volume, 0.75f);

        /// <summary>
        /// 落脚扬尘 + 轻微震地（Three.js footfall）：走动时每一步，越接近冲锋速度尘越大、震得越重（22 m 内感觉得到）
        /// </summary>
        void OnFootfall(int leg, Vector3 at)
        {
            var v = agent.velocity;
            v.y = 0;
            float sp = state == "charge" ? ChargeSpeed : v.magnitude;
            if (sp < 0.6f || Dead) return;
            float sn = Mathf.Clamp01((sp - moveSpeed) / (ChargeSpeed - moveSpeed));
            at.y = transform.position.y + 0.05f;
            ShotFx.Instance?.Impact(at, Vector3.up, false, (0.9f + 1.4f * sn) * Size);
            CameraShake.Quake(at, 0.05f + 0.1f * sn, 22f, 0.12f);
            GameAudio.PlayAt("footstep", at, 0.5f + 0.4f * sn, 0.45f);
        }

        /// <summary>釉甲格挡中：只有推进、两种蓄力时举着（同 Three.js guarding）；冲锋、撞晕、刹车、踏地后摇、被眩晕时不挡——那是反击窗口</summary>
        bool Guarding => !Dead && !Stunned && (state is "advance" or "chargeWindup" or "stompWindup");

        protected override bool DazeOverlay => state == "dazed";

        /// <summary>正面格挡：从前方 ±70° 打来 → 一成（斜着擦到背上的弱点也挡，×0.05）；持续伤害、反应不挡。挡住时脸上冒火星</summary>
        float Guard(DamageInfo info)
        {
            if (!Guarding || info.source == DamageSource.Status) return 1f;
            var dir = info.direction;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return 1f;
            if (Vector3.Dot(-dir.normalized, transform.forward) <= GuardCos) return 1f;
            if (Time.time - blockFxAt > 0.07f)
            {
                blockFxAt = Time.time;
                var p = transform.position + transform.forward * 1.2f * Size + Vector3.up * (0.7f + Random.value * 0.9f) * Size + transform.right * (Random.value - 0.5f) * 0.9f * Size;
                ShotFx.Instance?.Impact(p, transform.forward, false, 1.4f);
                GameAudio.PlayAt("shield_break", p, 0.4f, 2.1f);
            }
            return info.weakpoint ? GuardFactor * 0.5f : GuardFactor;
        }

        protected override void Think(float dt)
        {
            // 背上的龟裂只算从背后打来的弹（同格挡锥 ±70°）：命中判定的「进身体 1.5 m 内穿过弱点」会让正面瞄身体中心的弹穿到背上，等于不用绕背
            if (!crackGated && body.WeakZone)
            {
                body.WeakZone.facing = ZoneFacing.Back;
                body.WeakZone.facingCos = GuardCos;
                crackGated = true;
            }
            float d = DistToPlayer;
            chargeCd -= dt * auraAttackRate * (enraged ? 2 : 1);
            CheckShards();
            UpdateCrackFire(dt);
            float dy = Mathf.Abs(PlayerPos.y - transform.position.y);
            // 第一次看见玩家：仰头长吼
            if (!alerted && sees && d < 30)
            {
                alerted = true;
                Roar(0.7f);
            }
            if (!enraged && hp.Fraction < RageAt)
            {
                enraged = true;
                Roar(1f);
                ShotFx.Instance?.Impact(transform.position + Vector3.up * 1.5f * Size, Vector3.up, true, 6f);
                DesertKit.FlamePillar(Crack, 0.5f * Size, 2.6f * Size);
                CameraShake.Quake(transform.position, 0.35f, 28f, 0.5f);
            }
            float turn = TurnRate * (enraged ? 1.3f : 1f);
            Glow = state switch
            {
                "chargeWindup" or "stompWindup" => 0.5f + 0.5f * Mathf.Clamp01(stateTime / Mathf.Max(0.05f, windTime)),
                "charge" => 0.9f,
                "dazed" => 1f,
                "brake" => 0.7f,
                _ => (enraged ? 0.55f : 0.25f) + 0.1f * Mathf.Sin(age * 2),
            };
            switch (state)
            {
                case "advance":
                {
                    FacePlayer(turn, dt);
                    if (d <= StompRange * Size && dy <= 2f && cooldown <= 0)
                    {
                        BeginStomp();
                        break;
                    }
                    var to = PlayerPos - transform.position;
                    to.y = 0;
                    if (chargeCd <= 0 && d >= ChargeMin && d <= ChargeMax && sees && dy <= 1.5f && Vector3.Dot(transform.forward, to.normalized) > 0.85f)
                    {
                        BeginCharge(ChargeWindup);
                        break;
                    }
                    if (d > 2.4f * Size) MoveTo(PlayerPos, moveSpeed * (enraged ? 1.25f : 1f));
                    else Stop();
                    break;
                }
                case "chargeWindup":
                {
                    float t = Mathf.Clamp01(stateTime / windTime);
                    if (t < 0.6f)
                    {
                        FacePlayer(69, dt);
                        // 预警线跟着朝向调整（前 60% 还在瞄）
                        var from = transform.position + transform.forward * 1.2f * Size;
                        lane?.Move(from, from + transform.forward * ChargeLength, ChargeHalfWidth * 2 * Size);
                    }
                    chargeDir = transform.forward;
                    if (strike)
                    {
                        // 精英：压低、低头顶角，金点往角上收
                        strike.Charge(t, 0.12f, 7f);
                        Fx.EliteCharge(Horn, 1.4f * Size, t, dt);
                    }
                    // 刨地：每 0.3 s 扬一把沙、轻轻一震
                    if (t > 0.25f && Time.time - pawFxAt > 0.3f)
                    {
                        pawFxAt = Time.time;
                        ShotFx.Instance?.Impact(transform.position + transform.forward * 1.1f * Size, Vector3.up, false, 2.5f);
                        CameraShake.Quake(transform.position, 0.12f, 16f, 0.15f);
                        GameAudio.PlayAt("footstep", transform.position + transform.forward * 1.1f * Size, 0.8f, 0.5f);
                    }
                    if (stateTime >= windTime) StartCharge();
                    break;
                }
                case "charge":
                    ChargeStep(dt);
                    if (strike && state == "charge") Fx.EliteTrail(transform.position, chargeDir, Size, dt);
                    break;
                case "dazed":
                    // 撞晕：头顶冒金星（反击窗口，格挡已放下）
                    if (Time.time - dazeFxAt > 0.25f)
                    {
                        dazeFxAt = Time.time;
                        ShotFx.Instance?.Impact(transform.position + Vector3.up * 2f * Size + transform.forward * 0.8f * Size, Vector3.up, false, 0.8f);
                    }
                    if (stateTime >= DazedTime) EndCharge();
                    break;
                case "brake":
                {
                    float v = Mathf.Max(0, ChargeSpeed * (1 - stateTime / 0.35f));
                    SetManualVelocity(new Vector3(chargeDir.x * v, ManualVelocity.y, chargeDir.z * v));
                    // 刹车犁起的沙
                    if (stateTime < 0.35f && Time.time >= brakeFxAt)
                    {
                        brakeFxAt = Time.time + 0.08f;
                        Fx.Burst(transform.position + chargeDir * 1f * Size + Vector3.up * 0.05f, DesertKit.Dust, 6, 3f, 0.6f, 0.2f * Size, 6f);
                    }
                    if (stateTime >= BrakeTime)
                    {
                        if (recharge)
                        {
                            recharge = false;
                            EndManualMotion();
                            var to = PlayerPos - transform.position;
                            to.y = 0;
                            if (to.sqrMagnitude > 0.01f) transform.rotation = Quaternion.LookRotation(to);
                            BeginCharge(0.5f);
                        }
                        else EndCharge();
                    }
                    break;
                }
                case "stompWindup":
                    FacePlayer(115, dt);
                    // 精英：人立而起（后仰、拉高），金点往前爪收
                    if (strike)
                    {
                        float t = Mathf.Clamp01(stateTime / Mathf.Max(0.05f, windTime));
                        strike.Charge(t, -0.08f, -13f);
                        Fx.EliteCharge(transform.position + (transform.forward * 1f + Vector3.up * 0.8f) * Size, 1.2f * Size, t, dt);
                    }
                    if (stateTime >= windTime) Stomp();
                    break;
                case "stomp":
                    if (stateTime >= 0.2f) strike?.Relax();
                    if (stateTime >= 0.55f)
                    {
                        RollCooldown(2f, 2.8f);
                        PlayLocomotion();
                        SetState("advance");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("advance");
                    break;
            }
        }

        void BeginCharge(float windup)
        {
            windTime = Windup(windup, 0.45f);
            Stop();
            Roar(0.7f);
            PlayTimed("chargeWindup", windTime, 0.1f);
            strike ??= EliteStrike.For(this);
            if (strike) Fx.EliteCue(Horn, Size);
            SetState("chargeWindup");
            var from = transform.position + transform.forward * 1.2f * Size;
            lane = Telegraph.Line(from, from + transform.forward * ChargeLength, ChargeHalfWidth * 2 * Size, windTime + 0.3f, new Color(1f, 0.35f, 0.15f));
        }

        void StartCharge()
        {
            chargeDir = transform.forward;
            chargeDist = trailAt = 0;
            chargeHit = false;
            HitWall = false;
            BeginManualMotion(chargeDir * ChargeSpeed, 26f);
            Play("charge", 0.06f);
            SetState("charge");
            Charges++;
            Sfx("enemy_charge", 1f, 0.6f);
            CameraShake.Quake(transform.position, 0.3f, 20f, 0.25f);
            // 精英的释放帧：拉长前冲 + 顿帧 + 角前金色爆闪 + 加重一点震屏（同一帧）
            if (strike)
            {
                strike.Release(-0.12f, 9f, 0.06f);
                Fx.EliteRelease(Horn, chargeDir, Size * 1.2f);
                CameraShake.Quake(transform.position, 0.25f, 20f, 0.2f);
            }
        }

        void ChargeStep(float dt)
        {
            chargeDist += ChargeSpeed * dt;
            while (chargeDist - trailAt >= TrailStep)
            {
                trailAt += TrailStep;
                // 日火裂痕：FX4 日火地火（沙地上的金白裂缝 + 火苗）
                FloorFire.Spawn(transform.position, TrailRadius * Size, TrailTime, Damage * TrailMult, look: FireBed.Sunfire);
            }
            if (!chargeHit && player)
            {
                var v = PlayerPos - transform.position;
                float along = Vector3.Dot(v, chargeDir);
                var side = v - chargeDir * along;
                side.y = 0;
                if (along > -0.3f && along < 2.2f * Size && side.magnitude < ChargeHalfWidth * Size + 0.35f && v.y > -1 && v.y < 1.8f * Size)
                {
                    chargeHit = true;
                    if (HitTarget(Damage * ChargeMult, transform.position))
                    {
                        player.GetComponent<PlayerMotor>()?.AddImpulse(chargeDir * ChargeKnock + Vector3.up * 7f);
                        CameraShake.Add(0.9f, 0.4f);
                        GameAudio.PlayAt("boss_slam", PlayerPos, 0.8f, 1.3f);
                    }
                }
            }
            if (HitWall && stateTime > 0.15f)
            {
                // 撞墙：撞晕（反击窗口）
                SetManualVelocity(Vector3.zero);
                var at = transform.position + chargeDir * 1.5f * Size + Vector3.up * Size;
                ShotFx.Instance?.Impact(at, -chargeDir, false, 9f);
                ShotFx.Instance?.Impact(at + Vector3.up * 0.6f, -chargeDir, true, 4f);
                CameraShake.Quake(transform.position, 0.8f, 24f, 0.45f);
                GameAudio.PlayAt("boss_slam", at, 1f, 0.8f);
                GameAudio.PlayAt("shield_break", at, 0.7f, 0.9f);
                DesertKit.Shards(at, Size);
                // 背上的龟裂喷出日火柱（撞晕 = 反击窗口）
                DesertKit.FlamePillar(Crack, 0.45f * Size, 2.2f * Size);
                body.Rig?.Hit(-chargeDir, 1f);
                if (strike)
                {
                    // 精英撞墙：整只压扁一下、往后弹
                    strike.Kick(0.15f, -10f, 1f);
                    strike.Relax();
                }
                PlayLocomotion();
                SetState("dazed");
                return;
            }
            if (chargeDist >= ChargeLength || stateTime > ChargeLength / ChargeSpeed + 0.6f)
            {
                recharge = (elite || enraged) && !recharge;
                Play("brake", 0.06f);
                SetState("brake");
                // 精英刹车：往后一坐（惯性带着上身过冲），然后回正
                if (strike)
                {
                    strike.Kick(0.08f, -9f, 0.4f);
                    strike.Relax();
                }
            }
        }

        void EndCharge()
        {
            strike?.Relax();
            EndManualMotion();
            chargeCd = Random.Range(5f, 7f);
            PlayLocomotion();
            SetState("advance");
        }

        void BeginStomp()
        {
            windTime = Windup(StompWindup, 0.5f);
            Stop();
            PlayTimed("stompWindup", windTime, 0.08f);
            strike ??= EliteStrike.For(this);
            if (strike) Fx.EliteCue(transform.position + (transform.forward * 1f + Vector3.up * 1.2f) * Size, Size);
            Sfx("telegraph", 0.8f, 0.5f);
            Telegraph.Circle(transform.position, WaveRadius, windTime, new Color(1f, 0.5f, 0.2f, 0.6f));
            SetState("stompWindup");
        }

        void Stomp()
        {
            Play("stomp", 0.04f);
            SetState("stomp");
            // 双前爪砸在身前 1 m（同 TS localPoint(0, 0, 1)）
            var ground = DesertKit.OnGround(transform.position + transform.forward * 1f * Size);
            if (Taunted) DecoyBlocked(Target);
            else Spiritfire.Game.Blast.Player(ground + Vector3.up * 0.6f, StompCore * Size, Damage, Element.None, this, 0.7f, 0f, CoreKnock);
            CameraShake.Quake(transform.position, 0.9f, 26f, 0.45f);
            GameAudio.PlayAt("boss_slam", ground, 1f, 0.7f);
            GameAudio.PlayAt("explosion", ground, 0.5f, 0.6f);
            ShotFx.Instance?.Impact(ground, Vector3.up, false, 8f);
            Fx.Burst(ground, DesertKit.Dust, 26, 7f, 0.9f, 0.3f * Size, 10f);
            DesertKit.Shards(ground, Size * 0.8f, 6);
            DesertKit.FlamePillar(ground, 0.6f * Size, 2f * Size);
            DesertKit.Scorch(ground, StompCore * Size, 7f);
            DesertKit.FireRing(ground, WaveRadius);
            // 精英的释放帧：砸下去压扁前冲 + 顿帧 + 一圈金环、崩起石块 + 加重震屏（同一帧）
            if (strike)
            {
                strike.Release(0.14f, 10f, 0.07f);
                Fx.EliteSlam(ground, StompCore * Size * 2f);
                CameraShake.Quake(transform.position, 0.35f, 26f, 0.3f);
            }
            // 冲击波：数值见 StompWave（EditMode 测试锁着），往外推的击退在这里补上（同 TS WAVE_KNOCK）
            var wave = StompWave(transform.position, Size, Damage, this);
            wave.knockback = WaveKnock;
            wave.knockUp = WaveKnockUp;
            GroundWave.Spawn(wave);
        }

        /// <summary>
        /// 踏地冲击波（E4 起交给 <see cref="GroundWave"/>，数值同抽出之前）：波心在脚下，9 m、16 m/s，环带 ±0.7 m（前沿多走 1 m 才结束），
        /// 爆心 1.6 × 体型以内不吃，玩家贴地、高差 ±1.2 m 才吃 ×0.7（跳起来躲开），不挡；出手者被嘲讽期间不伤玩家。
        /// 这里不带击退（测试锁着这份数值），<see cref="Stomp"/> 出手时再补 <see cref="WaveKnock"/> / <see cref="WaveKnockUp"/>
        /// </summary>
        public static GroundWave.Spec StompWave(Vector3 center, float size, float damage, EnemyAI owner) =>
            new(center, WaveRadius, WaveSpeed, damage * WaveMult)
            {
                width = 1.4f,
                overshoot = 1f,
                innerRadius = StompCore * size,
                minRise = -1.2f,
                maxRise = 1.2f,
                needGrounded = true,
                color = new Color(1f, 0.75f, 0.4f),
                owner = owner,
            };
    }
}
