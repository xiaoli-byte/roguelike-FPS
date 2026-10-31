using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 天狗（第四章群怪·包抄；combat 3.2，设计单第 2 节）：三四只一群，在 12–18 m 外按「左后、右后、左侧、右侧」分站位绕。
    ///   · 雷吠 <c>howl</c>（群里同时一只，8–30 m、看得见）：坐低仰头长吠，玩家脚下一个跟着走的雷标（正红危险填充 + 紫红符印）；
    ///     1.2 s 定格（符印四齿往里收），交给落雷（<see cref="LightningStrike"/>，0.6 s 后劈下，3 m、15，落点里的雷魅带电 8 s）。
    ///     前摇里打出硬直或封脉：雷标取消。站到导体旁：雷被引走（F 路的落雷自己判）。
    ///   · 扑咬 <c>pounce</c>（群里同时一只，只从玩家视野外 &gt; 50°、2.5–6 m）：伏低 0.3 s（4 m 扑线）→ 腾空扑 4 m（1.2 m 高），9（衔雷后 14 + 雷殛）→ 落地滑一下低头 0.7 s。
    ///   · 衔雷（被动）：3 m 内落雷，带电 8 s（毛上闪电）。
    /// </summary>
    public sealed class TiangouAI : PlateauEnemyAI
    {
        public const float HowlMin = 8f, HowlMax = 30f, MarkRadius = 2.6f, StrikeDamage = 15f, StrikeWarn = 0.6f;
        public const float PounceMin = 2.5f, PounceMax = 6f, PounceSpeed = 10f, PounceHeight = 1.2f, PounceReach = 1.6f;
        public const float BiteDamage = 9f, ChargedBite = 14f, AbsorbRange = 3f, AbsorbSeconds = 8f, BehindAngle = 50f;

        /// <summary>最近一次雷吠的雷标落点（定格时）与落雷句柄</summary>
        public Vector3 LockAt { get; private set; }
        public StrikeHandle LastStrike { get; private set; }
        public int Strikes { get; private set; }
        public bool Bit { get; private set; }
        /// <summary>试玩套件：忽略「只从视野外扑」的条件（逼出扑咬）</summary>
        public bool forcePounce;

        PlateauShapeHandle sigil;
        TelegraphHandle follow;
        float howlCd;
        Vector3 dashDir;
        bool landed;

        protected override void Awake()
        {
            glowBoneName = "rune";
            glowSize = 0.9f;
            sight = 30f;
            centerY = 0.55f;
            base.Awake();
        }

        protected override void Subscribe(bool on)
        {
            LightningStrike.Landed -= OnStrikeLanded;
            if (on) LightningStrike.Landed += OnStrikeLanded;
        }

        /// <summary>衔雷：3 m 内落雷，带电 8 s</summary>
        void OnStrikeLanded(StrikeInfo s)
        {
            if (!this || Dead) return;
            if (Vector3.Distance(PlateauPack.Flat(s.point), PlateauPack.Flat(transform.position)) > AbsorbRange * Mathf.Max(1, Size / 1.1f)) return;
            var c = Center;
            Charge.Apply(hp, AbsorbSeconds, this);
            Fx.PlateauBolt(s.point + Vector3.up * 0.2f, c, 0.06f, 0.16f, 1);
            Fx.PlateauSparks(c, 8, 3f);
        }

        protected override void Fight(float dt, float dist)
        {
            // 雷吠：群里一只，8–30 m、看得见
            if (cooldown <= 0 && dist > HowlMin && dist < HowlMax && sees && Time.time >= howlCd && TakeToken(PlateauPack.Token.Howl, AttackTokens.Kind.Ranged, 3f))
            {
                howlCd = Time.time + PlateauMoves.TiangouHowl.cooldown;
                Begin(PlateauMoves.TiangouHowl);
                return;
            }
            // 扑咬：只从玩家视野外（> 50°）、2.5–6 m
            if (cooldown <= 0 && dist > PounceMin && dist < PounceMax && (forcePounce || AngleFromPlayerView() > BehindAngle)
                && TakeToken(PlateauPack.Token.Pounce, AttackTokens.Kind.Melee, 1.6f))
            {
                cooldown = PlateauMoves.TiangouPounce.cooldown;
                Begin(PlateauMoves.TiangouPounce);
                return;
            }
            // 绕圈：按「左后、右后、左侧、右侧」分站位；拿着扑咬令牌的往 4.5 m 收
            int slot = 0, i = 0;
            foreach (var m in Pack.members)
            {
                if (m == this) slot = i;
                if (m is TiangouAI && m && !m.Dead) i++;
            }
            float[] slots = { Mathf.PI - 0.7f, Mathf.PI + 0.7f, Mathf.PI - 1.6f, Mathf.PI + 1.6f };
            float fwd = motor ? motor.Yaw * Mathf.Deg2Rad : 0;
            float a = fwd + slots[slot % 4] + 0.15f * Mathf.Sin(Time.time * 0.7f + slot);
            float R = HoldingToken(PlateauPack.Token.Pounce) || forcePounce ? 4.5f : 13f + 3f * Mathf.Sin(Time.time * 0.5f + slot * 2);
            MoveTo(PlayerPos + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * R, moveSpeed);
            if (agent && agent.enabled && agent.velocity.sqrMagnitude > 1f) FaceMovement(480f, dt);
            else FacePlayer(300f, dt);
            Loco();
        }

        /// <summary>强制出招（试玩套件 / 节拍条）</summary>
        public void Force(string id)
        {
            Notice(false);
            Begin(id == "pounce" ? PlateauMoves.TiangouPounce : PlateauMoves.TiangouHowl);
        }

        protected override void OnMoveBegin(PlateauMove m)
        {
            if (m.id == "pounce")
            {
                Bit = false;
                landed = false;
            }
        }

        protected override void OnMoveEvent(string id, string evt)
        {
            switch (id)
            {
                case "howl" when evt == "warn":
                    // 雷标：正红危险填充（跟人走、填 1.2 s）+ 紫红符印（身份层）
                    follow = Warn(Telegraph.Circle(PlayerPos, MarkRadius, PlateauMoves.TiangouHowl.windup / HasteMult, TelegraphPalette.Danger, TelegraphTone.Danger));
                    sigil = Fx.PlateauSigil(PlayerPos, MarkRadius + 0.15f);
                    break;
                case "howl" when evt == "lock":
                {
                    // 定格：符印四齿往里收，交给落雷（0.6 s 后劈下）
                    LockAt = PlayerPos;
                    sigil.MoveTo(LockAt);
                    sigil.Lock();
                    follow.End();
                    var sg = sigil;
                    Strikes++;
                    LastStrike = LightningStrike.Strike(LockAt, new StrikeOptions
                    {
                        warn = StrikeWarn, radius = MarkRadius + 0.4f, damage = StrikeDamage * DamageMult, source = this, chargeFoes = AbsorbSeconds,
                        onLanded = s =>
                        {
                            sg.End();
                            Fx.PlateauScorch(s.point, MarkRadius);
                            Fx.PlateauDirt(s.point, 1.2f, 8);
                        },
                    });
                    PlateauFxSeq.After(StrikeWarn + 0.1f, () => sg.End());
                    break;
                }
                case "pounce" when evt == "warn":
                {
                    var to = PlayerPos - transform.position;
                    to.y = 0;
                    dashDir = to.sqrMagnitude > 1e-3f ? to.normalized : transform.forward;
                    Warn(Telegraph.Lane(transform.position, transform.position + dashDir * 4f * Mathf.Max(1, Size / 1.1f), 1.2f,
                        PlateauMoves.TiangouPounce.windup / HasteMult, TelegraphPalette.Danger));
                    break;
                }
                case "pounce" when evt == "hit":
                {
                    // 起跳：抛物线 1.2 m 高，出手段那么久落地
                    float T = PlateauMoves.TiangouPounce.active / HasteMult;
                    float vy = 4f * PounceHeight / T, g = 2f * vy / T;
                    BeginManualMotion(dashDir * PounceSpeed + Vector3.up * vy, g);
                    var mouth = BonePos(Bone("head"));
                    Fx.PlateauClaw(mouth + dashDir * 0.5f, dashDir, 1.3f * Size);
                    if (Charged) Fx.PlateauBolt(mouth, mouth + dashDir * 2f, 0.06f, 0.2f, 1);
                    ImpactHold(0.04f);
                    break;
                }
            }
        }

        protected override void MoveTick(float dt, MoveStage stage, float k)
        {
            switch (Move.Id)
            {
                case "howl":
                    Stop();
                    FacePlayer(170f, dt);
                    if (stage == MoveStage.Windup)
                    {
                        sigil.MoveTo(PlayerPos);
                        follow.MoveTo(PlayerPos);
                    }
                    break;
                case "pounce":
                    if (stage == MoveStage.Windup)
                    {
                        Stop();
                        var to = PlayerPos - transform.position;
                        to.y = 0;
                        if (to.sqrMagnitude > 1e-3f) dashDir = to.normalized;
                        transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(dashDir), 700f * dt);
                    }
                    else if (stage == MoveStage.Active)
                    {
                        if (!Bit)
                        {
                            var d = PlayerPos - transform.position;
                            if (new Vector3(d.x, 0, d.z).magnitude < PounceReach * Mathf.Max(1, Size / 1.1f) && d.y < 1.2f)
                            {
                                Bit = true;
                                bool ch = Charged;
                                Strike(ch ? ChargedBite : BiteDamage, transform.position + Vector3.up * 0.5f, ch ? Element.Shock : Element.None, dashDir * 3f);
                            }
                        }
                    }
                    else
                    {
                        // 落地滑一下、低头
                        if (!landed && ManualGrounded)
                        {
                            landed = true;
                            Fx.PlateauDirt(transform.position, 0.8f, 5);
                        }
                        if (ManualGrounded) SetManualVelocity(Vector3.Lerp(ManualVelocity, Vector3.zero, Mathf.Min(1, dt * 8)));
                        if (k > 0.35f) EndManualMotion();
                    }
                    break;
            }
        }

        protected override void OnMoveEnd(string id)
        {
            if (id == "pounce") EndManualMotion();
        }

        protected override void OnInterrupt(string id)
        {
            // 定格之前被打断：雷标撤回（定格之后雷已经交给落雷，照劈）
            if (id == "howl" && !LastStrike.Alive) sigil.End();
            if (id == "pounce") EndManualMotion();
        }
    }
}
