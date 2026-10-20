using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>熔心魔将（Three.js src/enemies/bosses/Warlord.ts）的颜色与尺寸常量。BS6 的 3-3 领主战照这些参考招式重写（熔岩涌动改成熔铜渠涨落）</summary>
    public static class WarlordRef
    {
        public static readonly Color Warn = Hex.Rgb(0xff4a1a), Fire = Hex.Rgb(0xff6a1f), Embers = Hex.Rgb(0xffa040), Lava = Hex.Rgb(0xff4a10);
        /// <summary>横扫扇形半角（度，TS 1.13 rad）、火浪最大半径、环带宽、预警半径（= 火浪最大半径 + 环带半宽 + 玩家半径）</summary>
        public const float SweepHalf = 64.74f, SweepRadius = 13f, SweepWidth = 1.3f, SweepWarnRadius = 14f;
        /// <summary>冲锋：预警长条半宽 = 命中判定（玩家中心到魔将中心的水平距离）</summary>
        public const float ChargeHalfWidth = 1.7f, ChargeSpeed = 20f;
        /// <summary>连斩：每斩前摇、间隔、扇形半径与半角（度，TS 0.9 rad）</summary>
        public const float ComboWindup = 0.5f, ComboPer = 0.72f, ComboRange = 4.8f, ComboHalf = 51.57f;
        /// <summary>跃击落点与预警圈中心偏差超过此值（被掩体挡住半路落地）时不结算落点重击，只放冲击波</summary>
        public const float LeapMiss = 2.5f, LeapGravity = 30f;
    }

    /// <summary>
    /// 魔将 · 烈焰冲锋：直线预警（预判玩家 0.3 s、越过玩家 6 m、最长 26 m、截到场地边界）→ 20 m/s 冲锋，沿途每 2.4 m 留一片持续 6 s 的火焰地带；
    /// 冲过玩家身边（预警半宽以内）撞一下并往侧前方掀开，每次冲锋只撞一下；撞墙硬直 1 s。二阶段起连冲两次（第二次预警 0.65 s）
    /// </summary>
    public sealed class WarlordCharge : ReferenceMove
    {
        public override string Id => "warlord_charge";
        public override string Name => "魔将 · 烈焰冲锋";

        enum Leg { Aim, Run, Crash, Recover }

        Leg leg;
        Vector3 dir, lastPos;
        float length, travelled, trail, legT, tele, fxAcc;
        int left;
        bool hitDone;
        Telegraph.LineHandle line;

        /// <summary>本次留下的火焰地带数、撞中次数（测试用）</summary>
        public int Trails { get; private set; }
        public int Hits { get; private set; }

        public WarlordCharge()
        {
            cooldown = 7f;
            recovery = 1.1f;
            windup = 0.9f;
            recover = 0.1f;
            windupAnim = "bloomWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 7f ? 3f : 1f;

        protected override void OnStart()
        {
            left = Phase >= 1 ? 2 : 1;
            tele = (Phase >= 1 ? 0.75f : 0.9f) * Brain.WindupScale;
            Trails = 0;
            Aim();
        }

        void Aim()
        {
            var from = Brain.transform.position;
            var want = Brain.Predict(0.3f) - from;
            want.y = 0;
            float d = want.magnitude;
            dir = d < 0.5f ? Dir(Facing) : want / d;
            float edge = ToEdge(from, dir, 1.5f);
            length = Mathf.Clamp(Mathf.Min(d + 6f, 26f), Mathf.Min(8f, edge), Mathf.Max(2f, edge));
            leg = Leg.Aim;
            legT = 0;
            Brain.Halt();
            Sfx("telegraph");
            Sfx("enemy_charge", 1f, 0.7f);
        }

        protected override void OnTelegraph() => DrawLine();

        void DrawLine()
        {
            var from = Brain.transform.position;
            from.y = Floor;
            line = WarnLine(from, from + dir * length, WarlordRef.ChargeHalfWidth * 2f, tele, WarlordRef.Warn);
        }

        protected override bool WindupDone => StageT >= tele;

        protected override void OnWindup(float dt)
        {
            Brain.Face(Brain.transform.position + dir, 340f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, tele)));
        }

        protected override void OnActiveBegin() => Run();

        void Run()
        {
            leg = Leg.Run;
            legT = 0;
            travelled = 0;
            trail = 1.5f;
            hitDone = false;
            Brain.FaceNow(Brain.transform.position + dir);
            lastPos = Brain.transform.position;
            Brain.BeginDash(dir * WarlordRef.ChargeSpeed, 30f);
            Sfx("enemy_charge", 1f, 0.55f);
            Brain.Shake(0.2f, 0.25f);
        }

        protected override void OnActive(float dt)
        {
            legT += dt;
            switch (leg)
            {
                case Leg.Aim:
                    Brain.Face(Brain.transform.position + dir, 340f, dt);
                    Brain.Glow(0, Mathf.Clamp01(legT / Mathf.Max(0.01f, tele)));
                    if (legT >= tele) Run();
                    break;
                case Leg.Run:
                    StepRun(dt);
                    break;
                default:
                    Brain.Halt();
                    Brain.Face(Brain.PlayerPosition, 170f, dt);
                    Brain.Glow(0, 0);
                    if (legT >= (leg == Leg.Crash ? 1f : 0.45f))
                    {
                        left--;
                        if (left > 0)
                        {
                            tele = 0.65f * Brain.WindupScale;
                            Aim();
                            DrawLine();
                        }
                        else EndActive();
                    }
                    break;
            }
        }

        void StepRun(float dt)
        {
            var p = Brain.transform.position;
            var step = p - lastPos;
            step.y = 0;
            float s = step.magnitude;
            travelled += s;
            trail += s;
            if (trail >= 2.4f)
            {
                trail = 0;
                var c = p;
                c.y = GroundY(p);
                Hazards.Zone(new BossZoneSpec(c, 1.6f, 6f, Dmg(5), WarlordRef.Fire) { arm = 0.25f, embers = true });
                Trails++;
            }
            if (!hitDone) CheckHit(p);
            fxAcc += dt;
            if (fxAcc >= 0.04f)
            {
                fxAcc = 0;
                Fx.Burst(new Vector3(p.x, Floor + 0.3f, p.z), WarlordRef.Embers, 4, 3f, 0.5f, 0.16f, -4f);
            }
            lastPos = p;
            bool crashed = Brain.DashHitWall && legT > 0.12f;
            bool outOfArena = Brain.Arena && !Brain.Arena.Contains(p, Brain.BodyRadius * 0.5f);
            if (travelled < length && !crashed && !outOfArena && legT <= 2.2f) return;
            Brain.EndDash();
            Brain.Halt();
            legT = 0;
            if (crashed)
            {
                leg = Leg.Crash;
                Fx.Explosion(p + dir * 1.2f + Vector3.up * 1.5f, 2f, WarlordRef.Fire);
                Brain.Shake(0.55f, 0.4f);
                Sfx("boss_slam", 1f, 1.1f);
            }
            else leg = Leg.Recover;
        }

        void CheckHit(Vector3 p)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var pp = pv.transform.position;
            var off = pp - p;
            float dy = off.y;
            off.y = 0;
            // 判定半径与预警长条半宽一致：玩家中心站在预警外就不会被撞到
            if (off.magnitude >= WarlordRef.ChargeHalfWidth || dy >= 2.8f) return;
            hitDone = true;
            if (Hazards.Hurt(Dmg(28), Element.Fire, p + Vector3.up) <= 0) return;
            Hits++;
            float side = off.x * dir.z - off.z * dir.x >= 0 ? 1 : -1;
            var motor = pv.GetComponent<PlayerMotor>();
            if (motor) motor.AddImpulse(new Vector3(dir.x * 13 + dir.z * 5 * side, 6, dir.z * 13 - dir.x * 5 * side));
            Brain.Shake(0.55f, 0.35f);
            Sfx("enemy_melee", 1f, 0.6f);
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.EndDash();
            Brain.Glow(0, 0);
            line?.End();
            line = null;
        }
    }

    /// <summary>
    /// 魔将 · 扇形火焰横扫：扇形预警（半角 64.7°、半径 14 m，0.85 s，二阶段 0.7 s）→ 挥刃放出贴地火焰弧（扇形冲击波，高 1 m：跳过 / 离开扇区）；
    /// 二阶段起 0.2 s 后反手再画一道扇形（0.55 s）、扫第二次，并沿扇区射出 7 枚膝高火弹（与火浪同速同向：同一次起跳一并躲过）
    /// </summary>
    public sealed class WarlordSweep : ReferenceMove
    {
        public override string Id => "warlord_sweep";
        public override string Name => "魔将 · 火焰横扫";

        float tele, yaw, yaw2;
        int sweeps;
        bool warned2, struck2;

        public WarlordSweep()
        {
            cooldown = 5f;
            recovery = 1.1f;
            windup = 0.85f;
            recover = 0.1f;
            weight = 3f;
            windupAnim = "chordWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 14f ? 3f : 1.2f;

        protected override void OnStart()
        {
            tele = (Phase >= 1 ? 0.7f : 0.85f) * Brain.WindupScale;
            yaw = YawToPlayer;
            sweeps = Phase >= 1 ? 2 : 1;
            warned2 = struck2 = false;
            Brain.Halt();
        }

        protected override void OnTelegraph()
        {
            Hazards.SectorWarning(OnGround(Brain.transform.position), yaw, WarlordRef.SweepHalf, WarlordRef.SweepWarnRadius, tele, WarlordRef.Warn);
            Sfx("telegraph");
        }

        protected override bool WindupDone => StageT >= tele;

        protected override void OnWindup(float dt)
        {
            TurnToward(yaw, 460f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, tele)));
        }

        protected override void OnActiveBegin() => Strike(yaw, false);

        protected override void OnActive(float dt)
        {
            if (sweeps < 2) return;
            if (!warned2 && StageT >= 0.2f)
            {
                warned2 = true;
                yaw2 = YawToPlayer;
                Hazards.SectorWarning(OnGround(Brain.transform.position), yaw2, WarlordRef.SweepHalf, WarlordRef.SweepWarnRadius, 0.55f, WarlordRef.Warn);
                Sfx("telegraph", 1f, 1.2f);
            }
            if (warned2 && !struck2) TurnToward(yaw2, 460f, dt);
            if (!struck2 && StageT >= 0.75f)
            {
                struck2 = true;
                Strike(yaw2, true);
            }
        }

        protected override bool ActiveDone => StageT >= (sweeps > 1 ? 1.35f : 0.8f);

        void Strike(float yawDeg, bool bolts)
        {
            Brain.Glow(0, 1);
            var c = OnGround(Brain.transform.position);
            Hazards.Wave(new BossWaveSpec(c, 16f, WarlordRef.SweepRadius, Dmg(24), WarlordRef.Fire)
            {
                startRadius = 1f, arcYaw = yawDeg, arcHalf = WarlordRef.SweepHalf, width = WarlordRef.SweepWidth, height = 1f,
                element = Element.Fire, knockback = 6, dust = true, dustColor = WarlordRef.Embers,
            });
            for (int i = -2; i <= 2; i++) Fx.Burst(c + Dir(yawDeg + i * 25.8f) * 2.8f + Vector3.up, WarlordRef.Fire, 5, 5f, 0.45f, 0.16f, -2f);
            if (bolts)
                for (int k = -3; k <= 3; k++)
                {
                    var d = Dir(yawDeg + k * 9.17f);
                    Shoot(c + d * 1.5f + Vector3.up * 0.55f, d, 16f, Dmg(10), WarlordRef.Fire, "flame", 0.3f, 2.2f, 1.3f, Element.Fire);
                }
            Brain.Shake(0.35f, 0.3f);
            Sfx("enemy_melee", 1f, 0.6f);
            Sfx("skill_fire", 0.8f, 0.8f);
        }

        protected override void OnEnd(bool cancelled) => Brain.Glow(0, 0);
    }

    /// <summary>
    /// 魔将 · 陨石雨：举剑引天火（0.8 s），之后 3.2 s 内落下 10（二阶段 14、三阶段 20）颗带落点预警的陨石（每三颗一颗预判玩家 1.1 s 后的走位，其余落在玩家周围 3–15 m），
    /// 从 30 m 高处斜着直线坠落（1.25 s）；二阶段起落点留下 3.5 s 的火焰
    /// </summary>
    public sealed class WarlordMeteor : ReferenceMove
    {
        public override string Id => "warlord_meteor";
        public override string Name => "魔将 · 陨石雨";

        int count, dropped;
        float dur, flameAcc;

        public WarlordMeteor()
        {
            cooldown = 11f;
            recovery = 1f;
            windup = 0.8f;
            recover = 0.1f;
            windupAnim = "blessWindup";
        }

        public override float Weight(BossBrain b) => 2.2f + (b.Phase >= 2 ? 1.5f : 0f);

        protected override void OnStart()
        {
            count = Phase >= 2 ? 20 : Phase >= 1 ? 14 : 10;
            dur = Phase >= 2 ? 3.6f : Phase >= 1 ? 3.4f : 3.2f;
            dropped = 0;
            Brain.Halt();
            Sfx("boss_roar", 0.6f, 1.2f);
            Sfx("telegraph");
        }

        protected override void OnTelegraph()
        {
            // Unity 补的：举剑时玩家周围一圈淡预警（陨石落点预警要等第一颗出手才有）
            Hazards.GroundWarning(OnGround(Brain.PlayerPosition), 15f, WindupTime, new Color(WarlordRef.Warn.r, WarlordRef.Warn.g, WarlordRef.Warn.b, 0.35f));
        }

        protected override void OnWindup(float dt)
        {
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, WindupTime)));
            flameAcc += dt;
            if (flameAcc < 0.06f) return;
            flameAcc = 0;
            Fx.Burst(Eye + Vector3.up * 1.2f, WarlordRef.Embers, 4, 5f, 0.6f, 0.16f, -12f);
        }

        protected override void OnActiveBegin() => Drop(dropped++);

        protected override void OnActive(float dt)
        {
            while (dropped < count && StageT >= dropped * dur / count) Drop(dropped++);
        }

        protected override bool ActiveDone => dropped >= count && StageT >= dur + 0.3f;

        void Drop(int i)
        {
            var rng = Rng;
            Vector3 to;
            if (i % 3 == 0) to = Brain.Predict(1.1f);
            else
            {
                float a = rng.Range(0, Mathf.PI * 2), r = rng.Range(3f, 15f);
                to = Brain.PlayerPosition + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r);
            }
            to = OnGround(Brain.ClampToArena(to, 2f));
            var from = to + new Vector3(rng.Range(-7f, 7f), 30f, rng.Range(-7f, 7f));
            bool leaveFire = Phase >= 1;
            float fireDmg = Dmg(4);
            var hz = Hazards;
            Hazards.Lob(new BossLobSpec(from, to, 1.25f, 0f, 3f, Dmg(22), WarlordRef.Fire, LobKind.Meteor)
            {
                element = Element.Fire,
                onLand = leaveFire ? p => hz.Zone(new BossZoneSpec(p, 2.2f, 3.5f, fireDmg, WarlordRef.Fire) { arm = 0.1f, embers = true }) : null,
            });
        }

        protected override void OnEnd(bool cancelled) => Brain.Glow(0, 0);
    }

    /// <summary>
    /// 魔将 · 跃击：蹲伏（0.48 s，二阶段 0.38 s）→ 跃向玩家 0.35 s 后的位置（落点 5 m 圆形预警，填满时刻 = 落地时刻；夹进场地）→ 砸地重击 + 扩散冲击波（5 → 20 m）；
    /// 二阶段起落点燃起 5 s 火焰。被掩体挡住半路落地（偏离预警圈 2.5 m 以上）或明显提前落地时，撤回落点预警、不结算落点重击，只放冲击波
    /// </summary>
    public sealed class WarlordLeap : ReferenceMove
    {
        public override string Id => "warlord_leap";
        public override string Name => "魔将 · 跃击";

        Vector3 target;
        float crouch, air, landT;
        bool landed;
        TelegraphHandle warn;

        /// <summary>上次落地是否在预警圈里（测试用）</summary>
        public bool LastOnMark { get; private set; }

        public WarlordLeap()
        {
            cooldown = 8f;
            recovery = 1.1f;
            windup = 0.48f;
            recover = 0.1f;
            windupAnim = "chordWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 8f ? 2.6f : 1.2f;

        protected override void OnStart()
        {
            crouch = (Phase >= 1 ? 0.38f : 0.48f) * Brain.WindupScale;
            air = Phase >= 1 ? 0.85f : 1f;
            landed = false;
            target = OnGround(Brain.ClampToArena(Brain.Predict(0.35f), 3f));
            Brain.Halt();
            Brain.FaceNow(target);
            Sfx("telegraph");
        }

        protected override void OnTelegraph() => warn = WarnCircle(target, 5f, crouch + air, WarlordRef.Warn);

        protected override bool WindupDone => StageT >= crouch;

        protected override void OnWindup(float dt) => Brain.Face(target, 460f, dt);

        protected override void OnActiveBegin()
        {
            var from = Brain.transform.position;
            var d = target - from;
            float dy = d.y;
            d.y = 0;
            var v = d / air;
            v.y = (dy + 0.5f * WarlordRef.LeapGravity * air * air) / air;
            Brain.BeginDash(v, WarlordRef.LeapGravity);
            Fx.Burst(from + Vector3.up * 0.2f, WarlordRef.Embers, 16, 6f, 0.6f, 0.2f, 6f);
            Sfx("jump", 1f, 0.5f);
        }

        protected override void OnActive(float dt)
        {
            if (landed) return;
            if ((StageT > 0.15f && Brain.DashGrounded) || StageT > air + 0.8f) Land();
        }

        protected override bool ActiveDone => landed && StageT - landT >= 0.7f;

        void Land()
        {
            bool early = StageT < air - 0.12f;
            landed = true;
            landT = StageT;
            Brain.EndDash();
            Brain.Halt();
            var p = Brain.transform.position;
            bool onMark = new Vector2(p.x - target.x, p.z - target.z).magnitude <= WarlordRef.LeapMiss;
            LastOnMark = onMark;
            if (!onMark || early) warn.Cancel();
            bool crushed = onMark && Hazards.Blast(p, 5f, Dmg(30), new BossBlastOpts { maxHeight = 1.8f, knockback = 12, knockUp = 6, element = Element.Fire });
            // 冲击波始终贴着场地地面扩散（落在掩体顶上时也一样），地面上的玩家才能看清并跳过
            var floor = new Vector3(p.x, Floor, p.z);
            Hazards.Wave(new BossWaveSpec(floor, 14f, 20f, Dmg(16), WarlordRef.Fire)
            {
                startRadius = 5f, element = Element.Fire, dust = true, dustColor = WarlordRef.Embers, width = 0.9f, height = 0.85f, spare = crushed,
            });
            Fx.Explosion(p + Vector3.up * 0.5f, 4.5f, WarlordRef.Fire);
            Brain.Shake(0.9f, 0.55f);
            Sfx("boss_slam");
            Sfx("explosion", 1f, 0.7f);
            if (Phase >= 1) Hazards.Zone(new BossZoneSpec(p, 4f, 5f, Dmg(5), WarlordRef.Fire) { arm = 0.3f, embers = true });
        }

        protected override void OnEnd(bool cancelled) => Brain.EndDash();
    }

    /// <summary>
    /// 魔将 · 焰刃连斩（贴身）：3（三阶段 4）连斩，每斩先画 4.8 m、半角 51.6° 的短扇形预警（0.5 s 前摇，期间转向玩家），出刀判定与预警同一扇区（按玩家半径放宽），
    /// 打中往前掀开；出刀后小幅前冲（在下一斩的预警画出之前完成，预警位置 = 判定位置）
    /// </summary>
    public sealed class WarlordCombo : ReferenceMove
    {
        public override string Id => "warlord_combo";
        public override string Name => "魔将 · 焰刃连斩";

        int count, warned, struck;
        float yaw;

        public int Hits { get; private set; }

        public WarlordCombo()
        {
            cooldown = 3.5f;
            recovery = 0.9f;
            windup = WarlordRef.ComboWindup;
            recover = 0.1f;
            windupAnim = "chordWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 5.5f ? 6f : 0f;

        protected override void OnStart()
        {
            count = Phase >= 2 ? 4 : 3;
            warned = struck = 0;
            Brain.Halt();
            Sfx("telegraph", 1f, 1.1f);
        }

        protected override void OnTelegraph() => Warn();

        void Warn()
        {
            yaw = YawToPlayer;
            Hazards.SectorWarning(OnGround(Brain.transform.position), yaw, WarlordRef.ComboHalf, WarlordRef.ComboRange, WarlordRef.ComboWindup, WarlordRef.Warn);
            warned++;
            Brain.Glow(0, 1);
        }

        protected override bool WindupDone => StageT >= WarlordRef.ComboWindup;

        protected override void OnWindup(float dt) => TurnToward(yaw, 570f, dt);

        protected override void OnActiveBegin() => Strike();

        protected override void OnActive(float dt)
        {
            // 时间轴相对整招：第 i 斩在 i × 0.72 s 画预警、再 0.5 s 出刀
            float t = T;
            if (warned < count && t >= warned * WarlordRef.ComboPer) Warn();
            if (struck < warned && t >= (struck * WarlordRef.ComboPer) + WarlordRef.ComboWindup) Strike();
            float local = t % WarlordRef.ComboPer;
            if (local < WarlordRef.ComboWindup) TurnToward(yaw, 570f, dt);
            bool lunge = local >= WarlordRef.ComboWindup && local < WarlordRef.ComboWindup + 0.14f && t < count * WarlordRef.ComboPer;
            if (lunge) Brain.MoveToward(Brain.transform.position + Dir(Facing) * 2f, 1.1f);
            else Brain.Halt();
        }

        protected override bool ActiveDone => struck >= count && T >= count * WarlordRef.ComboPer + 0.25f;

        void Strike()
        {
            struck++;
            bool hit = false;
            var pv = PlayerVitals.Instance;
            var p = Brain.transform.position;
            if (pv && !pv.Dead && BossHazards.PlayerBody(out var feet, out var pr, out _))
            {
                float dx = feet.x - p.x, dz = feet.z - p.z, d = Mathf.Sqrt(dx * dx + dz * dz), dy = feet.y - p.y;
                var cap = Brain.GetComponent<CapsuleCollider>();
                float height = cap ? cap.height * Mathf.Abs(Brain.transform.lossyScale.y) : 3.6f;
                if (d <= WarlordRef.ComboRange + pr * 0.5f && dy < height && dy > -1.5f)
                {
                    float off = d > 0.05f ? Mathf.Abs(BossHazards.AngleDiff(yaw * Mathf.Deg2Rad, Mathf.Atan2(dx, dz))) : 0;
                    if (off <= WarlordRef.ComboHalf * Mathf.Deg2Rad + Mathf.Atan2(pr, Mathf.Max(0.5f, d))) hit = Hazards.Hurt(Dmg(18), Element.Fire, p + Vector3.up) > 0;
                }
            }
            if (hit)
            {
                Hits++;
                var motor = pv.GetComponent<PlayerMotor>();
                if (motor) motor.AddImpulse(Dir(yaw) * 7f + Vector3.up * 3f);
                Brain.Shake(0.3f, 0.2f);
                Sfx("enemy_melee");
            }
            else Sfx("enemy_melee", 0.8f, 0.75f);
            var c = OnGround(p);
            for (int i = -1; i <= 1; i++) Fx.Burst(c + Dir(Facing + i * 31.5f) * 2.8f + Vector3.up * 1.1f, WarlordRef.Fire, 6, 5f, 0.4f, 0.16f, -2f);
            Fx.Slash(Brain.BodyCenter, yaw, WarlordRef.ComboRange * 0.8f, WarlordRef.ComboHalf * 2f * Mathf.Deg2Rad, struck % 2 == 0 ? 1 : -1, 0, 0.5f, 0.25f, WarlordRef.Fire);
            Brain.Glow(0, 0);
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.Halt();
            Brain.Glow(0, 0);
        }
    }

    /// <summary>
    /// 魔将 · 熔岩涌动（二阶段起，场上没有熔岩时）：插剑入地，场地外圈大范围熔岩——环形预警 3 s（从角落跑回内圈约需 3.4 s，配合冲刺或就近站上掩体可躲），
    /// 之后持续 10 s、每 0.5 s 烫一下站在环带里（脚底 0.8 m 以内）的玩家；靠近中心或站上高处可躲。内圈半径按场地缩放（TS 场地 40 m 时 15 m）。
    /// 3-3 领主战改成熔铜渠涨落（BS6），这里保留 TS 的环带写法作为「持续区 / 环带」原语的参考
    /// </summary>
    public sealed class WarlordLava : ReferenceMove
    {
        public override string Id => "warlord_lava";
        public override string Name => "魔将 · 熔岩涌动";

        HazardZone lava;
        bool announced;

        /// <summary>熔岩还在（预警或生效中）</summary>
        public bool LavaActive => lava && !lava.Ended;
        public HazardZone LavaZone => lava;

        public WarlordLava()
        {
            cooldown = 22f;
            recovery = 0.6f;
            windup = 0.45f;
            active = 0.85f;
            recover = 0.1f;
            windupAnim = "blessWindup";
        }

        public override float Weight(BossBrain b) => b.Phase >= 1 && !LavaActive ? 2.5f : 0f;

        protected override void OnStart()
        {
            Brain.Halt();
            Sfx("boss_roar", 0.8f);
            var c = Brain.Arena ? Brain.Arena.Center : Brain.transform.position;
            c.y = Floor;
            float extent = Brain.Arena ? Brain.Arena.Extent : 20f;
            float inner = Mathf.Clamp(extent * 0.38f, 5f, 15f);
            lava = Hazards.Zone(new BossZoneSpec(c, extent + 20f, 10f, Dmg(5), WarlordRef.Lava)
            {
                innerRadius = inner, arm = 3f, interval = 0.5f, embers = true, element = Element.Fire, maxHeight = 0.8f,
            });
            if (announced) return;
            announced = true;
            GameUI.Toast("熔岩正在涌向外圈——靠近中心或站上高处！", Hex.Rgb(0xff6a2a));
        }

        protected override void OnActiveBegin()
        {
            var c = OnGround(Brain.transform.position);
            Brain.Shake(0.4f, 1.6f);
            float inner = lava ? Mathf.Clamp((Brain.Arena ? Brain.Arena.Extent : 20f) * 0.38f, 5f, 15f) : 15f;
            Fx.Ring(c + Vector3.up * 0.1f, inner, WarlordRef.Lava, 1f);
            Sfx("boss_slam", 1f, 0.7f);
        }
    }
}
