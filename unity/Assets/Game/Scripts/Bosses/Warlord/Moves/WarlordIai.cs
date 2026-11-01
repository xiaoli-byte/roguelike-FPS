using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 魔将 · 居合 · 一闪（剑士化 v2，设计单 §13.4）：拔剑式的居合重斩——「先过身，后见光」。
    ///   按刀（前摇 0.95 / 二阶段 0.85 / 狂怒 0.75 s）：身子压低、剑收到左腰后，一条 3 m 宽的直线预警从他脚下铺向玩家身后 4 m（8–14 m，狂怒 × 1.15，夹到场地边）；
    ///   拔刀（前摇结束）：0.14 s 沿直线突进到线尾（突进本身不伤人）；
    ///   纳刀「咔」：收刀的那一帧整条线上的刀光才现形（迟到的刀光），这一刻判定——站在线里挨 30，往侧面掀开。预警填满 = 收刀 = 刀光。
    /// 狂怒时回身再来一次（重新瞄准，按刀 0.6 s）。收刀之后回身的那 0.5 s（胸口转向玩家）+ 收招是破绽窗口。
    /// </summary>
    public sealed class WarlordIai : WarlordSwordMove
    {
        public const string MoveId = "warlord_iai";
        public override string Id => MoveId;
        public override string Name => "魔将 · 居合一闪";

        enum Leg { Aim, Dash, Sheathe, Rest }

        /// <summary>线宽的一半（一阶段 / 之后）、离玩家身后多远、最短 / 最长</summary>
        public const float HalfWidth0 = 1.5f, HalfWidth = 1.7f, Beyond = 4f, MinLen = 8f, MaxLen = 14f;

        Leg leg;
        float legT, w, sheathe, len, half;
        int left;
        Vector3 from, dir;

        /// <summary>出过几次刀光、砍中几次、上一刀的线长（测试 / 节拍条用）</summary>
        public int Cuts { get; private set; }
        public int Hits { get; private set; }
        public float LastLength => len;
        /// <summary>这一刀按刀 / 纳刀用了多久（秒）</summary>
        public float LastWindup => w;
        public float LastSheathe => sheathe;

        public WarlordIai()
        {
            cooldown = 6.5f;
            recovery = 1f;
            windup = 0.95f;
            recover = 0.1f;
        }

        public override float Weight(BossBrain b)
        {
            float d = b.DistanceToPlayer;
            return d >= 5f && d <= 15f ? 2.8f : d < 5f ? 0.8f : 1.2f;
        }

        /// <summary>按刀时长 w 下的纳刀时长：片段 iai 里拔刀在 24 / 48、收刀在 36 / 48，整段按同一个倍率拉伸 → 突进 + 纳刀 = w × (36 / 24 − 1)</summary>
        public static float SheatheFor(float windupSeconds) => Mathf.Max(0.16f, windupSeconds * (WarlordSword.IaiHitAt / WarlordSword.IaiDashAt - 1f) - WarlordSword.IaiDash);

        protected override void OnStart()
        {
            left = Fury ? 2 : 1;
            float first = Phase >= 2 || Fury ? 0.75f : Phase >= 1 ? 0.85f : 0.95f;
            Aim(first * Brain.WindupScale, false);
        }

        void Aim(float windupSeconds, bool again)
        {
            leg = Leg.Aim;
            legT = 0;
            w = windupSeconds;
            sheathe = SheatheFor(w);
            Brain.Halt();
            from = Brain.transform.position;
            var want = Brain.Predict(0.25f) - from;
            want.y = 0;
            float d = want.magnitude;
            dir = d < 0.5f ? Dir(Facing) : want / d;
            float edge = ToEdge(from, dir, 1.5f);
            len = Mathf.Clamp(d + Beyond, MinLen, MaxLen * Reach);
            len = Mathf.Clamp(len, Mathf.Min(4f, edge), Mathf.Max(3f, edge));
            half = Phase >= 1 || Fury ? HalfWidth : HalfWidth0;
            Brain.FaceNow(Brain.transform.position + dir);
            var ground = from;
            ground.y = Floor;
            Hazards.LineWarning(ground, WarlordSword.Yaw(dir), len, half, w + WarlordSword.IaiDash + sheathe, WarlordSword.Warn);
            // 回身再斩时第一刀的片段正在退回待机：交叉淡入
            if (again) ActCrossfade("iai", (w + WarlordSword.IaiDash + sheathe) / WarlordSword.IaiHitAt);
            else Act("iai", (w + WarlordSword.IaiDash + sheathe) / WarlordSword.IaiHitAt);
            Sfx("telegraph", 1f, 0.9f);
        }

        protected override bool WindupDone => StageT >= w;

        protected override void OnWindup(float dt)
        {
            Brain.Face(Brain.transform.position + dir, 400f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, w)));
        }

        /// <summary>出手段由腿自己结束（EndActive）；8 s 兜底防卡死</summary>
        protected override bool ActiveDone => StageT > 8f;

        protected override void OnActiveBegin() => Dash();

        void Dash()
        {
            leg = Leg.Dash;
            legT = 0;
            float dash = Mathf.Max(1.5f, len - 1.8f);
            Brain.FaceNow(Brain.transform.position + dir);
            Brain.BeginDash(dir * (dash / WarlordSword.IaiDash), 0f);
            Brain.Glow(0, 1);
            Sfx("enemy_charge", 1f, 1.4f);
            if (LordFx is { } lord) lord.IaiDraw(from, dir, dash);
            else Fx.Beam(from + Vector3.up * 1.4f, from + dir * dash + Vector3.up * 1.4f, WarlordSword.Fire, 0.12f, 0.15f);
        }

        protected override void OnActive(float dt)
        {
            legT += dt;
            switch (leg)
            {
                case Leg.Aim:
                    Brain.Face(Brain.transform.position + dir, 400f, dt);
                    if (legT >= w) Dash();
                    break;
                case Leg.Dash:
                    if (legT < WarlordSword.IaiDash && !(Brain.DashHitWall && legT > 0.04f)) break;
                    Brain.EndDash();
                    Brain.Halt();
                    leg = Leg.Sheathe;
                    // 纳刀从拔刀那一刻起算（撞上掩体提前停下也不提前出刀光：预警填满才出）
                    legT -= WarlordSword.IaiDash;
                    break;
                case Leg.Sheathe:
                    Brain.Halt();
                    if (legT < sheathe) break;
                    Cut();
                    leg = Leg.Rest;
                    legT = 0;
                    break;
                default:
                    Brain.Halt();
                    // 纳刀之后回身：胸口（地火之心）转向玩家
                    Brain.Face(Brain.PlayerPosition, 260f, dt);
                    if (left > 0 && legT >= 0.3f) Aim(0.6f * Brain.WindupScale, true);
                    else if (left <= 0 && legT >= 0.5f) EndActive();
                    break;
            }
        }

        void Cut()
        {
            left--;
            Cuts++;
            bool hit = false;
            if (Player(out var feet, out float pr) && WarlordSword.InLane(from, dir, len, half, feet, pr, 3f))
            {
                var off = feet - from;
                float side = off.x * dir.z - off.z * dir.x >= 0 ? 1f : -1f;
                var lateral = new Vector3(dir.z, 0, -dir.x) * side;
                hit = Strike(Dmg(30), from + dir * (len * 0.5f) + Vector3.up, lateral * 9f + dir * 3f + Vector3.up * 4f);
            }
            if (hit)
            {
                Hits++;
                Sfx("enemy_melee", 1f, 0.7f);
            }
            Sfx("skill_fire", 0.9f, 1.3f);
            Brain.Glow(0, 0);
            if (LordFx is { } lord) lord.IaiCut(from, dir, len, half, hit);
            else
            {
                Fx.Slash(from + dir * (len * 0.5f) + Vector3.up * 1.3f, WarlordSword.Yaw(dir) + 90f, len * 0.6f, 1.6f, 1, 0, 0.6f, 0.3f, WarlordSword.Fire, true);
                Brain.Shake(0.4f, 0.3f);
            }
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.EndDash();
            Brain.Glow(0, 0);
        }
    }
}
