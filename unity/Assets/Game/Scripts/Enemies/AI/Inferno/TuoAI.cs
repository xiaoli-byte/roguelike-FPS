using System;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火鼍（Three.js 版 src/enemies/types/Tuo.ts + inferno/lavaSwim.ts）：第三章坦克，熔岩河里的巨鳄（<see cref="ILavaDweller"/>：熔岩不烧它、不托回）。
    ///   潜熔：沉进熔岩只露脊背和两眼（根节点降到熔岩面以下 1.0 × 体型），在熔岩里游（7 m/s，沿熔岩找离玩家最近的岸，
    ///         走不通就左右偏转绕开岸角），拖出熔岩波纹；这时一律 ×0.5。
    ///   伏击扑咬：玩家在岸边（不在熔岩上）、7 m 内：岸边熔岩鼓泡 0.6 s（地上品红扑击线，前 60% 跟着玩家）→ 冲上岸扑咬 ×1.5（14 m/s，≤ 0.55 s）；
    ///         玩家一直躲着岸边（11 m 外）超过 8 s，它也自己爬上岸来找人。
    ///   岩甲：背上 8 块玄武岩甲（左右两列 × 前后四排），整体 ×0.25；每块甲有血（最大生命 10%，按减伤前算），打碎一块那里露出熔肉 ×2。
    ///         分区：甲中心挂在 chest / spine / hips 骨上的触发球（忽略射线层，只按命中点分区）；碎甲的熔肉发光走 FX4 分区遮罩
    ///         （<see cref="RegionMask"/>：导入后处理按绑定姿势烘的 8 块甲区，SF_StylizedLit 把碎了的那块压暗成熔肉、透出脉动的熔岩光；遮罩还没烘时退回程序化光球）。
    ///   回熔：碎够 3 块、或上岸 7 s（伏击上岸的 12 s）后，附近有熔岩就爬回去；碎甲 5 s 内一块块长回来（先红后黑），然后接着潜游伏击。
    ///   甩尾：玩家在侧后 5.2 m 内：尾巴蓄 0.55 s（身后半圈预警）→ 横扫 ×0.8，击退约 4 m，优先扫向 7 m 内最近的熔岩（掉进熔岩归熔岩系统结算）；起跳躲得过。
    ///   陆上扑咬：3.1 m 内、正对：0.45 s 前摇 → 咬 ×1。鼍鸣：生命第一次低于 40%（在岸上时）：仰头 0.8 s → 贴地震波 10 m（16 m/s，×0.6 火伤，跳起可躲），
    ///         附近岸边溅起 5 处燃烧的火点。弱点：脊背中段的熔岩接缝（×0.5 + 暴击）。
    ///   移动：岸上走导航网格；进出熔岩、潜游、扑击时停掉导航代理，脚本推着走（贴熔岩面 / 地面），回到岸上再把代理放回导航网格。
    /// 没有熔岩（<see cref="InfernoKit.Lava"/> 是兜底）时只在岸上当陆上坦克打。
    /// 状态：enter → toLava →（regrow →）swim → surge → lunge → bite → land；land → biteWindup → bite / sweepWindup → sweep / roar → land；land → toLava。
    /// </summary>
    public sealed class TuoAI : InfernoEnemyAI, ILavaDweller
    {
        /// <summary>伤害倍率：完好的岩甲、碎甲熔肉、脊背接缝、潜熔</summary>
        public const float PlateArmor = 0.25f, FleshFactor = 2f, SeamFactor = 0.5f, SubmergedFactor = 0.5f;
        /// <summary>每块岩甲的血量（最大生命的比例，按减伤前的伤害算）、块数、碎多少块回熔</summary>
        public const float PlateHpFrac = 0.1f;
        public const int Plates = 8, RetreatBroken = 3;
        /// <summary>陆上：转身角速度（弧度/秒）、停步距离</summary>
        public const float TurnRate = 1.3f, StopDist = 2.6f;
        /// <summary>熔岩里：游速、转身、重选航向间隔、伏击距离、扑不到人多久自己上岸
        /// （TS 只在玩家躲到 11 m 外才累计，7–11 m 之间它既不扑也不上岸、一直潜着吃半伤；这里只要扑不到就累计，且等得更短）</summary>
        public const float SwimSpeed = 7, SwimTurn = 3.2f, Replan = 0.25f, AmbushRange = 7, EmergeAfter = 5;
        /// <summary>伏击：鼓泡前摇、扑击速度与最长时间、命中距离、倍率</summary>
        public const float SurgeTime = 0.6f, LungeSpeed = 14, LungeMax = 0.55f, AmbushReach = 3.4f, AmbushMult = 1.5f;
        /// <summary>陆上扑咬：触发距离、命中距离、前摇</summary>
        public const float BiteRange = 3.1f, BiteReach = 3.6f, BiteWindup = 0.45f;
        /// <summary>甩尾：触发距离、命中距离、前摇、倍率、击退（水平 / 上抛）、找熔岩的距离</summary>
        public const float SweepRange = 5.2f, SweepReach = 5.6f, SweepWindup = 0.55f, SweepMult = 0.8f, SweepKnock = 10, SweepUp = 3.5f, SweepLavaSeek = 7;
        /// <summary>鼍鸣：血量阈值、前摇、震波半径与速度、倍率、火点（个数、半径、持续）</summary>
        public const float RoarHp = 0.4f, RoarWindup = 0.8f, RoarRadius = 10, RoarSpeed = 16, RoarMult = 0.6f, FireSpotR = 1.3f, FireSpotTime = 4;
        public const int FireSpots = 5;
        /// <summary>回熔长甲时长、上岸后多久回熔岩（伏击上岸的更久）、找熔岩的距离、潜下去的深度（模型单位）</summary>
        public const float RegrowTime = 5, LandStay = 7, LandStayEmerged = 12, LavaSeek = 20, Sink = 1.0f;

        /// <summary>岩甲分区：四排（网格 Z 区间，前 → 后）× 左右两列，挂的骨骼</summary>
        static readonly Vector2[] PlateBands = { new(0.85f, 1.35f), new(0.35f, 0.85f), new(-0.15f, 0.35f), new(-0.65f, -0.15f) };
        static readonly string[] PlateBones = { "chest", "spine", "spine", "hips" };
        static readonly Vector3 SeamPoint = new(0, 1.55f, 0.45f);

        public bool SwimsInLava => true;
        /// <summary>潜在熔岩里（只露脊背和眼）：一律 ×0.5</summary>
        public bool Submerged => !Dead && state is "swim" or "regrow" or "surge";
        /// <summary>每块岩甲剩余血量 / 碎了没有 / 熔肉热度（1 = 刚碎，回熔时降到 0）</summary>
        public readonly float[] PlateHp = new float[Plates], PlateHeat = new float[Plates];
        public readonly bool[] Broken = new bool[Plates];
        /// <summary>最近一次咬 / 甩尾打中了玩家（测试 / 冒烟用）</summary>
        public bool Struck { get; private set; }
        /// <summary>导航代理停着、脚本推着走（进出熔岩、潜游、扑击）</summary>
        public bool Free { get; private set; }

        public int BrokenCount
        {
            get
            {
                int n = 0;
                foreach (bool b in Broken)
                    if (b)
                        n++;
                return n;
            }
        }

        readonly HitZone[] plates = new HitZone[Plates];
        readonly Renderer[] plateGlow = new Renderer[Plates];
        RegionMask region;
        float windTime = BiteWindup, ambushCd, biteCd = 0.8f, sweepCd = 1, landTime, shoreWait, replanAt, swimYaw, rippleAt, sweepSide = 1, sweepYaw;
        float roarAt = -1;
        bool roared, emerged, hasBank, alerted;
        Vector3 lungeTarget, bank;
        TelegraphHandle lane, ring;
        IDisposable armour;

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.2f, 0.05f, 2.4f, 0.8f, false);
            InfernoKit.PlaceWeak(body, "spine", SeamPoint, 0.3f);
            for (int i = 0; i < Plates; i++)
            {
                var band = PlateBands[i >> 1];
                var at = new Vector3(i % 2 == 0 ? 0.3f : -0.3f, 1.45f, (band.x + band.y) * 0.5f);
                var z = InfernoKit.AddSphereZone(body, PlateBones[i >> 1], at, 0.42f, "plate_" + i, false, 5, false);
                plates[i] = z;
                if (!z) continue;
                int idx = i;
                z.Damaged += (zone, info, r) => OnPlateHit(idx, info, r);
                float k = 0.32f * 2f * Mathf.Abs(transform.lossyScale.x) / Mathf.Max(1e-3f, Mathf.Abs(z.transform.lossyScale.x));
                plateGlow[i] = InfernoKit.Primitive(PrimitiveType.Sphere, "Molten", z.transform, Vector3.zero, new Vector3(k, k * 0.45f, k), Color.black, true);
            }
            armour = hp.Incoming.Add(ArmourIncoming);
            hp.Died += OnTuoDied;
            // FX4：岩甲分区遮罩（有就用，程序化光球收起来）
            if (Application.isPlaying && !GetComponent<PlaceholderBody>())
            {
                region = RegionMask.Plates(this, "T_Enemy_Tuo");
                if (region && region.Renderers > 0)
                {
                    foreach (var r in plateGlow)
                        if (r)
                            r.enabled = false;
                }
                else region = null;
            }
        }

        protected override void Start()
        {
            base.Start();
            for (int i = 0; i < Plates; i++) PlateHp[i] = hp.maxHealth * PlateHpFrac;
            ambushCd = Rand(0.6f, 1.2f);
        }

        protected override string InitialState => "enter";

        /// <summary>这一击的倍率（纯函数，测试用）：持续伤害 1；潜熔 0.5；碎甲熔肉 2；脊背接缝 0.5；其余（完好的岩甲）0.25</summary>
        public static float ArmourFactor(bool status, bool submerged, bool brokenPlate, bool seam) =>
            status ? 1f : submerged ? SubmergedFactor : brokenPlate ? FleshFactor : seam ? SeamFactor : PlateArmor;

        float ArmourIncoming(in IncomingHit h)
        {
            if (Dead) return 1;
            var info = h.info;
            var z = body.ZoneAt(info);
            int plate = Array.IndexOf(plates, z);
            return ArmourFactor(info.source == DamageSource.Status, Submerged, plate >= 0 && Broken[plate], info.weakpoint || (z && z == body.WeakZone));
        }

        /// <summary>甲上挨了一下：按减伤前的伤害扣这块甲的血，扣完碎甲（潜熔时打不碎）</summary>
        void OnPlateHit(int i, DamageInfo info, DamageResult r)
        {
            if (Dead || Submerged || info.source == DamageSource.Status || Broken[i] || r.total <= 0) return;
            PlateHp[i] -= r.total / PlateArmor;
            if (PlateHp[i] <= 0) BreakPlate(i);
        }

        /// <summary>打碎一块岩甲：碎石 + 熔岩飞溅，那一区改成熔肉发光</summary>
        public void BreakPlate(int i)
        {
            if (i < 0 || i >= Plates || Broken[i]) return;
            Broken[i] = true;
            PlateHp[i] = 0;
            PlateHeat[i] = 1;
            if (region) region.SetPlate(i, 1);
            var p = plates[i] ? plates[i].transform.position : transform.position + Vector3.up * 1.5f * Size;
            // FX4：玄武岩甲崩碎 + 熔岩从下面溅出来（同 TS basaltShards + moltenSplash）
            Fx.Basalt(p, 1.2f * Size);
            Fx.MoltenSplash(p, 0.9f * Size, InfernoKit.LavaColor);
            GameAudio.PlayAt("shield_break", p, 0.9f, 0.55f);
            CameraShake.Add(0.15f, 0.15f);
        }

        // ───────────── 移动方式：导航 / 脚本 ─────────────

        /// <summary>停掉导航代理，脚本推着走（基类的寻路、离网回收、击退都不再动它）</summary>
        void GoFree()
        {
            if (Free) return;
            Free = true;
            if (agent.enabled)
            {
                if (agent.isOnNavMesh) agent.isStopped = true;
                agent.enabled = false;
            }
        }

        /// <summary>回到导航网格（4 m 内找；找不到就留在脚本模式，下一帧再试）</summary>
        bool Land()
        {
            if (!Free) return true;
            if (!NavMesh.SamplePosition(transform.position, out var hit, 4f, NavMesh.AllAreas)) return false;
            Free = false;
            transform.position = hit.position;
            agent.enabled = true;
            agent.Warp(hit.position);
            agent.updatePosition = true;
            var loco = GetComponent<Spiritfire.Art.CreatureLocomotion>();
            if (loco) loco.Teleported();
            return true;
        }

        /// <summary>
        /// 脚本位移：水平按 vel 走（撞墙停下），高度贴熔岩面（潜熔时再往下沉 1.0 × 体型）或地面，按 12/s 追，不穿地
        /// </summary>
        void FreeMove(Vector3 vel, float dt, bool sunk)
        {
            var p = transform.position;
            var lava = InfernoKit.Lava;
            var step = new Vector3(vel.x, 0, vel.z) * dt;
            if (step.sqrMagnitude > 1e-8f)
            {
                float surf = lava.SurfaceY(p);
                var origin = new Vector3(p.x, (float.IsFinite(surf) ? Mathf.Max(surf, p.y) : p.y) + 0.6f, p.z);
                if (Physics.Raycast(origin, step.normalized, out var wall, step.magnitude + 0.6f * Size, Layers.WorldMask, QueryTriggerInteraction.Ignore) && wall.normal.y < 0.5f)
                {
                    step = Vector3.zero;
                    HitWall = true;
                }
            }
            p += step;
            float ty = p.y;
            float s = lava.SurfaceY(p);
            if (float.IsFinite(s)) ty = s - (sunk ? Sink * Size : 0);
            else
            {
                float g = InfernoKit.GroundAt(p, Mathf.Max(p.y, ty) + 1f, 8f);
                if (float.IsFinite(g)) ty = g;
            }
            p.y = Mathf.Lerp(p.y, ty, 1 - Mathf.Exp(-12f * dt));
            if (!sunk)
            {
                float g = InfernoKit.GroundAt(p, p.y + 1f, 3f);
                if (float.IsFinite(g) && p.y < g) p.y = g;
            }
            transform.position = p;
        }

        // ───────────── 思考 ─────────────

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            ambushCd -= dt * auraAttackRate;
            biteCd -= dt * auraAttackRate;
            sweepCd -= dt * auraAttackRate;
            if (!alerted && d < 28)
            {
                alerted = true;
                Sfx("enemy_alert", 0.8f, 0.4f);
            }
            UpdatePlateGlow();
            // 鼍鸣：生命第一次低于 40%（在岸上、不在出招中）
            if (!roared && hp.health <= hp.maxHealth * RoarHp && state == "land")
            {
                BeginRoar();
                return;
            }
            switch (state)
            {
                case "enter":
                    Enter();
                    break;
                case "toLava":
                    ToLavaStep(dt);
                    break;
                case "swim":
                    SwimStep(dt, d);
                    break;
                case "regrow":
                    RegrowStep(dt);
                    break;
                case "surge":
                    SurgeStep(dt);
                    break;
                case "lunge":
                    LungeStep(dt, d);
                    break;
                case "land":
                    LandStep(dt, d);
                    break;
                case "biteWindup":
                    Stop();
                    TurnTo(YawToTarget, 2, dt);
                    if (stateTime >= windTime) Bite(false);
                    break;
                case "bite":
                    if (Free) FreeMove(Vector3.zero, dt, false);
                    else Stop();
                    if (stateTime >= 0.45f) AfterBite();
                    break;
                case "sweepWindup":
                    Stop();
                    if (stateTime >= windTime) Sweep();
                    break;
                case "sweep":
                    Stop();
                    if (stateTime >= 0.45f) ToLand();
                    break;
                case "roar":
                    RoarStep(dt);
                    break;
                default:
                    ToLand();
                    break;
            }
        }

        /// <summary>出生 / 眩晕醒来 / 玩家复活后：还在熔岩里就接着游；附近有熔岩就爬过去；否则上岸</summary>
        void Enter()
        {
            var lava = InfernoKit.Lava;
            if (lava.IsLava(transform.position))
            {
                GoFree();
                bool regrow = BrokenCount > 0;
                Act(regrow ? "regrow" : "swim", 0.2f);
                SetState(regrow ? "regrow" : "swim");
                return;
            }
            // 原本在岸上打（被眩晕、玩家复活）：接着在岸上打，等上岸时限到了再回熔岩
            bool wasOnLand = landTime > 0 && landTime < (emerged ? LandStayEmerged : LandStay) && BrokenCount < RetreatBroken;
            if (!wasOnLand && lava.NearestLava(transform.position, LavaSeek, out _))
            {
                Act("toLava", 0.15f);
                SetState("toLava");
            }
            else ToLand();
        }

        void ToLand()
        {
            HideWarnings();
            ReleaseAttack();
            if (!Land() && InfernoKit.Lava.IsLava(transform.position))
            {
                // 还在熔岩上、附近没有岸：回去游
                SetState("swim");
                Act("swim", 0.2f);
                return;
            }
            // 回到导航网格了；或者在岸上但离网格还远（LandStep 里脚本推着往玩家那边挪，直到落回网格）
            Loco();
            SetState("land");
        }

        void HideWarnings()
        {
            lane.FadeOut();
            ring.FadeOut();
        }

        // ───────────── 熔岩：回熔、潜游、长甲 ─────────────

        /// <summary>爬回熔岩：先沿导航走到最近的岸，再直线滑进去</summary>
        void ToLavaStep(float dt)
        {
            var lava = InfernoKit.Lava;
            if (!lava.NearestLava(transform.position, LavaSeek + 10, out var t))
            {
                ToLand();
                return;
            }
            if (lava.IsLava(transform.position))
            {
                Submerge();
                return;
            }
            var to = t - transform.position;
            to.y = 0;
            float dist = to.magnitude;
            if (!Free && dist > 3.5f && stateTime < 4f)
            {
                MoveTo(t, moveSpeed * 1.3f);
                FaceMovement(TurnRate * 1.5f * Mathf.Rad2Deg, dt);
                return;
            }
            GoFree();
            if (dist > 1e-3f)
            {
                TurnTo(InfernoKit.Yaw(to), TurnRate * 1.5f, dt);
                FreeMove(to / dist * (moveSpeed * 1.6f * SpeedMult), dt, false);
            }
            if (stateTime > 9f) ToLand();
        }

        /// <summary>滑进熔岩：熔岩溅起；有碎甲就先长甲，否则直接潜游</summary>
        void Submerge()
        {
            HideWarnings();
            ReleaseAttack();
            GoFree();
            emerged = false;
            shoreWait = 0;
            replanAt = 0;
            landTime = 0;
            var p = transform.position + Vector3.up * 0.2f;
            Fx.MoltenSplash(p, 1.3f * Size, InfernoKit.LavaColor);
            Fx.Ring(p, 2.2f * Size, InfernoKit.LavaColor, 0.5f);
            GameAudio.PlayAt("skill_fire", p, 0.8f, 0.5f);
            if (BrokenCount > 0)
            {
                Act("regrow", 0.2f);
                SetState("regrow");
            }
            else
            {
                Act("swim", 0.2f);
                SetState("swim");
            }
        }

        /// <summary>熔岩里：朝离玩家最近的熔岩游（走不通就左右偏开）；玩家在岸边够近就伏击，扑不到人太久就自己上岸</summary>
        void SwimStep(float dt, float d)
        {
            var lava = InfernoKit.Lava;
            GoFree();
            ActLoop("swim");
            Ripple();
            bool playerOnLava = lava.IsLava(PlayerPos);
            bool canAmbush = !playerOnLava && d <= AmbushRange && VerticalReach(2.5f);
            if (ambushCd <= 0 && vitals && !vitals.Dead && canAmbush
                && RequestAttack(AttackTokens.Kind.Heavy, SurgeTime + LungeMax + 1))
            {
                BeginSurge(false);
                return;
            }
            // 扑不到（伏击距离外、高差太大、玩家站在熔岩上）就累计；够得着时慢慢回落
            shoreWait = canAmbush ? Mathf.Max(0, shoreWait - dt * 0.5f) : shoreWait + dt;
            if (shoreWait >= EmergeAfter && RequestAttack(AttackTokens.Kind.Heavy, SurgeTime + LungeMax + 1))
            {
                BeginSurge(true);
                return;
            }
            var p = transform.position;
            if (!lava.IsLava(p))
            {
                // 被挤上岸：回到最近的熔岩；附近没有就上岸
                if (lava.NearestLava(p, 6, out var back))
                {
                    var b = back - p;
                    b.y = 0;
                    FreeMove(b.normalized * (SwimSpeed * 0.5f), dt, true);
                }
                else ToLand();
                return;
            }
            replanAt -= dt;
            if (replanAt <= 0)
            {
                replanAt = Replan;
                var target = lava.NearestLava(PlayerPos, 14, out var near) ? near : PlayerPos;
                swimYaw = SwimHeading(lava, p, target, Facing, 2.5f * Size, out bool arrived);
                if (arrived) swimYaw = float.NaN;
            }
            if (float.IsNaN(swimYaw))
            {
                FreeMove(Vector3.zero, dt, true);
                TurnTo(YawToTarget, SwimTurn * 0.5f, dt);
                return;
            }
            TurnTo(swimYaw, SwimTurn, dt);
            // 先转向再加速：大角度转弯时慢下来
            float align = Mathf.Max(0.25f, Mathf.Cos(InfernoKit.WrapRad(swimYaw - Facing)));
            var v = transform.forward * (SwimSpeed * align * SpeedMult);
            // 不游出熔岩
            if (!lava.IsLava(p + v * Mathf.Max(dt * 3, 0.15f))) v = Vector3.zero;
            FreeMove(v, dt, true);
        }

        /// <summary>
        /// 熔岩里的航向（纯函数，测试用）：朝 target，直线 probe 米内不全是熔岩就依次试 ±0.4、±0.8 … ±2.6 弧度的偏转，挑第一个全是熔岩的；
        /// 都不行时朝 current（原地转）。离 target 1 m 内 arrived = true
        /// </summary>
        public static float SwimHeading(ILavaQuery lava, Vector3 from, Vector3 target, float current, float probe, out bool arrived)
        {
            var to = target - from;
            to.y = 0;
            arrived = to.magnitude < 1f;
            if (arrived) return current;
            float want = InfernoKit.Yaw(to);
            float reach = Mathf.Min(probe, to.magnitude);
            if (InfernoKit.AllLava(lava, from, from + InfernoKit.YawDir(want) * reach, 0.25f)) return want;
            for (int k = 1; k <= 6; k++)
            {
                float off = 0.4f * k + (k == 6 ? 0.2f : 0);
                foreach (float s in new[] { 1f, -1f })
                {
                    float a = want + off * s;
                    if (InfernoKit.AllLava(lava, from, from + InfernoKit.YawDir(a) * probe, 0.25f)) return a;
                }
            }
            return current;
        }

        /// <summary>潜熔时拖出的熔岩波纹</summary>
        void Ripple()
        {
            if (Time.time - rippleAt < 0.3f) return;
            rippleAt = Time.time;
            float s = InfernoKit.Lava.SurfaceY(transform.position);
            var p = Local(0, 0, -0.6f);
            p.y = (float.IsFinite(s) ? s : transform.position.y) + 0.06f;
            Fx.Ring(p, 1.1f * Size, InfernoKit.LavaColor, 0.6f, false);
            Fx.Burst(p, InfernoKit.Ember, 3, 1.5f, 0.5f, 0.08f, -2);
        }

        /// <summary>回熔长甲：5 s 内碎甲一块块长回来（错开，先红后黑）</summary>
        void RegrowStep(float dt)
        {
            FreeMove(Vector3.zero, dt, true);
            Ripple();
            float t = Mathf.Clamp01(stateTime / RegrowTime);
            int k = 0;
            for (int i = 0; i < Plates; i++)
            {
                if (!Broken[i]) continue;
                float start = (k * 0.12f) % 0.4f;
                PlateHeat[i] = 1 - InfernoKit.Smooth((t - start) / (1 - start));
                k++;
            }
            if (Mathf.Floor(stateTime / 0.4f) != Mathf.Floor((stateTime - dt) / 0.4f))
                Fx.Burst(transform.position + Vector3.up * (Sink + 0.3f) * Size, InfernoKit.Ember, 4, 1.6f, 0.6f, 0.1f, -3);
            if (stateTime >= RegrowTime)
            {
                for (int i = 0; i < Plates; i++)
                {
                    Broken[i] = false;
                    PlateHeat[i] = 0;
                    PlateHp[i] = hp.maxHealth * PlateHpFrac;
                    if (plates[i]) plates[i].ResetCount();
                }
                Act("swim", 0.2f);
                SetState("swim");
                replanAt = 0;
            }
        }

        void UpdatePlateGlow()
        {
            if (region)
            {
                for (int i = 0; i < Plates; i++) region.SetPlate(i, PlateHeat[i]);
                return;
            }
            for (int i = 0; i < Plates; i++)
            {
                var r = plateGlow[i];
                if (!r) continue;
                float h = PlateHeat[i];
                var c = Color.Lerp(new Color(0.6f, 0.07f, 0.01f), new Color(1f, 0.62f, 0.16f), Mathf.InverseLerp(0.5f, 1f, h));
                FxMaterials.Tint(r, h > 0.001f ? c * (h * (0.75f + 0.18f * Mathf.Sin(Time.time * 5 + i * 1.7f))) : Color.black);
            }
        }

        // ───────────── 伏击扑咬 ─────────────

        void BeginSurge(bool emerge)
        {
            windTime = Windup(SurgeTime, 0.45f);
            emerged = emerge;
            shoreWait = 0;
            Struck = false;
            lungeTarget = PlayerPos;
            hasBank = InfernoKit.Lava.ShoreToward(transform.position, PlayerPos, 12, out bank);
            HideWarnings();
            lane = Telegraph.Lane(transform.position, LaneEnd(), 1.2f * Size, windTime, InfernoKit.WarnTank);
            ActTimed("surge", windTime, 0.1f);
            SetState("surge");
            var at = hasBank ? bank : transform.position;
            GameAudio.PlayAt("telegraph", at, 0.9f, 0.45f);
            GameAudio.PlayAt("burn_tick", at, 0.8f, 0.4f);
        }

        Vector3 LaneEnd()
        {
            var to = lungeTarget - transform.position;
            to.y = 0;
            float len = Mathf.Min(LungeSpeed * LungeMax + 1, to.magnitude + 1.5f);
            return transform.position + (to.sqrMagnitude > 1e-4f ? to.normalized : transform.forward) * len;
        }

        /// <summary>岸边熔岩鼓泡：前 60% 跟着玩家（之后锁定扑击方向，侧移可躲），身体浮上熔岩面</summary>
        void SurgeStep(float dt)
        {
            float t = Mathf.Clamp01(stateTime / windTime);
            TurnTo(YawToTarget, 4, dt);
            if (t < 0.6f) lungeTarget = PlayerPos;
            lane.SetLine(transform.position, LaneEnd(), 1.2f * Size);
            FreeMove(Vector3.zero, dt, t < 0.5f);
            if (Mathf.Floor(stateTime / 0.1f) != Mathf.Floor((stateTime - dt) / 0.1f))
            {
                var p = hasBank ? bank : transform.position;
                float s = InfernoKit.Lava.SurfaceY(transform.position);
                if (float.IsFinite(s)) p.y = s;
                Fx.Burst(p + Random.insideUnitSphere * 0.6f * Size, InfernoKit.LavaColor, 3, 1.4f, 0.4f, 0.18f * Size, 4);
            }
            if (stateTime >= windTime) StartLunge();
        }

        void StartLunge()
        {
            HideWarnings();
            GoFree();
            HitWall = false;
            var to = lungeTarget - transform.position;
            to.y = 0;
            if (to.sqrMagnitude > 1e-4f) Facing = InfernoKit.Yaw(to);
            Act("lunge", 0.05f);
            SetState("lunge");
            var p = transform.position + Vector3.up * 0.3f;
            Fx.MoltenSplash(p, 1.6f * Size, InfernoKit.LavaColor);
            Fx.Ring(p, 2.6f * Size, InfernoKit.Hot, 0.45f);
            GameAudio.PlayAt("enemy_charge", p, 1f, 0.6f);
            Quake(0.35f, 20, 0.25f);
        }

        void LungeStep(float dt, float d)
        {
            FreeMove(transform.forward * LungeSpeed, dt, false);
            var to = lungeTarget - transform.position;
            to.y = 0;
            if (to.magnitude <= AmbushReach - 1 || d <= AmbushReach - 1 || stateTime >= LungeMax || (stateTime > 0.1f && HitWall))
            {
                landTime = 0;
                ambushCd = Rand(2.5f, 3.5f);
                Bite(true);
            }
        }

        /// <summary>咬：伏击扑咬 ×1.5，陆上扑咬 ×1</summary>
        void Bite(bool ambush)
        {
            Act("bite", 0.05f);
            SetState("bite");
            var p = Local(0, 0.8f, 1.9f);
            GameAudio.PlayAt("enemy_melee", p, 1f, 0.5f);
            float reach = ambush ? AmbushReach : BiteReach;
            if (vitals && !vitals.Dead && DistToPlayer <= reach + InfernoKit.PlayerRadius && FacingDot > 0.4f && VerticalReach(2))
            {
                Struck = HitPlayer(Damage * (ambush ? AmbushMult : 1), p, Element.None);
                if (Struck)
                {
                    var f = transform.forward * (ambush ? 7 : 5);
                    PushPlayer(new Vector3(f.x, 3, f.z));
                    CameraShake.Add(ambush ? 0.6f : 0.4f, 0.25f);
                    Fx.Burst(TargetChest, InfernoKit.LavaColor, 8, 3, 0.4f, 0.08f, 6);
                }
            }
            biteCd = Rand(1.8f, 2.6f);
            if (!ambush) ReleaseAttack();
        }

        /// <summary>咬完：还泡在熔岩里（扑空了）就接着游，否则上岸</summary>
        void AfterBite()
        {
            if (Free && InfernoKit.Lava.IsLava(transform.position))
            {
                ReleaseAttack();
                Act("swim", 0.2f);
                SetState("swim");
                return;
            }
            ToLand();
        }

        // ───────────── 陆上 ─────────────

        void LandStep(float dt, float d)
        {
            if (Free && !Land())
            {
                // 还没回到导航网格（刚扑上岸、卡在岸边）：继续往玩家那边挪
                var to = PlayerPos - transform.position;
                to.y = 0;
                FreeMove(to.sqrMagnitude > 0.01f ? to.normalized * moveSpeed : Vector3.zero, dt, false);
                return;
            }
            landTime += dt;
            var lava = InfernoKit.Lava;
            // 回熔：碎甲够多，或上岸太久（甲没碎够也回去再伏击）
            float stay = emerged ? LandStayEmerged : LandStay;
            if ((BrokenCount >= RetreatBroken || landTime >= stay) && lava.NearestLava(transform.position, LavaSeek, out _))
            {
                ReleaseAttack();
                Act("toLava", 0.15f);
                SetState("toLava");
                return;
            }
            TurnTo(YawToTarget, TurnRate, dt);
            float fd = FacingDot;
            if (sweepCd <= 0 && d <= SweepRange && fd < 0.1f && VerticalReach(1.8f) && RequestAttack(AttackTokens.Kind.Melee, 1.4f))
            {
                BeginSweep();
                return;
            }
            if (biteCd <= 0 && d <= BiteRange && fd > 0.75f && VerticalReach(1.8f) && RequestAttack(AttackTokens.Kind.Melee, 1.2f))
            {
                windTime = Windup(BiteWindup, 0.3f);
                Stop();
                Struck = false;
                ActTimed("biteWindup", windTime);
                SetState("biteWindup");
                GameAudio.PlayAt("telegraph", Local(0, 0.9f, 1.8f), 0.6f, 0.7f);
                return;
            }
            if (d > StopDist) MoveTo(PlayerPos, moveSpeed);
            else Stop();
        }

        // ───────────── 甩尾 ─────────────

        void BeginSweep()
        {
            windTime = Windup(SweepWindup, 0.4f);
            Stop();
            Struck = false;
            // 尾巴往玩家的反方向蓄力，横扫过身后半圈
            var to = PlayerPos - transform.position;
            sweepSide = Vector3.Dot(to, transform.right) >= 0 ? -1 : 1;
            sweepYaw = Facing + Mathf.PI;
            HideWarnings();
            ring = Telegraph.Sector(transform.position, sweepYaw * Mathf.Rad2Deg, 90, SweepReach, windTime, InfernoKit.WarnTank, 0.45f * Size);
            ActTimed("sweepWindup", windTime);
            SetState("sweepWindup");
            Sfx("telegraph", 0.7f, 0.9f);
        }

        void Sweep()
        {
            HideWarnings();
            Act("sweep", 0.05f);
            SetState("sweep");
            var p = Local(0, 0.5f, -2.2f);
            Fx.Burst(p, InfernoKit.Ember, 10, 6, 0.4f, 0.08f * Size, 6);
            GameAudio.PlayAt("enemy_melee", p, 1f, 0.35f);
            Quake(0.3f, 18, 0.2f);
            float dy = PlayerPos.y - transform.position.y;
            // 身后半圈（朝向余弦 < 0.2），起跳（离地 0.9 m 以上）躲得过
            if (vitals && !vitals.Dead && DistToPlayer <= SweepReach + InfernoKit.PlayerRadius && FacingDot < 0.2f && dy > -1 && dy < 0.9f)
            {
                Struck = HitPlayer(Damage * SweepMult, p, Element.None);
                if (Struck)
                {
                    PushPlayer(SweepKnockFor(PlayerPos, transform.position, sweepSide, InfernoKit.Lava));
                    CameraShake.Add(0.5f, 0.25f);
                }
            }
            sweepCd = Rand(3f, 4f);
        }

        /// <summary>
        /// 甩尾的击退速度（纯函数，测试用）：尾巴横扫的切向 × 0.7 + 往外 × 0.5，附近 7 m 有熔岩就 75% 偏向最近的熔岩；水平 10、上抛 3.5 m/s。
        /// 扫进熔岩之后由熔岩系统结算（火伤 + 托回），这里不另外扣血
        /// </summary>
        public static Vector3 SweepKnockFor(Vector3 playerPos, Vector3 self, float sweepSide, ILavaQuery lava)
        {
            var d = playerPos - self;
            d.y = 0;
            float len = d.magnitude;
            var radial = len > 1e-4f ? d / len : Vector3.forward;
            var tangent = new Vector3(-radial.z, 0, radial.x) * sweepSide;
            var dir = (tangent * 0.7f + radial * 0.5f).normalized;
            if (lava != null && lava.NearestLava(playerPos, SweepLavaSeek, out var l))
            {
                var b = l - playerPos;
                b.y = 0;
                if (b.sqrMagnitude > 1e-6f) dir = Vector3.Lerp(dir, b.normalized, 0.75f).normalized;
            }
            var v = dir * SweepKnock;
            v.y = SweepUp;
            return v;
        }

        // ───────────── 鼍鸣 ─────────────

        void BeginRoar()
        {
            roared = true;
            Stop();
            HideWarnings();
            ReleaseAttack();
            roarAt = -1;
            Act("roar", 0.1f);
            SetState("roar");
            GameAudio.PlayAt("boss_roar", Local(0, 1.1f, 1.9f), 0.9f, 0.55f);
        }

        void RoarStep(float dt)
        {
            Stop();
            if (stateTime < RoarWindup)
            {
                if (Mathf.Floor(stateTime / 0.15f) != Mathf.Floor((stateTime - dt) / 0.15f))
                    Fx.Burst(Local(0, 1.1f, 1.9f), InfernoKit.Smoke, 3, 0.8f, 0.8f, 0.3f * Size * 0.5f, -1.5f);
                return;
            }
            if (roarAt < 0)
            {
                roarAt = stateTime;
                // 贴地震波：波前扫过时玩家在地上（离地 0.5 m 内）就中，跳起可躲
                GroundWave.Spawn(new GroundWave.Spec(transform.position, RoarRadius, RoarSpeed, Damage * RoarMult)
                {
                    element = Element.Fire, minRise = -1f, maxRise = 0.5f, needGrounded = true, knockback = 5, knockUp = 4,
                    color = InfernoKit.LavaColor, owner = this,
                });
                Quake(0.6f, 24, 0.5f);
                SplashFireSpots();
            }
            if (stateTime - roarAt >= RoarRadius / RoarSpeed + 0.1f) ToLand();
        }

        /// <summary>附近岸边溅起几处燃烧的火点（有熔岩就挑熔岩边，没有就在周围）</summary>
        void SplashFireSpots()
        {
            var lava = InfernoKit.Lava;
            bool hasLava = InfernoKit.HasLava;
            int placed = 0;
            for (int k = 0; k < 24 && placed < FireSpots; k++)
            {
                float a = Random.value * Mathf.PI * 2, r = 3 + Random.value * 8;
                var p = transform.position + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * r;
                if (lava.IsLava(p)) continue;
                if (!NavMesh.SamplePosition(p, out var hit, 0.8f, NavMesh.AllAreas)) continue;
                if (hasLava && k < 16 && !lava.NearestLava(hit.position, 3, out _)) continue;
                FloorFire.Spawn(hit.position, FireSpotR, FireSpotTime, Damage * 0.15f, 0.5f, this, look: FireBed.Lava);
                Fx.MoltenSplash(hit.position + Vector3.up * 0.3f, 0.7f, InfernoKit.LavaColor);
                placed++;
            }
        }

        protected override void CancelAttack()
        {
            HideWarnings();
            if (Dead) return;
            if (state is "biteWindup" or "bite" or "sweepWindup" or "sweep" or "roar" or "lunge")
            {
                if (Free && InfernoKit.Lava.IsLava(transform.position)) SetState("swim");
                else
                {
                    Land();
                    SetState("land");
                }
            }
            else if (state == "surge")
            {
                SetState("swim");
                ambushCd = 2.5f;
            }
        }

        void OnTuoDied(DamageInfo info)
        {
            HideWarnings();
            armour?.Dispose();
            armour = null;
            for (int i = 0; i < Plates; i++)
                if (plateGlow[i])
                    plateGlow[i].enabled = false;
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            for (int i = 0; i < Plates; i += 2)
                if (plates[i])
                    Fx.Basalt(plates[i].transform.position, 1f * Size);
            var c = transform.position + Vector3.up * 0.9f * Size;
            Fx.MoltenSplash(c, 1.6f * Size, InfernoKit.LavaColor);
            GameAudio.PlayAt("shield_break", c, 1f, 0.45f);
            Quake(0.45f, 22, 0.35f);
        }
    }
}
