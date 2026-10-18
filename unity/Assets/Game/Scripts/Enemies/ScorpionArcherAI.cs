using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蝎尾弩卫（Three.js 版 src/enemies/types/ScorpionArcher.ts）：远程压制。
    ///   站位：保持 12–22 m，横走、正面始终对着玩家；看不见玩家时找能看见的位置
    ///   射击：上弦 0.6 s（拿远程名额）→ 3 支弩箭 30 m/s、间隔 0.16 s、预判 35%（精英 5 支扇形）
    ///   钻沙：玩家逼近到 7 m 内 → 钻入 0.55 s → 沙下潜行到玩家 13–20 m 外、看得见玩家的点（10 m/s）
    ///         → 钻出 0.5 s（1.5 m 内掀沙伤害 ×0.8）→ 伏击上弦 0.42 s（不占名额）。冷却 9–12 s
    ///         只有沉下去八成以上才不可选中（看得见的部分就打得到），完全在地下时碰撞体关闭
    ///   钳击：1.8 m 内，前摇 0.35 s，伤害 ×1.4
    /// </summary>
    public sealed class ScorpionArcherAI : EnemyAI
    {
        const float MinRange = 12, MaxRange = 22, AimTime = 0.6f, AmbushAim = 0.42f, ShotGap = 0.16f, BoltSpeed = 30;
        const float BurrowTrigger = 7, DiveTime = 0.55f, TunnelSpeed = 10, TunnelMax = 2.6f, EmergeTime = 0.5f, EmergeRadius = 1.5f;
        const float SnapRange = 1.8f, SnapWindup = 0.35f, SnapMult = 1.4f, SinkDepth = 1.8f;

        float burrowCd, aimTime, recoverTime, shotTimer, strafeTimer, strafeSign = 1;
        int shots;
        bool snapHit, emergeHit, ambush;
        Vector3 tunnelTarget;
        Transform model;
        float sink;

        protected override string InitialState => "move";

        protected override void Awake()
        {
            base.Awake();
            model = anim ? anim.transform : null;
            burrowCd = Random.Range(2f, 4f);
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name.EndsWith("crossbow")) { crossbow = t; break; }
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            if (burrowCd > 0) burrowCd -= dt;
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(1.8f, 3.2f);
                strafeSign = -strafeSign;
            }
            switch (state)
            {
                case "move":
                    if (burrowCd <= 0 && d < BurrowTrigger && FindExit(out tunnelTarget))
                    {
                        Stop();
                        Play("dive", 0.06f);
                        SetState("dive");
                        break;
                    }
                    if (d < SnapRange && cooldown <= 0.6f && RequestAttack(AttackTokens.Kind.Melee, SnapWindup + 0.6f))
                    {
                        snapHit = false;
                        Stop();
                        Play("snapWindup", 0.06f);
                        SetState("snapWindup");
                        break;
                    }
                    KeepRange(MinRange, MaxRange, d < MinRange ? moveSpeed * 1.3f : moveSpeed, strafeSign);
                    FacePlayer(200, dt);
                    if (cooldown <= 0 && sees && d <= MaxRange + 8) BeginAim(AimTime, false);
                    break;
                case "aim":
                    Stop();
                    FacePlayer(290, dt);
                    if (!sees && stateTime > 0.35f && !ambush)
                    {
                        ReleaseAttack();
                        RollCooldown(0.8f, 1.4f);
                        PlayLocomotion();
                        SetState("move");
                        break;
                    }
                    if (stateTime >= aimTime)
                    {
                        shots = 0;
                        shotTimer = 0;
                        Play("fire", 0.04f);
                        SetState("fire");
                    }
                    break;
                case "fire":
                {
                    FacePlayer(340, dt);
                    int total = elite ? 5 : 3;
                    shotTimer -= dt;
                    if (shotTimer <= 0 && shots < total)
                    {
                        FireBolt(shots, total);
                        shots++;
                        shotTimer = ShotGap / Mathf.Sqrt(auraAttackRate);
                    }
                    if (shots >= total && shotTimer <= 0)
                    {
                        recoverTime = 0.4f;
                        SetState("recover");
                    }
                    break;
                }
                case "dive":
                    sink = Smooth(stateTime / DiveTime);
                    if (stateTime >= DiveTime)
                    {
                        sink = 1;
                        SetModelVisible(false);
                        SetState("tunnel");
                    }
                    break;
                case "tunnel":
                    MoveTo(tunnelTarget, TunnelSpeed);
                    FaceMovement(570, dt);
                    if (Random.value < dt * 14f) ShotFx.Instance?.Impact(transform.position + Vector3.up * 0.1f, Vector3.up, false, 1.2f);
                    var flat = tunnelTarget - transform.position;
                    flat.y = 0;
                    if (flat.magnitude < 1f || stateTime >= TunnelMax)
                    {
                        Stop();
                        SetModelVisible(true);
                        Play("emerge", 0.05f);
                        Telegraph.Circle(transform.position, EmergeRadius, EmergeTime, new Color(0.9f, 0.75f, 0.45f));
                        emergeHit = false;
                        SetState("emerge");
                    }
                    break;
                case "emerge":
                    FacePlayer(460, dt);
                    sink = 1 - Smooth(stateTime / EmergeTime);
                    if (!emergeHit && stateTime >= 0.18f)
                    {
                        emergeHit = true;
                        Burst(transform.position, EmergeRadius, Damage * 0.8f);
                        ShotFx.Instance?.Impact(transform.position, Vector3.up, false, 4f);
                    }
                    if (stateTime >= EmergeTime)
                    {
                        sink = 0;
                        burrowCd = Random.Range(9f, 12f);
                        ambush = true;
                        BeginAim(AmbushAim, true);
                    }
                    break;
                case "snapWindup":
                    FacePlayer(400, dt);
                    if (stateTime >= Windup(SnapWindup, 0.2f))
                    {
                        Play("snap", 0.04f);
                        SetState("snap");
                    }
                    break;
                case "snap":
                    if (!snapHit && stateTime >= 0.06f)
                    {
                        snapHit = true;
                        Melee(SnapRange, Damage * SnapMult, 0.3f);
                    }
                    if (stateTime >= 0.25f)
                    {
                        recoverTime = 0.5f;
                        SetState("recover");
                    }
                    break;
                case "recover":
                    KeepRange(MinRange, MaxRange, moveSpeed * 0.6f, strafeSign);
                    FacePlayer(230, dt);
                    if (stateTime >= recoverTime / Mathf.Sqrt(auraAttackRate))
                    {
                        ReleaseAttack();
                        ambush = false;
                        if (cooldown <= 0.5f) RollCooldown(2.4f, 3.6f);
                        PlayLocomotion();
                        SetState("move");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("move");
                    break;
            }
            if (model) model.localPosition = new Vector3(0, -sink * SinkDepth * transform.localScale.y, 0);
            // 遁地：大半截身子进沙里才打不到（露在外面的部分一直能打），钻出来一冒头就能打；
            // 完全在地下时关掉碰撞体，免得看不见的身体挡子弹 / 挡路
            if (state is "dive" or "tunnel" or "emerge")
            {
                hp.untargetable = sink > 0.8f;
                SetColliders(sink < 0.99f);
            }
        }

        void SetColliders(bool on)
        {
            foreach (var c in GetComponents<Collider>()) c.enabled = on;
            if (body.WeakPoint) body.WeakPoint.gameObject.SetActive(on);
        }

        void BeginAim(float time, bool free)
        {
            if (!free && !RequestAttack(AttackTokens.Kind.Ranged, time + 3 * ShotGap + 0.6f))
            {
                cooldown = Random.Range(0.4f, 0.9f);
                return;
            }
            aimTime = Windup(time, 0.3f);
            Stop();
            Play("aim", 0.08f);
            SetState("aim");
        }

        Transform crossbow;

        /// <summary>弩尖：crossbow 骨骼往前 0.8 m（美术 2 m 版的骨长，随体型缩放）</summary>
        Vector3 Muzzle()
        {
            if (crossbow) return crossbow.position + transform.forward * 0.8f * transform.localScale.x;
            if (body.WeakPoint) return body.WeakPoint.position + transform.forward * 0.5f + Vector3.up * 0.15f;
            return transform.position + Vector3.up * 1.8f + transform.forward * 0.6f;
        }

        void FireBolt(int index, int total)
        {
            var from = Muzzle();
            var chest = PlayerPos + Vector3.up * 1.1f;
            float flight = Vector3.Distance(from, chest) / BoltSpeed;
            Vector3 target;
            if (total > 3)
            {
                // 精英五支扇形：以玩家为中心左右展开，不预判
                float fan = (index - (total - 1) / 2f) * 0.09f;
                var to = chest - from;
                target = from + Quaternion.AngleAxis(fan * Mathf.Rad2Deg, Vector3.up) * to;
            }
            else target = PredictPlayer(flight * 0.35f) + Vector3.up * 1.1f;
            var dir = (target - from).normalized;
            dir = Quaternion.Euler(Random.Range(-0.7f, 0.7f), Random.Range(-0.7f, 0.7f), 0) * dir;
            EnemyProjectile.Spawn(from, dir * BoltSpeed, 0, Damage, 0.14f, 0, new Color(1f, 0.82f, 0.48f), 3f);
        }

        /// <summary>钻出点：玩家 13–20 m 外、可走、从那里看得见玩家</summary>
        bool FindExit(out Vector3 exit)
        {
            for (int i = 0; i < 12; i++)
            {
                float a = Random.value * Mathf.PI * 2, r = Random.Range(13f, 20f);
                var p = PlayerPos + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * r;
                if (!NavMesh.SamplePosition(p, out var hit, 2f, NavMesh.AllAreas)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.6f, PlayerEye, null)) continue;
                exit = hit.position;
                return true;
            }
            exit = transform.position;
            return false;
        }

        void SetModelVisible(bool on)
        {
            if (!model) return;
            foreach (var r in model.GetComponentsInChildren<Renderer>()) r.enabled = on;
        }

        static float Smooth(float t)
        {
            t = Mathf.Clamp01(t);
            return t * t * (3 - 2 * t);
        }
    }
}
