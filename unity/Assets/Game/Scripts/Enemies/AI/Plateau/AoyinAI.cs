using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 獓狠（第四章坦克）+ 雷牦（同一模型 ×0.72，id = leiyak）；combat 3.3，设计单第 3 节。
    ///   · 蓑毛（只有獓狠）：7 片（胸、臀、背、左右肩、左右后腿），没烧的那片只吃 20%；火（燎的 E / Q、炎心、焚雷、爆炸）落在那片上 1.5 s 烧光，
    ///     露出发光的雷筋，之后吃 125%；熔金：每片烧掉一半。头、雷球没毛（头 ×1.6）。
    ///   · 刨地 → 领群踩踏 <c>stampede</c>（1.0 / ≤3.0 / 1.2，8–34 m）：冲撞线 40 m × 3.2 m（正红）+ 线上紫红电火花；同群空着的雷牦在两侧 4 m 平行排开一起冲；
    ///     13 m/s，撞到 24（雷牦 16）+ 大击退；冲完打滑停下、慢慢转身；每冲一次角间雷球攒一份电（最多 3）。
    ///   · 四角挑 <c>gore</c> / <c>goreL</c>（贴脸 4 m）：头往一侧压低 → 横甩往上挑，120° 扇形，16（雷牦 11）+ 挑飞；左右交替。
    ///   · 雷球砸地 <c>slam</c>（攒满 3 份）：人立、雷球亮到发白 1.4 s → 8 m 环形冲击（人在地上才挨，20 + 雷殛）；
    ///     前摇里打雷球 120 → 雷球在它脸上炸开：自伤 150 + 眩晕 2.5 s（阈值按血量口径缩放）。
    ///   · 带电：雷球攒了电（≥ 1 份）时带电（常驻持有）。
    /// </summary>
    public sealed class AoyinAI : PlateauEnemyAI
    {
        public const float StampedeSpeed = 13f, StampedeMin = 8f, StampedeMax = 34f, LaneLength = 40f, LaneWidth = 3.2f;
        public const float GoreRange = 4.2f, SlamRadius = 8f, OrbCounter = 120f, OrbSelfDamage = 150f, OrbStun = 2.5f;
        public const float FurBurnSeconds = 1.5f, FurArmor = 0.2f, VeinMult = 1.25f, HeadMult = 1.6f;
        static readonly string[] FurZones = { "chest", "rump", "back", "shoulderL", "shoulderR", "haunchL", "haunchR" };
        static readonly Dictionary<string, (string bone, float r)> FurBone = new()
        {
            ["chest"] = ("chest", 1.0f), ["rump"] = ("hips", 0.9f), ["back"] = ("spine", 0.85f),
            ["shoulderL"] = ("upperarm_L", 0.55f), ["shoulderR"] = ("upperarm_R", 0.55f), ["haunchL"] = ("thigh_L", 0.55f), ["haunchR"] = ("thigh_R", 0.55f),
        };

        static readonly PlateauMove GoreL = new()
        {
            id = "goreL", name = "四角挑（左）", windup = PlateauMoves.AoyinGore.windup, active = PlateauMoves.AoyinGore.active,
            recover = PlateauMoves.AoyinGore.recover, cooldown = PlateauMoves.AoyinGore.cooldown,
        };

        public bool Leiyak { get; private set; }
        /// <summary>角间雷球攒的电（0..3）</summary>
        public int OrbCharge { get; private set; }
        /// <summary>每片蓑毛：1 = 完整、0 = 烧光</summary>
        public readonly Dictionary<string, float> Fur = new();
        public int FurBurnedCount { get; private set; }
        public bool OrbDetonated { get; private set; }
        public bool StampedeHit { get; private set; }
        public AoyinAI Leader { get; private set; }

        readonly Dictionary<string, float> burning = new();
        readonly Dictionary<string, HitZone> zones = new();
        readonly Dictionary<string, Transform> veins = new();
        HitZone head;
        PlateauOrb orb;
        IDisposable armour, orbHold;
        Vector3 laneFrom, dir, forcedDir;
        float laneLen, stampCd, sparkT, scrapeT, orbDmg, ringR, side = 1;
        bool hasForced, ringHit, detonating;
        int scrapes;

        protected override void Awake()
        {
            Leiyak = enemyId == "leiyak" || name.Contains("leiyak");
            glowBoneName = Leiyak ? null : "orb";
            glowSize = 2.0f;
            sight = Leiyak ? 28f : 30f;
            centerY = 1.3f;
            base.Awake();
            armour = hp.Incoming.Add(ArmourIncoming);
            hp.Damaged += OnAoyinDamaged;
        }

        protected override void Start()
        {
            base.Start();
            Leiyak = enemyId == "leiyak";
            if (Leiyak)
            {
                // 雷牦：毛色暗一些，没有雷球和蓑毛
                body.SetTint("leiyak", new Color(0.62f, 0.6f, 0.6f, 1f));
                return;
            }
            foreach (var z in FurZones)
            {
                Fur[z] = 1f;
                var (bone, r) = FurBone[z];
                zones[z] = BoneZone(bone, r, "fur_" + z, false, false, 1);
                var b = Bone(bone);
                if (b)
                {
                    var v = FxMaterials.GlowSprite(b, 1f, PlateauPalette.Bolt);
                    v.gameObject.SetActive(false);
                    veins[z] = v;
                }
            }
            head = BoneZone("head", 0.45f, "head", false, false, 2);
            var ob = Bone("orb");
            if (ob) orb = PlateauOrb.Attach(ob, Vector3.zero, 0.42f * Size);
            if (body.WeakZone)
            {
                body.WeakZone.facing = ZoneFacing.Front;
                body.WeakZone.facingCos = 0.2f;
            }
        }

        public bool Armored => !Leiyak && Fur.Count > 0 && FurBurnedCount < Fur.Count;

        /// <summary>蓑毛 / 头的倍率：持续伤害、反应吃 1；没烧的毛 0.2 → 烧着的往 1 走 → 烧光的雷筋 1.25；头 1.6</summary>
        float ArmourIncoming(in IncomingHit h)
        {
            if (Dead || Leiyak) return 1;
            var info = h.info;
            if (IsDot(info) || info.reaction || (info.tags & DamageTag.Reaction) != 0) return 1;
            var z = ZoneOf(info);
            if (!z || z == body.WeakZone) return 1;
            if (z == head) return HeadMult;
            foreach (var (id, zone) in zones)
                if (zone == z)
                {
                    float f = Fur[id];
                    return f > 0 ? FurArmor + (1 - FurArmor) * (1 - f) : VeinMult;
                }
            return 1;
        }

        void OnAoyinDamaged(DamageInfo info, DamageResult r)
        {
            if (Dead || Leiyak || r.immune) return;
            // 火：烧打中的那片 / 爆炸半径里的几片；熔金：每片烧一半
            bool fire = info.element == Element.Fire && !IsDot(info);
            bool blast = IsBlast(info);
            if (info.reactionId == Reaction.Meltdown)
                foreach (var id in FurZones)
                    if (Fur[id] > 0) burning[id] = Mathf.Max(burning.TryGetValue(id, out var b) ? b : 0, 0.5f);
            if (fire || blast)
            {
                var hitZone = ZoneOf(info);
                foreach (var (id, zone) in zones)
                {
                    if (Fur[id] <= 0 || !zone) continue;
                    bool inBlast = blast && Vector3.Distance(zone.transform.position, info.point) < 2.6f;
                    if (zone == hitZone || inBlast) burning[id] = Mathf.Max(burning.TryGetValue(id, out var b) ? b : 0, 1f);
                }
            }
            // 雷球反制：砸地前摇里打雷球
            if (!detonating && Move.Id == "slam" && Move.Stage == MoveStage.Windup && r.total > 0 && ZoneOf(info) == body.WeakZone)
            {
                orbDmg += r.total;
                if (orbDmg >= OrbCounter * HpScale(900f)) DetonateOrb();
            }
        }

        void DetonateOrb()
        {
            detonating = true;
            OrbDetonated = true;
            var at = orb ? orb.transform.position : Center + transform.forward * 1.5f;
            Fx.PlateauBallLightning(at, 2.5f);
            Fx.PlateauSparks(at, 30, 7f, 0.1f);
            Quake(0.3f, 30f);
            SetOrbCharge(0);
            InterruptAttack();
            SelfDamage(OrbSelfDamage * HpScale(900f), at);
            if (!Dead) HitStun(OrbStun, HitCause.Counter, "雷球在脸上炸开，眩晕");
            detonating = false;
        }

        void SetOrbCharge(int n)
        {
            OrbCharge = Mathf.Clamp(n, 0, 3);
            if (OrbCharge > 0 && orbHold == null) orbHold = Charge.Hold(hp, this);
            else if (OrbCharge == 0 && orbHold != null)
            {
                orbHold.Dispose();
                orbHold = null;
            }
        }

        protected override void Update()
        {
            base.Update();
            if (Dead || Leiyak) return;
            float dt = Time.deltaTime;
            // 蓑毛：烧着的那片 1.5 s 烧光，冒火；烧光那一下一团紫红闪、露出雷筋
            foreach (var id in FurZones)
            {
                if (!burning.TryGetValue(id, out float b) || b <= 0 || Fur[id] <= 0) continue;
                Fur[id] = Mathf.Max(0, Fur[id] - dt / FurBurnSeconds * Mathf.Max(1, b));
                var at = zones[id] ? zones[id].transform.position : Center;
                if (Random.value < dt * 9f) Fx.PlateauFurFlame(at, 0.7f * Size);
                if (Fur[id] <= 0)
                {
                    burning[id] = 0;
                    FurBurnedCount++;
                    Fx.Play("ToonBurst", at, Vector3.up, PlateauPalette.Bolt, 1.1f * Size);
                    Fx.PlateauCrackle(at, 0.6f * Size);
                    if (veins.TryGetValue(id, out var v) && v) v.gameObject.SetActive(true);
                }
            }
            foreach (var (id, v) in veins)
            {
                if (!v || !v.gameObject.activeSelf) continue;
                float parent = Mathf.Max(1e-3f, Mathf.Abs(v.parent.lossyScale.x));
                v.localScale = Vector3.one * 1.1f * Size / parent;
                FxMaterials.Tint(v.GetComponent<Renderer>(), PlateauPalette.A(PlateauPalette.Bolt, 0.45f + 0.25f * Mathf.Sin(Time.time * 9f + id.Length)));
            }
            if (orb)
            {
                float windup = Move.Id == "slam" && Move.Stage == MoveStage.Windup ? Move.StageK : Move.Id == "slam" && Move.Stage == MoveStage.Active ? 1 : 0;
                orb.level = Mathf.Clamp01(OrbCharge / 3f * 0.6f + windup);
                orb.size = (0.42f + 0.12f * OrbCharge + 0.2f * windup) * Size;
            }
        }

        protected override void Fight(float dt, float dist)
        {
            if (!Leiyak && OrbCharge >= 3 && cooldown <= 0 && TakeToken(PlateauPack.Token.Melee, AttackTokens.Kind.Heavy, 3f))
            {
                cooldown = 2f;
                Begin(PlateauMoves.AoyinSlam);
                return;
            }
            if (cooldown <= 0 && dist < GoreRange * Size + 0.8f && TakeToken(PlateauPack.Token.Melee, AttackTokens.Kind.Melee, 1.6f))
            {
                side = -side;
                cooldown = PlateauMoves.AoyinGore.cooldown;
                Begin(side > 0 ? PlateauMoves.AoyinGore : GoreL);
                return;
            }
            bool leaderAlive = false;
            if (Leiyak)
                foreach (var m in Pack.Mates(this))
                    if (m is AoyinAI a && !a.Leiyak)
                        leaderAlive = true;
            if (cooldown <= 0 && dist > StampedeMin && dist < (Leiyak ? 26f : StampedeMax) && Time.time >= stampCd && (!Leiyak || !leaderAlive)
                && RequestAttack(AttackTokens.Kind.Heavy, 5.5f))
            {
                stampCd = Time.time + (Leiyak ? 6f : PlateauMoves.AoyinStampede.cooldown);
                cooldown = 1f;
                hasForced = false;
                Begin(PlateauMoves.AoyinStampede);
                return;
            }
            if (dist > 3f) MoveTo(PlayerPos, moveSpeed);
            else Stop();
            if (agent && agent.enabled && agent.velocity.sqrMagnitude > 0.5f) FaceMovement(120f, dt);
            else FacePlayer(110f, dt);
            Loco();
        }

        /// <summary>雷牦跟着獓狠冲：同一朝向、横向错开 off</summary>
        public void JoinStampede(AoyinAI lead, Vector3 laneDir, float off, float len)
        {
            if (Dead || Move.Busy || Stunned || HitStaggered) return;
            Leader = lead;
            forcedDir = laneDir;
            hasForced = true;
            laneLen = len;
            transform.rotation = Quaternion.LookRotation(laneDir);
            stampCd = Time.time + 6f;
            Begin(PlateauMoves.AoyinStampede);
        }

        protected override void OnMoveBegin(PlateauMove m)
        {
            if (m.id == "stampede")
            {
                StampedeHit = false;
                scrapes = 0;
                scrapeT = 0.3f;
            }
            if (m.id == "slam")
            {
                orbDmg = 0;
                ringHit = false;
                ringR = 0;
            }
        }

        protected override void OnMoveEvent(string id, string evt)
        {
            switch (id)
            {
                case "stampede" when evt == "warn":
                {
                    // 冲撞线：沿朝向 40 m（导航网格挡住就截短）
                    if (!hasForced)
                    {
                        var to = PlayerPos - transform.position;
                        to.y = 0;
                        dir = to.sqrMagnitude > 1e-3f ? to.normalized : transform.forward;
                        laneLen = LaneLength;
                    }
                    else dir = forcedDir;
                    transform.rotation = Quaternion.LookRotation(dir);
                    laneFrom = transform.position;
                    if (NavMesh.Raycast(laneFrom, laneFrom + dir * laneLen, out var hit, NavMesh.AllAreas)) laneLen = Mathf.Max(8f, hit.distance);
                    Warn(Telegraph.Lane(laneFrom, laneFrom + dir * laneLen, LaneWidth * Mathf.Max(0.8f, Size), PlateauMoves.AoyinStampede.windup, TelegraphPalette.Danger));
                    // 领群：同群空着的雷牦在两侧平行排开
                    if (!Leiyak)
                    {
                        int lane = 1;
                        foreach (var m in Pack.Mates(this))
                            if (m is AoyinAI a && a.Leiyak && !a.Move.Busy)
                            {
                                float off = (lane % 2 == 1 ? 1 : -1) * 4f * Mathf.Ceil(lane / 2f);
                                var right = new Vector3(dir.z, 0, -dir.x);
                                a.transform.position += right * off * 0.3f;
                                a.JoinStampede(this, dir, off, laneLen);
                                lane++;
                            }
                    }
                    break;
                }
                case "stampede" when evt == "hit":
                    // 起步：后腿一蹬
                    BeginManualMotion(dir * StampedeSpeed * HasteMult, EnemyAI.LaunchGravity);
                    Fx.PlateauDirt(transform.position - dir * 0.6f * Size, 1.4f * Size, 10);
                    Fx.Play("ToonDust", transform.position, Vector3.up, PlateauPalette.Dust, 1.6f * Size);
                    Quake(0.3f, 24f);
                    ImpactHold(0.05f);
                    break;
                case "gore" or "goreL" when evt == "warn":
                    Warn(Telegraph.Sector(transform.position, transform.eulerAngles.y, 60f, GoreRange * Size + 0.6f, PlateauMoves.AoyinGore.windup, TelegraphPalette.Danger));
                    break;
                case "gore" or "goreL" when evt == "hit":
                {
                    float yaw = transform.eulerAngles.y;
                    var hornAt = BonePos(Bone("head")) + transform.forward * 0.6f * Size;
                    Fx.PlateauCrescent(transform.position + Vector3.up * 1.3f * Size, yaw, 3.2f * Size, 2.1f, id == "gore" ? 1 : -1, 0.5f * (id == "gore" ? 1 : -1), 0.55f * Size, 0.2f);
                    Fx.PlateauSparks(hornAt, 6, 4f);
                    ImpactHold(0.05f);
                    if (PlateauGeo.InCone(PlayerPos, transform.position, yaw * Mathf.Deg2Rad, GoreRange * Size + 0.6f, 1.05f))
                        Strike(Leiyak ? 11f : 16f, transform.position + Vector3.up, Element.None, PlateauGeo.Knock(PlayerPos, transform.position, 6f, 7f));
                    break;
                }
                case "slam" when evt == "warn":
                    Warn(Telegraph.Circle(transform.position, SlamRadius, PlateauMoves.AoyinSlam.windup, TelegraphPalette.Danger));
                    GameUI.FloatText(Center + Vector3.up * 2f, "打角间的雷球！", PlateauPalette.Bolt, 1.1f);
                    break;
                case "slam" when evt == "hit":
                {
                    var g = transform.position;
                    Telegraph.Wave(g, SlamRadius, SlamRadius / 0.35f, TelegraphPalette.Danger, TelegraphTone.Danger);
                    Fx.PlateauArcRing(g, 1.5f, 12, 1.6f, 0.22f, 0.06f);
                    PlateauFxSeq.After(0.12f, () => Fx.PlateauArcRing(g, 4.5f, 10, 1.4f, 0.2f, 0.05f));
                    PlateauFxSeq.After(0.25f, () => Fx.PlateauArcRing(g, 7.2f, 12, 1.2f, 0.18f, 0.05f));
                    Fx.Play("ToonBurst", g + transform.forward * 1.5f * Size + Vector3.up * 0.5f, Vector3.up, PlateauPalette.Core, 2f);
                    Fx.PlateauDirt(g + transform.forward * 1.6f * Size, 1.8f * Size, 16);
                    Fx.PlateauScorch(g + transform.forward * 1.6f * Size, 2.2f);
                    Quake(0.45f, 34f);
                    ImpactHold(0.08f);
                    SetOrbCharge(0);
                    break;
                }
            }
        }

        protected override void MoveTick(float dt, MoveStage stage, float k)
        {
            switch (Move.Id)
            {
                case "stampede":
                    if (stage == MoveStage.Windup)
                    {
                        Stop();
                        // 刨地两下：蹄后一扇土块
                        scrapeT -= dt;
                        if (scrapeT <= 0 && scrapes < 2)
                        {
                            scrapes++;
                            scrapeT = 0.3f;
                            var hoof = BonePos(Bone("fhoof_R"));
                            Fx.PlateauDirt(hoof - transform.forward * 0.4f * Size, 0.9f * Size, 6);
                        }
                        // 线上冒紫红电火花（身份层：这是雷魅的冲撞）
                        sparkT -= dt;
                        if (sparkT <= 0)
                        {
                            sparkT = 0.12f;
                            var p = laneFrom + dir * Random.Range(2f, laneLen) + new Vector3(dir.z, 0, -dir.x) * Random.Range(-1.2f, 1.2f);
                            p.y = Ground(p) + 0.05f;
                            Fx.PlateauSparks(p, 3, 2.5f, 0.07f);
                            if (Random.value < 0.35f) Fx.PlateauBolt(p, p + Vector3.up * 0.6f + dir * 0.4f, 0.04f, 0.1f, 0, 1f, false);
                        }
                    }
                    else if (stage == MoveStage.Active)
                    {
                        float v = StampedeSpeed * HasteMult;
                        SetManualVelocity(new Vector3(dir.x * v, ManualVelocity.y, dir.z * v));
                        sparkT -= dt;
                        if (sparkT <= 0)
                        {
                            sparkT = 0.1f;
                            Fx.PlateauDirt(transform.position - dir * 1.2f * Size, 0.7f * Size, 3);
                        }
                        if (!StampedeHit && !PlayerInvulnerable)
                        {
                            var d = PlayerPos - transform.position;
                            if (new Vector3(d.x, 0, d.z).magnitude < 2.0f * Size + 0.6f && d.y < 2.2f * Size)
                            {
                                StampedeHit = true;
                                Strike(Leiyak ? 16f : 24f, transform.position + Vector3.up, Element.None, dir * 14f + Vector3.up * 6f);
                            }
                        }
                        float run = Vector3.Distance(PlateauPack.Flat(transform.position), PlateauPack.Flat(laneFrom));
                        if (HitWall || run >= laneLen)
                        {
                            HitWall = false;
                            FinishActive();
                            if (!Leiyak) SetOrbCharge(OrbCharge + 1);
                        }
                    }
                    else
                    {
                        // 打滑停下、慢慢转身
                        float slow = Mathf.Clamp01(1 - k / 0.3f);
                        SetManualVelocity(new Vector3(dir.x * 4f * slow, ManualVelocity.y, dir.z * 4f * slow));
                        if (k > 0.3f) EndManualMotion();
                        if (k > 0.5f) FacePlayer(90f, dt);
                    }
                    break;
                case "gore" or "goreL":
                    Stop();
                    if (stage == MoveStage.Windup) FacePlayer(230f, dt);
                    break;
                case "slam":
                    Stop();
                    if (stage == MoveStage.Windup && orb && Random.value < dt * 7f)
                    {
                        // 角尖往雷球连细雷刃
                        var o = orb.transform.position;
                        Fx.PlateauBolt(BonePos(Bone(Random.value < 0.5f ? "horn_L" : "horn_R")), o, 0.03f, 0.12f, 0, 1f, false);
                    }
                    if (stage == MoveStage.Active && !ringHit)
                    {
                        // 冲击环与判定同步：环经过时人在地上就挨
                        ringR = SlamRadius * Mathf.Clamp01(Move.StageT / 0.35f);
                        float d = Vector3.Distance(PlateauPack.Flat(PlayerPos), PlateauPack.Flat(transform.position));
                        if (Mathf.Abs(d - ringR) < 1.2f && PlayerGrounded && !PlayerInvulnerable && Mathf.Abs(PlayerPos.y - transform.position.y) < 2.5f)
                        {
                            ringHit = true;
                            Strike(20f, transform.position, Element.Shock, PlateauGeo.Knock(PlayerPos, transform.position, 8f, 5f));
                        }
                    }
                    break;
            }
        }

        protected override void OnMoveEnd(string id)
        {
            if (id == "stampede")
            {
                EndManualMotion();
                Leader = null;
            }
        }

        protected override void OnInterrupt(string id)
        {
            if (id == "stampede")
            {
                EndManualMotion();
                Leader = null;
            }
        }

        /// <summary>强制出招（试玩套件 / 节拍条）：slam 前先把雷球攒满</summary>
        public void Force(string id)
        {
            Notice(false);
            switch (id)
            {
                case "slam":
                    SetOrbCharge(3);
                    Begin(PlateauMoves.AoyinSlam);
                    break;
                case "gore":
                    Begin(PlateauMoves.AoyinGore);
                    break;
                case "goreL":
                    Begin(GoreL);
                    break;
                default:
                    hasForced = false;
                    Begin(PlateauMoves.AoyinStampede);
                    break;
            }
        }

        /// <summary>蓑毛某片的命中区中心（试玩套件：往那里打火）</summary>
        public Vector3 FurPoint(string id) => zones.TryGetValue(id, out var z) && z ? z.transform.position : Center;

        public static IReadOnlyList<string> FurZoneIds => FurZones;

        protected override void OnDeath(DamageInfo info, PlateauDeath kind)
        {
            armour?.Dispose();
            orbHold?.Dispose();
            orbHold = null;
            foreach (var v in veins.Values)
                if (v)
                    v.gameObject.SetActive(false);
            if (orb)
            {
                // 雷球暗下去、啪地放一圈小电
                var at = orb.transform.position;
                Fx.PlateauArcRing(new Vector3(at.x, Ground(at) + 0.1f, at.z), 0.6f, 6, 2.4f, 0.2f, 0.04f);
                orb.visible = false;
            }
        }
    }
}
