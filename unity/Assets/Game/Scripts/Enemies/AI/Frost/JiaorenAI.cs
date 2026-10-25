using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冻鲛人（Three.js 版 src/enemies/types/Jiaoren.ts）：第二章群怪，先远投骨矛，再成群突刺。
    ///   投矛：10–18 m、看得见时举矛过肩 0.5 s（拿远程名额，鲛珠与矛头亮起）→ 24 m/s 低弧线骨矛（重力 4，只预判一半移动：横移能躲），
    ///         骨矛走敌方投射物（可被挡弹区挡下）。投完手里空了，5 s 后掌心重新冻出一支（最后 0.6 s 从掌心长出来）。
    ///   围拢：有矛又没接战时守 10–18 m 投矛带横移；投过矛、或被贴到 7 m 内就算接战（拉开到 20 m 外才解除），绕着玩家在 2.5–4.5 m 打转合围。
    ///   群刺：6.5 m 内凑够 3 只（精英带队 2 只）能出手的鲛人（<see cref="PackCoordinator"/>，同一群 4.5 s 内只发起一次）：
    ///         由近到远依次错开 0.12 s 压低身子 0.45 s，朝玩家当时的位置（预判 0.15 s）贴地突刺 11 m/s × 0.42 s，打中 ×0.85；收势 0.7 s（输出窗口）。
    ///         个人冷却 5–7 s。群刺不占出手名额（同 TS）。
    ///   戳刺：贴身 1.95 m 内快戳一下（0.35 s 前摇，近战名额，×0.7）。
    ///   鲛珠：死时额头的鲛珠蹦出来滚一小段，0.8 s 后变成小回复（玩家最大生命 5%，精英 10%，至少 4）。清场 / 不给奖励的死亡不掉。
    /// 弱点：罩住整张鱼脸的球（模型空间离地 1.02、略靠前），挂在 head 骨上跟着动画走。骨矛是程序化小件，挂在 hand_R 骨上。
    /// 状态：advance → aim → throw → recover → advance；advance → lungeWindup → lunge → recover；advance → jabWindup → jab → recover
    /// </summary>
    public sealed class JiaorenAI : EnemyAI
    {
        public const float ThrowMin = 10, ThrowMax = 18, ThrowWindup = 0.5f, ThrowWindupMin = 0.35f, ThrowFollow = 0.25f;
        public const float SpearSpeed = 24, SpearGravity = 4, SpearLead = 0.5f, SpearRegrow = 5, SpearRadius = 0.14f;
        public const float CloseMin = 2.5f, CloseMax = 4.5f, EngageNear = 7, EngageDrop = 20;
        public const float PackRange = 6.5f, LungeWindup = 0.45f, LungeWindupMin = 0.32f, LungeStagger = 0.12f, LungeSpeed = 11;
        public const float LungeTime = 0.42f, LungeHit = 1.25f, LungeMult = 0.85f, LungeRecover = 0.7f, PackGap = 4.5f;
        public const int PackMin = 3;
        public const float JabRange = 1.6f, JabWindup = 0.35f, JabWindupMin = 0.24f, JabMult = 0.7f, PearlHeal = 0.05f, Reach = 1.4f;
        /// <summary>群刺门限的群名（PackCoordinator）</summary>
        public const string PackKey = "jiaoren.lunge";
        /// <summary>骨矛：握点到矛尖的长度（模型单位，随体型）</summary>
        const float SpearTip = 0.67f;
        static readonly Vector3 FaceCenter = new(0, 1.02f, 0.1f);
        static readonly Vector3 HoldDir = new Vector3(0, 0.35f, 1).normalized;
        static readonly List<JiaorenAI> pack = new();

        bool hasSpear = true, engaged, lungeHit, lungeSoundDone;
        float regrow, windTime = ThrowWindup, recoverTime = 0.4f, lungeCooldown, lungeDelay, blindTime, strafeTimer, strafeSign = 1;
        Vector3 lungeDir;
        Transform spear;
        float spearScale = 1;

        /// <summary>手里有矛</summary>
        public bool HasSpear => hasSpear;
        /// <summary>已接战（绕着玩家近身打转）</summary>
        public bool Engaged => engaged;
        /// <summary>当前招式的前摇（群刺含错开时间）</summary>
        public float WindTime => windTime;
        /// <summary>能参加群刺：活着、在追击、个人冷却好了、没被眩晕</summary>
        public bool PackReady => !Dead && state == "advance" && lungeCooldown <= 0 && !Stunned;

        protected override string InitialState => "advance";

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.22f, 0.08f, 3f, 0.75f);
            cooldown = Random.Range(0.8f, 2.2f);
            lungeCooldown = Random.Range(0.5f, 1.5f);
            strafeSign = Random.value < 0.5f ? -1 : 1;
            hp.Died += OnJiaorenDied;
            // 弱点：罩住整张鱼脸（head 骨 + 模型空间的脸心）
            var head = FrostKit.FindBone(transform, "head");
            if (head) body.SetWeakPoint(head, FrostKit.ModelPointOnBone(transform, head, FaceCenter), Registry<EnemyDef>.Get("jiaoren")?.weakRadius ?? 0.21f);
            BuildSpear();
        }

        /// <summary>骨矛握在右手掌心，矛尖朝前略向上（程序化：骨白的杆 + 冰蓝的矛头）</summary>
        void BuildSpear()
        {
            var hand = FrostKit.FindBone(transform, "hand_R");
            if (!hand) return;
            var fingers = FrostKit.FindBone(transform, "fingers_R");
            var grip = fingers ? Vector3.Lerp(hand.position, fingers.position, 0.4f) : hand.position;
            spear = new GameObject("Spear").transform;
            spear.SetParent(hand, false);
            spear.position = grip;
            spear.rotation = transform.rotation * Quaternion.LookRotation(HoldDir, Vector3.up);
            // 矛的部件按模型单位搭：局部缩放抵消手骨的缩放，整体随根节点体型
            float hs = Mathf.Max(1e-4f, hand.lossyScale.x);
            spearScale = transform.lossyScale.x / hs;
            spear.localScale = Vector3.one * spearScale;
            FrostKit.GlowPrimitive(PrimitiveType.Cylinder, spear, new Vector3(0, 0, 0.2f), Quaternion.Euler(90, 0, 0), new Vector3(0.035f, 0.45f, 0.035f), FrostKit.Bone, "Shaft");
            FrostKit.GlowPrimitive(PrimitiveType.Cube, spear, new Vector3(0, 0, SpearTip - 0.06f), Quaternion.Euler(0, 0, 45), new Vector3(0.05f, 0.05f, 0.16f), FrostKit.Ice, "Tip");
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            if (lungeCooldown > 0) lungeCooldown -= dt * auraAttackRate;
            blindTime = sees ? 0 : blindTime + dt;
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(1.5f, 3f);
                strafeSign = -strafeSign;
            }
            // 掌心重新冻出骨矛
            if (!hasSpear)
            {
                regrow += dt;
                if (regrow >= SpearRegrow)
                {
                    hasSpear = true;
                    regrow = 0;
                    if (spear)
                    {
                        FrostKit.Vapour(spear.position, 0.5f * Size, 4, FrostKit.Mist);
                        Fx.FrostGlint(spear.position, 0.6f * Size);
                    }
                }
            }
            UpdateSpearVisual();
            if (d < EngageNear) engaged = true;
            else if (d > EngageDrop) engaged = false;

            switch (state)
            {
                case "advance":
                    Advance(dt, d);
                    break;
                case "aim":
                {
                    // 举矛过肩：站定、正对玩家，鲛珠和矛头越来越亮
                    Stop();
                    FacePlayer(9 * Mathf.Rad2Deg, dt);
                    float t = Mathf.Clamp01(stateTime / windTime);
                    Glow = 0.5f + 0.5f * t;
                    SetGlow(1, t);
                    if (stateTime >= windTime)
                    {
                        ThrowSpear();
                        Act("throw", 0, 0.04f);
                        SetState("throw");
                    }
                    break;
                }
                case "throw":
                    Stop();
                    SetGlow(1, 0);
                    if (stateTime >= ThrowFollow) BeginRecover(0.35f);
                    break;
                case "lungeWindup":
                {
                    // 压低身子，矛尖对准玩家（错开的成员先等一会儿再出声）
                    Stop();
                    FacePlayer(10 * Mathf.Rad2Deg, dt);
                    float t = Mathf.Clamp01(stateTime / windTime);
                    Glow = 0.4f + 0.6f * t;
                    SetGlow(1, t);
                    if (!lungeSoundDone && stateTime >= lungeDelay)
                    {
                        lungeSoundDone = true;
                        Sfx("enemy_charge", 0.45f, 1.7f + Random.value * 0.2f);
                    }
                    if (stateTime >= windTime) LaunchLunge();
                    break;
                }
                case "lunge":
                {
                    SetGlow(1, 1);
                    bool blocked = FrostKit.NavStep(agent, lungeDir * (LungeSpeed * SpeedMult * dt), out _);
                    FaceTowards(transform.position + lungeDir, 20 * Mathf.Rad2Deg, dt);
                    if (!lungeHit && d <= LungeHit + 0.3f && VerticalReach(Reach))
                    {
                        lungeHit = Melee(LungeHit, Damage * LungeMult, 0.3f);
                        if (lungeHit) FrostKit.Shatter(PlayerPos + Vector3.up * 1.1f, 0.45f, 8, 3f);
                    }
                    if (stateTime >= LungeTime || lungeHit || (blocked && stateTime > 0.1f)) BeginRecover(LungeRecover);
                    break;
                }
                case "jabWindup":
                {
                    FacePlayer(10 * Mathf.Rad2Deg, dt);
                    SetGlow(1, Mathf.Clamp01(stateTime / windTime));
                    if (d > 1.0f) MoveTo(PlayerPos, moveSpeed * 0.4f);
                    else Stop();
                    if (stateTime >= windTime)
                    {
                        Stop();
                        Melee(JabRange, Damage * JabMult, 0.25f);
                        Act("jab", 0, 0.04f);
                        SetState("jab");
                    }
                    break;
                }
                case "jab":
                    FrostKit.NavStep(agent, transform.forward * (1.2f * dt), out _);
                    SetGlow(1, 0.4f);
                    if (stateTime >= 0.16f) BeginRecover(0.45f);
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
                        SetState("advance");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("advance");
                    break;
            }
        }

        /// <summary>追击：选出手（群刺 / 戳刺 / 投矛），否则按是否接战守投矛带或近身合围</summary>
        void Advance(float dt, float d)
        {
            Glow = 0.15f + 0.08f * Mathf.Sin(age * 2.7f);
            SetGlow(1, 0);
            bool reach = VerticalReach(Reach);
            if (sees && reach && d <= PackRange && lungeCooldown <= 0 && !Taunted
                && PackCoordinator.TryStartPack(PackKey, this, PlayerPos, PackRange, PackMin, PackGap, pack, m => m.PackReady && m.VerticalReach(Reach)))
            {
                for (int i = 0; i < pack.Count; i++) pack[i].BeginLunge(PackCoordinator.StaggerDelay(i, LungeStagger));
                pack.Clear();
                return;
            }
            if (cooldown <= 0 && reach && d <= JabRange + 0.35f && RequestAttack(AttackTokens.Kind.Melee, 1f))
            {
                windTime = Windup(JabWindup, JabWindupMin / JabWindup);
                Stop();
                Act("jabWindup", windTime, 0.06f);
                SetState("jabWindup");
                Sfx("enemy_alert", 0.35f, 1.4f);
                return;
            }
            if (hasSpear && cooldown <= 0 && sees && d >= ThrowMin - 1 && d <= ThrowMax + 1
                && RequestAttack(AttackTokens.Kind.Ranged, ThrowWindup + ThrowFollow + 0.6f))
            {
                windTime = Windup(ThrowWindup, ThrowWindupMin / ThrowWindup);
                Stop();
                Act("aim", windTime, 0.08f);
                SetState("aim");
                Sfx("enemy_charge", 0.5f, 1.5f);
                return;
            }
            if (!sees && blindTime > 0.5f)
            {
                MoveTo(PlayerPos, moveSpeed);
                FaceMovement(8 * Mathf.Rad2Deg, dt);
                return;
            }
            if (hasSpear && !engaged)
            {
                // 守投矛距离带
                if (d > ThrowMax) MoveTo(Toward(ThrowMax - 1), moveSpeed);
                else KeepRange(ThrowMin, ThrowMax, moveSpeed * 0.8f, strafeSign);
            }
            else if (d > CloseMax + 1 || !reach) MoveTo(Toward(CloseMax), moveSpeed);
            // 近身合围：在近身带上打转
            else KeepRange(CloseMin, CloseMax, moveSpeed * 0.75f, strafeSign);
            if (d < 9) FaceAimTravel(7 * Mathf.Rad2Deg, dt);
            else FaceMovement(8 * Mathf.Rad2Deg, dt);
        }

        /// <summary>玩家身前 arrive 米处（从自己这一侧）</summary>
        Vector3 Toward(float arrive)
        {
            var to = transform.position - PlayerPos;
            to.y = 0;
            return to.sqrMagnitude > 1e-4f ? PlayerPos + to.normalized * arrive : PlayerPos;
        }

        bool VerticalReach(float maxDy) => Mathf.Abs(PlayerPos.y - transform.position.y) <= maxDy;

        void BeginRecover(float time)
        {
            recoverTime = time;
            Stop();
            Act("recover", 0, 0.1f);
            SetState("recover");
        }

        /// <summary>加入群刺：delay 秒后出声（按离玩家由近到远依次错开），前摇含错开时间</summary>
        public void BeginLunge(float delay)
        {
            if (Dead || state == "spawn") return;
            windTime = Windup(LungeWindup, LungeWindupMin / LungeWindup) + Mathf.Max(0, delay);
            lungeDelay = Mathf.Max(0, delay);
            lungeSoundDone = false;
            lungeCooldown = Random.Range(5f, 7f);
            Stop();
            Act("lungeWindup", windTime, 0.08f);
            SetState("lungeWindup");
        }

        /// <summary>突刺：朝玩家此刻的位置（预判 0.15 s）贴地直线冲出</summary>
        void LaunchLunge()
        {
            var to = PredictPlayer(0.15f) - transform.position;
            to.y = 0;
            lungeDir = to.sqrMagnitude > 1e-4f ? to.normalized : transform.forward;
            transform.rotation = Quaternion.LookRotation(lungeDir);
            lungeHit = false;
            Stop();
            Act("lunge", 0, 0.04f);
            SetState("lunge");
            Sfx("dash", 0.4f, 1.3f);
            FrostKit.SnowPuff(transform.position, Size, 5);
        }

        /// <summary>
        /// 投矛的初速度（纯计算，测试用）：朝玩家胸口 + 一半预判（按直线飞行时间 t = 距离 / 24），竖直方向补偿重力的一半落差；life = 1.6t + 0.6
        /// </summary>
        public static Vector3 SpearVelocity(Vector3 from, Vector3 chest, Vector3 playerVelocity, out float life)
        {
            float t = Vector3.Distance(from, chest) / SpearSpeed;
            playerVelocity.y = 0;
            var target = chest + playerVelocity * (t * SpearLead);
            var dir = target - from;
            var v = (dir.sqrMagnitude > 1e-6f ? dir.normalized : Vector3.forward) * SpearSpeed;
            v.y += 0.5f * SpearGravity * t;
            life = t * 1.6f + 0.6f;
            return v;
        }

        /// <summary>投矛：真实投射物（伤害、挡弹）+ 骨矛外观</summary>
        void ThrowSpear()
        {
            var from = spear ? spear.TransformPoint(0, 0, SpearTip) : transform.position + Vector3.up * 1.2f * Size + transform.forward * 0.4f * Size;
            var motor = !Taunted && player ? player.GetComponent<Spiritfire.Art.PlayerMotor>() : null;
            var vel = SpearVelocity(from, PlayerPos + Vector3.up * 1.1f, motor ? motor.Velocity : Vector3.zero, out float life);
            EnemyProjectile.Spawn(new EnemyProjectileSpec(from, vel, Damage, SpearRadius, life)
            {
                gravity = SpearGravity, color = FrostKit.Ice, visual = "spear", scale = 0.9f, source = this, spirit = Taunted,
            });
            GameAudio.PlayAt("skill_throw", from, 0.6f, 1.3f);
            hasSpear = false;
            regrow = 0;
            engaged = true;
            ReleaseAttack();
            RollCooldown(1.6f, 2.8f);
        }

        /// <summary>手里没矛时缩没，重新冻出时最后 0.6 s 从掌心长出来</summary>
        void UpdateSpearVisual()
        {
            if (!spear) return;
            float grow = hasSpear ? 1f : Smooth((regrow - (SpearRegrow - 0.6f)) / 0.6f);
            spear.localScale = Vector3.one * (Mathf.Max(0.01f, grow) * spearScale);
            bool show = grow > 0.02f;
            if (spear.gameObject.activeSelf != show) spear.gameObject.SetActive(show);
        }

        protected override void CancelAttack()
        {
            SetGlow(1, 0);
            if (Dead || state is "advance" or IdleState or "spawn") return;
            PlayLocomotion();
            SetState("advance");
            RollCooldown(0.6f, 1.2f);
        }

        /// <summary>鲛珠回复量：玩家最大生命的 5%（精英 10%），四舍五入，至少 4</summary>
        public static float PearlHealFor(float playerMaxHp, bool elite) => Mathf.Max(4f, RoundHp(playerMaxHp * PearlHeal * (elite ? 2f : 1f)));

        void OnJiaorenDied(DamageInfo info)
        {
            if (spear) spear.gameObject.SetActive(false);
            if (EnemyRegistry.Purging || hp.noReward) return;
            // 鲛珠滚落：变成一个小回复
            var from = body.WeakPoint ? body.WeakPoint.position : transform.position + Vector3.up * 1.1f * Size;
            from += transform.forward * 0.15f * Size;
            var dir = Quaternion.Euler(0, Random.Range(-46f, 46f), 0) * transform.forward;
            var pv = PlayerVitals.Instance;
            JiaorenPearl.Drop(from, dir, PearlHealFor(pv ? pv.MaxHealth : 100f, elite));
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

        static float Smooth(float t)
        {
            t = Mathf.Clamp01(t);
            return t * t * (3 - 2 * t);
        }
    }

    /// <summary>
    /// 鲛珠（Three.js FrostPackFx.dropPearl）：从额头沿 dir 蹦出（水平 2.2 m/s、向上 3.2 m/s，重力 18），落地弹两下、滚一小段，
    /// 0.8 s 后原地变成回复 heal 点生命的拾取物（<see cref="Pickup"/>）。撞墙反弹（水平速度 × −0.4）
    /// </summary>
    [AddComponentMenu("")]
    public sealed class JiaorenPearl : MonoBehaviour
    {
        public const float Life = 0.8f, Gravity = 18f, Radius = 0.075f;

        Vector3 velocity;
        float age, heal, sparkle, fallbackFloor;
        int bounces;

        /// <summary>这颗鲛珠变成的回复量</summary>
        public float Heal => heal;

        public static JiaorenPearl Drop(Vector3 from, Vector3 dir, float heal)
        {
            var go = new GameObject("Jiaoren Pearl");
            go.transform.position = from;
            FrostKit.GlowPrimitive(PrimitiveType.Sphere, go.transform, Vector3.zero, Quaternion.identity, Vector3.one * Radius * 2f, FrostKit.Pearl, "Pearl");
            FxMaterials.GlowSprite(go.transform, 0.45f, new Color(FrostKit.Pearl.r, FrostKit.Pearl.g, FrostKit.Pearl.b, 0.6f));
            var p = go.AddComponent<JiaorenPearl>();
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            p.velocity = new Vector3(dir.x * 2.2f, 3.2f, dir.z * 2.2f);
            p.heal = heal;
            p.fallbackFloor = from.y - 1f;
            Fx.Burst(from, FrostKit.PearlHot, 8, 2f, 0.35f, 0.06f, 0);
            return p;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            age += dt;
            velocity.y -= Gravity * dt;
            var p0 = transform.position;
            var p = p0 + velocity * dt;
            var flat = new Vector3(p.x - p0.x, 0, p.z - p0.z);
            if (flat.sqrMagnitude > 1e-8f && Physics.Raycast(p0, flat.normalized, flat.magnitude + Radius, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                p.x = p0.x;
                p.z = p0.z;
                velocity.x *= -0.4f;
                velocity.z *= -0.4f;
            }
            float gy = FrostKit.GroundAt(p, Mathf.Max(p.y, p0.y), 0.3f, 6f);
            float floor = (float.IsFinite(gy) ? gy : fallbackFloor) + Radius;
            if (p.y < floor)
            {
                p.y = floor;
                if (velocity.y < 0)
                {
                    velocity.y = bounces < 2 ? -velocity.y * 0.4f : 0;
                    velocity.x *= 0.7f;
                    velocity.z *= 0.7f;
                    bounces++;
                }
            }
            transform.position = p;
            transform.Rotate(Vector3.right, new Vector2(velocity.x, velocity.z).magnitude * dt * 8 * Mathf.Rad2Deg, Space.Self);
            sparkle += dt;
            if (sparkle > 0.12f)
            {
                sparkle = 0;
                Fx.Burst(p, FrostKit.Pearl, 1, 0.3f, 0.4f, 0.05f, -1f);
            }
            if (age < Life) return;
            Fx.Burst(p, FrostKit.PearlHot, 12, 1.8f, 0.5f, 0.07f, -2f);
            Pickup.Spawn(Pickup.Kind.Health, p, heal, 0f);
            Destroy(gameObject);
        }
    }
}
