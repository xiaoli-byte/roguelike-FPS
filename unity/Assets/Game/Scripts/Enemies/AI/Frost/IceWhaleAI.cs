using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰鲸（Three.js 版 src/enemies/types/IceWhale.ts）：搁浅的幼鲸，炮兵。靠两只前鳍一耸一耸地往前拖，笨重、迟缓。
    ///   站位：保持 12–26 m（太远爬近、太近背离玩家爬开、区间内原地慢慢转向玩家）；转身 1.2 rad/s
    ///   冰柱雨：26 m 内不需要视线（更远要视线，没有就去找）、6–32 m、拿到重击名额 → 喷气孔胀亮 1 s（攻速加成最多缩到 70%）
    ///         → 喷出 5 根冰柱（精英 7 根，<see cref="IceWhalePillar"/>）：落点 = 玩家预判位置、左右两侧各一（封横移）、
    ///         玩家朝冰鲸看时视野扇面（±1.75 rad，3–6.5 m）里的随机点；落点彼此 ≥ 2.6 m、离冰鲸 ≥ 4 m + 身体半径；
    ///         落地时刻 1.35 s 起每根 +0.16 s（打乱顺序），砸中半径 2（精英 ×1.15），之后长出冰棱阵 5 s。收招 1.1 s，冷却 6–8 s
    ///   翻身拍击：玩家贴到 5.5 m（精英 ×1.2）内、高差 ≤ 1.6 m → 前身昂起 0.8 s（身前 1.6 m 处亮出 3 m 预警圈）
    ///         → 砸回冰面：爆心 3 × 体型内伤害 ×1.3 + 击飞；再推出一圈 9 m、13 m/s 的贴地冰冲击波 ×0.8（跳起或掩体能躲，爆心已中的不吃第二下）。冷却 4–6 s
    ///   弱点：头顶喷气孔（胀亮时判定球放大到 1.35 倍）；免疫击退
    /// 大体型（身长约 5.2 m）：导航仍用项目唯一的 Humanoid 代理类型（半径 0.5 烘焙，另开代理类型要改 NavMeshAreas 并在每张图多烘一层，归关卡单元），
    ///   这里的做法是：代理避让半径取身体半宽、避让优先级最高（别的敌人让它）；寻路目的地离导航网格边缘至少留半个身宽；
    ///   身长避墙同 TS：头、尾各一个探测盒（地形 / 可走的地面不算墙），这一帧的转身会把头 / 尾新扫进墙里就撤销转身，
    ///   已经顶进墙里就沿身体轴线往外挪，往前爬头要撞墙时朝空的一侧拐。
    /// </summary>
    public sealed class IceWhaleAI : EnemyAI
    {
        public const float MinRange = 12, MaxRange = 26, BlindFireRange = 26, FireMin = 6, FireMax = 32;
        public const float SwellTime = 1f, SpoutTime = 0.55f, RecoverTime = 1.1f;
        public const int Pillars = 5, PillarsElite = 7;
        public const float PillarFirst = 1.35f, PillarStagger = 0.16f, PillarRadius = 2f, RandomSpread = 1.75f, MinSpacing = 2.6f;
        public const float SlamRange = 5.5f, RearTime = 0.8f, SlamTime = 0.35f, SlamCore = 3f, SlamCoreMult = 1.3f;
        public const float WaveRadius = 9f, WaveSpeed = 13f, WaveMult = 0.8f, WaveKnock = 8f;
        /// <summary>转身角速度（度/秒，TS 1.2 rad/s）</summary>
        public const float TurnRate = 1.2f * Mathf.Rad2Deg;
        /// <summary>爬行：一个周期的时长、撑地前冲段（周期内的区间）、前冲段 / 其余时间的移速倍率</summary>
        public const float CrawlPeriod = 1.5f, PushStart = 0.12f, PushEnd = 0.52f, PushSpeed = 1.9f, DragSpeed = 0.4f;
        /// <summary>身长避墙：头 / 尾探测盒中心离身体中心多远、半宽、离地高度、高度（设计尺寸，乘体型）；往外挪的速度、拐弯角速度（rad/s）</summary>
        public const float HeadProbe = 2.1f, TailProbe = 2.15f, ProbeHalf = 0.4f, ProbeY = 0.4f, ProbeH = 1.1f, ClearPush = 1.4f, SteerRate = 1f;
        /// <summary>身体半宽（设计尺寸）：寻路目的地离导航网格边缘至少留这么多</summary>
        public const float HalfWidth = 1.2f;
        /// <summary>喷气孔、拍击爆心（模型空间设计尺寸）</summary>
        static readonly Vector3 Blowhole = new(0, 2.22f, 1.66f), SlamFrontLocal = new(0, 0, 1.6f);

        static readonly Color IceColor = Hex.Rgb(0xcff4ff), ShardColor = Hex.Rgb(0xdff6ff), MistColor = Hex.Rgb(0xe8f8ff), SparkColor = Hex.Rgb(0xc8f8ff), SnowColor = Hex.Rgb(0xf4fbff);

        float swellTime = SwellTime, rearTime = RearTime, recoverTime = RecoverTime, slamCd, mistAcc, crawl, strafeTimer, strafeSign = 1;
        bool spouted, slammed;
        TelegraphHandle slamWarn;
        readonly SightSeeker seeker = new();
        readonly List<Vector3> targets = new();
        readonly List<float> times = new();
        System.Random rng;
        static readonly Collider[] probeBuf = new Collider[16];

        protected override string InitialState => "move";

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.08f, 0.03f, 1.6f, 0.9f);
            agent.acceleration = 10;
            agent.obstacleAvoidanceType = ObstacleAvoidanceType.HighQualityObstacleAvoidance;
            agent.avoidancePriority = 10;
            rng = new System.Random(Random.Range(int.MinValue, int.MaxValue));
            strafeSign = Random.value < 0.5f ? -1 : 1;
        }

        protected override void Start()
        {
            base.Start();
            cooldown = Random.Range(1.5f, 3f);
            slamCd = 0;
        }

        /// <summary>只在前鳍撑地前冲时快走（整段平均移速约等于 1）</summary>
        protected override float GaitMult => crawl >= PushStart && crawl < PushEnd ? PushSpeed : DragSpeed;

        // ───────────── 纯计算（EditMode 测试直接调） ─────────────

        /// <summary>
        /// 冰柱落点（同 TS pickTargets）：玩家预判位置（速度 × 0.6 s）、玩家左右两侧 4.2 m、（只给精英）玩家身后 4 m，
        /// 再按黄金比打散的随机点（以「玩家 → 冰鲸」为中心 ±1.75 rad、3–6.5 m，带一点抖动）补满 count 个；
        /// 每个候选先经 snap 贴到可走的地面（返回 null = 用原点），离冰鲸 &lt; 4 + bodyRadius 或离已选的 &lt; 2.6 m 的跳过。
        /// </summary>
        public static void PickTargets(Vector3 player, Vector3 playerVel, Vector3 whale, float bodyRadius, int count, System.Random rng,
            Func<Vector3, Vector3?> snap, List<Vector3> result)
        {
            result.Clear();
            var f = new Vector3(player.x - whale.x, 0, player.z - whale.z);
            float fl = f.magnitude;
            f = fl > 1e-4f ? f / fl : Vector3.forward;
            var cands = new List<Vector3>(24)
            {
                new(player.x + playerVel.x * 0.6f, player.y, player.z + playerVel.z * 0.6f),
                new(player.x - f.z * 4.2f, player.y, player.z + f.x * 4.2f),
                new(player.x + f.z * 4.2f, player.y, player.z - f.x * 4.2f),
            };
            // 第 4 个固定点（玩家身后）只给精英：普通冰鲸用随机点
            if (count >= PillarsElite) cands.Add(new Vector3(player.x + f.x * 4f, player.y, player.z + f.z * 4f));
            float toWhale = Mathf.Atan2(-f.x, -f.z);
            float u0 = (float)rng.NextDouble();
            for (int i = 0; i < 16; i++)
            {
                float u = (u0 + i * 0.618034f) % 1f;
                float a = toWhale + (u * 2 - 1) * RandomSpread + Range(rng, -0.2f, 0.2f);
                float r = 3 + (i * 0.381966f + 0.5f) % 1f * 3.5f + Range(rng, -0.3f, 0.3f);
                cands.Add(new Vector3(player.x + Mathf.Sin(a) * r, player.y, player.z + Mathf.Cos(a) * r));
            }
            foreach (var c in cands)
            {
                if (result.Count >= count) break;
                var q = snap?.Invoke(c) ?? c;
                if (new Vector2(q.x - whale.x, q.z - whale.z).magnitude < 4 + bodyRadius) continue;
                bool close = false;
                foreach (var o in result)
                    if (new Vector2(o.x - q.x, o.z - q.z).magnitude < MinSpacing)
                    {
                        close = true;
                        break;
                    }
                if (!close) result.Add(q);
            }
        }

        /// <summary>落地时刻：1.35 s 起每根 +0.16 s，再打乱顺序（不总是先砸玩家脚下）</summary>
        public static void PillarTimes(int count, System.Random rng, List<float> result)
        {
            result.Clear();
            for (int i = 0; i < count; i++) result.Add(PillarFirst + i * PillarStagger);
            for (int i = result.Count - 1; i > 0; i--)
            {
                int j = rng.Next(i + 1);
                (result[i], result[j]) = (result[j], result[i]);
            }
        }

        static float Range(System.Random rng, float a, float b) => a + (float)rng.NextDouble() * (b - a);

        // ───────────── 行为 ─────────────

        Vector3 BlowholePos => body.WeakPoint ? body.WeakPoint.position : transform.TransformPoint(Blowhole);
        Vector3 SlamFront => transform.TransformPoint(SlamFrontLocal);

        protected override void Think(float dt)
        {
            var rot0 = transform.rotation;
            Decide(dt);
            KeepBodyClear(rot0, dt);
        }

        void Decide(float dt)
        {
            float d = DistToPlayer;
            float dy = Mathf.Abs(PlayerPos.y - transform.position.y);
            if (slamCd > 0) slamCd -= dt;
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(2.5f, 4.5f);
                strafeSign = -strafeSign;
            }
            // 爬行相位：动着就往前走，停下时把这一耸做完再停
            var v = agent.velocity;
            v.y = 0;
            if (v.sqrMagnitude > 0.01f || crawl > 0.02f)
            {
                float next = crawl + dt / CrawlPeriod;
                crawl = next >= 1 && v.sqrMagnitude <= 0.01f ? 0 : next % 1f;
            }
            // 胀亮时喷气孔的判定球放大（只在变化时改碰撞体）
            float weakScale = state == "swell" ? 1 + 0.35f * Mathf.Clamp01(stateTime / swellTime) : state == "spout" ? 1.35f : 1f;
            if (body.WeakZone && Mathf.Abs(body.WeakZone.RadiusScale - weakScale) > 1e-3f) body.WeakZone.SetRadiusScale(weakScale);
            switch (state)
            {
                case "move":
                {
                    Glow = 0.15f + 0.08f * Mathf.Sin(age * 1.6f);
                    if (slamCd <= 0 && d < SlamRange * (elite ? 1.2f : 1f) && dy <= 1.6f)
                    {
                        BeginRear();
                        break;
                    }
                    bool canLob = sees || d <= BlindFireRange;
                    if (!canLob && SeekSight(dt)) break;
                    CrawlRange(d, dt);
                    if (cooldown <= 0 && canLob && d >= FireMin && d <= FireMax)
                    {
                        if (RequestAttack(AttackTokens.Kind.Heavy, SwellTime + SpoutTime + 1.5f))
                        {
                            swellTime = Windup(SwellTime, 0.7f);
                            Stop();
                            Sfx("boss_roar", 0.45f, 1.6f);
                            PlayTimed("swell", swellTime, 0.1f);
                            SetState("swell");
                        }
                        else cooldown = Random.Range(0.6f, 1.2f);
                    }
                    break;
                }
                case "swell":
                {
                    Stop();
                    FacePlayer(TurnRate * 0.6f, dt);
                    float t = Mathf.Clamp01(stateTime / swellTime);
                    Glow = 0.3f + 0.7f * t;
                    // 喷气孔冒白气、越来越急
                    mistAcc += dt * (3 + 14 * t);
                    if (mistAcc >= 1)
                    {
                        mistAcc = 0;
                        Fx.Burst(BlowholePos, t > 0.6f ? SparkColor : MistColor, 2, 0.8f + 1.5f * t, 0.5f, (0.15f + 0.2f * t) * Size, -2);
                        // FX3：喷气孔聚满时冒冰晶星芒
                        if (t > 0.6f && Random.value < 0.35f) Fx.FrostGlint(BlowholePos + Random.insideUnitSphere * 0.3f * Size, (0.5f + 0.6f * t) * Size, SparkColor);
                    }
                    if (stateTime >= swellTime)
                    {
                        spouted = false;
                        Play("spout", 0.05f);
                        SetState("spout");
                    }
                    break;
                }
                case "spout":
                    Stop();
                    Glow = 1;
                    if (!spouted)
                    {
                        spouted = true;
                        Spout();
                    }
                    if (stateTime >= SpoutTime)
                    {
                        recoverTime = RecoverTime;
                        Play("recover", 0.1f);
                        SetState("recover");
                    }
                    break;
                case "rear":
                    Stop();
                    FacePlayer(TurnRate * 0.8f, dt);
                    Glow = 0.4f + 0.5f * Mathf.Clamp01(stateTime / rearTime);
                    if (stateTime >= rearTime)
                    {
                        slammed = false;
                        Play("slam", 0.04f);
                        SetState("slam");
                    }
                    break;
                case "slam":
                    Stop();
                    if (!slammed && stateTime >= SlamTime * 0.6f)
                    {
                        slammed = true;
                        Slam();
                    }
                    if (stateTime >= SlamTime)
                    {
                        recoverTime = RecoverTime + 0.2f;
                        Play("recover", 0.1f);
                        SetState("recover");
                    }
                    break;
                case "recover":
                    Stop();
                    FacePlayer(TurnRate * 0.5f, dt);
                    Glow = 0.2f;
                    if (stateTime >= recoverTime / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)))
                    {
                        ReleaseAttack();
                        if (cooldown <= 0.5f) RollCooldown(6f, 8f);
                        PlayLocomotion();
                        SetState("move");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("move");
                    break;
            }
        }

        /// <summary>保持距离：太远爬近（停在 24 m），太近背离玩家（略带横向）爬开，区间内原地慢慢转向玩家</summary>
        void CrawlRange(float d, float dt)
        {
            var pos = transform.position;
            var away = pos - PlayerPos;
            away.y = 0;
            if (d > MaxRange)
            {
                var dir = d > 1e-3f ? -away / d : transform.forward;
                MoveTo(ClearOfEdges(PlayerPos - dir * (MaxRange - 2)), moveSpeed);
                FaceMovement(TurnRate, dt);
            }
            else if (d < MinRange)
            {
                float s = strafeSign * 0.5f;
                var dest = pos + new Vector3(away.x - away.z * s, 0, away.z + away.x * s) * 0.5f;
                MoveTo(ClearOfEdges(dest), moveSpeed);
                FaceMovement(TurnRate, dt);
            }
            else
            {
                Stop();
                FacePlayer(TurnRate * 0.7f, dt);
            }
        }

        /// <summary>寻路目的地离导航网格边缘至少留半个身宽（身体比烘焙的代理半径宽得多）</summary>
        Vector3 ClearOfEdges(Vector3 dest)
        {
            if (!NavMesh.SamplePosition(dest, out var on, 3f, NavMesh.AllAreas)) return dest;
            dest = on.position;
            float half = HalfWidth * Size;
            if (NavMesh.FindClosestEdge(dest, out var edge, NavMesh.AllAreas) && edge.distance < half)
            {
                var n = edge.normal;
                n.y = 0;
                if (n.sqrMagnitude > 1e-4f) dest += n.normalized * (half - edge.distance);
            }
            return dest;
        }

        bool SeekSight(float dt)
        {
            var q = new SightQuery(PlayerPos, PlayerEye, transform.position, MinRange - 3, MaxRange, 2f * Size) { clearance = HalfWidth * Size };
            if (!seeker.Tick(sees, dt, q)) return false;
            if (seeker.HasSpot)
            {
                MoveTo(ClearOfEdges(seeker.Spot), moveSpeed);
                if (seeker.Arrived(transform.position)) seeker.Reached();
            }
            else MoveTo(PlayerPos, moveSpeed);
            FaceMovement(TurnRate, dt);
            return true;
        }

        /// <summary>喷出冰柱雨：落点贴到导航网格上的地面</summary>
        void Spout()
        {
            int count = elite ? PillarsElite : Pillars;
            var motor = player ? player.GetComponent<PlayerMotor>() : null;
            var vel = !Taunted && motor ? motor.Velocity : Vector3.zero;
            PickTargets(PlayerPos, vel, transform.position, 1.05f * Size, count, rng, SnapToGround, targets);
            PillarTimes(targets.Count, rng, times);
            float k = elite ? 1.15f : 1f;
            IceWhalePillar.Launch(new IceWhalePillar.Volley
            {
                from = BlowholePos, targets = targets, times = times, radius = PillarRadius * k, damage = Damage, scale = k, owner = this,
            });
            GameAudio.PlayAt("explosion", BlowholePos, 0.5f, 1.7f);
            GameAudio.PlayAt("shot_launcher", BlowholePos, 0.9f, 0.5f);
        }

        Vector3? SnapToGround(Vector3 p)
        {
            if (NavMesh.SamplePosition(p, out var hit, 3f, NavMesh.AllAreas)) return hit.position;
            float gy = Fx.GroundY(p + Vector3.up * 2f, 6f);
            return float.IsFinite(gy) ? new Vector3(p.x, gy, p.z) : p;
        }

        void BeginRear()
        {
            rearTime = Windup(RearTime, 0.6f);
            Stop();
            slamCd = Random.Range(4f, 6f);
            slamWarn.Cancel();
            slamWarn = Telegraph.Circle(SlamFront, SlamCore * Size, rearTime + SlamTime * 0.6f, IceWhalePillar.WarnColor);
            Sfx("boss_roar", 0.6f, 1.2f);
            PlayTimed("rear", rearTime, 0.08f);
            SetState("rear");
        }

        /// <summary>拍击：身前爆心重击 + 击飞；再推出一圈贴地冰冲击波（爆心已中的玩家只看到波，不吃第二下）</summary>
        void Slam()
        {
            var c = SlamFront;
            c.y = transform.position.y;
            float r = SlamCore * Size;
            bool hit = false;
            var pv = PlayerVitals.Instance;
            if (pv && !pv.Dead)
            {
                var feet = PlayerPos;
                var cc = pv.GetComponent<CharacterController>();
                float pr = cc ? cc.radius : 0.35f;
                var flat = new Vector3(feet.x - c.x, 0, feet.z - c.z);
                float dd = flat.magnitude, dy = feet.y - c.y;
                if (dd <= r + pr && dy < 1.4f && dy > -1 && HitTarget(Damage * SlamCoreMult, c))
                {
                    hit = true;
                    var dir = dd > 0.05f ? flat / dd : transform.forward;
                    var motor = pv.GetComponent<PlayerMotor>();
                    if (motor && !pv.Dead) motor.AddImpulse(new Vector3(dir.x * 9f, 4.5f, dir.z * 9f));
                }
            }
            float waveR = WaveRadius * (elite ? 1.2f : 1f);
            if (hit) Telegraph.Wave(c, waveR, WaveSpeed, IceColor);
            else GroundWave.Spawn(SlamWave(c, waveR, Damage, this));
            // FX3：鲸身砸地——冰爆（粉雾、冰块、冰碴、霜斑）+ 一圈冰刺冒出又缩回
            Fx.FrostNova(c + Vector3.up * 0.3f, 2.2f * Size, ShardColor);
            Fx.IceRing(c, 2.6f * Size, 14);
            CameraShake.Quake(c, 0.45f, 26f, 0.35f);
            GameAudio.PlayAt("boss_slam", c, 0.9f, 0.9f);
        }

        /// <summary>
        /// 拍击的冰冲击波（数值同 TS spawnIceShockwave）：从 0.6 m 起以 13 m/s 扩到 9 m，环带 ±0.7 m；脚底高出波心 0.6 m 以上（跳起）躲开，
        /// 低于 1 m 以下不吃；掩体挡波；命中向外击退 8 m/s、向上 3.5。伤害 = 拍击伤害 × 0.8（damage 传拍击的最终伤害）
        /// </summary>
        public static GroundWave.Spec SlamWave(Vector3 center, float maxRadius, float damage, EnemyAI owner) =>
            new(center, maxRadius, WaveSpeed, damage * WaveMult)
            {
                startRadius = 0.6f, width = 1.4f, minRise = -1f, maxRise = 0.6f, needGrounded = false, coverBlocks = true,
                knockback = WaveKnock, knockUp = 3.5f, color = IceColor, owner = owner,
            };

        // ───────────── 身长避墙 ─────────────

        /// <summary>沿朝向 rot、离身体中心 along 米处的探测盒顶在墙里（地形、可走的地面不算）</summary>
        bool ProbeBlocked(Quaternion rot, float along)
        {
            var fwd = rot * Vector3.forward;
            fwd.y = 0;
            if (fwd.sqrMagnitude < 1e-6f) return false;
            fwd.Normalize();
            float k = Size;
            var c = transform.position + fwd * along + Vector3.up * (ProbeY + ProbeH * 0.5f) * k;
            var half = new Vector3(ProbeHalf, ProbeH * 0.5f, ProbeHalf) * k;
            int n = Physics.OverlapBoxNonAlloc(c, half, probeBuf, Quaternion.LookRotation(fwd), Layers.WorldMask, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
            {
                var col = probeBuf[i];
                if (col is TerrainCollider) continue;
                var hb = col.GetComponent<Hitbox>();
                if (hb && !hb.blocksSight) continue;
                // 探测盒底下是能走的地面（坡道、台阶顶面）：不是墙
                if (col.Raycast(new Ray(c + Vector3.up * half.y, Vector3.down), out var h, half.y * 2f + 0.1f) && h.normal.y > 0.6f) continue;
                return true;
            }
            return false;
        }

        /// <summary>
        /// 身长避墙（在这一帧的朝向和移动决定之后）：1. 这一帧的转身把头或尾新扫进墙里 → 撤销转身；
        /// 2. 头在墙里、尾不在 → 沿身体轴线往后挪；尾在墙里、头不在 → 往前挪（去掉往墙里走的分量）；3. 往前爬、前方头要撞墙 → 朝空的一侧拐
        /// </summary>
        void KeepBodyClear(Quaternion rot0, float dt)
        {
            if (!agent.enabled || !agent.isOnNavMesh) return;
            float k = Size, head = HeadProbe * k, tail = -TailProbe * k;
            var rot = transform.rotation;
            bool hb = ProbeBlocked(rot, head), tb = ProbeBlocked(rot, tail);
            int room = 0;
            if ((hb || tb) && Quaternion.Angle(rot, rot0) > 0.01f)
            {
                bool hb0 = ProbeBlocked(rot0, head), tb0 = ProbeBlocked(rot0, tail);
                if ((hb && !hb0) || (tb && !tb0))
                {
                    room = hb && !hb0 ? -1 : 1;
                    transform.rotation = rot = rot0;
                    hb = hb0;
                    tb = tb0;
                }
            }
            var fwd = rot * Vector3.forward;
            fwd.y = 0;
            fwd.Normalize();
            int push = hb && !tb ? -1 : tb && !hb ? 1 : room;
            if (push != 0)
            {
                var v = agent.velocity;
                float along = Vector3.Dot(v, fwd);
                if (along * push < 0) agent.velocity = v - fwd * along;
                agent.Move(fwd * (push * ClearPush * dt));
            }
            // 往前爬时看前方一小段：头要撞墙就朝空的一侧拐
            float ahead = Vector3.Dot(agent.velocity, fwd);
            if (!hb && ahead > 0.2f && ProbeBlocked(rot, head + 0.8f * k))
            {
                bool l = ProbeBlocked(rot * Quaternion.Euler(0, 0.5f * Mathf.Rad2Deg, 0), head);
                bool r = ProbeBlocked(rot * Quaternion.Euler(0, -0.5f * Mathf.Rad2Deg, 0), head);
                if (l != r) transform.rotation = rot * Quaternion.Euler(0, (l ? -1 : 1) * SteerRate * Mathf.Rad2Deg * dt, 0);
            }
        }

        protected override void CancelAttack()
        {
            slamWarn.Cancel();
            if (body.WeakZone) body.WeakZone.SetRadiusScale(1);
        }
    }
}
