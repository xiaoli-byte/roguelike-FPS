using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鹏 · 俯冲掠台（Three.js KunPeng.ts 'swoop'）：
    ///   前摇（瞄准 ≤ 1.8 s + 预警 0.9 s）：定一条俯冲线——过玩家所在方位、沿环台切线，两端都留在环台内（<see cref="KunPengMath.SwoopLine"/>），
    ///     从鹏所在的那一头进场（<see cref="KunPengMath.SwoopSide"/>）；飞到起点、降到 7 m，地面亮一条半宽 2.3 m 的长条预警（act_swoopReady），转向俯冲方向；
    ///   出手：贴地（0.6 m）26 m/s 沿预警线掠过（dive，横向偏差拉回线上）——从双爪到胸口的一段（随俯冲姿势倾斜）加上这一帧双爪扫过的路径碰到玩家就是一下
    ///     （30，往前 12 m/s 掀飞）；掠完猛刹车往上拉起；狂怒（25% 以下）时停 0.6 s 再瞄一次、连掠两次；
    ///   收招 0.6 s：拉回盘旋高度。
    /// 撞柱（玩家的应对手段）：身体中线上一根细探针（双爪上方 1.5 m、半径 0.35 m）撞上陡面（冰柱、祭台侧壁、冰崖；冰窟边缘段、1.2 m 的矮墙不算）
    ///   才算撞，擦边不算；硬直 1.8 s（<see cref="BossBrain.Stagger"/>，crash 动作，鲛珠大亮——额外的输出窗口），招式就此打断。
    ///   瞄线时沿线模拟一遍：陡面在玩家之前（玩家把柱子夹在自己和鹏之间）= 引撞，照常俯冲、一头撞上；
    ///   陡面在玩家之后 = 线截到它前面（<see cref="KunPengMath.TrimSwoop"/>），掠过玩家就拉起，不会撞玩家身后的柱子。站在开阔处的玩家要靠侧移 / 冲刺躲。
    /// </summary>
    public sealed class PengSwoop : KunPengMove
    {
        public const string MoveId = "swoop";
        public const float AimMax = 1.8f, TeleSeconds = 0.9f, DiveSpeed = 26f, DiveAlt = 0.6f, DiveMax = 2.6f, HalfWidth = 2.3f, HitRadius = 1.6f, CrashStagger = 1.8f;
        /// <summary>撞柱探针：双爪上方多高、多粗（米）</summary>
        public const float ProbeLift = 1.5f, ProbeRadius = 0.35f;
        /// <summary>预警时悬停的高度、俯冲开始往下压的竖直速度（瞄线时按它模拟起点附近的高度：贴着起点的柱子从柱顶上越过）</summary>
        public const float TeleAlt = 7f, DescentRate = 13.5f;
        /// <summary>线截短：在陡面前多少米拉起、至少过玩家多少米；拉起时的刹车加速度（米/秒²）与上抬速度（米/秒）</summary>
        public const float PullUp = 8f, PastPlayer = 3f, PullBrake = 60f, PullLift = 12f;
        /// <summary>横向偏差拉回预警线的速率（1/秒）与横向速度上限</summary>
        const float LineGain = 4f, LineMaxSide = 14f;

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
        /// <summary>当前这一趟：线上离起点多远有陡面（没有 = +∞）、是不是引撞（陡面在玩家之前）、线有没有为玩家身后的陡面截短</summary>
        public float WallAt { get; private set; } = float.PositiveInfinity;
        public bool Lured { get; private set; }
        public bool Trimmed { get; private set; }

        Sub sub;
        float subT, travel, trailAcc;
        int left;
        bool hit;
        Vector3 prevTalons;
        static readonly RaycastHit[] probeHits = new RaycastHit[16];

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
            var player = Brain.PlayerPosition;
            int side = KunPengMath.SwoopSide(Hole, player, Brain.transform.position, Rng.Sign());
            var (from, yaw, len) = KunPengMath.SwoopLine(Hole, player, side);
            From = AtFloor(from);
            Yaw = yaw;
            var dir = Dir(yaw);
            var rel = player - From;
            float playerAt = rel.x * dir.x + rel.z * dir.z;
            WallAt = WallOnLine(From, dir, len);
            Lured = KunPengMath.SwoopLured(len, playerAt, WallAt);
            Length = KunPengMath.TrimSwoop(len, playerAt, WallAt, Mathf.Max(PullUp, Reach(0.05f) + 4f), PastPlayer);
            Trimmed = Length < len - 0.01f;
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
                    if (kp) kp.HoverAlt = TeleAlt;
                    Hazards.LineWarning(From, Yaw, Length, HalfWidth, TeleSeconds, KunPengDef.Warn);
                    CountWarning();
                    Sfx("telegraph");
                    return;
                }
                case Sub.Tele:
                    // 瞄准超时没飞到起点时，预警期间接着往起点靠（俯冲沿画出来的线走）
                    kp?.FlyTo(From, 22f, 1f);
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
                // 沿预警线：进度按在线上的投影算（起点没飞到也掠到线的终点），横向偏差按 LineGain 拉回线上
                var rel = Brain.transform.position - From;
                rel.y = 0;
                var across = new Vector3(dir.z, 0, -dir.x);
                float off = Vector3.Dot(rel, across);
                kp.FlyVelocityTo(dir * DiveSpeed - across * Mathf.Clamp(off * LineGain, -LineMaxSide, LineMaxSide));
                kp.SetFacing(Yaw);
                travel = Mathf.Max(travel, Vector3.Dot(rel, dir));
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
                kp.Hover();
                if (crashed) kp.Accel = KDef != null ? KDef.pengAccel : 22f;
                else
                {
                    // 拉起：猛刹车、往上一抬（截短的线后面就是柱子，不能贴地滑过去）
                    kp.Accel = PullBrake;
                    var v = kp.FlyVelocity;
                    kp.SetFlyVelocity(new Vector3(v.x, Mathf.Max(v.y, PullLift), v.z));
                }
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

        /// <summary>探针往前伸多远：这一帧飞的距离 + 胸口到双爪的前伸 + 0.5 m</summary>
        float Reach(float dt) => DiveSpeed * dt + Brain.BodyRadius * 0.6f + 0.5f;

        /// <summary>前方中线上（双爪上方 1.5 m 的细探针）这一帧会撞上陡面</summary>
        bool WallAhead(Vector3 dir, float dt) => Steep(Brain.transform.position + Vector3.up * ProbeLift, dir, Reach(dt), out _);

        /// <summary>
        /// 瞄线时沿线模拟一遍俯冲的撞柱判定（每 0.5 m 一步；高度按预警悬停的 7 m 往下压到贴地、过台子时贴着台面），
        /// 返回陡面离起点多远（不会撞 = +∞）
        /// </summary>
        float WallOnLine(Vector3 from, Vector3 dir, float len)
        {
            const float step = 0.5f;
            for (float s = 0; s <= len; s += step)
            {
                var p = from + dir * s;
                p.y = Floor + Mathf.Max(DiveAlt, TeleAlt - DescentRate * s / DiveSpeed);
                if (KP)
                {
                    float g = KP.GroundBelow(p);
                    if (float.IsFinite(g)) p.y = Mathf.Max(p.y, g);
                }
                if (Steep(p + Vector3.up * ProbeLift, dir, step + 0.05f, out float at)) return s + at;
            }
            return float.PositiveInfinity;
        }

        /// <summary>
        /// 细探针撞上陡面：世界层、法线朝上分量 &lt; 0.5（冰柱、祭台侧壁、冰崖），不算冰窟边缘段（气流和狂风都越过它）、首领自己、起点就重叠的东西
        /// </summary>
        bool Steep(Vector3 origin, Vector3 dir, float dist, out float at)
        {
            at = float.PositiveInfinity;
            int n = Physics.SphereCastNonAlloc(origin, ProbeRadius, dir, probeHits, dist, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            var hole = KP ? KP.HoleMarker : null;
            for (int i = 0; i < n; i++)
            {
                var h = probeHits[i];
                if (!h.collider || h.distance <= 0f || h.normal.y >= 0.5f) continue;
                if (h.collider.transform.IsChildOf(Brain.transform)) continue;
                if (hole && hole.IsRim(h.collider)) continue;
                at = Mathf.Min(at, h.distance);
            }
            return float.IsFinite(at);
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
