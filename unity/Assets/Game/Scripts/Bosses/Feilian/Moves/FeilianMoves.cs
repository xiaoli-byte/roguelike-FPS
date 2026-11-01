using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>飞廉招式的底座</summary>
    public abstract class FeilianMove : LordMove
    {
        protected FeilianBrain Fei => Brain as FeilianBrain;
        protected FeilianDef FDef => Brain.Def as FeilianDef;
        protected Vector3 OrbPos => LordB.BonePos(FeilianDef.WeakBone);

        protected void Glint(float at)
        {
            if (Cue("glint", at)) Fx.LdOne("Star", OrbPos, Vector3.zero, 1.4f, 0.2f, FeilianPalette.OrbCore);
        }
    }

    /// <summary>
    /// 蓄风狂风（gust，1.0 / 0.6 / 0.8，冷却 4 s）：人立、尾羽扇张开，空中风痕往珠子收；危险扇形 50° / 40 m；0.75 s 珠上白星；前蹄踏地 = 出手（片段 hit）。
    /// 出手：风锥 + 锥内风线；锥里、没躲在冰脊 / 巨石后面的人挨 6 并被顺风猛推 0.6 s（约 9 m/s）
    /// </summary>
    public sealed class FeilianGust : FeilianMove
    {
        public const string MoveId = "gust";
        public override string Id => MoveId;
        public override string Name => "蓄风狂风";
        public const float Range = 40f, HalfAngle = 25f, WebDamage = 6f, PushSeconds = 0.6f;

        float yaw;

        /// <summary>最近一次：吹到人了、被掩体挡了</summary>
        public bool LastHit { get; private set; }
        public bool LastCovered { get; private set; }

        public FeilianGust()
        {
            windup = 1.0f;
            active = 0.6f;
            recover = 0.8f;
            cooldown = 4f;
            recovery = 0.8f;
            weight = 1f;
        }

        protected override void Prepare()
        {
            Brain.Halt();
            yaw = YawToPlayer;
        }

        protected override void Telegraph()
        {
            Hazards.SectorWarning(Brain.transform.position, yaw, HalfAngle, Range, WindupTime, WarnTint);
            CountWarning();
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            TurnToward(YawToPlayer, 143f, dt);
            yaw = Facing;
            Fx.FeilianGather(OrbPos, Dir(yaw), 14f, StageT / Mathf.Max(0.05f, WindupTime), dt);
            Glint(WindupTime - 0.25f);
        }

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            var d = Dir(yaw);
            Fx.FeilianGust(Brain.transform.position + d * 2f, d, Range, Mathf.Tan(HalfAngle * Mathf.Deg2Rad) * Range);
            Brain.Shake(0.25f, 0.3f, 40f);
            LordB?.ImpactHold(0.05f);
            LastHit = LastCovered = false;
            if (!LordBrain.PlayerFeet(out var feet)) return;
            var o = Brain.transform.position;
            if (Flat(feet, o) > Range || Mathf.Abs(Mathf.DeltaAngle(yaw, YawTo(feet))) > HalfAngle + 9f) return;
            if (Fei && Fei.Covered(OrbPos))
            {
                LastCovered = true;
                Fei.Tell("feilian_cover", "躲在掩体后面，狂风吹不到", FeilianPalette.Wind, 6f, 1.2f);
                return;
            }
            LastHit = true;
            HurtPlayer(Dmg(WebDamage), Element.None, o, d * 6f);
            if (Fei)
            {
                Fei.GustLeft = PushSeconds;
                Fei.GustDir = d;
            }
        }

        protected override void OnActive(float dt) => Brain.Halt();
    }

    /// <summary>
    /// 低头冲撞（charge，0.8 / ≤ 1.4 / 1.0，冷却 3 s）：后坐 → 低头（角对准、珠降到 3 m）→ 右前蹄刨冰两下；危险冲撞线 30 m × 3 m；0.55 s 珠上白星；
    /// 后蹄蹬冰 = 冲出（片段 hit）：24 m/s，撞到人 22 + 击退；**撞上冰脊 / 巨石就晕 2 s**（侧倒）；冲完低头喘（珠在 3 m）。
    /// 第三个打的领主：冲撞接风刃（变体）
    /// </summary>
    public class FeilianCharge : FeilianMove
    {
        public const string MoveId = "charge";
        public override string Id => MoveId;
        public override string Name => "低头冲撞";
        public const float Speed = 24f, Length = 30f, Width = 3f, HitRadius = 2.8f, WebDamage = 22f, CrashStun = 2f;

        protected float yaw, turnRate;
        bool dashing, hit;
        FxHandle trail;

        /// <summary>最近一次：冲了多远、撞晕了没、撞到人了没</summary>
        public float Travelled { get; private set; }
        public bool Crashed { get; private set; }
        public bool HitPlayer => hit;

        public FeilianCharge()
        {
            windup = 0.8f;
            active = 1.4f;
            recover = 1.0f;
            cooldown = 3f;
            recovery = 0.8f;
            weight = 1f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 8f ? weight : weight * 0.3f;

        protected override void Prepare()
        {
            Brain.Halt();
            yaw = YawToPlayer;
            Travelled = 0;
            Crashed = hit = false;
            turnRate = 0;
        }

        protected override void Telegraph()
        {
            var o = Brain.transform.position;
            WarnLine(o, o + Dir(yaw) * Length, Width, WindupTime);
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            TurnToward(yaw, 286f, dt);
            Glint(WindupTime - 0.25f);
            if (StageAt(14f / 30f) || StageAt(19f / 30f)) Fx.FeilianPaw(LordB.BonePos("fhoof_R"), -Brain.transform.forward);
        }

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            SetFacing(yaw);
            Brain.BeginDash(Vector3.zero, 0);
            dashing = true;
            Fx.FeilianSnowCrown(Brain.transform.position - Brain.transform.forward * 1.5f, 0.8f);
            trail = Surge.Trail(Brain.transform, Vector3.up * 1.8f, 1.2f, 7f, SurgeKind.Water, active + 0.2f, FeilianPalette.Wind, FeilianPalette.WindCore, 0.55f);
        }

        protected override void OnActive(float dt)
        {
            yaw += turnRate * dt;
            SetFacing(yaw);
            var d = Dir(yaw);
            var p = Brain.transform.position;
            float step = Speed * dt;
            // 撞上冰脊 / 巨石：晕
            var chest = p + Vector3.up * 1.5f;
            if (Physics.SphereCast(chest, 1.1f, d, out var wall, step + 1.6f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && wall.normal.y < 0.6f)
            {
                Crash(IsObstacle(wall.collider));
                return;
            }
            var next = p + d * step;
            if (Brain.Arena && !Brain.Arena.Contains(next, 1.5f))
            {
                EndActive();
                return;
            }
            float gy = LordB.GroundAt(next);
            if (gy < p.y - 4f)
            {
                // 不下冰崖
                EndActive();
                return;
            }
            next.y = gy;
            Brain.transform.position = next;
            Travelled += step;
            if (!hit && LordBrain.PlayerFeet(out var feet) && Flat(feet, next) < HitRadius && feet.y < next.y + 3f)
            {
                hit = true;
                if (HurtPlayer(Dmg(WebDamage), Element.None, next, d * 16f + Vector3.up * 5f) > 0)
                    Fx.FeilianCrash(LordB.BonePos("head"), yaw, false);
            }
        }

        static bool IsObstacle(Collider c)
        {
            if (!c) return false;
            for (var t = c.transform; t; t = t.parent)
                foreach (var pre in FeilianDef.ObstaclePrefixes)
                    if (t.name.StartsWith(pre, System.StringComparison.OrdinalIgnoreCase))
                        return true;
            return !(c is TerrainCollider);
        }

        void Crash(bool stun)
        {
            Crashed = stun;
            EndDash();
            Fx.FeilianCrash(LordB.BonePos("head"), yaw, true);
            Brain.Shake(0.35f, 0.35f, 30f);
            if (!stun)
            {
                EndActive();
                return;
            }
            if (Fei) Fei.Crashes++;
            Fei?.Tell("feilian_crash", "撞上冰脊，撞晕了——打风雷珠！", FeilianPalette.Wind, 6f, 2f);
            Brain.Stagger(CrashStun, "down", 1f);
        }

        void EndDash()
        {
            trail.Cancel();
            if (!dashing) return;
            dashing = false;
            Brain.EndDash();
        }

        protected override bool ActiveDone => StageT >= active;

        protected override void OnRecoverBegin() => EndDash();

        protected override void OnRecover(float dt)
        {
            Brain.Halt();
            if (Brain.Staggered && Fei) Fx.FeilianDizzy(LordB.BonePos("head"), dt);
        }

        protected override void OnEnd(bool cancelled)
        {
            EndDash();
            if (!cancelled && Fei && Fei.Variant && Id == MoveId) Brain.QueueMove(FeilianBlades.MoveId);
        }
    }

    /// <summary>回旋冲撞（wheel，二阶段起，0.8 / ≤ 2.2 / 1.2，冷却 6 s）：同冲撞，冲出去再绕回来一次（2.2 s 转 150°），整身往弧心倾（手 K：往左倾）</summary>
    public sealed class FeilianWheel : FeilianCharge
    {
        public new const string MoveId = "wheel";
        public override string Id => MoveId;
        public override string Name => "回旋冲撞";
        /// <summary>出手段一共转多少（弧度，网页 2.6）；手 K 片段只做了往左倾，所以固定往左绕</summary>
        public const float Sweep = 2.6f;

        public FeilianWheel()
        {
            windup = 0.8f;
            active = 2.2f;
            recover = 1.2f;
            cooldown = 6f;
            minPhase = 1;
        }

        protected override void Telegraph()
        {
            // 弧形冲撞线：按出手段第一秒的弧画三段
            var o = Brain.transform.position;
            float y = yaw, rate = -Sweep / active * Mathf.Rad2Deg;
            for (int i = 0; i < 3; i++)
            {
                var a = o;
                y += rate / 3f * 0.5f;
                var b = a + Dir(y) * Speed / 3f;
                y += rate / 3f * 0.5f;
                WarnLine(a, b, Width, WindupTime);
                o = b;
            }
        }

        protected override void OnActiveBegin()
        {
            base.OnActiveBegin();
            turnRate = -Sweep / active * Mathf.Rad2Deg;
        }
    }

    /// <summary>
    /// 风刃（blades，0.6 / 0.1 / 0.6，冷却 2.5 s）：尾羽往左收到底 → 3 帧甩到右边 = 出手（片段 release）：扇形三道月牙风刃（±15°，20 m/s，各 10）。不画地面预警（弹体自己是读点）
    /// </summary>
    public sealed class FeilianBlades : FeilianMove
    {
        public const string MoveId = "blades";
        public override string Id => MoveId;
        public override string Name => "风刃";
        public const float Speed = 20f, Spread = 15f, WebDamage = 10f, Range = 32f;

        public int Fired { get; private set; }
        public int BladeHits { get; private set; }

        public FeilianBlades()
        {
            windup = 0.6f;
            active = 0.1f;
            recover = 0.6f;
            cooldown = 2.5f;
            recovery = 0.6f;
            weight = 1f;
            stunnable = true;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 10f ? 1.2f : 0.4f;

        protected override void Prepare() => Brain.Halt();

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            TurnToward(YawToPlayer, 143f, dt);
            if (Random.value < dt * 20f) Fx.FeilianGather(LordB.BonePos("tail_6"), null, 2f, 0.5f, dt);
        }

        protected override bool WindupDone => Cue("release", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            var from = LordB.BonePos("chest");
            var target = Brain.PlayerEyePosition - Vector3.up * 0.5f;
            var dir = target - from;
            float y = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            float pitch = Mathf.Atan2(dir.y, new Vector2(dir.x, dir.z).magnitude);
            foreach (float off in new[] { -Spread, 0f, Spread })
            {
                var d = Dir(y + off);
                var v = (d * Mathf.Cos(pitch) + Vector3.up * Mathf.Sin(pitch)).normalized * Speed;
                var push = d * 6f;
                FeilianBlade.Spawn(from + d * 1.2f, v, Range / Speed, 0.9f, Hazards, at =>
                {
                    if (LordBrain.PlayerDashing) return;
                    if (Hazards.Hurt(Dmg(WebDamage), Element.None, at) > 0)
                    {
                        BladeHits++;
                        Hits++;
                        LordBrain.PushPlayer(push);
                    }
                });
                Fired++;
            }
            Fx.FeilianGather(LordB.BonePos("tail_6"), null, 1.5f, 1f, 0.1f);
        }
    }

    /// <summary>侧跃（sidestep，0.1 / 0.6 / 0.2，冷却 4 s）：2 s 内挨打太多就往右侧跳 10 m（手 K 只做了往右跳；右边出擂台时往左）</summary>
    public sealed class FeilianSidestep : FeilianMove
    {
        public const string MoveId = "sidestep";
        public override string Id => MoveId;
        public override string Name => "侧跃";
        public const float Distance = 10f;

        Vector3 from, to;
        bool dashing;

        public FeilianSidestep()
        {
            windup = 0.1f;
            active = 0.6f;
            recover = 0.2f;
            cooldown = 4f;
            recovery = 0.4f;
            weight = 100f;
            stunnable = true;
        }

        public override float Weight(BossBrain b)
        {
            var f = b as FeilianBrain;
            var d = b.Def as FeilianDef;
            return f && d != null && f.RecentDamage > d.sidestepDamage * f.WebScale ? weight : 0f;
        }

        protected override void Prepare()
        {
            Brain.Halt();
            from = Brain.transform.position;
            to = from + Brain.transform.right * Distance;
            if (Brain.Arena && !Brain.Arena.Contains(to, 2f)) to = from - Brain.transform.right * Distance;
            to = OnGround(Brain.ClampToArena(to));
        }

        protected override void OnActiveBegin()
        {
            MarkRelease();
            Brain.BeginDash(Vector3.zero, 0);
            dashing = true;
            Fx.FeilianPaw(from, (from - to).normalized);
            Fx.FeilianGroundWind(from, to - from, 1f);
        }

        protected override void OnActive(float dt)
        {
            float k = Mathf.Clamp01(StageT / active);
            var p = Vector3.Lerp(from, to, k);
            p.y += 1.2f * 4f * k * (1 - k);
            Brain.transform.position = p;
        }

        protected override void OnRecoverBegin()
        {
            Brain.transform.position = to;
            Fx.FeilianSnowCrown(to, 0.7f);
            EndDash();
        }

        void EndDash()
        {
            if (!dashing) return;
            dashing = false;
            Brain.EndDash();
        }

        protected override void OnEnd(bool cancelled)
        {
            EndDash();
            if (Fei) Fei.GustLeft = 0;
        }
    }

    /// <summary>
    /// 龙卷风柱（tornado，二阶段起，1.0 / 0.2 / 0.6，冷却 9 s）：蹲坐 → 人立 70° 仰头长嘶，头顶风涡往下垂出螺旋带；前蹄踏下 = 出手（片段 release）：
    /// 两根（三阶段三根）龙卷落在玩家两侧 12 m（<see cref="FeilianTornado"/>）。场上已有两根时不出
    /// </summary>
    public sealed class FeilianTornadoMove : FeilianMove
    {
        public const string MoveId = "tornado";
        public override string Id => MoveId;
        public override string Name => "龙卷风柱";

        readonly List<Vector3> spots = new();

        public int Spawned { get; private set; }

        public FeilianTornadoMove()
        {
            windup = 1.0f;
            active = 0.2f;
            recover = 0.6f;
            cooldown = 9f;
            recovery = 0.8f;
            weight = 1.2f;
            minPhase = 1;
        }

        public override float Weight(BossBrain b) => b is FeilianBrain f && f.Tornadoes.Count < 2 ? weight : 0f;

        protected override void Prepare()
        {
            Brain.Halt();
            spots.Clear();
            var p = Brain.PlayerPosition;
            float y = YawToPlayer;
            var offs = Brain.Phase >= 2 ? new[] { 0f, 120f, -120f } : new[] { 70f, -70f };
            foreach (float a in offs)
            {
                var s = p + Dir(y + 180f + a) * 12f;
                spots.Add(OnGround(Brain.ClampToArena(s, 2f)));
            }
        }

        protected override void Telegraph()
        {
            foreach (var s in spots) WarnCircle(s, FeilianTornado.Radius, WindupTime);
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            TurnToward(YawToPlayer, 143f, dt);
            if (Random.value < dt * 10f)
                foreach (var s in spots)
                    Fx.FeilianGather(s + Vector3.up * 2f, null, 4f, StageT / WindupTime, dt);
        }

        protected override bool WindupDone => Cue("release", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            if (!Fei) return;
            foreach (var s in spots)
            {
                Fei.SpawnTornado(s);
                Spawned++;
            }
            Brain.Shake(0.2f, 0.3f, 40f);
        }
    }

    /// <summary>
    /// 风雷爆（stormburst，三阶段，4.0 / 0.3 / 1.5，冷却 14 s，霸体）：人立、珠子胀大尖啸、风往里猛吸；危险圈 12 m；3.75 s 珠白星；前蹄砸下 = 出手（片段 hit）：
    /// 风雷冲击环，12 m 内 35 + 雷殛 + 击退。解法：前摇里打满破防条（珠碎打断，BossBrain 的破防打断霸体招），或顶着吸力冲刺出圈
    /// </summary>
    public sealed class FeilianStormBurst : FeilianMove
    {
        public const string MoveId = "stormburst";
        public override string Id => MoveId;
        public override string Name => "风雷爆";
        public const float Radius = 12f, WebDamage = 35f;

        public FeilianStormBurst()
        {
            windup = 4.0f;
            active = 0.3f;
            recover = 1.5f;
            cooldown = 14f;
            recovery = 1f;
            weight = 2f;
            minPhase = 2;
            stunnable = false;
            firstDelay = 3f;
        }

        public override float Weight(BossBrain b) => b is FeilianBrain f && f.OrbIntact ? weight : 0f;

        protected override void Prepare() => Brain.Halt();

        protected override void Telegraph()
        {
            WarnCircle(Brain.transform.position, Radius, WindupTime);
            Fei?.Tell("feilian_storm", "飞廉在蓄风雷爆——打碎风雷珠打断它，或者顶风冲出圈！", FeilianPalette.Orb, 14f, 3f);
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            float k = StageT / Mathf.Max(0.05f, WindupTime);
            if (Fei) Fei.Storm = k;
            Fx.FeilianGather(OrbPos, null, Radius, k, dt);
            Glint(WindupTime - 0.25f);
        }

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            if (Fei) Fei.Storm = 0;
            var o = Brain.transform.position;
            Fx.FeilianStormBurst(OrbPos, o, Radius);
            Brain.Shake(0.6f, 0.45f, 40f);
            LordB?.ImpactHold(0.08f);
            if (!LordBrain.PlayerFeet(out var feet) || Flat(feet, o) > Radius) return;
            var d = feet - o;
            d.y = 0;
            d = d.sqrMagnitude > 1e-4f ? d.normalized : Brain.transform.forward;
            HurtPlayer(Dmg(WebDamage), Element.Shock, o, d * 14f + Vector3.up * 6f);
        }

        protected override void OnEnd(bool cancelled)
        {
            if (Fei) Fei.Storm = 0;
        }
    }
}
