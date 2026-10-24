using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 沙魇（Unity 新增，定义见 <see cref="Enemy_SandWraith"/>）：被日火烧成沙的跳鼠兵，侧翼伏击手。设计目标「射得爽」——
    /// 每一招都先给看得见、听得见的预告，出手后留一个站桩的输出窗口；挨打掉沙，死了整个崩成一团沙。
    ///   出生：从沙里升起（出生无敌那 0.7 s 里身体从地下冒出来，扬沙）。
    ///   潜行（stalk）：5.6 m/s 摇摆着逼近（左右换向 0.5–0.9 s），身上不停往下掉沙；冷却中在 2.4–5 m 绕圈；
    ///   潜沙突袭：3–16 m、拿到近战名额（贴身打完一套也会钻下去绕到身边再冒出来） → 沉沙 0.45 s（下沉过半就打不到）→ 沙下潜行（9 m/s，最多 2.4 s，朝玩家拐弯，
    ///             地上拖一道沙痕、冒沙浪、闷响）→ 定点 surface：脚下亮 2.2 m 预警圈 0.6 s（裂纹越烧越亮、沙柱往上喷）→
    ///             erupt 破沙旋斩：圈内 ×1.3 伤害 + 往外掀开（6 / 3.5 m/s）+ 近处震屏 → 硬直 0.7 s（输出窗口）。冷却 5.5–7.5 s
    ///             精英：圈大到 2.6 m；破沙后玩家还在 4 m 外就立刻再潜一次（每轮最多连一次）
    ///   贴脸（1.6 m 内）：举爪 0.35 s（铜铃全亮）→ 交叉爪击 → 收招 0.45 s
    ///   受击：EnemyVariant 的扬沙；倒下：EnemyVariant 崩沙（身体散掉、落一堆沙痕）。
    ///   遁地中被眩晕 / 打断 / 玩家阵亡：立刻钻回地面（身体、碰撞体、可选中都还原）
    /// 动作借跳鼠刀兵的 AC_：crouch（沉沙）、spin（破沙旋斩）、slashWindup / slash、recover、Locomotion。
    /// </summary>
    public sealed class SandWraithAI : EnemyAI
    {
        public const float BurrowMin = 3f, BurrowMax = 16f, SinkTime = 0.45f, TunnelSpeed = 9f, TunnelMax = 2.4f, SurfaceTime = 0.6f;
        public const float EruptRadius = 2.2f, EliteEruptRadius = 2.6f, EruptMult = 1.3f, EruptKnock = 6f, EruptKnockUp = 3.5f, RecoverAfterErupt = 0.7f;
        public const float SlashRange = 1.6f, SlashWindup = 0.35f, RecoverAfterSlash = 0.45f, ChainRange = 4f;
        /// <summary>沉进沙里的深度（模型局部单位 = 设计尺寸，随根节点体型放大）、出生升起用时</summary>
        const float SinkDepth = 1.3f, RiseTime = 0.7f;

        float burrowCd, windTime, recoverTime, zigzagTimer, strafeSign = 1, sink, furrowAt, dustAt, rumbleAt, fountainAt;
        Vector3 tunnelTarget, eruptAt, lastFurrow, modelPos;
        bool hitDone, chained;
        Transform model;
        EnemyVariant variant;

        /// <summary>累计：潜沙几次、破沙打中几次、精英连潜几次（测试用）</summary>
        public int Burrows { get; private set; }
        public int EruptHits { get; private set; }
        public int Chains { get; private set; }
        /// <summary>现在在沙下（看不见、打不到）</summary>
        public bool Underground => sink > 0.8f;
        /// <summary>破沙的预警半径</summary>
        public float EruptRange => elite ? EliteEruptRadius : EruptRadius;

        protected override string InitialState => "stalk";

        protected override void Awake()
        {
            base.Awake();
            model = anim ? anim.transform : null;
            if (model) modelPos = model.localPosition;
            burrowCd = Random.Range(1f, 3.5f);
            sink = 1;
            GlowStyle(0.12f, 0.06f, 3f, 0.75f);
        }

        protected override void Start()
        {
            base.Start();
            variant = EnemyVariant.Apply(this, EnemyVariant.Wraith, false);
        }

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            sink = 1;
            ApplySink();
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            if (burrowCd > 0) burrowCd -= dt * auraAttackRate;
            float boost = 0;
            switch (state)
            {
                case "stalk":
                {
                    Glow = 0.15f + 0.1f * Mathf.Sin(age * 3);
                    sink = 0;
                    float dy = Mathf.Abs(PlayerPos.y - transform.position.y);
                    if (cooldown <= 0 && sees && d <= SlashRange + 0.3f && dy < 1.6f && RequestAttack(AttackTokens.Kind.Melee, 1.2f))
                    {
                        windTime = Windup(SlashWindup, 0.24f);
                        Stop();
                        Sfx("enemy_alert", 0.4f, 1.3f);
                        PlayTimed("slashWindup", windTime, 0.05f);
                        SetState("slashWindup");
                        break;
                    }
                    if (burrowCd <= 0 && d >= BurrowMin && d <= BurrowMax && dy < 2.5f && (sees || d < 10f) && RequestAttack(AttackTokens.Kind.Melee, 5f))
                    {
                        chained = false;
                        BeginSink();
                        break;
                    }
                    zigzagTimer -= dt;
                    if (zigzagTimer <= 0)
                    {
                        zigzagTimer = Random.Range(0.5f, 0.9f);
                        strafeSign = -strafeSign;
                    }
                    if (d > 5.5f || !sees)
                    {
                        var to = PlayerPos - transform.position;
                        to.y = 0;
                        var dir = to.sqrMagnitude > 0.01f ? to.normalized : transform.forward;
                        var side = new Vector3(-dir.z, 0, dir.x) * strafeSign;
                        MoveTo(sees ? transform.position + (dir + side * 0.55f) * 4f : PlayerPos, moveSpeed);
                        FaceMovement(540, dt);
                    }
                    else
                    {
                        if (cooldown > 0.3f) KeepRange(2.4f, 5f, moveSpeed * 0.85f, strafeSign);
                        else MoveTo(PlayerPos, moveSpeed);
                        FaceAimTravel(480, dt);
                    }
                    // 一直往下掉沙
                    if (Time.time >= dustAt)
                    {
                        dustAt = Time.time + Random.Range(0.1f, 0.18f);
                        Fx.Burst(transform.position + Vector3.up * Random.Range(0.4f, 1.1f) * Size, DesertKit.Sand, 1, 0.4f, 0.8f, 0.08f * Size, 3f);
                    }
                    break;
                }
                case "sink":
                    Stop();
                    FacePlayer(300, dt);
                    sink = DesertKit.Smooth(stateTime / SinkTime);
                    Glow = 0.6f;
                    boost = 0.4f;
                    Spray(0.05f, 4);
                    if (stateTime >= SinkTime)
                    {
                        sink = 1;
                        SetModelVisible(false);
                        tunnelTarget = AmbushPoint();
                        lastFurrow = transform.position;
                        Burrows++;
                        SetState("burrow");
                    }
                    break;
                case "burrow":
                {
                    // 朝玩家拐弯（离得近时锁定，不贴身追）
                    var toP = PlayerPos - transform.position;
                    toP.y = 0;
                    if (toP.magnitude > 3f) tunnelTarget = AmbushPoint();
                    MoveTo(tunnelTarget, TunnelSpeed);
                    FaceMovement(720, dt);
                    Spray(0.07f, 3);
                    if ((transform.position - lastFurrow).sqrMagnitude > 0.36f)
                    {
                        lastFurrow = transform.position;
                        DesertKit.Furrow(transform.position, 0.55f * Size, 3f);
                    }
                    if (Time.time >= rumbleAt)
                    {
                        rumbleAt = Time.time + 0.35f;
                        GameAudio.PlayAt("footstep", transform.position, 0.55f, 0.4f);
                    }
                    var flat = tunnelTarget - transform.position;
                    flat.y = 0;
                    if (toP.magnitude < 1.4f || flat.magnitude < 0.9f || stateTime >= TunnelMax) BeginSurface();
                    break;
                }
                case "surface":
                    // 预警：地下的它定在这一点，裂纹越烧越亮、沙柱往上喷
                    Stop();
                    boost = Mathf.Clamp01(stateTime / Mathf.Max(0.05f, windTime));
                    Glow = 0.5f + 0.5f * boost;
                    if (Time.time >= fountainAt)
                    {
                        fountainAt = Time.time + 0.06f;
                        var c = Random.insideUnitCircle * EruptRange * 0.6f;
                        Fx.Burst(eruptAt + new Vector3(c.x, 0.1f, c.y), DesertKit.SandLight, 2, 1.2f, 0.5f, 0.22f * Size, -6f * (0.5f + boost));
                    }
                    if (stateTime >= windTime) Erupt();
                    break;
                case "erupt":
                    FacePlayer(400, dt);
                    sink = 1 - DesertKit.Smooth(stateTime / 0.22f);
                    Glow = 0.8f;
                    boost = 0.6f;
                    if (stateTime >= 0.38f)
                    {
                        sink = 0;
                        if (elite && !chained && d >= ChainRange && d <= BurrowMax && RequestAttack(AttackTokens.Kind.Melee, 5f))
                        {
                            chained = true;
                            Chains++;
                            BeginSink();
                            break;
                        }
                        recoverTime = RecoverAfterErupt;
                        Play("recover", 0.08f);
                        SetState("recover");
                    }
                    break;
                case "slashWindup":
                    FacePlayer(460, dt);
                    Glow = 1;
                    boost = 0.5f;
                    if (d > 1f) MoveTo(PlayerPos, moveSpeed * 0.5f);
                    else Stop();
                    if (stateTime >= windTime)
                    {
                        Play("slash", 0.03f);
                        Melee(SlashRange, Damage, 0.2f);
                        ClawFx();
                        SetState("slash");
                    }
                    break;
                case "slash":
                    MoveTo(transform.position + transform.forward * 2f, 1.5f);
                    if (stateTime >= 0.16f)
                    {
                        Stop();
                        recoverTime = RecoverAfterSlash;
                        SetState("recover");
                    }
                    break;
                case "recover":
                    Stop();
                    FacePlayer(220, dt);
                    sink = 0;
                    Glow = 0.1f;
                    if (stateTime >= recoverTime / Mathf.Sqrt(auraAttackRate))
                    {
                        ReleaseAttack();
                        RollCooldown(1.2f, 2.2f);
                        if (burrowCd < 1.5f) burrowCd = Random.Range(5.5f, 7.5f);
                        PlayLocomotion();
                        SetState("stalk");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("stalk");
                    break;
            }
            if (variant) variant.CrackBoost = boost;
        }

        void LateUpdate()
        {
            if (Dead) return;
            // 出生：从沙里升起（出生无敌期间，基类不调 Think）
            if (state == "spawn")
            {
                sink = 1 - DesertKit.Smooth(stateTime / RiseTime);
                Spray(0.06f, 3);
            }
            ApplySink();
        }

        void ApplySink()
        {
            // 模型是子物体：局部位移已随根节点缩放
            if (model) model.localPosition = modelPos + new Vector3(0, -sink * SinkDepth, 0);
            if (state is "sink" or "burrow" or "surface" or "erupt")
            {
                hp.untargetable = sink > 0.8f;
                SetColliders(sink < 0.99f);
            }
        }

        void Spray(float every, int count)
        {
            if (Time.time < furrowAt) return;
            furrowAt = Time.time + every;
            DesertKit.SandSpray(transform.position, count, Size * 0.8f);
        }

        void BeginSink()
        {
            Stop();
            Sfx("telegraph", 0.55f, 0.75f);
            PlayTimed("crouch", SinkTime, 0.06f);
            SetState("sink");
        }

        /// <summary>伏击点：玩家预判位置（0.35 s）往自己这边退 0.6 m（不钻在玩家脚底正中）</summary>
        Vector3 AmbushPoint()
        {
            var p = PredictPlayer(0.35f);
            var back = transform.position - p;
            back.y = 0;
            return back.sqrMagnitude > 0.01f ? p + back.normalized * 0.6f : p;
        }

        void BeginSurface()
        {
            Stop();
            eruptAt = transform.position;
            windTime = Windup(SurfaceTime, 0.45f);
            hitDone = false;
            Telegraph.Circle(eruptAt, EruptRange, windTime, new Color(1f, 0.6f, 0.22f));
            Sfx("telegraph", 0.8f, 0.5f);
            GameAudio.PlayAt("enemy_charge", eruptAt, 0.5f, 0.7f);
            SetState("surface");
        }

        void Erupt()
        {
            SetModelVisible(true);
            SetColliders(true);
            Play("spin", 0.04f);
            Sfx("land", 0.7f, 0.8f);
            GameAudio.PlayAt("boss_slam", eruptAt, 0.45f, 1.5f);
            SetState("erupt");
            if (!hitDone)
            {
                hitDone = true;
                if (Burst(eruptAt, EruptRange, Damage * EruptMult))
                {
                    EruptHits++;
                    var away = PlayerPos - eruptAt;
                    away.y = 0;
                    away = away.sqrMagnitude > 1e-4f ? away.normalized : transform.forward;
                    player.GetComponent<Spiritfire.Art.PlayerMotor>()?.AddImpulse(away * EruptKnock + Vector3.up * EruptKnockUp);
                    CameraShake.Add(0.35f, 0.25f);
                }
                else CameraShake.Quake(eruptAt, 0.25f, 10f, 0.25f);
            }
            float k = Size;
            Fx.Burst(eruptAt + Vector3.up * 0.2f, DesertKit.Sand, 22, 5f, 0.8f, 0.3f * k, 6f);
            Fx.Burst(eruptAt + Vector3.up * 0.4f, DesertKit.SandLight, 10, 2f, 0.9f, 0.45f * k, -3f);
            Fx.Burst(eruptAt + Vector3.up * 0.6f, DesertKit.Spark, 10, 4f, 0.5f, 0.06f, 2f);
            Fx.Ring(eruptAt + Vector3.up * 0.08f, EruptRange, DesertKit.SandLight, 0.4f);
            SlashArc.Spawn(eruptAt + Vector3.up * 0.42f * k, transform.eulerAngles.y, EruptRange * 0.85f, Mathf.PI * 1.9f, 1, 0, 0.5f * k, 0.26f, new Color(1f, 0.72f, 0.36f));
            DesertKit.Furrow(eruptAt, EruptRange * 0.7f, 4f);
        }

        /// <summary>交叉爪击：两道沙色刀光交成 X</summary>
        void ClawFx()
        {
            float k = Size;
            var c = transform.position + Vector3.up * 0.55f * k;
            foreach (int s in new[] { 1, -1 })
                SlashArc.Spawn(c, transform.eulerAngles.y, 1.1f * k, 1.7f, s, s * 0.75f, 0.3f * k, 0.2f, new Color(1f, 0.74f, 0.42f));
            Fx.Burst(c + transform.forward * 0.6f * k, DesertKit.Sand, 6, 2.5f, 0.4f, 0.12f * k, 4f);
        }

        void SetColliders(bool on)
        {
            foreach (var c in GetComponents<Collider>()) c.enabled = on;
            if (body.WeakPoint) body.WeakPoint.gameObject.SetActive(on);
        }

        void SetModelVisible(bool on)
        {
            if (!model) return;
            foreach (var r in model.GetComponentsInChildren<Renderer>()) r.enabled = on;
        }

        /// <summary>遁地中被打断：钻回地面上，身体 / 碰撞体 / 可选中都还原</summary>
        void Resurface()
        {
            sink = 0;
            if (model) model.localPosition = modelPos;
            SetModelVisible(true);
            SetColliders(true);
            hp.untargetable = false;
            if (variant) variant.CrackBoost = 0;
        }

        protected override void OnStunned() => Resurface();

        protected override void CancelAttack()
        {
            if (state is "sink" or "burrow" or "surface" or "erupt") Resurface();
            Glow = 0;
            if (state is not "stalk" and not IdleState)
            {
                RollCooldown(0.8f, 1.4f);
                if (burrowCd < 2f) burrowCd = Random.Range(2f, 3.5f);
            }
        }
    }
}
