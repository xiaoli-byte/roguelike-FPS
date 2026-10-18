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
    ///   踏地：3.6 m 内，蓄力 0.7 s → 中心 1.6 m 伤害 ×1.0 + 9 m 外扩冲击波（16 m/s，贴地才吃，跳起可躲，×0.7）
    ///   狂暴：生命低于 40% → 移速 ×1.25、冲锋冷却减半、一次冲两趟
    /// </summary>
    public sealed class TombBeastAI : EnemyAI
    {
        const float GuardFactor = 0.1f, GuardCos = 0.34f, TurnRate = 80f;
        const float ChargeMin = 7, ChargeMax = 20, ChargeWindup = 1f, ChargeSpeed = 15, ChargeLength = 20, ChargeHalfWidth = 0.9f;
        const float ChargeMult = 1.4f, ChargeKnock = 16, DazedTime = 1.8f, BrakeTime = 0.9f;
        const float TrailStep = 1.4f, TrailRadius = 0.6f, TrailTime = 3f, TrailMult = 0.15f;
        const float StompRange = 3.6f, StompWindup = 0.7f, StompCore = 1.6f, WaveRadius = 9, WaveSpeed = 16, WaveMult = 0.7f, RageAt = 0.4f;

        float chargeCd = 2f, windTime, chargeDist, trailAt;
        bool enraged, chargeHit, recharge;
        Vector3 chargeDir;
        // 踏地冲击波
        bool waveActive, waveHit;
        float waveStart;
        Vector3 waveCenter;

        protected override string InitialState => "advance";

        protected override void Awake()
        {
            base.Awake();
            hp.incomingModifier = Guard;
        }

        /// <summary>正面格挡：子弹方向与朝向相对（从前方打来）→ 一成；持续伤害不挡</summary>
        float Guard(DamageInfo info)
        {
            if (info.source == DamageSource.Status || info.weakpoint) return 1f;
            var dir = info.direction;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return 1f;
            return Vector3.Dot(-dir.normalized, transform.forward) > GuardCos ? GuardFactor : 1f;
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            chargeCd -= dt * auraAttackRate * (enraged ? 2 : 1);
            if (!enraged && hp.Fraction < RageAt)
            {
                enraged = true;
                ShotFx.Instance?.Impact(transform.position + Vector3.up * 1.5f, Vector3.up, true, 6f);
            }
            UpdateWave();
            float turn = TurnRate * (enraged ? 1.3f : 1f);
            switch (state)
            {
                case "advance":
                {
                    FacePlayer(turn, dt);
                    if (d <= StompRange && cooldown <= 0)
                    {
                        BeginStomp();
                        break;
                    }
                    var to = PlayerPos - transform.position;
                    to.y = 0;
                    if (chargeCd <= 0 && d >= ChargeMin && d <= ChargeMax && sees && Vector3.Dot(transform.forward, to.normalized) > 0.85f)
                    {
                        BeginCharge(ChargeWindup);
                        break;
                    }
                    if (d > 2.6f) MoveTo(PlayerPos, moveSpeed * (enraged ? 1.25f : 1f));
                    else Stop();
                    break;
                }
                case "chargeWindup":
                {
                    float t = Mathf.Clamp01(stateTime / windTime);
                    if (t < 0.6f) FacePlayer(69, dt);
                    chargeDir = transform.forward;
                    if (Random.value < dt * 3.3f) ShotFx.Instance?.Impact(transform.position + transform.forward * 1.1f, Vector3.up, false, 2.5f);
                    if (stateTime >= windTime) StartCharge();
                    break;
                }
                case "charge":
                    ChargeStep(dt);
                    break;
                case "dazed":
                    if (stateTime >= DazedTime) EndCharge();
                    break;
                case "brake":
                {
                    float v = Mathf.Max(0, ChargeSpeed * (1 - stateTime / 0.35f));
                    SetManualVelocity(new Vector3(chargeDir.x * v, ManualVelocity.y, chargeDir.z * v));
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
                    if (stateTime >= windTime) Stomp();
                    break;
                case "stomp":
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
            Play("chargeWindup", 0.1f);
            SetState("chargeWindup");
            var from = transform.position + transform.forward * 1.2f;
            Telegraph.Line(from, from + transform.forward * ChargeLength, ChargeHalfWidth * 2, windTime + 0.3f, new Color(1f, 0.35f, 0.15f));
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
        }

        void ChargeStep(float dt)
        {
            chargeDist += ChargeSpeed * dt;
            while (chargeDist - trailAt >= TrailStep)
            {
                trailAt += TrailStep;
                FireZone.Spawn(transform.position, TrailRadius, TrailTime, Damage * TrailMult);
            }
            if (!chargeHit && player)
            {
                var v = PlayerPos - transform.position;
                float along = Vector3.Dot(v, chargeDir);
                var side = v - chargeDir * along;
                side.y = 0;
                if (along > -0.3f && along < 2.4f && side.magnitude < ChargeHalfWidth + 0.35f && v.y > -1 && v.y < 2.2f)
                {
                    chargeHit = true;
                    if (Combat.DamagePlayer(Damage * ChargeMult, transform.position) > 0)
                        player.GetComponent<PlayerMotor>()?.AddImpulse(chargeDir * ChargeKnock + Vector3.up * 7f);
                }
            }
            if (HitWall && stateTime > 0.15f)
            {
                // 撞墙：撞晕（反击窗口）
                SetManualVelocity(Vector3.zero);
                ShotFx.Instance?.Impact(transform.position + chargeDir * 1.5f + Vector3.up, -chargeDir, false, 6f);
                body.Rig?.Hit(-chargeDir, 1f);
                PlayLocomotion();
                SetState("dazed");
                return;
            }
            if (chargeDist >= ChargeLength)
            {
                recharge = enraged && !recharge;
                Play("brake", 0.06f);
                SetState("brake");
            }
        }

        void EndCharge()
        {
            EndManualMotion();
            chargeCd = Random.Range(5f, 7f);
            PlayLocomotion();
            SetState("advance");
        }

        void BeginStomp()
        {
            windTime = Windup(StompWindup, 0.5f);
            Stop();
            Play("stompWindup", 0.08f);
            Telegraph.Circle(transform.position, WaveRadius, windTime, new Color(1f, 0.5f, 0.2f, 0.6f));
            SetState("stompWindup");
        }

        void Stomp()
        {
            Play("stomp", 0.04f);
            SetState("stomp");
            Burst(transform.position, StompCore, Damage);
            ShotFx.Instance?.Impact(transform.position, Vector3.up, false, 8f);
            Telegraph.Wave(transform.position, WaveRadius, WaveSpeed, new Color(1f, 0.75f, 0.4f));
            waveActive = true;
            waveHit = false;
            waveStart = Time.time;
            waveCenter = transform.position;
        }

        /// <summary>冲击波：环经过玩家时，玩家贴地就吃 ×0.7（跳起来躲开）</summary>
        void UpdateWave()
        {
            if (!waveActive) return;
            float r = (Time.time - waveStart) * WaveSpeed;
            if (r > WaveRadius + 1)
            {
                waveActive = false;
                return;
            }
            if (waveHit || !player) return;
            var to = PlayerPos - waveCenter;
            float dy = to.y;
            to.y = 0;
            float dist = to.magnitude;
            if (dist <= StompCore || Mathf.Abs(dist - r) > 0.7f) return;
            var motor = player.GetComponent<PlayerMotor>();
            if (motor && !motor.Grounded) return;
            if (Mathf.Abs(dy) > 1.2f) return;
            waveHit = true;
            Combat.DamagePlayer(Damage * WaveMult, waveCenter);
        }
    }
}
