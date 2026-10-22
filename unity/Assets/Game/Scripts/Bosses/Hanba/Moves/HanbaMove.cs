using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一招的时间轴（秒）：前摇 / 出手 / 收招。击杀用时模拟和测试报告用</summary>
    public readonly struct HanbaMovePlan
    {
        public readonly float windup, active, recover;

        public HanbaMovePlan(float windup, float active, float recover)
        {
            this.windup = windup;
            this.active = active;
            this.recover = recover;
        }

        public float Total => windup + active + recover;

        public override string ToString() => $"{windup:F2} + {active:F2} + {recover:F2} s";
    }

    /// <summary>
    /// 旱魃招式的基类：危险物集合（<see cref="BossHazards"/>）、日轮、日晒、阶段节奏、动作触发和几样朝向 / 地面工具（同 B1 参考招式的写法）。
    /// 动作：<see cref="Act"/> 触发 ART2 的 act_&lt;状态&gt;，按「出手事件在片段里的位置」把整段拉伸到实际前摇——出手事件正好落在前摇结束，
    /// <see cref="BossMove.Cue"/> 先到先算，代理模型没有片段时按时间兜底。
    /// 预警：地面圆 / 直线走 BossMove 的 WarnCircle / WarnLine（计 TelegraphCount）；扇形等走 BossHazards 的招式组预警，用 <see cref="Warned"/> 记数。
    /// 角度一律世界 yaw（度），0 = +Z。
    /// </summary>
    public abstract class HanbaMove : BossMove
    {
        BossHazards hazards;

        protected BossHazards Hazards => hazards ? hazards : hazards = BossHazards.For(Brain);
        protected HanbaBrain Hanba => Brain as HanbaBrain;
        protected HanbaDef HDef => Brain.Def as HanbaDef;
        protected SunRing Ring => Hanba ? Hanba.Ring : null;
        protected SunExposure Exposure => Hanba ? Hanba.Exposure : null;

        /// <summary>经 BossHazards 画的预警个数（扇形、地面长条…；BossMove 自己的 WarnCircle / WarnLine 记在 TelegraphCount）</summary>
        public int ExtraWarnings { get; private set; }
        /// <summary>预警合计</summary>
        public int Warned => TelegraphCount + ExtraWarnings;
        /// <summary>本次出招的阶段节奏（出招第一帧取；二、三阶段 &gt; 1：前摇更短、扫得更快，见 <see cref="HanbaDef.pace"/>）</summary>
        protected float PaceNow { get; private set; } = 1f;

        /// <summary>记一个经 BossHazards 画的预警（同时让首领派发 MoveTelegraphed）</summary>
        protected void CountWarning()
        {
            ExtraWarnings++;
            Brain.NotifyTelegraph(this);
        }

        /// <summary>出招第一帧：取阶段节奏，再交给子类</summary>
        protected sealed override void OnStart()
        {
            PaceNow = Hanba ? Hanba.Pace : 1f;
            Prepare();
        }

        /// <summary>子类的出招第一帧（选目标、记落点）</summary>
        protected virtual void Prepare() { }

        /// <summary>播一个 ART2 招式状态，拉伸到 seconds 秒播完</summary>
        protected void Act(string state, float seconds)
        {
            if (Hanba) Hanba.Act(state, seconds);
            else Brain.PlayAct(state, seconds);
        }

        /// <summary>本次出招的实际前摇（秒，<see cref="Windup"/> 算出的；测试比较各阶段的节奏）</summary>
        public float WindNow { get; private set; }

        /// <summary>前摇时长 = 定义前摇 ÷ 阶段节奏 × 狂怒前摇倍率（同时记进 <see cref="WindNow"/>）</summary>
        protected float Windup(float baseSeconds) => WindNow = Mathf.Max(0.25f, baseSeconds / Mathf.Max(0.5f, PaceNow) * Brain.WindupScale);

        /// <summary>不随节奏 / 狂怒变的前摇（日蚀：片段原速播，3 s 窗口要对得上 eclipseStart / eclipseEnd），同样记进 <see cref="WindNow"/></summary>
        protected float FixedWindup(float seconds) => WindNow = Mathf.Max(0.05f, seconds);

        /// <summary>
        /// 某个阶段节奏下这一招的时间轴（前摇 / 出手 / 收招，秒；不含招式之间的喘息）：击杀用时模拟（<see cref="HanbaBalance"/>）按它排招。
        /// 缺省 = 定义前摇 ÷ 节奏、定义出手、定义收招；出手时长由运动决定的招式（扫射、热浪、裂缝蔓延）自己覆盖
        /// </summary>
        public virtual HanbaMovePlan Plan(float pace) => new(Mathf.Max(0.25f, windup / Mathf.Max(0.5f, pace)), active, recover);

        protected float Floor => Brain.Arena ? Brain.Arena.FloorY : GroundY(Brain.transform.position);
        protected float Facing => Brain.transform.eulerAngles.y;

        protected float YawToPlayer
        {
            get
            {
                var d = Brain.PlayerPosition - Brain.transform.position;
                d.y = 0;
                return d.sqrMagnitude > 1e-4f ? Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg : Facing;
            }
        }

        protected static Vector3 Dir(float yawDeg)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        protected void SetFacing(float yawDeg) => Brain.transform.rotation = Quaternion.Euler(0, yawDeg, 0);

        protected void TurnToward(float yawDeg, float degPerSec, float dt) => SetFacing(Mathf.MoveTowardsAngle(Facing, yawDeg, degPerSec * dt));

        /// <summary>(x, z) 处、参考高度附近的地面高度（打不到时原样）</summary>
        protected static float GroundY(Vector3 p, float above = 6f) =>
            Physics.Raycast(p + Vector3.up * above, Vector3.down, out var h, above + 20f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y;

        /// <summary>首领脚下水平面上的点贴到地面</summary>
        protected Vector3 OnGround(Vector3 p)
        {
            p.y = Brain.transform.position.y;
            p.y = GroundY(p);
            return p;
        }

        protected void Sfx(string id, float volume = 1f, float pitch = 1f) => Brain.PlaySfx(id, volume, pitch);

        static RunRng fallbackRng;

        /// <summary>方向 / 落点的随机流（本局有种子时可复现）</summary>
        protected static RunRng Rng => RunState.Current != null ? RunState.Current.Stream("boss_hanba") : fallbackRng ??= new RunRng(System.Environment.TickCount);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => fallbackRng = null;

        protected override void OnEnd(bool cancelled)
        {
            if (Ring) Ring.Idle();
            Brain.Glow(0, 0);
        }
    }
}
