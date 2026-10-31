using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 玄鳞 · 踏火奔驰 + 横穿冲撞（TS Qilin 'gallop'）：
    ///   前摇 0.35 s 长啸 → 上跑道（≤ 2.5 s，15 m/s 斜着切上外环跑道）→ 沿外环跑道狂奔 3.2–4.6 s（18 m/s，朝玩家那一侧绕；
    ///   左右蹄交替落下燃烧的蹄印：4 s、半径 0.95 m、贴地踩到每 0.4 s 烧 7；撞到跑道上的人 24 + 掀开，1 s 一次）；
    ///   玩家落在前方 28–75° 时（或跑够了）停步转身、刨蹄：地上亮出一条 4 m 宽的冲撞线（1 s），过玩家（预判 0.35 s）一直冲到对面跑道（10 m ≤ 线长 ≤ 跑道直径）；
    ///   30 m/s 冲过去（≤ 2.4 s），胸—臀线段扫到玩家撞一下 34 + 侧向掀飞（每次冲撞一下）；冲撞也落蹄印。
    ///   撞上石柱（殿里的东西）：晕 1.6 s（一个小输出窗口，火珠大亮）；没撞上、或头冲到殿墙跟前：收步 0.5 s。
    /// 位移全程走脚本位移（BeginDash：跨过齐地的熔岩渠、撞墙就停），收招交还导航。
    /// 撞墙判定从头的前沿往前扫（<see cref="WallAhead"/>）：麒麟身子长，只从角色胶囊中心探的话头会先扎进柱子 / 墙里；奔驰中碰到石柱顺着柱面滑过去。
    /// 吊着 / 斜挂的巨鼎没有碰撞体，冲撞线穿过它时在头碰上鼎之前刹住（<see cref="ClearOfCauldron"/>），预警线也画到那里为止。
    /// Q 路（2026-10-31，docs/art/vfx/qilin.md「踏火奔驰 · 冲撞」）：刨蹄是手 K 片段 paw（重心后坐、低头亮角、右前蹄刨两下、臀部下蹲蓄力），
    /// 每一刨由动画事件 fx:qPaw 甩出暗金火星和玄武岩尘；冲出去那一帧后蹄蹬出尘环（<see cref="Fx.QilinChargeLaunch"/>），冲撞全程身后拖一道火尾；
    /// 撞柱是玄铁鳞屑 + 金色眩晕星（<see cref="Fx.QilinCrash"/>）。
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
                        Brain.PlayAct("Locomotion", 0, 0.05f);
                        Sfx("boss_roar", 0.9f, 1.3f);
                        // 后蹄一蹬：尘环 + 身后两团尘云；冲撞全程身后拖一道火尾（踏火）
                        Fx.QilinChargeLaunch(OnFloor(p), chargeDir);
                        var body = Brain.Model?.root ? Brain.Model.root.transform : Brain.transform;
                        Surge.Trail(body, Vector3.up * 2.4f, 0.9f, 7f, SurgeKind.Fire, Mathf.Min(2.4f, ChargeLength / Mathf.Max(1f, speed0)) + 0.1f, null, null, 0.75f);
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
                    // 脚本位移只从角色胶囊中心往前探 0.4 m：长身子要等头扎进柱子 3 m 才算撞上，所以这里从头的前沿再探一步。
                    // 殿里的东西（石柱、坠池的鼎）撞上就晕；殿墙一圈只是冲到头了（收步，不晕，头也不扎进墙里）
                    bool ahead = WallAhead(chargeDir, speed * dt + 0.2f, out _, out bool obstacle);
                    bool crashed = (Brain.DashHitWall || (ahead && obstacle)) && legT > 0.1f;
                    bool atWall = ahead && !obstacle;
                    bool outside = Brain.Arena && !Brain.Arena.Contains(p, Brain.BodyRadius * 0.5f);
                    if (travel < ChargeLength && !crashed && !atWall && !outside && legT <= 2.4f) break;
                    Brain.SetDashVelocity(Vector3.zero);
                    Brain.EndDash();
                    if (crashed)
                    {
                        Next(Leg.Crash);
                        Crashes++;
                        Brain.PlayAct("stun", 1.6f);
                        var h = Qilin ? Qilin.HeadPoint : Brain.BodyCenter;
                        Fx.QilinCrash(h);
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

        /// <summary>朝 target 以 speed 推进（脚本位移，保留竖直速度），朝向跟着速度转；头前面是石柱就顺着它的表面滑过去（不一头扎进去）</summary>
        void Steer(Vector3 target, float speed, float dt)
        {
            var d = target - Brain.transform.position;
            d.y = 0;
            if (d.sqrMagnitude < 0.01f) return;
            var v = d.normalized * speed;
            if (WallAhead(v / speed, speed * 0.12f, out var wall, out bool obstacle) && obstacle)
            {
                var n = new Vector3(wall.x, 0, wall.z);
                if (n.sqrMagnitude > 1e-4f)
                {
                    n.Normalize();
                    var slide = v - Vector3.Dot(v, n) * n;
                    if (slide.sqrMagnitude < speed * speed * 0.04f) slide = Vector3.Cross(Vector3.up, n) * dirSign;
                    v = slide.normalized * speed;
                }
            }
            Brain.SetDashVelocity(new Vector3(v.x, Brain.DashVelocity.y, v.z));
            TurnToward(Mathf.Atan2(v.x, v.z) * Mathf.Rad2Deg, 360f, dt);
        }

        /// <summary>
        /// 沿 dir 头的前沿再往前 lead 米有没有石柱 / 墙（世界层、近乎竖直的面；离地 2 m、半径 0.7 m 的球，熔池浅碟的缓坡不算）。
        /// wallNormal = 撞到的面朝向；obstacle = 撞到的是殿里的东西（石柱、坠池的鼎），不是殿墙那一圈（墙板、扶壁、炉口、门楼）
        /// </summary>
        bool WallAhead(Vector3 dir, float lead, out Vector3 wallNormal, out bool obstacle)
        {
            wallNormal = Vector3.zero;
            obstacle = false;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return false;
            dir.Normalize();
            var p = Brain.transform.position;
            float reach = Brain.BodyRadius;
            if (Qilin) reach = Mathf.Max(reach, Vector3.Dot(Qilin.HeadPoint - p, dir));
            reach = Mathf.Clamp(reach, 0.5f, 6f);
            var from = new Vector3(p.x, Floor + 2f, p.z);
            if (!Physics.SphereCast(from, 0.7f, dir, out var hit, reach + Mathf.Max(0.05f, lead), Layers.WorldMask, QueryTriggerInteraction.Ignore)) return false;
            if (hit.normal.y >= 0.5f) return false;
            wallNormal = hit.normal;
            var f = Furnace;
            obstacle = !f || f.RadiusOf(hit.point) < f.wallRadius - 0.8f;
            return true;
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
            ChargeLength = ClearOfCauldron(p, chargeDir, ChargeLength);
            Next(Leg.Aim);
            Brain.SetDashVelocity(Vector3.zero);
            var from = OnFloor(p);
            line = WarnLine(from, from + chargeDir * ChargeLength, 4f, 1f);
            Brain.PlayAct("paw", 1f, 0.08f);
            Sfx("telegraph");
            Qilin?.Tell("charge", "地上亮线——火麒麟要横穿象限冲撞，侧移躲开！");
        }

        /// <summary>
        /// 吊着 / 斜挂的巨鼎挡在冲撞线上（鼎足离地 3 m 起，麒麟头高 4–5 m；斜挂时一角落到池沿）：它没有碰撞体，冲过去会一头穿过鼎足，
        /// 所以头、胸、膝三个高度沿线每 0.5 m 查一次落没落进鼎（鼎的局部盒：鼎身 + 足，外扩 0.4 m），碰上之前 0.6 m 就刹住。返回能冲的最远距离
        /// </summary>
        float ClearOfCauldron(Vector3 p, Vector3 dir, float len)
        {
            var cd = Qilin ? Qilin.Cauldron : null;
            if (!cd || !cd.Ding || cd.State is CauldronState.Falling or CauldronState.Fallen) return len;
            var ding = cd.Ding;
            float fwd = Brain.BodyRadius, headY = 4f, chestY = 2.6f;
            if (Qilin)
            {
                var head = Qilin.HeadPoint - p;
                fwd = Mathf.Max(fwd, Vector3.Dot(new Vector3(head.x, 0, head.z), Brain.transform.forward));
                headY = Mathf.Max(1.5f, head.y);
                chestY = Mathf.Max(1f, Qilin.ChestPoint.y - p.y);
            }
            const float pad = 0.4f;
            float halfXZ = QilinCauldron.Half + pad, top = QilinCauldron.HalfY + 0.6f, bottom = -(QilinCauldron.HalfY + QilinCauldron.Leg) - pad;
            for (float t = 0; t <= len; t += 0.5f)
            {
                foreach (float y in new[] { headY, chestY, 1.2f })
                {
                    var lp = ding.InverseTransformPoint(p + dir * (t + fwd) + Vector3.up * y);
                    if (Mathf.Abs(lp.x) < halfXZ && Mathf.Abs(lp.z) < halfXZ && lp.y > bottom && lp.y < top) return Mathf.Max(0.5f, t - 0.6f);
                }
            }
            return len;
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
            if (printSide % 2 == 1) Fx.Burst(at + Vector3.up * 0.2f, QilinPalette.Gold, 3, 3f, 0.4f, 0.14f, 6f);
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
