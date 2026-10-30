using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔炉铁牛（Three.js 版 src/enemies/types/IronOx.ts）：第三章坦克，和前两章的坦克相反——弱点在正面，而且只在它最危险的时候打开。
    ///   铁甲：到处只吃 20%（甲上迸火星、铁响），炉门关着时也一样；持续伤害不受铁甲影响。
    ///   炉门（身体的弱点区，挂 chest 骨，<see cref="ZoneFacing.Front"/> 朝向门）：吸气后段 / 呛火跪倒时敞开——从正面打进炉膛 ×3、必暴击，
    ///         判定半径从 0.2 放大到 0.36；关着时不是弱点、按铁甲算。
    ///   铁蹄推进：低头慢走（2.4 m/s），每一步震屏，挤开挡路的小怪（生命 &lt; 400 × 难度的地面敌人）。
    ///   鼓风吸气：6–16 m、看得见、正对（冷却 9.5–11 s，开局 2.5–4 s）：1.6 s（精英 2.2 s）里把正前方、看得见的玩家一阵阵往嘴边拉
    ///         （每 0.18 s 一次冲量 2.4 / 精英 3.3，按距离衰减，掩体挡风），地上亮出接下来熔铁喷吐的扇形预警。
    ///   呛火：吸气期间炉门累计吃到最大生命 8%：炉膛回火爆炸，前腿一软跪倒 2.5 s，炉门敞开——最好的输出窗口；这次吸气作废。
    ///   熔铁喷吐：吸气没被打断：低头 0.45 s → 12 m、60° 扇面火伤 ×1.3（掩体挡得住）；落地的熔铁冷成两排矮铁渣墙
    ///         （<see cref="SlagWall"/>：真碰撞，挡路挡子弹，也能当掩体），6 s 后碎掉。精英喷完紧接一次顶角。
    ///   顶角掀地：贴身 4.2 m 内、正对：低头 0.5 s（前方扇形预警）→ 牛角往上一挑 ×1.2，把人挑飞（上 9、前 5 m/s）。
    /// 状态：advance → inhale →（choke | spitWindup → spit）→ advance；advance → tossWindup → toss → advance。
    /// </summary>
    public sealed class IronOxAI : InfernoEnemyAI
    {
        /// <summary>铁甲 / 炉门倍率</summary>
        public const float IronFactor = 0.2f, DoorFactor = 3f;
        /// <summary>炉门判定半径（设计尺寸）：关着 / 敞开</summary>
        public const float DoorClosed = 0.2f, DoorOpenR = 0.36f;
        /// <summary>推进转身角速度（弧度/秒）、停步距离</summary>
        public const float TurnRate = 1.0f, StopDist = 3.2f;
        /// <summary>吸气：触发距离带、时长（精英）、冷却、开局冷却、吸力脉冲间隔与冲量（精英）、作用范围、呛火阈值、跪倒时长</summary>
        public const float InhaleMin = 6, InhaleMax = 16, InhaleTime = 1.6f, InhaleTimeElite = 2.2f;
        public const float PullGap = 0.18f, PullImpulse = 2.4f, PullImpulseElite = 3.3f, PullRange = 20, ChokeFraction = 0.08f, ChokeTime = 2.5f;
        /// <summary>喷吐：前摇、射程、半角（弧度）、倍率、持续、铁渣落地时刻</summary>
        public const float SpitWindup = 0.45f, SpitRange = 12, SpitHalf = Mathf.PI / 6, SpitMult = 1.3f, SpitTime = 0.9f, SlagAt = 0.35f;
        /// <summary>顶角：触发距离、命中距离、前摇、倍率、上挑 / 前推速度</summary>
        public const float TossRange = 4.2f, TossReach = 4.8f, TossWindup = 0.5f, TossMult = 1.2f, TossUp = 9, TossPush = 5;
        /// <summary>挤开小怪：生命低于 SHOVE_HP × 难度的地面敌人</summary>
        public const float ShoveHp = 400;
        /// <summary>脚步震屏的感知距离</summary>
        public const float StepShakeRange = 22;

        /// <summary>铁渣墙：两排（离铁牛 5.5 m 两段、9 m 三段），每段长度</summary>
        public static readonly (float d, float[] lat)[] SlagRows = { (5.5f, new[] { -1.7f, 1.7f }), (9f, new[] { -3.2f, 0f, 3.2f }) };
        public const float SlagLength = 2.1f;

        /// <summary>美术网格实测：炉门中心、炉心、嘴、左风箱</summary>
        static readonly Vector3 DoorPoint = new(0, 0.84f, 0.86f), CorePoint = new(0, 0.84f, 0.72f), MouthPoint = new(0, 1.36f, 1.3f), BellowsPoint = new(0.6f, 1.2f, 0.2f);

        /// <summary>这次吸气期间炉门吃到的伤害</summary>
        public float DoorDamage { get; private set; }
        /// <summary>最近一次喷吐 / 顶角打中了玩家（测试 / 冒烟用）</summary>
        public bool Struck { get; private set; }
        /// <summary>本次喷吐立起的铁渣墙</summary>
        public readonly List<SlagWall> Walls = new();
        /// <summary>炉门敞开（吸气后段、呛火跪倒）：从正面打进炉膛 ×3</summary>
        public bool DoorOpen => !Dead && (state == "choke" || (state == "inhale" && stateTime >= 0.25f));

        float inhaleCd, inhaleTime = InhaleTime, pullAcc, streakAcc, spitYaw, windTime = SpitWindup, blockFxAt, coreLevel;
        bool slagDone, alerted;
        Transform mouth, core;
        Renderer coreGlow;
        TelegraphHandle fan, sector;
        IDisposable armour;
        /// <summary>精英出手分量层（三章共用，普通铁牛为 null）与这一招的铜芒放过没有（docs/art/vfx/elites-ch3.md）</summary>
        EliteStrike strike;
        bool glinted;
        static readonly List<EnemyAI> near = new();

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.1f, 0.04f, 3f, 0.9f, false);
            // 炉门 = 身体的弱点球：挂 chest 骨，只认正面（±70°）
            InfernoKit.PlaceWeak(body, "chest", DoorPoint, DoorClosed);
            if (body.WeakZone)
            {
                body.WeakZone.facing = ZoneFacing.Front;
                body.WeakZone.facingCos = 0.34f;
                body.WeakZone.SetWeakPoint(false);
            }
            mouth = InfernoKit.Anchor(transform, "head", MouthPoint, "Mouth");
            core = InfernoKit.Anchor(transform, "chest", CorePoint, "FurnaceCore");
            float k = 0.22f * 2f * Mathf.Abs(transform.lossyScale.x) / Mathf.Max(1e-3f, Mathf.Abs(core.lossyScale.x));
            coreGlow = InfernoKit.Primitive(PrimitiveType.Sphere, "Core", core, Vector3.zero, Vector3.one * k, Color.black, true);
            armour = hp.Incoming.Add(ArmourIncoming);
            hp.Damaged += OnOxDamaged;
            hp.Died += OnOxDied;
            if (body.Rig) body.Rig.Footfall += OnFootfall;
        }

        protected override void Start()
        {
            base.Start();
            inhaleCd = Rand(2.5f, 4f);
        }

        protected override string InitialState => "advance";

        /// <summary>
        /// 这一击的倍率（纯函数，测试用）：持续伤害 1；炉门敞开、落在炉门区、从正面打来 ×3；其余 ×0.2（含关着的炉门）
        /// </summary>
        public static float ArmourFactor(bool status, bool doorOpen, bool onDoor, bool fromFront) =>
            status ? 1f : doorOpen && onDoor && fromFront ? DoorFactor : IronFactor;

        float ArmourIncoming(in IncomingHit h)
        {
            if (Dead) return 1;
            var info = h.info;
            bool status = info.source == DamageSource.Status;
            var door = body.WeakZone;
            bool onDoor = door && body.ZoneAt(info) == door;
            float k = ArmourFactor(status, DoorOpen, onDoor, door && door.FacingPasses(info.direction));
            if (k == IronFactor && Time.time - blockFxAt > 0.07f)
            {
                // 铁甲：迸火星、铁响
                blockFxAt = Time.time;
                var p = float.IsFinite(info.point.x) && info.point != Vector3.zero ? info.point : Local(Random.value - 0.5f, 0.8f + Random.value * 1.2f, 1f);
                Fx.Play("Cinder", p, Vector3.up, InfernoKit.Ember, 0.4f);
                Fx.Burst(p, InfernoKit.Ember, 4, 5, 0.25f, 0.05f * Size, 9);
                GameAudio.PlayAt("shield_break", p, 0.3f, 1.7f);
            }
            return k;
        }

        /// <summary>吸气时打进炉膛的伤害累计：够了就呛火</summary>
        void OnOxDamaged(DamageInfo info, DamageResult r)
        {
            if (state != "inhale" || !DoorOpen || info.source == DamageSource.Status || r.total <= 0) return;
            var door = body.WeakZone;
            if (!door || body.ZoneAt(info) != door || !door.FacingPasses(info.direction)) return;
            DoorDamage += r.total;
            if (DoorDamage >= hp.maxHealth * ChokeFraction) Choke();
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            inhaleCd -= dt * auraAttackRate;
            if (!alerted && sees && d < 30)
            {
                alerted = true;
                Sfx("enemy_alert", 0.9f, 0.45f);
            }
            UpdateDoor(dt);
            switch (state)
            {
                case "advance":
                {
                    SetGlow(1, 0.1f);
                    Glow = 0.1f;
                    TurnTo(YawToTarget, TurnRate, dt);
                    float fd = FacingDot;
                    if (cooldown <= 0 && d <= TossRange && fd > 0.6f && VerticalReach(2) && RequestAttack(AttackTokens.Kind.Melee, 1.4f))
                    {
                        BeginToss();
                        break;
                    }
                    if (inhaleCd <= 0 && d >= InhaleMin && d <= InhaleMax && sees && fd > 0.5f && VerticalReach(3)
                        && RequestAttack(AttackTokens.Kind.Heavy, InhaleTimeElite + SpitWindup + SpitTime + 1))
                    {
                        BeginInhale();
                        break;
                    }
                    if (d > StopDist) MoveTo(PlayerPos, moveSpeed);
                    else Stop();
                    Shove();
                    break;
                }
                case "inhale":
                {
                    Stop();
                    TurnTo(YawToTarget, 0.7f, dt);
                    float t = Mathf.Clamp01(stateTime / inhaleTime);
                    SetGlow(1, 0.4f + 0.6f * t);
                    Glow = 0.4f + 0.6f * t;
                    // 精英：吸气时昂首鼓胸（拔高、后仰），喷吐前摇再一头扎下去
                    strike?.Charge(t, -0.08f, -8f);
                    fan.SetYaw(Facing * Mathf.Rad2Deg);
                    pullAcc += dt;
                    while (pullAcc >= PullGap)
                    {
                        pullAcc -= PullGap;
                        PullPlayer();
                    }
                    streakAcc += dt;
                    while (streakAcc >= 0.06f)
                    {
                        streakAcc -= 0.06f;
                        SuctionStreak();
                    }
                    if (stateTime >= inhaleTime) BeginSpit();
                    break;
                }
                case "choke":
                    Stop();
                    if (Mathf.Floor(stateTime / 0.2f) != Mathf.Floor((stateTime - dt) / 0.2f))
                    {
                        foreach (int s in new[] { 1, -1 })
                            Fx.Burst(Local(s * BellowsPoint.x, BellowsPoint.y, BellowsPoint.z), InfernoKit.Smoke, 4, 1.2f, 0.9f, 0.35f * Size * 0.7f, -1.5f);
                        Fx.Burst(core.position, InfernoKit.Smoke, 3, 1f, 0.8f, 0.3f * Size * 0.5f, -1.5f);
                    }
                    if (stateTime >= ChokeTime)
                    {
                        Sfx("land", 0.9f, 0.45f);
                        Quake(0.3f, StepShakeRange, 0.25f);
                        ToAdvance();
                    }
                    break;
                case "spitWindup":
                    Stop();
                    // 精英：低头压低（蓄满一口熔铁），顶点嘴边一点铜芒
                    strike?.Charge(stateTime / Mathf.Max(0.05f, windTime), 0.12f, 12f);
                    if (strike != null && !glinted && stateTime >= windTime * 0.8f)
                    {
                        glinted = true;
                        Fx.EliteCh3Glint(mouth.position, 1.4f);
                    }
                    if (stateTime >= windTime) Spit();
                    break;
                case "spit":
                    Stop();
                    if (!slagDone && stateTime >= SlagAt)
                    {
                        slagDone = true;
                        RaiseWalls();
                    }
                    if (stateTime >= SpitTime)
                    {
                        // 精英：喷完紧接一次顶角
                        if (elite && DistToPlayer <= TossRange + 2 && RequestAttack(AttackTokens.Kind.Melee, 1.4f)) BeginToss();
                        else ToAdvance();
                    }
                    break;
                case "tossWindup":
                    Stop();
                    TurnTo(YawToTarget, 1.4f, dt);
                    sector.SetYaw(Facing * Mathf.Rad2Deg);
                    // 精英：牛头压到最低（角尖贴地），顶点角尖一点铜芒
                    strike?.Charge(stateTime / Mathf.Max(0.05f, windTime), 0.13f, 13f);
                    if (strike != null && !glinted && stateTime >= windTime * 0.8f)
                    {
                        glinted = true;
                        Fx.EliteCh3Glint(Local(0, 0.4f, 1.9f), 1.3f);
                    }
                    if (stateTime >= windTime) Toss();
                    break;
                case "toss":
                    Stop();
                    if (stateTime >= 0.55f) ToAdvance();
                    break;
                default:
                    ToAdvance();
                    break;
            }
        }

        /// <summary>炉门：敞开时是弱点、判定放大，炉心白热</summary>
        void UpdateDoor(float dt)
        {
            bool open = DoorOpen;
            var door = body.WeakZone;
            if (door)
            {
                door.SetWeakPoint(open);
                door.SetRadiusScale(open ? DoorOpenR / DoorClosed : 1f);
            }
            float target = state == "choke" ? 1.2f : state == "inhale" ? 0.4f + 0.8f * Mathf.Clamp01(stateTime / inhaleTime) : state is "spitWindup" or "spit" ? 1.4f : 0.08f;
            coreLevel = Mathf.Lerp(coreLevel, target, 1 - Mathf.Exp(-8f * dt));
            if (coreGlow) FxMaterials.Tint(coreGlow, Color.Lerp(InfernoKit.LavaColor, InfernoKit.White, Mathf.Clamp01(coreLevel - 0.6f)) * Mathf.Clamp01(coreLevel));
        }

        void ToAdvance()
        {
            strike?.Relax();
            Loco();
            SetState("advance");
            HideWarnings();
            ReleaseAttack();
        }

        void HideWarnings()
        {
            fan.FadeOut();
            sector.FadeOut();
        }

        /// <summary>挤开挡在面前的小怪（铁牛不绕路）</summary>
        void Shove()
        {
            if (agent.velocity.sqrMagnitude < 0.09f) return;
            var f = transform.forward;
            f.y = 0;
            f.Normalize();
            float myR = 0.95f * Size;
            EnemyRegistry.InRadius(transform.position, myR + 2f, near, EnemyQuery.Alive, this);
            foreach (var e in near)
            {
                if (!e || !e.Health || e.Health.IsBoss || e.Health.maxHealth >= ShoveHp * level || e is FlyingEnemyAI or BifangAI) continue;
                var to = e.transform.position - transform.position;
                to.y = 0;
                float dist = to.magnitude;
                if (dist < 1e-3f || dist > myR + EnemyRegistry.BodyRadius(e) + 0.5f || Vector3.Dot(to, f) <= 0) continue;
                float side = Vector3.Dot(to, new Vector3(f.z, 0, -f.x)) >= 0 ? 1 : -1;
                var right = new Vector3(f.z, 0, -f.x);
                e.Knockback(right * (side * 6) + f * 2);
            }
        }

        void OnFootfall(int leg, Vector3 at)
        {
            if (Dead) return;
            at.y = transform.position.y + 0.02f;
            Fx.Burst(at, InfernoKit.Ember, 4, 1.4f, 0.4f, 0.12f * Size, 2);
            Fx.Burst(at, InfernoKit.Ash, 3, 1.0f, 0.6f, 0.2f * Size, -0.5f);
            Quake(0.09f, StepShakeRange, 0.14f);
            if (DistToPlayer < StepShakeRange) GameAudio.PlayAt("footstep", at, 0.6f, 0.35f);
        }

        // ───────────── 鼓风吸气 / 呛火 ─────────────

        void BeginInhale()
        {
            strike ??= EliteStrike.For(this);
            glinted = false;
            Stop();
            inhaleTime = elite ? InhaleTimeElite : InhaleTime;
            DoorDamage = 0;
            pullAcc = streakAcc = 0;
            Struck = false;
            HideWarnings();
            // 喷吐扇形预警：吸气期间一直亮着（越来越满），提前告诉玩家「不打断就喷这里」
            fan = Telegraph.Sector(transform.position, Facing * Mathf.Rad2Deg, SpitHalf * Mathf.Rad2Deg, SpitRange, inhaleTime + SpitWindup, InfernoKit.WarnTank, 0.95f * Size);
            ActTimed("inhale", inhaleTime, 0.12f);
            SetState("inhale");
            Sfx("telegraph", 1f, 0.45f);
            Sfx("enemy_charge", 0.8f, 0.5f);
        }

        /// <summary>吸力冲量（纯函数，测试用）：dist = 玩家到铁牛的水平距离；太近 / 太远 / 不在正前方（余弦 &lt; 0.3）为 0</summary>
        public static float PullStrength(float dist, float frontCos, bool isElite, float bodyRadius)
        {
            if (dist < bodyRadius + 1.6f || dist > PullRange || frontCos < 0.3f) return 0;
            return (isElite ? PullImpulseElite : PullImpulse) * Mathf.Clamp01(1.3f - dist / (PullRange * 1.2f));
        }

        /// <summary>风往嘴里灌：前方、看得见（掩体挡风）的玩家被一阵阵拉向炉门</summary>
        void PullPlayer()
        {
            if (Taunted || !vitals || vitals.Dead || !motor) return;
            var to = transform.position - player.position;
            to.y = 0;
            float d = to.magnitude;
            if (d < 1e-3f) return;
            float frontCos = Vector3.Dot(-to / d, transform.forward);
            float k = PullStrength(d, frontCos, elite, 0.95f * Size);
            if (k <= 0) return;
            if (!Combat.LineClear(mouth.position, player.position + Vector3.up * 1.2f)) return;
            motor.AddImpulse(to / d * k);
        }

        /// <summary>气流线朝嘴汇聚、火星被吸进炉门</summary>
        void SuctionStreak()
        {
            float a = Facing + (Random.value - 0.5f) * 1.3f;
            float r = 4 + Random.value * 7;
            var from = transform.position + InfernoKit.YawDir(a) * r + Vector3.up * (0.6f + Random.value * 3);
            if (Random.value < 0.55f) Fx.Tracer(from, mouth.position, new Color(1f, 0.9f, 0.75f), 0.035f);
            else Fx.Tracer(from, core.position, InfernoKit.Ember, 0.05f);
        }

        /// <summary>呛火：炉膛回火爆炸，跪倒 2.5 s，炉门敞开（最好的输出窗口）；这次吸气作废</summary>
        void Choke()
        {
            strike?.Kick(0.1f, 10f, 0.4f);
            strike?.Relax();
            HideWarnings();
            ReleaseAttack();
            Stop();
            inhaleCd = Rand(9.5f, 11f);
            Act("choke", 0.06f);
            SetState("choke");
            var p = core.position;
            // FX4：炉膛呛火——熔铁炸出来 + 黑烟 + 爆
            Fx.MoltenSplash(p, 1.4f * Size, InfernoKit.LavaColor);
            Fx.Play("Soot", p, Vector3.up, InfernoKit.Smoke, 1.2f * Size);
            Fx.Explosion(p, 1.2f * Size, InfernoKit.LavaColor);
            GameAudio.PlayAt("boss_slam", p, 1f, 0.7f);
            GameAudio.PlayAt("boss_roar", p, 0.7f, 1.6f);
            Quake(0.5f, StepShakeRange, 0.4f);
        }

        // ───────────── 熔铁喷吐 ─────────────

        void BeginSpit()
        {
            windTime = Windup(SpitWindup, 0.35f);
            spitYaw = Facing;
            inhaleCd = Rand(9.5f, 11f);
            ActTimed("spitWindup", windTime);
            SetState("spitWindup");
            GameAudio.PlayAt("telegraph", mouth.position, 0.9f, 0.7f);
        }

        /// <summary>玩家在喷吐扇面里（纯函数，测试用）：12 m + 身宽、半角 30°（贴身 1 m 内都算）</summary>
        public static bool InFan(Vector3 origin, float yaw, Vector3 feet, float bodyRadius)
        {
            var to = feet - origin;
            to.y = 0;
            float d = to.magnitude;
            if (d > SpitRange + InfernoKit.PlayerRadius) return false;
            if (d < bodyRadius + 1) return true;
            return Mathf.Abs(InfernoKit.WrapRad(InfernoKit.Yaw(to) - yaw)) <= SpitHalf;
        }

        void Spit()
        {
            Act("spit", 0.05f);
            SetState("spit");
            slagDone = false;
            Walls.Clear();
            HideWarnings();
            var from = mouth.position;
            GameAudio.PlayAt("skill_fire", from, 1f, 0.6f);
            Quake(0.35f, StepShakeRange, 0.3f);
            // 精英：喷出那一帧脖子一伸、往前顶，局部顿帧；嘴边一喷铜火
            if (strike != null)
            {
                strike.Release(-0.1f, 9f, 0.06f);
                Fx.EliteCh3Burst(from, transform.forward, 1.4f);
            }
            // 熔铁团：朝两排铁渣墙飞出去（落地时刻 = 立墙时刻）
            foreach (var (dd, lats) in SlagRows)
                foreach (float lat in lats)
                {
                    var land = SlagPoint(transform.position, spitYaw, dd, lat);
                    float gy = InfernoKit.GroundAt(land, transform.position.y + 1f, 6f);
                    if (float.IsFinite(gy)) land.y = gy;
                    // FX4：一团熔铁沿抛物线飞过去（同 TS moltenArc），落地时刻 = 立墙时刻
                    MoltenStream.Arc(from, land + Vector3.up * 0.3f, SlagAt, 1.1f * Size, 1.2f + dd * 0.12f);
                }
            // 扇面伤害：12 m、60°，掩体挡得住
            if (vitals && !vitals.Dead && VerticalReach(3.5f) && InFan(transform.position, spitYaw, PlayerPos, 0.95f * Size) && Combat.LineClear(from, TargetChest))
            {
                Struck = HitPlayer(Damage * SpitMult, from, Element.Fire);
                if (Struck) Fx.MoltenSplash(TargetChest, 0.7f, InfernoKit.LavaColor);
            }
        }

        /// <summary>某一段铁渣墙的中心（地面上的水平位置）：离铁牛 d 米、横向 lat 米</summary>
        public static Vector3 SlagPoint(Vector3 origin, float yaw, float d, float lat)
        {
            var f = InfernoKit.YawDir(yaw);
            var right = new Vector3(f.z, 0, -f.x);
            return origin + f * d + right * lat;
        }

        /// <summary>熔铁落地，冷成两排矮铁渣墙（墙面朝铁牛）；中间被挡住的那段不立</summary>
        void RaiseWalls()
        {
            var from = transform.position + Vector3.up * 0.8f;
            foreach (var (dd, lats) in SlagRows)
                foreach (float lat in lats)
                {
                    var c = SlagPoint(transform.position, spitYaw, dd, lat);
                    if (!Combat.LineClear(from, c + Vector3.up * 0.8f)) continue;
                    float gy = InfernoKit.GroundAt(c, transform.position.y + 1f, 6f);
                    if (!float.IsFinite(gy)) continue;
                    c.y = gy;
                    var w = SlagWall.Raise(c, spitYaw, SlagLength);
                    if (w) Walls.Add(w);
                }
            Sfx("land", 0.8f, 0.6f);
        }

        // ───────────── 顶角掀地 ─────────────

        void BeginToss()
        {
            strike ??= EliteStrike.For(this);
            glinted = false;
            windTime = Windup(TossWindup, 0.35f);
            Stop();
            Struck = false;
            HideWarnings();
            sector = Telegraph.Sector(transform.position, Facing * Mathf.Rad2Deg, 0.8f * Mathf.Rad2Deg, TossReach, windTime, InfernoKit.WarnTank, 0.6f * 0.95f * Size);
            ActTimed("tossWindup", windTime);
            SetState("tossWindup");
            GameAudio.PlayAt("telegraph", mouth.position, 0.7f, 0.6f);
            Fx.Burst(mouth.position, InfernoKit.Smoke, 3, 0.8f, 0.7f, 0.3f * Size * 0.4f, -1);
        }

        void Toss()
        {
            Act("toss", 0.05f);
            SetState("toss");
            HideWarnings();
            var p = Local(0, 0.2f, 2.2f);
            float gy = InfernoKit.GroundAt(p, transform.position.y + 1f, 6f);
            if (float.IsFinite(gy)) p.y = gy + 0.15f;
            // 掀起的地面铁板：一把铁片和火星往上崩
            Fx.Basalt(p, 1.2f * Size, InfernoKit.Iron);
            Fx.Burst(p, InfernoKit.Ember, 10, 6, 0.5f, 0.07f * Size, 8);
            Fx.Ring(p, 2.2f, InfernoKit.LavaColor, 0.3f);
            // 精英：角往上一挑那一帧整个前身扬起、拉长，局部顿帧；掀起处一圈铜色粗环 + 方铜渣崩开
            if (strike != null)
            {
                strike.Release(-0.12f, -12f, 0.07f);
                Fx.EliteCh3Impact(p, 1.8f * Size);
            }
            GameAudio.PlayAt("boss_slam", p, 0.9f, 0.8f);
            Quake(0.45f, StepShakeRange, 0.3f);
            if (vitals && !vitals.Dead && DistToPlayer <= TossReach + InfernoKit.PlayerRadius && FacingDot > 0.45f && VerticalReach(2.2f))
            {
                Struck = HitPlayer(Damage * TossMult, p, Element.None);
                if (Struck)
                {
                    var f = transform.forward;
                    PushPlayer(new Vector3(f.x * TossPush, TossUp, f.z * TossPush));
                    CameraShake.Add(0.6f, 0.3f);
                }
            }
            RollCooldown(2.4f, 3.2f);
        }

        protected override void CancelAttack()
        {
            strike?.Relax();
            HideWarnings();
            if (state == "choke") return;
            if (state is not ("advance" or IdleState or "spawn"))
            {
                SetState("advance");
                inhaleCd = Mathf.Max(inhaleCd, 3);
            }
        }

        void OnOxDied(DamageInfo info)
        {
            HideWarnings();
            armour?.Dispose();
            armour = null;
            if (body.Rig) body.Rig.Footfall -= OnFootfall;
            if (coreGlow) coreGlow.enabled = false;
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            var p = core ? core.position : transform.position + Vector3.up;
            Fx.MoltenSplash(p, 1.8f * Size, InfernoKit.LavaColor);
            Fx.Play("Soot", p, Vector3.up, InfernoKit.Smoke, 1.5f * Size);
            Fx.Explosion(p, 1.6f * Size, InfernoKit.LavaColor);
            GameAudio.PlayAt("boss_slam", p, 1f, 0.55f);
            Quake(0.6f, 26, 0.45f);
        }
    }

    /// <summary>
    /// 铁渣墙（熔炉铁牛的熔铁喷吐落地冷成的矮墙，TS fx/InfernoTankFx.ts 的 SlagWall）：以某点为中心、垂直于喷吐方向摆一道长 length 的墙，
    /// 每 0.7 m 一段（高约 1.35 m、厚 0.7 m），真碰撞（默认层：挡路、挡子弹、挡视线），导航网格上挖洞（NavMeshObstacle carve）。
    /// 和玩家 / 地面敌人重叠的段、落在不可走的地方（熔岩、悬崖、墙里）的段跳过。刚落地通红，1.5 s 冷成黑铁，最后 0.6 s 裂开发红，6 s 碎掉。
    /// </summary>
    [AddComponentMenu("")]
    public sealed class SlagWall : MonoBehaviour
    {
        /// <summary>每段长、高、厚、寿命、冷却时长</summary>
        public const float Seg = 0.7f, Height = 1.35f, Thick = 0.7f, Life = 6f, Cool = 1.5f;

        static readonly List<SlagWall> live = new();
        static readonly Collider[] overlap = new Collider[8];

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => live.Clear();

        /// <summary>场上的铁渣墙（测试 / 冒烟用）</summary>
        public static IReadOnlyList<SlagWall> Live
        {
            get
            {
                live.RemoveAll(w => !w);
                return live;
            }
        }

        /// <summary>立起来的段数（碰撞盒数）</summary>
        public int Segments => boxes.Count;

        readonly List<BoxCollider> boxes = new();
        readonly List<Renderer> hot = new(), cold = new();
        float t;
        bool done;

        /// <summary>在 center（地面点）立一道墙，墙面朝 yaw（弧度）；一段都立不起来时返回 null</summary>
        public static SlagWall Raise(Vector3 center, float yaw, float length)
        {
            int n = Mathf.Max(1, Mathf.RoundToInt(length / Seg));
            var f = InfernoKit.YawDir(yaw);
            var right = new Vector3(f.z, 0, -f.x);
            var go = new GameObject("Slag Wall");
            go.transform.SetPositionAndRotation(center, Quaternion.LookRotation(f));
            var w = go.AddComponent<SlagWall>();
            var pv = PlayerVitals.Instance;
            for (int i = 0; i < n; i++)
            {
                float off = (i - (n - 1) * 0.5f) * Seg;
                var c = center + right * off;
                if (!NavMesh.SamplePosition(c, out var nh, 0.6f, NavMesh.AllAreas)) continue;
                c.y = nh.position.y;
                if (InfernoKit.Lava.IsLava(c)) continue;
                float h = Height * (0.82f + 0.18f * Mathf.Abs(Mathf.Sin(i * 2.3f + center.x)));
                var half = new Vector3(Seg * 0.5f, h * 0.5f, Thick * 0.5f);
                var mid = c + Vector3.up * half.y;
                // 不把玩家 / 地面敌人关在墙里
                if (pv && !pv.Dead)
                {
                    var d = pv.transform.position - c;
                    d.y = 0;
                    if (d.magnitude < Mathf.Max(half.x, half.z) + InfernoKit.PlayerRadius + 0.1f) continue;
                }
                if (Physics.OverlapBoxNonAlloc(mid, half, overlap, go.transform.rotation, 1 << Layers.Character, QueryTriggerInteraction.Ignore) > 0) continue;
                var seg = new GameObject("Seg" + i);
                seg.transform.SetParent(go.transform, false);
                seg.transform.position = mid;
                seg.transform.rotation = go.transform.rotation;
                var box = seg.AddComponent<BoxCollider>();
                box.size = half * 2;
                w.boxes.Add(box);
                var ob = seg.AddComponent<NavMeshObstacle>();
                ob.shape = NavMeshObstacleShape.Box;
                ob.size = half * 2;
                ob.carving = true;
                // 视觉：两块歪斜的铁渣叠成一段（下层余烬、上层黑铁）
                for (int k = 0; k < 2; k++)
                {
                    var r = InfernoKit.Primitive(PrimitiveType.Cube, k == 0 ? "Ember" : "Iron", seg.transform,
                        new Vector3((k - 0.5f) * 0.12f, h * (k == 0 ? -0.18f : 0.22f), 0),
                        new Vector3(Seg * (1.05f - 0.2f * k), h * (k == 0 ? 0.64f : 0.5f), Thick * (1.1f - 0.25f * k)), InfernoKit.LavaColor);
                    r.transform.localRotation = Quaternion.Euler(0.12f * Mathf.Rad2Deg * Mathf.Sin(i + k), 0.25f * Mathf.Rad2Deg * Mathf.Sin(i * 1.7f + k), 0.1f * Mathf.Rad2Deg * Mathf.Cos(i * 1.3f + k));
                    (k == 0 ? w.hot : w.cold).Add(r);
                }
            }
            if (w.boxes.Count == 0)
            {
                Destroy(go);
                return null;
            }
            live.Add(w);
            Fx.MoltenSplash(center + Vector3.up * 0.2f, 1.2f, InfernoKit.LavaColor);
            Fx.Burst(center + Vector3.up * 0.2f, InfernoKit.Smoke, 8, 1.5f, 0.9f, 0.35f, -1.5f);
            return w;
        }

        void Update()
        {
            if (done) return;
            t += Time.deltaTime;
            // 刚落地通红，1.5 s 冷成黑铁，最后 0.6 s 裂开发红
            float cool = Mathf.Max(0, 1 - t / Cool);
            float crack = Mathf.Max(0, (t - (Life - 0.6f)) / 0.6f);
            float flare = Mathf.Clamp01(cool * cool + 0.5f * crack * (0.5f + 0.5f * Mathf.Sin(t * 30)));
            foreach (var r in cold)
                if (r)
                    FxMaterials.Tint(r, Color.Lerp(InfernoKit.Iron, InfernoKit.LavaColor, flare));
            foreach (var r in hot)
                if (r)
                    FxMaterials.Tint(r, Color.Lerp(InfernoKit.Slag, InfernoKit.LavaColor, Mathf.Clamp01(0.15f + flare)));
            if (t >= Life) Shatter();
        }

        /// <summary>碎掉：碰撞盒移除，碎铁渣四散</summary>
        public void Shatter()
        {
            if (done) return;
            done = true;
            foreach (var b in boxes)
                if (b)
                    Fx.Basalt(b.transform.position, 0.8f, InfernoKit.Iron);
            GameAudio.PlayAt("shield_break", transform.position, 0.6f, 0.6f);
            live.Remove(this);
            Destroy(gameObject);
        }
    }
}
