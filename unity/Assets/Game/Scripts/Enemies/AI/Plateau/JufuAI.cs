using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 举父（第四章远程·炮击；combat 3.4，设计单第 4 节）：先抢高、再抛物线远投；打它手里的石头能反制。
    ///   · 抢高 <c>climb</c>：开战先找 25 m 内比现在高 3–14 m、看得见玩家的落脚点，蹲 → 一跃（3 m 高抛物线）→ 四肢着地。被推开之后换一处。
    ///   · 远投 <c>throw</c>（6–60 m、看得见、群内远程令牌）：弯腰抠石 → 双手举过头顶 1.0 s → 甩出，落点 3 m 圈在「玩家正要去的地方」，
    ///     飞 1.0–1.4 s，3 m 溅射 18；雷暴 / 带电时是雷石：举石期间常驻带电，落地留 4 m 电场 6 s（每 0.5 s 4 + 雷殛）。
    ///   · 手中炸石（反制）：举石的 1 s 里石头是命中球，打中 40（按血量口径缩放）→ 石头在它手里炸开：自伤 60 + 眩晕 2 s；带电时是焚雷；
    ///     站在高处边上会摔下来（再掉 30、多晕 1.5 s）。
    ///   · 推开 <c>shove</c>（被逼到 5 m 内）：双臂张开 → 横扫 120°，12 + 击退 9；推完换一处高地。
    ///   · 摔下高处 <c>fall</c>：在高处边上被打出硬直 / 眩晕时，往最近的边摔下去，落地自伤 30 + 眩晕 1.5 s。
    /// </summary>
    public sealed class JufuAI : PlateauEnemyAI
    {
        public const float ThrowMin = 6f, ThrowMax = 60f, Splash = 3f, SplashDamage = 18f, Gravity = 20f;
        public const float FieldRadius = 4f, FieldSeconds = 6f, FieldDamage = 4f, FieldTick = 0.5f;
        public const float RockCounter = 40f, RockSelfDamage = 60f, RockStun = 2f, ShoveRange = 5f, ShoveDamage = 12f, FallDamage = 30f, FallStun = 1.5f;

        public bool Holding { get; private set; }
        public bool Storm => StormLevel > 0.5f || Charged;
        public bool OnPerch => transform.position.y - home.y > 2f || elevatedProbe;
        public int Throws { get; private set; }
        public int Pops { get; private set; }
        public int Falls { get; private set; }
        public Vector3 Target { get; private set; }
        /// <summary>试玩套件：最近一次落点留下的电场</summary>
        public JufuStormField LastField { get; private set; }

        Transform rockRoot, handL, handR;
        Renderer rockR;
        PlateauOrb rockGlow;
        HitZone rockZone;
        IDisposable rockHold;
        Vector3 from, perch;
        float rockDmg, flight;
        bool climbed, repos, holdStorm, elevatedProbe, popping;

        protected override void Awake()
        {
            glowBoneName = "palm";
            glowSize = 1.0f;
            sight = 55f;
            centerY = 1.0f;
            base.Awake();
            handL = Bone("hand_L");
            handR = Bone("hand_R");
            // 手里的石头：低多边形方块石（雷暴时带紫红光），只在举石时出现
            rockRoot = new GameObject("Jufu Rock").transform;
            rockRoot.SetParent(transform, false);
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Destroy(cube.GetComponent<Collider>());
            cube.name = "Rock";
            cube.transform.SetParent(rockRoot, false);
            cube.transform.localRotation = Quaternion.Euler(38, 27, 14);
            rockR = cube.GetComponent<Renderer>();
            rockR.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(rockR, PlateauPalette.Rock);
            rockGlow = PlateauOrb.Attach(rockRoot, Vector3.zero, 0.28f);
            rockGlow.level = 0.5f;
            rockZone = BoneZone("rock", 0.42f, "rock", false, true, 3, rockRoot);
            rockZone.SetActive(false);
            rockRoot.gameObject.SetActive(false);
            hp.Incoming.Add(RockIncoming);
            hp.Damaged += OnJufuDamaged;
        }

        protected override void LateUpdate()
        {
            base.LateUpdate();
            if (!rockRoot || !rockRoot.gameObject.activeSelf) return;
            var at = handL && handR ? (handL.position + handR.position) * 0.5f : Center + Vector3.up * 1.2f * Size;
            rockRoot.position = at;
            float s = 0.62f * Size * (holdStorm ? 1f + 0.08f * Mathf.Sin(Time.time * 30f) : 1f);
            rockR.transform.localScale = Vector3.one * s / Mathf.Max(1e-3f, rockRoot.lossyScale.x);
            rockGlow.visible = holdStorm;
        }

        float RockIncoming(in IncomingHit h)
        {
            if (Dead || !Holding) return 1;
            return ZoneOf(h.info) == rockZone ? 0.5f : 1f;
        }

        void OnJufuDamaged(DamageInfo info, DamageResult r)
        {
            if (Dead || !Holding || popping || r.total <= 0 || ZoneOf(info) != rockZone) return;
            rockDmg += r.total * 2f;
            if (rockDmg >= RockCounter * HpScale(240f)) PopRock();
        }

        void SetHolding(bool on)
        {
            Holding = on;
            rockRoot.gameObject.SetActive(on);
            rockZone.SetActive(on);
            holdStorm = on && Storm;
            if (holdStorm && rockHold == null) rockHold = Charge.Hold(hp, this);
            if (!on && rockHold != null)
            {
                rockHold.Dispose();
                rockHold = null;
            }
            FxMaterials.Tint(rockR, holdStorm ? Color.Lerp(PlateauPalette.Rock, PlateauPalette.Deep, 0.45f) : PlateauPalette.Rock);
        }

        /// <summary>手中炸石：石头在它手里炸开，自伤 + 眩晕；带电时是焚雷；在高处边上的摔下来</summary>
        public void PopRock()
        {
            if (!Holding || popping) return;
            popping = true;
            Pops++;
            var at = rockRoot.position;
            bool storm = holdStorm;
            if (storm) Fx.PlateauBallLightning(at, 2.4f);
            else Fx.Play("ToonBurst", at, Vector3.up, Hex.Rgb(0xffb37a), 1.6f);
            Fx.PlateauDirt(at, 1.2f, 16);
            Fx.PlateauSparks(at, 14, 6f);
            Quake(0.2f, 20f);
            InterruptAttack();
            SetHolding(false);
            SelfDamage(RockSelfDamage * HpScale(240f), at);
            if (!Dead && storm) Combat.ApplyElement(hp, Element.Fire, 40f * HpScale(240f), 0, this);
            if (!Dead && !TryFall()) HitStun(RockStun, HitCause.Counter, "手里的石头炸了");
            popping = false;
        }

        protected override void Fight(float dt, float dist)
        {
            FacePlayer(230f, dt);
            bool elevated = IsElevated();
            // 抢高：开战先跳上最近的高处；被推开之后换一处
            if ((!elevated && !climbed) || repos)
            {
                climbed = true;
                repos = false;
                if (FindPerch())
                {
                    Begin(PlateauMoves.JufuClimb);
                    return;
                }
            }
            if (dist < ShoveRange * Size && cooldown <= 0)
            {
                cooldown = PlateauMoves.JufuShove.cooldown;
                Begin(PlateauMoves.JufuShove);
                return;
            }
            if (cooldown <= 0 && dist < ThrowMax && dist > ThrowMin && sees && TakeToken(PlateauPack.Token.Ranged, AttackTokens.Kind.Ranged, 2.5f))
            {
                cooldown = PlateauMoves.JufuThrow.cooldown + Random.value;
                Begin(PlateauMoves.JufuThrow);
                return;
            }
            // 没在高处、又没地方爬：指节着地跑到 15–25 m
            if (!elevated && (dist < 12 || dist > 30))
            {
                var away = transform.position - PlayerPos;
                away.y = 0;
                away = away.sqrMagnitude > 1e-3f ? away.normalized : -transform.forward;
                MoveTo(PlayerPos + away * 18f, moveSpeed);
            }
            else Stop();
            Loco();
        }

        /// <summary>脚下是高处：周围 4 m 内有比现在低 2 m 以上的地面</summary>
        bool IsElevated()
        {
            elevatedProbe = EdgeDir(out _, out _);
            return elevatedProbe;
        }

        bool EdgeDir(out Vector3 to, out float drop)
        {
            var p = transform.position;
            to = default;
            drop = 0;
            float best = float.MaxValue;
            for (int k = 0; k < 8; k++)
            {
                float a = k / 8f * Mathf.PI * 2;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                for (int r = 1; r <= 4; r++)
                {
                    var q = p + d * r;
                    float g = Physics.Raycast(q + Vector3.up * 0.5f, Vector3.down, out var hit, 30f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : p.y;
                    if (g < p.y - 2f)
                    {
                        if (r < best)
                        {
                            best = r;
                            to = new Vector3(q.x + d.x * 0.6f, g, q.z + d.z * 0.6f);
                            drop = p.y - g;
                        }
                        break;
                    }
                }
            }
            return best < float.MaxValue;
        }

        /// <summary>25 m 内比现在高 3–14 m、站得住（导航网格）、看得见玩家的落脚点</summary>
        bool FindPerch()
        {
            float best = float.MaxValue;
            var p = transform.position;
            for (int k = 0; k < 24; k++)
            {
                float a = k / 24f * Mathf.PI * 2;
                for (float r = 6; r <= 25; r += 3)
                {
                    var q = p + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * r;
                    if (!Physics.Raycast(q + Vector3.up * 30f, Vector3.down, out var hit, 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                    float dh = hit.point.y - p.y;
                    if (dh < 3 || dh > 14) continue;
                    if (!NavMesh.SamplePosition(hit.point, out var nav, 1.2f, NavMesh.AllAreas)) continue;
                    if (!Combat.LineClear(nav.position + Vector3.up * 1.6f, TargetChest)) continue;
                    float score = r - dh * 0.5f;
                    if (score < best)
                    {
                        best = score;
                        perch = nav.position;
                    }
                }
            }
            return best < float.MaxValue;
        }

        /// <summary>在高处边上就往下摔（返回是否摔了）</summary>
        bool TryFall()
        {
            if (Dead || !EdgeDir(out var to, out _)) return false;
            perch = to;
            Falls++;
            Begin(PlateauMoves.JufuFall);
            return true;
        }

        protected override bool OnHitStagger(float seconds, Vector3 hitFrom, HitCause cause)
        {
            // 在屋顶边被打出硬直：摔下去（不站着晃）
            if (Move.Id != "fall" && TryFall()) return true;
            return base.OnHitStagger(seconds, hitFrom, cause);
        }

        protected override void OnMoveBegin(PlateauMove m)
        {
            switch (m.id)
            {
                case "climb":
                case "fall":
                    from = transform.position;
                    BeginManualMotion(Vector3.zero, 0);
                    break;
                case "throw":
                    rockDmg = 0;
                    break;
            }
        }

        protected override void OnMoveEvent(string id, string evt)
        {
            switch (id)
            {
                case "throw" when evt == "warn":
                {
                    // 往玩家正要去的地方扔：落点预警圈和举石同时出现
                    SetHolding(true);
                    float dist = DistToPlayer;
                    flight = Mathf.Min(1.4f, dist / 22f + 0.6f);
                    float lead = PlateauMoves.JufuThrow.windup / HasteMult + flight;
                    var v = PlayerVelocity;
                    var t = PlayerPos + new Vector3(v.x, 0, v.z) * lead * 0.8f;
                    t.y = Ground(t);
                    Target = t;
                    Warn(Telegraph.Circle(t, Splash, lead, TelegraphPalette.Danger, TelegraphTone.Danger));
                    if (holdStorm) Warn(Telegraph.Circle(t, Splash + 0.35f, lead, TelegraphPalette.Thunder, TelegraphTone.Thunder));
                    break;
                }
                case "throw" when evt == "release":
                {
                    var at = rockRoot.position;
                    bool storm = holdStorm;
                    SetHolding(false);
                    Throws++;
                    var vel = EnemyProjectile.Ballistic(at, Target, flight, Gravity);
                    var spec = new EnemyProjectileSpec(at, vel, 0, 0.45f, flight + 1.5f)
                    {
                        gravity = Gravity, visual = "chunk", color = storm ? Color.Lerp(PlateauPalette.Rock, PlateauPalette.Bolt, 0.35f) : PlateauPalette.Rock,
                        scale = 1.4f * Size, source = this, blockable = true,
                        onImpact = (p, _) => Impact(p, storm),
                    };
                    EnemyProjectile.Spawn(spec);
                    Fx.Burst(at, PlateauPalette.Dust, 6, 3f, 0.4f, 0.2f, 3);
                    ImpactHold(0.04f);
                    Pack?.Give(this);
                    ReleaseAttack();
                    break;
                }
                case "shove" when evt == "warn":
                    Warn(Telegraph.Sector(transform.position, transform.eulerAngles.y, 60f, ShoveRange * Size, PlateauMoves.JufuShove.windup / HasteMult, TelegraphPalette.Danger));
                    break;
                case "shove" when evt == "hit":
                {
                    float yaw = transform.eulerAngles.y;
                    Fx.PlateauCrescent(transform.position + Vector3.up * 1.1f * Size, yaw, 2.2f * Size, 2.1f, 1, 0.2f, 0.5f * Size, 0.18f);
                    Fx.PlateauDirt(transform.position + transform.forward * 1.5f, 0.8f, 4);
                    if (PlateauGeo.InCone(PlayerPos, transform.position, yaw * Mathf.Deg2Rad, ShoveRange * Size, 1.05f))
                        Strike(ShoveDamage, transform.position + Vector3.up, Element.None, PlateauGeo.Knock(PlayerPos, transform.position, 9f, 3f));
                    repos = true;
                    break;
                }
                case "climb" when evt == "land":
                    Fx.PlateauDirt(transform.position, 1f, 8);
                    break;
                case "fall" when evt == "land":
                    Fx.PlateauDirt(transform.position, 1.3f, 12);
                    EndManualMotion();
                    SelfDamage(FallDamage * HpScale(240f), transform.position);
                    if (!Dead) HitStun(FallStun, HitCause.Counter, "从高处摔下来了");
                    break;
            }
        }

        /// <summary>石头落地：碎石 + 冲击环 + 3 m 溅射；雷石再留 4 m 电场 6 s</summary>
        void Impact(Vector3 p, bool storm)
        {
            Fx.PlateauDirt(p, 1.5f, 16);
            Fx.Play("ToonRing", p + Vector3.up * 0.05f, Vector3.up, storm ? PlateauPalette.Bolt : PlateauPalette.Dust, Splash);
            if (storm) Fx.PlateauBallLightning(p + Vector3.up * 0.5f, 1.6f);
            Combat.BlastPlayer(p, Splash + 0.2f, SplashDamage * DamageMult, 0.6f, storm ? Element.Shock : Element.None, this);
            if (storm) LastField = JufuStormField.Spawn(p, FieldRadius, FieldSeconds, FieldDamage * DamageMult, this);
        }

        protected override void MoveTick(float dt, MoveStage stage, float k)
        {
            switch (Move.Id)
            {
                case "climb":
                case "fall":
                    if (stage == MoveStage.Active)
                    {
                        // 抛物线：抢高 3 m、摔下 1 m
                        float h = Move.Id == "climb" ? 3f : 1f;
                        var p = Vector3.Lerp(from, perch, k);
                        p.y += h * 4f * k * (1 - k);
                        transform.position = p;
                        var d = perch - from;
                        d.y = 0;
                        if (d.sqrMagnitude > 1e-3f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(d), 340f * dt);
                    }
                    else if (stage == MoveStage.Recover && Move.Id == "climb")
                    {
                        transform.position = perch;
                        if (k > 0.5f) EndManualMotion();
                    }
                    break;
                case "throw":
                case "shove":
                    Stop();
                    FacePlayer(230f, dt);
                    break;
            }
        }

        protected override void UpdateMoveGlow()
        {
            // 掌印：举石时渐亮，扔完双臂垂下时亮 0.8 s（窗口）
            if (Move.Id == "throw") Glow = Move.Stage == MoveStage.Windup ? 0.6f * Move.StageK : 1f;
            else base.UpdateMoveGlow();
        }

        protected override void OnMoveEnd(string id)
        {
            if (id is "climb" or "fall") EndManualMotion();
        }

        protected override void OnInterrupt(string id)
        {
            if (id == "throw" && Holding && !popping) SetHolding(false);
            if (id is "climb" or "fall") EndManualMotion();
        }

        protected override void OnDeath(DamageInfo info, PlateauDeath kind)
        {
            if (Holding) SetHolding(false);
        }

        /// <summary>强制出招（试玩套件 / 节拍条）</summary>
        public void Force(string id)
        {
            Notice(false);
            if (id == "climb" && !FindPerch()) perch = transform.position + transform.forward * 6f + Vector3.up * 3f;
            Begin(id switch
            {
                "climb" => PlateauMoves.JufuClimb,
                "shove" => PlateauMoves.JufuShove,
                "fall" => PlateauMoves.JufuFall,
                _ => PlateauMoves.JufuThrow,
            });
        }
    }

    /// <summary>
    /// 雷石电场（combat 3.4）：落点 4 m、6 s——紫红符印圈 + 圈里爬电（<see cref="Fx.PlateauField"/>），
    /// 玩家在圈里、在地上每 0.5 s 挨 4 + 雷殛（冲刺无敌不挨）；圈里的雷魅带电。
    /// </summary>
    public sealed class JufuStormField : MonoBehaviour
    {
        public float radius, seconds, damage;
        public int Ticks { get; private set; }
        UnityEngine.Object source;
        PlateauShapeHandle shape;
        float age, tick;

        public static JufuStormField Spawn(Vector3 at, float radius, float seconds, float damage, UnityEngine.Object source)
        {
            var go = new GameObject("Jufu Storm Field");
            go.transform.position = at;
            var f = go.AddComponent<JufuStormField>();
            f.radius = radius;
            f.seconds = seconds;
            f.damage = damage;
            f.source = source;
            f.shape = Fx.PlateauField(at, radius, seconds);
            return f;
        }

        void Update()
        {
            age += Time.deltaTime;
            if (age >= seconds)
            {
                Destroy(gameObject);
                return;
            }
            tick -= Time.deltaTime;
            if (tick > 0) return;
            tick = 0.5f;
            var at = transform.position;
            // 圈里的雷魅带电（电场接上啸獭的电网）
            foreach (var e in EnemyAI.All)
                if (e is PlateauEnemyAI p && !p.Dead && Vector3.Distance(PlateauPack.Flat(p.transform.position), PlateauPack.Flat(at)) < radius)
                    Charge.Apply(p.Health, 0.8f, this);
            var v = PlayerVitals.Instance;
            if (!v || v.Dead || v.Invulnerable) return;
            var P = v.transform.position;
            var motor = v.GetComponent<PlayerMotor>();
            if (Vector3.Distance(PlateauPack.Flat(P), PlateauPack.Flat(at)) < radius && P.y < at.y + 1f && (!motor || motor.Grounded))
            {
                Ticks++;
                Combat.DamagePlayer(damage, at, Element.Shock, source);
            }
        }

        void OnDestroy() => shape.End();
    }
}
