using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 夫诸（Three.js 版 src/enemies/types/Fuzhu.ts）：冻成冰的四角白鹿，精准远程——玩家要靠远程对枪，不是追着砍。
    ///   踱步：保持 13–24 m（9 m 内快步 ×1.3 后撤），面朝走向、头由 CreatureRig 盯着玩家；看不见玩家时找有视线的位置（<see cref="SightSeeker"/>）
    ///   冰光：有视线、6–30 m、高差 ≤ 6 m、冷却好、拿到重击名额 → 低头蓄力 1.2 s（攻速加成最多缩到 90%），地面亮出瞄准线（铺到被挡住的地方）；
    ///         前 70% 瞄准点跟着玩家胸口走（带 0.2 s 提前量），之后锁死——这时离开瞄准线就能躲。
    ///         射出一道直线冰光（角间光团 → 第一个遮挡，最远 34 m，判定半径 0.35、精英 ×1.2）：碰到玩家胶囊伤害一次 + 2.6 m/s 的小推力；
    ///         光束下的地面结冰 4 s（<see cref="FuzhuIceStrip"/>，从前蹄起铺，半宽 0.9、精英 ×1.25），踩上去打滑。收招 0.7 s，冷却 3.6–5 s
    ///   跳跃换位：玩家逼近到 6.5 m（精英 ×1.15）内、高差 ≤ 2.5 m → 后腿一蹲 0.2 s，腾空 0.8 s 落到背离玩家约 10 m 外的可走点
    ///         （落点要比现在离玩家远 4 m 以上、1.4 m 高的直线不被挡），冷却 4–6 s；落地 0.3 s 后很快就能再蓄力
    /// 跳跃走脚本位移（<see cref="EnemyAI.BeginManualMotion"/>，重力 26），落地交还导航。
    /// </summary>
    public sealed class FuzhuAI : EnemyAI
    {
        public const float MinRange = 13, MaxRange = 24, FireMin = 6, FireMax = 30, BeamRange = 34, ChargeTime = 1.2f, TrackFrac = 0.7f, BeamRadius = 0.35f;
        public const float RecoverTime = 0.7f, StripHalf = 0.9f, StripTime = 4, AimHalf = 0.55f, BeamPush = 2.6f;
        public const float LeapTrigger = 6.5f, LeapDist = 10, LeapTime = 0.8f, CrouchTime = 0.2f, LandTime = 0.3f, Gravity = 26;
        /// <summary>角间光团（冰光发射点）、冻地起点（前蹄前方），模型空间设计尺寸</summary>
        static readonly Vector3 Focus = new(0, 1.66f, 0.42f), StripFrom = new(0, 0, 0.45f);
        /// <summary>跳跃落点依次尝试的方向偏转（弧度，相对「背离玩家」；带 s 的乘横移方向）</summary>
        static readonly float[] LeapOffsets = { 0, 0.5f, -0.5f, 1f, -1f, 1.5f, -1.5f };
        static readonly bool[] LeapSigned = { false, true, true, true, true, false, false };

        static readonly Color WarnColor = Hex.Rgb(0x6fd8ff), BeamColor = Hex.Rgb(0x6fe6ff), CoreColor = Hex.Rgb(0xf0ffff);
        static readonly Color SparkColor = Hex.Rgb(0xc8f8ff), ShardColor = Hex.Rgb(0xdff6ff), SnowColor = Hex.Rgb(0xf4fbff), IceColor = Hex.Rgb(0xcff4ff);

        float chargeTime = ChargeTime, recoverTime = RecoverTime, leapCd, aimTimer, aimLen = 1, chargeAcc, strafeTimer, strafeSign = 1;
        Vector3 aimDir = Vector3.forward, leapTarget;
        TelegraphHandle aimLane;
        /// <summary>角间的冰晶星芒（FX3，Three.js createFrostGlow）：蓄力时变大变亮，出手后 0.25 s 熄掉</summary>
        FrostGlint focusGlint;
        float glintLevel;
        readonly SightSeeker seeker = new();
        static RaycastHit[] rayBuf = new RaycastHit[16];

        protected override string InitialState => "move";

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.08f, 0.03f, 2f, 0.9f);
            strafeSign = Random.value < 0.5f ? -1 : 1;
        }

        // ───────────── 纯计算（EditMode 测试直接调） ─────────────

        /// <summary>蓄力进度 t（0..1）到了锁定段（后 30%）</summary>
        public static bool AimLocked(float t) => t >= TrackFrac;

        /// <summary>跳跃初速：T 秒从 from 落到 to（重力 g），水平匀速、竖直补偿高差</summary>
        public static Vector3 LeapVelocity(Vector3 from, Vector3 to, float T, float g) =>
            new((to.x - from.x) / T, 0.5f * g * T + (to.y - from.y) / T, (to.z - from.z) / T);

        /// <summary>带半径的线段 a → b 碰到竖直胶囊（脚底 feet、半径 capRadius、高 capHeight）</summary>
        public static bool SegmentHitsCapsule(Vector3 a, Vector3 b, float radius, Vector3 feet, float capRadius, float capHeight)
        {
            var lo = feet + Vector3.up * capRadius;
            var hi = feet + Vector3.up * Mathf.Max(capRadius, capHeight - capRadius);
            return ProjectileMath.SegmentSegmentDistance(a, b, lo, hi) <= radius + capRadius;
        }

        /// <summary>
        /// 世界射线：沿 dir 最远 range 米，第一个挡住它的地形 / 建筑（标了 blocksSight 的命中盒，如狐巫冰壁，也算；敌人命中盒不算）。
        /// 返回是否被挡，dist = 挡住处的距离（没挡 = range）
        /// </summary>
        public static bool WorldRay(Vector3 from, Vector3 dir, float range, out float dist)
        {
            dist = range;
            if (!(range > 0) || dir.sqrMagnitude < 1e-8f) return false;
            dir.Normalize();
            int n;
            while ((n = Physics.RaycastNonAlloc(from, dir, rayBuf, range, Layers.WorldMask, QueryTriggerInteraction.Ignore)) >= rayBuf.Length)
                rayBuf = new RaycastHit[rayBuf.Length * 2];
            bool hit = false;
            for (int i = 0; i < n; i++)
            {
                var h = rayBuf[i];
                var hb = h.collider.GetComponent<Hitbox>();
                if (hb && !hb.blocksSight) continue;
                if (h.distance < dist)
                {
                    dist = h.distance;
                    hit = true;
                }
            }
            return hit;
        }

        // ───────────── 行为 ─────────────

        Vector3 Muzzle => transform.TransformPoint(Focus);

        void UpdateGlint(float dt)
        {
            float want = state == "charge" && !Dead ? Mathf.Clamp01(stateTime / Mathf.Max(0.05f, chargeTime)) : 0;
            glintLevel = want > glintLevel ? want : Mathf.MoveTowards(glintLevel, 0, dt * 4f);
            if (!focusGlint && glintLevel > 0.01f) focusGlint = FrostGlint.Attach(transform, Focus, 0.9f * Size, CoreColor);
            if (focusGlint) focusGlint.Set(glintLevel, 0.45f + 0.9f * glintLevel);
        }

        protected override void Think(float dt)
        {
            UpdateGlint(dt);
            float d = DistToPlayer;
            float dy = Mathf.Abs(PlayerPos.y - transform.position.y);
            if (leapCd > 0) leapCd -= dt;
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(1.8f, 3.2f);
                strafeSign = -strafeSign;
            }
            switch (state)
            {
                case "move":
                {
                    Glow = 0.15f + 0.08f * Mathf.Sin(age * 2);
                    if (leapCd <= 0 && d < LeapTrigger * (elite ? 1.15f : 1f) && dy <= 2.5f && PickLeap())
                    {
                        Stop();
                        Sfx("enemy_alert", 0.5f, 1.5f);
                        Play("crouch", 0.06f);
                        SetState("crouch");
                        break;
                    }
                    if (SeekSight(dt)) break;
                    bool fast = d < MinRange - 2 || d > MaxRange + 2;
                    KeepRange(MinRange, MaxRange, d < 9 ? moveSpeed * 1.3f : moveSpeed, strafeSign);
                    var v = agent.desiredVelocity;
                    v.y = 0;
                    if (fast) FaceMovement(286, dt);
                    else if (v.sqrMagnitude > 0.25f) FaceMovement(172, dt);
                    else FacePlayer(172, dt);
                    if (cooldown <= 0 && sees && d >= FireMin && d <= FireMax && dy <= 6)
                    {
                        if (RequestAttack(AttackTokens.Kind.Heavy, ChargeTime + 1.4f)) BeginCharge();
                        else cooldown = Random.Range(0.4f, 0.9f);
                    }
                    break;
                }
                case "charge":
                {
                    Stop();
                    float t = Mathf.Clamp01(stateTime / chargeTime);
                    Glow = 0.3f + 0.7f * t;
                    bool locked = AimLocked(t);
                    // 跟踪段：转身对准玩家，瞄准点跟着玩家胸口走；锁定段方向不再变
                    if (!locked) FacePlayer(258, dt);
                    UpdateAim(locked, dt);
                    ChargeFx(t, dt);
                    if (stateTime >= chargeTime) Fire();
                    break;
                }
                case "recover":
                    Stop();
                    FacePlayer(115, dt);
                    Glow = 0.25f;
                    if (stateTime >= recoverTime / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)))
                    {
                        ReleaseAttack();
                        RollCooldown(3.6f, 5f);
                        PlayLocomotion();
                        SetState("move");
                    }
                    break;
                case "crouch":
                    Stop();
                    FaceTowards(leapTarget, 344, dt);
                    if (stateTime >= CrouchTime) LaunchLeap();
                    break;
                case "leap":
                    FaceTowards(leapTarget, 229, dt);
                    if ((ManualGrounded && stateTime > 0.15f) || stateTime > LeapTime * 2.5f) Land();
                    break;
                case "land":
                    Stop();
                    FacePlayer(286, dt);
                    if (stateTime >= LandTime)
                    {
                        // 落地后很快就能再蓄力（逼近它只会让它换个地方继续射）
                        cooldown = Mathf.Min(cooldown, Random.Range(0.6f, 1.1f));
                        PlayLocomotion();
                        SetState("move");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("move");
                    break;
            }
        }

        /// <summary>看不见玩家：绕到 9–24 m 外、看得见玩家的位置（返回 true = 这一帧在寻位）</summary>
        bool SeekSight(float dt)
        {
            var q = new SightQuery(PlayerPos, PlayerEye, transform.position, MinRange - 4, MaxRange, 1.6f * Size) { clearance = 0.6f * Size };
            if (!seeker.Tick(sees, dt, q)) return false;
            if (seeker.HasSpot)
            {
                MoveTo(seeker.Spot, moveSpeed);
                if (seeker.Arrived(transform.position)) seeker.Reached();
            }
            else MoveTo(PlayerPos, moveSpeed);
            FaceMovement(286, dt);
            return true;
        }

        void BeginCharge()
        {
            chargeTime = Windup(ChargeTime, 0.9f);
            Stop();
            aimTimer = 0;
            chargeAcc = 0;
            SetState("charge");
            UpdateAim(false, 0);
            float w = AimHalf * 2f * (elite ? 1.25f : 1f);
            var flat = new Vector3(aimDir.x, 0, aimDir.z).normalized;
            aimLane = Telegraph.Lane(transform.position, transform.position + flat * aimLen, w, chargeTime, WarnColor);
            Sfx("telegraph", 0.75f, 1.6f);
            PlayTimed("charge", chargeTime, 0.08f);
            // 前蹄一跺：蓄力开始
            FrostKit.SnowPuff(transform.TransformPoint(new Vector3(0.1f, 0.05f, 0.3f)), 0.6f * Size, 5);
        }

        /// <summary>瞄准：跟踪段更新方向（玩家胸口 + 0.2 s 提前量）；每 0.1 s 重测射程，瞄准线沿冰光的地面投影铺到被挡住的地方</summary>
        void UpdateAim(bool locked, float dt)
        {
            var from = Muzzle;
            if (!locked)
            {
                var aim = PredictPlayer(0.2f) + Vector3.up * 1.08f;
                var dir = aim - from;
                if (dir.sqrMagnitude > 1e-6f) aimDir = dir.normalized;
            }
            aimTimer -= dt;
            if (aimTimer <= 0)
            {
                aimTimer = 0.1f;
                WorldRay(from, aimDir, BeamRange, out float dist);
                aimLen = Mathf.Max(1, new Vector2(aimDir.x, aimDir.z).magnitude * dist);
            }
            var flat = new Vector3(aimDir.x, 0, aimDir.z);
            if (flat.sqrMagnitude < 1e-6f) return;
            aimLane.SetLine(transform.position, transform.position + flat.normalized * aimLen, AimHalf * 2f * (elite ? 1.25f : 1f));
        }

        /// <summary>蓄力特效：角间光团冒冰晶，越来越密、越来越亮</summary>
        void ChargeFx(float t, float dt)
        {
            chargeAcc += dt * (5 + t * 20);
            if (chargeAcc < 1) return;
            chargeAcc = 0;
            var m = Muzzle;
            Fx.Burst(m + Random.insideUnitSphere * 0.25f * Size, t > 0.7f ? CoreColor : SparkColor, 1, 0.5f + t, 0.3f, 0.05f * Size, -0.5f);
            // FX3：聚光时冰晶往角间收、闪粒一颗颗亮
            if (t > 0.5f) Fx.Play("Twinkle", m + Random.insideUnitSphere * 0.35f * Size, Vector3.up, CoreColor, 0.15f + 0.15f * t);
        }

        /// <summary>射出冰光：终点停在第一个遮挡上；碰到目标胶囊伤害一次 + 小推力；光束下铺冻地</summary>
        void Fire()
        {
            var from = Muzzle;
            var dir = aimDir;
            float k = elite ? 1.25f : 1f;
            WorldRay(from, dir, BeamRange, out float dist);
            var end = from + dir * dist;
            var pv = PlayerVitals.Instance;
            var cc = pv ? pv.GetComponent<CharacterController>() : null;
            float pr = cc ? cc.radius : 0.35f, ph = cc ? cc.height : 1.8f;
            if (SegmentHitsCapsule(from, end, BeamRadius * (elite ? 1.2f : 1f), PlayerPos, pr, ph) && HitTarget(Damage, from))
            {
                // 小推力（< 3 m/s，不触发击退硬直）：被冰光冲得一晃
                var motor = pv ? pv.GetComponent<PlayerMotor>() : null;
                if (motor && !pv.Dead) motor.AddImpulse(new Vector3(dir.x * BeamPush, 0, dir.z * BeamPush));
            }
            Fx.Beam(from, end, BeamColor, 0.32f * k, 0.42f);
            int n = Mathf.Clamp(Mathf.FloorToInt(dist / 1.2f), 2, 24);
            // FX3：光束沿线留下闪粒、终点碎冰、角间一记星芒
            for (int i = 1; i <= n; i++) Fx.Play("Twinkle", from + dir * (dist * i / (n + 1)), Vector3.up, i % 3 == 0 ? CoreColor : SparkColor, 0.3f * k);
            FrostKit.Shatter(end, 0.7f * k, ShardColor, 14, 5);
            Fx.FrostGlint(from, 1.3f * k, CoreColor);
            GameAudio.PlayAt("shot_beam", from, 0.9f, 1.35f);
            // 冻地从前蹄处开始（冰光从头顶射出，脚下的地面不结冰），只铺在和起点差不多高的地面上
            var g0 = transform.TransformPoint(StripFrom);
            g0.y = transform.position.y;
            float gy = Fx.GroundY(end + Vector3.up * 0.5f, 6f);
            var g1 = new Vector3(end.x, float.IsFinite(gy) && Mathf.Abs(gy - g0.y) < 0.8f ? gy : g0.y, end.z);
            FuzhuIceStrip.Spawn(g0, g1, StripHalf * k, StripTime);
            aimLane.End();
            recoverTime = RecoverTime;
            Play("recover", 0.06f);
            SetState("recover");
        }

        /// <summary>选跳跃落点：背离玩家约 10 m、在导航网格上、高差 ≤ 1.5 m、1.4 m 高的直线不被挡（矮掩体跳得过去）、比现在离玩家远 4 m 以上</summary>
        bool PickLeap()
        {
            var pos = transform.position;
            var away = pos - PlayerPos;
            away.y = 0;
            float len = away.magnitude;
            if (len < 1e-3f)
            {
                away = -transform.forward;
                away.y = 0;
            }
            float baseYaw = Mathf.Atan2(away.x, away.z);
            for (int i = 0; i < LeapOffsets.Length; i++)
            {
                float a = baseYaw + LeapOffsets[i] * (LeapSigned[i] ? strafeSign : 1f);
                var t = new Vector3(pos.x + Mathf.Sin(a) * LeapDist, pos.y, pos.z + Mathf.Cos(a) * LeapDist);
                if (!NavMesh.SamplePosition(t, out var hit, 1.5f, NavMesh.AllAreas)) continue;
                var p = hit.position;
                if (new Vector2(p.x - t.x, p.z - t.z).magnitude > 0.8f || Mathf.Abs(p.y - pos.y) > 1.5f) continue;
                // 腾空弧线中段约 2 m 高：1.4 m 高处的直线不被挡住就跳得过去
                if (Combat.Blocked(pos + Vector3.up * 1.4f, p + Vector3.up * 1.4f, null)) continue;
                var fromPlayer = p - PlayerPos;
                fromPlayer.y = 0;
                if (fromPlayer.magnitude < len + 4) continue;
                leapTarget = p;
                return true;
            }
            leapCd = 1f;
            return false;
        }

        void LaunchLeap()
        {
            BeginManualMotion(LeapVelocity(transform.position, leapTarget, LeapTime, Gravity), Gravity);
            leapCd = Random.Range(4f, 6f);
            Play("leap", 0.05f);
            SetState("leap");
            GameAudio.PlayAt("jump", transform.position, 0.6f, 0.8f);
            FrostKit.SnowPuff(transform.TransformPoint(new Vector3(0, 0.05f, -0.35f)), Size, 8);
        }

        void Land()
        {
            EndManualMotion();
            Play("land", 0.05f);
            SetState("land");
            foreach (float z in new[] { 0.3f, -0.35f }) FrostKit.SnowPuff(transform.TransformPoint(new Vector3(0, 0.05f, z)), Size, 7);
            Fx.Ring(transform.position + Vector3.up * 0.05f, 2.2f * Size, IceColor, 0.4f);
            GameAudio.PlayAt("land", transform.position, 0.7f, 1.2f);
        }

        protected override void CancelAttack()
        {
            aimLane.Cancel();
            if (!Dead && state is "charge" or "recover") RollCooldown(1.5f, 2.5f);
        }
    }
}
