using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃 · 日轮扫射（一阶段「烈日」，unity-maps-v1 第 3 节：日轮聚焦成光束，沿地面扫过，躲进影子）。
    ///   前摇（1.4 s ÷ 阶段节奏）：右手高举召日（ART2 sunSweep，beamStart 事件落在前摇结束），日轮炽度拉满、转快；
    ///     地面亮一条起始长条（光束第一下落点）+ 一片扫射扇区，日轮到起始落点拉一根细瞄准线。
    ///   出手：日轮心射出光束，落点在「出招时玩家的距离」（7–26 m）那一圈上，从玩家一侧 55° 扫到另一侧 55°（48°/s × 节奏），首领跟着转身。
    ///     光束从轮心朝落点打射线，中途被岩岛、月牙阁、沙丘、巨砾挡住就停在那里——挡板后面就是影子。
    ///     判定：每帧把本帧扫过的角度按落点每 0.5 m 一段细分，任一段光束（带 0.85 m 半径的线段）碰到玩家胶囊就灼伤一下（每 0.45 s 至多一次），
    ///     额外叠 1 层日晒；低帧率一帧扫过几米也不会跳过玩家。
    ///   收招 1 s：泉珠露出（施法后摇，<see cref="HanbaBrain"/> 开弱点）。
    /// 动作与特效（docs/art/vfx/hanba.md「日轮扫射」）：片段 121 帧——起手右手往下后方一收、下蹲 → 高举召日、上浮（过冲）→ 蓄力顶点 →
    ///   2 帧劈向光束落点（beamStart = 释放帧，片段 36 帧）→ 持续段整个人跟着光束转、手一直指着落点 → 过冲 → 收。
    ///   前摇：日轮八根辐条往轮毂聚光（<see cref="Fx.HanbaRingGather"/>），光束第一下落点一圈收紧的灼点印正好在释放帧收完（<see cref="Fx.HanbaFocusSeal"/>）；
    ///   释放帧：顿帧 0.07 s + 轮毂 / 落点爆闪（<see cref="Fx.HanbaSunStrike"/>）+ 震屏；持续段：落点的白金热芯、顺着扫的方向甩出金丝和沙线（<see cref="Fx.HanbaBeamEdge"/>）；
    ///   收招：光束 0.18 s 收细熄灭、沿光束往上飘一串金点（<see cref="Fx.HanbaBeamFade"/>）。
    /// 躲法：躲进影子（光束照不到挡板后面）、径向拉开到光束够不到的距离、冲刺穿过光束。
    /// </summary>
    public sealed class Phase1SunSweep : HanbaMove
    {
        public const string MoveId = "sun_sweep";
        /// <summary>扫射总角度、角速度（度 / 秒，× 节奏）、落点距离范围、判定半径、外观半宽、判定间隔、细分步长</summary>
        public const float Arc = 110f, Speed = 48f, MinRange = 7f, MaxRange = 26f, HitRadius = 0.85f, VisualRadius = 0.45f, HitEvery = 0.45f, SubStep = 0.5f;
        /// <summary>每次灼伤的伤害倍率、额外日晒秒数</summary>
        public const float DamageMult = 0.85f, BurnSeconds = 0.5f;
        static readonly Color BeamColor = Hex.Rgb(0xfff0b8), AimColor = Hex.Rgb(0xffc060);
        /// <summary>片段 sunSweep 121 帧，beamStart / hit 在 36 帧（hanba_anims.py）：整段按「出手事件落在前摇结束」拉伸</summary>
        public const float ClipHit = 36f / 121f;
        /// <summary>光束收招时收细熄灭的时长（秒）</summary>
        const float FadeSeconds = 0.18f;

        public override string Id => MoveId;
        public override string Name => "日轮扫射";

        /// <summary>本次：落点距离、起始角、扫过的角度、打中次数；累计打中</summary>
        public float Range { get; private set; }
        public float StartYaw { get; private set; }
        public float Swept { get; private set; }
        public int Hits { get; private set; }
        public int TotalHits { get; private set; }
        /// <summary>本次有几段光束被挡住（落在挡板上，后面是影子）</summary>
        public int Blocked { get; private set; }

        float yaw, sign, speed, wind, nextHit, soundAcc, sprayAcc;
        Vector3 lastScorch = new(float.NaN, 0, 0), lastEnd;
        static readonly Color Gold = new(1f, 0.74f, 0.28f);
        BossBeam aim, beam;

        public Phase1SunSweep()
        {
            cooldown = 9f;
            recovery = 1f;
            weight = 2.4f;
            windup = 1.4f;
            active = Arc / Speed;
            recover = 1f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 6f ? weight : weight * 0.4f;

        /// <summary>出手 = 扫满 110° 的时长（角速度 × 节奏）</summary>
        public override HanbaMovePlan Plan(float pace) => new(Mathf.Max(0.25f, windup / Mathf.Max(0.5f, pace)), Arc / (Speed * Mathf.Max(0.5f, pace)), recover);

        protected override void Prepare()
        {
            Range = Mathf.Clamp(Brain.DistanceToPlayer, MinRange, MaxRange);
            sign = Rng.Value < 0.5f ? -1f : 1f;
            StartYaw = YawToPlayer - sign * Arc * 0.5f;
            yaw = StartYaw;
            Swept = 0;
            Hits = 0;
            Blocked = 0;
            nextHit = 0;
            speed = Speed * PaceNow;
            wind = Windup(windup);
            Brain.Halt();
            if (Ring) Ring.SetBlaze(1f, 3f);
            aim = Hazards.Beam(AimColor);
        }

        protected override void OnTelegraph()
        {
            var o = OnGround(Brain.transform.position);
            WarnLine(o, o + Dir(StartYaw) * Range, 2.2f, wind);
            Hazards.SectorWarning(o, StartYaw + sign * Arc * 0.5f, Arc * 0.5f, Range + 2f, wind, HanbaDef.Warn);
            CountWarning();
            // 灼点印：光束第一下落点一圈收紧的刻符环，倒计时和预警同一刻收完
            Fx.HanbaFocusSeal(EndPoint(StartYaw, out _), 1.6f, wind);
            // 片段 121 帧，beamStart / hit 在 36 帧：整段拉伸到 wind ÷ ClipHit，出手事件正好落在前摇结束
            ActAt("sunSweep", ClipHit, wind);
            Sfx("telegraph", 1f, 0.9f);
            Sfx("enemy_charge", 0.9f, 0.6f);
        }

        protected override bool WindupDone => Cue("beamStart", wind);

        protected override void OnWindup(float dt)
        {
            TurnToward(StartYaw, 150f, dt);
            float u = Mathf.Clamp01(StageT / Mathf.Max(0.01f, wind));
            Brain.Glow(0, u);
            if (aim != null && Ring) aim.Set(Ring.Center, EndPoint(StartYaw, out _), 0.03f + 0.05f * u);
            // 日轮聚光：光点沿八根辐条收进轮毂，越到顶点越密越亮
            RingFrame(out var hub, out var right, out var up, out float radius);
            Fx.HanbaRingGather(hub, right, up, radius, u * u, dt);
        }

        protected override void OnActiveBegin()
        {
            Hazards.ReleaseBeam(aim);
            aim = null;
            beam = Hazards.Beam(BeamColor);
            if (Ring) Ring.Flash(1f);
            // 释放帧：轮毂 / 落点爆闪 + 顿帧 + 震屏 + 音效，同一帧（这一帧就是动画的 beamStart）
            RingFrame(out var hub, out _, out _, out float radius);
            var first = EndPoint(yaw, out _);
            Fx.SunFlare(hub, 2.4f);
            Fx.HanbaSunStrike(hub, first, radius);
            lastScorch = new Vector3(float.NaN, 0, 0);
            lastEnd = first;
            Sfx("shot_beam", 1f, 0.5f);
            Sfx("explosion", 0.35f, 1.5f);
            Impact(0.07f, 0.35f, 0.35f, cue: "beamStart");
        }

        protected override void OnActive(float dt)
        {
            float prev = yaw;
            float step = speed * dt;
            if (Swept + step > Arc) step = Mathf.Max(0, Arc - Swept);
            yaw += sign * step;
            Swept += step;
            SetFacing(yaw);
            Brain.Glow(0, 1);
            var c = Ring ? Ring.Center : Brain.BodyCenter + Vector3.up * 2f;
            // 本帧扫过的角度按落点弧长每 0.5 m 一段细分，逐段判定
            int n = Mathf.Max(1, Mathf.CeilToInt(Mathf.Abs(yaw - prev) * Mathf.Deg2Rad * Range / SubStep));
            Vector3 end = c;
            for (int i = 1; i <= n; i++)
            {
                float a = Mathf.Lerp(prev, yaw, i / (float)n);
                end = EndPoint(a, out bool blocked);
                if (i == n && blocked) Blocked++;
                if (Time.time < nextHit || !Hazards.SegmentHitsPlayer(c, end, HitRadius)) continue;
                nextHit = Time.time + HitEvery;
                if (Hazards.Hurt(Damage(DamageMult), Element.Fire, c) > 0)
                {
                    Hits++;
                    TotalHits++;
                }
                Exposure?.Burn(BurnSeconds, c);
            }
            beam?.Set(c, end, VisualRadius);
            // 犁地的前沿：落点热芯 + 顺着扫的方向甩金丝和沙线（看得出往哪边扫、扫多快）
            Fx.HanbaBeamEdge(end, end - lastEnd, dt);
            lastEnd = end;
            // 外层一道粗的金色光晕（纯外观，比判定宽）+ 落点一路烧出断续的日火裂痕、隔一段窜一簇火苗，沙被光束犁起来往两边喷
            Fx.Beam(c, end, Gold, 1.5f, 0.08f);
            if (float.IsNaN(lastScorch.x) || (end - lastScorch).sqrMagnitude > 0.7f * 0.7f)
            {
                bool flame = float.IsNaN(lastScorch.x) || Random.value < 0.35f;
                lastScorch = end;
                FxDecals.Fire(end + Vector3.up * 0.02f, 0.85f, 2.6f, FireBed.Sunfire);
                if (flame) FlameTongues.Ground(end, 0.4f, 2, 1.1f, 0.55f);
            }
            sprayAcc += dt;
            if (sprayAcc >= 0.18f)
            {
                sprayAcc = 0;
                Fx.SandBlast(end + Vector3.up * 0.1f, 0.5f);
            }
            soundAcc += dt;
            if (soundAcc >= 0.35f)
            {
                soundAcc = 0;
                Sfx("shot_beam", 0.45f, 0.55f);
            }
        }

        protected override bool ActiveDone => Swept >= Arc - 1e-3f;

        protected override void OnRecoverBegin()
        {
            // 光束不一下子消失：收招开头 0.18 s 里收细（判定已经停了），之后才放掉
            var c = Ring ? Ring.Center : Brain.BodyCenter + Vector3.up * 2f;
            Fx.HanbaBeamFade(c, lastEnd);
            if (Ring) Ring.Idle();
            Brain.Glow(0, 0);
        }

        protected override void OnRecover(float dt)
        {
            if (beam == null) return;
            if (StageT >= FadeSeconds)
            {
                Hazards.ReleaseBeam(beam);
                beam = null;
                return;
            }
            var c = Ring ? Ring.Center : Brain.BodyCenter + Vector3.up * 2f;
            float k = 1f - StageT / FadeSeconds;
            beam.Set(c, lastEnd, VisualRadius * k * k);
        }

        /// <summary>fx:raise（手举到顶那一下）：日轮先亮一下，像被手点着</summary>
        protected override void OnFxCue(string cue)
        {
            if (cue == "raise" && Ring) Ring.Flash(0.45f);
        }

        /// <summary>
        /// 角度 a 处的光束终点：落点 = 首领脚下沿 a 方向 <see cref="Range"/> 米处的地面；从轮心朝落点打射线，中途打到世界几何就停在那里（blocked = true）
        /// </summary>
        public Vector3 EndPoint(float a, out bool blocked)
        {
            blocked = false;
            var c = Ring ? Ring.Center : Brain.BodyCenter + Vector3.up * 2f;
            var g = OnGround(Brain.transform.position + Dir(a) * Range);
            var d = g - c;
            float len = d.magnitude;
            if (len < 0.1f) return g;
            if (Physics.Raycast(c, d / len, out var hit, len - 0.05f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                blocked = true;
                return hit.point;
            }
            return g;
        }

        protected override void OnEnd(bool cancelled)
        {
            Hazards.ReleaseBeam(aim);
            Hazards.ReleaseBeam(beam);
            aim = beam = null;
            base.OnEnd(cancelled);
        }
    }
}
