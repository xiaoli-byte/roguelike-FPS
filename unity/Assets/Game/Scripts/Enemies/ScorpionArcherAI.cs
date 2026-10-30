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
    ///   钳击：1.8 m 内，前摇 0.35 s（巨钳发光，通道 2），伤害 ×1.4
    ///   寻视线（同 TS seekSight）：连续 0.4 s 看不见玩家就去玩家 10–22 m 环带里一个看得见的站位（<see cref="SightSeeker"/>）；上弦时看不见超过 0.35 s 就收弦
    ///   读招：上弦最后 0.15 s 弩尖金光一闪（同 TS）；弩矢是「arrow」外观（金色箭杆 + 拖尾）
    ///   遁沙：沉沙 / 钻出时扬沙，沙下潜行每 0.6 m 落一段沙痕（3 s 后抹平）+ 沙浪；钻出近处（8 m 内）震屏 0.18
    ///   被打断（眩晕 / 玩家阵亡 / 清场）：立刻钻回地面（修掉了玩家阵亡时卡在沙下隐身的问题），冷却重摇 1.2–2 s
    ///   精英的出手分量（docs/art/vfx/elites-ch1.md，数值 / 时机不变）：上弦一开始弩口一颗金芒（<see cref="Fx.EliteCue"/>），上弦时压低后仰拉弦
    ///     （<see cref="EliteStrike.Charge"/>），后半段弩口沿五支的扇形甩金色弦光（<see cref="Fx.EliteVolleyRays"/>：读得出五支、扇形）；
    ///     第一发是释放帧（拉长前冲 + 顿帧 + 金色爆闪），之后每一发弩口金星、身子被后坐踢一下；钳击同样蓄力 / 释放
    /// </summary>
    public sealed class ScorpionArcherAI : EnemyAI
    {
        const float MinRange = 12, MaxRange = 22, AimTime = 0.6f, AmbushAim = 0.42f, ShotGap = 0.16f, BoltSpeed = 30;
        const float BurrowTrigger = 7, DiveTime = 0.55f, TunnelSpeed = 10, TunnelMax = 2.6f, EmergeTime = 0.5f, EmergeRadius = 1.5f;
        const float SnapRange = 1.8f, SnapWindup = 0.35f, SnapMult = 1.4f, SinkDepth = 1.8f;

        float burrowCd, aimTime, recoverTime, shotTimer, strafeTimer, strafeSign = 1, blindTime, sprayAt;
        int shots;
        bool flashed;
        Vector3 lastFurrow;
        readonly SightSeeker seeker = new();

        /// <summary>累计：射出的弩矢、钻沙几次、寻视线挪过几次站位（测试用）</summary>
        public int BoltsFired { get; private set; }
        public int Burrows { get; private set; }
        public int SightMoves { get; private set; }
        bool snapHit, emergeHit, ambush;
        /// <summary>精英的出手分量层（普通的为 null）</summary>
        EliteStrike strike;
        /// <summary>精英齐射扇形相邻两支的夹角（弧度，和 FireBolt 里一致）</summary>
        const float FanStep = 0.09f;
        Vector3 tunnelTarget;
        Transform model;
        float sink;

        protected override string InitialState => "move";

        protected override void Awake()
        {
            base.Awake();
            model = anim ? anim.transform : null;
            burrowCd = Random.Range(2f, 4f);
            GlowStyle(0.06f, 0.03f, 2.6f, 0.55f);
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name.EndsWith("crossbow")) { crossbow = t; break; }
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            if (burrowCd > 0) burrowCd -= dt;
            blindTime = sees ? 0 : blindTime + dt;
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(1.8f, 3.2f);
                strafeSign = -strafeSign;
            }
            switch (state)
            {
                case "move":
                    Glow = 0.25f + 0.1f * Mathf.Sin(age * 2.6f);
                    if (burrowCd <= 0 && d < BurrowTrigger && FindExit(out tunnelTarget))
                    {
                        Stop();
                        Sfx("telegraph", 0.55f, 0.7f);
                        Play("dive", 0.06f);
                        SetState("dive");
                        break;
                    }
                    if (d < SnapRange * Size && cooldown <= 0.6f && RequestAttack(AttackTokens.Kind.Melee, SnapWindup + 0.6f))
                    {
                        snapHit = false;
                        strike ??= EliteStrike.For(this);
                        if (strike) Fx.EliteCue(transform.position + (transform.forward * 1.1f + Vector3.up * 0.9f) * Size, Size * 0.7f);
                        Sfx("telegraph", 0.6f, 1.3f);
                        Stop();
                        PlayTimed("snapWindup", Windup(SnapWindup, 0.2f), 0.06f);
                        SetState("snapWindup");
                        break;
                    }
                    // 寻视线：看不见玩家时去一个看得见的站位
                    var q = new SightQuery(PlayerPos, PlayerEye, transform.position, MinRange - 2, MaxRange, 1.6f * Size);
                    if (seeker.Tick(sees, dt, q))
                    {
                        if (seeker.HasSpot)
                        {
                            MoveTo(seeker.Spot, moveSpeed);
                            if (seeker.Arrived(transform.position))
                            {
                                seeker.Reached();
                                SightMoves++;
                            }
                        }
                        else MoveTo(PlayerPos, moveSpeed);
                        FaceMovement(290, dt);
                        break;
                    }
                    KeepRange(MinRange, MaxRange, d < MinRange ? moveSpeed * 1.3f : moveSpeed, strafeSign);
                    FaceAimTravel(200, dt);
                    if (cooldown <= 0 && sees && d <= MaxRange + 8) BeginAim(AimTime, false);
                    break;
                case "aim":
                    Glow = 0.35f + 0.65f * Mathf.Clamp01(stateTime / Mathf.Max(0.05f, aimTime));
                    Stop();
                    FacePlayer(290, dt);
                    if (strike)
                    {
                        // 精英：压低后仰拉弦，后半段弩口甩出五道金色弦光
                        float u = Mathf.Clamp01(stateTime / Mathf.Max(0.05f, aimTime));
                        strike.Charge(u, 0.08f, -9f);
                        if (u > 0.45f) Fx.EliteVolleyRays(Muzzle(), PlayerPos - transform.position, FanStep, 5, (u - 0.45f) / 0.55f, dt);
                    }
                    // 弩尖金光一闪：还有 0.15 s 就放箭
                    if (!flashed && stateTime >= aimTime - 0.15f)
                    {
                        flashed = true;
                        var m = Muzzle();
                        Fx.Burst(m, Hex.Rgb(0xfff2c0), 6, 1.2f, 0.2f, 0.09f * Size, 0);
                        Fx.Flash(m, Hex.Rgb(0xffd27a), 3f, 3f, 0.12f);
                    }
                    if (!sees && blindTime > 0.35f)
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
                        // 精英的释放帧：拉长前冲 + 顿帧 + 金色爆闪（和第一发同一帧）
                        if (strike)
                        {
                            strike.Release(-0.1f, 7f, 0.05f);
                            Fx.EliteRelease(Muzzle(), PlayerPos + Vector3.up * 1.1f - Muzzle(), Size * 0.8f);
                        }
                    }
                    break;
                case "fire":
                {
                    Glow = 1;
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
                    Spray(stateTime < 0.35f ? 0.04f : 0.1f, 3);
                    if (stateTime >= DiveTime)
                    {
                        sink = 1;
                        SetModelVisible(false);
                        lastFurrow = transform.position;
                        Burrows++;
                        SetState("tunnel");
                    }
                    break;
                case "tunnel":
                    MoveTo(tunnelTarget, TunnelSpeed);
                    FaceMovement(570, dt);
                    // 沙浪 + 沙痕（同 TS：每 0.07 s 一团沙；沙痕是 Unity 补的，地上看得出它往哪钻）
                    if (Time.time >= sprayAt)
                    {
                        sprayAt = Time.time + 0.07f;
                        Fx.Burst(transform.position + Vector3.up * 0.15f, DesertKit.Sand, 3, 1.6f, 0.5f, 0.32f * Size, -3f);
                    }
                    if ((transform.position - lastFurrow).sqrMagnitude > 0.36f)
                    {
                        lastFurrow = transform.position;
                        DesertKit.Furrow(transform.position, 0.5f * Size, 3f);
                    }
                    var flat = tunnelTarget - transform.position;
                    flat.y = 0;
                    if (flat.magnitude < 1f || stateTime >= TunnelMax)
                    {
                        Stop();
                        SetModelVisible(true);
                        Sfx("telegraph", 0.7f, 0.5f);
                        Play("emerge", 0.05f);
                        Telegraph.Circle(transform.position, EmergeRadius * Size, EmergeTime, new Color(0.9f, 0.75f, 0.45f));
                        Fx.Ring(transform.position + Vector3.up * 0.08f, EmergeRadius * Size, DesertKit.SandLight, 0.4f);
                        emergeHit = false;
                        SetState("emerge");
                    }
                    break;
                case "emerge":
                    FacePlayer(460, dt);
                    sink = 1 - Smooth(stateTime / EmergeTime);
                    if (stateTime < 0.3f) Spray(0.04f, 4);
                    if (!emergeHit && stateTime >= 0.18f)
                    {
                        emergeHit = true;
                        Burst(transform.position, EmergeRadius * Size, Damage * 0.8f);
                        ShotFx.Instance?.Impact(transform.position, Vector3.up, false, 4f);
                        if (d < 8) CameraShake.Add(0.18f, 0.25f);
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
                    SetGlow(2, Mathf.Clamp01(stateTime / SnapWindup));
                    strike?.Charge(stateTime / Mathf.Max(0.05f, Windup(SnapWindup, 0.2f)), 0.1f, -10f);
                    if (stateTime >= Windup(SnapWindup, 0.2f))
                    {
                        Play("snap", 0.04f);
                        SetState("snap");
                        if (strike)
                        {
                            strike.Release(-0.08f, 11f, 0.05f);
                            Fx.EliteRelease(transform.position + (transform.forward * 1.1f + Vector3.up * 0.9f) * Size, transform.forward, Size * 0.8f);
                        }
                    }
                    break;
                case "snap":
                    SetGlow(2, 0);
                    if (!snapHit && stateTime >= 0.06f)
                    {
                        snapHit = true;
                        Melee(SnapRange * Size, Damage * SnapMult, 0.3f);
                    }
                    if (stateTime >= 0.25f)
                    {
                        recoverTime = 0.5f;
                        SetState("recover");
                    }
                    break;
                case "recover":
                    Glow = 0.25f;
                    strike?.Relax();
                    KeepRange(MinRange, MaxRange, moveSpeed * 0.6f, strafeSign);
                    FaceAimTravel(230, dt, 0.35f);
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
            // 模型是子物体：局部位移已随根节点缩放，SinkDepth 是设计尺寸下的深度，不再乘体型
            if (model) model.localPosition = new Vector3(0, -sink * SinkDepth, 0);
            // 遁地：大半截身子进沙里才打不到（露在外面的部分一直能打），钻出来一冒头就能打；
            // 完全在地下时关掉碰撞体，免得看不见的身体挡子弹 / 挡路
            if (state is "dive" or "tunnel" or "emerge")
            {
                hp.untargetable = sink > 0.8f;
                SetColliders(sink < 0.99f);
            }
        }

        protected override void OnStunned() => Resurface();

        /// <summary>钻沙途中被定住 / 打断：钻回地面上</summary>
        void Resurface()
        {
            sink = 0;
            if (model) model.localPosition = Vector3.zero;
            SetModelVisible(true);
            SetColliders(true);
            hp.untargetable = false;
        }

        /// <summary>同 TS cancelAttack：潜沙途中被打断（玩家阵亡、清场、坠落回收）立刻回到地面；冷却重摇</summary>
        protected override void CancelAttack()
        {
            strike?.Relax();
            if (state is "dive" or "tunnel" or "emerge") Resurface();
            SetGlow(2, 0);
            ambush = false;
            if (state is not "move" and not IdleState) RollCooldown(1.2f, 2f);
        }

        void Spray(float every, int count)
        {
            if (Time.time < sprayAt) return;
            sprayAt = Time.time + every;
            DesertKit.SandSpray(transform.position, count, Size);
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
            flashed = false;
            Sfx("telegraph", 0.5f, 1.6f);
            // 精英：上弦一开始弩口一颗金芒（要出五连了）
            strike ??= EliteStrike.For(this);
            if (strike) Fx.EliteCue(Muzzle(), Size * 0.7f);
            Stop();
            PlayTimed("aim", aimTime, 0.08f);
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
            GameAudio.PlayAt("enemy_shot", from, 0.6f);
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
            // 金色弩矢（arrow 外观：箭杆 + 箭头 + 拖尾，同 TS visual: 'arrow'）
            EnemyProjectile.Spawn(new EnemyProjectileSpec(from, dir * BoltSpeed, Damage, 0.14f, 3f)
            {
                color = Hex.Rgb(0xffd27a), visual = "arrow", scale = 1.3f, source = this, spirit = Taunted,
            });
            BoltsFired++;
            // 精英：每一发弩口金星 + 后坐踢一下（第一发是释放帧，已经打满了）
            if (strike)
            {
                Fx.EliteMuzzle(from, dir);
                if (index > 0) strike.Kick(-0.03f, -3f, 0.7f);
            }
        }

        /// <summary>钻出点：玩家 13–20 m 外、可走、从那里看得见玩家</summary>
        bool FindExit(out Vector3 exit)
        {
            for (int i = 0; i < 12; i++)
            {
                float a = Random.value * Mathf.PI * 2, r = Random.Range(13f, 20f);
                var p = PlayerPos + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * r;
                if (!NavMesh.SamplePosition(p, out var hit, 2f, NavMesh.AllAreas)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.6f * Size, PlayerEye, null)) continue;
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
