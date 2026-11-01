using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>夔招式的底座：夔的行为、选招计数（每出一招「距上次捶胸」+1）</summary>
    public abstract class KuiMove : LordMove
    {
        protected KuiBrain Kui => Brain as KuiBrain;
        protected KuiDef KDef => Brain.Def as KuiDef;

        protected override void Prepare()
        {
            if (Kui) Kui.SinceDrum++;
            KuiPrepare();
        }

        protected virtual void KuiPrepare() { }

        /// <summary>玩家在身后（偏离朝向 &gt; 115°）</summary>
        protected bool PlayerBehind => Mathf.Abs(Mathf.DeltaAngle(Facing, YawToPlayer)) > 115f;
    }

    /// <summary>
    /// 夔的蹦跳（《庄子·秋水》「夔以一足趻踔而行」）：蓄力下蹲 → 腾空 → 落地，三段。蹄子只在蓄力和落地时着地，水平位移和转身全在空中（不滑步）。
    /// 前摇 = 蓄力（单腿蹲，片段手 K），出手段 = 腾空（抛物线，代码驱动根节点；片段不带根运动），落地那一帧 = 片段的 land 事件（Cue，按时间兜底）。
    /// 子类定：跳多远（reach，离玩家留 keep）、多高、落地判定。
    /// </summary>
    public abstract class KuiJump : KuiMove
    {
        protected Vector3 from, to;
        protected float height = 1.4f, reach = 3.5f, keep = 3f;
        bool dashing;

        /// <summary>最近一次的起跳点、落点（测试用）</summary>
        public Vector3 From => from;
        public Vector3 To => to;
        /// <summary>落过几次地</summary>
        public int Landings { get; private set; }

        protected override void KuiPrepare()
        {
            from = Brain.transform.position;
            to = Target();
            JumpPrepare();
        }

        protected virtual void JumpPrepare() { }

        /// <summary>落点：朝玩家跳 min(reach, 距离 − keep)，夹进擂台，贴地</summary>
        protected virtual Vector3 Target()
        {
            var p = Brain.PlayerPosition;
            var o = Brain.transform.position;
            var d = p - o;
            d.y = 0;
            float dist = d.magnitude;
            float r = Mathf.Min(reach, Mathf.Max(0, dist - keep));
            var b = o + (dist > 0.1f ? d / dist : Brain.transform.forward) * r;
            b = Brain.ClampToArena(b);
            return OnGround(b);
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            if (to != from) TurnToward(YawTo(to), 240f, dt);
            if (Kui && Random.value < dt * 6f) Fx.KuiCrouch(Brain.transform.position, StageT / Mathf.Max(0.05f, WindupTime));
        }

        protected override void OnActiveBegin()
        {
            Brain.BeginDash(Vector3.zero, 0);
            dashing = true;
            Fx.KuiTakeoff(Brain.transform.position, -Brain.transform.forward, TakeoffSize);
        }

        protected virtual float TakeoffSize => 1f;

        protected override void OnActive(float dt)
        {
            float k = Mathf.Clamp01(StageT / Mathf.Max(0.05f, active));
            var p = Vector3.Lerp(from, to, k);
            p.y += height * 4f * k * (1 - k);
            Brain.transform.position = p;
            Airborne(k, dt);
        }

        protected virtual void Airborne(float k, float dt) { }

        /// <summary>落地：片段的 land 事件（按时间兜底 = 前摇 + 腾空）</summary>
        protected override bool ActiveDone => Cue("land", WindupTime + active);

        protected override void OnRecoverBegin()
        {
            Brain.transform.position = to;
            if (dashing)
            {
                Brain.EndDash();
                dashing = false;
            }
            Landings++;
            MarkRelease();
            Land(to);
        }

        /// <summary>落地的判定和特效</summary>
        protected abstract void Land(Vector3 at);

        protected override void OnRecover(float dt) => Brain.Halt();

        protected override void OnEnd(bool cancelled)
        {
            if (!dashing) return;
            dashing = false;
            var p = Brain.transform.position;
            p.y = LordB ? LordB.GroundAt(p) : p.y;
            Brain.transform.position = p;
            Brain.EndDash();
        }

        /// <summary>落地小冲击：radius 内、站在地上的玩家挨 web 伤害 + 往外推</summary>
        protected void SmallImpact(Vector3 at, float radius, float web)
        {
            Fx.KuiDrumRing(at, radius, 0.3f);
            Fx.KuiDust(at, radius * 0.4f, 4);
            Brain.Shake(0.15f, 0.25f, 20f);
            if (!LordBrain.PlayerFeet(out var feet) || !LordBrain.PlayerGrounded) return;
            if (Flat(feet, at) > radius) return;
            var d = feet - at;
            d.y = 0;
            d = d.sqrMagnitude > 1e-4f ? d.normalized : Brain.transform.forward;
            HurtPlayer(Dmg(web), Element.None, at, d * 6f + Vector3.up * 4f);
        }
    }

    /// <summary>小跳（hop，0.3 / 0.55 / 0.25）：挪位、追人；3.5 m 一跳，落地 3.5 m 小冲击 8。不画地面预警（小招）</summary>
    public sealed class KuiHop : KuiJump
    {
        public const string MoveId = "hop";
        public override string Id => MoveId;
        public override string Name => "小跳";

        public KuiHop()
        {
            windup = 0.3f;
            active = 0.55f;
            recover = 0.25f;
            cooldown = 0f;
            recovery = 0.35f;
            weight = 1f;
            stunnable = true;
            height = 1.4f;
            reach = 3.5f;
            keep = 3f;
        }

        protected override void JumpPrepare()
        {
            if (Kui) Kui.Hops++;
        }

        protected override void Land(Vector3 at) => SmallImpact(at, 3.5f, 8f);
    }

    /// <summary>
    /// 大跳（leap，0.75 / 1.05 / 0.8）：蹲得更深、双拳甩到身后（剪影），落点 4 m 预警圈在起手那一刻出现、腾空 1.05 s 填满；
    /// 双拳砸地 → 鼓皮冲击环扩到 16 m（BossHazards.Wave，环经过时在地上就挨 22，跳起来躲）+ 顿帧；双拳插在地里 0.8 s = 打鼓心的窗口。
    /// 落在带电的经幡杆 4.5 m 内会被回劈（<see cref="KuiBrain.TryBacklash"/>）。
    /// </summary>
    public class KuiLeap : KuiJump
    {
        public const string MoveId = "leap";
        public override string Id => MoveId;
        public override string Name => "大跳";
        /// <summary>冲击环：最大半径、扩散用时（网页 16 m / 0.9 s）、伤害（网页值）</summary>
        public const float RingRadius = 16f, RingSeconds = 0.9f, RingDamage = 22f, LandWarn = 4f;

        /// <summary>最近一次冲击环（测试用）</summary>
        public int Rings { get; private set; }

        public KuiLeap()
        {
            windup = 0.75f;
            active = 1.05f;
            recover = 0.8f;
            cooldown = 1.5f;
            recovery = 0.35f;
            weight = 6f;
            height = 4.2f;
            reach = 14f;
            keep = 0f;
            firstDelay = 1f;
        }

        public override bool Allowed(BossBrain b) => base.Allowed(b) && b.Phase < 2;

        public override float Weight(BossBrain b)
        {
            var k = b as KuiBrain;
            if (!k) return weight;
            bool due = k.Hops % (KDef != null ? KDef.leapEvery : 4) == 3 || b.DistanceToPlayer > (KDef != null ? KDef.leapBeyond : 16f);
            return due ? weight : 0f;
        }

        protected override void Telegraph()
        {
            WarnCircle(to, LandWarn, WindupTime + active);
            Kui?.Tell("kui_leap", "夔要大跳——落地的冲击环跳起来躲", KuiDef.Thunder, 30f, 2f);
        }

        protected override void OnWindup(float dt)
        {
            base.OnWindup(dt);
            if (Cue("glint", WindupTime - 0.25f)) Fx.LdOne("Star", LordB.BonePos(KuiDef.WeakBone), Vector3.zero, 1.6f, 0.2f, KuiPalette.ThunderCore);
        }

        protected override float TakeoffSize => 1.4f;

        protected override void Airborne(float k, float dt)
        {
            if (Random.value < dt * 14f) Fx.KuiCloudTrail(LordB.BonePos("chest"), Vector3.up * (1 - 2 * k) * 8f);
        }

        protected override void Land(Vector3 at)
        {
            var spec = new BossWaveSpec(at, RingRadius / RingSeconds, RingRadius, Dmg(RingDamage), KuiPalette.Skin)
            {
                width = 1.3f, height = 0.85f, knockback = 10f, dust = true, dustColor = KuiPalette.Dust,
            };
            Hazards.Wave(spec);
            Rings++;
            Fx.KuiDrumRing(at, RingRadius, RingSeconds, Last);
            Fx.KuiDust(at, 2.4f, 8);
            Brain.Shake(0.6f, 0.45f, 20f);
            LordB?.ImpactHold(0.08f);
            Kui?.TryBacklash();
        }

        protected virtual bool Last => false;

        protected override void OnRecover(float dt)
        {
            base.OnRecover(dt);
            Fx.KuiCoreGlow(LordB.BonePos(KuiDef.WeakBone), dt, 0.7f);
        }
    }

    /// <summary>
    /// 连环大跳（leapChain，三阶段，0.5 / 0.9 / 0.35 × 3）：三连砸，每跳的蹲更浅、冲击环一个接一个；第三跳后跪得更久（收招 + 0.6 s）。
    /// 一跳一个招式，前两跳收招后直接排下一跳（QueueMove，不喘息）
    /// </summary>
    public sealed class KuiLeapChain : KuiLeap
    {
        public new const string MoveId = "leapChain";
        public override string Id => MoveId;
        public override string Name => "连环大跳";
        public const int Count = 3;

        /// <summary>这一串还剩几跳（含这一跳）</summary>
        public int Left { get; private set; }

        public KuiLeapChain()
        {
            windup = 0.5f;
            active = 0.9f;
            recover = 0.35f;
            cooldown = 2f;
            recovery = 0.35f;
            minPhase = 2;
            height = 3.2f;
            reach = 10f;
            firstDelay = 0;
        }

        public override bool Allowed(BossBrain b) => b.Phase >= minPhase;

        public override float Weight(BossBrain b)
        {
            var k = b as KuiBrain;
            if (!k) return weight;
            return k.Hops % (KDef != null ? KDef.leapEvery : 4) == 3 || b.DistanceToPlayer > (KDef != null ? KDef.leapBeyond : 16f) ? weight : 0f;
        }

        protected override void JumpPrepare()
        {
            if (Left <= 0) Left = Count;
            if (Left == 1) recover += 0.6f;
        }

        protected override bool Last => Left == 1;

        protected override void OnEnd(bool cancelled)
        {
            base.OnEnd(cancelled);
            if (cancelled)
            {
                Left = 0;
                return;
            }
            Left--;
            if (Left > 0)
            {
                recovery = 0f;
                Brain.QueueMove(Id);
            }
            else recovery = 0.35f;
        }
    }

    /// <summary>转身跳（turnLeap，0.3 / 0.5 / 0.3）：玩家绕到身后（&gt; 115°、12 m 内），原地一蹲、空中转 180°，落地 5 m 冲击 10</summary>
    public sealed class KuiTurnLeap : KuiJump
    {
        public const string MoveId = "turnLeap";
        public override string Id => MoveId;
        public override string Name => "转身跳";
        float turnFrom;

        public KuiTurnLeap()
        {
            windup = 0.3f;
            active = 0.5f;
            recover = 0.3f;
            cooldown = 2.5f;
            recovery = 0.35f;
            weight = 20f;
            height = 1.4f;
            stunnable = true;
        }

        public override float Weight(BossBrain b) => PlayerBehindOf(b) && b.DistanceToPlayer < 12f ? weight : 0f;

        static bool PlayerBehindOf(BossBrain b)
        {
            var d = b.PlayerPosition - b.transform.position;
            d.y = 0;
            if (d.sqrMagnitude < 1e-4f) return false;
            return Vector3.Angle(b.transform.forward, d) > 115f;
        }

        protected override Vector3 Target() => Brain.transform.position;

        protected override void JumpPrepare() => turnFrom = Facing;

        protected override void Airborne(float k, float dt) => SetFacing(turnFrom + 180f * k * k * (3 - 2 * k));

        protected override void Land(Vector3 at) => SmallImpact(at, 5f, 10f);
    }
}
