using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 玄鳞 · 踏火奔驰 + 横穿冲撞（TS Qilin 'gallop'）：
    ///   前摇 0.35 s 长啸 → 上跑道（≤ 2.5 s，15 m/s 斜着切上外环跑道）→ 沿外环跑道狂奔 3.2–4.6 s（18 m/s，朝玩家那一侧绕；
    ///   左右蹄交替落下燃烧的蹄印：4 s、半径 0.95 m、贴地踩到每 0.4 s 烧 7；撞到跑道上的人 24 + 掀开，1 s 一次）；
    ///   玩家落在前方 28–75° 时（或跑够了）停步转身、刨蹄：地上亮出一条 4 m 宽的冲撞线（1 s），过玩家（预判 0.35 s）一直冲到对面跑道（10 m ≤ 线长 ≤ 跑道直径）；
    ///   30 m/s 冲过去（≤ 2.4 s），胸—臀线段扫到玩家撞一下 34 + 侧向掀飞（每次冲撞一下）；冲撞也落蹄印。
    ///   撞上石柱 / 墙：晕 1.6 s（一个小输出窗口，火珠大亮）；没撞上：收步 0.5 s。
    /// 位移全程走脚本位移（BeginDash：跨过齐地的熔岩渠、撞墙就停），收招交还导航。
    /// </summary>
    public sealed class ScaleGallop : QilinMove
    {
        public const string MoveId = "gallop";

        public enum Leg { ToTrack, Run, Aim, Charge, Crash, Recover, Done }

        public override string Id => MoveId;
        public override string Name => "踏火奔驰";

        public Leg Phase { get; private set; }
        /// <summary>本次：落下的蹄印、撞到的次数、冲撞线长度；累计：冲撞次数、撞柱次数</summary>
        public int Prints { get; private set; }
        public int Tramples { get; private set; }
        public int ChargeHits { get; private set; }
        public float ChargeLength { get; private set; }
        public int Charges { get; private set; }
        public int Crashes { get; private set; }

        float legT, runFor, printAcc, trampleAt = -10, travel, chargeYaw;
        int dirSign = 1, printSide;
        bool hitDone;
        Vector3 chargeDir, lastPos;
        Telegraph.LineHandle line;

        public ScaleGallop()
        {
            cooldown = 9f;
            recovery = 1f;
            weight = 2.6f;
            firstDelay = 0.5f;
            windup = 0.35f;
            active = 14f;
            recover = 0.1f;
            forms = new[] { QilinDef.XuanForm };
        }

        float TrackR => Furnace ? Furnace.trackRadius : 18f;

        protected override void Prepare()
        {
            Brain.Halt();
            var f = Furnace;
            float me = f ? f.YawOf(Brain.transform.position) : Facing;
            float pa = f ? f.YawOf(Brain.PlayerPosition) : YawToPlayer;
            dirSign = Mathf.DeltaAngle(me, pa) >= 0 ? 1 : -1;
            runFor = Rng.Range(3.2f, 4.6f);
            printAcc = 0;
            Prints = Tramples = ChargeHits = 0;
            ChargeLength = 0;
            Phase = Leg.ToTrack;
        }

        protected override void OnTelegraph()
        {
            Brain.PlayAct("roar", WindupTime + 0.6f);
            Sfx("boss_roar", 0.7f, 1.1f);
            Qilin?.Tell("gallop", "火麒麟沿外环跑道狂奔——别站在跑道上，蹄印上的火会烧人");
        }

        protected override void OnActiveBegin()
        {
            Phase = Leg.ToTrack;
            legT = 0;
            lastPos = Brain.transform.position;
            Brain.BeginDash(Vector3.zero, 30f);
            Brain.PlayAct("Locomotion");
        }

        protected override bool ActiveDone => Phase == Leg.Done;

        protected override void OnActive(float dt)
        {
            legT += dt;
            var f = Furnace;
            var p = Brain.transform.position;
            float R = TrackR;
            switch (Phase)
            {
                case Leg.ToTrack:
                {
                    float th = (f ? f.YawOf(p) : Facing) + dirSign * 14.3f;
                    Steer(f ? f.Point(th, R) : p + Dir(Facing) * 10f, QDef?.toTrackSpeed ?? 15f, dt);
                    float r = f ? f.RadiusOf(p) : R;
                    if (Mathf.Abs(r - R) < 1.2f || legT > 2.5f) Next(Leg.Run);
                    break;
                }
                case Leg.Run:
                {
                    float th = (f ? f.YawOf(p) : Facing) + dirSign * 17.2f;
                    Steer(f ? f.Point(th, R) : p + Dir(Facing) * 10f, QDef?.gallopSpeed ?? 18f, dt);
                    DropPrints(dt, 0.13f);
                    Trample();
                    float ahead = f ? Mathf.DeltaAngle(f.YawOf(p), f.YawOf(Brain.PlayerPosition)) * dirSign : 0;
                    if (legT >= runFor || (legT > 2f && ahead > 28.6f && ahead < 74.5f)) BeginAim();
                    break;
                }
                case Leg.Aim:
                    Brain.SetDashVelocity(new Vector3(0, Brain.DashVelocity.y, 0));
                    TurnToward(chargeYaw, 400f, dt);
                    if (legT >= 1f)
                    {
                        Next(Leg.Charge);
                        travel = 0;
                        hitDone = false;
                        lastPos = p;
                        Charges++;
                        // 重新起一段脚本位移：清掉奔驰时的撞墙标记，冲撞只认这一程撞没撞上
                        float speed0 = QDef?.chargeSpeed ?? 30f;
                        Brain.BeginDash(chargeDir * speed0, 30f);
                        Brain.PlayAct("Locomotion");
                        Sfx("boss_roar", 0.9f, 1.3f);
                    }
                    break;
                case Leg.Charge:
                {
                    float speed = QDef?.chargeSpeed ?? 30f;
                    Brain.SetDashVelocity(new Vector3(chargeDir.x * speed, Brain.DashVelocity.y, chargeDir.z * speed));
                    SetFacing(chargeYaw);
                    var step = p - lastPos;
                    step.y = 0;
                    travel += step.magnitude;
                    lastPos = p;
                    DropPrints(dt, 0.1f);
                    if (!hitDone) ChargeHit();
                    bool crashed = Brain.DashHitWall && legT > 0.15f;
                    bool outside = Brain.Arena && !Brain.Arena.Contains(p, Brain.BodyRadius * 0.5f);
                    if (travel < ChargeLength && !crashed && !outside && legT <= 2.4f) break;
                    Brain.SetDashVelocity(Vector3.zero);
                    Brain.EndDash();
                    if (crashed)
                    {
                        Next(Leg.Crash);
                        Crashes++;
                        Brain.PlayAct("stun", 1.6f);
                        var h = Qilin ? Qilin.HeadPoint : Brain.BodyCenter;
                        Fx.Burst(h, Hex.Rgb(0x4a4040), 30, 8f, 1f, 0.4f, 14f);
                        Brain.Shake(0.6f, 0.4f);
                        Sfx("boss_slam", 1f, 0.9f);
                        Qilin?.Tell("crash", "火麒麟一头撞上石柱，晕了——快打角根的火珠！", Hex.Rgb(0xffe08a));
                    }
                    else Next(Leg.Recover);
                    break;
                }
                case Leg.Crash:
                case Leg.Recover:
                    Brain.Halt();
                    Brain.Face(Brain.PlayerPosition, 115f, dt);
                    if (legT >= (Phase == Leg.Crash ? 1.6f : 0.5f)) Next(Leg.Done);
                    break;
            }
        }

        void Next(Leg l)
        {
            Phase = l;
            legT = 0;
        }

        /// <summary>朝 target 以 speed 推进（脚本位移，保留竖直速度），朝向跟着速度转</summary>
        void Steer(Vector3 target, float speed, float dt)
        {
            var d = target - Brain.transform.position;
            d.y = 0;
            if (d.sqrMagnitude < 0.01f) return;
            var v = d.normalized * speed;
            Brain.SetDashVelocity(new Vector3(v.x, Brain.DashVelocity.y, v.z));
            TurnToward(Mathf.Atan2(v.x, v.z) * Mathf.Rad2Deg, 360f, dt);
        }

        /// <summary>横穿冲撞：从当前位置过玩家（预判 0.35 s）一直冲到对面跑道（直线与跑道圆的远交点，10 m ≤ 长 ≤ 跑道直径）</summary>
        void BeginAim()
        {
            var f = Furnace;
            var p = Brain.transform.position;
            var aim = Brain.Predict(0.35f) - p;
            aim.y = 0;
            chargeDir = aim.sqrMagnitude > 0.25f ? aim.normalized : Dir(Facing);
            chargeYaw = Mathf.Atan2(chargeDir.x, chargeDir.z) * Mathf.Rad2Deg;
            float R = TrackR, len = 20f;
            if (f)
            {
                var o = p - f.Center;
                o.y = 0;
                float b = Vector3.Dot(o, chargeDir), c = o.sqrMagnitude - R * R, disc = b * b - c;
                len = disc > 0 ? -b + Mathf.Sqrt(disc) : 20f;
            }
            ChargeLength = Mathf.Clamp(len, 10f, 2f * R);
            if (Brain.Arena) ChargeLength = Mathf.Min(ChargeLength, Mathf.Max(6f, Brain.Arena.DistanceToEdge(p, chargeDir, 1f)));
            Next(Leg.Aim);
            Brain.SetDashVelocity(Vector3.zero);
            var from = OnFloor(p);
            line = WarnLine(from, from + chargeDir * ChargeLength, 4f, 1f);
            Brain.PlayAct("paw", 1f);
            Sfx("telegraph");
            Qilin?.Tell("charge", "地上亮线——火麒麟要横穿象限冲撞，侧移躲开！");
        }

        /// <summary>左右蹄交替落下燃烧的蹄印</summary>
        void DropPrints(float dt, float every)
        {
            printAcc += dt;
            if (printAcc < every || !Qilin) return;
            printAcc = 0;
            var at = Qilin.HoofPoint(printSide++);
            Qilin.DropPrint(at);
            Prints++;
            if (printSide % 2 == 1) Fx.Burst(at + Vector3.up * 0.2f, QilinDef.Ember, 4, 3f, 0.4f, 0.15f, 6f);
        }

        /// <summary>奔驰时撞到跑道上的玩家：24 + 往外掀开，1 s 一次</summary>
        void Trample()
        {
            if (Time.time - trampleAt < 1f || !PlayerFeet(out var feet)) return;
            var c = Brain.BodyCenter;
            var off = feet - c;
            off.y = 0;
            if (off.magnitude > Brain.BodyRadius + 1f || feet.y - Floor > 3f) return;
            trampleAt = Time.time;
            if (Hazards.Hurt(Dmg(24), Element.None, Brain.transform.position + Vector3.up) <= 0) return;
            Tramples++;
            var o = off.sqrMagnitude > 1e-4f ? off.normalized : Brain.transform.right;
            Push(new Vector3(o.x * 11f, 6f, o.z * 11f));
            Brain.Shake(0.4f, 0.3f);
            Sfx("enemy_melee", 1f, 0.7f);
        }

        /// <summary>冲撞判定：胸—臀线段（离地 1.2 m）扫到玩家胶囊（半径 1.6）就撞一下，往冲撞方向的侧前方掀飞</summary>
        void ChargeHit()
        {
            if (!Qilin) return;
            var a = Qilin.ChestPoint;
            var b = Qilin.HipsPoint;
            a.y = b.y = Floor + 1.2f;
            if (!Hazards.SegmentHitsPlayer(a, b, QDef?.chargeRadius ?? 1.6f)) return;
            hitDone = true;
            if (Hazards.Hurt(Dmg(34), Element.None, Brain.transform.position + Vector3.up) <= 0) return;
            ChargeHits++;
            PlayerFeet(out var feet);
            var off = feet - Brain.transform.position;
            float side = off.x * chargeDir.z - off.z * chargeDir.x >= 0 ? 1f : -1f;
            float yaw = chargeYaw + side * 68.8f;
            var d = Dir(yaw);
            Push(new Vector3(d.x * 13f, 7f, d.z * 13f));
            Brain.Shake(0.55f, 0.35f);
            Sfx("enemy_melee", 1f, 0.6f);
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.EndDash();
            line?.End();
            line = null;
            Phase = Leg.Done;
        }
    }
}
