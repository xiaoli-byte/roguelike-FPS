using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 炮仗傀儡（Three.js 版 src/enemies/types/Firecracker.ts，第三章炮击怪）：提线烧断的庙会木偶，胸口是「一窝蜂」六角火箭箱，腹部铜火药仓是弱点。
    ///   保持距离：12–22 m 外一顿一顿地挪（木偶步态：迈腿段 ×1.95、停顿段 ×0.3，整步平均 ≈ 移速），太近退开；24 m 内不要视线也能开炮，
    ///     更远又看不见时寻视线站位。
    ///   一窝蜂（10–30 m，约每 6 s，拿重型名额）：扎马弹盖 0.35 s → 引信沿导线烧到箱底 1.2 s（火药仓越来越亮）→ 8 支火箭（精英 12）冲天，
    ///     玩家周围 6 m 内每个落点立刻亮出朱红预警圈，1.3 s 起每隔 0.09 s 从高空斜砸下来（顺序打乱），各炸 1.6 m，落点留 1 m 残火 2.5 s（祸斗能吃）。
    ///   哑炸：引信烧着时打中火药仓（弱点命中离火药仓 0.45 m 内，或任何命中点离它 0.28 m 内，都乘体型）→ 火箭在箱里炸开、
    ///     四散落在傀儡周围 2.5–7 m（对敌人 30 × 等级、击退 6：能炸伤同伴、推进熔岩），傀儡仰面倒地 2 s（输出窗口）再起身 0.6 s。
    ///   地老鼠：玩家 8 m 内、高差 2 m 内 → 跺脚 0.4 s → 4 个地老鼠贴地乱窜追脚（5.2 m/s，碰到脚或 2.5 s 后炸 1.4 m；跳起来躲开）。
    ///   连环爆：死时火箭箱炸开（3.5 m，玩家也挨炸），3.5 m 内的其他火药怪由近到远一只接一只被引爆，其余敌人吃 70 × 等级火药伤害 + 击退 9
    ///     （<see cref="ExplosiveChain"/> 的 Detonate 模式）；清场时不炸。
    ///   箱盖：美术网格里没有，运行时程序化一块尖顶六边形板挂在 chest 骨的铰链上，扎马时「啪」地弹开（欠阻尼弹簧，开到头回弹一下）。
    /// 状态机：march → brace → fuse → volley → recover → march；march → stomp → march；fuse →（火药仓中弹）toppled → getup → march。
    /// 动作片段（E5 采样）：brace / fuse / volley / recover / stomp / toppled / getup + Locomotion。
    /// </summary>
    public sealed class FirecrackerAI : EnemyAI, IExplosiveKin
    {
        // ───────────── 数值（同 TS） ─────────────
        /// <summary>保持距离带、开炮距离带、不需要视线的开炮距离（米）</summary>
        public const float KeepMin = 12, KeepMax = 22, FireMin = 10, FireMax = 30, BlindFire = 24;
        /// <summary>一窝蜂：扎马、引信、齐射、收势（秒）</summary>
        public const float BraceTime = 0.35f, FuseTime = 1.2f, VolleyTime = 0.5f, RecoverTime = 0.9f;
        public const float VolleyCdMin = 5.5f, VolleyCdMax = 6.5f;
        /// <summary>火箭：数量（精英）、落点离玩家最远、爆炸半径、最早落地、相邻落地间隔、落点最小间距</summary>
        public const int Rockets = 8, RocketsElite = 12;
        public const float Spread = 6, RocketRadius = 1.6f, RocketFirst = 1.3f, RocketStagger = 0.09f, RocketGap = 1.7f;
        /// <summary>火箭落点的残火：半径、持续、每 0.5 s 一跳占火箭伤害的比例</summary>
        public const float FloorFireRadius = 1f, FloorFireTime = 2.5f, FloorFireMult = 0.12f;
        /// <summary>地老鼠：触发距离、跺脚前摇、数量、寿命、速度、爆炸半径、伤害倍率、冷却</summary>
        public const float RatRange = 8, StompTime = 0.4f, RatLife = 2.5f, RatSpeed = 5.2f, RatRadius = 1.4f, RatMult = 0.6f, RatCdMin = 5, RatCdMax = 6.5f;
        public const int Rats = 4;
        /// <summary>哑炸：仰倒、起身、乱飞火箭落点离傀儡的距离带、对玩家的伤害倍率、对敌人的基础伤害（× 等级）、击退</summary>
        public const float ToppleTime = 2f, GetupTime = 0.6f, DudRingMin = 2.5f, DudRingMax = 7f, DudMult = 0.8f, DudEnemyBase = 30, DudKnock = 6;
        /// <summary>死亡爆炸：半径（米，不随体型）、对敌人的基础伤害（× 等级，精英 ×1.5）、击退、对玩家的伤害倍率</summary>
        public const float BlastRadius = 3.5f, BlastBase = 70, BlastKnock = 9, BlastMult = 1f;
        /// <summary>木偶步态：一步时长、迈腿占比、迈腿 / 停顿段的移速倍率</summary>
        public const float StepTime = 0.62f, Swing = 0.42f, SwingSpeed = 1.95f, HoldSpeed = 0.3f;
        /// <summary>火药仓判定半径（设计尺寸）：命中点离它这么近（+ 0.08）就算打中</summary>
        public const float BellyR = 0.2f;

        /// <summary>美术模型空间（Three.js 坐标：X = 生物左、Y = 上、Z = 前，未缩放）：火药仓、箱口、箱盖铰链</summary>
        static readonly Vector3 Belly = new(0, 0.76f, 0.17f), BoxMuzzle = new(0, 1.08f, 0.3f), LidHinge = new(0, 1.275f, 0.29f);
        const float LidR = 0.215f;
        /// <summary>引信导线：从箱顶沿箱子左沿烧到箱底，再进火药仓的引信口</summary>
        static readonly Vector3[] FusePath =
        {
            new(0, 1.25f, 0.3f), new(0.19f, 1.16f, 0.3f), new(0.19f, 0.97f, 0.3f), new(0, 0.87f, 0.29f), new(0, 0.71f, 0.26f),
        };

        /// <summary>预警 / 火药的颜色（同 TS INFERNO）</summary>
        /// <summary>精英出手分量层（三章共用，普通傀儡为 null）与这一招的铜芒放过没有（docs/art/vfx/elites-ch3.md）</summary>
        EliteStrike strike;
        bool glinted;

        /// <summary>地老鼠已经放出去了（这次跺脚的释放帧过了；节拍条套件用）</summary>
        public bool RatsOut => state == "stomp" && stompDone;

        public static readonly Color Warn = Hex.Rgb(0xff1f4f), FireColor = Hex.Rgb(0xff8a2a), Hot = Hex.Rgb(0xffd27a), Paper = Hex.Rgb(0xd8241c),
            Gold = Hex.Rgb(0xffc850), Soot = Hex.Rgb(0x2a1a14);

        float braceTime = BraceTime, fuseTime = FuseTime, ratCd, gait, volleyAge = 99f, lidOpen, lidVel;
        bool stompDone, primed, detonated, placed;
        Transform chest, lidHinge, fuseSpark, bellyGlow;
        Vector3[] fuseLocal;
        Vector3 muzzleLocal;
        float fuseTrail;
        readonly List<Vector3> targets = new();
        readonly SightSeeker seeker = new();

        protected override string InitialState => "march";

        /// <summary>木偶步态的位移倍率（迈腿段快、停顿段几乎不动）</summary>
        protected override float GaitMult => PuppetGait(gait);

        /// <summary>木偶步态：一步进度 g（0..1）处的移速倍率</summary>
        public static float PuppetGait(float g) => g < Swing ? SwingSpeed : HoldSpeed;

        /// <summary>一步的平均移速倍率（≈ 1：整步平均等于定义移速）</summary>
        public static float PuppetGaitAverage => Swing * SwingSpeed + (1 - Swing) * HoldSpeed;

        protected override void Awake()
        {
            base.Awake();
            ratCd = Random.Range(0.5f, 1.5f);
            hp.Damaged += OnHurt;
            hp.Died += OnDeath;
            GlowStyle(0.1f, 0.03f, 3f, 0.9f, false);
        }

        protected override void Start()
        {
            base.Start();
            cooldown = Random.Range(1.5f, 3f);
            PlaceParts();
        }

        // ───────────── 部件 ─────────────

        /// <summary>模型空间（Three.js 坐标，设计尺寸）的点 → 世界：X 取反（Three.js 的 +X 是生物的左）</summary>
        Vector3 ModelPoint(Vector3 three) => transform.TransformPoint(new Vector3(-three.x, three.y, three.z));

        Transform Bone(string boneName)
        {
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name == boneName)
                    return t;
            return null;
        }

        /// <summary>
        /// 第一帧（绑定姿势）按模型空间摆好：弱点球挪到火药仓、箱口 / 引信导线换算到 chest 骨局部；箱盖、引信火花、火药仓光（只在 Play 里建）。
        /// 占位体没有骨骼：弱点留在定义的高度，箱口按根节点算
        /// </summary>
        void PlaceParts()
        {
            if (placed) return;
            placed = true;
            chest = GetComponent<PlaceholderBody>() ? null : Bone("chest");
            if (chest)
            {
                body.SetWeakPoint(chest, chest.InverseTransformPoint(ModelPoint(Belly)), BellyR);
                muzzleLocal = chest.InverseTransformPoint(ModelPoint(BoxMuzzle));
                fuseLocal = Array.ConvertAll(FusePath, p => chest.InverseTransformPoint(ModelPoint(p)));
            }
            if (!Application.isPlaying) return;
            var weak = body.WeakPoint;
            if (weak)
            {
                bellyGlow = FxMaterials.GlowSprite(weak, 0.55f * Size / Mathf.Max(1e-3f, weak.lossyScale.x), new Color(1f, 0.54f, 0.16f, 0.6f));
                bellyBase = bellyGlow.localScale.x;
                var r = bellyGlow.GetComponent<Renderer>();
                body.AddGlowPart(r, 0, new Color(1f, 0.45f, 0.12f, 0.25f), new Color(1f, 0.94f, 0.69f, 1f));
            }
            if (chest)
            {
                lidHinge = BuildLid(chest, ModelPoint(LidHinge));
                lidRest = lidHinge.localRotation;
                fuseSpark = FxMaterials.GlowSprite(chest, 0.22f * Size / Mathf.Max(1e-3f, chest.lossyScale.x), new Color(1f, 0.95f, 0.7f, 1f));
                fuseSpark.gameObject.SetActive(false);
            }
        }

        /// <summary>
        /// 箱盖：红漆尖顶六边形木板（外接圆 0.215 m）+ 铜边，铰链在箱顶尖角、与模型空间同向，弹开时绕水平轴向前上方翻起
        /// </summary>
        Transform BuildLid(Transform parent, Vector3 hingeWorld)
        {
            var hinge = new GameObject("Lid Hinge").transform;
            hinge.SetParent(parent, false);
            hinge.position = hingeWorld;
            hinge.rotation = transform.rotation;
            hinge.localScale = Vector3.one * (transform.lossyScale.x / Mathf.Max(1e-4f, parent.lossyScale.x));
            AddHex(hinge, "Lid Rim", LidR + 0.012f, 0.018f, -0.008f, Hex.Rgb(0xc8963a));
            AddHex(hinge, "Lid", LidR, 0.03f, 0f, Hex.Rgb(0xc0281c));
            AddHex(hinge, "Lid Inset", LidR * 0.72f, 0.012f, 0.017f, Hex.Rgb(0x2a1a14));
            AddHex(hinge, "Lid Stud", 0.035f, 0.02f, 0.03f, Hex.Rgb(0xe8c060));
            foreach (var t in hinge.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = Layers.IgnoreRaycast;
            return hinge;
        }

        static Mesh hexMesh;

        static void AddHex(Transform hinge, string partName, float r, float thick, float z, Color c)
        {
            var go = new GameObject(partName);
            go.transform.SetParent(hinge, false);
            // 板挂在铰链下方：尖角朝上贴着铰链
            go.transform.localPosition = new Vector3(0, -LidR, z);
            go.transform.localScale = new Vector3(r, r, thick);
            go.AddComponent<MeshFilter>().sharedMesh = hexMesh ? hexMesh : hexMesh = HexPrism();
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(mr, c);
        }

        /// <summary>单位尖顶六棱柱（外接圆半径 1、厚 1，沿 Z）：一个角朝 +Y</summary>
        static Mesh HexPrism()
        {
            var v = new List<Vector3>();
            var tris = new List<int>();
            for (int s = 0; s < 2; s++)
            {
                float zz = s == 0 ? 0.5f : -0.5f;
                v.Add(new Vector3(0, 0, zz));
                for (int i = 0; i < 6; i++)
                {
                    float a = i / 6f * Mathf.PI * 2;
                    v.Add(new Vector3(Mathf.Sin(a), Mathf.Cos(a), zz));
                }
            }
            for (int i = 0; i < 6; i++)
            {
                int a = 1 + i, b = 1 + (i + 1) % 6;
                tris.AddRange(new[] { 0, b, a });
                tris.AddRange(new[] { 7, 7 + a, 7 + b });
                tris.AddRange(new[] { a, b, 7 + b, a, 7 + b, 7 + a });
            }
            var m = new Mesh { name = "Firecracker Lid" };
            m.SetVertices(v);
            m.SetTriangles(tris, 0);
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }

        /// <summary>火药仓的世界位置（弱点球；没有时按根节点算）</summary>
        public Vector3 BellyCenter => body && body.WeakPoint && body.WeakPoint.gameObject.activeInHierarchy ? body.WeakPoint.position : ModelPoint(Belly);

        /// <summary>箱口（火箭出射点）</summary>
        public Vector3 Muzzle => chest ? chest.TransformPoint(muzzleLocal) : ModelPoint(BoxMuzzle);

        // ───────────── 连环爆（IExplosiveKin） ─────────────

        public bool ChainArmed => this && !Dead && !primed;
        public Vector3 ChainCenter => BellyCenter;
        public float ChainRadius => EnemyRegistry.BodyRadius(this);

        /// <summary>被同伴引爆：引信「嗤」一声、身上泛橙，delay 秒后当场炸开（死亡回调负责爆炸）</summary>
        public void ChainDetonate(float delay)
        {
            if (primed || Dead) return;
            primed = true;
            body.SetOverlay("chain", new Color(1f, 0.48f, 0.12f), 0.8f);
            Fx.Burst(BellyCenter, Gold, 10, 3, 0.3f, 0.05f, 2);
            ExplosiveChain.DetonateLater(this, delay);
        }

        // ───────────── AI ─────────────

        protected override void Think(float dt)
        {
            if (ratCd > 0) ratCd -= dt;
            volleyAge += dt;
            StepGait(dt);
            float d = DistToPlayer;
            switch (state)
            {
                case "march":
                {
                    Glow = 0.12f;
                    if (ratCd <= 0 && d < RatRange && Mathf.Abs(PlayerPos.y - transform.position.y) <= 2 && RequestAttack(AttackTokens.Kind.Melee, StompTime + 0.6f))
                    {
                        stompDone = false;
                        strike ??= EliteStrike.For(this);
                        glinted = false;
                        Stop();
                        PlayTimed("stomp", StompTime + 0.35f);
                        Sfx("telegraph", 0.6f, 1.3f);
                        SetState("stomp");
                        break;
                    }
                    bool canLob = sees || d <= BlindFire;
                    if (!canLob && SeekSightGround())
                    {
                        FaceMovement(172, dt);
                        break;
                    }
                    March(d, dt);
                    if (cooldown <= 0 && canLob && d >= FireMin && d <= FireMax)
                    {
                        if (RequestAttack(AttackTokens.Kind.Heavy, BraceTime + FuseTime + VolleyTime + 1.2f))
                        {
                            braceTime = Windup(BraceTime, 0.25f);
                            fuseTime = Windup(FuseTime, 0.8f);
                            strike ??= EliteStrike.For(this);
                            glinted = false;
                            Stop();
                            PlayTimed("brace", braceTime);
                            Sfx("telegraph", 0.7f, 0.9f);
                            SetState("brace");
                        }
                        else cooldown = Random.Range(0.6f, 1.2f);
                    }
                    break;
                }
                case "brace":
                    // 扎马、弹开箱盖
                    Stop();
                    FacePlayer(143, dt);
                    Glow = 0.25f;
                    // 精英：扎马更低（前摇 = 扎马 + 引信，扎马占前 25%）
                    strike?.Charge(0.25f * stateTime / Mathf.Max(0.01f, braceTime), 0.13f, -5f);
                    if (stateTime >= braceTime)
                    {
                        PlayTimed("fuse", fuseTime);
                        Sfx("enemy_charge", 0.7f, 1.6f);
                        SetState("fuse");
                    }
                    break;
                case "fuse":
                {
                    // 引信沿导线一路烧到箱底：火药仓越来越亮（这段时间打中火药仓 = 哑炸）
                    Stop();
                    FacePlayer(115, dt);
                    float t = Mathf.Clamp01(stateTime / fuseTime);
                    Glow = 0.3f + 0.7f * t;
                    // 精英：引信烧到底的过程里越压越低、往后仰（顶住后坐），顶点箱口一点铜芒
                    strike?.Charge(0.25f + 0.75f * t, 0.13f, -9f);
                    if (strike != null && !glinted && t >= 0.85f)
                    {
                        glinted = true;
                        Fx.EliteCh3Glint(Muzzle, 1.1f);
                    }
                    if (stateTime >= fuseTime)
                    {
                        PickVolleyTargets(elite ? RocketsElite : Rockets);
                        Play("volley", 0.05f);
                        SetState("volley");
                        FireVolley();
                    }
                    break;
                }
                case "volley":
                    Stop();
                    Glow = 1f;
                    if (stateTime >= VolleyTime)
                    {
                        Play("recover", 0.1f);
                        SetState("recover");
                    }
                    break;
                case "stomp":
                    Stop();
                    FacePlayer(229, dt);
                    Glow = 0.3f;
                    if (!stompDone && stateTime >= Windup(StompTime, 0.3f))
                    {
                        stompDone = true;
                        ScatterRats();
                    }
                    if (!stompDone && strike != null)
                    {
                        // 精英：抬腿蓄力（拔高、后仰），顶点脚下一点铜芒
                        float st = stateTime / Mathf.Max(0.05f, Windup(StompTime, 0.3f));
                        strike.Charge(st, -0.08f, -7f);
                        if (!glinted && st >= 0.85f)
                        {
                            glinted = true;
                            Fx.EliteCh3Glint(transform.position + Vector3.up * 0.3f, 1f);
                        }
                    }
                    if (stateTime >= StompTime + 0.35f)
                    {
                        strike?.Relax();
                        ReleaseAttack();
                        ratCd = Random.Range(RatCdMin, RatCdMax);
                        PlayLocomotion();
                        SetState("march");
                    }
                    break;
                case "recover":
                    Stop();
                    FacePlayer(115, dt);
                    Glow = 0.15f;
                    strike?.Relax();
                    if (stateTime >= RecoverTime / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)))
                    {
                        ReleaseAttack();
                        if (cooldown <= 0.5f) RollCooldown(VolleyCdMin, VolleyCdMax);
                        PlayLocomotion();
                        SetState("march");
                    }
                    break;
                case "toppled":
                    // 哑炸后仰面倒地（输出窗口）
                    Stop();
                    Glow = 0;
                    if (stateTime >= ToppleTime)
                    {
                        Play("getup", 0.1f);
                        SetState("getup");
                    }
                    break;
                case "getup":
                    Stop();
                    if (stateTime >= GetupTime)
                    {
                        RollCooldown(3, 4);
                        PlayLocomotion();
                        SetState("march");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("march");
                    break;
            }
        }

        /// <summary>木偶步态：想移动时一步接一步；停下时把这一步迈完</summary>
        void StepGait(float dt)
        {
            bool wants = agent && agent.enabled && agent.isOnNavMesh && !agent.isStopped && agent.desiredVelocity.sqrMagnitude > 0.0025f;
            if (!wants && gait <= 0) return;
            gait += dt / (StepTime / Mathf.Sqrt(Mathf.Max(0.5f, SpeedMult)));
            if (gait >= 1) gait = wants ? gait - 1 : 0;
        }

        /// <summary>保持距离：太远走近到 20 m，太近带横移退开，区间内站定转向玩家</summary>
        void March(float d, float dt)
        {
            if (d > KeepMax)
            {
                var dir = (transform.position - PlayerPos);
                dir.y = 0;
                MoveTo(PlayerPos + dir.normalized * (KeepMax - 2), moveSpeed);
                FaceMovement(172, dt);
            }
            else if (d < KeepMin)
            {
                var away = transform.position - PlayerPos;
                away.y = 0;
                var side = new Vector3(-away.z, 0, away.x) * (strafe * 0.5f);
                MoveTo(transform.position + (away + side) * 0.5f, moveSpeed);
                FaceAimTravel(172, dt);
            }
            else
            {
                Stop();
                FacePlayer(126, dt);
            }
        }

        float strafe = 1, strafeTimer;

        protected override void Update()
        {
            strafeTimer -= Time.deltaTime;
            if (strafeTimer <= 0)
            {
                strafe = -strafe;
                strafeTimer = Random.Range(1.5f, 3.2f);
            }
            base.Update();
        }

        /// <summary>看不到玩家又在 24 m 外：去 12–22 m 环带里看得见的站位（返回 true = 这一帧在寻位）</summary>
        bool SeekSightGround()
        {
            var q = new SightQuery(PlayerPos, PlayerEye, transform.position, KeepMin, KeepMax, 1.5f * Size);
            if (!seeker.Tick(sees, Time.deltaTime, q)) return false;
            if (seeker.HasSpot)
            {
                MoveTo(seeker.Spot, moveSpeed);
                var to = seeker.Spot - transform.position;
                to.y = 0;
                if (to.magnitude <= seeker.arrive) seeker.Reached();
            }
            else MoveTo(PlayerPos, moveSpeed);
            return true;
        }

        // ───────────── 一窝蜂 ─────────────

        /// <summary>
        /// 落点：玩家预判位置（0.6 s）一处，其余按黄金角撒在玩家周围 1.8–6 m（彼此至少 1.7 m，离傀儡至少 3 m + 身体半径），都投到可走的地面上
        /// </summary>
        void PickVolleyTargets(int count)
        {
            var pv = player ? player.GetComponent<PlayerMotor>() : null;
            var vel = pv && !Taunted ? pv.Velocity : Vector3.zero;
            float a0 = Random.Range(0f, Mathf.PI * 2);
            PickTargets(PlayerPos, vel, transform.position, EnemyRegistry.BodyRadius(this), count, a0, () => Random.Range(-0.15f, 0.15f), ProjectToGround, targets);
        }

        /// <summary>候选点投到导航网格（2 m 内）并贴地</summary>
        static Vector3 ProjectToGround(Vector3 p)
        {
            if (UnityEngine.AI.NavMesh.SamplePosition(p, out var hit, 2f, UnityEngine.AI.NavMesh.AllAreas)) p = hit.position;
            return new Vector3(p.x, GroundY(p + Vector3.up * 2f), p.z);
        }

        /// <summary>
        /// 落点算法（纯函数，测试直接调）：第一处是玩家预判位置（速度 × 0.6 s），之后 40 个候选按黄金角（2.399963）+ jitter 撒在玩家周围
        /// 1.8–Spread 米；投影后离玩家超过 Spread + 0.3、离自己不到 3 + selfRadius、离已选落点不到 RocketGap 的跳过。返回选中的个数
        /// </summary>
        public static int PickTargets(Vector3 playerPos, Vector3 playerVel, Vector3 self, float selfRadius, int count, float a0,
            Func<float> jitter, Func<Vector3, Vector3> project, List<Vector3> results)
        {
            results.Clear();
            project ??= p => p;
            for (int i = -1; i < 40 && results.Count < count; i++)
            {
                Vector3 c;
                if (i < 0) c = new Vector3(playerPos.x + playerVel.x * 0.6f, playerPos.y, playerPos.z + playerVel.z * 0.6f);
                else
                {
                    float a = a0 + i * 2.399963f + (jitter != null ? jitter() : 0);
                    float r = 1.8f + ((i * 0.618034f + 0.3f) % 1f) * (Spread - 1.8f);
                    c = new Vector3(playerPos.x + Mathf.Sin(a) * r, playerPos.y, playerPos.z + Mathf.Cos(a) * r);
                }
                var q = project(c);
                if (FlatDist(q, playerPos) > Spread + 0.3f) continue;
                if (FlatDist(q, self) < 3 + selfRadius) continue;
                bool crowded = false;
                foreach (var o in results)
                    if (FlatDist(o, q) < RocketGap)
                    {
                        crowded = true;
                        break;
                    }
                if (crowded) continue;
                results.Add(q);
            }
            return results.Count;
        }

        static float FlatDist(Vector3 a, Vector3 b) => new Vector2(a.x - b.x, a.z - b.z).magnitude;

        /// <summary>各支火箭的落地时刻：1.3 s 起每隔 0.09 s 一支，打乱顺序（不总是先砸玩家脚下）</summary>
        public static float[] VolleyTimes(int n, Func<int, int> pick)
        {
            var t = new float[Mathf.Max(0, n)];
            for (int i = 0; i < t.Length; i++) t[i] = RocketFirst + i * RocketStagger;
            for (int i = t.Length - 1; i > 0; i--)
            {
                int j = Mathf.Clamp(pick != null ? pick(i) : i, 0, i);
                (t[i], t[j]) = (t[j], t[i]);
            }
            return t;
        }

        /// <summary>齐射：箱口的蜂窝管里依次冲出火箭</summary>
        void FireVolley()
        {
            var m = Muzzle;
            var from = new Vector3[targets.Count];
            for (int i = 0; i < from.Length; i++)
            {
                float a = i / Mathf.Max(1f, from.Length) * Mathf.PI * 2;
                from[i] = m + transform.right * (Mathf.Cos(a) * 0.12f * Size) + Vector3.up * (Mathf.Sin(a) * 0.1f * Size + 0.1f);
            }
            var spec = new Volley
            {
                from = from, targets = targets.ToArray(), times = VolleyTimes(targets.Count, i => Random.Range(0, i + 1)),
                radius = RocketRadius * (elite ? 1.1f : 1f), damage = Damage, source = this, scale = 1,
                fire = true, fireRadius = FloorFireRadius, fireTime = FloorFireTime, fireDamage = Damage * FloorFireMult,
            };
            LaunchVolley(spec);
            volleyAge = 0;
            Fx.Burst(m, Gold, 26, 9, 0.6f, 0.07f, 6);
            Fx.Burst(m, Soot, 10, 2.5f, 1.1f, 0.4f, -1.5f);
            CameraShake.Quake(m, 0.12f, 20f, 0.25f);
            // 精英：齐射那一帧被后坐顶得往后一仰、压扁，局部顿帧；箱口一喷铜火 + 一把红纸屑
            if (strike != null)
            {
                strike.Release(0.08f, -10f, 0.06f);
                Fx.EliteCh3Burst(m, Vector3.up + transform.forward * 0.4f, 1.2f, true);
                CameraShake.Quake(m, 0.12f, 20f, 0.2f);
            }
            GameAudio.PlayAt("shot_launcher", m, 0.9f, 1.3f);
            GameAudio.PlayAt("explosion", m, 0.4f, 1.8f);
        }

        /// <summary>哑炸：火药仓被打中，火箭在箱里炸开、四散乱飞（也炸伤同伴），傀儡仰面倒地</summary>
        void Dud()
        {
            var c = BellyCenter;
            GunpowderBlast(c, 1.2f, 0.8f);
            // 哑炸：肚子里的引信嗤嗤乱喷一阵（一串火星 + 黑烟），然后整个往后倒
            Fx.Burst(c, InfernoPalette.Gold, 18, 7f, 0.5f, 0.05f, 6f);
            Fx.Play("Soot", c + Vector3.up * 0.3f, Vector3.up, InfernoPalette.Soot, 1.2f);
            int n = elite ? RocketsElite : Rockets;
            var tg = new Vector3[n];
            var from = new Vector3[n];
            var times = new float[n];
            float a0 = Random.Range(0f, Mathf.PI * 2);
            for (int i = 0; i < n; i++)
            {
                float a = a0 + i * 2.399963f;
                float r = DudRingMin + ((i * 0.618034f + 0.2f) % 1f) * (DudRingMax - DudRingMin);
                tg[i] = ProjectToGround(transform.position + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r));
                from[i] = c;
                times[i] = 0.6f + i * 0.07f;
            }
            LaunchVolley(new Volley
            {
                from = from, targets = tg, times = times, radius = RocketRadius, damage = Damage * DudMult, source = this,
                enemyBase = DudEnemyBase * level * (elite ? 1.5f : 1f), knockback = DudKnock, rise = 4, riseTime = 0.3f, scale = 0.9f,
                fire = true, fireRadius = FloorFireRadius, fireTime = FloorFireTime, fireDamage = Damage * FloorFireMult,
            });
            ReleaseAttack();
            Play("toppled", 0.06f);
            SetState("toppled");
        }

        /// <summary>引信烧着时打中火药仓 → 哑炸（弱点命中离火药仓 0.45 m 内，或命中点离它 0.28 m 内，都乘体型）</summary>
        void OnHurt(DamageInfo info, DamageResult r)
        {
            if (Dead || state != "fuse" || r.immune) return;
            var p = info.point;
            if (!float.IsFinite(p.x + p.y + p.z)) return;
            float dist = Vector3.Distance(p, BellyCenter);
            if (DudHit(info.weakpoint, dist, Size)) Dud();
        }

        /// <summary>哑炸判定（纯函数）：弱点命中且离火药仓 ≤ 0.45 × 体型，或任何命中离它 ≤ (0.2 + 0.08) × 体型</summary>
        public static bool DudHit(bool weakpoint, float distToBelly, float size) =>
            (weakpoint && distToBelly <= 0.45f * size) || distToBelly <= (BellyR + 0.08f) * size;

        // ───────────── 地老鼠 ─────────────

        void ScatterRats()
        {
            var at = ModelPoint(new Vector3(0, 0.05f, 0.3f));
            float yaw = transform.eulerAngles.y * Mathf.Deg2Rad;
            FirecrackerRats.Spawn(at, Rats, RatLife, RatSpeed, RatRadius, Damage * RatMult, this, yaw);
            Fx.Burst(at, Gold, 16, 4, 0.4f, 0.05f, 4);
            // 精英：一脚跺下去压扁、前顿，局部顿帧；脚下铜色粗环 + 方铜渣崩一圈
            if (strike != null)
            {
                strike.Release(0.12f, 6f, 0.06f);
                Fx.EliteCh3Impact(transform.position, 1.6f * Size);
            }
            CameraShake.Quake(at, 0.1f, 14f, 0.2f);
            GameAudio.PlayAt("enemy_melee", at, 0.8f, 0.7f);
        }

        // ───────────── 打断 / 死亡 ─────────────

        protected override void CancelAttack()
        {
            strike?.Relax();
            if (fuseSpark) fuseSpark.gameObject.SetActive(false);
            // 已经射出去的火箭照样落下（预警随火箭兑现）
            if (!Dead && state is "brace" or "fuse" or "volley" or "stomp")
            {
                PlayLocomotion();
                SetState("march");
                RollCooldown(2, 3);
            }
        }

        /// <summary>死时火箭箱炸开：伤玩家（3.5 m 内）、炸飞其他敌人、引爆附近的火药怪；清场不炸</summary>
        void OnDeath(DamageInfo info)
        {
            if (fuseSpark) fuseSpark.gameObject.SetActive(false);
            if (detonated || EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            detonated = true;
            var c = BellyCenter;
            GunpowderBlast(c, BlastRadius, 1.5f);
            CameraShake.Quake(c, 0.35f, 24f, 0.3f);
            Blast.Player(c, BlastRadius, Damage * BlastMult, Element.Fire, this, 0.5f, 0.5f, 7);
            ExplosiveChain.Explode(new ExplosiveChain.Spec(c, BlastRadius, BlastBase * level * (elite ? 1.5f : 1f), BlastKnock, ExplosiveChain.Mode.Detonate, this));
        }

        // ───────────── 表现 ─────────────

        void LateUpdate()
        {
            if (!placed) return;
            float dt = Time.deltaTime;
            // 箱盖：扎马时弹开（欠阻尼弹簧：开到头回弹一下），收势 0.45 s 后合上
            bool open = !Dead && (state is "brace" or "fuse" or "volley" || (state == "recover" && stateTime < 0.45f));
            StepSpring(ref lidOpen, ref lidVel, open ? 1 : 0, 140f, 0.45f, dt);
            if (lidHinge) lidHinge.localRotation = Quaternion.Euler(-1.9f * Mathf.Clamp(lidOpen, -0.1f, 1.15f) * Mathf.Rad2Deg, 0, 0) * lidRest;
            // 引信火花沿导线烧下去，身后喷金色火星
            bool burning = !Dead && state == "fuse" && fuseLocal != null;
            float t = burning ? Mathf.Clamp01(stateTime / Mathf.Max(0.05f, fuseTime)) : -1;
            if (fuseSpark)
            {
                fuseSpark.gameObject.SetActive(burning);
                if (burning)
                {
                    fuseSpark.localPosition = AlongPath(fuseLocal, t);
                    fuseTrail -= dt;
                    if (fuseTrail <= 0)
                    {
                        fuseTrail = 0.04f;
                        Fx.Burst(fuseSpark.position, Gold, 2, 1.6f, 0.3f, 0.04f, 3);
                    }
                }
            }
            if (bellyGlow)
            {
                float recoil = volleyAge < 2 ? Mathf.Exp(-volleyAge * 6) : 0;
                bellyGlow.localScale = Vector3.one * (bellyBase * (1 + 0.6f * Mathf.Max(0, t) + 0.4f * recoil));
                bellyGlow.gameObject.SetActive(!Dead);
                SetGlow(1, recoil);
            }
        }

        Quaternion lidRest = Quaternion.identity;
        float bellyBase = 1;

        static void StepSpring(ref float x, ref float v, float target, float k, float zeta, float dt)
        {
            float h = Mathf.Min(dt, 1f / 30f);
            int n = Mathf.Max(1, Mathf.CeilToInt(dt / h));
            h = dt / n;
            float c = 2 * zeta * Mathf.Sqrt(k);
            for (int i = 0; i < n; i++)
            {
                v += (k * (target - x) - c * v) * h;
                x += v * h;
            }
        }

        /// <summary>折线上按长度 t（0..1）处的点</summary>
        public static Vector3 AlongPath(IReadOnlyList<Vector3> pts, float t)
        {
            if (pts == null || pts.Count == 0) return Vector3.zero;
            if (pts.Count == 1) return pts[0];
            float total = 0;
            for (int i = 1; i < pts.Count; i++) total += Vector3.Distance(pts[i - 1], pts[i]);
            float want = Mathf.Clamp01(t) * total;
            for (int i = 1; i < pts.Count; i++)
            {
                float seg = Vector3.Distance(pts[i - 1], pts[i]);
                if (want <= seg || i == pts.Count - 1) return Vector3.Lerp(pts[i - 1], pts[i], seg > 1e-5f ? Mathf.Clamp01(want / seg) : 1);
                want -= seg;
            }
            return pts[pts.Count - 1];
        }

        // ───────────── 火药（炮仗傀儡与神火飞鸦共用的外观 / 齐射） ─────────────

        /// <summary>
        /// 火药爆炸（外观，同 TS gunpowderBlast；FX4 起走 <see cref="Fx.Gunpowder"/>：火团、金色火星、红纸屑、黑火药烟、金环、焦痕，离地近时一圈火舌火柱）+ 爆炸声。
        /// 伤害由调用方结算。size 是旧接口的纸屑 / 火星量，折进规模
        /// </summary>
        public static void GunpowderBlast(Vector3 center, float radius, float size = 1)
        {
            if (!Application.isPlaying) return;
            Fx.Gunpowder(center, Mathf.Max(0.6f, radius) * Mathf.Lerp(0.85f, 1.1f, Mathf.InverseLerp(0.5f, 1.2f, size)), FireColor);
            GameAudio.PlayAt("explosion", center, Mathf.Min(1, 0.55f + 0.1f * radius), 1.15f);
        }

        /// <summary>一窝蜂齐射的参数（同 TS RocketVolleySpec）</summary>
        public struct Volley
        {
            /// <summary>每支火箭的出射点（少于火箭数时循环用）、落点（地面）与各自的落地时刻（从现在起，秒）</summary>
            public Vector3[] from, targets;
            public float[] times;
            /// <summary>爆炸半径、对玩家的伤害（已含倍率）</summary>
            public float radius, damage;
            public UnityEngine.Object source;
            /// <summary>顺带伤敌（哑炸乱飞的火箭）：对敌人的基础伤害与击退；0 = 不伤敌</summary>
            public float enemyBase, knockback;
            /// <summary>上升段：冲多高、飞多久（0 = 缺省 9 m / 0.55 s）</summary>
            public float rise, riseTime, scale;
            /// <summary>落点留残火（半径、持续、每 0.5 s 伤害）</summary>
            public bool fire;
            public float fireRadius, fireTime, fireDamage;
        }

        /// <summary>火箭从高空斜砸下来的最后一段（秒）与起始高度</summary>
        public const float RocketFall = 0.32f, RocketDrop = 13f;

        /// <summary>
        /// 一窝蜂（同 TS launchRocketVolley）：火箭从出射点冲上天（外观），各落点立刻亮出预警圈，按 times 依次从高空斜砸下来炸开。
        /// 发射者之后死了，已经射出去的照样落下；换关时 <see cref="HazardClock"/> 清空队列
        /// </summary>
        public static void LaunchVolley(Volley s)
        {
            if (s.targets == null) return;
            float k = s.scale > 0 ? s.scale : 1;
            float rise = s.rise > 0 ? s.rise : 9, riseTime = s.riseTime > 0 ? s.riseTime : 0.55f;
            int n = s.targets.Length;
            for (int i = 0; i < n; i++)
            {
                var tgt = s.targets[i];
                var from = s.from != null && s.from.Length > 0 ? s.from[i % s.from.Length] : tgt;
                // 上升段（外观）：稍微朝落点方向斜出，带火星尾迹
                var flat = new Vector3(tgt.x - from.x, 0, tgt.z - from.z);
                var dir = flat.sqrMagnitude > 1e-4f ? flat.normalized : Vector3.forward;
                float spread = 1.6f + i % 3 * 0.5f;
                var v = dir * spread + new Vector3(Mathf.Sin(i * 2.4f) * 0.8f, rise / riseTime, Mathf.Cos(i * 2.4f) * 0.8f);
                int idx = i;
                HazardClock.Delay(idx * 0.05f, () => RocketVisual(from, v, riseTime, 0.14f * k));
                float at = Mathf.Max(RocketFall + 0.12f, s.times != null && i < s.times.Length ? s.times[i] : 1.4f);
                if (Application.isPlaying) Telegraph.Circle(tgt, s.radius, at, Warn);
                var spec = s;
                HazardClock.Delay(at - RocketFall, () =>
                {
                    // 斜着砸下来：从落点上方、偏一侧的高空沿直线落到落点
                    float side = (idx % 2 == 0 ? 1 : -1) * 2.5f;
                    var start = new Vector3(tgt.x + side, tgt.y + RocketDrop, tgt.z + side * 0.6f);
                    RocketVisual(start, (tgt - start) / RocketFall, RocketFall * 0.95f, 0.16f * k);
                });
                HazardClock.Delay(at, () => RocketImpact(tgt, spec, k));
            }
        }

        /// <summary>火箭外观：不伤人的投射物（"rocket" 造型，伤害 0、不被挡弹区吃掉）</summary>
        static void RocketVisual(Vector3 from, Vector3 velocity, float life, float radius)
        {
            if (!Application.isPlaying) return;
            EnemyProjectile.Spawn(new EnemyProjectileSpec(from, velocity, 0, radius, life)
            {
                visual = "rocket", color = Gold, blockable = false,
            });
        }

        /// <summary>一支火箭落地：伤玩家（火，边缘 50%）、可选顺带伤敌（延后 0.02 s，不在别的结算里递归）、火药爆炸、残火</summary>
        public static void RocketImpact(Vector3 ground, in Volley s, float k = 1)
        {
            var c = ground + Vector3.up * 0.35f;
            var src = s.source ? s.source : null;
            Blast.Player(c, s.radius, s.damage, Element.Fire, src, 0.5f, 0.25f, 4.5f);
            if (s.enemyBase > 0)
            {
                float b = s.enemyBase, kb = s.knockback > 0 ? s.knockback : 4, r = s.radius;
                HazardClock.Delay(0.02f, () =>
                {
                    if (!EnemyRegistry.Purging) Blast.Enemies(c, r, b, kb, 0.5f, null, src ? src : null);
                });
            }
            GunpowderBlast(c, s.radius * 0.9f, 0.7f * k);
            if (s.fire && s.fireTime > 0 && Application.isPlaying) FloorFire.Spawn(ground, s.fireRadius, s.fireTime, s.fireDamage, 0.5f, src, look: FireBed.PaperAsh);
        }
    }

    /// <summary>
    /// 地老鼠烟花（TS spawnGroundRats）：一把小纸炮从脚下扇形撒出去，贴地乱窜追玩家的脚（蛇形摆动、转向有限，比玩家跑得慢），
    /// 碰到脚（水平 0.75 m 内、高差 0.9 m 内——跳起来就躲开）或寿命到了就炸。撞墙 / 台阶太高就拐开。外观借投射物的 rocket 造型
    /// </summary>
    [AddComponentMenu("")]
    public sealed class FirecrackerRats : MonoBehaviour
    {
        /// <summary>碰脚的水平距离与高差（米）、追脚的转向速率（弧度 / 秒）、先按撒出方向冲多久</summary>
        public const float Touch = 0.75f, TouchDy = 0.9f, Turn = 4.5f, Launch = 0.25f;

        sealed class Rat
        {
            public Vector3 pos;
            public float yaw, phase, age;
            public bool done;
            public ProjectileView view;
        }

        readonly List<Rat> rats = new();
        float life, speed, radius, damage, puff;
        UnityEngine.Object source;

        /// <summary>存活数量（测试 / 调试）</summary>
        public int Alive
        {
            get
            {
                int n = 0;
                foreach (var r in rats)
                    if (!r.done)
                        n++;
                return n;
            }
        }

        /// <summary>撒出 count 个地老鼠（yaw = 初始朝向，弧度，0 = +Z），扇形展开 ±1.1 弧度</summary>
        public static FirecrackerRats Spawn(Vector3 from, int count, float life, float speed, float radius, float damage, UnityEngine.Object source, float yaw)
        {
            var go = new GameObject("Ground Rats");
            var s = go.AddComponent<FirecrackerRats>();
            s.life = life;
            s.speed = speed;
            s.radius = radius;
            s.damage = damage;
            s.source = source;
            for (int i = 0; i < count; i++)
            {
                float spread = count > 1 ? (i / (count - 1f) - 0.5f) * 2.2f : 0;
                var r = new Rat { pos = from, yaw = yaw + spread, phase = i * 1.7f };
                if (Application.isPlaying)
                {
                    r.view = ProjectileVisuals.Acquire("rocket");
                    var look = new ProjectileLook
                    {
                        color = FirecrackerAI.Paper, hostile = true, size = ProjectileVisuals.ViewSize("rocket", 0.07f, 1f), coreBoost = 1.2f,
                        trailWidth = 0.08f, trailTime = 0.2f, trailColor = new Color(1f, 0.78f, 0.31f, 0.9f),
                    };
                    r.view.Setup(look, from, Heading(r.yaw));
                }
                s.rats.Add(r);
            }
            return s;
        }

        static Vector3 Heading(float yaw) => new(Mathf.Sin(yaw), 0, Mathf.Cos(yaw));

        void Update() => Step(Time.deltaTime);

        /// <summary>推进 dt 秒（Update 调用；测试可直接调）</summary>
        public void Step(float dt)
        {
            if (dt <= 0) return;
            var pv = PlayerVitals.Instance;
            bool alive = pv && !pv.Dead;
            var pl = alive ? pv.transform.position : Vector3.zero;
            puff += dt;
            bool sparkle = puff > 0.05f;
            if (sparkle) puff = 0;
            int live = 0;
            foreach (var r in rats)
            {
                if (r.done) continue;
                r.age += dt;
                // 追脚：先按撒出方向冲 0.25 s，之后朝玩家脚下转（转向有限），叠加蛇形摆动
                if (r.age > Launch && alive)
                {
                    float want = Mathf.Atan2(pl.x - r.pos.x, pl.z - r.pos.z);
                    float d = Mathf.DeltaAngle(r.yaw * Mathf.Rad2Deg, want * Mathf.Rad2Deg) * Mathf.Deg2Rad;
                    r.yaw += Mathf.Clamp(d, -Turn * dt, Turn * dt);
                }
                float yaw = r.yaw + Mathf.Sin(r.age * 13 + r.phase) * 0.9f;
                var next = r.pos + Heading(yaw) * (speed * dt);
                var a = r.pos + Vector3.up * 0.2f;
                var b = next + Vector3.up * 0.2f;
                if (Physics.Linecast(a, b, Layers.WorldMask, QueryTriggerInteraction.Ignore)) r.yaw += Mathf.PI * 0.6f;
                else
                {
                    float gy = Physics.Raycast(next + Vector3.up * 0.6f, Vector3.down, out var hit, 3f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : r.pos.y;
                    if (gy - r.pos.y < 0.5f) r.pos = new Vector3(next.x, gy, next.z);
                    else r.yaw += Mathf.PI * 0.6f;
                }
                if (r.view) r.view.Pose(r.pos + Vector3.up * 0.08f, Heading(yaw), r.age, life, dt, 1f);
                if (sparkle && Application.isPlaying) Fx.Burst(r.pos + Vector3.up * 0.12f, FirecrackerAI.Gold, 1, 1.5f, 0.25f, 0.05f, 2);
                float dx = pl.x - r.pos.x, dz = pl.z - r.pos.z;
                bool touch = alive && dx * dx + dz * dz < Touch * Touch && Mathf.Abs(pl.y - r.pos.y) < TouchDy;
                if (touch || r.age >= life)
                {
                    r.done = true;
                    var c = r.pos + Vector3.up * 0.25f;
                    Blast.Player(c, radius, damage, Element.Fire, source ? source : null, 0.6f, 0.15f, 3);
                    FirecrackerAI.GunpowderBlast(c, radius * 0.8f, 0.45f);
                    if (r.view) r.view.Release();
                    r.view = null;
                    continue;
                }
                live++;
            }
            if (live == 0 && Application.isPlaying) Destroy(gameObject);
        }

        void OnDestroy()
        {
            foreach (var r in rats)
                if (r.view)
                    r.view.Release();
        }
    }
}
