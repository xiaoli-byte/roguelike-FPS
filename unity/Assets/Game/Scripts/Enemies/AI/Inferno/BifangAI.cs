using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 毕方（Three.js 版 src/enemies/types/Bifang.ts）：第三章栖落狙击，独脚火鹤。它<b>从不悬停</b>——要么单足立在柱顶 / 高台上，
    /// 要么扇几下翅膀做一段短滑翔换到另一处高点。所以不走飞行基类的悬停积分：位置全由脚本的弧线驱动（不用导航），
    /// 落脚点用 E3 的 <see cref="PerchPoint"/>（关卡标记 → 射线兜底的高处 → 地面；要求滑翔弧线不被挡；同伴各占一处）。
    ///   栖高：找玩家 12–28 m 外、比玩家所在地面高 3.2 m 以上（找不到就 1.6 m 以上，再不行就 14–24 m 外看得见玩家的地面）的落脚点，
    ///         起飞下蹲 0.35 s → 滑翔（时长 = 距离 / 10，夹到 0.8–2.6 s；中段抬高 0.8 + 0.06 × 距离 + 爬升 × 0.25）→ 落地缓冲 0.3 s；
    ///         从起飞算起 2 s 内不射。
    ///   毕方鸣 · 火矛（约每 2.3–2.9 s，拿到远程名额）：第一声「毕」0.8 s——喙尖到玩家胸口一根淡金瞄准细线，前 70% 跟着玩家，之后锁死转白热；
    ///         第二声「方」——长喙一啄，射出快速火矛（42 m/s、直线、射程 46 m）。打中玩家点燃 2 s；打空在落点留一个烧 3 s 的讹火（祸斗能吃）。
    ///   断足坠落：站着时那条腿（比画出来的粗一圈的命中区）累计吃到最大生命 25%：腿一软从高处摔到柱脚（0.7 s 抛物线，片段不带离地高度），
    ///         在地上扑腾 2.5 s（输出窗口），然后再飞回高处；本来就在地上的就地扑倒。
    ///   换栖：被打掉 30% 血、玩家爬上差不多的高度（1.3 m 内、9 m 内）、2.5 s 看不到玩家、站在矮处 / 地面、或离玩家太近 / 太远时，滑翔到另一处。
    ///   弱点：喙里衔的炭火（挂 head 骨）。
    /// 状态：perch → cryBi → cryFang → recover → perch；perch → takeoff → glide → land → perch；（腿断）→ fall → downed → takeoff …
    /// </summary>
    public sealed class BifangAI : InfernoEnemyAI
    {
        /// <summary>落脚点：离玩家的水平距离带、高处 / 最低高差、地面落脚点的距离带</summary>
        public const float PerchMin = 12, PerchMax = 28, PerchHighRise = 3.2f, PerchLowRise = 1.6f, GroundMin = 14, GroundMax = 24;
        /// <summary>毕方鸣：前摇、跟踪段比例、啄、收势、冷却、出手距离带</summary>
        public const float CryTime = 0.8f, TrackFrac = 0.7f, PeckTime = 0.18f, RecoverTime = 0.5f, CryCdMin = 2.3f, CryCdMax = 2.9f, FireMin = 6, FireMax = 34;
        /// <summary>火矛：速度、射程、判定半径；点燃（时长、每跳）；讹火（半径、时长、每跳）</summary>
        public const float SpearSpeed = 42, SpearRange = 46, SpearRadius = 0.3f, IgniteTime = 2, IgniteTick = 3, EmberRadius = 0.9f, EmberTime = 3, EmberTick = 4;
        /// <summary>换栖：掉血比例、同高判定与距离、看不到多久、移动后多久不能射</summary>
        public const float MoveHurt = 0.3f, SameHeight = 1.3f, SameHeightRange = 9, BlindMove = 2.5f, NoFireAfterMove = 2;
        /// <summary>起飞下蹲、落地缓冲、滑翔时长范围、参考速度、最远滑翔</summary>
        public const float TakeoffTime = 0.35f, LandTime = 0.3f, GlideMin = 0.8f, GlideMax = 2.6f, GlideSpeed = 10, GlideMaxDist = 34;
        /// <summary>断足：腿累计伤害比例、坠落时长、地上扑腾时长</summary>
        public const float LegBreak = 0.25f, FallTime = 0.7f, DownedTime = 2.5f;

        /// <summary>美术网格实测：喙里的炭火、喙尖</summary>
        static readonly Vector3 EmberPoint = new(0, 1.445f, 0.4785f), BeakTip = new(0, 1.42f, 0.575f);
        /// <summary>腿的命中球（比画出来的腿粗：站着时它最显眼、比身体好打）</summary>
        static readonly (string bone, Vector3 at)[] LegHits =
        {
            ("shin", new Vector3(0, 0.66f, 0.07f)), ("tarsus", new Vector3(0, 0.5f, 0.056f)), ("tarsus", new Vector3(0, 0.38f, 0.057f)),
            ("tarsus", new Vector3(0, 0.26f, 0.058f)), ("tarsus", new Vector3(0, 0.15f, 0.06f)),
        };
        const float LegR = 0.085f * 1.35f;

        /// <summary>当前落脚点（脚底）与是否在高处</summary>
        public Vector3 Perch { get; private set; }
        public bool PerchHigh { get; private set; }
        /// <summary>自上次换栖起被打掉的血、腿累计吃到的伤害</summary>
        public float HurtSinceMove { get; private set; }
        public float LegDamage { get; private set; }
        /// <summary>瞄准方向（锁定后不变）</summary>
        public Vector3 AimDir { get; private set; } = Vector3.forward;
        /// <summary>最近一次射出的火矛（测试 / 冒烟用）</summary>
        public EnemyProjectile LastSpear { get; private set; }

        protected override bool UsesNavMesh => false;
        protected override string InitialState => "perch";

        Vector3 glideFrom, glideTo, fallTo, aimPoint;
        float glideTime = 1, glideApex = 1, moveRetry, cryTime = CryTime, stunVy;
        bool glideToHigh, locked;
        Transform beak;
        FxHandle aimLine;

        protected override void Awake()
        {
            base.Awake();
            // 不走导航：停掉生成器挂的代理（基类的寻路、离网回收、击退都不生效），位置由脚本钉在落脚点 / 滑翔弧线上
            if (agent) agent.enabled = false;
            GlowStyle(0.3f, 0.08f, 5f, 0.7f, false);
            InfernoKit.PlaceWeak(body, "head", EmberPoint, 0.09f);
            beak = InfernoKit.Anchor(transform, "head", BeakTip, "BeakTip");
            foreach (var (bone, at) in LegHits) InfernoKit.AddSphereZone(body, bone, at, LegR, "leg", false, 5, true);
            hp.Damaged += OnBifangHurt;
            hp.Died += OnBifangDied;
        }

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            // 出生在地面（出生点可能在半空：落到脚下的地面上）：站在原地，一出生就去找高处
            var p = transform.position;
            float g = InfernoKit.GroundAt(p, p.y + 1f, 40f);
            if (float.IsFinite(g)) p.y = g;
            transform.position = p;
            Perch = p;
            PerchHigh = false;
        }

        protected override void Start()
        {
            base.Start();
            cooldown = Rand(1.2f, 2.0f);
        }

        /// <summary>站着的状态（腿伤只在站着时累计）</summary>
        bool Standing => state is "perch" or "cryBi" or "cryFang" or "recover" or "land" or "chase";

        void OnBifangHurt(DamageInfo info, DamageResult r)
        {
            if (r.total <= 0) return;
            HurtSinceMove += r.total;
            if (!Standing || info.weakpoint || info.source == DamageSource.Status) return;
            var z = body.ZoneAt(info);
            if (z && z.id == "leg") LegDamage += r.total;
        }

        protected override void Update()
        {
            base.Update();
            // 滑翔 / 坠落中被眩晕：往下掉到地上（不停在半空）
            if (Dead || !Stunned || state is not ("glide" or "fall" or "takeoff")) return;
            var p = transform.position;
            stunVy -= 20f * Time.deltaTime;
            p.y += stunVy * Time.deltaTime;
            float g = InfernoKit.GroundAt(p, p.y + 0.5f, 40f);
            if (float.IsFinite(g) && p.y <= g)
            {
                p.y = g;
                stunVy = 0;
                Perch = p;
                PerchHigh = false;
            }
            transform.position = p;
        }

        protected override void Think(float dt)
        {
            stunVy = 0;
            if (moveRetry > 0) moveRetry -= dt;
            float d = DistToPlayer;
            switch (state)
            {
                case "chase":
                case "perch":
                    Hold();
                    FacePlayer(4 * Mathf.Rad2Deg, dt);
                    Glow = 0.25f;
                    if (LegBroken()) break;
                    if (WantsToMove(d) && moveRetry <= 0 && StartMove()) break;
                    if (cooldown <= 0 && sees && d >= FireMin && d <= FireMax && FacingDot > 0.94f)
                    {
                        if (RequestAttack(AttackTokens.Kind.Ranged, CryTime + PeckTime + RecoverTime + 0.5f)) BeginCry();
                        else cooldown = Rand(0.3f, 0.7f);
                    }
                    break;
                case "cryBi":
                {
                    Hold();
                    if (LegBroken()) break;
                    float t = Mathf.Clamp01(stateTime / cryTime);
                    bool lockNow = t >= TrackFrac;
                    if (!lockNow) FacePlayer(5 * Mathf.Rad2Deg, dt);
                    Glow = 0.4f + 0.6f * t;
                    UpdateAim(lockNow);
                    if (stateTime >= cryTime) Fire();
                    break;
                }
                case "cryFang":
                    Hold();
                    if (stateTime >= PeckTime)
                    {
                        Act("recover");
                        SetState("recover");
                    }
                    break;
                case "recover":
                    Hold();
                    FacePlayer(2 * Mathf.Rad2Deg, dt);
                    Glow = 0.3f;
                    if (LegBroken()) break;
                    if (stateTime >= RecoverTime / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)))
                    {
                        ReleaseAttack();
                        RollCooldown(CryCdMin, CryCdMax);
                        ToPerch();
                    }
                    break;
                case "takeoff":
                    Hold();
                    FaceTowards(glideTo, 8 * Mathf.Rad2Deg, dt);
                    if (stateTime >= TakeoffTime)
                    {
                        Act("glide", 0.1f);
                        SetState("glide");
                        Sfx("jump", 0.5f, 1.4f);
                        Fx.Burst(Local(0, 0.9f, -0.1f), InfernoKit.Ash, 8, 2.2f, 0.5f, 0.1f, 2);
                    }
                    break;
                case "glide":
                {
                    float u = Mathf.Clamp01(stateTime / glideTime);
                    transform.position = GlidePoint(glideFrom, glideTo, glideApex, u);
                    FaceTowards(glideTo, 6 * Mathf.Rad2Deg, dt);
                    if (u >= 1)
                    {
                        Perch = glideTo;
                        PerchHigh = glideToHigh;
                        Act("land", 0.08f);
                        SetState("land");
                        Sfx("land", 0.5f, 1.3f);
                        Fx.Burst(Perch + Vector3.up * 0.05f, InfernoKit.Spark, 10, 2.5f, 0.4f, 0.06f, 3);
                    }
                    break;
                }
                case "land":
                    Hold();
                    FacePlayer(7 * Mathf.Rad2Deg, dt);
                    if (LegBroken()) break;
                    if (stateTime >= LandTime) ToPerch();
                    break;
                case "fall":
                {
                    // 腿一软：从落脚点翻下来，抛物线落到柱脚（片段不带离地高度：根节点由这里降）
                    float u = Mathf.Clamp01(stateTime / FallTime);
                    transform.position = FallPoint(glideFrom, fallTo, u);
                    if (u >= 1)
                    {
                        Perch = fallTo;
                        PerchHigh = false;
                        Act("downed", 0.08f);
                        SetState("downed");
                        CameraShake.Add(0.15f, 0.2f);
                        Sfx("land", 0.8f, 0.7f);
                        Fx.Burst(Perch + Vector3.up * 0.1f, InfernoKit.Ash, 14, 3, 0.6f, 0.14f, 2);
                    }
                    break;
                }
                case "downed":
                    // 在地上扑腾：输出窗口
                    Hold();
                    Glow = 0.15f;
                    if (stateTime >= DownedTime)
                    {
                        LegDamage = 0;
                        HurtSinceMove = 0;
                        moveRetry = 0;
                        ToPerch();
                        if (!StartMove()) moveRetry = 1;
                    }
                    break;
                default:
                    ToPerch();
                    break;
            }
        }

        void ToPerch()
        {
            Loco(0.12f);
            SetState("perch");
        }

        /// <summary>滑翔弧线上 u（0..1）处的位置：匀速略带缓入缓出，中段抬高 apex</summary>
        public static Vector3 GlidePoint(Vector3 from, Vector3 to, float apex, float u)
        {
            u = Mathf.Clamp01(u);
            float s = u * u * (3 - 2 * u) * 0.35f + u * 0.65f;
            var p = Vector3.Lerp(from, to, s);
            p.y += apex * Mathf.Sin(Mathf.PI * s);
            return p;
        }

        /// <summary>断腿坠落弧线：水平匀速，高度按 u² 落下，开头往上翻一点</summary>
        public static Vector3 FallPoint(Vector3 from, Vector3 to, float u)
        {
            u = Mathf.Clamp01(u);
            var p = Vector3.Lerp(from, to, u);
            p.y = from.y + (to.y - from.y) * u * u + 0.6f * Mathf.Sin(Mathf.PI * u) * (1 - u);
            return p;
        }

        /// <summary>滑翔时长（距离 / 10，夹到 0.8–2.6 s）与中段抬高（0.8 + 0.06 × 距离 + 爬升 × 0.25）</summary>
        public static void GlidePlan(Vector3 from, Vector3 to, out float time, out float apex)
        {
            var d = to - from;
            float rise = Mathf.Max(0, d.y);
            d.y = 0;
            float dist = d.magnitude;
            time = Mathf.Clamp(dist / GlideSpeed, GlideMin, GlideMax);
            apex = 0.8f + 0.06f * dist + rise * 0.25f;
        }

        /// <summary>钉在落脚点上（不悬停、不被推下柱顶）。被关卡瞬移走了（回收点）：落到新位置脚下的地面上，再重新找高处</summary>
        void Hold()
        {
            var p = Perch;
            if ((transform.position - p).sqrMagnitude > 1.5f * 1.5f)
            {
                var c = transform.position;
                float g = InfernoKit.GroundAt(c, c.y + 0.5f, 40f);
                p = new Vector3(c.x, float.IsFinite(g) ? g : c.y, c.z);
                Perch = p;
                PerchHigh = false;
                moveRetry = 0;
                PerchPoint.Release(this);
            }
            transform.position = p;
        }

        /// <summary>腿累计伤害到 25% 最大生命：从落脚点摔下来（在地上就就地扑倒）</summary>
        bool LegBroken()
        {
            if (LegDamage < LegBreak * hp.maxHealth) return false;
            LegDamage = 0;
            ClearAim();
            ReleaseAttack();
            glideFrom = Perch;
            Sfx("enemy_alert", 0.9f, 2.6f);
            Fx.Burst(transform.position + Vector3.up * 0.4f * Size, InfernoKit.Spark, 12, 3, 0.4f, 0.07f, 4);
            if (PerchHigh && PickFallSpot())
            {
                Act("fall", 0.06f);
                SetState("fall");
            }
            else
            {
                fallTo = Perch;
                Act("downed", 0.08f);
                SetState("downed");
            }
            PerchPoint.Release(this);
            cooldown = Mathf.Max(cooldown, 1.0f);
            return true;
        }

        /// <summary>摔落点：柱脚外侧朝玩家一边、导航网格上、比落脚点低 0.8 m 以上的地面；找不到就落在柱顶上</summary>
        bool PickFallSpot()
        {
            var dir = PlayerPos - Perch;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : -transform.forward;
            foreach (float r in new[] { 1.4f, 2.2f, 3.2f })
                foreach (float off in new[] { 0f, 0.6f, -0.6f, 1.3f, -1.3f })
                {
                    var p = Perch + Quaternion.Euler(0, off * Mathf.Rad2Deg, 0) * dir * r;
                    float g = InfernoKit.GroundAt(p, Perch.y - 0.4f, 30f);
                    if (!float.IsFinite(g) || g > Perch.y - 0.8f) continue;
                    if (!UnityEngine.AI.NavMesh.SamplePosition(new Vector3(p.x, g, p.z), out var hit, 0.6f, UnityEngine.AI.NavMesh.AllAreas)) continue;
                    fallTo = hit.position;
                    return true;
                }
            return false;
        }

        /// <summary>是否该换栖（纯条件，测试用）</summary>
        public static bool WantsToMove(float hurt, float maxHp, bool perchHigh, float playerDy, float dist, float blind)
        {
            if (hurt >= MoveHurt * maxHp) return true;
            if (perchHigh && Mathf.Abs(playerDy) < SameHeight && dist < SameHeightRange) return true;
            if (blind > BlindMove) return true;
            if (!perchHigh) return true;
            return dist < PerchMin * 0.55f || dist > PerchMax + 8;
        }

        bool WantsToMove(float d) => WantsToMove(HurtSinceMove, hp.maxHealth, PerchHigh, PlayerPos.y - Perch.y, d, blindTime);

        /// <summary>找下一个落脚点并起飞；找不到返回 false（过一会儿再找）</summary>
        bool StartMove()
        {
            var q = new PerchQuery(PlayerPos, PlayerEye, Perch, PerchMin, PerchMax, PerchLowRise, 14f, this)
            {
                preferRange = 20, highRise = PerchHighRise, eyeHeight = 1.4f * Size, clearance = 0.3f, headroom = 2f * Size, current = Perch,
                needPath = true, maxPath = GlideMaxDist, pathLift = 0.9f * Size, allowGround = true, groundMin = GroundMin, groundMax = GroundMax,
            };
            var kind = PerchPoint.Find(q, out var spot);
            if (kind == PerchKind.None)
            {
                moveRetry = 1.5f;
                return false;
            }
            // 已经站在地上、又只找到地面落脚点：不来回乱跳，等会儿再看
            if (kind == PerchKind.Ground && !PerchHigh && HurtSinceMove < MoveHurt * hp.maxHealth && blindTime <= BlindMove && DistToPlayer >= GroundMin * 0.6f)
            {
                moveRetry = 2;
                return false;
            }
            PerchPoint.Claim(this, spot);
            glideFrom = Perch;
            glideTo = spot.position;
            glideToHigh = kind != PerchKind.Ground && spot.high;
            GlidePlan(glideFrom, glideTo, out glideTime, out glideApex);
            HurtSinceMove = 0;
            ReleaseAttack();
            ClearAim();
            cooldown = Mathf.Max(cooldown, NoFireAfterMove);
            ActTimed("takeoff", TakeoffTime, 0.08f);
            SetState("takeoff");
            Sfx("telegraph", 0.35f, 2.2f);
            return true;
        }

        // ───────────── 毕方鸣 · 火矛 ─────────────

        void BeginCry()
        {
            cryTime = Windup(CryTime, 0.55f);
            locked = false;
            ClearAim();
            UpdateAim(false);
            ActTimed("cryBi", cryTime, 0.08f);
            SetState("cryBi");
            // 第一声「毕」
            Sfx("telegraph", 0.9f, 1.9f);
            Sfx("enemy_alert", 0.7f, 2.4f);
        }

        /// <summary>瞄准：跟踪段对准玩家胸口（不带提前量），锁定后方向不变、细线转白热</summary>
        void UpdateAim(bool lockNow)
        {
            var from = beak ? beak.position : Local(BeakTip.x, BeakTip.y, BeakTip.z);
            if (!lockNow)
            {
                aimPoint = TargetChest;
                var dir = aimPoint - from;
                AimDir = dir.sqrMagnitude > 1e-6f ? dir.normalized : transform.forward;
            }
            float len = Physics.Raycast(from, AimDir, out var hit, SpearRange, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? hit.distance
                : Mathf.Min(SpearRange, Vector3.Distance(from, aimPoint) + 3);
            var to = from + AimDir * len;
            if (lockNow && !locked)
            {
                locked = true;
                aimLine.Cancel();
                aimLine = Fx.Beam(from, to, InfernoKit.AimHot, 0.045f, cryTime);
            }
            else if (!aimLine.Alive) aimLine = Fx.Beam(from, to, lockNow ? InfernoKit.AimHot : InfernoKit.AimGold, lockNow ? 0.045f : 0.025f, cryTime);
            else aimLine.Retarget(from, to);
        }

        void ClearAim()
        {
            aimLine.Cancel();
            aimLine = FxHandle.None;
            locked = false;
        }

        /// <summary>第二声「方」：长喙一啄，射出火矛</summary>
        void Fire()
        {
            var from = beak ? beak.position : Local(BeakTip.x, BeakTip.y, BeakTip.z);
            float k = elite ? 1.25f : 1f;
            float mult = DamageMult;
            var self = this;
            LastSpear = EnemyProjectile.Spawn(new EnemyProjectileSpec(from, AimDir * SpearSpeed, Damage, SpearRadius * k, SpearRange / SpearSpeed)
            {
                element = Element.Fire, source = this, visual = "spear", color = InfernoKit.Ember, scale = k,
                onImpact = (at, hitPlayer) =>
                {
                    if (hitPlayer)
                    {
                        // 打中玩家：点燃 2 s
                        PlayerStatus.Ignite(IgniteTime, IgniteTick * mult);
                        return;
                    }
                    // 打空：落点（墙脚 / 地面）留一个讹火
                    float g = InfernoKit.GroundAt(at, at.y + 0.3f, 3f);
                    if (!float.IsFinite(g) || at.y - g > 2.2f) return;
                    FloorFire.Spawn(new Vector3(at.x, g, at.z), EmberRadius, EmberTime, EmberTick * mult, 0.5f, self);
                    Fx.Burst(at, InfernoKit.Spark, 12, 3.5f, 0.4f, 0.06f, 6);
                },
            });
            Sfx("enemy_alert", 0.8f, 1.6f);
            Fx.Burst(from, InfernoKit.Hot, 10, 2.5f, 0.25f, 0.08f, 0);
            ClearAim();
            Act("cryFang", 0.04f);
            SetState("cryFang");
        }

        protected override void CancelAttack()
        {
            ClearAim();
            if (!Dead && state is "cryBi" or "cryFang" or "recover")
            {
                SetState("perch");
                RollCooldown(1.0f, 1.8f);
            }
        }

        void OnBifangDied(DamageInfo info)
        {
            ClearAim();
            PerchPoint.Release(this);
            var c = transform.position + Vector3.up * 1.0f * Size;
            if (!EnemyRegistry.Purging && !info.Has(DamageTag.Purge))
            {
                Fx.Burst(c, InfernoKit.Ember, 18, 4, 0.7f, 0.1f, -1);
                Fx.Burst(c, InfernoKit.Smoke, 8, 1.4f, 1.0f, 0.3f, -0.6f);
            }
            // 没有布娃娃（占位体）又不在地上（滑翔中）：掉下来
            var ragdoll = GetComponent<Spiritfire.Art.CreatureRagdoll>();
            if (ragdoll && ragdoll.Active) return;
            var p = transform.position;
            float g = InfernoKit.GroundAt(p, p.y + 0.3f, 60f);
            if (float.IsFinite(g) && p.y - g > 0.3f) gameObject.AddComponent<FlyerCorpseFall>().Begin(Vector3.zero);
        }
    }
}
