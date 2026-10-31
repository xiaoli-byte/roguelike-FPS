using System;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 穷奇（第四章游猎·精英；combat 3.8，设计单第 8 节）：虎身有翼，背上猬毛雷冠。每张图一只，名册直接是精英级（金环 + 词缀 + EliteStrike），
    /// 出手在 EliteStrike 的金色分量层上再叠第四章的紫红点缀（金 = 精英，紫红 = 雷魅）。
    ///   · 游猎 patrol：沿 <see cref="route"/> 巡视（M1 路给路点，没给就绕出生点一圈）；雷暴时主动来找 70 m 内的玩家。
    ///   · 上脊 ridge：发现玩家后先跑上 25 m 内比现在高 4 m 以上的高地。
    ///   · 掠空扑杀 <c>glide</c>：伏低张翼、雷冠亮 0.7 s → 滑翔 20–35 m（地上的影子越来越大越黑，落点 3.5 m 圈）→ 落地扑杀 22（吞雷后 + 雷殛）。
    ///     滑翔中打翼根 120（按血量口径缩放）→ 坠地眩晕 2 s。
    ///   · 翼刃雷旋 <c>spin</c>（贴脸 3.8 m）：双翼一展 0.5 s → 原地旋斩一圈 4 m，16；转完晃 0.8 s。
    ///   · 爪击 <c>claw</c>（3 m）：抬一只前爪 → 两下，各 10。
    ///   · 吞雷 <c>absorb</c>：12 m 内落雷，跑过去人立接雷，带电 15 s；接雷时打雷冠 80 → 雷冠过载，眩晕 1.5 s。
    ///   · 撤退 flee：血 &lt; 30% 长啸一声展翼飞回巢穴回血（只一次），可以追；回到 60% 或玩家追到 18 m 内就回来打。
    /// 弱点：雷冠 ×暴击（weak）、头 ×1.6、翼根（只在滑翔、旋斩时露出来）。
    /// </summary>
    public sealed class QiongqiAI : PlateauEnemyAI
    {
        public const float GlideSpeed = 18f, GlideHeight = 4f, SlamRadius = 3.5f, SlamDamage = 22f, WingCounter = 120f, CrashStun = 2f;
        public const float SpinRange = 3.8f, SpinRadius = 4.2f, SpinDamage = 16f, ClawRange = 3.2f, ClawDamage = 10f;
        public const float AbsorbRange = 12f, AbsorbCharge = 15f, CrownCounter = 80f, CrownStun = 1.5f, HeadMult = 1.6f;
        public const float FleeAt = 0.3f, FleeSpeed = 13f, FleeHeight = 8f, LairHeal = 0.08f;

        /// <summary>巡视路点（M1 路的 4-1 游猎线；没给就绕出生点）与巢穴</summary>
        public Vector3[] route;
        public Vector3 lair;
        public bool Fled { get; private set; }
        public bool Fleeing { get; private set; }
        public bool Crashed { get; private set; }
        public int Glides { get; private set; }
        public int Absorbs { get; private set; }
        public Vector3 GlideFrom => A;
        public Vector3 GlideTo => B;

        EliteStrike strike;
        HitZone wingL, wingR, head;
        PlateauShapeHandle shadow;
        Vector3 A, B, ridge, boltAt;
        float flight = 1.2f, wingDmg, crownDmg, glideCd, spinCd;
        int leg;
        bool goRidge, ridged, crash, landed, manualOn;

        protected override bool Leashes => false;

        protected override void Awake()
        {
            glowBoneName = "crown";
            glowSize = 1.4f;
            sight = 34f;
            centerY = 0.9f;
            base.Awake();
            hp.Incoming.Add(ZoneIncoming);
            hp.Damaged += OnQiongqiDamaged;
        }

        protected override void Start()
        {
            base.Start();
            wingL = BoneZone("wing_1_L", 0.45f, "wingL", true, true, 4);
            wingR = BoneZone("wing_1_R", 0.45f, "wingR", true, true, 4);
            head = BoneZone("head", 0.38f, "head", false, false, 2);
            wingL.SetActive(false);
            wingR.SetActive(false);
            strike = EliteStrike.For(this);
        }

        /// <summary>穷奇永远是精英（名册 rank = Elite；定义生命按 ×2.6 折算过）</summary>
        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, true);
            if (route == null || route.Length == 0)
            {
                route = new Vector3[4];
                for (int i = 0; i < 4; i++)
                {
                    float a = i * Mathf.PI * 0.5f;
                    var p = home + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * 18f;
                    route[i] = NavMesh.SamplePosition(p, out var hit, 6f, NavMesh.AllAreas) ? hit.position : home;
                }
            }
            if (lair == Vector3.zero) lair = home;
        }

        protected override void Subscribe(bool on)
        {
            LightningStrike.Landed -= OnStrikeLanded;
            if (on) LightningStrike.Landed += OnStrikeLanded;
        }

        float ZoneIncoming(in IncomingHit h)
        {
            if (Dead) return 1;
            var z = ZoneOf(h.info);
            return z && z == head ? HeadMult : 1f;
        }

        void OnQiongqiDamaged(DamageInfo info, DamageResult r)
        {
            if (Dead || r.total <= 0) return;
            var z = ZoneOf(info);
            // 翼根：滑翔中打穿就坠地
            if ((z == wingL || z == wingR) && Move.Id == "glide" && Move.Stage == MoveStage.Active && !crash)
            {
                wingDmg += r.total;
                if (wingDmg >= WingCounter * HpScale(1100f))
                {
                    crash = true;
                    Crashed = true;
                    GameUI.FloatText(Center + Vector3.up, "翼根被打穿——坠地", PlateauPalette.Bolt, 1.1f);
                }
            }
            // 雷冠：接雷时打过载
            if (z == body.WeakZone && Move.Id == "absorb" && Move.Stage != MoveStage.Recover)
            {
                crownDmg += r.total;
                if (crownDmg >= CrownCounter * HpScale(1100f))
                {
                    crownDmg = 0;
                    Fx.PlateauBallLightning(BonePos(GlowBone), 2f);
                    HitStun(CrownStun / StunStatus.ScaledDuration(Rank.Elite, 1f), HitCause.Counter, "雷冠过载，眩晕");
                }
            }
        }

        /// <summary>12 m 内落雷：去接雷</summary>
        void OnStrikeLanded(StrikeInfo s)
        {
            if (!this || Dead || !Alerted || Move.Busy || Stunned || HitStaggered || Fleeing) return;
            if (Vector3.Distance(PlateauPack.Flat(s.point), PlateauPack.Flat(transform.position)) > AbsorbRange) return;
            boltAt = s.point;
            Begin(PlateauMoves.QiongqiAbsorb);
        }

        protected override void Roam(float dt)
        {
            Glow = 0.05f;
            // 雷暴时主动来找 70 m 内的玩家
            if (StormLevel > 0.5f && DistToPlayer < 70f && vitals && !vitals.Dead)
            {
                Notice(true);
                return;
            }
            if (route != null && route.Length > 0)
            {
                var to = route[leg % route.Length];
                MoveTo(to, moveSpeed);
                if (Vector3.Distance(PlateauPack.Flat(to), PlateauPack.Flat(transform.position)) < 3f) leg++;
                FaceMovement(200f, dt);
            }
            if (hp.health < hp.maxHealth) hp.Heal(10f * dt);
            if (vitals && !vitals.Dead && DistToPlayer < Sight && sees) Notice(true);
            Loco();
        }

        protected override void Fight(float dt, float dist)
        {
            if (!Fled && hp.health < hp.maxHealth * FleeAt)
            {
                Fled = Fleeing = true;
                GameUI.FloatText(Center + Vector3.up * 1.2f, "穷奇展翼飞回巢穴了", PlateauPalette.Bolt, 1.1f);
                Fx.PlateauSparks(BonePos(GlowBone), 10, 4f);
            }
            if (Fleeing)
            {
                Flee(dt, dist);
                return;
            }
            if (dist < SpinRange * Size / 1.25f + 0.4f && cooldown <= 0 && Time.time >= spinCd && Random.value < 0.5f)
            {
                spinCd = Time.time + PlateauMoves.QiongqiSpin.cooldown;
                cooldown = 0.6f;
                Begin(PlateauMoves.QiongqiSpin);
                return;
            }
            if (dist < 3f * Size / 1.25f + 0.3f && cooldown <= 0)
            {
                cooldown = PlateauMoves.QiongqiClaw.cooldown;
                Begin(PlateauMoves.QiongqiClaw);
                return;
            }
            bool high = transform.position.y - PlayerPos.y > 3f;
            if (cooldown <= 0 && Time.time >= glideCd && ((high && dist > 12 && dist < 35) || (!high && dist > 9 && dist < 24))
                && RequestAttack(AttackTokens.Kind.Heavy, 4f))
            {
                glideCd = Time.time + PlateauMoves.QiongqiGlide.cooldown;
                cooldown = 1f;
                Begin(PlateauMoves.QiongqiGlide);
                return;
            }
            // 上脊：先跑上近处的高地
            if (!ridged && dist > 10)
            {
                ridged = true;
                goRidge = FindRidge();
            }
            if (goRidge)
            {
                MoveTo(ridge, 8f);
                FaceMovement(360f, dt);
                if (Vector3.Distance(ridge, transform.position) < 2.5f || (agent && agent.enabled && !agent.pathPending && agent.remainingDistance < 0.5f)) goRidge = false;
                Loco();
                return;
            }
            MoveTo(PlayerPos, dist > 12 ? 8f : moveSpeed);
            FaceMovement(300f, dt);
            Loco();
        }

        /// <summary>25 m 内比现在高 4 m 以上、站得住的山脊 / 丘顶</summary>
        bool FindRidge()
        {
            float best = float.MaxValue;
            var p = transform.position;
            for (int k = 0; k < 16; k++)
            {
                float a = k / 16f * Mathf.PI * 2;
                for (float r = 6; r <= 25; r += 4)
                {
                    var q = p + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * r;
                    if (!Physics.Raycast(q + Vector3.up * 30f, Vector3.down, out var hit, 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                    if (hit.point.y - p.y < 4f) continue;
                    if (!NavMesh.SamplePosition(hit.point, out var nav, 1.5f, NavMesh.AllAreas)) continue;
                    if (r < best)
                    {
                        best = r;
                        ridge = nav.position;
                    }
                }
            }
            return best < float.MaxValue;
        }

        void Flee(float dt, float dist)
        {
            var p = transform.position;
            var to = lair - p;
            to.y = 0;
            if (to.magnitude > 4f)
            {
                if (!manualOn)
                {
                    manualOn = true;
                    BeginManualMotion(Vector3.zero, 0);
                }
                ActLoop("flee");
                var step = to.normalized * Mathf.Min(to.magnitude, FleeSpeed * dt);
                p += step;
                p.y += (Ground(p) + FleeHeight - p.y) * Mathf.Min(1, dt * 2f);
                transform.position = p;
                transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(to), 300f * dt);
                return;
            }
            // 回到巢穴：落地回血
            if (manualOn)
            {
                transform.position = new Vector3(p.x, Ground(p), p.z);
                EndManualMotion();
                manualOn = false;
                Loco();
            }
            Stop();
            hp.Heal(hp.maxHealth * LairHeal * dt);
            if (hp.health > hp.maxHealth * 0.6f || dist < 18f) Fleeing = false;
        }

        protected override void OnMoveBegin(PlateauMove m)
        {
            Fx.EliteCue(BonePos(GlowBone), 0.8f);
            switch (m.id)
            {
                case "glide":
                    wingDmg = 0;
                    crash = false;
                    landed = false;
                    Glides++;
                    break;
                case "absorb":
                    crownDmg = 0;
                    Absorbs++;
                    break;
            }
        }

        protected override void OnMoveEvent(string id, string evt)
        {
            switch (id)
            {
                case "glide" when evt == "warn":
                {
                    A = transform.position;
                    float lead = 0.7f + Mathf.Min(1.6f, DistToPlayer / 18f);
                    var v = PlayerVelocity;
                    var b = PlayerPos + new Vector3(v.x, 0, v.z) * lead * 0.6f;
                    B = NavMesh.SamplePosition(b, out var hit, 2f, NavMesh.AllAreas) ? hit.position : PlayerPos;
                    flight = Mathf.Clamp(Vector3.Distance(A, B) / GlideSpeed, 0.8f, 1.6f);
                    Warn(Telegraph.Circle(B, SlamRadius, (PlateauMoves.QiongqiGlide.windup + flight) / HasteMult, TelegraphPalette.Danger));
                    break;
                }
                case "glide" when evt == "hit":
                {
                    // 起飞：后腿一蹬、双翼往下一扇
                    manualOn = true;
                    BeginManualMotion(Vector3.zero, 0);
                    SetWings(true);
                    shadow = Fx.PlateauShadow(transform.position, 1.2f * Size);
                    var dir = (B - A).normalized;
                    Fx.Play("ToonDust", transform.position + Vector3.up * 0.05f, Vector3.up, PlateauPalette.Dust, 2.2f);
                    Fx.Burst(transform.position, PlateauPalette.Grass, 10, 5f, 0.5f, 0.15f, 3);
                    Fx.EliteRelease(BonePos(GlowBone), dir, 1.2f);
                    strike?.Release(-0.12f, -6f, 0.05f);
                    break;
                }
                case "glide" when evt == "land":
                    LandSlam();
                    break;
                case "spin" when evt == "warn":
                    SetWings(true);
                    Warn(Telegraph.Circle(transform.position, SpinRadius, PlateauMoves.QiongqiSpin.windup / HasteMult, TelegraphPalette.Danger));
                    break;
                case "spin" when evt == "hit":
                {
                    var c = transform.position + Vector3.up * 1.0f * Size;
                    float yaw = transform.eulerAngles.y;
                    Fx.PlateauCrescent(c, yaw, SpinRadius * 0.85f, Mathf.PI * 2f, 1, 0.12f, 0.7f, 0.25f);
                    Fx.PlateauCrescent(c + Vector3.up * 0.25f, yaw + 180f, SpinRadius * 0.75f, Mathf.PI * 1.6f, 1, -0.2f, 0.5f, 0.22f);
                    Fx.PlateauArcRing(transform.position, SpinRadius * 0.6f, 8, 1.2f, 0.2f, 0.05f);
                    Fx.EliteRelease(c, transform.forward, 1.0f);
                    strike?.Release(-0.1f, 0f, 0.05f);
                    Quake(0.25f, 18f);
                    if (DistToPlayer < SpinRadius && !PlayerInvulnerable)
                        Strike(SpinDamage, transform.position, Charged ? Element.Shock : Element.None, PlateauGeo.Knock(PlayerPos, transform.position, 7f, 3f));
                    break;
                }
                case "claw" when evt is "hit1" or "hit2":
                {
                    int side = evt == "hit1" ? 1 : -1;
                    var paw = BonePos(Bone(side > 0 ? "paw_L" : "paw_R"));
                    Fx.PlateauClaw(paw + transform.forward * 0.5f, transform.forward, 1.5f * Size, side);
                    if (evt == "hit2") Fx.EliteRelease(paw, transform.forward, 0.7f);
                    strike?.Kick(-0.05f, 5f);
                    if (PlateauGeo.InCone(PlayerPos, transform.position, transform.eulerAngles.y * Mathf.Deg2Rad, ClawRange * Size / 1.25f + 0.4f, 0.9f))
                        Strike(ClawDamage, transform.position + Vector3.up, Element.None, PlateauGeo.Knock(PlayerPos, transform.position, 3f));
                    break;
                }
                case "absorb" when evt == "eat":
                {
                    var crown = BonePos(GlowBone);
                    Fx.PlateauSkyBolt(boltAt, 18f, 0.24f);
                    Fx.PlateauBolt(crown + Vector3.up * 18f, crown, 0.2f, 0.3f, 2, 0.5f);
                    Fx.Play("ToonBurst", crown, Vector3.up, PlateauPalette.Core, 1.6f);
                    Fx.PlateauSparks(crown, 14, 4f);
                    Charge.Apply(hp, AbsorbCharge, this);
                    GameUI.FloatText(crown + Vector3.up * 0.6f, "吞雷", PlateauPalette.Bolt, 1f);
                    break;
                }
            }
        }

        void SetWings(bool open)
        {
            if (wingL) wingL.SetActive(open);
            if (wingR) wingR.SetActive(open);
        }

        /// <summary>落地扑杀：3.5 m，22（吞雷后 + 雷殛）</summary>
        void LandSlam()
        {
            if (landed) return;
            landed = true;
            var p = transform.position;
            p.y = Ground(p);
            transform.position = p;
            EndManualMotion();
            manualOn = false;
            shadow.End();
            SetWings(false);
            bool ch = Charged;
            float yaw = transform.eulerAngles.y;
            // 两道交叉的爪风月牙 + 贴地冲击环 + 金环
            Fx.PlateauCrescent(p + Vector3.up * 0.4f, yaw + 35f, SlamRadius * 0.8f, 1.6f, 1, 0.5f, 0.6f, 0.2f, -20f);
            Fx.PlateauCrescent(p + Vector3.up * 0.4f, yaw - 35f, SlamRadius * 0.8f, 1.6f, -1, -0.5f, 0.6f, 0.2f, -20f);
            Telegraph.Wave(p, SlamRadius, SlamRadius / 0.3f, TelegraphPalette.Danger, TelegraphTone.Danger);
            Fx.EliteSlam(p, SlamRadius);
            Fx.PlateauDirt(p, 1.4f, 14);
            if (ch) Fx.PlateauArcRing(p, 1f, 12, 2.4f, 0.22f, 0.06f);
            Quake(0.3f, 24f);
            strike?.Kick(0.12f, 8f);
            var d = PlayerPos - p;
            if (new Vector3(d.x, 0, d.z).magnitude < SlamRadius && !PlayerInvulnerable && d.y < 2f)
                Strike(SlamDamage, p, ch ? Element.Shock : Element.None, transform.forward * 10f + Vector3.up * 4f);
        }

        protected override void MoveTick(float dt, MoveStage stage, float k)
        {
            switch (Move.Id)
            {
                case "glide":
                    if (stage == MoveStage.Windup)
                    {
                        Stop();
                        var d = B - transform.position;
                        d.y = 0;
                        if (d.sqrMagnitude > 1e-3f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(d), 460f * dt);
                        strike?.Charge(k, 0.12f, 8f);
                        // 翼骨上细电火花
                        if (Random.value < dt * 10f) Fx.PlateauCrackle(BonePos(Bone(Random.value < 0.5f ? "wing_1_L" : "wing_1_R")), 0.4f);
                    }
                    else if (stage == MoveStage.Active && !landed)
                    {
                        if (crash)
                        {
                            // 翼根被打穿：直直掉下去，摔晕
                            var p = transform.position;
                            p.y -= dt * 14f;
                            float g = Ground(p);
                            if (p.y <= g)
                            {
                                p.y = g;
                                transform.position = p;
                                landed = true;
                                EndManualMotion();
                                manualOn = false;
                                shadow.End();
                                SetWings(false);
                                Fx.PlateauDirt(p, 1.6f, 18);
                                crash = false;
                                FinishActive();
                                HitStun(CrashStun / StunStatus.ScaledDuration(Rank.Elite, 1f), HitCause.Counter, "坠地眩晕");
                                return;
                            }
                            transform.position = p;
                            return;
                        }
                        float t = Mathf.Clamp01(Move.StageT / flight);
                        var q = Vector3.Lerp(A, B, t);
                        q.y = Mathf.Max(Ground(q), Mathf.Lerp(A.y, B.y, t) + GlideHeight * 4f * t * (1 - t));
                        transform.position = q;
                        // 地上的影子：越接近落点越大越黑
                        shadow.MoveTo(new Vector3(q.x, Ground(q), q.z));
                        shadow.SetRadius((1.2f + 1.8f * t) * Size);
                        shadow.SetAlpha(0.35f + 0.6f * t);
                        if (Charged && Random.value < dt * 12f) Fx.PlateauBolt(q, q - (B - A).normalized * 2.5f, 0.06f, 0.15f, 0);
                        if (t >= 1f)
                        {
                            FinishActive();
                            LandSlam();
                        }
                    }
                    break;
                case "spin":
                    Stop();
                    if (stage == MoveStage.Windup)
                    {
                        strike?.Charge(k, 0.08f, -6f);
                        if (Random.value < dt * 14f) Fx.PlateauCrackle(BonePos(Bone(Random.value < 0.5f ? "wing_2_L" : "wing_2_R")), 0.5f);
                    }
                    else if (stage == MoveStage.Recover) SetWings(false);
                    break;
                case "claw":
                    Stop();
                    if (stage == MoveStage.Windup)
                    {
                        FacePlayer(600f, dt);
                        strike?.Charge(k, 0.06f, -5f);
                    }
                    break;
                case "absorb":
                    if (stage == MoveStage.Windup)
                    {
                        // 跑过去人立接雷，雷冠越来越亮
                        var d = boltAt - transform.position;
                        d.y = 0;
                        if (d.magnitude > 3f) MoveTo(boltAt, 8f);
                        else Stop();
                        if (d.sqrMagnitude > 1e-3f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(d), 300f * dt);
                        strike?.Charge(k, -0.08f, -10f);
                    }
                    else Stop();
                    break;
            }
        }

        protected override void UpdateMoveGlow()
        {
            if (Move.Id == "absorb") Glow = Move.Stage == MoveStage.Windup ? 0.4f + 0.6f * Move.StageK : 1f;
            else base.UpdateMoveGlow();
        }

        protected override void OnMoveEnd(string id)
        {
            strike?.Relax();
            if (id == "glide" && !landed)
            {
                EndManualMotion();
                manualOn = false;
                shadow.End();
            }
            SetWings(false);
        }

        protected override void OnInterrupt(string id)
        {
            strike?.Relax();
            if (id == "glide")
            {
                shadow.End();
                if (manualOn && !crash)
                {
                    EndManualMotion();
                    manualOn = false;
                }
            }
            SetWings(false);
        }

        protected override void OnDeath(DamageInfo info, PlateauDeath kind)
        {
            shadow.End();
            SetWings(false);
            // 雷冠的电噼啪 1 s 后熄灭
            var crown = GlowBone;
            for (int i = 0; i < 5; i++)
                PlateauFxSeq.After(i * 0.2f, () =>
                {
                    if (crown) Fx.PlateauCrackle(crown.position, 0.5f);
                });
        }

        /// <summary>强制出招（试玩套件 / 节拍条）：absorb 时在身前 4 m 落一道雷</summary>
        public void Force(string id)
        {
            Notice(false);
            switch (id)
            {
                case "glide":
                    Begin(PlateauMoves.QiongqiGlide);
                    break;
                case "spin":
                    Begin(PlateauMoves.QiongqiSpin);
                    break;
                case "claw":
                    Begin(PlateauMoves.QiongqiClaw);
                    break;
                default:
                    boltAt = transform.position + transform.forward * 4f;
                    Begin(PlateauMoves.QiongqiAbsorb);
                    break;
            }
        }

        /// <summary>打穿翼根（试玩套件：不靠枪法验证坠地）</summary>
        public void DebugCrash()
        {
            if (Move.Id == "glide" && Move.Stage == MoveStage.Active) crash = Crashed = true;
        }
    }
}
