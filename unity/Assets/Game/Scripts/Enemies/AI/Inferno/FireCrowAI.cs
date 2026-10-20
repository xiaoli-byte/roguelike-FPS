using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 神火飞鸦（Three.js 版 src/enemies/types/FireCrow.ts，第三章飞行神风）：竹篾纸糊的火箭乌鸦，肚子是火药鼓（弱点），20 血一枪死。
    ///   盘旋：成群在 8–14 m 高（离地 / 离玩家脚底取高的）绕玩家转圈（同一方向，各自的半径 7–10 m、黄金角错开的相位，0.5 rad/s），
    ///     圆心缓慢跟随玩家；看不到玩家超过 0.8 s 抬高 2 m，撞到东西临时爬升 2.5 m。
    ///   点火（轮流）：整群共用一个轮次（<see cref="FlockReady"/>），每 1.5–3 s 轮到一只，还要拿到远程名额；28 m 内、看得见、
    ///     自己比玩家高 2 m 以上才点。尖啸、火药鼓变亮 0.7 s 原地悬停；这一刻玩家脚下的地面点被锁定，地面亮出朱红俯冲线，落点亮出 3 m 预警圈。
    ///   俯冲：沿直线冲向锁定点（不追踪，横移就躲开），速度 20 m/s、竖直分量不超过 13 m/s；撞地、撞墙（0.08 s 后）、贴到玩家胸口 1 m（× 体型）
    ///     或冲满 2.4 s 就炸开：3 m 火爆（边缘 50%），地上留 1.6 m 燃烧纸灰 3 s（每 0.5 s 撞击伤害 × 0.15，祸斗能吃）。自己撞死不给奖励。
    ///   空中打爆：被打死时在空中炸开 3 m，对附近所有敌人 30 × 等级（精英 ×1.5）、击退 3（<see cref="ExplosiveChain"/> 的 Damage 模式：
    ///     旁边的飞鸦被炸死就接着炸）；不伤玩家。被炮仗傀儡的死亡爆炸引爆时同样在空中炸开。清场时不炸。
    /// 状态机：circle → ignite → dive →（撞地 / 撞墙 / 贴脸）自爆。动作片段：ignite / dive + Locomotion（翼面转平已采样进片段）。
    /// </summary>
    public sealed class FireCrowAI : FlyingEnemyAI, IExplosiveKin, ISelfDestruct
    {
        /// <summary>盘旋高度带、绕圈半径带、角速度（弧度 / 秒）、出生时脚底至少离地（× 体型）</summary>
        public const float AltMin = 8, AltMax = 14, OrbitRMin = 7, OrbitRMax = 10, OrbitW = 0.5f, SpawnAlt = 2.5f;
        /// <summary>点火：前摇、能点火的水平距离、整群轮流的间隔</summary>
        public const float IgniteTime = 0.7f, IgniteRange = 28, FlockGapMin = 1.5f, FlockGapMax = 3f;
        /// <summary>俯冲：速度、竖直速度上限、最长时间、贴脸判定（身体中心到玩家胸口，× 体型）</summary>
        public const float DiveSpeed = 20, DiveVyMax = 13, DiveMaxTime = 2.4f, DiveHit = 1f;
        /// <summary>撞地爆：半径、燃烧纸灰（半径、持续、每跳占撞击伤害的比例）</summary>
        public const float BlastRadius = 3, AshRadius = 1.6f, AshTime = 3, AshMult = 0.15f;
        /// <summary>空中打爆：半径、对敌人的基础伤害（× 等级，精英 ×1.5）、击退</summary>
        public const float AirRadius = 3, AirBase = 30, AirKnock = 3;

        /// <summary>火药鼓（模型空间，Three.js 坐标，未缩放）</summary>
        static readonly Vector3 Drum = new(0, 0.43f, 0.12f);

        static float flockNext = float.NegativeInfinity;
        static int spawnCount;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            flockNext = float.NegativeInfinity;
            spawnCount = 0;
        }

        /// <summary>整群的点火轮次到了（now ≥ 下一只最早能点火的时刻）</summary>
        public static bool FlockReady(float now) => now >= flockNext;

        /// <summary>这一只开始点火：下一只至少 gap 秒之后</summary>
        public static void FlockTaken(float now, float gap) => flockNext = now + Mathf.Max(0, gap);

        /// <summary>测试用：清掉轮次</summary>
        public static void ResetFlock() => flockNext = float.NegativeInfinity;

        /// <summary>
        /// 俯冲速度（一次定死）：指向锁定点上方 0.25 m，速率 min(20, 13 / |方向的竖直分量|)——竖直分量正好不超过 13 m/s
        /// </summary>
        public static Vector3 DiveVelocity(Vector3 from, Vector3 target)
        {
            var d = target + Vector3.up * 0.25f - from;
            if (d.sqrMagnitude < 1e-4f) d = Vector3.down;
            d.Normalize();
            return d * Mathf.Min(DiveSpeed, DiveVyMax / Mathf.Max(1e-3f, Mathf.Abs(d.y)));
        }

        /// <summary>绕圈的目标点：圆心 + (sin a, 0, cos a) × r，a = phase + w × t</summary>
        public static Vector3 OrbitPoint(Vector3 center, float phase, float w, float t, float r)
        {
            float a = phase + w * t;
            return new Vector3(center.x + Mathf.Sin(a) * r, center.y, center.z + Mathf.Cos(a) * r);
        }

        float altitude, orbitR, orbitPhase, bobPhase, climb, blind, igniteTime = IgniteTime, igniteY;
        Vector3 orbitCenter, diveTarget, diveVel;
        bool orbitInit, crashed, primed, detonated, placed;
        TelegraphHandle warn, lane;
        Transform drumGlow;
        float drumBase = 1, sparkTimer;

        /// <summary>
        /// 撞地 / 撞墙 / 贴脸自爆死的（<see cref="ISelfDestruct"/>）：直接 Kill、不经伤害管线、不算玩家击杀（同 TS）。
        /// 空中被打爆 / 被连环爆引爆不算——那两种都走 <see cref="Combat.DamageEnemy"/>
        /// </summary>
        public bool Detonated => crashed;

        /// <summary>锁定的落点（测试 / 调试）</summary>
        public Vector3 DiveTarget => diveTarget;
        public Vector3 DiveVel => diveVel;
        protected override string InitialState => "circle";

        protected override void Awake()
        {
            base.Awake();
            altitude = Random.Range(AltMin, AltMax);
            orbitR = Random.Range(OrbitRMin, OrbitRMax);
            // 各只错开相位（黄金角），整群围成一圈
            orbitPhase = spawnCount++ * 2.399963f % (Mathf.PI * 2);
            bobPhase = Random.Range(0, Mathf.PI * 2);
            cruiseHeight = altitude;
            accel = 10;
            spawnLift = SpawnAlt;
            hp.Died += OnDeath;
            GlowStyle(0.15f, 0.05f, 5f, 0.85f, false);
        }

        protected override void Start()
        {
            base.Start();
            cooldown = Random.Range(0.8f, 1.8f);
            PlaceParts();
        }

        Vector3 ModelPoint(Vector3 three) => transform.TransformPoint(new Vector3(-three.x, three.y, three.z));

        /// <summary>弱点球挪到火药鼓（body 骨上）；鼓里的火光（只在 Play 里建）</summary>
        void PlaceParts()
        {
            if (placed) return;
            placed = true;
            Transform bone = null;
            if (!GetComponent<PlaceholderBody>())
                foreach (var t in GetComponentsInChildren<Transform>(true))
                    if (t.name == "body")
                    {
                        bone = t;
                        break;
                    }
            if (bone) body.SetWeakPoint(bone, bone.InverseTransformPoint(ModelPoint(Drum)), 0.24f);
            if (!Application.isPlaying || !body.WeakPoint) return;
            var w = body.WeakPoint;
            drumGlow = FxMaterials.GlowSprite(w, 0.6f * Size / Mathf.Max(1e-3f, w.lossyScale.x), new Color(1f, 0.54f, 0.19f, 0.6f));
            drumBase = drumGlow.localScale.x;
            body.AddGlowPart(drumGlow.GetComponent<Renderer>(), 0, new Color(1f, 0.45f, 0.15f, 0.3f), new Color(1f, 0.88f, 0.63f, 1f));
        }

        /// <summary>火药鼓中心（弱点球；没有时按根节点算）</summary>
        public Vector3 DrumCenter => body && body.WeakPoint && body.WeakPoint.gameObject.activeInHierarchy ? body.WeakPoint.position : ModelPoint(Drum);

        // ───────────── 连环爆 ─────────────

        public bool ChainArmed => this && !Dead && !primed;
        public Vector3 ChainCenter => DrumCenter;
        public float ChainRadius => EnemyRegistry.BodyRadius(this);

        /// <summary>被同伴引爆：身上泛橙，delay 秒后在空中炸开（死亡回调负责爆炸）</summary>
        public void ChainDetonate(float delay)
        {
            if (primed || Dead) return;
            primed = true;
            body.SetOverlay("chain", new Color(1f, 0.48f, 0.12f), 0.9f);
            ExplosiveChain.DetonateLater(this, delay);
        }

        // ───────────── AI ─────────────

        protected override void Think(float dt)
        {
            blind = sees ? 0 : blind + dt;
            switch (state)
            {
                case "circle":
                {
                    Glow = 0.15f;
                    SetGlow(1, 0);
                    Circle(dt);
                    float d = DistToPlayer;
                    if (cooldown <= 0 && sees && d <= IgniteRange && d > 2 && transform.position.y > PlayerPos.y + 2)
                    {
                        if (FlockReady(Time.time) && RequestAttack(AttackTokens.Kind.Ranged, IgniteTime + DiveMaxTime + 0.3f))
                        {
                            FlockTaken(Time.time, Random.Range(FlockGapMin, FlockGapMax));
                            StartIgnite();
                        }
                        else cooldown = Random.Range(0.25f, 0.6f);
                    }
                    break;
                }
                case "ignite":
                {
                    // 原地悬停、盯住锁定的落点：尖啸、火药鼓变亮，俯冲线逐渐填满
                    Hover();
                    SetTargetY(igniteY);
                    FaceTowards(diveTarget, 344, dt);
                    float t = Mathf.Clamp01(stateTime / igniteTime);
                    Glow = 0.4f + 0.6f * t;
                    SetGlow(1, 1);
                    if (stateTime >= igniteTime) StartDive();
                    break;
                }
                case "dive":
                {
                    var c = DrumCenter;
                    var chest = PlayerPos + Vector3.up * 1.15f;
                    var p = transform.position;
                    bool ground = GroundAt(p, p.y + 0.5f, out float gy) && p.y <= gy + 0.15f;
                    bool hitPlayer = Vector3.Distance(c, chest) <= DiveHit * Size && (Taunted || (vitals && !vitals.Dead));
                    bool blocked = stateTime > 0.08f && Bumped;
                    if (hitPlayer || ground || blocked || stateTime >= DiveMaxTime)
                    {
                        Crash();
                        break;
                    }
                    // 沿直线俯冲（不追踪）：速度在开始时定死，每帧原样保持
                    velocity = diveVel;
                    var flat = new Vector3(diveVel.x, 0, diveVel.z);
                    FlyToward(flat, flat.magnitude / Mathf.Max(0.1f, SpeedMult));
                    SetTargetY(p.y + diveVel.y / 3f);
                    if (flat.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(flat);
                    Glow = 1;
                    SetGlow(1, 1);
                    break;
                }
                default:
                    PlayLocomotion();
                    SetState("circle");
                    break;
            }
        }

        /// <summary>盘旋：绕着（缓慢跟随的）玩家转圈，高度随玩家抬升；看不到玩家、撞到东西时升高</summary>
        void Circle(float dt)
        {
            var pl = PlayerPos;
            if (!orbitInit)
            {
                orbitCenter = pl;
                orbitInit = true;
            }
            float k = 1 - Mathf.Exp(-1.2f * dt);
            orbitCenter.x = Mathf.Lerp(orbitCenter.x, pl.x, k);
            orbitCenter.z = Mathf.Lerp(orbitCenter.z, pl.z, k);
            var tgt = OrbitPoint(orbitCenter, orbitPhase, OrbitW, Time.time, orbitR);
            var to = tgt - transform.position;
            to.y = 0;
            FlyToward(to, Mathf.Min(moveSpeed, 1.5f + to.magnitude * 1.6f));
            FaceVelocity(200, dt);
            climb = Bumped ? 1.2f : Mathf.Max(0, climb - dt);
            float y = Mathf.Max(GroundHeight, pl.y) + altitude;
            if (blind > 0.8f) y += 2;
            if (climb > 0) y += AvoidClimb;
            SetTargetY(y + Mathf.Sin(age * 1.3f + bobPhase) * 0.35f);
        }

        /// <summary>点火：锁定玩家这一刻脚下的地面点，亮出俯冲线和落点预警</summary>
        void StartIgnite()
        {
            var pl = PlayerPos;
            diveTarget = new Vector3(pl.x, GroundAt(pl, pl.y + 0.5f, out float gy) ? gy : pl.y, pl.z);
            igniteTime = Windup(IgniteTime, 0.5f);
            igniteY = transform.position.y;
            SetState("ignite");
            PlayTimed("ignite", igniteTime);
            var c = DrumCenter;
            var below = new Vector3(transform.position.x, GroundAt(transform.position, transform.position.y, out float sy) ? sy : diveTarget.y, transform.position.z);
            float eta = igniteTime + Vector3.Distance(c, diveTarget) / DiveSpeed + 0.1f;
            if (Application.isPlaying)
            {
                lane = Telegraph.Lane(below, diveTarget, 0.5f, igniteTime, FirecrackerAI.Warn, eta - igniteTime);
                warn = Telegraph.Circle(diveTarget, BlastRadius, eta, FirecrackerAI.Warn);
                Fx.Burst(c, FirecrackerAI.Gold, 10, 3, 0.4f, 0.05f, 2);
            }
            Sfx("telegraph", 1f, 2.4f);
        }

        /// <summary>俯冲：速度一次定死</summary>
        void StartDive()
        {
            diveVel = DiveVelocity(DrumCenter, diveTarget);
            accel = 200;
            Play("dive", 0.05f);
            SetState("dive");
            Sfx("enemy_charge", 0.9f, 1.7f);
        }

        /// <summary>撞地 / 撞墙 / 贴脸：炸开、留下燃烧纸灰，自身死亡（不算玩家击杀、不掉落）</summary>
        void Crash()
        {
            if (crashed || Dead) return;
            crashed = true;
            detonated = true;
            // 预警如期兑现：让它们自然收尾
            warn = default;
            lane = default;
            var c = DrumCenter;
            if (Taunted) DecoyBlocked(Target);
            else Blast.Player(c, BlastRadius, Damage, Element.Fire, this, 0.5f, 0.6f, 6);
            FirecrackerAI.GunpowderBlast(c, BlastRadius, 1.1f);
            if (Application.isPlaying && GroundAt(c, c.y + 0.5f, out float gy) && c.y - gy < 2.5f)
                FloorFire.Spawn(new Vector3(c.x, gy, c.z), AshRadius, AshTime, Damage * AshMult, 0.5f, this);
            hp.noReward = true;
            var info = DamageInfo.Simple(0, DamageSource.Explosion, c, Vector3.up);
            info.element = Element.Fire;
            hp.Kill(info);
        }

        protected override void CancelAttack()
        {
            warn.Cancel();
            lane.Cancel();
            warn = default;
            lane = default;
            if (!Dead && state is "ignite" or "dive")
            {
                // 眩晕 / 清理 / 玩家死亡：熄火，回到盘旋
                accel = 10;
                PlayLocomotion();
                SetState("circle");
                RollCooldown(1.2f, 2.2f);
            }
        }

        /// <summary>空中被打爆：炸伤附近所有敌人（同类被炸死就接着炸），不伤玩家；清场不炸</summary>
        void OnDeath(DamageInfo info)
        {
            if (drumGlow) drumGlow.gameObject.SetActive(false);
            if (detonated || EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            detonated = true;
            var c = DrumCenter;
            FirecrackerAI.GunpowderBlast(c, AirRadius, 0.9f);
            ExplosiveChain.Explode(new ExplosiveChain.Spec(c, AirRadius, AirBase * level * (elite ? 1.5f : 1f), AirKnock, ExplosiveChain.Mode.Damage, this));
        }

        void LateUpdate()
        {
            if (Dead) return;
            float ignite = state == "ignite" ? Mathf.Clamp01(stateTime / Mathf.Max(0.05f, igniteTime)) : 0;
            bool dive = state == "dive";
            if (drumGlow) drumGlow.localScale = Vector3.one * drumBase * (1 + 0.25f * ignite + (dive ? 0.3f : 0));
            // 翅下火箭筒的火星：平时零星，点火猛喷，俯冲全开
            sparkTimer -= Time.deltaTime;
            if (sparkTimer <= 0 && Application.isPlaying && state != "spawn")
            {
                sparkTimer = dive ? 0.03f : ignite > 0 ? 0.05f : 0.18f;
                var back = DrumCenter - transform.forward * 0.25f * Size;
                Fx.Burst(back, FirecrackerAI.Gold, dive ? 3 : 1, dive ? 3f : 1.2f, 0.3f, 0.05f, 1);
            }
        }
    }
}
