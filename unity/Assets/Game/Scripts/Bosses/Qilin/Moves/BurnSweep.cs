using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 焚身 · 麟火吐息扫象限（TS Qilin 'sweep'）：
    ///   飞到熔池对岸（玩家所在象限中线的反方向、池外 2.2 m；3 m 高、20 m/s，≤ 2.2 s），落地；
    ///   蓄势 1.2 s：扇形预警盖住整个象限（从落点看两条渠在殿墙边的端点之间，外加 4.6°），转向起扫的一侧——从离玩家远的那条渠扫起；
    ///     扇形在起飞那一刻（前摇开始）就画出来，落地时按蓄势时长重新计时，填满那一刻开扫；
    ///   吐息 2.6 s：一道窄火（半角 8.6°）从象限一侧匀速扫到另一侧，每 0.15 s 判一次：在火里、口到玩家胸口不被挡 → 9（火）。
    ///   石柱和池中的倒鼎挡得住——躲到它们后面；或者翻过渠躲到隔壁象限。
    /// 落点、扫的方向由 <see cref="Plan"/> 算（纯计算，EditMode 测试守着）。
    /// </summary>
    public sealed class BurnSweep : QilinMove
    {
        public const string MoveId = "burn_sweep";
        /// <summary>飞向对岸的速度、最长用时、高度；蓄势、扫的时长、收尾（秒）</summary>
        public const float ApproachSpeed = 20f, ApproachMax = 2.2f, ApproachAlt = 3f, Tele = 1.2f, SweepTime = 2.6f, Tail = 0.3f;
        /// <summary>火的半角、判定间隔、每跳伤害（TS 原值，难度 1）、落点离池边多远、预警扇形额外放宽的半角（度）</summary>
        public const float HalfBeam = 8.6f, TickEvery = 0.15f, TickDamage = 9f, SpotOut = 2.2f, WarnPad = 4.6f;

        public override string Id => MoveId;
        public override string Name => "麟火扫象限";

        /// <summary>本次：扫的象限、落点、起扫 / 收扫方位、射程；累计：判定、烧到、被挡</summary>
        public int Quadrant { get; private set; } = -1;
        public Vector3 Spot { get; private set; }
        public float Yaw0 { get; private set; }
        public float Yaw1 { get; private set; }
        public float Range { get; private set; }
        public int Ticks { get; private set; }
        public int Hits { get; private set; }
        public int Blocked { get; private set; }
        /// <summary>本次实际扫过的角度（度）</summary>
        public float Swept { get; private set; }

        float acc, fxAcc, lastYaw, scorchAcc;
        bool arrived, firing;
        BossBeam beam;
        TelegraphHandle warn;

        public BurnSweep()
        {
            cooldown = 10f;
            recovery = 1f;
            weight = 2.2f;
            firstDelay = 6f;
            windup = ApproachMax;
            active = Tele + SweepTime + Tail;
            recover = 0.3f;
            forms = new[] { QilinDef.BurnForm };
        }

        /// <summary>
        /// 吐息的计划（TS beginSweep）：象限 q 的对岸落点（象限中线反方向、熔池外 2.2 m），
        /// 从落点看夹着象限的两条渠在殿墙内 1 m 处的端点——起扫方位取离玩家远的那一端、收扫取近的那一端；射程 = 两端较远的距离 + 2 m
        /// </summary>
        public static void Plan(QilinFurnace f, int q, Vector3 player, out Vector3 spot, out float yaw0, out float yaw1, out float range)
        {
            int n = f.QuadrantCount;
            q = ((q % n) + n) % n;
            spot = f.Point(f.QuadrantYaw(q) + 180f, f.poolRadius + SpotOut);
            var a = f.Point(f.channelYaws[q], f.wallRadius - 1f);
            var b = f.Point(f.channelYaws[(q + 1) % n], f.wallRadius - 1f);
            float ya = YawFrom(spot, a), yb = YawFrom(spot, b), yp = YawFrom(spot, player);
            bool nearA = Mathf.Abs(Mathf.DeltaAngle(yp, ya)) < Mathf.Abs(Mathf.DeltaAngle(yp, yb));
            yaw0 = nearA ? yb : ya;
            yaw1 = nearA ? ya : yb;
            range = Mathf.Max(Flat(a - spot).magnitude, Flat(b - spot).magnitude) + 2f;
        }

        static float YawFrom(Vector3 from, Vector3 to)
        {
            var d = to - from;
            return Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);

        protected override void Prepare()
        {
            arrived = firing = false;
            acc = fxAcc = 0;
            Swept = 0;
            var f = Furnace;
            if (f)
            {
                Quadrant = f.QuadrantOf(Brain.PlayerPosition);
                Plan(f, Quadrant, Brain.PlayerPosition, out var spot, out float y0, out float y1, out float range);
                Spot = Qilin ? Qilin.LandingSpot(spot) : spot;
                Yaw0 = y0;
                Yaw1 = y1;
                Range = range;
            }
            else
            {
                Quadrant = -1;
                Spot = OnFloor(Brain.transform.position);
                Yaw0 = YawToPlayer - 35f;
                Yaw1 = YawToPlayer + 35f;
                Range = 24f;
            }
            if (Qilin) Qilin.SkyTarget = ApproachAlt;
        }

        /// <summary>
        /// 前摇（飞向对岸）一开始就把象限扇形画出来：预警时长 = 估计的飞行时间 + 蓄势；落地开始蓄势时按蓄势时长重新计时（D21 整改：原来落地后才画，前摇里看不到）
        /// </summary>
        protected override void OnTelegraph()
        {
            Brain.PlayAct("Locomotion");
            Sfx("boss_roar", 0.7f, 1.2f);
            var off = Spot - Brain.transform.position;
            off.y = 0;
            // 下限 1 s：估计 + 蓄势 ≥ 飞行上限 2.2 s，飞得再慢也不会在落地前就填满
            float eta = Mathf.Clamp(off.magnitude / ApproachSpeed + 0.25f, ApproachMax - Tele, ApproachMax);
            warn = Hazards.SectorWarning(Spot, WarnMid, WarnHalf, Range, eta + Tele, QilinDef.Warn);
            CountWarning();
        }

        /// <summary>预警扇形：两端方位的中线、半角（两端夹角的一半 + 放宽）</summary>
        float WarnMid => Yaw0 + Mathf.DeltaAngle(Yaw0, Yaw1) * 0.5f;
        float WarnHalf => Mathf.Abs(Mathf.DeltaAngle(Yaw0, Yaw1)) * 0.5f + WarnPad;

        protected override bool WindupDone => arrived || StageT >= ApproachMax;

        protected override void OnWindup(float dt)
        {
            if (Qilin)
            {
                Qilin.SkyTarget = ApproachAlt;
                arrived = Qilin.FlyTo(Spot, ApproachSpeed, 1.2f);
            }
            else arrived = true;
            TurnToward(YawTo(Spot), 230f, dt);
        }

        protected override void OnActiveBegin()
        {
            if (Qilin)
            {
                Qilin.SkyTarget = 0;
                Qilin.Brake(0.3f);
            }
            // 前摇里画的扇形接着走，按蓄势时长重新计时；万一已经没了（被挤出池子）就补画
            if (warn.Pending) warn.Retime(Tele);
            else
            {
                warn = Hazards.SectorWarning(Spot, WarnMid, WarnHalf, Range, Tele, QilinDef.Warn);
                CountWarning();
            }
            Brain.PlayAct("breath", Tele + SweepTime);
            Sfx("enemy_charge", 1f, 0.5f);
            Qilin?.Tell("sweep", "焚身要吐息扫过整个象限——躲到石柱或池中倒鼎的后面！", Hex.Rgb(0xff9a4a));
        }

        protected override void OnActive(float dt)
        {
            if (Qilin)
            {
                Qilin.SkyTarget = 0;
                Qilin.FlyTo(Spot, 8f, 0.4f);
            }
            if (StageT < Tele)
            {
                TurnToward(Yaw0, 229f, dt);
                return;
            }
            if (!firing)
            {
                firing = true;
                lastYaw = Yaw0;
                SetFacing(Yaw0);
                Sfx("skill_fire", 1f, 0.6f);
            }
            float k = Mathf.Clamp01((StageT - Tele) / SweepTime);
            float yaw = Yaw0 + Mathf.DeltaAngle(Yaw0, Yaw1) * k;
            Swept += Mathf.Abs(Mathf.DeltaAngle(lastYaw, yaw));
            lastYaw = yaw;
            SetFacing(yaw);
            if (k < 1f) BreatheAlong(yaw, dt);
            else EndBeam();
        }

        void EndBeam()
        {
            beam?.Release();
            beam = null;
        }

        /// <summary>
        /// 沿 yaw 吐一道窄火：一条火柱（光束，碰到石柱 / 倒鼎就截断、在挡住的地方迸火星——看得出掩体挡住了）+ 沿线的火焰粒子；
        /// 每 0.15 s 判定一次（半角 8.6°、射程、口到玩家胸口不被挡）
        /// </summary>
        void BreatheAlong(float yawDeg, float dt)
        {
            var mouth = Qilin ? Qilin.MouthPoint : Brain.BodyCenter + Brain.transform.forward * 2f;
            var d = Dir(yawDeg);
            // 火柱：从口往前斜着落到离地 0.9 m，碰到东西截断
            var end = mouth + d * Range;
            end.y = Floor + 0.9f;
            var seg = end - mouth;
            float len = seg.magnitude;
            bool blockedFx = false;
            if (len > 0.1f && Physics.Raycast(mouth, seg / len, out var wall, len, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                end = wall.point;
                len = wall.distance;
                blockedFx = true;
            }
            beam ??= Hazards.Beam(QilinDef.Fire);
            beam.Set(mouth, end, 0.55f);
            // 吐息火柱：外层一道更宽的暗橙光、一股往前喷的火舌团，落点一路烧出余烬地火
            Fx.Beam(mouth, end, new Color(1f, 0.42f, 0.08f), 1.6f, 0.08f);
            Fx.FireStream(mouth, end, 1.3f, dt, QilinDef.Fire);
            scorchAcc += dt;
            if (scorchAcc >= 0.18f)
            {
                scorchAcc = 0;
                FxDecals.Fire(new Vector3(end.x, Floor + 0.02f, end.z), 1.1f, 2.4f, FireBed.Ember);
                if (Random.value < 0.4f) FlameTongues.Ground(new Vector3(end.x, Floor, end.z), 0.6f, 2, 1.2f, 0.6f);
            }
            fxAcc += dt;
            if (fxAcc >= 0.05f)
            {
                fxAcc = 0;
                const int n = 7;
                for (int i = 1; i <= n; i++)
                {
                    float u = i / (float)n;
                    var p = Vector3.Lerp(mouth, end, u);
                    Fx.Burst(p, i <= 2 ? QilinDef.Hot : QilinDef.Fire, 3, 2.2f + u * 2f, 0.35f, 0.45f + 0.5f * u, 1.2f);
                }
                if (blockedFx) Fx.Burst(end, QilinDef.Hot, 8, 6f, 0.4f, 0.3f, 4f);
            }
            acc += dt;
            if (acc < TickEvery) return;
            acc = 0;
            Ticks++;
            if (!PlayerFeet(out var feet)) return;
            var m = OnFloor(mouth);
            var off = feet - m;
            off.y = 0;
            if (off.magnitude > Range || Mathf.Abs(Mathf.DeltaAngle(yawDeg, Mathf.Atan2(off.x, off.z) * Mathf.Rad2Deg)) > HalfBeam) return;
            var chest = feet + Vector3.up * 1.2f;
            if (!Combat.LineClear(mouth, chest))
            {
                Blocked++;
                return;
            }
            if (Hazards.Hurt(Dmg(TickDamage), Element.Fire, mouth) > 0) Hits++;
        }

        protected override void OnEnd(bool cancelled)
        {
            EndBeam();
            if (Qilin) Qilin.SkyTarget = QilinBrain.SkyAlt;
        }
    }
}
