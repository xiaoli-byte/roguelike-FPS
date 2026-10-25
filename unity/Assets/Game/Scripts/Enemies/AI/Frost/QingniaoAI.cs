using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三青鸟（Three.js 版 src/enemies/types/Qingniao.ts）：第二章唯一的飞行常规怪，逼玩家抬头。飞行、避障、起落交给 <see cref="FlyingEnemyAI"/>（E3）。
    ///   盘旋：离地 / 离玩家脚底 8–11 m（每只随机一个高度，缓慢起伏 ±0.4 m；看不到玩家时再高 1.5 m），和玩家保持 15–25 m、绕着横移；
    ///         看不到玩家时换到有视线的悬停点（<see cref="FlyingEnemyAI.SeekSight"/>）。地面出生时先抬到离地 2 m（尾羽不插进地面）。
    ///   冰羽扇射（约每 3 s，有视线、远程名额）：双翅后收上扬 0.5 s（羽尖冰刃亮起）→ 一记下扑，从左翼尖、左翼中、胸前霜晶、右翼中、右翼尖同时射出 5 根冰羽，
    ///         在玩家处排成间距 2 m 的一道横排（预判 0.35；横移从缝里躲开），22 m/s。收招 0.45 s。
    ///   俯冲换位：累计被打掉 30% 血时尖啸 0.45 s（昂头张翅，掠过点亮预警圈）→ 收翅贴地俯冲到玩家身侧 1.6 m、胸口高度（14 m/s），
    ///         身体中心擦到玩家 1.7 m（× 体型 × 0.85）内重伤 22（× 等级倍率）并被撞开 → 拉升到玩家另一侧 16 m 外的高处（出界就拉回自己这一侧）。
    ///   歇脚：飞满 11–14 s 后找玩家 6–22 m 内、比玩家高 1.4–7 m、看得见玩家的柱顶 / 高台（PerchPoint 标记优先，再兜底搜索），
    ///         都没有就落在 9–16 m 外看得见玩家的空地上；歇 3 s 收翅理羽（输出窗口），歇脚时被打掉 25% 血或被贴到 2.5 m 内会惊飞。
    /// 弱点：胸口霜晶（chest 骨）；身体、头、翅膀用存活时的布娃娃胶囊做命中盒（<see cref="HitboxMode.Ragdoll"/>）。
    /// perched 是持续型片段（AC_ 里没有自动退出），起飞时由这里 CrossFade 到 takeoff。
    /// 状态：hover → volley → recover → hover；hover → screech → swoopDown → swoopUp → hover；hover → toPerch → perched → takeoff → hover
    /// </summary>
    public sealed class QingniaoAI : FlyingEnemyAI
    {
        public const float AltitudeMin = 8, AltitudeMax = 11, RangeMin = 15, RangeMax = 25;
        public const float VolleyWindup = 0.5f, VolleyWindupMin = 0.35f, VolleyRecover = 0.45f, FeatherSpeed = 22, FeatherSpacing = 2f, FeatherLead = 0.35f;
        public const int Feathers = 5;
        public const float SwoopTrigger = 0.3f, ScreechTime = 0.45f, SwoopSide = 1.6f, SwoopSpeed = 14, SwoopClimbSpeed = 12, SwoopHitRange = 1.7f;
        public const float SwoopDamage = 22, SwoopFar = 16;
        public const float PerchAfterMin = 11, PerchAfterMax = 14, PerchTime = 3, PerchStartleHp = 0.25f, PerchStartleRange = 2.5f, TakeoffTime = 0.5f;
        public const float SpawnAlt = 2f, Accel = 9, SwoopAccel = 30;

        float altitude, bobPhase, flyTime, perchAfter, hurtSinceSwoop, hurtWhilePerched, volleyTime = VolleyWindup, blindTime;
        bool swoopHit;
        Vector3 swoopLow, swoopEnd;
        TelegraphHandle swoopWarn;
        Transform chest, wingTipL, wingMidL, wingTipR, wingMidR;
        PerchSpot perch;

        /// <summary>这只的盘旋高度</summary>
        public float Altitude => altitude;
        /// <summary>最近一次扇射的出射点（左翼尖 → 右翼尖）与落点</summary>
        public readonly Vector3[] lastOrigins = new Vector3[Feathers], lastTargets = new Vector3[Feathers];
        public int Volleys { get; private set; }
        /// <summary>俯冲擦中玩家的次数</summary>
        public int SwoopHits { get; private set; }
        /// <summary>歇脚点</summary>
        public PerchSpot Perch => perch;

        protected override string InitialState => "hover";

        protected override void Awake()
        {
            base.Awake();
            altitude = Random.Range(AltitudeMin, AltitudeMax);
            bobPhase = Random.Range(0f, Mathf.PI * 2);
            perchAfter = Random.Range(PerchAfterMin, PerchAfterMax);
            cooldown = Random.Range(1f, 2.2f);
            cruiseHeight = altitude;
            accel = Accel;
            spawnLift = SpawnAlt;
            takeoffHeight = 3f;
            takeoffTime = TakeoffTime;
            GlowStyle(0.2f, 0.06f, 2f, 0.7f);
            chest = FrostKit.FindBone(transform, "chest");
            wingTipL = FrostKit.FindBone(transform, "wing_3_L");
            wingMidL = FrostKit.FindBone(transform, "wing_2_L");
            wingTipR = FrostKit.FindBone(transform, "wing_3_R");
            wingMidR = FrostKit.FindBone(transform, "wing_2_R");
            hp.Damaged += OnQingniaoHurt;
            hp.Died += OnQingniaoDied;
        }

        void OnQingniaoHurt(DamageInfo info, DamageResult r)
        {
            if (r.total <= 0) return;
            hurtSinceSwoop += r.total;
            if (state == "perched") hurtWhilePerched += r.total;
        }

        void OnQingniaoDied(DamageInfo info)
        {
            swoopWarn.Cancel();
            FrostKit.Shatter(BodyCenter(transform.position), 0.9f * Size, 14, 5f);
        }

        protected override void Think(float dt)
        {
            blindTime = sees ? 0 : blindTime + dt;
            switch (state)
            {
                case "hover":
                {
                    // 眩晕 / 玩家阵亡打断了歇脚：先飞起来（站着的不吃移动）
                    if (FlightPhase == Flight.Landed) TakeOff();
                    else if (FlightPhase == Flight.Landing) CancelLanding();
                    flyTime += dt;
                    HoldAltitude();
                    Glow = 0.15f;
                    SetGlow(1, 0);
                    if (hurtSinceSwoop >= SwoopTrigger * hp.maxHealth && StartScreech()) break;
                    if (flyTime >= perchAfter && TryPerch()) break;
                    if (SeekSight(RangeMin - 3, RangeMax, moveSpeed, altitude))
                    {
                        FaceVelocity(3 * Mathf.Rad2Deg, dt);
                        break;
                    }
                    KeepRangeAir(RangeMin, RangeMax, moveSpeed, 0.6f);
                    FacePlayer(3 * Mathf.Rad2Deg, dt);
                    if (cooldown <= 0 && sees && DistToPlayer <= RangeMax + 6)
                    {
                        if (RequestAttack(AttackTokens.Kind.Ranged, VolleyWindup + VolleyRecover + 0.4f))
                        {
                            volleyTime = Windup(VolleyWindup, VolleyWindupMin / VolleyWindup);
                            Act("volley", volleyTime, 0.08f);
                            SetState("volley");
                            GameAudio.PlayAt("telegraph", transform.position, 0.6f, 1.6f);
                        }
                        else cooldown = Random.Range(0.3f, 0.7f);
                    }
                    break;
                }
                case "volley":
                {
                    // 双翅后收上扬，羽尖亮起；悬停原地（慢慢漂）
                    HoldAltitude();
                    KeepRangeAir(RangeMin, RangeMax, moveSpeed * 0.25f, 0.3f);
                    FacePlayer(5 * Mathf.Rad2Deg, dt);
                    float t = Mathf.Clamp01(stateTime / volleyTime);
                    Glow = 0.3f + 0.7f * t;
                    SetGlow(1, t);
                    if (stateTime >= volleyTime)
                    {
                        FireFeathers();
                        Act("recover", 0, 0.06f);
                        SetState("recover");
                    }
                    break;
                }
                case "recover":
                    HoldAltitude();
                    KeepRangeAir(RangeMin, RangeMax, moveSpeed * 0.5f, 0.5f);
                    FacePlayer(4 * Mathf.Rad2Deg, dt);
                    Glow = 0.15f;
                    SetGlow(1, 0);
                    if (stateTime >= VolleyRecover)
                    {
                        ReleaseAttack();
                        RollCooldown(2.6f, 3.4f);
                        PlayLocomotion();
                        SetState("hover");
                    }
                    break;
                case "screech":
                    // 尖啸：原地昂头张翅，然后收翅俯冲
                    Hover();
                    SetTargetY(transform.position.y);
                    FacePlayer(6 * Mathf.Rad2Deg, dt);
                    Glow = 0.6f + 0.4f * Mathf.Sin(stateTime * 30);
                    if (stateTime >= ScreechTime)
                    {
                        swoopHit = false;
                        accel = SwoopAccel;
                        Act("swoopDown", 0, 0.06f);
                        SetState("swoopDown");
                    }
                    break;
                case "swoopDown":
                {
                    // 贴地俯冲向掠过点；高度直接追掠过点
                    SetTargetY(swoopLow.y);
                    bool reached = FlyTo(swoopLow, SwoopSpeed, 1.4f);
                    FaceVelocity(10 * Mathf.Rad2Deg, dt);
                    CheckSwoopHit();
                    if (reached || stateTime > 1.8f || (Bumped && stateTime > 0.3f))
                    {
                        swoopWarn = TelegraphHandle.None;
                        Act("swoopUp", 0, 0.08f);
                        SetState("swoopUp");
                    }
                    break;
                }
                case "swoopUp":
                {
                    // 掠过后拉升到玩家另一侧的高处
                    SetTargetY(swoopEnd.y);
                    bool reached = FlyTo(swoopEnd, SwoopClimbSpeed, 2f);
                    FaceVelocity(5 * Mathf.Rad2Deg, dt);
                    if (stateTime < 0.35f) CheckSwoopHit();
                    if (reached || stateTime > 2.2f || Bumped)
                    {
                        accel = Accel;
                        hurtSinceSwoop = 0;
                        flyTime = Mathf.Min(flyTime, perchAfter - 3);
                        RollCooldown(1f, 1.8f);
                        PlayLocomotion();
                        SetState("hover");
                    }
                    break;
                }
                case "toPerch":
                {
                    var to = perch.position - transform.position;
                    to.y = 0;
                    if (to.magnitude > 1.5f) FaceVelocity(4 * Mathf.Rad2Deg, dt);
                    else FacePlayer(3 * Mathf.Rad2Deg, dt);
                    // 降落由飞行基类推进：站定 → OnLanded（perched）；7 s 落不下 → OnLandingFailed（hover）
                    if (FlightPhase == Flight.Airborne)
                    {
                        flyTime = 0;
                        PlayLocomotion();
                        SetState("hover");
                    }
                    break;
                }
                case "perched":
                {
                    FacePlayer(2 * Mathf.Rad2Deg, dt);
                    Glow = 0.1f;
                    SetGlow(1, 0);
                    bool startled = hurtWhilePerched >= PerchStartleHp * hp.maxHealth
                                    || (DistToPlayer < PerchStartleRange * Size && Mathf.Abs(PlayerPos.y - transform.position.y) <= 2.5f);
                    if (stateTime >= PerchTime || startled)
                    {
                        TakeOff();
                        // perched 是持续型片段，没有自动退出：这里切到 takeoff
                        Act("takeoff", TakeoffTime, 0.08f);
                        SetState("takeoff");
                        GameAudio.PlayAt("telegraph", transform.position, 0.4f, 2f);
                        FrostKit.SnowPuff(transform.position, Size, 9);
                    }
                    break;
                }
                case "takeoff":
                    FacePlayer(3 * Mathf.Rad2Deg, dt);
                    if ((stateTime >= TakeoffTime && FlightPhase == Flight.Airborne) || stateTime > 2f)
                    {
                        flyTime = 0;
                        perchAfter = Random.Range(PerchAfterMin, PerchAfterMax);
                        RollCooldown(0.4f, 1f);
                        PlayLocomotion();
                        SetState("hover");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("hover");
                    break;
            }
        }

        /// <summary>盘旋高度：地面参考 + 盘旋高度、随玩家所在高度抬升（≥ 玩家脚底 + 0.8 × 高度），看不到玩家时再高 1.5 m，带缓慢起伏</summary>
        void HoldAltitude()
        {
            float h = altitude + (blindTime > 0.6f ? 1.5f : 0f) + Mathf.Sin(age * 0.9f + bobPhase) * 0.4f;
            SetAltitude(h, true);
        }

        // ───────────── 冰羽扇射 ─────────────

        /// <summary>
        /// 冰羽横排的落点（纯计算，测试用）：从 muzzle 看向 target 的水平垂线方向上，以 target 为中心每隔 2 m 排开；
        /// 下标 0 在出手者的左边（左翼尖），4 在右边（右翼尖）
        /// </summary>
        public static void FeatherTargets(Vector3 muzzle, Vector3 target, Vector3[] into)
        {
            var to = target - muzzle;
            to.y = 0;
            var right = to.sqrMagnitude > 1e-6f ? Vector3.Cross(Vector3.up, to.normalized) : Vector3.right;
            int n = into.Length;
            for (int i = 0; i < n; i++)
            {
                float k = i - (n - 1) / 2f;
                into[i] = target + right * (k * FeatherSpacing);
            }
        }

        /// <summary>冰羽的出射点：左翼尖、左翼中、胸前霜晶、右翼中、右翼尖（骨骼缺失时按体型从身体中心排开）</summary>
        void FeatherOrigins(Vector3[] into)
        {
            var c = body.WeakPoint ? body.WeakPoint.position : BodyCenter(transform.position);
            var r = transform.right * Size;
            into[0] = wingTipL ? wingTipL.position : c - r * 1.3f;
            into[1] = wingMidL ? wingMidL.position : c - r * 0.8f;
            into[2] = c + transform.forward * 0.1f * Size;
            into[3] = wingMidR ? wingMidR.position : c + r * 0.8f;
            into[4] = wingTipR ? wingTipR.position : c + r * 1.3f;
        }

        void FireFeathers()
        {
            var muzzle = body.WeakPoint ? body.WeakPoint.position : BodyCenter(transform.position);
            var chestP = PlayerPos + Vector3.up * 1.1f;
            float t = Vector3.Distance(muzzle, chestP) / FeatherSpeed;
            var aim = PredictPlayer(t * FeatherLead) + Vector3.up * 1.1f;
            FeatherOrigins(lastOrigins);
            FeatherTargets(muzzle, aim, lastTargets);
            for (int i = 0; i < Feathers; i++)
            {
                var dir = lastTargets[i] - lastOrigins[i];
                if (dir.sqrMagnitude < 1e-6f) dir = transform.forward;
                EnemyProjectile.Spawn(new EnemyProjectileSpec(lastOrigins[i], dir.normalized * FeatherSpeed, Damage, 0.2f, 3.2f)
                {
                    color = Hex.Rgb(0xbfeeff), visual = "feather", scale = 1.6f, source = this, spirit = Taunted,
                });
            }
            Volleys++;
            FrostKit.Shatter(muzzle, 0.5f, 8, 3f);
            GameAudio.PlayAt("enemy_shot", muzzle, 0.6f, 1.4f);
        }

        // ───────────── 俯冲换位 ─────────────

        /// <summary>
        /// 俯冲的掠过点和终点（纯计算，测试用）：掠过点在玩家身侧 1.6 m（side = ±1）、胸口高度（脚底 + 0.25）；
        /// 终点在玩家另一侧 16 m、高度 = max(地面 + 盘旋高度, 玩家脚底 + 0.8 × 盘旋高度)
        /// </summary>
        public static void SwoopPath(Vector3 self, Vector3 playerFeet, float side, float altitude, float groundY, out Vector3 low, out Vector3 end)
        {
            var to = playerFeet - self;
            to.y = 0;
            var dir = to.sqrMagnitude > 1e-6f ? to.normalized : Vector3.forward;
            var perp = new Vector3(dir.z, 0, -dir.x) * Mathf.Sign(side == 0 ? 1 : side);
            low = new Vector3(playerFeet.x + perp.x * SwoopSide, playerFeet.y + 0.25f, playerFeet.z + perp.z * SwoopSide);
            end = new Vector3(playerFeet.x + dir.x * SwoopFar, Mathf.Max(groundY + altitude, playerFeet.y + altitude * 0.8f), playerFeet.z + dir.z * SwoopFar);
        }

        bool StartScreech()
        {
            var pl = PlayerPos;
            var to = pl - transform.position;
            to.y = 0;
            if (to.sqrMagnitude < 1e-6f) return false;
            SwoopPath(transform.position, pl, strafeSign, altitude, GroundHeight, out swoopLow, out swoopEnd);
            // 另一侧出界（没有导航网格 = 关卡外）：拉升回自己这一侧
            if (!NavMesh.SamplePosition(new Vector3(swoopEnd.x, pl.y, swoopEnd.z), out _, 3f, NavMesh.AllAreas))
            {
                var back = -to.normalized * (SwoopFar * 0.8f);
                swoopEnd = new Vector3(pl.x + back.x, swoopEnd.y, pl.z + back.z);
            }
            ReleaseAttack();
            Act("screech", ScreechTime, 0.06f);
            SetState("screech");
            GameAudio.PlayAt("telegraph", transform.position, 1f, 2.2f);
            var flat = swoopLow - transform.position;
            flat.y = 0;
            float eta = ScreechTime + flat.magnitude / SwoopSpeed;
            swoopWarn = Telegraph.Circle(new Vector3(swoopLow.x, pl.y, swoopLow.z), SwoopHitRange, eta, FrostKit.Warn);
            return true;
        }

        /// <summary>俯冲擦中：身体中心离玩家胸口 1.7 m（× 体型 × 0.85）内，一次</summary>
        void CheckSwoopHit()
        {
            if (swoopHit || !player || Taunted) return;
            var c = BodyCenter(transform.position);
            var chestP = PlayerPos + Vector3.up * 1.1f;
            if (Vector3.Distance(c, chestP) > SwoopHitRange * Size * 0.85f) return;
            swoopHit = true;
            if (Combat.DamagePlayer(SwoopDamage * DamageMult, c, Element.None, this) > 0)
            {
                SwoopHits++;
                var v = new Vector3(velocity.x, 0, velocity.z);
                var k = (v.sqrMagnitude > 1e-4f ? v.normalized * 6f : Vector3.zero) + Vector3.up * 3f;
                var pv = PlayerVitals.Instance;
                if (pv && !pv.Dead && !pv.Invulnerable) pv.GetComponent<Spiritfire.Art.PlayerMotor>()?.AddImpulse(k);
                CameraShake.Add(0.4f, 0.25f);
            }
            FrostKit.Shatter(chestP, 0.6f, 10, 4f);
        }

        // ───────────── 歇脚 ─────────────

        /// <summary>找歇脚点并开始降落：玩家 6–22 m、高 1.4–7 m 的高处（看得见玩家），没有就落在 9–16 m 外的空地</summary>
        bool TryPerch()
        {
            var q = PerchAroundTarget(6f, 22f, 1.4f, 7f);
            q.preferRange = 13f;
            q.groundMin = 9f;
            q.groundMax = 16f;
            q.allowGround = true;
            if (FindPerch(q, out var s) == PerchKind.None || !BeginLanding(s)) return false;
            perch = s;
            Act("toPerch", 0, 0.1f);
            SetState("toPerch");
            return true;
        }

        protected override void OnLanded()
        {
            if (state != "toPerch") return;
            hurtWhilePerched = 0;
            Act("perched", 0, 0.12f);
            SetState("perched");
            FrostKit.SnowPuff(perch.position, Size, 8);
        }

        protected override void OnLandingFailed()
        {
            if (state != "toPerch") return;
            flyTime = 0;
            PlayLocomotion();
            SetState("hover");
        }

        protected override void CancelAttack()
        {
            swoopWarn.Cancel();
            swoopWarn = TelegraphHandle.None;
            SetGlow(1, 0);
            if (Dead) return;
            if (state is "volley" or "recover" or "screech" or "swoopDown" or "swoopUp")
            {
                accel = Accel;
                PlayLocomotion();
                SetState("hover");
                RollCooldown(0.8f, 1.6f);
            }
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
