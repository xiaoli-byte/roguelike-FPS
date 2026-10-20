using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰河豚（Three.js 版 src/enemies/types/IcePuffer.ts）：第二章自爆飞行怪，像气球一样飘在半空，浑身短粗的冰刺。飞行与避障交给 <see cref="FlyingEnemyAI"/>。
    ///   飘近：身体底部在离地 / 离玩家脚底 2.2–3.0 m（每只随机）的高度慢慢飘过来，左右摇摆（±0.45），上下浮动 ±0.25 m；看不到玩家时再高 1.2 m，撞到障碍临时爬升 2 m。
    ///   俯冲：身体中心离玩家胸口 8 m 内、看得到时鼻尖朝玩家一头扎下来（6 m/s 起每秒 +14、最高 11），水平转向只有 2 rad/s（精英 ×1.25）：横移能甩开。
    ///   鼓气：俯冲到胸口 2.4 m（× 体型）内、高差 2.5 m 内就地停住，0.8 s 鼓成两倍大（弱点判定球跟着变大，身体泛青光），地面预警圈同步填满；
    ///         随后炸开：3 m 球形爆炸（边缘剩 55%、击退 4），留下 3 m（精英 3.6 m）的冻雾 4 s（<see cref="FrostFog"/>：移速 −40%），自身死亡（不算玩家击杀、不掉落）。
    ///         这 0.8 s 里打爆它或跑出圈都行。
    ///   落空：俯冲 1.6 s 没贴上、或撞墙：刹住、浮回高处 1.2 s，冷却 1.5–2.6 s 后再冲。
    ///   被提前打死：没鼓气时只碎成一团冰屑；鼓气中被打爆时冰爆照样炸开，但只伤其他敌人（30 × 等级，精英 ×1.5，延后 0.06 s 结算），并留下一小团冻雾（2.2 m、2.5 s、−30%）。
    /// 弱点：整个身体（body 骨 + 模型空间 (0, 0.47, 0.05)，半径 0.34），鼓气时半径 ×2。
    /// 状态：drift → dive → inflate →（自爆）；dive →（落空）recover → drift
    /// </summary>
    public sealed class IcePufferAI : FlyingEnemyAI, ISelfDestruct
    {
        public const float HoverMin = 2.2f, HoverMax = 3f, DiveRange = 8, DiveStart = 6, DiveSpeed = 11, DiveRamp = 14, DiveTurn = 2f, DiveMaxTime = 1.6f;
        public const float InflateRange = 2.4f, InflateTime = 0.8f, InflateTimeMin = 0.6f, InflateScale = 2f, BurstRadius = 3f, BurstEdge = 0.55f, BurstKnock = 4f;
        public const float FogRadius = 3f, FogTime = 4f, FogSlow = 0.4f, DeathBlastBase = 30f, DeathFogRadius = 2.2f, DeathFogTime = 2.5f, DeathFogSlow = 0.3f;
        public const float RecoverTime = 1.2f, Accel = 12f;
        static readonly Vector3 BodyPoint = new(0, 0.47f, 0.05f);
        static readonly Color BurstColor = Hex.Rgb(0x9fe8ff), Spine = Hex.Rgb(0xbfe6f6), GlowTint = Hex.Rgb(0x5fdcff);

        float baseHover, bobPhase, diveYaw, inflateTime = InflateTime, holdY, blindTime, pInflate;
        bool detonated;
        TelegraphHandle warning;
        Transform inflateVisual;
        Vector3 inflateVisualScale = Vector3.one;

        /// <summary>鼓气进度 0..1（驱动弱点半径、占位体缩放、发光）</summary>
        public float Inflation => pInflate;
        /// <summary>已经炸开（鼓满自爆，或鼓气中被打爆）</summary>
        public bool Detonated => detonated;
        /// <summary>鼓气前摇（含攻速）</summary>
        public float InflateDuration => inflateTime;

        protected override string InitialState => "drift";

        protected override void Awake()
        {
            base.Awake();
            baseHover = Random.Range(HoverMin, HoverMax);
            bobPhase = Random.Range(0f, Mathf.PI * 2);
            cooldown = Random.Range(0.4f, 1.4f);
            cruiseHeight = baseHover;
            accel = Accel;
            GlowStyle(0.1f, 0.05f, 3f, 0.8f);
            var bone = FrostKit.FindBone(transform, "body");
            if (bone) body.SetWeakPoint(bone, FrostKit.ModelPointOnBone(transform, bone, BodyPoint), Registry<EnemyDef>.Get("ice_puffer")?.weakRadius ?? 0.34f);
            // 占位体（没有 Animator）：鼓气时直接放大身体胶囊；美术模型的鼓气由 inflate 片段放大 body 骨
            if (!anim)
            {
                inflateVisual = FrostKit.FindBone(transform, "Body");
                if (inflateVisual) inflateVisualScale = inflateVisual.localScale;
            }
            hp.Died += OnPufferDied;
        }

        /// <summary>身体中心（弱点球心）</summary>
        Vector3 Center => body.WeakPoint ? body.WeakPoint.position : transform.TransformPoint(BodyPoint);

        /// <summary>身体中心到玩家胸口的距离</summary>
        float ChestDistance() => Vector3.Distance(Center, PlayerPos + Vector3.up * 1.1f);

        protected override void Think(float dt)
        {
            blindTime = sees ? 0 : blindTime + dt;
            switch (state)
            {
                case "drift":
                {
                    HoverHeight();
                    Glow = 0.1f;
                    if (cooldown <= 0 && sees && ChestDistance() <= DiveRange)
                    {
                        StartDive();
                        break;
                    }
                    // 飘过来：直线加一点左右摇摆
                    var to = PlayerPos - transform.position;
                    to.y = 0;
                    if (to.magnitude > 1.2f)
                    {
                        var dir = to.normalized;
                        float w = Mathf.Sin(age * 1.7f + bobPhase) * 0.45f;
                        FlyToward(dir + new Vector3(-dir.z, 0, dir.x) * w, moveSpeed);
                    }
                    else Hover();
                    FacePlayer(3 * Mathf.Rad2Deg, dt);
                    break;
                }
                case "dive":
                {
                    // 鼻尖朝玩家胸口扎下来：水平方向有限转向，竖直方向追胸口高度
                    var to = PlayerPos - transform.position;
                    diveYaw = Mathf.MoveTowardsAngle(diveYaw, FrostKit.Yaw(to), DiveTurn * (elite ? 1.25f : 1f) * Mathf.Rad2Deg * dt);
                    FlyToward(FrostKit.YawDir(diveYaw), DiveSpeedAt(stateTime));
                    transform.rotation = Quaternion.Euler(0, diveYaw, 0);
                    SetTargetY(PlayerPos.y + 1.1f - BodyPoint.y * Size);
                    Glow = 0.5f;
                    if (ChestDistance() <= InflateRange * Size && Mathf.Abs(PlayerPos.y - transform.position.y) <= 2.5f)
                    {
                        StartInflate();
                        break;
                    }
                    if (stateTime >= DiveMaxTime || (Bumped && stateTime > 0.25f)) Miss();
                    break;
                }
                case "inflate":
                {
                    // 原地停住鼓气（预警圈和炸点一致）
                    Hover();
                    SetTargetY(holdY);
                    FacePlayer(4 * Mathf.Rad2Deg, dt);
                    float t = Mathf.Clamp01(stateTime / inflateTime);
                    Glow = 0.4f + 0.6f * t;
                    body.SetOverlay("puffer.inflate", GlowTint, t * 0.55f);
                    SetInflation(Smooth(t));
                    if (stateTime >= inflateTime) Burst();
                    break;
                }
                case "recover":
                    // 刹住、浮回高处
                    HoverHeight();
                    Hover();
                    FacePlayer(2 * Mathf.Rad2Deg, dt);
                    Glow = 0.1f;
                    if (stateTime >= RecoverTime)
                    {
                        accel = Accel;
                        PlayLocomotion();
                        SetState("drift");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("drift");
                    break;
            }
        }

        /// <summary>俯冲速度：6 m/s 起每秒 +14，封顶 11</summary>
        public static float DiveSpeedAt(float t) => Mathf.Min(DiveSpeed, DiveStart + t * DiveRamp);

        /// <summary>鼓气中被打爆时对其他敌人的冰爆基础伤害：30 × 等级（精英 ×1.5）</summary>
        public static float DeathBlastDamage(float level, bool elite) => DeathBlastBase * level * (elite ? 1.5f : 1f);

        /// <summary>飘行高度：脚底不低于地面 / 玩家脚底 + 飘行高度，看不到玩家时再高 1.2 m，撞到障碍临时爬升 2 m，带上下浮动</summary>
        void HoverHeight()
        {
            float y = Mathf.Max(GroundHeight + baseHover, PlayerPos.y + baseHover);
            if (blindTime > 0.8f) y += 1.2f;
            if (Bumped) climbUntil = Time.time + 1f;
            if (Time.time < climbUntil) y += 2f;
            SetTargetY(y + Mathf.Sin(age * 1.9f + bobPhase) * 0.25f);
        }

        float climbUntil;

        void StartDive()
        {
            diveYaw = transform.eulerAngles.y;
            accel = 40;
            Act("dive", 0, 0.08f);
            SetState("dive");
            GameAudio.PlayAt("telegraph", transform.position, 0.6f, 1.9f);
            Fx.Burst(Center, Spine, 6, 1.6f, 0.35f, 0.05f, 0);
        }

        void StartInflate()
        {
            inflateTime = Windup(InflateTime, InflateTimeMin / InflateTime);
            holdY = transform.position.y;
            accel = 30;
            var c = Center;
            float gy = FrostKit.GroundAt(c, c.y, 0.2f, 20f);
            var ground = new Vector3(c.x, float.IsFinite(gy) ? gy : transform.position.y, c.z);
            warning = Telegraph.Circle(ground, BurstRadius, inflateTime, FrostKit.Warn);
            Act("inflate", inflateTime, 0.06f);
            SetState("inflate");
            GameAudio.PlayAt("telegraph", c, 0.9f, 1.4f);
        }

        /// <summary>俯冲落空：刹住，浮回高处再来</summary>
        void Miss()
        {
            accel = 10;
            RollCooldown(1.5f, 2.6f);
            Act("recover", 0, 0.1f);
            SetState("recover");
            Fx.Burst(Center, Spine, 8, 2.2f, 0.5f, 0.05f, 4f);
        }

        void SetInflation(float k)
        {
            pInflate = Mathf.Clamp01(k);
            float s = Mathf.Lerp(1f, InflateScale, pInflate);
            if (body.WeakZone) body.WeakZone.SetRadiusScale(s);
            if (inflateVisual) inflateVisual.localScale = inflateVisualScale * s;
        }

        /// <summary>鼓满炸开：伤害玩家、留下冻雾，自身死亡（不算玩家击杀、不掉落）</summary>
        void Burst()
        {
            if (detonated || Dead) return;
            detonated = true;
            // 预警如期兑现：让它自然收尾，下面的死亡 → CancelAttack 不再撤销它
            warning = TelegraphHandle.None;
            var c = Center;
            Fx.Explosion(c, BurstRadius, BurstColor);
            GameAudio.PlayAt("explosion", c, 0.9f, 1.35f);
            FrostKit.Shatter(c, 1.3f * Size, 18, 6f);
            Fx.Ring(c, BurstRadius, Hex.Rgb(0xcff4ff), 0.4f);
            // 被嘲讽时扑的是灵体诱饵：炸不到玩家
            if (Taunted) DecoyBlocked(Target);
            else Spiritfire.Game.Blast.Player(c, BurstRadius, Damage, Element.None, this, BurstEdge, 0.6f, BurstKnock);
            FrostFog.Spawn(c, FogRadius * (elite ? 1.2f : 1f), FogTime, FogSlow);
            var info = DamageInfo.Simple(0, DamageSource.Enemy, c, Vector3.up);
            hp.noReward = true;
            hp.Kill(info);
        }

        void OnPufferDied(DamageInfo info)
        {
            body.ClearOverlay("puffer.inflate");
            bool inflating = state == "inflate";
            if (detonated || EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            detonated = true;
            var c = Center;
            if (!inflating)
            {
                // 没鼓气时被打死：碎成一团冰屑
                FrostKit.Shatter(c, 0.8f * Size, 12, 4f);
                return;
            }
            // 鼓气中被打爆：冰爆照样炸开，只伤其他敌人（延后结算，避免在伤害结算里递归），留一小团冻雾
            float dmg = DeathBlastDamage(level, elite);
            FrostKit.Shatter(c, 1.2f * Size, 18, 6f);
            Fx.Explosion(c, BurstRadius, BurstColor);
            FrostFog.Spawn(c, DeathFogRadius, DeathFogTime, DeathFogSlow);
            var self = hp;
            FrostKit.Delay(body, 0.06f, () => Spiritfire.Game.Blast.Enemies(c, BurstRadius, dmg, 5f, 0.5f, new[] { self }));
        }

        protected override void CancelAttack()
        {
            warning.Cancel();
            warning = TelegraphHandle.None;
            if (Dead || detonated) return;
            body.ClearOverlay("puffer.inflate");
            if (state is "inflate" or "dive")
            {
                // 眩晕 / 玩家阵亡：泄气，浮回高处
                SetInflation(0);
                accel = 10;
                RollCooldown(1.2f, 2.2f);
                PlayLocomotion();
                SetState("recover");
            }
        }

        void Act(string s, float seconds = 0, float fade = 0.08f)
        {
            if (!FrostKit.CanPlay(anim, s, enemyId))
            {
                PlayLocomotion();
                return;
            }
            if (FrostKit.InState(anim, s)) return;
            if (seconds > 0.05f) PlayTimed(s, seconds, fade);
            else Play(s, fade);
        }

        static float Smooth(float t)
        {
            t = Mathf.Clamp01(t);
            return t * t * (3 - 2 * t);
        }
    }
}
