using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 魔将 · 突刺冲锋（剑士化 v2，设计单 §13.6；替代烈焰冲锋）：剑尖在前的突刺——直线预警（预判玩家 0.3 s、越过玩家 5 m、最长 24 m、截到场地边）→
    /// 24 m/s 突进，沿途每 2.4 m 留一片 5 s 的火（冲锋留火保留）；冲过玩家身边（预警半宽以内）刺中一下并往侧前方掀开。
    /// 刹住之后转身「收刀横斩」：朝玩家一个 5.2 m、半角 70° 的扇形（0.42 / 0.36 / 0.32 s 预警）。撞墙硬直 1 s、不横斩（破绽窗口）。
    /// 二阶段起连刺两次（第二次前摇 0.6 s），狂怒前摇再压。
    /// </summary>
    public sealed class WarlordThrust : WarlordSwordMove
    {
        public const string MoveId = "warlord_thrust";
        public override string Id => MoveId;
        public override string Name => "魔将 · 突刺冲锋";

        enum Leg { Aim, Run, Cut, Crash, Recover }

        public const float HalfWidth = 1.6f, Speed = 24f, MaxLen = 24f, CutRange = 5.2f, CutHalf = 70f;

        Leg leg;
        Vector3 dir, lastPos;
        float length, travelled, trail, legT, tele, cutTele, cutYaw, fxAcc;
        int left;
        bool hitDone;
        Telegraph.LineHandle line;
        FxHandle runTrail;

        /// <summary>留下的火焰地带、刺中、收刀横斩砍中、横斩次数（测试用）</summary>
        public int Trails { get; private set; }
        public int Hits { get; private set; }
        public int CutHits { get; private set; }
        public int Cuts { get; private set; }
        public int Crashes { get; private set; }
        /// <summary>上一次突进跑了多远（米）</summary>
        public float LastRun { get; private set; }
        /// <summary>正在突进（WarlordBrain 据此在剑尖甩火星）</summary>
        public bool Running => leg == Leg.Run && Stage == MoveStage.Active;

        public WarlordThrust()
        {
            cooldown = 7f;
            recovery = 1f;
            windup = 0.85f;
            recover = 0.1f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 8f ? 2.6f : 0.8f;

        protected override void OnStart()
        {
            left = Phase >= 1 || Fury ? 2 : 1;
            tele = (Fury ? 0.62f : Phase >= 1 ? 0.72f : 0.85f) * Brain.WindupScale;
            cutTele = (Fury ? 0.32f : Phase >= 1 ? 0.36f : 0.42f) * Brain.WindupScale;
            Trails = 0;
            Aim(false);
        }

        void Aim(bool again)
        {
            var from = Brain.transform.position;
            var want = Brain.Predict(0.3f) - from;
            want.y = 0;
            float d = want.magnitude;
            dir = d < 0.5f ? Dir(Facing) : want / d;
            float edge = ToEdge(from, dir, 1.5f);
            length = Mathf.Clamp(Mathf.Min(d + 5f, MaxLen), Mathf.Min(8f, edge), Mathf.Max(2f, edge));
            leg = Leg.Aim;
            legT = 0;
            Brain.Halt();
            // 第二次突刺：横斩 / 撞墙的片段可能正在退回待机，交叉淡入
            if (again) ActCrossfade("thrustReady", tele);
            else Act("thrustReady", tele);
            Sfx("telegraph");
            Sfx("enemy_charge", 1f, 0.8f);
        }

        protected override void OnTelegraph() => DrawLine();

        void DrawLine()
        {
            var from = Brain.transform.position;
            from.y = Floor;
            line = WarnLine(from, from + dir * length, HalfWidth * 2f, tele, WarlordSword.Warn);
        }

        protected override bool WindupDone => StageT >= tele;

        protected override void OnWindup(float dt)
        {
            Brain.Face(Brain.transform.position + dir, 340f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, tele)));
        }

        /// <summary>出手段由腿自己结束（EndActive：连刺都刺完）；10 s 兜底防卡死</summary>
        protected override bool ActiveDone => StageT > 10f;

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
            Brain.BeginDash(dir * Speed, 30f);
            Brain.Glow(0, 1);
            Sfx("enemy_charge", 1f, 0.7f);
            runTrail.Cancel();
            var root = Brain.Model?.root ? Brain.Model.root.transform : Brain.transform;
            runTrail = Surge.Trail(root, Vector3.up * 1.6f, 1.1f, 7f, SurgeKind.Fire, 2.2f, WarlordRef.SurgeEdge(Brain), WarlordRef.SurgeCore(Brain));
            if (Lord) Lord.ThrustRun(dir, length / Speed, LordFx != null);
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
                case Leg.Cut:
                    Brain.Halt();
                    TurnToward(cutYaw, 500f, dt);
                    if (legT >= cutTele) Cut();
                    break;
                default:
                    Brain.Halt();
                    if (leg == Leg.Recover) Brain.Face(Brain.PlayerPosition, 200f, dt);
                    Brain.Glow(0, 0);
                    if (legT >= (leg == Leg.Crash ? 1f : 0.35f)) Next();
                    break;
            }
        }

        void Next()
        {
            left--;
            if (left > 0)
            {
                tele = 0.6f * Brain.WindupScale * (Fury ? 0.9f : 1f);
                Aim(true);
                DrawLine();
            }
            else EndActive();
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
                Hazards.Zone(new BossZoneSpec(c, 1.6f, 5f, Dmg(5), WarlordSword.Fire) { arm = 0.25f, embers = true });
                Trails++;
            }
            if (!hitDone) CheckHit(p);
            fxAcc += dt;
            if (fxAcc >= 0.05f && LordFx == null)
            {
                fxAcc = 0;
                Fx.Burst(new Vector3(p.x, Floor + 0.3f, p.z), WarlordRef.Embers, 4, 3f, 0.5f, 0.16f, -4f);
            }
            lastPos = p;
            bool crashed = Brain.DashHitWall && legT > 0.1f;
            bool outOfArena = Brain.Arena && !Brain.Arena.Contains(p, Brain.BodyRadius * 0.5f);
            if (travelled < length && !crashed && !outOfArena && legT <= 1.8f) return;
            Brain.EndDash();
            Brain.Halt();
            legT = 0;
            LastRun = travelled;
            runTrail.Cancel();
            line?.End();
            line = null;
            if (crashed)
            {
                leg = Leg.Crash;
                Crashes++;
                Lord?.ChargeEnd(true, p, dir);
                Brain.Shake(0.55f, 0.4f);
                Sfx("boss_slam", 1f, 1.1f);
                return;
            }
            // 刹住 → 转身收刀横斩：朝玩家画扇形，填满即斩
            leg = Leg.Cut;
            var to = Brain.PlayerPosition - p;
            to.y = 0;
            cutYaw = to.sqrMagnitude > 0.25f ? WarlordSword.Yaw(to) : Facing;
            Hazards.SectorWarning(OnGround(p), cutYaw, CutHalf, CutRange * Reach, cutTele, WarlordSword.Warn);
            Lord?.ThrustStop(p, dir, cutTele);
        }

        void CheckHit(Vector3 p)
        {
            if (!Player(out var feet, out _)) return;
            var off = feet - p;
            float dy = off.y;
            off.y = 0;
            // 判定半径与预警长条半宽一致：玩家中心站在预警外就不会被刺到
            if (off.magnitude >= HalfWidth || dy >= 2.8f) return;
            hitDone = true;
            float side = off.x * dir.z - off.z * dir.x >= 0 ? 1 : -1;
            if (!Strike(Dmg(28), p + Vector3.up, new Vector3(dir.x * 13 + dir.z * 5 * side, 6, dir.z * 13 - dir.x * 5 * side))) return;
            Hits++;
            Brain.Shake(0.55f, 0.35f);
            Sfx("enemy_melee", 1f, 0.6f);
        }

        void Cut()
        {
            Cuts++;
            leg = Leg.Recover;
            legT = 0;
            var p = Brain.transform.position;
            bool hit = false;
            if (Player(out var feet, out float pr) && WarlordSword.InSector(p, cutYaw, CutHalf, CutRange * Reach, feet, pr, 3.2f))
                hit = Strike(Dmg(20), p + Vector3.up, Dir(cutYaw) * 8f + Vector3.up * 3.5f);
            if (hit) CutHits++;
            Sfx("enemy_melee", hit ? 1f : 0.8f, hit ? 1f : 0.8f);
            if (LordFx is { } lord) lord.ThrustCut(cutYaw, hit, CutRange * Reach);
            else Fx.Slash(Brain.BodyCenter, cutYaw, CutRange * 0.8f, CutHalf * 2f * Mathf.Deg2Rad, 1, 0, 0.7f, 0.28f, WarlordSword.Fire, true);
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.EndDash();
            Brain.Glow(0, 0);
            runTrail.Cancel();
            line?.End();
            line = null;
        }
    }
}
