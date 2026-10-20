using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 代理首领 · 震地：前摇时玩家脚下（预判 0.5 s，最远 14 m，夹进场地）亮出圆形预警，预警填满时跃起，抛物线落到预警圈里砸地——
    /// 圈内按距离衰减吃伤害并被掀开（冲刺无敌帧闪得过、墙后不受伤），地面裂开一圈。跳的路上被挡住就在落下的地方砸
    /// </summary>
    public sealed class ProxySlam : BossMove
    {
        public const string MoveId = "slam";
        public const float Radius = 5.5f, MaxLeap = 14f, Gravity = 34f, Flight = 0.6f;

        public override string Id => MoveId;
        public override string Name => "震地";

        /// <summary>累计砸中玩家的次数（测试用）</summary>
        public int Hits { get; private set; }
        /// <summary>本次的落点（预警圈中心）</summary>
        public Vector3 Target { get; private set; }

        bool landed;

        public ProxySlam()
        {
            cooldown = 6f;
            recovery = 1.1f;
            weight = 2.4f;
            windup = 1.1f;
            active = Flight + 0.8f;
            recover = 0.8f;
            windupAnim = "chordWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 18f ? weight : weight * 0.5f;

        protected override void OnStart()
        {
            landed = false;
            var from = Brain.transform.position;
            var want = Brain.Predict(0.5f);
            var d = want - from;
            d.y = 0;
            if (d.magnitude > MaxLeap) want = from + d.normalized * MaxLeap;
            var t = Brain.ClampToArena(want);
            if (Physics.Raycast(t + Vector3.up * 6f, Vector3.down, out var hit, 20f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) t.y = hit.point.y;
            Target = t;
            Brain.Halt();
            Brain.FaceNow(Target);
        }

        protected override void OnTelegraph() => WarnCircle(Target, Radius, WindupTime);

        protected override void OnWindup(float dt)
        {
            Brain.Face(Target, 240f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, WindupTime)));
        }

        protected override void OnActiveBegin()
        {
            var from = Brain.transform.position;
            var d = Target - from;
            float dy = d.y;
            d.y = 0;
            var v = d / Flight;
            v.y = (dy + 0.5f * Gravity * Flight * Flight) / Flight;
            Brain.BeginDash(v, Gravity);
            Brain.PlaySfx("enemy_charge", 0.8f, 0.6f);
        }

        protected override void OnActive(float dt)
        {
            if (landed) return;
            if ((StageT > 0.15f && Brain.DashGrounded) || StageT >= Flight + 0.5f) Land();
        }

        protected override bool ActiveDone => landed;

        void Land()
        {
            landed = true;
            Brain.EndDash();
            var c = Brain.transform.position;
            if (Brain.BlastPlayer(c + Vector3.up * 0.5f, Radius, Damage(1.6f), 0.55f) > 0) Hits++;
            var color = Brain.Def.color;
            SkillFx.Ring(c, Radius, WarnTint, 0.35f);
            SkillFx.Burst(c + Vector3.up * 0.4f, color, 28, 9f, 0.8f, 0.4f, 6f);
            SkillFx.GroundCrack(c, Radius * 0.8f, color, 1.6f);
            Brain.Shake(0.55f, 0.45f, 40f);
            Brain.PlaySfx("boss_slam");
            Brain.Glow(0, 0);
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.EndDash();
            Brain.Glow(0, 0);
        }
    }

    /// <summary>
    /// 代理首领 · 冲撞：朝玩家拉一条直线预警（前摇前半段还跟着玩家转，越过玩家 7 m、最长 26 m，截到场地边界），预警填满后沿线冲过去；
    /// 冲过玩家身边（线宽一半以内）撞一下并把人往侧面掀开，每次冲撞只撞一下。撞墙 / 到头 / 出界就停
    /// </summary>
    public sealed class ProxyDash : BossMove
    {
        public const string MoveId = "dash";
        public const float Speed = 22f, Width = 3.2f, MaxLength = 26f, Overshoot = 7f;

        public override string Id => MoveId;
        public override string Name => "冲撞";

        public int Hits { get; private set; }
        /// <summary>本次冲出的距离（米）</summary>
        public float Travelled { get; private set; }

        Vector3 from, dir, lastPos;
        float length;
        bool hitDone;
        Telegraph.LineHandle line;

        public ProxyDash()
        {
            cooldown = 7f;
            recovery = 1f;
            weight = 2f;
            windup = 0.9f;
            active = 2.5f;
            recover = 0.7f;
            windupAnim = "bloomWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 6f ? weight : weight * 0.4f;

        protected override void OnStart()
        {
            hitDone = false;
            Travelled = 0;
            Aim();
        }

        void Aim()
        {
            from = Brain.transform.position;
            var d = Brain.PlayerPosition - from;
            d.y = 0;
            dir = d.sqrMagnitude > 0.01f ? d.normalized : Brain.transform.forward;
            dir.y = 0;
            dir.Normalize();
            length = Mathf.Min(MaxLength, d.magnitude + Overshoot);
            if (Brain.Arena) length = Mathf.Min(length, Brain.Arena.DistanceToEdge(from, dir, Brain.ArenaMargin));
            length = Mathf.Max(3f, length);
        }

        protected override void OnTelegraph() => line = WarnLine(from, from + dir * length, Width, WindupTime);

        protected override void OnWindup(float dt)
        {
            // 前半段还在调整方向（同镇墓兽冲锋），后半段锁死
            if (StageT < WindupTime * 0.5f)
            {
                Aim();
                line?.Move(from, from + dir * length, Width);
            }
            Brain.Face(from + dir, 360f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, WindupTime)));
        }

        protected override void OnActiveBegin()
        {
            Brain.FaceNow(from + dir);
            lastPos = Brain.transform.position;
            Brain.BeginDash(dir * Speed, 30f);
            Brain.PlaySfx("boss_roar", 0.6f, 1.4f);
        }

        protected override void OnActive(float dt)
        {
            var p = Brain.transform.position;
            var step = p - lastPos;
            step.y = 0;
            Travelled += step.magnitude;
            if (!hitDone) CheckHit(lastPos, p);
            lastPos = p;
            bool outOfArena = Brain.Arena && !Brain.Arena.Contains(p, Brain.BodyRadius * 0.5f);
            if (Travelled >= length || Brain.DashHitWall || outOfArena || (StageT > 0.2f && step.sqrMagnitude < 1e-6f)) EndActive();
        }

        void CheckHit(Vector3 a, Vector3 b)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var pp = Brain.PlayerPosition;
            if (Mathf.Abs(pp.y - a.y) > 3f) return;
            var ab = b - a;
            ab.y = 0;
            var ap = pp - a;
            ap.y = 0;
            float t = ab.sqrMagnitude > 1e-6f ? Mathf.Clamp01(Vector3.Dot(ap, ab) / ab.sqrMagnitude) : 0;
            var off = ap - ab * t;
            if (off.magnitude > Width * 0.5f + Brain.BodyRadius * 0.25f + 0.4f) return;
            hitDone = true;
            var at = a + ab * t;
            if (!Brain.HitPlayer(Damage(1.3f), at + Vector3.up)) return;
            Hits++;
            var side = Vector3.Cross(Vector3.up, dir);
            if (Vector3.Dot(off, side) < 0) side = -side;
            var motor = pv.GetComponent<PlayerMotor>();
            if (motor) motor.AddImpulse(side * 9f + dir * 6f + Vector3.up * 4f);
            Brain.Shake(0.45f, 0.35f, 30f);
            Brain.PlaySfx("enemy_melee", 1f, 0.6f);
        }

        protected override void OnRecoverBegin()
        {
            Brain.EndDash();
            Brain.Halt();
            Brain.Glow(0, 0);
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.EndDash();
            Brain.Glow(0, 0);
        }
    }

    /// <summary>
    /// 代理首领 · 召唤：脚下亮一圈紫色预警，举手召来两只跳鼠刀兵（先在场地召唤点上亮落点预警，0.8 s 后出现）。
    /// 这种爪牙同时最多 4 只（场上满了这招权重为 0）；首领倒下时全部崩解
    /// </summary>
    public sealed class ProxySummon : BossMove
    {
        public const string MoveId = "summon";
        static readonly Color Purple = new(0.75f, 0.45f, 1f);

        public override string Id => MoveId;
        public override string Name => "召唤";

        /// <summary>召唤哪种敌人、每次几只、这种最多同时几只</summary>
        public string enemyId = "jerboa_blade";
        public int count = 2, cap = 4;
        /// <summary>上一次实际排进预警的数量</summary>
        public int LastQueued { get; private set; }

        public ProxySummon()
        {
            cooldown = 12f;
            recovery = 1f;
            weight = 1.2f;
            firstDelay = 4f;
            windup = 0.9f;
            active = 0.2f;
            recover = 0.6f;
            windupAnim = "blessWindup";
        }

        public override float Weight(BossBrain b) =>
            b.Summons.Count(enemyId) >= cap || b.Summons.Alive + b.Summons.PendingCount >= b.Summons.Cap ? 0 : weight;

        protected override void OnTelegraph() => WarnCircle(Brain.transform.position, Brain.BodyRadius + 2f, WindupTime, Purple);

        protected override void OnWindup(float dt)
        {
            Brain.Face(Brain.PlayerPosition, 120f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, WindupTime)));
        }

        protected override void OnActiveBegin()
        {
            var o = SummonOptions.Default;
            o.cap = cap;
            LastQueued = Brain.Summons.Spawn(enemyId, count, o);
            Brain.PlaySfx("boss_roar", 0.5f, 1.6f);
            SkillFx.Burst(Brain.BodyCenter, Purple, 20, 5f, 0.8f, 0.3f, 4f);
            Brain.Glow(0, 0);
        }

        protected override void OnEnd(bool cancelled) => Brain.Glow(0, 0);
    }
}
