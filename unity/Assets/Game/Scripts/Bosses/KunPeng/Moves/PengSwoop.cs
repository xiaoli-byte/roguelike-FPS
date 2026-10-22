using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鹏 · 俯冲掠台（Three.js KunPeng.ts 'swoop'）：
    ///   前摇（瞄准 ≤ 1.8 s + 预警 0.9 s）：飞到俯冲起点（过玩家所在方位、沿环台切线，两端都留在环台内，<see cref="KunPengMath.SwoopLine"/>），
    ///     降到 7 m，地面亮一条半宽 2.3 m 的长条预警（act_swoopReady），转向俯冲方向；
    ///   出手：贴地（0.6 m）26 m/s 掠过整条线（dive）——从双爪到胸口的一段（随俯冲姿势倾斜）加上这一帧双爪扫过的路径碰到玩家就是一下（30，往前 12 m/s 掀飞）；
    ///     撞上冰柱 / 祭台 / 冰崖就硬直 1.8 s（<see cref="BossBrain.Stagger"/>，crash 动作，鲛珠大亮——额外的输出窗口），招式就此打断；
    ///     狂怒（25% 以下）时停 0.6 s 再瞄一次、连掠两次；
    ///   收招 0.6 s：拉回盘旋高度。
    /// 侧移 / 冲刺躲开。
    /// </summary>
    public sealed class PengSwoop : KunPengMove
    {
        public const string MoveId = "swoop";
        public const float AimMax = 1.8f, TeleSeconds = 0.9f, DiveSpeed = 26f, DiveAlt = 0.6f, DiveMax = 2.6f, HalfWidth = 2.3f, HitRadius = 1.6f, CrashStagger = 1.8f;

        enum Sub { Aim, Tele, Dive, Pause }

        public override string Id => MoveId;
        public override string Name => "鹏 · 俯冲掠台";

        /// <summary>本次俯冲了几趟、打中几下、撞没撞；当前这一趟的线（测试用）</summary>
        public int Dives { get; private set; }
        public int Hits { get; private set; }
        public bool Crashed { get; private set; }
        public Vector3 From { get; private set; }
        public float Yaw { get; private set; }
        public float Length { get; private set; }
        /// <summary>这一趟里离地最低的高度（米）</summary>
        public float LowestAlt { get; private set; }

        Sub sub;
        float subT, travel, trailAcc;
        int left;
        bool hit;
        Vector3 prevTalons;

        public PengSwoop()
        {
            forms = new[] { KunPengDef.PengForm };
            cooldown = 7f;
            recovery = 1f;
            firstDelay = 3.5f;
            weight = 2.6f;
            windup = AimMax + TeleSeconds;
            active = 8f;
            recover = 0.6f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 10f ? 2.6f : 1.6f;

        protected override void OnStart()
        {
            left = Brain.Enraged ? 2 : 1;
            Dives = Hits = 0;
            Crashed = false;
            LowestAlt = float.PositiveInfinity;
            if (KP) KP.MovesSincePerch++;
            BeginAim();
        }

        void BeginAim()
        {
            sub = Sub.Aim;
            subT = 0;
            Act("swoopReady", 2.4f);
            var (from, yaw, len) = KunPengMath.SwoopLine(Hole, Brain.PlayerPosition, Rng.Sign());
            From = AtFloor(from);
            Yaw = yaw;
            Length = len;
            if (KP)
            {
                KP.HoverAlt = KP.OverHoleAlt((KDef != null ? KDef.pengOverHole : 11.5f) + 0.5f);
                KP.Accel = 40f;
            }
            CuedSfx("enemy_alert", 1f, 0.7f);
        }

        // 前摇 = 第一趟的瞄准 + 预警；出手 = 俯冲（狂怒时含中间的停顿与第二趟的瞄准 / 预警）；收招 0.6 s
        protected override bool WindupDone => false;
        protected override bool ActiveDone => false;

        protected override void OnWindup(float dt) => Tick(dt);
        protected override void OnActive(float dt) => Tick(dt);

        void Tick(float dt)
        {
            subT += dt;
            var kp = KP;
            switch (sub)
            {
                case Sub.Aim:
                {
                    bool arrived = !kp || kp.FlyTo(From, 22f, 2.5f);
                    Brain.Face(From, 230f, dt);
                    if (!arrived && subT <= AimMax) return;
                    sub = Sub.Tele;
                    subT = 0;
                    if (kp)
                    {
                        kp.Hover();
                        kp.HoverAlt = 7f;
                    }
                    Hazards.LineWarning(From, Yaw, Length, HalfWidth, TeleSeconds, KunPengDef.Warn);
                    CountWarning();
                    Sfx("telegraph");
                    return;
                }
                case Sub.Tele:
                    kp?.Hover();
                    kp?.SetFacing(Mathf.MoveTowardsAngle(Brain.transform.eulerAngles.y, Yaw, 286f * dt));
                    if (subT < TeleSeconds) return;
                    if (Stage == MoveStage.Windup) EndWindup();
                    BeginDive();
                    return;
                case Sub.Dive:
                    StepDive(dt);
                    return;
                case Sub.Pause:
                    kp?.Hover();
                    Brain.Face(Brain.PlayerPosition, 143f, dt);
                    if (subT >= 0.6f) BeginAim();
                    return;
            }
        }

        void BeginDive()
        {
            sub = Sub.Dive;
            subT = travel = trailAcc = 0;
            hit = false;
            left--;
            Dives++;
            var kp = KP;
            if (kp)
            {
                kp.Accel = 90f;
                kp.HoverAlt = DiveAlt;
                kp.Diving = true;
                var v = kp.FlyVelocity;
                kp.SetFlyVelocity(new Vector3(v.x, Mathf.Min(v.y, -10f), v.z));
                kp.SetFacing(Yaw);
            }
            Act("dive", 1.2f);
            CuedSfx("boss_roar", 0.8f, 1.5f);
            prevTalons = Talons;
        }

        Vector3 Talons
        {
            get
            {
                var root = Brain.transform.position;
                var l = BonePos("talon_L", root + Vector3.up * 0.5f);
                var r = BonePos("talon_R", root + Vector3.up * 0.5f);
                return (l + r) * 0.5f;
            }
        }

        void StepDive(float dt)
        {
            var kp = KP;
            var dir = Dir(Yaw);
            if (kp)
            {
                kp.FlyVelocityTo(dir * DiveSpeed);
                kp.SetFacing(Yaw);
                var v = kp.FlyVelocity;
                travel += new Vector2(v.x, v.z).magnitude * dt;
            }
            else travel += DiveSpeed * dt;
            LowestAlt = Mathf.Min(LowestAlt, Brain.transform.position.y - Floor);
            var talons = Talons;
            var chest = BonePos("chest", Brain.BodyCenter);
            if (!hit && (Hazards.SegmentHitsPlayer(talons, chest, HitRadius) || Hazards.SegmentHitsPlayer(prevTalons, talons, HitRadius)))
            {
                hit = true;
                Hits++;
                Hazards.Hurt(Dmg(30), Element.None, Brain.transform.position);
                if (kp && kp.Motor) kp.Motor.AddImpulse(dir * 12f + Vector3.up * 6f);
                Brain.Shake(0.5f, 0.35f);
                Sfx("enemy_melee", 1f, 0.7f);
            }
            prevTalons = talons;
            trailAcc += dt;
            if (trailAcc >= 0.05f)
            {
                trailAcc = 0;
                Fx.Burst(talons, KunPengDef.Ice, 4, 2f, 0.6f, 0.35f, -1f);
            }
            bool crashed = subT > 0.2f && WallAhead(dir, dt);
            if (travel < Length && !crashed && subT <= DiveMax) return;
            if (kp)
            {
                kp.Diving = false;
                kp.Accel = KDef != null ? KDef.pengAccel : 22f;
                kp.Hover();
            }
            if (crashed)
            {
                Crashed = true;
                Fx.Burst(talons, KunPengDef.Ice, 24, 8f, 0.9f, 0.4f, 12f);
                CuedSfx("boss_slam", 1f, 1.1f);
                // 撞晕：脚本化硬直（打断招式，crash 动作，鲛珠大亮）
                Brain.Stagger(CrashStagger, "crash");
                return;
            }
            if (kp) kp.HoverAlt = KDef != null ? KDef.pengHover : 13.5f;
            if (left > 0)
            {
                sub = Sub.Pause;
                subT = 0;
                return;
            }
            EndActive();
        }

        /// <summary>前方低处（1.5 m 高、1.2 m 粗）这一帧会撞上陡面（冰柱、祭台侧壁、冰崖；冰窟边缘段不算）</summary>
        bool WallAhead(Vector3 dir, float dt)
        {
            var origin = Brain.transform.position + Vector3.up * 1.5f;
            float dist = DiveSpeed * dt + Brain.BodyRadius * 0.6f + 0.5f;
            if (!Physics.SphereCast(origin, 1.2f, dir, out var h, dist, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return false;
            if (h.normal.y >= 0.5f || h.collider.transform.IsChildOf(Brain.transform)) return false;
            return !(KP && KP.HoleMarker && KP.HoleMarker.IsRim(h.collider));
        }

        protected override void OnRecover(float dt)
        {
            KP?.Hover();
            Brain.Face(Brain.PlayerPosition, 143f, dt);
        }

        protected override void OnEnd(bool cancelled)
        {
            if (!KP) return;
            KP.Diving = false;
            KP.Accel = KDef != null ? KDef.pengAccel : 22f;
            if (!KP.Staggered) KP.HoverAlt = KDef != null ? KDef.pengHover : 13.5f;
        }
    }
}
